import assert from "node:assert/strict";
import test from "node:test";
import {
  detectCocosRuntimePlatform,
  readCocosRuntimeLaunchSearch,
  resolveCocosRuntimeCapabilities,
  serializeCocosLaunchQuery
} from "../assets/scripts/cocos-runtime-platform.ts";

test("detectCocosRuntimePlatform prefers 微信小游戏 when wx launch options are available", () => {
  assert.equal(
    detectCocosRuntimePlatform({
      location: {
        search: "?roomId=browser-room",
        href: "https://veil.example.com/preview/index.html?roomId=browser-room"
      },
      wx: {
        getLaunchOptionsSync: () => ({
          query: {
            roomId: "wx-room"
          }
        })
      }
    }),
    "wechat-game"
  );
});

test("serializeCocosLaunchQuery keeps supported scalar values and ignores blank entries", () => {
  assert.equal(
    serializeCocosLaunchQuery({
      roomId: " crystal-hall ",
      playerId: "guest-123456",
      debug: true,
      retries: 2,
      empty: "   ",
      unsupported: { nested: true }
    }),
    "?roomId=crystal-hall&playerId=guest-123456&debug=true&retries=2"
  );
});

test("readCocosRuntimeLaunchSearch converts 微信小游戏 launch query into URLSearchParams format", () => {
  assert.equal(
    readCocosRuntimeLaunchSearch({
      wx: {
        getLaunchOptionsSync: () => ({
          query: {
            roomId: "crystal-hall",
            playerId: "guest-888888",
            displayName: "晶塔旅人"
          }
        })
      }
    }),
    "?roomId=crystal-hall&playerId=guest-888888&displayName=%E6%99%B6%E5%A1%94%E6%97%85%E4%BA%BA"
  );
});

test("resolveCocosRuntimeCapabilities marks 微信小游戏 config center access as manual-link", () => {
  assert.deepEqual(resolveCocosRuntimeCapabilities("wechat-game"), {
    platform: "wechat-game",
    authFlow: "wechat-session-bridge",
    configCenterAccess: "manual-link",
    launchQuerySource: "wechat-launch-options",
    supportsBrowserHistory: false,
    supportsWechatLogin: true
  });
});
