import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_PERF_LOW_FPS_WINDOW_MS,
  CLIENT_PERF_THROTTLE_MS,
  createClientPerfTelemetryMonitorState,
  evaluateClientPerfTelemetry,
  readClientPerfRuntimeMetadata,
  recordClientPerfFrame
} from "../assets/scripts/cocos-client-perf-telemetry.ts";

test("evaluateClientPerfTelemetry emits after fps stays below threshold for 5 seconds", () => {
  const state = createClientPerfTelemetryMonitorState();

  for (let nowMs = 250; nowMs <= CLIENT_PERF_LOW_FPS_WINDOW_MS + 250; nowMs += 250) {
    recordClientPerfFrame(state, 0.06, nowMs);
  }

  const payload = evaluateClientPerfTelemetry(state, {
    nowMs: CLIENT_PERF_LOW_FPS_WINDOW_MS + 250,
    memoryUsageRatio: 0.55,
    metadata: {
      deviceModel: "Pixel 8",
      wechatVersion: "8.0.51"
    }
  });

  assert.deepEqual(payload, {
    reason: "fps",
    fpsAvg: 16.7,
    latencyMsAvg: 60,
    memoryUsageRatio: 0.55,
    deviceModel: "Pixel 8",
    wechatVersion: "8.0.51"
  });
});

test("evaluateClientPerfTelemetry emits immediately when memory usage crosses 80 percent and then throttles", () => {
  const state = createClientPerfTelemetryMonitorState();
  recordClientPerfFrame(state, 1 / 60, 1_000);

  const first = evaluateClientPerfTelemetry(state, {
    nowMs: 1_000,
    memoryUsageRatio: 0.83,
    metadata: {
      deviceModel: "iPhone 15",
      wechatVersion: "8.0.50"
    }
  });
  const throttled = evaluateClientPerfTelemetry(state, {
    nowMs: 1_000 + CLIENT_PERF_THROTTLE_MS - 1,
    memoryUsageRatio: 0.9,
    metadata: {
      deviceModel: "iPhone 15",
      wechatVersion: "8.0.50"
    }
  });
  recordClientPerfFrame(state, 1 / 60, 1_000 + CLIENT_PERF_THROTTLE_MS);
  const afterThrottle = evaluateClientPerfTelemetry(state, {
    nowMs: 1_000 + CLIENT_PERF_THROTTLE_MS,
    memoryUsageRatio: 0.9,
    metadata: {
      deviceModel: "iPhone 15",
      wechatVersion: "8.0.50"
    }
  });

  assert.equal(first?.reason, "memory");
  assert.equal(first?.memoryUsageRatio, 0.83);
  assert.equal(throttled, null);
  assert.equal(afterThrottle?.reason, "memory");
});

test("readClientPerfRuntimeMetadata reads WeChat device model and version with unknown fallback", () => {
  assert.deepEqual(
    readClientPerfRuntimeMetadata({
      wx: {
        getSystemInfoSync: () => ({
          model: "iPhone 13 Pro Max",
          version: "8.0.50"
        })
      }
    }),
    {
      deviceModel: "iPhone 13 Pro Max",
      wechatVersion: "8.0.50"
    }
  );

  assert.deepEqual(readClientPerfRuntimeMetadata({ wx: {} }), {
    deviceModel: "unknown",
    wechatVersion: "unknown"
  });
});
