import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoomSnapshotStore, PlayerAccountSnapshot } from "./persistence";
import { LobbyRoomSummary, listLobbyRooms, getActiveRoomInstances } from "./colyseus-room";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "veil-admin-2026";

function isAuthorized(request: IncomingMessage): boolean {
  return request.headers["x-veil-admin-secret"] === ADMIN_SECRET;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, x-veil-admin-secret");
  response.end(JSON.stringify(payload));
}

function sendUnauthorized(response: ServerResponse): void {
  sendJson(response, 401, { error: "Unauthorized: Invalid Admin Secret" });
}

async function readJsonBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function registerAdminRoutes(
  app: {
    use: (handler: any) => void;
    get: (path: string, handler: (request: any, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: any, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null,
  gameServer?: any 
): void {
  
  app.use((req: any, res: any, next: any) => {
    if (req.method === 'OPTIONS') {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-veil-admin-secret");
        res.statusCode = 204;
        res.end();
        return;
    }
    next();
  });

  app.get("/admin", async (request, response) => {
    try {
      const html = await readFile(join(process.cwd(), "apps/client/admin.html"), "utf8");
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
    } catch (error) {
      response.statusCode = 500;
      response.end("Failed to load admin.html");
    }
  });

  app.get("/api/admin/overview", async (request, response) => {
    if (!isAuthorized(request)) return sendUnauthorized(response);
    const lobbyRooms = listLobbyRooms();
    sendJson(response, 200, {
      serverTime: new Date().toISOString(),
      activeRooms: lobbyRooms.length,
      activePlayers: lobbyRooms.reduce((sum, r) => sum + r.connectedPlayers, 0),
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage()
    });
  });

  app.post("/api/admin/players/:id/resources", async (request, response) => {
    if (!isAuthorized(request)) return sendUnauthorized(response);
    const playerId = request.params.id;
    const { gold, wood, ore } = await readJsonBody(request);

    try {
      let currentResources = { gold: 0, wood: 0, ore: 0 };
      if (store) {
          let account = await store.loadPlayerAccount(playerId);
          if (!account) account = await store.ensurePlayerAccount({ playerId, displayName: playerId });
          if (account && account.globalResources) currentResources = { ...account.globalResources };
      }

      const nextResources = {
        gold: Math.max(0, currentResources.gold + (gold || 0)),
        wood: Math.max(0, currentResources.wood + (wood || 0)),
        ore: Math.max(0, currentResources.ore + (ore || 0))
      };

      if (store) await store.savePlayerAccountProgress(playerId, { globalResources: nextResources });

      let syncedToRoom = false;
      const activeRooms = getActiveRoomInstances();

      for (const [roomId, vRoom] of activeRooms) {
          if (vRoom.worldRoom) {
              const internalState = vRoom.worldRoom.getInternalState();
              
              if (internalState.resources && internalState.resources[playerId]) {
                  internalState.resources[playerId] = { ...nextResources };
              }
              
              if (internalState.playerResources && internalState.playerResources[playerId]) {
                  internalState.playerResources[playerId] = { ...nextResources };
              }

              console.log(`[Admin] Patched room ${roomId} for ${playerId}:`, nextResources);
              
              const snapshot = vRoom.worldRoom.getSnapshot(playerId);
              snapshot.state.resources = { ...nextResources };
              
              for (const client of vRoom.clients) {
                  client.send("session.state", {
                      delivery: "push",
                      payload: {
                          world: snapshot.state,
                          battle: snapshot.battle,
                          events: [{ type: "system.announcement", text: "资源已更新", tone: "system" }],
                          movementPlan: null,
                          reachableTiles: []
                      }
                  });
              }
              
              syncedToRoom = true;
          }
      }

      sendJson(response, 200, { ok: true, resources: nextResources, syncedToRoom });
    } catch (error) {
      console.error("[Admin] Sync error:", error);
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/broadcast", async (request, response) => {
    if (!isAuthorized(request)) return sendUnauthorized(response);
    const { message, type = "info" } = await readJsonBody(request);
    const activeRooms = getActiveRoomInstances();
    for (const [_, room] of activeRooms) {
        room.broadcast("system.announcement", { text: message, type, timestamp: new Date().toISOString() });
    }
    sendJson(response, 200, { ok: true });
  });
}
