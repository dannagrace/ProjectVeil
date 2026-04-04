import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import {
  resetWechatSubscribeRuntimeForTests,
  sendWechatSubscribeMessage
} from "../src/wechat-subscribe";

test("sendWechatSubscribeMessage constructs the expected POST body", async () => {
  resetWechatSubscribeRuntimeForTests();
  const store = new MemoryRoomSnapshotStore();
  await store.bindPlayerAccountWechatMiniGameIdentity("player-1", {
    openId: "wx-open-id-1",
    displayName: "Player One"
  });

  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const sent = await sendWechatSubscribeMessage(
    "player-1",
    "match_found",
    {
      mapName: "Frontier Basin",
      opponentName: "Player Two"
    },
    {
      store,
      env: {
        WECHAT_APP_ID: "wx-app-id",
        WECHAT_APP_SECRET: "wx-app-secret",
        VEIL_WECHAT_MATCH_FOUND_TMPL_ID: "tmpl-match-found",
        VEIL_WECHAT_TURN_REMINDER_TMPL_ID: "tmpl-turn-reminder",
        VEIL_WECHAT_SUBSCRIBE_ACCESS_TOKEN_URL: "https://wechat.example.com/token",
        VEIL_WECHAT_SUBSCRIBE_SEND_URL: "https://wechat.example.com/send"
      },
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : undefined
        });
        if (String(input).startsWith("https://wechat.example.com/token")) {
          return new Response(JSON.stringify({ access_token: "access-token-1", expires_in: 7200 }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  );

  assert.equal(sent, true);
  assert.equal(requests.length, 2);
  assert.match(requests[0]!.url, /grant_type=client_credential/);
  assert.match(requests[1]!.url, /access_token=access-token-1/);
  assert.deepEqual(JSON.parse(requests[1]!.body ?? "{}"), {
    touser: "wx-open-id-1",
    template_id: "tmpl-match-found",
    data: {
      mapName: { value: "Frontier Basin" },
      opponentName: { value: "Player Two" }
    }
  });
});

test("sendWechatSubscribeMessage logs API errors and resolves without throwing", async () => {
  resetWechatSubscribeRuntimeForTests();
  const store = new MemoryRoomSnapshotStore();
  await store.bindPlayerAccountWechatMiniGameIdentity("player-2", {
    openId: "wx-open-id-2",
    displayName: "Player Two"
  });

  const errors: Array<{ message: string; details?: unknown }> = [];
  const sent = await sendWechatSubscribeMessage(
    "player-2",
    "turn_reminder",
    {
      roomId: "pvp-match-9",
      turnNumber: 3
    },
    {
      store,
      logger: {
        error(message, details) {
          errors.push({ message, details });
        }
      },
      env: {
        WECHAT_APP_ID: "wx-app-id",
        WECHAT_APP_SECRET: "wx-app-secret",
        VEIL_WECHAT_MATCH_FOUND_TMPL_ID: "tmpl-match-found",
        VEIL_WECHAT_TURN_REMINDER_TMPL_ID: "tmpl-turn-reminder",
        VEIL_WECHAT_SUBSCRIBE_ACCESS_TOKEN_URL: "https://wechat.example.com/token",
        VEIL_WECHAT_SUBSCRIBE_SEND_URL: "https://wechat.example.com/send"
      },
      fetchImpl: async (input) => {
        if (String(input).startsWith("https://wechat.example.com/token")) {
          return new Response(JSON.stringify({ access_token: "access-token-2", expires_in: 7200 }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ errcode: 43101, errmsg: "user refuse to accept the msg" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  );

  assert.equal(sent, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /Failed to send WeChat subscribe message/);
});
