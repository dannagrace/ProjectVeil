import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test, { afterEach } from "node:test";
import {
  configureAnalyticsPipelineCounterStore,
  createRedisAnalyticsPipelineCounterStore,
  configureAnalyticsRuntimeDependencies,
  emitAnalyticsEvent,
  flushAnalyticsEventsForTest,
  getAnalyticsPipelineSnapshot,
  registerAnalyticsRoutes,
  resetAnalyticsRuntimeDependencies
} from "@server/domain/ops/analytics";
import { issueGuestAuthSession, resetGuestAuthSessions } from "@server/domain/account/auth";
import { createFakeRedisRateLimitClient } from "./fake-redis-rate-limit.ts";

function createFakeAnalyticsRedisClient(): {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
} {
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();

  const readHash = (key: string): Map<string, string> => {
    let hash = hashes.get(key);
    if (!hash) {
      hash = new Map();
      hashes.set(key, hash);
    }
    return hash;
  };

  return {
    async eval(_script, numKeys, ...args) {
      const keys = args.slice(0, numKeys);
      const argv = args.slice(numKeys);
      const command = argv[0];
      if (command === "record") {
        const [totalsKey, ingestedKey, flushedKey, eventKeysKey] = keys;
        const [_command, ingestedTotal, flushedTotal, flushBatchesTotal, flushFailuresTotal, lastFlushAt, lastErrorAt, lastErrorMessage, eventsJson] = argv;
        const totals = readHash(totalsKey ?? "");
        const addNumber = (field: string, value: string | undefined) => {
          const amount = Number(value ?? "0");
          if (amount > 0) {
            totals.set(field, String(Number(totals.get(field) ?? "0") + amount));
          }
        };
        addNumber("ingestedEventsTotal", ingestedTotal);
        addNumber("flushedEventsTotal", flushedTotal);
        addNumber("flushBatchesTotal", flushBatchesTotal);
        addNumber("flushFailuresTotal", flushFailuresTotal);
        if (lastFlushAt) {
          totals.set("lastFlushAt", lastFlushAt);
        }
        if (lastErrorAt) {
          totals.set("lastErrorAt", lastErrorAt);
        }
        if (lastErrorMessage) {
          totals.set("lastErrorMessage", lastErrorMessage);
        } else if (lastFlushAt) {
          totals.delete("lastErrorAt");
          totals.delete("lastErrorMessage");
        }
        const ingested = readHash(ingestedKey ?? "");
        const flushed = readHash(flushedKey ?? "");
        const eventKeys = sets.get(eventKeysKey ?? "") ?? new Set<string>();
        sets.set(eventKeysKey ?? "", eventKeys);
        const events = JSON.parse(eventsJson ?? "[]") as Array<{ key: string; ingested: number; flushed: number }>;
        for (const event of events) {
          eventKeys.add(event.key);
          if (event.ingested > 0) {
            ingested.set(event.key, String(Number(ingested.get(event.key) ?? "0") + event.ingested));
          }
          if (event.flushed > 0) {
            flushed.set(event.key, String(Number(flushed.get(event.key) ?? "0") + event.flushed));
          }
        }
        return "OK";
      }
      if (command === "snapshot") {
        const [totalsKey, ingestedKey, flushedKey, eventKeysKey] = keys;
        const totals = readHash(totalsKey ?? "");
        const eventKeys = Array.from(sets.get(eventKeysKey ?? "") ?? new Set<string>()).sort();
        const ingested = readHash(ingestedKey ?? "");
        const flushed = readHash(flushedKey ?? "");
        return [
          totals.get("ingestedEventsTotal") ?? "0",
          totals.get("flushedEventsTotal") ?? "0",
          totals.get("flushBatchesTotal") ?? "0",
          totals.get("flushFailuresTotal") ?? "0",
          totals.get("lastFlushAt") ?? "",
          totals.get("lastErrorAt") ?? "",
          totals.get("lastErrorMessage") ?? "",
          JSON.stringify(eventKeys.map((key) => [key, ingested.get(key) ?? "0", flushed.get(key) ?? "0"]))
        ];
      }
      throw new Error(`unexpected eval command: ${command}`);
    }
  };
}

