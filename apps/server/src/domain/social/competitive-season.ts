import type { PlayerBattleReplaySummary } from "@veil/shared/battle";
import { addUtcDays, didPlayerWinReplay, getPreviousRankDivision, getPromotionSeriesTargetDivision, getRankDivisionForRating, getRankDivisionIndex, getSoftDecayDivision, getTierFloorDivision, getTierForDivision, getUtcWeekStart, resolveRankedSeasonConfig, rollRankedWeeklyProgress, shouldApplyWeeklyDivisionDecay } from "@veil/shared/progression";
import type { RankDivisionId } from "@veil/shared/social";
import type { PlayerAccountSnapshot, PlayerAccountProgressPatch } from "@server/persistence";

function uniqueNewReplays(
  existing: PlayerAccountSnapshot,
  nextReplays: NonNullable<PlayerAccountSnapshot["recentBattleReplays"]>
): PlayerBattleReplaySummary[] {
  const existingIds = new Set((existing.recentBattleReplays ?? []).map((replay) => replay.id));
  return nextReplays
    .filter((replay) => !existingIds.has(replay.id))
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt) || left.id.localeCompare(right.id));
}

function toHeroPvpReplays(replays: PlayerBattleReplaySummary[]): PlayerBattleReplaySummary[] {
  return replays.filter((replay) => replay.battleKind === "hero");
}

function updateWeeklyProgress(
  account: PlayerAccountSnapshot,
  newReplays: PlayerBattleReplaySummary[],
  referenceTime = new Date()
): NonNullable<PlayerAccountSnapshot["rankedWeeklyProgress"]> {
  const currentWeekStartsAt = getUtcWeekStart(referenceTime);
  const previousWeekStartsAt = addUtcDays(currentWeekStartsAt, -7);
  const next = rollRankedWeeklyProgress(account.rankedWeeklyProgress, referenceTime);

  for (const replay of toHeroPvpReplays(newReplays)) {
    const replayWeekStartsAt = getUtcWeekStart(replay.completedAt);
    if (replayWeekStartsAt === next.currentWeekStartsAt) {
      next.currentWeekBattles += 1;
      if (didPlayerWinReplay(replay)) {
        next.currentWeekWins += 1;
      }
      continue;
    }
    if (replayWeekStartsAt === previousWeekStartsAt) {
      next.previousWeekStartsAt = previousWeekStartsAt;
      next.previousWeekBattles = (next.previousWeekBattles ?? 0) + 1;
      if (didPlayerWinReplay(replay)) {
        next.previousWeekWins = (next.previousWeekWins ?? 0) + 1;
      }
    }
  }

  return next;
}

function applyWeeklyDivisionDecay(
  account: PlayerAccountSnapshot,
  rankDivision: RankDivisionId,
  peakRankDivision: RankDivisionId,
  referenceTime = new Date()
): Pick<PlayerAccountSnapshot, "rankDivision" | "peakRankDivision" | "promotionSeries" | "demotionShield" | "rankedWeeklyProgress"> {
  const rankedWeeklyProgress = rollRankedWeeklyProgress(account.rankedWeeklyProgress, referenceTime);
  if (!shouldApplyWeeklyDivisionDecay(rankDivision, account.rankedWeeklyProgress, referenceTime)) {
    return {
      rankDivision,
      peakRankDivision,
      ...(account.promotionSeries ? { promotionSeries: account.promotionSeries } : {}),
      ...(account.demotionShield ? { demotionShield: account.demotionShield } : {}),
      rankedWeeklyProgress
    };
  }

  return {
    rankDivision: getPreviousRankDivision(rankDivision) ?? rankDivision,
    peakRankDivision,
    rankedWeeklyProgress
  };
}

export function resolveCompetitiveProgression(
  existing: PlayerAccountSnapshot,
  patch: PlayerAccountProgressPatch,
  nextReplays: NonNullable<PlayerAccountSnapshot["recentBattleReplays"]>,
  nextRating: number,
  referenceTime = new Date()
): Pick<
  PlayerAccountSnapshot,
  "rankDivision" | "peakRankDivision" | "promotionSeries" | "demotionShield" | "rankedWeeklyProgress"
