import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  getBattleBalanceConfig,
  getDefaultBattleSkillCatalog,
  getDefaultWorldConfig,
  resetRuntimeConfigs
} from "../../../packages/shared/src/index";
import {
  createWorldConfigPreview,
  FileSystemConfigCenterStore
} from "../src/config-center";
import type { WorldConfigPreview } from "../src/config-center";

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

const BATTLE_SKILL_CONFIG = {
  skills: [
    {
      id: "power_shot",
      name: "投矛射击",
      description: "远程压制目标，伤害略低，但不会触发反击。",
      kind: "active" as const,
      target: "enemy" as const,
      cooldown: 2,
      effects: {
        damageMultiplier: 0.85,
        allowRetaliation: false
      }
    },
    {
      id: "armor_spell",
      name: "护甲术",
      description: "为自己附加护甲术，在后续回合提升防御。",
      kind: "active" as const,
      target: "self" as const,
      cooldown: 3,
      effects: {
        grantedStatusId: "arcane_armor"
      }
    },
    {
      id: "venomous_fangs",
      name: "毒牙",
      description: "命中后让目标陷入中毒，回合开始时持续掉血。",
      kind: "passive" as const,
      target: "enemy" as const,
      cooldown: 0,
      effects: {
        onHitStatusId: "poisoned"
      }
    }
  ],
  statuses: [
    {
      id: "poisoned",
      name: "中毒",
      description: "回合开始时损失生命。",
      duration: 2,
      attackModifier: 0,
      defenseModifier: 0,
      damagePerTurn: 2
    },
    {
      id: "arcane_armor",
      name: "护甲术",
      description: "临时提升防御。",
      duration: 2,
      attackModifier: 0,
      defenseModifier: 3,
      damagePerTurn: 0
    }
  ]
};

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
  }
};

async function seedConfigRoot(rootDir: string): Promise<void> {
  await writeFile(join(rootDir, "phase1-world.json"), `${JSON.stringify(WORLD_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "phase1-map-objects.json"), `${JSON.stringify(MAP_OBJECTS_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "units.json"), `${JSON.stringify(UNIT_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "battle-skills.json"), `${JSON.stringify(BATTLE_SKILL_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "battle-balance.json"), `${JSON.stringify(BATTLE_BALANCE_CONFIG, null, 2)}\n`, "utf8");
}

test.afterEach(() => {
  resetRuntimeConfigs();
});

test("config center lists seeded config documents", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-center-"));
  await seedConfigRoot(rootDir);
  const store = new FileSystemConfigCenterStore(rootDir);

  const items = await store.listDocuments();

  assert.deepEqual(
    items.map((item) => item.id),
    ["world", "mapObjects", "units", "battleSkills", "battleBalance"]
  );
  assert.match(items[0]?.summary ?? "", /8x8/);
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

test("config center presets and workbook import/export roundtrip", async () => {
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
  assert.match(exported.fileName, /\.xlsx$/);
  const workbook = XLSX.read(exported.body, { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Meta", "Schema", "Fields"]);
  const fieldRows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Fields);
  assert.equal(fieldRows.some((row) => row.Path === "skills[0].id" && row.Description?.includes("技能 id")), true);
  assert.equal((await store.loadDocument("battleSkills")).exportedAt, exported.exportedAt);

  const csvExported = await store.exportDocument("battleSkills", "csv");
  assert.match(csvExported.fileName, /\.csv$/);
  assert.match(csvExported.body.toString("utf8"), /Section,Field,Path,Type,Schema,Description,Value,JSON/);

  const imported = await store.importDocumentFromWorkbook("battleSkills", exported.body);
  assert.equal(imported.id, "battleSkills");

  const restored = await store.applyPreset("battleSkills", preset.id);
  assert.equal(restored.content, original.content);
});
