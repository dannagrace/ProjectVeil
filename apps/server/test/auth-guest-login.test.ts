import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import type { ClientMessage, ServerMessage } from "../../../packages/shared/src/index";
import {
  hashAccountPassword,
  issueAccountAuthSession,
  registerAuthRoutes,
  resetGuestAuthSessions,
  type GuestAuthSession
} from "../src/auth";
import { configureRoomSnapshotStore, VeilColyseusRoom } from "../src/colyseus-room";
import { registerPlayerAccountRoutes } from "../src/player-accounts";
import type {
  PlayerAccountProgressPatch,
  PlayerAccountAuthSnapshot,
  PlayerAccountCredentialInput,
  PlayerAccountEnsureInput,
  PlayerEventHistoryQuery,
  PlayerEventHistorySnapshot,
  PlayerAccountListOptions,
  PlayerAccountProfilePatch,
  PlayerAccountSnapshot,
  PlayerHeroArchiveSnapshot,
  RoomSnapshotStore
} from "../src/persistence";
import type { RoomPersistenceSnapshot } from "../src/index";
import { queryEventLogEntries } from "../../../packages/shared/src/index";

class MemoryAuthStore implements RoomSnapshotStore {
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly authByLoginId = new Map<string, PlayerAccountAuthSnapshot>();
  private readonly playerIdByWechatOpenId = new Map<string, string>();

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

  async loadPlayerAccountByWechatMiniGameOpenId(openId: string): Promise<PlayerAccountSnapshot | null> {
    const playerId = this.playerIdByWechatOpenId.get(openId.trim());
    return playerId ? this.accounts.get(playerId) ?? null : null;
  }

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    return playerIds
      .map((playerId) => this.accounts.get(playerId))
      .filter((account): account is PlayerAccountSnapshot => Boolean(account));
  }

  async loadPlayerEventHistory(
    playerId: string,
    query: PlayerEventHistoryQuery = {}
  ): Promise<PlayerEventHistorySnapshot> {
    const account = this.accounts.get(playerId);
    const total = queryEventLogEntries(account?.recentEventLog ?? [], {
      ...query,
      limit: undefined,
      offset: undefined
    }).length;
    return {
      items: queryEventLogEntries(account?.recentEventLog ?? [], query),
      total
    };
  }

  async loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    return this.authByLoginId.get(loginId.trim().toLowerCase()) ?? null;
  }

  async loadPlayerAccountAuthByPlayerId(playerId: string): Promise<PlayerAccountAuthSnapshot | null> {
    return Array.from(this.authByLoginId.values()).find((auth) => auth.playerId === playerId.trim()) ?? null;
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
      ...(existing?.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}),
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      achievements: structuredClone(existing?.achievements ?? []),
      recentEventLog: structuredClone(existing?.recentEventLog ?? []),
      ...(input.lastRoomId?.trim() ? { lastRoomId: input.lastRoomId.trim() } : existing?.lastRoomId ? { lastRoomId: existing.lastRoomId } : {}),
      lastSeenAt: new Date().toISOString(),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
      ...(existing?.wechatMiniGameOpenId ? { wechatMiniGameOpenId: existing.wechatMiniGameOpenId } : {}),
      ...(existing?.wechatMiniGameUnionId ? { wechatMiniGameUnionId: existing.wechatMiniGameUnionId } : {}),
      ...(existing?.wechatMiniGameBoundAt ? { wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt } : {}),
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
      accountSessionVersion: existing.accountSessionVersion ?? 0,
      ...(account.credentialBoundAt ? { credentialBoundAt: account.credentialBoundAt } : {})
    });
    return account;
  }

  async savePlayerAccountAuthSession(
    playerId: string,
    input: { refreshSessionId: string; refreshTokenHash: string; refreshTokenExpiresAt: string }
  ): Promise<PlayerAccountAuthSnapshot | null> {
    const auth = await this.loadPlayerAccountAuthByPlayerId(playerId);
    if (!auth) {
      return null;
    }

    const nextAuth: PlayerAccountAuthSnapshot = {
      ...auth,
      accountSessionVersion: auth.accountSessionVersion + 1,
      refreshSessionId: input.refreshSessionId,
      refreshTokenHash: input.refreshTokenHash,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt
    };
    this.authByLoginId.set(auth.loginId, nextAuth);
    return nextAuth;
  }

  async revokePlayerAccountAuthSessions(
    playerId: string,
    input: { passwordHash?: string; credentialBoundAt?: string } = {}
  ): Promise<PlayerAccountAuthSnapshot | null> {
    const auth = await this.loadPlayerAccountAuthByPlayerId(playerId);
    if (!auth) {
      return null;
    }

    const nextAuth: PlayerAccountAuthSnapshot = {
      ...auth,
      ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
      ...(input.credentialBoundAt ? { credentialBoundAt: input.credentialBoundAt } : {}),
      accountSessionVersion: auth.accountSessionVersion + 1
    };
    delete nextAuth.refreshSessionId;
    delete nextAuth.refreshTokenHash;
    delete nextAuth.refreshTokenExpiresAt;
    this.authByLoginId.set(auth.loginId, nextAuth);
    return nextAuth;
  }

  async bindPlayerAccountWechatMiniGameIdentity(
    playerId: string,
    input: { openId: string; unionId?: string; displayName?: string; avatarUrl?: string | null }
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({
      playerId,
      ...(input.displayName?.trim() ? { displayName: input.displayName } : {})
    });
    const normalizedOpenId = input.openId.trim();
    const owner = await this.loadPlayerAccountByWechatMiniGameOpenId(normalizedOpenId);
    if (owner && owner.playerId !== existing.playerId) {
      throw new Error("wechatMiniGameOpenId is already taken");
    }

    const account: PlayerAccountSnapshot = {
      ...existing,
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      ...(input.avatarUrl?.trim() ? { avatarUrl: input.avatarUrl.trim() } : existing.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}),
      wechatMiniGameOpenId: normalizedOpenId,
      ...(input.unionId?.trim() ? { wechatMiniGameUnionId: input.unionId.trim() } : existing.wechatMiniGameUnionId ? { wechatMiniGameUnionId: existing.wechatMiniGameUnionId } : {}),
      wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(existing.playerId, account);
    this.playerIdByWechatOpenId.set(normalizedOpenId, existing.playerId);
    return account;
  }

  async savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      displayName: patch.displayName?.trim() || existing.displayName,
      ...(patch.avatarUrl !== undefined
        ? patch.avatarUrl?.trim()
          ? { avatarUrl: patch.avatarUrl.trim() }
          : {}
        : existing.avatarUrl
          ? { avatarUrl: existing.avatarUrl }
          : {}),
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
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
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

