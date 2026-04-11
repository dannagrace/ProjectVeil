import assert from "node:assert/strict";
import test from "node:test";
import { ImageAsset, SpriteFrame, resources } from "cc";
import {
  configureAssetLoadResilienceRuntimeDependencies,
  resetAssetLoadResilienceRuntimeForTests
} from "../assets/scripts/cocos-asset-load-resilience.ts";
import { resetPlaceholderSpriteAssetsForTests } from "../assets/scripts/cocos-placeholder-sprites.ts";
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
  resetAssetLoadResilienceRuntimeForTests();
  resetPlaceholderSpriteAssetsForTests();
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

test("loadPixelSpriteAssets replaces failed non-critical sprites with placeholder frames", async (t) => {
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
  assert.equal(firstAssets.icons.hud?.name, "placeholder/icons/hud");
  assert.equal(getPixelSpriteAssets()?.icons.hud?.name, "placeholder/icons/hud");

  const readyStatus = getPixelSpriteLoadStatus();
  assert.equal(readyStatus.phase, "ready");
  assert.equal(readyStatus.loadedResourceCount, bootPaths.length);

  await loadPixelSpriteAssets("boot");
  assert.equal(loadCallCount, bootPaths.length + 2);
});

test("loadPixelSpriteAssets retries critical sprite loads before falling back to placeholders", async (t) => {
  const failedPath = pixelSpriteManifest.tiles.grass[0]!;
  const attempts = new Map<string, number>();
  const retryDelays: number[] = [];
  configureAssetLoadResilienceRuntimeDependencies({
    setTimeout: (handler, delayMs) => {
      retryDelays.push(delayMs);
      handler();
      return { delayMs } as ReturnType<typeof globalThis.setTimeout>;
    },
    clearTimeout: () => {}
  });
  resources.load = ((path: string, _type: typeof ImageAsset, callback: PendingLoad["callback"]) => {
    const nextAttempt = (attempts.get(path) ?? 0) + 1;
    attempts.set(path, nextAttempt);
    if (path === failedPath && nextAttempt <= 4) {
      callback(new Error(`missing sprite ${nextAttempt}`), new ImageAsset());
      return;
    }

    const asset = new ImageAsset();
    asset.name = path;
    callback(null, asset);
  }) as typeof resources.load;
  installFrameFactoryDouble();
  t.after(restoreCcDoubles);

  const assets = await loadPixelSpriteAssets("boot");

  assert.equal(attempts.get(failedPath), 4);
  assert.deepEqual(retryDelays, [1000, 2000, 4000]);
  assert.equal((assets.tiles.grass[0]?.texture as ImageAsset | undefined)?.name, "placeholder/tiles/grass-1");
});
