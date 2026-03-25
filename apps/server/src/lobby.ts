import type { IncomingMessage, ServerResponse } from "node:http";
import type { LobbyRoomSummary } from "./colyseus-room";

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

export function registerLobbyRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  options: {
    listRooms: () => LobbyRoomSummary[];
  }
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

  app.get("/api/lobby/rooms", async (request, response) => {
    try {
      const limit = parseLimit(request);
      const rooms = options.listRooms();
      sendJson(response, 200, {
        items: limit != null ? rooms.slice(0, Math.max(1, Math.floor(limit))) : rooms
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
