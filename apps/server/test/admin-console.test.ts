import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerAdminRoutes } from "../src/admin-console";
import { getActiveRoomInstances } from "../src/colyseus-room";
import type { PlayerBanHistoryRecord, RoomSnapshotStore } from "../src/persistence";

type RouteHandler = (request: any, response: ServerResponse) => void | Promise<void>;

function createTestApp() {
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();

  return {
    app: {
      use(_handler: any) {},
      get(path: string, handler: RouteHandler) {
        gets.set(path, handler);
      },
      post(path: string, handler: RouteHandler) {
        posts.set(path, handler);
      }
    },
    gets,
    posts
  };
}

function createRequest(options: {
  method?: string;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string>;
  body?: string;
} = {}): IncomingMessage & {
  params: Record<string, string>;
} {
  async function* iterateBody() {
    if (options.body !== undefined) {
      yield Buffer.from(options.body, "utf8");
    }
  }

  const request = iterateBody() as IncomingMessage & { params: Record<string, string> };
  Object.assign(request, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    params: options.params ?? {}
  });
  return request;
}

function createResponse(): ServerResponse & {
  body: string;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  let body = "";

  return {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    end(chunk?: string | Buffer) {
      body = chunk === undefined ? "" : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      return this;
    },
    get body() {
      return body;
    },
    headers
  } as ServerResponse & { body: string; headers: Record<string, string> };
}

function withAdminSecret(t: TestContext, secret = "test-admin-secret"): string {
  const originalAdminSecret = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = secret;
  getActiveRoomInstances().clear();
  t.after(() => {
    getActiveRoomInstances().clear();
    if (originalAdminSecret === undefined) {
      delete process.env.ADMIN_SECRET;
      return;
    }
    process.env.ADMIN_SECRET = originalAdminSecret;
  });
  return secret;
}

function registerRoutes(store: RoomSnapshotStore | null = null) {
  const { app, gets, posts } = createTestApp();
  registerAdminRoutes(app, store);
  return { gets, posts };
}

