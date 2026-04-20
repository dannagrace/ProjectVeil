import seasonRewardsDocument from "../../../configs/season-rewards.json";
import seasonRewardSchemaDocument from "../../../configs/schemas/season-rewards.schema.json";
import type { SeasonRewardBracket, SeasonRewardConfig } from "@veil/shared/models";

export interface ResolvedSeasonRewardConfig extends SeasonRewardConfig {}

export interface SeasonRewardBracketAssignment extends SeasonRewardBracket {
  rankPosition: number;
}

export interface SeasonRewardComputation {
  gems: number;
  badge: string;
  rankPosition: number;
}

interface JsonSchemaDocument {
  $id?: string;
}

const SEASON_REWARD_CONFIG_SCHEMA = seasonRewardSchemaDocument as JsonSchemaDocument;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSchemaPrefixedMessage(message: string): string {
  const schemaId = SEASON_REWARD_CONFIG_SCHEMA.$id ? ` (${SEASON_REWARD_CONFIG_SCHEMA.$id})` : "";
  return `Invalid season reward config${schemaId}: ${message}`;
}

function assertAllowedKeys(value: Record<string, unknown>, allowedKeys: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(formatSchemaPrefixedMessage(`${path}.${key} is not allowed`));
    }
  }
}

function parseSeasonRewardBracketDocument(value: unknown, index: number): SeasonRewardBracket {
  const path = `seasonRewards.brackets[${index}]`;
  if (!isRecord(value)) {
    throw new Error(formatSchemaPrefixedMessage(`${path} must be an object`));
  }

  assertAllowedKeys(value, ["topPercentile", "gems", "badge"], path);

  if (typeof value.badge !== "string" || value.badge.trim().length === 0) {
    throw new Error(formatSchemaPrefixedMessage(`${path}.badge must be a non-empty string`));
  }

  if (typeof value.topPercentile !== "number" || !Number.isFinite(value.topPercentile)) {
    throw new Error(formatSchemaPrefixedMessage(`${path}.topPercentile must be a number`));
  }

  if (typeof value.gems !== "number" || !Number.isInteger(value.gems) || value.gems < 0) {
    throw new Error(formatSchemaPrefixedMessage(`${path}.gems must be a non-negative integer`));
  }

  return {
    topPercentile: value.topPercentile,
    gems: value.gems,
    badge: value.badge.trim()
  };
}

export function parseSeasonRewardConfigDocument(rawConfig: unknown): ResolvedSeasonRewardConfig {
  if (!isRecord(rawConfig)) {
    throw new Error(formatSchemaPrefixedMessage("seasonRewards must be an object"));
  }

  assertAllowedKeys(rawConfig, ["brackets"], "seasonRewards");

  const { brackets } = rawConfig;
  if (!Array.isArray(brackets)) {
    throw new Error(formatSchemaPrefixedMessage("seasonRewards.brackets must be an array"));
  }

  return normalizeSeasonRewardConfig({
    brackets: brackets.map((bracket, index) => parseSeasonRewardBracketDocument(bracket, index))
  });
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

const resolvedSeasonRewardConfig = parseSeasonRewardConfigDocument(seasonRewardsDocument);

export function resolveSeasonRewardConfig(): ResolvedSeasonRewardConfig {
  return resolvedSeasonRewardConfig;
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
