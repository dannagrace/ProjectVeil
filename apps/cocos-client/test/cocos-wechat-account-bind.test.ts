import assert from "node:assert/strict";
import test from "node:test";
import { loginCocosWechatAuthSession } from "../assets/scripts/cocos-lobby.ts";

test("cocos wechat auth helper forwards minor-protection age declaration when binding identity", async () => {
  let requestedBody = "";

  await loginCocosWechatAuthSession("http://127.0.0.1:2567", "wechat-player", "雾桥旅人", {
    fetchImpl: async (_input, init) => {
      requestedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          session: {
            token: "wechat.token",
            playerId: "wechat-player",
            displayName: "雾桥旅人",
            authMode: "account",
            provider: "wechat-mini-game",
            loginId: "veil-ranger"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    },
    authToken: "account.token",
    privacyConsentAccepted: true,
    minorProtection: {
      isAdult: false
    },
    wx: {
      login: ({ success }) => {
        success?.({ code: "wx-dev-code" });
      }
    }
  });

  assert.match(requestedBody, /"privacyConsentAccepted":true/);
  assert.match(requestedBody, /"isAdult":false/);
});
