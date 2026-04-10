const DEFAULT_ROLLOUT = 1;
const DEFAULT_EXPERIMENT_BUCKETS = 100;

export type FeatureFlagPrimitive = boolean | string | number;
export type FeatureFlagKey =
  | "quest_system_enabled"
  | "battle_pass_enabled"
  | "pve_enabled"
  | "tutorial_enabled";

export interface FeatureFlags {
  quest_system_enabled: boolean;
  battle_pass_enabled: boolean;
  pve_enabled: boolean;
  tutorial_enabled: boolean;
}

interface BaseFeatureFlagDefinition<T extends FeatureFlagPrimitive> {
  type: "boolean" | "string" | "number";
  value: T;
  defaultValue: T;
  enabled?: boolean;
  rollout?: number;
}

export interface BooleanFeatureFlagDefinition extends BaseFeatureFlagDefinition<boolean> {
  type: "boolean";
}

export interface StringFeatureFlagDefinition extends BaseFeatureFlagDefinition<string> {
  type: "string";
}

export interface NumberFeatureFlagDefinition extends BaseFeatureFlagDefinition<number> {
  type: "number";
}

export type FeatureFlagDefinition =
  | BooleanFeatureFlagDefinition
  | StringFeatureFlagDefinition
  | NumberFeatureFlagDefinition;

export type FeatureFlagConfig = Record<FeatureFlagKey, FeatureFlagDefinition>;

export interface FeatureFlagConfigDocument {
  schemaVersion: 1;
  flags: FeatureFlagConfig;
  experiments?: ExperimentConfig;
}

export interface ExperimentVariantDefinition {
  key: string;
  allocation: number;
}

export interface ExperimentDefinition {
  name: string;
  owner: string;
  enabled?: boolean;
  startAt?: string;
  endAt?: string;
  fallbackVariant: string;
  whitelist?: Record<string, string>;
  variants: ExperimentVariantDefinition[];
}

export type ExperimentKey = string;
export type ExperimentConfig = Record<ExperimentKey, ExperimentDefinition>;

export interface ExperimentAssignment {
  experimentKey: string;
  experimentName: string;
  owner: string;
  bucket: number;
  variant: string;
  fallbackVariant: string;
  startAt?: string;
  endAt?: string;
  assigned: boolean;
  reason: "whitelist" | "bucket" | "inactive" | "before_start" | "after_end" | "fallback";
}

export interface ResolvedFeatureEntitlements {
  featureFlags: FeatureFlags;
  experiments: ExperimentAssignment[];
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  quest_system_enabled: true,
  battle_pass_enabled: false,
  pve_enabled: true,
  tutorial_enabled: true
};

export const DEFAULT_FEATURE_FLAG_CONFIG: FeatureFlagConfigDocument = {
  schemaVersion: 1,
  flags: {
    quest_system_enabled: {
      type: "boolean",
      value: true,
      defaultValue: true,
      enabled: true,
      rollout: DEFAULT_ROLLOUT
    },
    battle_pass_enabled: {
      type: "boolean",
      value: false,
      defaultValue: false,
      enabled: true,
      rollout: DEFAULT_ROLLOUT
    },
    pve_enabled: {
      type: "boolean",
      value: true,
      defaultValue: true,
      enabled: true,
      rollout: DEFAULT_ROLLOUT
    },
    tutorial_enabled: {
      type: "boolean",
      value: true,
      defaultValue: true,
      enabled: true,
      rollout: DEFAULT_ROLLOUT
    }
  },
  experiments: {
    account_portal_copy: {
      name: "Account Portal Upgrade Copy",
      owner: "growth",
      enabled: true,
      startAt: "2026-04-05T00:00:00.000Z",
      fallbackVariant: "control",
      variants: [
        { key: "control", allocation: 50 },
        { key: "upgrade", allocation: 50 }
      ]
    }
  }
};

export function normalizeFeatureFlags(input?: Partial<FeatureFlags> | null): FeatureFlags {
  return {
    quest_system_enabled: input?.quest_system_enabled === true,
    battle_pass_enabled: input?.battle_pass_enabled === true,
    pve_enabled: input?.pve_enabled === true,
    tutorial_enabled: input?.tutorial_enabled !== false
  };
}

function clampRollout(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_ROLLOUT;
  }

  return Math.min(1, Math.max(0, value ?? DEFAULT_ROLLOUT));
}

