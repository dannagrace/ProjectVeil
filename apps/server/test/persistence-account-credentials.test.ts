import assert from "node:assert/strict";
import test from "node:test";
import {
  MySqlRoomSnapshotStore,
  type PlayerAccountSnapshot,
  type PlayerEventHistorySnapshot
} from "@server/persistence";

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

function createSeasonRewardAccounts(count = 100) {
  return new Map(
    Array.from({ length: count }, (_, index) => {
      const playerNumber = index + 1;
      const playerId = `player-${String(playerNumber).padStart(3, "0")}`;
      return [
        playerId,
        {
          eloRating: 2000 - index,
          gems: playerNumber,
          seasonBadges: playerNumber === 1 ? ["founder"] : []
        }
      ];
    })
  );
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

test("closeSeason distributes bracket rewards once and records badges in the reward log", async () => {
  const seasonState = {
    seasonId: "season-live",
    status: "active" as "active" | "closed",
    rewardDistributedAt: null as Date | null
  };
  const accounts = createSeasonRewardAccounts();
  const rankingRows: Array<{ seasonId: string; playerId: string; finalRating: number; tier: string; rankPosition: number }> = [];
  const rewardLog = new Map<string, { gems: number; badge: string }>();

  const connection = {
    async beginTransaction() {},
    async query(sql: string, params: unknown[] = []) {
      if (/FROM `veil_seasons`/.test(sql) && /FOR UPDATE/.test(sql)) {
        return [[{
          season_id: seasonState.seasonId,
          status: seasonState.status,
          reward_distributed_at: seasonState.rewardDistributedAt
        }]];
      }
      if (/FROM `leaderboard_season_archives`/.test(sql) && /ORDER BY rank_position ASC/.test(sql)) {
        return [rankingRows.map((row) => ({
          player_id: row.playerId,
          rank_position: row.rankPosition
        }))];
      }
      if (/FROM `player_accounts`/.test(sql) && /ORDER BY elo_rating DESC/.test(sql)) {
        const rows = [...accounts.entries()]
          .sort((left, right) => right[1].eloRating - left[1].eloRating || left[0].localeCompare(right[0]))
          .map(([playerId, account]) => ({
            player_id: playerId,
            display_name: playerId,
            elo_rating: account.eloRating
          }));
        return [rows];
      }
      if (/INSERT INTO `leaderboard_season_archives`/.test(sql)) {
        const values = params[0] as Array<[string, number, string, string, number, string]>;
        for (const [seasonId, rankPosition, playerId, _displayName, finalRating, tier] of values) {
          rankingRows.push({ seasonId, playerId, finalRating, tier, rankPosition });
        }
        return [{ affectedRows: values.length }];
      }
      if (/INSERT IGNORE INTO `season_reward_log`/.test(sql)) {
        const [seasonId, playerId, gems, badge] = params as [string, string, number, string];
        const rewardKey = `${seasonId}:${playerId}`;
        if (rewardLog.has(rewardKey)) {
          return [{ affectedRows: 0 }];
        }
        rewardLog.set(rewardKey, { gems, badge });
        return [{ affectedRows: 1 }];
      }
      if (/SELECT \*/.test(sql) && /FROM `player_accounts`/.test(sql) && /FOR UPDATE/.test(sql)) {
        const [playerId] = params as [string];
        const account = accounts.get(playerId);
        return [[account
          ? {
              player_id: playerId,
              display_name: playerId,
              avatar_url: null,
              elo_rating: account.eloRating,
              gems: account.gems,
              season_badges_json: JSON.stringify(account.seasonBadges),
              global_resources_json: JSON.stringify({ gold: 0, wood: 0, ore: 0 }),
              achievements_json: JSON.stringify([]),
              recent_event_log_json: JSON.stringify([]),
              recent_battle_replays_json: JSON.stringify([]),
              last_room_id: null,
              last_seen_at: null,
              login_id: null,
              age_verified: 0,
              is_minor: 0,
              daily_play_minutes: 0,
              last_play_date: null,
              login_streak: 0,
              ban_status: "none",
              ban_expiry: null,
              ban_reason: null,
              account_session_version: 0,
              refresh_session_id: null,
              refresh_token_hash: null,
              refresh_token_expires_at: null,
              wechat_open_id: null,
              wechat_union_id: null,
              wechat_mini_game_open_id: null,
              wechat_mini_game_union_id: null,
              wechat_mini_game_bound_at: null,
              credential_bound_at: null,
              privacy_consent_at: null,
              phone_number: null,
              phone_number_bound_at: null,
              created_at: "2026-03-20T00:00:00.000Z",
              updated_at: "2026-03-20T00:00:00.000Z"
            }
          : undefined]];
      }
      if (/UPDATE `player_accounts`/.test(sql) && /season_badges_json = \?/.test(sql)) {
        const [gems, seasonBadgesJson, playerId] = params as [number, string, string];
        const account = accounts.get(playerId);
        assert.ok(account);
        accounts.set(playerId, {
          ...account,
          gems,
          seasonBadges: JSON.parse(seasonBadgesJson)
        });
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE `player_accounts`/.test(sql) && /season_history_json = \?/.test(sql)) {
        const [eloRating, rankDivision, peakRankDivision, _promotionSeriesJson, _demotionShieldJson, seasonHistoryJson, playerId] =
          params as [number, string, string, string, string, string, string];
        const account = accounts.get(playerId);
        assert.ok(account);
        accounts.set(playerId, {
          ...account,
          eloRating,
          rankDivision,
          peakRankDivision,
          seasonHistory: JSON.parse(seasonHistoryJson)
        });
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE `veil_seasons`/.test(sql) && /reward_distributed_at/.test(sql)) {
        seasonState.status = "closed";
        seasonState.rewardDistributedAt = params[1] as Date;
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
    playersRewarded: 25,
    totalGemsGranted: 1850
  });
  assert.deepEqual(secondClose, {
    seasonId: "season-live",
    playersRewarded: 0,
    totalGemsGranted: 0
  });
  assert.equal(accounts.get("player-001")?.gems, 201);
  assert.deepEqual(accounts.get("player-001")?.seasonBadges, ["founder", "diamond_champion"]);
  assert.equal(accounts.get("player-010")?.gems, 110);
  assert.deepEqual(accounts.get("player-010")?.seasonBadges, ["platinum_rival"]);
  assert.equal(accounts.get("player-025")?.gems, 75);
  assert.deepEqual(accounts.get("player-025")?.seasonBadges, ["gold_contender"]);
  assert.equal(accounts.get("player-026")?.gems, 26);
  assert.deepEqual(accounts.get("player-026")?.seasonBadges, []);
  assert.equal(rankingRows.length, 100);
  assert.equal(rewardLog.size, 25);
  assert.deepEqual(rewardLog.get("season-live:player-001"), {
    gems: 200,
    badge: "diamond_champion"
  });
  assert.deepEqual(rewardLog.get("season-live:player-010"), {
    gems: 100,
    badge: "platinum_rival"
  });
  assert.deepEqual(rewardLog.get("season-live:player-025"), {
    gems: 50,
    badge: "gold_contender"
  });
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

test("deletePlayerAccount deletes dependent rows, verifies cascade cleanup, and scrubs leaderboard state", async () => {
  const existingAccount = createExistingAccount({
    displayName: "Veil Ranger",
    loginId: "veil-ranger",
    privacyConsentAt: "2026-03-20T01:00:00.000Z",
    eloRating: 1660,
    rankDivision: "platinum_i",
    peakRankDivision: "diamond_v",
    seasonHistory: [
      {
        seasonId: "season-1",
        finalRating: 1640,
        rankDivision: "platinum_i",
        archivedAt: "2026-03-19T00:00:00.000Z"
      }
    ],
    recentEventLog: [
      {
        id: "delete-me-event",
        timestamp: "2026-03-20T00:01:00.000Z",
        roomId: "room-1",
        playerId: "player-1",
        category: "combat",
        description: "delete me",
        rewards: []
      }
    ],
    recentBattleReplays: [
      {
        id: "delete-me-replay",
        battleId: "battle-1",
        roomId: "room-1",
        createdAt: "2026-03-20T00:02:00.000Z",
        participants: [],
        result: "victory",
        rewardSummary: []
      }
    ],
    mailbox: [
      {
        id: "mail-1",
        kind: "system",
        title: "Delete me",
        body: "Delete me",
        sentAt: "2026-03-20T00:03:00.000Z"
      }
    ]
  });
  const deletedAccount = createExistingAccount({
    displayName: "deleted-player-1",
    eloRating: undefined,
    rankDivision: undefined,
    peakRankDivision: undefined,
    seasonHistory: [],
    recentEventLog: [],
    recentBattleReplays: [],
    mailbox: undefined,
    leaderboardModerationState: {
      hiddenAt: "2026-03-21T00:00:00.000Z",
      hiddenByPlayerId: "system:gdpr-delete"
    },
    loginId: undefined,
    privacyConsentAt: undefined
  });
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let loadCount = 0;
  let committed = false;
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (/SELECT COUNT\(\*\) AS total/.test(sql)) {
        return [[{ total: 0 }]];
      }

      return [{ affectedRows: 1 }];
    },
    async commit() {
      committed = true;
    },
    async rollback() {
      rolledBack = true;
    },
    release() {}
  };

  const store = createStoreHarness();
  store.loadPlayerAccount = async (playerId: string) => {
    assert.equal(playerId, "player-1");
    loadCount += 1;
    return loadCount === 1 ? existingAccount : deletedAccount;
  };
  store.loadPlayerAccountByLoginId = async () => null;
  store.ensurePlayerAccount = async () => existingAccount;
  store.pool = {
    query: async () => {
      throw new Error("pool.query should not be used by deletePlayerAccount");
    },
    getConnection: async () => connection
  };

  const account = await store.deletePlayerAccount("player-1", {
    deletedAt: "2026-03-21T00:00:00.000Z"
  });

  assert.equal(account?.displayName, "deleted-player-1");
  assert.equal(account?.eloRating, undefined);
  assert.equal(account?.leaderboardModerationState?.hiddenByPlayerId, "system:gdpr-delete");
  assert.equal(committed, true);
  assert.equal(rolledBack, false);
  assert.match(queries[0]?.sql ?? "", /DELETE FROM `player_account_sessions`/);
  assert.ok(queries.some((entry) => /DELETE FROM `player_compensation_history`/.test(entry.sql)));
  assert.ok(queries.some((entry) => /DELETE FROM `guild_memberships`/.test(entry.sql)));
  assert.ok(queries.some((entry) => /DELETE FROM `battle_snapshots`/.test(entry.sql)));
  assert.ok(queries.some((entry) => /DELETE FROM `leaderboard_season_archives`/.test(entry.sql)));
  assert.ok(queries.some((entry) => /DELETE FROM `season_reward_log`/.test(entry.sql)));
  const retainedOrderUpdate = queries.find((entry) => /UPDATE `orders`/.test(entry.sql));
  assert.ok(retainedOrderUpdate);
  assert.equal(retainedOrderUpdate?.params[1], "player-1");
  assert.match(String(retainedOrderUpdate?.params[0] ?? ""), /^deleted-financial-/);
  assert.deepEqual(retainedOrderUpdate?.params.slice(2), ["settled", "dead_letter"]);
  const retainedReceiptUpdate = queries.find((entry) => /UPDATE `payment_receipts`/.test(entry.sql));
  assert.ok(retainedReceiptUpdate);
  assert.equal(retainedReceiptUpdate?.params[0], retainedOrderUpdate?.params[0]);
  assert.deepEqual(retainedReceiptUpdate?.params.slice(1), ["player-1", "player-1", "settled", "dead_letter"]);
  assert.equal(queries.filter((entry) => /SELECT COUNT\(\*\) AS total/.test(entry.sql)).length, 14);
  assert.ok(
    queries.some((entry) => /SELECT COUNT\(\*\) AS total FROM `leaderboard_season_archives`/.test(entry.sql))
  );
  const updateQuery = queries.find((entry) => /UPDATE `player_accounts`/.test(entry.sql));
  assert.ok(updateQuery);
  assert.equal(updateQuery?.params[0], "deleted-player-1");
  assert.equal(updateQuery?.params[10], JSON.stringify({
    hiddenAt: "2026-03-21T00:00:00.000Z",
    hiddenByPlayerId: "system:gdpr-delete"
  }));
});

test("deletePlayerAccount rolls back when post-delete verification finds remaining dependent rows", async () => {
  const existingAccount = createExistingAccount({
    displayName: "Veil Ranger",
    loginId: "veil-ranger"
  });
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (/FROM `guild_memberships`/.test(sql) && /SELECT COUNT\(\*\) AS total/.test(sql)) {
        return [[{ total: 1 }]];
      }
      if (/SELECT COUNT\(\*\) AS total/.test(sql)) {
        return [[{ total: 0 }]];
      }

      return [{ affectedRows: 1 }];
    },
    async commit() {
      committed = true;
    },
    async rollback() {
      rolledBack = true;
    },
    release() {}
  };

  const store = createStoreHarness();
  store.loadPlayerAccount = async () => existingAccount;
  store.loadPlayerAccountByLoginId = async () => null;
  store.ensurePlayerAccount = async () => existingAccount;
  store.pool = {
    query: async () => {
      throw new Error("pool.query should not be used by deletePlayerAccount");
    },
    getConnection: async () => connection
  };

  await assert.rejects(
    () =>
      store.deletePlayerAccount("player-1", {
        deletedAt: "2026-03-21T00:00:00.000Z"
      }),
    /gdpr_delete_verification_failed:guild_memberships/
  );

  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.ok(queries.some((entry) => /SELECT COUNT\(\*\) AS total FROM `guild_memberships`/.test(entry.sql)));
  assert.ok(queries.every((entry) => !/UPDATE `player_accounts`/.test(entry.sql)));
});

