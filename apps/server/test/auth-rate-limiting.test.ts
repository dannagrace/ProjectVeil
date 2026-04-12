import assert from "node:assert/strict";
import test from "node:test";
import { hashAccountPassword, resetGuestAuthSessions, type GuestAuthSession } from "../src/auth";
import { startDevServer, type DevServerRuntimeHandle } from "../src/dev-server";
import type {
  PlayerAccountAuthSessionInput,
  PlayerAccountAuthSnapshot,
  PlayerAccountCredentialInput,
  PlayerAccountEnsureInput,
  PlayerAccountProgressPatch,
  PlayerAccountSnapshot,
  PlayerAccountDeviceSessionSnapshot,
  PlayerEventHistorySnapshot
} from "../src/persistence";

type TestMiddleware = (
  request: AsyncIterable<Buffer> & {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    socket: { remoteAddress: string };
  },
  response: TestResponse,
  next: () => void
) => void | Promise<void>;

type TestRouteHandler = (
  request: AsyncIterable<Buffer> & {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    socket: { remoteAddress: string };
  },
  response: TestResponse
) => void | Promise<void>;

interface TestHttpApp {
  middleware: TestMiddleware[];
  getRoutes: Array<{ path: string; handler: TestRouteHandler }>;
  postRoutes: Array<{ path: string; handler: TestRouteHandler }>;
  putRoutes: Array<{ path: string; handler: TestRouteHandler }>;
  deleteRoutes: Array<{ path: string; handler: TestRouteHandler }>;
  patchRoutes: Array<{ path: string; handler: TestRouteHandler }>;
  optionsRoutes: Array<{ path: string; handler: TestRouteHandler }>;
  headRoutes: Array<{ path: string; handler: TestRouteHandler }>;
  use(handler: TestMiddleware): void;
  get(path: string, handler: TestRouteHandler): void;
  post(path: string, handler: TestRouteHandler): void;
  put(path: string, handler: TestRouteHandler): void;
  delete(path: string, handler: TestRouteHandler): void;
  patch(path: string, handler: TestRouteHandler): void;
  options(path: string, handler: TestRouteHandler): void;
  head(path: string, handler: TestRouteHandler): void;
}

class TestResponse {
  statusCode = 200;
  headersSent = false;
  private readonly headers = new Map<string, string>();
  private readonly finishListeners: Array<() => void> = [];
  private readonly closeListeners: Array<() => void> = [];
  body = "";
  finished = false;

  once(event: "finish" | "close", listener: () => void): this {
    if (event === "finish") {
      this.finishListeners.push(listener);
    } else {
      this.closeListeners.push(listener);
    }
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  end(chunk?: string | Buffer): void {
    if (chunk) {
      this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    }
    this.headersSent = true;
    this.finished = true;
    for (const listener of this.finishListeners) {
      listener();
    }
    for (const listener of this.closeListeners) {
      listener();
    }
  }
}

class MemoryAuthRateLimitStore {
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly authByLoginId = new Map<string, PlayerAccountAuthSnapshot>();
  private readonly authSessionsByPlayerId = new Map<string, Map<string, PlayerAccountDeviceSessionSnapshot>>();

  async close(): Promise<void> {}

  async load(_roomId: string): Promise<null> {
    return null;
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    return this.accounts.get(playerId.trim()) ?? null;
  }

  async loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedLoginId = loginId.trim().toLowerCase();
    return Array.from(this.accounts.values()).find((account) => account.loginId === normalizedLoginId) ?? null;
  }

