import type { PlayerBattleReplaySummary } from "./battle-replay.ts";

export const DEFAULT_TUTORIAL_STEP = 1;
export const MIN_SKIP_TUTORIAL_STEP = 2;
export const NEW_PLAYER_MATCHMAKING_PROTECTION_MATCHES = 5;
export const STANDARD_MATCHMAKING_MAX_RATING_GAP = 200;
export const PROTECTED_MATCHMAKING_MAX_RATING_GAP = 500;
export const TOP_TIER_MATCHMAKING_RATING = 1500;

export function normalizeTutorialStep(value?: number | null): number | null {
  if (value == null) {
    return null;
  }

  const normalized = Math.floor(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : DEFAULT_TUTORIAL_STEP;
}

export function isTutorialComplete(tutorialStep?: number | null): boolean {
  return normalizeTutorialStep(tutorialStep) === null;
}

export function canSkipTutorial(tutorialStep?: number | null): boolean {
  const normalized = normalizeTutorialStep(tutorialStep);
  return normalized !== null && normalized >= MIN_SKIP_TUTORIAL_STEP;
}

export function countTrackedPvpMatches(
  replays?: Partial<PlayerBattleReplaySummary>[] | null,
  limit = NEW_PLAYER_MATCHMAKING_PROTECTION_MATCHES
): number {
  const safeLimit = Math.max(1, Math.floor(limit));
  return (replays ?? []).filter((replay) => replay?.battleKind === "hero").slice(0, safeLimit).length;
}

export function countRemainingProtectedPvpMatches(
  replays?: Partial<PlayerBattleReplaySummary>[] | null,
  limit = NEW_PLAYER_MATCHMAKING_PROTECTION_MATCHES
): number {
  const safeLimit = Math.max(1, Math.floor(limit));
  return Math.max(0, safeLimit - countTrackedPvpMatches(replays, safeLimit));
}
