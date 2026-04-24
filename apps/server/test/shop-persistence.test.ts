import assert from "node:assert/strict";
import test from "node:test";
import { MySqlRoomSnapshotStore, type PlayerAccountSnapshot } from "@server/persistence";

function createExistingAccount(overrides: Partial<PlayerAccountSnapshot> = {}): PlayerAccountSnapshot {
  return {
    playerId: "shop-player",
    displayName: "shop-player",
    gems: 0,
    globalResources: { gold: 0, wood: 0, ore: 0 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [],
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
    ...overrides
  };
}

function createPlayerAccountRow(overrides: Record<string, unknown> = {}) {
  return {
    player_id: "shop-player",
    display_name: "shop-player",
    gems: 200,
    global_resources_json: JSON.stringify({ gold: 0, wood: 0, ore: 0 }),
    achievements_json: "[]",
    recent_event_log_json: "[]",
    recent_battle_replays_json: "[]",
    created_at: new Date("2026-04-24T00:00:00.000Z"),
    updated_at: new Date("2026-04-24T00:00:00.000Z"),
    ...overrides
  };
}

function createStoreHarness() {
  return Object.create(MySqlRoomSnapshotStore.prototype) as MySqlRoomSnapshotStore & {
    pool: {
      query: (sql: string, params: unknown[]) => Promise<unknown>;
      getConnection: () => Promise<{
        beginTransaction: () => Promise<void>;
        query: (sql: string, params?: unknown[]) => Promise<unknown>;
        commit: () => Promise<void>;
        rollback: () => Promise<void>;
        release: () => void;
      }>;
    };
    ensurePlayerAccount: (input: { playerId: string }) => Promise<PlayerAccountSnapshot>;
    loadPlayerAccount: (playerId: string) => Promise<PlayerAccountSnapshot | null>;
    loadPlayerAccountByLoginId: (loginId: string) => Promise<PlayerAccountSnapshot | null>;
  };
}

test("purchaseShopProduct rejects daily gem spend overflow after locking the account", async () => {
  const store = createStoreHarness();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    beginTransaction: async () => {},
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/FROM `shop_purchases`/.test(sql) && /purchase_id = \?/.test(sql)) {
        return [[]];
      }
      if (/FROM `player_accounts`/.test(sql)) {
        return [[createPlayerAccountRow()]];
      }
      if (/FROM `shop_purchases`/.test(sql) && /created_at >= \?/.test(sql)) {
        return [[{ product_id: "starter-bundle", quantity: 1, total_price: 30 }]];
      }

      return [{}];
    },
    commit: async () => {
      committed = true;
    },
    rollback: async () => {
      rolledBack = true;
    },
    release: () => {}
  };

  store.ensurePlayerAccount = async () => createExistingAccount({ gems: 200 });
  store.loadPlayerAccount = async () => createExistingAccount({ gems: 200 });
  store.loadPlayerAccountByLoginId = async () => null;
  store.pool = {
    query: async () => {
      throw new Error("pool.query should not be used inside shop purchase transactions");
    },
    getConnection: async () => connection
  };

  await assert.rejects(
    () =>
      store.purchaseShopProduct("shop-player", {
        purchaseId: "purchase-cap-2",
        productId: "starter-bundle",
        productName: "Starter Bundle",
        quantity: 1,
        unitPrice: 30,
        grant: { resources: { gold: 120 } },
        limitEnforcement: {
          window: {
            from: "2026-04-24T00:00:00.000Z",
            resetAt: "2026-04-25T00:00:00.000Z"
          },
          dailyGemSpendCap: 50,
          perItemDailyQuantityLimit: 0
        }
      } as never),
    /daily_gem_spend_cap/
  );

  const accountLockIndex = queries.findIndex((entry) => /FROM `player_accounts`/.test(entry.sql) && /FOR UPDATE/.test(entry.sql));
  const limitHistoryIndex = queries.findIndex((entry) => /FROM `shop_purchases`/.test(entry.sql) && /created_at >= \?/.test(entry.sql));

  assert.ok(accountLockIndex >= 0);
  assert.ok(limitHistoryIndex > accountLockIndex);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(queries.some((entry) => /INSERT INTO `shop_purchases`/.test(entry.sql)), false);
});

test("purchaseShopProduct rejects per-item daily quantity overflow after locking the account", async () => {
  const store = createStoreHarness();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    beginTransaction: async () => {},
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/FROM `shop_purchases`/.test(sql) && /purchase_id = \?/.test(sql)) {
        return [[]];
      }
      if (/FROM `player_accounts`/.test(sql)) {
        return [[createPlayerAccountRow()]];
      }
      if (/FROM `shop_purchases`/.test(sql) && /created_at >= \?/.test(sql)) {
        return [[{ product_id: "starter-bundle", quantity: 2, total_price: 60 }]];
      }

      return [{}];
    },
    commit: async () => {
      committed = true;
    },
    rollback: async () => {
      rolledBack = true;
    },
    release: () => {}
  };

  store.ensurePlayerAccount = async () => createExistingAccount({ gems: 200 });
  store.loadPlayerAccount = async () => createExistingAccount({ gems: 200 });
  store.loadPlayerAccountByLoginId = async () => null;
  store.pool = {
    query: async () => {
      throw new Error("pool.query should not be used inside shop purchase transactions");
    },
    getConnection: async () => connection
  };

  await assert.rejects(
    () =>
      store.purchaseShopProduct("shop-player", {
        purchaseId: "purchase-item-limit-2",
        productId: "starter-bundle",
        productName: "Starter Bundle",
        quantity: 1,
        unitPrice: 30,
        grant: { resources: { gold: 120 } },
        limitEnforcement: {
          window: {
            from: "2026-04-24T00:00:00.000Z",
            resetAt: "2026-04-25T00:00:00.000Z"
          },
          dailyGemSpendCap: 0,
          perItemDailyQuantityLimit: 2
        }
      } as never),
    /daily_item_quantity_limit/
  );

  const accountLockIndex = queries.findIndex((entry) => /FROM `player_accounts`/.test(entry.sql) && /FOR UPDATE/.test(entry.sql));
  const limitHistoryIndex = queries.findIndex((entry) => /FROM `shop_purchases`/.test(entry.sql) && /created_at >= \?/.test(entry.sql));

  assert.ok(accountLockIndex >= 0);
  assert.ok(limitHistoryIndex > accountLockIndex);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(queries.some((entry) => /INSERT INTO `shop_purchases`/.test(entry.sql)), false);
});
