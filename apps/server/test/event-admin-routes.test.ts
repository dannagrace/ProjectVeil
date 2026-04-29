import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerEventRoutes, resetSeasonalEventRuntimeState } from "@server/domain/battle/event-engine";
import { issueGuestAuthSession } from "@server/domain/account/auth";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "@server/domain/ops/observability";

type RouteHandler = (request: any, response: ServerResponse) => void | Promise<void>;

function createFakeEventClusterRedisClient() {
  const hashes = new Map<string, Map<string, string>>();

  return {
    async hget(key: string, field: string): Promise<string | null> {
      return hashes.get(key)?.get(field) ?? null;
    },
    async hset(key: string, field: string, value: string): Promise<number> {
      const hash = hashes.get(key) ?? new Map<string, string>();
      const inserted = hash.has(field) ? 0 : 1;
      hash.set(field, value);
      hashes.set(key, hash);
      return inserted;
    }
  };
}

function createFakeSeasonalEventOpsAuditRedisClient() {
  const lists = new Map<string, string[]>();
  const expireSecondsByKey = new Map<string, number>();
  const failureMode = {
    lpush: false,
    lrange: false
  };

  return {
    expireSecondsByKey,
    failureMode,
    async lpush(key: string, ...values: string[]): Promise<number> {
      if (failureMode.lpush) {
        throw new Error("audit write unavailable");
      }
      const list = lists.get(key) ?? [];
      list.unshift(...values);
      lists.set(key, list);
      return list.length;
    },
    async ltrim(key: string, start: number, stop: number): Promise<"OK"> {
      const list = lists.get(key) ?? [];
      lists.set(key, list.slice(start, stop + 1));
      return "OK";
    },
    async lrange(key: string, start: number, stop: number): Promise<string[]> {
      if (failureMode.lrange) {
        throw new Error("audit read unavailable");
      }
      const list = lists.get(key) ?? [];
      return list.slice(start, stop + 1);
    },
    async expire(key: string, seconds: number): Promise<number> {
      expireSecondsByKey.set(key, seconds);
      return lists.has(key) ? 1 : 0;
    },
    async del(key: string): Promise<number> {
      const existed = lists.delete(key);
      return existed ? 1 : 0;
    }
  };
}

