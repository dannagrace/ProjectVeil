import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { type TestContext } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { addUtcDays, getUtcWeekStart } from "@veil/shared/progression";
import { registerLeaderboardRoutes } from "@server/domain/social/leaderboard";
import { createMemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { DEFAULT_LEADERBOARD_TIER_THRESHOLDS } from "@server/domain/social/leaderboard-tier-thresholds";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

function createTestApp() {
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();
  const middlewares: Array<
    (request: IncomingMessage, response: ServerResponse, next: () => void) => void
  > = [];

  return {
    app: {
      use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) {
        middlewares.push(handler);
      },
      get(path: string, handler: RouteHandler) {
        gets.set(path, handler);
      },
      post(path: string, handler: RouteHandler) {
        posts.set(path, handler);
      }
    },
    gets,
    posts,
    middlewares
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

async function runMiddlewares(
  middlewares: Array<(request: IncomingMessage, response: ServerResponse, next: () => void) => void>,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  let index = 0;

  const next = async () => {
    const middleware = middlewares[index++];
    if (!middleware) {
      return;
    }
    await middleware(request, response, () => {
      void next();
    });
  };

  await next();
}

function registerRoutes(
  store = createMemoryRoomSnapshotStore(),
  configCenterStore?: {
    loadDocument(id: "leaderboardTierThresholds"): Promise<{ content: string }>;
  }
) {
  const { app, gets, posts, middlewares } = createTestApp();
  registerLeaderboardRoutes(app, store, configCenterStore);
  return { gets, posts, middlewares, store };
}

function withAdminToken(t: TestContext, token = "leaderboard-admin-token"): string {
  const original = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = token;
  t.after(() => {
    if (original === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
    } else {
      process.env.VEIL_ADMIN_TOKEN = original;
    }
  });
  return token;
}

test("GET /api/leaderboard returns ranked players in elo order with competitive progression fields", async () => {
  const { gets, store } = registerRoutes();
  const handler = gets.get("/api/leaderboard");
  const response = createResponse();

  await store.ensurePlayerAccount({ playerId: "player-low", displayName: "Low Tide" });
  await store.savePlayerAccountProgress("player-low", {
    eloRating: 1050,
    rankDivision: "bronze_i"
  });
  await store.ensurePlayerAccount({ playerId: "player-high", displayName: "High Tide" });
  await store.savePlayerAccountProgress("player-high", {
    eloRating: 1650,
    rankDivision: "platinum_i",
    promotionSeries: {
      targetDivision: "platinum_i",
      wins: 2,
      losses: 1,
      winsRequired: 3,
      lossesAllowed: 2
    },
    demotionShield: {
      tier: "platinum",
      remainingMatches: 2
    }
  });

  assert.ok(handler);
  await handler(createRequest({ url: "/api/leaderboard?limit=999" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    players: [
      {
        playerId: "player-high",
        displayName: "High Tide",
        eloRating: 1650,
        tier: "platinum",
        division: "platinum_i",
        isFrozen: false,
        promotionSeries: {
          targetDivision: "platinum_i",
          wins: 2,
          losses: 1,
          winsRequired: 3,
          lossesAllowed: 2
        },
        demotionShield: {
          tier: "platinum",
          remainingMatches: 2
        }
      },
      {
        playerId: "player-low",
        displayName: "Low Tide",
        eloRating: 1050,
        tier: "bronze",
        division: "bronze_i",
        isFrozen: false,
        promotionSeries: null,
        demotionShield: null
      }
    ]
  });
});

test("GET /api/leaderboard hides removed players and marks frozen players", async () => {
  const { gets, store } = registerRoutes();
  const handler = gets.get("/api/leaderboard");
  const response = createResponse();

  await store.ensurePlayerAccount({ playerId: "player-visible", displayName: "Visible" });
  await store.savePlayerAccountProgress("player-visible", {
    eloRating: 1510,
    rankDivision: "platinum_i",
    leaderboardModerationState: {
      frozenAt: "2026-04-11T08:00:00.000Z",
      frozenByPlayerId: "support-moderator:admin-console"
    }
  });
  await store.ensurePlayerAccount({ playerId: "player-hidden", displayName: "Hidden" });
  await store.savePlayerAccountProgress("player-hidden", {
    eloRating: 1800,
    rankDivision: "diamond_i",
    leaderboardModerationState: {
      hiddenAt: "2026-04-11T08:05:00.000Z",
      hiddenByPlayerId: "support-moderator:admin-console"
    }
  });

  assert.ok(handler);
  await handler(createRequest({ url: "/api/leaderboard" }), response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    players: Array<{
      playerId: string;
      displayName: string;
      eloRating: number;
      tier: string;
      division: string;
      isFrozen: boolean;
    }>;
  };
  assert.equal(payload.players.length, 1);
  assert.equal(payload.players[0]?.playerId, "player-visible");
  assert.equal(payload.players[0]?.displayName, "Visible");
  assert.equal(payload.players[0]?.eloRating, 1510);
  assert.equal(payload.players[0]?.tier, "platinum");
  assert.equal(payload.players[0]?.division, "platinum_i");
  assert.equal(payload.players[0]?.isFrozen, true);
});

test("leaderboard route middleware responds to OPTIONS and applies CORS headers", async () => {
  const { middlewares } = registerRoutes();
  const response = createResponse();

  assert.equal(middlewares.length, 1);
  await runMiddlewares(middlewares, createRequest({ method: "OPTIONS", url: "/api/leaderboard" }), response);

  assert.equal(response.statusCode, 204);
  assert.equal(response.body, "");
  assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(response.headers["Access-Control-Allow-Methods"], "GET,POST,OPTIONS");
  assert.equal(response.headers["Access-Control-Allow-Headers"], "Content-Type,X-Veil-Admin-Token");
});

test("leaderboard route middleware continues non-OPTIONS requests after applying CORS headers", async () => {
  const { middlewares } = registerRoutes();
  const response = createResponse();
  let nextCalled = false;

  assert.equal(middlewares.length, 1);
  await middlewares[0]!(
    createRequest({ method: "GET", url: "/api/leaderboard" }),
    response,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(response.headers["Access-Control-Allow-Methods"], "GET,POST,OPTIONS");
  assert.equal(response.headers["Access-Control-Allow-Headers"], "Content-Type,X-Veil-Admin-Token");
});

test("GET /api/leaderboard returns a 500 payload when the store listing fails", async () => {
  const { gets, store } = registerRoutes();
  const handler = gets.get("/api/leaderboard");
  const response = createResponse();

  store.listPlayerAccounts = async () => {
    throw new Error("leaderboard_unavailable");
  };

  assert.ok(handler);
  await handler(createRequest({ url: "/api/leaderboard" }), response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), {
    error: {
      code: "Error",
      message: "leaderboard_unavailable"
    }
  });
});

test("GET /api/leaderboard returns an empty list when no snapshot store is configured", async () => {
  const { gets } = registerRoutes(null);
  const handler = gets.get("/api/leaderboard");
  const response = createResponse();

  assert.ok(handler);
  await handler(createRequest({ url: "/api/leaderboard?limit=0" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { players: [] });
});

test("GET /api/leaderboard/weekly returns current and previous weekly standings", async () => {
  const { gets, store } = registerRoutes();
  const handler = gets.get("/api/leaderboard/weekly");
  const response = createResponse();
  const currentWeekStartsAt = getUtcWeekStart();
  const previousWeekStartsAt = addUtcDays(currentWeekStartsAt, -7);

  await store.ensurePlayerAccount({ playerId: "player-current", displayName: "Current Climber" });
  await store.savePlayerAccountProgress("player-current", {
    eloRating: 1420,
    rankDivision: "gold_i",
    rankedWeeklyProgress: {
      currentWeekStartsAt,
      currentWeekBattles: 5,
      currentWeekWins: 5,
      previousWeekStartsAt,
      previousWeekBattles: 1,
      previousWeekWins: 1
    }
  });
  await store.ensurePlayerAccount({ playerId: "player-previous", displayName: "Previous Veteran" });
  await store.savePlayerAccountProgress("player-previous", {
    eloRating: 1350,
    rankDivision: "gold_i",
    rankedWeeklyProgress: {
      currentWeekStartsAt,
      currentWeekBattles: 1,
      currentWeekWins: 0,
      previousWeekStartsAt,
      previousWeekBattles: 4,
      previousWeekWins: 4
    }
  });
  await store.ensurePlayerAccount({ playerId: "player-idle", displayName: "Idle Scout" });

  assert.ok(handler);
  await handler(createRequest({ url: "/api/leaderboard/weekly" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    current: [
      {
        playerId: "player-current",
        displayName: "Current Climber",
        wins: 5,
        weekStartsAt: currentWeekStartsAt,
        weekEndsAt: addUtcDays(currentWeekStartsAt, 7),
        rankDivision: "gold_i"
      }
    ],
    previous: [
      {
        playerId: "player-previous",
        displayName: "Previous Veteran",
        wins: 4,
        weekStartsAt: previousWeekStartsAt,
        weekEndsAt: currentWeekStartsAt,
        rankDivision: "gold_i"
      },
      {
        playerId: "player-current",
        displayName: "Current Climber",
        wins: 1,
        weekStartsAt: previousWeekStartsAt,
        weekEndsAt: currentWeekStartsAt,
        rankDivision: "gold_i"
      }
    ]
  });
});

test("GET /api/leaderboard/weekly returns empty standings when no snapshot store is configured", async () => {
  const { gets } = registerRoutes(null);
  const handler = gets.get("/api/leaderboard/weekly");
  const response = createResponse();

  assert.ok(handler);
  await handler(createRequest({ url: "/api/leaderboard/weekly" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    current: [],
    previous: []
  });
});

test("GET /api/leaderboard/weekly returns a 500 payload when weekly standings cannot be listed", async () => {
  const { gets, store } = registerRoutes();
  const handler = gets.get("/api/leaderboard/weekly");
  const response = createResponse();

  store.listPlayerAccounts = async () => {
    throw new Error("weekly_leaderboard_unavailable");
  };

  assert.ok(handler);
  await handler(createRequest({ url: "/api/leaderboard/weekly" }), response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), {
    error: {
      code: "Error",
      message: "weekly_leaderboard_unavailable"
    }
  });
});

test("GET /api/player/:id/season-history returns an empty history when no snapshot store is configured", async () => {
  const { gets } = registerRoutes(null);
  const handler = gets.get("/api/player/:id/season-history");
  const response = createResponse();

  assert.ok(handler);
  await handler(createRequest({ url: "/api/player/player-seasonal/season-history" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { history: [] });
});

test("GET /api/player/:id/season-history returns the requested player's archived seasons", async () => {
  const { gets, store } = registerRoutes();
  const handler = gets.get("/api/player/:id/season-history");
  const response = createResponse();

  await store.ensurePlayerAccount({ playerId: "player-seasonal", displayName: "Seasoned" });
  await store.savePlayerAccountProgress("player-seasonal", {
    eloRating: 1510,
    rankDivision: "platinum_i",
    seasonHistory: [
      {
        seasonId: "season-2",
        finalRating: 1520,
        peakRating: 1580,
        peakDivision: "platinum_i",
        finalDivision: "gold_iii",
        rewardTier: "gold",
        rankPercentile: 0.18,
        rewardsGrantedAt: "2026-03-01T00:00:00.000Z"
      }
    ]
  });

  assert.ok(handler);
  await handler(createRequest({ url: "/api/player/player-seasonal/season-history" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    history: [
      {
        seasonId: "season-2",
        finalRating: 1520,
        peakRating: 1580,
        peakDivision: "platinum_i",
        finalDivision: "gold_iii",
        rewardTier: "gold",
        rankPercentile: 0.18,
        rewardsGrantedAt: "2026-03-01T00:00:00.000Z"
      }
    ]
  });
});

test("GET /api/player/:id/season-history rejects requests without a player id", async () => {
  const { gets } = registerRoutes();
  const handler = gets.get("/api/player/:id/season-history");
  const response = createResponse();

  assert.ok(handler);
  await handler(createRequest({ url: "/api/player//season-history" }), response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), {
    error: {
      code: "invalid_player_id",
      message: "Player id is required"
    }
  });
});

test("GET /api/player/:id/season-history returns a 500 payload when loading the player account fails", async () => {
  const { gets, store } = registerRoutes();
  const handler = gets.get("/api/player/:id/season-history");
  const response = createResponse();

  store.loadPlayerAccount = async () => {
    throw new Error("season_history_unavailable");
  };

  assert.ok(handler);
  await handler(createRequest({ url: "/api/player/player-seasonal/season-history" }), response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), {
    error: {
      code: "Error",
      message: "season_history_unavailable"
    }
  });
});

test("GET /api/leaderboard/seasons/:seasonId returns archived rankings for the requested season", async () => {
  const { gets, store } = registerRoutes();
  const handler = gets.get("/api/leaderboard/seasons/:seasonId");
  const response = createResponse();

  await store.ensurePlayerAccount({ playerId: "player-1", displayName: "Alpha" });
  await store.savePlayerAccountProgress("player-1", { eloRating: 1650, rankDivision: "platinum_i" });
  await store.ensurePlayerAccount({ playerId: "player-2", displayName: "Beta" });
  await store.savePlayerAccountProgress("player-2", { eloRating: 1400, rankDivision: "gold_i" });
  await store.createSeason("season-archive");
  await store.closeSeason("season-archive");

  assert.ok(handler);
  await handler(createRequest({ url: "/api/leaderboard/seasons/season-archive?limit=1" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    seasonId: "season-archive",
    rankings: [
      {
        seasonId: "season-archive",
        rank: 1,
        playerId: "player-1",
        displayName: "Alpha",
        finalRating: 1650,
        tier: "platinum",
        archivedAt: JSON.parse(response.body).rankings[0].archivedAt
      }
    ]
  });
});

test("POST /api/admin/leaderboard/season-rollover closes the current season, archives standings, and starts the next one", async (t) => {
  const token = withAdminToken(t);
  const { posts, store } = registerRoutes();
  const handler = posts.get("/api/admin/leaderboard/season-rollover");
  const response = createResponse();

  await store.ensurePlayerAccount({ playerId: "player-1", displayName: "Alpha" });
  await store.savePlayerAccountProgress("player-1", {
    eloRating: 1650,
    rankDivision: "platinum_i",
    peakRankDivision: "diamond_i"
  });
  await store.ensurePlayerAccount({ playerId: "player-2", displayName: "Beta" });
  await store.savePlayerAccountProgress("player-2", {
    eloRating: 1400,
    rankDivision: "gold_i"
  });
  await store.createSeason("season-9");

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      url: "/api/admin/leaderboard/season-rollover",
      headers: { "x-veil-admin-token": token },
      body: JSON.stringify({ seasonId: "season-9", nextSeasonId: "season-10" })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    rolledOver: boolean;
    nextSeason: { seasonId: string; status: string };
    summary: { seasonId: string; playersRewarded: number };
    archive: Array<{ playerId: string; rank: number }>;
  };
  assert.equal(payload.rolledOver, true);
  assert.equal(payload.summary.seasonId, "season-9");
  assert.equal(payload.nextSeason.seasonId, "season-10");
  assert.equal(payload.nextSeason.status, "active");
  assert.deepEqual(payload.archive.map((entry) => [entry.rank, entry.playerId]), [
    [1, "player-1"],
    [2, "player-2"]
  ]);

  const firstAccount = await store.loadPlayerAccount("player-1");
  assert.equal(firstAccount?.seasonHistory?.[0]?.seasonId, "season-9");
  assert.equal(firstAccount?.seasonHistory?.[0]?.rankPosition, 1);
  assert.equal(firstAccount?.seasonHistory?.[0]?.finalRating, 1650);
  assert.equal(firstAccount?.seasonHistory?.[0]?.totalPlayers, 2);
  assert.equal(firstAccount?.seasonHistory?.[0]?.rewardClaimed, true);
  assert.equal(firstAccount?.eloRating, 1300);
  assert.equal((await store.getCurrentSeason())?.seasonId, "season-10");
});

test("POST /api/admin/leaderboard/season-rollover is idempotent for the same season pair", async (t) => {
  const token = withAdminToken(t);
  const { posts, store } = registerRoutes();
  const handler = posts.get("/api/admin/leaderboard/season-rollover");

  await store.ensurePlayerAccount({ playerId: "player-1", displayName: "Alpha" });
  await store.savePlayerAccountProgress("player-1", {
    eloRating: 1650,
    rankDivision: "platinum_i"
  });
  await store.createSeason("season-11");

  assert.ok(handler);
  const firstResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      url: "/api/admin/leaderboard/season-rollover",
      headers: { "x-veil-admin-token": token },
      body: JSON.stringify({ seasonId: "season-11", nextSeasonId: "season-12" })
    }),
    firstResponse
  );
  const secondResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      url: "/api/admin/leaderboard/season-rollover",
      headers: { "x-veil-admin-token": token },
      body: JSON.stringify({ seasonId: "season-11", nextSeasonId: "season-12" })
    }),
    secondResponse
  );

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  const secondPayload = JSON.parse(secondResponse.body) as {
    rolledOver: boolean;
    summary: { playersRewarded: number; totalGemsGranted: number };
    nextSeason: { seasonId: string };
    archive: Array<{ playerId: string }>;
  };
  assert.equal(secondPayload.rolledOver, false);
  assert.deepEqual(secondPayload.summary, {
    seasonId: "season-11",
    playersRewarded: 0,
    totalGemsGranted: 0
  });
  assert.equal(secondPayload.nextSeason.seasonId, "season-12");
  assert.deepEqual(secondPayload.archive.map((entry) => entry.playerId), ["player-1"]);
  assert.equal((await store.getCurrentSeason())?.seasonId, "season-12");
});

test("GET /api/matchmaking/tiers returns the published tier thresholds", async () => {
  const { gets } = registerRoutes();
  const handler = gets.get("/api/matchmaking/tiers");
  const response = createResponse();

  assert.ok(handler);
  await handler(createRequest({ url: "/api/matchmaking/tiers" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    tiers: DEFAULT_LEADERBOARD_TIER_THRESHOLDS
  });
});

test("leaderboard routes load tier thresholds from config-center at initialization", async () => {
  const { gets } = registerRoutes(createMemoryRoomSnapshotStore(), {
    async loadDocument() {
      return {
        content: JSON.stringify({
          key: "leaderboard.tier_thresholds",
          tiers: [
            { tier: "bronze", minRating: 0, maxRating: 999 },
            { tier: "silver", minRating: 1000, maxRating: 1199 },
            { tier: "gold", minRating: 1200, maxRating: 1399 },
            { tier: "platinum", minRating: 1400, maxRating: 1599 },
            { tier: "diamond", minRating: 1600 }
          ]
        })
      };
    }
  });
  const handler = gets.get("/api/matchmaking/tiers");
  const response = createResponse();

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(handler);
  await handler(createRequest({ url: "/api/matchmaking/tiers" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    tiers: [
      { tier: "bronze", minRating: 0, maxRating: 999 },
      { tier: "silver", minRating: 1000, maxRating: 1199 },
      { tier: "gold", minRating: 1200, maxRating: 1399 },
      { tier: "platinum", minRating: 1400, maxRating: 1599 },
      { tier: "diamond", minRating: 1600, maxRating: null }
    ]
  });
});

test("POST /api/admin/leaderboard/season-rollover returns 413 when content-length declares a 2 MB body", async (t) => {
  const token = withAdminToken(t);
  const { posts, store } = registerRoutes();
  const handler = posts.get("/api/admin/leaderboard/season-rollover");
  await store.createSeason("season-413");

  assert.ok(handler);
  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      url: "/api/admin/leaderboard/season-rollover",
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

test("POST /api/admin/leaderboard/season-rollover returns 413 when streamed body exceeds 32 KB", async (t) => {
  const token = withAdminToken(t);
  const { posts, store } = registerRoutes();
  const handler = posts.get("/api/admin/leaderboard/season-rollover");
  await store.createSeason("season-413-stream");

  assert.ok(handler);
  const response = createResponse();
  const request = new EventEmitter() as IncomingMessage & EventEmitter;
  Object.assign(request, {
    method: "POST",
    headers: { "x-veil-admin-token": token },
    url: "/api/admin/leaderboard/season-rollover"
  });
  queueMicrotask(() => {
    request.emit("data", Buffer.alloc(33 * 1024, "x"));
    request.emit("end");
  });

  await handler(request, response);

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error.code, "payload_too_large");
});

test("POST /api/admin/leaderboard/season-rollover returns 413 immediately when content-length is oversized without waiting for body stream to end", async (t) => {
  const token = withAdminToken(t);
  const { posts, store } = registerRoutes();
  const handler = posts.get("/api/admin/leaderboard/season-rollover");
  await store.createSeason("season-413-fast");

  assert.ok(handler);
  const response = createResponse();

  // Build a stream that never emits "end" — simulates a slow-loris upload.
  // The handler must return 413 before the stream finishes.
  const request = new EventEmitter() as IncomingMessage & EventEmitter;
  Object.assign(request, {
    method: "POST",
    headers: {
      "x-veil-admin-token": token,
      "content-length": String(2 * 1024 * 1024)
    },
    url: "/api/admin/leaderboard/season-rollover",
    resume() {}
  });

  await handler(request, response);

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error.code, "payload_too_large");
});
