import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { getBattleBalanceConfig, getDefaultBattleSkillCatalog, getDefaultWorldConfig, resetRuntimeConfigs } from "@veil/shared/world";
import {
  configureConfigCenterRuntimeDependencies,
  configureConfigRuntimeStatusProvider,
  createWorldConfigPreview,
  FileSystemConfigCenterStore,
  flushPendingConfigUpdate,
  resetConfigCenterRuntimeDependencies,
  resetConfigHotReloadState
} from "@server/config-center";
import type { WorldConfigPreview } from "@server/config-center";
import { DEFAULT_LEADERBOARD_TIER_THRESHOLDS } from "@server/domain/social/leaderboard-tier-thresholds";
import { recordRuntimeErrorEvent, resetRuntimeObservability } from "@server/domain/ops/observability";

const WORLD_CONFIG = {
  width: 8,
  height: 8,
  heroes: [
    {
      id: "hero-1",
      playerId: "player-1",
      name: "凯琳",
      position: { x: 1, y: 1 },
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
      progression: {
        level: 1,
        experience: 0,
        battlesWon: 0,
        neutralBattlesWon: 0,
        pvpBattlesWon: 0
      },
      armyTemplateId: "hero_guard_basic",
      armyCount: 12
    }
  ],
  resourceSpawn: {
    goldChance: 0.06,
    woodChance: 0.06,
    oreChance: 0.06
  }
};

const MAP_OBJECTS_CONFIG = {
  neutralArmies: [
    {
      id: "neutral-1",
      position: { x: 5, y: 4 },
      reward: { kind: "gold" as const, amount: 300 },
      stacks: [{ templateId: "wolf_pack", count: 8 }]
    }
  ],
  guaranteedResources: [
    {
      position: { x: 2, y: 1 },
      resource: { kind: "wood" as const, amount: 5 }
    }
  ],
  buildings: [
    {
      id: "recruit-post-1",
      kind: "recruitment_post" as const,
      position: { x: 1, y: 3 },
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
      id: "shrine-attack-1",
      kind: "attribute_shrine" as const,
      position: { x: 3, y: 2 },
      label: "战旗圣坛",
      bonus: {
        attack: 1,
        defense: 0,
        power: 0,
        knowledge: 0
      }
    },
    {
      id: "mine-wood-1",
      kind: "resource_mine" as const,
      position: { x: 4, y: 1 },
      label: "前线伐木场",
      resourceKind: "wood" as const,
      income: 2
    }
  ]
};

const UNIT_CONFIG = {
  templates: [
    {
      id: "hero_guard_basic",
      stackName: "枪兵",
      faction: "crown",
      rarity: "common",
      initiative: 6,
      attack: 4,
      defense: 4,
      minDamage: 1,
      maxDamage: 3,
      maxHp: 10
    },
    {
      id: "wolf_pack",
      stackName: "恶狼",
      faction: "wild",
      rarity: "common",
      initiative: 8,
      attack: 5,
      defense: 3,
      minDamage: 2,
      maxDamage: 4,
      maxHp: 7
    }
  ]
};

const BATTLE_SKILL_CONFIG = getDefaultBattleSkillCatalog();

const BATTLE_BALANCE_CONFIG = {
  damage: {
    defendingDefenseBonus: 5,
    offenseAdvantageStep: 0.05,
    minimumOffenseMultiplier: 0.3,
    varianceBase: 0.9,
    varianceRange: 0.2
  },
  environment: {
    blockerSpawnThreshold: 0.62,
    blockerDurability: 1,
    trapSpawnThreshold: 0.58,
    trapDamage: 1,
    trapCharges: 1,
    trapGrantedStatusId: "poisoned"
  },
  pvp: {
    eloK: 32
  },
  turnTimerSeconds: 30,
  afkStrikesBeforeForfeit: 2
};