function createTestApp() {
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();
  const patches = new Map<string, RouteHandler>();
  const deletes = new Map<string, RouteHandler>();

  return {
    app: {
      use(_handler: any) {},
      get(path: string, handler: RouteHandler) {
        gets.set(path, handler);
      },
      post(path: string, handler: RouteHandler) {
        posts.set(path, handler);
      },
      patch(path: string, handler: RouteHandler) {
        patches.set(path, handler);
      },
      delete(path: string, handler: RouteHandler) {
        deletes.set(path, handler);
      }
    },
    gets,
    posts,
    patches,
    deletes
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

function withAdminToken(t: TestContext, token = "test-admin-jwt"): string {
  const original = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = token;
  resetSeasonalEventRuntimeState();
  t.after(() => {
    resetSeasonalEventRuntimeState();
    if (original === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
    } else {
      process.env.VEIL_ADMIN_TOKEN = original;
    }
  });
  return token;
}

function createStore() {
  const accounts = new Map<string, any>([
    [
      "player-1",
      {
        playerId: "player-1",
        displayName: "Lyra",
        globalResources: { gold: 0, wood: 0, ore: 0 },
        achievements: [],
        recentEventLog: [],
        seasonalEventStates: [
          {
            eventId: "defend-the-bridge",
            points: 160,
            claimedRewardIds: ["bridge-ration-cache"],
            appliedActionIds: ["run-1", "run-2", "run-3", "run-4"],
            lastUpdatedAt: "2026-04-04T09:00:00.000Z"
          }
        ],
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T09:00:00.000Z"
      }
    ],
    [
      "player-2",
      {
        playerId: "player-2",
        displayName: "Serin",
        globalResources: { gold: 0, wood: 0, ore: 0 },
        achievements: [],
        recentEventLog: [],
        seasonalEventStates: [
          {
            eventId: "defend-the-bridge",
            points: 80,
            claimedRewardIds: [],
            appliedActionIds: ["run-1", "run-2"],
            lastUpdatedAt: "2026-04-04T09:10:00.000Z"
          }
        ],
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T09:10:00.000Z"
      }
    ],
    [
      "player-3",
      {
        playerId: "player-3",
        displayName: "Hale",
        globalResources: { gold: 0, wood: 0, ore: 0 },
        achievements: [],
        recentEventLog: [],
        dailyDungeonState: {
          dateKey: "2026-04-04",
          attemptsUsed: 1,
          claimedRunIds: ["daily-claimed-run-1"],
          runs: [
            {
              runId: "daily-claimed-run-1",
              dungeonId: "shadow-archives",
              floor: 1,
              startedAt: "2026-04-04T11:55:00.000Z",
              rewardClaimedAt: "2026-04-04T12:00:00.000Z"
            }
          ]
        },
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T09:20:00.000Z"
      }
    ]
  ]);
  const mailboxByPlayerId = new Map<string, string[]>();

  return {
    mailboxByPlayerId,
    async listPlayerAccounts() {
      return Array.from(accounts.values()).map((account) => structuredClone(account));
    },
    async loadPlayerAccount(playerId: string) {
      return accounts.get(playerId) ? structuredClone(accounts.get(playerId)) : null;
    },
    async ensurePlayerAccount(input: { playerId: string; displayName?: string }) {
      const existing = accounts.get(input.playerId);
      if (existing) {
        return structuredClone(existing);
      }
      const created = {
        playerId: input.playerId,
        displayName: input.displayName ?? input.playerId,
        globalResources: { gold: 0, wood: 0, ore: 0 },
        achievements: [],
        recentEventLog: [],
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z"
      };
      accounts.set(input.playerId, created);
      return structuredClone(created);
    },
    async savePlayerAccountProgress(playerId: string, patch: { seasonalEventStates?: unknown }) {
      const existing = accounts.get(playerId);
      const next = {
        ...existing,
        ...(patch.seasonalEventStates !== undefined ? { seasonalEventStates: patch.seasonalEventStates } : {}),
        updatedAt: "2026-04-04T10:00:00.000Z"
      };
      accounts.set(playerId, next);
      return structuredClone(next);
    },
    async deliverPlayerMailbox(input: { playerIds: string[]; message: { id: string } }) {
      const deliveredPlayerIds: string[] = [];
      const skippedPlayerIds: string[] = [];
      for (const playerId of input.playerIds) {
        const mailbox = mailboxByPlayerId.get(playerId) ?? [];
        if (mailbox.includes(input.message.id)) {
          skippedPlayerIds.push(playerId);
          continue;
        }
        mailbox.push(input.message.id);
        mailboxByPlayerId.set(playerId, mailbox);
        deliveredPlayerIds.push(playerId);
      }
      return {
        deliveredPlayerIds,
        skippedPlayerIds,
        message: input.message
      };
    }
  };
}

function registerRoutes(
  store: ReturnType<typeof createStore>,
  nowIso = "2026-04-04T12:00:00.000Z",
  eventOptions: Parameters<typeof registerEventRoutes>[2] = {}
) {
  const { app, gets, posts, patches, deletes } = createTestApp();
  registerEventRoutes(app, store as never, { ...eventOptions, now: () => new Date(nowIso) });
  return { gets, posts, patches, deletes };
}

test("GET /api/admin/seasonal-events requires the admin token", async (t) => {
  withAdminToken(t);
  const store = createStore();
  const { gets } = registerRoutes(store);
  const handler = gets.get("/api/admin/seasonal-events");
  assert.ok(handler);

  const response = createResponse();
  await handler(createRequest(), response);

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    error: { code: "forbidden", message: "Invalid admin token" }
  });
});

test("GET /api/admin/seasonal-events lists event status, participation stats, and audit trail", async (t) => {
  const token = withAdminToken(t);
  const store = createStore();
  const { gets } = registerRoutes(store);
  const handler = gets.get("/api/admin/seasonal-events");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        authorization: `Bearer ${token}`
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.events[0]?.id, "defend-the-bridge");
  assert.equal(payload.events[0]?.status, "active");
  assert.equal(payload.events[0]?.participation.participants, 2);
  assert.equal(payload.events[0]?.participation.totalPoints, 240);
  assert.deepEqual(payload.audit, []);
});

