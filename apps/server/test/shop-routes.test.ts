import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import {
  configureAnalyticsRuntimeDependencies,
  flushAnalyticsEventsForTest,
  resetAnalyticsRuntimeDependencies
} from "../src/analytics";
import { issueAccountAuthSession } from "../src/auth";
import type { RoomPersistenceSnapshot } from "../src/index";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { registerShopRoutes, type ShopProduct } from "../src/shop";
import {
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  resolveWeeklyShopRotation,
  type PlayerAccountSnapshot
} from "../../../packages/shared/src/index";

function createShopWorldSnapshot(): RoomPersistenceSnapshot {
  return {
    state: {
      meta: {
        roomId: "shop-room",
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
          playerId: "shop-player",
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
        "shop-player": { gold: 0, wood: 0, ore: 0 }
      },
      visibilityByPlayer: {}
    },
    battles: []
  };
}

async function startShopRouteServer(
  port: number,
  store: MemoryRoomSnapshotStore,
  products: Partial<ShopProduct>[],
  options: {
    purchaseControls?: {
      limitTimezone?: string;
      dailyGemSpendCap?: number;
      highValuePurchaseThreshold?: number;
      perItemDailyQuantityLimits?: Record<string, number>;
    };
  } = {}
): Promise<Server> {
  const transport = new WebSocketTransport();
  registerShopRoutes(transport.getExpressApp() as never, store, { products, purchaseControls: options.purchaseControls });
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

const TEST_PRODUCTS: Partial<ShopProduct>[] = [
  {
    productId: "starter-bundle",
    name: "Starter Bundle",
    type: "resource_bundle",
    price: 30,
    enabled: true,
    grant: {
      resources: {
        gold: 120,
        wood: 10,
        ore: 5
      }
    }
  },
  {
    productId: "sunforged-spear",
    name: "Sunforged Spear",
    type: "equipment",
    price: 20,
    enabled: true,
    grant: {
      equipmentIds: ["sunforged_spear"]
    }
  },
  {
    productId: "hidden-pack",
    name: "Hidden Pack",
    type: "gem_pack",
    price: 5,
    enabled: false,
    grant: {
      gems: 10
    }
  },
  {
    productId: "border-shadowcourt-direct",
    name: "Shadowcourt Border",
    type: "cosmetic",
    price: 12,
    enabled: true,
    grant: {
      cosmeticIds: ["border-shadowcourt"]
    }
  }
];

test("shop products route returns only enabled items", async (t) => {
  const port = 42400 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  const server = await startShopRouteServer(port, store, TEST_PRODUCTS);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/shop/products`);
  const payload = (await response.json()) as { items: ShopProduct[]; rotation: { seed: string } };

  assert.equal(response.status, 200);
  assert.deepEqual(payload.items.slice(0, 3).map((item) => item.productId), [
    "starter-bundle",
    "sunforged-spear",
    "border-shadowcourt-direct"
  ]);
  assert.ok(payload.items.some((item) => item.productId.startsWith("cosmetic:")));
  assert.match(payload.rotation.seed, /^\d{4}-W\d{2}$/);
});

test("weekly shop rotation is deterministic within an ISO week and advances on the next ISO week", () => {
  const currentWeek = resolveWeeklyShopRotation(new Date("2026-01-06T12:00:00.000Z"));
  const sameWeek = resolveWeeklyShopRotation(new Date("2026-01-08T12:00:00.000Z"));
  const nextWeek = resolveWeeklyShopRotation(new Date("2026-01-13T12:00:00.000Z"));

  assert.equal(currentWeek.seed, "2026-W02");
  assert.equal(sameWeek.seed, currentWeek.seed);
  assert.deepEqual(sameWeek.featuredSlots, currentWeek.featuredSlots);
  assert.deepEqual(sameWeek.discountSlots, currentWeek.discountSlots);
  assert.equal(nextWeek.seed, "2026-W03");
  assert.notEqual(nextWeek.seed, currentWeek.seed);
});

test("shop purchase debits gems and grants resource bundles", async (t) => {
  const port = 42420 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  const analyticsLogs: string[] = [];
  configureAnalyticsRuntimeDependencies({
    log: (message) => {
      analyticsLogs.push(message);
    }
  });
  await store.save("shop-room", createShopWorldSnapshot());
  await store.creditGems("shop-player", 100, "purchase", "seed-gems");
  const server = await startShopRouteServer(port, store, TEST_PRODUCTS);
  const session = issueAccountAuthSession({
    playerId: "shop-player",
    displayName: "暮潮守望",
    loginId: "shop-player"
  });

  t.after(async () => {
    resetAnalyticsRuntimeDependencies();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "starter-bundle",
      quantity: 2,
      purchaseId: "purchase-resource-1"
    })
  });
  const payload = (await response.json()) as {
    totalPrice: number;
    gemsBalance: number;
    granted: {
      resources: PlayerAccountSnapshot["globalResources"];
    };
  };

  const account = await store.loadPlayerAccount("shop-player");
  await flushAnalyticsEventsForTest({ ANALYTICS_SINK: "stdout" });
  const analyticsEvents = analyticsLogs
    .filter((entry) => entry.startsWith("[Analytics] {"))
    .map((entry) => JSON.parse(entry.slice("[Analytics] ".length)) as { events: Array<{ name: string; payload: Record<string, unknown> }> })
    .flatMap((entry) => entry.events);
  const purchaseCompletedEvent = analyticsEvents.find(
    (event) => event.name === "purchase_completed" && event.payload.purchaseId === "purchase-resource-1"
  );

  assert.equal(response.status, 200);
  assert.equal(payload.totalPrice, 60);
  assert.equal(payload.gemsBalance, 40);
  assert.deepEqual(payload.granted.resources, { gold: 240, wood: 20, ore: 10 });
  assert.deepEqual(account?.globalResources, { gold: 240, wood: 20, ore: 10 });
  assert.equal(account?.gems, 40);
  assert.equal(purchaseCompletedEvent?.payload.paymentMethod, "gems");
  assert.equal(purchaseCompletedEvent?.payload.totalPrice, 60);
});

test("shop purchase grants cosmetics and equip route applies an owned cosmetic", async (t) => {
  const port = 42480 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.save("shop-room", createShopWorldSnapshot());
  const baselineSnapshot = await store.load("shop-room");
  await store.creditGems("shop-player", 30, "purchase", "seed-gems");
  const server = await startShopRouteServer(port, store, TEST_PRODUCTS);
  const session = issueAccountAuthSession({
    playerId: "shop-player",
    displayName: "暮潮守望",
    loginId: "shop-player"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const purchaseResponse = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "border-shadowcourt-direct",
      quantity: 1,
      purchaseId: "purchase-cosmetic-1"
    })
  });
  const purchasePayload = (await purchaseResponse.json()) as {
    granted: {
      cosmeticIds: string[];
    };
    gemsBalance: number;
  };

  const equipResponse = await fetch(`http://127.0.0.1:${port}/api/shop/equip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      cosmeticId: "border-shadowcourt"
    })
  });
  const equipPayload = (await equipResponse.json()) as {
    equippedCosmetics: {
      profileBorderId?: string;
    };
  };

  const account = await store.loadPlayerAccount("shop-player");
  const roomSnapshot = await store.load("shop-room");

  assert.equal(purchaseResponse.status, 200);
  assert.deepEqual(purchasePayload.granted.cosmeticIds, ["border-shadowcourt"]);
  assert.equal(purchasePayload.gemsBalance, 18);
  assert.deepEqual(account?.cosmeticInventory?.ownedIds, ["border-shadowcourt"]);

  assert.equal(equipResponse.status, 200);
  assert.equal(equipPayload.equippedCosmetics.profileBorderId, "border-shadowcourt");
  assert.equal(account?.equippedCosmetics?.profileBorderId, "border-shadowcourt");
  assert.deepEqual(roomSnapshot?.state.heroes[0]?.stats, baselineSnapshot?.state.heroes[0]?.stats);
  assert.deepEqual(roomSnapshot?.state.heroes[0]?.loadout, baselineSnapshot?.state.heroes[0]?.loadout);
});