afterEach(() => {
  resetAnalyticsRuntimeDependencies();
  resetGuestAuthSessions();
});

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
} {
  const request = Readable.from(body == null ? [] : [body]) as Readable & {
    method: string;
    headers: Record<string, string>;
  };
  request.method = method;
  request.headers = {
    ...headers,
    ...(body == null ? {} : { "content-length": Buffer.byteLength(body).toString() })
  };
  return request;
}

function capturePublicAnalyticsPostHandler(options: Record<string, unknown> = {}): (
  request: never,
  response: TestResponse
) => void | Promise<void> {
  let handler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;

  registerAnalyticsRoutes(
    {
      use() {},
      get() {},
      post(path, nextHandler) {
        if (path === "/api/analytics/events") {
          handler = nextHandler as never;
        }
      }
    },
    options as never
  );

  assert(handler);
  return handler;
}

async function postEmptyAnalyticsBatch(
  handler: (request: never, response: TestResponse) => void | Promise<void>,
  token: string
): Promise<TestResponse> {
  const response = createResponse();
  await handler(
    createRequest("POST", JSON.stringify({ events: [] }), {
      authorization: `Bearer ${token}`
    }) as never,
    response
  );
  return response;
}

test("registerAnalyticsRoutes keeps test capture routes disabled by default", () => {
  const getPaths: string[] = [];
  const postPaths: string[] = [];

  registerAnalyticsRoutes({
    use() {},
    get(path) {
      getPaths.push(path);
    },
    post(path) {
      postPaths.push(path);
    }
  });

  assert.deepEqual(getPaths, []);
  assert.deepEqual(postPaths, ["/api/analytics/events"]);
});

test("registerAnalyticsRoutes accepts analytics batches and logs the payload when test capture routes are enabled", async (t) => {
  let middleware:
    | ((request: never, response: TestResponse, next: () => void) => void)
    | undefined;
  let getHandler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;
  let testCaptureHandler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;
  let handler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;
  const logs: string[] = [];
  const originalAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = "analytics-test-admin";
  t.after(() => {
    if (originalAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
    } else {
      process.env.VEIL_ADMIN_TOKEN = originalAdminToken;
    }
  });

  configureAnalyticsRuntimeDependencies({
    log: (message) => {
      logs.push(message);
    }
  });

  const getPaths: string[] = [];
  const postPaths: string[] = [];

  registerAnalyticsRoutes(
    {
      use(nextMiddleware) {
        middleware = nextMiddleware as never;
      },
      get(path, nextHandler) {
        getPaths.push(path);
        getHandler = nextHandler as never;
      },
      post(path, nextHandler) {
        postPaths.push(path);
        if (path === "/api/test/analytics/events") {
          testCaptureHandler = nextHandler as never;
          return;
        }
        handler = nextHandler as never;
      }
    },
    { enableTestRoutes: true }
  );

  assert(middleware);
  assert(getHandler);
  assert(testCaptureHandler);
  assert(handler);
  assert.deepEqual(getPaths, ["/api/test/analytics/events"]);
  assert.deepEqual(postPaths, ["/api/test/analytics/events", "/api/analytics/events"]);

  const requestBody = JSON.stringify({
    schemaVersion: 1,
    emittedAt: "2026-04-05T00:00:00.000Z",
    events: [{ name: "shop_open", playerId: "spoofed-player" }, { name: "battle_start" }]
  });
  const session = issueGuestAuthSession({ playerId: "player-1", displayName: "Veil Ranger" });
  const request = createRequest("POST", requestBody, {
    authorization: `Bearer ${session.token}`
  });
  const response = createResponse();

  let nextCalled = false;
  middleware(request as never, response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  await handler(request as never, response);

  assert.equal(response.statusCode, 202);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.deepEqual(JSON.parse(response.body), { accepted: 2 });
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /^\[Analytics\] accepted 2 event\(s\) into stdout sink$/);

  const getResponse = createResponse();
  await getHandler(
    createRequest("GET", undefined, {
      "x-veil-admin-token": "analytics-test-admin"
    }) as never,
    getResponse
  );

  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(getResponse.body), {
    events: [{ name: "shop_open", playerId: "player-1" }, { name: "battle_start", playerId: "player-1" }]
  });
});

