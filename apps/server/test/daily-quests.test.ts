import assert from "node:assert/strict";
import test from "node:test";
import {
  createDailyQuestClaimEventLogEntry,
  getDailyQuestCycleKey,
  getDailyQuestResetAt,
  loadDailyQuestBoard,
  readDailyQuestFeatureEnabled
} from "@server/domain/economy/daily-quests";

// readDailyQuestFeatureEnabled

test("readDailyQuestFeatureEnabled returns true for '1'", () => {
  assert.equal(readDailyQuestFeatureEnabled({ VEIL_DAILY_QUESTS_ENABLED: "1" }), true);
});

test("readDailyQuestFeatureEnabled returns true for 'true'", () => {
  assert.equal(readDailyQuestFeatureEnabled({ VEIL_DAILY_QUESTS_ENABLED: "true" }), true);
});

test("readDailyQuestFeatureEnabled returns true for 'yes'", () => {
  assert.equal(readDailyQuestFeatureEnabled({ VEIL_DAILY_QUESTS_ENABLED: "yes" }), true);
});

test("readDailyQuestFeatureEnabled returns true for 'on'", () => {
  assert.equal(readDailyQuestFeatureEnabled({ VEIL_DAILY_QUESTS_ENABLED: "on" }), true);
});

test("readDailyQuestFeatureEnabled returns true for uppercase 'TRUE'", () => {
  assert.equal(readDailyQuestFeatureEnabled({ VEIL_DAILY_QUESTS_ENABLED: "TRUE" }), true);
});

test("readDailyQuestFeatureEnabled returns false for '0'", () => {
  assert.equal(readDailyQuestFeatureEnabled({ VEIL_DAILY_QUESTS_ENABLED: "0" }), false);
});

test("readDailyQuestFeatureEnabled returns false for 'false'", () => {
  assert.equal(readDailyQuestFeatureEnabled({ VEIL_DAILY_QUESTS_ENABLED: "false" }), false);
});

test("readDailyQuestFeatureEnabled returns false when env var is absent", () => {
  assert.equal(readDailyQuestFeatureEnabled({}), false);
});

test("readDailyQuestFeatureEnabled returns false for empty string", () => {
  assert.equal(readDailyQuestFeatureEnabled({ VEIL_DAILY_QUESTS_ENABLED: "" }), false);
});

// getDailyQuestCycleKey

test("getDailyQuestCycleKey returns the ISO date portion of the provided date", () => {
  const result = getDailyQuestCycleKey(new Date("2026-04-10T12:00:00.000Z"));
  assert.equal(result, "2026-04-10");
});

test("getDailyQuestCycleKey returns a 10-character YYYY-MM-DD string", () => {
  const result = getDailyQuestCycleKey(new Date("2026-01-01T00:00:00.000Z"));
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result.length, 10);
});

// getDailyQuestResetAt

test("getDailyQuestResetAt returns end-of-day timestamp for a given cycle key", () => {
  const result = getDailyQuestResetAt("2026-04-10");
  assert.equal(result, "2026-04-10T23:59:59.999Z");
});

test("getDailyQuestResetAt always ends with T23:59:59.999Z", () => {
  const result = getDailyQuestResetAt("2026-12-31");
  assert.ok(result.endsWith("T23:59:59.999Z"));
});

// createDailyQuestClaimEventLogEntry

test("createDailyQuestClaimEventLogEntry returns a correctly shaped entry with gem and gold rewards", () => {
  const entry = createDailyQuestClaimEventLogEntry(
    "player-1",
    "room-99",
    { id: "q-gems-gold", title: "Test Quest", reward: { gems: 10, gold: 200 } },
    "2026-04-10T12:00:00.000Z"
  );

  assert.equal(entry.playerId, "player-1");
  assert.equal(entry.roomId, "room-99");
  assert.equal(entry.category, "account");
  assert.equal(entry.timestamp, "2026-04-10T12:00:00.000Z");
  assert.ok(entry.id.includes("player-1"));
  assert.ok(entry.id.includes("daily-quest-claim"));
  assert.ok(entry.id.includes("q-gems-gold"));

  const gemReward = entry.rewards.find((r) => r.label === "gems");
  const goldReward = entry.rewards.find((r) => r.label === "gold");
  assert.ok(gemReward, "should have gems reward");
  assert.equal(gemReward?.amount, 10);
  assert.ok(goldReward, "should have gold reward");
  assert.equal(goldReward?.amount, 200);
});

test("createDailyQuestClaimEventLogEntry omits zero-value rewards", () => {
  const entry = createDailyQuestClaimEventLogEntry(
    "player-2",
    "room-1",
    { id: "q-gems-only", title: "Gems Quest", reward: { gems: 5, gold: 0 } },
    "2026-04-10T08:00:00.000Z"
  );

  assert.equal(entry.rewards.length, 1);
  assert.equal(entry.rewards[0]?.label, "gems");
  assert.equal(entry.rewards[0]?.amount, 5);
});

test("createDailyQuestClaimEventLogEntry uses sequence in the generated id", () => {
  const entry = createDailyQuestClaimEventLogEntry(
    "player-3",
    "room-2",
    { id: "q-seq", title: "Seq Quest", reward: { gems: 1, gold: 0 } },
    "2026-04-10T09:00:00.000Z",
    3
  );

  assert.ok(entry.id.includes(":3:"), "id should contain the sequence number");
});

test("loadDailyQuestBoard uses the active daily quest rotation override", async (t) => {
  const originalRotationJson = process.env.VEIL_DAILY_QUEST_ROTATIONS_JSON;
  process.env.VEIL_DAILY_QUEST_ROTATIONS_JSON = JSON.stringify({
    schemaVersion: 1,
    rotations: [
      {
        id: "test-override",
        label: "Test Override",
        schedule: {
          startDate: "2026-05-01",
          endDate: "2026-05-31",
          weekdays: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
        },
        quests: [
          {
            id: "override_first_battle",
            title: "Override First Battle",
            description: "Win one battle.",
            metric: "battle_wins",
            target: 1,
            reward: {
              gems: 1,
              gold: 10
            }
          }
        ]
      }
    ]
  });
  t.after(() => {
    if (originalRotationJson === undefined) {
      delete process.env.VEIL_DAILY_QUEST_ROTATIONS_JSON;
    } else {
      process.env.VEIL_DAILY_QUEST_ROTATIONS_JSON = originalRotationJson;
    }
  });

  const board = await loadDailyQuestBoard(
    {
      loadPlayerEventHistory: async () => ({ items: [] }),
      loadPlayerQuestState: async () => null,
      savePlayerQuestState: async (_playerId: string, state: unknown) => state
    } as never,
    {
      playerId: "rotation-player",
      displayName: "Rotation Player"
    } as never,
    new Date("2026-05-06T12:00:00.000Z"),
    {
      enabled: true
    }
  );

  assert.deepEqual(
    board.quests.map((quest) => quest.id),
    ["override_first_battle"]
  );
});
