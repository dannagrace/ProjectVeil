import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PLAYER_NAME_HISTORY_CLEANUP_BATCH_SIZE,
  DEFAULT_PLAYER_NAME_HISTORY_CLEANUP_INTERVAL_MINUTES,
  DEFAULT_PLAYER_NAME_HISTORY_TTL_DAYS,
  DEFAULT_SNAPSHOT_CLEANUP_INTERVAL_MINUTES,
  DEFAULT_SNAPSHOT_TTL_HOURS,
  isPlayerBanActive,
  readMySqlPersistenceConfig,
  snapshotHasExpired
} from "../src/persistence";
import {
  DEFAULT_MYSQL_POOL_CONNECTION_LIMIT,
  DEFAULT_MYSQL_POOL_IDLE_TIMEOUT_MS,
  DEFAULT_MYSQL_POOL_MAX_IDLE,
  DEFAULT_MYSQL_POOL_QUEUE_LIMIT,
  DEFAULT_MYSQL_POOL_WAIT_FOR_CONNECTIONS
} from "../src/infra/mysql-pool";

test("mysql persistence config uses default snapshot retention policy", () => {
  const config = readMySqlPersistenceConfig({
    VEIL_MYSQL_HOST: "127.0.0.1",
    VEIL_MYSQL_USER: "root",
    VEIL_MYSQL_PASSWORD: "secret"
  });

  assert.ok(config);
  assert.equal(config.pool.connectionLimit, DEFAULT_MYSQL_POOL_CONNECTION_LIMIT);
  assert.equal(config.pool.maxIdle, DEFAULT_MYSQL_POOL_MAX_IDLE);
  assert.equal(config.pool.idleTimeoutMs, DEFAULT_MYSQL_POOL_IDLE_TIMEOUT_MS);
  assert.equal(config.pool.queueLimit, DEFAULT_MYSQL_POOL_QUEUE_LIMIT);
  assert.equal(config.pool.waitForConnections, DEFAULT_MYSQL_POOL_WAIT_FOR_CONNECTIONS);
  assert.equal(config.retention.ttlHours, DEFAULT_SNAPSHOT_TTL_HOURS);
  assert.equal(config.retention.cleanupIntervalMinutes, DEFAULT_SNAPSHOT_CLEANUP_INTERVAL_MINUTES);
  assert.equal(config.playerNameHistoryRetention.ttlDays, DEFAULT_PLAYER_NAME_HISTORY_TTL_DAYS);
  assert.equal(
    config.playerNameHistoryRetention.cleanupIntervalMinutes,
    DEFAULT_PLAYER_NAME_HISTORY_CLEANUP_INTERVAL_MINUTES
  );
  assert.equal(config.playerNameHistoryRetention.cleanupBatchSize, DEFAULT_PLAYER_NAME_HISTORY_CLEANUP_BATCH_SIZE);
});

test("mysql persistence config allows disabling ttl and periodic cleanup", () => {
  const config = readMySqlPersistenceConfig({
    VEIL_MYSQL_HOST: "127.0.0.1",
    VEIL_MYSQL_USER: "root",
    VEIL_MYSQL_PASSWORD: "secret",
    VEIL_MYSQL_SNAPSHOT_TTL_HOURS: "0",
    VEIL_MYSQL_SNAPSHOT_CLEANUP_INTERVAL_MINUTES: "-1",
    VEIL_PLAYER_NAME_HISTORY_TTL_DAYS: "0",
    VEIL_PLAYER_NAME_HISTORY_CLEANUP_INTERVAL_MINUTES: "-1"
  });

  assert.ok(config);
  assert.equal(config.retention.ttlHours, null);
  assert.equal(config.retention.cleanupIntervalMinutes, null);
  assert.equal(config.playerNameHistoryRetention.ttlDays, null);
  assert.equal(config.playerNameHistoryRetention.cleanupIntervalMinutes, null);
  assert.equal(config.playerNameHistoryRetention.cleanupBatchSize, DEFAULT_PLAYER_NAME_HISTORY_CLEANUP_BATCH_SIZE);
});

test("mysql persistence config reads explicit pool tuning from env", () => {
  const config = readMySqlPersistenceConfig({
    VEIL_MYSQL_HOST: "127.0.0.1",
    VEIL_MYSQL_USER: "root",
    VEIL_MYSQL_PASSWORD: "secret",
    VEIL_MYSQL_POOL_CONNECTION_LIMIT: "12",
    VEIL_MYSQL_POOL_MAX_IDLE: "6",
    VEIL_MYSQL_POOL_IDLE_TIMEOUT_MS: "15000",
    VEIL_MYSQL_POOL_QUEUE_LIMIT: "32",
    VEIL_MYSQL_POOL_WAIT_FOR_CONNECTIONS: "false"
  });

  assert.ok(config);
  assert.equal(config.pool.connectionLimit, 12);
  assert.equal(config.pool.maxIdle, 6);
  assert.equal(config.pool.idleTimeoutMs, 15_000);
  assert.equal(config.pool.queueLimit, 32);
  assert.equal(config.pool.waitForConnections, false);
});

test("snapshotHasExpired respects ttl windows", () => {
  const now = new Date("2026-03-20T12:00:00.000Z");
  const recent = new Date("2026-03-20T10:30:00.000Z");
  const stale = new Date("2026-03-20T08:59:59.000Z");

  assert.equal(snapshotHasExpired(recent, 3, now), false);
  assert.equal(snapshotHasExpired(stale, 3, now), true);
  assert.equal(snapshotHasExpired(stale, null, now), false);
});

test("snapshotHasExpired expires exactly at the ttl boundary for date and ISO string inputs", () => {
  const now = new Date("2026-03-20T12:00:00.000Z");
  const boundary = "2026-03-20T09:00:00.000Z";
  const justInsideWindow = "2026-03-20T09:00:00.001Z";

  assert.equal(snapshotHasExpired(boundary, 3, now), true);
  assert.equal(snapshotHasExpired(justInsideWindow, 3, now), false);
});

test("isPlayerBanActive handles none, permanent, and temporary ban states deterministically", () => {
  const referenceTime = new Date("2026-03-20T12:00:00.000Z");
  const originalDateNow = Date.now;
  Date.now = () => referenceTime.getTime();

  try {
    assert.equal(isPlayerBanActive(undefined), false);
    assert.equal(isPlayerBanActive(null), false);
    assert.equal(isPlayerBanActive({ banStatus: "none" }), false);
    assert.equal(isPlayerBanActive({ banStatus: "permanent" }), true);
    assert.equal(
      isPlayerBanActive({
        banStatus: "temporary",
        banExpiry: "2026-03-20T12:30:00.000Z"
      }),
      true
    );
  } finally {
    Date.now = originalDateNow;
  }
});

test("isPlayerBanActive rejects expired, boundary, missing, and invalid temporary expiries", () => {
  const referenceTime = new Date("2026-03-20T12:00:00.000Z");
  const originalDateNow = Date.now;
  Date.now = () => referenceTime.getTime();

  try {
    assert.equal(
      isPlayerBanActive({
        banStatus: "temporary",
        banExpiry: "2026-03-20T11:59:59.999Z"
      }),
      false
    );
    assert.equal(
      isPlayerBanActive({
        banStatus: "temporary",
        banExpiry: "2026-03-20T12:00:00.000Z"
      }),
      false
    );
    assert.equal(isPlayerBanActive({ banStatus: "temporary" }), false);
    assert.equal(
      isPlayerBanActive({
        banStatus: "temporary",
        banExpiry: "not-a-timestamp"
      }),
      false
    );
  } finally {
    Date.now = originalDateNow;
  }
});