function withEnvOverrides(
  overrides: Record<string, string | undefined>,
  cleanup: Array<() => void>
): void {
  const previousValues = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]])
  ) as Record<string, string | undefined>;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  cleanup.push(() => {
    for (const [key, value] of Object.entries(previousValues)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  assert.equal(payload.session.provider, "guest");
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
  assert.equal(sessionPayload.session.provider, "guest");
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
  assert.equal(bindPayload.session.provider, "account-password");
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
  assert.equal(accountLoginPayload.session.provider, "account-password");
  assert.equal(accountLoginPayload.session.loginId, "veil-ranger");

  const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${accountLoginPayload.session.token}`
    }
  });
  const sessionPayload = (await sessionResponse.json()) as { session: GuestAuthSession };

  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionPayload.session.authMode, "account");
  assert.equal(sessionPayload.session.provider, "account-password");
  assert.equal(sessionPayload.session.loginId, "veil-ranger");
});

test("account access tokens expire with token_expired and can be rotated through refresh", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_AUTH_ACCESS_TTL_SECONDS: "1",
      VEIL_AUTH_REFRESH_TTL_SECONDS: "30"
    },
    cleanup
  );

  const port = 44540 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  await store.bindPlayerAccountCredentials("expiry-player", {
    loginId: "expiry-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "expiry-ranger",
      password: "hunter2"
    })
  });
  const loginPayload = (await loginResponse.json()) as {
    session: GuestAuthSession;
  };

  assert.equal(loginResponse.status, 200);
  assert.equal(typeof loginPayload.session.refreshToken, "string");

  await sleep(1_100);

  const expiredResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${loginPayload.session.token}`
    }
  });
  const expiredPayload = (await expiredResponse.json()) as { error: { code: string } };

  assert.equal(expiredResponse.status, 401);
  assert.equal(expiredPayload.error.code, "token_expired");

  const refreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginPayload.session.refreshToken}`
    }
  });
  const refreshPayload = (await refreshResponse.json()) as { session: GuestAuthSession };

  assert.equal(refreshResponse.status, 200);
  assert.notEqual(refreshPayload.session.token, loginPayload.session.token);
  assert.notEqual(refreshPayload.session.refreshToken, loginPayload.session.refreshToken);
});

test("refresh rotation invalidates the previous refresh token and logout revokes the active one", async (t) => {
  const port = 44580 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  await store.bindPlayerAccountCredentials("rotate-player", {
    loginId: "rotate-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "rotate-ranger",
      password: "hunter2"
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };

  const rotatedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginPayload.session.refreshToken}`
    }
  });
  const rotatedPayload = (await rotatedResponse.json()) as { session: GuestAuthSession };

  assert.equal(rotatedResponse.status, 200);

  const staleRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginPayload.session.refreshToken}`
    }
  });
  const staleRefreshPayload = (await staleRefreshResponse.json()) as { error: { code: string } };

  assert.equal(staleRefreshResponse.status, 401);
  assert.equal(staleRefreshPayload.error.code, "session_revoked");

  const logoutResponse = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${rotatedPayload.session.token}`
    }
  });
  assert.equal(logoutResponse.status, 200);

  const revokedRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${rotatedPayload.session.refreshToken}`
    }
  });
  const revokedRefreshPayload = (await revokedRefreshResponse.json()) as { error: { code: string } };

  assert.equal(revokedRefreshResponse.status, 401);
  assert.equal(revokedRefreshPayload.error.code, "session_revoked");
});

test("password changes revoke the current account session family", async (t) => {
  const port = 44610 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  await store.bindPlayerAccountCredentials("password-player", {
    loginId: "password-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "password-ranger",
      password: "hunter2"
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };

  const passwordChangeResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginPayload.session.token}`
    },
    body: JSON.stringify({
      currentPassword: "hunter2",
      newPassword: "hunter3"
    })
  });

  assert.equal(passwordChangeResponse.status, 200);

  const revokedAccessResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${loginPayload.session.token}`
    }
  });
  const revokedAccessPayload = (await revokedAccessResponse.json()) as { error: { code: string } };

  assert.equal(revokedAccessResponse.status, 401);
  assert.equal(revokedAccessPayload.error.code, "session_revoked");

  const revokedRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginPayload.session.refreshToken}`
    }
  });
  const revokedRefreshPayload = (await revokedRefreshResponse.json()) as { error: { code: string } };

  assert.equal(revokedRefreshResponse.status, 401);
  assert.equal(revokedRefreshPayload.error.code, "session_revoked");
});

