import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import assetConfig from "../../../configs/assets.json";
import {
  applyBattleAction,
  appendEventLogEntries,
  appendPlayerBattleReplaySummaries,
  applyBattleOutcomeToWorld,
  applyAchievementMetricDelta,
  applyAchievementProgressValue,
  buildPlayerProgressionSnapshot,
  queryAchievementProgress,
  queryEventLogEntries,
  queryPlayerBattleReplaySummaries,
  createHeroAttributeBreakdown,
  createHeroEquipmentBonusSummary,
  createHeroEquipmentLoadoutView,
  createHeroSkillTreeView,
  createHeroProgressMeterView,
  createBattleEnvironmentState,
  createBattleReplayPlaybackState,
  createDemoBattleState,
  createEmptyBattleState,
  executeBattleSkill,
  createHeroBattleState,
  createDefaultHeroLoadout,
  createNeutralBattleState,
  createDefaultHeroProgression,
  createPlayerWorldView,
  createWorldStateFromConfigs,
  decodePlayerWorldView,
  encodePlayerWorldView,
  filterWorldEventsForPlayer,
  getBattleBalanceConfig,
  getAchievementDefinitions,
  getAssetConfigValidationErrors,
  getDefaultMapObjectsConfig,
  getDefaultBattleSkillCatalog,
  getDefaultHeroSkillTreeConfig,
  getDefaultUnitCatalog,
  getDefaultWorldConfig,
  getBattleOutcome,
  getDefaultEquipmentCatalog,
  getLatestProgressedAchievement,
  getLatestUnlockedAchievement,
  hasFullyExploredMap,
  normalizePlayerAccountReadModel,
  normalizePlayerBattleReplaySummaries,
  pauseBattleReplayPlayback,
  pickAutomatedBattleAction,
  planPlayerViewMovement,
  playBattleReplayPlayback,
  predictPlayerWorldAction,
  resetBattleReplayPlayback,
  resetRuntimeConfigs,
  simulateAutomatedBattle,
  simulateAutomatedBattles,
  stepBattleReplayPlayback,
  tickBattleReplayPlayback,
  resolveWorldAction,
  rollEquipmentDrop,
  setBattleBalanceConfig,
  setBattleSkillCatalog,
  setUnitCatalog,
  validateBattleAction,
  validateWorldAction,
  type BattleOutcome,
  type BattleState,
  type HeroState,
  type NeutralArmyState,
  type PlayerWorldView,
  type ResourceNode,
  type TileState,
  type UnitStack,
  type WorldState
} from "../src/index";

function createHero(overrides: Partial<HeroState> & Pick<HeroState, "id" | "playerId" | "name">): HeroState {
  return {
    id: overrides.id,
    playerId: overrides.playerId,
    name: overrides.name,
    position: overrides.position ?? { x: 0, y: 0 },
    vision: overrides.vision ?? 2,
    move: overrides.move ?? { total: 6, remaining: 6 },
    stats: overrides.stats ?? {
      attack: 2,
      defense: 2,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    progression: overrides.progression ?? createDefaultHeroProgression(),
    loadout: overrides.loadout ?? createDefaultHeroLoadout(),
    armyTemplateId: overrides.armyTemplateId ?? "hero_guard_basic",
    armyCount: overrides.armyCount ?? 12,
    learnedSkills: overrides.learnedSkills ?? []
  };
}

function createTile(
  x: number,
  y: number,
  options?: {
    walkable?: boolean;
    terrain?: TileState["terrain"];
    resource?: ResourceNode;
    occupant?: TileState["occupant"];
    building?: TileState["building"];
  }
): TileState {
  return {
    position: { x, y },
    terrain: options?.terrain ?? "grass",
    walkable: options?.walkable ?? true,
    resource: options?.resource,
    occupant: options?.occupant,
    building: options?.building
  };
}

function createWorldState(options?: {
  width?: number;
  height?: number;
  tiles?: TileState[];
  heroes?: HeroState[];
  neutralArmies?: Record<string, NeutralArmyState>;
  buildings?: WorldState["buildings"];
  resources?: WorldState["resources"];
  visibilityByPlayer?: WorldState["visibilityByPlayer"];
}): WorldState {
  const width = options?.width ?? 3;
  const height = options?.height ?? 3;
  const tiles =
    options?.tiles ??
    Array.from({ length: width * height }, (_, index) => createTile(index % width, Math.floor(index / width)));
  const heroes = options?.heroes ?? [];

  return {
    meta: {
      roomId: "test-room",
      seed: 1001,
      day: 1
    },
    map: {
      width,
      height,
      tiles
    },
    heroes,
    neutralArmies: options?.neutralArmies ?? {},
    buildings: options?.buildings ?? {},
    resources:
      options?.resources ??
      Object.fromEntries(
        Array.from(new Set(heroes.map((hero) => hero.playerId))).map((playerId) => [
          playerId,
          {
            gold: 0,
            wood: 0,
            ore: 0
          }
        ])
      ),
    visibilityByPlayer: options?.visibilityByPlayer ?? {}
  };
}

function createLargePlayerWorldView(): PlayerWorldView {
  const width = 32;
  const height = 32;
  const playerId = "player-1";
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const terrain = (["grass", "dirt", "sand", "water"] as const)[(x + y) % 4] ?? "grass";
    const resource = index % 47 === 0 ? { kind: "wood" as const, amount: 5 } : undefined;
    const occupant = index === width + 1 ? { kind: "hero" as const, refId: "hero-1" } : undefined;

    return createTile(x, y, {
      terrain,
      walkable: terrain !== "water",
      ...(resource ? { resource } : {}),
      ...(occupant ? { occupant } : {})
    });
  });

  const visibilityByPlayer = {
    [playerId]: tiles.map((tile) => {
      if (tile.position.x <= 10 && tile.position.y <= 10) {
        return "visible" as const;
      }
      if (tile.position.x <= 18 && tile.position.y <= 18) {
        return "explored" as const;
      }
      return "hidden" as const;
    })
  };

  return createPlayerWorldView(
    createWorldState({
      width,
      height,
      tiles,
      heroes: [
        createHero({
          id: "hero-1",
          playerId,
          name: "Scout",
          position: { x: 1, y: 1 }
        })
      ],
      visibilityByPlayer
    }),
    playerId
  );
}

test("typed-array world map payload decodes back to the original player world view", () => {
  const view = createLargePlayerWorldView();

  assert.deepEqual(decodePlayerWorldView(encodePlayerWorldView(view)), view);
});

test("asset config passes schema validation", () => {
  assert.deepEqual(getAssetConfigValidationErrors(assetConfig), []);
});

test("asset config validation reports missing terrain variants and bad asset roots", () => {
  const errors = getAssetConfigValidationErrors({
    terrain: {
      grass: {
        default: "/assets/terrain/grass-tile.svg",
        variants: ["/assets/terrain/grass-tile.svg"]
      },
      dirt: {
        default: "/assets/terrain/dirt-tile.svg",
        variants: ["/assets/terrain/dirt-tile.svg"]
      },
      sand: {
        default: "/assets/terrain/sand-tile.svg",
        variants: ["/assets/terrain/sand-tile.svg"]
      },
      water: {
        default: "/assets/terrain/water-tile.svg",
        variants: ["/assets/terrain/water-tile.svg"]
      },
      unknown: {
        default: "/assets/terrain/fog-tile.svg",
        variants: []
      }
    },
    resources: {
      gold: "/assets/resources/gold-pile.svg",
      wood: "assets/resources/wood-stack.svg",
      ore: "/assets/resources/ore-crate.svg"
    },
    buildings: {
      recruitment_post: "/assets/buildings/recruitment-post.svg",
      attribute_shrine: "/assets/buildings/attribute-shrine.svg",
      resource_mine: "/assets/buildings/resource-mine.svg"
    },
    units: {
      hero_guard_basic: {
        portrait: {
          idle: "/assets/units/hero-guard-basic.svg",
          selected: "/assets/units/hero-guard-basic-selected.svg",
          hit: "/assets/units/hero-guard-basic-hit.svg"
        },
        frame: "/assets/frames/unit-frame-ally.svg"
      }
    },
    markers: {
      hero: {
        idle: "/assets/markers/hero-marker.svg",
        selected: "/assets/markers/hero-marker-selected.svg",
        hit: "/assets/markers/hero-marker-hit.svg"
      },
      neutral: {
        idle: "/assets/markers/neutral-marker.svg",
        selected: "/assets/markers/neutral-marker-selected.svg",
        hit: "/assets/markers/neutral-marker-hit.svg"
      }
    },
    badges: {
      factions: {
        crown: "/assets/badges/faction-crown.svg"
      },
      rarities: {
        common: "/assets/badges/rarity-common.svg"
      },
      interactions: {
        move: "/assets/badges/interaction-move.svg"
      }
    }
  });

  assert.ok(errors.includes("terrain.unknown.variants must be a non-empty array"));
  assert.ok(errors.includes("resources.wood must start with /assets/"));
});

test("achievement helpers unlock milestones and preserve catalog order", () => {
  const firstPass = applyAchievementMetricDelta([], "battles_started", 1, "2026-03-27T10:00:00.000Z");
  assert.equal(firstPass.unlocked[0]?.id, "first_battle");
  assert.equal(firstPass.progress[0]?.unlocked, true);
  assert.equal(firstPass.progress[0]?.progressUpdatedAt, "2026-03-27T10:00:00.000Z");

  const secondPass = applyAchievementMetricDelta(firstPass.progress, "skills_learned", 5, "2026-03-27T10:01:00.000Z");
  assert.equal(secondPass.unlocked[0]?.id, "skill_scholar");
  assert.equal(secondPass.progress[2]?.progressUpdatedAt, "2026-03-27T10:01:00.000Z");
  assert.deepEqual(
    secondPass.progress.map((achievement) => achievement.id),
    getAchievementDefinitions().map((achievement) => achievement.id)
  );
});

test("achievement helpers can sync progress from an absolute value", () => {
  const progressSync = applyAchievementProgressValue([], "epic_collector", 2, "2026-03-27T10:00:00.000Z");
  assert.equal(progressSync.progress.find((achievement) => achievement.id === "epic_collector")?.current, 2);
  assert.equal(
    progressSync.progress.find((achievement) => achievement.id === "epic_collector")?.progressUpdatedAt,
    "2026-03-27T10:00:00.000Z"
  );
  assert.equal(progressSync.unlocked.length, 0);

  const unlockedSync = applyAchievementProgressValue(
    progressSync.progress,
    "epic_collector",
    3,
    "2026-03-27T10:01:00.000Z"
  );
  assert.equal(unlockedSync.unlocked[0]?.id, "epic_collector");
  assert.equal(unlockedSync.progress.find((achievement) => achievement.id === "epic_collector")?.unlocked, true);
  assert.equal(
    unlockedSync.progress.find((achievement) => achievement.id === "epic_collector")?.progressUpdatedAt,
    "2026-03-27T10:01:00.000Z"
  );

  const regressedSync = applyAchievementProgressValue(
    unlockedSync.progress,
    "epic_collector",
    1,
    "2026-03-27T10:02:00.000Z"
  );
  assert.equal(regressedSync.unlocked.length, 0);
  assert.equal(regressedSync.progress.find((achievement) => achievement.id === "epic_collector")?.current, 3);
  assert.equal(regressedSync.progress.find((achievement) => achievement.id === "epic_collector")?.unlocked, true);
  assert.equal(
    regressedSync.progress.find((achievement) => achievement.id === "epic_collector")?.progressUpdatedAt,
    "2026-03-27T10:01:00.000Z"
  );
});

test("exploration helpers detect when a map has been fully revealed", () => {
  assert.equal(hasFullyExploredMap(["visible", "explored", "hidden"], 3), false);
  assert.equal(hasFullyExploredMap(["visible", "explored", "visible"], 3), true);
  assert.equal(hasFullyExploredMap([], 0), false);
});

test("achievement helpers return the most recently unlocked milestone", () => {
  const progress = [
    {
      id: "first_battle" as const,
      current: 1,
      unlockedAt: "2026-03-27T10:00:00.000Z"
    },
    {
      id: "skill_scholar" as const,
      current: 5,
      unlockedAt: "2026-03-27T10:05:00.000Z"
    }
  ];

  assert.equal(getLatestUnlockedAchievement(progress)?.id, "skill_scholar");
});

test("achievement helpers return the most recently progressed milestone", () => {
  const progress = [
    {
      id: "first_battle" as const,
      current: 1,
      progressUpdatedAt: "2026-03-27T10:00:00.000Z"
    },
    {
      id: "enemy_slayer" as const,
      current: 2,
      progressUpdatedAt: "2026-03-27T10:05:00.000Z"
    }
  ];

  assert.equal(getLatestProgressedAchievement(progress)?.id, "enemy_slayer");
});

test("event log helper keeps newest unique entries first", () => {
  const merged = appendEventLogEntries(
    [
      {
        id: "older",
        timestamp: "2026-03-27T09:58:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "movement",
        description: "older",
        rewards: []
      }
    ],
    [
      {
        id: "newer",
        timestamp: "2026-03-27T10:00:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "achievement",
        description: "newer",
        rewards: []
      },
      {
        id: "older",
        timestamp: "2026-03-27T09:58:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "movement",
        description: "older",
        rewards: []
      }
    ],
    4
  );

  assert.deepEqual(
    merged.map((entry) => entry.id),
    ["newer", "older"]
  );
});

test("event log query helper filters by category, hero, achievement metadata, and offset", () => {
  const queried = queryEventLogEntries(
    [
      {
        id: "combat-entry",
        timestamp: "2026-03-27T10:00:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "combat",
        description: "combat",
        heroId: "hero-1",
        worldEventType: "battle.started",
        rewards: []
      },
      {
        id: "achievement-entry",
        timestamp: "2026-03-27T10:05:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "achievement",
        description: "achievement",
        heroId: "hero-1",
        achievementId: "first_battle",
        rewards: []
      },
      {
        id: "other-hero-entry",
        timestamp: "2026-03-27T10:06:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "achievement",
        description: "other hero",
        heroId: "hero-2",
        achievementId: "first_battle",
        rewards: []
      }
    ],
    {
      category: "achievement",
      heroId: "hero-1",
      achievementId: "first_battle",
      limit: 3
    }
  );

  assert.deepEqual(queried.map((entry) => entry.id), ["achievement-entry"]);

  const paged = queryEventLogEntries(
    [
      {
        id: "newest-entry",
        timestamp: "2026-03-27T10:07:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "achievement",
        description: "newest",
        heroId: "hero-1",
        achievementId: "first_battle",
        rewards: []
      },
      {
        id: "older-entry",
        timestamp: "2026-03-27T10:05:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "achievement",
        description: "older",
        heroId: "hero-1",
        achievementId: "first_battle",
        rewards: []
      }
    ],
    {
      category: "achievement",
      heroId: "hero-1",
      achievementId: "first_battle",
      offset: 1,
      limit: 1
    }
  );

  assert.deepEqual(paged.map((entry) => entry.id), ["older-entry"]);
});

test("achievement progress query helper filters by id, metric, unlocked state, and limit", () => {
  const queried = queryAchievementProgress(
    [
      {
        id: "first_battle",
        current: 1,
        unlockedAt: "2026-03-27T10:00:00.000Z"
      },
      {
        id: "enemy_slayer",
        current: 2,
        progressUpdatedAt: "2026-03-27T10:04:00.000Z"
      },
      {
        id: "skill_scholar",
        current: 5,
        unlockedAt: "2026-03-27T10:06:00.000Z"
      }
    ],
    {
      metric: "skills_learned",
      unlocked: true,
      limit: 1
    }
  );

  assert.deepEqual(queried.map((entry) => entry.id), ["skill_scholar"]);
  assert.equal(queried[0]?.title, "求知者");
  assert.equal(queried[0]?.target, 5);
});

test("player progression snapshot summarizes unlocked achievements and recent events", () => {
  const snapshot = buildPlayerProgressionSnapshot(
    [
      {
        id: "first_battle",
        current: 1,
        progressUpdatedAt: "2026-03-27T10:00:00.000Z",
        unlockedAt: "2026-03-27T10:00:00.000Z"
      },
      {
        id: "enemy_slayer",
        current: 2,
        progressUpdatedAt: "2026-03-27T10:04:00.000Z"
      }
    ],
    [
      {
        id: "event-older",
        timestamp: "2026-03-27T09:55:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "combat",
        description: "older",
        rewards: []
      },
      {
        id: "event-newer",
        timestamp: "2026-03-27T10:05:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "achievement",
        description: "newer",
        rewards: []
      }
    ],
    1
  );

  assert.deepEqual(snapshot.summary, {
    totalAchievements: 5,
    unlockedAchievements: 1,
    inProgressAchievements: 1,
    latestProgressAchievementId: "enemy_slayer",
    latestProgressAchievementTitle: "猎敌者",
    latestProgressAt: "2026-03-27T10:04:00.000Z",
    latestUnlockedAchievementId: "first_battle",
    latestUnlockedAchievementTitle: "初次交锋",
    latestUnlockedAt: "2026-03-27T10:00:00.000Z",
    recentEventCount: 1,
    latestEventAt: "2026-03-27T10:05:00.000Z"
  });
  assert.deepEqual(snapshot.recentEventLog.map((entry) => entry.id), ["event-newer"]);
  assert.equal(snapshot.achievements[1]?.id, "enemy_slayer");
  assert.equal(snapshot.achievements[1]?.current, 2);
});

