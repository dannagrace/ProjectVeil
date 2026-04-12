import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { issueAccountAuthSession } from "../src/auth";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { registerPlayerAccountRoutes } from "../src/player-accounts";

async function startAccountRouteServer(port: number, store: MemoryRoomSnapshotStore): Promise<Server> {
  const transport = new WebSocketTransport();
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

function createReplaySummary(id: string, createdAt: string) {
  return {
    id,
    battleId: `battle-${id}`,
    roomId: "room-delete",
    createdAt,
    participants: [],
    result: "victory" as const,
    rewardSummary: []
  };
}

test("delete route removes dependent account state and revokes the session", async (t) => {
  const port = 46000 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.ensurePlayerAccount({
    playerId: "player-delete",
    displayName: "雾海旅人",
    privacyConsentAt: "2026-03-27T12:00:00.000Z"
  });
  await store.bindPlayerAccountCredentials("player-delete", {
    loginId: "delete-ranger",
    passwordHash: "hashed-password"
  });
  await store.bindPlayerAccountWechatMiniGameIdentity("player-delete", {
    openId: "wx-delete-openid",
    displayName: "雾海旅人"
  });
  await store.savePlayerAccountProgress("player-delete", {
    recentEventLog: [
      {
        id: "delete-event-1",
        timestamp: "2026-03-27T12:01:00.000Z",
        roomId: "room-delete",
        playerId: "player-delete",
        category: "combat",
        description: "完成一场遭遇战",
        rewards: []
      }
    ],
    recentBattleReplays: [createReplaySummary("delete-replay-1", "2026-03-27T12:02:00.000Z")],
    mailbox: [
      {
        id: "mail-delete-1",
        kind: "compensation",
        title: "Delete me",
        body: "Delete me",
        sentAt: "2026-03-27T12:03:00.000Z",
        claimedAt: undefined,
        expiresAt: undefined,
        rewards: {
          gems: 5,
          resources: { gold: 10, wood: 0, ore: 0 },
          equipmentIds: [],
          cosmeticIds: []
        }
      }
    ],
    eloRating: 1650,
    rankDivision: "platinum_i"
  });

  const server = await startAccountRouteServer(port, store);
  const session = issueAccountAuthSession({
    playerId: "player-delete",
    displayName: "雾海旅人",
    loginId: "delete-ranger",
    sessionVersion: 0
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/players/me/delete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const deletePayload = (await deleteResponse.json()) as {
    ok: boolean;
    deleted: { playerId: string; displayName: string };
  };

  assert.equal(deleteResponse.status, 200);
  assert.equal(deletePayload.ok, true);
  assert.equal(deletePayload.deleted.playerId, "player-delete");
  assert.match(deletePayload.deleted.displayName, /^deleted-player-delete/);

  const deletedAccount = await store.loadPlayerAccount("player-delete");
  assert.equal(deletedAccount?.loginId, undefined);
  assert.equal(deletedAccount?.privacyConsentAt, undefined);
  assert.equal(deletedAccount?.wechatMiniGameOpenId, undefined);
  assert.deepEqual(deletedAccount?.recentBattleReplays, []);
  assert.deepEqual(deletedAccount?.recentEventLog, []);
  assert.equal(deletedAccount?.mailbox, undefined);
  assert.equal(deletedAccount?.eloRating, undefined);
  assert.equal(deletedAccount?.leaderboardModerationState?.hiddenByPlayerId, "system:gdpr-delete");

  const reloginOpenId = await store.loadPlayerAccountByWechatMiniGameOpenId("wx-delete-openid");
  assert.equal(reloginOpenId, null);

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as {
    error: { code: string };
  };
  assert.equal(meResponse.status, 401);
  assert.equal(mePayload.error.code, "session_revoked");
});

test("delete route returns 500 when cascade verification fails", async (t) => {
  const port = 47000 + Math.floor(Math.random() * 1000);

  class FailingDeleteStore extends MemoryRoomSnapshotStore {
    override async deletePlayerAccount() {
      throw new Error("gdpr_delete_verification_failed:guild_memberships");
    }
  }

  const store = new FailingDeleteStore();
  await store.ensurePlayerAccount({
    playerId: "player-delete-fail",
    displayName: "雾海旅人",
    privacyConsentAt: "2026-03-27T12:00:00.000Z"
  });
  await store.bindPlayerAccountCredentials("player-delete-fail", {
    loginId: "delete-ranger-fail",
    passwordHash: "hashed-password"
  });

  const server = await startAccountRouteServer(port, store);
  const session = issueAccountAuthSession({
    playerId: "player-delete-fail",
    displayName: "雾海旅人",
    loginId: "delete-ranger-fail",
    sessionVersion: 0
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/players/me/delete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const deletePayload = (await deleteResponse.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(deleteResponse.status, 500);
  assert.equal(deletePayload.error.code, "Error");
  assert.equal(deletePayload.error.message, "gdpr_delete_verification_failed:guild_memberships");
});
