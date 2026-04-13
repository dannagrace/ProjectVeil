import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test, { afterEach } from "node:test";
import {
  configureAnalyticsRuntimeDependencies,
  flushAnalyticsEventsForTest,
  getAnalyticsPipelineSnapshot,
  registerAnalyticsRoutes,
  resetAnalyticsRuntimeDependencies
} from "../src/analytics";

afterEach(() => {
  resetAnalyticsRuntimeDependencies();
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

function createRequest(method: string, body?: string): Readable & {
  method: string;
  headers: Record<string, string>;
  resume(): void;
} {
  const request = Readable.from(body == null ? [] : [body]) as Readable & {
    method: string;
    headers: Record<string, string>;
    resume(): void;
  };
  request.method = method;
  request.headers = body == null ? {} : { "content-length": Buffer.byteLength(body).toString() };
  request.resume = () => {
    request.read();
  };
  return request;
}

test("registerAnalyticsRoutes accepts analytics batches and logs the payload", async () => {
  let middleware:
    | ((request: never, response: TestResponse, next: () => void) => void)
    | undefined;
  let getHandler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;
  let handler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;
  const logs: string[] = [];

  configureAnalyticsRuntimeDependencies({
    log: (message) => {
      logs.push(message);
    }
  });

  registerAnalyticsRoutes({
    use(nextMiddleware) {
      middleware = nextMiddleware as never;
    },
    get(path, nextHandler) {
      assert.equal(path, "/api/test/analytics/events");
      getHandler = nextHandler as never;
    },
    post(path, nextHandler) {
      assert.equal(path, "/api/analytics/events");
      handler = nextHandler as never;
    }
  });

  assert(middleware);
  assert(getHandler);
  assert(handler);

  const requestBody = JSON.stringify({
    schemaVersion: 1,
    emittedAt: "2026-04-05T00:00:00.000Z",
    events: [{ name: "shop_open" }, { name: "battle_start" }]
  });
  const request = createRequest("POST", requestBody);
  const response = createResponse();

  let nextCalled = false;
  middleware(request as never, response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  await handler(request as never, response);

  assert.equal(response.statusCode, 202);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.deepEqual(JSON.parse(response.body), { accepted: 2 });
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /^\[Analytics\] accepted 2 event\(s\) into stdout sink$/);

  const getResponse = createResponse();
  await getHandler(createRequest("GET") as never, getResponse);

  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(getResponse.body), {
    events: [{ name: "shop_open" }, { name: "battle_start" }]
  });
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
      fetchCalls.push({ input, init });
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
  const request = createRequest("POST", requestBody);
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

  const snapshot = getAnalyticsPipelineSnapshot({
    ANALYTICS_SINK: "http",
    ANALYTICS_ENDPOINT: "https://analytics.projectveil.example/ingest"
  });
  assert.equal(snapshot.delivery.ingestedEventsTotal, 2);
  assert.equal(snapshot.delivery.flushedEventsTotal, 2);
  assert.equal(snapshot.delivery.flushFailuresTotal, 0);
  assert.equal(snapshot.delivery.events.find((event) => event.name === "session_start" && event.source === "cocos-client")?.flushedTotal, 1);
});

test("getAnalyticsPipelineSnapshot warns when http sink is requested without an endpoint", () => {
  const snapshot = getAnalyticsPipelineSnapshot({
    ANALYTICS_SINK: "http"
  });

  assert.equal(snapshot.status, "warn");
  assert.equal(snapshot.sink, "stdout");
  assert.match(snapshot.alerts[0] ?? "", /ANALYTICS_ENDPOINT/);
});

test("getAnalyticsPipelineSnapshot warns when ANALYTICS_ENDPOINT still uses a .example hostname", () => {
  const snapshot = getAnalyticsPipelineSnapshot({
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

  const request = createRequest("POST", "{");
  const response = createResponse();

  await handler(request as never, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.match(response.body, /"code":"SyntaxError"/);
});
