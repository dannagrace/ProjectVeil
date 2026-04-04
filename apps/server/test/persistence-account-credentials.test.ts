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
    gems: 0,
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
    pool: {
      query: (sql: string, params: unknown[]) => Promise<unknown>;
      getConnection?: () => Promise<{
        beginTransaction: () => Promise<void>;
        query: (sql: string, params: unknown[]) => Promise<unknown>;
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

test("listSeasons reads closed seasons by default and caps the query limit at 100", async () => {
  const store = createStoreHarness();
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  store.pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return [[
        {
          season_id: "season-2",
          status: "closed",
          started_at: "2026-03-01T00:00:00.000Z",
          ended_at: "2026-03-15T00:00:00.000Z"
        }
      ]];
    }
  };

  const seasons = await store.listSeasons({ limit: 999 });

  assert.deepEqual(seasons, [
    {
      seasonId: "season-2",
      status: "closed",
      startedAt: "2026-03-01T00:00:00.000Z",
      endedAt: "2026-03-15T00:00:00.000Z"
    }
  ]);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM `veil_seasons`/);
  assert.match(queries[0].sql, /WHERE status = \?/);
  assert.deepEqual(queries[0].params, ["closed", 100]);
});

test("listSeasons supports status=all without a status filter", async () => {
  const store = createStoreHarness();
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  store.pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return [[
        {
          season_id: "season-3",
          status: "active",
          started_at: "2026-04-01T00:00:00.000Z",
          ended_at: null
        }
      ]];
    }
  };

  const seasons = await store.listSeasons({ status: "all", limit: 5 });

  assert.deepEqual(seasons, [
    {
      seasonId: "season-3",
      status: "active",
      startedAt: "2026-04-01T00:00:00.000Z"
    }
  ]);
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0].sql, /WHERE status = \?/);
  assert.deepEqual(queries[0].params, [5]);
});

