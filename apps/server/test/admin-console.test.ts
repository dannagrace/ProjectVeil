import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerAdminRoutes } from "../src/admin-console";

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
    params: options.params ?? {}
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

test("admin overview fails closed when ADMIN_SECRET is unset", async () => {
  const originalAdminSecret = process.env.ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;

  try {
    const { app, gets } = createTestApp();
    registerAdminRoutes(app, null);

    const handler = gets.get("/api/admin/overview");
    assert.ok(handler);

    const response = createResponse();
    await handler(
      createRequest({
        headers: {
          "x-veil-admin-secret": "veil-admin-2026"
        }
      }),
      response
    );

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "ADMIN_SECRET is not configured" });
  } finally {
    if (originalAdminSecret === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = originalAdminSecret;
    }
  }
});

test("admin broadcast returns 400 for malformed JSON", async () => {
  const originalAdminSecret = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = "test-admin-secret";

  try {
    const { app, posts } = createTestApp();
    registerAdminRoutes(app, null);

    const handler = posts.get("/api/admin/broadcast");
    assert.ok(handler);

    const response = createResponse();
    await handler(
      createRequest({
        method: "POST",
        headers: {
          "x-veil-admin-secret": "test-admin-secret"
        },
        body: "{"
      }),
      response
    );

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: "Invalid JSON body" });
  } finally {
    if (originalAdminSecret === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = originalAdminSecret;
    }
  }
});
