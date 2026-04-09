import assert from "node:assert/strict";
import test from "node:test";
import { createHeroProgressMeterView, createHeroAttributeBreakdown } from "../src/hero-progression.ts";
import { experienceRequiredForNextLevel, totalExperienceRequiredForLevel } from "../src/models.ts";
import type { HeroState } from "../src/models.ts";

// ──────────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────────

function makeHero(overrides: Partial<HeroState> = {}): HeroState {
  return {
    id: "hero-1",
    playerId: "player-1",
    name: "Aria",
    position: { x: 0, y: 0 },
    vision: 3,
    move: { remaining: 3, max: 3 },
    stats: {
      attack: 5,
      defense: 4,
      power: 3,
      knowledge: 2,
      hp: 30,
      maxHp: 30
    },
    progression: {
      level: 1,
      experience: 0,
      skillPoints: 0,
      battlesWon: 0,
      neutralBattlesWon: 0,
      pvpBattlesWon: 0
    },
    loadout: {
      learnedSkills: [],
      equipment: {
        weaponId: undefined,
        armorId: undefined,
        accessoryId: undefined,
        trinketIds: []
      },
      inventory: []
    },
    armyTemplateId: "pikeman",
    armyCount: 10,
    learnedSkills: [],
    ...overrides
  };
}

// ──────────────────────────────────────────────────────────
// createHeroProgressMeterView
// ──────────────────────────────────────────────────────────

