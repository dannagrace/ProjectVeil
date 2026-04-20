import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test, { type TestContext } from "node:test";

import { createMemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { registerRiskReviewAdminRoutes } from "@server/transport/http/risk-review-admin";

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

function createRequest(options: { headers?: Record<string, string>; params?: Record<string, string>; body?: string } = {}): IncomingMessage & { params: Record<string, string> } {
  async function* iterateBody() {
    if (options.body !== undefined) {
      yield Buffer.from(options.body, "utf8");
    }
  }
  const request = iterateBody() as IncomingMessage & { params: Record<string, string> };
  Object.assign(request, {
    method: "POST",
    headers: options.headers ?? {},
    params: options.params ?? {},
    url: "/"
  });
  return request;
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

function withSupportSecrets(t: TestContext): { admin: string; moderator: string } {
  const admin = "test-admin-secret";
  const moderator = "test-support-moderator-secret";
  const previousAdmin = process.env.ADMIN_SECRET;
  const previousModerator = process.env.SUPPORT_MODERATOR_SECRET;
  process.env.ADMIN_SECRET = admin;
  process.env.SUPPORT_MODERATOR_SECRET = moderator;
  t.after(() => {
    if (previousAdmin === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = previousAdmin;
    }
    if (previousModerator === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = previousModerator;
    }
  });
  return { admin, moderator };
}

test("risk review admin routes list queue entries and resolve warnings", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createMemoryRoomSnapshotStore();
  const { app, gets, posts } = createTestApp();
  registerRiskReviewAdminRoutes(app, store);

  t.after(async () => {
    await store.close();
  });

  await store.ensurePlayerAccount({ playerId: "risk-admin-player", displayName: "Risk Operator" });
  await store.savePlayerAccountProgress("risk-admin-player", {
    leaderboardAbuseState: {
      status: "flagged",
      lastAlertReasons: ["重复对手异常"],
      dailyEloGain: 320
    }
  });

  const listHandler = gets.get("/api/admin/risk-queue");
  const reviewHandler = posts.get("/api/admin/risk-queue/:playerId/review");
  assert.ok(listHandler);
  assert.ok(reviewHandler);

  const listResponse = createResponse();
  await listHandler!(
    createRequest({ headers: { "x-veil-admin-secret": moderator } }),
    listResponse
  );
  const listPayload = JSON.parse(listResponse.body) as { items: Array<{ playerId: string }> };
  assert.equal(listPayload.items[0]?.playerId, "risk-admin-player");

  const reviewResponse = createResponse();
  await reviewHandler!(
    createRequest({
      headers: { "x-veil-admin-secret": moderator },
      params: { playerId: "risk-admin-player" },
      body: JSON.stringify({ action: "warn", reason: "人工复核需先告警" })
    }),
    reviewResponse
  );
  const payload = JSON.parse(reviewResponse.body) as { ok: boolean; account: { leaderboardAbuseState?: { status?: string } } };
  assert.equal(payload.ok, true);
  assert.equal(payload.account.leaderboardAbuseState?.status, "watch");
});