test("player account read model helper normalizes progression, replays, and resource fields together", () => {
  const account = normalizePlayerAccountReadModel({
    playerId: " player-1 ",
    displayName: "  ",
    globalResources: {
      gold: 12.9,
      wood: -3,
      ore: 4.1
    },
    achievements: [
      {
        id: "first_battle",
        current: 1,
        unlockedAt: "2026-03-27T12:00:00.000Z"
      }
    ],
    recentEventLog: [
      {
        id: "event-older",
        timestamp: "2026-03-27T11:59:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "combat",
        description: "older",
        rewards: []
      },
      {
        id: "event-newer",
        timestamp: "2026-03-27T12:01:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "achievement",
        description: "newer",
        achievementId: "first_battle",
        rewards: []
      }
    ],
    recentBattleReplays: [
      {
        id: "replay-1",
        roomId: "room-alpha",
        playerId: "player-1",
        battleId: "battle-1",
        battleKind: "neutral",
        playerCamp: "attacker",
        heroId: "hero-1",
        startedAt: "2026-03-27T11:58:00.000Z",
        completedAt: "2026-03-27T12:02:00.000Z",
        initialState: createEmptyBattleState({
          id: "battle-1",
          attackerHeroId: "hero-1",
          defenderHeroId: "neutral-1"
        }),
        steps: [],
        result: "attacker_victory"
      }
    ],
    loginId: "  CAPTAIN ",
    lastRoomId: " room-alpha "
  });

  assert.equal(account.playerId, "player-1");
  assert.equal(account.displayName, "player-1");
  assert.deepEqual(account.globalResources, {
    gold: 12,
    wood: 0,
    ore: 4
  });
  assert.equal(account.achievements.find((achievement) => achievement.id === "first_battle")?.unlocked, true);
  assert.deepEqual(account.recentEventLog.map((entry) => entry.id), ["event-newer", "event-older"]);
  assert.deepEqual(account.recentBattleReplays.map((replay) => replay.id), ["replay-1"]);
  assert.equal(account.loginId, "captain");
  assert.equal(account.lastRoomId, "room-alpha");
});

test("player account read model helper falls back to empty progression collections", () => {
  const account = normalizePlayerAccountReadModel();

  assert.equal(account.displayName, "player");
  assert.equal(account.achievements.length, getAchievementDefinitions().length);
  assert.deepEqual(account.recentEventLog, []);
  assert.deepEqual(account.recentBattleReplays, []);
  assert.deepEqual(account.globalResources, {
    gold: 0,
    wood: 0,
    ore: 0
  });
});

test("battle replay helpers normalize steps and keep newest unique replays first", () => {
  const battle = createEmptyBattleState();
  const normalized = normalizePlayerBattleReplaySummaries([
    {
      id: "replay-older",
      roomId: "room-alpha",
      playerId: "player-1",
      battleId: "battle-1",
      battleKind: "neutral",
      playerCamp: "attacker",
      heroId: "hero-1",
      neutralArmyId: "neutral-1",
      startedAt: "2026-03-27T10:00:00.000Z",
      completedAt: "2026-03-27T10:01:00.000Z",
      initialState: battle,
      steps: [{ index: 2, source: "player", action: { type: "battle.wait", unitId: "hero-1-stack" } }],
      result: "attacker_victory"
    }
  ]);

  const merged = appendPlayerBattleReplaySummaries(normalized, [
    {
      id: "replay-newer",
      roomId: "room-alpha",
      playerId: "player-1",
      battleId: "battle-2",
      battleKind: "hero",
      playerCamp: "defender",
      heroId: "hero-2",
      opponentHeroId: "hero-1",
      startedAt: "2026-03-27T10:02:00.000Z",
      completedAt: "2026-03-27T10:03:00.000Z",
      initialState: battle,
      steps: [
        { index: 5, source: "automated", action: { type: "battle.defend", unitId: "hero-2-stack" } }
      ],
      result: "defender_victory"
    },
    {
      id: "replay-older",
      roomId: "room-alpha",
      playerId: "player-1",
      battleId: "battle-1",
      battleKind: "neutral",
      playerCamp: "attacker",
      heroId: "hero-1",
      neutralArmyId: "neutral-1",
      startedAt: "2026-03-27T10:00:00.000Z",
      completedAt: "2026-03-27T10:01:00.000Z",
      initialState: battle,
      steps: [{ index: 9, source: "player", action: { type: "battle.wait", unitId: "hero-1-stack" } }],
      result: "attacker_victory"
    }
  ]);

  assert.deepEqual(merged.map((replay) => replay.id), ["replay-newer", "replay-older"]);
  assert.equal(merged[0]?.steps[0]?.index, 5);
  assert.equal(merged[1]?.steps[0]?.index, 9);
});

test("battle replay query helper filters normalized summaries by replay metadata", () => {
  const battle = createEmptyBattleState();
  const replays = normalizePlayerBattleReplaySummaries([
    {
      id: "replay-neutral",
      roomId: "room-alpha",
      playerId: "player-1",
      battleId: "battle-neutral-1",
      battleKind: "neutral",
      playerCamp: "attacker",
      heroId: "hero-1",
      neutralArmyId: "neutral-1",
      startedAt: "2026-03-27T10:00:00.000Z",
      completedAt: "2026-03-27T10:01:00.000Z",
      initialState: battle,
      steps: [],
      result: "attacker_victory"
    },
    {
      id: "replay-hero",
      roomId: "room-beta",
      playerId: "player-1",
      battleId: "battle-hero-1",
      battleKind: "hero",
      playerCamp: "defender",
      heroId: "hero-2",
      opponentHeroId: "hero-9",
      startedAt: "2026-03-27T10:02:00.000Z",
      completedAt: "2026-03-27T10:03:00.000Z",
      initialState: battle,
      steps: [],
      result: "defender_victory"
    }
  ]);

  assert.deepEqual(
    queryPlayerBattleReplaySummaries(replays, {
      battleKind: "hero",
      playerCamp: "defender",
      opponentHeroId: "hero-9"
    }).map((replay) => replay.id),
    ["replay-hero"]
  );

  assert.deepEqual(
    queryPlayerBattleReplaySummaries(replays, {
      roomId: "room-alpha",
      neutralArmyId: "neutral-1",
      result: "attacker_victory",
      limit: 1
    }).map((replay) => replay.id),
    ["replay-neutral"]
  );
});

test("battle replay playback helpers support play pause tick and reset controls", () => {
  const initial = createDemoBattleState();
  const replay = normalizePlayerBattleReplaySummaries([
    {
      id: "replay-controls",
      roomId: "room-alpha",
      playerId: "player-1",
      battleId: initial.id,
      battleKind: "hero",
      playerCamp: "attacker",
      heroId: "hero-1",
      opponentHeroId: "hero-2",
      startedAt: "2026-03-27T10:00:00.000Z",
      completedAt: "2026-03-27T10:01:00.000Z",
      initialState: initial,
      steps: [
        {
          index: 1,
          source: "automated",
          action: {
            type: "battle.attack",
            attackerId: "wolf-d",
            defenderId: "pikeman-a"
          }
        },
        {
          index: 2,
          source: "player",
          action: {
            type: "battle.wait",
            unitId: "pikeman-a"
          }
        }
      ],
      result: "attacker_victory"
    }
  ])[0];
  assert.ok(replay);

  const playback = createBattleReplayPlaybackState(replay);
  assert.equal(playback.status, "paused");
  assert.equal(playback.currentStepIndex, 0);
  assert.equal(playback.currentStep, null);
  assert.equal(playback.nextStep?.index, 1);
  assert.equal(playback.currentState.activeUnitId, initial.activeUnitId);

  const playing = playBattleReplayPlayback(playback);
  assert.equal(playing.status, "playing");

  const afterTick = tickBattleReplayPlayback(playing);
  assert.equal(afterTick.status, "playing");
  assert.equal(afterTick.currentStepIndex, 1);
  assert.equal(afterTick.currentStep?.index, 1);
  assert.equal(afterTick.nextStep?.index, 2);
  assert.equal(afterTick.currentState.activeUnitId, "pikeman-a");

  const paused = pauseBattleReplayPlayback(afterTick);
  assert.equal(paused.status, "paused");

  const afterManualStep = stepBattleReplayPlayback(paused);
  assert.equal(afterManualStep.status, "completed");
  assert.equal(afterManualStep.currentStepIndex, 2);
  assert.equal(afterManualStep.currentStep?.index, 2);
  assert.equal(afterManualStep.nextStep, null);

  const replayingCompleted = playBattleReplayPlayback(afterManualStep);
  assert.equal(replayingCompleted.status, "completed");

  const reset = resetBattleReplayPlayback(afterManualStep);
  assert.equal(reset.status, "paused");
  assert.equal(reset.currentStepIndex, 0);
  assert.equal(reset.currentStep, null);
  assert.equal(reset.nextStep?.index, 1);
  assert.equal(reset.currentState.activeUnitId, initial.activeUnitId);
});

test("typed-array world map payload is materially smaller than the raw tile JSON on a 32x32 map", () => {
  const view = createLargePlayerWorldView();
  const encoded = encodePlayerWorldView(view);
  const rawSize = JSON.stringify(view).length;
  const encodedSize = JSON.stringify(encoded).length;

  assert.ok(encodedSize < rawSize * 0.55, `expected encoded payload < 55% of raw size, got ${encodedSize}/${rawSize}`);
});

test("typed-array world map payload can encode a bounded chunk and merge it back into the previous map", () => {
  const previous = createLargePlayerWorldView();
  const next: PlayerWorldView = {
    ...previous,
    map: {
      ...previous.map,
      tiles: previous.map.tiles.map((tile) =>
        tile.position.x >= 8 && tile.position.x < 16 && tile.position.y >= 8 && tile.position.y < 16
          ? {
              ...tile,
              fog: "visible",
              terrain: tile.position.x === 10 && tile.position.y === 10 ? "water" : tile.terrain,
              walkable: tile.position.x === 10 && tile.position.y === 10 ? false : tile.walkable,
              resource:
                tile.position.x === 9 && tile.position.y === 9
                  ? {
                      kind: "ore",
                      amount: 7
                    }
                  : tile.resource,
              occupant:
                tile.position.x === 11 && tile.position.y === 11
                  ? {
                      kind: "neutral",
                      refId: "neutral-patch"
                    }
                  : tile.occupant
            }
          : tile
      )
    },
    resources: {
      gold: previous.resources.gold + 50,
      wood: previous.resources.wood,
      ore: previous.resources.ore + 7
    }
  };

  const partial = encodePlayerWorldView(next, {
    bounds: {
      x: 8,
      y: 8,
      width: 8,
      height: 8
    }
  });

  assert.deepEqual(decodePlayerWorldView(partial, previous), next);
});

test("bounded typed-array world map payload is materially smaller than the full encoded payload", () => {
  const view = createLargePlayerWorldView();
  const fullEncoded = encodePlayerWorldView(view);
  const chunkEncoded = encodePlayerWorldView(view, {
    bounds: {
      x: 8,
      y: 8,
      width: 8,
      height: 8
    }
  });

  assert.ok(
    JSON.stringify(chunkEncoded).length < JSON.stringify(fullEncoded).length * 0.3,
    "expected 8x8 encoded chunk to be less than 30% of full encoded payload"
  );
});

function cloneBattleState(state: BattleState): BattleState {
  return structuredClone(state);
}

function cloneBattleUnit(unit: UnitStack): UnitStack {
  return structuredClone(unit);
}

function getUnitHpPool(unit: UnitStack): number {
  if (unit.count <= 0) {
    return 0;
  }

  return (unit.count - 1) * unit.maxHp + unit.currentHp;
}

test("createPlayerWorldView respects fog-of-war visibility rules", () => {
  const heroOne = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 }
  });
  const hiddenEnemy = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 1, y: 0 }
  });
  const visibleEnemy = createHero({
    id: "hero-3",
    playerId: "player-2",
    name: "萨恩",
    position: { x: 0, y: 1 }
  });

  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [heroOne, hiddenEnemy, visibleEnemy],
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0, {
        resource: { kind: "ore", amount: 5 },
        occupant: { kind: "hero", refId: "hero-2" }
      }),
      createTile(0, 1, {
        resource: { kind: "gold", amount: 300 },
        occupant: { kind: "hero", refId: "hero-3" }
      }),
      createTile(1, 1, { resource: { kind: "wood", amount: 5 } })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "explored", "visible", "hidden"]
    }
  });

  const view = createPlayerWorldView(state, "player-1");

  assert.equal(view.map.tiles[0]?.terrain, "grass");
  assert.deepEqual(view.map.tiles[0]?.occupant, { kind: "hero", refId: "hero-1" });

  assert.equal(view.map.tiles[1]?.fog, "explored");
  assert.equal(view.map.tiles[1]?.terrain, "grass");
  assert.equal(view.map.tiles[1]?.resource, undefined);
  assert.equal(view.map.tiles[1]?.occupant, undefined);

  assert.equal(view.map.tiles[3]?.fog, "hidden");
  assert.equal(view.map.tiles[3]?.terrain, "unknown");
  assert.equal(view.map.tiles[3]?.walkable, false);

  assert.deepEqual(view.visibleHeroes, [
    {
      id: "hero-3",
      playerId: "player-2",
      name: "萨恩",
      position: { x: 0, y: 1 }
    }
  ]);
  assert.deepEqual(view.resources, { gold: 0, wood: 0, ore: 0 });
});

test("hero progression helpers expose xp meter and attribute sources", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    stats: {
      attack: 4,
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
    loadout: {
      learnedSkills: [],
      equipment: {
        weaponId: "sunforged_spear",
        armorId: "padded_gambeson",
        accessoryId: "sun_medallion",
        trinketIds: []
      }
    }
  });
  const state = createWorldState({
    heroes: [hero],
    buildings: {
      shrine: {
        id: "shrine",
        kind: "attribute_shrine",
        position: { x: 1, y: 0 },
        label: "荣耀方尖碑",
        bonus: {
          attack: 1,
          defense: 0,
          power: 0,
          knowledge: 0
        },
        lastUsedDay: 1
      }
    },
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0, {
        building: {
          id: "shrine",
          kind: "attribute_shrine",
          position: { x: 1, y: 0 },
          label: "荣耀方尖碑",
          bonus: {
            attack: 1,
            defense: 0,
            power: 0,
            knowledge: 0
          },
          lastUsedDay: 1
        }
      }),
      createTile(0, 1),
      createTile(1, 1)
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible", "visible"]
    }
  });
  const view = createPlayerWorldView(state, "player-1");
  const meter = createHeroProgressMeterView(hero);
  const breakdown = createHeroAttributeBreakdown(hero, view);

  assert.deepEqual(meter, {
    level: 2,
    totalExperience: 140,
    currentLevelExperience: 40,
    nextLevelExperience: 175,
    remainingExperience: 135,
    progressRatio: 40 / 175
  });
  assert.equal(breakdown.find((row) => row.key === "attack")?.formula, "攻击 5 = 基础 2 成长 +1 建筑 +1 装备 +1");
  assert.equal(breakdown.find((row) => row.key === "defense")?.formula, "防御 3 = 基础 2 成长 +1");
  assert.equal(breakdown.find((row) => row.key === "maxHp")?.formula, "生命上限 34 = 基础 30 成长 +2 装备 +2");
});

test("equipment catalog exposes the minimum foundation set and resolves hero bonuses", () => {
  const catalog = getDefaultEquipmentCatalog();
  const countsByType = catalog.entries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    return counts;
  }, {});
  const hero = createHero({
    id: "hero-equip",
    playerId: "player-1",
    name: "装备凯琳",
    stats: {
      attack: 5,
      defense: 4,
      power: 1,
      knowledge: 2,
      hp: 30,
      maxHp: 30
    },
    loadout: {
      learnedSkills: [],
      equipment: {
        weaponId: "sunforged_spear",
        armorId: "warden_aegis",
        accessoryId: "oracle_lens",
        trinketIds: []
      }
    }
  });

  const bonuses = createHeroEquipmentBonusSummary(hero);

  assert.equal(countsByType.weapon, 6);
  assert.equal(countsByType.armor, 6);
  assert.equal(countsByType.accessory, 6);
  assert.equal(bonuses.attack, 1);
  assert.equal(bonuses.defense, 1);
  assert.equal(bonuses.power, 2);
  assert.equal(bonuses.knowledge, 2);
  assert.equal(bonuses.maxHp, 6);
  assert.deepEqual(bonuses.resolvedItemIds, ["sunforged_spear", "warden_aegis", "oracle_lens"]);
  assert.deepEqual(
    bonuses.specialEffects.map((effect) => effect.id).sort(),
    ["channeling", "momentum", "ward"]
  );
});

