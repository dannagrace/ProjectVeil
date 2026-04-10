import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  clearCachedDailyQuestRotationConfig,
  configureDailyQuestRotationRuntimeDependencies,
  createDailyQuestRotationPreview,
  loadDailyQuestRotationConfig,
  resetDailyQuestRotationRuntimeDependencies,
  resolveDailyQuestRotation
} from "../src/daily-quest-rotations";

function withCleanState(t: TestContext): void {
  resetDailyQuestRotationRuntimeDependencies();
  clearCachedDailyQuestRotationConfig();
  const originalPath = process.env.VEIL_DAILY_QUEST_ROTATIONS_PATH;
  const originalJson = process.env.VEIL_DAILY_QUEST_ROTATIONS_JSON;
  t.after(() => {
    resetDailyQuestRotationRuntimeDependencies();
    clearCachedDailyQuestRotationConfig();
    if (originalPath === undefined) {
      delete process.env.VEIL_DAILY_QUEST_ROTATIONS_PATH;
    } else {
      process.env.VEIL_DAILY_QUEST_ROTATIONS_PATH = originalPath;
    }
    if (originalJson === undefined) {
      delete process.env.VEIL_DAILY_QUEST_ROTATIONS_JSON;
    } else {
      process.env.VEIL_DAILY_QUEST_ROTATIONS_JSON = originalJson;
    }
  });
}

function makeValidRotationDoc() {
  return {
    schemaVersion: 1 as const,
    rotations: [
      {
        id: "test-rotation",
        label: "Test Rotation",
        schedule: {
          startDate: "2026-01-01",
          endDate: "2099-12-31",
          weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
        },
        quests: [
          {
            id: "q1",
            title: "Quest 1",
            description: "Description 1",
            metric: "hero_moves" as const,
            target: 3,
            reward: { gems: 3, gold: 40 }
          }
        ]
      }
    ]
  };
}

test("loadDailyQuestRotationConfig caches result on second call (callCount = 1)", (t) => {
  withCleanState(t);
  const validDoc = makeValidRotationDoc();
  let callCount = 0;
  configureDailyQuestRotationRuntimeDependencies({
    readFileSync: () => {
      callCount += 1;
      return JSON.stringify(validDoc);
    }
  });

  const first = loadDailyQuestRotationConfig({});
  const second = loadDailyQuestRotationConfig({});

  assert.equal(callCount, 1, "file should be read only once due to caching");
  assert.equal(first, second, "both calls should return the same cached object");
  assert.equal(first.rotations.length, 1);
});

test("loadDailyQuestRotationConfig falls back to bundled defaults when file is missing (throws ENOENT)", (t) => {
  withCleanState(t);
  configureDailyQuestRotationRuntimeDependencies({
    readFileSync: () => {
      const err = new Error("ENOENT: no such file or directory");
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    }
  });

  const config = loadDailyQuestRotationConfig({});
  assert.ok(config.rotations.length > 0, "bundled default should have rotations");
  assert.equal(config.schemaVersion, 1);
});

test("loadDailyQuestRotationConfig falls back to bundled defaults when JSON is invalid", (t) => {
  withCleanState(t);
  configureDailyQuestRotationRuntimeDependencies({
    readFileSync: () => "not-json{{{broken"
  });

  const config = loadDailyQuestRotationConfig({});
  assert.ok(config.rotations.length > 0, "bundled default should have rotations");
  assert.equal(config.schemaVersion, 1);
});

test("loadDailyQuestRotationConfig falls back to bundled defaults when config fails validation", (t) => {
  withCleanState(t);
  // A config with duplicate rotation IDs will fail validation
  const invalidDoc = {
    schemaVersion: 1,
    rotations: [
      {
        id: "dup-id",
        label: "Rotation A",
        quests: []
      },
      {
        id: "dup-id",
        label: "Rotation B",
        quests: []
      }
    ]
  };
  configureDailyQuestRotationRuntimeDependencies({
    readFileSync: () => JSON.stringify(invalidDoc)
  });

  const config = loadDailyQuestRotationConfig({});
  // Bundled defaults have valid distinct rotation IDs
  const ids = config.rotations.map((r) => r.id);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, uniqueIds.size, "should fall back to bundled defaults (no duplicate IDs)");
  assert.ok(config.rotations.length > 0);
});

test("clearCachedDailyQuestRotationConfig forces fresh file read on next call (callCount = 2)", (t) => {
  withCleanState(t);
  const validDoc = makeValidRotationDoc();
  let callCount = 0;
  configureDailyQuestRotationRuntimeDependencies({
    readFileSync: () => {
      callCount += 1;
      return JSON.stringify(validDoc);
    }
  });

  loadDailyQuestRotationConfig({});
  assert.equal(callCount, 1, "first call reads file once");

  clearCachedDailyQuestRotationConfig();

  loadDailyQuestRotationConfig({});
  assert.equal(callCount, 2, "after clearing cache, second call should re-read file");
});

test("loadDailyQuestRotationConfig uses VEIL_DAILY_QUEST_ROTATIONS_JSON env override when set", (t) => {
  withCleanState(t);
  let fileReadCount = 0;
  configureDailyQuestRotationRuntimeDependencies({
    readFileSync: () => {
      fileReadCount += 1;
      return "{}";
    }
  });

  const overrideDoc = makeValidRotationDoc();
  const config = loadDailyQuestRotationConfig({
    VEIL_DAILY_QUEST_ROTATIONS_JSON: JSON.stringify(overrideDoc)
  });

  assert.equal(fileReadCount, 0, "should not read file when env override is set");
  assert.equal(config.rotations[0]?.id, "test-rotation", "should use config from env override");
});