test("shop purchase grants equipment and replays the original result for the same purchaseId", async (t) => {
  const port = 42440 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.save("shop-room", createShopWorldSnapshot());
  await store.creditGems("shop-player", 100, "purchase", "seed-gems");
  const server = await startShopRouteServer(port, store, TEST_PRODUCTS);
  const session = issueAccountAuthSession({
    playerId: "shop-player",
    displayName: "暮潮守望",
    loginId: "shop-player"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "sunforged-spear",
      quantity: 1,
      purchaseId: "purchase-equipment-1"
    })
  });
  const firstPayload = await firstResponse.json();

  const secondResponse = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "sunforged-spear",
      quantity: 1,
      purchaseId: "purchase-equipment-1"
    })
  });
  const secondPayload = await secondResponse.json();

  const account = await store.loadPlayerAccount("shop-player");
  const archives = await store.loadPlayerHeroArchives(["shop-player"]);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(secondPayload, firstPayload);
  assert.equal(account?.gems, 80);
  assert.deepEqual(archives[0]?.hero.loadout.inventory, ["sunforged_spear"]);
});

test("shop purchase rejects insufficient gems without debiting or granting", async (t) => {
  const port = 42460 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  const analyticsLogs: string[] = [];
  configureAnalyticsRuntimeDependencies({
    log: (message) => {
      analyticsLogs.push(message);
    }
  });
  await store.save("shop-room", createShopWorldSnapshot());
  await store.creditGems("shop-player", 10, "purchase", "seed-gems");
  const server = await startShopRouteServer(port, store, TEST_PRODUCTS);
  const session = issueAccountAuthSession({
    playerId: "shop-player",
    displayName: "暮潮守望",
    loginId: "shop-player"
  });

  t.after(async () => {
    resetAnalyticsRuntimeDependencies();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "starter-bundle",
      quantity: 1,
      purchaseId: "purchase-fail-1"
    })
  });
  const payload = (await response.json()) as {
    error: {
      code: string;
    };
  };

  const account = await store.loadPlayerAccount("shop-player");
  const archives = await store.loadPlayerHeroArchives(["shop-player"]);
  await flushAnalyticsEventsForTest({ ANALYTICS_SINK: "stdout" });
  const analyticsEvents = analyticsLogs
    .filter((entry) => entry.startsWith("[Analytics] {"))
    .map((entry) => JSON.parse(entry.slice("[Analytics] ".length)) as { events: Array<{ name: string; payload: Record<string, unknown> }> })
    .flatMap((entry) => entry.events);
  const purchaseFailedEvent = analyticsEvents.find(
    (event) => event.name === "purchase_failed" && event.payload.purchaseId === "purchase-fail-1"
  );

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "insufficient_gems");
  assert.equal(account?.gems, 10);
  assert.deepEqual(account?.globalResources, { gold: 0, wood: 0, ore: 0 });
  assert.deepEqual(archives[0]?.hero.loadout.inventory, []);
  assert.equal(purchaseFailedEvent?.payload.paymentMethod, "gems");
  assert.equal(purchaseFailedEvent?.payload.failureReason, "insufficient_gems");
});

