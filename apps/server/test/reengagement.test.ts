import assert from "node:assert/strict";
import test from "node:test";

import { flushAnalyticsEventsForTest, resetAnalyticsRuntimeDependencies } from "@server/domain/ops/analytics";
import { createMemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import {
  acknowledgeReengagementMailboxOpen,
  recordReengagementReturn,
  runReengagementSweep,
  type ReengagementPolicy
} from "@server/domain/ops/reengagement";

function seedLastSeenAt(store: ReturnType<typeof createMemoryRoomSnapshotStore>, playerId: string, lastSeenAt: string): void {
  const accounts = (store as unknown as { accounts: Map<string, Record<string, unknown>> }).accounts;
  const account = accounts.get(playerId);
  if (!account) {
    throw new Error(`missing seeded account ${playerId}`);
  }
  account.lastSeenAt = lastSeenAt;
  account.updatedAt = lastSeenAt;
}

test("runReengagementSweep delivers mailbox/push channels and emits sent-opened-returned analytics", async (t) => {
  resetAnalyticsRuntimeDependencies();
  const store = createMemoryRoomSnapshotStore();
  const now = new Date("2026-04-17T12:00:00.000Z");
  const policy: ReengagementPolicy = {
    id: "returning-24h",
    name: "Returning After 24 Hours",
    inactiveHours: 24,
    channels: ["mailbox", "wechat_subscribe", "mobile_push"],
    mailbox: {
      title: "前线重新集结",
      body: "回来继续你的今日目标。"
    },
    subscribe: {
      headline: "战线等你",
      chapterName: "今日主线"
    }
  };

  t.after(async () => {
    resetAnalyticsRuntimeDependencies();
    await store.close();
  });

  await store.ensurePlayerAccount({ playerId: "player-return", displayName: "Returner" });
  seedLastSeenAt(store, "player-return", "2026-04-15T06:00:00.000Z");

  const sweep = await runReengagementSweep(store, {
    now,
    policies: [policy],
    sendWechatSubscribeMessageImpl: async () => true,
    sendMobilePushNotificationImpl: async () => true
  });
  await flushAnalyticsEventsForTest();

  assert.equal(sweep.deliveries.length, 1);
  assert.deepEqual(sweep.deliveries[0]?.deliveredChannels, ["mailbox", "wechat_subscribe", "mobile_push"]);

  const afterSweep = await store.loadPlayerAccount("player-return");
  assert.ok(afterSweep?.mailbox?.[0]?.id.startsWith("reengagement:returning-24h:2026-04-17"));

  const openedAccount = await acknowledgeReengagementMailboxOpen(store, afterSweep!, "2026-04-17T12:05:00.000Z");
  await recordReengagementReturn(store, openedAccount, "2026-04-17T12:10:00.000Z");
  await flushAnalyticsEventsForTest();

  const auditLogs = await store.listAdminAuditLogs?.({ targetPlayerId: "player-return", limit: 20 });
  assert.equal(auditLogs?.some((entry) => entry.action === "reengagement_sent"), true);
  assert.equal(auditLogs?.some((entry) => entry.action === "reengagement_opened"), true);
  assert.equal(auditLogs?.some((entry) => entry.action === "reengagement_returned"), true);

  const reloaded = await store.loadPlayerAccount("player-return");
  assert.ok(reloaded?.mailbox?.[0]?.readAt);
});