test("hero equipment loadout view resolves slot metadata for equipped and empty slots", () => {
  const hero = createHero({
    id: "hero-equip-view",
    playerId: "player-1",
    name: "装备视图测试",
    stats: {
      attack: 5,
      defense: 4,
      power: 1,
      knowledge: 2,
      hp: 30,
      maxHp: 30
    },
    loadout: {
      learnedSkills: [],
      equipment: {
        weaponId: "sunforged_spear",
        accessoryId: "oracle_lens",
        trinketIds: []
      }
    }
  });

  const view = createHeroEquipmentLoadoutView(hero);

  assert.deepEqual(
    view.slots.map((slot) => [slot.slot, slot.itemId, slot.rarityLabel]),
    [
      ["weapon", "sunforged_spear", "史诗"],
      ["armor", null, null],
      ["accessory", "oracle_lens", "史诗"]
    ]
  );
  assert.equal(view.slots[0]?.bonusSummary, "攻击 +16% / 力量 +1");
  assert.equal(view.slots[1]?.itemName, "未装备");
  assert.equal(view.slots[1]?.bonusSummary, "等待拾取或替换");
  assert.equal(view.slots[2]?.specialEffectSummary, "引导: 为后续技能结算预留更高的法术上限。");
  assert.deepEqual(view.summary.resolvedItemIds, ["sunforged_spear", "oracle_lens"]);
});

test("hero equipment loadout view tolerates archived ids missing from the equipment catalog", () => {
  const hero = createHero({
    id: "hero-equip-missing",
    playerId: "player-1",
    name: "残缺档案",
    loadout: {
      learnedSkills: [],
      equipment: {
        weaponId: "missing_weapon",
        trinketIds: []
      }
    }
  });

  const view = createHeroEquipmentLoadoutView(hero);

  assert.equal(view.slots[0]?.itemName, "未知装备 (missing_weapon)");
  assert.equal(view.slots[0]?.bonusSummary, "装备目录缺失");
  assert.deepEqual(view.summary.resolvedItemIds, []);
});

test("hero equip and unequip actions rotate items between slots and inventory", () => {
  const hero = createHero({
    id: "hero-equip-action",
    playerId: "player-1",
    name: "装备流转测试",
    loadout: {
      learnedSkills: [],
      equipment: {
        weaponId: "militia_pike",
        trinketIds: []
      },
      inventory: ["vanguard_blade", "padded_gambeson", "scout_compass"]
    }
  });
  const state = createWorldState({
    heroes: [hero]
  });

  assert.deepEqual(validateWorldAction(state, {
    type: "hero.equip",
    heroId: "hero-equip-action",
    slot: "weapon",
    equipmentId: "padded_gambeson"
  }), {
    valid: false,
    reason: "equipment_slot_mismatch"
  });

  const equipped = resolveWorldAction(state, {
    type: "hero.equip",
    heroId: "hero-equip-action",
    slot: "weapon",
    equipmentId: "vanguard_blade"
  });

  assert.equal(equipped.state.heroes[0]?.loadout.equipment.weaponId, "vanguard_blade");
  assert.deepEqual(equipped.state.heroes[0]?.loadout.inventory, ["padded_gambeson", "scout_compass", "militia_pike"]);
  assert.deepEqual(equipped.events, [
    {
      type: "hero.equipmentChanged",
      heroId: "hero-equip-action",
      slot: "weapon",
      equippedItemId: "vanguard_blade",
      unequippedItemId: "militia_pike"
    }
  ]);

  const unequipped = resolveWorldAction(equipped.state, {
    type: "hero.unequip",
    heroId: "hero-equip-action",
    slot: "weapon"
  });

  assert.equal(unequipped.state.heroes[0]?.loadout.equipment.weaponId, undefined);
  assert.deepEqual(unequipped.state.heroes[0]?.loadout.inventory, [
    "padded_gambeson",
    "scout_compass",
    "militia_pike",
    "vanguard_blade"
  ]);
  assert.deepEqual(unequipped.events, [
    {
      type: "hero.equipmentChanged",
      heroId: "hero-equip-action",
      slot: "weapon",
      unequippedItemId: "vanguard_blade"
    }
  ]);
});

test("equipment drops respect rarity pools and battle victories add loot to hero inventory", () => {
  assert.equal(rollEquipmentDrop(0.9, 0.1, 0.1), null);
  assert.deepEqual(rollEquipmentDrop(0.01, 0.98, 0.9), {
    itemId: "oracle_lens",
    item: getDefaultEquipmentCatalog().entries.find((entry) => entry.id === "oracle_lens")
  });

  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳"
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 1, y: 0 },
    reward: { kind: "gold", amount: 100 },
    stacks: [{ templateId: "wolf_pack", count: 4 }]
  };
  const state = createWorldState({
    heroes: [hero],
    neutralArmies: { "neutral-1": neutralArmy },
    resources: {
      "player-1": {
        gold: 0,
        wood: 0,
        ore: 0
      }
    }
  });
  state.meta.seed = 3;

  const outcome = applyBattleOutcomeToWorld(state, "battle-neutral-1", "hero-1", {
    status: "attacker_victory",
    survivingAttackers: ["hero-1-stack"],
    survivingDefenders: []
  });

  assert.deepEqual(outcome.state.heroes[0]?.loadout.inventory, ["tower_shield_mail"]);
  assert.deepEqual(outcome.events.slice(-1), [
    {
      type: "hero.equipmentFound",
      heroId: "hero-1",
      battleId: "battle-neutral-1",
      battleKind: "neutral",
      equipmentId: "tower_shield_mail",
      equipmentName: "塔盾链甲",
      rarity: "common"
    }
  ]);
});

test("resolveWorldAction starts a battle when a hero reaches a neutral army tile", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 },
    move: { total: 6, remaining: 6 }
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 2, y: 0 },
    reward: { kind: "gold", amount: 300 },
    stacks: [{ templateId: "wolf_pack", count: 8 }]
  };
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: { "neutral-1": neutralArmy },
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = resolveWorldAction(state, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  });

  assert.equal(outcome.movementPlan?.endsInEncounter, true);
  assert.equal(outcome.movementPlan?.encounterKind, "neutral");
  assert.deepEqual(outcome.movementPlan?.path, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 }
  ]);
  assert.deepEqual(outcome.movementPlan?.travelPath, [
    { x: 0, y: 0 },
    { x: 1, y: 0 }
  ]);

  assert.equal(outcome.state.heroes[0]?.position.x, 1);
  assert.equal(outcome.state.heroes[0]?.position.y, 0);
  assert.equal(outcome.state.heroes[0]?.move.remaining, 5);

  assert.deepEqual(outcome.events, [
    {
      type: "battle.started",
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      battleId: "battle-neutral-1",
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 0 }
      ],
      moveCost: 1
    }
  ]);
});

test("createWorldStateFromConfigs reuses deterministic generation for preview and room startup", () => {
  const worldConfig = {
    width: 4,
    height: 3,
    heroes: [
      {
        id: "hero-1",
        playerId: "player-1",
        name: "凯琳",
        position: { x: 0, y: 0 },
        vision: 2,
        move: { total: 6, remaining: 6 },
        stats: {
          attack: 2,
          defense: 2,
          power: 1,
          knowledge: 1,
          hp: 30,
          maxHp: 30
        },
        progression: createDefaultHeroProgression(),
        armyTemplateId: "hero_guard_basic",
        armyCount: 12
      }
    ],
    resourceSpawn: {
      goldChance: 0.08,
      woodChance: 0.08,
      oreChance: 0.08
    }
  };
  const mapObjectsConfig = {
    neutralArmies: [
      {
        id: "neutral-1",
        position: { x: 3, y: 2 },
        reward: { kind: "gold" as const, amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }]
      }
    ],
    guaranteedResources: [
      {
        position: { x: 1, y: 0 },
        resource: { kind: "wood" as const, amount: 5 }
      }
    ],
    buildings: [
      {
        id: "recruit-post-1",
        kind: "recruitment_post" as const,
        position: { x: 0, y: 2 },
        label: "前线招募所",
        unitTemplateId: "hero_guard_basic",
        recruitCount: 4,
        cost: {
          gold: 240,
          wood: 0,
          ore: 0
        }
      },
      {
        id: "shrine-1",
        kind: "attribute_shrine" as const,
        position: { x: 2, y: 1 },
        label: "战旗圣坛",
        bonus: {
          attack: 1,
          defense: 0,
          power: 0,
          knowledge: 0
        }
      },
      {
        id: "mine-1",
        kind: "resource_mine" as const,
        position: { x: 3, y: 0 },
        label: "前线伐木场",
        resourceKind: "wood" as const,
        income: 2
      }
    ]
  };

  const previewState = createWorldStateFromConfigs(worldConfig, mapObjectsConfig, 2026, "preview-room");
  const roomState = createWorldStateFromConfigs(worldConfig, mapObjectsConfig, 2026, "preview-room");
  const guaranteedTile = previewState.map.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 0);
  const neutralTile = previewState.map.tiles.find((tile) => tile.position.x === 3 && tile.position.y === 2);
  const buildingTile = previewState.map.tiles.find((tile) => tile.position.x === 0 && tile.position.y === 2);
  const shrineTile = previewState.map.tiles.find((tile) => tile.position.x === 2 && tile.position.y === 1);
  const mineTile = previewState.map.tiles.find((tile) => tile.position.x === 3 && tile.position.y === 0);

  assert.deepEqual(previewState.map.tiles, roomState.map.tiles);
  assert.equal(previewState.meta.roomId, "preview-room");
  assert.deepEqual(guaranteedTile?.resource, { kind: "wood", amount: 5 });
  assert.deepEqual(neutralTile?.occupant, { kind: "neutral", refId: "neutral-1" });
  assert.equal(buildingTile?.building?.id, "recruit-post-1");
  assert.equal(shrineTile?.building?.kind, "attribute_shrine");
  assert.equal(mineTile?.building?.kind, "resource_mine");
  assert.deepEqual(previewState.map.tiles[0]?.occupant, { kind: "hero", refId: "hero-1" });
});

test("applyBattleOutcomeToWorld grants neutral rewards and moves the hero onto the defeated army tile", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 0 }
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 2, y: 0 },
    reward: { kind: "gold", amount: 300 },
    stacks: [{ templateId: "wolf_pack", count: 8 }]
  };
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: { "neutral-1": neutralArmy },
    tiles: [
      createTile(0, 0),
      createTile(1, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = applyBattleOutcomeToWorld(state, "battle-neutral-1", "hero-1", {
    status: "attacker_victory",
    survivingAttackers: ["hero-1-stack"],
    survivingDefenders: []
  });

  assert.equal(outcome.state.heroes[0]?.position.x, 2);
  assert.equal(outcome.state.resources["player-1"]?.gold, 300);
  assert.equal(outcome.state.neutralArmies["neutral-1"], undefined);
  assert.equal(outcome.state.heroes[0]?.progression.level, 2);
  assert.equal(outcome.state.heroes[0]?.progression.experience, 120);
  assert.equal(outcome.state.heroes[0]?.progression.skillPoints, 1);
  assert.equal(outcome.state.heroes[0]?.progression.neutralBattlesWon, 1);
  assert.deepEqual(outcome.events, [
    {
      type: "battle.resolved",
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      battleId: "battle-neutral-1",
      result: "attacker_victory"
    },
    {
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-neutral-1",
      battleKind: "neutral",
      experienceGained: 120,
      totalExperience: 120,
      level: 2,
      levelsGained: 1,
      skillPointsAwarded: 1,
      availableSkillPoints: 1
    },
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: { kind: "gold", amount: 300 }
    }
  ]);
});

test("applyBattleOutcomeToWorld grants PvP experience to the winning hero", () => {
  const attacker = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 },
    armyCount: 12
  });
  const defender = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 2, y: 1 },
    armyCount: 10
  });
  const state = createWorldState({
    width: 3,
    height: 3,
    heroes: [attacker, defender],
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(2, 0),
      createTile(0, 1),
      createTile(1, 1, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 1, { occupant: { kind: "hero", refId: "hero-2" } }),
      createTile(0, 2),
      createTile(1, 2),
      createTile(2, 2)
    ]
  });

  const outcome = applyBattleOutcomeToWorld(state, "battle-hero-1-vs-hero-2", "hero-1", {
    status: "defender_victory",
    survivingAttackers: [],
    survivingDefenders: ["hero-2-stack"]
  });

  const winningDefender = outcome.state.heroes.find((hero) => hero.id === "hero-2");

  assert.equal(winningDefender?.progression.level, 2);
  assert.equal(winningDefender?.progression.experience, 164);
  assert.equal(winningDefender?.progression.skillPoints, 1);
  assert.equal(winningDefender?.progression.pvpBattlesWon, 1);
  assert.deepEqual(outcome.events, [
    {
      type: "battle.resolved",
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      defenderHeroId: "hero-2",
      defenderPlayerId: "player-2",
      battleId: "battle-hero-1-vs-hero-2",
      result: "defender_victory"
    },
    {
      type: "hero.progressed",
      heroId: "hero-2",
      battleId: "battle-hero-1-vs-hero-2",
      battleKind: "hero",
      experienceGained: 164,
      totalExperience: 164,
      level: 2,
      levelsGained: 1,
      skillPointsAwarded: 1,
      availableSkillPoints: 1
    }
  ]);
});

test("resolveWorldAction lets heroes learn and upgrade long-term skills after leveling", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    progression: {
      ...createDefaultHeroProgression(),
      level: 2,
      experience: 120,
      skillPoints: 2
    }
  });
  const state = createWorldState({
    width: 2,
    height: 1,
    heroes: [hero],
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0)
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible"]
    }
  });

  const predicted = predictPlayerWorldAction(createPlayerWorldView(state, "player-1"), {
    type: "hero.learnSkill",
    heroId: "hero-1",
    skillId: "war_banner"
  });

  assert.equal(predicted.reason, undefined);
  assert.equal(predicted.world.ownHeroes[0]?.progression.skillPoints, 1);
  assert.deepEqual(predicted.world.ownHeroes[0]?.learnedSkills, [{ skillId: "war_banner", rank: 1 }]);

  const learned = resolveWorldAction(state, {
    type: "hero.learnSkill",
    heroId: "hero-1",
    skillId: "war_banner"
  });

  assert.equal(learned.state.heroes[0]?.progression.skillPoints, 1);
  assert.deepEqual(learned.state.heroes[0]?.learnedSkills, [{ skillId: "war_banner", rank: 1 }]);
  assert.deepEqual(learned.events, [
    {
      type: "hero.skillLearned",
      heroId: "hero-1",
      skillId: "war_banner",
      branchId: "warpath",
      skillName: "战旗号令",
      branchName: "战阵",
      newRank: 1,
      spentPoint: 1,
      remainingSkillPoints: 1,
      newlyGrantedBattleSkillIds: ["commanding_shout"]
    }
  ]);

  const upgraded = resolveWorldAction(learned.state, {
    type: "hero.learnSkill",
    heroId: "hero-1",
    skillId: "war_banner"
  });

  assert.equal(upgraded.state.heroes[0]?.progression.skillPoints, 0);
  assert.deepEqual(upgraded.state.heroes[0]?.learnedSkills, [{ skillId: "war_banner", rank: 2 }]);
  assert.deepEqual(validateWorldAction(upgraded.state, {
    type: "hero.learnSkill",
    heroId: "hero-1",
    skillId: "war_banner"
  }), {
    valid: false,
    reason: "not_enough_skill_points"
  });
});

test("default hero skill tree loads the full three-branch layout", () => {
  const config = getDefaultHeroSkillTreeConfig();

  assert.equal(config.branches.length, 3);
  assert.equal(config.skills.length, 15);
  assert.equal(config.skills.filter((skill) => skill.branchId === "warpath").length, 5);
  assert.equal(config.skills.filter((skill) => skill.branchId === "bulwark").length, 5);
  assert.equal(config.skills.filter((skill) => skill.branchId === "arcanum").length, 5);
});

test("hero skill tree view and resolveWorldAction advance branch prerequisites in order", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    progression: {
      ...createDefaultHeroProgression(),
      level: 3,
      experience: 240,
      skillPoints: 2
    }
  });
  const state = createWorldState({
    width: 2,
    height: 1,
    heroes: [hero],
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0)
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible"]
    }
  });

  const initialView = createHeroSkillTreeView(hero);
  const initialLearnableIds = initialView.branches.flatMap((branch) => branch.skills.filter((skill) => skill.canLearn).map((skill) => skill.id));
  assert.ok(initialLearnableIds.includes("war_banner"));
  assert.ok(!initialLearnableIds.includes("spearhead_assault"));

  const firstLearn = resolveWorldAction(state, {
    type: "hero.learnSkill",
    heroId: "hero-1",
    skillId: "war_banner"
  });

  const progressedHero = firstLearn.state.heroes[0]!;
  const nextView = createHeroSkillTreeView(progressedHero);
  const nextLearnableIds = nextView.branches.flatMap((branch) => branch.skills.filter((skill) => skill.canLearn).map((skill) => skill.id));
  assert.ok(nextLearnableIds.includes("spearhead_assault"));

  const secondLearn = resolveWorldAction(firstLearn.state, {
    type: "hero.learnSkill",
    heroId: "hero-1",
    skillId: "spearhead_assault"
  });

  assert.deepEqual(
    secondLearn.state.heroes[0]?.learnedSkills.slice().sort((left, right) => left.skillId.localeCompare(right.skillId)),
    [
      { skillId: "spearhead_assault", rank: 1 },
      { skillId: "war_banner", rank: 1 }
    ]
  );
  assert.deepEqual(secondLearn.events, [
    {
      type: "hero.skillLearned",
      heroId: "hero-1",
      skillId: "spearhead_assault",
      branchId: "warpath",
      skillName: "矛锋突击",
      branchName: "战阵",
      newRank: 1,
      spentPoint: 1,
      remainingSkillPoints: 0,
      newlyGrantedBattleSkillIds: ["sundering_spear"]
    }
  ]);
});

