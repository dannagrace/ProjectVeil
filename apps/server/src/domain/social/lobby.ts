import type { IncomingMessage, ServerResponse } from "node:http";
import { validateAuthSessionFromRequest } from "@server/domain/account/auth";
import type { RoomSnapshotStore } from "@server/persistence";

export interface LobbyRoomSummary {
  roomId: string;
  seed: number;
  day: number;
  connectedPlayers: number;
  disconnectedPlayers: number;
  heroCount: number;
  activeBattles: number;
  statusLabel: string;
  updatedAt: string;
}

export type PublicLobbyRoomSummary = Omit<LobbyRoomSummary, "seed">;

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

function parseLimit(request: IncomingMessage): number | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get("limit");
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function requireAuthSession(
  request: IncomingMessage,
  response: ServerResponse,
  store: RoomSnapshotStore | null
): Promise<boolean> {
  const result = await validateAuthSessionFromRequest(request, store);
  if (result.session) {
    return true;
  }

  if (result.errorCode === "account_banned") {
    sendJson(response, 403, {
      error: {
        code: "account_banned",
        message: "Account is banned",
        reason: result.ban?.banReason ?? "No reason provided",
        ...(result.ban?.banExpiry ? { expiry: result.ban.banExpiry } : {})
      }
    });
    return false;
  }

  sendJson(response, 401, {
    error: {
      code: result.errorCode ?? "unauthorized",
      message: "Authentication required"
    }
  });
  return false;
}

function toPublicLobbyRoomSummary(summary: LobbyRoomSummary): PublicLobbyRoomSummary {
  const { seed: _seed, ...publicSummary } = summary;
  return publicSummary;
}

export function registerLobbyRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  options: {
    listRooms: () => LobbyRoomSummary[];
    store?: RoomSnapshotStore | null;
  }
): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/lobby/rooms", async (request, response) => {
    if (!(await requireAuthSession(request, response, options.store ?? null))) {
      return;
    }

    try {
      const limit = parseLimit(request);
      const rooms = options.listRooms().map(toPublicLobbyRoomSummary);
      sendJson(response, 200, {
        items: limit != null ? rooms.slice(0, Math.max(1, Math.floor(limit))) : rooms
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
