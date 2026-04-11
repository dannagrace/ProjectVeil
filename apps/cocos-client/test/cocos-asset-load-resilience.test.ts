import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  configureAssetLoadResilienceRuntimeDependencies,
  resetAssetLoadResilienceRuntimeForTests,
  retryAssetLoad,
  setAssetLoadFailureReporter,
  subscribeAssetLoadFailures
} from "../assets/scripts/cocos-asset-load-resilience.ts";

afterEach(() => {
  resetAssetLoadResilienceRuntimeForTests();
});

test("retryAssetLoad retries critical assets with exponential backoff and reports the final failure", async () => {
  const events: Array<{ retryCount: number; finalFailure: boolean; path: string }> = [];
  const delays: number[] = [];
  configureAssetLoadResilienceRuntimeDependencies({
    setTimeout: (handler, delayMs) => {
      delays.push(delayMs);
      handler();
      return { delayMs } as ReturnType<typeof globalThis.setTimeout>;
    },
    clearTimeout: () => {}
  });
  const unsubscribe = subscribeAssetLoadFailures((event) => {
    events.push({
      retryCount: event.retryCount,
      finalFailure: event.finalFailure,
      path: event.assetPath
    });
  });

  let attempts = 0;
  const result = await retryAssetLoad({
    assetType: "sprite",
    assetPath: "pixel/terrain/grass-1",
    critical: true,
    load: async () => {
      attempts += 1;
      throw new Error(`missing-${attempts}`);
    },
    fallback: async () => "placeholder-frame"
  });
  unsubscribe();

  assert.equal(result, "placeholder-frame");
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.deepEqual(events, [
    { retryCount: 0, finalFailure: false, path: "pixel/terrain/grass-1" },
    { retryCount: 1, finalFailure: false, path: "pixel/terrain/grass-1" },
    { retryCount: 2, finalFailure: false, path: "pixel/terrain/grass-1" },
    { retryCount: 3, finalFailure: true, path: "pixel/terrain/grass-1" }
  ]);
});

test("retryAssetLoad reports non-critical failures once without scheduling retries", async () => {
  const reported: Array<{ retryCount: number; finalFailure: boolean }> = [];
  setAssetLoadFailureReporter((event) => {
    reported.push({
      retryCount: event.retryCount,
      finalFailure: event.finalFailure
    });
  });

  let attempts = 0;
  const result = await retryAssetLoad({
    assetType: "audio",
    assetPath: "audio/hit",
    critical: false,
    load: async () => {
      attempts += 1;
      throw new Error("asset missing");
    }
  });

  assert.equal(result, null);
  assert.equal(attempts, 1);
  assert.deepEqual(reported, [{ retryCount: 0, finalFailure: true }]);
});
