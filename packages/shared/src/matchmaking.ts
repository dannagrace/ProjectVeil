import { getBattleBalanceConfig } from "./world-config";
import type { HeroState } from "./models";

export const DEFAULT_ELO_RATING = 1000;

export interface MatchmakingHeroSnapshot {
  heroId: string;
  name: string;
  level: number;
  armyTemplateId: string;
  armyCount: number;
}

export interface MatchmakingRequest {
  playerId: string;
  heroSnapshot: MatchmakingHeroSnapshot;
  rating: number;
  enqueuedAt: string;
}

export interface MatchResult {
  roomId: string;
  playerIds: [string, string];
  seedOverride: number;
}

export interface MatchmakingPairSelection {
  players: [MatchmakingRequest, MatchmakingRequest];
  ratingGap: number;
}

function normalizeFiniteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export function normalizeEloRating(value: number | undefined | null): number {
  return normalizeFiniteInteger(value ?? DEFAULT_ELO_RATING, DEFAULT_ELO_RATING);
}

export function createMatchmakingHeroSnapshot(hero: HeroState): MatchmakingHeroSnapshot {
  return {
    heroId: hero.id,
    name: hero.name,
    level: normalizeFiniteInteger(hero.progression.level, 1),
    armyTemplateId: hero.armyTemplateId,
    armyCount: normalizeFiniteInteger(hero.armyCount, 0)
  };
}

export function normalizeMatchmakingRequest(input: Partial<MatchmakingRequest>): MatchmakingRequest {
  const playerId = input.playerId?.trim() ?? "";
  const heroSnapshot = input.heroSnapshot;
  const enqueuedAt = input.enqueuedAt ? new Date(input.enqueuedAt) : new Date();

  if (!playerId) {
    throw new Error("matchmaking playerId must not be empty");
  }
  if (!heroSnapshot?.heroId?.trim()) {
    throw new Error("matchmaking heroSnapshot.heroId must not be empty");
  }
  if (!heroSnapshot?.name?.trim()) {
    throw new Error("matchmaking heroSnapshot.name must not be empty");
  }
  if (!heroSnapshot?.armyTemplateId?.trim()) {
    throw new Error("matchmaking heroSnapshot.armyTemplateId must not be empty");
  }

  return {
    playerId,
    heroSnapshot: {
      heroId: heroSnapshot.heroId.trim(),
      name: heroSnapshot.name.trim(),
      level: normalizeFiniteInteger(heroSnapshot.level, 1),
      armyTemplateId: heroSnapshot.armyTemplateId.trim(),
      armyCount: normalizeFiniteInteger(heroSnapshot.armyCount, 0)
    },
    rating: normalizeEloRating(input.rating),
    enqueuedAt: Number.isNaN(enqueuedAt.getTime()) ? new Date().toISOString() : enqueuedAt.toISOString()
  };
}

function waitingMillisFor(request: MatchmakingRequest, referenceTimeMs: number): number {
  const enqueuedAt = new Date(request.enqueuedAt).getTime();
  if (Number.isNaN(enqueuedAt)) {
    return 0;
  }
  return Math.max(0, referenceTimeMs - enqueuedAt);
}

export function selectBestMatchPair(
  requests: MatchmakingRequest[],
  now = new Date()
): MatchmakingPairSelection | null {
  if (requests.length < 2) {
    return null;
  }

  const referenceTimeMs = now.getTime();
  let best: MatchmakingPairSelection | null = null;
  let bestTotalWait = -1;
  let bestOldestQueuedAt = Number.POSITIVE_INFINITY;

  for (let leftIndex = 0; leftIndex < requests.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < requests.length; rightIndex += 1) {
      const left = requests[leftIndex]!;
      const right = requests[rightIndex]!;
      const ratingGap = Math.abs(normalizeEloRating(left.rating) - normalizeEloRating(right.rating));
      const totalWait = waitingMillisFor(left, referenceTimeMs) + waitingMillisFor(right, referenceTimeMs);
      const oldestQueuedAt = Math.min(new Date(left.enqueuedAt).getTime(), new Date(right.enqueuedAt).getTime());

      if (
        !best ||
        ratingGap < best.ratingGap ||
        (ratingGap === best.ratingGap && totalWait > bestTotalWait) ||
        (ratingGap === best.ratingGap && totalWait === bestTotalWait && oldestQueuedAt < bestOldestQueuedAt)
      ) {
        best = {
          players: [left, right],
          ratingGap
        };
        bestTotalWait = totalWait;
        bestOldestQueuedAt = oldestQueuedAt;
      }
    }
  }

  return best;
}

export function estimateMatchmakingWaitSeconds(position: number): number {
  const normalizedPosition = Math.max(1, Math.floor(position));
  return Math.max(0, (normalizedPosition - 1) * 15);
}

export function expectedEloScore(playerRating: number, opponentRating: number): number {
  const normalizedPlayerRating = normalizeEloRating(playerRating);
  const normalizedOpponentRating = normalizeEloRating(opponentRating);
  return 1 / (1 + 10 ** ((normalizedOpponentRating - normalizedPlayerRating) / 400));
}

export function calculateEloRatingChange(
  playerRating: number,
  opponentRating: number,
  score: 0 | 0.5 | 1,
  kFactor = getBattleBalanceConfig().pvp.eloK
): number {
  const delta = kFactor * (score - expectedEloScore(playerRating, opponentRating));
  return Math.round(delta);
}

export function applyEloMatchResult(
  winnerRating: number,
  loserRating: number,
  kFactor = getBattleBalanceConfig().pvp.eloK
): {
  winnerRating: number;
  loserRating: number;
  winnerDelta: number;
  loserDelta: number;
} {
  const winnerDelta = calculateEloRatingChange(winnerRating, loserRating, 1, kFactor);
  const loserDelta = calculateEloRatingChange(loserRating, winnerRating, 0, kFactor);

  return {
    winnerRating: Math.max(0, normalizeEloRating(winnerRating) + winnerDelta),
    loserRating: Math.max(0, normalizeEloRating(loserRating) + loserDelta),
    winnerDelta,
    loserDelta
  };
}

export type PlayerTier = "bronze" | "silver" | "gold" | "platinum" | "diamond";

export function getTierForRating(rating: number): PlayerTier {
  const normalized = normalizeEloRating(rating);
  if (normalized >= 1800) return "diamond";
  if (normalized >= 1500) return "platinum";
  if (normalized >= 1300) return "gold";
  if (normalized >= 1100) return "silver";
  return "bronze";
}

export interface TierInfo {
  tier: PlayerTier;
  rating: number;
  nextTierRating: number | null;
  progressPercent: number;
}

export function getTierInfo(rating: number): TierInfo {
  const normalized = normalizeEloRating(rating);
  const tier = getTierForRating(normalized);
  const thresholds: Record<PlayerTier, number> = {
    bronze: 0,
    silver: 1100,
    gold: 1300,
    platinum: 1500,
    diamond: 1800
  };
  const nextThresholds: Record<PlayerTier, number | null> = {
    bronze: 1100,
    silver: 1300,
    gold: 1500,
    platinum: 1800,
    diamond: null
  };
  const current = thresholds[tier];
  const next = nextThresholds[tier];
  const progressPercent = next === null ? 100 : Math.min(100, Math.round(((normalized - current) / (next - current)) * 100));
  return { tier, rating: normalized, nextTierRating: next, progressPercent };
}
