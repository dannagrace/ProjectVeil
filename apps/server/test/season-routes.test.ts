import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { type TestContext } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerSeasonRoutes } from "../src/seasons";
import type { RoomSnapshotStore, SeasonListOptions, SeasonSnapshot } from "../src/persistence";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

function createTestApp() {
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();

  return {
    app: {
      use(_handler: unknown) {},
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
  url?: string;
  body?: string;
} = {}): IncomingMessage {
  const request = new EventEmitter() as IncomingMessage & EventEmitter;
  Object.assign(request, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    url: options.url ?? "/",
    resume() {}
  });
  queueMicrotask(() => {
    if (options.body !== undefined) {
      request.emit("data", Buffer.from(options.body, "utf8"));
    }
    request.emit("end");
  });
  return request;
}

function createResponse(): ServerResponse & { body: string; headers: Record<string, string> } {
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

function createSeasonStore(seasons: SeasonSnapshot[], calls: SeasonListOptions[]): RoomSnapshotStore {
  return {
    async listSeasons(options: SeasonListOptions = {}) {
      calls.push(options);
      const status = options.status ?? "closed";
      const limit = options.limit ?? 20;
      return seasons
        .filter((season) => status === "all" || season.status === status)
        .slice(0, limit);
    },
    async getCurrentSeason() {
      return seasons.find((season) => season.status === "active") ?? null;
    },
    async createSeason(seasonId: string) {
      return {
        seasonId,
        status: "active",
        startedAt: new Date().toISOString()
      };
    },
    async closeSeason(seasonId: string) {
      return {
        seasonId,
        playersRewarded: 2,
        totalGemsGranted: 75
      };
    },
    async load() {
      return null;
    },
    async loadPlayerAccount() {
      return null;
    },
    async loadPlayerAccountByLoginId() {
      return null;
    },
    async loadPlayerAccountByWechatMiniGameOpenId() {
      return null;
    },
    async loadPlayerEventHistory() {
      return { items: [], total: 0 };
    },
    async loadPlayerAccounts() {
      return [];
    },
    async loadPlayerAccountAuthByLoginId() {
      return null;
    },
    async loadPlayerAccountAuthByPlayerId() {
      return null;
    },
    async loadPlayerHeroArchives() {
      return [];
    },
    async ensurePlayerAccount() {
      throw new Error("not implemented");
    },
    async bindPlayerAccountCredentials() {
      throw new Error("not implemented");
    },
    async creditGems() {
      throw new Error("not implemented");
    },
    async debitGems() {
      throw new Error("not implemented");
    },
    async savePlayerAccountPrivacyConsent() {
      throw new Error("not implemented");
    },
    async savePlayerAccountAuthSession() {
      return null;
    },
    async loadPlayerAccountAuthSession() {
      return null;
    },
    async listPlayerAccountAuthSessions() {
      return [];
    },
    async touchPlayerAccountAuthSession() {},
    async revokePlayerAccountAuthSession() {
      return false;
    },
    async revokePlayerAccountAuthSessions() {
      return null;
    },
    async bindPlayerAccountWechatMiniGameIdentity() {
      throw new Error("not implemented");
    },
    async deletePlayerAccount() {
      return null;
    },
    async savePlayerAccountProfile() {
      throw new Error("not implemented");
    },
    async savePlayerAccountProgress() {
      throw new Error("not implemented");
    },
    async listPlayerAccounts() {
      return [];
    },
    async save() {},
    async delete() {},
    async pruneExpired() {
      return 0;
    },
    async close() {}
  } as RoomSnapshotStore;
}

function withAdminToken(t: TestContext, token = "season-admin-token"): string {
  const originalAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = token;
  t.after(() => {
    if (originalAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
      return;
    }
    process.env.VEIL_ADMIN_TOKEN = originalAdminToken;
  });
  return token;
}

function registerRoutes(store: RoomSnapshotStore | null) {
  const { app, gets, posts } = createTestApp();
  registerSeasonRoutes(app, store);
  return { gets, posts };
}

test("GET /api/seasons returns closed seasons and caps limit at 100", async () => {
  const calls: SeasonListOptions[] = [];
  const store = createSeasonStore([
    { seasonId: "season-3", status: "closed", startedAt: "2026-03-03T00:00:00.000Z", endedAt: "2026-03-04T00:00:00.000Z" },
    { seasonId: "season-2", status: "closed", startedAt: "2026-02-03T00:00:00.000Z", endedAt: "2026-02-04T00:00:00.000Z" },
    { seasonId: "season-1", status: "active", startedAt: "2026-01-03T00:00:00.000Z" }
  ], calls);
  const { gets } = registerRoutes(store);
  const handler = gets.get("/api/seasons");
  const response = createResponse();

  assert.ok(handler);
  await handler(createRequest({ url: "/api/seasons?limit=999" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [{ status: "closed", limit: 100 }]);
  assert.deepEqual(JSON.parse(response.body), {
    seasons: [
      { seasonId: "season-3", status: "closed", startedAt: "2026-03-03T00:00:00.000Z", endedAt: "2026-03-04T00:00:00.000Z" },
      { seasonId: "season-2", status: "closed", startedAt: "2026-02-03T00:00:00.000Z", endedAt: "2026-02-04T00:00:00.000Z" }
    ]
  });
});

test("GET /api/admin/seasons requires the admin token", async (t) => {
  const token = withAdminToken(t);
  const calls: SeasonListOptions[] = [];
  const store = createSeasonStore([], calls);
  const { gets } = registerRoutes(store);
  const handler = gets.get("/api/admin/seasons");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({ url: "/api/admin/seasons", headers: { "x-veil-admin-token": `${token}-wrong` } }),
    response
  );

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    error: { code: "forbidden", message: "Invalid admin token" }
  });
  assert.deepEqual(calls, []);
});

