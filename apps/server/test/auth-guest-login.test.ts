import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import type { ClientMessage, ServerMessage } from "../../../packages/shared/src/index";
import { registerAuthRoutes, resetGuestAuthSessions, type GuestAuthSession } from "../src/auth";
import { configureRoomSnapshotStore, VeilColyseusRoom } from "../src/colyseus-room";
import type {
  PlayerAccountProgressPatch,
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

class MemoryAuthStore implements RoomSnapshotStore {
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
    return Array.from(this.accounts.values()).find((account) => account.loginId === normalizedLoginId) ?? null;
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
    const playerId = input.playerId.trim();
    const existing = this.accounts.get(playerId);
    const account: PlayerAccountSnapshot = {
      playerId,
      displayName: input.displayName?.trim() || existing?.displayName || playerId,
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      achievements: structuredClone(existing?.achievements ?? []),
      recentEventLog: structuredClone(existing?.recentEventLog ?? []),
      ...(input.lastRoomId?.trim() ? { lastRoomId: input.lastRoomId.trim() } : existing?.lastRoomId ? { lastRoomId: existing.lastRoomId } : {}),
      lastSeenAt: new Date().toISOString(),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
      ...(existing?.credentialBoundAt ? { credentialBoundAt: existing.credentialBoundAt } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId, account);
    return account;
  }

  async bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const normalizedLoginId = input.loginId.trim().toLowerCase();
    const owner = await this.loadPlayerAccountByLoginId(normalizedLoginId);
    if (owner && owner.playerId !== existing.playerId) {
      throw new Error("loginId is already taken");
    }

    const account: PlayerAccountSnapshot = {
      ...existing,
      loginId: normalizedLoginId,
      credentialBoundAt: existing.credentialBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(existing.playerId, account);
    this.authByLoginId.set(normalizedLoginId, {
      playerId: existing.playerId,
      displayName: account.displayName,
      loginId: normalizedLoginId,
      passwordHash: input.passwordHash,
      ...(account.credentialBoundAt ? { credentialBoundAt: account.credentialBoundAt } : {})
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
    this.accounts.set(account.playerId, account);
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

  async savePlayerAccountProgress(playerId: string, patch: PlayerAccountProgressPatch): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      achievements: structuredClone((patch.achievements as PlayerAccountSnapshot["achievements"] | undefined) ?? existing.achievements),
      recentEventLog: structuredClone((patch.recentEventLog as PlayerAccountSnapshot["recentEventLog"] | undefined) ?? existing.recentEventLog),
      ...(patch.lastRoomId !== undefined
        ? patch.lastRoomId?.trim()
          ? { lastRoomId: patch.lastRoomId.trim() }
          : {}
        : existing.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {}),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(account.playerId, account);
    return account;
  }

  async listPlayerAccounts(_options: PlayerAccountListOptions = {}): Promise<PlayerAccountSnapshot[]> {
    return Array.from(this.accounts.values());
  }

  async save(_roomId: string, _snapshot: RoomPersistenceSnapshot): Promise<void> {}

  async delete(_roomId: string): Promise<void> {}

  async pruneExpired(): Promise<number> {
    return 0;
  }

  async close(): Promise<void> {}
}

async function startAuthServer(port: number, store: RoomSnapshotStore | null = null): Promise<Server> {
  configureRoomSnapshotStore(store);
  resetGuestAuthSessions();
  const transport = new WebSocketTransport();
  registerAuthRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

async function joinRoom(port: number, logicalRoomId: string, playerId: string): Promise<ColyseusRoom> {
  const client = new Client(`http://127.0.0.1:${port}`);
  return client.joinOrCreate("veil", {
    logicalRoomId,
    playerId,
    seed: 1001
  });
}

async function sendRequest<T extends ServerMessage["type"]>(
  room: ColyseusRoom,
  message: ClientMessage,
  expectedType: T
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, 5_000);

    const unsubscribe = room.onMessage("*", (type, payload) => {
      if (typeof type !== "string") {
        return;
      }

      const response = { type, ...(payload as object) } as ServerMessage;
      if ("requestId" in response && response.requestId !== message.requestId) {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();

      if (response.type === "error") {
        reject(new Error(response.reason));
        return;
      }

      if (response.type !== expectedType) {
        reject(new Error(`Unexpected response type: ${response.type}`));
        return;
      }

      resolve(response as Extract<ServerMessage, { type: T }>);
    });

    room.send(message.type, message);
  });
}

test("guest auth route issues a signed session token", async (t) => {
  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "player-auth",
      displayName: "访客骑士"
    })
  });
  const payload = (await response.json()) as { session: GuestAuthSession };

  assert.equal(response.status, 200);
  assert.equal(payload.session.playerId, "player-auth");
  assert.equal(payload.session.displayName, "访客骑士");
  assert.match(payload.session.token, /\./);
});

test("auth session route resolves a bearer token into the current guest session", async (t) => {
  const port = 43500 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);
  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "player-session",
      displayName: "回声旅人"
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${loginPayload.session.token}`
    }
  });
  const sessionPayload = (await sessionResponse.json()) as { session: GuestAuthSession };

  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionPayload.session.playerId, "player-session");
  assert.equal(sessionPayload.session.displayName, "回声旅人");
  assert.match(sessionPayload.session.token, /\./);
});

test("connect message prefers auth token identity over a spoofed playerId", async (t) => {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);
  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "trusted-player",
      displayName: "真正的访客"
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };
  const room = await joinRoom(port, "auth-room", "spoofed-player");

  t.after(async () => {
    await room.leave(true).catch(() => undefined);
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await sendRequest(
    room,
    {
      type: "connect",
      requestId: "auth-connect",
      roomId: "auth-room",
      playerId: "spoofed-player",
      authToken: loginPayload.session.token
    },
    "session.state"
  );

  assert.equal(response.payload.world.playerId, "trusted-player");
});

test("account bind upgrades a guest session into password login and account-login restores it", async (t) => {
  const port = 44500 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const guestLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "account-player",
      displayName: "暮潮守望"
    })
  });
  const guestLoginPayload = (await guestLoginResponse.json()) as { session: GuestAuthSession };

  const bindResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-bind`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${guestLoginPayload.session.token}`
    },
    body: JSON.stringify({
      loginId: "veil-ranger",
      password: "hunter2"
    })
  });
  const bindPayload = (await bindResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: GuestAuthSession;
  };

  assert.equal(bindResponse.status, 200);
  assert.equal(bindPayload.account.loginId, "veil-ranger");
  assert.equal(bindPayload.session.authMode, "account");
  assert.equal(bindPayload.session.loginId, "veil-ranger");

  const accountLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "veil-ranger",
      password: "hunter2"
    })
  });
  const accountLoginPayload = (await accountLoginResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: GuestAuthSession;
  };

  assert.equal(accountLoginResponse.status, 200);
  assert.equal(accountLoginPayload.account.playerId, "account-player");
  assert.equal(accountLoginPayload.session.authMode, "account");
  assert.equal(accountLoginPayload.session.loginId, "veil-ranger");

  const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${accountLoginPayload.session.token}`
    }
  });
  const sessionPayload = (await sessionResponse.json()) as { session: GuestAuthSession };

  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionPayload.session.authMode, "account");
  assert.equal(sessionPayload.session.loginId, "veil-ranger");
});
