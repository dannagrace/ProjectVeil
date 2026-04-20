import rankedSeasonConfigDocument from "../../../../../configs/ranked-season.json";
import { normalizeEloRating, type PlayerTier, type RankDivisionId } from "./matchmaking.ts";
import type { PlayerBattleReplaySummary } from "./battle-replay.ts";
import type { RankedWeeklyProgress } from "./models.ts";

interface RankedSeasonConfigDocument {
  divisionThresholds?: Partial<Record<RankDivisionId, number>> | null;
  promotionSeries?: {
    winsRequired?: number | null;
    lossesAllowed?: number | null;
  } | null;
  demotionShield?: {
    games?: number | null;
  } | null;
  softDecay?: Partial<Record<PlayerTier, RankDivisionId>> | null;
}

export interface RankedSeasonConfig {
  divisionThresholds: Record<RankDivisionId, number>;
  promotionSeries: {
    winsRequired: number;
    lossesAllowed: number;
  };
  demotionShield: {
    games: number;
  };
  softDecay: Partial<Record<PlayerTier, RankDivisionId>>;
}

export const RANK_DIVISION_ORDER: RankDivisionId[] = [
  "bronze_i",
  "bronze_ii",
  "bronze_iii",
  "silver_i",
  "silver_ii",
  "silver_iii",
  "gold_i",
  "gold_ii",
  "gold_iii",
  "platinum_i",
  "platinum_ii",
  "platinum_iii",
  "diamond_i",
  "diamond_ii",
  "diamond_iii"
];

const DIVISION_TO_TIER: Record<RankDivisionId, PlayerTier> = {
  bronze_i: "bronze",
  bronze_ii: "bronze",
  bronze_iii: "bronze",
  silver_i: "silver",
  silver_ii: "silver",
  silver_iii: "silver",
  gold_i: "gold",
  gold_ii: "gold",
  gold_iii: "gold",
  platinum_i: "platinum",
  platinum_ii: "platinum",
  platinum_iii: "platinum",
  diamond_i: "diamond",
  diamond_ii: "diamond",
  diamond_iii: "diamond"
};

