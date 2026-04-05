import assert from "node:assert/strict";
import test from "node:test";
import {
  findNextDailyQuestRotation,
  normalizeDailyQuestRotationConfigDocument,
  selectDailyQuestRotationForDate,
  validateDailyQuestRotationConfigDocument
} from "../src/index.ts";

test("daily quest rotation selection honors weekday and feature-flag schedule gates", () => {
  const document = normalizeDailyQuestRotationConfigDocument({
    schemaVersion: 1,
    rotations: [
      {
        id: "weekday-core",
        label: "Weekday Core",
        schedule: {
          startDate: "2026-04-01",
          endDate: "2026-04-30",
          weekdays: ["mon", "tue", "wed", "thu", "fri"]
        },
        quests: [
          {
            id: "weekday-scout",
            title: "Weekday Scout",
            description: "Move 3 times.",
            metric: "hero_moves",
            target: 3,
            reward: { gems: 3, gold: 40 }
          }
        ]
      },
      {
        id: "pve-weekend",
        label: "PvE Weekend",
        schedule: {
          startDate: "2026-05-01",
          endDate: "2026-05-31",
          weekdays: ["sun", "sat"],
          requiredFlags: ["pve_enabled"]
        },
        quests: [
          {
            id: "weekend-battle",
            title: "Weekend Battle",
            description: "Win 2 battles.",
            metric: "battle_wins",
            target: 2,
            reward: { gems: 8, gold: 85 }
          }
        ]
      }
    ]
  });

  const weekdayRotation = selectDailyQuestRotationForDate(document, new Date("2026-04-06T10:00:00.000Z"));
  assert.equal(weekdayRotation?.id, "weekday-core");

  const missingFlagRotation = selectDailyQuestRotationForDate(document, new Date("2026-05-02T10:00:00.000Z"));
  assert.equal(missingFlagRotation, null);

  const flaggedRotation = selectDailyQuestRotationForDate(document, new Date("2026-05-02T10:00:00.000Z"), ["pve_enabled"]);
  assert.equal(flaggedRotation?.id, "pve-weekend");

  const nextRotation = findNextDailyQuestRotation(document, new Date("2026-04-29T10:00:00.000Z"), ["pve_enabled"]);
  assert.equal(nextRotation?.rotation.id, "pve-weekend");
  assert.equal(nextRotation?.dateKey, "2026-05-02");
});

test("daily quest rotation validation catches duplicate quests, reward range violations and overlapping schedules", () => {
  const document = normalizeDailyQuestRotationConfigDocument({
    schemaVersion: 1,
    rotations: [
      {
        id: "overlap-a",
        label: "Overlap A",
        schedule: {
          startDate: "2026-04-01",
          endDate: "2026-04-07",
          weekdays: ["wed"]
        },
        quests: [
          {
            id: "duplicate-quest",
            title: "Quest A",
            description: "Move 3 times.",
            metric: "hero_moves",
            target: 3,
            reward: { gems: 3, gold: 40 }
          },
          {
            id: "duplicate-quest",
            title: "Quest B",
            description: "Collect twice.",
            metric: "resource_collections",
            target: 2,
            reward: { gems: 30, gold: 40 }
          }
        ]
      },
      {
        id: "overlap-b",
        label: "Overlap B",
        schedule: {
          startDate: "2026-04-01",
          endDate: "2026-04-07",
          weekdays: ["wed"]
        },
        quests: [
          {
            id: "battle-quest",
            title: "Quest C",
            description: "Win once.",
            metric: "battle_wins",
            target: 1,
            reward: { gems: 5, gold: 60 }
          }
        ]
      }
    ]
  });

  const issueSummary = validateDailyQuestRotationConfigDocument(document)
    .map((issue) => issue.message)
    .join("\n");
  assert.match(issueSummary, /Duplicate quest id "duplicate-quest"/);
  assert.match(issueSummary, /Gem reward must be an integer between 0 and 25/);
  assert.match(issueSummary, /conflicts with "overlap-a" on 2026-04-01/);
});
