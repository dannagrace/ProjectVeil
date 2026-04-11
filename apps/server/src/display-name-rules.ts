import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_DISPLAY_NAME_VALIDATION_RULES,
  findDisplayNameModerationViolation,
  normalizeDisplayNameValidationRules,
  normalizeTextForModeration,
  type DisplayNameModerationViolation,
  type DisplayNameValidationRules
} from "../../../packages/shared/src/index";
import type { RoomSnapshotStore } from "./persistence";

const DEFAULT_DISPLAY_NAME_RULES_PATH = path.resolve(process.cwd(), "configs/display-name-rules.json");
const DEFAULT_DISPLAY_NAME_RULES_RELOAD_INTERVAL_MS = 30_000;
const BANNED_ACCOUNT_NAME_RESERVATION_DAYS = 7;

interface DisplayNameRuleRuntimeDependencies {
  readFileSync(filePath: string, encoding: BufferEncoding): string;
  statSync(filePath: string): fs.Stats;
  now(): number;
}

const defaultDisplayNameRuleRuntimeDependencies: DisplayNameRuleRuntimeDependencies = {
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
  statSync: (filePath) => fs.statSync(filePath),
  now: () => Date.now()
};

let displayNameRuleRuntimeDependencies = defaultDisplayNameRuleRuntimeDependencies;

interface CachedDisplayNameRuleState {
  rules: DisplayNameValidationRules;
  source: "env_override" | "file" | "default_fallback";
  configuredPath: string;
  checksum: string;
  loadedAtMs: number;
  lastCheckedAtMs: number;
  sourceUpdatedAtMs?: number;
  lastError?: string;
}

export interface DisplayNameRuleRuntimeSnapshot {
  rules: DisplayNameValidationRules;
  metadata: {
    source: "env_override" | "file" | "default_fallback";
    configuredPath: string;
    checksum: string;
    loadedAt: string;
    lastCheckedAt: string;
    reloadIntervalMs: number;
    sourceUpdatedAt?: string;
    lastError?: string;
  };
}

export interface DisplayNameReservationMatch {
  playerId: string;
  displayName: string;
  reservedUntil: string;
  reason: string;
}

export class InvalidDisplayNameError extends Error {
  readonly violation: DisplayNameModerationViolation;

  constructor(displayName: string, violation: DisplayNameModerationViolation) {
    super(buildDisplayNameViolationMessage(displayName, violation));
    this.name = "invalid_display_name";
    this.violation = violation;
  }
}

export class ReservedDisplayNameError extends Error {
  readonly reservation: DisplayNameReservationMatch;

  constructor(displayName: string, reservation: DisplayNameReservationMatch) {
    super(
      `Display name "${displayName.trim()}" is temporarily reserved until ${reservation.reservedUntil} because it was used by a banned account`
    );
    this.name = "display_name_reserved";
    this.reservation = reservation;
  }
}

let cachedDisplayNameRuleState: CachedDisplayNameRuleState | null = null;

function parseReloadIntervalMs(value: string | undefined): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DISPLAY_NAME_RULES_RELOAD_INTERVAL_MS;
  }

  return parsed;
}

function hashRules(rules: DisplayNameValidationRules): string {
  return crypto.createHash("sha256").update(JSON.stringify(rules)).digest("hex");
}

function buildDisplayNameViolationMessage(displayName: string, violation: DisplayNameModerationViolation): string {
  if (violation.term === "empty_name") {
    return "Display name must not be empty";
  }

  if (violation.term === "min_length") {
    return `Display name "${displayName.trim()}" is too short for current game rules`;
  }

  if (violation.term === "max_length") {
    return `Display name "${displayName.trim()}" is too long for current game rules`;
  }

  if (violation.reason === "reserved") {
    return `Display name "${displayName.trim()}" contains a reserved term`;
  }

  if (violation.reason === "profanity") {
    return `Display name "${displayName.trim()}" contains banned content`;
  }

  return `Display name "${displayName.trim()}" violates current game rules`;
}

function parseRulesOverride(rawValue: string | undefined): DisplayNameValidationRules | null {
  if (!rawValue?.trim()) {
    return null;
  }

  try {
    return normalizeDisplayNameValidationRules(JSON.parse(rawValue) as Partial<DisplayNameValidationRules>);
  } catch (error) {
    console.warn("[DisplayNameRules] Failed to parse VEIL_DISPLAY_NAME_RULES_JSON override", error);
    return null;
  }
}

function buildRuntimeSnapshot(state: CachedDisplayNameRuleState, reloadIntervalMs: number): DisplayNameRuleRuntimeSnapshot {
  return {
    rules: state.rules,
    metadata: {
      source: state.source,
      configuredPath: state.configuredPath,
      checksum: state.checksum,
      loadedAt: new Date(state.loadedAtMs).toISOString(),
      lastCheckedAt: new Date(state.lastCheckedAtMs).toISOString(),
      reloadIntervalMs,
      ...(state.sourceUpdatedAtMs !== undefined ? { sourceUpdatedAt: new Date(state.sourceUpdatedAtMs).toISOString() } : {}),
      ...(state.lastError ? { lastError: state.lastError } : {})
    }
  };
}

