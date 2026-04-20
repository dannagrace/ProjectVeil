import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerAchievementProgress } from "@veil/shared/event-log";
import { createDefaultHeroLoadout, createDefaultHeroProgression, type WorldState } from "@veil/shared/models";
import { applyPlayerEventLogAndAchievements } from "@server/domain/account/player-achievements";

function createTrackingWorldState(): WorldState {
  return {
    meta: {
      roomId: "room-achievement-progress",
      seed: 1001,
      day: 2
    },
    map: {
      width: 2,
      height: 2,
      tiles: [
        {
          position: { x: 0, y: 0 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 1, y: 0 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 0, y: 1 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 1, y: 1 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        }
      ]
    },
    heroes: [
      {
        id: "hero-1",
        playerId: "player-1",
        name: "暮火侦骑",
        position: { x: 0, y: 0 },
        vision: 2,
        move: { total: 6, remaining: 6 },
        stats: { attack: 2, defense: 2, power: 1, knowledge: 1, hp: 20, maxHp: 20 },
        progression: createDefaultHeroProgression(),
        loadout: createDefaultHeroLoadout(),
        armyTemplateId: "hero_guard_basic",
        armyCount: 12,
        learnedSkills: []
      }
    ],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 1, y: 1 },
        reward: undefined,
        stacks: []
      }
    },
    buildings: {},
    resources: {
      "player-1": { gold: 0, wood: 0, ore: 0 }
    },
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "explored", "hidden"]
    }
  };
}

function createSkillScholarProgress(current: number): Partial<PlayerAchievementProgress>[] {
  return [
    {
      id: "skill_scholar",
      title: "ignored",
      description: "ignored",
      metric: "skills_learned",
      current,
      target: 5,
      unlocked: false,
      progressUpdatedAt: "2026-03-27T11:59:00.000Z"
    }
  ];
}

test("player achievement tracker appends progress entries for partial milestone updates", () => {
  const updated = applyPlayerEventLogAndAchievements(
    {
      playerId: "player-1",
      displayName: "暮火侦骑",
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: createSkillScholarProgress(1),
      recentEventLog: []
    },
    createTrackingWorldState(),
    [
      {
        type: "hero.skillLearned",
        heroId: "hero-1",
        skillId: "skill-1",
        branchId: "branch-1",
        skillName: "远见",
        branchName: "战略",
        newRank: 1,
        spentPoint: 1,
        remainingSkillPoints: 0,
        newlyGrantedBattleSkillIds: []
      }
    ],
    "2026-03-27T12:00:00.000Z"
  );

  assert.equal(updated.achievements.find((achievement) => achievement.id === "skill_scholar")?.current, 2);
  assert.ok(
    updated.recentEventLog.some(
      (entry) => entry.category === "achievement" && entry.achievementId === "skill_scholar" && /2\/5/.test(entry.description)
    )
  );
  assert.equal(
    updated.recentEventLog.filter((entry) => entry.achievementId === "skill_scholar" && /解锁成就/.test(entry.description)).length,
    0
  );
});

test("player achievement tracker records visible neutral movement in the account event log", () => {
  const updated = applyPlayerEventLogAndAchievements(
    {
      playerId: "player-1",
      displayName: "暮火侦骑",
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      recentEventLog: []
    },
    createTrackingWorldState(),
    [
      {
        type: "neutral.moved",
        neutralArmyId: "neutral-1",
        from: { x: 1, y: 1 },
        to: { x: 0, y: 1 },
        reason: "chase",
        targetHeroId: "hero-1"
      }
    ],
    "2026-03-27T12:05:00.000Z"
  );

  assert.equal(updated.recentEventLog[0]?.worldEventType, "neutral.moved");
  assert.equal(updated.recentEventLog[0]?.category, "movement");
  assert.equal(updated.recentEventLog[0]?.heroId, "hero-1");
  assert.match(updated.recentEventLog[0]?.description ?? "", /neutral-1 追击 hero-1/);
});
