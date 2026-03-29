import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosHudSkillPanelView } from "../assets/scripts/cocos-hud-skill-panel.ts";
import type { PlayerTileView, SessionUpdate, TerrainType } from "../assets/scripts/VeilCocosSession.ts";

function createTile(position: { x: number; y: number }, terrain: TerrainType = "grass"): PlayerTileView {
  return {
    position,
    fog: "visible",
    terrain,
    walkable: true,
    resource: undefined,
    occupant: undefined,
    building: undefined
  };
}

function createBaseUpdate(skillPoints = 1): SessionUpdate {
  return {
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day: 1
      },
      map: {
        width: 1,
        height: 1,
        tiles: [createTile({ x: 0, y: 0 })]
      },
      ownHeroes: [
        {
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
            level: 2,
            experience: 140,
            skillPoints,
            battlesWon: 1,
            neutralBattlesWon: 1,
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
          learnedSkills: []
        }
      ],
      visibleHeroes: [],
      resources: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      playerId: "player-1"
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: []
  };
}

test("buildCocosHudSkillPanelView shows learnable skills and wires callback IDs", () => {
  const learnedSkillIds: string[] = [];
  const view = buildCocosHudSkillPanelView(createBaseUpdate(1), (skillId) => {
    learnedSkillIds.push(skillId);
  });

  assert.equal(view.lines[0], "学习新技能  3 项");
  assert.match(view.lines[1]!, /战旗号令 · 战阵 · 消耗 1 技能点 · 解锁 号令突进/);
  assert.match(view.lines[2]!, /盾墙教范 · 壁垒 · 消耗 1 技能点 · 解锁 持盾列阵/);
  assert.match(view.lines[3]!, /战地炼护 · 秘仪 · 消耗 1 技能点 · 解锁 护甲术/);
  assert.deepEqual(
    view.actions.map((action) => ({ skillId: action.skillId, label: action.label })),
    [
      { skillId: "war_banner", label: "学习 战旗号令" },
      { skillId: "shield_discipline", label: "学习 盾墙教范" },
      { skillId: "field_alchemy", label: "学习 战地炼护" }
    ]
  );

  view.actions[0]?.onSelect?.();
  assert.deepEqual(learnedSkillIds, ["war_banner"]);
});

test("buildCocosHudSkillPanelView hides learnable skill entries without skill points", () => {
  const view = buildCocosHudSkillPanelView(createBaseUpdate(0));

  assert.deepEqual(view.lines, [
    "学习新技能",
    "英雄升级后获得技能点，可在这里学习新的战斗能力。"
  ]);
  assert.equal(view.actions.length, 0);
  assert.equal(view.lines.some((line) => line.includes("战旗号令")), false);
  assert.equal(view.lines.some((line) => line.includes("消耗 1 技能点")), false);
});