test("shop purchase enforces the configured daily gem spend cap", async (t) => {
  const port = 42510 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.save("shop-room", createShopWorldSnapshot());
  await store.creditGems("shop-player", 200, "purchase", "seed-gems");
  const server = await startShopRouteServer(port, store, TEST_PRODUCTS, {
    purchaseControls: {
      limitTimezone: "UTC",
      dailyGemSpendCap: 50,
      highValuePurchaseThreshold: 0
    }
  });
  const session = issueAccountAuthSession({
    playerId: "shop-player",
    displayName: "暮潮守望",
    loginId: "shop-player"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "starter-bundle",
      quantity: 1,
      purchaseId: "purchase-cap-1"
    })
  });

  const secondResponse = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "starter-bundle",
      quantity: 1,
      purchaseId: "purchase-cap-2"
    })
  });
  const secondPayload = (await secondResponse.json()) as {
    error: {
      limitType: string;
      resetAt: string;
    };
  };

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 429);
  assert.equal(secondPayload.error.limitType, "daily_gem_spend_cap");
  assert.match(secondPayload.error.resetAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("shop purchase enforces configured per-item daily quantity limits", async (t) => {
  const port = 42530 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.save("shop-room", createShopWorldSnapshot());
  await store.creditGems("shop-player", 200, "purchase", "seed-gems");
  const server = await startShopRouteServer(port, store, TEST_PRODUCTS, {
    purchaseControls: {
      limitTimezone: "UTC",
      dailyGemSpendCap: 0,
      highValuePurchaseThreshold: 0,
      perItemDailyQuantityLimits: {
        "starter-bundle": 2
      }
    }
  });
  const session = issueAccountAuthSession({
    playerId: "shop-player",
    displayName: "暮潮守望",
    loginId: "shop-player"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "starter-bundle",
      quantity: 2,
      purchaseId: "purchase-item-limit-1"
    })
  });

  const secondResponse = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "starter-bundle",
      quantity: 1,
      purchaseId: "purchase-item-limit-2"
    })
  });
  const secondPayload = (await secondResponse.json()) as {
    error: {
      limitType: string;
      resetAt: string;
    };
  };

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 429);
  assert.equal(secondPayload.error.limitType, "daily_item_quantity_limit");
  assert.match(secondPayload.error.resetAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("shop purchase emits a high-value alert analytics event when configured", async (t) => {
  const port = 42550 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  const analyticsLogs: string[] = [];
  configureAnalyticsRuntimeDependencies({
    log: (message) => {
      analyticsLogs.push(message);
    }
  });
  await store.save("shop-room", createShopWorldSnapshot());
  await store.creditGems("shop-player", 200, "purchase", "seed-gems");
  const server = await startShopRouteServer(port, store, TEST_PRODUCTS, {
    purchaseControls: {
      limitTimezone: "UTC",
      dailyGemSpendCap: 0,
      highValuePurchaseThreshold: 100
    }
  });
  const session = issueAccountAuthSession({
    playerId: "shop-player",
    displayName: "暮潮守望",
    loginId: "shop-player"
  });

  t.after(async () => {
    resetAnalyticsRuntimeDependencies();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/shop/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "starter-bundle",
      quantity: 4,
      purchaseId: "purchase-high-value-1"
    })
  });

  await flushAnalyticsEventsForTest({ ANALYTICS_SINK: "stdout" });
  const analyticsEvents = analyticsLogs
    .filter((entry) => entry.startsWith("[Analytics] {"))
    .map((entry) => JSON.parse(entry.slice("[Analytics] ".length)) as { events: Array<{ name: string; payload: Record<string, unknown> }> })
    .flatMap((entry) => entry.events);
  const alertEvent = analyticsEvents.find(
    (event) => event.name === "purchase_high_value_alert" && event.payload.purchaseId === "purchase-high-value-1"
  );

  assert.equal(response.status, 200);
  assert.equal(alertEvent?.payload.productId, "starter-bundle");
  assert.equal(alertEvent?.payload.totalPrice, 120);
  assert.equal(alertEvent?.payload.threshold, 100);
});
