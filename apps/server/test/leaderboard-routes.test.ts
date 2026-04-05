import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { addUtcDays, getUtcWeekStart } from "../../../packages/shared/src/index";
import { registerLeaderboardRoutes } from "../src/leaderboard";
import { createMemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

function createTestApp() {
  const gets = new Map<string, RouteHandler>();
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
      }
    },
    gets,
    middlewares
  };
}

function createRequest(options: {
  method?: string;
  headers?: Record<string, string | undefined>;
  url?: string;
} = {}): IncomingMessage {
  const request = {} as IncomingMessage;
  Object.assign(request, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    url: options.url ?? "/"
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

function registerRoutes(store = createMemoryRoomSnapshotStore()) {
  const { app, gets, middlewares } = createTestApp();
  registerLeaderboardRoutes(app, store);
  return { gets, middlewares, store };
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
        promotionSeries: null,
        demotionShield: null
      }
    ]
  });
});

test("leaderboard route middleware responds to OPTIONS and applies CORS headers", async () => {
  const { middlewares } = registerRoutes();
  const response = createResponse();

  assert.equal(middlewares.length, 1);
  await runMiddlewares(middlewares, createRequest({ method: "OPTIONS", url: "/api/leaderboard" }), response);

  assert.equal(response.statusCode, 204);
  assert.equal(response.body, "");
  assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(response.headers["Access-Control-Allow-Methods"], "GET,OPTIONS");
  assert.equal(response.headers["Access-Control-Allow-Headers"], "Content-Type");
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
  assert.equal(response.headers["Access-Control-Allow-Methods"], "GET,OPTIONS");
  assert.equal(response.headers["Access-Control-Allow-Headers"], "Content-Type");
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
      currentWeekWins: 5,
      previousWeekStartsAt,
      previousWeekWins: 1
    }
  });
  await store.ensurePlayerAccount({ playerId: "player-previous", displayName: "Previous Veteran" });
  await store.savePlayerAccountProgress("player-previous", {
    eloRating: 1350,
    rankDivision: "gold_i",
    rankedWeeklyProgress: {
      currentWeekStartsAt,
      currentWeekWins: 0,
      previousWeekStartsAt,
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

test("GET /api/matchmaking/tiers returns the published tier thresholds", async () => {
  const { gets } = registerRoutes();
  const handler = gets.get("/api/matchmaking/tiers");
  const response = createResponse();

  assert.ok(handler);
  await handler(createRequest({ url: "/api/matchmaking/tiers" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    tiers: [
      { tier: "bronze", minRating: 0, maxRating: 1099 },
      { tier: "silver", minRating: 1100, maxRating: 1299 },
      { tier: "gold", minRating: 1300, maxRating: 1499 },
      { tier: "platinum", minRating: 1500, maxRating: 1799 },
      { tier: "diamond", minRating: 1800, maxRating: null }
    ]
  });
});
