import assert from "node:assert/strict";
import test from "node:test";
import {
  validateHeroSkillSelection,
  applyHeroSkillSelection,
  heroSkillRankFor,
  createHeroSkillBonusSummary,
  grantedHeroBattleSkillIds
} from "../src/hero-skills.ts";
import type { HeroSkillTreeConfig, HeroState } from "../src/models.ts";

// ──────────────────────────────────────────────────────────
// Minimal skill tree fixture (no external file dependency)
// ──────────────────────────────────────────────────────────

const STUB_TREE: HeroSkillTreeConfig = {
  branches: [
    { id: "warpath", name: "战阵", description: "攻击型技能分支" },
    { id: "arcane", name: "奥术", description: "魔法型技能分支" }
  ],
  skills: [
    {
      id: "war_banner",
      branchId: "warpath",
      name: "战旗号令",
      description: "提升攻击力",
      requiredLevel: 2,
      maxRank: 2,
      prerequisites: [],
      ranks: [
        { rank: 1, description: "Rank 1", battleSkillIds: ["commanding_shout"], statBonuses: { attack: 1 } },
        { rank: 2, description: "Rank 2", battleSkillIds: ["rending_mark"], statBonuses: { attack: 1 } }
      ]
    },
    {
      id: "spearhead_assault",
      branchId: "warpath",
      name: "矛尖突击",
      description: "需要前置技能",
      requiredLevel: 4,
      maxRank: 1,
      prerequisites: ["war_banner"],
      ranks: [
        { rank: 1, description: "Rank 1", battleSkillIds: ["pierce_line"], statBonuses: { attack: 2 } }
      ]
    },
    {
      id: "mana_flow",
      branchId: "arcane",
      name: "魔力涌动",
      description: "提升知识与力量",
      requiredLevel: 2,
      maxRank: 1,
      prerequisites: [],
      ranks: [
        { rank: 1, description: "Rank 1", battleSkillIds: [], statBonuses: { knowledge: 1, power: 1 } }
      ]
    }
  ]
};

// ──────────────────────────────────────────────────────────
// Hero fixture helpers
// ──────────────────────────────────────────────────────────

function makeHero(overrides: Partial<HeroState> = {}): HeroState {
  return {
    id: "hero-1",
    playerId: "player-1",
    name: "Aria",
    position: { x: 0, y: 0 },
    vision: 3,
    move: { remaining: 3, max: 3 },
    stats: { attack: 5, defense: 4, power: 3, knowledge: 2, hp: 30, maxHp: 30 },
    progression: { level: 2, experience: 100, skillPoints: 1, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 },
    loadout: {
      learnedSkills: [],
      equipment: { weaponId: undefined, armorId: undefined, accessoryId: undefined, trinketIds: [] },
      inventory: []
    },
    armyTemplateId: "pikeman",
    armyCount: 10,
    learnedSkills: [],
    ...overrides
  };
}

// ──────────────────────────────────────────────────────────
// heroSkillRankFor
// ──────────────────────────────────────────────────────────

test("heroSkillRankFor: returns 0 when hero has no learned skills", () => {
  const hero = makeHero();
  assert.equal(heroSkillRankFor(hero, "war_banner"), 0);
});

test("heroSkillRankFor: returns correct rank for a learned skill", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 2 }] });
  assert.equal(heroSkillRankFor(hero, "war_banner"), 2);
});

test("heroSkillRankFor: returns 0 for an unknown skill even when hero has other skills", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 1 }] });
  assert.equal(heroSkillRankFor(hero, "nonexistent_skill"), 0);
});

// ──────────────────────────────────────────────────────────
// validateHeroSkillSelection — rejection cases
// ──────────────────────────────────────────────────────────

test("validateHeroSkillSelection: rejects unknown skill id", () => {
  const result = validateHeroSkillSelection(makeHero(), "ghost_skill", STUB_TREE);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "hero_skill_not_found");
});