test("createHeroBattleState carries learned hero skill tree rewards into battle", () => {
  const attacker = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    progression: {
      ...createDefaultHeroProgression(),
      level: 3,
      experience: 420
    },
    learnedSkills: [{ skillId: "war_banner", rank: 2 }]
  });
  const defender = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安"
  });

  const battle = createHeroBattleState(attacker, defender, 1001);
  const attackerSkills = battle.units["hero-1-stack"]?.skills?.map((skill) => skill.id) ?? [];

  assert.ok(attackerSkills.includes("power_shot"));
  assert.ok(attackerSkills.includes("commanding_shout"));
  assert.ok(attackerSkills.includes("rending_mark"));
});

test("battle state builders fold equipped item bonuses into hero-led stacks", () => {
  const attacker = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    stats: {
      attack: 5,
      defense: 4,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    loadout: {
      learnedSkills: [],
      equipment: {
        weaponId: "sunforged_spear",
        armorId: "bastion_plate",
        accessoryId: "captains_insignia",
        trinketIds: []
      }
    }
  });
  const defender = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    stats: {
      attack: 3,
      defense: 5,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    loadout: {
      learnedSkills: [],
      equipment: {
        weaponId: "militia_pike",
        armorId: "padded_gambeson",
        accessoryId: "scribe_charm",
        trinketIds: []
      }
    }
  });

  const attackerBonuses = createHeroEquipmentBonusSummary(attacker);
  const defenderBonuses = createHeroEquipmentBonusSummary(defender);
  const baselineBattle = createHeroBattleState(
    {
      ...attacker,
      loadout: createDefaultHeroLoadout()
    },
    {
      ...defender,
      loadout: createDefaultHeroLoadout()
    },
    1001
  );
  const battle = createHeroBattleState(attacker, defender, 1001);

  assert.equal(
    battle.units["hero-1-stack"]?.attack,
    (baselineBattle.units["hero-1-stack"]?.attack ?? 0) + attackerBonuses.attack
  );
  assert.equal(
    battle.units["hero-1-stack"]?.defense,
    (baselineBattle.units["hero-1-stack"]?.defense ?? 0) + attackerBonuses.defense
  );
  assert.equal(
    battle.units["hero-2-stack"]?.attack,
    (baselineBattle.units["hero-2-stack"]?.attack ?? 0) + defenderBonuses.attack
  );
  assert.equal(
    battle.units["hero-2-stack"]?.defense,
    (baselineBattle.units["hero-2-stack"]?.defense ?? 0) + defenderBonuses.defense
  );
});

test("createPlayerWorldView returns player-scoped resources after collection", () => {
  const collector = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 }
  });
  const observer = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 1, y: 0 }
  });

  const state = createWorldState({
    width: 2,
    height: 1,
    heroes: [collector, observer],
    tiles: [
      createTile(0, 0, {
        resource: { kind: "gold", amount: 300 },
        occupant: { kind: "hero", refId: "hero-1" }
      }),
      createTile(1, 0, { occupant: { kind: "hero", refId: "hero-2" } })
    ]
  });

  const outcome = resolveWorldAction(state, {
    type: "hero.collect",
    heroId: "hero-1",
    position: { x: 0, y: 0 }
  });

  const playerOneView = createPlayerWorldView(outcome.state, "player-1");
  const playerTwoView = createPlayerWorldView(outcome.state, "player-2");

  assert.deepEqual(playerOneView.resources, { gold: 300, wood: 0, ore: 0 });
  assert.deepEqual(playerTwoView.resources, { gold: 0, wood: 0, ore: 0 });
});

test("resolveWorldAction recruits units from a recruitment post and resets stock on next day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 },
    armyCount: 12
  });
  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [hero],
    buildings: {
      "recruit-post-1": {
        id: "recruit-post-1",
        kind: "recruitment_post",
        position: { x: 1, y: 1 },
        label: "前线招募所",
        unitTemplateId: "hero_guard_basic",
        recruitCount: 4,
        availableCount: 4,
        cost: {
          gold: 240,
          wood: 0,
          ore: 0
        }
      }
    },
    resources: {
      "player-1": {
        gold: 300,
        wood: 0,
        ore: 0
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(0, 1),
      createTile(1, 1, {
        occupant: { kind: "hero", refId: "hero-1" },
        building: {
          id: "recruit-post-1",
          kind: "recruitment_post",
          position: { x: 1, y: 1 },
          label: "前线招募所",
          unitTemplateId: "hero_guard_basic",
          recruitCount: 4,
          availableCount: 4,
          cost: {
            gold: 240,
            wood: 0,
            ore: 0
          }
        }
      })
    ]
  });

  const recruitOutcome = resolveWorldAction(state, {
    type: "hero.recruit",
    heroId: "hero-1",
    buildingId: "recruit-post-1"
  });

  assert.equal(recruitOutcome.state.heroes[0]?.armyCount, 16);
  assert.equal(recruitOutcome.state.resources["player-1"]?.gold, 60);
  assert.equal(recruitOutcome.state.buildings["recruit-post-1"]?.availableCount, 0);
  assert.equal(recruitOutcome.state.map.tiles[3]?.building?.availableCount, 0);
  assert.deepEqual(recruitOutcome.events, [
    {
      type: "hero.recruited",
      heroId: "hero-1",
      buildingId: "recruit-post-1",
      buildingKind: "recruitment_post",
      unitTemplateId: "hero_guard_basic",
      count: 4,
      cost: {
        gold: 240,
        wood: 0,
        ore: 0
      }
    }
  ]);

  const nextDayOutcome = resolveWorldAction(recruitOutcome.state, {
    type: "turn.endDay"
  });

  assert.equal(nextDayOutcome.state.buildings["recruit-post-1"]?.availableCount, 4);
  assert.equal(nextDayOutcome.state.map.tiles[3]?.building?.availableCount, 4);
});

test("building interactions reject missing resources, exhausted stock, wrong building types, and duplicate claims", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 },
    armyCount: 12
  });
  const state = createWorldState({
    width: 3,
    height: 2,
    heroes: [hero],
    buildings: {
      "recruit-post-1": {
        id: "recruit-post-1",
        kind: "recruitment_post",
        position: { x: 1, y: 1 },
        label: "前线招募所",
        unitTemplateId: "hero_guard_basic",
        recruitCount: 4,
        availableCount: 4,
        cost: {
          gold: 240,
          wood: 0,
          ore: 0
        }
      },
      "shrine-1": {
        id: "shrine-1",
        kind: "attribute_shrine",
        position: { x: 2, y: 1 },
        label: "战旗圣坛",
        bonus: {
          attack: 1,
          defense: 0,
          power: 0,
          knowledge: 0
        },
        visitedHeroIds: []
      },
      "mine-1": {
        id: "mine-1",
        kind: "resource_mine",
        position: { x: 0, y: 1 },
        label: "前线伐木场",
        resourceKind: "wood",
        income: 2
      }
    },
    resources: {
      "player-1": {
        gold: 120,
        wood: 0,
        ore: 0
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(2, 0),
      createTile(0, 1, {
        building: {
          id: "mine-1",
          kind: "resource_mine",
          position: { x: 0, y: 1 },
          label: "前线伐木场",
          resourceKind: "wood",
          income: 2
        }
      }),
      createTile(1, 1, {
        occupant: { kind: "hero", refId: "hero-1" },
        building: {
          id: "recruit-post-1",
          kind: "recruitment_post",
          position: { x: 1, y: 1 },
          label: "前线招募所",
          unitTemplateId: "hero_guard_basic",
          recruitCount: 4,
          availableCount: 4,
          cost: {
            gold: 240,
            wood: 0,
            ore: 0
          }
        }
      }),
      createTile(2, 1, {
        building: {
          id: "shrine-1",
          kind: "attribute_shrine",
          position: { x: 2, y: 1 },
          label: "战旗圣坛",
          bonus: {
            attack: 1,
            defense: 0,
            power: 0,
            knowledge: 0
          },
          visitedHeroIds: []
        }
      })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible", "visible", "visible", "visible"]
    }
  });

  assert.deepEqual(validateWorldAction(state, {
    type: "hero.recruit",
    heroId: "hero-1",
    buildingId: "recruit-post-1"
  }), {
    valid: false,
    reason: "not_enough_resources"
  });
  assert.equal(
    predictPlayerWorldAction(createPlayerWorldView(state, "player-1"), {
      type: "hero.recruit",
      heroId: "hero-1",
      buildingId: "recruit-post-1"
    }).reason,
    "not_enough_resources"
  );
  assert.deepEqual(validateWorldAction(state, {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "recruit-post-1"
  }), {
    valid: false,
    reason: "building_not_visitable"
  });
  assert.deepEqual(validateWorldAction(state, {
    type: "hero.claimMine",
    heroId: "hero-1",
    buildingId: "recruit-post-1"
  }), {
    valid: false,
    reason: "building_not_claimable"
  });

  const stockedState = createWorldState({
    ...state,
    resources: {
      "player-1": {
        gold: 300,
        wood: 0,
        ore: 0
      }
    }
  });
  const recruitedState = resolveWorldAction(stockedState, {
    type: "hero.recruit",
    heroId: "hero-1",
    buildingId: "recruit-post-1"
  }).state;

  assert.deepEqual(validateWorldAction(recruitedState, {
    type: "hero.recruit",
    heroId: "hero-1",
    buildingId: "recruit-post-1"
  }), {
    valid: false,
    reason: "building_depleted"
  });

  const visitedState = resolveWorldAction(
    createWorldState({
      ...state,
      heroes: [
        {
          ...hero,
          position: { x: 2, y: 1 }
        }
      ],
      tiles: [
        createTile(0, 0),
        createTile(1, 0),
        createTile(2, 0),
        createTile(0, 1, {
          building: {
            id: "mine-1",
            kind: "resource_mine",
            position: { x: 0, y: 1 },
            label: "前线伐木场",
            resourceKind: "wood",
            income: 2
          }
        }),
        createTile(1, 1, {
          building: {
            id: "recruit-post-1",
            kind: "recruitment_post",
            position: { x: 1, y: 1 },
            label: "前线招募所",
            unitTemplateId: "hero_guard_basic",
            recruitCount: 4,
            availableCount: 4,
            cost: {
              gold: 240,
              wood: 0,
              ore: 0
            }
          }
        }),
        createTile(2, 1, {
          occupant: { kind: "hero", refId: "hero-1" },
          building: {
            id: "shrine-1",
            kind: "attribute_shrine",
            position: { x: 2, y: 1 },
            label: "战旗圣坛",
            bonus: {
              attack: 1,
              defense: 0,
              power: 0,
              knowledge: 0
            },
            lastUsedDay: undefined
          }
        })
      ]
    }),
    {
      type: "hero.visit",
      heroId: "hero-1",
      buildingId: "shrine-1"
    }
  ).state;

  assert.deepEqual(validateWorldAction(visitedState, {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "shrine-1"
  }), {
    valid: false,
    reason: "building_on_cooldown"
  });

  const claimedState = resolveWorldAction(
    createWorldState({
      ...state,
      heroes: [
        {
          ...hero,
          position: { x: 0, y: 1 }
        }
      ],
      tiles: [
        createTile(0, 0),
        createTile(1, 0),
        createTile(2, 0),
        createTile(0, 1, {
          occupant: { kind: "hero", refId: "hero-1" },
          building: {
            id: "mine-1",
            kind: "resource_mine",
            position: { x: 0, y: 1 },
            label: "前线伐木场",
            resourceKind: "wood",
            income: 2
          }
        }),
        createTile(1, 1, {
          building: {
            id: "recruit-post-1",
            kind: "recruitment_post",
            position: { x: 1, y: 1 },
            label: "前线招募所",
            unitTemplateId: "hero_guard_basic",
            recruitCount: 4,
            availableCount: 4,
            cost: {
              gold: 240,
              wood: 0,
              ore: 0
            }
          }
        }),
        createTile(2, 1, {
          building: {
            id: "shrine-1",
            kind: "attribute_shrine",
            position: { x: 2, y: 1 },
            label: "战旗圣坛",
            bonus: {
              attack: 1,
              defense: 0,
              power: 0,
              knowledge: 0
            },
            lastUsedDay: undefined
          }
        })
      ]
    }),
    {
      type: "hero.claimMine",
      heroId: "hero-1",
      buildingId: "mine-1"
    }
  ).state;

  assert.deepEqual(validateWorldAction(claimedState, {
    type: "hero.claimMine",
    heroId: "hero-1",
    buildingId: "mine-1"
  }), {
    valid: false,
    reason: "building_on_cooldown"
  });
});

test("resolveWorldAction visits an attribute shrine once, grants permanent stats, and does not reset on next day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 }
  });
  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [hero],
    buildings: {
      "shrine-1": {
        id: "shrine-1",
        kind: "attribute_shrine",
        position: { x: 1, y: 1 },
        label: "战旗圣坛",
        bonus: {
          attack: 1,
          defense: 0,
          power: 1,
          knowledge: 0
        },
        lastUsedDay: undefined
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(0, 1),
      createTile(1, 1, {
        occupant: { kind: "hero", refId: "hero-1" },
        building: {
          id: "shrine-1",
          kind: "attribute_shrine",
          position: { x: 1, y: 1 },
          label: "战旗圣坛",
          bonus: {
            attack: 1,
            defense: 0,
            power: 1,
            knowledge: 0
          },
          lastUsedDay: undefined
        }
      })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible", "visible"]
    }
  });

  const visitOutcome = resolveWorldAction(state, {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "shrine-1"
  });

  assert.equal(visitOutcome.state.heroes[0]?.stats.attack, 3);
  assert.equal(visitOutcome.state.heroes[0]?.stats.power, 2);
  assert.equal(visitOutcome.state.buildings["shrine-1"]?.lastUsedDay, 1);
  assert.deepEqual(visitOutcome.events, [
    {
      type: "hero.visited",
      heroId: "hero-1",
      buildingId: "shrine-1",
      buildingKind: "attribute_shrine",
      bonus: {
        attack: 1,
        defense: 0,
        power: 1,
        knowledge: 0
      }
    }
  ]);

  assert.deepEqual(
    predictPlayerWorldAction(createPlayerWorldView(state, "player-1"), {
      type: "hero.visit",
      heroId: "hero-1",
      buildingId: "shrine-1"
    }).world.ownHeroes[0]?.stats,
    {
      attack: 3,
      defense: 2,
      power: 2,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    }
  );

  assert.deepEqual(validateWorldAction(visitOutcome.state, {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "shrine-1"
  }), {
    valid: false,
    reason: "building_on_cooldown"
  });

  const nextDayOutcome = resolveWorldAction(visitOutcome.state, {
    type: "turn.endDay"
  });

  assert.equal(nextDayOutcome.state.buildings["shrine-1"]?.lastUsedDay, 1);
  assert.equal(nextDayOutcome.state.heroes[0]?.stats.attack, 3);
  assert.equal(nextDayOutcome.state.heroes[0]?.stats.power, 2);
});

test("resolveWorldAction harvests a resource mine immediately and unlocks it again on the next day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 },
    move: { total: 6, remaining: 0 }
  });
  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [hero],
    buildings: {
      "mine-1": {
        id: "mine-1",
        kind: "resource_mine",
        position: { x: 1, y: 1 },
        label: "前线伐木场",
        resourceKind: "wood",
        income: 2
      }
    },
    resources: {
      "player-1": {
        gold: 0,
        wood: 0,
        ore: 0
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(0, 1),
      createTile(1, 1, {
        occupant: { kind: "hero", refId: "hero-1" },
        building: {
          id: "mine-1",
          kind: "resource_mine",
          position: { x: 1, y: 1 },
          label: "前线伐木场",
          resourceKind: "wood",
          income: 2
        }
      })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible", "visible"]
    }
  });

  const predictedClaim = predictPlayerWorldAction(createPlayerWorldView(state, "player-1"), {
    type: "hero.claimMine",
    heroId: "hero-1",
    buildingId: "mine-1"
  });
  assert.equal(predictedClaim.reason, undefined);
  assert.equal(
    predictedClaim.world.map.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 1)?.building?.lastHarvestDay,
    1
  );
  assert.equal(predictedClaim.world.resources.wood, 2);

  const claimOutcome = resolveWorldAction(state, {
    type: "hero.claimMine",
    heroId: "hero-1",
    buildingId: "mine-1"
  });

  assert.equal(claimOutcome.state.buildings["mine-1"]?.lastHarvestDay, 1);
  assert.equal(claimOutcome.state.map.tiles[3]?.building?.lastHarvestDay, 1);
  assert.equal(claimOutcome.state.resources["player-1"]?.wood, 2);
  assert.deepEqual(claimOutcome.events, [
    {
      type: "hero.claimedMine",
      heroId: "hero-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine",
      resourceKind: "wood",
      income: 2,
      ownerPlayerId: "player-1"
    }
  ]);

  assert.deepEqual(validateWorldAction(claimOutcome.state, {
    type: "hero.claimMine",
    heroId: "hero-1",
    buildingId: "mine-1"
  }), {
    valid: false,
    reason: "building_on_cooldown"
  });

  const nextDayOutcome = resolveWorldAction(claimOutcome.state, {
    type: "turn.endDay"
  });

  assert.equal(nextDayOutcome.state.resources["player-1"]?.wood, 2);
  assert.equal(nextDayOutcome.state.heroes[0]?.move.remaining, 6);
  assert.deepEqual(nextDayOutcome.events, [
    {
      type: "turn.advanced",
      day: 2
    }
  ]);
});

