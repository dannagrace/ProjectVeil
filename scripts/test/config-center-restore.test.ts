import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemConfigCenterStore } from "@server/config-center";

const repoRoot = path.resolve(__dirname, "../..");

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
  neutralArmies: [],
  guaranteedResources: [],
  buildings: []
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
    }
  ]
};

const BATTLE_SKILL_CONFIG = {
  skills: [
    {
      id: "power_shot",
      name: "投矛射击",
      description: "远程压制目标。",
      kind: "active",
      target: "enemy",
      cooldown: 2,
      effects: {
        damageMultiplier: 0.85,
        allowRetaliation: false
      }
    }
  ],
  statuses: []
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
    trapCharges: 1
  },
  pvp: {
    eloK: 32
  },
  turnTimerSeconds: 30,
  afkStrikesBeforeForfeit: 2
};

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createConfigRoot(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-config-center-restore-"));
  writeJson(path.join(rootDir, "phase1-world.json"), WORLD_CONFIG);
  writeJson(path.join(rootDir, "phase1-map-objects.json"), MAP_OBJECTS_CONFIG);
  writeJson(path.join(rootDir, "units.json"), UNIT_CONFIG);
  writeJson(path.join(rootDir, "battle-skills.json"), BATTLE_SKILL_CONFIG);
  writeJson(path.join(rootDir, "battle-balance.json"), BATTLE_BALANCE_CONFIG);
  return rootDir;
}

function runRestore(args: string[]) {
  return spawnSync("node", ["--import", "tsx", "./scripts/config-center-restore.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

test("config-center:restore rolls back from a publish event snapshot", async () => {
  const configRoot = createConfigRoot();
  const store = new FileSystemConfigCenterStore(configRoot);
  await store.initializeRuntimeConfigs();
  await store.saveStagedDraft([
    {
      id: "world",
      content: JSON.stringify({
        ...WORLD_CONFIG,
        width: 10
      })
    }
  ]);

  const published = await store.publishStagedDraft({
    author: "ConfigOps",
    summary: "扩图并补资源",
    candidate: "phase1-rc",
    revision: "abc1234"
  });
  await store.close();

  const publishId = published.publish.id;
  const result = runRestore(["--config-root", configRoot, "--document", "world", "--publish-id", publishId]);

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  const restored = JSON.parse(fs.readFileSync(path.join(configRoot, "phase1-world.json"), "utf8")) as { width: number };
  assert.equal(restored.width, WORLD_CONFIG.width);
});
