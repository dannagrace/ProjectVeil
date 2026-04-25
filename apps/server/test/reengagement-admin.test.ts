import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { createMemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { registerReengagementAdminRoutes } from "@server/transport/http/reengagement-admin";
import type { RoomSnapshotStore } from "@server/persistence";

type RouteHandler = (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>;

function createTestApp() {
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();
  return {
    app: {
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

function createRequest(options: { headers?: Record<string, string>; url?: string } = {}): IncomingMessage & { params: Record<string, string> } {
  return {
    method: "GET",
    headers: options.headers ?? {},
    params: {},
    url: options.url ?? "/"
  } as IncomingMessage & { params: Record<string, string> };
}

function createResponse(): ServerResponse & { body: string } {
  let body = "";
  return {
    statusCode: 200,
    setHeader() {
      return this;
    },
    end(chunk?: string | Buffer) {
      body = chunk === undefined ? "" : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      return this;
    },
    get body() {
      return body;
    }
  } as ServerResponse & { body: string };
}

function withAdminSecret(t: TestContext, secret = "test-admin-secret"): string {
  const previous = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = secret;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.ADMIN_SECRET;
      return;
    }
    process.env.ADMIN_SECRET = previous;
  });
  return secret;
}

function seedLastSeenAt(store: RoomSnapshotStore, playerId: string, lastSeenAt: string): void {
  const accounts = (store as unknown as { accounts: Map<string, Record<string, unknown>> }).accounts;
  const account = accounts.get(playerId);
  if (!account) {
    throw new Error(`missing seeded account ${playerId}`);
  }
  account.lastSeenAt = lastSeenAt;
  account.updatedAt = lastSeenAt;
}

test("reengagement admin routes preview candidates and run a sweep", async (t) => {
  const secret = withAdminSecret(t);
  const store = createMemoryRoomSnapshotStore();
  const { app, gets, posts } = createTestApp();
  registerReengagementAdminRoutes(app, store);

  t.after(async () => {
    await store.close();
  });

  await store.ensurePlayerAccount({ playerId: "player-reengage", displayName: "Returner" });
  seedLastSeenAt(store, "player-reengage", "2026-04-15T00:00:00.000Z");

  const summaryHandler = gets.get("/api/admin/reengagement/summary");
  const runHandler = posts.get("/api/admin/reengagement/run");
  assert.ok(summaryHandler);
  assert.ok(runHandler);

  const summaryResponse = createResponse();
  await summaryHandler!(
    createRequest({
      headers: { "x-veil-admin-secret": secret },
      url: "/api/admin/reengagement/summary"
    }),
    summaryResponse
  );
  const summaryPayload = JSON.parse(summaryResponse.body) as { totalCandidates: number };
  assert.equal(summaryResponse.statusCode, 200);
  assert.equal(summaryPayload.totalCandidates, 1);

  const runResponse = createResponse();
  await runHandler!(
    createRequest({
      headers: { "x-veil-admin-secret": secret },
      url: "/api/admin/reengagement/run"
    }),
    runResponse
  );
  const runPayload = JSON.parse(runResponse.body) as { deliveries: Array<{ playerId: string }> };
  assert.equal(runResponse.statusCode, 200);
  assert.equal(runPayload.deliveries[0]?.playerId, "player-reengage");
});

test("reengagement admin routes reject invalid admin secret", async (t) => {
  const secret = withAdminSecret(t);
  const { app, gets } = createTestApp();
  registerReengagementAdminRoutes(app, null);

  const summaryHandler = gets.get("/api/admin/reengagement/summary");
  assert.ok(summaryHandler);

  const response = createResponse();
  await summaryHandler(
    createRequest({
      headers: { "x-veil-admin-secret": `${secret}-wrong` },
      url: "/api/admin/reengagement/summary"
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
});

test("reengagement admin auth uses timing-safe secret comparisons", async () => {
  const sourcePath = fileURLToPath(new URL("../src/transport/http/reengagement-admin.ts", import.meta.url));
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /\btimingSafeCompareAdminToken\b/);
  assert.doesNotMatch(source, /\bheader\s*===\s*/);
  assert.doesNotMatch(source, /\bsecret\s*===\s*/);
  assert.doesNotMatch(source, /\badminSecret\s*===\s*/);
  assert.doesNotMatch(source, /header\s*===\s*readRuntimeSecret\(/);
  assert.doesNotMatch(source, /readRuntimeSecret\([^)]*\)\s*===/);
  assert.doesNotMatch(source, /===\s*readRuntimeSecret\b/);
  assert.doesNotMatch(source, /readHeaderSecret\(request\)\s*===\s*adminSecret/);
  assert.doesNotMatch(source, /===\s*adminSecret\b/);
  assert.doesNotMatch(source, /header\s*===\s*adminSecret/);
});