test("deletePlayerAccount rolls back when unsettled orders keep a raw player id", async () => {
  const existingAccount = createExistingAccount({
    displayName: "Veil Ranger",
    loginId: "veil-ranger"
  });
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (/FROM `orders`/.test(sql) && /SELECT COUNT\(\*\) AS total/.test(sql)) {
        return [[{ total: 1 }]];
      }
      if (/SELECT COUNT\(\*\) AS total/.test(sql)) {
        return [[{ total: 0 }]];
      }

      return [{ affectedRows: 1 }];
    },
    async commit() {
      committed = true;
    },
    async rollback() {
      rolledBack = true;
    },
    release() {}
  };

  const store = createStoreHarness();
  store.loadPlayerAccount = async () => existingAccount;
  store.loadPlayerAccountByLoginId = async () => null;
  store.ensurePlayerAccount = async () => existingAccount;
  store.pool = {
    query: async () => {
      throw new Error("pool.query should not be used by deletePlayerAccount");
    },
    getConnection: async () => connection
  };

  await assert.rejects(
    () =>
      store.deletePlayerAccount("player-1", {
        deletedAt: "2026-03-21T00:00:00.000Z"
      }),
    /gdpr_delete_verification_failed:orders/
  );

  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  const retainedOrderUpdate = queries.find((entry) => /UPDATE `orders`/.test(entry.sql));
  assert.ok(retainedOrderUpdate);
  assert.equal(retainedOrderUpdate?.params[1], "player-1");
  assert.match(String(retainedOrderUpdate?.params[0] ?? ""), /^deleted-financial-/);
  assert.deepEqual(retainedOrderUpdate?.params.slice(2), ["settled", "dead_letter"]);
  assert.ok(queries.some((entry) => /SELECT COUNT\(\*\) AS total FROM `orders`/.test(entry.sql)));
  assert.ok(queries.every((entry) => !/UPDATE `player_accounts`/.test(entry.sql)));
});

