import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { issueAccountAuthSession } from "@server/domain/account/auth";
import { applyBattlePassXp, resolveBattlePassConfig } from "@server/domain/economy/battle-pass";
import type { RoomPersistenceSnapshot } from "@server/index";
import { MemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { registerPlayerAccountRoutes } from "@server/domain/account/player-accounts";
import { registerShopRoutes, type ShopProduct } from "@server/domain/economy/shop";
import { createDefaultHeroLoadout, createDefaultHeroProgression } from "@veil/shared/models";

function createBattlePassWorldSnapshot(): RoomPersistenceSnapshot {
  return {
    state: {
      meta: {
        roomId: "battle-pass-room",
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
          playerId: "battle-pass-player",
          name: "暮潮守望",
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
        "battle-pass-player": { gold: 0, wood: 0, ore: 0 }
      },
      visibilityByPlayer: {}
    },
    battles: []
  };
}

async function startAccountRouteServer(port: number, store: MemoryRoomSnapshotStore): Promise<Server> {
  const transport = new WebSocketTransport();
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

async function startShopRouteServer(port: number, store: MemoryRoomSnapshotStore, products: Partial<ShopProduct>[]): Promise<Server> {
  const transport = new WebSocketTransport();
  registerShopRoutes(transport.getExpressApp() as never, store, { products });
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

test("battle pass XP accumulates and unlocks tiers at configured thresholds", () => {
  const config = resolveBattlePassConfig();

  const afterLoss = applyBattlePassXp(config, { seasonXp: 0, seasonPassTier: 1 }, config.seasonXpPerLoss);
  const afterThreshold = applyBattlePassXp(config, afterLoss, 460);

  assert.equal(afterLoss.seasonXp, 40);
  assert.equal(afterLoss.seasonPassTier, 1);
  assert.equal(afterThreshold.seasonXp, 500);
  assert.equal(afterThreshold.seasonPassTier, 2);
});

test("battle pass claim endpoint rejects double-claim attempts", async (t) => {
  const port = 42500 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.save("battle-pass-room", createBattlePassWorldSnapshot());
  await store.savePlayerAccountProgress("battle-pass-player", { seasonXpDelta: 500 });
  const server = await startAccountRouteServer(port, store);
  const session = issueAccountAuthSession({
    playerId: "battle-pass-player",
    displayName: "暮潮守望",
    loginId: "battle-pass-player"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/player/battle-pass/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({ tier: 2 })
  });
  const secondResponse = await fetch(`http://127.0.0.1:${port}/api/player/battle-pass/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({ tier: 2 })
  });
  const firstPayload = await firstResponse.json();
  const secondPayload = (await secondResponse.json()) as { error: { code: string } };
  const account = await store.loadPlayerAccount("battle-pass-player");

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 409);
  assert.equal(secondPayload.error.code, "battle_pass_tier_already_claimed");
  assert.equal(firstPayload.tier, 2);
  assert.deepEqual(account?.seasonPassClaimedTiers, [2]);
  assert.equal(account?.globalResources.gold, 275);
});

test("battle pass premium rewards are withheld until premium unlock is purchased", async (t) => {
  const port = 42520 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.save("battle-pass-room", createBattlePassWorldSnapshot());
  await store.savePlayerAccountProgress("battle-pass-player", { seasonXpDelta: 2000 });
  const server = await startAccountRouteServer(port, store);
  const session = issueAccountAuthSession({
    playerId: "battle-pass-player",
    displayName: "暮潮守望",
    loginId: "battle-pass-player"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/player/battle-pass/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({ tier: 5 })
  });
  const payload = (await response.json()) as {
    granted: {
      equipmentIds: string[];
      resources: { gold: number };
    };
    seasonPassPremiumApplied: boolean;
  };
  const account = await store.loadPlayerAccount("battle-pass-player");
  const archive = (await store.loadPlayerHeroArchives(["battle-pass-player"]))[0];

  assert.equal(response.status, 200);
  assert.equal(payload.seasonPassPremiumApplied, false);
  assert.deepEqual(payload.granted.equipmentIds, []);
  assert.equal(payload.granted.resources.gold, 500);
  assert.equal(account?.seasonPassPremium ?? false, false);
  assert.deepEqual(archive?.hero.loadout.inventory ?? [], []);
});

test("battle pass claim grants premium rewards and persists them to the account", async () => {
  const store = new MemoryRoomSnapshotStore();
  await store.save("battle-pass-room", createBattlePassWorldSnapshot());
  await store.savePlayerAccountProgress("battle-pass-player", {
    seasonXpDelta: 2000,
    seasonPassPremium: true
  });
  const payload = (await store.claimBattlePassTier("battle-pass-player", 5)) as {
    tier: number;
    granted: {
      resources: { gold: number };
      equipmentIds: string[];
    };
    seasonPassPremiumApplied: boolean;
    account: {
      seasonPassPremium: boolean;
      seasonPassClaimedTiers: number[];
      globalResources: { gold: number };
    };
  };
  const account = await store.loadPlayerAccount("battle-pass-player");
  const archive = (await store.loadPlayerHeroArchives(["battle-pass-player"]))[0];

  assert.equal(payload.tier, 5);
  assert.equal(payload.seasonPassPremiumApplied, true);
  assert.equal(payload.granted.resources.gold, 500);
  assert.deepEqual(payload.granted.equipmentIds, ["sunforged_spear"]);
  assert.equal(payload.account.seasonPassPremium, true);
  assert.deepEqual(payload.account.seasonPassClaimedTiers, [5]);
  assert.equal(payload.account.globalResources.gold, 500);
  assert.equal(account?.seasonPassPremium, true);
  assert.deepEqual(account?.seasonPassClaimedTiers, [5]);
  assert.equal(account?.globalResources.gold, 500);
  assert.deepEqual(archive?.hero.loadout.inventory ?? [], ["sunforged_spear"]);
});

test("season pass premium shop purchase unlocks premium access", async (t) => {
  const port = 42540 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.save("battle-pass-room", createBattlePassWorldSnapshot());
  await store.creditGems("battle-pass-player", 200, "purchase", "seed-gems");
  const server = await startShopRouteServer(port, store, [
    {
      productId: "season-pass-premium",
      name: "Season Pass Premium",
      type: "season_pass_premium",
      price: 120,
      enabled: true,
      grant: {
        seasonPassPremium: true
      }
    }
  ]);
  const session = issueAccountAuthSession({
    playerId: "battle-pass-player",
    displayName: "暮潮守望",
    loginId: "battle-pass-player"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "season-pass-premium",
      quantity: 1,
      purchaseId: "purchase-season-pass-premium-1"
    })
  });
  const payload = (await response.json()) as {
    granted: {
      seasonPassPremium?: boolean;
    };
    gemsBalance: number;
  };
  const account = await store.loadPlayerAccount("battle-pass-player");

  assert.equal(response.status, 200);
  assert.equal(payload.granted.seasonPassPremium, true);
  assert.equal(payload.gemsBalance, 80);
  assert.equal(account?.seasonPassPremium, true);
});