function createStore(initialResourcesByPlayer: Record<string, { gold: number; wood: number; ore: number }> = {}) {
  const accounts = new Map(
    Object.entries(initialResourcesByPlayer).map(([playerId, globalResources]) => [
      playerId,
      {
        playerId,
        displayName: playerId,
        globalResources: { ...globalResources }
      }
    ])
  );
  const banHistoryByPlayerId = new Map<string, PlayerBanHistoryRecord[]>();
  const saveCalls: Array<{ playerId: string; globalResources: { gold: number; wood: number; ore: number } }> = [];

  const store = {
    saveCalls,
    async loadPlayerAccount(playerId: string) {
      return accounts.get(playerId) ?? null;
    },
    async loadPlayerBan(playerId: string) {
      const account = accounts.get(playerId);
      if (!account) {
        return null;
      }
      return {
        playerId: account.playerId,
        banStatus: account.banStatus ?? "none",
        ...(account.banExpiry ? { banExpiry: account.banExpiry } : {}),
        ...(account.banReason ? { banReason: account.banReason } : {})
      };
    },
    async ensurePlayerAccount(input: { playerId: string; displayName?: string }) {
      const existing = accounts.get(input.playerId);
      if (existing) {
        return existing;
      }
      const created = {
        playerId: input.playerId,
        displayName: input.displayName ?? input.playerId,
        globalResources: { gold: 0, wood: 0, ore: 0 },
        banStatus: "none" as const
      };
      accounts.set(input.playerId, created);
      return created;
    },
    async savePlayerAccountProgress(playerId: string, patch: { globalResources?: { gold: number; wood: number; ore: number } }) {
      const account =
        (await this.loadPlayerAccount(playerId)) ??
        (await this.ensurePlayerAccount({
          playerId,
          displayName: playerId
        }));
      account.globalResources = { ...account.globalResources, ...patch.globalResources };
      saveCalls.push({ playerId, globalResources: { ...account.globalResources } });
      return account;
    },
    async savePlayerBan(playerId: string, input: { banStatus: "temporary" | "permanent"; banReason: string; banExpiry?: string }) {
      const account =
        (await this.loadPlayerAccount(playerId)) ??
        (await this.ensurePlayerAccount({
          playerId,
          displayName: playerId
        }));
      account.banStatus = input.banStatus;
      account.banReason = input.banReason;
      account.banExpiry = input.banStatus === "temporary" ? input.banExpiry : undefined;
      const history = banHistoryByPlayerId.get(playerId) ?? [];
      history.unshift({
        id: (history[0]?.id ?? 0) + 1,
        playerId,
        action: "ban",
        banStatus: input.banStatus,
        ...(input.banExpiry ? { banExpiry: input.banExpiry } : {}),
        banReason: input.banReason,
        createdAt: new Date().toISOString()
      });
      banHistoryByPlayerId.set(playerId, history);
      return account;
    },
    async clearPlayerBan(playerId: string, input: { reason?: string } = {}) {
      const account =
        (await this.loadPlayerAccount(playerId)) ??
        (await this.ensurePlayerAccount({
          playerId,
          displayName: playerId
        }));
      account.banStatus = "none";
      delete account.banReason;
      delete account.banExpiry;
      const history = banHistoryByPlayerId.get(playerId) ?? [];
      history.unshift({
        id: (history[0]?.id ?? 0) + 1,
        playerId,
        action: "unban",
        banStatus: "none",
        ...(input.reason ? { banReason: input.reason } : {}),
        createdAt: new Date().toISOString()
      });
      banHistoryByPlayerId.set(playerId, history);
      return account;
    },
    async listPlayerBanHistory(playerId: string, options: { limit?: number } = {}) {
      return (banHistoryByPlayerId.get(playerId) ?? []).slice(0, Math.max(1, Math.floor(options.limit ?? 20)));
    }
  };

  return store as Pick<
    RoomSnapshotStore,
    "loadPlayerAccount" | "loadPlayerBan" | "ensurePlayerAccount" | "savePlayerAccountProgress" | "savePlayerBan" | "clearPlayerBan" | "listPlayerBanHistory"
  > & {
    saveCalls: Array<{ playerId: string; globalResources: { gold: number; wood: number; ore: number } }>;
  };
}

test("GET /api/admin/overview returns 401 without a valid admin secret", async (t) => {
  withAdminSecret(t);
  const { gets } = registerRoutes();
  const handler = gets.get("/api/admin/overview");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-secret": "wrong-secret"
      }
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
});

test("GET /api/admin/overview returns server overview payload with a valid admin secret", async (t) => {
  const secret = withAdminSecret(t);
  const { gets } = registerRoutes();
  const handler = gets.get("/api/admin/overview");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-secret": secret
      }
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    serverTime: string;
    activeRooms: number;
    activePlayers: number;
    nodeVersion: string;
    memoryUsage: NodeJS.MemoryUsage;
  };

  assert.equal(response.statusCode, 200);
  assert.equal(payload.activeRooms, 0);
  assert.equal(payload.activePlayers, 0);
  assert.equal(payload.nodeVersion, process.version);
  assert.ok(Number.isFinite(Date.parse(payload.serverTime)));
  assert.equal(typeof payload.memoryUsage.rss, "number");
});

test("POST /api/admin/players/:id/resources returns 401 without a valid admin secret", async (t) => {
  withAdminSecret(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/resources");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      body: JSON.stringify({ gold: 5 })
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
  assert.equal(store.saveCalls.length, 0);
});

test("POST /api/admin/players/:id/resources returns 400 for malformed JSON", async (t) => {
  const secret = withAdminSecret(t);
  const { posts } = registerRoutes(createStore() as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/resources");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: "{"
    }),
    response
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "Invalid JSON body" });
});

