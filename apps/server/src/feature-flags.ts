import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_FEATURE_FLAG_CONFIG,
  evaluateFeatureFlags,
  normalizeFeatureFlagConfigDocument,
  type FeatureFlagConfigDocument,
  type FeatureFlags
} from "../../../packages/shared/src/index";

const DEFAULT_FEATURE_FLAG_CONFIG_PATH = path.resolve(process.cwd(), "configs/feature-flags.json");

interface FeatureFlagRuntimeDependencies {
  readFileSync(filePath: string, encoding: BufferEncoding): string;
}

const defaultFeatureFlagRuntimeDependencies: FeatureFlagRuntimeDependencies = {
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding)
};

let featureFlagRuntimeDependencies = defaultFeatureFlagRuntimeDependencies;
let cachedFeatureFlagConfig: FeatureFlagConfigDocument | null = null;

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
  cachedFeatureFlagConfig = null;
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
  const override = parseFeatureFlagOverride(env.VEIL_FEATURE_FLAGS_JSON);
  if (override) {
    return override;
  }

  if (cachedFeatureFlagConfig) {
    return cachedFeatureFlagConfig;
  }

  const configuredPath = env.VEIL_FEATURE_FLAGS_PATH?.trim() || DEFAULT_FEATURE_FLAG_CONFIG_PATH;

  try {
    const raw = featureFlagRuntimeDependencies.readFileSync(configuredPath, "utf8");
    cachedFeatureFlagConfig = normalizeFeatureFlagConfigDocument(JSON.parse(raw) as FeatureFlagConfigDocument);
  } catch (error) {
    console.warn(`[FeatureFlags] Falling back to defaults after failing to load ${configuredPath}`, error);
    cachedFeatureFlagConfig = DEFAULT_FEATURE_FLAG_CONFIG;
  }

  return cachedFeatureFlagConfig;
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
