import {
  PROTECTED_MATCHMAKING_MAX_RATING_GAP,
  STANDARD_MATCHMAKING_MAX_RATING_GAP,
  TOP_TIER_MATCHMAKING_RATING
} from "./tutorial.ts";
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
  protectedPvpMatchesRemaining?: number;
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

const LARGE_MATCHMAKING_QUEUE_THRESHOLD = 50;

interface IndexedMatchmakingRequest {
  request: MatchmakingRequest;
  index: number;
  rating: number;
}

interface MatchmakingPairSearchState {
  selection: MatchmakingPairSelection;
  totalWait: number;
  oldestQueuedAt: number;
  leftIndex: number;
  rightIndex: number;
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
    enqueuedAt: Number.isNaN(enqueuedAt.getTime()) ? new Date().toISOString() : enqueuedAt.toISOString(),
    protectedPvpMatchesRemaining: Math.max(0, Math.floor(input.protectedPvpMatchesRemaining ?? 0))
  };
}

function resolvePairRatingGapLimit(left: MatchmakingRequest, right: MatchmakingRequest): number {
  return left.protectedPvpMatchesRemaining || right.protectedPvpMatchesRemaining
    ? PROTECTED_MATCHMAKING_MAX_RATING_GAP
    : STANDARD_MATCHMAKING_MAX_RATING_GAP;
}

function pairsIntoTopTierWhileProtected(left: MatchmakingRequest, right: MatchmakingRequest): boolean {
  return (
    (left.protectedPvpMatchesRemaining ?? 0) > 0 && normalizeEloRating(right.rating) >= TOP_TIER_MATCHMAKING_RATING
  ) || (
    (right.protectedPvpMatchesRemaining ?? 0) > 0 && normalizeEloRating(left.rating) >= TOP_TIER_MATCHMAKING_RATING
  );
}

function waitingMillisFor(request: MatchmakingRequest, referenceTimeMs: number): number {
  const enqueuedAt = new Date(request.enqueuedAt).getTime();
  if (Number.isNaN(enqueuedAt)) {
    return 0;
  }
  return Math.max(0, referenceTimeMs - enqueuedAt);
}

function createIndexedMatchmakingRequests(requests: MatchmakingRequest[]): IndexedMatchmakingRequest[] {
  return requests.map((request, index) => ({
    request,
    index,
    rating: normalizeEloRating(request.rating)
  }));
}

function considerMatchmakingPair(
  current: MatchmakingPairSearchState | null,
  left: IndexedMatchmakingRequest,
  right: IndexedMatchmakingRequest,
  referenceTimeMs: number
): MatchmakingPairSearchState | null {
  const ratingGap = Math.abs(left.rating - right.rating);
  if (
    ratingGap > resolvePairRatingGapLimit(left.request, right.request) ||
    pairsIntoTopTierWhileProtected(left.request, right.request)
  ) {
    return current;
  }

  const totalWait = waitingMillisFor(left.request, referenceTimeMs) + waitingMillisFor(right.request, referenceTimeMs);
  const oldestQueuedAt = Math.min(
    new Date(left.request.enqueuedAt).getTime(),
    new Date(right.request.enqueuedAt).getTime()
  );
  const leftIndex = Math.min(left.index, right.index);
  const rightIndex = Math.max(left.index, right.index);

  if (
    current &&
    (ratingGap > current.selection.ratingGap ||
      (ratingGap === current.selection.ratingGap && totalWait < current.totalWait) ||
      (ratingGap === current.selection.ratingGap &&
        totalWait === current.totalWait &&
        oldestQueuedAt > current.oldestQueuedAt) ||
      (ratingGap === current.selection.ratingGap &&
        totalWait === current.totalWait &&
        oldestQueuedAt === current.oldestQueuedAt &&
        (leftIndex > current.leftIndex || (leftIndex === current.leftIndex && rightIndex >= current.rightIndex))))
  ) {
    return current;
  }

  const players =
    left.index < right.index
      ? ([left.request, right.request] as [MatchmakingRequest, MatchmakingRequest])
      : ([right.request, left.request] as [MatchmakingRequest, MatchmakingRequest]);
  return {
    selection: {
      players,
      ratingGap
    },
    totalWait,
    oldestQueuedAt,
    leftIndex,
    rightIndex
  };
}

function selectBestMatchPairExhaustive(
  requests: IndexedMatchmakingRequest[],
  referenceTimeMs: number
): MatchmakingPairSearchState | null {
  let best: MatchmakingPairSearchState | null = null;

  for (let leftIndex = 0; leftIndex < requests.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < requests.length; rightIndex += 1) {
      best = considerMatchmakingPair(best, requests[leftIndex]!, requests[rightIndex]!, referenceTimeMs);
    }
  }

  return best;
}

function selectBestMatchPairFromRatingWindow(
  requests: IndexedMatchmakingRequest[],
  referenceTimeMs: number
): MatchmakingPairSearchState | null {
  const sortedRequests = [...requests].sort((left, right) => left.rating - right.rating || left.index - right.index);
  let best: MatchmakingPairSearchState | null = null;

  for (let leftIndex = 0; leftIndex < sortedRequests.length - 1; leftIndex += 1) {
    const left = sortedRequests[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < sortedRequests.length; rightIndex += 1) {
      const right = sortedRequests[rightIndex]!;
      const ratingGap = right.rating - left.rating;
      if (ratingGap > PROTECTED_MATCHMAKING_MAX_RATING_GAP || (best && ratingGap > best.selection.ratingGap)) {
        break;
      }
      best = considerMatchmakingPair(best, left, right, referenceTimeMs);
    }
  }

  return best;
}

export function selectBestMatchPair(
  requests: MatchmakingRequest[],
  now = new Date()
): MatchmakingPairSelection | null {
  if (requests.length < 2) {
    return null;
  }

  const referenceTimeMs = now.getTime();
  const indexedRequests = createIndexedMatchmakingRequests(requests);
  const search =
    requests.length > LARGE_MATCHMAKING_QUEUE_THRESHOLD
      ? selectBestMatchPairFromRatingWindow(indexedRequests, referenceTimeMs)
      : selectBestMatchPairExhaustive(indexedRequests, referenceTimeMs);

  return search?.selection ?? null;
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
export type RankDivisionId =
  | "bronze_i"
  | "bronze_ii"
  | "bronze_iii"
  | "silver_i"
  | "silver_ii"
  | "silver_iii"
  | "gold_i"
  | "gold_ii"
  | "gold_iii"
  | "platinum_i"
  | "platinum_ii"
  | "platinum_iii"
  | "diamond_i"
  | "diamond_ii"
  | "diamond_iii";

export interface PromotionSeriesState {
  targetDivision: RankDivisionId;
  wins: number;
  losses: number;
  winsRequired: number;
  lossesAllowed: number;
}

export interface DemotionShieldState {
  tier: PlayerTier;
  remainingMatches: number;
}

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
