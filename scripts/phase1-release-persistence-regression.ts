import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createWorldStateFromConfigs,
  type EventLogEntry,
  type MapObjectsConfig,
  type PlayerBattleReplaySummary,
  type WorldGenerationConfig
} from "../packages/shared/src/index.ts";
import { createMemoryRoomSnapshotStore } from "../apps/server/src/memory-room-snapshot-store.ts";
import {
  applyPlayerAccountsToWorldState,
  applyPlayerHeroArchivesToWorldState,
  MySqlRoomSnapshotStore,
  readMySqlPersistenceConfig,
  type RoomSnapshotStore
} from "../apps/server/src/persistence.ts";
import { buildContentPackCliReport } from "./validate-content-pack.ts";
import { resolveExtraContentPackMapPack } from "./content-pack-map-packs.ts";

type RequestedStorageMode = "auto" | "memory" | "mysql";
type EffectiveStorageMode = "memory" | "mysql";

interface Args {
  outputPath?: string;
  storageMode: RequestedStorageMode;
  configsRoot: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface Phase1PersistenceReleaseReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  requestedStorageMode: RequestedStorageMode;
  effectiveStorageMode: EffectiveStorageMode;
  storageDescription: string;
  configsRoot: string;
  summary: {
    status: "passed";
    assertionCount: number;
  };
  contentValidation: {
    valid: boolean;
    bundleCount: number;
    summary: string;
    issueCount: number;
  };
  persistenceRegression: {
    sourceRoomId: string;
    targetRoomId: string;
    playerId: string;
    heroId: string;
    assertions: string[];
  };
}

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");
const SOURCE_ROOM_ID = "phase1-release-gate-source";
const TARGET_ROOM_ID = "phase1-release-gate-target";
const PLAYER_ONE_ID = "release-gate-player-1";
const PLAYER_TWO_ID = "release-gate-player-2";
const HERO_ONE_ID = "release-gate-hero-1";
const HERO_TWO_ID = "release-gate-hero-2";
const EVENT_ID = "release-gate-event-1";
const REPLAY_ID = "release-gate-replay-1";

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let outputPath: string | undefined;
  let storageMode: RequestedStorageMode = "auto";
  let configsRoot = path.resolve("configs");

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--output" && next) {
      outputPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--storage" && next) {
      if (next !== "auto" && next !== "memory" && next !== "mysql") {
        fail(`Unsupported storage mode: ${next}`);
      }
      storageMode = next;
      index += 1;
      continue;
    }
    if (arg === "--configs-root" && next) {
      configsRoot = path.resolve(next);
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(outputPath ? { outputPath } : {}),
    storageMode,
    configsRoot
  };
}

function getGitValue(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function getRevision(): GitRevision {
  return {
    commit: getGitValue(["rev-parse", "HEAD"]),
    shortCommit: getGitValue(["rev-parse", "--short", "HEAD"]),
    branch: getGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: getGitValue(["status", "--porcelain"]).length > 0
  };
}

function resolveOutputPath(outputPath: string | undefined, shortCommit: string): string {
  if (outputPath) {
    return outputPath;
  }
  return path.resolve(DEFAULT_OUTPUT_DIR, `phase1-release-persistence-regression-${shortCommit}.json`);
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function buildWorldConfigForRegression(config: WorldGenerationConfig): WorldGenerationConfig {
  return {
    ...structuredClone(config),
    heroes: config.heroes.map((hero, index) => ({
      ...structuredClone(hero),
      id: index === 0 ? HERO_ONE_ID : HERO_TWO_ID,
      playerId: index === 0 ? PLAYER_ONE_ID : PLAYER_TWO_ID
    }))
  };
}

function createReplaySummary(playerId: string, heroId: string): PlayerBattleReplaySummary {
  return {
    id: REPLAY_ID,
    roomId: SOURCE_ROOM_ID,
    playerId,
    battleId: "release-gate-battle-1",
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId,
    neutralArmyId: "neutral-1",
    startedAt: "2026-03-31T00:00:00.000Z",
    completedAt: "2026-03-31T00:03:00.000Z",
    initialState: {
      id: "release-gate-battle-1",
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
          initiative: 5,
          attack: 3,
          defense: 2,
          minDamage: 1,
          maxDamage: 3,
          count: 16,
          currentHp: 10,
          maxHp: 10,
          hasRetaliated: false,
          defending: false
        }
      },
      environment: [],
      log: [],
      rng: { seed: 11, cursor: 0 }
    },
    steps: [],
    result: "attacker_victory"
  };
}

