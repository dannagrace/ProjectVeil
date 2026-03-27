import assert from "node:assert/strict";
import test from "node:test";
import {
  createAchievementProgressEventLogEntry,
  createAchievementUnlockedEventLogEntry,
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  createWorldEventLogEntry,
  type PlayerAchievementProgress,
  type WorldState
} from "../src/index";

function createEventTrackingWorldState(): WorldState {
  return {
    meta: {
      roomId: "room-event-log",
      seed: 42,
      day: 3
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

test("shared event log factory builds world event entries with shared descriptions", () => {
  const state = createEventTrackingWorldState();
  const moved = createWorldEventLogEntry(
    state,
    "player-1",
    {
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 1, y: 1 },
      to: { x: 0, y: 1 },
      reason: "chase",
      targetHeroId: "hero-1"
    },
    "2026-03-27T10:00:00.000Z",
    1
  );
  const loot = createWorldEventLogEntry(
    state,
    "player-1",
    {
      type: "hero.equipmentFound",
      heroId: "hero-1",
      battleId: "battle-1",
      battleKind: "neutral",
      equipmentId: "warden_aegis",
      equipmentName: "守誓圣铠",
      rarity: "epic"
    },
    "2026-03-27T10:01:00.000Z",
    2
  );

  assert.equal(moved?.category, "movement");
  assert.equal(moved?.heroId, "hero-1");
  assert.match(moved?.description ?? "", /neutral-1 追击 hero-1/);
  assert.equal(loot?.category, "combat");
  assert.match(loot?.description ?? "", /史诗装备 守誓圣铠/);
});

test("shared event log factory builds achievement progress and unlock entries", () => {
  const achievement: PlayerAchievementProgress = {
    id: "skill_scholar",
    title: "求知者",
    description: "学习 5 个长期技能。",
    metric: "skills_learned",
    current: 2,
    target: 5,
    unlocked: false,
    progressUpdatedAt: "2026-03-27T10:00:00.000Z"
  };
  const progressed = createAchievementProgressEventLogEntry(
    {
      roomId: "room-event-log",
      playerId: "player-1"
    },
    achievement,
    "2026-03-27T10:00:00.000Z",
    3
  );
  const unlocked = createAchievementUnlockedEventLogEntry(
    {
      roomId: "room-event-log",
      playerId: "player-1"
    },
    {
      ...achievement,
      current: 5,
      unlocked: true,
      unlockedAt: "2026-03-27T10:01:00.000Z"
    },
    "2026-03-27T10:01:00.000Z",
    4
  );

  assert.equal(progressed.category, "achievement");
  assert.equal(progressed.achievementId, "skill_scholar");
  assert.match(progressed.description, /2\/5/);
  assert.equal(unlocked.rewards[0]?.type, "badge");
  assert.equal(unlocked.rewards[0]?.label, "求知者");
  assert.match(unlocked.id, /achievement:4:skill_scholar$/);
});
