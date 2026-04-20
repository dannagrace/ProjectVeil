import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { DEFAULT_FEATURE_FLAG_CONFIG, DEFAULT_MIN_SUPPORTED_CLIENT_VERSION, evaluateFeatureEntitlements, evaluateFeatureFlags, type FeatureFlagConfigDocument, type FeatureFlagKey, type FeatureFlagRolloutPolicy, type FeatureFlags, normalizeClientVersion, normalizeFeatureFlagConfigDocument, type ResolvedFeatureEntitlements, type RuntimeKillSwitchDefinition } from "@veil/shared/platform";

const DEFAULT_FEATURE_FLAG_CONFIG_PATH = path.resolve(process.cwd(), "configs/feature-flags.json");
const DEFAULT_FEATURE_FLAG_RELOAD_INTERVAL_MS = 30_000;
const DEFAULT_FEATURE_FLAG_STALE_THRESHOLD_MS = 120_000;

interface FeatureFlagRuntimeDependencies {
  readFileSync(filePath: string, encoding: BufferEncoding): string;
  statSync(filePath: string): fs.Stats;
  now(): number;
}

const defaultFeatureFlagRuntimeDependencies: FeatureFlagRuntimeDependencies = {
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
  statSync: (filePath) => fs.statSync(filePath),
  now: () => Date.now()
};

let featureFlagRuntimeDependencies = defaultFeatureFlagRuntimeDependencies;

export interface FeatureFlagRuntimeMetadata {
  source: "env_override" | "file" | "default_fallback";
  configuredPath: string;
  checksum: string;
  loadedAt: string;
  lastCheckedAt: string;
  reloadIntervalMs: number;
  staleThresholdMs: number;
  cacheAgeMs: number;
  stale: boolean;
  sourceUpdatedAt?: string;
  lastError?: string;
}

export interface FeatureFlagRuntimeSnapshot {
  config: FeatureFlagConfigDocument;
  metadata: FeatureFlagRuntimeMetadata;
}

interface CachedFeatureFlagState {
  config: FeatureFlagConfigDocument;
  source: FeatureFlagRuntimeMetadata["source"];
  configuredPath: string;
  checksum: string;
  loadedAtMs: number;
  lastCheckedAtMs: number;
  sourceUpdatedAtMs?: number;
  lastError?: string;
}

let cachedFeatureFlagState: CachedFeatureFlagState | null = null;

export function configureFeatureFlagRuntimeDependencies(
  overrides: Partial<FeatureFlagRuntimeDependencies>
): void {
  featureFlagRuntimeDependencies = {
    ...featureFlagRuntimeDependencies,
    ...overrides
  };
}

export function resetFeatureFlagRuntimeDependencies(): void {
  featureFlagRuntimeDependencies = defaultFeatureFlagRuntimeDependencies;
}

export function clearCachedFeatureFlagConfig(): void {
  cachedFeatureFlagState = null;
}

function parseFeatureFlagOverride(rawValue: string | undefined): FeatureFlagConfigDocument | null {
  if (!rawValue?.trim()) {
    return null;
  }

  try {
    return normalizeFeatureFlagConfigDocument(JSON.parse(rawValue) as FeatureFlagConfigDocument);
  } catch (error) {
    console.warn("[FeatureFlags] Failed to parse VEIL_FEATURE_FLAGS_JSON override", error);
    return null;
  }
}

function hashFeatureFlagConfig(config: FeatureFlagConfigDocument): string {
  return crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function parseReloadIntervalMs(value: string | undefined): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_FEATURE_FLAG_RELOAD_INTERVAL_MS;
  }

  return parsed;
}

function buildRuntimeSnapshot(
  state: CachedFeatureFlagState,
  reloadIntervalMs: number,
  nowMs: number
): FeatureFlagRuntimeSnapshot {
  const staleThresholdMs = Math.max(DEFAULT_FEATURE_FLAG_STALE_THRESHOLD_MS, reloadIntervalMs * 2);

  return {
    config: state.config,
    metadata: {
      source: state.source,
      configuredPath: state.configuredPath,
      checksum: state.checksum,
      loadedAt: new Date(state.loadedAtMs).toISOString(),
      lastCheckedAt: new Date(state.lastCheckedAtMs).toISOString(),
      reloadIntervalMs,
      staleThresholdMs,
      cacheAgeMs: Math.max(0, nowMs - state.loadedAtMs),
      stale: nowMs - state.lastCheckedAtMs > staleThresholdMs,
      ...(state.sourceUpdatedAtMs !== undefined ? { sourceUpdatedAt: new Date(state.sourceUpdatedAtMs).toISOString() } : {}),
      ...(state.lastError ? { lastError: state.lastError } : {})
    }
  };
}