> {
  const config = resolveRankedSeasonConfig();
  const newReplays = uniqueNewReplays(existing, nextReplays);
  const heroPvpReplays = toHeroPvpReplays(newReplays);
  let rankDivision = existing.rankDivision ?? getRankDivisionForRating(existing.eloRating ?? 1000);
  let peakRankDivision = existing.peakRankDivision ?? rankDivision;
  let promotionSeries = existing.promotionSeries;
  let demotionShield = existing.demotionShield;
  const weeklyDecay = applyWeeklyDivisionDecay(existing, rankDivision, peakRankDivision, referenceTime);
  rankDivision = weeklyDecay.rankDivision ?? rankDivision;
  peakRankDivision = weeklyDecay.peakRankDivision ?? peakRankDivision;
  promotionSeries = weeklyDecay.promotionSeries;
  demotionShield = weeklyDecay.demotionShield;
  const targetDivision = patch.eloRating !== undefined ? getRankDivisionForRating(nextRating) : rankDivision;

  if (patch.eloRating !== undefined && getRankDivisionIndex(targetDivision) < getRankDivisionIndex(rankDivision)) {
    if (demotionShield && demotionShield.remainingMatches > 0 && demotionShield.tier === getTierForDivision(rankDivision)) {
      demotionShield = {
        ...demotionShield,
        remainingMatches: Math.max(0, demotionShield.remainingMatches - heroPvpReplays.length)
      };
      if (demotionShield.remainingMatches <= 0) {
        demotionShield = undefined;
        rankDivision = targetDivision;
      }
    } else {
      rankDivision = targetDivision;
    }
    promotionSeries = undefined;
  } else if (patch.eloRating !== undefined) {
    const promotionTarget = getPromotionSeriesTargetDivision(rankDivision, nextRating);
    if (promotionTarget && (!promotionSeries || promotionSeries.targetDivision !== promotionTarget)) {
      promotionSeries = {
        targetDivision: promotionTarget,
        wins: 0,
        losses: 0,
        winsRequired: config.promotionSeries.winsRequired,
        lossesAllowed: config.promotionSeries.lossesAllowed
      };
    } else if (!promotionTarget && getRankDivisionIndex(targetDivision) === getRankDivisionIndex(rankDivision)) {
      promotionSeries = undefined;
    }
  }

  for (const replay of heroPvpReplays) {
    if (promotionSeries) {
      if (didPlayerWinReplay(replay)) {
        promotionSeries = {
          ...promotionSeries,
          wins: promotionSeries.wins + 1
        };
      } else {
        promotionSeries = {
          ...promotionSeries,
          losses: promotionSeries.losses + 1
        };
      }

      if (promotionSeries.wins >= promotionSeries.winsRequired) {
        rankDivision = promotionSeries.targetDivision;
        peakRankDivision =
          getRankDivisionIndex(rankDivision) > getRankDivisionIndex(peakRankDivision) ? rankDivision : peakRankDivision;
        demotionShield = {
          tier: getTierForDivision(rankDivision),
          remainingMatches: config.demotionShield.games
        };
        promotionSeries = undefined;
      } else if (promotionSeries.losses >= promotionSeries.lossesAllowed) {
        promotionSeries = undefined;
      }
      continue;
    }

    if (demotionShield && demotionShield.remainingMatches > 0) {
      demotionShield = {
        ...demotionShield,
        remainingMatches: Math.max(0, demotionShield.remainingMatches - 1)
      };
      if (demotionShield.remainingMatches <= 0) {
        demotionShield = undefined;
      }
    }
  }

  if (getRankDivisionIndex(rankDivision) > getRankDivisionIndex(peakRankDivision)) {
    peakRankDivision = rankDivision;
  }

  return {
    rankDivision,
    peakRankDivision,
    ...(promotionSeries ? { promotionSeries } : {}),
    ...(demotionShield ? { demotionShield } : {}),
    rankedWeeklyProgress: updateWeeklyProgress(
      {
        ...existing,
        rankDivision,
        peakRankDivision,
        ...(promotionSeries ? { promotionSeries } : {}),
        ...(demotionShield ? { demotionShield } : {}),
        ...(weeklyDecay.rankedWeeklyProgress ? { rankedWeeklyProgress: weeklyDecay.rankedWeeklyProgress } : {})
      },
      newReplays,
      referenceTime
    )
  };
}

export function applySeasonSoftDecay(account: PlayerAccountSnapshot): Pick<
  PlayerAccountSnapshot,
  "eloRating" | "rankDivision" | "peakRankDivision" | "promotionSeries" | "demotionShield"
> {
  const nextDivision = getSoftDecayDivision(account.rankDivision ?? getRankDivisionForRating(account.eloRating ?? 1000));
  return {
    eloRating: decayDivisionToRating(nextDivision),
    rankDivision: nextDivision,
    peakRankDivision: nextDivision
  };
}

export function getCurrentAndPreviousWeeklyEntries(accounts: PlayerAccountSnapshot[], referenceTime = new Date()) {
  const currentWeekStartsAt = getUtcWeekStart(referenceTime);
  const previousWeekStartsAt = addUtcDays(currentWeekStartsAt, -7);

  const current = accounts
    .map((account) => ({
      playerId: account.playerId,
      displayName: account.displayName,
      wins: account.rankedWeeklyProgress?.currentWeekStartsAt === currentWeekStartsAt
        ? account.rankedWeeklyProgress.currentWeekWins
        : 0,
      weekStartsAt: currentWeekStartsAt,
      weekEndsAt: addUtcDays(currentWeekStartsAt, 7),
      rankDivision: account.rankDivision ?? getRankDivisionForRating(account.eloRating ?? 1000)
    }))
    .filter((entry) => entry.wins > 0)
    .sort((left, right) => right.wins - left.wins || left.playerId.localeCompare(right.playerId))
    .slice(0, 100);

  const previous = accounts
    .map((account) => ({
      playerId: account.playerId,
      displayName: account.displayName,
      wins:
        account.rankedWeeklyProgress?.previousWeekStartsAt === previousWeekStartsAt
          ? account.rankedWeeklyProgress.previousWeekWins ?? 0
          : 0,
      weekStartsAt: previousWeekStartsAt,
      weekEndsAt: currentWeekStartsAt,
      rankDivision: account.rankDivision ?? getRankDivisionForRating(account.eloRating ?? 1000)
    }))
    .filter((entry) => entry.wins > 0)
    .sort((left, right) => right.wins - left.wins || left.playerId.localeCompare(right.playerId))
    .slice(0, 100);

  return { current, previous };
}

export function decayDivisionToRating(division: RankDivisionId): number {
  return resolveRankedSeasonConfig().divisionThresholds[division];
}

export function getDivisionTierFloor(division: RankDivisionId): RankDivisionId {
  return getTierFloorDivision(getTierForDivision(division));
}