test("resolveWorldAction advances patrolling neutral armies by one tile on end day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 }
  });
  const state = createWorldState({
    width: 4,
    height: 2,
    heroes: [hero],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 3, y: 1 },
        origin: { x: 3, y: 1 },
        reward: { kind: "gold", amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }],
        behavior: {
          mode: "patrol",
          patrolPath: [{ x: 2, y: 1 }, { x: 3, y: 1 }],
          patrolIndex: 0,
          detectionRadius: 0,
          chaseDistance: 0,
          patrolRadius: 0,
          speed: 1,
          state: "patrol"
        }
      }
    },
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0),
      createTile(2, 0),
      createTile(3, 0),
      createTile(0, 1),
      createTile(1, 1),
      createTile(2, 1),
      createTile(3, 1, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = resolveWorldAction(state, {
    type: "turn.endDay"
  });

  assert.deepEqual(outcome.events, [
    {
      type: "turn.advanced",
      day: 2
    },
    {
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 3, y: 1 },
      to: { x: 2, y: 1 },
      reason: "patrol"
    }
  ]);
  assert.deepEqual(outcome.state.neutralArmies["neutral-1"]?.position, { x: 2, y: 1 });
  assert.equal(outcome.state.neutralArmies["neutral-1"]?.behavior?.patrolIndex, 1);
});

test("resolveWorldAction keeps patrol movement deterministic across days", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 }
  });
  const initialState = createWorldState({
    width: 5,
    height: 3,
    heroes: [hero],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 2, y: 1 },
        origin: { x: 2, y: 1 },
        reward: { kind: "gold", amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }],
        behavior: {
          mode: "patrol",
          patrolPath: [{ x: 1, y: 1 }, { x: 3, y: 1 }],
          patrolIndex: 0,
          detectionRadius: 0,
          chaseDistance: 2,
          patrolRadius: 0,
          speed: 1,
          state: "patrol"
        }
      }
    },
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0),
      createTile(2, 0),
      createTile(3, 0),
      createTile(4, 0),
      createTile(0, 1),
      createTile(1, 1),
      createTile(2, 1, { occupant: { kind: "neutral", refId: "neutral-1" } }),
      createTile(3, 1),
      createTile(4, 1),
      createTile(0, 2),
      createTile(1, 2),
      createTile(2, 2),
      createTile(3, 2),
      createTile(4, 2)
    ]
  });

  const dayTwo = resolveWorldAction(initialState, { type: "turn.endDay" });
  const dayThree = resolveWorldAction(dayTwo.state, { type: "turn.endDay" });
  const dayFour = resolveWorldAction(dayThree.state, { type: "turn.endDay" });
  const dayFive = resolveWorldAction(dayFour.state, { type: "turn.endDay" });

  assert.deepEqual(dayTwo.state.neutralArmies["neutral-1"]?.position, { x: 1, y: 1 });
  assert.deepEqual(dayThree.state.neutralArmies["neutral-1"]?.position, { x: 2, y: 1 });
  assert.deepEqual(dayFour.state.neutralArmies["neutral-1"]?.position, { x: 3, y: 1 });
  assert.deepEqual(dayFive.state.neutralArmies["neutral-1"]?.position, { x: 2, y: 1 });
});

test("resolveWorldAction can start a neutral-initiated battle on end day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 0 }
  });
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 2, y: 0 },
        origin: { x: 2, y: 0 },
        reward: { kind: "gold", amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }],
        behavior: {
          mode: "guard",
          patrolPath: [],
          patrolIndex: 0,
          detectionRadius: 1,
          chaseDistance: 3,
          patrolRadius: 0,
          speed: 1,
          state: "return"
        }
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = resolveWorldAction(state, {
    type: "turn.endDay"
  });

  assert.deepEqual(outcome.events, [
    {
      type: "turn.advanced",
      day: 2
    },
    {
      type: "battle.started",
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      initiator: "neutral",
      battleId: "battle-neutral-1",
      path: [{ x: 1, y: 0 }],
      moveCost: 0
    }
  ]);
  assert.deepEqual(outcome.state.neutralArmies["neutral-1"]?.position, { x: 2, y: 0 });
});

test("resolveWorldAction switches neutral armies from chase back to return when heroes leave range", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 2, y: 0 }
  });
  const state = createWorldState({
    width: 6,
    height: 3,
    heroes: [hero],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 5, y: 0 },
        origin: { x: 5, y: 0 },
        reward: { kind: "gold", amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }],
        behavior: {
          mode: "guard",
          patrolPath: [],
          patrolIndex: 0,
          detectionRadius: 3,
          chaseDistance: 5,
          patrolRadius: 0,
          speed: 1,
          state: "return"
        }
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(2, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(3, 0),
      createTile(4, 0),
      createTile(5, 0, { occupant: { kind: "neutral", refId: "neutral-1" } }),
      createTile(0, 1),
      createTile(1, 1),
      createTile(2, 1),
      createTile(3, 1),
      createTile(4, 1),
      createTile(5, 1),
      createTile(0, 2),
      createTile(1, 2),
      createTile(2, 2),
      createTile(3, 2),
      createTile(4, 2),
      createTile(5, 2)
    ]
  });

  const chaseOutcome = resolveWorldAction(state, { type: "turn.endDay" });
  assert.deepEqual(chaseOutcome.events, [
    {
      type: "turn.advanced",
      day: 2
    },
    {
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 5, y: 0 },
      to: { x: 4, y: 0 },
      reason: "chase",
      targetHeroId: "hero-1"
    }
  ]);
  assert.equal(chaseOutcome.state.neutralArmies["neutral-1"]?.behavior?.state, "chase");

  const returnState: WorldState = {
    ...chaseOutcome.state,
    heroes: [createHero({ ...hero, position: { x: 0, y: 2 } })],
    map: {
      ...chaseOutcome.state.map,
      tiles: chaseOutcome.state.map.tiles.map((tile) => {
        if (tile.position.x === 4 && tile.position.y === 0) {
          return createTile(4, 0, { occupant: { kind: "neutral", refId: "neutral-1" } });
        }
        if (tile.position.x === 0 && tile.position.y === 2) {
          return createTile(0, 2, { occupant: { kind: "hero", refId: "hero-1" } });
        }
        return createTile(tile.position.x, tile.position.y, { walkable: tile.walkable });
      })
    }
  };
  const returnOutcome = resolveWorldAction(returnState, { type: "turn.endDay" });

  assert.deepEqual(returnOutcome.events, [
    {
      type: "turn.advanced",
      day: 3
    },
    {
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 4, y: 0 },
      to: { x: 5, y: 0 },
      reason: "return"
    }
  ]);
  assert.deepEqual(returnOutcome.state.neutralArmies["neutral-1"]?.position, { x: 5, y: 0 });
  assert.equal(returnOutcome.state.neutralArmies["neutral-1"]?.behavior?.targetHeroId, undefined);
});

test("resolveWorldAction tracks multiple neutral chase targets independently", () => {
  const heroOne = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 }
  });
  const heroTwo = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 6, y: 2 }
  });
  const state = createWorldState({
    width: 7,
    height: 3,
    heroes: [heroOne, heroTwo],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 3, y: 0 },
        origin: { x: 3, y: 0 },
        reward: { kind: "gold", amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }],
        behavior: {
          mode: "guard",
          patrolPath: [],
          patrolIndex: 0,
          detectionRadius: 3,
          chaseDistance: 6,
          patrolRadius: 0,
          speed: 1,
          state: "return"
        }
      },
      "neutral-2": {
        id: "neutral-2",
        position: { x: 4, y: 2 },
        origin: { x: 4, y: 2 },
        reward: { kind: "gold", amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }],
        behavior: {
          mode: "guard",
          patrolPath: [],
          patrolIndex: 0,
          detectionRadius: 3,
          chaseDistance: 6,
          patrolRadius: 0,
          speed: 1,
          state: "return"
        }
      }
    },
    tiles: Array.from({ length: 21 }, (_, index) => {
      const x = index % 7;
      const y = Math.floor(index / 7);
      if (x === 0 && y === 0) {
        return createTile(x, y, { occupant: { kind: "hero", refId: "hero-1" } });
      }
      if (x === 3 && y === 0) {
        return createTile(x, y, { occupant: { kind: "neutral", refId: "neutral-1" } });
      }
      if (x === 6 && y === 2) {
        return createTile(x, y, { occupant: { kind: "hero", refId: "hero-2" } });
      }
      if (x === 4 && y === 2) {
        return createTile(x, y, { occupant: { kind: "neutral", refId: "neutral-2" } });
      }
      return createTile(x, y);
    })
  });

  const outcome = resolveWorldAction(state, { type: "turn.endDay" });

  assert.deepEqual(outcome.events, [
    {
      type: "turn.advanced",
      day: 2
    },
    {
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 3, y: 0 },
      to: { x: 2, y: 0 },
      reason: "chase",
      targetHeroId: "hero-1"
    },
    {
      type: "neutral.moved",
      neutralArmyId: "neutral-2",
      from: { x: 4, y: 2 },
      to: { x: 5, y: 2 },
      reason: "chase",
      targetHeroId: "hero-2"
    }
  ]);
});

test("resolveWorldAction routes neutral chase movement around walls instead of through them", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 1 }
  });
  const state = createWorldState({
    width: 5,
    height: 3,
    heroes: [hero],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 4, y: 1 },
        origin: { x: 4, y: 1 },
        reward: { kind: "gold", amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }],
        behavior: {
          mode: "guard",
          patrolPath: [],
          patrolIndex: 0,
          detectionRadius: 6,
          chaseDistance: 8,
          patrolRadius: 0,
          speed: 2,
          state: "return"
        }
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(2, 0),
      createTile(3, 0),
      createTile(4, 0),
      createTile(0, 1, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 1, { walkable: false, terrain: "water" }),
      createTile(2, 1, { walkable: false, terrain: "water" }),
      createTile(3, 1, { walkable: false, terrain: "water" }),
      createTile(4, 1, { occupant: { kind: "neutral", refId: "neutral-1" } }),
      createTile(0, 2),
      createTile(1, 2),
      createTile(2, 2),
      createTile(3, 2),
      createTile(4, 2)
    ]
  });

  const outcome = resolveWorldAction(state, { type: "turn.endDay" });

  assert.deepEqual(outcome.events[0], {
    type: "turn.advanced",
    day: 2
  });
  assert.deepEqual(outcome.events[1], {
    type: "neutral.moved",
    neutralArmyId: "neutral-1",
    from: { x: 4, y: 1 },
    to: outcome.events[1]?.type === "neutral.moved" && outcome.events[1].to.y === 0 ? { x: 3, y: 0 } : { x: 3, y: 2 },
    reason: "chase",
    targetHeroId: "hero-1"
  });
});

test("planPlayerViewMovement stops at the tile before a visible neutral encounter", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 },
    move: { total: 6, remaining: 6 }
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 2, y: 0 },
    reward: { kind: "gold", amount: 300 },
    stacks: [{ templateId: "wolf_pack", count: 8 }]
  };
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: { "neutral-1": neutralArmy },
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible"]
    }
  });

  const view = createPlayerWorldView(state, "player-1");
  const plan = planPlayerViewMovement(view, "hero-1", { x: 2, y: 0 });

  assert.equal(plan?.endsInEncounter, true);
  assert.equal(plan?.encounterKind, "neutral");
  assert.deepEqual(plan?.travelPath, [
    { x: 0, y: 0 },
    { x: 1, y: 0 }
  ]);
  assert.equal(plan?.moveCost, 1);
});

test("predictPlayerWorldAction updates the player view immediately for move and collect", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 },
    move: { total: 6, remaining: 6 }
  });
  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [hero],
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0, { resource: { kind: "wood", amount: 5 } }),
      createTile(0, 1),
      createTile(1, 1)
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible", "visible"]
    }
  });

  const view = createPlayerWorldView(state, "player-1");
  const predictedMove = predictPlayerWorldAction(view, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 1, y: 0 }
  });

  assert.equal(predictedMove.reason, undefined);
  assert.equal(predictedMove.world.ownHeroes[0]?.position.x, 1);
  assert.equal(predictedMove.world.ownHeroes[0]?.position.y, 0);
  assert.equal(predictedMove.world.ownHeroes[0]?.move.remaining, 5);
  assert.equal(
    predictedMove.world.map.tiles.find((tile) => tile.position.x === 0 && tile.position.y === 0)?.occupant,
    undefined
  );
  assert.deepEqual(
    predictedMove.world.map.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 0)?.occupant,
    { kind: "hero", refId: "hero-1" }
  );

  const predictedCollect = predictPlayerWorldAction(predictedMove.world, {
    type: "hero.collect",
    heroId: "hero-1",
    position: { x: 1, y: 0 }
  });

  assert.equal(predictedCollect.reason, undefined);
  assert.deepEqual(predictedCollect.world.resources, { gold: 0, wood: 5, ore: 0 });
  assert.equal(
    predictedCollect.world.map.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 0)?.resource,
    undefined
  );
});

test("applyBattleOutcomeToWorld penalizes the hero on defeat and keeps the neutral army", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 0 }
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 2, y: 0 },
    reward: { kind: "gold", amount: 300 },
    stacks: [{ templateId: "wolf_pack", count: 8 }]
  };
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: { "neutral-1": neutralArmy },
    tiles: [
      createTile(0, 0),
      createTile(1, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = applyBattleOutcomeToWorld(state, "battle-neutral-1", "hero-1", {
    status: "defender_victory",
    survivingAttackers: [],
    survivingDefenders: ["neutral-1-stack-1"]
  });

  assert.equal(outcome.state.heroes[0]?.position.x, 1);
  assert.equal(outcome.state.heroes[0]?.stats.hp, 15);
  assert.equal(outcome.state.heroes[0]?.move.remaining, 0);
  assert.ok(outcome.state.neutralArmies["neutral-1"]);
  assert.deepEqual(outcome.events, [
    {
      type: "battle.resolved",
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      battleId: "battle-neutral-1",
      result: "defender_victory"
    }
  ]);
});

test("applyBattleOutcomeToWorld keeps defenderHeroId on hero-vs-hero resolution events", () => {
  const attacker = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 }
  });
  const defender = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 2, y: 1 }
  });
  const state = createWorldState({
    width: 3,
    height: 3,
    heroes: [attacker, defender],
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(2, 0),
      createTile(0, 1),
      createTile(1, 1, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 1, { occupant: { kind: "hero", refId: "hero-2" } }),
      createTile(0, 2),
      createTile(1, 2),
      createTile(2, 2)
    ]
  });

  const outcome = applyBattleOutcomeToWorld(state, "battle-hero-1-vs-hero-2", "hero-1", {
    status: "attacker_victory",
    survivingAttackers: ["hero-1-stack"],
    survivingDefenders: []
  });

  assert.deepEqual(outcome.events, [
    {
      type: "battle.resolved",
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      defenderHeroId: "hero-2",
      defenderPlayerId: "player-2",
      battleId: "battle-hero-1-vs-hero-2",
      result: "attacker_victory"
    },
    {
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-hero-1-vs-hero-2",
      battleKind: "hero",
      experienceGained: 164,
      totalExperience: 164,
      level: 2,
      levelsGained: 1,
      skillPointsAwarded: 1,
      availableSkillPoints: 1
    }
  ]);
});

test("filterWorldEventsForPlayer hides unrelated hero timelines while keeping mine income and both sides of PvP encounters", () => {
  const attacker = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 }
  });
  const defender = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 2, y: 1 }
  });
  const bystander = createHero({
    id: "hero-3",
    playerId: "player-3",
    name: "萨恩",
    position: { x: 0, y: 0 }
  });
  const state = createWorldState({
    heroes: [attacker, defender, bystander]
  });
  const events = [
    {
      type: "hero.moved" as const,
      heroId: "hero-1",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    },
    {
      type: "hero.collected" as const,
      heroId: "hero-3",
      resource: { kind: "wood" as const, amount: 5 }
    },
    {
      type: "battle.started" as const,
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      defenderHeroId: "hero-2",
      defenderPlayerId: "player-2",
      encounterKind: "hero" as const,
      battleId: "battle-hero-1-vs-hero-2",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    },
    {
      type: "battle.resolved" as const,
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      defenderHeroId: "hero-2",
      defenderPlayerId: "player-2",
      battleId: "battle-hero-1-vs-hero-2",
      result: "attacker_victory" as const
    },
    {
      type: "hero.claimedMine" as const,
      heroId: "hero-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine" as const,
      resourceKind: "wood" as const,
      income: 2,
      ownerPlayerId: "player-1"
    },
    {
      type: "resource.produced" as const,
      playerId: "player-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine" as const,
      resource: {
        kind: "wood" as const,
        amount: 2
      }
    },
    {
      type: "resource.produced" as const,
      playerId: "player-3",
      buildingId: "mine-2",
      buildingKind: "resource_mine" as const,
      resource: {
        kind: "gold" as const,
        amount: 300
      }
    },
    {
      type: "turn.advanced" as const,
      day: 2
    }
  ];

  assert.deepEqual(filterWorldEventsForPlayer(state, "player-1", events), [
    events[0],
    events[2],
    events[3],
    events[4],
    events[5],
    events[7]
  ]);
  assert.deepEqual(filterWorldEventsForPlayer(state, "player-2", events), [events[2], events[3], events[7]]);
  assert.deepEqual(filterWorldEventsForPlayer(state, "player-3", events), [events[1], events[6], events[7]]);
});

