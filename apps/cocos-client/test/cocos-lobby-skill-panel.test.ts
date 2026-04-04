import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLobbySkillPanelView,
  toLobbySkillPanelHeroState
} from "../assets/scripts/cocos-lobby-skill-panel.ts";
import { getRuntimeConfigBundleForRoom } from "../assets/scripts/project-shared/index.ts";
import type { HeroView } from "../assets/scripts/VeilCocosSession.ts";

function createHero(skillPoints: number): HeroView {
  return {
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 },
    vision: 4,
    move: {
      total: 6,
      remaining: 6
    },
    stats: {
      attack: 2,
      defense: 2,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    progression: {
      level: 3,
      experience: 210,
      skillPoints,
      battlesWon: 2,
      neutralBattlesWon: 2,
      pvpBattlesWon: 0
    },
    loadout: {
      learnedSkills: [],
      equipment: {
        trinketIds: []
      },
      inventory: []
    },
    armyCount: 12,
    armyTemplateId: "hero_guard_basic",
    learnedSkills: [
      { skillId: "war_banner", rank: 1 },
      { skillId: "field_alchemy", rank: 1 }
    ]
  };
}

test("buildLobbySkillPanelView renders available and locked skill actions for a level 3 hero with two spent points", () => {
  const view = buildLobbySkillPanelView(
    toLobbySkillPanelHeroState(createHero(1)),
    getRuntimeConfigBundleForRoom("room-alpha", 1001)
  );
  const actionsBySkillId = new Map(view.actions.map((action) => [action.skillId, action]));
  const warpath = view.branches.find((branch) => branch.id === "warpath");
  const arcanum = view.branches.find((branch) => branch.id === "arcanum");

  assert.equal(view.level, 3);
  assert.equal(view.availableSkillPoints, 1);
  assert.equal(actionsBySkillId.get("war_banner")?.canLearn, true);
  assert.equal(actionsBySkillId.get("spearhead_assault")?.canLearn, true);
  assert.equal(actionsBySkillId.get("shield_discipline")?.canLearn, true);
  assert.equal(actionsBySkillId.get("crippling_hex")?.canLearn, true);
  assert.equal(actionsBySkillId.get("field_alchemy")?.canLearn, false);
  assert.equal(actionsBySkillId.get("guardian_oath_training")?.canLearn, false);
  assert.match(actionsBySkillId.get("war_banner")?.label ?? "", /升级 战旗号令 R2/);
  assert.match(
    warpath?.skills.find((skill) => skill.skillId === "spearhead_assault")?.summary ?? "",
    /R1/
  );
  assert.match(
    arcanum?.skills.find((skill) => skill.skillId === "field_alchemy")?.summary ?? "",
    /已满级/
  );
});

test("buildLobbySkillPanelView marks every learn action unavailable when the hero has no skill points", () => {
  const view = buildLobbySkillPanelView(
    toLobbySkillPanelHeroState(createHero(0)),
    getRuntimeConfigBundleForRoom("room-alpha", 1001)
  );

  assert.equal(view.availableSkillPoints, 0);
  assert.equal(view.actions.some((action) => action.canLearn), false);
});
