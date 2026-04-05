import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test, { afterEach } from "node:test";
import {
  configureAnalyticsRuntimeDependencies,
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
    post(path, nextHandler) {
      assert.equal(path, "/api/analytics/events");
      handler = nextHandler as never;
    }
  });

  assert(middleware);
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
  assert.match(logs[0] ?? "", /"shop_open"/);
});

test("registerAnalyticsRoutes rejects malformed analytics payloads", async () => {
  let handler:
    | ((request: never, response: TestResponse) => void | Promise<void>)
    | undefined;

  registerAnalyticsRoutes({
    use() {},
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
