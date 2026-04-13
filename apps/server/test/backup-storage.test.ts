import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLatestSuccessTimestamp,
  parseLatestTimestampFromListing
} from "../src/backup-storage";

test("parseLatestSuccessTimestamp returns the epoch for a marker timestamp field", () => {
  const markerJson = JSON.stringify({
    timestamp: "2026-04-12T08:15:30.000Z"
  });

  assert.equal(parseLatestSuccessTimestamp(markerJson), 1775981730);
});

test("parseLatestSuccessTimestamp falls back to completedAt when timestamp is absent", () => {
  const markerJson = JSON.stringify({
    completedAt: "2026-04-12T08:15:30.000Z"
  });

  assert.equal(parseLatestSuccessTimestamp(markerJson), 1775981730);
});

test("parseLatestSuccessTimestamp returns null when the marker has neither supported field", () => {
  const markerJson = JSON.stringify({
    status: "ok"
  });

  assert.equal(parseLatestSuccessTimestamp(markerJson), null);
});

test("parseLatestSuccessTimestamp returns null for an invalid date string", () => {
  const markerJson = JSON.stringify({
    timestamp: "not-a-date"
  });

  assert.equal(parseLatestSuccessTimestamp(markerJson), null);
});

test("parseLatestSuccessTimestamp returns null for malformed JSON", () => {
  assert.equal(parseLatestSuccessTimestamp("{"), null);
});

test("parseLatestSuccessTimestamp returns null for an empty string", () => {
  assert.equal(parseLatestSuccessTimestamp(""), null);
});

test("parseLatestTimestampFromListing returns the newest timestamp from a multi-line aws listing", () => {
  const listing = [
    "2026-04-10 05:00:00      123 backups/mysql/backup-20260410.sql.gz",
    "2026-04-11 06:30:00      456 backups/mysql/backup-20260411.sql.gz",
    "2026-04-09 04:15:00      789 backups/mysql/backup-20260409.sql.gz"
  ].join("\n");

  assert.equal(parseLatestTimestampFromListing(listing), 1775889000);
});

test("parseLatestTimestampFromListing returns the timestamp from a single valid sql.gz line", () => {
  const listing = "2026-04-12 08:15:30      123 backups/mysql/backup-20260412.sql.gz";

  assert.equal(parseLatestTimestampFromListing(listing), 1775981730);
});

test("parseLatestTimestampFromListing ignores lines that do not end in .sql.gz", () => {
  const listing = [
    "2026-04-12 08:15:30      123 backups/mysql/backup-20260412.sql",
    "2026-04-12 08:16:30      123 backups/mysql/backup-20260412.tar.gz",
    "2026-04-12 08:17:30      123 backups/mysql/notes.txt"
  ].join("\n");

  assert.equal(parseLatestTimestampFromListing(listing), null);
});

test("parseLatestTimestampFromListing returns null for empty input", () => {
  assert.equal(parseLatestTimestampFromListing(""), null);
});

test("parseLatestTimestampFromListing returns null for whitespace-only input", () => {
  assert.equal(parseLatestTimestampFromListing("   \n\t  "), null);
});

test("parseLatestTimestampFromListing ignores invalid timestamps and keeps valid sql.gz entries", () => {
  const listing = [
    "not-a-date 08:15:30      123 backups/mysql/bad-prefix.sql.gz",
    "2026-04-12 08:15:30      123 backups/mysql/backup-20260412.sql.gz"
  ].join("\n");

  assert.equal(parseLatestTimestampFromListing(listing), 1775981730);
});

test("parseLatestTimestampFromListing ignores incomplete aws listing lines", () => {
  const listing = [
    "PRE backups/mysql/",
    "2026-04-12 08:15:30",
    "2026-04-12 08:15:30      123 backups/mysql/backup-20260412.sql.gz"
  ].join("\n");

  assert.equal(parseLatestTimestampFromListing(listing), 1775981730);
});
