import assert from "node:assert/strict";
import test from "node:test";
import { buildBattleEnterCopy, buildBattleExitCopy } from "../assets/scripts/cocos-battle-transition-copy";
import type { PlayerTileView, SessionUpdate, TerrainType, WorldEvent } from "../assets/scripts/VeilCocosSession";

function createTile(position: { x: number; y: number }, terrain: TerrainType): PlayerTileView {
  return {
    position,
    fog: "visible",
    terrain,
    walkable: terrain !== "water",
    resource: undefined,
    occupant: undefined,
    building: undefined
  };
}

function createBattleEnterUpdate(event: WorldEvent, terrain: TerrainType, encounterPosition: { x: number; y: number }): SessionUpdate {
  return {
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day: 1
      },
      map: {
        width: 8,
        height: 8,
        tiles: [createTile(encounterPosition, terrain)]
      },
      ownHeroes: [
        {
          id: "hero-1",
          playerId: "player-1",
          name: "Katherine",
          position: { x: 1, y: 1 },
          vision: 4,
          move: {
            total: 6,
            remaining: 4
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
    battle: {
      id: event.type === "battle.started" ? event.battleId : "battle-unknown",
      round: 1,
      lanes: 1,
      activeUnitId: null,
      turnOrder: [],
      units: {},
      environment: [],
      log: [],
      rng: {
        seed: 1,
        cursor: 0
      },
      worldHeroId: "hero-1",
      encounterPosition
    },
    events: [event],
    movementPlan: null,
    reachableTiles: []
  };
}

test("buildBattleEnterCopy distinguishes pve and pvp encounters", () => {
  const neutralEnter = buildBattleEnterCopy(createBattleEnterUpdate(
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-7",
      initiator: "neutral",
      battleId: "battle-1",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    },
    "dirt",
    { x: 5, y: 4 }
  ));
  assert.deepEqual(neutralEnter, {
    badge: "AMBUSH",
    title: "中立守军主动来袭",
    subtitle: "荒地战场 · 目标 neutral-7 · 坐标 (5,4)",
    tone: "enter",
    terrain: "dirt",
    detailChips: []
  });

  const heroEnter = buildBattleEnterCopy(createBattleEnterUpdate(
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "hero",
      defenderHeroId: "hero-2",
      initiator: "hero",
      battleId: "battle-2",
      path: [{ x: 3, y: 4 }, { x: 3, y: 5 }],
      moveCost: 1
    },
    "grass",
    { x: 3, y: 5 }
  ));
  assert.deepEqual(heroEnter, {
    badge: "PVP",
    title: "敌方英雄 hero-2",
    subtitle: "草野战场 · 坐标 (3,5) · 双方部队展开接战",
    tone: "enter",
    terrain: "grass",
    detailChips: []
  });
});

test("buildBattleExitCopy summarizes rewards and progression", () => {
  const events: WorldEvent[] = [
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: {
        kind: "gold",
        amount: 300
      }
    },
    {
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-1",
      battleKind: "neutral",
      experienceGained: 120,
      totalExperience: 120,
      level: 2,
      levelsGained: 1,
      skillPointsAwarded: 1,
      availableSkillPoints: 1
    }
  ];

  const update = createBattleEnterUpdate(
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-7",
      initiator: "hero",
      battleId: "battle-1",
      path: [{ x: 4, y: 4 }, { x: 5, y: 4 }],
      moveCost: 1
    },
    "dirt",
    { x: 5, y: 4 }
  );
  update.events = events;

  assert.deepEqual(buildBattleExitCopy(update.battle, update, true), {
    badge: "VICTORY",
    title: "战斗胜利",
    subtitle: "荒地战场 · 坐标 (5,4) · 返回世界地图，继续推进前线",
    tone: "victory",
    terrain: "dirt",
    detailChips: [
      { icon: "gold", label: "金币 +300" },
      { icon: "hero", label: "Lv 2" }
    ]
  });

  assert.deepEqual(buildBattleExitCopy(update.battle, update, false), {
    badge: "RETREAT",
    title: "战斗失利",
    subtitle: "荒地战场 · 坐标 (5,4) · 部队需要整顿后再战",
    tone: "defeat",
    terrain: "dirt",
    detailChips: [
      { icon: "gold", label: "金币 +300" },
      { icon: "hero", label: "Lv 2" }
    ]
  });
});

test("buildBattleExitCopy prioritizes level and equipment chips when rewards overflow", () => {
  const update = createBattleEnterUpdate(
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-9",
      initiator: "hero",
      battleId: "battle-2",
      path: [{ x: 4, y: 3 }, { x: 5, y: 3 }],
      moveCost: 1
    },
    "sand",
    { x: 5, y: 3 }
  );
  update.events = [
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: {
        kind: "gold",
        amount: 250
      }
    },
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: {
        kind: "wood",
        amount: 5
      }
    },
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: {
        kind: "ore",
        amount: 3
      }
    },
    {
      type: "hero.equipmentFound",
      heroId: "hero-1",
      battleId: "battle-2",
      battleKind: "neutral",
      equipmentId: "ember-crown",
      equipmentName: "余烬王冠",
      rarity: "epic"
    },
    {
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-2",
      battleKind: "neutral",
      experienceGained: 160,
      totalExperience: 160,
      level: 2,
      levelsGained: 1,
      skillPointsAwarded: 1,
      availableSkillPoints: 1
    }
  ];

  assert.deepEqual(buildBattleExitCopy(update.battle, update, true), {
    badge: "VICTORY",
    title: "战斗胜利",
    subtitle: "沙原战场 · 坐标 (5,3) · 返回世界地图，继续推进前线",
    tone: "victory",
    terrain: "sand",
    detailChips: [
      { icon: "battle", label: "史诗 余烬王冠" },
      { icon: "hero", label: "Lv 2" },
      { icon: "gold", label: "金币 +250" }
    ]
  });
});

test("buildBattleExitCopy marks overflowed equipment so failed pickups stay visible", () => {
  const update = createBattleEnterUpdate(
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-9",
      initiator: "hero",
      battleId: "battle-3",
      path: [{ x: 4, y: 3 }, { x: 5, y: 3 }],
      moveCost: 1
    },
    "sand",
    { x: 5, y: 3 }
  );
  update.events = [
    {
      type: "hero.equipmentFound",
      heroId: "hero-1",
      battleId: "battle-3",
      battleKind: "neutral",
      equipmentId: "ember-crown",
      equipmentName: "余烬王冠",
      rarity: "epic",
      overflowed: true
    }
  ];

  assert.deepEqual(buildBattleExitCopy(update.battle, update, true), {
    badge: "VICTORY",
    title: "战斗胜利",
    subtitle: "沙原战场 · 坐标 (5,3) · 返回世界地图，继续推进前线",
    tone: "victory",
    terrain: "sand",
    detailChips: [
      { icon: "battle", label: "未拾取 余烬王冠" }
    ]
  });
});