test("guest auth route returns 429 after the per-IP rate limit is exceeded", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_RATE_LIMIT_AUTH_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_AUTH_MAX: "2"
    },
    cleanup
  );

  const port = 44625 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        playerId: `guest-rate-limit-${index}`
      })
    });
    assert.equal(response.status, 200);
  }

  const limitedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "guest-rate-limit-3"
    })
  });
  const limitedPayload = (await limitedResponse.json()) as { error: { code: string } };

  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedPayload.error.code, "rate_limited");
  assert.equal(limitedResponse.headers.get("Retry-After"), "60");
});

test("account login locks after repeated invalid credentials and returns lockedUntil", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_AUTH_LOCKOUT_THRESHOLD: "2",
      VEIL_AUTH_LOCKOUT_DURATION_MINUTES: "15"
    },
    cleanup
  );

  const port = 44650 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "lockout-player",
    displayName: "锁定骑士"
  });
  await store.bindPlayerAccountCredentials("lockout-player", {
    loginId: "lockout-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: "lockout-ranger",
        password: "wrong-password"
      })
    });

    if (index === 0) {
      const payload = (await response.json()) as { error: { code: string } };
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "invalid_credentials");
      continue;
    }

    const payload = (await response.json()) as { error: { code: string; lockedUntil?: string } };
    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "account_locked");
    assert.ok(payload.error.lockedUntil);
  }

  const lockedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "lockout-ranger",
      password: "hunter2"
    })
  });
  const lockedPayload = (await lockedResponse.json()) as { error: { code: string; lockedUntil?: string } };

  assert.equal(lockedResponse.status, 403);
  assert.equal(lockedPayload.error.code, "account_locked");
  assert.ok(lockedPayload.error.lockedUntil);
});

