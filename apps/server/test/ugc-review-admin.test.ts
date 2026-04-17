import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";

import { normalizeGuildState } from "../../../packages/shared/src/index";
import { createMemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { registerUgcReviewAdminRoutes } from "../src/ugc-review-admin";

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
  const admin = "ugc-admin-secret";
  const moderator = "ugc-support-secret";
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

async function withKeywordConfig(t: TestContext): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "veil-ugc-admin-"));
  const filePath = path.join(dir, "ugc-banned-keywords.json");
  await writeFile(
    filePath,
    `${JSON.stringify({ schemaVersion: 1, reviewThreshold: 40, approvedTerms: [], candidateTerms: ["vx"] }, null, 2)}\n`,
    "utf8"
  );
  const previous = process.env.VEIL_UGC_BANNED_KEYWORDS_PATH;
  process.env.VEIL_UGC_BANNED_KEYWORDS_PATH = filePath;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.VEIL_UGC_BANNED_KEYWORDS_PATH;
    } else {
      process.env.VEIL_UGC_BANNED_KEYWORDS_PATH = previous;
    }
  });
}

test("ugc review admin routes list queue entries and resolve a rejection", async (t) => {
  const { moderator } = withSupportSecrets(t);
  await withKeywordConfig(t);
  const store = createMemoryRoomSnapshotStore();
  const { app, gets, posts } = createTestApp();
  registerUgcReviewAdminRoutes(app, store);

  t.after(async () => {
    await store.close();
  });

  await store.ensurePlayerAccount({ playerId: "ugc-admin-player", displayName: "vx88888" });
  await store.ensurePlayerAccount({ playerId: "ugc-guild-owner", displayName: "GuildOwner" });
  await store.saveGuild(
    normalizeGuildState({
      id: "ugc-admin-guild",
      name: "正常公会",
      tag: "UGC",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
      memberLimit: 20,
      level: 1,
      xp: 0,
      members: [{ playerId: "ugc-guild-owner", displayName: "GuildOwner", role: "owner", joinedAt: "2026-04-17T00:00:00.000Z" }],
      joinRequests: [],
      invites: []
    })
  );

  const listHandler = gets.get("/api/admin/ugc-review");
  const resolveHandler = posts.get("/api/admin/ugc-review/:itemId/resolve");
  assert.ok(listHandler);
  assert.ok(resolveHandler);

  const listResponse = createResponse();
  await listHandler!(createRequest({ headers: { "x-veil-admin-secret": moderator } }), listResponse);
  const listPayload = JSON.parse(listResponse.body) as { items: Array<{ itemId: string; kind: string }> };
  assert.equal(listPayload.items[0]?.kind, "display_name");

  const resolveResponse = createResponse();
  await resolveHandler!(
    createRequest({
      headers: { "x-veil-admin-secret": moderator },
      params: { itemId: listPayload.items[0]!.itemId },
      body: JSON.stringify({ action: "reject", reason: "人工复核拒绝", candidateKeyword: "vx" })
    }),
    resolveResponse
  );
  const payload = JSON.parse(resolveResponse.body) as { ok: boolean; entry: { reviewStatus: string } };
  assert.equal(payload.ok, true);
  assert.equal(payload.entry.reviewStatus, "rejected");
});