  async loadPlayerAccountByWechatMiniGameOpenId(): Promise<PlayerAccountSnapshot | null> {
    return null;
  }

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    return playerIds
      .map((playerId) => this.accounts.get(playerId.trim()))
      .filter((account): account is PlayerAccountSnapshot => Boolean(account));
  }

  async loadPlayerEventHistory(): Promise<PlayerEventHistorySnapshot> {
    return {
      items: [],
      total: 0
    };
  }

  async loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    return this.authByLoginId.get(loginId.trim().toLowerCase()) ?? null;
  }

  async loadPlayerAccountAuthByPlayerId(playerId: string): Promise<PlayerAccountAuthSnapshot | null> {
    return Array.from(this.authByLoginId.values()).find((auth) => auth.playerId === playerId.trim()) ?? null;
  }

  async loadPlayerHeroArchives(): Promise<[]> {
    return [];
  }

  async ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot> {
    const playerId = input.playerId.trim();
    const existing = this.accounts.get(playerId);
    const timestamp = new Date().toISOString();
    const account: PlayerAccountSnapshot = {
      playerId,
      displayName: input.displayName?.trim() || existing?.displayName || playerId,
      gems: existing?.gems ?? 0,
      seasonXp: existing?.seasonXp ?? 0,
      loginStreak: existing?.loginStreak ?? 0,
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      achievements: existing?.achievements ?? [],
      recentEventLog: existing?.recentEventLog ?? [],
      lastSeenAt: timestamp,
      ...(existing?.lastPlayDate ? { lastPlayDate: existing.lastPlayDate } : {}),
      ...(existing?.dailyPlayMinutes != null ? { dailyPlayMinutes: existing.dailyPlayMinutes } : {}),
      ...(existing?.privacyConsentAt ? { privacyConsentAt: existing.privacyConsentAt } : {}),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
      ...(existing?.credentialBoundAt ? { credentialBoundAt: existing.credentialBoundAt } : {}),
      ...(existing?.accountSessionVersion != null ? { accountSessionVersion: existing.accountSessionVersion } : {}),
      ...(existing?.refreshSessionId ? { refreshSessionId: existing.refreshSessionId } : {}),
      ...(existing?.refreshTokenExpiresAt ? { refreshTokenExpiresAt: existing.refreshTokenExpiresAt } : {}),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.accounts.set(playerId, account);
    return account;
  }

  async bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot> {
    const account = await this.ensurePlayerAccount({ playerId });
    const normalizedLoginId = input.loginId.trim().toLowerCase();
    const nextAccount: PlayerAccountSnapshot = {
      ...account,
      loginId: normalizedLoginId,
      credentialBoundAt: account.credentialBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(account.playerId, nextAccount);
    this.authByLoginId.set(normalizedLoginId, {
      playerId: nextAccount.playerId,
      displayName: nextAccount.displayName,
      loginId: normalizedLoginId,
      passwordHash: input.passwordHash,
      accountSessionVersion: nextAccount.accountSessionVersion ?? 0,
      ...(nextAccount.credentialBoundAt ? { credentialBoundAt: nextAccount.credentialBoundAt } : {})
    });
    return nextAccount;
  }

  async savePlayerAccountPrivacyConsent(
    playerId: string,
    input: { privacyConsentAt?: string } = {}
  ): Promise<PlayerAccountSnapshot> {
    const account = await this.ensurePlayerAccount({ playerId });
    const nextAccount: PlayerAccountSnapshot = {
      ...account,
      privacyConsentAt: account.privacyConsentAt ?? new Date(input.privacyConsentAt ?? Date.now()).toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId.trim(), nextAccount);
    return nextAccount;
  }

  async savePlayerAccountAuthSession(
    playerId: string,
    input: PlayerAccountAuthSessionInput
  ): Promise<PlayerAccountAuthSnapshot | null> {
    const auth = await this.loadPlayerAccountAuthByPlayerId(playerId);
    if (!auth) {
      return null;
    }

    const nextAuth: PlayerAccountAuthSnapshot = {
      ...auth,
      refreshSessionId: input.refreshSessionId,
      refreshTokenHash: input.refreshTokenHash,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt
    };
    this.authByLoginId.set(auth.loginId, nextAuth);

    const sessions = this.authSessionsByPlayerId.get(playerId.trim()) ?? new Map<string, PlayerAccountDeviceSessionSnapshot>();
    sessions.set(input.refreshSessionId, {
      playerId: playerId.trim(),
      sessionId: input.refreshSessionId,
      provider: input.provider ?? "account-password",
      deviceLabel: input.deviceLabel ?? "Unknown device",
      refreshTokenHash: input.refreshTokenHash,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      createdAt: input.lastUsedAt ?? new Date().toISOString(),
      lastUsedAt: input.lastUsedAt ?? new Date().toISOString()
    });
    this.authSessionsByPlayerId.set(playerId.trim(), sessions);

    const account = await this.ensurePlayerAccount({ playerId });
    this.accounts.set(playerId.trim(), {
      ...account,
      accountSessionVersion: nextAuth.accountSessionVersion,
      refreshSessionId: input.refreshSessionId,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      updatedAt: new Date().toISOString()
    });

    return nextAuth;
  }

  async savePlayerAccountProgress(playerId: string, patch: PlayerAccountProgressPatch): Promise<PlayerAccountSnapshot> {
    const account = await this.ensurePlayerAccount({ playerId });
    const nextAccount: PlayerAccountSnapshot = {
      ...account,
      ...(patch.gems != null ? { gems: patch.gems } : {}),
      ...(patch.seasonXpDelta != null ? { seasonXp: (account.seasonXp ?? 0) + patch.seasonXpDelta } : {}),
      ...(patch.globalResources ? { globalResources: { ...account.globalResources, ...patch.globalResources } } : {}),
      ...(patch.recentEventLog ? { recentEventLog: [...patch.recentEventLog] } : {}),
      ...(patch.lastPlayDate ? { lastPlayDate: patch.lastPlayDate } : {}),
      ...(patch.dailyPlayMinutes != null ? { dailyPlayMinutes: patch.dailyPlayMinutes } : {}),
      ...(patch.loginStreak != null ? { loginStreak: patch.loginStreak } : {}),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId.trim(), nextAccount);
    return nextAccount;
  }
}

function withEnvOverrides(overrides: Record<string, string | undefined>, cleanup: Array<() => void>): void {
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

function createTestHttpApp(): TestHttpApp {
  return {
    middleware: [],
    getRoutes: [],
    postRoutes: [],
    putRoutes: [],
    deleteRoutes: [],
    patchRoutes: [],
    optionsRoutes: [],
    headRoutes: [],
    use(handler) {
      this.middleware.push(handler);
    },
    get(path, handler) {
      this.getRoutes.push({ path, handler });
    },
    post(path, handler) {
      this.postRoutes.push({ path, handler });
    },
    put(path, handler) {
      this.putRoutes.push({ path, handler });
    },
    delete(path, handler) {
      this.deleteRoutes.push({ path, handler });
    },
    patch(path, handler) {
      this.patchRoutes.push({ path, handler });
    },
    options(path, handler) {
      this.optionsRoutes.push({ path, handler });
    },
    head(path, handler) {
      this.headRoutes.push({ path, handler });
    }
  };
}

async function startRateLimitDevServer(
  store: MemoryAuthRateLimitStore
): Promise<{ app: TestHttpApp; runtime: DevServerRuntimeHandle }> {
  const app = createTestHttpApp();
  const runtime = await startDevServer(0, "127.0.0.1", {
    loadRuntimeSecrets: async () => {},
    readMySqlPersistenceConfig: () => null,
    createFileSystemConfigCenterStore: () => ({
      mode: "filesystem" as const,
      async initializeRuntimeConfigs() {},
      async close() {}
    }),
    createMemoryRoomSnapshotStore: () => store as never,
    createTransport: () => ({
      getExpressApp() {
        return app;
      }
    }),
    createGameServer: () => ({
      define() {
        return {
          filterBy() {}
        };
      },
      async listen() {},
      async gracefullyShutdown() {}
    }),
    validateBackupStorage: async () => ({
      status: "skipped" as const,
      message: "Backup storage validation skipped because VEIL_BACKUP_S3_BUCKET is not configured.",
      lastSuccessTimestamp: null
    }),
    logger: {
      log() {},
      warn() {},
      error() {}
    },
    process: {
      once() {},
      on() {},
      exit() {}
    }
  });
  return { app, runtime };
}

async function dispatchJson(
  app: TestHttpApp,
  input: {
    path: string;
    body: Record<string, unknown>;
    headers?: Record<string, string>;
    remoteAddress?: string;
  }
): Promise<{
  status: number;
  body: Record<string, unknown>;
  headers: {
    get(name: string): string | undefined;
  };
}> {
  const route = app.postRoutes.find((candidate) => candidate.path === input.path);
  if (!route) {
    throw new Error(`route_not_found:${input.path}`);
  }

  const encodedBody = Buffer.from(JSON.stringify(input.body));
  const headers = Object.fromEntries(
    Object.entries({
      "content-type": "application/json",
      ...(input.headers ?? {})
    }).map(([key, value]) => [key.toLowerCase(), value])
  );
  const request = {
    method: "POST",
    url: input.path,
    headers,
    socket: {
      remoteAddress: input.remoteAddress ?? "127.0.0.1"
    },
    async *[Symbol.asyncIterator]() {
      if (encodedBody.length > 0) {
        yield encodedBody;
      }
    }
  };
  const response = new TestResponse();

  for (const middleware of app.middleware) {
    let nextCalled = false;
    await middleware(request, response, () => {
      nextCalled = true;
    });
    if (response.finished || !nextCalled) {
      return {
        status: response.statusCode,
        body: response.body ? (JSON.parse(response.body) as Record<string, unknown>) : {},
        headers: {
          get(name: string) {
            return response.getHeader(name);
          }
        }
      };
    }
  }

  await route.handler(request, response);
  return {
    status: response.statusCode,
    body: response.body ? (JSON.parse(response.body) as Record<string, unknown>) : {},
    headers: {
      get(name: string) {
        return response.getHeader(name);
      }
    }
  };
}

async function seedAccount(
  store: MemoryAuthRateLimitStore,
  input: {
    playerId: string;
    displayName: string;
    loginId: string;
    password: string;
  }
): Promise<void> {
  await store.ensurePlayerAccount({
    playerId: input.playerId,
    displayName: input.displayName
  });
  await store.bindPlayerAccountCredentials(input.playerId, {
    loginId: input.loginId,
    passwordHash: hashAccountPassword(input.password)
  });
}

test("real dev-server locks an account after 10 failed attempts and rejects attempt 11", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_RATE_LIMIT_AUTH_MAX: "100",
      VEIL_AUTH_LOCKOUT_THRESHOLD: "10",
      VEIL_AUTH_LOCKOUT_DURATION_MINUTES: "0.01"
    },
    cleanup
  );

  const store = new MemoryAuthRateLimitStore();
  await seedAccount(store, {
    playerId: "rate-limit-brute-force-player",
    displayName: "Rate Limit Ranger",
    loginId: "rate-limit-ranger",
    password: "hunter2"
  });
  const { app, runtime } = await startRateLimitDevServer(store);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await runtime.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const response = await dispatchJson(app, {
      path: "/api/auth/account-login",
      body: {
        loginId: "rate-limit-ranger",
        password: "wrong-password",
        privacyConsentAccepted: true
      }
    });
    assert.equal(response.status, 401, `attempt ${attempt} should still count as a failed credential check`);
    assert.equal((response.body.error as { code: string }).code, "invalid_credentials");
  }

  const lockedResponse = await dispatchJson(app, {
    path: "/api/auth/account-login",
    body: {
      loginId: "rate-limit-ranger",
      password: "wrong-password",
      privacyConsentAccepted: true
    }
  });
  const lockedPayload = lockedResponse.body as { error: { code: string; lockedUntil?: string } };

  assert.equal(lockedResponse.status, 403);
  assert.equal(lockedPayload.error.code, "account_locked");
  assert.ok(lockedPayload.error.lockedUntil);
  assert.ok(lockedResponse.headers.get("Retry-After"));
});