async function seedConfigRoot(rootDir: string): Promise<void> {
  await writeFile(join(rootDir, "phase1-world.json"), `${JSON.stringify(WORLD_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "phase1-map-objects.json"), `${JSON.stringify(MAP_OBJECTS_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "units.json"), `${JSON.stringify(UNIT_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "battle-skills.json"), `${JSON.stringify(BATTLE_SKILL_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "battle-balance.json"), `${JSON.stringify(BATTLE_BALANCE_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(
    join(rootDir, "leaderboard-tier-thresholds.json"),
    `${JSON.stringify({ key: "leaderboard.tier_thresholds", tiers: DEFAULT_LEADERBOARD_TIER_THRESHOLDS }, null, 2)}\n`,
    "utf8"
  );
}

test.afterEach(() => {
  delete process.env.CONFIG_ROLLBACK_WINDOW_MS;
  resetRuntimeConfigs();
  resetConfigHotReloadState();
  resetConfigCenterRuntimeDependencies();
  configureConfigRuntimeStatusProvider(() => ({
    rooms: [],
    activeBattleCount: 0
  }));
  resetRuntimeObservability();
});

test("config center lists seeded config documents", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const items = await store.listDocuments();

  assert.deepEqual(
    items.map((item) => item.id),
    ["world", "mapObjects", "units", "battleSkills", "battleBalance", "leaderboardTierThresholds"]
  );
  assert.match(items[0]?.summary ?? "", /8x8/);
});

test("config center validates leaderboard tier thresholds as a contiguous config key", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const report = await store.validateDocument(
    "leaderboardTierThresholds",
    JSON.stringify({
      key: "leaderboard.tier_thresholds",
      tiers: [
        { tier: "bronze", minRating: 0, maxRating: 1099 },
        { tier: "silver", minRating: 1200, maxRating: 1299 },
        { tier: "gold", minRating: 1300, maxRating: 1499 },
        { tier: "platinum", minRating: 1500, maxRating: 1799 },
        { tier: "diamond", minRating: 1800 }
      ]
    })
  );

  assert.equal(report.valid, false);
  assert.equal(report.schema.id, "project-veil.config-center.leaderboardTierThresholds");
  assert.match(report.summary, /当前文档问题/);
  assert.match(report.issues[0]?.path ?? "", /^tiers\[1\]\.minRating$/);
});

test("config center save writes file and refreshes runtime world config", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const nextWorld = {
    ...WORLD_CONFIG,
    width: 10,
    heroes: [
      {
        ...WORLD_CONFIG.heroes[0],
        position: { x: 2, y: 2 }
      }
    ]
  };

  const document = await store.saveDocument("world", JSON.stringify(nextWorld));
  const fileContent = await readFile(join(rootDir, "phase1-world.json"), "utf8");

  assert.equal(document.id, "world");
  assert.match(fileContent, /"width": 10/);
  assert.equal(getDefaultWorldConfig().width, 10);
  assert.equal(getDefaultWorldConfig().heroes[0]?.position.x, 2);
});

test("config center save writes battle skills file and refreshes runtime skill catalog", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const nextCatalog = {
    ...BATTLE_SKILL_CONFIG,
    skills: BATTLE_SKILL_CONFIG.skills.map((skill) =>
      skill.id === "power_shot" ? { ...skill, name: "重弩射击", cooldown: 1 } : skill
    )
  };

  const document = await store.saveDocument("battleSkills", JSON.stringify(nextCatalog));
  const fileContent = await readFile(join(rootDir, "battle-skills.json"), "utf8");
  const powerShot = getDefaultBattleSkillCatalog().skills.find((skill) => skill.id === "power_shot");

  assert.equal(document.id, "battleSkills");
  assert.match(fileContent, /"重弩射击"/);
  assert.equal(powerShot?.name, "重弩射击");
  assert.equal(powerShot?.cooldown, 1);
});

test("config center save writes battle balance file and refreshes runtime battle balance", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const nextBalance = {
    ...BATTLE_BALANCE_CONFIG,
    environment: {
      ...BATTLE_BALANCE_CONFIG.environment,
      trapDamage: 3,
      trapCharges: 2
    },
    pvp: {
      eloK: 28
    }
  };

  const document = await store.saveDocument("battleBalance", JSON.stringify(nextBalance));
  const fileContent = await readFile(join(rootDir, "battle-balance.json"), "utf8");
  const runtimeBalance = getBattleBalanceConfig();

  assert.equal(document.id, "battleBalance");
  assert.match(fileContent, /"trapDamage": 3/);
  assert.equal(runtimeBalance.environment.trapDamage, 3);
  assert.equal(runtimeBalance.environment.trapCharges, 2);
  assert.equal(runtimeBalance.pvp.eloK, 28);
});

test("config center rejects map objects that exceed current world bounds", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const invalidMapObjects = {
    ...MAP_OBJECTS_CONFIG,
    guaranteedResources: [
      {
        position: { x: 99, y: 99 },
        resource: { kind: "gold", amount: 300 }
      }
    ]
  };

  await assert.rejects(
    () => store.saveDocument("mapObjects", JSON.stringify(invalidMapObjects)),
    /exceeds map bounds/
  );
});

test("config center world preview summarizes generated terrain, resources and occupants", () => {
  const preview = createWorldConfigPreview(WORLD_CONFIG, MAP_OBJECTS_CONFIG, 2026) as WorldConfigPreview;
  const guaranteedTile = preview.tiles.find((tile) => tile.position.x === 2 && tile.position.y === 1);
  const neutralTile = preview.tiles.find((tile) => tile.position.x === 5 && tile.position.y === 4);
  const buildingTile = preview.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 3);
  const shrineTile = preview.tiles.find((tile) => tile.position.x === 3 && tile.position.y === 2);
  const mineTile = preview.tiles.find((tile) => tile.position.x === 4 && tile.position.y === 1);
  const totalTerrain = Object.values(preview.counts.terrain).reduce((sum, count) => sum + count, 0);

  assert.equal(preview.seed, 2026);
  assert.equal(preview.width, 8);
  assert.equal(preview.height, 8);
  assert.equal(totalTerrain, 64);
  assert.equal(preview.counts.heroes, 1);
  assert.equal(preview.counts.neutralArmies, 1);
  assert.equal(preview.counts.buildings, 3);
  assert.equal(preview.counts.guaranteedResources, 1);
  assert.deepEqual(guaranteedTile?.resource, {
    kind: "wood",
    amount: 5,
    source: "guaranteed"
  });
  assert.equal(neutralTile?.occupant?.kind, "neutral");
  assert.equal(buildingTile?.building?.kind, "recruitment_post");
  assert.equal(shrineTile?.building?.kind, "attribute_shrine");
  assert.equal(mineTile?.building?.kind, "resource_mine");
  assert.equal(mineTile?.building?.resourceKind, "wood");
});

test("config center can validate invalid world config with structured issues", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const report = await store.validateDocument(
    "world",
    JSON.stringify({
      ...WORLD_CONFIG,
      width: 0,
      heroes: [
        {
          ...WORLD_CONFIG.heroes[0],
          position: { x: 99, y: 1 }
        }
      ]
    })
  );

  assert.equal(report.valid, false);
  assert.match(report.summary, /发现/);
  assert.match(report.issues.map((issue) => issue.path).join(","), /width|heroes\[0\]\.position\.x/);
  assert.equal(report.schema.id, "project-veil.config-center.world");
  assert.match(report.schema.version, /\d{4}-\d{2}-\d{2}/);
  assert.equal(report.contentPack.valid, true);
});

test("config center schema validation reports missing and mistyped fields", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const report = await store.validateDocument(
    "battleSkills",
    JSON.stringify({
      skills: [
        {
          id: "broken-skill",
          name: "坏技能",
          description: "故意缺字段",
          kind: "burst",
          target: "enemy",
          cooldown: "soon"
        }
      ]
    })
  );

  assert.equal(report.valid, false);
  assert.match(report.issues.map((issue) => issue.path).join(","), /statuses|skills\[0\]\.kind|skills\[0\]\.cooldown/);
  assert.equal(report.schema.id, "project-veil.config-center.battleSkills");
});

test("config center schema accepts ally-targeted battle skills", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const report = await store.validateDocument("battleSkills", JSON.stringify(BATTLE_SKILL_CONFIG));

  assert.equal(report.valid, true);
  assert.equal(report.issues.length, 0);
  assert.equal(report.contentPack.valid, true);
  assert.ok(BATTLE_SKILL_CONFIG.skills.some((skill) => skill.target === "ally"));
});

test("config center validates battle balance against thresholds and status references", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const report = await store.validateDocument(
    "battleBalance",
    JSON.stringify({
      ...BATTLE_BALANCE_CONFIG,
      environment: {
        ...BATTLE_BALANCE_CONFIG.environment,
        trapSpawnThreshold: 1.2,
        trapGrantedStatusId: "missing_status"
      }
    })
  );

  assert.equal(report.valid, false);
  assert.match(
    report.issues.map((issue) => issue.path).join(","),
    /environment\.trapSpawnThreshold|environment\.trapGrantedStatusId/
  );
  assert.equal(report.schema.id, "project-veil.config-center.battleBalance");
  assert.equal(report.contentPack.valid, false);
  assert.match(
    report.contentPack.issues.map((issue) => `${issue.documentId}:${issue.path}`).join(","),
    /battleBalance:environment\.trapGrantedStatusId/
  );
});

test("config center validation exposes content-pack issues from other config files", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const report = await store.validateDocument(
    "world",
    JSON.stringify({
      ...WORLD_CONFIG,
      heroes: [
        {
          ...WORLD_CONFIG.heroes[0],
          armyTemplateId: "missing_template"
        }
      ]
    })
  );

  assert.equal(report.valid, false);
  assert.equal(report.issues.length, 0);
  assert.equal(report.contentPack.valid, false);
  assert.match(
    report.contentPack.issues.map((issue) => `${issue.documentId}:${issue.path}`).join(","),
    /world:heroes\[0\]\.armyTemplateId/
  );
});

test("config center snapshots support diff and rollback", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const baseline = await store.loadDocument("world");
  const snapshot = await store.createSnapshot("world", baseline.content, "baseline");

  await store.saveDocument(
    "world",
    JSON.stringify({
      ...WORLD_CONFIG,
      width: 12
    })
  );

  const diff = await store.diffWithSnapshot("world", snapshot.id);
  const widthEntry = diff.entries.find((entry) => entry.path === "width");
  assert.ok(widthEntry);
  assert.equal(widthEntry?.kind, "value");
  assert.equal(widthEntry?.fieldType.includes("integer"), true);
  assert.equal(widthEntry?.blastRadius.includes("配置台编辑器"), true);

  const rolledBack = await store.rollbackToSnapshot("world", snapshot.id);
  assert.equal(JSON.parse(rolledBack.content).width, WORLD_CONFIG.width);
});

test("config center exposes built-in layout presets for the additional map variants", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const worldPresets = await store.listPresets("world");
  const mapObjectPresets = await store.listPresets("mapObjects");

  assert.ok(worldPresets.some((preset) => preset.id === "layout_stonewatch_fork"));
  assert.ok(mapObjectPresets.some((preset) => preset.id === "layout_stonewatch_fork"));
  assert.ok(worldPresets.some((preset) => preset.id === "layout_ridgeway_crossing"));
  assert.ok(mapObjectPresets.some((preset) => preset.id === "layout_ridgeway_crossing"));
  assert.ok(worldPresets.some((preset) => preset.id === "layout_highland_reach"));
  assert.ok(mapObjectPresets.some((preset) => preset.id === "layout_highland_reach"));
  assert.ok(worldPresets.some((preset) => preset.id === "layout_amber_fields"));
  assert.ok(mapObjectPresets.some((preset) => preset.id === "layout_amber_fields"));
  assert.ok(worldPresets.some((preset) => preset.id === "layout_ironpass_gorge"));
  assert.ok(mapObjectPresets.some((preset) => preset.id === "layout_ironpass_gorge"));
  assert.ok(worldPresets.some((preset) => preset.id === "layout_splitrock_canyon"));
  assert.ok(mapObjectPresets.some((preset) => preset.id === "layout_splitrock_canyon"));
  assert.ok(worldPresets.some((preset) => preset.id === "layout_contested_basin"));
  assert.ok(mapObjectPresets.some((preset) => preset.id === "layout_contested_basin"));
  assert.ok(worldPresets.some((preset) => preset.id === "layout_phase2_frontier_expanded"));
  assert.ok(mapObjectPresets.some((preset) => preset.id === "layout_phase2_frontier_expanded"));

  const highlandWorldDocument = await store.applyPreset("world", "layout_highland_reach");
  const highlandMapObjectsDocument = await store.applyPreset("mapObjects", "layout_highland_reach");
  const frontierExpandedWorldDocument = await store.applyPreset("world", "layout_phase2_frontier_expanded");
  const frontierExpandedMapObjectsDocument = await store.applyPreset("mapObjects", "layout_phase2_frontier_expanded");

  assert.match(highlandWorldDocument.content, /"width": 10/);
  assert.match(highlandWorldDocument.content, /"position": \{\s+"x": 1,\s+"y": 4/s);
  assert.match(highlandMapObjectsDocument.content, /"id": "mine-ore-1"/);
  assert.match(frontierExpandedWorldDocument.content, /"width": 32/);
  assert.match(frontierExpandedWorldDocument.content, /"height": 32/);
  assert.match(frontierExpandedMapObjectsDocument.content, /"id": "watchtower-frontier-expanded-1"/);
  assert.match(frontierExpandedMapObjectsDocument.content, /"id": "neutral-river-watch"/);
});

test("config center diff classifies added, removed, and type changes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const baseline = await store.loadDocument("battleBalance");
  const snapshot = await store.createSnapshot("battleBalance", baseline.content, "baseline");

  const mutated = JSON.parse(baseline.content) as Record<string, any>;
  mutated.environment = {
    ...mutated.environment,
    experimentalTrapMode: true
  };
  delete mutated.environment.trapGrantedStatusId;
  await store.saveDocument("battleBalance", JSON.stringify(mutated));

  const libraryPath = join(rootDir, ".config-center-library.json");
  const state = JSON.parse(await readFile(libraryPath, "utf8")) as {
    snapshots: Record<string, Array<{ id: string; content: string }>>;
  };
  const snapshotRecord = state.snapshots.battleBalance?.find((item) => item.id === snapshot.id);
  assert.ok(snapshotRecord);
  const snapshotPayload = JSON.parse(snapshotRecord.content) as Record<string, any>;
  snapshotPayload.environment.trapDamage = "9";
  snapshotRecord.content = JSON.stringify(snapshotPayload, null, 2);
  await writeFile(libraryPath, JSON.stringify(state), "utf8");

  const diff = await store.diffWithSnapshot("battleBalance", snapshot.id);
  const byPath = Object.fromEntries(diff.entries.map((entry) => [entry.path, entry]));

  assert.equal(byPath["environment.experimentalTrapMode"]?.kind, "field_added");
  assert.equal(byPath["environment.trapGrantedStatusId"]?.kind, "field_removed");
  assert.equal(byPath["environment.trapDamage"]?.kind, "type_changed");
  assert.equal(byPath["environment.trapDamage"]?.required, true);
  assert.equal(byPath["environment.trapGrantedStatusId"]?.required, false);
  assert.ok(
    (byPath["environment.trapDamage"]?.blastRadius ?? []).some(
      (label) => label.includes("战斗平衡") || label.includes("PVP")
    )
  );
});

test("config center save creates automatic version snapshots and skips no-op saves", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const baseline = await store.loadDocument("world");
  const unchanged = await store.saveDocument("world", baseline.content);
  assert.equal(unchanged.version, baseline.version);
  assert.deepEqual(await store.listSnapshots("world"), []);

  const changed = await store.saveDocument(
    "world",
    JSON.stringify({
      ...WORLD_CONFIG,
      width: 10
    })
  );
  const snapshots = await store.listSnapshots("world");

  assert.equal(changed.version, (baseline.version ?? 1) + 1);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.version, changed.version);
  assert.match(snapshots[0]?.label ?? "", /自动保存/);
});

test("config center export updates exportedAt metadata without changing version", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const beforeExport = await store.loadDocument("world");
  assert.equal(beforeExport.exportedAt ?? null, null);

  const exported = await store.exportDocument("world", "jsonc");
  const afterExport = await store.loadDocument("world");

  assert.match(exported.fileName, /^world-v1\.jsonc$/);
  assert.equal(typeof exported.exportedAt, "string");
  assert.equal(afterExport.version, beforeExport.version);
  assert.equal(afterExport.exportedAt, exported.exportedAt);
  assert.equal((await store.listDocuments()).find((item) => item.id === "world")?.exportedAt, exported.exportedAt);
});

test("config center JSONC export preserves the document contract with metadata header comments", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const original = await store.loadDocument("world");
  const exported = await store.exportDocument("world", "jsonc");
  const body = exported.body.toString("utf8");

  assert.equal(exported.fileName, `world-v${original.version ?? 1}.jsonc`);
  assert.equal(exported.contentType, "application/jsonc; charset=utf-8");
  assert.match(body, /^\/\/ Project Veil Config Center export\n/);
  assert.match(body, new RegExp(`^// Document: world \\(${original.title}\\)$`, "m"));
  assert.match(body, new RegExp(`^// Version: v${original.version ?? 1}$`, "m"));
  assert.match(body, new RegExp(`^// Updated: ${original.updatedAt}$`, "m"));
  assert.match(body, new RegExp(`^// Summary: ${original.summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.ok(body.endsWith(original.content));
  assert.equal((await store.loadDocument("world")).exportedAt, exported.exportedAt);
});

test("config center Excel export exposes stable workbook sheets and field rows", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const original = await store.loadDocument("battleSkills");
  const preset = await store.savePreset("battleSkills", "自定义技能预设", original.content);
  assert.equal(preset.kind, "custom");

  const afterBuiltin = await store.applyPreset("battleSkills", "hard");
  assert.notEqual(afterBuiltin.content, original.content);

  const exported = await store.exportDocument("battleSkills", "xlsx");
  assert.equal(exported.fileName, `battleSkills-v${afterBuiltin.version ?? 1}.xlsx`);
  assert.equal(exported.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const workbook = XLSX.read(exported.body, { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Meta", "Schema", "Fields"]);
  const metaRows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets.Meta, { header: 1 });
  assert.deepEqual(metaRows.slice(0, 5), [
    ["Document", "battleSkills"],
    ["Title", afterBuiltin.title],
    ["Version", String(afterBuiltin.version ?? 1)],
    ["UpdatedAt", afterBuiltin.updatedAt],
    ["Summary", afterBuiltin.summary]
  ]);
  assert.match(String(metaRows[5]?.[1] ?? ""), /^project-veil\.config-center\.battleSkills$/);
  assert.match(String(metaRows[6]?.[1] ?? ""), /^\d{4}-\d{2}-\d{2}$/);
  const fieldRows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Fields);
  const skillIdRow = fieldRows.find((row) => row.Path === "skills[0].id");
  assert.equal(skillIdRow?.Section, "skills.0");
  assert.equal(skillIdRow?.Field, "id");
  assert.equal(skillIdRow?.Type, "string");
  assert.match(skillIdRow?.Schema ?? "", /^string/);
  assert.equal(skillIdRow?.Value, "power_shot");
  assert.equal(skillIdRow?.JSON, "\"power_shot\"");
  assert.equal((await store.loadDocument("battleSkills")).exportedAt, exported.exportedAt);
});

test("config center CSV export exposes stable tabular field rows", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const csvExported = await store.exportDocument("battleSkills", "csv");
  const workbookExported = await store.exportDocument("battleSkills", "xlsx");
  assert.equal(csvExported.fileName, "battleSkills-v1.csv");
  assert.equal(csvExported.contentType, "text/csv; charset=utf-8");
  const csvText = csvExported.body.toString("utf8");
  assert.match(csvText, /^Section,Field,Path,Type,Schema,Description,Value,JSON\r?\n/);
  assert.match(csvText, /skills\.0\.effects,damageMultiplier,skills\[0\]\.effects\.damageMultiplier,number,/);
  assert.match(csvText, /0\.85,0\.85/);

  const imported = await store.importDocumentFromWorkbook("battleSkills", workbookExported.body);
  assert.equal(imported.id, "battleSkills");
});

test("config center staged publish applies bundled drafts and records publish history", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const staged = await store.saveStagedDraft([
    {
      id: "world",
      content: JSON.stringify({ ...WORLD_CONFIG, width: WORLD_CONFIG.width + 2 })
    },
    {
      id: "mapObjects",
      content: JSON.stringify({
        ...MAP_OBJECTS_CONFIG,
        guaranteedResources: [
          ...MAP_OBJECTS_CONFIG.guaranteedResources,
          {
            position: { x: 0, y: 0 },
            resource: { kind: "ore", amount: 20 }
          }
        ]
      })
    }
  ]);
  assert.equal(staged?.documents.length, 2);
  assert.equal(staged?.valid, true);

  const published = await store.publishStagedDraft({
    author: "ConfigOps",
    summary: "调大地图并补齐资源",
    candidate: "phase1-rc",
    revision: "abc1234"
  });
  assert.equal(published.stage, null);
  assert.equal(published.publish.changes.length, 2);
  assert.equal(published.publish.author, "ConfigOps");

  const worldDocument = await store.loadDocument("world");
  assert.match(worldDocument.content, new RegExp(`\"width\": ${WORLD_CONFIG.width + 2}`));

  const worldHistory = await store.listPublishHistory("world");
  assert.equal(worldHistory[0]?.author, "ConfigOps");
  assert.equal(worldHistory[0]?.summary, "调大地图并补齐资源");
  assert.equal(worldHistory[0]?.candidate, "phase1-rc");
  assert.equal(worldHistory[0]?.revision, "abc1234");
  assert.equal((worldHistory[0]?.changeCount ?? 0) > 0, true);

  const mapHistory = await store.listPublishHistory("mapObjects");
  assert.equal(mapHistory[0]?.documentId, "mapObjects");
  assert.equal((mapHistory[0]?.structuralChangeCount ?? 0) >= 0, true);

  const auditHistory = await store.listPublishAuditHistory();
  assert.equal(auditHistory[0]?.author, "ConfigOps");
  assert.equal(auditHistory[0]?.candidate, "phase1-rc");
  assert.equal(auditHistory[0]?.revision, "abc1234");
  assert.equal(auditHistory[0]?.resultStatus, "applied");
  assert.equal(auditHistory[0]?.changes.length, 2);
  assert.equal(auditHistory[0]?.changes[0]?.runtimeStatus, "applied");
  assert.equal(typeof auditHistory[0]?.changes[0]?.snapshotId, "string");
  assert.equal((auditHistory[0]?.changes[0]?.diffSummary.length ?? 0) > 0, true);
  assert.equal(auditHistory[0]?.changes[0]?.impactSummary?.documentId, auditHistory[0]?.changes[0]?.documentId);
  assert.equal((auditHistory[0]?.changes[0]?.impactSummary?.changedFields.length ?? 0) > 0, true);
  assert.equal((auditHistory[0]?.changes[0]?.impactSummary?.impactedModules.length ?? 0) > 0, true);
  assert.equal((auditHistory[0]?.changes[0]?.impactSummary?.riskHints.length ?? 0) > 0, true);

  const rollbackSnapshotId = auditHistory[0]?.changes.find((change) => change.documentId === "world")?.snapshotId;
  assert.equal(typeof rollbackSnapshotId, "string");
  const rolledBack = await store.rollbackToSnapshot("world", rollbackSnapshotId ?? "");
  assert.equal(JSON.parse(rolledBack.content).width, WORLD_CONFIG.width);

  const stageAfter = await store.getStagedDraft();
  assert.equal(stageAfter, null);
});

test("config center staged publish blocks invalid drafts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const staged = await store.saveStagedDraft([
    {
      id: "world",
      content: JSON.stringify({
        ...WORLD_CONFIG,
        width: 0
      })
    }
  ]);
  assert.equal(staged?.valid, false);

  await assert.rejects(
    () => store.publishStagedDraft({ author: "Ops", summary: "bad publish" }),
    /未通过校验|修复/
  );
});

test("config center staged diff preview returns grouped added, modified, and removed entries with a stable stage hash", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const live = {
    ...MAP_OBJECTS_CONFIG,
    buildings: MAP_OBJECTS_CONFIG.buildings.map((building) =>
      building.kind === "resource_mine"
        ? {
            ...building,
            lastHarvestDay: 2
          }
        : building
    )
  };
  await store.saveDocument("mapObjects", JSON.stringify(live));

  const staged = {
    ...live,
    buildings: live.buildings.map((building) => {
      if (building.kind === "resource_mine") {
        const { lastHarvestDay: _lastHarvestDay, ...rest } = building;
        return {
          ...rest,
          income: building.income + 1
        };
      }
      if (building.kind === "attribute_shrine") {
        return {
          ...building,
          lastUsedDay: 3
        };
      }
      return building;
    })
  };
  await store.saveStagedDraft([
    {
      id: "mapObjects",
      content: JSON.stringify(staged)
    }
  ]);

  const preview = await store.previewStagedDiff("mapObjects");

  assert.equal(preview.documentId, "mapObjects");
  assert.equal(typeof preview.hash, "string");
  assert.equal(typeof preview.stageHash, "string");
  assert.ok(preview.stageHash.length > 0);
  assert.equal(preview.added.some((entry) => entry.key === "buildings[1].lastUsedDay" && entry.after === "3"), true);
  assert.equal(
    preview.modified.some(
      (entry) => entry.key === "buildings[2].income" && entry.before === "2" && entry.after === "3"
    ),
    true
  );
  assert.equal(
    preview.removed.some((entry) => entry.key === "buildings[2].lastHarvestDay" && entry.before === "2"),
    true
  );
});

