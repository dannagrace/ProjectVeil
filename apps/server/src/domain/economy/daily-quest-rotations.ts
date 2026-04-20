import fs from "node:fs";
import path from "node:path";
import dailyQuestRotationsDocument from "../../../../../configs/daily-quest-rotations.json";
import type { FeatureFlags } from "@veil/shared/platform";
import { type DailyQuestRotationConfigDocument, type DailyQuestRotationDefinition, DEFAULT_DAILY_QUEST_ROTATION_CONFIG, findNextDailyQuestRotation, normalizeDailyQuestRotationConfigDocument, selectDailyQuestRotationForDate, summarizeDailyQuestRotation, validateDailyQuestRotationConfigDocument } from "@veil/shared/progression";

const DEFAULT_DAILY_QUEST_ROTATIONS_PATH = path.resolve(process.cwd(), "configs/daily-quest-rotations.json");

interface DailyQuestRotationRuntimeDependencies {
  readFileSync(filePath: string, encoding: BufferEncoding): string;
}

const defaultDailyQuestRotationRuntimeDependencies: DailyQuestRotationRuntimeDependencies = {
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding)
};

let dailyQuestRotationRuntimeDependencies = defaultDailyQuestRotationRuntimeDependencies;
let cachedDailyQuestRotationConfig: DailyQuestRotationConfigDocument | null = null;

export interface DailyQuestRotationPreview {
  generatedAt: string;
  activeDate: string;
  enabledFlags: string[];
  activeRotation: {
    id: string;
    label: string;
    summary: string;
  } | null;
  nextRotation: {
    id: string;
    label: string;
    startsOn: string;
    summary: string;
  } | null;
}

function getEnabledFlagKeys(flags?: Partial<FeatureFlags> | null): string[] {
  return Object.entries(flags ?? {})
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
}

function parseDailyQuestRotationOverride(rawValue: string | undefined): DailyQuestRotationConfigDocument | null {
  if (!rawValue?.trim()) {
    return null;
  }

  try {
    return normalizeDailyQuestRotationConfigDocument(JSON.parse(rawValue) as DailyQuestRotationConfigDocument);
  } catch (error) {
    console.warn("[DailyQuestRotations] Failed to parse VEIL_DAILY_QUEST_ROTATIONS_JSON override", error);
    return null;
  }
}

function validateOrFallback(document: DailyQuestRotationConfigDocument, sourceLabel: string): DailyQuestRotationConfigDocument {
  const issues = validateDailyQuestRotationConfigDocument(document);
  if (!issues.length) {
    return document;
  }

  console.warn(
    `[DailyQuestRotations] Falling back after invalid config from ${sourceLabel}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`
  );
  return normalizeDailyQuestRotationConfigDocument(DEFAULT_DAILY_QUEST_ROTATION_CONFIG);
}

export function configureDailyQuestRotationRuntimeDependencies(
  overrides: Partial<DailyQuestRotationRuntimeDependencies>
): void {
  dailyQuestRotationRuntimeDependencies = {
    ...dailyQuestRotationRuntimeDependencies,
    ...overrides
  };
}

export function resetDailyQuestRotationRuntimeDependencies(): void {
  dailyQuestRotationRuntimeDependencies = defaultDailyQuestRotationRuntimeDependencies;
}

export function clearCachedDailyQuestRotationConfig(): void {
  cachedDailyQuestRotationConfig = null;
}

export function loadDailyQuestRotationConfig(env: NodeJS.ProcessEnv = process.env): DailyQuestRotationConfigDocument {
  const override = parseDailyQuestRotationOverride(env.VEIL_DAILY_QUEST_ROTATIONS_JSON);
  if (override) {
    return validateOrFallback(override, "VEIL_DAILY_QUEST_ROTATIONS_JSON");
  }

  if (cachedDailyQuestRotationConfig) {
    return cachedDailyQuestRotationConfig;
  }

  const configuredPath = env.VEIL_DAILY_QUEST_ROTATIONS_PATH?.trim() || DEFAULT_DAILY_QUEST_ROTATIONS_PATH;

  try {
    const raw = dailyQuestRotationRuntimeDependencies.readFileSync(configuredPath, "utf8");
    cachedDailyQuestRotationConfig = validateOrFallback(
      normalizeDailyQuestRotationConfigDocument(JSON.parse(raw) as DailyQuestRotationConfigDocument),
      configuredPath
    );
  } catch (error) {
    console.warn(`[DailyQuestRotations] Falling back to bundled defaults after failing to load ${configuredPath}`, error);
    cachedDailyQuestRotationConfig = normalizeDailyQuestRotationConfigDocument(
      dailyQuestRotationsDocument as DailyQuestRotationConfigDocument
    );
  }

  return cachedDailyQuestRotationConfig;
}

export function resolveDailyQuestRotation(
  now = new Date(),
  flags?: Partial<FeatureFlags> | null,
  env: NodeJS.ProcessEnv = process.env
): DailyQuestRotationDefinition | null {
  return selectDailyQuestRotationForDate(loadDailyQuestRotationConfig(env), now, getEnabledFlagKeys(flags));
}

export function findNextScheduledDailyQuestRotation(
  now = new Date(),
  flags?: Partial<FeatureFlags> | null,
  env: NodeJS.ProcessEnv = process.env
) {
  return findNextDailyQuestRotation(loadDailyQuestRotationConfig(env), now, getEnabledFlagKeys(flags));
}

export function createDailyQuestRotationPreview(
  now = new Date(),
  flags?: Partial<FeatureFlags> | null,
  env: NodeJS.ProcessEnv = process.env
): DailyQuestRotationPreview {
  const activeRotation = resolveDailyQuestRotation(now, flags, env);
  const nextRotation = findNextScheduledDailyQuestRotation(now, flags, env);

  return {
    generatedAt: now.toISOString(),
    activeDate: now.toISOString().slice(0, 10),
    enabledFlags: getEnabledFlagKeys(flags),
    activeRotation: activeRotation
      ? {
          id: activeRotation.id,
          label: activeRotation.label,
          summary: summarizeDailyQuestRotation(activeRotation)
        }
      : null,
    nextRotation: nextRotation
      ? {
          id: nextRotation.rotation.id,
          label: nextRotation.rotation.label,
          startsOn: nextRotation.dateKey,
          summary: summarizeDailyQuestRotation(nextRotation.rotation)
        }
      : null
  };
}
