import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerEventRoutes, resetSeasonalEventRuntimeState } from "../src/event-engine";

type RouteHandler = (request: any, response: ServerResponse) => void | Promise<void>;

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

function registerRoutes(store: ReturnType<typeof createStore>, nowIso = "2026-04-04T12:00:00.000Z") {
  const { app, gets, posts, patches, deletes } = createTestApp();
  registerEventRoutes(app, store as never, { now: () => new Date(nowIso) });
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