function loadFeatureFlagSnapshot(env: NodeJS.ProcessEnv = process.env): FeatureFlagRuntimeSnapshot {
  const nowMs = featureFlagRuntimeDependencies.now();
  const reloadIntervalMs = parseReloadIntervalMs(env.VEIL_FEATURE_FLAGS_RELOAD_INTERVAL_MS);
  const configuredPath = env.VEIL_FEATURE_FLAGS_PATH?.trim() || DEFAULT_FEATURE_FLAG_CONFIG_PATH;
  const override = parseFeatureFlagOverride(env.VEIL_FEATURE_FLAGS_JSON);

  if (override) {
    const state: CachedFeatureFlagState = {
      config: override,
      source: "env_override",
      configuredPath,
      checksum: hashFeatureFlagConfig(override),
      loadedAtMs: nowMs,
      lastCheckedAtMs: nowMs
    };
    cachedFeatureFlagState = state;
    return buildRuntimeSnapshot(state, reloadIntervalMs, nowMs);
  }

  if (
    cachedFeatureFlagState &&
    cachedFeatureFlagState.source !== "env_override" &&
    cachedFeatureFlagState.configuredPath === configuredPath &&
    nowMs - cachedFeatureFlagState.lastCheckedAtMs < reloadIntervalMs
  ) {
    return buildRuntimeSnapshot(cachedFeatureFlagState, reloadIntervalMs, nowMs);
  }

  try {
    const stats = featureFlagRuntimeDependencies.statSync(configuredPath);
    if (
      cachedFeatureFlagState &&
      cachedFeatureFlagState.source === "file" &&
      cachedFeatureFlagState.configuredPath === configuredPath &&
      cachedFeatureFlagState.sourceUpdatedAtMs === stats.mtimeMs
    ) {
      cachedFeatureFlagState = {
        ...cachedFeatureFlagState,
        lastCheckedAtMs: nowMs
      };
      return buildRuntimeSnapshot(cachedFeatureFlagState, reloadIntervalMs, nowMs);
    }

    const raw = featureFlagRuntimeDependencies.readFileSync(configuredPath, "utf8");
    const config = normalizeFeatureFlagConfigDocument(JSON.parse(raw) as FeatureFlagConfigDocument);
    cachedFeatureFlagState = {
      config,
      source: "file",
      configuredPath,
      checksum: hashFeatureFlagConfig(config),
      loadedAtMs: nowMs,
      lastCheckedAtMs: nowMs,
      sourceUpdatedAtMs: stats.mtimeMs
    };
  } catch (error) {
    console.warn(`[FeatureFlags] Falling back to defaults after failing to load ${configuredPath}`, error);
    cachedFeatureFlagState = {
      config: DEFAULT_FEATURE_FLAG_CONFIG,
      source: "default_fallback",
      configuredPath,
      checksum: hashFeatureFlagConfig(DEFAULT_FEATURE_FLAG_CONFIG),
      loadedAtMs: nowMs,
      lastCheckedAtMs: nowMs,
      lastError: error instanceof Error ? error.message : String(error)
    };
  }

  return buildRuntimeSnapshot(cachedFeatureFlagState, reloadIntervalMs, nowMs);
}

function readLegacyBooleanEnv(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return null;
}

export function loadFeatureFlagConfig(env: NodeJS.ProcessEnv = process.env): FeatureFlagConfigDocument {
  return loadFeatureFlagSnapshot(env).config;
}

export function resolveFeatureFlagsForPlayer(
  playerId: string,
  env: NodeJS.ProcessEnv = process.env
): FeatureFlags {
  const flags = evaluateFeatureFlags(playerId, loadFeatureFlagConfig(env));
  const legacyDailyQuestOverride = readLegacyBooleanEnv(env.VEIL_DAILY_QUESTS_ENABLED);

  if (legacyDailyQuestOverride == null) {
    return flags;
  }

  return {
    ...flags,
    quest_system_enabled: legacyDailyQuestOverride
  };
}

export function resolveFeatureEntitlementsForPlayer(
  playerId: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): ResolvedFeatureEntitlements {
  const entitlements = evaluateFeatureEntitlements(playerId, loadFeatureFlagConfig(env), now);
  const legacyDailyQuestOverride = readLegacyBooleanEnv(env.VEIL_DAILY_QUESTS_ENABLED);

  if (legacyDailyQuestOverride == null) {
    return entitlements;
  }

  return {
    ...entitlements,
    featureFlags: {
      ...entitlements.featureFlags,
      quest_system_enabled: legacyDailyQuestOverride
    }
  };
}

