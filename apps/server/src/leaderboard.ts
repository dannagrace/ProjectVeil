import type { IncomingMessage, ServerResponse } from "node:http";
import { getTierForRating } from "../../../packages/shared/src/index";
import type { RoomSnapshotStore } from "./persistence";

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

const TIER_THRESHOLDS = [
  { tier: "bronze", minRating: 0, maxRating: 1099 },
  { tier: "silver", minRating: 1100, maxRating: 1299 },
  { tier: "gold", minRating: 1300, maxRating: 1499 },
  { tier: "platinum", minRating: 1500, maxRating: 1799 },
  { tier: "diamond", minRating: 1800, maxRating: null }
] as const;

export function registerLeaderboardRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null
): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
      const players = accounts.map((account) => ({
        playerId: account.playerId,
        displayName: account.displayName,
        eloRating: account.eloRating,
        tier: getTierForRating(account.eloRating ?? 1000)
      }));

      sendJson(response, 200, { players });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/matchmaking/tiers", (_request, response) => {
    sendJson(response, 200, { tiers: TIER_THRESHOLDS });
  });
}