test("filterWorldEventsForPlayer falls back to participant player ids when battle heroes are no longer present", () => {
  const state = createWorldState({
    heroes: [
      createHero({
        id: "hero-3",
        playerId: "player-3",
        name: "旁观者",
        position: { x: 0, y: 0 }
      })
    ]
  });
  const events = [
    {
      type: "battle.started" as const,
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      defenderHeroId: "hero-2",
      defenderPlayerId: "player-2",
      encounterKind: "hero" as const,
      battleId: "battle-hero-1-vs-hero-2",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    },
    {
      type: "battle.resolved" as const,
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      defenderHeroId: "hero-2",
      defenderPlayerId: "player-2",
      battleId: "battle-hero-1-vs-hero-2",
      result: "defender_victory" as const
    }
  ];

  assert.deepEqual(filterWorldEventsForPlayer(state, "player-1", events), events);
  assert.deepEqual(filterWorldEventsForPlayer(state, "player-2", events), events);
  assert.deepEqual(filterWorldEventsForPlayer(state, "player-3", events), []);
});

test("applyBattleAction uses deterministic damage and retaliation flow", () => {
  const initial = createDemoBattleState();
  const activeUnitId = initial.activeUnitId;
  assert.equal(activeUnitId, "wolf-d");

  const next = applyBattleAction(initial, {
    type: "battle.attack",
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  });

  assert.equal(next.rng.cursor, 2);
  assert.equal(next.round, 1);
  assert.equal(next.activeUnitId, "pikeman-a");
  assert.equal(next.units["pikeman-a"]?.count, 10);
  assert.equal(next.units["pikeman-a"]?.currentHp, 1);
  assert.equal(next.units["pikeman-a"]?.hasRetaliated, true);
  assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.id, "poisoned");
  assert.equal(next.units["wolf-d"]?.count, 6);
  assert.equal(next.units["wolf-d"]?.currentHp, 6);
  assert.deepEqual(next.log.slice(-4), [
    "恶狼 对 枪兵 造成 27 伤害",
    "恶狼 的毒牙让 枪兵 陷入中毒",
    "枪兵 反击 恶狼，造成 18 伤害",
    "枪兵 受到中毒影响，损失 2 生命"
  ]);
});

test("applyBattleAction supports active ranged skills without retaliation", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];

  const next = applyBattleAction(initial, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "power_shot",
    targetId: "wolf-d"
  });

  assert.equal(next.rng.cursor, 1);
  assert.equal(next.activeUnitId, "wolf-d");
  assert.equal(next.units["pikeman-a"]?.count, 12);
  assert.equal(next.units["wolf-d"]?.count, 6);
  assert.equal(next.units["wolf-d"]?.hasRetaliated, false);
  assert.equal(next.units["pikeman-a"]?.skills?.find((skill) => skill.id === "power_shot")?.remainingCooldown, 2);
  assert.match(next.log.at(-1) ?? "", /投矛射击/);
});

test("executeBattleSkill resolves enemy and self-target skills through the shared battle path", () => {
  const rangedState = createDemoBattleState();
  rangedState.activeUnitId = "pikeman-a";
  rangedState.turnOrder = ["pikeman-a", "wolf-d"];

  const rangedNext = executeBattleSkill(rangedState, "pikeman-a", "power_shot", "wolf-d");

  assert.equal(rangedNext.activeUnitId, "wolf-d");
  assert.equal(rangedNext.units["pikeman-a"]?.skills?.find((skill) => skill.id === "power_shot")?.remainingCooldown, 2);
  assert.equal(rangedNext.units["wolf-d"]?.hasRetaliated, false);
  assert.match(rangedNext.log.at(-1) ?? "", /投矛射击/);

  const buffState = createDemoBattleState();
  buffState.activeUnitId = "pikeman-a";
  buffState.turnOrder = ["pikeman-a", "wolf-d"];

  const buffNext = executeBattleSkill(buffState, "pikeman-a", "armor_spell", "pikeman-a");

  assert.equal(buffNext.activeUnitId, "wolf-d");
  assert.equal(buffNext.units["pikeman-a"]?.statusEffects?.[0]?.id, "arcane_armor");
  assert.equal(buffNext.units["pikeman-a"]?.skills?.find((skill) => skill.id === "armor_spell")?.remainingCooldown, 3);
  assert.match(buffNext.log.at(-1) ?? "", /护甲术/);
});

test("applyBattleAction supports armor spell buffs on the acting unit", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];

  const next = applyBattleAction(initial, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "armor_spell",
    targetId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.id, "arcane_armor");
  assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.defenseModifier, 3);
  assert.equal(next.units["pikeman-a"]?.skills?.find((skill) => skill.id === "armor_spell")?.remainingCooldown, 3);
  assert.match(next.log.at(-1) ?? "", /护甲术/);
});

test("applyBattleAction reduces damage against defending targets", () => {
  const baselineState = createDemoBattleState();
  baselineState.activeUnitId = "wolf-d";
  baselineState.turnOrder = ["wolf-d", "pikeman-a"];
  baselineState.units["wolf-d"] = {
    ...baselineState.units["wolf-d"]!,
    attack: 12,
    minDamage: 6,
    maxDamage: 6,
    count: 4
  };
  baselineState.units["pikeman-a"] = {
    ...baselineState.units["pikeman-a"]!,
    defense: 0,
    count: 6,
    currentHp: 10,
    defending: false
  };

  const defendingState = cloneBattleState(baselineState);
  defendingState.units["pikeman-a"] = {
    ...defendingState.units["pikeman-a"]!,
    defending: true
  };

  const baselineNext = applyBattleAction(baselineState, {
    type: "battle.attack",
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  });
  const defendingNext = applyBattleAction(defendingState, {
    type: "battle.attack",
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  });

  const baselineDefender = baselineNext.units["pikeman-a"]!;
  const defendingDefender = defendingNext.units["pikeman-a"]!;

  assert.ok(
    defendingDefender.count > baselineDefender.count ||
      (defendingDefender.count === baselineDefender.count && defendingDefender.currentHp > baselineDefender.currentHp)
  );
});

test("pickAutomatedBattleAction prefers ready skills before default attacks", () => {
  const initial = createDemoBattleState();

  assert.deepEqual(pickAutomatedBattleAction(initial), {
    type: "battle.skill",
    unitId: "wolf-d",
    skillId: "crippling_howl",
    targetId: "pikeman-a"
  });

  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];

  assert.deepEqual(pickAutomatedBattleAction(initial), {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "armor_spell",
    targetId: "pikeman-a"
  });
});

