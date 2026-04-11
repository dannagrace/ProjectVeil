import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeGuildState, type GuildState } from "../../../packages/shared/src/index";
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
  url?: string;
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
    params: options.params ?? {},
    url: options.url ?? "/"
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

function withSupportSecrets(
  t: TestContext,
  options: {
    moderator?: string;
    supervisor?: string;
  } = {}
): { moderator: string; supervisor: string } {
  const moderator = options.moderator ?? "test-support-moderator-secret";
  const supervisor = options.supervisor ?? "test-support-supervisor-secret";
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  process.env.SUPPORT_MODERATOR_SECRET = moderator;
  process.env.SUPPORT_SUPERVISOR_SECRET = supervisor;
  t.after(() => {
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  });
  return { moderator, supervisor };
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
  const reports = new Map<string, {
    reportId: string;
    reporterId: string;
    targetId: string;
    reason: "cheating" | "harassment" | "afk";
    description?: string;
    roomId: string;
    status: "pending" | "dismissed" | "warned" | "banned";
    createdAt: string;
    resolvedAt?: string;
  }>();
  const guilds = new Map<string, GuildState>();
  const battleHistoryByPlayerId = new Map<string, Array<{
    roomId: string;
    battleId: string;
    status: "active" | "resolved" | "compensated" | "aborted";
    encounterKind: "neutral" | "hero";
    startedAt: string;
  }>>();
  const guildAuditLogs: Array<{
    auditId: string;
    guildId: string;
    action: "created" | "hidden" | "unhidden" | "deleted";
    actorPlayerId: string;
    occurredAt: string;
    name: string;
    tag: string;
    reason?: string;
  }> = [];
  const saveCalls: Array<{ playerId: string; globalResources: { gold: number; wood: number; ore: number } }> = [];
  let nextReportId = 1;

  const store = {
    saveCalls,
    async loadPlayerAccount(playerId: string) {
      return accounts.get(playerId) ?? null;
    },
    async createPlayerReport(input: {
      reporterId: string;
      targetId: string;
      reason: "cheating" | "harassment" | "afk";
      description?: string;
      roomId: string;
    }) {
      const duplicate = Array.from(reports.values()).find(
        (report) =>
          report.reporterId === input.reporterId &&
          report.targetId === input.targetId &&
          report.roomId === input.roomId
      );
      if (duplicate) {
        throw new Error("duplicate_player_report");
      }
      const report = {
        reportId: String(nextReportId++),
        reporterId: input.reporterId,
        targetId: input.targetId,
        reason: input.reason,
        ...(input.description ? { description: input.description } : {}),
        roomId: input.roomId,
        status: "pending" as const,
        createdAt: new Date().toISOString()
      };
      reports.set(report.reportId, report);
      return report;
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
    async loadGuild(guildId: string) {
      return guilds.get(guildId) ? normalizeGuildState(guilds.get(guildId)) : null;
    },
    async loadGuildByMemberPlayerId(playerId: string) {
      const match = Array.from(guilds.values()).find((guild) => guild.members.some((member) => member.playerId === playerId));
      return match ? normalizeGuildState(match) : null;
    },
    async listGuilds(options: { limit?: number } = {}) {
      return Array.from(guilds.values())
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(1, Math.floor(options.limit ?? 50)))
        .map((guild) => normalizeGuildState(guild));
    },
    async saveGuild(guild: GuildState) {
      const normalized = normalizeGuildState(guild);
      guilds.set(normalized.id, normalized);
      return normalizeGuildState(normalized);
    },
    async deleteGuild(guildId: string) {
      guilds.delete(guildId);
    },
    async appendGuildAuditLog(input: {
      guildId: string;
      action: "created" | "hidden" | "unhidden" | "deleted";
      actorPlayerId: string;
      occurredAt?: string;
      name: string;
      tag: string;
      reason?: string;
    }) {
      const entry = {
        auditId: `${guildAuditLogs.length + 1}`,
        guildId: input.guildId,
        action: input.action,
        actorPlayerId: input.actorPlayerId,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        name: input.name,
        tag: input.tag,
        ...(input.reason ? { reason: input.reason } : {})
      };
      guildAuditLogs.unshift(entry);
      return entry;
    },
    async listGuildAuditLogs(options: { guildId?: string; limit?: number } = {}) {
      return guildAuditLogs
        .filter((entry) => !options.guildId || entry.guildId === options.guildId)
        .slice(0, Math.max(1, Math.floor(options.limit ?? 50)));
    },
    async savePlayerAccountProgress(
      playerId: string,
      patch: {
        globalResources?: { gold: number; wood: number; ore: number };
        leaderboardModerationState?: Record<string, unknown>;
      }
    ) {
      const account =
        (await this.loadPlayerAccount(playerId)) ??
        (await this.ensurePlayerAccount({
          playerId,
          displayName: playerId
        }));
      account.globalResources = { ...account.globalResources, ...patch.globalResources };
      if (patch.leaderboardModerationState) {
        account.leaderboardModerationState = {
          ...(account.leaderboardModerationState ?? {}),
          ...patch.leaderboardModerationState
        };
      }
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
    },
    async listBattleSnapshotsForPlayer(playerId: string, options: { limit?: number } = {}) {
      return (battleHistoryByPlayerId.get(playerId) ?? []).slice(0, Math.max(1, Math.floor(options.limit ?? 50)));
    },
    seedBattleHistory(
      playerId: string,
      items: Array<{
        roomId: string;
        battleId: string;
        status: "active" | "resolved" | "compensated" | "aborted";
        encounterKind: "neutral" | "hero";
        startedAt: string;
      }>
    ) {
      battleHistoryByPlayerId.set(playerId, items);
    },
    async listPlayerReports(options: {
      status?: "pending" | "dismissed" | "warned" | "banned";
      limit?: number;
    } = {}) {
      return Array.from(reports.values())
        .filter((report) => !options.status || report.status === options.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.reportId.localeCompare(right.reportId))
        .slice(0, Math.max(1, Math.floor(options.limit ?? 50)));
    },
    async resolvePlayerReport(reportId: string, input: { status: "dismissed" | "warned" | "banned" }) {
      const report = reports.get(reportId);
      if (!report) {
        return null;
      }
      const next = {
        ...report,
        status: input.status,
        resolvedAt: new Date().toISOString()
      };
      reports.set(reportId, next);
      return next;
    }
  };

  return store as Pick<
    RoomSnapshotStore,
    | "loadPlayerAccount"
    | "createPlayerReport"
    | "loadPlayerBan"
    | "ensurePlayerAccount"
    | "loadGuild"
    | "loadGuildByMemberPlayerId"
    | "listGuilds"
    | "saveGuild"
    | "deleteGuild"
    | "appendGuildAuditLog"
    | "listGuildAuditLogs"
    | "savePlayerAccountProgress"
    | "savePlayerBan"
    | "clearPlayerBan"
    | "listPlayerBanHistory"
    | "listBattleSnapshotsForPlayer"
    | "listPlayerReports"
    | "resolvePlayerReport"
  > & {
    saveCalls: Array<{ playerId: string; globalResources: { gold: number; wood: number; ore: number } }>;
    seedBattleHistory(
      playerId: string,
      items: Array<{
        roomId: string;
        battleId: string;
        status: "active" | "resolved" | "compensated" | "aborted";
        encounterKind: "neutral" | "hero";
        startedAt: string;
      }>
    ): void;
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
  const buildStatePayloadCalls: string[] = [];

  getActiveRoomInstances().set("room-alpha", {
    getPlayerId(client: { sessionId?: string }) {
      return client.sessionId === "session-player-2" ? "player-2" : "player-1";
    },
    buildStatePayload(playerId: string) {
      buildStatePayloadCalls.push(playerId);
      return {
        world: {
          playerId,
          resources: { gold: 0, wood: 7, ore: 3 }
        },
        battle: null,
        events: [{ type: "system.announcement", text: "资源已更新", tone: "system" }],
        movementPlan: null,
        reachableTiles: [],
        featureFlags: {
          quest_system_enabled: false,
          battle_pass_enabled: false,
          pve_enabled: true,
          tutorial_enabled: false
        }
      };
    },
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
        sessionId: "session-player-1",
        send(type: string, payload: unknown) {
          sentMessages.push({ type, payload });
        }
      },
      {
        sessionId: "session-player-2",
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
  assert.deepEqual(buildStatePayloadCalls, ["player-1", "player-2"]);
  assert.equal(sentMessages.length, 2);
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
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
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
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({
        banStatus: "temporary",
        banExpiry: "2026-05-05T00:00:00.000Z",
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
  assert.equal(banPayload.account.banExpiry, "2026-05-05T00:00:00.000Z");
  assert.equal(banPayload.account.banReason, "Chargeback abuse");
  assert.equal(banPayload.disconnectedClients, 0);

  const unbanResponse = createResponse();
  await unbanHandler(
    createRequest({
      method: "POST",
      params: { id: "player-7" },
      headers: {
        "x-veil-admin-secret": moderator
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
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
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
        "x-veil-admin-secret": moderator
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

test("GET /api/admin/reports returns filtered player reports", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.createPlayerReport({
    reporterId: "player-1",
    targetId: "player-2",
    reason: "cheating",
    roomId: "room-report"
  });
  const report = await store.createPlayerReport({
    reporterId: "player-3",
    targetId: "player-4",
    reason: "harassment",
    roomId: "room-report"
  });
  await store.resolvePlayerReport(report.reportId, { status: "dismissed" });

  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/reports");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      url: "/api/admin/reports?status=pending",
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    status: string;
    items: Array<{ reporterId: string; status: string }>;
  };
  assert.equal(payload.status, "pending");
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0]?.reporterId, "player-1");
  assert.equal(payload.items[0]?.status, "pending");
});

test("POST /api/admin/reports/:id/resolve marks a report resolved", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const report = await store.createPlayerReport({
    reporterId: "player-1",
    targetId: "player-2",
    reason: "afk",
    roomId: "room-report"
  });

  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/reports/:id/resolve");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: report.reportId },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({ status: "warned" })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    ok: boolean;
    report: { status: string; resolvedAt?: string };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.report.status, "warned");
  assert.ok(payload.report.resolvedAt);
});

test("GET /api/admin/overview returns 503 when ADMIN_SECRET is not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;
  try {
    const { gets } = registerRoutes();
    const handler = gets.get("/api/admin/overview");
    assert.ok(handler);

    const response = createResponse();
    await handler(createRequest({ headers: { "x-veil-admin-secret": "any-secret" } }), response);

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "ADMIN_SECRET is not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
  }
});

test("GET /admin serves admin.html with text/html content-type", async (t) => {
  withAdminSecret(t);
  const { gets } = registerRoutes();
  const handler = gets.get("/admin");
  assert.ok(handler);

  const response = createResponse();
  await handler(createRequest({ url: "/admin" }), response);

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["Content-Type"] ?? "", /text\/html/);
  assert.ok(response.body.length > 0, "admin.html body should be non-empty");
});

test("POST /api/admin/players/:id/unban returns 401 without a valid admin secret", async (t) => {
  withAdminSecret(t);
  withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/unban");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      body: JSON.stringify({ reason: "appeal approved" })
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
});

test("POST /api/admin/players/:id/unban returns 503 when support secrets are not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  delete process.env.ADMIN_SECRET;
  delete process.env.SUPPORT_MODERATOR_SECRET;
  delete process.env.SUPPORT_SUPERVISOR_SECRET;
  try {
    const { posts } = registerRoutes();
    const handler = posts.get("/api/admin/players/:id/unban");
    assert.ok(handler);

    const response = createResponse();
    await handler(
      createRequest({ method: "POST", params: { id: "player-1" }, body: JSON.stringify({}) }),
      response
    );

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "Player support secrets are not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  }
});

test("GET /api/admin/players/:id/ban-history returns 503 when support secrets are not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  delete process.env.ADMIN_SECRET;
  delete process.env.SUPPORT_MODERATOR_SECRET;
  delete process.env.SUPPORT_SUPERVISOR_SECRET;
  try {
    const store = createStore();
    const { gets } = registerRoutes(store as RoomSnapshotStore);
    const handler = gets.get("/api/admin/players/:id/ban-history");
    assert.ok(handler);

    const response = createResponse();
    await handler(createRequest({ params: { id: "player-1" } }), response);

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "Player support secrets are not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  }
});

test("GET /api/admin/reports returns 503 when support secrets are not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  delete process.env.ADMIN_SECRET;
  delete process.env.SUPPORT_MODERATOR_SECRET;
  delete process.env.SUPPORT_SUPERVISOR_SECRET;
  try {
    const store = createStore();
    const { gets } = registerRoutes(store as RoomSnapshotStore);
    const handler = gets.get("/api/admin/reports");
    assert.ok(handler);

    const response = createResponse();
    await handler(createRequest({ url: "/api/admin/reports" }), response);

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "Player support secrets are not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  }
});

test("POST /api/admin/reports/:id/resolve returns 503 when support secrets are not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  delete process.env.ADMIN_SECRET;
  delete process.env.SUPPORT_MODERATOR_SECRET;
  delete process.env.SUPPORT_SUPERVISOR_SECRET;
  try {
    const store = createStore();
    const { posts } = registerRoutes(store as RoomSnapshotStore);
    const handler = posts.get("/api/admin/reports/:id/resolve");
    assert.ok(handler);

    const response = createResponse();
    await handler(
      createRequest({ method: "POST", params: { id: "report-1" }, body: JSON.stringify({ status: "dismissed" }) }),
      response
    );

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "Player support secrets are not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  }
});

test("POST /api/admin/reports/:id/resolve with banned also bans the reported player", async (t) => {
  withAdminSecret(t);
  const { supervisor } = withSupportSecrets(t);
  const store = createStore();
  const report = await store.createPlayerReport({
    reporterId: "player-1",
    targetId: "player-2",
    reason: "cheating",
    roomId: "room-report"
  });

  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/reports/:id/resolve");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: report.reportId },
      headers: {
        "x-veil-admin-secret": supervisor
      },
      body: JSON.stringify({
        status: "banned",
        approval: {
          approvedBy: "ops-lead",
          approvalReference: "SUP-204"
        }
      })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    ok: boolean;
    disconnectedClients: number;
    report: { status: string; targetId: string };
  };
  const currentBan = await store.loadPlayerBan("player-2");
  assert.equal(payload.ok, true);
  assert.equal(payload.report.status, "banned");
  assert.equal(payload.disconnectedClients, 0);
  assert.equal(currentBan?.banStatus, "permanent");
  assert.match(currentBan?.banReason ?? "", /player report/);
  assert.match(currentBan?.banReason ?? "", /approvedBy=ops-lead/);
});

test("POST /api/admin/players/:id/ban rejects permanent bans from support moderators", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/ban");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-9" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({
        banStatus: "permanent",
        banReason: "Confirmed botting",
        approval: {
          approvedBy: "ops-lead",
          approvalReference: "SUP-205"
        }
      })
    }),
    response
  );

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    error: "Forbidden: permanent bans require support-supervisor or admin credentials"
  });
});

