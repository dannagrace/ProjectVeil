import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SNAPSHOT_CLEANUP_INTERVAL_MINUTES,
  DEFAULT_SNAPSHOT_TTL_HOURS,
  readMySqlPersistenceConfig,
  snapshotHasExpired
} from "../src/persistence";

test("mysql persistence config uses default snapshot retention policy", () => {
  const config = readMySqlPersistenceConfig({
    VEIL_MYSQL_HOST: "127.0.0.1",
    VEIL_MYSQL_USER: "root",
    VEIL_MYSQL_PASSWORD: "secret"
  });

  assert.ok(config);
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

test("snapshotHasExpired respects ttl windows", () => {
  const now = new Date("2026-03-20T12:00:00.000Z");
  const recent = new Date("2026-03-20T10:30:00.000Z");
  const stale = new Date("2026-03-20T08:59:59.000Z");

  assert.equal(snapshotHasExpired(recent, 3, now), false);
  assert.equal(snapshotHasExpired(stale, 3, now), true);
  assert.equal(snapshotHasExpired(stale, null, now), false);
});
