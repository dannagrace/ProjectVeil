import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test, { type TestContext } from "node:test";
import { registerConfigCenterRoutes } from "@server/domain/config-center/routes";
import type { ConfigCenterStore } from "@server/domain/config-center/types";

type RouteHandler = (
  request: IncomingMessage & { params: Record<string, string> },
  response: ServerResponse
) => void | Promise<void>;

function createTestApp() {
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();
  const puts = new Map<string, RouteHandler>();
  const uses: Array<(request: IncomingMessage, response: ServerResponse, next: () => void) => void> = [];

  return {
    app: {
      use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) {
        uses.push(handler);
      },
      get(path: string, handler: RouteHandler) {
        gets.set(path, handler);
      },
      post(path: string, handler: RouteHandler) {
        posts.set(path, handler);
      },
      put(path: string, handler: RouteHandler) {
        puts.set(path, handler);
      }
    },
    gets,
    posts,
    puts,
    uses
  };
}

function createRequest(options: {
  method?: string;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string>;
  body?: string;
  url?: string;
} = {}): IncomingMessage & { params: Record<string, string> } {
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

function withAdminToken(t: TestContext, token = "config-center-admin-token"): string {
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

function withMissingAdminToken(t: TestContext): void {
  const original = process.env.VEIL_ADMIN_TOKEN;
  delete process.env.VEIL_ADMIN_TOKEN;
  t.after(() => {
    if (original === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
      return;
    }
    process.env.VEIL_ADMIN_TOKEN = original;
  });
}

function createStore() {
  const savedDocuments: Array<{ id: string; content: string }> = [];
  const documents = new Map<string, string>([
    [
      "world",
      JSON.stringify({
        width: 8,
        height: 8,
        heroes: [],
        resourceSpawn: {
          goldChance: 0.06,
          woodChance: 0.06,
          oreChance: 0.06
        }
      })
    ]
  ]);

  const store = {
    mode: "filesystem",
    async initializeRuntimeConfigs() {},
    async listDocuments() {
      return [
        {
          id: "world",
          title: "World",
          description: "World config",
          fileName: "phase1-world.json",
          updatedAt: "2026-04-23T00:00:00.000Z",
          summary: "8x8 world",
          storage: "filesystem"
        }
      ];
    },
    async loadDocument(id: "world") {
      return {
        id,
        title: "World",
        description: "World config",
        fileName: "phase1-world.json",
        updatedAt: "2026-04-23T00:00:00.000Z",
        summary: "8x8 world",
        storage: "filesystem" as const,
        content: documents.get(id) ?? "{}"
      };
    },
    async saveDocument(id: "world", content: string) {
      savedDocuments.push({ id, content });
      documents.set(id, content);
      return {
        id,
        title: "World",
        description: "World config",
        fileName: "phase1-world.json",
        updatedAt: "2026-04-23T00:00:00.000Z",
        summary: "saved",
        storage: "filesystem" as const,
        content
      };
    },
    async validateDocument() {
      return {
        valid: true,
        summary: "ok",
        issues: [],
        schema: {
          id: "project-veil.config-center.world",
          title: "World",
          version: "1",
          description: "test schema",
          required: []
        },
        contentPack: {
          valid: true,
          summary: "ok",
          issues: []
        }
      } as Awaited<ReturnType<ConfigCenterStore["validateDocument"]>>;
    }
  } as ConfigCenterStore;

  return { store, savedDocuments };
}

function registerRoutes(store: ConfigCenterStore) {
  const { app, gets, posts, puts, uses } = createTestApp();
  registerConfigCenterRoutes(app, store);
  return { gets, posts, puts, uses };
}

test("config-center read routes require the admin token", async (t) => {
  withMissingAdminToken(t);
  const { store } = createStore();
  const { gets, posts, uses } = registerRoutes(store);
  const routes: Array<{
    method: "get" | "post";
    path: string;
    params?: Record<string, string>;
    body?: string;
    url: string;
  }> = [
    {
      method: "get",
      path: "/api/config-center/configs",
      url: "/api/config-center/configs"
    },
    {
      method: "get",
      path: "/api/config-center/configs/:id",
      params: { id: "world" },
      url: "/api/config-center/configs/world"
    },
    {
      method: "get",
      path: "/api/config-center/configs/:id/diff-preview",
      params: { id: "world" },
      url: "/api/config-center/configs/world/diff-preview"
    },
    {
      method: "post",
      path: "/api/config-center/configs/:id/preview",
      params: { id: "world" },
      body: JSON.stringify({ content: "{\"width\":8}" }),
      url: "/api/config-center/configs/world/preview"
    },
    {
      method: "post",
      path: "/api/config-center/configs/:id/validate",
      params: { id: "world" },
      body: JSON.stringify({ content: "{\"width\":8}" }),
      url: "/api/config-center/configs/world/validate"
    },
    {
      method: "post",
      path: "/api/config-center/configs/:id/diff",
      params: { id: "world" },
      body: JSON.stringify({ snapshotId: "snapshot-1" }),
      url: "/api/config-center/configs/world/diff"
    },
    {
      method: "get",
      path: "/api/config-center/configs/:id/snapshots",
      params: { id: "world" },
      url: "/api/config-center/configs/world/snapshots"
    },
    {
      method: "get",
      path: "/api/config-center/publish-stage",
      url: "/api/config-center/publish-stage"
    },
    {
      method: "get",
      path: "/api/config-center/publish-history",
      url: "/api/config-center/publish-history"
    },
    {
      method: "get",
      path: "/api/config-center/configs/:id/presets",
      params: { id: "world" },
      url: "/api/config-center/configs/world/presets"
    },
    {
      method: "get",
      path: "/api/config-center/configs/:id/export",
      params: { id: "world" },
      url: "/api/config-center/configs/world/export"
    }
  ];

  assert.equal(uses.length, 0);
  for (const route of routes) {
    const handler = route.method === "get" ? gets.get(route.path) : posts.get(route.path);
    const response = createResponse();
    assert.ok(handler, `expected handler for ${route.method.toUpperCase()} ${route.path}`);
    await handler(
      createRequest({
        method: route.method.toUpperCase(),
        headers: {},
        params: route.params,
        body: route.body,
        url: route.url
      }),
      response
    );

    assert.equal(response.statusCode, 503, `${route.method.toUpperCase()} ${route.path}`);
    assert.deepEqual(JSON.parse(response.body), {
      error: {
        code: "not_configured",
        message: "Admin token not configured"
      }
    });
    assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  }
});

test("config-center mutating routes return 503 when VEIL_ADMIN_TOKEN is not configured", async () => {
  delete process.env.VEIL_ADMIN_TOKEN;
  const { store, savedDocuments } = createStore();
  const { posts, puts } = registerRoutes(store);
  const routes: Array<{
    method: "post" | "put";
    path: string;
    params?: Record<string, string>;
  }> = [
    { method: "put", path: "/api/config-center/publish-stage" },
    { method: "post", path: "/api/config-center/publish-stage/publish" },
    { method: "post", path: "/api/config-center/configs/:id/snapshots", params: { id: "world" } },
    { method: "post", path: "/api/config-center/configs/:id/rollback", params: { id: "world" } },
    { method: "post", path: "/api/config-center/configs/:id/presets", params: { id: "world" } },
    { method: "post", path: "/api/config-center/configs/:id/presets/:presetId/apply", params: { id: "world", presetId: "preset-1" } },
    { method: "post", path: "/api/config-center/configs/:id/import", params: { id: "world" } },
    { method: "put", path: "/api/config-center/configs/:id", params: { id: "world" } }
  ];

  for (const route of routes) {
    const handler = route.method === "post" ? posts.get(route.path) : puts.get(route.path);
    const response = createResponse();

    assert.ok(handler, `expected handler for ${route.method.toUpperCase()} ${route.path}`);
    await handler(
      createRequest({
        method: route.method.toUpperCase(),
        url: route.path.replace(":id", route.params?.id ?? "").replace(":presetId", route.params?.presetId ?? ""),
        params: route.params
      }),
      response
    );

    assert.equal(response.statusCode, 503, `${route.method.toUpperCase()} ${route.path}`);
    assert.deepEqual(JSON.parse(response.body), {
      error: {
        code: "not_configured",
        message: "Admin token not configured"
      }
    });
    assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  }

  assert.deepEqual(savedDocuments, []);
});

test("config-center read routes accept a valid admin token", async (t) => {
  const token = withAdminToken(t);
  const { store } = createStore();
  const { gets, posts } = registerRoutes(store);

  const listHandler = gets.get("/api/config-center/configs");
  const validateHandler = posts.get("/api/config-center/configs/:id/validate");
  const listResponse = createResponse();
  const validateResponse = createResponse();

  assert.ok(listHandler);
  assert.ok(validateHandler);

  await listHandler(
    createRequest({
      url: "/api/config-center/configs",
      headers: { "x-veil-admin-token": token }
    }),
    listResponse
  );
  await validateHandler(
    createRequest({
      method: "POST",
      url: "/api/config-center/configs/world/validate",
      params: { id: "world" },
      headers: { "x-veil-admin-token": token },
      body: JSON.stringify({ content: "{\"width\":8}" })
    }),
    validateResponse
  );

  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(validateResponse.statusCode, 200);
  assert.equal(validateResponse.headers["Access-Control-Allow-Origin"], undefined);
});

test("config-center mutating routes reject invalid admin tokens and accept valid ones", async (t) => {
  const token = withAdminToken(t);
  const { store, savedDocuments } = createStore();
  const { puts } = registerRoutes(store);
  const saveHandler = puts.get("/api/config-center/configs/:id");
  const forbiddenResponse = createResponse();
  const successResponse = createResponse();
  const nextContent = JSON.stringify({
    width: 10,
    height: 8,
    heroes: [],
    resourceSpawn: {
      goldChance: 0.06,
      woodChance: 0.06,
      oreChance: 0.06
    }
  });

  assert.ok(saveHandler);

  await saveHandler(
    createRequest({
      method: "PUT",
      url: "/api/config-center/configs/world",
      params: { id: "world" },
      headers: { "x-veil-admin-token": `${token}-wrong` },
      body: JSON.stringify({ content: nextContent })
    }),
    forbiddenResponse
  );

  assert.equal(forbiddenResponse.statusCode, 403);
  assert.deepEqual(JSON.parse(forbiddenResponse.body), {
    error: {
      code: "forbidden",
      message: "Invalid admin token"
    }
  });
  assert.deepEqual(savedDocuments, []);

  await saveHandler(
    createRequest({
      method: "PUT",
      url: "/api/config-center/configs/world",
      params: { id: "world" },
      headers: { "x-veil-admin-token": token },
      body: JSON.stringify({ content: nextContent })
    }),
    successResponse
  );

  assert.equal(successResponse.statusCode, 200);
  assert.equal(savedDocuments.length, 1);
  assert.deepEqual(savedDocuments[0], {
    id: "world",
    content: nextContent
  });
});