test("PATCH /api/admin/seasonal-events/:id updates runtime dates, activation state, and reward config", async (t) => {
  const token = withAdminToken(t);
  const store = createStore();
  const { patches, gets } = registerRoutes(store);
  const handler = patches.get("/api/admin/seasonal-events/:id");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "PATCH",
      headers: {
        "x-veil-admin-token": token
      },
      params: {
        id: "defend-the-bridge"
      },
      body: JSON.stringify({
        startsAt: "2026-04-03T00:00:00.000Z",
        endsAt: "2026-04-10T00:00:00.000Z",
        isActive: true,
        rewards: [
          {
            id: "bridge-ration-cache",
            name: "Ration Cache",
            pointsRequired: 40,
            kind: "resources",
            resources: { gold: 200, wood: 25 }
          }
        ]
      })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.event.startsAt, "2026-04-03T00:00:00.000Z");
  assert.equal(payload.event.endsAt, "2026-04-10T00:00:00.000Z");
  assert.equal(payload.event.isActive, true);
  assert.equal(payload.event.rewards[0]?.resources.gold, 200);
  assert.equal(payload.audit.action, "patched");

  const listHandler = gets.get("/api/admin/seasonal-events");
  assert.ok(listHandler);
  const listResponse = createResponse();
  await listHandler(
    createRequest({
      headers: {
        "x-veil-admin-token": token
      }
    }),
    listResponse
  );
  const listPayload = JSON.parse(listResponse.body);
  assert.equal(listPayload.audit[0]?.action, "patched");
});

test("PATCH /api/admin/seasonal-events/:id persists runtime overrides across route instances", async (t) => {
  const token = withAdminToken(t);
  const redis = createFakeEventClusterRedisClient();
  const eventOptions = {
    seasonalEventRuntimeRedisClient: redis as never
  } as unknown as Parameters<typeof registerEventRoutes>[2];
  const firstRoutes = registerRoutes(createStore(), "2026-04-04T12:00:00.000Z", eventOptions);
  const secondRoutes = registerRoutes(createStore(), "2026-04-04T12:00:00.000Z", eventOptions);
  const patchHandler = firstRoutes.patches.get("/api/admin/seasonal-events/:id");
  assert.ok(patchHandler);

  const patchResponse = createResponse();
  await patchHandler(
    createRequest({
      method: "PATCH",
      headers: {
        "x-veil-admin-token": token
      },
      params: {
        id: "defend-the-bridge"
      },
      body: JSON.stringify({
        isActive: false
      })
    }),
    patchResponse
  );

  assert.equal(patchResponse.statusCode, 200);
  resetSeasonalEventRuntimeState();

  const activeHandler = secondRoutes.gets.get("/api/events/active");
  assert.ok(activeHandler);
  const session = issueGuestAuthSession({
    playerId: "player-3",
    displayName: "Hale"
  });
  const activeResponse = createResponse();
  await activeHandler(
    createRequest({
      headers: {
        authorization: `Bearer ${session.token}`
      }
    }),
    activeResponse
  );

  assert.equal(activeResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(activeResponse.body).events, []);
});