test("POST /api/admin/players/:id/resources returns 400 for invalid resource payload types", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore({
    "player-1": { gold: 10, wood: 4, ore: 1 }
  });
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/resources");
  assert.ok(handler);

  const nonObjectResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: "null"
    }),
    nonObjectResponse
  );

  assert.equal(nonObjectResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(nonObjectResponse.body), { error: "JSON body must be an object" });

  const invalidFieldResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ gold: "drop table", wood: 2.5, ore: 1 })
    }),
    invalidFieldResponse
  );

  assert.equal(invalidFieldResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(invalidFieldResponse.body), { error: '"gold" must be a finite integer' });
  assert.equal(store.saveCalls.length, 0);
});

test("POST /api/admin/players/:id/resources adds and clamps resources and syncs active rooms", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore({
    "player-1": { gold: 10, wood: 4, ore: 1 }
  });
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/resources");
  assert.ok(handler);

  const internalState = {
    resources: {
      "player-1": { gold: 10, wood: 4, ore: 1 }
    },
    playerResources: {
      "player-1": { gold: 10, wood: 4, ore: 1 }
    }
  };
  const snapshot = {
    state: {
      resources: { gold: 10, wood: 4, ore: 1 }
    },
    battle: { turn: 1 }
  };
  const sentMessages: Array<{ type: string; payload: unknown }> = [];

  getActiveRoomInstances().set("room-alpha", {
    worldRoom: {
      getInternalState() {
        return internalState;
      },
      getSnapshot(playerId: string) {
        assert.equal(playerId, "player-1");
        return snapshot;
      }
    },
    clients: [
      {
        send(type: string, payload: unknown) {
          sentMessages.push({ type, payload });
        }
      }
    ]
  } as never);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ gold: -15, wood: 3, ore: 2 })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    resources: { gold: 0, wood: 7, ore: 3 },
    syncedToRoom: true
  });
  assert.deepEqual(store.saveCalls, [
    {
      playerId: "player-1",
      globalResources: { gold: 0, wood: 7, ore: 3 }
    }
  ]);
  assert.deepEqual(internalState.resources["player-1"], { gold: 0, wood: 7, ore: 3 });
  assert.deepEqual(internalState.playerResources["player-1"], { gold: 0, wood: 7, ore: 3 });
  assert.deepEqual(snapshot.state.resources, { gold: 0, wood: 7, ore: 3 });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.type, "session.state");
});

test("POST /api/admin/broadcast returns 401 without a valid admin secret", async (t) => {
  withAdminSecret(t);
  const { posts } = registerRoutes();
  const handler = posts.get("/api/admin/broadcast");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      body: JSON.stringify({ message: "Server restart incoming" })
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
});

test("POST /api/admin/broadcast broadcasts to all active rooms and succeeds when none are active", async (t) => {
  const secret = withAdminSecret(t);
  const { posts } = registerRoutes();
  const handler = posts.get("/api/admin/broadcast");
  assert.ok(handler);

  const broadcasts: Array<{ roomId: string; type: string; payload: { text: string; type: string; timestamp: string } }> = [];
  getActiveRoomInstances().set("room-a", {
    broadcast(type: string, payload: { text: string; type: string; timestamp: string }) {
      broadcasts.push({ roomId: "room-a", type, payload });
    }
  } as never);
  getActiveRoomInstances().set("room-b", {
    broadcast(type: string, payload: { text: string; type: string; timestamp: string }) {
      broadcasts.push({ roomId: "room-b", type, payload });
    }
  } as never);

  const activeRoomsResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ message: "Server restart incoming", type: "warning" })
    }),
    activeRoomsResponse
  );

  assert.equal(activeRoomsResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(activeRoomsResponse.body), { ok: true });
  assert.equal(broadcasts.length, 2);
  assert.deepEqual(
    broadcasts.map(({ roomId, type, payload }) => ({
      roomId,
      type,
      text: payload.text,
      announcementType: payload.type,
      hasTimestamp: Number.isFinite(Date.parse(payload.timestamp))
    })),
    [
      {
        roomId: "room-a",
        type: "system.announcement",
        text: "Server restart incoming",
        announcementType: "warning",
        hasTimestamp: true
      },
      {
        roomId: "room-b",
        type: "system.announcement",
        text: "Server restart incoming",
        announcementType: "warning",
        hasTimestamp: true
      }
    ]
  );

  getActiveRoomInstances().clear();

  const noRoomsResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ message: "No listeners" })
    }),
    noRoomsResponse
  );

  assert.equal(noRoomsResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(noRoomsResponse.body), { ok: true });
});

