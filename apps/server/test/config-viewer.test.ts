import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { getDefaultBattleSkillCatalog } from "@veil/shared/world";
import { FileSystemConfigCenterStore } from "../src/config-center";
import { DEFAULT_LEADERBOARD_TIER_THRESHOLDS } from "../src/leaderboard-tier-thresholds";
import { buildConfigViewerPageForTest, registerConfigViewerRoutes } from "../src/config-viewer";

const WORLD_CONFIG = {
  width: 8,
  height: 8,
  heroes: [
    {
      id: "hero-1",
      playerId: "player-1",
      name: "Scout",
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
  buildings: []
};

const UNIT_CONFIG = {
  templates: [
    {
      id: "hero_guard_basic",
      stackName: "Guard",
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
      stackName: "Wolf Pack",
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
  turnTimerSeconds: 45,
  afkStrikesBeforeForfeit: 2,
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
  await writeFile(
    join(rootDir, "leaderboard-tier-thresholds.json"),
    `${JSON.stringify({ key: "leaderboard.tier_thresholds", tiers: DEFAULT_LEADERBOARD_TIER_THRESHOLDS }, null, 2)}\n`,
    "utf8"
  );
}

async function startConfigViewerServer(port: number, rootDir: string): Promise<{ server: Server; store: FileSystemConfigCenterStore }> {
  const store = new FileSystemConfigCenterStore(rootDir);
  await store.initializeRuntimeConfigs();
  const transport = new WebSocketTransport();
  registerConfigViewerRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return { server, store };
}

test("config viewer page includes plain fetch-driven shell", () => {
  const html = buildConfigViewerPageForTest();

  assert.match(html, /Config Viewer/);
  assert.match(html, /fetch\("\/api\/config"\)/);
  assert.match(html, /fetch\("\/api\/config\/" \+ encodeURIComponent\(item.id\)\)/);
});

test("config viewer exposes list and detail aliases plus html page", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "veil-config-viewer-"));
  await seedConfigRoot(rootDir);
  const port = 42500 + Math.floor(Math.random() * 1000);
  const { server, store } = await startConfigViewerServer(port, rootDir);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
    await store.close();
  });

  const pageResponse = await fetch(`http://127.0.0.1:${port}/config-viewer`);
  const pageHtml = await pageResponse.text();
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-type") ?? "", /text\/html/);
  assert.match(pageHtml, /Loading config documents/);

  const listResponse = await fetch(`http://127.0.0.1:${port}/api/config`);
  const listPayload = (await listResponse.json()) as {
    items: Array<{
      id: string;
      updatedAt: string;
      summary: string;
      storage: string;
      version: number;
    }>;
  };

  assert.equal(listResponse.status, 200);
  assert.equal(listPayload.items.length, 6);
  assert.deepEqual(
    listPayload.items.map((item) => item.id),
    ["world", "mapObjects", "units", "battleSkills", "battleBalance", "leaderboardTierThresholds"]
  );
  assert.ok(listPayload.items.every((item) => item.updatedAt && item.summary && item.storage && item.version >= 1));

  const detailResponse = await fetch(`http://127.0.0.1:${port}/api/config/world`);
  const detailPayload = (await detailResponse.json()) as {
    document: {
      id: string;
      storage: string;
      version: number;
      content: {
        width: number;
        height: number;
      };
    };
  };

  assert.equal(detailResponse.status, 200);
  assert.equal(detailPayload.document.id, "world");
  assert.equal(detailPayload.document.storage, "filesystem");
  assert.equal(detailPayload.document.version, 1);
  assert.equal(detailPayload.document.content.width, 8);
  assert.equal(detailPayload.document.content.height, 8);

  const missingResponse = await fetch(`http://127.0.0.1:${port}/api/config/missing`);
  assert.equal(missingResponse.status, 404);
});