test("PATCH /api/admin/seasonal-events/:id publishes audit rows across route instances", async (t) => {
  const token = withAdminToken(t);
  const redis = createFakeSeasonalEventOpsAuditRedisClient();
  const eventOptions = {
    seasonalEventOpsAuditRedisClient: redis as never
  } as unknown as Parameters<typeof registerEventRoutes>[2];
  const firstRoutes = registerRoutes(createStore(), "2026-04-04T12:00:00.000Z", eventOptions);
  const secondRoutes = registerRoutes(createStore(), "2026-04-04T12:01:00.000Z", eventOptions);
  const patchHandler = firstRoutes.patches.get("/api/admin/seasonal-events/:id");
  assert.ok(patchHandler);

  const patchResponse = createResponse();
  await patchHandler(
    createRequest({
      method: "PATCH",
      headers: {
        "x-veil-admin-token": token
      },
      params: {
        id: "defend-the-bridge"
      },
      body: JSON.stringify({
        isActive: false
      })
    }),
    patchResponse
  );

  assert.equal(patchResponse.statusCode, 200);
  resetSeasonalEventRuntimeState();

  const listHandler = secondRoutes.gets.get("/api/admin/seasonal-events");
  assert.ok(listHandler);
  const listResponse = createResponse();
  await listHandler(
    createRequest({
      headers: {
        "x-veil-admin-token": token
      }
    }),
    listResponse
  );

  assert.equal(listResponse.statusCode, 200);
  const listPayload = JSON.parse(listResponse.body);
  assert.equal(listPayload.audit[0]?.action, "patched");
  assert.equal(listPayload.audit[0]?.eventId, "defend-the-bridge");
  assert.equal(listPayload.audit[0]?.occurredAt, "2026-04-04T12:00:00.000Z");
  assert.equal(redis.expireSecondsByKey.size, 1);
});

