import type { IncomingMessage, ServerResponse } from "node:http";
import type { AdminAuditActorRole } from "@server/persistence";
import { appendAdminAuditLogIfAvailable, type AdminAuditWritableStore } from "@server/domain/ops/admin-audit-log";
import { readRuntimeSecret } from "@server/infra/runtime-secrets";
import { timingSafeCompareAdminToken } from "@server/infra/admin-token";

type AdminForensicsMiddleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

export interface AdminForensicsApp {
  use(handler: AdminForensicsMiddleware): void;
}

function readHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0]?.trim() ?? null : value?.trim() ?? null;
}

function inferAdminRole(request: IncomingMessage): AdminAuditActorRole | null {
  const adminSecret = readRuntimeSecret("ADMIN_SECRET");
  const supportModeratorSecret = readRuntimeSecret("SUPPORT_MODERATOR_SECRET");
  const supportSupervisorSecret = readRuntimeSecret("SUPPORT_SUPERVISOR_SECRET");
  const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
  const adminSecretHeader = readHeader(request, "x-veil-admin-secret");
  const adminTokenHeader = readHeader(request, "x-veil-admin-token");

  if (timingSafeCompareAdminToken(adminSecretHeader, adminSecret) || timingSafeCompareAdminToken(adminTokenHeader, adminToken)) {
    return "admin";
  }
  if (timingSafeCompareAdminToken(adminSecretHeader, supportSupervisorSecret)) {
    return "support-supervisor";
  }
  if (timingSafeCompareAdminToken(adminSecretHeader, supportModeratorSecret)) {
    return "support-moderator";
  }
  return null;
}

function describeActor(role: AdminAuditActorRole | null): string {
  return role ? `${role}:admin-forensics` : "anonymous:admin-forensics";
}

function readRequestPath(request: IncomingMessage): { path: string; queryKeys: string[] } {
  try {
    const url = new URL(request.url ?? "/", "http://projectveil.local");
    return {
      path: url.pathname,
      queryKeys: Array.from(url.searchParams.keys()).sort()
    };
  } catch {
    return {
      path: (request.url ?? "/").split("?")[0] || "/",
      queryKeys: []
    };
  }
}

function readRequestIp(request: IncomingMessage): string | null {
  const forwardedFor = readHeader(request, "x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  return request.socket.remoteAddress ?? null;
}

function readCredentialHint(request: IncomingMessage): { header: string; prefix: string; length: number } | null {
  for (const header of ["x-veil-admin-secret", "x-veil-admin-token"]) {
    const value = readHeader(request, header);
    if (!value) {
      continue;
    }
    return {
      header,
      prefix: value.slice(0, 6),
      length: value.length
    };
  }
  return null;
}

function recordAdminForensicsEvent(
  store: AdminAuditWritableStore | null | undefined,
  request: IncomingMessage,
  statusCode: number
): void {
  const method = request.method ?? "GET";
  const { path, queryKeys } = readRequestPath(request);
  if (!path.startsWith("/api/admin")) {
    return;
  }

  const role = inferAdminRole(request);
  if (method === "GET" && statusCode >= 200 && statusCode < 300 && role) {
    void appendAdminAuditLogIfAvailable(store, {
      actorPlayerId: describeActor(role),
      actorRole: role,
      action: "admin_read_access",
      targetScope: path,
      summary: `Read admin resource ${path}`,
      metadataJson: JSON.stringify({
        method,
        path,
        queryKeys,
        statusCode,
        ip: readRequestIp(request)
      })
    }).catch(() => undefined);
    return;
  }

  if (statusCode === 401 || statusCode === 403) {
    void appendAdminAuditLogIfAvailable(store, {
      actorPlayerId: describeActor(role),
      actorRole: role ?? "admin",
      action: "admin_auth_failed",
      targetScope: "admin-auth",
      summary: `Rejected admin request ${method} ${path}`,
      metadataJson: JSON.stringify({
        method,
        path,
        queryKeys,
        statusCode,
        ip: readRequestIp(request),
        credential: readCredentialHint(request)
      })
    }).catch(() => undefined);
  }
}

export function registerAdminForensicsMiddleware(
  app: AdminForensicsApp,
  store: AdminAuditWritableStore | null | undefined
): void {
  app.use((request, response, next) => {
    const originalEnd = response.end.bind(response) as (...args: unknown[]) => ServerResponse;
    response.end = ((...args: unknown[]) => {
      const statusCode = response.statusCode;
      const result = originalEnd(...args);
      recordAdminForensicsEvent(store, request, statusCode);
      return result;
    }) as ServerResponse["end"];
    next();
  });
}
