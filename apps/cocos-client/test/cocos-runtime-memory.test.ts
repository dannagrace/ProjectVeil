import assert from "node:assert/strict";
import test from "node:test";
import {
  bindCocosRuntimeMemoryWarning,
  formatCocosRuntimeMemoryStatus,
  readCocosRuntimeMemorySnapshot,
  triggerCocosRuntimeGc
} from "../assets/scripts/cocos-runtime-memory.ts";

test("readCocosRuntimeMemorySnapshot prefers 微信小游戏 performance memory when available", () => {
  const snapshot = readCocosRuntimeMemorySnapshot({
    performance: {
      memory: {
        usedJSHeapSize: 10,
        totalJSHeapSize: 20,
        jsHeapSizeLimit: 30
      }
    },
    wx: {
      getPerformance: () => ({
        memory: {
          usedJSHeapSize: 100,
          totalJSHeapSize: 150,
          jsHeapSizeLimit: 200
        }
      }),
      triggerGC: () => undefined,
      onMemoryWarning: () => undefined
    }
  });

  assert.deepEqual(snapshot, {
    source: "wechat-performance",
    heapUsedBytes: 100,
    heapTotalBytes: 150,
    heapLimitBytes: 200,
    canTriggerGc: true,
    canListenMemoryWarning: true
  });
});

test("formatCocosRuntimeMemoryStatus summarizes pressure and retained asset scopes", () => {
  const status = formatCocosRuntimeMemoryStatus(
    {
      source: "wechat-performance",
      heapUsedBytes: 180 * 1024 * 1024,
      heapTotalBytes: 200 * 1024 * 1024,
      heapLimitBytes: 220 * 1024 * 1024,
      canTriggerGc: true,
      canListenMemoryWarning: true
    },
    {
      retainedScopes: ["map", "hud"],
      loadedPaths: ["a", "b", "c"],
      retainedPaths: ["a", "b"]
    }
  );

  assert.match(status, /180\.0MB/);
  assert.match(status, /220\.0MB/);
  assert.match(status, /偏高/);
  assert.match(status, /资源 map\/hud/);
  assert.match(status, /支持 GC/);
});

test("bindCocosRuntimeMemoryWarning wires and unwires the 微信小游戏 memory warning callback", () => {
  let boundHandler: ((payload?: { level?: number } | null) => void) | null = null;
  const events: Array<number | null> = [];

  const unsubscribe = bindCocosRuntimeMemoryWarning(
    (event) => {
      events.push(event.level);
    },
    {
      wx: {
        onMemoryWarning: (handler) => {
          boundHandler = handler;
        },
        offMemoryWarning: (handler) => {
          if (boundHandler === handler) {
            boundHandler = null;
          }
        }
      }
    }
  );

  boundHandler?.({ level: 10 });
  boundHandler?.({});
  assert.deepEqual(events, [10, null]);

  unsubscribe();
  assert.equal(boundHandler, null);
});

test("triggerCocosRuntimeGc reports whether the runtime exposes manual gc", () => {
  let triggered = 0;
  assert.equal(
    triggerCocosRuntimeGc({
      wx: {
        triggerGC: () => {
          triggered += 1;
        }
      }
    }),
    true
  );
  assert.equal(triggered, 1);
  assert.equal(triggerCocosRuntimeGc({}), false);
});