test("PATCH /api/admin/seasonal-events/:id surfaces degraded audit persistence", async (t) => {
  resetRuntimeObservability();
  t.after(() => {
    resetSeasonalEventRuntimeState();
    resetRuntimeObservability();
  });
  const token = withAdminToken(t);
  const redis = createFakeSeasonalEventOpsAuditRedisClient();
  redis.failureMode.lpush = true;
  const { patches } = registerRoutes(createStore(), "2026-04-04T12:00:00.000Z", {
    seasonalEventOpsAuditRedisClient: redis as never
  } as unknown as Parameters<typeof registerEventRoutes>[2]);
  const patchHandler = patches.get("/api/admin/seasonal-events/:id");
  assert.ok(patchHandler);

  const response = createResponse();
  await patchHandler(
    createRequest({
      method: "PATCH",
      headers: {
        "x-veil-admin-token": token
      },
      params: {
        id: "defend-the-bridge"
      },
      body: JSON.stringify({
        isActive: false
      })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.audit.action, "patched");
  assert.equal(payload.auditDegraded, true);
  const metrics = buildPrometheusMetricsDocument();
  assert.match(metrics, /^veil_seasonal_event_ops_audit_persist_failures_total 1$/m);
  assert.match(metrics, /^veil_seasonal_event_ops_audit_local_fallback_writes_total 1$/m);
});

test("GET /api/admin/seasonal-events surfaces degraded audit reads", async (t) => {
  resetRuntimeObservability();
  t.after(() => {
    resetSeasonalEventRuntimeState();
    resetRuntimeObservability();
  });
  const token = withAdminToken(t);
  const redis = createFakeSeasonalEventOpsAuditRedisClient();
  const options = {
    seasonalEventOpsAuditRedisClient: redis as never
  } as unknown as Parameters<typeof registerEventRoutes>[2];
  const routes = registerRoutes(createStore(), "2026-04-04T12:00:00.000Z", options);
  const patchHandler = routes.patches.get("/api/admin/seasonal-events/:id");
  const listHandler = routes.gets.get("/api/admin/seasonal-events");
  assert.ok(patchHandler);
  assert.ok(listHandler);

  await patchHandler(
    createRequest({
      method: "PATCH",
      headers: {
        "x-veil-admin-token": token
      },
      params: {
        id: "defend-the-bridge"
      },
      body: JSON.stringify({
        isActive: false
      })
    }),
    createResponse()
  );

  redis.failureMode.lrange = true;
  const response = createResponse();
  await listHandler(
    createRequest({
      headers: {
        "x-veil-admin-token": token
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.audit[0]?.action, "patched");
  assert.equal(payload.auditDegraded, true);
  const metrics = buildPrometheusMetricsDocument();
  assert.match(metrics, /^veil_seasonal_event_ops_audit_persist_success_total 1$/m);
  assert.match(metrics, /^veil_seasonal_event_ops_audit_read_failures_total 1$/m);
});

test("POST /api/admin/seasonal-events/:id/end force-ends an active event and distributes mailbox rewards", async (t) => {
  const token = withAdminToken(t);
  const store = createStore();
  const { posts } = registerRoutes(store);
  const handler = posts.get("/api/admin/seasonal-events/:id/end");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      },
      params: {
        id: "defend-the-bridge"
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.event.isActive, false);
  assert.equal(payload.event.endsAt, "2026-04-04T12:00:00.000Z");
  assert.equal(payload.distribution.deliveredThresholdRewards, 2);
  assert.equal(payload.distribution.deliveredLeaderboardRewards, 2);
  assert.equal(payload.audit.action, "force_ended");
  assert.deepEqual(
    store.mailboxByPlayerId.get("player-1")?.sort(),
    [
      "seasonal-event:defend-the-bridge:leaderboard",
      "seasonal-event:defend-the-bridge:reward:bridge-relief-fund"
    ].sort()
  );
});

test("POST /api/events/:eventId/progress rejects unsupported configured action types before awarding points", async () => {
  const store = createStore();
  const session = issueGuestAuthSession({
    playerId: "player-3",
    displayName: "Hale"
  });
  const { posts } = registerRoutes(store, "2026-04-04T12:00:00.000Z", {
    eventIndexDocument: {
      events: [
        {
          id: "forgeable-event",
          name: "Forgeable Event",
          description: "Regression event",
          startsAt: "2026-04-04T00:00:00.000Z",
          endsAt: "2026-04-05T00:00:00.000Z",
          durationDays: 1,
          bannerText: "Regression",
          leaderboard: { size: 10 }
        }
      ]
    },
    eventDocuments: {
      "forgeable-event": {
        id: "forgeable-event",
        name: "Forgeable Event",
        description: "Regression event",
        startsAt: "2026-04-04T00:00:00.000Z",
        endsAt: "2026-04-05T00:00:00.000Z",
        durationDays: 1,
        bannerText: "Regression",
        objectives: [
          {
            id: "forged-objective",
            description: "Unsupported forged action",
            actionType: "manual_bonus",
            points: 500
          }
        ],
        rewards: [],
        leaderboard: {
          size: 10,
          rewardTiers: []
        }
      }
    }
  });
  const handler = posts.get("/api/events/:eventId/progress");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`
      },
      params: {
        eventId: "forgeable-event"
      },
      body: JSON.stringify({
        actionId: "forged-action-1",
        actionType: "manual_bonus"
      })
    }),
    response
  );

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error.code, "seasonal_event_action_unsupported");
  assert.equal((await store.loadPlayerAccount("player-3"))?.seasonalEventStates, undefined);
});

test("POST /api/events/:eventId/progress accepts verified daily dungeon reward claims", async () => {
  const store = createStore();
  const session = issueGuestAuthSession({
    playerId: "player-3",
    displayName: "Hale"
  });
  const { posts } = registerRoutes(store);
  const handler = posts.get("/api/events/:eventId/progress");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`
      },
      params: {
        eventId: "defend-the-bridge"
      },
      body: JSON.stringify({
        actionId: "daily-claimed-run-1",
        actionType: "daily_dungeon_reward_claimed",
        dungeonId: "shadow-archives"
      })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.applied, true);
  assert.equal(payload.eventProgress.delta, 40);
  assert.equal(payload.eventProgress.objectiveId, "bridge-dungeon-clear");
  const progress = (await store.loadPlayerAccount("player-3"))?.seasonalEventStates?.find(
    (state: { eventId: string }) => state.eventId === "defend-the-bridge"
  );
  assert.equal(progress?.points, 40);
  assert.deepEqual(progress?.appliedActionIds, ["daily-claimed-run-1"]);
});

test("DELETE /api/admin/seasonal-events/:eventId/players/:playerId resets a single player progress record", async (t) => {
  const token = withAdminToken(t);
  const store = createStore();
  const { deletes } = registerRoutes(store);
  const handler = deletes.get("/api/admin/seasonal-events/:eventId/players/:playerId");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "DELETE",
      headers: {
        "x-veil-admin-token": token
      },
      params: {
        eventId: "defend-the-bridge",
        playerId: "player-1"
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.reset, true);
  assert.equal(payload.playerId, "player-1");
  assert.equal(payload.account.seasonalEventStates, null);
  assert.equal(payload.audit.action, "player_progress_reset");
});