function createEventLogEntry(playerId: string, heroId: string): EventLogEntry {
  return {
    id: EVENT_ID,
    timestamp: "2026-03-31T00:02:00.000Z",
    roomId: SOURCE_ROOM_ID,
    playerId,
    category: "achievement",
    description: "Release gate progression event",
    heroId,
    achievementId: "first_battle",
    rewards: [{ type: "resource", label: "Gold", amount: 180 }]
  };
}

async function createSnapshotStore(storageMode: RequestedStorageMode): Promise<{
  store: RoomSnapshotStore;
  mode: EffectiveStorageMode;
  description: string;
}> {
  if (storageMode === "memory") {
    return {
      store: createMemoryRoomSnapshotStore(),
      mode: "memory",
      description: "memory://room_snapshots"
    };
  }

  const mysqlConfig = readMySqlPersistenceConfig();
  if (storageMode === "mysql") {
    if (!mysqlConfig) {
      fail("MySQL storage was requested but VEIL_MYSQL_* is not configured.");
    }
    const store = await MySqlRoomSnapshotStore.create(mysqlConfig);
    return {
      store,
      mode: "mysql",
      description: `mysql://${mysqlConfig.database}/room_snapshots`
    };
  }

  if (mysqlConfig) {
    const store = await MySqlRoomSnapshotStore.create(mysqlConfig);
    return {
      store,
      mode: "mysql",
      description: `mysql://${mysqlConfig.database}/room_snapshots`
    };
  }

  return {
    store: createMemoryRoomSnapshotStore(),
    mode: "memory",
    description: "memory://room_snapshots"
  };
}

