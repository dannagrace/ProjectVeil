import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSnapshotStore } from "@server/persistence";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import {
  buildUgcReviewQueue,
  getUgcModerationConfigMeta,
  resolveUgcReviewEntry,
  type UgcModerationConfigStorage
} from "@server/domain/social/ugc-moderation";
import { timingSafeCompareAdminToken } from "@server/infra/admin-token";

type AdminRouteHandler = (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>;
type AdminApp = {
  get: (path: string, handler: AdminRouteHandler) => void;
  post: (path: string, handler: AdminRouteHandler) => void;
};

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function readRole(request: IncomingMessage): "admin" | "support-moderator" | "support-supervisor" | null {
  const header = typeof request.headers["x-veil-admin-secret"] === "string" ? request.headers["x-veil-admin-secret"] : null;
  if (!header) {
    return null;
  }
  if (timingSafeCompareAdminToken(header, readRuntimeSecret("ADMIN_SECRET"))) {
    return "admin";
  }
  if (timingSafeCompareAdminToken(header, readRuntimeSecret("SUPPORT_SUPERVISOR_SECRET"))) {
    return "support-supervisor";
  }
  if (timingSafeCompareAdminToken(header, readRuntimeSecret("SUPPORT_MODERATOR_SECRET"))) {
    return "support-moderator";
  }
  return null;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function registerUgcReviewAdminRoutes(
  app: AdminApp,
  store: RoomSnapshotStore | null,
  options: { configStorage?: UgcModerationConfigStorage | null } = {}
): void {
  app.get("/api/admin/ugc-review", async (request, response) => {
    if (!readRuntimeSecret("SUPPORT_MODERATOR_SECRET") && !readRuntimeSecret("ADMIN_SECRET")) {
      sendJson(response, 503, { error: "Support moderation secrets are not configured" });
      return;
    }
    if (!readRole(request)) {
      sendJson(response, 401, { error: "Unauthorized: Invalid Admin Secret" });
      return;
    }
    if (!store?.listPlayerAccounts) {
      sendJson(response, 503, { error: "UGC moderation queue requires configured room persistence storage" });
      return;
    }
    sendJson(response, 200, {
      items: await buildUgcReviewQueue(store, options),
      configMeta: getUgcModerationConfigMeta()
    });
  });

  app.post("/api/admin/ugc-review/:itemId/resolve", async (request, response) => {
    const role = readRole(request);
    if (!readRuntimeSecret("SUPPORT_MODERATOR_SECRET") && !readRuntimeSecret("ADMIN_SECRET")) {
      sendJson(response, 503, { error: "Support moderation secrets are not configured" });
      return;
    }
    if (!role) {
      sendJson(response, 401, { error: "Unauthorized: Invalid Admin Secret" });
      return;
    }
    if (!store?.listPlayerAccounts) {
      sendJson(response, 503, { error: "UGC moderation queue requires configured room persistence storage" });
      return;
    }
    const itemId = request.params.itemId?.trim();
    if (!itemId) {
      sendJson(response, 400, { error: "itemId is required" });
      return;
    }
    const body = (await readJsonBody(request)) as { action?: "approve" | "reject"; reason?: string; candidateKeyword?: string };
    if (body.action !== "approve" && body.action !== "reject") {
      sendJson(response, 400, { error: "action must be approve or reject" });
      return;
    }
    if (!body.reason?.trim()) {
      sendJson(response, 400, { error: "reason is required" });
      return;
    }
    try {
      const payload = await resolveUgcReviewEntry(
        store,
        {
          itemId,
          action: body.action,
          reason: body.reason.trim(),
          actorPlayerId: `${role}:ugc-review`,
          actorRole: role,
          ...(body.candidateKeyword?.trim() ? { candidateKeyword: body.candidateKeyword.trim() } : {})
        },
        options
      );
      sendJson(response, 200, { ok: true, ...payload });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "Invalid JSON body" });
        return;
      }
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
