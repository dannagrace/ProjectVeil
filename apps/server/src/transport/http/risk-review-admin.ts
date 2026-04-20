import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSnapshotStore } from "@server/persistence";
import { buildRiskQueue, reviewRiskQueueEntry } from "@server/domain/ops/risk-score";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";

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

function readAdminSecret(): string | null {
  const secret = readRuntimeSecret("SUPPORT_MODERATOR_SECRET") ?? readRuntimeSecret("ADMIN_SECRET");
  return secret ? secret : null;
}

function readRole(request: IncomingMessage): "admin" | "support-moderator" | null {
  const header = typeof request.headers["x-veil-admin-secret"] === "string" ? request.headers["x-veil-admin-secret"] : null;
  if (!header) {
    return null;
  }
  if (header === readRuntimeSecret("ADMIN_SECRET")) {
    return "admin";
  }
  if (header === readRuntimeSecret("SUPPORT_MODERATOR_SECRET")) {
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

export function registerRiskReviewAdminRoutes(app: AdminApp, store: RoomSnapshotStore | null): void {
  app.get("/api/admin/risk-queue", async (request, response) => {
    if (!readAdminSecret()) {
      sendJson(response, 503, { error: "Support moderation secrets are not configured" });
      return;
    }
    if (!readRole(request)) {
      sendJson(response, 401, { error: "Unauthorized: Invalid Admin Secret" });
      return;
    }
    if (!store?.listPlayerAccounts) {
      sendJson(response, 503, { error: "Risk review queue requires configured room persistence storage" });
      return;
    }
    sendJson(response, 200, {
      items: await buildRiskQueue(store)
    });
  });

  app.post("/api/admin/risk-queue/:playerId/review", async (request, response) => {
    const role = readRole(request);
    if (!readAdminSecret()) {
      sendJson(response, 503, { error: "Support moderation secrets are not configured" });
      return;
    }
    if (!role) {
      sendJson(response, 401, { error: "Unauthorized: Invalid Admin Secret" });
      return;
    }
    if (!store?.loadPlayerAccount) {
      sendJson(response, 503, { error: "Risk review queue requires configured room persistence storage" });
      return;
    }
    const body = (await readJsonBody(request)) as {
      action?: "warn" | "clear" | "ban";
      reason?: string;
      banStatus?: "temporary" | "permanent";
      banExpiry?: string;
    };
    const action = body.action ?? "warn";
    if (!body.reason?.trim()) {
      sendJson(response, 400, { error: "reason is required" });
      return;
    }
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendJson(response, 400, { error: "playerId is required" });
      return;
    }
    const account = await reviewRiskQueueEntry(store, {
      playerId,
      action,
      reason: body.reason.trim(),
      actorPlayerId: `${role}:risk-review`,
      actorRole: role,
      ...(body.banStatus ? { banStatus: body.banStatus } : {}),
      ...(body.banExpiry ? { banExpiry: body.banExpiry } : {})
    });
    sendJson(response, 200, { ok: true, account });
  });
}