test("real dev-server blocks credential stuffing from one IP after five distinct login IDs", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_RATE_LIMIT_AUTH_MAX: "100",
      VEIL_AUTH_CREDENTIAL_STUFFING_DISTINCT_LOGIN_IDS: "5",
      VEIL_AUTH_CREDENTIAL_STUFFING_BLOCK_DURATION_MINUTES: "0.01"
    },
    cleanup
  );

  const store = new MemoryAuthRateLimitStore();
  await seedAccount(store, {
    playerId: "credential-stuffing-player",
    displayName: "Credential Stuffing Ranger",
    loginId: "credential-stuffing-real",
    password: "hunter2"
  });
  const { app, runtime } = await startRateLimitDevServer(store);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await runtime.gracefullyShutdown(false).catch(() => undefined);
  });

  const sourceIp = "198.51.100.25";
  for (let index = 1; index <= 5; index += 1) {
    const response = await dispatchJson(app, {
      path: "/api/auth/account-login",
      remoteAddress: sourceIp,
      headers: {
        "x-forwarded-for": sourceIp
      },
      body: {
        loginId: `credential-burst-${index}`,
        password: "wrong-password",
        privacyConsentAccepted: true
      }
    });
    assert.equal(response.status, 401, `attempt ${index} should still be counted before the source is blocked`);
    assert.equal((response.body.error as { code: string }).code, "invalid_credentials");
  }

  const blockedResponse = await dispatchJson(app, {
    path: "/api/auth/account-login",
    remoteAddress: sourceIp,
    headers: {
      "x-forwarded-for": sourceIp
    },
    body: {
      loginId: "credential-burst-6",
      password: "wrong-password",
      privacyConsentAccepted: true
    }
  });
  const blockedPayload = blockedResponse.body as { error: { code: string; blockedUntil?: string } };

  assert.equal(blockedResponse.status, 429);
  assert.equal(blockedPayload.error.code, "credential_stuffing_blocked");
  assert.ok(blockedPayload.error.blockedUntil);
  assert.ok(blockedResponse.headers.get("Retry-After"));
});

