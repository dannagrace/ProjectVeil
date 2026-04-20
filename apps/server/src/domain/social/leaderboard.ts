import type { IncomingMessage, ServerResponse } from "node:http";
import { getRankDivisionForRating } from "@veil/shared/progression";
import { getCurrentAndPreviousWeeklyEntries } from "@server/domain/social/competitive-season";
import type { ConfigCenterStore } from "@server/config-center";
import {
  DEFAULT_LEADERBOARD_TIER_THRESHOLDS,
  getLeaderboardTierForRating,
  parseLeaderboardTierThresholdsConfigDocument,
  type LeaderboardTierThreshold
} from "@server/domain/social/leaderboard-tier-thresholds";
import type { RoomSnapshotStore } from "@server/persistence";
import { isLeaderboardFrozen, isLeaderboardHidden } from "@server/domain/social/leaderboard-anti-abuse";
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

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  return value?.trim() || null;
}

function isAdminAuthorized(request: IncomingMessage): boolean {
  const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
  return Boolean(adminToken) && readHeaderValue(request.headers["x-veil-admin-token"]) === adminToken;
}

function readLimit(request: IncomingMessage, fallback = 100): number {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const rawLimit = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(rawLimit)) {
    return fallback;
  }
  return Math.min(100, Math.max(1, Math.floor(rawLimit)));
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

export function registerLeaderboardRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null,
  configCenterStore?: Pick<ConfigCenterStore, "loadDocument">
): void {
  let cachedTierThresholds: readonly LeaderboardTierThreshold[] = DEFAULT_LEADERBOARD_TIER_THRESHOLDS;

  if (configCenterStore) {
    void configCenterStore
      .loadDocument("leaderboardTierThresholds")
      .then((document) => {
        cachedTierThresholds = parseLeaderboardTierThresholdsConfigDocument(document.content).tiers;
      })
      .catch((error) => {
        console.warn("[leaderboard] Failed to load config-center leaderboard tier thresholds; using defaults", error);
      });
  }

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

  app.get("/api/leaderboard", async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const rawLimit = url.searchParams.get("limit");
      const parsedLimit = rawLimit ? Number(rawLimit) : 50;
      const limitValue = Number.isFinite(parsedLimit) ? Math.floor(parsedLimit) : 50;
      const limit = Math.min(100, Math.max(1, limitValue));

      if (!store) {
        sendJson(response, 200, { players: [] });
        return;
      }

      const accounts = await store.listPlayerAccounts({ limit, orderBy: "eloRating" });
      const players = accounts
        .filter((account) => !isLeaderboardHidden(account.leaderboardModerationState))
        .map((account) => ({
        playerId: account.playerId,
        displayName: account.displayName,
        eloRating: account.eloRating,
        tier: getLeaderboardTierForRating(account.eloRating, cachedTierThresholds),
        division: account.rankDivision ?? getRankDivisionForRating(account.eloRating ?? 1000),
        isFrozen: isLeaderboardFrozen(account.leaderboardModerationState),
        promotionSeries: account.promotionSeries ?? null,
        demotionShield: account.demotionShield ?? null
        }));

      sendJson(response, 200, { players });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/leaderboard/weekly", async (_request, response) => {
    try {
      if (!store) {
        sendJson(response, 200, { current: [], previous: [] });
        return;
      }
      const accounts = (await store.listPlayerAccounts({ limit: 500, orderBy: "eloRating" })).filter(
        (account) => !isLeaderboardHidden(account.leaderboardModerationState)
      );
      const { current, previous } = getCurrentAndPreviousWeeklyEntries(accounts);
      sendJson(response, 200, { current, previous });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player/:id/season-history", async (request, response) => {
    try {
      if (!store) {
        sendJson(response, 200, { history: [] });
        return;
      }
      const url = request.url ?? "/";
      const match = url.match(/\/api\/player\/([^/]+)\/season-history/);
      const playerId = match?.[1] ? decodeURIComponent(match[1]) : "";
      if (!playerId) {
        sendJson(response, 400, { error: { code: "invalid_player_id", message: "Player id is required" } });
        return;
      }
      const account = await store.loadPlayerAccount(playerId);
      sendJson(response, 200, { history: account?.seasonHistory ?? [] });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/leaderboard/seasons/:seasonId", async (request, response) => {
    try {
      const url = request.url ?? "/";
      const match = url.match(/\/api\/leaderboard\/seasons\/([^/?]+)/);
      const seasonId = match?.[1] ? decodeURIComponent(match[1]) : "";
      if (!seasonId) {
        sendJson(response, 400, { error: { code: "invalid_season_id", message: "Season id is required" } });
        return;
      }
      if (!store?.listLeaderboardSeasonArchive) {
        sendJson(response, 200, { seasonId, rankings: [] });
        return;
      }

      sendJson(response, 200, {
        seasonId,
        rankings: await store.listLeaderboardSeasonArchive(seasonId, readLimit(request))
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/admin/leaderboard/season-rollover", async (request, response) => {
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
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        sendJson(response, 400, { error: { code: "invalid_request", message: "Request body must be an object" } });
        return;
      }
      const seasonId = String((body as Record<string, unknown>).seasonId ?? "").trim();
      const nextSeasonId = String((body as Record<string, unknown>).nextSeasonId ?? "").trim();
      if (!seasonId || !nextSeasonId) {
        sendJson(response, 400, {
          error: {
            code: "invalid_request",
            message: "seasonId and nextSeasonId are required"
          }
        });
        return;
      }
      if (seasonId === nextSeasonId) {
        sendJson(response, 400, {
          error: {
            code: "invalid_request",
            message: "nextSeasonId must differ from seasonId"
          }
        });
        return;
      }

      const currentSeason = await store.getCurrentSeason();
      if (!currentSeason) {
        sendJson(response, 404, { error: { code: "no_active_season", message: "No active season found" } });
        return;
      }
      if (currentSeason.seasonId !== seasonId && currentSeason.seasonId !== nextSeasonId) {
        sendJson(response, 409, {
          error: {
            code: "season_rollover_conflict",
            message: `Active season ${currentSeason.seasonId} does not match rollover request`
          }
        });
        return;
      }

      const closeSummary = await store.closeSeason(seasonId);
      const nextSeason = currentSeason.seasonId === nextSeasonId ? currentSeason : await store.createSeason(nextSeasonId);
      sendJson(response, 200, {
        rolledOver: currentSeason.seasonId === seasonId,
        seasonId,
        nextSeason,
        archive:
          store.listLeaderboardSeasonArchive != null
            ? await store.listLeaderboardSeasonArchive(seasonId, 100)
            : [],
        summary: closeSummary
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/matchmaking/tiers", (_request, response) => {
    sendJson(response, 200, { tiers: cachedTierThresholds });
  });
}