test("POST /api/admin/broadcast returns 400 for invalid payload types", async (t) => {
  const secret = withAdminSecret(t);
  const { posts } = registerRoutes();
  const handler = posts.get("/api/admin/broadcast");
  assert.ok(handler);

  const nonObjectResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": secret
      },
      body: "[]"
    }),
    nonObjectResponse
  );

  assert.equal(nonObjectResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(nonObjectResponse.body), { error: "JSON body must be an object" });

  const invalidMessageResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ message: "   ", type: 42 })
    }),
    invalidMessageResponse
  );

  assert.equal(invalidMessageResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(invalidMessageResponse.body), { error: '"message" must be a non-empty string' });
});

test("POST /api/admin/players/:id/ban bans the player and POST /unban clears it", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore({
    "player-7": { gold: 1, wood: 2, ore: 3 }
  });
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const banHandler = posts.get("/api/admin/players/:id/ban");
  const unbanHandler = posts.get("/api/admin/players/:id/unban");
  assert.ok(banHandler);
  assert.ok(unbanHandler);

  const banResponse = createResponse();
  await banHandler(
    createRequest({
      method: "POST",
      params: { id: "player-7" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({
        banStatus: "temporary",
        banExpiry: "2026-04-05T00:00:00.000Z",
        banReason: "Chargeback abuse"
      })
    }),
    banResponse
  );

  assert.equal(banResponse.statusCode, 200);
  const banPayload = JSON.parse(banResponse.body) as {
    ok: boolean;
    account: { banStatus: string; banExpiry?: string; banReason?: string };
    disconnectedClients: number;
  };
  assert.equal(banPayload.ok, true);
  assert.equal(banPayload.account.banStatus, "temporary");
  assert.equal(banPayload.account.banExpiry, "2026-04-05T00:00:00.000Z");
  assert.equal(banPayload.account.banReason, "Chargeback abuse");
  assert.equal(banPayload.disconnectedClients, 0);

  const unbanResponse = createResponse();
  await unbanHandler(
    createRequest({
      method: "POST",
      params: { id: "player-7" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ reason: "Appeal approved" })
    }),
    unbanResponse
  );

  assert.equal(unbanResponse.statusCode, 200);
  const unbanPayload = JSON.parse(unbanResponse.body) as {
    ok: boolean;
    account: { banStatus: string; banExpiry?: string; banReason?: string };
  };
  assert.equal(unbanPayload.ok, true);
  assert.equal(unbanPayload.account.banStatus, "none");
  assert.equal("banExpiry" in unbanPayload.account, false);
  assert.equal("banReason" in unbanPayload.account, false);
});

test("GET /api/admin/players/:id/ban-history returns current ban state and history records", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore();
  await store.savePlayerBan("player-history", {
    banStatus: "permanent",
    banReason: "Botting"
  });
  await store.clearPlayerBan("player-history", {
    reason: "Manual review"
  });
  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/players/:id/ban-history");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      params: { id: "player-history" },
      headers: {
        "x-veil-admin-secret": secret
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    items: PlayerBanHistoryRecord[];
    currentBan: { banStatus: string };
  };
  assert.equal(payload.currentBan.banStatus, "none");
  assert.ok(payload.items.length >= 1);
  assert.equal(payload.items[0]?.action, "unban");
  assert.equal(payload.items[0]?.banReason, "Manual review");
});