test("deletePlayerAccount rolls back when payment receipts verification still finds a raw player id", async () => {
  const existingAccount = createExistingAccount({
    displayName: "Veil Ranger",
    loginId: "veil-ranger"
  });
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (/FROM `payment_receipts`/.test(sql) && /SELECT COUNT\(\*\) AS total/.test(sql)) {
        return [[{ total: 1 }]];
      }
      if (/SELECT COUNT\(\*\) AS total/.test(sql)) {
        return [[{ total: 0 }]];
      }

      return [{ affectedRows: 1 }];
    },
    async commit() {
      committed = true;
    },
    async rollback() {
      rolledBack = true;
    },
    release() {}
  };

  const store = createStoreHarness();
  store.loadPlayerAccount = async () => existingAccount;
  store.loadPlayerAccountByLoginId = async () => null;
  store.ensurePlayerAccount = async () => existingAccount;
  store.pool = {
    query: async () => {
      throw new Error("pool.query should not be used by deletePlayerAccount");
    },
    getConnection: async () => connection
  };

  await assert.rejects(
    () =>
      store.deletePlayerAccount("player-1", {
        deletedAt: "2026-03-21T00:00:00.000Z"
      }),
    /gdpr_delete_verification_failed:payment_receipts/
  );

  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  const retainedReceiptUpdate = queries.find((entry) => /UPDATE `payment_receipts`/.test(entry.sql));
  assert.ok(retainedReceiptUpdate);
  assert.equal(retainedReceiptUpdate?.params[1], "player-1");
  assert.equal(retainedReceiptUpdate?.params[2], "player-1");
  assert.deepEqual(retainedReceiptUpdate?.params.slice(3), ["settled", "dead_letter"]);
  assert.ok(queries.some((entry) => /SELECT COUNT\(\*\) AS total FROM `payment_receipts`/.test(entry.sql)));
  assert.ok(queries.every((entry) => !/UPDATE `player_accounts`/.test(entry.sql)));
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
