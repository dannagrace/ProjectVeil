import assert from "node:assert/strict";
import test from "node:test";
import { ImageAsset, SpriteFrame, resources } from "cc";
import {
  getPixelSpriteAssets,
  getPixelSpriteLoadStatus,
  loadPixelSpriteAssets,
  resetPixelSpriteRuntimeForTests
} from "../assets/scripts/cocos-pixel-sprites.ts";
import { pixelSpriteManifest, resolvePixelSpritePreloadPaths } from "../assets/scripts/cocos-pixel-sprite-manifest.ts";

type PendingLoad = {
  path: string;
  callback: (err: Error | null, asset: ImageAsset) => void;
};

const originalLoad = resources.load;
const originalCreateWithImage = SpriteFrame.createWithImage;

function installFrameFactoryDouble(): void {
  SpriteFrame.createWithImage = ((imageAsset: ImageAsset) => {
    const frame = new SpriteFrame();
    frame.name = imageAsset.name;
    frame.texture = imageAsset;
    return frame;
  }) as typeof SpriteFrame.createWithImage;
}

function restoreCcDoubles(): void {
  resources.load = originalLoad;
  SpriteFrame.createWithImage = originalCreateWithImage;
  resetPixelSpriteRuntimeForTests();
}

test("loadPixelSpriteAssets tracks async boot loading and exposes loaded frames", async (t) => {
  const pendingLoads: PendingLoad[] = [];
  resources.load = ((path: string, _type: typeof ImageAsset, callback: PendingLoad["callback"]) => {
    pendingLoads.push({ path, callback });
  }) as typeof resources.load;
  installFrameFactoryDouble();
  t.after(restoreCcDoubles);

  const bootPaths = resolvePixelSpritePreloadPaths("boot");
  const loadPromise = loadPixelSpriteAssets("boot");

  assert.equal(getPixelSpriteAssets(), null);
  assert.deepEqual(
    pendingLoads.map((entry) => entry.path).sort(),
    [...bootPaths].sort()
  );

  const loadingStatus = getPixelSpriteLoadStatus();
  assert.equal(loadingStatus.phase, "loading");
  assert.deepEqual(loadingStatus.requestedGroups, ["boot"]);
  assert.deepEqual(loadingStatus.pendingGroups, ["boot"]);
  assert.equal(loadingStatus.loadedResourceCount, 0);

  for (const { path, callback } of pendingLoads) {
    const asset = new ImageAsset();
    asset.name = path;
    callback(null, asset);
  }

  const assets = await loadPromise;
  assert.equal(assets.icons.hud?.name, pixelSpriteManifest.icons.hud);
  assert.equal((assets.icons.hud?.texture as ImageAsset | undefined)?.name, pixelSpriteManifest.icons.hud);

  const readyStatus = getPixelSpriteLoadStatus();
  assert.equal(readyStatus.phase, "ready");
  assert.deepEqual(readyStatus.loadedGroups, ["boot"]);
  assert.deepEqual(readyStatus.pendingGroups, []);
  assert.equal(readyStatus.loadedResourceCount, bootPaths.length);
});

test("loadPixelSpriteAssets reuses inflight and cached boot loads", async (t) => {
  const pendingLoads = new Map<string, PendingLoad["callback"]>();
  let loadCallCount = 0;
  resources.load = ((path: string, _type: typeof ImageAsset, callback: PendingLoad["callback"]) => {
    loadCallCount += 1;
    pendingLoads.set(path, callback);
  }) as typeof resources.load;
  installFrameFactoryDouble();
  t.after(restoreCcDoubles);

  const bootPaths = resolvePixelSpritePreloadPaths("boot");

  const firstLoad = loadPixelSpriteAssets("boot");
  const secondLoad = loadPixelSpriteAssets("boot");

  assert.equal(loadCallCount, bootPaths.length);
  assert.deepEqual([...pendingLoads.keys()].sort(), [...bootPaths].sort());

  for (const [path, callback] of pendingLoads) {
    const asset = new ImageAsset();
    asset.name = path;
    callback(null, asset);
  }

  const [firstAssets, secondAssets] = await Promise.all([firstLoad, secondLoad]);
  assert.equal(firstAssets.icons.hud?.name, pixelSpriteManifest.icons.hud);
  assert.equal(secondAssets.icons.hud?.name, pixelSpriteManifest.icons.hud);

  await loadPixelSpriteAssets("boot");
  assert.equal(loadCallCount, bootPaths.length);
});

test("loadPixelSpriteAssets caches failed loads as null fallbacks", async (t) => {
  const failedPath = pixelSpriteManifest.icons.hud;
  let loadCallCount = 0;
  resources.load = ((path: string, _type: typeof ImageAsset, callback: PendingLoad["callback"]) => {
    loadCallCount += 1;
    if (path === failedPath) {
      callback(new Error("missing sprite"), new ImageAsset());
      return;
    }

    const asset = new ImageAsset();
    asset.name = path;
    callback(null, asset);
  }) as typeof resources.load;
  installFrameFactoryDouble();
  t.after(restoreCcDoubles);

  const bootPaths = resolvePixelSpritePreloadPaths("boot");

  const firstAssets = await loadPixelSpriteAssets("boot");
  assert.equal(firstAssets.icons.hud, null);
  assert.equal(getPixelSpriteAssets()?.icons.hud, null);

  const readyStatus = getPixelSpriteLoadStatus();
  assert.equal(readyStatus.phase, "ready");
  assert.equal(readyStatus.loadedResourceCount, bootPaths.length);

  await loadPixelSpriteAssets("boot");
  assert.equal(loadCallCount, bootPaths.length);
});
