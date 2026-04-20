import type { LeaderboardAbuseState, LeaderboardModerationState } from "@veil/shared/progression";
import { applyEloMatchResult } from "@veil/shared/social";

export const LEADERBOARD_DAILY_ELO_GAIN_LIMIT = 120;
export const LEADERBOARD_REPEATED_OPPONENT_ELO_GAIN_LIMIT = 40;
export const LEADERBOARD_REPEATED_OPPONENT_ALERT_THRESHOLD = 4;
const MAX_TRACKED_OPPONENTS = 12;

export interface LeaderboardAlertEvent {
  type:
    | "leaderboard_daily_gain_cap"
    | "leaderboard_repeated_opponent_gain_cap"
    | "leaderboard_repeated_opponent_watch"
    | "leaderboard_frozen_player_match";
  playerId: string;
  opponentPlayerId?: string;
  at: string;
  detail: string;
}

interface LeaderboardAccountSettlementInput {
  playerId: string;
  eloRating?: number | undefined;
  leaderboardAbuseState?: LeaderboardAbuseState | undefined;
  leaderboardModerationState?: LeaderboardModerationState | undefined;
}

export interface LeaderboardSettlementResult {
  winnerRating: number;
  loserRating: number;
  winnerAbuseState: LeaderboardAbuseState | undefined;
  loserAbuseState: LeaderboardAbuseState | undefined;
  alerts: LeaderboardAlertEvent[];
  capped: boolean;
}

function dayKey(at: string): string {
  return at.slice(0, 10);
}

function cloneAbuseState(state?: LeaderboardAbuseState): LeaderboardAbuseState {
  return structuredClone(state ?? {});
}

function resetDailyWindowIfNeeded(state: LeaderboardAbuseState, currentDay: string): LeaderboardAbuseState {
  if (state.currentDay === currentDay) {
    return state;
  }

  return {
    ...state,
    currentDay,
    dailyEloGain: 0,
    dailyEloLoss: 0
  };
}

function updateOpponentLedger(
  state: LeaderboardAbuseState,
  opponentPlayerId: string,
  at: string,
  gainDelta: number,
  lossDelta: number
): LeaderboardAbuseState {
  const existing = state.opponentStats ?? [];
  const nextEntries = existing.filter((entry) => entry.opponentPlayerId !== opponentPlayerId);
  const previous = existing.find((entry) => entry.opponentPlayerId === opponentPlayerId);
  nextEntries.push({
    opponentPlayerId,
    matchCount: Math.max(0, Math.floor((previous?.matchCount ?? 0) + 1)),
    eloGain: Math.max(0, Math.floor((previous?.eloGain ?? 0) + gainDelta)),
    eloLoss: Math.max(0, Math.floor((previous?.eloLoss ?? 0) + lossDelta)),
    lastPlayedAt: at
  });
  nextEntries.sort((left, right) => right.lastPlayedAt.localeCompare(left.lastPlayedAt));

  return {
    ...state,
    opponentStats: nextEntries.slice(0, MAX_TRACKED_OPPONENTS)
  };
}

function pushAlertReason(
  state: LeaderboardAbuseState,
  at: string,
  reason: string,
  elevatedStatus: "watch" | "flagged"
): LeaderboardAbuseState {
  const lastAlertReasons = Array.from(new Set([...(state.lastAlertReasons ?? []), reason])).slice(0, 8);

  return {
    ...state,
    status: state.status === "flagged" || elevatedStatus === "flagged" ? "flagged" : "watch",
    lastAlertAt: at,
    lastAlertReasons
  };
}

export function isLeaderboardFrozen(state?: LeaderboardModerationState | null): boolean {
  return Boolean(state?.frozenAt);
}

export function isLeaderboardHidden(state?: LeaderboardModerationState | null): boolean {
  return Boolean(state?.hiddenAt);
}

