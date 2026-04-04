const DEFAULT_ROLLOUT = 1;

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
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  quest_system_enabled: false,
  battle_pass_enabled: false,
  pve_enabled: false,
  tutorial_enabled: true
};

export const DEFAULT_FEATURE_FLAG_CONFIG: FeatureFlagConfigDocument = {
  schemaVersion: 1,
  flags: {
    quest_system_enabled: {
      type: "boolean",
      value: false,
      defaultValue: false,
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
      value: false,
      defaultValue: false,
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