test("validateHeroSkillSelection: rejects when hero has no skill points", () => {
  const hero = makeHero({ progression: { level: 2, experience: 100, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  const result = validateHeroSkillSelection(hero, "war_banner", STUB_TREE);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "not_enough_skill_points");
});

test("validateHeroSkillSelection: rejects when hero level is below requiredLevel", () => {
  const hero = makeHero({ progression: { level: 1, experience: 0, skillPoints: 1, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  const result = validateHeroSkillSelection(hero, "war_banner", STUB_TREE);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "hero_level_too_low");
});

test("validateHeroSkillSelection: rejects when skill is already at max rank", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 2 }] });
  const result = validateHeroSkillSelection(hero, "war_banner", STUB_TREE);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "skill_max_rank_reached");
});

test("validateHeroSkillSelection: rejects when prerequisite skill is not learned", () => {
  const hero = makeHero({
    progression: { level: 4, experience: 0, skillPoints: 1, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 }
  });
  const result = validateHeroSkillSelection(hero, "spearhead_assault", STUB_TREE);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "skill_prerequisite_missing");
});

// ──────────────────────────────────────────────────────────
// validateHeroSkillSelection — acceptance cases
// ──────────────────────────────────────────────────────────

test("validateHeroSkillSelection: accepts valid first rank of a no-prerequisite skill", () => {
  const result = validateHeroSkillSelection(makeHero(), "war_banner", STUB_TREE);
  assert.equal(result.valid, true);
});

test("validateHeroSkillSelection: accepts upgrade to rank 2 when rank 1 is already learned", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 1 }] });
  const result = validateHeroSkillSelection(hero, "war_banner", STUB_TREE);
  assert.equal(result.valid, true);
});

test("validateHeroSkillSelection: accepts skill with prerequisite when prerequisite is satisfied", () => {
  const hero = makeHero({
    progression: { level: 4, experience: 0, skillPoints: 1, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 },
    learnedSkills: [{ skillId: "war_banner", rank: 1 }]
  });
  const result = validateHeroSkillSelection(hero, "spearhead_assault", STUB_TREE);
  assert.equal(result.valid, true);
});

// ──────────────────────────────────────────────────────────
// applyHeroSkillSelection
// ──────────────────────────────────────────────────────────

test("applyHeroSkillSelection: throws when validation fails", () => {
  const hero = makeHero({ progression: { level: 1, experience: 0, skillPoints: 0, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  assert.throws(() => applyHeroSkillSelection(hero, "war_banner", STUB_TREE));
});

test("applyHeroSkillSelection: increments skill rank from 0 to 1", () => {
  const hero = makeHero();
  const result = applyHeroSkillSelection(hero, "war_banner", STUB_TREE);
  assert.equal(result.newRank, 1);
  assert.equal(heroSkillRankFor(result.hero, "war_banner"), 1);
});

test("applyHeroSkillSelection: increments skill rank from 1 to 2", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 1 }] });
  const result = applyHeroSkillSelection(hero, "war_banner", STUB_TREE);
  assert.equal(result.newRank, 2);
  assert.equal(heroSkillRankFor(result.hero, "war_banner"), 2);
});

test("applyHeroSkillSelection: deducts one skill point", () => {
  const hero = makeHero({ progression: { level: 2, experience: 100, skillPoints: 3, battlesWon: 0, neutralBattlesWon: 0, pvpBattlesWon: 0 } });
  const result = applyHeroSkillSelection(hero, "war_banner", STUB_TREE);
  assert.equal(result.hero.progression.skillPoints, 2);
});

test("applyHeroSkillSelection: applies stat bonus from the gained rank", () => {
  const hero = makeHero({ stats: { attack: 5, defense: 4, power: 3, knowledge: 2, hp: 30, maxHp: 30 } });
  const result = applyHeroSkillSelection(hero, "war_banner", STUB_TREE);
  // war_banner rank 1 grants +1 attack
  assert.equal(result.hero.stats.attack, 6);
});

test("applyHeroSkillSelection: returns branch info for the selected skill", () => {
  const hero = makeHero();
  const result = applyHeroSkillSelection(hero, "war_banner", STUB_TREE);
  assert.equal(result.branch.id, "warpath");
});

