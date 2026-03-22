import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getDefaultWorldConfig,
  resetRuntimeConfigs
} from "../../../packages/shared/src/index";
import { FileSystemConfigCenterStore } from "../src/config-center";

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
      reward: { kind: "gold", amount: 300 },
      stacks: [{ templateId: "wolf_pack", count: 8 }]
    }
  ],
  guaranteedResources: [
    {
      position: { x: 2, y: 1 },
      resource: { kind: "wood", amount: 5 }
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

async function seedConfigRoot(rootDir: string): Promise<void> {
  await writeFile(join(rootDir, "phase1-world.json"), `${JSON.stringify(WORLD_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "phase1-map-objects.json"), `${JSON.stringify(MAP_OBJECTS_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "units.json"), `${JSON.stringify(UNIT_CONFIG, null, 2)}\n`, "utf8");
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
    ["world", "mapObjects", "units"]
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
