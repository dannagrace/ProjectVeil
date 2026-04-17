import assert from "node:assert/strict";
import test from "node:test";

import {
  loadCocosWechatHotfixManifest,
  resolveCocosWechatHotfixAssetUrl,
  resolveCocosWechatHotfixManifestUrl,
  resolveCocosWechatHotfixRuntimeConfig,
  type CocosWechatHotfixManifest
} from "../assets/scripts/cocos-wechat-hotfix.ts";

test("resolveCocosWechatHotfixRuntimeConfig reads runtime config and prefers explicit manifest URL", () => {
  const config = resolveCocosWechatHotfixRuntimeConfig({
    __PROJECT_VEIL_RUNTIME_CONFIG__: {
      wechatMiniGame: {
        remoteAssetRoot: "https://cdn.example.com/assets",
        hotfixManifestUrl: "https://cdn.example.com/assets/current/codex.wechat.hotfix-manifest.json",
        hotfixVersion: "phase1"
      }
    }
  });

  assert.equal(config.remoteAssetRoot, "https://cdn.example.com/assets");
  assert.equal(config.manifestUrl, "https://cdn.example.com/assets/current/codex.wechat.hotfix-manifest.json");
  assert.equal(config.currentVersion, "phase1");
  assert.equal(
    resolveCocosWechatHotfixManifestUrl(config),
    "https://cdn.example.com/assets/current/codex.wechat.hotfix-manifest.json"
  );
});

test("resolveCocosWechatHotfixManifestUrl falls back to remoteAssetRoot and currentVersion", () => {
  assert.equal(
    resolveCocosWechatHotfixManifestUrl({
      remoteAssetRoot: "https://cdn.example.com/assets",
      currentVersion: "phase1"
    }),
    "https://cdn.example.com/assets/phase1/codex.wechat.hotfix-manifest.json"
  );
});

test("resolveCocosWechatHotfixAssetUrl finds changed asset URLs from the manifest", () => {
  const manifest: CocosWechatHotfixManifest = {
    schemaVersion: 1,
    buildTemplatePlatform: "wechatgame",
    generatedAt: "2026-04-17T00:00:00.000Z",
    version: "phase1",
    sourceRevision: "abc1234",
    remoteAssetRoot: "https://cdn.example.com/assets",
    manifestUrl: "https://cdn.example.com/assets/phase1/codex.wechat.hotfix-manifest.json",
    changedFiles: [
      {
        path: "pixel/icons/hud.png",
        sha256: "a".repeat(64),
        bytes: 512,
        url: "https://cdn.example.com/assets/phase1/pixel/icons/hud.png"
      }
    ],
    changedSubpackages: [],
    totalChangedBytes: 512
  };

  assert.equal(
    resolveCocosWechatHotfixAssetUrl(manifest, "pixel/icons/hud.png"),
    "https://cdn.example.com/assets/phase1/pixel/icons/hud.png"
  );
  assert.equal(resolveCocosWechatHotfixAssetUrl(manifest, "pixel/icons/missing.png"), null);
});

test("loadCocosWechatHotfixManifest fetches and parses the runtime manifest", async () => {
  const manifest: CocosWechatHotfixManifest = {
    schemaVersion: 1,
    buildTemplatePlatform: "wechatgame",
    generatedAt: "2026-04-17T00:00:00.000Z",
    version: "phase1",
    sourceRevision: "abc1234",
    remoteAssetRoot: "https://cdn.example.com/assets",
    manifestUrl: "https://cdn.example.com/assets/phase1/codex.wechat.hotfix-manifest.json",
    changedFiles: [],
    changedSubpackages: [],
    totalChangedBytes: 0
  };

  let requestedUrl: string | null = null;
  const loaded = await loadCocosWechatHotfixManifest(
    (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch,
    { remoteAssetRoot: "https://cdn.example.com/assets", currentVersion: "phase1" }
  );

  assert.equal(requestedUrl, "https://cdn.example.com/assets/phase1/codex.wechat.hotfix-manifest.json");
  assert.equal(loaded?.version, "phase1");
});
