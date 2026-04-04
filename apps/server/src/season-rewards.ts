import seasonRewardsDocument from "../../../configs/season-rewards.json";
import { type SeasonRewardBracket, type SeasonRewardConfig } from "../../../packages/shared/src/index";

export interface ResolvedSeasonRewardConfig extends SeasonRewardConfig {}

export interface SeasonRewardBracketAssignment extends SeasonRewardBracket {
  rankPosition: number;
}

export interface SeasonRewardComputation {
  gems: number;
  badge: string;
  rankPosition: number;
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || normalized < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return normalized;
}

function normalizePositivePercentile(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error(`${field} must be within 0-100`);
  }

  return value;
}

function normalizeSeasonRewardBracket(
  bracket: Partial<SeasonRewardBracket> | null | undefined,
  index: number
): SeasonRewardBracket {
  const badge = bracket?.badge?.trim();
  if (!badge) {
    throw new Error(`seasonRewards.brackets[${index}].badge is required`);
  }

  return {
    topPercentile: normalizePositivePercentile(
      bracket?.topPercentile ?? Number.NaN,
      `seasonRewards.brackets[${index}].topPercentile`
    ),
    gems: normalizeNonNegativeInteger(bracket?.gems ?? 0, `seasonRewards.brackets[${index}].gems`),
    badge
  };
}

export function normalizeSeasonRewardConfig(rawConfig?: Partial<SeasonRewardConfig> | null): ResolvedSeasonRewardConfig {
  const brackets = (rawConfig?.brackets ?? []).map((bracket, index) => normalizeSeasonRewardBracket(bracket, index));
  if (brackets.length === 0) {
    throw new Error("seasonRewards.brackets must define at least one reward bracket");
  }

  const sortedBrackets = [...brackets].sort((left, right) => left.topPercentile - right.topPercentile);
  for (let index = 1; index < sortedBrackets.length; index += 1) {
    if (sortedBrackets[index]!.topPercentile === sortedBrackets[index - 1]!.topPercentile) {
      throw new Error("seasonRewards.brackets topPercentile values must be unique");
    }
  }

  return {
    brackets: sortedBrackets
  };
}

export function resolveSeasonRewardConfig(): ResolvedSeasonRewardConfig {
  return normalizeSeasonRewardConfig(seasonRewardsDocument as SeasonRewardConfig);
}

export function resolveSeasonRewardBracket(
  rankPosition: number,
  rankedPlayerCount: number,
  rewardConfig = resolveSeasonRewardConfig()
): SeasonRewardBracketAssignment | null {
  if (!Number.isInteger(rankPosition) || rankPosition <= 0 || rankedPlayerCount <= 0) {
    return null;
  }

  for (const bracket of rewardConfig.brackets) {
    const maxRank = Math.max(1, Math.ceil((rankedPlayerCount * bracket.topPercentile) / 100));
    if (rankPosition <= maxRank) {
      return {
        ...bracket,
        rankPosition
      };
    }
  }

  return null;
}

export function computeSeasonReward(
  rankPosition: number,
  rankedPlayerCount: number,
  rewardConfig = resolveSeasonRewardConfig()
): SeasonRewardComputation | null {
  const bracket = resolveSeasonRewardBracket(rankPosition, rankedPlayerCount, rewardConfig);
  if (!bracket) {
    return null;
  }

  return {
    gems: bracket.gems,
    badge: bracket.badge,
    rankPosition
  };
}
