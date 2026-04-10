import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  configureDailyQuestConfigRuntimeDependencies,
  loadDailyQuestConfig,
  normalizeDailyQuestConfigDocument,
  resetDailyQuestConfigRuntimeDependencies,
  validateDailyQuestConfigDocument,
  type DailyQuestConfigDocument
} from "../src/daily-quest-config";

function withCleanState(t: TestContext): void {
  resetDailyQuestConfigRuntimeDependencies();
  const originalPath = process.env.VEIL_DAILY_QUESTS_PATH;
  t.after(() => {
    resetDailyQuestConfigRuntimeDependencies();
    if (originalPath === undefined) {
      delete process.env.VEIL_DAILY_QUESTS_PATH;
    } else {
      process.env.VEIL_DAILY_QUESTS_PATH = originalPath;
    }
  });
}

function makeValidQuests(count = 15): DailyQuestConfigDocument["quests"] {
  return Array.from({ length: count }, (_, i) => ({
    id: `quest-${i + 1}`,
    title: `Quest ${i + 1}`,
    description: `Description ${i + 1}`,
    metric: (i % 3 === 0 ? "hero_moves" : i % 3 === 1 ? "battle_wins" : "resource_collections") as "hero_moves" | "battle_wins" | "resource_collections",
    target: i + 1,
    tier: (i < 10 ? "common" : i < 13 ? "rare" : "epic") as "common" | "rare" | "epic",
    reward: { gems: 5, gold: 0 }
  }));
}

test("normalizeDailyQuestConfigDocument returns an empty quest list from null input", () => {
  const result = normalizeDailyQuestConfigDocument(null);
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.quests, []);
});

test("normalizeDailyQuestConfigDocument returns an empty quest list when quests is not an array", () => {
  const result = normalizeDailyQuestConfigDocument({ schemaVersion: 1, quests: "bad" as never });
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.quests, []);
});

test("normalizeDailyQuestConfigDocument clamps float targets to positive integers", () => {
  const result = normalizeDailyQuestConfigDocument({
    schemaVersion: 1,
    quests: [
      {
        id: "q1",
        title: "Float target",
        description: "desc",
        metric: "hero_moves",
        target: 3.9,
        tier: "common",
        reward: { gems: 1, gold: 0 }
      }
    ]
  });
  assert.equal(result.quests[0]?.target, 3);
});

test("normalizeDailyQuestConfigDocument uses fallback id when quest id is missing", () => {
  const result = normalizeDailyQuestConfigDocument({
    schemaVersion: 1,
    quests: [
      {
        id: "",
        title: "No ID quest",
        description: "desc",
        metric: "hero_moves",
        target: 1,
        tier: "common",
        reward: { gems: 1, gold: 0 }
      }
    ]
  });
  assert.match(result.quests[0]?.id ?? "", /^daily-quest-\d+$/);
});

test("normalizeDailyQuestConfigDocument uses fallback metric when metric is invalid", () => {
  const result = normalizeDailyQuestConfigDocument({
    schemaVersion: 1,
    quests: [
      {
        id: "q-bad-metric",
        title: "Bad metric quest",
        description: "desc",
        metric: "unknown_metric" as never,
        target: 1,
        tier: "common",
        reward: { gems: 1, gold: 0 }
      }
    ]
  });
  assert.equal(result.quests[0]?.metric, "hero_moves");
});

test("normalizeDailyQuestConfigDocument clamps negative gem rewards to zero", () => {
  const result = normalizeDailyQuestConfigDocument({
    schemaVersion: 1,
    quests: [
      {
        id: "q-neg-gems",
        title: "Negative gems",
        description: "desc",
        metric: "hero_moves",
        target: 1,
        tier: "common",
        reward: { gems: -5, gold: 0 }
      }
    ]
  });
  assert.equal(result.quests[0]?.reward.gems, 0);
});

