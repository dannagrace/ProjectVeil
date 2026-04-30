import type { IncomingMessage, ServerResponse } from "node:http";
import type { AdminAuditLogCreateInput, AdminAuditLogRecord, RoomSnapshotStore } from "@server/persistence";
import { timingSafeCompareAdminToken } from "@server/infra/admin-token";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function toErrorPayload(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "error" : "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

function hasAdminAuditStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "appendAdminAuditLog">> {
  return Boolean(store?.appendAdminAuditLog);
}

async function appendAdminAuditLogIfAvailable(
  store: RoomSnapshotStore | null,
  input: AdminAuditLogCreateInput
): Promise<AdminAuditLogRecord | null> {
  if (!hasAdminAuditStore(store)) {
    return null;
  }
  return store.appendAdminAuditLog(input);
}

function safeSerialize(value: unknown): string {
  return JSON.stringify(value);
}

function readRequestIp(request: IncomingMessage): string | undefined {
  const forwardedFor = request.headers["x-forwarded-for"];
  const candidate = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return candidate?.split(",")[0]?.trim() || request.socket?.remoteAddress || undefined;
}

function isAdminAuthorized(request: IncomingMessage): boolean {
  const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
  return timingSafeCompareAdminToken(request.headers["x-veil-admin-token"], adminToken);
}

const MAX_JSON_BODY_BYTES = 32 * 1024;

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "payload_too_large";
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"]);

  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    // Fail fast: reject immediately based on Content-Length alone.
    // Resume the stream in the background to drain it without accumulating
    // data, so the connection is not reset — but do NOT await it, as that
    // would keep the handler blocked (slow-loris risk).
    request.on("error", () => {});
    request.resume();
    return Promise.reject(new PayloadTooLargeError(MAX_JSON_BODY_BYTES));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let tooLarge = false;

    request.on("data", (chunk: Buffer) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (tooLarge || totalBytes > MAX_JSON_BODY_BYTES) {
        // Mark as too large but continue draining so the connection is not reset
        tooLarge = true;
      } else {
        chunks.push(buffer);
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new PayloadTooLargeError(MAX_JSON_BODY_BYTES));
        return;
      }
      try {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function readLimit(request: IncomingMessage, fallback = 20): number {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const rawLimit = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(rawLimit)) {
    return fallback;
  }

  return Math.min(100, Math.max(1, Math.floor(rawLimit)));
}

function readAdminSeasonStatus(request: IncomingMessage): "closed" | "all" {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const status = url.searchParams.get("status");
  if (!status || status === "closed") {
    return "closed";
  }
  if (status === "all") {
    return "all";
  }
  throw new Error('status must be "closed" or "all"');
}

export function registerSeasonRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null
): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Veil-Admin-Token");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/seasons/current", async (_request, response) => {
    try {
      if (!store) {
        sendJson(response, 200, { season: null });
        return;
      }
      const season = await store.getCurrentSeason();
      sendJson(response, 200, { season });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/seasons", async (request, response) => {
    try {
      if (!store) {
        sendJson(response, 200, { seasons: [] });
        return;
      }
      if (!store.listSeasons) {
        sendJson(response, 200, { seasons: [] });
        return;
      }

      const seasons = await store.listSeasons({
        status: "closed",
        limit: readLimit(request)
      });
      sendJson(response, 200, { seasons });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/admin/seasons", async (request, response) => {
    try {
      const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
      if (!adminToken) {
        sendJson(response, 503, { error: { code: "not_configured", message: "Admin token not configured" } });
        return;
      }
      if (!isAdminAuthorized(request)) {
        sendJson(response, 403, { error: { code: "forbidden", message: "Invalid admin token" } });
        return;
      }
      if (!store) {
        sendJson(response, 503, { error: { code: "no_store", message: "No persistence store available" } });
        return;
      }
      if (!store.listSeasons) {
        sendJson(response, 503, { error: { code: "no_store", message: "No season history store available" } });
        return;
      }

      const seasons = await store.listSeasons({
        status: readAdminSeasonStatus(request),
        limit: readLimit(request)
      });
      sendJson(response, 200, { seasons });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/admin/seasons/create", async (request, response) => {
    try {
      const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
      if (!adminToken) {
        sendJson(response, 503, { error: { code: "not_configured", message: "Admin token not configured" } });
        return;
      }
      if (!isAdminAuthorized(request)) {
        sendJson(response, 403, { error: { code: "forbidden", message: "Invalid admin token" } });
        return;
      }
      if (!store) {
        sendJson(response, 503, { error: { code: "no_store", message: "No persistence store available" } });
        return;
      }
      const body = await readJsonBody(request);
      const seasonId = typeof body === "object" && body !== null && "seasonId" in body
        ? String((body as Record<string, unknown>)["seasonId"] ?? "")
        : `season_${Date.now()}`;
      const season = await store.createSeason(seasonId || `season_${Date.now()}`);
      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: "admin:seasons",
        actorRole: "admin",
        action: "season_created",
        targetScope: "season",
        summary: `Created season ${season.seasonId}`,
        afterJson: safeSerialize(season),
        metadataJson: safeSerialize({
          actorIp: readRequestIp(request),
          seasonId: season.seasonId
        })
      });
      sendJson(response, 201, { season });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          error: {
            code: "invalid_json",
            message: "Request body must be valid JSON"
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/admin/seasons/close", async (request, response) => {
    try {
      const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
      if (!adminToken) {
        sendJson(response, 503, { error: { code: "not_configured", message: "Admin token not configured" } });
        return;
      }
      if (!isAdminAuthorized(request)) {
        sendJson(response, 403, { error: { code: "forbidden", message: "Invalid admin token" } });
        return;
      }
      if (!store) {
        sendJson(response, 503, { error: { code: "no_store", message: "No persistence store available" } });
        return;
      }
      const currentSeason = await store.getCurrentSeason();
      if (!currentSeason) {
        sendJson(response, 404, { error: { code: "no_active_season", message: "No active season found" } });
        return;
      }
      const summary = await store.closeSeason(currentSeason.seasonId);
      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: "admin:seasons",
        actorRole: "admin",
        action: "season_closed",
        targetScope: "season",
        summary: `Closed season ${currentSeason.seasonId}`,
        beforeJson: safeSerialize(currentSeason),
        metadataJson: safeSerialize({
          actorIp: readRequestIp(request),
          seasonId: currentSeason.seasonId,
          playersRewarded: summary.playersRewarded,
          totalGemsGranted: summary.totalGemsGranted
        })
      });
      sendJson(response, 200, { closed: true, ...summary });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