test("account login lockout expires after the configured duration", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_AUTH_LOCKOUT_THRESHOLD: "2",
      VEIL_AUTH_LOCKOUT_DURATION_MINUTES: "0.002"
    },
    cleanup
  );

  const port = 44675 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "lockout-expiry-player",
    displayName: "解锁骑士"
  });
  await store.bindPlayerAccountCredentials("lockout-expiry-player", {
    loginId: "expiry-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let index = 0; index < 2; index += 1) {
    await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: "expiry-ranger",
        password: "wrong-password"
      })
    });
  }

  await sleep(180);

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "expiry-ranger",
      password: "hunter2"
    })
  });
  const payload = (await response.json()) as {
    account: PlayerAccountSnapshot;
    session: GuestAuthSession;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.account.playerId, "lockout-expiry-player");
  assert.equal(payload.session.loginId, "expiry-ranger");
});

test("guest auth session LRU eviction invalidates the oldest idle guest token", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_MAX_GUEST_SESSIONS: "2"
    },
    cleanup
  );

  const port = 44700 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const sessions: GuestAuthSession[] = [];
  for (const playerId of ["guest-lru-1", "guest-lru-2", "guest-lru-3"]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ playerId })
    });
    const payload = (await response.json()) as { session: GuestAuthSession };
    assert.equal(response.status, 200);
    sessions.push(payload.session);
  }

  const evictedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${sessions[0].token}`
    }
  });
  const activeResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${sessions[2].token}`
    }
  });
  const activePayload = (await activeResponse.json()) as { session: GuestAuthSession };

  assert.equal(evictedResponse.status, 401);
  assert.equal(activeResponse.status, 200);
  assert.equal(activePayload.session.playerId, "guest-lru-3");
});

test("wechat mini game scaffold route returns 501 until mock mode is enabled", { concurrency: false }, async (t) => {
  const port = 44750 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);

  t.after(async () => {
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/wechat-mini-game-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-dev-code",
      playerId: "wechat-player",
      displayName: "云桥旅人"
    })
  });
  const payload = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 501);
  assert.equal(payload.error.code, "wechat_login_not_enabled");
});

test("wechat mini game scaffold route issues a provider-tagged session in mock mode", { concurrency: false }, async (t) => {
  const port = 44850 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port, new MemoryAuthStore());

  t.after(async () => {
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "mock";
  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE = "wx-dev-code";
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/wechat-mini-game-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-dev-code",
      playerId: "wechat-player",
      displayName: "云桥旅人"
    })
  });
  const payload = (await response.json()) as { session: GuestAuthSession };

  assert.equal(response.status, 200);
  assert.equal(payload.session.playerId, "wechat-player");
  assert.equal(payload.session.provider, "wechat-mini-game");
  assert.equal(payload.session.authMode, "guest");
});