function normalizePositiveInteger(value: number | null | undefined, fallback: number): number {
  const normalized = Math.floor(value ?? Number.NaN);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

export function resolveRankedSeasonConfig(
  document: RankedSeasonConfigDocument = rankedSeasonConfigDocument as RankedSeasonConfigDocument
): RankedSeasonConfig {
  const divisionThresholds = Object.fromEntries(
    RANK_DIVISION_ORDER.map((division, index) => {
      const configured = document.divisionThresholds?.[division];
      const fallback = index === 0 ? 0 : index * 100;
      return [division, Math.max(0, Math.floor(configured ?? fallback))];
    })
  ) as Record<RankDivisionId, number>;

  return {
    divisionThresholds,
    promotionSeries: {
      winsRequired: normalizePositiveInteger(document.promotionSeries?.winsRequired, 3),
      lossesAllowed: normalizePositiveInteger(document.promotionSeries?.lossesAllowed, 2)
    },
    demotionShield: {
      games: normalizePositiveInteger(document.demotionShield?.games, 3)
    },
    softDecay: document.softDecay ?? {}
  };
}

export function getRankDivisionThreshold(division: RankDivisionId): number {
  return resolveRankedSeasonConfig().divisionThresholds[division];
}

export function getRankDivisionIndex(division: RankDivisionId): number {
  return RANK_DIVISION_ORDER.indexOf(division);
}

export function getNextRankDivision(division: RankDivisionId): RankDivisionId | null {
  const index = getRankDivisionIndex(division);
  return index >= 0 && index < RANK_DIVISION_ORDER.length - 1 ? RANK_DIVISION_ORDER[index + 1]! : null;
}

export function getPreviousRankDivision(division: RankDivisionId): RankDivisionId | null {
  const index = getRankDivisionIndex(division);
  return index > 0 ? RANK_DIVISION_ORDER[index - 1]! : null;
}

export function getRankDivisionForRating(rating: number | undefined | null): RankDivisionId {
  const normalized = normalizeEloRating(rating);
  const config = resolveRankedSeasonConfig();
  let current: RankDivisionId = "bronze_i";
  for (const division of RANK_DIVISION_ORDER) {
    if (normalized >= config.divisionThresholds[division]) {
      current = division;
      continue;
    }
    break;
  }
  return current;
}

export function getTierForDivision(division: RankDivisionId): PlayerTier {
  return DIVISION_TO_TIER[division];
}

export function getDivisionLabel(division: RankDivisionId): string {
  const parts = division.split("_");
  const tier = parts[0] || "bronze";
  const roman = parts[1] || "i";
  return `${tier.toUpperCase()} ${roman.toUpperCase()}`;
}

export function getTierFloorDivision(tier: PlayerTier): RankDivisionId {
  return RANK_DIVISION_ORDER.find((division) => DIVISION_TO_TIER[division] === tier) ?? "bronze_i";
}

export function getSoftDecayDivision(division: RankDivisionId): RankDivisionId {
  const config = resolveRankedSeasonConfig();
  return config.softDecay[getTierForDivision(division)] ?? division;
}

export function getPromotionSeriesTargetDivision(
  currentDivision: RankDivisionId,
  rating: number | undefined | null
): RankDivisionId | null {
  const nextDivision = getNextRankDivision(currentDivision);
  if (!nextDivision) {
    return null;
  }

  return normalizeEloRating(rating) >= getRankDivisionThreshold(nextDivision) ? nextDivision : null;
}

export function isPromotionSeriesBoundary(currentDivision: RankDivisionId, nextDivision: RankDivisionId): boolean {
  return getTierForDivision(currentDivision) !== getTierForDivision(nextDivision) && getRankDivisionIndex(nextDivision) > getRankDivisionIndex(currentDivision);
}

export function rollRankedWeeklyProgress(
  progress: RankedWeeklyProgress | undefined,
  referenceTime: Date | string = new Date()
): RankedWeeklyProgress {
  const currentWeekStartsAt = getUtcWeekStart(referenceTime);
  const previousWeekStartsAt = addUtcDays(currentWeekStartsAt, -7);
  const next: RankedWeeklyProgress = {
    currentWeekStartsAt,
    currentWeekBattles: 0,
    currentWeekWins: 0
  };

  if (!progress) {
    return next;
  }

  if (progress.currentWeekStartsAt === currentWeekStartsAt) {
    next.currentWeekBattles = Math.max(0, Math.floor(progress.currentWeekBattles ?? 0));
    next.currentWeekWins = Math.max(0, Math.floor(progress.currentWeekWins ?? 0));
    if (progress.previousWeekStartsAt === previousWeekStartsAt) {
      const previousWeekBattles = Math.max(0, Math.floor(progress.previousWeekBattles ?? 0));
      const previousWeekWins = Math.max(0, Math.floor(progress.previousWeekWins ?? 0));
      next.previousWeekStartsAt = previousWeekStartsAt;
      if (previousWeekBattles > 0) {
        next.previousWeekBattles = previousWeekBattles;
      }
      if (previousWeekWins > 0) {
        next.previousWeekWins = previousWeekWins;
      }
    }
    return next;
  }

  const previousWeek =
    progress.currentWeekStartsAt === previousWeekStartsAt
      ? {
          battles: Math.max(0, Math.floor(progress.currentWeekBattles ?? 0)),
          wins: Math.max(0, Math.floor(progress.currentWeekWins ?? 0))
        }
      : progress.previousWeekStartsAt === previousWeekStartsAt
        ? {
            battles: Math.max(0, Math.floor(progress.previousWeekBattles ?? 0)),
            wins: Math.max(0, Math.floor(progress.previousWeekWins ?? 0))
          }
        : null;

  if (previousWeek) {
    next.previousWeekStartsAt = previousWeekStartsAt;
    if (previousWeek.battles > 0) {
      next.previousWeekBattles = previousWeek.battles;
    }
    if (previousWeek.wins > 0) {
      next.previousWeekWins = previousWeek.wins;
    }
  }

  return next;
}

export function shouldApplyWeeklyDivisionDecay(
  division: RankDivisionId,
  progress: RankedWeeklyProgress | undefined,
  referenceTime: Date | string = new Date()
): boolean {
  const currentWeekStartsAt = getUtcWeekStart(referenceTime);
  if (!progress || progress.currentWeekStartsAt === currentWeekStartsAt || division === "bronze_i") {
    return false;
  }

  const previousWeekStartsAt = addUtcDays(currentWeekStartsAt, -7);
  if (progress.currentWeekStartsAt === previousWeekStartsAt) {
    return Math.max(0, Math.floor(progress.currentWeekBattles ?? 0)) < 1;
  }
  if (progress.previousWeekStartsAt === previousWeekStartsAt) {
    return Math.max(0, Math.floor(progress.previousWeekBattles ?? 0)) < 1;
  }
  return true;
}

export function didPlayerWinReplay(replay: Pick<PlayerBattleReplaySummary, "playerCamp" | "result">): boolean {
  return (
    (replay.playerCamp === "attacker" && replay.result === "attacker_victory") ||
    (replay.playerCamp === "defender" && replay.result === "defender_victory")
  );
}

export function getUtcWeekStart(referenceTime: Date | string = new Date()): string {
  const reference = typeof referenceTime === "string" ? new Date(referenceTime) : new Date(referenceTime.getTime());
  const normalized = Number.isNaN(reference.getTime()) ? new Date() : reference;
  const day = normalized.getUTCDay();
  const distanceToMonday = (day + 6) % 7;
  normalized.setUTCHours(0, 0, 0, 0);
  normalized.setUTCDate(normalized.getUTCDate() - distanceToMonday);
  return normalized.toISOString();
}

export function addUtcDays(timestamp: string, days: number): string {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
