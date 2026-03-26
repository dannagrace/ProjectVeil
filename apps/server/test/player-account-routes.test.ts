import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { issueAccountAuthSession, issueGuestAuthSession } from "../src/auth";
import { registerPlayerAccountRoutes } from "../src/player-accounts";
import type {
  PlayerAccountAuthSnapshot,
  PlayerAccountCredentialInput,
  PlayerAccountEnsureInput,
  PlayerAccountListOptions,
  PlayerAccountProfilePatch,
  PlayerAccountSnapshot,
  PlayerHeroArchiveSnapshot,
  RoomSnapshotStore
} from "../src/persistence";
import type { RoomPersistenceSnapshot } from "../src/index";

class MemoryPlayerAccountStore implements RoomSnapshotStore {
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly authByLoginId = new Map<string, PlayerAccountAuthSnapshot>();

  async load(_roomId: string): Promise<RoomPersistenceSnapshot | null> {
    return null;
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    return this.accounts.get(playerId) ?? null;
  }

  async loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedLoginId = loginId.trim().toLowerCase();
    return (
      Array.from(this.accounts.values()).find((account) => account.loginId === normalizedLoginId) ?? null
    );
  }

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    return playerIds
      .map((playerId) => this.accounts.get(playerId))
      .filter((account): account is PlayerAccountSnapshot => Boolean(account));
  }

  async loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    return this.authByLoginId.get(loginId.trim().toLowerCase()) ?? null;
  }

  async loadPlayerHeroArchives(_playerIds: string[]): Promise<PlayerHeroArchiveSnapshot[]> {
    return [];
  }

  async ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot> {
    const existing = this.accounts.get(input.playerId);
    const account: PlayerAccountSnapshot = {
      playerId: input.playerId,
      displayName: input.displayName?.trim() || existing?.displayName || input.playerId,
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      ...(input.lastRoomId?.trim() ? { lastRoomId: input.lastRoomId.trim() } : existing?.lastRoomId ? { lastRoomId: existing.lastRoomId } : {}),
      lastSeenAt: new Date().toISOString(),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
      ...(existing?.credentialBoundAt ? { credentialBoundAt: existing.credentialBoundAt } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(account.playerId, account);
    return account;
  }

  async bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const normalizedLoginId = input.loginId.trim().toLowerCase();
    const owner = await this.loadPlayerAccountByLoginId(normalizedLoginId);
    if (owner && owner.playerId !== playerId) {
      throw new Error("loginId is already taken");
    }

    const credentialBoundAt = existing.credentialBoundAt ?? new Date().toISOString();
    const account: PlayerAccountSnapshot = {
      ...existing,
      loginId: normalizedLoginId,
      credentialBoundAt,
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId, account);
    this.authByLoginId.set(normalizedLoginId, {
      playerId,
      displayName: account.displayName,
      loginId: normalizedLoginId,
      passwordHash: input.passwordHash,
      credentialBoundAt
    });
    return account;
  }

  async savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      displayName: patch.displayName?.trim() || existing.displayName,
      ...(patch.lastRoomId !== undefined
        ? patch.lastRoomId?.trim()
          ? { lastRoomId: patch.lastRoomId.trim() }
          : {}
        : existing.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {}),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId, account);
    if (account.loginId) {
      const auth = this.authByLoginId.get(account.loginId);
      if (auth) {
        this.authByLoginId.set(account.loginId, {
          ...auth,
          displayName: account.displayName
        });
      }
    }
    return account;
  }

  async listPlayerAccounts(options: PlayerAccountListOptions = {}): Promise<PlayerAccountSnapshot[]> {
    const accounts = Array.from(this.accounts.values()).filter((account) =>
      options.playerId ? account.playerId === options.playerId : true
    );
    return accounts.slice(0, Math.max(1, Math.floor(options.limit ?? 20)));
  }

  async save(_roomId: string, _snapshot: RoomPersistenceSnapshot): Promise<void> {}

  async delete(_roomId: string): Promise<void> {}

  async pruneExpired(): Promise<number> {
    return 0;
  }

  async close(): Promise<void> {}

  seedAccount(account: PlayerAccountSnapshot): void {
    this.accounts.set(account.playerId, account);
  }
}