test("validateBattleAction covers wait and skill rejection branches", () => {
  const initial = createDemoBattleState();

  assert.deepEqual(validateBattleAction(initial, { type: "battle.wait", unitId: "pikeman-a" }), {
    valid: false,
    reason: "unit_not_active"
  });

  const unavailableWaitState = cloneBattleState(initial);
  unavailableWaitState.activeUnitId = "pikeman-a";
  unavailableWaitState.turnOrder = ["pikeman-a", "wolf-d"];
  unavailableWaitState.units["pikeman-a"] = {
    ...unavailableWaitState.units["pikeman-a"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(validateBattleAction(unavailableWaitState, { type: "battle.wait", unitId: "pikeman-a" }), {
    valid: false,
    reason: "unit_not_available"
  });

  assert.deepEqual(
    validateBattleAction(initial, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "power_shot",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "unit_not_active"
    }
  );

  const unavailableCasterState = cloneBattleState(initial);
  unavailableCasterState.activeUnitId = "pikeman-a";
  unavailableCasterState.turnOrder = ["pikeman-a", "wolf-d"];
  unavailableCasterState.units["pikeman-a"] = {
    ...unavailableCasterState.units["pikeman-a"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(
    validateBattleAction(unavailableCasterState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "power_shot",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "unit_not_available"
    }
  );

  const passiveSkillState = cloneBattleState(initial);
  assert.deepEqual(
    validateBattleAction(passiveSkillState, {
      type: "battle.skill",
      unitId: "wolf-d",
      skillId: "venomous_fangs",
      targetId: "pikeman-a"
    }),
    {
      valid: false,
      reason: "skill_not_available"
    }
  );

  const cooldownState = cloneBattleState(initial);
  cooldownState.activeUnitId = "pikeman-a";
  cooldownState.turnOrder = ["pikeman-a", "wolf-d"];
  cooldownState.units["pikeman-a"] = {
    ...cooldownState.units["pikeman-a"]!,
    skills: cooldownState.units["pikeman-a"]!.skills?.map((skill) =>
      skill.id === "power_shot" ? { ...skill, remainingCooldown: 1 } : skill
    )
  };
  assert.deepEqual(
    validateBattleAction(cooldownState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "power_shot",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "skill_on_cooldown"
    }
  );

  assert.deepEqual(
    validateBattleAction(cooldownState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "armor_spell",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "invalid_skill_target"
    }
  );

  assert.deepEqual(
    validateBattleAction(cooldownState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "armor_spell"
    }),
    {
      valid: true
    }
  );

  assert.deepEqual(
    validateBattleAction(
      {
        ...cloneBattleState(initial),
        activeUnitId: "pikeman-a",
        turnOrder: ["pikeman-a", "wolf-d"]
      },
      {
        type: "battle.skill",
        unitId: "pikeman-a",
        skillId: "power_shot"
      }
    ),
    {
      valid: false,
      reason: "skill_target_missing"
    }
  );

  const missingTargetState = cloneBattleState(cooldownState);
  missingTargetState.units["wolf-d"] = {
    ...missingTargetState.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(
    validateBattleAction(missingTargetState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "sundering_spear",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "defender_not_available"
    }
  );

  const friendlyTargetState = cloneBattleState(cooldownState);
  friendlyTargetState.units["ally-a"] = {
    ...cloneBattleUnit(friendlyTargetState.units["pikeman-a"]!),
    id: "ally-a",
    stackName: "友军枪兵"
  };
  assert.deepEqual(
    validateBattleAction(friendlyTargetState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "sundering_spear",
      targetId: "ally-a"
    }),
    {
      valid: false,
      reason: "friendly_fire_blocked"
    }
  );
});

test("validateBattleAction covers attack rejection branches", () => {
  const initial = createDemoBattleState();

  assert.deepEqual(
    validateBattleAction(initial, {
      type: "battle.attack",
      attackerId: "pikeman-a",
      defenderId: "wolf-d"
    }),
    {
      valid: false,
      reason: "attacker_not_active"
    }
  );

  const unavailableAttackerState = cloneBattleState(initial);
  unavailableAttackerState.units["wolf-d"] = {
    ...unavailableAttackerState.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(
    validateBattleAction(unavailableAttackerState, {
      type: "battle.attack",
      attackerId: "wolf-d",
      defenderId: "pikeman-a"
    }),
    {
      valid: false,
      reason: "attacker_not_available"
    }
  );

  const unavailableDefenderState = cloneBattleState(initial);
  unavailableDefenderState.units["pikeman-a"] = {
    ...unavailableDefenderState.units["pikeman-a"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(
    validateBattleAction(unavailableDefenderState, {
      type: "battle.attack",
      attackerId: "wolf-d",
      defenderId: "pikeman-a"
    }),
    {
      valid: false,
      reason: "defender_not_available"
    }
  );

  const friendlyAttackState = cloneBattleState(initial);
  friendlyAttackState.activeUnitId = "pikeman-a";
  friendlyAttackState.turnOrder = ["pikeman-a", "wolf-d"];
  friendlyAttackState.units["ally-a"] = {
    ...cloneBattleUnit(friendlyAttackState.units["pikeman-a"]!),
    id: "ally-a",
    stackName: "友军枪兵"
  };
  assert.deepEqual(
    validateBattleAction(friendlyAttackState, {
      type: "battle.attack",
      attackerId: "pikeman-a",
      defenderId: "ally-a"
    }),
    {
      valid: false,
      reason: "friendly_fire_blocked"
    }
  );

  const validAttackState = cloneBattleState(initial);
  assert.deepEqual(
    validateBattleAction(validAttackState, {
      type: "battle.attack",
      attackerId: "wolf-d",
      defenderId: "pikeman-a"
    }),
    {
      valid: true
    }
  );
});

test("applyBattleAction logs rejected actions without mutating battle flow", () => {
  const initial = createDemoBattleState();

  const next = applyBattleAction(initial, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.equal(next.activeUnitId, initial.activeUnitId);
  assert.deepEqual(next.turnOrder, initial.turnOrder);
  assert.equal(next.log.at(-1), "Action rejected: attacker_not_active");
});

test("applyBattleAction resolves wait plus turn-start poison death and cooldown ticking", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];
  initial.units["wolf-d"] = {
    ...initial.units["wolf-d"]!,
    count: 1,
    currentHp: 2,
    skills: initial.units["wolf-d"]!.skills?.map((skill) =>
      skill.id === "crippling_howl" ? { ...skill, remainingCooldown: 1 } : skill
    ),
    statusEffects: [
      {
        id: "poisoned",
        name: "中毒",
        description: "回合开始时损失生命。",
        durationRemaining: 1,
        attackModifier: 0,
        defenseModifier: 0,
        damagePerTurn: 2,
        initiativeModifier: 0,
        blocksActiveSkills: false
      }
    ]
  };

  const next = applyBattleAction(initial, {
    type: "battle.wait",
    unitId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "pikeman-a");
  assert.deepEqual(next.turnOrder, ["pikeman-a"]);
  assert.equal(next.units["wolf-d"]?.count, 0);
  assert.equal(next.units["wolf-d"]?.currentHp, 0);
  assert.equal(next.units["wolf-d"]?.skills?.find((skill) => skill.id === "crippling_howl")?.remainingCooldown, 0);
  assert.deepEqual(next.units["wolf-d"]?.statusEffects, []);
  assert.deepEqual(next.log.slice(-3), ["pikeman-a 选择等待", "恶狼 受到中毒影响，损失 2 生命", "恶狼 的中毒结束"]);
});

test("applyBattleAction advances into turn-start processing even when the next unit has no skills", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.units["wolf-d"] = {
    ...state.units["wolf-d"]!,
    skills: undefined
  };

  const next = applyBattleAction(state, {
    type: "battle.wait",
    unitId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.units["wolf-d"]?.skills, []);
  assert.equal(next.log.at(-1), "pikeman-a 选择等待");
});

test("applyBattleAction defend refreshes the round and clears temporary flags", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a"];
  initial.units["pikeman-a"] = {
    ...initial.units["pikeman-a"]!,
    hasRetaliated: true,
    defending: true
  };
  initial.units["wolf-d"] = {
    ...initial.units["wolf-d"]!,
    hasRetaliated: true,
    defending: true
  };

  const next = applyBattleAction(initial, {
    type: "battle.defend",
    unitId: "pikeman-a"
  });

  assert.equal(next.round, 2);
  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.turnOrder, ["wolf-d", "pikeman-a"]);
  assert.equal(next.units["pikeman-a"]?.hasRetaliated, false);
  assert.equal(next.units["wolf-d"]?.hasRetaliated, false);
  assert.equal(next.units["pikeman-a"]?.defending, false);
  assert.equal(next.units["wolf-d"]?.defending, false);
  assert.equal(next.log.at(-1), "pikeman-a 进入防御");
});

test("applyBattleAction refreshes explicit on-hit statuses instead of stacking them", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];
  initial.units["wolf-d"] = {
    ...initial.units["wolf-d"]!,
    statusEffects: [
      {
        id: "armor_break",
        name: "破甲",
        description: "短时间内护甲被撕裂，防御力下降。",
        durationRemaining: 1,
        attackModifier: 0,
        defenseModifier: -2,
        damagePerTurn: 0,
        initiativeModifier: 0,
        blocksActiveSkills: false,
        sourceUnitId: "someone-else"
      }
    ]
  };

  const next = applyBattleAction(initial, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "sundering_spear",
    targetId: "wolf-d"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.equal(next.units["wolf-d"]?.statusEffects?.length, 1);
  assert.equal(next.units["wolf-d"]?.statusEffects?.[0]?.id, "armor_break");
  assert.equal(next.units["wolf-d"]?.statusEffects?.[0]?.durationRemaining, 1);
  assert.equal(next.units["wolf-d"]?.statusEffects?.[0]?.sourceUnitId, "pikeman-a");
  assert.equal(next.units["wolf-d"]?.hasRetaliated, true);
  assert.equal(next.units["pikeman-a"]?.skills?.find((skill) => skill.id === "sundering_spear")?.remainingCooldown, 2);
  assert.match(next.log.join("\n"), /破甲投枪/);
  assert.match(next.log.join("\n"), /陷入破甲/);
});

test("applyBattleAction does not attach on-hit statuses to targets defeated by the strike", () => {
  const state = createDemoBattleState();
  state.units["pikeman-a"] = {
    ...state.units["pikeman-a"]!,
    count: 1,
    currentHp: 1,
    statusEffects: []
  };

  const next = applyBattleAction(state, {
    type: "battle.attack",
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  });

  assert.equal(next.units["pikeman-a"]?.count, 0);
  assert.equal(next.units["pikeman-a"]?.currentHp, 0);
  assert.deepEqual(next.units["pikeman-a"]?.statusEffects, []);
  assert.match(next.log.at(-1) ?? "", /造成 \d+ 伤害/);
});

test("pickAutomatedBattleAction falls back between buff, enemy skill, attack, and null states", () => {
  const buffedState = createDemoBattleState();
  buffedState.activeUnitId = "pikeman-a";
  buffedState.turnOrder = ["pikeman-a", "wolf-d"];
  buffedState.units["pikeman-a"] = {
    ...buffedState.units["pikeman-a"]!,
    statusEffects: [
      {
        id: "arcane_armor",
        name: "护甲术",
        description: "临时提升防御。",
        durationRemaining: 2,
        attackModifier: 0,
        defenseModifier: 3,
        damagePerTurn: 0,
        initiativeModifier: 0,
        blocksActiveSkills: false
      },
      {
        id: "battle_frenzy",
        name: "战意激发",
        description: "短暂提升攻击。",
        durationRemaining: 2,
        attackModifier: 2,
        defenseModifier: 0,
        damagePerTurn: 0,
        initiativeModifier: 0,
        blocksActiveSkills: false
      }
    ]
  };

  assert.deepEqual(pickAutomatedBattleAction(buffedState), {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "sundering_spear",
    targetId: "wolf-d"
  });

  buffedState.units["wolf-d"] = {
    ...buffedState.units["wolf-d"]!,
    statusEffects: [
      {
        id: "armor_break",
        name: "破甲",
        description: "短时间内护甲被撕裂，防御力下降。",
        durationRemaining: 2,
        attackModifier: 0,
        defenseModifier: -2,
        damagePerTurn: 0,
        initiativeModifier: 0,
        blocksActiveSkills: false
      }
    ]
  };
  assert.deepEqual(pickAutomatedBattleAction(buffedState), {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "power_shot",
    targetId: "wolf-d"
  });

  const fallbackState = cloneBattleState(buffedState);
  fallbackState.units["pikeman-a"] = {
    ...fallbackState.units["pikeman-a"]!,
    skills: fallbackState.units["pikeman-a"]!.skills?.map((skill) => ({ ...skill, remainingCooldown: 1 }))
  };
  assert.deepEqual(pickAutomatedBattleAction(fallbackState), {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  const noEnemyState = cloneBattleState(fallbackState);
  noEnemyState.units["wolf-d"] = {
    ...noEnemyState.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.equal(pickAutomatedBattleAction(noEnemyState), null);

  const noActiveState = cloneBattleState(fallbackState);
  noActiveState.activeUnitId = null;
  assert.equal(pickAutomatedBattleAction(noActiveState), null);
});

test("battle outcome helpers report in-progress and both victory states", () => {
  const inProgress = createDemoBattleState();
  assert.deepEqual(getBattleOutcome(inProgress), { status: "in_progress" });

  const attackerVictory = cloneBattleState(inProgress);
  attackerVictory.units["wolf-d"] = {
    ...attackerVictory.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(getBattleOutcome(attackerVictory), {
    status: "attacker_victory",
    survivingAttackers: ["pikeman-a"],
    survivingDefenders: []
  });

  const defenderVictory = cloneBattleState(inProgress);
  defenderVictory.units["pikeman-a"] = {
    ...defenderVictory.units["pikeman-a"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(getBattleOutcome(defenderVictory), {
    status: "defender_victory",
    survivingAttackers: [],
    survivingDefenders: ["wolf-d"]
  });
});

test("createEmptyBattleState returns the minimal neutral battle shell", () => {
  assert.deepEqual(createEmptyBattleState(), {
    id: "battle-empty",
    round: 0,
    lanes: 1,
    activeUnitId: null,
    turnOrder: [],
    units: {},
    environment: [],
    log: [],
    rng: {
      seed: 1,
      cursor: 0
    }
  });
});

test("simulateAutomatedBattle resolves a deterministic demo encounter and records skill usage", () => {
  const result = simulateAutomatedBattle(createDemoBattleState());

  assert.notEqual(result.outcome.status, "in_progress");
  assert.ok(result.turns > 0);
  assert.ok(result.rounds >= 1);
  assert.ok(Object.values(result.skillUsage).reduce((total, value) => total + value, 0) > 0);
  assert.equal(result.maxActionsReached, false);
});

test("simulateAutomatedBattles aggregates win rate, rounds, and skill usage across repeated auto battles", () => {
  const world = createWorldStateFromConfigs(getDefaultWorldConfig(), getDefaultMapObjectsConfig(), 1001, "metrics-room");
  const attacker = world.heroes[0]!;
  const neutralArmy = Object.values(world.neutralArmies)[0]!;

  const metrics = simulateAutomatedBattles(
    (battleIndex) => createNeutralBattleState(attacker, neutralArmy, 5000 + battleIndex),
    12
  );

  assert.equal(metrics.battleCount, 12);
  assert.equal(metrics.attackerWins + metrics.defenderWins + metrics.unresolvedBattles, 12);
  assert.ok(metrics.averageRounds >= 1);
  assert.ok(metrics.averageTurns >= 1);
  assert.ok(metrics.maxRounds >= metrics.minRounds);
  assert.ok(metrics.totalSkillUses > 0);
  assert.ok(metrics.skillUsage.length > 0);
  assert.equal(
    metrics.skillUsage.every((entry, index, entries) => index === 0 || entries[index - 1]!.uses >= entry.uses),
    true
  );
});

test("battle-skills-v1.1 preset validates against the shared runtime schema", () => {
  const presetContent = readFileSync(
    new URL("../../../configs/battle-skills-v1.1.json", import.meta.url),
    "utf8"
  );
  const preset = JSON.parse(presetContent) as ReturnType<typeof getDefaultBattleSkillCatalog>;

  assert.doesNotThrow(() => setBattleSkillCatalog(preset));

  resetRuntimeConfigs();
});

test("applyBattleAction routes contact attacks through blockers before hitting the target", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.units["wolf-d"] = {
    ...state.units["wolf-d"]!,
    hasRetaliated: true
  };
  state.environment = [
    {
      id: "hazard-blocker-0",
      kind: "blocker",
      lane: 0,
      name: "碎石路障",
      description: "近身接战前需要先破开这道障碍。",
      durability: 1,
      maxDurability: 1
    }
  ];

  const next = applyBattleAction(state, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.environment, []);
  assert.equal(next.units["wolf-d"]?.count, 8);
  assert.equal(next.units["wolf-d"]?.currentHp, 8);
  assert.deepEqual(next.log.slice(-2), [
    "枪兵 被 碎石路障 阻挡，只能先破开障碍",
    "碎石路障 被击碎，1 线重新打开"
  ]);
});

test("applyBattleAction triggers contact traps before the strike and logs granted statuses", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.units["wolf-d"] = {
    ...state.units["wolf-d"]!,
    hasRetaliated: true
  };
  state.environment = [
    {
      id: "hazard-trap-0",
      kind: "trap",
      lane: 0,
      effect: "damage",
      name: "捕兽夹陷阱",
      description: "近身突进时会先被陷阱割伤并短暂削弱。",
      damage: 2,
      charges: 1,
      revealed: false,
      triggered: false,
      grantedStatusId: "weakened",
      triggeredByCamp: "both"
    }
  ];

  const next = applyBattleAction(state, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.deepEqual(next.environment, [
    {
      id: "hazard-trap-0",
      kind: "trap",
      lane: 0,
      effect: "damage",
      name: "捕兽夹陷阱",
      description: "近身突进时会先被陷阱割伤并短暂削弱。",
      damage: 2,
      charges: 0,
      revealed: true,
      triggered: true,
      grantedStatusId: "weakened",
      triggeredByCamp: "both"
    }
  ]);
  assert.equal(next.units["pikeman-a"]?.currentHp, 8);
  assert.deepEqual(next.units["pikeman-a"]?.statusEffects?.map((status) => status.id), ["weakened"]);
  assert.deepEqual(next.log.slice(-5, -1), [
    "枪兵 踩中隐藏陷阱 捕兽夹陷阱，陷阱位置暴露",
    "枪兵 触发 捕兽夹陷阱，损失 2 生命",
    "枪兵 因 捕兽夹陷阱 陷入削弱",
    "捕兽夹陷阱 已失效，但该位置对双方保持可见"
  ]);
  assert.match(next.log.at(-1) ?? "", /^枪兵 对 恶狼 造成 \d+ 伤害$/);
});

test("applyBattleAction lets ranged skills bypass blockers and traps", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.environment = [
    {
      id: "hazard-blocker-0",
      kind: "blocker",
      lane: 0,
      name: "碎石路障",
      description: "近身接战前需要先破开这道障碍。",
      durability: 1,
      maxDurability: 1
    },
    {
      id: "hazard-trap-0",
      kind: "trap",
      lane: 0,
      effect: "damage",
      name: "捕兽夹陷阱",
      description: "近身突进时会先被陷阱割伤并短暂削弱。",
      damage: 2,
      charges: 1,
      revealed: false,
      triggered: false,
      grantedStatusId: "weakened",
      triggeredByCamp: "both"
    }
  ];

  const next = applyBattleAction(state, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "power_shot",
    targetId: "wolf-d"
  });

  assert.equal(next.units["pikeman-a"]?.currentHp, 10);
  assert.deepEqual(next.units["pikeman-a"]?.statusEffects, []);
  assert.deepEqual(next.environment, state.environment);
  assert.match(next.log.at(-1) ?? "", /^枪兵 施放 投矛射击，对 恶狼 造成 \d+ 伤害$/);
});

test("applyBattleAction reveals silence traps and blocks active skills on the affected unit", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.units["wolf-d"] = {
    ...state.units["wolf-d"]!,
    hasRetaliated: true
  };
  state.environment = [
    {
      id: "hazard-trap-0",
      kind: "trap",
      lane: 0,
      effect: "silence",
      name: "封咒符印",
      description: "触发后短时间内无法施放主动技能。",
      damage: 0,
      charges: 1,
      revealed: false,
      triggered: false,
      grantedStatusId: "silenced",
      triggeredByCamp: "both"
    }
  ];

  const next = applyBattleAction(state, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });
  const silencedTurnState = {
    ...next,
    activeUnitId: "pikeman-a",
    turnOrder: ["pikeman-a", "wolf-d"]
  };
  const rejected = applyBattleAction(silencedTurnState, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "power_shot",
    targetId: "wolf-d"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.environment, [
    {
      id: "hazard-trap-0",
      kind: "trap",
      lane: 0,
      effect: "silence",
      name: "封咒符印",
      description: "触发后短时间内无法施放主动技能。",
      damage: 0,
      charges: 0,
      revealed: true,
      triggered: true,
      grantedStatusId: "silenced",
      triggeredByCamp: "both"
    }
  ]);
  assert.deepEqual(next.units["pikeman-a"]?.statusEffects?.map((status) => status.id), ["silenced"]);
  assert.deepEqual(next.log.slice(-4, -1), [
    "枪兵 踩中隐藏陷阱 封咒符印，陷阱位置暴露",
    "枪兵 因 封咒符印 陷入禁魔",
    "封咒符印 已失效，但该位置对双方保持可见"
  ]);
  assert.equal(rejected.log.at(-1), "Action rejected: skill_disabled");
});

test("slow traps change the next round turn order", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.units["pikeman-a"] = {
    ...state.units["pikeman-a"]!,
    initiative: 13
  };
  state.units["wolf-d"] = {
    ...state.units["wolf-d"]!,
    hasRetaliated: true
  };
  state.environment = [
    {
      id: "hazard-trap-0",
      kind: "trap",
      lane: 0,
      effect: "slow",
      name: "缠足泥沼",
      description: "踩中后会被拖慢，下一轮行动明显延后。",
      damage: 0,
      charges: 1,
      revealed: false,
      triggered: false,
      grantedStatusId: "slowed",
      triggeredByCamp: "both"
    }
  ];

  const afterTrap = applyBattleAction(state, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });
  const nextRound = applyBattleAction(afterTrap, {
    type: "battle.defend",
    unitId: "wolf-d"
  });

  assert.deepEqual(afterTrap.units["pikeman-a"]?.statusEffects?.map((status) => status.id), ["slowed"]);
  assert.equal(nextRound.round, 2);
  assert.deepEqual(nextRound.turnOrder, ["wolf-d", "pikeman-a"]);
});

test("applyBattleAction supports self-target skills without granted statuses", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.skills.push({
    id: "steady_pose",
    name: "稳固架势",
    description: "稳住阵脚，为下一轮交换位置做准备。",
    kind: "active",
    target: "self",
    cooldown: 1,
    effects: {}
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const state = createDemoBattleState();
    state.activeUnitId = "pikeman-a";
    state.turnOrder = ["pikeman-a", "wolf-d"];
    state.units["pikeman-a"] = {
      ...state.units["pikeman-a"]!,
      skills: [
        {
          id: "steady_pose",
          name: "稳固架势",
          description: "稳住阵脚，为下一轮交换位置做准备。",
          kind: "active",
          target: "self",
          cooldown: 1,
          remainingCooldown: 0
        }
      ],
      statusEffects: []
    };

    const next = applyBattleAction(state, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "steady_pose"
    });

    assert.equal(next.activeUnitId, "wolf-d");
    assert.equal(next.units["pikeman-a"]?.skills?.[0]?.remainingCooldown, 1);
    assert.deepEqual(next.units["pikeman-a"]?.statusEffects, []);
    assert.equal(next.log.at(-1), "枪兵 施放 稳固架势");
  } finally {
    resetRuntimeConfigs();
  }
});

test("pickAutomatedBattleAction and applyBattleAction default enemy skill effects when omitted", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.skills.push({
    id: "harrying_strike",
    name: "袭扰打击",
    description: "测试未显式声明伤害倍率和反击开关时的默认行为。",
    kind: "active",
    target: "enemy",
    cooldown: 1,
    effects: {}
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const state = createDemoBattleState();
    state.activeUnitId = "pikeman-a";
    state.turnOrder = ["pikeman-a", "wolf-d"];
    state.units["pikeman-a"] = {
      ...state.units["pikeman-a"]!,
      skills: [
        {
          id: "harrying_strike",
          name: "袭扰打击",
          description: "测试未显式声明伤害倍率和反击开关时的默认行为。",
          kind: "active",
          target: "enemy",
          cooldown: 1,
          remainingCooldown: 0
        }
      ],
      statusEffects: []
    };

    assert.deepEqual(pickAutomatedBattleAction(state), {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "harrying_strike",
      targetId: "wolf-d"
    });

    const next = applyBattleAction(state, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "harrying_strike",
      targetId: "wolf-d"
    });

    assert.equal(next.units["pikeman-a"]?.skills?.[0]?.remainingCooldown, 1);
    assert.equal(next.units["wolf-d"]?.hasRetaliated, true);
    assert.match(next.log[1] ?? "", /袭扰打击/);
    assert.match(next.log.join("\n"), /反击/);
  } finally {
    resetRuntimeConfigs();
  }
});

test("pickAutomatedBattleAction returns null for an empty or dead active slot", () => {
  const deadActiveState = createDemoBattleState();
  deadActiveState.activeUnitId = "wolf-d";
  deadActiveState.units["wolf-d"] = {
    ...deadActiveState.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.equal(pickAutomatedBattleAction(deadActiveState), null);
});

test("pickAutomatedBattleAction still scores enemy skills against low-count targets", () => {
  const state = createDemoBattleState();
  state.units["pikeman-a"] = {
    ...state.units["pikeman-a"]!,
    count: 2,
    currentHp: 7
  };

  assert.deepEqual(pickAutomatedBattleAction(state), {
    type: "battle.skill",
    unitId: "wolf-d",
    skillId: "crippling_howl",
    targetId: "pikeman-a"
  });
});

test("applyBattleAction skips dead queued units before handing control to the next live stack", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-dead", "wolf-d"];
  state.units["wolf-dead"] = {
    ...cloneBattleUnit(state.units["wolf-d"]!),
    id: "wolf-dead",
    count: 0,
    currentHp: 0
  };

  const next = applyBattleAction(state, {
    type: "battle.wait",
    unitId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.turnOrder, ["wolf-d", "pikeman-a"]);
  assert.equal(next.log.at(-1), "pikeman-a 选择等待");
});

test("applyBattleAction skips missing queued units before handing control to the next live stack", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "missing-unit", "wolf-d"];

  const next = applyBattleAction(state, {
    type: "battle.wait",
    unitId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.turnOrder, ["wolf-d", "pikeman-a"]);
  assert.equal(next.log.at(-1), "pikeman-a 选择等待");
});