test("applyHeroSkillSelection: lists newly granted battle skill ids at rank 1", () => {
  const hero = makeHero();
  const result = applyHeroSkillSelection(hero, "war_banner", STUB_TREE);
  assert.ok(result.newlyGrantedBattleSkillIds.includes("commanding_shout"));
});

test("applyHeroSkillSelection: lists only the newly added battle skill at rank 2", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 1 }] });
  const result = applyHeroSkillSelection(hero, "war_banner", STUB_TREE);
  // rank 2 grants "rending_mark" and should NOT re-list "commanding_shout"
  assert.ok(result.newlyGrantedBattleSkillIds.includes("rending_mark"));
  assert.ok(!result.newlyGrantedBattleSkillIds.includes("commanding_shout"));
});

// ──────────────────────────────────────────────────────────
// createHeroSkillBonusSummary
// ──────────────────────────────────────────────────────────

test("createHeroSkillBonusSummary: returns all-zero bonuses for hero with no skills", () => {
  const bonuses = createHeroSkillBonusSummary(makeHero(), STUB_TREE);
  assert.deepEqual(bonuses, { attack: 0, defense: 0, power: 0, knowledge: 0, maxHp: 0 });
});

test("createHeroSkillBonusSummary: accumulates attack bonus from war_banner rank 1", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 1 }] });
  const bonuses = createHeroSkillBonusSummary(hero, STUB_TREE);
  assert.equal(bonuses.attack, 1);
});

test("createHeroSkillBonusSummary: accumulates attack bonus from war_banner rank 2 (2x +1)", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 2 }] });
  const bonuses = createHeroSkillBonusSummary(hero, STUB_TREE);
  assert.equal(bonuses.attack, 2);
});

test("createHeroSkillBonusSummary: accumulates bonuses across multiple skills", () => {
  const hero = makeHero({
    learnedSkills: [
      { skillId: "war_banner", rank: 1 },
      { skillId: "mana_flow", rank: 1 }
    ]
  });
  const bonuses = createHeroSkillBonusSummary(hero, STUB_TREE);
  assert.equal(bonuses.attack, 1);
  assert.equal(bonuses.knowledge, 1);
  assert.equal(bonuses.power, 1);
});

test("createHeroSkillBonusSummary: ignores unknown skill ids silently", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "ghost_skill_id", rank: 1 }] });
  const bonuses = createHeroSkillBonusSummary(hero, STUB_TREE);
  assert.deepEqual(bonuses, { attack: 0, defense: 0, power: 0, knowledge: 0, maxHp: 0 });
});

// ──────────────────────────────────────────────────────────
// grantedHeroBattleSkillIds
// ──────────────────────────────────────────────────────────

test("grantedHeroBattleSkillIds: returns empty array for hero with no skills", () => {
  const ids = grantedHeroBattleSkillIds(makeHero(), STUB_TREE);
  assert.deepEqual(ids, []);
});

test("grantedHeroBattleSkillIds: returns battle skill from rank 1 war_banner", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 1 }] });
  const ids = grantedHeroBattleSkillIds(hero, STUB_TREE);
  assert.ok(ids.includes("commanding_shout"));
});

test("grantedHeroBattleSkillIds: returns both battle skills from rank 2 war_banner without duplicates", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "war_banner", rank: 2 }] });
  const ids = grantedHeroBattleSkillIds(hero, STUB_TREE);
  assert.ok(ids.includes("commanding_shout"));
  assert.ok(ids.includes("rending_mark"));
  assert.equal(new Set(ids).size, ids.length, "no duplicate battle skill ids");
});

test("grantedHeroBattleSkillIds: mana_flow rank 1 grants no battle skill ids", () => {
  const hero = makeHero({ learnedSkills: [{ skillId: "mana_flow", rank: 1 }] });
  const ids = grantedHeroBattleSkillIds(hero, STUB_TREE);
  assert.deepEqual(ids, []);
});
