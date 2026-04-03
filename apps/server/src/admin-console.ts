import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResourceLedger, WorldState } from "../../../packages/shared/src/index";
import type { RoomSnapshotStore } from "./persistence";
import { listLobbyRooms, getActiveRoomInstances } from "./colyseus-room";

class InvalidAdminJsonError extends Error {
  constructor() {
    super("Invalid JSON body");
    this.name = "InvalidAdminJsonError";
  }
}

class InvalidAdminPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAdminPayloadError";
  }
}

type AdminRequest = IncomingMessage & { params: Record<string, string> };
type AdminMiddleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
type AdminRouteHandler = (request: AdminRequest, response: ServerResponse) => void | Promise<void>;
type AdminApp = {
  use: (handler: AdminMiddleware) => void;
  get: (path: string, handler: AdminRouteHandler) => void;
  post: (path: string, handler: AdminRouteHandler) => void;
};

function readAdminSecret(): string | null {
  const secret = process.env.ADMIN_SECRET?.trim();
  return secret ? secret : null;
}

function isAdminSecretConfigured(): boolean {
  return readAdminSecret() !== null;
}

function isAuthorized(request: IncomingMessage): boolean {
  const adminSecret = readAdminSecret();
  return adminSecret !== null && request.headers["x-veil-admin-secret"] === adminSecret;
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

function sendAdminSecretNotConfigured(response: ServerResponse): void {
  sendJson(response, 503, { error: "ADMIN_SECRET is not configured" });
}

function sendStoreUnavailable(response: ServerResponse): void {
  sendJson(response, 503, { error: "Player moderation requires configured room persistence storage" });
}

function hasBanModerationStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "loadPlayerBan" | "listPlayerBanHistory" | "savePlayerBan" | "clearPlayerBan">> {
  return Boolean(store?.loadPlayerBan && store.listPlayerBanHistory && store.savePlayerBan && store.clearPlayerBan);
}

function sendInvalidJson(response: ServerResponse): void {
  sendJson(response, 400, { error: "Invalid JSON body" });
}

function sendInvalidPayload(response: ServerResponse, message: string): void {
  sendJson(response, 400, { error: message });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredObjectBody(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw new InvalidAdminPayloadError("JSON body must be an object");
  }
  return value;
}

function readRequiredParam(request: AdminRequest, key: string): string {
  const value = request.params[key];
  if (!value) {
    throw new InvalidAdminPayloadError(`Missing route parameter "${key}"`);
  }
  return value;
}

function readOptionalIntegerField(payload: Record<string, unknown>, key: keyof ResourceLedger): number {
  const value = payload[key];
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new InvalidAdminPayloadError(`"${key}" must be a finite integer`);
  }
  return value;
}

function readOptionalTrimmedString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new InvalidAdminPayloadError(`"${key}" must be a string`);
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function parseIsoTimestamp(value: string, key: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidAdminPayloadError(`"${key}" must be a valid ISO timestamp`);
  }
  return parsed.toISOString();
}

function parseBanBody(value: unknown): { banStatus: "temporary" | "permanent"; banReason: string; banExpiry?: string } {
  const payload = readRequiredObjectBody(value);
  const banStatus = readOptionalTrimmedString(payload, "banStatus");
  const banReason = readOptionalTrimmedString(payload, "banReason");
  const banExpiry = readOptionalTrimmedString(payload, "banExpiry");

  if (banStatus !== "temporary" && banStatus !== "permanent") {
    throw new InvalidAdminPayloadError('"banStatus" must be "temporary" or "permanent"');
  }
  if (!banReason) {
    throw new InvalidAdminPayloadError('"banReason" must be a non-empty string');
  }
  if (banStatus === "temporary") {
    if (!banExpiry) {
      throw new InvalidAdminPayloadError('"banExpiry" is required for temporary bans');
    }
    const normalizedExpiry = parseIsoTimestamp(banExpiry, "banExpiry");
    if (new Date(normalizedExpiry).getTime() <= Date.now()) {
      throw new InvalidAdminPayloadError('"banExpiry" must be in the future');
    }
    return { banStatus, banReason, banExpiry: normalizedExpiry };
  }

  return { banStatus, banReason };
}

