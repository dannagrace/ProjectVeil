import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  captureServerError,
  configureErrorMonitoringRuntimeDependencies,
  isErrorMonitoringEnabled,
  resetErrorMonitoringRuntimeDependencies
} from "../src/error-monitoring";

afterEach(() => {
  resetErrorMonitoringRuntimeDependencies();
});

test("error monitoring stays disabled when SENTRY_DSN is empty", async () => {
  let fetchCalls = 0;
  configureErrorMonitoringRuntimeDependencies({
    fetch: async () => {
      fetchCalls += 1;
      return { ok: true, status: 202 };
    }
  });

  assert.equal(isErrorMonitoringEnabled({ ...process.env, SENTRY_DSN: "" }), false);
  await captureServerError(
    {
      errorCode: "uncaught_exception",
      message: "Uncaught exception in dev server",
      error: new Error("boom")
    },
    { ...process.env, SENTRY_DSN: "" }
  );

  assert.equal(fetchCalls, 0);
});

test("error monitoring posts a Sentry envelope with structured Project Veil context when enabled", async () => {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  configureErrorMonitoringRuntimeDependencies({
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return { ok: true, status: 202 };
    }
  });

  await captureServerError(
    {
      errorCode: "persistence_save_failed",
      message: "Room state persistence failed and the action was rolled back.",
      error: new Error("write timeout"),
      surface: "colyseus-room",
      context: {
        roomId: "room-alpha",
        playerId: "player-7",
        requestId: "req-1",
        action: "world.move",
        roomDay: 4,
        battleId: "battle-1",
        heroId: "hero-2",
        detail: "write timeout"
      }
    },
    {
      ...process.env,
      NODE_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: "abc1234",
      SENTRY_DSN: "https://public@example.ingest.sentry.io/42"
    }
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, "https://example.ingest.sentry.io/api/42/envelope/");
  const rawBody = String(fetchCalls[0]?.init?.body);
  const [envelopeHeader, itemHeader, payload] = rawBody.split("\n");
  assert.match(envelopeHeader, /"dsn":"https:\/\/public@example\.ingest\.sentry\.io\/42"/);
  assert.equal(itemHeader, JSON.stringify({ type: "event" }));
  assert.match(payload, /"error_code":"persistence_save_failed"/);
  assert.match(payload, /"roomId":"room-alpha"/);
  assert.match(payload, /"playerId":"player-7"/);
  assert.match(payload, /"battleId":"battle-1"/);
  assert.match(payload, /"release":"abc1234"/);
});
