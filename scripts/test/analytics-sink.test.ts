import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  configureAnalyticsRuntimeDependencies,
  emitAnalyticsEvent,
  flushAnalyticsEventsForTest,
  getAnalyticsPipelineSnapshot,
  resetAnalyticsRuntimeDependencies
} from "@server/domain/ops/analytics";

afterEach(() => {
  resetAnalyticsRuntimeDependencies();
});

test("analytics pipeline flushes HTTP batches to the configured endpoint with the expected event schema", async () => {
  const deliveries: Array<{
    input: string;
    init?: RequestInit;
  }> = [];
  configureAnalyticsRuntimeDependencies({
    fetch: async (input, init) => {
      deliveries.push(init === undefined ? { input } : { input, init });
      return {
        ok: true,
        status: 202
      };
    },
    log: () => {}
  });

  const env = {
    ...process.env,
    ANALYTICS_SINK: "http",
    ANALYTICS_ENDPOINT: "https://analytics.projectveil.example/ingest"
  };

  emitAnalyticsEvent("session_start", {
    at: "2026-04-12T08:00:00.000Z",
    playerId: "player-http-1",
    source: "cocos-client",
    sessionId: "session-http-1",
    platform: "wechat",
    roomId: "room-http-1",
    payload: {
      roomId: "room-http-1",
      authMode: "guest",
      platform: "wechat"
    }
  }, env);

  emitAnalyticsEvent("client_runtime_error", {
    at: "2026-04-12T08:00:05.000Z",
    playerId: "player-http-1",
    source: "cocos-client",
    sessionId: "session-http-1",
    platform: "wechat",
    roomId: "room-http-1",
    payload: {
      errorCode: "session_disconnect",
      severity: "error",
      stage: "connection",
      recoverable: true,
      message: "Reconnect failed while restoring the room snapshot."
    }
  }, env);

  await flushAnalyticsEventsForTest(env);

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.input, "https://analytics.projectveil.example/ingest");
  assert.equal(deliveries[0]?.init?.method, "POST");
  assert.equal((deliveries[0]?.init?.headers as Record<string, string> | undefined)?.["Content-Type"], "application/json; charset=utf-8");

  const envelope = JSON.parse(String(deliveries[0]?.init?.body ?? "{}")) as {
    schemaVersion?: number;
    emittedAt?: string;
    events?: Array<Record<string, unknown>>;
  };
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(typeof envelope.emittedAt, "string");
  assert.equal(envelope.events?.length, 2);
  assert.deepEqual(envelope.events?.[0], {
    schemaVersion: 1,
    name: "session_start",
    version: 1,
    at: "2026-04-12T08:00:00.000Z",
    playerId: "player-http-1",
    source: "cocos-client",
    sessionId: "session-http-1",
    platform: "wechat",
    roomId: "room-http-1",
    payload: {
      roomId: "room-http-1",
      authMode: "guest",
      platform: "wechat"
    }
  });
  assert.deepEqual(envelope.events?.[1], {
    schemaVersion: 1,
    name: "client_runtime_error",
    version: 1,
    at: "2026-04-12T08:00:05.000Z",
    playerId: "player-http-1",
    source: "cocos-client",
    sessionId: "session-http-1",
    platform: "wechat",
    roomId: "room-http-1",
    payload: {
      errorCode: "session_disconnect",
      severity: "error",
      stage: "connection",
      recoverable: true,
      message: "Reconnect failed while restoring the room snapshot."
    }
  });

  const snapshot = await getAnalyticsPipelineSnapshot(env);
  assert.equal(snapshot.sink, "http");
  assert.equal(snapshot.delivery.ingestedEventsTotal, 2);
  assert.equal(snapshot.delivery.flushedEventsTotal, 2);
  assert.equal(snapshot.delivery.flushFailuresTotal, 0);
});

test("analytics pipeline warns and falls back to stdout when ANALYTICS_ENDPOINT is missing", async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  configureAnalyticsRuntimeDependencies({
    log: (message) => {
      logs.push(message);
    },
    error: (message) => {
      errors.push(message);
    }
  });

  const env = {
    ...process.env,
    ANALYTICS_SINK: "http"
  };

  emitAnalyticsEvent("client_runtime_error", {
    at: "2026-04-12T09:00:00.000Z",
    playerId: "player-stdout-1",
    source: "cocos-client",
    payload: {
      errorCode: "session_disconnect",
      severity: "error",
      stage: "connection",
      recoverable: true,
      message: "Reconnect failed while restoring the room snapshot."
    }
  }, env);

  await flushAnalyticsEventsForTest(env);

  const snapshot = await getAnalyticsPipelineSnapshot(env);
  assert.equal(snapshot.sink, "stdout");
  assert.match(snapshot.alerts[0] ?? "", /ANALYTICS_ENDPOINT/);
  assert.match(errors[0] ?? "", /\[Analytics\] ANALYTICS_SINK=http but ANALYTICS_ENDPOINT is not configured; falling back to stdout\./);
  assert.match(logs[0] ?? "", /^\[Analytics\] \{"schemaVersion":1,"emittedAt":"[^"]+","events":\[/);
});
