import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSnapshotStore } from "@server/persistence";
import { appendAdminAuditLogIfAvailable } from "@server/domain/ops/admin-audit-log";
import { loadReengagementPolicies, previewReengagementCandidates, runReengagementSweep } from "@server/domain/ops/reengagement";
import { readRuntimeSecret } from "@server/infra/runtime-secrets";
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

function readAdminSecret(): string | null {
  const secret = readRuntimeSecret("ADMIN_SECRET");
  return secret ? secret : null;
}

function isAuthorized(request: IncomingMessage): boolean {
  const adminSecret = readAdminSecret();
  return timingSafeCompareAdminToken(request.headers["x-veil-admin-secret"], adminSecret);
}

function readRequestIp(request: IncomingMessage): string | undefined {
  const forwardedFor = request.headers["x-forwarded-for"];
  const candidate = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return candidate?.split(",")[0]?.trim() || request.socket?.remoteAddress || undefined;
}

export function registerReengagementAdminRoutes(app: AdminApp, store: RoomSnapshotStore | null): void {
  app.get("/api/admin/reengagement/summary", async (request, response) => {
    if (!readAdminSecret()) {
      sendJson(response, 503, { error: "ADMIN_SECRET is not configured" });
      return;
    }
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: "Unauthorized: Invalid Admin Secret" });
      return;
    }
    if (!store?.listPlayerAccounts) {
      sendJson(response, 503, { error: "Reengagement summary requires configured room persistence storage" });
      return;
    }
    const policies = loadReengagementPolicies();
    const candidates = await previewReengagementCandidates(store, { policies });
    sendJson(response, 200, {
      policies,
      candidates,
      totalCandidates: candidates.length
    });
  });

  app.post("/api/admin/reengagement/run", async (request, response) => {
    if (!readAdminSecret()) {
      sendJson(response, 503, { error: "ADMIN_SECRET is not configured" });
      return;
    }
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: "Unauthorized: Invalid Admin Secret" });
      return;
    }
    if (!store?.listPlayerAccounts) {
      sendJson(response, 503, { error: "Reengagement run requires configured room persistence storage" });
      return;
    }
    const result = await runReengagementSweep(store, {
      policies: loadReengagementPolicies()
    });
    await appendAdminAuditLogIfAvailable(store, {
      actorPlayerId: "admin:reengagement",
      actorRole: "admin",
      action: "reengagement_run",
      targetScope: "reengagement-sweep",
      summary: "Ran reengagement sweep",
      metadataJson: JSON.stringify({
        candidatesEvaluated: result.candidates.length,
        deliveries: result.deliveries.length,
        skipped: result.skipped.length,
        deliveredPlayerIds: result.deliveries.map((entry) => entry.playerId),
        requestIp: readRequestIp(request)
      }),
      occurredAt: result.processedAt
    });
    sendJson(response, 200, result);
  });
}