test("registerAnalyticsRoutes protects test analytics capture routes with the admin token", async (t) => {
  let getHandler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;
  let testCaptureHandler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;
  const originalAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = "analytics-test-admin";
  t.after(() => {
    if (originalAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
    } else {
      process.env.VEIL_ADMIN_TOKEN = originalAdminToken;
    }
  });

  registerAnalyticsRoutes(
    {
      use() {},
      get(_path, nextHandler) {
        getHandler = nextHandler as never;
      },
      post(path, nextHandler) {
        if (path === "/api/test/analytics/events") {
          testCaptureHandler = nextHandler as never;
        }
      }
    },
    { enableTestRoutes: true }
  );

  assert(getHandler);
  assert(testCaptureHandler);

  const getResponse = createResponse();
  await getHandler(createRequest("GET") as never, getResponse);
  assert.equal(getResponse.statusCode, 403);
  assert.equal(JSON.parse(getResponse.body).error.code, "forbidden");

  const postResponse = createResponse();
  await testCaptureHandler(createRequest("POST", JSON.stringify({ events: [] })) as never, postResponse);
  assert.equal(postResponse.statusCode, 403);
  assert.equal(JSON.parse(postResponse.body).error.code, "forbidden");
});

test("registerAnalyticsRoutes rejects public analytics ingest without an auth session", async () => {
  let handler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;

  registerAnalyticsRoutes({
    use() {},
    get() {},
    post(_path, nextHandler) {
      handler = nextHandler as never;
    }
  });

  assert(handler);

  const request = createRequest("POST", JSON.stringify({ events: [{ name: "session_start" }] }));
  const response = createResponse();

  await handler(request as never, response);

  assert.equal(response.statusCode, 401);
  assert.match(response.body, /Analytics ingestion requires an authenticated player session/);
});

test("registerAnalyticsRoutes queues accepted events for the configured analytics sink", async () => {
  let handler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const originalAnalyticsSink = process.env.ANALYTICS_SINK;
  const originalAnalyticsEndpoint = process.env.ANALYTICS_ENDPOINT;
  process.env.ANALYTICS_SINK = "http";
  process.env.ANALYTICS_ENDPOINT = "https://analytics.projectveil.example/ingest";

  configureAnalyticsRuntimeDependencies({
    fetch: async (input, init) => {
      fetchCalls.push(init === undefined ? { input } : { input, init });
      return {
        ok: true,
        status: 202
      };
    },
    log: () => {}
  });

  registerAnalyticsRoutes({
    use() {},
    get() {},
    post(_path, nextHandler) {
      handler = nextHandler as never;
    }
  });

  assert(handler);

  const requestBody = JSON.stringify({
    schemaVersion: 1,
    emittedAt: "2026-04-11T08:00:00.000Z",
    events: [
      {
        name: "session_start",
        source: "cocos-client",
        playerId: "player-1",
        payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
      },
      {
        name: "tutorial_step",
        source: "cocos-client",
        playerId: "player-1",
        payload: { stepId: "tutorial_completed", status: "completed" }
      }
    ]
  });
  const session = issueGuestAuthSession({ playerId: "player-1", displayName: "Veil Ranger" });
  const request = createRequest("POST", requestBody, {
    authorization: `Bearer ${session.token}`
  });
  const response = createResponse();

  try {
    await handler(request as never, response);
    await flushAnalyticsEventsForTest();
  } finally {
    if (originalAnalyticsSink === undefined) {
      delete process.env.ANALYTICS_SINK;
    } else {
      process.env.ANALYTICS_SINK = originalAnalyticsSink;
    }

    if (originalAnalyticsEndpoint === undefined) {
      delete process.env.ANALYTICS_ENDPOINT;
    } else {
      process.env.ANALYTICS_ENDPOINT = originalAnalyticsEndpoint;
    }
  }

  assert.equal(response.statusCode, 202);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, "https://analytics.projectveil.example/ingest");
  assert.match(String(fetchCalls[0]?.init?.body), /"tutorial_step"/);

  const snapshot = await getAnalyticsPipelineSnapshot({
    ANALYTICS_SINK: "http",
    ANALYTICS_ENDPOINT: "https://analytics.projectveil.example/ingest"
  });
  assert.equal(snapshot.delivery.ingestedEventsTotal, 2);
  assert.equal(snapshot.delivery.flushedEventsTotal, 2);
  assert.equal(snapshot.delivery.flushFailuresTotal, 0);
  assert.equal(snapshot.delivery.events.find((event) => event.name === "session_start" && event.source === "cocos-client")?.flushedTotal, 1);
});