test("validateDailyQuestConfigDocument reports error when fewer than 15 quests defined", () => {
  const doc = normalizeDailyQuestConfigDocument({
    schemaVersion: 1,
    quests: makeValidQuests(5)
  });
  const issues = validateDailyQuestConfigDocument(doc);
  assert.ok(issues.some((i) => i.path === "quests" && i.message.includes("15")));
});

test("validateDailyQuestConfigDocument reports error for duplicate quest IDs", () => {
  const quests = makeValidQuests(15);
  if (quests[1]) {
    quests[1].id = quests[0]!.id;
  }
  const doc = normalizeDailyQuestConfigDocument({ schemaVersion: 1, quests });
  const issues = validateDailyQuestConfigDocument(doc);
  assert.ok(issues.some((i) => i.message.includes("Duplicate")));
});

test("validateDailyQuestConfigDocument reports error when a tier has no quests", () => {
  const quests = makeValidQuests(15).map((q) => ({ ...q, tier: "common" as const }));
  const doc = normalizeDailyQuestConfigDocument({ schemaVersion: 1, quests });
  const issues = validateDailyQuestConfigDocument(doc);
  assert.ok(issues.some((i) => i.message.includes("rare")));
  assert.ok(issues.some((i) => i.message.includes("epic")));
});

test("validateDailyQuestConfigDocument reports error when a quest has no reward", () => {
  const quests = makeValidQuests(15);
  if (quests[0]) {
    quests[0].reward = { gems: 0, gold: 0 };
  }
  const doc = normalizeDailyQuestConfigDocument({ schemaVersion: 1, quests });
  const issues = validateDailyQuestConfigDocument(doc);
  assert.ok(issues.some((i) => i.path.includes("reward")));
});

test("validateDailyQuestConfigDocument returns no issues for a well-formed document", () => {
  const doc = normalizeDailyQuestConfigDocument({ schemaVersion: 1, quests: makeValidQuests(15) });
  const issues = validateDailyQuestConfigDocument(doc);
  assert.equal(issues.length, 0);
});

test("loadDailyQuestConfig uses injectable readFileSync and caches on second call", (t) => {
  withCleanState(t);
  const validDoc = normalizeDailyQuestConfigDocument({ schemaVersion: 1, quests: makeValidQuests(15) });
  let callCount = 0;
  configureDailyQuestConfigRuntimeDependencies({
    readFileSync: () => {
      callCount += 1;
      return JSON.stringify(validDoc);
    }
  });

  const first = loadDailyQuestConfig({});
  const second = loadDailyQuestConfig({});

  assert.equal(callCount, 1, "file should be read only once due to caching");
  assert.equal(first, second, "both calls should return the same cached object");
  assert.equal(first.quests.length, 15);
});

test("loadDailyQuestConfig falls back to bundled defaults when file is missing", (t) => {
  withCleanState(t);
  configureDailyQuestConfigRuntimeDependencies({
    readFileSync: () => {
      throw new Error("ENOENT");
    }
  });

  const config = loadDailyQuestConfig({});
  assert.ok(config.quests.length >= 15, "bundled default should have at least 15 quests");
});

test("loadDailyQuestConfig falls back to bundled defaults when JSON is invalid", (t) => {
  withCleanState(t);
  configureDailyQuestConfigRuntimeDependencies({
    readFileSync: () => "not-json{{{broken"
  });

  const config = loadDailyQuestConfig({});
  assert.ok(config.quests.length >= 15);
});

test("loadDailyQuestConfig falls back to bundled defaults when loaded config fails validation", (t) => {
  withCleanState(t);
  const tooFewQuests = normalizeDailyQuestConfigDocument({ schemaVersion: 1, quests: makeValidQuests(3) });
  configureDailyQuestConfigRuntimeDependencies({
    readFileSync: () => JSON.stringify(tooFewQuests)
  });

  const config = loadDailyQuestConfig({});
  assert.ok(config.quests.length >= 15, "should fall back to bundled defaults when validation fails");
});