test("POST /api/admin/players/:id/ban requires approval metadata for permanent bans", async (t) => {
  withAdminSecret(t);
  const { supervisor } = withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/ban");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-10" },
      headers: {
        "x-veil-admin-secret": supervisor
      },
      body: JSON.stringify({
        banStatus: "permanent",
        banReason: "Chargeback fraud"
      })
    }),
    response
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "\"approval\" is required" });
});

test("POST /api/admin/players/:id/unban rejects permanent-ban reversal from support moderators", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.savePlayerBan("player-11", {
    banStatus: "permanent",
    banReason: "Severe abuse"
  });
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/unban");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-11" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({ reason: "appeal approved" })
    }),
    response
  );

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    error: "Forbidden: permanent-ban reversals require support-supervisor or admin credentials"
  });
});

test("GET /api/admin/players/:id/export returns account data for support workflows", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore({
    "player-export": { gold: 9, wood: 4, ore: 2 }
  });
  await store.savePlayerBan("player-export", {
    banStatus: "temporary",
    banReason: "Spam",
    banExpiry: "2026-05-10T00:00:00.000Z"
  });
  store.seedBattleHistory("player-export", [
    {
      roomId: "room-reconnect",
      battleId: "battle-neutral-1",
      status: "compensated",
      encounterKind: "neutral",
      startedAt: "2026-04-11T10:00:00.000Z"
    }
  ]);
  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/players/:id/export");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      params: { id: "player-export" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    playerId: string;
    exportedAt: string;
    account: { playerId: string; globalResources: { gold: number; wood: number; ore: number } };
    moderation: { currentBan: { banStatus: string }; banHistory: Array<{ action: string }> };
    battleHistory: Array<{ battleId: string; status: string }>;
  };
  assert.equal(payload.playerId, "player-export");
  assert.ok(Number.isFinite(Date.parse(payload.exportedAt)));
  assert.equal(payload.account.playerId, "player-export");
  assert.deepEqual(payload.account.globalResources, { gold: 9, wood: 4, ore: 2 });
  assert.equal(payload.moderation.currentBan.banStatus, "temporary");
  assert.equal(payload.moderation.banHistory[0]?.action, "ban");
  assert.equal(payload.battleHistory[0]?.battleId, "battle-neutral-1");
  assert.equal(payload.battleHistory[0]?.status, "compensated");
});

