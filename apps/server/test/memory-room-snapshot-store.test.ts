import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultHeroLoadout, createDefaultHeroProgression, type PlayerBattleReplaySummary, type WorldState } from "../../../packages/shared/src/index";
import type { RoomPersistenceSnapshot } from "../src/index";
import { createMemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";

function createReplaySummary(id: string): PlayerBattleReplaySummary {
  return {
    id,
    roomId: "room-memory",
    playerId: "player-1",
    battleId: `${id}-battle`,
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    neutralArmyId: "neutral-1",
    startedAt: "2026-03-27T11:58:00.000Z",
    completedAt: "2026-03-27T12:00:00.000Z",
    initialState: {
      id: `${id}-battle`,
      round: 1,
      lanes: 1,
      activeUnitId: "unit-1",
      turnOrder: ["unit-1"],
      units: {
        "unit-1": {
          id: "unit-1",
          camp: "attacker",
          templateId: "hero_guard_basic",
          lane: 0,
          stackName: "暮火侦骑",
          initiative: 4,
          attack: 2,
          defense: 2,
          minDamage: 1,
          maxDamage: 2,
          count: 12,
          currentHp: 10,
          maxHp: 10,
          hasRetaliated: false,
          defending: false
        }
      },
      environment: [],
      log: [],
      rng: { seed: 7, cursor: 0 }
    },
    steps: [],
    result: "attacker_victory"
  };
}

function createSnapshot(): RoomPersistenceSnapshot {
  const state: WorldState = {
    meta: {
      roomId: "room-memory",
      seed: 1001,
      day: 1
    },
    map: {
      width: 1,
      height: 1,
      tiles: [
        {
          position: { x: 0, y: 0 },
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
    neutralArmies: {},
    buildings: {},
    resources: {
      "player-1": { gold: 300, wood: 0, ore: 0 }
    },
    visibilityByPlayer: {}
  };

  return {
    state,
    battles: []
  };
}

test("memory room snapshot store persists room-derived accounts and later battle replay progress", async () => {
  const store = createMemoryRoomSnapshotStore();
  await store.save("room-memory", createSnapshot());
  await store.savePlayerAccountProgress("player-1", {
    recentBattleReplays: [createReplaySummary("replay-1")],
    lastRoomId: "room-memory"
  });

  const account = await store.loadPlayerAccount("player-1");
  assert.equal(account?.globalResources.gold, 300);
  assert.deepEqual(account?.recentBattleReplays.map((replay) => replay.id), ["replay-1"]);
  assert.equal(account?.lastRoomId, "room-memory");
});

test("memory room snapshot store supports binding and resolving account credentials", async () => {
  const store = createMemoryRoomSnapshotStore();
  await store.ensurePlayerAccount({
    playerId: "player-1",
    displayName: "灰烬领主"
  });
  await store.bindPlayerAccountCredentials("player-1", {
    loginId: "ash-lord",
    passwordHash: "hashed-password"
  });

  const account = await store.loadPlayerAccountByLoginId("ash-lord");
  const auth = await store.loadPlayerAccountAuthByLoginId("ash-lord");
  assert.equal(account?.playerId, "player-1");
  assert.equal(auth?.playerId, "player-1");
  assert.equal(auth?.displayName, "灰烬领主");
});
