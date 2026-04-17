import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSnapshotStore } from "./persistence";
import { loadReengagementPolicies, previewReengagementCandidates, runReengagementSweep } from "./reengagement";
import { readRuntimeSecret } from "./runtime-secrets";

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
  const header = request.headers["x-veil-admin-secret"];
  return typeof header === "string" && Boolean(adminSecret) && header === adminSecret;
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
    sendJson(response, 200, result);
  });
}
