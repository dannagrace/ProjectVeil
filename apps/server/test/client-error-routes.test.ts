import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { issueGuestAuthSession } from "@server/domain/account/auth";
import { registerClientErrorRoutes } from "@server/domain/ops/client-error";
import { createFakeRedisRateLimitClient } from "./fake-redis-rate-limit.ts";

interface TestResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function createResponse(): TestResponse {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body = "") {
      this.body = body;
      this.ended = true;
    }
  };
}

function createRequest(method: string, body?: string, headers: Record<string, string> = {}): Readable & {
  method: string;
  headers: Record<string, string>;
  socket: { remoteAddress?: string };
  resume(): void;
} {
  const request = Readable.from(body == null ? [] : [body]) as Readable & {
    method: string;
    headers: Record<string, string>;
    socket: { remoteAddress?: string };
    resume(): void;
  };
  request.method = method;
  request.headers = {
    ...(body == null ? {} : { "content-length": Buffer.byteLength(body).toString() }),
    ...headers
  };
  request.socket = { remoteAddress: "203.0.113.7" };
  request.resume = () => {
    request.read();
  };
  return request;
}

function registerRoute(
  overrides: {
    now?: () => number;
    rateLimitRedisClient?: unknown;
  } = {}
): {
  middleware: (request: never, response: TestResponse, next: () => void) => void;
  handler: (request: never, response: TestResponse) => void | Promise<void>;
  captureCalls: Array<unknown>;
  runtimeEvents: Array<unknown>;
  rateLimitedCount: number;
} {
  let middleware:
    | ((request: never, response: TestResponse, next: () => void) => void)
    | undefined;
  let handler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;
  const captureCalls: Array<unknown> = [];
  const runtimeEvents: Array<unknown> = [];
  let rateLimitedCount = 0;

  registerClientErrorRoutes(
    {
      use(nextMiddleware) {
        middleware = nextMiddleware as never;
      },
      post(path, nextHandler) {
        assert.equal(path, "/api/client-error");
        handler = nextHandler as never;
      }
    },
    null,
    {
      now: overrides.now ?? (() => Date.now()),
      captureClientError: async (input) => {
        captureCalls.push(input);
      },
      recordRuntimeErrorEvent: (input) => {
        runtimeEvents.push(input);
      },
      recordHttpRateLimited: () => {
        rateLimitedCount += 1;
      },
      rateLimitRedisClient: overrides.rateLimitRedisClient as never
    }
  );

  assert(middleware);
  assert(handler);

  return {
    middleware,
    handler,
    captureCalls,
    runtimeEvents,
    get rateLimitedCount() {
      return rateLimitedCount;
    }
  };
}

test("client error route rejects invalid payloads", async () => {
  const { middleware, handler, captureCalls, runtimeEvents } = registerRoute();
  const request = createRequest("POST", JSON.stringify({ version: "1.2.3", errorMessage: "boom" }));
  const response = createResponse();

  let nextCalled = false;
  middleware(request as never, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  await handler(request as never, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), {
    error: {
      code: "invalid_client_error_payload",
      message: "platform must be a string"
    }
  });
  assert.equal(captureCalls.length, 0);
  assert.equal(runtimeEvents.length, 0);
});

test("client error route forwards authenticated reports into monitoring", async () => {
  const { handler, captureCalls, runtimeEvents } = registerRoute({ now: () => Date.parse("2026-04-12T12:00:00.000Z") });
  const session = issueGuestAuthSession({ playerId: "player-42", displayName: "Ranger" });
  const request = createRequest(
    "POST",
    JSON.stringify({
      platform: "cocos",
      version: "1.2.3",
      errorMessage: "UI exploded",
      stack: "TypeError: UI exploded\n at battle.ts:42:3",
      context: {
        scene: "battle",
        roomId: "room-9"
      }
    }),
    {
      authorization: `Bearer ${session.token}`
    }
  );
  const response = createResponse();

  await handler(request as never, response);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { accepted: true });
  assert.equal(captureCalls.length, 1);
  assert.deepEqual(captureCalls[0], {
    platform: "cocos",
    version: "1.2.3",
    errorMessage: "UI exploded",
    stack: "TypeError: UI exploded\n at battle.ts:42:3",
    authenticated: true,
    context: {
      playerId: "player-42",
      requestId: null,
      clientVersion: "1.2.3",
      detail: JSON.stringify({
        scene: "battle",
        roomId: "room-9"
      })
    }
  });
  assert.equal(runtimeEvents.length, 1);
  assert.deepEqual(runtimeEvents[0], {
    id: runtimeEvents[0] && typeof runtimeEvents[0] === "object" ? (runtimeEvents[0] as { id: string }).id : null,
    recordedAt: "2026-04-12T12:00:00.000Z",
    source: "client",
    surface: "client-error-report",
    candidateRevision: null,
    featureArea: "runtime",
    ownerArea: "client",
    severity: "error",
    errorCode: "client_error_boundary_triggered",
    message: "UI exploded",
    context: {
      roomId: null,
      playerId: "player-42",
      requestId: null,
      route: "/api/client-error",
      action: "cocos",
      statusCode: null,
      crash: true,
      detail: JSON.stringify({
        scene: "battle",
        roomId: "room-9"
      })
    },
    tags: ["cocos", "1.2.3", "authenticated"]
  });
});