test("real dev-server clears account lockout state after the configured recovery window", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_RATE_LIMIT_AUTH_MAX: "100",
      VEIL_AUTH_LOCKOUT_THRESHOLD: "2",
      VEIL_AUTH_LOCKOUT_DURATION_MINUTES: "0.002"
    },
    cleanup
  );

  const store = new MemoryAuthRateLimitStore();
  await seedAccount(store, {
    playerId: "rate-limit-recovery-player",
    displayName: "Recovery Ranger",
    loginId: "recovery-ranger",
    password: "hunter2"
  });
  const { app, runtime } = await startRateLimitDevServer(store);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await runtime.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await dispatchJson(app, {
      path: "/api/auth/account-login",
      body: {
        loginId: "recovery-ranger",
        password: "wrong-password",
        privacyConsentAccepted: true
      }
    });
    assert.equal(response.status, 401);
    assert.equal((response.body.error as { code: string }).code, "invalid_credentials");
  }

  const lockedResponse = await dispatchJson(app, {
    path: "/api/auth/account-login",
    body: {
      loginId: "recovery-ranger",
      password: "wrong-password",
      privacyConsentAccepted: true
    }
  });
  const lockedPayload = lockedResponse.body as { error: { code: string; lockedUntil?: string } };
  assert.equal(lockedResponse.status, 403);
  assert.equal(lockedPayload.error.code, "account_locked");
  assert.ok(lockedPayload.error.lockedUntil);

  await sleep(180);

  const recoveredResponse = await dispatchJson(app, {
    path: "/api/auth/account-login",
    body: {
      loginId: "recovery-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    }
  });
  const recoveredPayload = recoveredResponse.body as {
    account: PlayerAccountSnapshot;
    session: GuestAuthSession;
  };

  assert.equal(recoveredResponse.status, 200);
  assert.equal(recoveredPayload.account.playerId, "rate-limit-recovery-player");
  assert.equal(recoveredPayload.session.loginId, "recovery-ranger");
});
