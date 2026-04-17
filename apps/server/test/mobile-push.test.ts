import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { sendMobilePushNotification } from "../src/adapters/mobile-push";

test("sendMobilePushNotification fans out to APNs and FCM for registered devices", async () => {
  const store = new MemoryRoomSnapshotStore();
  await store.ensurePlayerAccount({ playerId: "player-1", displayName: "Player One" });
  await store.savePlayerAccountProfile("player-1", {
    pushTokens: [
      {
        platform: "ios",
        token: "apns-token-1",
        registeredAt: "2026-04-13T01:46:00.000Z",
        updatedAt: "2026-04-13T01:46:00.000Z"
      },
      {
        platform: "android",
        token: "fcm-token-1",
        registeredAt: "2026-04-13T01:46:00.000Z",
        updatedAt: "2026-04-13T01:46:00.000Z"
      }
    ]
  });

  const deliveries: Array<{ platform: string; title: string; body: string; roomId?: string }> = [];
  const sent = await sendMobilePushNotification(
    "player-1",
    "match_found",
    {
      mapName: "Phase1",
      opponentName: "Player Two",
      roomId: "pvp-match-1"
    },
    {
      store,
      env: {
        VEIL_APNS_KEY_ID: "kid",
        VEIL_APNS_TEAM_ID: "team",
        VEIL_APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----",
        VEIL_APNS_TOPIC: "com.projectveil.app",
        VEIL_FCM_SERVER_KEY: "server-key"
      },
      sendApnsImpl: async (registration, message) => {
        deliveries.push({ platform: registration.platform, title: message.title, body: message.body, roomId: message.data.roomId });
        return "sent";
      },
      sendFcmImpl: async (registration, message) => {
        deliveries.push({ platform: registration.platform, title: message.title, body: message.body, roomId: message.data.roomId });
        return "sent";
      }
    }
  );

  assert.equal(sent, true);
  assert.deepEqual(
    deliveries.sort((left, right) => left.platform.localeCompare(right.platform)),
    [
      {
        platform: "android",
        title: "Match Found",
        body: "Player Two is ready on Phase1.",
        roomId: "pvp-match-1"
      },
      {
        platform: "ios",
        title: "Match Found",
        body: "Player Two is ready on Phase1.",
        roomId: "pvp-match-1"
      }
    ]
  );
});

test("sendMobilePushNotification prunes invalid registrations returned by providers", async () => {
  const store = new MemoryRoomSnapshotStore();
  await store.ensurePlayerAccount({ playerId: "player-2", displayName: "Player Two" });
  await store.savePlayerAccountProfile("player-2", {
    pushTokens: [
      {
        platform: "android",
        token: "fcm-invalid",
        registeredAt: "2026-04-13T01:46:00.000Z",
        updatedAt: "2026-04-13T01:46:00.000Z"
      }
    ]
  });

  const sent = await sendMobilePushNotification(
    "player-2",
    "turn_reminder",
    {
      roomId: "room-2",
      turnNumber: 4
    },
    {
      store,
      env: {
        VEIL_FCM_SERVER_KEY: "server-key"
      },
      sendFcmImpl: async () => "invalid_token"
    }
  );

  assert.equal(sent, false);
  assert.equal((await store.loadPlayerAccount("player-2"))?.pushTokens, undefined);
});
