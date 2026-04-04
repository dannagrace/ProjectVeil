import battlePassConfigDocument from "../../../configs/battle-pass.json";
import { getEquipmentDefinition, type EquipmentId, type ResourceLedger } from "../../../packages/shared/src/index";

export interface BattlePassReward {
  gems?: number;
  gold?: number;
  equipmentId?: EquipmentId;
}

export interface BattlePassTier {
  tier: number;
  xpRequired: number;
  freeReward: BattlePassReward;
  premiumReward: BattlePassReward;
}

export interface BattlePassConfig {
  seasonXpPerWin: number;
  seasonXpPerLoss: number;
  seasonXpDailyLoginBonus: number;
  tiers: BattlePassTier[];
}

interface BattlePassConfigDocument {
  seasonXpPerWin?: number | null;
  seasonXpPerLoss?: number | null;
  seasonXpDailyLoginBonus?: number | null;
  tiers?: Array<Partial<BattlePassTier>> | null;
}

export interface BattlePassProgressState {
  seasonXp?: number;
  seasonPassTier?: number;
}

export interface BattlePassProgressSnapshot {
  seasonXp: number;
  seasonPassTier: number;
}

export interface BattlePassRewardGrant {
  gems: number;
  resources: ResourceLedger;
  equipmentIds: EquipmentId[];
}

function normalizeNonNegativeInteger(value: number | null | undefined, field: string): number {
  const normalized = Math.floor(value ?? Number.NaN);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return normalized;
}

function normalizeReward(rawReward: BattlePassReward | null | undefined, field: string): BattlePassReward {
  const gems = rawReward?.gems != null ? normalizeNonNegativeInteger(rawReward.gems, `${field}.gems`) : 0;
  const gold = rawReward?.gold != null ? normalizeNonNegativeInteger(rawReward.gold, `${field}.gold`) : 0;
  const equipmentId = rawReward?.equipmentId?.trim() as EquipmentId | undefined;
  if (equipmentId && !getEquipmentDefinition(equipmentId)) {
    throw new Error(`${field}.equipmentId references unknown equipment: ${equipmentId}`);
  }

  return {
    ...(gems > 0 ? { gems } : {}),
    ...(gold > 0 ? { gold } : {}),
    ...(equipmentId ? { equipmentId } : {})
  };
}

function normalizeTier(rawTier: Partial<BattlePassTier> | undefined, index: number, previousXpRequired: number): BattlePassTier {
  const tier = Math.floor(rawTier?.tier ?? Number.NaN);
  if (!Number.isFinite(tier) || tier <= 0) {
    throw new Error(`battle pass tier[${index}] tier must be a positive integer`);
  }

  const xpRequired = normalizeNonNegativeInteger(rawTier?.xpRequired, `battle pass tier ${tier} xpRequired`);
  if (xpRequired < previousXpRequired) {
    throw new Error(`battle pass tier ${tier} xpRequired must be monotonic`);
  }

  return {
    tier,
    xpRequired,
    freeReward: normalizeReward(rawTier?.freeReward, `battle pass tier ${tier} freeReward`),
    premiumReward: normalizeReward(rawTier?.premiumReward, `battle pass tier ${tier} premiumReward`)
  };
}

export function resolveBattlePassConfig(
  document: BattlePassConfigDocument = battlePassConfigDocument as BattlePassConfigDocument
): BattlePassConfig {
  const tiers: BattlePassTier[] = [];
  let previousXpRequired = 0;
  for (const [index, rawTier] of (document.tiers ?? []).entries()) {
    const tier = normalizeTier(rawTier, index, previousXpRequired);
    if (tier.tier !== index + 1) {
      throw new Error(`battle pass tier[${index}] tier must equal ${index + 1}`);
    }
    tiers.push(tier);
    previousXpRequired = tier.xpRequired;
  }

  if (tiers.length === 0) {
    throw new Error("battle pass tiers must not be empty");
  }

  return {
    seasonXpPerWin: normalizeNonNegativeInteger(document.seasonXpPerWin, "battle pass seasonXpPerWin"),
    seasonXpPerLoss: normalizeNonNegativeInteger(document.seasonXpPerLoss, "battle pass seasonXpPerLoss"),
    seasonXpDailyLoginBonus: normalizeNonNegativeInteger(
      document.seasonXpDailyLoginBonus,
      "battle pass seasonXpDailyLoginBonus"
    ),
    tiers
  };
}

export function resolveBattlePassTier(config: BattlePassConfig, tier: number): BattlePassTier | null {
  const normalizedTier = Math.floor(tier);
  return config.tiers.find((entry) => entry.tier === normalizedTier) ?? null;
}

export function resolveBattlePassTierForXp(config: BattlePassConfig, seasonXp: number): number {
  const normalizedSeasonXp = Math.max(0, Math.floor(seasonXp));
  let unlockedTier = config.tiers[0]?.tier ?? 1;
  for (const tier of config.tiers) {
    if (normalizedSeasonXp >= tier.xpRequired) {
      unlockedTier = tier.tier;
      continue;
    }
    break;
  }
  return unlockedTier;
}

export function applyBattlePassXp(
  config: BattlePassConfig,
  state: BattlePassProgressState,
  seasonXpDelta = 0
): BattlePassProgressSnapshot {
  const normalizedDelta = Math.max(0, Math.floor(seasonXpDelta));
  const seasonXp = Math.max(0, Math.floor(state.seasonXp ?? 0)) + normalizedDelta;
  const seasonPassTier = Math.max(
    Math.floor(state.seasonPassTier ?? 1),
    resolveBattlePassTierForXp(config, seasonXp)
  );

  return {
    seasonXp,
    seasonPassTier
  };
}

export function toBattlePassRewardGrant(...rewards: Array<BattlePassReward | undefined>): BattlePassRewardGrant {
  return rewards.reduce<BattlePassRewardGrant>(
    (grant, reward) => ({
      gems: grant.gems + Math.max(0, Math.floor(reward?.gems ?? 0)),
      resources: {
        gold: grant.resources.gold + Math.max(0, Math.floor(reward?.gold ?? 0)),
        wood: grant.resources.wood,
        ore: grant.resources.ore
      },
      equipmentIds: reward?.equipmentId ? grant.equipmentIds.concat(reward.equipmentId) : grant.equipmentIds
    }),
    {
      gems: 0,
      resources: { gold: 0, wood: 0, ore: 0 },
      equipmentIds: []
    }
  );
}

export function didPlayerWinBattle(replay: {
  attackerPlayerId: string;
  defenderPlayerId?: string;
  result: "attacker_victory" | "defender_victory";
}, playerId: string): boolean {
  return (
    (replay.attackerPlayerId === playerId && replay.result === "attacker_victory") ||
    (replay.defenderPlayerId === playerId && replay.result === "defender_victory")
  );
}