test("closeSeason grants tier rewards, soft-resets elo, and is idempotent", async () => {
  const seasonState = { seasonId: "season-live", status: "active" as "active" | "closed" };
  const accounts = new Map([
    ["diamond-player", { eloRating: 1820, gems: 10 }],
    ["gold-player", { eloRating: 1380, gems: 5 }],
    ["bronze-player", { eloRating: 1040, gems: 0 }]
  ]);
  const rankingRows: Array<{ seasonId: string; playerId: string; finalRating: number; tier: string; rankPosition: number }> = [];
  const gemLedgerEntries: Array<{ playerId: string; delta: number; refId: string }> = [];

  const connection = {
    async beginTransaction() {},
    async query(sql: string, params: unknown[] = []) {
      if (/FROM `veil_seasons`/.test(sql) && /FOR UPDATE/.test(sql)) {
        return [[{ season_id: seasonState.seasonId, status: seasonState.status }]];
      }
      if (/FROM `player_accounts`/.test(sql) && /ORDER BY elo_rating DESC/.test(sql)) {
        const rows = [...accounts.entries()]
          .sort((left, right) => right[1].eloRating - left[1].eloRating || left[0].localeCompare(right[0]))
          .map(([playerId, account]) => ({
            player_id: playerId,
            elo_rating: account.eloRating,
            gems: account.gems
          }));
        return [rows];
      }
      if (/INSERT INTO `veil_season_rankings`/.test(sql)) {
        const values = params[0] as Array<[string, string, number, string, number]>;
        for (const [seasonId, playerId, finalRating, tier, rankPosition] of values) {
          rankingRows.push({ seasonId, playerId, finalRating, tier, rankPosition });
        }
        return [{ affectedRows: values.length }];
      }
      if (/UPDATE `player_accounts`/.test(sql) && /SET gems = \?,\s+elo_rating = \?/.test(sql)) {
        const [gems, eloRating, playerId] = params as [number, number, string];
        accounts.set(playerId, { gems, eloRating });
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO `gem_ledger`/.test(sql)) {
        const [, playerId, delta, , refId] = params as [string, string, number, string, string];
        gemLedgerEntries.push({ playerId, delta, refId });
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE `veil_seasons`/.test(sql) && /status = 'closed'/.test(sql)) {
        seasonState.status = "closed";
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Unexpected SQL in closeSeason test: ${sql}`);
    },
    async commit() {},
    async rollback() {},
    release() {}
  };

  const store = new MySqlRoomSnapshotStore({
    getConnection: async () => connection,
    query: async () => {
      throw new Error("pool.query should not be used by closeSeason");
    }
  } as never);

  const firstClose = await store.closeSeason("season-live");
  const secondClose = await store.closeSeason("season-live");

  assert.deepEqual(firstClose, {
    seasonId: "season-live",
    playersRewarded: 3,
    totalGemsGranted: 375
  });
  assert.deepEqual(secondClose, {
    seasonId: "season-live",
    playersRewarded: 0,
    totalGemsGranted: 0
  });
  assert.deepEqual(accounts.get("diamond-player"), { eloRating: 1410, gems: 260 });
  assert.deepEqual(accounts.get("gold-player"), { eloRating: 1190, gems: 105 });
  assert.deepEqual(accounts.get("bronze-player"), { eloRating: 1020, gems: 25 });
  assert.deepEqual(
    rankingRows.map((row) => ({ playerId: row.playerId, tier: row.tier, rankPosition: row.rankPosition, finalRating: row.finalRating })),
    [
      { playerId: "diamond-player", tier: "diamond", rankPosition: 1, finalRating: 1820 },
      { playerId: "gold-player", tier: "gold", rankPosition: 2, finalRating: 1380 },
      { playerId: "bronze-player", tier: "bronze", rankPosition: 3, finalRating: 1040 }
    ]
  );
  assert.deepEqual(gemLedgerEntries, [
    { playerId: "diamond-player", delta: 250, refId: "season:season-live" },
    { playerId: "gold-player", delta: 100, refId: "season:season-live" },
    { playerId: "bronze-player", delta: 25, refId: "season:season-live" }
  ]);
});

test("mysql player event history query applies inclusive timestamp filters", async () => {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const store = new MySqlRoomSnapshotStore({
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (queries.length === 1) {
        return [[{ total: 1 }]];
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
  } as never);

  const history = (await store.loadPlayerEventHistory("player-1", {
    since: "2026-03-20T00:00:00.000Z",
    until: "2026-03-20T00:06:00.000Z"
  })) as PlayerEventHistorySnapshot;

  assert.equal(history.total, 1);
  assert.deepEqual(history.items.map((entry) => entry.id), ["event-2"]);
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /timestamp >= \?/);
  assert.match(queries[0].sql, /timestamp <= \?/);
  assert.deepEqual(queries[0].params, ["player-1", "2026-03-20T00:00:00.000Z", "2026-03-20T00:06:00.000Z"]);
  assert.match(queries[1].sql, /ORDER BY timestamp DESC, event_id ASC/);
  assert.deepEqual(queries[1].params, ["player-1", "2026-03-20T00:00:00.000Z", "2026-03-20T00:06:00.000Z"]);
});

test("creditGems updates balance and appends a ledger entry in one transaction", async () => {
  const store = createStoreHarness();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const connection = {
    beginTransaction: async () => {},
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (/SELECT gems/.test(sql)) {
        return [[{ gems: 4 }]];
      }

      return [{}];
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  };

  store.ensurePlayerAccount = async () => createExistingAccount({ gems: 4 });
  store.loadPlayerAccount = async () => createExistingAccount({ gems: 9 });
  store.loadPlayerAccountByLoginId = async () => null;
  store.pool = {
    query: async () => {
      throw new Error("pool.query should not be used inside gem mutation transactions");
    },
    getConnection: async () => connection
  };

  const account = await store.creditGems("player-1", 5, "reward", "quest-1");

  assert.equal(account.gems, 9);
  assert.equal(queries.length, 3);
  assert.match(queries[0].sql, /SELECT gems/);
  assert.match(queries[1].sql, /UPDATE `player_accounts`/);
  assert.deepEqual(queries[1].params, [9, "player-1"]);
  assert.match(queries[2].sql, /INSERT INTO `gem_ledger`/);
  assert.deepEqual(queries[2].params.slice(1), ["player-1", 5, "reward", "quest-1"]);
});

test("debitGems rejects overspend and rolls back without writing a ledger entry", async () => {
  const store = createStoreHarness();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    beginTransaction: async () => {},
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (/SELECT gems/.test(sql)) {
        return [[{ gems: 2 }]];
      }

      throw new Error("unexpected write during insufficient funds path");
    },
    commit: async () => {
      committed = true;
    },
    rollback: async () => {
      rolledBack = true;
    },
    release: () => {}
  };

  store.ensurePlayerAccount = async () => createExistingAccount({ gems: 2 });
  store.loadPlayerAccount = async () => createExistingAccount({ gems: 2 });
  store.loadPlayerAccountByLoginId = async () => null;
  store.pool = {
    query: async () => {
      throw new Error("pool.query should not be used inside gem mutation transactions");
    },
    getConnection: async () => connection
  };

  await assert.rejects(() => store.debitGems("player-1", 3, "spend", "shop-1"), /insufficient gems/);

  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /SELECT gems/);
});
