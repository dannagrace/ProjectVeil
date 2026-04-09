import assert from "node:assert/strict";
import test from "node:test";
import {
  validateDailyDungeonDefinition,
  validateDailyDungeonConfigDocument
} from "../src/daily-dungeons.ts";
import type { DailyDungeonDefinition } from "../src/models.ts";

function makeFloor(overrides: Partial<{
  floor: number;
  recommendedHeroLevel: number;
  enemyArmyTemplateId: string;
  enemyArmyCount: number;
  enemyStatMultiplier: number;
  reward: { gems?: number; resources?: { gold?: number; wood?: number; ore?: number } };
}> = {}) {
  return {
    floor: 1,
    recommendedHeroLevel: 3,
    enemyArmyTemplateId: "skeleton-archer",
    enemyArmyCount: 5,
    enemyStatMultiplier: 1.0,
    reward: { gems: 10 },
    ...overrides
  };
}

function makeDungeon(overrides: Partial<DailyDungeonDefinition> = {}): DailyDungeonDefinition {
  return {
    id: "dungeon-weekly-1",
    name: "骷髅地下城",
    description: "首个每周地下城关卡。",
    attemptLimit: 3,
    activeWindow: { startDate: "2026-04-07", endDate: "2026-04-13" },
    floors: [makeFloor()],
    ...overrides
  };
}

// ──────────────────────────────────────────────────────────
// validateDailyDungeonDefinition
// ──────────────────────────────────────────────────────────

test("validateDailyDungeonDefinition: valid single-floor dungeon returns no issues", () => {
  const issues = validateDailyDungeonDefinition(makeDungeon());
  assert.deepEqual(issues, []);
});

test("validateDailyDungeonDefinition: valid multi-floor dungeon returns no issues", () => {
  const dungeon = makeDungeon({
    floors: [
      makeFloor({ floor: 1, reward: { gems: 10 } }),
      makeFloor({ floor: 2, recommendedHeroLevel: 5, enemyStatMultiplier: 1.3, reward: { gems: 20 } }),
      makeFloor({ floor: 3, recommendedHeroLevel: 8, enemyStatMultiplier: 1.7, reward: { resources: { gold: 200 } } })
    ]
  });
  assert.deepEqual(validateDailyDungeonDefinition(dungeon), []);
});

test("validateDailyDungeonDefinition: empty id is rejected", () => {
  const issues = validateDailyDungeonDefinition(makeDungeon({ id: "   " }));
  assert.ok(issues.some((i) => i.path.endsWith(".id")), "expected id error");
});

test("validateDailyDungeonDefinition: empty name is rejected", () => {
  const issues = validateDailyDungeonDefinition(makeDungeon({ name: "" }));
  assert.ok(issues.some((i) => i.path.endsWith(".name")));
});

test("validateDailyDungeonDefinition: empty description is rejected", () => {
  const issues = validateDailyDungeonDefinition(makeDungeon({ description: "  " }));
  assert.ok(issues.some((i) => i.path.endsWith(".description")));
});

test("validateDailyDungeonDefinition: zero attemptLimit is rejected", () => {
  const issues = validateDailyDungeonDefinition(makeDungeon({ attemptLimit: 0 }));
  assert.ok(issues.some((i) => i.path.endsWith(".attemptLimit")));
});

test("validateDailyDungeonDefinition: non-integer attemptLimit is rejected", () => {
  const issues = validateDailyDungeonDefinition(makeDungeon({ attemptLimit: 1.5 }));
  assert.ok(issues.some((i) => i.path.endsWith(".attemptLimit")));
});

test("validateDailyDungeonDefinition: invalid startDate format is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ activeWindow: { startDate: "07-04-2026", endDate: "2026-04-13" } })
  );
  assert.ok(issues.some((i) => i.path.includes("startDate")));
});

test("validateDailyDungeonDefinition: invalid endDate format is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ activeWindow: { startDate: "2026-04-07", endDate: "not-a-date" } })
  );
  assert.ok(issues.some((i) => i.path.includes("endDate")));
});

test("validateDailyDungeonDefinition: startDate after endDate is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ activeWindow: { startDate: "2026-04-14", endDate: "2026-04-07" } })
  );
  assert.ok(issues.some((i) => i.message.includes("startDate cannot be later")));
});

test("validateDailyDungeonDefinition: window spanning more than 7 days is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ activeWindow: { startDate: "2026-04-07", endDate: "2026-04-15" } })
  );
  assert.ok(issues.some((i) => i.message.includes("7 calendar days")));
});

test("validateDailyDungeonDefinition: window spanning fewer than 7 days is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ activeWindow: { startDate: "2026-04-07", endDate: "2026-04-11" } })
  );
  assert.ok(issues.some((i) => i.message.includes("7 calendar days")));
});

test("validateDailyDungeonDefinition: empty floors array is rejected", () => {
  const issues = validateDailyDungeonDefinition(makeDungeon({ floors: [] }));
  assert.ok(issues.some((i) => i.path.endsWith(".floors")));
});

test("validateDailyDungeonDefinition: floor with zero enemyArmyCount is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ floors: [makeFloor({ enemyArmyCount: 0 })] })
  );
  assert.ok(issues.some((i) => i.message.includes("enemyArmyCount")));
});

