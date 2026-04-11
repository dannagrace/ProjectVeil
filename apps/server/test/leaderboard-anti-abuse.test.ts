import assert from "node:assert/strict";
import test from "node:test";
import {
  LEADERBOARD_DAILY_ELO_GAIN_LIMIT,
  LEADERBOARD_REPEATED_OPPONENT_ALERT_THRESHOLD,
  LEADERBOARD_REPEATED_OPPONENT_ELO_GAIN_LIMIT,
  settleLeaderboardMatch
} from "../src/leaderboard-anti-abuse";

test("settleLeaderboardMatch caps winner gain at the daily ELO limit", () => {
  const result = settleLeaderboardMatch({
    winner: {
      playerId: "winner",
      eloRating: 1000,
      leaderboardAbuseState: {
        currentDay: "2026-04-11",
        dailyEloGain: LEADERBOARD_DAILY_ELO_GAIN_LIMIT - 2
      }
    },
    loser: {
      playerId: "loser",
      eloRating: 1000
    },
    settledAt: "2026-04-11T08:00:00.000Z"
  });

  assert.equal(result.winnerRating, 1002);
  assert.equal(result.loserRating, 998);
  assert.equal(result.capped, true);
  assert.equal(result.winnerAbuseState?.dailyEloGain, LEADERBOARD_DAILY_ELO_GAIN_LIMIT);
  assert.match(result.alerts[0]?.type ?? "", /daily_gain_cap/);
});

test("settleLeaderboardMatch caps winner gain from repeated opponent farming", () => {
  const result = settleLeaderboardMatch({
    winner: {
      playerId: "winner",
      eloRating: 1000,
      leaderboardAbuseState: {
        currentDay: "2026-04-11",
        dailyEloGain: 10,
        opponentStats: [
          {
            opponentPlayerId: "loser",
            matchCount: 2,
            eloGain: LEADERBOARD_REPEATED_OPPONENT_ELO_GAIN_LIMIT - 2,
            eloLoss: 0,
            lastPlayedAt: "2026-04-11T07:00:00.000Z"
          }
        ]
      }
    },
    loser: {
      playerId: "loser",
      eloRating: 1000
    },
    settledAt: "2026-04-11T08:00:00.000Z"
  });

  assert.equal(result.winnerRating, 1002);
  assert.equal(result.loserRating, 998);
  assert.equal(
    result.winnerAbuseState?.opponentStats?.find((entry) => entry.opponentPlayerId === "loser")?.eloGain,
    LEADERBOARD_REPEATED_OPPONENT_ELO_GAIN_LIMIT
  );
  assert.match(result.alerts[0]?.type ?? "", /repeated_opponent_gain_cap/);
});

test("settleLeaderboardMatch raises a repeated-opponent watch alert at the threshold", () => {
  const result = settleLeaderboardMatch({
    winner: {
      playerId: "winner",
      eloRating: 1000,
      leaderboardAbuseState: {
        currentDay: "2026-04-11",
        opponentStats: [
          {
            opponentPlayerId: "loser",
            matchCount: LEADERBOARD_REPEATED_OPPONENT_ALERT_THRESHOLD - 1,
            eloGain: 20,
            eloLoss: 0,
            lastPlayedAt: "2026-04-11T07:00:00.000Z"
          }
        ]
      }
    },
    loser: {
      playerId: "loser",
      eloRating: 1000
    },
    settledAt: "2026-04-11T08:00:00.000Z"
  });

  assert.equal(result.winnerAbuseState?.status, "watch");
  assert.equal(
    result.winnerAbuseState?.opponentStats?.find((entry) => entry.opponentPlayerId === "loser")?.matchCount,
    LEADERBOARD_REPEATED_OPPONENT_ALERT_THRESHOLD
  );
  assert.equal(result.alerts.some((alert) => alert.type === "leaderboard_repeated_opponent_watch"), true);
});

test("settleLeaderboardMatch skips rating changes when a frozen leaderboard account is involved", () => {
  const result = settleLeaderboardMatch({
    winner: {
      playerId: "winner",
      eloRating: 1000,
      leaderboardModerationState: {
        frozenAt: "2026-04-11T08:00:00.000Z",
        frozenByPlayerId: "support-moderator:admin-console"
      }
    },
    loser: {
      playerId: "loser",
      eloRating: 1000
    },
    settledAt: "2026-04-11T08:00:00.000Z"
  });

  assert.equal(result.winnerRating, 1000);
  assert.equal(result.loserRating, 1000);
  assert.equal(result.capped, true);
  assert.equal(result.alerts.some((alert) => alert.type === "leaderboard_frozen_player_match"), true);
});
