import assert from "node:assert/strict";
import test from "node:test";
import { MySqlRoomSnapshotStore, type PlayerAccountSnapshot } from "../src/persistence";

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

test("deletePlayerAccount removes GDPR-linked name history, guild chat, and referral rows", async () => {
  const existingAccount = createExistingAccount({
    displayName: "Veil Ranger",
    loginId: "veil-ranger",
    privacyConsentAt: "2026-03-20T01:00:00.000Z",
    eloRating: 1660,
    rankDivision: "platinum_i",
    peakRankDivision: "diamond_v"
  });
  const deletedAccount = createExistingAccount({
    displayName: "deleted-player-1",
    eloRating: undefined,
    rankDivision: undefined,
    peakRankDivision: undefined,
    loginId: undefined,
    privacyConsentAt: undefined,
    leaderboardModerationState: {
      hiddenAt: "2026-03-21T00:00:00.000Z",
      hiddenByPlayerId: "system:gdpr-delete"
    }
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
  assert.equal(account?.leaderboardModerationState?.hiddenByPlayerId, "system:gdpr-delete");
  assert.equal(committed, true);
  assert.equal(rolledBack, false);
  assert.ok(queries.some((entry) => /DELETE FROM `player_name_history`/.test(entry.sql)));
  assert.ok(queries.some((entry) => /DELETE FROM `guild_messages`\s+WHERE author_player_id = \?/.test(entry.sql)));
  assert.ok(queries.some((entry) => /DELETE FROM `referrals`\s+WHERE referrer_id = \? OR new_player_id = \?/.test(entry.sql)));
  assert.ok(
    queries.some((entry) => /SELECT COUNT\(\*\) AS total FROM `player_name_history` WHERE player_id = \?/.test(entry.sql))
  );
  assert.ok(
    queries.some((entry) => /SELECT COUNT\(\*\) AS total FROM `guild_messages` WHERE author_player_id = \?/.test(entry.sql))
  );
  assert.ok(
    queries.some(
      (entry) => /SELECT COUNT\(\*\) AS total FROM `referrals` WHERE referrer_id = \? OR new_player_id = \?/.test(entry.sql)
    )
  );
  assert.equal(queries.filter((entry) => /SELECT COUNT\(\*\) AS total/.test(entry.sql)).length, 14);
});

test("deletePlayerAccount rolls back when guild chat rows remain after author cleanup", async () => {
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
      if (/FROM `guild_messages`/.test(sql) && /SELECT COUNT\(\*\) AS total/.test(sql)) {
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
    /gdpr_delete_verification_failed:guild_messages/
  );

  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.ok(queries.some((entry) => /DELETE FROM `guild_messages`\s+WHERE author_player_id = \?/.test(entry.sql)));
  assert.ok(
    queries.some((entry) => /SELECT COUNT\(\*\) AS total FROM `guild_messages` WHERE author_player_id = \?/.test(entry.sql))
  );
  assert.ok(queries.every((entry) => !/UPDATE `player_accounts`/.test(entry.sql)));
});
