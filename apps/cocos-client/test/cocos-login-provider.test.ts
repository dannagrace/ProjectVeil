import assert from "node:assert/strict";
import test from "node:test";
import {
  loginWithCocosProvider,
  resolveCocosLoginProviders,
  resolveCocosLoginRuntimeConfig
} from "../assets/scripts/cocos-login-provider.ts";
import { resolveCocosRuntimeCapabilities } from "../assets/scripts/cocos-runtime-platform.ts";

test("resolveCocosLoginRuntimeConfig reads runtime overrides and keeps the default exchange path", () => {
  assert.deepEqual(
    resolveCocosLoginRuntimeConfig({
      __PROJECT_VEIL_RUNTIME_CONFIG__: {
        wechatMiniGame: {
          enabled: true,
          mockCode: "wx-dev-code",
          appId: "wx123"
        }
      }
    }),
    {
      wechatMiniGame: {
        enabled: true,
        appId: "wx123",
        exchangePath: "/api/auth/wechat-login",
        mockCode: "wx-dev-code"
      }
    }
  );
});

test("resolveCocosLoginProviders promotes wechat login in mini game runtime when wx.login is available", () => {
  const providers = resolveCocosLoginProviders({
    platform: "wechat-game",
    capabilities: resolveCocosRuntimeCapabilities("wechat-game"),
    config: {
      wechatMiniGame: {
        enabled: true,
        exchangePath: "/api/auth/wechat-login"
      }
    },
    wx: {
      login: () => undefined
    }
  });

  assert.equal(providers.find((provider) => provider.id === "wechat-mini-game")?.available, true);
  assert.equal(providers.find((provider) => provider.id === "account-password")?.available, false);
});

test("loginWithCocosProvider sends wx.login code to the scaffold exchange endpoint", async () => {
  let requestedUrl = "";
  let requestedBody = "";
  const session = await loginWithCocosProvider(
    "http://127.0.0.1:2567",
    {
      provider: "wechat-mini-game",
      playerId: "guest-mini",
      displayName: "雾海旅人"
    },
    {
      wx: {
        login: ({ success }) => {
          success?.({ code: "wx-code-123" });
        }
      },
      config: {
        wechatMiniGame: {
          enabled: true,
          exchangePath: "/api/auth/wechat-login"
        }
      },
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            session: {
              token: "wechat.token",
              playerId: "guest-mini",
              displayName: "雾海旅人",
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
    }
  );

  assert.equal(requestedUrl, "http://127.0.0.1:2567/api/auth/wechat-login");
  assert.match(requestedBody, /"code":"wx-code-123"/);
  assert.deepEqual(session, {
    token: "wechat.token",
    playerId: "guest-mini",
    displayName: "雾海旅人",
    authMode: "guest",
    provider: "wechat-mini-game",
    source: "remote"
  });
});

test("resolveCocosLoginProviders hides wechat login when wx.login is unavailable", () => {
  const providers = resolveCocosLoginProviders({
    platform: "wechat-game",
    capabilities: resolveCocosRuntimeCapabilities("wechat-game"),
    config: {
      wechatMiniGame: {
        enabled: true,
        exchangePath: "/api/auth/wechat-login",
        mockCode: "wx-dev-code"
      }
    },
    wx: {}
  });

  assert.equal(providers.find((provider) => provider.id === "wechat-mini-game")?.available, false);
  assert.equal(providers.find((provider) => provider.id === "wechat-mini-game")?.label, "微信登录");
});
