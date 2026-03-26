import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
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

async function seedConfigRoot(rootDir: string): Promise<void> {
  await writeFile(join(rootDir, "phase1-world.json"), `${JSON.stringify(WORLD_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "phase1-map-objects.json"), `${JSON.stringify(MAP_OBJECTS_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "units.json"), `${JSON.stringify(UNIT_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "battle-skills.json"), `${JSON.stringify(BATTLE_SKILL_CONFIG, null, 2)}\n`, "utf8");
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
    ["world", "mapObjects", "units", "battleSkills"]
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
  assert.equal(diff.entries.some((entry) => entry.path === "width"), true);

  const rolledBack = await store.rollbackToSnapshot("world", snapshot.id);
  assert.equal(JSON.parse(rolledBack.content).width, WORLD_CONFIG.width);
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

  const imported = await store.importDocumentFromWorkbook("battleSkills", exported.body);
  assert.equal(imported.id, "battleSkills");

  const restored = await store.applyPreset("battleSkills", preset.id);
  assert.equal(restored.content, original.content);
});
