import shopConfigDocument from "../../../configs/shop-config.json";
import { DEFAULT_ELO_RATING, getTierForRating, normalizeEloRating, type PlayerTier, type SeasonRewardConfig } from "../../../packages/shared/src/index";

interface ShopConfigDocument {
  seasonRewards?: Partial<SeasonRewardConfig> | null;
}

const PLAYER_TIERS: PlayerTier[] = ["bronze", "silver", "gold", "platinum", "diamond"];

export interface ResolvedSeasonRewardConfig extends SeasonRewardConfig {}

export interface SeasonRewardComputation {
  tier: PlayerTier;
  gems: number;
  resetEloRating: number;
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || normalized < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return normalized;
}

export function normalizeSeasonRewardConfig(rawConfig?: Partial<SeasonRewardConfig> | null): ResolvedSeasonRewardConfig {
  const config = rawConfig ?? {};

  return {
    bronze: normalizeNonNegativeInteger(config.bronze ?? 0, "seasonRewards.bronze"),
    silver: normalizeNonNegativeInteger(config.silver ?? 0, "seasonRewards.silver"),
    gold: normalizeNonNegativeInteger(config.gold ?? 0, "seasonRewards.gold"),
    platinum: normalizeNonNegativeInteger(config.platinum ?? 0, "seasonRewards.platinum"),
    diamond: normalizeNonNegativeInteger(config.diamond ?? 0, "seasonRewards.diamond")
  };
}

export function resolveSeasonRewardConfig(): ResolvedSeasonRewardConfig {
  return normalizeSeasonRewardConfig((shopConfigDocument as ShopConfigDocument).seasonRewards);
}

export function computeSeasonResetEloRating(rating: number): number {
  const normalizedRating = normalizeEloRating(rating);
  return DEFAULT_ELO_RATING + Math.floor((normalizedRating - DEFAULT_ELO_RATING) * 0.5);
}

export function computeSeasonReward(rating: number, rewardConfig = resolveSeasonRewardConfig()): SeasonRewardComputation {
  const tier = getTierForRating(rating);

  return {
    tier,
    gems: rewardConfig[tier],
    resetEloRating: computeSeasonResetEloRating(rating)
  };
}

export { PLAYER_TIERS };
