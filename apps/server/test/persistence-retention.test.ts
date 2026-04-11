import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SNAPSHOT_CLEANUP_INTERVAL_MINUTES,
  DEFAULT_SNAPSHOT_TTL_HOURS,
  readMySqlPersistenceConfig,
  snapshotHasExpired
} from "../src/persistence";
import {
  DEFAULT_MYSQL_POOL_CONNECTION_LIMIT,
  DEFAULT_MYSQL_POOL_IDLE_TIMEOUT_MS,
  DEFAULT_MYSQL_POOL_MAX_IDLE,
  DEFAULT_MYSQL_POOL_QUEUE_LIMIT,
  DEFAULT_MYSQL_POOL_WAIT_FOR_CONNECTIONS
} from "../src/mysql-pool";

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
});

test("mysql persistence config allows disabling ttl and periodic cleanup", () => {
  const config = readMySqlPersistenceConfig({
    VEIL_MYSQL_HOST: "127.0.0.1",
    VEIL_MYSQL_USER: "root",
    VEIL_MYSQL_PASSWORD: "secret",
    VEIL_MYSQL_SNAPSHOT_TTL_HOURS: "0",
    VEIL_MYSQL_SNAPSHOT_CLEANUP_INTERVAL_MINUTES: "-1"
  });

  assert.ok(config);
  assert.equal(config.retention.ttlHours, null);
  assert.equal(config.retention.cleanupIntervalMinutes, null);
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