test("config center staged publish rejects confirmed diff hashes after staged drift", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  await store.saveStagedDraft([
    {
      id: "world",
      content: JSON.stringify({
        ...WORLD_CONFIG,
        width: WORLD_CONFIG.width + 1
      })
    }
  ]);
  const preview = await store.previewStagedDiff("world");

  await store.saveStagedDraft([
    {
      id: "world",
      content: JSON.stringify({
        ...WORLD_CONFIG,
        width: WORLD_CONFIG.width + 2
      })
    }
  ]);

  await assert.rejects(
    () =>
      store.publishStagedDraft({
        author: "ConfigOps",
        summary: "stale preview",
        confirmedDiffHash: preview.stageHash
      }),
    /漂移.*diff-preview|diff-preview.*漂移/
  );
});

test("config center delays hot reload while battles are active and applies it once rooms are safe", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  let activeBattles = 1;
  configureConfigRuntimeStatusProvider(() => ({
    rooms: activeBattles > 0 ? [{ roomId: "room-battle", activeBattles }] : [],
    activeBattleCount: activeBattles
  }));

  const nextWorld = {
    ...WORLD_CONFIG,
    width: 10
  };

  await store.saveDocument("world", JSON.stringify(nextWorld));
  assert.equal(getDefaultWorldConfig().width, WORLD_CONFIG.width);

  activeBattles = 0;
  const result = flushPendingConfigUpdate();

  assert.equal(result?.status, "applied");
  assert.equal(getDefaultWorldConfig().width, 10);
});