test("GET /api/admin/seasons supports status=all and caps limit at 100", async (t) => {
  const token = withAdminToken(t);
  const calls: SeasonListOptions[] = [];
  const store = createSeasonStore([
    { seasonId: "season-4", status: "active", startedAt: "2026-04-01T00:00:00.000Z" },
    { seasonId: "season-3", status: "closed", startedAt: "2026-03-01T00:00:00.000Z", endedAt: "2026-03-15T00:00:00.000Z" }
  ], calls);
  const { gets } = registerRoutes(store);
  const handler = gets.get("/api/admin/seasons");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      url: "/api/admin/seasons?status=all&limit=500",
      headers: { "x-veil-admin-token": token }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [{ status: "all", limit: 100 }]);
  assert.deepEqual(JSON.parse(response.body), {
    seasons: [
      { seasonId: "season-4", status: "active", startedAt: "2026-04-01T00:00:00.000Z" },
      { seasonId: "season-3", status: "closed", startedAt: "2026-03-01T00:00:00.000Z", endedAt: "2026-03-15T00:00:00.000Z" }
    ]
  });
});

test("POST /api/admin/seasons/close returns the reward distribution summary", async (t) => {
  const token = withAdminToken(t);
  const store = createSeasonStore([
    { seasonId: "season-9", status: "active", startedAt: "2026-04-01T00:00:00.000Z" }
  ], []);
  const { posts } = registerRoutes(store);
  const handler = posts.get("/api/admin/seasons/close");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      url: "/api/admin/seasons/close",
      headers: { "x-veil-admin-token": token }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    closed: true,
    seasonId: "season-9",
    playersRewarded: 2,
    totalGemsGranted: 75
  });
});

test("POST /api/admin/seasons/create returns 400 for malformed JSON", async (t) => {
  const token = withAdminToken(t);
  const store = createSeasonStore([], []);
  const { posts } = registerRoutes(store);
  const handler = posts.get("/api/admin/seasons/create");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      url: "/api/admin/seasons/create",
      headers: { "x-veil-admin-token": token },
      body: "{\"seasonId\":"
    }),
    response
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), {
    error: {
      code: "invalid_json",
      message: "Request body must be valid JSON"
    }
  });
});

test("POST /api/admin/seasons/create returns 413 when content-length declares a 2 MB body", async (t) => {
  const token = withAdminToken(t);
  const store = createSeasonStore([], []);
  const { posts } = registerRoutes(store);
  const handler = posts.get("/api/admin/seasons/create");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      url: "/api/admin/seasons/create",
      headers: {
        "x-veil-admin-token": token,
        "content-length": String(2 * 1024 * 1024)
      }
    }),
    response
  );

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error.code, "payload_too_large");
});

test("POST /api/admin/seasons/create returns 413 when streamed body exceeds 32 KB", async (t) => {
  const token = withAdminToken(t);
  const store = createSeasonStore([], []);
  const { posts } = registerRoutes(store);
  const handler = posts.get("/api/admin/seasons/create");
  const response = createResponse();

  assert.ok(handler);
  const request = new EventEmitter() as IncomingMessage & EventEmitter;
  Object.assign(request, {
    method: "POST",
    headers: { "x-veil-admin-token": token },
    url: "/api/admin/seasons/create"
  });
  queueMicrotask(() => {
    request.emit("data", Buffer.alloc(33 * 1024, "x"));
    request.emit("end");
  });

  await handler(request, response);

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error.code, "payload_too_large");
});

test("POST /api/admin/seasons/create returns 413 immediately when content-length is oversized without waiting for body stream to end", async (t) => {
  const token = withAdminToken(t);
  const store = createSeasonStore([], []);
  const { posts } = registerRoutes(store);
  const handler = posts.get("/api/admin/seasons/create");
  const response = createResponse();

  assert.ok(handler);

  // Build a stream that never emits "end" — simulates a slow-loris upload.
  // The handler must return 413 before the stream finishes.
  const request = new EventEmitter() as IncomingMessage & EventEmitter;
  Object.assign(request, {
    method: "POST",
    headers: {
      "x-veil-admin-token": token,
      "content-length": String(2 * 1024 * 1024)
    },
    url: "/api/admin/seasons/create",
    resume() {}
  });

  await handler(request, response);

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error.code, "payload_too_large");
});