export function settleLeaderboardMatch(input: {
  winner: LeaderboardAccountSettlementInput;
  loser: LeaderboardAccountSettlementInput;
  settledAt?: string;
}): LeaderboardSettlementResult {
  const settledAt = input.settledAt ?? new Date().toISOString();
  const currentDay = dayKey(settledAt);
  let winnerState = resetDailyWindowIfNeeded(cloneAbuseState(input.winner.leaderboardAbuseState), currentDay);
  let loserState = resetDailyWindowIfNeeded(cloneAbuseState(input.loser.leaderboardAbuseState), currentDay);
  const alerts: LeaderboardAlertEvent[] = [];
  const winnerRating = Math.max(0, Math.floor(input.winner.eloRating ?? 1000));
  const loserRating = Math.max(0, Math.floor(input.loser.eloRating ?? 1000));

  if (isLeaderboardFrozen(input.winner.leaderboardModerationState) || isLeaderboardFrozen(input.loser.leaderboardModerationState)) {
    const detail = `Leaderboard settlement skipped because ${input.winner.playerId} or ${input.loser.playerId} is frozen.`;
    alerts.push({
      type: "leaderboard_frozen_player_match",
      playerId: input.winner.playerId,
      opponentPlayerId: input.loser.playerId,
      at: settledAt,
      detail
    });
    return {
      winnerRating,
      loserRating,
      winnerAbuseState: pushAlertReason(winnerState, settledAt, "frozen_match_skipped", "watch"),
      loserAbuseState: loserState,
      alerts,
      capped: true
    };
  }

  const raw = applyEloMatchResult(winnerRating, loserRating);
  const rawGain = Math.max(0, raw.winnerRating - winnerRating);
  const remainingDailyGain = Math.max(0, LEADERBOARD_DAILY_ELO_GAIN_LIMIT - Math.max(0, winnerState.dailyEloGain ?? 0));
  const previousOpponentWinner = winnerState.opponentStats?.find((entry) => entry.opponentPlayerId === input.loser.playerId);
  const remainingOpponentGain = Math.max(
    0,
    LEADERBOARD_REPEATED_OPPONENT_ELO_GAIN_LIMIT - Math.max(0, previousOpponentWinner?.eloGain ?? 0)
  );
  const allowedGain = Math.max(0, Math.min(rawGain, remainingDailyGain, remainingOpponentGain));
  const capped = allowedGain < rawGain;

  if (allowedGain < rawGain && remainingDailyGain < rawGain) {
    winnerState = pushAlertReason(winnerState, settledAt, "daily_gain_cap_hit", "flagged");
    alerts.push({
      type: "leaderboard_daily_gain_cap",
      playerId: input.winner.playerId,
      opponentPlayerId: input.loser.playerId,
      at: settledAt,
      detail: `Winner gain capped to ${allowedGain} because the daily ELO gain limit is ${LEADERBOARD_DAILY_ELO_GAIN_LIMIT}.`
    });
  }
  if (allowedGain < rawGain && remainingOpponentGain < rawGain) {
    winnerState = pushAlertReason(winnerState, settledAt, "repeated_opponent_gain_cap_hit", "flagged");
    alerts.push({
      type: "leaderboard_repeated_opponent_gain_cap",
      playerId: input.winner.playerId,
      opponentPlayerId: input.loser.playerId,
      at: settledAt,
      detail:
        `Winner gain capped to ${allowedGain} because the repeated-opponent ELO gain limit is ` +
        `${LEADERBOARD_REPEATED_OPPONENT_ELO_GAIN_LIMIT}.`
    });
  }

  winnerState = updateOpponentLedger(winnerState, input.loser.playerId, settledAt, allowedGain, 0);
  loserState = updateOpponentLedger(loserState, input.winner.playerId, settledAt, 0, allowedGain);
  winnerState.dailyEloGain = Math.max(0, Math.floor((winnerState.dailyEloGain ?? 0) + allowedGain));
  loserState.dailyEloLoss = Math.max(0, Math.floor((loserState.dailyEloLoss ?? 0) + allowedGain));

  const winnerOpponentLedger = winnerState.opponentStats?.find((entry) => entry.opponentPlayerId === input.loser.playerId);
  if ((winnerOpponentLedger?.matchCount ?? 0) >= LEADERBOARD_REPEATED_OPPONENT_ALERT_THRESHOLD) {
    winnerState = pushAlertReason(winnerState, settledAt, "repeated_opponent_watch", "watch");
    alerts.push({
      type: "leaderboard_repeated_opponent_watch",
      playerId: input.winner.playerId,
      opponentPlayerId: input.loser.playerId,
      at: settledAt,
      detail:
        `Winner has played ${winnerOpponentLedger?.matchCount ?? 0} settled matches against the same opponent in the active window.`
    });
  }

  return {
    winnerRating: winnerRating + allowedGain,
    loserRating: loserRating - allowedGain,
    winnerAbuseState: winnerState,
    loserAbuseState: loserState,
    alerts,
    capped
  };
}