test("validateDailyDungeonDefinition: floor with non-positive enemyStatMultiplier is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ floors: [makeFloor({ enemyStatMultiplier: 0 })] })
  );
  assert.ok(issues.some((i) => i.message.includes("enemyStatMultiplier")));
});

test("validateDailyDungeonDefinition: floor with negative enemyStatMultiplier is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ floors: [makeFloor({ enemyStatMultiplier: -0.5 })] })
  );
  assert.ok(issues.some((i) => i.message.includes("enemyStatMultiplier")));
});

test("validateDailyDungeonDefinition: floor with empty enemyArmyTemplateId is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ floors: [makeFloor({ enemyArmyTemplateId: "" })] })
  );
  assert.ok(issues.some((i) => i.message.includes("enemyArmyTemplateId")));
});

test("validateDailyDungeonDefinition: floor with zero recommendedHeroLevel is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ floors: [makeFloor({ recommendedHeroLevel: 0 })] })
  );
  assert.ok(issues.some((i) => i.message.includes("recommendedHeroLevel")));
});

test("validateDailyDungeonDefinition: floor reward with no gems or resources is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ floors: [makeFloor({ reward: {} })] })
  );
  assert.ok(issues.some((i) => i.message.includes("reward")));
});

test("validateDailyDungeonDefinition: floor reward with only zero resources is rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ floors: [makeFloor({ reward: { resources: { gold: 0, wood: 0, ore: 0 } } })] })
  );
  assert.ok(issues.some((i) => i.message.includes("reward")));
});

test("validateDailyDungeonDefinition: floor reward with positive gold resource is accepted", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({ floors: [makeFloor({ reward: { resources: { gold: 100 } } })] })
  );
  assert.deepEqual(issues, []);
});

test("validateDailyDungeonDefinition: duplicate floor numbers are rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({
      floors: [
        makeFloor({ floor: 1, reward: { gems: 10 } }),
        makeFloor({ floor: 1, recommendedHeroLevel: 5, reward: { gems: 20 } })
      ]
    })
  );
  assert.ok(issues.some((i) => i.message.includes("Duplicate floor number")));
});

test("validateDailyDungeonDefinition: non-sequential floor numbers are rejected", () => {
  const issues = validateDailyDungeonDefinition(
    makeDungeon({
      floors: [
        makeFloor({ floor: 1, reward: { gems: 10 } }),
        makeFloor({ floor: 3, recommendedHeroLevel: 5, reward: { gems: 20 } })
      ]
    })
  );
  assert.ok(issues.some((i) => i.message.includes("sequential")));
});

test("validateDailyDungeonDefinition: uses custom path prefix in issue paths", () => {
  const issues = validateDailyDungeonDefinition(makeDungeon({ name: "" }), "root.dungeons[2]");
  assert.ok(issues.every((i) => i.path.startsWith("root.dungeons[2]")));
});

// ──────────────────────────────────────────────────────────
// validateDailyDungeonConfigDocument
// ──────────────────────────────────────────────────────────

test("validateDailyDungeonConfigDocument: valid document with one dungeon returns no issues", () => {
  const issues = validateDailyDungeonConfigDocument({ dungeons: [makeDungeon()] });
  assert.deepEqual(issues, []);
});

test("validateDailyDungeonConfigDocument: empty dungeons array returns one issue", () => {
  const issues = validateDailyDungeonConfigDocument({ dungeons: [] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.path, "dungeons");
});

test("validateDailyDungeonConfigDocument: duplicate dungeon ids are rejected", () => {
  const issues = validateDailyDungeonConfigDocument({
    dungeons: [
      makeDungeon({ id: "dungeon-a", activeWindow: { startDate: "2026-04-07", endDate: "2026-04-13" } }),
      makeDungeon({ id: "dungeon-a", activeWindow: { startDate: "2026-04-14", endDate: "2026-04-20" } })
    ]
  });
  assert.ok(issues.some((i) => i.message.includes('Duplicate dungeon id "dungeon-a"')));
});

test("validateDailyDungeonConfigDocument: overlapping activeWindows are rejected", () => {
  const issues = validateDailyDungeonConfigDocument({
    dungeons: [
      makeDungeon({ id: "dungeon-a", activeWindow: { startDate: "2026-04-07", endDate: "2026-04-13" } }),
      makeDungeon({ id: "dungeon-b", activeWindow: { startDate: "2026-04-10", endDate: "2026-04-16" } })
    ]
  });
  assert.ok(issues.some((i) => i.message.includes("overlaps")));
});

test("validateDailyDungeonConfigDocument: adjacent non-overlapping windows are valid", () => {
  const issues = validateDailyDungeonConfigDocument({
    dungeons: [
      makeDungeon({ id: "dungeon-a", activeWindow: { startDate: "2026-04-07", endDate: "2026-04-13" } }),
      makeDungeon({ id: "dungeon-b", activeWindow: { startDate: "2026-04-14", endDate: "2026-04-20" } })
    ]
  });
  assert.deepEqual(issues, []);
});

test("validateDailyDungeonConfigDocument: invalid dungeon definitions are surfaced with index in path", () => {
  const issues = validateDailyDungeonConfigDocument({
    dungeons: [makeDungeon({ name: "" })]
  });
  assert.ok(issues.some((i) => i.path.startsWith("dungeons[0]")));
});
