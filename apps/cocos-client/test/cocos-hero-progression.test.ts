import assert from "node:assert/strict";
import test from "node:test";
import { buildHeroProgressNotice } from "../assets/scripts/cocos-hero-progression";

test("buildHeroProgressNotice summarizes hero level up and skill prompt", () => {
  const notice = buildHeroProgressNotice(
    {
      world: {
        meta: {
          roomId: "room-alpha",
          seed: 1001,
          day: 1
        },
        map: {
          width: 1,
          height: 1,
          tiles: []
        },
        ownHeroes: [
          {
            id: "hero-1",
            playerId: "player-1",
            name: "凯琳",
            position: { x: 0, y: 0 },
            vision: 2,
            move: { total: 6, remaining: 6 },
            stats: {
              attack: 3,
              defense: 3,
              power: 1,
              knowledge: 1,
              hp: 30,
              maxHp: 32
            },
            progression: {
              level: 2,
              experience: 140,
              skillPoints: 1,
              battlesWon: 1,
              neutralBattlesWon: 1,
              pvpBattlesWon: 0
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
      events: [
        {
          type: "hero.progressed" as const,
          heroId: "hero-1",
          battleId: "battle-1",
          battleKind: "neutral" as const,
          experienceGained: 140,
          totalExperience: 140,
          level: 2,
          levelsGained: 1,
          skillPointsAwarded: 1,
          availableSkillPoints: 1
        }
      ],
      movementPlan: null,
      reachableTiles: [],
      reason: undefined
    },
    "hero-1"
  );

  assert.deepEqual(notice, {
    title: "升级到 Lv 2",
    detail: "获得 140 XP，当前 40/175 XP。可立即学习新技能，剩余技能点 1。"
  });
});
