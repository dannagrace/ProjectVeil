import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmCocosAccountRegistration,
  loginCocosGuestAuthSession,
  loginCocosPasswordAuthSession,
  loginCocosWechatAuthSession
} from "../assets/scripts/cocos-lobby.ts";

test("cocos auth helpers forward privacy consent across guest, account, registration, and wechat flows", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  let callIndex = 0;

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: String(init?.body ?? "")
    });
    callIndex += 1;

    if (callIndex === 4) {
      return new Response(
        JSON.stringify({
          session: {
            token: "wechat.token",
            playerId: "wechat-player",
            displayName: "雾桥旅人",
            authMode: "guest",
            provider: "wechat-mini-game"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        account: {
          playerId: "account-player",
          displayName: "雾桥旅人",
          loginId: "veil-ranger"
        },
        session: {
          token: "account.token",
          playerId: "account-player",
          displayName: "雾桥旅人",
          authMode: "account",
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
  };

  await loginCocosGuestAuthSession("http://127.0.0.1:2567", "guest-privacy", "雾桥旅人", {
    fetchImpl,
    privacyConsentAccepted: true
  });
  await loginCocosPasswordAuthSession("http://127.0.0.1:2567", "Veil-Ranger", "hunter2", {
    fetchImpl,
    privacyConsentAccepted: true
  });
  await confirmCocosAccountRegistration("http://127.0.0.1:2567", "Veil-Ranger", "dev-registration-token", "hunter2", {
    fetchImpl,
    privacyConsentAccepted: true
  });
  await loginCocosWechatAuthSession("http://127.0.0.1:2567", "wechat-player", "雾桥旅人", {
    fetchImpl,
    privacyConsentAccepted: true,
    wx: {
      login: ({ success }) => {
        success?.({ code: "wx-dev-code" });
      }
    }
  });

  assert.equal(requests.length, 4);
  assert.match(requests[0]?.body ?? "", /"privacyConsentAccepted":true/);
  assert.match(requests[1]?.body ?? "", /"privacyConsentAccepted":true/);
  assert.match(requests[2]?.body ?? "", /"privacyConsentAccepted":true/);
  assert.match(requests[3]?.body ?? "", /"privacyConsentAccepted":true/);
});
