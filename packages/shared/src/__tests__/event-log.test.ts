import assert from "node:assert/strict";
import test from "node:test";
import {
  appendEventLogEntries,
  applyAchievementMetricDelta,
  buildPlayerProgressionSnapshot,
  normalizeEventLogEntries,
  normalizePlayerProgressionSnapshot,
  queryAchievementProgress,
  queryEventLogEntries,
  type EventLogEntry
} from "../event-log.ts";

function createEntry(overrides: Partial<EventLogEntry> = {}): EventLogEntry {
  return {
    id: "event-1",
    timestamp: "2026-04-11T14:00:00.000Z",
    roomId: "room-1",
    playerId: "player-1",
    category: "achievement",
    description: "Battle started",
    rewards: [],
    ...overrides
  };
}

test("appendEventLogEntries keeps newest events first and deduplicates repeated entries", () => {
  const existing = [
    createEntry({
      id: "event-2",
      timestamp: "2026-04-11T14:01:00.000Z",
      description: "Older unique event"
    }),
    createEntry({
      id: "event-1",
      timestamp: "2026-04-11T14:00:00.000Z",
      description: "Original event"
    })
  ];
  const incoming = [
    createEntry({
      id: "event-3",
      timestamp: "2026-04-11T14:02:00.000Z",
      description: "Newest event"
    }),
    createEntry({
      id: "event-1",
      timestamp: "2026-04-11T14:00:00.000Z",
      description: "Original event"
    })
  ];

  const combined = appendEventLogEntries(existing, incoming, 10);

  assert.deepEqual(
    combined.map((entry) => entry.id),
    ["event-3", "event-2", "event-1"]
  );
  assert.equal(combined[2]?.description, "Original event");
});

test("appendEventLogEntries enforces the configured maximum log size", () => {
  const combined = appendEventLogEntries(
    [],
    [
      createEntry({ id: "event-1", timestamp: "2026-04-11T14:00:00.000Z" }),
      createEntry({ id: "event-2", timestamp: "2026-04-11T14:01:00.000Z" }),
      createEntry({ id: "event-3", timestamp: "2026-04-11T14:02:00.000Z" })
    ],
    2
  );

  assert.deepEqual(
    combined.map((entry) => entry.id),
    ["event-3", "event-2"]
  );
});

test("applyAchievementMetricDelta increments progress and unlocks the matching milestone once", () => {
  const recordedAt = "2026-04-11T15:00:00.000Z";
  const progressed = applyAchievementMetricDelta([], "battles_started", 1, recordedAt);

  const firstBattle = queryAchievementProgress(progressed.progress, {
    achievementId: "first_battle"
  })[0];

  assert.equal(firstBattle?.current, 1);
  assert.equal(firstBattle?.unlocked, true);
  assert.equal(firstBattle?.progressUpdatedAt, recordedAt);
  assert.equal(firstBattle?.unlockedAt, recordedAt);
  assert.deepEqual(
    progressed.unlocked.map((entry) => entry.id),
    ["first_battle"]
  );

  const repeated = applyAchievementMetricDelta(progressed.progress, "battles_started", 3, "2026-04-11T15:05:00.000Z");
  const repeatedFirstBattle = queryAchievementProgress(repeated.progress, {
    achievementId: "first_battle"
  })[0];

  assert.equal(repeatedFirstBattle?.current, 1);
  assert.equal(repeated.unlocked.length, 0);
});

test("queryEventLogEntries filters and paginates normalized event logs", () => {
  const entries = normalizeEventLogEntries([
    createEntry({
      id: "event-4",
      timestamp: "2026-04-11T14:03:00.000Z",
      category: "achievement",
      achievementId: "enemy_slayer",
      heroId: "hero-1",
      description: "Achievement unlocked"
    }),
    createEntry({
      id: "event-3",
      timestamp: "2026-04-11T14:02:00.000Z",
      category: "combat",
      heroId: "hero-1",
      worldEventType: "battle.resolved",
      description: "Won battle"
    }),
    createEntry({
      id: "event-2",
      timestamp: "2026-04-11T14:01:00.000Z",
      category: "movement",
      heroId: "hero-2",
      description: "Moved hero"
    }),
    createEntry({
      id: "event-1",
      timestamp: "2026-04-11T14:00:00.000Z",
      category: "combat",
      heroId: "hero-1",
      worldEventType: "battle.started",
      description: "Started battle"
    })
  ]);

  const filtered = queryEventLogEntries(entries, {
    heroId: " hero-1 ",
    since: "2026-04-11T14:00:30.000Z",
    until: "2026-04-11T14:03:00.000Z",
    offset: 1,
    limit: 1
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "event-3");
});

test("snapshot normalization survives serialize-roundtrip and preserves edge-case entries", () => {
  const maxLengthDescription = "x".repeat(4096);
  const snapshot = buildPlayerProgressionSnapshot(
    [],
    [createEntry({ id: "event-max", description: maxLengthDescription, category: "account" })],
    5
  );

  const roundTripped = normalizePlayerProgressionSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const emptySnapshot = buildPlayerProgressionSnapshot([], [], 5);
  const singleEvent = queryEventLogEntries(roundTripped.recentEventLog, { limit: 1 })[0];

  assert.equal(emptySnapshot.summary.recentEventCount, 0);
  assert.equal(emptySnapshot.summary.latestEventAt, undefined);
  assert.equal(roundTripped.summary.recentEventCount, 1);
  assert.equal(singleEvent?.id, "event-max");
  assert.equal(singleEvent?.description.length, 4096);
  assert.deepEqual(roundTripped.recentEventLog, snapshot.recentEventLog);
  assert.equal(roundTripped.achievements.length > 0, true);
});