export async function runPhase1ReleasePersistenceRegression(args: Args): Promise<Phase1PersistenceReleaseReport> {
  const revision = getRevision();
  const worldConfig = buildWorldConfigForRegression(readJsonFile<WorldGenerationConfig>(path.join(args.configsRoot, "phase1-world.json")));
  const mapObjectsConfig = readJsonFile<MapObjectsConfig>(path.join(args.configsRoot, "phase1-map-objects.json"));
  const frontierBasin = resolveExtraContentPackMapPack("frontier-basin");
  const phase2 = resolveExtraContentPackMapPack("phase2");
  if (!frontierBasin || !phase2) {
    fail("Expected shipped extra content-pack definitions for frontier-basin and phase2.");
  }

  const contentReport = await buildContentPackCliReport({
    rootDir: args.configsRoot,
    extraMapPacks: [frontierBasin, phase2]
  });
  if (!contentReport.valid) {
    fail(contentReport.contentPack.summary);
  }

  const { store, mode, description } = await createSnapshotStore(args.storageMode);
  const assertions: string[] = [];

  try {
    const sourceState = createWorldStateFromConfigs(worldConfig, mapObjectsConfig, 1001, SOURCE_ROOM_ID);
    const sourceHero = sourceState.heroes.find((hero) => hero.playerId === PLAYER_ONE_ID);
    if (!sourceHero) {
      fail(`Expected hero for ${PLAYER_ONE_ID}.`);
    }
    const originalTargetPosition = structuredClone(sourceHero.position);

    sourceState.resources[PLAYER_ONE_ID] = { gold: 640, wood: 9, ore: 4 };
    sourceHero.position = {
      x: Math.min(sourceState.map.width - 1, sourceHero.position.x + 1),
      y: Math.min(sourceState.map.height - 1, sourceHero.position.y + 1)
    };
    sourceHero.move = { total: 8, remaining: 2 };
    sourceHero.stats = {
      ...sourceHero.stats,
      attack: sourceHero.stats.attack + 3,
      defense: sourceHero.stats.defense + 2,
      hp: 34,
      maxHp: 34
    };
    sourceHero.progression = {
      ...sourceHero.progression,
      level: 4,
      experience: 420,
      skillPoints: 3,
      battlesWon: 5,
      neutralBattlesWon: 5,
      pvpBattlesWon: 0
    };
    sourceHero.loadout = {
      ...sourceHero.loadout,
      learnedSkills: [{ skillId: "armor_spell", rank: 1 }],
      equipment: {
        weaponId: "bronze_halberd",
        armorId: "march_guard",
        accessoryId: "trail_compass",
        trinketIds: ["wind_charm"]
      },
      inventory: ["sunforged_spear", "ranger_scale", "ember_talisman"]
    };
    sourceHero.learnedSkills = [{ skillId: "war_banner", rank: 2 }];
    sourceHero.armyCount = 18;

    await store.save(SOURCE_ROOM_ID, {
      state: sourceState,
      battles: []
    });
    await store.savePlayerAccountProgress(PLAYER_ONE_ID, {
      recentEventLog: [createEventLogEntry(PLAYER_ONE_ID, HERO_ONE_ID)],
      recentBattleReplays: [createReplaySummary(PLAYER_ONE_ID, HERO_ONE_ID)],
      lastRoomId: SOURCE_ROOM_ID
    });

    const persistedSnapshot = await store.load(SOURCE_ROOM_ID);
    const persistedAccount = await store.loadPlayerAccount(PLAYER_ONE_ID);
    const persistedArchives = await store.loadPlayerHeroArchives([PLAYER_ONE_ID]);
    const persistedHistory = await store.loadPlayerEventHistory(PLAYER_ONE_ID, {
      category: "achievement",
      heroId: HERO_ONE_ID
    });

    assert.equal(persistedSnapshot?.state.resources[PLAYER_ONE_ID]?.gold, 640);
    assertions.push("source-room snapshot keeps upgraded world resources");

    assert.equal(persistedSnapshot?.state.heroes.find((hero) => hero.id === HERO_ONE_ID)?.progression.level, 4);
    assertions.push("source-room snapshot keeps upgraded hero progression");

    assert.equal(persistedAccount?.globalResources.gold, 640);
    assert.equal(persistedAccount?.recentBattleReplays?.[0]?.id, REPLAY_ID);
    assert.equal(persistedAccount?.lastRoomId, SOURCE_ROOM_ID);
    assertions.push("player-account persistence keeps resources, replay summary, and last room");

    assert.equal(persistedHistory.total >= 1, true);
    assert.equal(persistedHistory.items[0]?.id, EVENT_ID);
    assertions.push("player event history remains queryable through the persistence store");

    const archiveHero = persistedArchives.find((archive) => archive.heroId === HERO_ONE_ID)?.hero;
    assert.equal(archiveHero?.stats.attack, sourceHero.stats.attack);
    assert.equal(archiveHero?.progression.level, 4);
    assertions.push("hero archive captures long-term hero growth");

    const targetState = createWorldStateFromConfigs(worldConfig, mapObjectsConfig, 1002, TARGET_ROOM_ID);
    const hydratedTargetState = applyPlayerHeroArchivesToWorldState(
      applyPlayerAccountsToWorldState(targetState, persistedAccount ? [persistedAccount] : []),
      persistedArchives
    );
    const hydratedHero = hydratedTargetState.heroes.find((hero) => hero.id === HERO_ONE_ID);

    assert.equal(hydratedTargetState.resources[PLAYER_ONE_ID]?.gold, 640);
    assert.equal(hydratedHero?.progression.level, 4);
    assert.equal(hydratedHero?.stats.attack, sourceHero.stats.attack);
    assert.deepEqual(hydratedHero?.position, originalTargetPosition);
    assert.deepEqual(hydratedHero?.move, { total: 8, remaining: 8 });
    assert.deepEqual(hydratedHero?.loadout.equipment, sourceHero.loadout.equipment);
    assertions.push("fresh-room hydration reapplies account resources and hero growth while resetting room-local position/readiness");

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      revision,
      requestedStorageMode: args.storageMode,
      effectiveStorageMode: mode,
      storageDescription: description,
      configsRoot: args.configsRoot,
      summary: {
        status: "passed",
        assertionCount: assertions.length
      },
      contentValidation: {
        valid: true,
        bundleCount: contentReport.bundleCount,
        summary: contentReport.contentPack.summary,
        issueCount: contentReport.documentValidation.issueCount + contentReport.contentPack.issueCount
      },
      persistenceRegression: {
        sourceRoomId: SOURCE_ROOM_ID,
        targetRoomId: TARGET_ROOM_ID,
        playerId: PLAYER_ONE_ID,
        heroId: HERO_ONE_ID,
        assertions
      }
    };
  } finally {
    await Promise.resolve(store.delete?.(SOURCE_ROOM_ID)).catch(() => undefined);
    await store.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const report = await runPhase1ReleasePersistenceRegression(args);
  const outputPath = resolveOutputPath(args.outputPath, report.revision.shortCommit);
  writeJsonFile(outputPath, report);

  console.log("Phase 1 release persistence regression");
  console.log(`Storage: ${report.effectiveStorageMode}`);
  console.log(`Content validation: PASS (${report.contentValidation.bundleCount} bundles)`);
  console.log(`Assertions: ${report.summary.assertionCount}`);
  console.log(`Report written to ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(`Phase 1 release persistence regression failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