test("POST /api/admin/players/:id/leaderboard/freeze freezes leaderboard movement for a player", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/leaderboard/freeze");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-freeze" },
      body: JSON.stringify({ reason: "Suspicious ELO spike" }),
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    ok: boolean;
    account: { leaderboardModerationState?: { frozenByPlayerId?: string; freezeReason?: string; frozenAt?: string } };
  };

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.account.leaderboardModerationState?.frozenByPlayerId, "support-moderator:admin-console");
  assert.equal(payload.account.leaderboardModerationState?.freezeReason, "Suspicious ELO spike");
  assert.ok(payload.account.leaderboardModerationState?.frozenAt);
});

test("POST /api/admin/players/:id/leaderboard/remove hides a player from leaderboard output", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/leaderboard/remove");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-hidden" },
      body: JSON.stringify({ reason: "Leaderboard manipulation investigation" }),
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    ok: boolean;
    account: { leaderboardModerationState?: { hiddenByPlayerId?: string; hiddenReason?: string; hiddenAt?: string } };
  };

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.account.leaderboardModerationState?.hiddenByPlayerId, "support-moderator:admin-console");
  assert.equal(payload.account.leaderboardModerationState?.hiddenReason, "Leaderboard manipulation investigation");
  assert.ok(payload.account.leaderboardModerationState?.hiddenAt);
});