function hashFeatureFlagKey(playerId: string, flagKey: string): number {
  let hash = 2166136261;
  const input = `${playerId}:${flagKey}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 0x1_0000_0000;
}

function normalizeExperimentAllocation(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(DEFAULT_EXPERIMENT_BUCKETS, Math.max(0, Math.floor(value ?? 0)));
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const timestamp = new Date(trimmed);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeExperimentVariantDefinition(input: Partial<ExperimentVariantDefinition> | undefined): ExperimentVariantDefinition | null {
  if (!input) {
    return null;
  }

  const key = input?.key?.trim();
  if (!key) {
    return null;
  }

  return {
    key,
    allocation: normalizeExperimentAllocation(input?.allocation)
  };
}

export function normalizeExperimentDefinition(
  definition: Partial<ExperimentDefinition> | undefined,
  fallbackKey: string,
  fallback: ExperimentDefinition
): ExperimentDefinition {
  if (!definition || typeof definition !== "object") {
    return structuredClone(fallback);
  }

  const variants = Array.isArray(definition.variants)
    ? definition.variants
        .map((variant) => normalizeExperimentVariantDefinition(variant))
        .filter((variant): variant is ExperimentVariantDefinition => Boolean(variant))
    : structuredClone(fallback.variants);
  const fallbackVariant = definition.fallbackVariant?.trim() || fallback.fallbackVariant || variants[0]?.key || fallbackKey;
  const normalizedVariants = variants.some((variant) => variant.key === fallbackVariant)
    ? variants
    : [{ key: fallbackVariant, allocation: 0 }, ...variants];
  const whitelist = isPlainRecord(definition.whitelist)
    ? Object.fromEntries(
        Object.entries(definition.whitelist)
          .map(([playerId, variant]): [string, string] => [playerId.trim(), typeof variant === "string" ? variant.trim() : ""])
          .filter(([playerId, variant]) => playerId.length > 0 && variant.length > 0)
      )
    : fallback.whitelist;
  const startAt = normalizeTimestamp(definition.startAt);
  const endAt = normalizeTimestamp(definition.endAt);
  const normalizedDefinition: ExperimentDefinition = {
    name: definition.name?.trim() || fallback.name,
    owner: definition.owner?.trim() || fallback.owner,
    enabled: definition.enabled ?? true,
    fallbackVariant,
    variants: normalizedVariants
  };

  if (startAt) {
    normalizedDefinition.startAt = startAt;
  }

  if (endAt) {
    normalizedDefinition.endAt = endAt;
  }

  if (whitelist && Object.keys(whitelist).length > 0) {
    normalizedDefinition.whitelist = whitelist;
  }

  return normalizedDefinition;
}

export function normalizeFeatureFlagDefinition(
  definition: Partial<FeatureFlagDefinition> | undefined,
  fallback: FeatureFlagDefinition
): FeatureFlagDefinition {
  if (!definition || typeof definition !== "object") {
    return { ...fallback };
  }

  const type = definition.type === "string" || definition.type === "number" || definition.type === "boolean"
    ? definition.type
    : fallback.type;
  const enabled = definition.enabled ?? true;
  const rollout = clampRollout(definition.rollout);

  if (type === "string") {
    return {
      type,
      value: typeof definition.value === "string" ? definition.value : String(fallback.value),
      defaultValue: typeof definition.defaultValue === "string" ? definition.defaultValue : String(fallback.defaultValue),
      enabled,
      rollout
    };
  }

  if (type === "number") {
    return {
      type,
      value: Number.isFinite(definition.value) ? Number(definition.value) : Number(fallback.value),
      defaultValue: Number.isFinite(definition.defaultValue)
        ? Number(definition.defaultValue)
        : Number(fallback.defaultValue),
      enabled,
      rollout
    };
  }

  return {
    type: "boolean",
    value: definition.value === true,
    defaultValue: definition.defaultValue === true,
    enabled,
    rollout
  };
}

export function normalizeFeatureFlagConfigDocument(
  input?: Partial<FeatureFlagConfigDocument> | null
): FeatureFlagConfigDocument {
  const flags = (input?.flags ?? {}) as Partial<Record<FeatureFlagKey, Partial<FeatureFlagDefinition>>>;
  const experiments = isPlainRecord(input?.experiments) ? input?.experiments : {};
  return {
    schemaVersion: 1,
    flags: {
      quest_system_enabled: normalizeFeatureFlagDefinition(
        flags.quest_system_enabled,
        DEFAULT_FEATURE_FLAG_CONFIG.flags.quest_system_enabled
      ),
      battle_pass_enabled: normalizeFeatureFlagDefinition(
        flags.battle_pass_enabled,
        DEFAULT_FEATURE_FLAG_CONFIG.flags.battle_pass_enabled
      ),
      pve_enabled: normalizeFeatureFlagDefinition(flags.pve_enabled, DEFAULT_FEATURE_FLAG_CONFIG.flags.pve_enabled),
      tutorial_enabled: normalizeFeatureFlagDefinition(
        flags.tutorial_enabled,
        DEFAULT_FEATURE_FLAG_CONFIG.flags.tutorial_enabled
      )
    },
    experiments: {
      account_portal_copy: normalizeExperimentDefinition(
        isPlainRecord(experiments?.account_portal_copy) ? (experiments.account_portal_copy as Partial<ExperimentDefinition>) : undefined,
        "account_portal_copy",
        DEFAULT_FEATURE_FLAG_CONFIG.experiments?.account_portal_copy ?? {
          name: "Account Portal Upgrade Copy",
          owner: "growth",
          enabled: true,
          fallbackVariant: "control",
          variants: [
            { key: "control", allocation: 100 }
          ]
        }
      )
    }
  };
}

function toBooleanFeatureFlagDefinition(definition: FeatureFlagDefinition): BooleanFeatureFlagDefinition {
  if (definition.type === "boolean") {
    return definition;
  }

  return {
    type: "boolean",
    value: Boolean(definition.defaultValue),
    defaultValue: Boolean(definition.defaultValue),
    ...(definition.enabled !== undefined ? { enabled: definition.enabled } : {}),
    ...(definition.rollout !== undefined ? { rollout: definition.rollout } : {})
  };
}

export function evaluateFeatureFlag<T extends FeatureFlagPrimitive>(
  playerId: string,
  flagKey: string,
  definition: BaseFeatureFlagDefinition<T>
): T {
  if (definition.enabled === false) {
    return definition.defaultValue;
  }

  if (clampRollout(definition.rollout) <= 0) {
    return definition.defaultValue;
  }

  if (clampRollout(definition.rollout) >= 1) {
    return definition.value;
  }

  return hashFeatureFlagKey(playerId, flagKey) < clampRollout(definition.rollout)
    ? definition.value
    : definition.defaultValue;
}

export function evaluateFeatureFlags(
  playerId: string,
  config: FeatureFlagConfigDocument = DEFAULT_FEATURE_FLAG_CONFIG
): FeatureFlags {
  const normalizedPlayerId = playerId.trim();
  const normalizedConfig = normalizeFeatureFlagConfigDocument(config);

  return {
    quest_system_enabled: Boolean(
      evaluateFeatureFlag(
        normalizedPlayerId,
        "quest_system_enabled",
        toBooleanFeatureFlagDefinition(normalizedConfig.flags.quest_system_enabled)
      )
    ),
    battle_pass_enabled: Boolean(
      evaluateFeatureFlag(
        normalizedPlayerId,
        "battle_pass_enabled",
        toBooleanFeatureFlagDefinition(normalizedConfig.flags.battle_pass_enabled)
      )
    ),
    pve_enabled: Boolean(
      evaluateFeatureFlag(
        normalizedPlayerId,
        "pve_enabled",
        toBooleanFeatureFlagDefinition(normalizedConfig.flags.pve_enabled)
      )
    ),
    tutorial_enabled: Boolean(
      evaluateFeatureFlag(
        normalizedPlayerId,
        "tutorial_enabled",
        toBooleanFeatureFlagDefinition(normalizedConfig.flags.tutorial_enabled)
      )
    )
  };
}

function resolveExperimentAssignment(
  playerId: string,
  experimentKey: string,
  definition: ExperimentDefinition,
  now: Date
): ExperimentAssignment {
  const normalizedPlayerId = playerId.trim();
  const bucket = Math.min(DEFAULT_EXPERIMENT_BUCKETS - 1, Math.floor(hashFeatureFlagKey(normalizedPlayerId, experimentKey) * DEFAULT_EXPERIMENT_BUCKETS));
  const baseAssignment = {
    experimentKey,
    experimentName: definition.name,
    owner: definition.owner,
    bucket,
    fallbackVariant: definition.fallbackVariant,
    ...(definition.startAt ? { startAt: definition.startAt } : {}),
    ...(definition.endAt ? { endAt: definition.endAt } : {})
  };
  const whitelistVariant = definition.whitelist?.[normalizedPlayerId];
  if (whitelistVariant) {
    return {
      ...baseAssignment,
      variant: whitelistVariant,
      assigned: true,
      reason: "whitelist"
    };
  }

  if (definition.enabled === false) {
    return {
      ...baseAssignment,
      variant: definition.fallbackVariant,
      assigned: false,
      reason: "inactive"
    };
  }

  if (definition.startAt && now < new Date(definition.startAt)) {
    return {
      ...baseAssignment,
      variant: definition.fallbackVariant,
      assigned: false,
      reason: "before_start"
    };
  }

  if (definition.endAt && now > new Date(definition.endAt)) {
    return {
      ...baseAssignment,
      variant: definition.fallbackVariant,
      assigned: false,
      reason: "after_end"
    };
  }

  let upperBound = 0;
  for (const variant of definition.variants) {
    upperBound += normalizeExperimentAllocation(variant.allocation);
    if (bucket < upperBound) {
      return {
        ...baseAssignment,
        variant: variant.key,
        assigned: true,
        reason: "bucket"
      };
    }
  }

  return {
    ...baseAssignment,
    variant: definition.fallbackVariant,
    assigned: false,
    reason: "fallback"
  };
}

export function evaluateExperiments(
  playerId: string,
  config: FeatureFlagConfigDocument = DEFAULT_FEATURE_FLAG_CONFIG,
  now: Date = new Date()
): ExperimentAssignment[] {
  const normalizedConfig = normalizeFeatureFlagConfigDocument(config);
  return Object.entries(normalizedConfig.experiments ?? {})
    .map(([experimentKey, definition]) => resolveExperimentAssignment(playerId, experimentKey, definition, now))
    .sort((left, right) => left.experimentKey.localeCompare(right.experimentKey));
}

export function evaluateFeatureEntitlements(
  playerId: string,
  config: FeatureFlagConfigDocument = DEFAULT_FEATURE_FLAG_CONFIG,
  now: Date = new Date()
): ResolvedFeatureEntitlements {
  return {
    featureFlags: evaluateFeatureFlags(playerId, config),
    experiments: evaluateExperiments(playerId, config, now)
  };
}

export function normalizeExperimentAssignments(input?: Partial<ExperimentAssignment>[] | null): ExperimentAssignment[] {
  return (input ?? [])
    .map((assignment) => {
      const experimentKey = assignment.experimentKey?.trim();
      const experimentName = assignment.experimentName?.trim();
      const owner = assignment.owner?.trim();
      const variant = assignment.variant?.trim();
      const fallbackVariant = assignment.fallbackVariant?.trim();
      const bucket = Math.floor(assignment.bucket ?? Number.NaN);
      if (!experimentKey || !experimentName || !owner || !variant || !fallbackVariant || !Number.isFinite(bucket)) {
        return null;
      }

      return {
        experimentKey,
        experimentName,
        owner,
        bucket: Math.min(DEFAULT_EXPERIMENT_BUCKETS - 1, Math.max(0, bucket)),
        variant,
        fallbackVariant,
        ...(normalizeTimestamp(assignment.startAt) ? { startAt: normalizeTimestamp(assignment.startAt) } : {}),
        ...(normalizeTimestamp(assignment.endAt) ? { endAt: normalizeTimestamp(assignment.endAt) } : {}),
        assigned: assignment.assigned === true,
        reason:
          assignment.reason === "whitelist" ||
          assignment.reason === "bucket" ||
          assignment.reason === "inactive" ||
          assignment.reason === "before_start" ||
          assignment.reason === "after_end" ||
          assignment.reason === "fallback"
            ? assignment.reason
            : "fallback"
      };
    })
    .filter((assignment): assignment is ExperimentAssignment => Boolean(assignment))
    .sort((left, right) => left.experimentKey.localeCompare(right.experimentKey));
}
