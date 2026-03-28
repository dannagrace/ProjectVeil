import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCocosWechatMiniGameScaffoldConfig,
  type CocosWechatMiniGameScaffoldConfig
} from "../assets/scripts/cocos-wechat-minigame-scaffold.ts";

function createValidConfig(): CocosWechatMiniGameScaffoldConfig {
  return {
    platform: "wechat-game",
    creatorVersion: "3.8.8",
    appId: "wx1234567890",
    envVersion: "develop",
    mainPackageBudgetMB: 3.5,
    preloadBundles: ["resources", "main"],
    remoteBundles: ["world-art", "battle-fx"],
    assetCdnBaseUrl: "https://assets.example.com/project-veil/wechat",
    loginExchangePath: "/api/auth/wechat-mini-game-login",
    socketDomains: ["wss://veil.example.com"],
    requestDomains: ["https://veil.example.com", "https://assets.example.com"],
    notes: "Scaffold only. Real code2Session, bundling, and performance work still pending."
  };
}

test("validateCocosWechatMiniGameScaffoldConfig accepts the checked-in scaffold shape", () => {
  assert.deepEqual(validateCocosWechatMiniGameScaffoldConfig(createValidConfig()), []);
});

test("validateCocosWechatMiniGameScaffoldConfig rejects bundle overlap and non-HTTPS safety domains", () => {
  const issues = validateCocosWechatMiniGameScaffoldConfig({
    ...createValidConfig(),
    preloadBundles: ["resources", "world-art"],
    remoteBundles: ["world-art"],
    assetCdnBaseUrl: "http://assets.example.com/project-veil/wechat",
    socketDomains: ["ws://veil.example.com"],
    requestDomains: ["http://veil.example.com"]
  });

  assert.equal(issues.some((issue) => issue.code === "bundle_overlap"), true);
  assert.equal(issues.some((issue) => issue.code === "invalid_asset_cdn_base_url"), true);
  assert.equal(issues.some((issue) => issue.code === "invalid_socket_domains"), true);
  assert.equal(issues.some((issue) => issue.code === "invalid_request_domains"), true);
});

test("validateCocosWechatMiniGameScaffoldConfig warns on placeholder appId and missing notes", () => {
  const issues = validateCocosWechatMiniGameScaffoldConfig({
    ...createValidConfig(),
    appId: "wx-your-app-id",
    notes: ""
  });

  assert.equal(issues.some((issue) => issue.code === "placeholder_app_id"), true);
  assert.equal(issues.some((issue) => issue.code === "notes_missing"), true);
});