test("support moderators can hide and inspect guild moderation audit", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.saveGuild(
    normalizeGuildState({
      id: "guild-admin-1",
      name: "Nightwatch",
      tag: "NW",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
      memberLimit: 20,
      level: 1,
      xp: 0,
      members: [{ playerId: "founder-1", displayName: "Founder", role: "owner", joinedAt: "2026-04-11T00:00:00.000Z" }],
      joinRequests: [],
      invites: []
    })
  );
  await store.appendGuildAuditLog({
    guildId: "guild-admin-1",
    action: "created",
    actorPlayerId: "founder-1",
    occurredAt: "2026-04-11T00:00:00.000Z",
    name: "Nightwatch",
    tag: "NW"
  });
  const { gets, posts } = registerRoutes(store as RoomSnapshotStore);
  const hideHandler = posts.get("/api/admin/guilds/:id/hide");
  const getHandler = gets.get("/api/admin/guilds/:id");
  assert.ok(hideHandler);
  assert.ok(getHandler);

  const hideResponse = createResponse();
  await hideHandler(
    createRequest({
      method: "POST",
      params: { id: "guild-admin-1" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({ reason: "违规名称巡检下架" })
    }),
    hideResponse
  );

  assert.equal(hideResponse.statusCode, 200);
  const hiddenPayload = JSON.parse(hideResponse.body) as { guild: GuildState };
  assert.equal(hiddenPayload.guild.moderation?.isHidden, true);
  assert.equal(hiddenPayload.guild.moderation?.hiddenReason, "违规名称巡检下架");

  const getResponse = createResponse();
  await getHandler(
    createRequest({
      params: { id: "guild-admin-1" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    getResponse
  );

  assert.equal(getResponse.statusCode, 200);
  const getPayload = JSON.parse(getResponse.body) as {
    guild: GuildState;
    audit: Array<{ action: string; actorPlayerId: string; reason?: string; guildId: string; name: string; tag: string }>;
  };
  assert.equal(getPayload.guild.moderation?.isHidden, true);
  assert.equal(getPayload.audit[0]?.action, "hidden");
  assert.equal(getPayload.audit[0]?.actorPlayerId, "support-moderator:admin-console");
  assert.equal(getPayload.audit[0]?.reason, "违规名称巡检下架");
  assert.equal(getPayload.audit[0]?.guildId, "guild-admin-1");
  assert.equal(getPayload.audit[0]?.name, "Nightwatch");
  assert.equal(getPayload.audit[0]?.tag, "NW");
  const audit = await store.listGuildAuditLogs({ guildId: "guild-admin-1" });
  assert.equal(audit[0]?.action, "hidden");
  assert.equal(audit[1]?.action, "created");
  assert.equal(audit[1]?.actorPlayerId, "founder-1");
});

test("support moderators can delete guilds without removing audit history", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.saveGuild(
    normalizeGuildState({
      id: "guild-admin-delete",
      name: "Spammy",
      tag: "SPM",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
      memberLimit: 20,
      level: 1,
      xp: 0,
      members: [{ playerId: "founder-delete", displayName: "Founder Delete", role: "owner", joinedAt: "2026-04-11T00:00:00.000Z" }],
      joinRequests: [],
      invites: []
    })
  );
  await store.appendGuildAuditLog({
    guildId: "guild-admin-delete",
    action: "created",
    actorPlayerId: "founder-delete",
    occurredAt: "2026-04-11T00:00:00.000Z",
    name: "Spammy",
    tag: "SPM"
  });
  const { posts, gets } = registerRoutes(store as RoomSnapshotStore);
  const deleteHandler = posts.get("/api/admin/guilds/:id/delete");
  const getHandler = gets.get("/api/admin/guilds/:id");
  assert.ok(deleteHandler);
  assert.ok(getHandler);

  const deleteResponse = createResponse();
  await deleteHandler(
    createRequest({
      method: "POST",
      params: { id: "guild-admin-delete" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({ reason: "spam cleanup" })
    }),
    deleteResponse
  );

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal((await store.loadGuild("guild-admin-delete")) === null, true);

  const getResponse = createResponse();
  await getHandler(
    createRequest({
      params: { id: "guild-admin-delete" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    getResponse
  );

  assert.equal(getResponse.statusCode, 400);
  assert.match(getResponse.body, /guild_not_found/);
  const audit = await store.listGuildAuditLogs({ guildId: "guild-admin-delete" });
  assert.equal(audit[0]?.action, "deleted");
  assert.equal(audit[0]?.reason, "spam cleanup");
  assert.equal(audit[1]?.action, "created");
});