test("client error route rate limits repeated reports per player and ip", async () => {
  const originalWindow = process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS;
  const originalPlayerMax = process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_PLAYER_MAX;
  const originalIpMax = process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_IP_MAX;
  process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS = "60000";
  process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_PLAYER_MAX = "1";
  process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_IP_MAX = "2";

  try {
    const route = registerRoute({ now: () => Date.parse("2026-04-12T12:00:00.000Z") });
    const session = issueGuestAuthSession({ playerId: "player-7", displayName: "Knight" });
    const requestBody = JSON.stringify({
      platform: "h5",
      version: "9.9.9",
      errorMessage: "render failed"
    });

    const firstResponse = createResponse();
    await route.handler(
      createRequest("POST", requestBody, {
        authorization: `Bearer ${session.token}`
      }) as never,
      firstResponse
    );
    assert.equal(firstResponse.statusCode, 202);

    const secondResponse = createResponse();
    await route.handler(
      createRequest("POST", requestBody, {
        authorization: `Bearer ${session.token}`
      }) as never,
      secondResponse
    );

    assert.equal(secondResponse.statusCode, 429);
    assert.equal(secondResponse.headers["Retry-After"], "60");
    assert.deepEqual(JSON.parse(secondResponse.body), {
      error: {
        code: "rate_limited",
        message: "Too many client error reports, please retry later"
      }
    });
    assert.equal(route.rateLimitedCount, 1);
    assert.equal(route.captureCalls.length, 1);
  } finally {
    if (originalWindow === undefined) {
      delete process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS;
    } else {
      process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS = originalWindow;
    }

    if (originalPlayerMax === undefined) {
      delete process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_PLAYER_MAX;
    } else {
      process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_PLAYER_MAX = originalPlayerMax;
    }

    if (originalIpMax === undefined) {
      delete process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_IP_MAX;
    } else {
      process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_IP_MAX = originalIpMax;
    }
  }
});

test("client error rate limits are shared through Redis across route instances", async () => {
  const originalWindow = process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS;
  const originalPlayerMax = process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_PLAYER_MAX;
  const originalIpMax = process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_IP_MAX;
  process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS = "60000";
  process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_PLAYER_MAX = "1";
  process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_IP_MAX = "10";

  try {
    const now = () => Date.parse("2026-04-12T12:00:00.000Z");
    const redis = createFakeRedisRateLimitClient(now);
    const firstRoute = registerRoute({ now, rateLimitRedisClient: redis });
    const secondRoute = registerRoute({ now, rateLimitRedisClient: redis });
    const session = issueGuestAuthSession({ playerId: "shared-client-error-player", displayName: "Shared Error" });
    const requestBody = JSON.stringify({
      platform: "h5",
      version: "9.9.9",
      errorMessage: "render failed"
    });

    const firstResponse = createResponse();
    await firstRoute.handler(
      createRequest("POST", requestBody, {
        authorization: `Bearer ${session.token}`
      }) as never,
      firstResponse
    );
    assert.equal(firstResponse.statusCode, 202);

    const secondResponse = createResponse();
    await secondRoute.handler(
      createRequest("POST", requestBody, {
        authorization: `Bearer ${session.token}`
      }) as never,
      secondResponse
    );

    assert.equal(secondResponse.statusCode, 429);
    assert.equal(secondResponse.headers["Retry-After"], "60");
    assert.deepEqual(JSON.parse(secondResponse.body), {
      error: {
        code: "rate_limited",
        message: "Too many client error reports, please retry later"
      }
    });
    assert.equal(secondRoute.rateLimitedCount, 1);
  } finally {
    if (originalWindow === undefined) {
      delete process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS;
    } else {
      process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS = originalWindow;
    }

    if (originalPlayerMax === undefined) {
      delete process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_PLAYER_MAX;
    } else {
      process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_PLAYER_MAX = originalPlayerMax;
    }

    if (originalIpMax === undefined) {
      delete process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_IP_MAX;
    } else {
      process.env.VEIL_RATE_LIMIT_CLIENT_ERROR_IP_MAX = originalIpMax;
    }
  }
});