test("createDemoBattleState throws when required demo templates are missing", () => {
  const customCatalog = getDefaultUnitCatalog();
  customCatalog.templates = customCatalog.templates.filter((template) => template.id !== "wolf_pack");

  try {
    setUnitCatalog(customCatalog);
    assert.throws(() => createDemoBattleState(), /Missing demo battle templates/);
  } finally {
    resetRuntimeConfigs();
  }
});

test("applyBattleAction describes granted statuses that have no numeric modifiers", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.statuses.push({
    id: "blank_status",
    name: "空白姿态",
    description: "只有持续时间，不带任何数值变化。",
    duration: 1,
    attackModifier: 0,
    defenseModifier: 0,
    damagePerTurn: 0
  });
  customCatalog.skills.push({
    id: "blank_pose",
    name: "空白姿态",
    description: "测试 granted status 的空词条描述。",
    kind: "active",
    target: "self",
    cooldown: 1,
    effects: {
      grantedStatusId: "blank_status"
    }
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const state = createDemoBattleState();
    state.activeUnitId = "pikeman-a";
    state.turnOrder = ["pikeman-a", "wolf-d"];
    state.units["pikeman-a"] = {
      ...state.units["pikeman-a"]!,
      skills: [
        {
          id: "blank_pose",
          name: "空白姿态",
          description: "测试 granted status 的空词条描述。",
          kind: "active",
          target: "self",
          cooldown: 1,
          remainingCooldown: 0
        }
      ],
      statusEffects: []
    };

    const next = applyBattleAction(state, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "blank_pose"
    });

    assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.id, "blank_status");
    assert.equal(next.log.at(-1), "枪兵 施放 空白姿态，获得 空白姿态");
  } finally {
    resetRuntimeConfigs();
  }
});

test("applyBattleAction describes granted statuses with negative attack and damage-over-time effects", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.statuses.push({
    id: "withering_brand",
    name: "枯萎烙印",
    description: "会削弱攻击并附带持续伤害。",
    duration: 2,
    attackModifier: -1,
    defenseModifier: 0,
    damagePerTurn: 3
  });
  customCatalog.skills.push({
    id: "withering_mark",
    name: "枯萎烙印",
    description: "测试 granted status 的负攻击和持续伤害描述。",
    kind: "active",
    target: "self",
    cooldown: 2,
    effects: {
      grantedStatusId: "withering_brand"
    }
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const state = createDemoBattleState();
    state.activeUnitId = "pikeman-a";
    state.turnOrder = ["pikeman-a", "wolf-d"];
    state.units["pikeman-a"] = {
      ...state.units["pikeman-a"]!,
      skills: [
        {
          id: "withering_mark",
          name: "枯萎烙印",
          description: "测试 granted status 的负攻击和持续伤害描述。",
          kind: "active",
          target: "self",
          cooldown: 2,
          remainingCooldown: 0
        }
      ],
      statusEffects: []
    };

    const next = applyBattleAction(state, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "withering_mark"
    });

    assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.id, "withering_brand");
    assert.equal(next.log.at(-1), "枪兵 施放 枯萎烙印，获得 枯萎烙印（-1 攻击，每回合 3 持续伤害）");
  } finally {
    resetRuntimeConfigs();
  }
});

test("applyBattleAction describes granted statuses with positive attack and negative defense modifiers", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.statuses.push({
    id: "glass_offense",
    name: "破阵战意",
    description: "强化输出但牺牲防御。",
    duration: 2,
    attackModifier: 2,
    defenseModifier: -3,
    damagePerTurn: 0
  });
  customCatalog.skills.push({
    id: "glass_offense_pose",
    name: "破阵姿态",
    description: "测试 granted status 的正攻击和负防御描述。",
    kind: "active",
    target: "self",
    cooldown: 2,
    effects: {
      grantedStatusId: "glass_offense"
    }
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const state = createDemoBattleState();
    state.activeUnitId = "pikeman-a";
    state.turnOrder = ["pikeman-a", "wolf-d"];
    state.units["pikeman-a"] = {
      ...state.units["pikeman-a"]!,
      skills: [
        {
          id: "glass_offense_pose",
          name: "破阵姿态",
          description: "测试 granted status 的正攻击和负防御描述。",
          kind: "active",
          target: "self",
          cooldown: 2,
          remainingCooldown: 0
        }
      ],
      statusEffects: []
    };

    const next = applyBattleAction(state, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "glass_offense_pose"
    });

    assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.id, "glass_offense");
    assert.equal(next.log.at(-1), "枪兵 施放 破阵姿态，获得 破阵战意（+2 攻击，-3 防御）");
  } finally {
    resetRuntimeConfigs();
  }
});

test("battle state builders carry stats, metadata, and missing-template guards", () => {
  const attackerHero = createHero({
    id: "hero-a",
    playerId: "player-1",
    name: "凯琳",
    stats: {
      attack: 3,
      defense: 2,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    armyCount: 15
  });
  const defenderHero = createHero({
    id: "hero-b",
    playerId: "player-2",
    name: "罗安",
    position: { x: 4, y: 2 },
    stats: {
      attack: 1,
      defense: 4,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    armyCount: 11
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-2",
    position: { x: 6, y: 3 },
    reward: { kind: "ore", amount: 4 },
    stacks: [{ templateId: "wolf_pack", count: 5 }]
  };

  const neutralBattle = createNeutralBattleState(attackerHero, neutralArmy, 2027);
  assert.equal(neutralBattle.worldHeroId, "hero-a");
  assert.equal(neutralBattle.neutralArmyId, "neutral-2");
  assert.deepEqual(neutralBattle.encounterPosition, { x: 6, y: 3 });
  assert.equal(neutralBattle.lanes, 1);
  assert.equal(neutralBattle.units["hero-a-stack"]?.attack, 7);
  assert.equal(neutralBattle.units["hero-a-stack"]?.defense, 6);
  assert.equal(neutralBattle.units["hero-a-stack"]?.count, 15);
  assert.equal(neutralBattle.units["hero-a-stack"]?.lane, 0);
  assert.equal(neutralBattle.units["neutral-2-stack-1"]?.count, 5);
  assert.equal(neutralBattle.units["neutral-2-stack-1"]?.lane, 0);
  assert.equal(neutralBattle.environment.every((hazard) => hazard.lane < neutralBattle.lanes), true);

  const heroBattle = createHeroBattleState(attackerHero, defenderHero, 2028);
  assert.equal(heroBattle.worldHeroId, "hero-a");
  assert.equal(heroBattle.defenderHeroId, "hero-b");
  assert.deepEqual(heroBattle.encounterPosition, { x: 4, y: 2 });
  assert.equal(heroBattle.lanes, 1);
  assert.equal(heroBattle.units["hero-a-stack"]?.attack, 7);
  assert.equal(heroBattle.units["hero-a-stack"]?.lane, 0);
  assert.equal(heroBattle.units["hero-b-stack"]?.defense, 8);
  assert.equal(heroBattle.units["hero-b-stack"]?.lane, 0);
  assert.equal(heroBattle.environment.every((hazard) => hazard.lane < heroBattle.lanes), true);

  assert.throws(
    () =>
      createNeutralBattleState(
        {
          ...attackerHero,
          armyTemplateId: "missing-template"
        },
        neutralArmy,
        2029
      ),
    /Missing hero army template/
  );
  assert.throws(
    () =>
      createNeutralBattleState(
        attackerHero,
        {
          ...neutralArmy,
          stacks: [{ templateId: "missing-template", count: 5 }]
        },
        2030
      ),
    /Missing neutral unit template/
  );
  assert.throws(
    () =>
      createHeroBattleState(
        {
          ...attackerHero,
          armyTemplateId: "missing-template"
        },
        defenderHero,
        2031
      ),
    /Missing hero army template for PvP battle/
  );
  assert.throws(
    () =>
      createHeroBattleState(
        attackerHero,
        {
          ...defenderHero,
          armyTemplateId: "missing-template"
        },
        2032
      ),
    /Missing hero army template for PvP battle/
  );
});

test("battle state builders support empty armies and templates without battle skills", () => {
  const customCatalog = getDefaultUnitCatalog();
  customCatalog.templates = customCatalog.templates.map((template) =>
    template.id === "hero_guard_basic" || template.id === "wolf_pack"
      ? { ...template, battleSkills: undefined }
      : template
  );

  try {
    setUnitCatalog(customCatalog);

    const emptyHero = createHero({
      id: "hero-empty-a",
      playerId: "player-1",
      name: "空军凯琳",
      armyCount: 0
    });
    const emptyEnemy = createHero({
      id: "hero-empty-b",
      playerId: "player-2",
      name: "空军罗安",
      armyCount: 0
    });
    const emptyNeutral: NeutralArmyState = {
      id: "neutral-empty",
      position: { x: 1, y: 1 },
      reward: { kind: "gold", amount: 0 },
      stacks: [{ templateId: "wolf_pack", count: 0 }]
    };

    const neutralBattle = createNeutralBattleState(emptyHero, emptyNeutral, 3030);
    assert.equal(neutralBattle.activeUnitId, null);
    assert.deepEqual(neutralBattle.units["hero-empty-a-stack"]?.skills, []);
    assert.deepEqual(neutralBattle.units["neutral-empty-stack-1"]?.skills, []);

    const heroBattle = createHeroBattleState(emptyHero, emptyEnemy, 3031);
    assert.equal(heroBattle.activeUnitId, null);
    assert.deepEqual(heroBattle.units["hero-empty-a-stack"]?.skills, []);
    assert.deepEqual(heroBattle.units["hero-empty-b-stack"]?.skills, []);
  } finally {
    resetRuntimeConfigs();
  }
});

test("battle state builders consume runtime battle balance environment config", () => {
  const attackerHero = createHero({
    id: "hero-balance-a",
    playerId: "player-1",
    name: "凯琳",
    armyCount: 12
  });
  const defenderHero = createHero({
    id: "hero-balance-b",
    playerId: "player-2",
    name: "罗安",
    armyCount: 10
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-balance",
    position: { x: 2, y: 3 },
    reward: { kind: "gold", amount: 100 },
    stacks: [{ templateId: "wolf_pack", count: 6 }]
  };
  const customBalance = getBattleBalanceConfig();
  customBalance.environment.blockerSpawnThreshold = 0;
  customBalance.environment.blockerDurability = 3;
  customBalance.environment.trapSpawnThreshold = 0;
  customBalance.environment.trapDamage = 4;
  customBalance.environment.trapCharges = 2;

  try {
    setBattleBalanceConfig(customBalance);

    const neutralBattle = createNeutralBattleState(attackerHero, neutralArmy, 2027);
    assert.equal(neutralBattle.environment.some((hazard) => hazard.kind === "blocker" && hazard.durability === 3), true);
    assert.equal(
      neutralBattle.environment.some(
        (hazard) =>
          hazard.kind === "trap" &&
          hazard.damage === 4 &&
          hazard.charges === 2 &&
          hazard.grantedStatusId === "weakened"
      ),
      true
    );

    const heroBattle = createHeroBattleState(attackerHero, defenderHero, 2028);
    assert.equal(heroBattle.environment.some((hazard) => hazard.kind === "blocker" && hazard.maxDurability === 3), true);
    assert.equal(heroBattle.environment.some((hazard) => hazard.kind === "trap" && hazard.damage === 4), true);
  } finally {
    resetRuntimeConfigs();
  }
});

test("createBattleEnvironmentState deterministically generates blockers plus hidden traps from runtime config", () => {
  const customBalance = getBattleBalanceConfig();
  customBalance.environment.blockerSpawnThreshold = 0;
  customBalance.environment.blockerDurability = 2;
  customBalance.environment.trapSpawnThreshold = 0;
  customBalance.environment.trapDamage = 3;
  customBalance.environment.trapCharges = 2;

  try {
    setBattleBalanceConfig(customBalance);

    const environment = createBattleEnvironmentState(3, 2027);

    assert.deepEqual(environment, [
      {
        id: "hazard-blocker-2",
        kind: "blocker",
        lane: 2,
        name: "碎石路障",
        description: "近身接战前需要先破开这道障碍。",
        durability: 2,
        maxDurability: 2
      },
      {
        id: "hazard-trap-2",
        kind: "trap",
        lane: 2,
        effect: "damage",
        name: "爆裂地刺",
        description: "隐藏在地面的尖刺会在近战突进时突然弹出。",
        damage: 3,
        charges: 2,
        revealed: false,
        triggered: false,
        grantedStatusId: "weakened",
        triggeredByCamp: "both"
      }
    ]);
  } finally {
    resetRuntimeConfigs();
  }
});

test("applyBattleAction consumes runtime battle balance damage config", () => {
  const state = createEmptyBattleState();
  state.id = "battle-balance-damage";
  state.round = 1;
  state.lanes = 1;
  state.activeUnitId = "attacker";
  state.turnOrder = ["attacker", "defender"];
  state.rng = {
    seed: 12345,
    cursor: 0
  };
  state.units = {
    attacker: {
      id: "attacker",
      templateId: "hero_guard_basic",
      camp: "attacker",
      lane: 0,
      stackName: "枪兵",
      initiative: 10,
      attack: 10,
      defense: 5,
      minDamage: 5,
      maxDamage: 5,
      count: 3,
      currentHp: 10,
      maxHp: 10,
      hasRetaliated: false,
      defending: false,
      skills: [],
      statusEffects: []
    },
    defender: {
      id: "defender",
      templateId: "wolf_pack",
      camp: "defender",
      lane: 0,
      stackName: "恶狼",
      initiative: 5,
      attack: 5,
      defense: 10,
      minDamage: 2,
      maxDamage: 2,
      count: 4,
      currentHp: 10,
      maxHp: 10,
      hasRetaliated: false,
      defending: true,
      skills: [],
      statusEffects: []
    }
  };

  const baselineBalance = getBattleBalanceConfig();
  baselineBalance.damage.varianceBase = 1;
  baselineBalance.damage.varianceRange = 0;
  const boostedBalance = structuredClone(baselineBalance);
  boostedBalance.damage.defendingDefenseBonus = 0;

  try {
    setBattleBalanceConfig(baselineBalance);
    const defendedResult = applyBattleAction(cloneBattleState(state), {
      type: "battle.attack",
      attackerId: "attacker",
      defenderId: "defender"
    });

    setBattleBalanceConfig(boostedBalance);
    const boostedResult = applyBattleAction(cloneBattleState(state), {
      type: "battle.attack",
      attackerId: "attacker",
      defenderId: "defender"
    });

    assert.ok(getUnitHpPool(boostedResult.units.defender!) < getUnitHpPool(defendedResult.units.defender!));
  } finally {
    resetRuntimeConfigs();
  }
});

test("applyBattleAction throws for stale battle skills that no longer exist in runtime config", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.skills.push({
    id: "obsolete_shot",
    name: "旧式射击",
    description: "用于模拟运行时配置变更后的陈旧战斗数据。",
    kind: "active",
    target: "enemy",
    cooldown: 1,
    effects: {
      damageMultiplier: 1
    }
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const staleState = createDemoBattleState();
    staleState.activeUnitId = "pikeman-a";
    staleState.turnOrder = ["pikeman-a", "wolf-d"];
    staleState.units["pikeman-a"] = {
      ...staleState.units["pikeman-a"]!,
      skills: [
        {
          id: "obsolete_shot",
          name: "旧式射击",
          description: "用于模拟运行时配置变更后的陈旧战斗数据。",
          kind: "active",
          target: "enemy",
          cooldown: 1,
          remainingCooldown: 0
        }
      ]
    };

    resetRuntimeConfigs();

    assert.throws(
      () =>
        applyBattleAction(staleState, {
          type: "battle.skill",
          unitId: "pikeman-a",
          skillId: "obsolete_shot",
          targetId: "wolf-d"
        }),
      /Missing battle skill definition: obsolete_shot/
    );
  } finally {
    resetRuntimeConfigs();
  }
});

test("applyBattleAction returns the normalized state for unknown runtime action types", () => {
  const state = createDemoBattleState();
  state.units["pikeman-a"] = {
    ...state.units["pikeman-a"]!,
    skills: undefined,
    statusEffects: undefined
  };

  const next = applyBattleAction(
    state,
    {
      type: "battle.unknown",
      attackerId: "wolf-d",
      defenderId: "pikeman-a"
    } as unknown as import("../src/index").BattleAction
  );

  assert.deepEqual(next.units["pikeman-a"]?.skills, []);
  assert.deepEqual(next.units["pikeman-a"]?.statusEffects, []);
  assert.deepEqual(next.log, state.log);
});

test("applyBattleAction only triggers traps for matching camps", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.units["wolf-d"] = {
    ...state.units["wolf-d"]!,
    hasRetaliated: true
  };
  state.environment = [
    {
      id: "hazard-trap-defender",
      kind: "trap",
      lane: 0,
      effect: "damage",
      name: "守军地刺",
      description: "只会对防守方的冲锋路线生效。",
      damage: 3,
      charges: 1,
      revealed: false,
      triggered: false,
      triggeredByCamp: "defender"
    }
  ];

  const next = applyBattleAction(state, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.equal(next.environment[0]?.charges, 1);
  assert.equal(next.environment[0]?.revealed, false);
  assert.equal(next.units["pikeman-a"]?.currentHp, 10);
  assert.equal(next.log.some((entry) => entry.includes("守军地刺")), false);
  assert.match(next.log.at(-1) ?? "", /^枪兵 对 恶狼 造成 \d+ 伤害$/);
});
