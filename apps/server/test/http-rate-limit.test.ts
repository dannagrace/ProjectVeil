import assert from "node:assert/strict";
import test from "node:test";
import { startDevServer } from "../src/dev-server";
import { resetRuntimeObservability } from "../src/observability";

function withEnvOverrides(
  overrides: Record<string, string>,
  cleanup: Array<() => void>
): void {
  for (const [key, value] of Object.entries(overrides)) {
    const originalValue = process.env[key];
    process.env[key] = value;
    cleanup.push(() => {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    });
  }
}

function withHeaders(ipAddress: string, extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    "x-forwarded-for": ipAddress,
    ...extraHeaders
  };
}

test("HTTP rate limiting returns 429 with Retry-After and increments Prometheus metrics for scoped routes", { concurrency: false }, async (t) => {
  resetRuntimeObservability();
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      ADMIN_SECRET: "test-admin-secret",
      VEIL_RATE_LIMIT_HTTP_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_HTTP_GLOBAL_MAX: "2",
      VEIL_RATE_LIMIT_HTTP_SHOP_MAX: "1",
      VEIL_RATE_LIMIT_HTTP_LEADERBOARD_MAX: "1",
      VEIL_RATE_LIMIT_HTTP_ADMIN_MAX: "1"
    },
    cleanup
  );

  const port = 46000 + Math.floor(Math.random() * 1000);
  const runtime = await startDevServer(port, "127.0.0.1");

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetRuntimeObservability();
    await runtime.gracefullyShutdown(false).catch(() => undefined);
  });

  const shopIp = "203.0.113.10";
  const leaderboardIp = "203.0.113.11";
  const adminIp = "203.0.113.12";
  const globalIp = "203.0.113.13";
  const metricsIp = "203.0.113.99";

  const firstShopResponse = await fetch(`http://127.0.0.1:${port}/api/shop/products`, {
    headers: withHeaders(shopIp)
  });
  assert.equal(firstShopResponse.status, 200);

  const limitedShopResponse = await fetch(`http://127.0.0.1:${port}/api/shop/products`, {
    headers: withHeaders(shopIp)
  });
  assert.equal(limitedShopResponse.status, 429);
  assert.equal(limitedShopResponse.headers.get("Retry-After"), "60");
  assert.equal(((await limitedShopResponse.json()) as { error: { code: string } }).error.code, "rate_limited");

  const firstLeaderboardResponse = await fetch(`http://127.0.0.1:${port}/api/leaderboard`, {
    headers: withHeaders(leaderboardIp)
  });
  assert.equal(firstLeaderboardResponse.status, 200);

  const limitedLeaderboardResponse = await fetch(`http://127.0.0.1:${port}/api/leaderboard`, {
    headers: withHeaders(leaderboardIp)
  });
  assert.equal(limitedLeaderboardResponse.status, 429);
  assert.equal(limitedLeaderboardResponse.headers.get("Retry-After"), "60");

  const firstAdminResponse = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
    headers: withHeaders(adminIp, { "x-veil-admin-secret": "test-admin-secret" })
  });
  assert.equal(firstAdminResponse.status, 200);

  const limitedAdminResponse = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
    headers: withHeaders(adminIp, { "x-veil-admin-secret": "test-admin-secret" })
  });
  assert.equal(limitedAdminResponse.status, 429);
  assert.equal(limitedAdminResponse.headers.get("Retry-After"), "60");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/lobby/rooms`, {
      headers: withHeaders(globalIp)
    });
    assert.equal(response.status, 200);
  }

  const limitedGlobalResponse = await fetch(`http://127.0.0.1:${port}/api/lobby/rooms`, {
    headers: withHeaders(globalIp)
  });
  assert.equal(limitedGlobalResponse.status, 429);
  assert.equal(limitedGlobalResponse.headers.get("Retry-After"), "60");

  const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`, {
    headers: withHeaders(metricsIp)
  });
  const metricsText = await metricsResponse.text();

  assert.equal(metricsResponse.status, 200);
  assert.match(metricsText, /^veil_http_rate_limited_total 4$/m);
});