test("wechat mini game production exchange binds code2Session identity onto an authenticated account", { concurrency: false }, async (t) => {
  const port = 44950 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedAccept = "";

  await store.ensurePlayerAccount({
    playerId: "account-player",
    displayName: "暮潮守望"
  });
  await store.bindPlayerAccountCredentials("account-player", {
    loginId: "veil-ranger",
    passwordHash: "hashed-password"
  });

  const accountSession = issueAccountAuthSession({
    playerId: "account-player",
    displayName: "暮潮守望",
    loginId: "veil-ranger"
  });

  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.VEIL_WECHAT_MINIGAME_APP_ID;
    delete process.env.VEIL_WECHAT_MINIGAME_APP_SECRET;
    delete process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "production";
  process.env.VEIL_WECHAT_MINIGAME_APP_ID = "wx-prod-app";
  process.env.VEIL_WECHAT_MINIGAME_APP_SECRET = "wx-prod-secret";
  process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL = "https://wechat.example.test/code2session";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedAccept = new Headers(init?.headers).get("Accept") ?? "";
    return new Response(
      JSON.stringify({
        openid: "wx-openid-prod",
        unionid: "wx-union-prod",
        session_key: "session-key"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  };

  const response = await originalFetch(`http://127.0.0.1:${port}/api/auth/wechat-mini-game-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accountSession.token}`
    },
    body: JSON.stringify({
      code: "wx-prod-code",
      displayName: "微信暮潮守望",
      avatarUrl: " https://cdn.example.com/avatar.png "
    })
  });
  const payload = (await response.json()) as { session: GuestAuthSession };

  assert.equal(response.status, 200);
  assert.equal(payload.session.playerId, "account-player");
  assert.equal(payload.session.displayName, "微信暮潮守望");
  assert.equal(payload.session.provider, "wechat-mini-game");
  assert.equal(payload.session.authMode, "account");
  assert.equal(payload.session.loginId, "veil-ranger");

  const requestUrl = new URL(requestedUrl);
  assert.equal(requestUrl.origin + requestUrl.pathname, "https://wechat.example.test/code2session");
  assert.equal(requestUrl.searchParams.get("appid"), "wx-prod-app");
  assert.equal(requestUrl.searchParams.get("secret"), "wx-prod-secret");
  assert.equal(requestUrl.searchParams.get("js_code"), "wx-prod-code");
  assert.equal(requestUrl.searchParams.get("grant_type"), "authorization_code");
  assert.equal(requestedAccept, "application/json");

  const storedAccount = await store.loadPlayerAccount("account-player");
  assert.equal(storedAccount?.displayName, "微信暮潮守望");
  assert.equal(storedAccount?.avatarUrl, "https://cdn.example.com/avatar.png");
  assert.equal(storedAccount?.wechatMiniGameOpenId, "wx-openid-prod");
  assert.equal(storedAccount?.wechatMiniGameUnionId, "wx-union-prod");
  assert.equal(storedAccount?.loginId, "veil-ranger");
});

test("wechat mini game login reuses the bound player even when later requests spoof another playerId", { concurrency: false }, async (t) => {
  const port = 45050 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);
  const originalFetch = globalThis.fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.VEIL_WECHAT_MINIGAME_APP_ID;
    delete process.env.VEIL_WECHAT_MINIGAME_APP_SECRET;
    delete process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "production";
  process.env.VEIL_WECHAT_MINIGAME_APP_ID = "wx-prod-app";
  process.env.VEIL_WECHAT_MINIGAME_APP_SECRET = "wx-prod-secret";
  process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL = "https://wechat.example.test/code2session";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        openid: "wx-openid-repeat",
        session_key: "session-key"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  const firstResponse = await originalFetch(`http://127.0.0.1:${port}/api/auth/wechat-mini-game-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-prod-code",
      playerId: "wechat-player",
      displayName: "初次旅人"
    })
  });
  const firstPayload = (await firstResponse.json()) as { session: GuestAuthSession };

  const secondResponse = await originalFetch(`http://127.0.0.1:${port}/api/auth/wechat-mini-game-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-prod-code",
      playerId: "spoofed-player",
      displayName: "回归旅人"
    })
  });
  const secondPayload = (await secondResponse.json()) as { session: GuestAuthSession };

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(firstPayload.session.playerId, "wechat-player");
  assert.equal(secondPayload.session.playerId, "wechat-player");
  assert.equal(secondPayload.session.displayName, "回归旅人");
  assert.equal(secondPayload.session.provider, "wechat-mini-game");

  const boundAccount = await store.loadPlayerAccount("wechat-player");
  const spoofedAccount = await store.loadPlayerAccount("spoofed-player");
  assert.equal(boundAccount?.wechatMiniGameOpenId, "wx-openid-repeat");
  assert.equal(boundAccount?.displayName, "回归旅人");
  assert.equal(spoofedAccount, null);
});
