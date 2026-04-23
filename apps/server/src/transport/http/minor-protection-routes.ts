import type { IncomingMessage, ServerResponse } from "node:http";
import { buildMinorProtectionBlockDetails, getMinorProtectionDateKey, readMinorProtectionConfig } from "@server/domain/ops/minor-protection";
import type { PlayerAccountSnapshot, RoomSnapshotStore } from "@server/persistence";
import { timingSafeCompareAdminToken } from "@server/infra/admin-token";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";

interface MinorProtectionApp {
  use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): void;
  get(path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): void;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function isAdminAuthorized(request: IncomingMessage): boolean {
  const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
  return timingSafeCompareAdminToken(request.headers["x-veil-admin-token"], adminToken);
}

function readOptionalTrimmedQueryParam(request: IncomingMessage, key: string): string | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function readOptionalDateQueryParam(request: IncomingMessage, key: string): Date | undefined {
  const value = readOptionalTrimmedQueryParam(request, key);
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`"${key}" must be a valid ISO-8601 datetime`);
  }

  return parsed;
}

function readOptionalIntegerQueryParam(request: IncomingMessage, key: string): number | undefined {
  const value = readOptionalTrimmedQueryParam(request, key);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`"${key}" must be a finite integer`);
  }

  return Math.max(0, Math.floor(parsed));
}

export function registerMinorProtectionRoutes(app: MinorProtectionApp, store: RoomSnapshotStore | null): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Veil-Admin-Token");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  const handleMinorProtectionRequest = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, {
          error: {
            code: "unauthorized",
            message: "Invalid admin token"
          }
        });
        return;
      }

      const playerId = readOptionalTrimmedQueryParam(request, "playerId");
      if (!playerId) {
        sendJson(response, 400, {
          error: {
            code: "invalid_request",
            message: '"playerId" is required'
          }
        });
        return;
      }

      const at = readOptionalDateQueryParam(request, "at") ?? new Date();
      const dailyPlayMinutesOverride = readOptionalIntegerQueryParam(request, "dailyPlayMinutes");
      const account = (await store?.loadPlayerAccount(playerId)) ?? null;
      const config = readMinorProtectionConfig();
      const overrideLocalDate = dailyPlayMinutesOverride == null ? undefined : getMinorProtectionDateKey(at, config.timeZone);
      const evaluationInput: Pick<PlayerAccountSnapshot, "isMinor" | "dailyPlayMinutes" | "lastPlayDate"> = {};
      const effectiveDailyPlayMinutes = dailyPlayMinutesOverride ?? account?.dailyPlayMinutes;
      const effectiveLastPlayDate = overrideLocalDate ?? account?.lastPlayDate;

      if (account?.isMinor !== undefined) {
        evaluationInput.isMinor = account.isMinor;
      }
      if (effectiveDailyPlayMinutes !== undefined) {
        evaluationInput.dailyPlayMinutes = effectiveDailyPlayMinutes;
      }
      if (effectiveLastPlayDate !== undefined) {
        evaluationInput.lastPlayDate = effectiveLastPlayDate;
      }

      sendJson(response, 200, buildMinorProtectionBlockDetails(evaluationInput, at, config));
    } catch (error) {
      sendJson(response, 400, {
        error: {
          code: "invalid_request",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  };

  app.get("/api/admin/minor-protection", handleMinorProtectionRequest);
  app.get("/api/admin/minor-protection/preview", handleMinorProtectionRequest);
}
