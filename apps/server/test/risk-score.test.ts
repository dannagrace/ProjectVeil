import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { buildRiskQueue, reviewRiskQueueEntry, scoreRiskState } from "@server/domain/ops/risk-score";

test("scoreRiskState prioritizes flagged status, alert reasons, and repeat opponents", () => {
  const score = scoreRiskState({
    status: "flagged",
    lastAlertReasons: ["重复对手异常", "Elo 波动异常"],
    dailyEloGain: 420,
    opponentStats: [{ opponentPlayerId: "opp-1", matchCount: 6, eloGain: 120, eloLoss: 0, lastPlayedAt: "2026-04-17T00:00:00.000Z" }]
  });
  assert.equal(score.score >= 70, true);
  assert.equal(score.reasons.length >= 3, true);
});

test("buildRiskQueue and reviewRiskQueueEntry cover warn, clear, and ban", async (t) => {
  const store = createMemoryRoomSnapshotStore();
  t.after(async () => {
    await store.close();
  });

  await store.ensurePlayerAccount({ playerId: "risk-player", displayName: "Risky" });
  await store.savePlayerAccountProgress("risk-player", {
    leaderboardAbuseState: {
      status: "flagged",
      lastAlertReasons: ["重复对手异常"],
      dailyEloGain: 420,
      opponentStats: [{ opponentPlayerId: "opp-1", matchCount: 6, eloGain: 120, eloLoss: 0, lastPlayedAt: "2026-04-17T00:00:00.000Z" }]
    }
  });

  const queue = await buildRiskQueue(store);
  assert.equal(queue[0]?.playerId, "risk-player");
  assert.equal(queue[0]?.reviewStatus, "pending");

  const warned = await reviewRiskQueueEntry(store, {
    playerId: "risk-player",
    action: "warn",
    reason: "近期 Elo 涨幅异常",
    actorPlayerId: "support-moderator:risk-review",
    actorRole: "support-moderator"
  });
  assert.equal(warned.leaderboardAbuseState?.status, "watch");

  const cleared = await reviewRiskQueueEntry(store, {
    playerId: "risk-player",
    action: "clear",
    reason: "复核后判定为正常行为",
    actorPlayerId: "support-moderator:risk-review",
    actorRole: "support-moderator"
  });
  assert.equal(cleared.leaderboardAbuseState?.status, "clear");

  const banned = await reviewRiskQueueEntry(store, {
    playerId: "risk-player",
    action: "ban",
    reason: "确认存在刷分行为",
    actorPlayerId: "admin:risk-review",
    actorRole: "admin",
    banStatus: "temporary",
    banExpiry: "2026-04-24T00:00:00.000Z"
  });
  assert.equal(banned.banStatus, "temporary");
});
