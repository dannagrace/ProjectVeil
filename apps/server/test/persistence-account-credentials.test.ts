import assert from "node:assert/strict";
import test from "node:test";
import {
  MySqlRoomSnapshotStore,
  type PlayerAccountSnapshot,
  type PlayerEventHistorySnapshot
} from "../src/persistence";

function createExistingAccount(overrides: Partial<PlayerAccountSnapshot> = {}): PlayerAccountSnapshot {
  return {
    playerId: "player-1",
    displayName: "player-1",
    globalResources: { gold: 0, wood: 0, ore: 0 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [],
    createdAt: "2026-03-20T00:00:00.000Z",
    updatedAt: "2026-03-20T00:00:00.000Z",
    ...overrides
  };
}

function createStoreHarness() {
  return Object.create(MySqlRoomSnapshotStore.prototype) as MySqlRoomSnapshotStore & {
    pool: { query: (sql: string, params: unknown[]) => Promise<unknown> };
    ensurePlayerAccount: (input: { playerId: string }) => Promise<PlayerAccountSnapshot>;
    loadPlayerAccount: (playerId: string) => Promise<PlayerAccountSnapshot | null>;
    loadPlayerAccountByLoginId: (loginId: string) => Promise<PlayerAccountSnapshot | null>;
  };
}

test("bindPlayerAccountCredentials translates MySQL duplicate-key failures into a taken error", async () => {
  const existingAccount = createExistingAccount();
  const store = createStoreHarness();

  store.ensurePlayerAccount = async () => existingAccount;
  store.loadPlayerAccount = async () => {
    throw new Error("loadPlayerAccount should not run after a duplicate-key failure");
  };
  store.loadPlayerAccountByLoginId = async () => {
    throw new Error("loadPlayerAccountByLoginId should not be used for uniqueness checks");
  };
  store.pool = {
    query: async () => {
      throw Object.assign(new Error("Duplicate entry 'veil-ranger' for key 'uidx_player_accounts_login_id'"), {
        code: "ER_DUP_ENTRY",
        errno: 1062
      });
    }
  };

  await assert.rejects(
    () =>
      store.bindPlayerAccountCredentials("player-1", {
        loginId: "Veil-Ranger",
        passwordHash: "hashed-password"
      }),
    /loginId is already taken/
  );
});

test("bindPlayerAccountCredentials writes directly without a login-owner pre-check", async () => {
  const existingAccount = createExistingAccount({
    loginId: "veil-ranger",
    credentialBoundAt: "2026-03-21T00:00:00.000Z"
  });
  const persistedAccount = {
    ...existingAccount,
    passwordHash: undefined,
    updatedAt: "2026-03-21T00:00:05.000Z"
  };
  const store = createStoreHarness();
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  store.ensurePlayerAccount = async () => existingAccount;
  store.loadPlayerAccountByLoginId = async () => {
    throw new Error("loadPlayerAccountByLoginId should not be called");
  };
  store.loadPlayerAccount = async (playerId: string) => {
    assert.equal(playerId, "player-1");
    return persistedAccount;
  };
  store.pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return [];
    }
  };

  const account = await store.bindPlayerAccountCredentials("player-1", {
    loginId: "Veil-Ranger",
    passwordHash: "next-hash"
  });

  assert.equal(account.loginId, "veil-ranger");
  assert.equal(account.credentialBoundAt, "2026-03-21T00:00:00.000Z");
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UPDATE `player_accounts`/);
  assert.deepEqual(queries[0].params.slice(0, 2), ["veil-ranger", "next-hash"]);
  assert.equal(queries[0].params[3], "player-1");
});

test("savePlayerAccountProgress appends only newly added entries into player event history", async () => {
  const existingAccount = createExistingAccount({
    recentEventLog: [
      {
        id: "event-older",
        timestamp: "2026-03-20T00:00:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "combat",
        description: "older",
        rewards: []
      }
    ]
  });
  const persistedAccount = createExistingAccount({
    recentEventLog: [
      {
        id: "event-new",
        timestamp: "2026-03-20T00:05:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "achievement",
        description: "new",
        achievementId: "first_battle",
        rewards: [{ type: "badge", label: "初次交锋" }]
      },
      existingAccount.recentEventLog[0]!
    ]
  });
  const store = createStoreHarness();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let loadCount = 0;

  store.loadPlayerAccount = async () => {
    loadCount += 1;
    return loadCount === 1 ? existingAccount : persistedAccount;
  };
  store.ensurePlayerAccount = async () => {
    throw new Error("ensurePlayerAccount should not be called when the account already exists");
  };
  store.loadPlayerAccountByLoginId = async () => null;
  store.pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return [];
    }
  };

  const account = await store.savePlayerAccountProgress("player-1", {
    recentEventLog: persistedAccount.recentEventLog
  });

  assert.equal(account.recentEventLog[0]?.id, "event-new");
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /INSERT INTO `player_accounts`/);
  assert.match(queries[1].sql, /INSERT INTO `player_event_history`/);
  assert.deepEqual(queries[1].params.slice(0, 4), [
    "player-1",
    "event-new",
    new Date("2026-03-20T00:05:00.000Z"),
    "room-1"
  ]);
});

test("loadPlayerEventHistory returns paged rows and total count", async () => {
  const store = createStoreHarness();
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  store.pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (/COUNT\(\*\) AS total/.test(sql)) {
        return [[{ total: 2 }]];
      }

      return [[
        {
          player_id: "player-1",
          event_id: "event-2",
          timestamp: "2026-03-20T00:05:00.000Z",
          room_id: "room-1",
          category: "achievement",
          hero_id: "hero-1",
          world_event_type: null,
          achievement_id: "first_battle",
          entry_json: JSON.stringify({
            id: "event-2",
            timestamp: "2026-03-20T00:05:00.000Z",
            roomId: "room-1",
            playerId: "player-1",
            category: "achievement",
            description: "new",
            heroId: "hero-1",
            achievementId: "first_battle",
            rewards: [{ type: "badge", label: "初次交锋" }]
          }),
          created_at: "2026-03-20T00:05:00.000Z"
        }
      ]];
    }
  };

  const history = (await store.loadPlayerEventHistory("player-1", {
    heroId: "hero-1",
    category: "achievement",
    limit: 1,
    offset: 1
  })) as PlayerEventHistorySnapshot;

  assert.equal(history.total, 2);
  assert.deepEqual(history.items.map((entry) => entry.id), ["event-2"]);
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /FROM `player_event_history`/);
  assert.deepEqual(queries[0].params, ["player-1", "achievement", "hero-1"]);
  assert.match(queries[1].sql, /ORDER BY timestamp DESC, event_id ASC/);
  assert.deepEqual(queries[1].params, ["player-1", "achievement", "hero-1", 1, 1]);
});