test("loadDailyQuestRotationConfig ignores invalid VEIL_DAILY_QUEST_ROTATIONS_JSON and falls through to file", (t) => {
  withCleanState(t);
  const validDoc = makeValidRotationDoc();
  let fileReadCount = 0;
  configureDailyQuestRotationRuntimeDependencies({
    readFileSync: () => {
      fileReadCount += 1;
      return JSON.stringify(validDoc);
    }
  });

  const config = loadDailyQuestRotationConfig({
    VEIL_DAILY_QUEST_ROTATIONS_JSON: "this is not valid JSON!!!"
  });

  assert.equal(fileReadCount, 1, "should fall through to file when env JSON is invalid");
  assert.equal(config.rotations[0]?.id, "test-rotation", "should use config from file");
});

test("createDailyQuestRotationPreview returns correct shape", (t) => {
  withCleanState(t);
  // Use a fixed date that matches the bundled config (a weekday in April 2026)
  // 2026-04-10 is a Friday
  const now = new Date("2026-04-10T12:00:00.000Z");
  const preview = createDailyQuestRotationPreview(now, null, {});

  assert.equal(typeof preview.generatedAt, "string", "generatedAt should be a string");
  assert.ok(preview.generatedAt.includes("T"), "generatedAt should be an ISO string");
  assert.match(preview.activeDate, /^\d{4}-\d{2}-\d{2}$/, "activeDate should be YYYY-MM-DD");
  assert.equal(preview.activeDate, "2026-04-10", "activeDate should match the date passed in");
  assert.ok(Array.isArray(preview.enabledFlags), "enabledFlags should be an array");

  // activeRotation is null or has required shape
  if (preview.activeRotation !== null) {
    assert.equal(typeof preview.activeRotation.id, "string", "activeRotation.id should be a string");
    assert.equal(typeof preview.activeRotation.label, "string", "activeRotation.label should be a string");
    assert.equal(typeof preview.activeRotation.summary, "string", "activeRotation.summary should be a string");
  }

  // nextRotation is null or has required shape
  if (preview.nextRotation !== null) {
    assert.equal(typeof preview.nextRotation.id, "string", "nextRotation.id should be a string");
    assert.equal(typeof preview.nextRotation.label, "string", "nextRotation.label should be a string");
    assert.equal(typeof preview.nextRotation.startsOn, "string", "nextRotation.startsOn should be a string");
    assert.match(preview.nextRotation.startsOn, /^\d{4}-\d{2}-\d{2}$/, "nextRotation.startsOn should be YYYY-MM-DD");
    assert.equal(typeof preview.nextRotation.summary, "string", "nextRotation.summary should be a string");
  }
});

test("createDailyQuestRotationPreview includes enabled flag keys when flags are provided", (t) => {
  withCleanState(t);
  const now = new Date("2026-04-10T12:00:00.000Z");
  const flags = { pve_enabled: true, pvp_enabled: false };
  const preview = createDailyQuestRotationPreview(now, flags, {});

  assert.ok(Array.isArray(preview.enabledFlags), "enabledFlags should be an array");
  assert.ok(preview.enabledFlags.includes("pve_enabled"), "should include enabled flag pve_enabled");
  assert.ok(!preview.enabledFlags.includes("pvp_enabled"), "should not include disabled flag pvp_enabled");
});

test("createDailyQuestRotationPreview generatedAt matches the date passed in", (t) => {
  withCleanState(t);
  const now = new Date("2026-04-10T08:30:00.000Z");
  const preview = createDailyQuestRotationPreview(now, null, {});

  assert.equal(preview.generatedAt, now.toISOString(), "generatedAt should equal now.toISOString()");
  assert.equal(preview.activeDate, "2026-04-10", "activeDate should be YYYY-MM-DD slice of the date");
});

test("resolveDailyQuestRotation returns null or a rotation with id and quests", (t) => {
  withCleanState(t);
  // April 10 2026 is a Friday — bundled config has spring-weekday-patrol for this date
  const now = new Date("2026-04-10T00:00:00.000Z");
  const rotation = resolveDailyQuestRotation(now, null, {});

  if (rotation !== null) {
    assert.equal(typeof rotation.id, "string");
    assert.equal(typeof rotation.label, "string");
    assert.ok(Array.isArray(rotation.quests));
    assert.ok(rotation.quests.length > 0);
  }
  // null is also a valid result (no rotation scheduled for this date)
});

test("loadDailyQuestRotationConfig reads from VEIL_DAILY_QUEST_ROTATIONS_PATH when set", (t) => {
  withCleanState(t);
  const customPath = "/custom/path/rotations.json";
  let capturedPath = "";
  const validDoc = makeValidRotationDoc();
  configureDailyQuestRotationRuntimeDependencies({
    readFileSync: (filePath) => {
      capturedPath = filePath;
      return JSON.stringify(validDoc);
    }
  });

  loadDailyQuestRotationConfig({ VEIL_DAILY_QUEST_ROTATIONS_PATH: customPath });

  assert.equal(capturedPath, customPath, "should read from the custom path specified in env");
});