export function getFeatureFlagRuntimeSnapshot(env: NodeJS.ProcessEnv = process.env): FeatureFlagRuntimeSnapshot {
  return loadFeatureFlagSnapshot(env);
}

export interface FeatureFlagRuntimeSummary {
  flagKey: FeatureFlagKey;
  enabled: boolean;
  rollout: number;
  currentValue: boolean | string | number;
  defaultValue: boolean | string | number;
  owner?: string;
  rolloutPolicy?: FeatureFlagRolloutPolicy;
}

export interface RuntimeKillSwitchSummary extends RuntimeKillSwitchDefinition {
  key: string;
}

export interface RuntimeKillSwitchSnapshot {
  clientMinVersion: {
    defaultVersion: string;
    activeVersion: string;
    channels: Record<string, string>;
    upgradeMessage?: string;
  };
  killSwitches: RuntimeKillSwitchSummary[];
}

function readChannelSpecificMinimumVersion(channel: string | null | undefined, env: NodeJS.ProcessEnv): string | null {
  const normalizedChannel = channel?.trim().toUpperCase();
  if (!normalizedChannel) {
    return null;
  }

  return normalizeClientVersion(env[`MIN_SUPPORTED_CLIENT_VERSION_${normalizedChannel}`]);
}

export function resolveMinimumSupportedClientVersion(
  channel: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): string {
  const snapshot = loadFeatureFlagSnapshot(env);
  const config = snapshot.config.runtimeGates?.clientMinVersion;
  const normalizedChannel = channel?.trim().toLowerCase();
  return (
    readChannelSpecificMinimumVersion(channel, env) ??
    (normalizedChannel ? normalizeClientVersion(config?.channels?.[normalizedChannel]) : null) ??
    normalizeClientVersion(env.MIN_SUPPORTED_CLIENT_VERSION) ??
    normalizeClientVersion(config?.defaultVersion) ??
    DEFAULT_MIN_SUPPORTED_CLIENT_VERSION
  );
}

export function getRuntimeKillSwitchSnapshot(env: NodeJS.ProcessEnv = process.env): RuntimeKillSwitchSnapshot {
  const snapshot = loadFeatureFlagSnapshot(env);
  const config = snapshot.config.runtimeGates ?? DEFAULT_FEATURE_FLAG_CONFIG.runtimeGates ?? {};
  const clientMinVersion = config.clientMinVersion ?? {
    defaultVersion: DEFAULT_MIN_SUPPORTED_CLIENT_VERSION
  };
  const channels = Object.fromEntries(
    Object.entries(clientMinVersion.channels ?? {}).map(([channel, minimumVersion]) => [
      channel,
      resolveMinimumSupportedClientVersion(channel, env)
    ])
  );
  return {
    clientMinVersion: {
      defaultVersion: normalizeClientVersion(clientMinVersion.defaultVersion) ?? DEFAULT_MIN_SUPPORTED_CLIENT_VERSION,
      activeVersion: resolveMinimumSupportedClientVersion(null, env),
      channels,
      ...(clientMinVersion.upgradeMessage ? { upgradeMessage: clientMinVersion.upgradeMessage } : {})
    },
    killSwitches: Object.entries(config.killSwitches ?? {})
      .map(([key, definition]) => ({
        key,
        enabled: definition.enabled === true,
        label: definition.label,
        ...(definition.summary ? { summary: definition.summary } : {}),
        ...(definition.channels?.length ? { channels: definition.channels } : {})
      }))
      .sort((left, right) => left.key.localeCompare(right.key))
  };
}

export function listFeatureFlagRuntimeSummaries(env: NodeJS.ProcessEnv = process.env): FeatureFlagRuntimeSummary[] {
  const snapshot = loadFeatureFlagSnapshot(env);
  const rolloutPolicies = snapshot.config.operations?.rolloutPolicies ?? {};

  return Object.entries(snapshot.config.flags)
    .map(([flagKey, definition]) => {
      const policy = rolloutPolicies[flagKey as FeatureFlagKey];
      return {
        flagKey: flagKey as FeatureFlagKey,
        enabled: definition.enabled !== false,
        rollout: definition.rollout ?? 1,
        currentValue: definition.value,
        defaultValue: definition.defaultValue,
        ...(policy ? { owner: policy.owner, rolloutPolicy: policy } : {})
      };
    })
    .sort((left, right) => left.flagKey.localeCompare(right.flagKey));
}