function parseUnbanBody(value: unknown): { reason?: string } {
  if (value === undefined || value === null || value === "") {
    return {};
  }
  const payload = readRequiredObjectBody(value);
  const reason = readOptionalTrimmedString(payload, "reason");
  return reason ? { reason } : {};
}

function readLimit(request: IncomingMessage, fallback = 20): number {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const parsed = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function parseResourceDeltaBody(value: unknown): ResourceLedger {
  const payload = readRequiredObjectBody(value);
  return {
    gold: readOptionalIntegerField(payload, "gold"),
    wood: readOptionalIntegerField(payload, "wood"),
    ore: readOptionalIntegerField(payload, "ore")
  };
}

function parseBroadcastBody(value: unknown): { message: string; type: string } {
  const payload = readRequiredObjectBody(value);
  const message = payload.message;
  const announcementType = payload.type;

  if (typeof message !== "string" || message.trim().length === 0) {
    throw new InvalidAdminPayloadError('"message" must be a non-empty string');
  }
  if (announcementType !== undefined && (typeof announcementType !== "string" || announcementType.trim().length === 0)) {
    throw new InvalidAdminPayloadError('"type" must be a non-empty string');
  }

  return {
    message: message.trim(),
    type: typeof announcementType === "string" ? announcementType.trim() : "info"
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new InvalidAdminJsonError();
  }
}

export function registerAdminRoutes(
  app: AdminApp,
  store: RoomSnapshotStore | null,
  _gameServer?: unknown
): void {
  app.use((request, response, next) => {
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, x-veil-admin-secret");
      response.statusCode = 204;
      response.end();
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
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
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
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    try {
      const playerId = readRequiredParam(request, "id");
      const { gold, wood, ore } = parseResourceDeltaBody(await readJsonBody(request));
      let currentResources: ResourceLedger = { gold: 0, wood: 0, ore: 0 };
      if (store) {
        let account = await store.loadPlayerAccount(playerId);
        if (!account) {
          account = await store.ensurePlayerAccount({ playerId, displayName: playerId });
        }
        if (account?.globalResources) {
          currentResources = { ...account.globalResources };
        }
      }

      const nextResources: ResourceLedger = {
        gold: Math.max(0, currentResources.gold + gold),
        wood: Math.max(0, currentResources.wood + wood),
        ore: Math.max(0, currentResources.ore + ore)
      };

      if (store) await store.savePlayerAccountProgress(playerId, { globalResources: nextResources });

      let syncedToRoom = false;
      const activeRooms = getActiveRoomInstances();

      for (const [roomId, vRoom] of activeRooms) {
        if (vRoom.worldRoom) {
          const internalState = vRoom.worldRoom.getInternalState() as WorldState & {
            playerResources?: Record<string, ResourceLedger>;
          };

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
                battle: null,
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
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      console.error("[Admin] Sync error:", error);
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/broadcast", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    try {
      const { message, type } = parseBroadcastBody(await readJsonBody(request));
      const activeRooms = getActiveRoomInstances();
      for (const [_, room] of activeRooms) {
        room.broadcast("system.announcement", { text: message, type, timestamp: new Date().toISOString() });
      }
      sendJson(response, 200, { ok: true });
    } catch (error) {
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/players/:id/ban", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    if (!hasBanModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const input = parseBanBody(await readJsonBody(request));
      const account = await store.savePlayerBan(playerId, input);
      let disconnectedClients = 0;
      for (const room of getActiveRoomInstances().values()) {
        disconnectedClients += room.disconnectPlayer(playerId, "account_banned");
      }
      sendJson(response, 200, { ok: true, account, disconnectedClients });
    } catch (error) {
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/players/:id/unban", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    if (!hasBanModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const input = parseUnbanBody(await readJsonBody(request));
      const account = await store.clearPlayerBan(playerId, input);
      sendJson(response, 200, { ok: true, account });
    } catch (error) {
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/players/:id/ban-history", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    if (!hasBanModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request as AdminRequest, "id");
      const items = await store.listPlayerBanHistory(playerId, { limit: readLimit(request) });
      const currentBan = await store.loadPlayerBan(playerId);
      sendJson(response, 200, { items, currentBan });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });
}
