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

function seedSeasonRewardAccounts(store: ReturnType<typeof createMemoryRoomSnapshotStore>, count = 100) {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const playerNumber = index + 1;
      const playerId = `player-${String(playerNumber).padStart(3, "0")}`;
      await store.ensurePlayerAccount({ playerId, displayName: playerId });
      await store.savePlayerAccountProgress(playerId, {
        gems: playerNumber,
        eloRating: 2000 - index,
        ...(playerNumber === 1 ? { seasonBadges: ["founder"] } : {})
      });
    })
  );
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

test("memory room snapshot store ensurePlayerAccount keeps stored snapshots isolated", async () => {
  const store = createMemoryRoomSnapshotStore();
  const first = await store.ensurePlayerAccount({
    playerId: "player-1",
    displayName: "灰烬领主"
  });

  first.globalResources.gold = 999;
  first.achievements.push({
    id: "first_battle",
    title: "First Battle",
    description: "Win or complete your first battle.",
    metric: "battles_started",
    current: 1,
    target: 1,
    unlocked: true,
    progressUpdatedAt: "2026-03-27T12:00:00.000Z",
    unlockedAt: "2026-03-27T12:00:00.000Z"
  });
  first.recentEventLog.push({
    id: "mutated-event",
    timestamp: "2026-03-27T12:00:00.000Z",
    roomId: "room-memory",
    playerId: "player-1",
    category: "account",
    description: "mutated",
    rewards: []
  });
  first.recentBattleReplays.push(createReplaySummary("mutated-replay"));

  const second = await store.ensurePlayerAccount({ playerId: "player-1" });

  assert.equal(second.globalResources.gold, 0);
  assert.equal(second.achievements.length, 0);
  assert.equal(second.recentEventLog.length, 0);
  assert.equal(second.recentBattleReplays.length, 0);
});

test("memory room snapshot store lists closed seasons and retains active season separately", async () => {
  const store = createMemoryRoomSnapshotStore();
  await store.createSeason("season-1");
  await store.closeSeason("season-1");
  await store.createSeason("season-2");

  const currentSeason = await store.getCurrentSeason();
  const closedSeasons = await store.listSeasons?.({ status: "closed", limit: 10 });
  const allSeasons = await store.listSeasons?.({ status: "all", limit: 10 });

  assert.equal(currentSeason?.seasonId, "season-2");
  assert.deepEqual(closedSeasons?.map((season) => season.seasonId), ["season-1"]);
  assert.deepEqual(new Set(allSeasons?.map((season) => season.seasonId)), new Set(["season-1", "season-2"]));
  assert.equal(allSeasons?.find((season) => season.seasonId === "season-2")?.status, "active");
  assert.equal(allSeasons?.find((season) => season.seasonId === "season-1")?.status, "closed");
  assert.ok(allSeasons?.find((season) => season.seasonId === "season-1")?.endedAt);
});

test("memory room snapshot store matches season reward bracket distribution and prevents double grant", async () => {
  const store = createMemoryRoomSnapshotStore();
  await seedSeasonRewardAccounts(store);
  await store.createSeason("season-rewards");

  const firstClose = await store.closeSeason("season-rewards");
  const secondClose = await store.closeSeason("season-rewards");
  const first = await store.loadPlayerAccount("player-001");
  const tenth = await store.loadPlayerAccount("player-010");
  const twentyFifth = await store.loadPlayerAccount("player-025");
  const twentySixth = await store.loadPlayerAccount("player-026");

  assert.deepEqual(firstClose, {
    seasonId: "season-rewards",
    playersRewarded: 25,
    totalGemsGranted: 1850
  });
  assert.equal(first?.gems, 201);
  assert.deepEqual(first?.seasonBadges, ["founder", "diamond_champion"]);
  assert.equal(tenth?.gems, 110);
  assert.deepEqual(tenth?.seasonBadges, ["platinum_rival"]);
  assert.equal(twentyFifth?.gems, 75);
  assert.deepEqual(twentyFifth?.seasonBadges, ["gold_contender"]);
  assert.equal(twentySixth?.gems, 26);
  assert.deepEqual(twentySixth?.seasonBadges, []);
  assert.deepEqual(secondClose, {
    seasonId: "season-rewards",
    playersRewarded: 0,
    totalGemsGranted: 0
  });
  assert.equal((await store.loadPlayerAccount("player-001"))?.gems, 201);
});