test("analytics pipeline counters bucket unexpected client sources instead of accumulating random keys", async () => {
  const logs: string[] = [];
  const redis = createFakeAnalyticsRedisClient();
  const store = createRedisAnalyticsPipelineCounterStore(redis as never, {
    keyPrefix: "test:analytics-random-source-cap:"
  });
  configureAnalyticsRuntimeDependencies({
    log: (message) => {
      logs.push(message);
    }
  });
  configureAnalyticsPipelineCounterStore(store);

  const handler = capturePublicAnalyticsPostHandler();
  const session = issueGuestAuthSession({ playerId: "player-random-sources", displayName: "Random Sources" });
  const events = Array.from({ length: 50 }, (_, index) => ({
    name: "session_start",
    source: `client-${index}-${crypto.randomUUID()}`,
    payload: {
      roomId: "room-random-sources",
      authMode: "guest",
      platform: "web"
    }
  }));
  const response = createResponse();

  await handler(
    createRequest("POST", JSON.stringify({ events }), {
      authorization: `Bearer ${session.token}`
    }) as never,
    response
  );
  await flushAnalyticsEventsForTest();

  const snapshot = await getAnalyticsPipelineSnapshot();

  assert.equal(response.statusCode, 202);
  assert.equal(logs.some((message) => message.includes("accepted 50 event(s) into stdout sink")), true);
  assert.equal(snapshot.delivery.ingestedEventsTotal, 50);
  assert.equal(snapshot.delivery.flushedEventsTotal, 50);
  assert.deepEqual(snapshot.delivery.events, [
    {
      name: "session_start",
      source: "unknown",
      ingestedTotal: 50,
      flushedTotal: 50
    }
  ]);
});

test("getAnalyticsPipelineSnapshot aggregates Redis-backed counters across simulated pods", async () => {
  const redis = createFakeAnalyticsRedisClient();
  const store = createRedisAnalyticsPipelineCounterStore(redis as never, {
    keyPrefix: "test:analytics-pipeline:"
  });

  configureAnalyticsRuntimeDependencies({
    log: () => {}
  });
  configureAnalyticsPipelineCounterStore(store);
  emitAnalyticsEvent("session_start", {
    playerId: "player-a",
    source: "server",
    payload: {
      roomId: "room-a",
      authMode: "guest",
      platform: "web"
    }
  });
  await flushAnalyticsEventsForTest();

  resetAnalyticsRuntimeDependencies();
  configureAnalyticsRuntimeDependencies({
    log: () => {}
  });
  configureAnalyticsPipelineCounterStore(store);
  emitAnalyticsEvent("tutorial_step", {
    playerId: "player-b",
    source: "cocos-client",
    payload: {
      stepId: "intro",
      status: "completed",
      reason: "test"
    }
  });
  await flushAnalyticsEventsForTest();

  const snapshot = await getAnalyticsPipelineSnapshot();

  assert.equal(snapshot.delivery.ingestedEventsTotal, 2);
  assert.equal(snapshot.delivery.flushedEventsTotal, 2);
  assert.equal(snapshot.delivery.flushBatchesTotal, 2);
  assert.equal(snapshot.delivery.flushFailuresTotal, 0);
  assert.ok(snapshot.delivery.lastFlushAt);
  assert.equal(snapshot.delivery.lastErrorAt, null);
  assert.equal(snapshot.delivery.lastErrorMessage, null);
  assert.equal(
    snapshot.delivery.events.find((event) => event.name === "session_start" && event.source === "server")?.ingestedTotal,
    1
  );
  assert.equal(
    snapshot.delivery.events.find((event) => event.name === "tutorial_step" && event.source === "cocos-client")?.flushedTotal,
    1
  );
});