test("createHeroProgressMeterView: level 1 hero at 0 xp has zero progress", () => {
  const view = createHeroProgressMeterView({ progression: { level: 1, experience: 0, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  assert.equal(view.level, 1);
  assert.equal(view.totalExperience, 0);
  assert.equal(view.currentLevelExperience, 0);
  assert.equal(view.progressRatio, 0);
});

test("createHeroProgressMeterView: nextLevelExperience equals experienceRequiredForNextLevel(1)", () => {
  const view = createHeroProgressMeterView({ progression: { level: 1, experience: 0, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  assert.equal(view.nextLevelExperience, experienceRequiredForNextLevel(1));
});

test("createHeroProgressMeterView: hero halfway through level 1 has ~0.5 progressRatio", () => {
  const halfXp = Math.floor(experienceRequiredForNextLevel(1) / 2);
  const view = createHeroProgressMeterView({ progression: { level: 1, experience: halfXp, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  assert.ok(view.progressRatio >= 0.49 && view.progressRatio <= 0.51, `expected ~0.5, got ${view.progressRatio}`);
  assert.equal(view.currentLevelExperience, halfXp);
  assert.equal(view.remainingExperience, experienceRequiredForNextLevel(1) - halfXp);
});

test("createHeroProgressMeterView: level 2 hero shows correct currentLevelExperience offset", () => {
  const level1Cost = experienceRequiredForNextLevel(1); // 100
  const overXp = level1Cost + 40; // exactly 40 into level 2
  const view = createHeroProgressMeterView({ progression: { level: 2, experience: overXp, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  assert.equal(view.level, 2);
  assert.equal(view.totalExperience, overXp);
  assert.equal(view.currentLevelExperience, 40);
  assert.equal(view.nextLevelExperience, experienceRequiredForNextLevel(2));
});

test("createHeroProgressMeterView: progressRatio is clamped to [0, 1]", () => {
  // Give more xp than needed for the level — should still cap at 1
  const view = createHeroProgressMeterView({ progression: { level: 1, experience: 9999, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  assert.ok(view.progressRatio <= 1, `progressRatio should not exceed 1, got ${view.progressRatio}`);
  assert.ok(view.progressRatio >= 0);
});

test("createHeroProgressMeterView: level 5 hero at xp base has 0 currentLevelExperience", () => {
  const baseXp = totalExperienceRequiredForLevel(5);
  const view = createHeroProgressMeterView({ progression: { level: 5, experience: baseXp, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  assert.equal(view.level, 5);
  assert.equal(view.currentLevelExperience, 0);
  assert.equal(view.progressRatio, 0);
});

test("createHeroProgressMeterView: remainingExperience plus currentLevelExperience equals nextLevelExperience", () => {
  const view = createHeroProgressMeterView({ progression: { level: 3, experience: totalExperienceRequiredForLevel(3) + 77, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  assert.equal(view.currentLevelExperience + view.remainingExperience, view.nextLevelExperience);
});

// ──────────────────────────────────────────────────────────
// createHeroAttributeBreakdown
// ──────────────────────────────────────────────────────────

test("createHeroAttributeBreakdown: returns rows for all five attributes", () => {
  const hero = makeHero();
  const rows = createHeroAttributeBreakdown(hero);
  const keys = rows.map((r) => r.key);
  assert.deepEqual(keys, ["attack", "defense", "power", "knowledge", "maxHp"]);
});

test("createHeroAttributeBreakdown: level-1 hero has no progression contribution", () => {
  const hero = makeHero({ progression: { level: 1, experience: 0, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  const rows = createHeroAttributeBreakdown(hero);
  for (const row of rows) {
    assert.equal(row.progression, 0, `expected no progression for ${row.key} at level 1`);
  }
});

test("createHeroAttributeBreakdown: level-3 hero has progression contribution of 2 for attack and defense", () => {
  const hero = makeHero({
    progression: { level: 3, experience: totalExperienceRequiredForLevel(3), skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 }
  });
  const rows = createHeroAttributeBreakdown(hero);
  const attack = rows.find((r) => r.key === "attack");
  const defense = rows.find((r) => r.key === "defense");
  const power = rows.find((r) => r.key === "power");
  assert.equal(attack?.progression, 2, "attack progression should be gainedLevels = 2");
  assert.equal(defense?.progression, 2, "defense progression should be gainedLevels = 2");
  assert.equal(power?.progression, 0, "power has no progression bonus");
});

test("createHeroAttributeBreakdown: maxHp progression is 2x gainedLevels", () => {
  const hero = makeHero({
    progression: { level: 4, experience: totalExperienceRequiredForLevel(4), skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 }
  });
  const rows = createHeroAttributeBreakdown(hero);
  const maxHpRow = rows.find((r) => r.key === "maxHp");
  assert.equal(maxHpRow?.progression, 6, "maxHp progression = 3 gainedLevels * 2");
});

test("createHeroAttributeBreakdown: formula string is non-empty for each row", () => {
  const hero = makeHero();
  const rows = createHeroAttributeBreakdown(hero);
  for (const row of rows) {
    assert.ok(row.formula.length > 0, `formula for ${row.key} should not be empty`);
  }
});

test("createHeroAttributeBreakdown: formula string includes attribute label", () => {
  const hero = makeHero();
  const rows = createHeroAttributeBreakdown(hero);
  const attackRow = rows.find((r) => r.key === "attack");
  assert.ok(attackRow?.formula.includes("攻击"), "formula should include Chinese label for attack");
});

test("createHeroAttributeBreakdown: no world arg produces zero buildings contribution", () => {
  const hero = makeHero();
  const rows = createHeroAttributeBreakdown(hero, null);
  for (const row of rows) {
    assert.equal(row.buildings, 0, `buildings should be 0 without world, got ${row.buildings} for ${row.key}`);
  }
});

test("createHeroAttributeBreakdown: no equipment produces zero equipment contribution", () => {
  const hero = makeHero();
  const rows = createHeroAttributeBreakdown(hero);
  for (const row of rows) {
    assert.equal(row.equipment, 0, `equipment should be 0 with no gear, got ${row.equipment} for ${row.key}`);
  }
});

test("createHeroAttributeBreakdown: base + progression + buildings + equipment + skills + other sums to total", () => {
  const hero = makeHero({
    progression: { level: 3, experience: totalExperienceRequiredForLevel(3), skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 }
  });
  const rows = createHeroAttributeBreakdown(hero);
  for (const row of rows) {
    const computed = row.base + row.progression + row.buildings + row.equipment + row.skills + row.other;
    assert.equal(computed, row.total, `${row.key}: base+contributions should equal total`);
  }
});

test("createHeroAttributeBreakdown: rows are always returned in canonical attribute order", () => {
  const hero1 = makeHero({ progression: { level: 1, experience: 0, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  const hero2 = makeHero({ progression: { level: 5, experience: totalExperienceRequiredForLevel(5), skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  const order = ["attack", "defense", "power", "knowledge", "maxHp"];
  assert.deepEqual(createHeroAttributeBreakdown(hero1).map((r) => r.key), order);
  assert.deepEqual(createHeroAttributeBreakdown(hero2).map((r) => r.key), order);
});