function loadDisplayNameRuleSnapshot(env: NodeJS.ProcessEnv = process.env): DisplayNameRuleRuntimeSnapshot {
  const nowMs = displayNameRuleRuntimeDependencies.now();
  const reloadIntervalMs = parseReloadIntervalMs(env.VEIL_DISPLAY_NAME_RULES_RELOAD_INTERVAL_MS);
  const configuredPath = env.VEIL_DISPLAY_NAME_RULES_PATH?.trim() || DEFAULT_DISPLAY_NAME_RULES_PATH;
  const override = parseRulesOverride(env.VEIL_DISPLAY_NAME_RULES_JSON);

  if (override) {
    cachedDisplayNameRuleState = {
      rules: override,
      source: "env_override",
      configuredPath,
      checksum: hashRules(override),
      loadedAtMs: nowMs,
      lastCheckedAtMs: nowMs
    };
    return buildRuntimeSnapshot(cachedDisplayNameRuleState, reloadIntervalMs);
  }

  if (
    cachedDisplayNameRuleState &&
    cachedDisplayNameRuleState.source !== "env_override" &&
    cachedDisplayNameRuleState.configuredPath === configuredPath &&
    nowMs - cachedDisplayNameRuleState.lastCheckedAtMs < reloadIntervalMs
  ) {
    return buildRuntimeSnapshot(cachedDisplayNameRuleState, reloadIntervalMs);
  }

  try {
    const stats = displayNameRuleRuntimeDependencies.statSync(configuredPath);
    if (
      cachedDisplayNameRuleState &&
      cachedDisplayNameRuleState.source === "file" &&
      cachedDisplayNameRuleState.configuredPath === configuredPath &&
      cachedDisplayNameRuleState.sourceUpdatedAtMs === stats.mtimeMs
    ) {
      cachedDisplayNameRuleState = {
        ...cachedDisplayNameRuleState,
        lastCheckedAtMs: nowMs
      };
      return buildRuntimeSnapshot(cachedDisplayNameRuleState, reloadIntervalMs);
    }

    const raw = displayNameRuleRuntimeDependencies.readFileSync(configuredPath, "utf8");
    const rules = normalizeDisplayNameValidationRules(JSON.parse(raw) as Partial<DisplayNameValidationRules>);
    cachedDisplayNameRuleState = {
      rules,
      source: "file",
      configuredPath,
      checksum: hashRules(rules),
      loadedAtMs: nowMs,
      lastCheckedAtMs: nowMs,
      sourceUpdatedAtMs: stats.mtimeMs
    };
  } catch (error) {
    console.warn(`[DisplayNameRules] Falling back to defaults after failing to load ${configuredPath}`, error);
    cachedDisplayNameRuleState = {
      rules: DEFAULT_DISPLAY_NAME_VALIDATION_RULES,
      source: "default_fallback",
      configuredPath,
      checksum: hashRules(DEFAULT_DISPLAY_NAME_VALIDATION_RULES),
      loadedAtMs: nowMs,
      lastCheckedAtMs: nowMs,
      lastError: error instanceof Error ? error.message : String(error)
    };
  }

  return buildRuntimeSnapshot(cachedDisplayNameRuleState, reloadIntervalMs);
}

export function configureDisplayNameRuleRuntimeDependencies(
  overrides: Partial<DisplayNameRuleRuntimeDependencies>
): void {
  displayNameRuleRuntimeDependencies = {
    ...displayNameRuleRuntimeDependencies,
    ...overrides
  };
}

export function resetDisplayNameRuleRuntimeDependencies(): void {
  displayNameRuleRuntimeDependencies = defaultDisplayNameRuleRuntimeDependencies;
}

export function clearCachedDisplayNameRules(): void {
  cachedDisplayNameRuleState = null;
}

export function getDisplayNameRuleRuntimeSnapshot(env: NodeJS.ProcessEnv = process.env): DisplayNameRuleRuntimeSnapshot {
  return loadDisplayNameRuleSnapshot(env);
}

export function loadDisplayNameValidationRules(env: NodeJS.ProcessEnv = process.env): DisplayNameValidationRules {
  return loadDisplayNameRuleSnapshot(env).rules;
}

export function normalizeDisplayNameForLookup(displayName: string): string {
  return normalizeTextForModeration(displayName);
}

export function buildBannedAccountNameReservationExpiry(now = new Date()): string {
  return new Date(now.getTime() + BANNED_ACCOUNT_NAME_RESERVATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function validateDisplayNameOrThrow(
  displayName: string,
  env: NodeJS.ProcessEnv = process.env
): DisplayNameValidationRules {
  const rules = loadDisplayNameValidationRules(env);
  const violation = findDisplayNameModerationViolation(displayName, rules);
  if (violation) {
    throw new InvalidDisplayNameError(displayName, violation);
  }

  return rules;
}

export async function assertDisplayNameAvailableOrThrow(
  store: Pick<RoomSnapshotStore, "findActivePlayerNameReservation"> | null | undefined,
  displayName: string,
  playerId?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<DisplayNameValidationRules> {
  const rules = validateDisplayNameOrThrow(displayName, env);
  const reservation = await store?.findActivePlayerNameReservation?.(displayName);
  if (reservation && reservation.playerId !== playerId?.trim()) {
    throw new ReservedDisplayNameError(displayName, reservation);
  }

  return rules;
}
