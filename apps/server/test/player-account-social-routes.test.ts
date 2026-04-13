import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { issueGuestAuthSession } from "../src/auth";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { registerPlayerAccountRoutes } from "../src/player-accounts";

async function startServer(store: MemoryRoomSnapshotStore, port: number): Promise<Server> {
  const transport = new WebSocketTransport();
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

test("social routes persist notification prefs and validate group challenge expiry", async (t) => {
  const store = new MemoryRoomSnapshotStore();
  await store.ensurePlayerAccount({ playerId: "player-7", displayName: "雾林司灯" });
  await store.ensurePlayerAccount({ playerId: "friend-1", displayName: "山岚旅人" });
  await store.savePlayerAccountProgress("friend-1", { eloRating: 1320 });
  await store.savePlayerAccountProgress("player-7", { eloRating: 1450 });
  const session = issueGuestAuthSession({
    playerId: "player-7",
    displayName: "雾林司灯"
  });

  const port = 42590 + Math.floor(Math.random() * 1000);
  const server = await startServer(store, port);
  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const prefsResponse = await fetch(`http://127.0.0.1:${port}/api/account/notification-prefs`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      matchFound: false,
      turnReminder: true
    })
  });
  const prefsPayload = (await prefsResponse.json()) as {
    notificationPreferences: { matchFound: boolean; turnReminder: boolean };
  };
  assert.equal(prefsResponse.status, 200);
  assert.equal(prefsPayload.notificationPreferences.matchFound, false);
  assert.equal((await store.loadPlayerAccount("player-7"))?.notificationPreferences?.matchFound, false);

  const pushRegisterResponse = await fetch(`http://127.0.0.1:${port}/api/players/me/push-token`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      platform: "ios",
      token: "apns-token-player-7"
    })
  });
  const pushRegisterPayload = (await pushRegisterResponse.json()) as {
    pushTokens: Array<{ platform: string; token: string }>;
  };
  assert.equal(pushRegisterResponse.status, 200);
  assert.equal(pushRegisterPayload.pushTokens.length, 1);
  assert.equal(pushRegisterPayload.pushTokens[0]?.platform, "ios");
  assert.equal(pushRegisterPayload.pushTokens[0]?.token, "apns-token-player-7");
  assert.deepEqual((await store.loadPlayerAccount("player-7"))?.pushTokens?.map((entry) => entry.token), [
    "apns-token-player-7"
  ]);

  const pushDeleteResponse = await fetch(`http://127.0.0.1:${port}/api/players/me/push-token`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      platform: "ios"
    })
  });
  const pushDeletePayload = (await pushDeleteResponse.json()) as {
    pushTokens: Array<{ platform: string; token: string }>;
  };
  assert.equal(pushDeleteResponse.status, 200);
  assert.deepEqual(pushDeletePayload.pushTokens, []);
  assert.equal((await store.loadPlayerAccount("player-7"))?.pushTokens, undefined);

  const leaderboardResponse = await fetch(
    `http://127.0.0.1:${port}/api/social/friend-leaderboard?friendIds=${encodeURIComponent("friend-1")}`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const leaderboardPayload = (await leaderboardResponse.json()) as {
    items: Array<{ playerId: string; rank: number }>;
  };
  assert.equal(leaderboardResponse.status, 200);
  assert.deepEqual(
    leaderboardPayload.items.map((item) => [item.rank, item.playerId]),
    [
      [1, "player-7"],
      [2, "friend-1"]
    ]
  );

  const createResponse = await fetch(`http://127.0.0.1:${port}/api/social/group-challenge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "create",
      roomId: "room-social",
      challengeType: "victory",
      scoreTarget: 2
    })
  });
  const createPayload = (await createResponse.json()) as { token: string };
  assert.equal(createResponse.status, 200);
  assert.match(createPayload.token, /\./);

  const redeemResponse = await fetch(`http://127.0.0.1:${port}/api/social/group-challenge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "redeem",
      token: `${createPayload.token}tampered`
    })
  });
  assert.equal(redeemResponse.status, 400);
});