test("config center rejects schema-incompatible staged publishes with an explicit error", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  const incompatibleBalance = {
    ...BATTLE_BALANCE_CONFIG,
    environment: {
      ...BATTLE_BALANCE_CONFIG.environment
    }
  } as typeof BATTLE_BALANCE_CONFIG & {
    environment: Omit<typeof BATTLE_BALANCE_CONFIG.environment, "trapGrantedStatusId">;
  };
  delete incompatibleBalance.environment.trapGrantedStatusId;

  await store.saveStagedDraft([
    {
      id: "battleBalance",
      content: JSON.stringify(incompatibleBalance)
    }
  ]);

  await assert.rejects(
    () => store.publishStagedDraft({ author: "Ops", summary: "incompatible hot reload" }),
    /不兼容的 Schema 变更/
  );
});

test("config center rolls back hot reloads after a room error spike within the safety window", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  let scheduledHandler: (() => void) | null = null;
  let scheduledDelayMs: number | null = null;
  const baselineMs = Date.parse("2026-04-11T16:15:00.000Z");
  configureConfigCenterRuntimeDependencies({
    now: () => baselineMs,
    setTimeout: (handler, delayMs) => {
      scheduledHandler = handler;
      scheduledDelayMs = delayMs;
      return {};
    },
    clearTimeout: () => {
      scheduledHandler = null;
      scheduledDelayMs = null;
    }
  });

  await store.saveDocument(
    "world",
    JSON.stringify({
      ...WORLD_CONFIG,
      width: 10
    })
  );
  assert.equal(getDefaultWorldConfig().width, 10);
  assert.ok(scheduledHandler);
  assert.equal(scheduledDelayMs, 120_000);

  for (let index = 0; index < 3; index += 1) {
    recordRuntimeErrorEvent({
      id: `hot-reload-error-${index}`,
      recordedAt: new Date(baselineMs + 1_000 + index).toISOString(),
      source: "server",
      surface: "server",
      candidateRevision: "workspace",
      featureArea: "runtime",
      ownerArea: "multiplayer",
      severity: "error",
      errorCode: "room_hot_reload_crash",
      message: "Synthetic room crash after hot reload.",
      context: {
        roomId: `room-${index}`,
        playerId: null,
        requestId: null,
        route: null,
        action: null,
        statusCode: null,
        crash: true,
        detail: "test spike"
      }
    });
  }

  scheduledHandler?.();
  assert.equal(getDefaultWorldConfig().width, WORLD_CONFIG.width);
});

test("config center honors CONFIG_ROLLBACK_WINDOW_MS when scheduling the hot reload safety window", async () => {
  process.env.CONFIG_ROLLBACK_WINDOW_MS = "45000";

  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();

  let scheduledDelayMs: number | null = null;
  configureConfigCenterRuntimeDependencies({
    setTimeout: (_handler, delayMs) => {
      scheduledDelayMs = delayMs;
      return {};
    },
    clearTimeout: () => {
      scheduledDelayMs = null;
    }
  });

  await store.saveDocument(
    "world",
    JSON.stringify({
      ...WORLD_CONFIG,
      width: 11
    })
  );

  assert.equal(scheduledDelayMs, 45_000);
});
