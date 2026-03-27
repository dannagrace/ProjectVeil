import assert from "node:assert/strict";
import test from "node:test";
import { MySqlRoomSnapshotStore, type PlayerAccountSnapshot } from "../src/persistence";

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