test("getAnalyticsPipelineSnapshot warns when http sink is requested without an endpoint", async () => {
  const snapshot = await getAnalyticsPipelineSnapshot({
    ANALYTICS_SINK: "http"
  });

  assert.equal(snapshot.status, "warn");
  assert.equal(snapshot.sink, "stdout");
  assert.match(snapshot.alerts[0] ?? "", /ANALYTICS_ENDPOINT/);
});

test("getAnalyticsPipelineSnapshot warns when ANALYTICS_ENDPOINT still uses a .example hostname", async () => {
  const snapshot = await getAnalyticsPipelineSnapshot({
    ANALYTICS_SINK: "http",
    ANALYTICS_ENDPOINT: "https://analytics.projectveil.example/ingest"
  });

  assert.equal(snapshot.status, "warn");
  assert.equal(snapshot.sink, "http");
  assert.equal(snapshot.endpoint, "https://analytics.projectveil.example/ingest");
  assert.match(snapshot.alerts[0] ?? "", /ANALYTICS_ENDPOINT uses a \.example hostname/);
});

test("registerAnalyticsRoutes rejects malformed analytics payloads", async () => {
  let handler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;

  registerAnalyticsRoutes({
    use() {},
    get() {},
    post(_path, nextHandler) {
      handler = nextHandler as never;
    }
  });

  assert(handler);

  const session = issueGuestAuthSession({ playerId: "player-1", displayName: "Veil Ranger" });
  const request = createRequest("POST", "{", {
    authorization: `Bearer ${session.token}`
  });
  const response = createResponse();

  await handler(request as never, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.match(response.body, /"code":"SyntaxError"/);
});

test("registerAnalyticsRoutes rejects unknown analytics event names", async () => {
  let handler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;

  registerAnalyticsRoutes({
    use() {},
    get() {},
    post(_path, nextHandler) {
      handler = nextHandler as never;
    }
  });

  assert(handler);

  const session = issueGuestAuthSession({ playerId: "player-1", displayName: "Veil Ranger" });
  const request = createRequest("POST", JSON.stringify({ events: [{ name: "fake_purchase_completed" }] }), {
    authorization: `Bearer ${session.token}`
  });
  const response = createResponse();

  await handler(request as never, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /analytics event name is not allowed/);
});

test("registerAnalyticsRoutes shares public ingest rate limits through Redis across local resets", async () => {
  configureAnalyticsRuntimeDependencies({
    log: () => {}
  });
  const redis = createFakeRedisRateLimitClient();
  const session = issueGuestAuthSession({ playerId: "analytics-shared-limit", displayName: "Analytics Shared" });
  let handler = capturePublicAnalyticsPostHandler({ rateLimitRedisClient: redis });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const accepted = await postEmptyAnalyticsBatch(handler, session.token);
    assert.equal(accepted.statusCode, 202);
  }

  resetAnalyticsRuntimeDependencies();
  configureAnalyticsRuntimeDependencies({
    log: () => {}
  });
  handler = capturePublicAnalyticsPostHandler({ rateLimitRedisClient: redis });

  const limited = await postEmptyAnalyticsBatch(handler, session.token);
  const limitedPayload = JSON.parse(limited.body) as { error: { code: string } };

  assert.equal(limited.statusCode, 429);
  assert.equal(limitedPayload.error.code, "analytics_rate_limited");
});