async function startAccountRouteServer(port: number, store: RoomSnapshotStore | null): Promise<Server> {
  const transport = new WebSocketTransport();
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

test("player account routes list and fetch stored accounts", async (t) => {
  const port = 40000 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-1",
    displayName: "灰烬领主",
    globalResources: { gold: 320, wood: 5, ore: 1 },
    lastRoomId: "room-alpha",
    lastSeenAt: new Date("2026-03-25T09:00:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const listResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts`);
  const listPayload = (await listResponse.json()) as { items: PlayerAccountSnapshot[] };
  assert.equal(listResponse.status, 200);
  assert.equal(listPayload.items[0]?.displayName, "灰烬领主");

  const detailResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-1`);
  const detailPayload = (await detailResponse.json()) as { account: PlayerAccountSnapshot };
  assert.equal(detailResponse.status, 200);
  assert.equal(detailPayload.account.playerId, "player-1");
  assert.equal(detailPayload.account.lastRoomId, "room-alpha");
});

test("player account routes update display names through the account store", async (t) => {
  const port = 41000 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  const server = await startAccountRouteServer(port, store);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const updateResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-2`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      displayName: "北境执旗官",
      lastRoomId: "room-bravo"
    })
  });
  const updatePayload = (await updateResponse.json()) as { account: PlayerAccountSnapshot };

  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.account.displayName, "北境执旗官");
  assert.equal(updatePayload.account.lastRoomId, "room-bravo");

  const stored = await store.loadPlayerAccount("player-2");
  assert.equal(stored?.displayName, "北境执旗官");
  assert.equal(stored?.lastRoomId, "room-bravo");
});

test("player account me routes resolve and update the current authenticated account", async (t) => {
  const port = 42000 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-me",
    displayName: "苍穹侦骑",
    globalResources: { gold: 12, wood: 3, ore: 4 },
    lastRoomId: "room-old",
    lastSeenAt: new Date("2026-03-25T11:00:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-me",
    displayName: "苍穹侦骑"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: { token: string; playerId: string; displayName: string };
  };

  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.account.playerId, "player-me");
  assert.equal(mePayload.account.displayName, "苍穹侦骑");
  assert.equal(mePayload.session.playerId, "player-me");

  const updateResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      displayName: "风暴司灯人",
      lastRoomId: "room-next"
    })
  });
  const updatePayload = (await updateResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: { token: string; playerId: string; displayName: string };
  };

  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.account.displayName, "风暴司灯人");
  assert.equal(updatePayload.account.lastRoomId, "room-next");
  assert.equal(updatePayload.session.displayName, "风暴司灯人");

  const stored = await store.loadPlayerAccount("player-me");
  assert.equal(stored?.displayName, "风暴司灯人");
  assert.equal(stored?.lastRoomId, "room-next");
});

test("player account me route preserves account-mode sessions and returns the global vault", async (t) => {
  const port = 42100 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "account-player",
    displayName: "暮潮守望",
    globalResources: { gold: 320, wood: 5, ore: 2 },
    loginId: "veil-ranger",
    credentialBoundAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
    lastRoomId: "room-vault",
    lastSeenAt: new Date("2026-03-25T12:30:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueAccountAuthSession({
    playerId: "account-player",
    displayName: "暮潮守望",
    loginId: "veil-ranger"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: {
      token: string;
      playerId: string;
      displayName: string;
      authMode: "guest" | "account";
      loginId?: string;
    };
  };

  assert.equal(meResponse.status, 200);
  assert.deepEqual(mePayload.account.globalResources, {
    gold: 320,
    wood: 5,
    ore: 2
  });
  assert.equal(mePayload.session.authMode, "account");
  assert.equal(mePayload.session.loginId, "veil-ranger");
});
