import type { IncomingMessage, ServerResponse } from "node:http";
import {
  buildPlayerProgressionSnapshot,
  queryAchievementProgress,
  queryEventLogEntries,
  normalizePlayerBattleReplaySummaries
} from "../../../packages/shared/src/index";
import { issueNextAuthSession, resolveAuthSessionFromRequest } from "./auth";
import type { PlayerAccountProfilePatch, PlayerAccountSnapshot, RoomSnapshotStore } from "./persistence";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "Player account route not found"
    }
  });
}

function toErrorPayload(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "error" : "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "payload_too_large";
  }
}

const MAX_JSON_BODY_BYTES = 64 * 1024;

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

function parsePlayerIdFilter(request: IncomingMessage): string | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get("playerId")?.trim();
  return value ? value : undefined;
}

function parseOptionalQueryParam(request: IncomingMessage, key: string): string | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function parseBooleanQueryParam(request: IncomingMessage, key: string): boolean | undefined {
  const value = parseOptionalQueryParam(request, key)?.toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function toReplayResponse(account: PlayerAccountSnapshot, limit?: number): { items: PlayerAccountSnapshot["recentBattleReplays"] } {
  const items = normalizePlayerBattleReplaySummaries(account.recentBattleReplays);
  const safeLimit = limit == null ? undefined : Math.max(1, Math.floor(limit));
  return {
    items: safeLimit == null ? items : items.slice(0, safeLimit)
  };
}

function toEventLogResponse(
  account: PlayerAccountSnapshot,
  request: IncomingMessage
): { items: PlayerAccountSnapshot["recentEventLog"] } {
  const limit = parseLimit(request);
  const category = parseOptionalQueryParam(request, "category") as
    | PlayerAccountSnapshot["recentEventLog"][number]["category"]
    | undefined;
  const heroId = parseOptionalQueryParam(request, "heroId");
  const achievementId = parseOptionalQueryParam(request, "achievementId") as
    | PlayerAccountSnapshot["recentEventLog"][number]["achievementId"]
    | undefined;
  const worldEventType = parseOptionalQueryParam(request, "worldEventType") as
    | PlayerAccountSnapshot["recentEventLog"][number]["worldEventType"]
    | undefined;

  return {
    items: queryEventLogEntries(account.recentEventLog, {
      ...(limit != null ? { limit } : {}),
      ...(category ? { category } : {}),
      ...(heroId ? { heroId } : {}),
      ...(achievementId ? { achievementId } : {}),
      ...(worldEventType ? { worldEventType } : {})
    })
  };
}

function toAchievementResponse(account: PlayerAccountSnapshot, request: IncomingMessage): { items: PlayerAccountSnapshot["achievements"] } {
  const limit = parseLimit(request);
  const achievementId = parseOptionalQueryParam(request, "achievementId") as
    | PlayerAccountSnapshot["achievements"][number]["id"]
    | undefined;
  const metric = parseOptionalQueryParam(request, "metric") as
    | PlayerAccountSnapshot["achievements"][number]["metric"]
    | undefined;
  const unlocked = parseBooleanQueryParam(request, "unlocked");

  return {
    items: queryAchievementProgress(account.achievements, {
      ...(limit != null ? { limit } : {}),
      ...(achievementId ? { achievementId } : {}),
      ...(metric ? { metric } : {}),
      ...(unlocked != null ? { unlocked } : {})
    })
  };
}

function toProgressionResponse(
  account: PlayerAccountSnapshot,
  limit?: number
): ReturnType<typeof buildPlayerProgressionSnapshot> {
  return buildPlayerProgressionSnapshot(account.achievements, account.recentEventLog, limit);
}

function normalizePlayerId(playerId?: string | null): string {
  const normalized = playerId?.trim();
  return normalized && normalized.length > 0 ? normalized : "player";
}

function normalizeDisplayName(playerId: string, displayName?: string | null): string {
  const normalized = displayName?.trim();
  return normalized && normalized.length > 0 ? normalized : playerId;
}

function normalizeLoginId(loginId?: string | null): string | undefined {
  const normalized = loginId?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function createLocalModeAccount(input: {
  playerId?: string | null | undefined;
  displayName?: string | null | undefined;
  lastRoomId?: string | null | undefined;
  loginId?: string | null | undefined;
  credentialBoundAt?: string | null | undefined;
}): PlayerAccountSnapshot {
  const playerId = normalizePlayerId(input.playerId);
  const displayName = normalizeDisplayName(playerId, input.displayName);
  const lastRoomId = input.lastRoomId?.trim();
  const loginId = normalizeLoginId(input.loginId);
  const credentialBoundAt = input.credentialBoundAt?.trim();

  return {
    playerId,
    displayName,
    globalResources: {
      gold: 0,
      wood: 0,
      ore: 0
    },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [],
    ...(lastRoomId ? { lastRoomId } : {}),
    ...(loginId ? { loginId } : {}),
    ...(credentialBoundAt ? { credentialBoundAt } : {})
  };
}

function sendUnauthorized(response: ServerResponse): void {
  sendJson(response, 401, {
    error: {
      code: "unauthorized",
      message: "Guest auth session is missing or invalid"
    }
  });
}

function sendForbidden(response: ServerResponse): void {
  sendJson(response, 403, {
    error: {
      code: "forbidden",
      message: "Authenticated players may only modify their own profile"
    }
  });
}

function toPublicPlayerAccount(account: PlayerAccountSnapshot): Omit<PlayerAccountSnapshot, "loginId" | "credentialBoundAt"> {
  const { loginId: _loginId, credentialBoundAt: _credentialBoundAt, ...publicAccount } = account;
  return publicAccount;
}

export function registerPlayerAccountRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
    put: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null
): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/player-accounts", async (request, response) => {
    if (!store) {
      sendJson(response, 200, {
        items: []
      });
      return;
    }

    try {
      const limit = parseLimit(request);
      const playerId = parsePlayerIdFilter(request);
      sendJson(response, 200, {
        items: (await store.listPlayerAccounts({
          ...(limit != null ? { limit } : {}),
          ...(playerId ? { playerId } : {})
        })).map((account) => toPublicPlayerAccount(account))
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me", async (request, response) => {
    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
      return;
    }

    if (!store) {
      const account = createLocalModeAccount({
        playerId: authSession.playerId,
        displayName: authSession.displayName,
        loginId: authSession.loginId
      });
      sendJson(response, 200, {
        account,
        session: issueNextAuthSession(account, authSession)
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, {
        account,
        session: issueNextAuthSession(account, authSession)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/battle-replays", async (request, response) => {
    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        items: []
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, toReplayResponse(account, parseLimit(request)));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/event-log", async (request, response) => {
    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toEventLogResponse(
          createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            loginId: authSession.loginId
          }),
          request
        )
      );
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, toEventLogResponse(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/achievements", async (request, response) => {
    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toAchievementResponse(
          createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            loginId: authSession.loginId
          }),
          request
        )
      );
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, toAchievementResponse(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/progression", async (request, response) => {
    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toProgressionResponse(
          createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            loginId: authSession.loginId
          }),
          parseLimit(request)
        )
      );
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, toProgressionResponse(account, parseLimit(request)));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        account: toPublicPlayerAccount(
          createLocalModeAccount({
            playerId
          })
        )
      });
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, { account: toPublicPlayerAccount(account) });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/battle-replays", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        items: []
      });
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, toReplayResponse(account, parseLimit(request)));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/event-log", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toEventLogResponse(
          createLocalModeAccount({
            playerId
          }),
          request
        )
      );
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, toEventLogResponse(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/achievements", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toAchievementResponse(
          createLocalModeAccount({
            playerId
          }),
          request
        )
      );
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, toAchievementResponse(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/progression", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toProgressionResponse(
          createLocalModeAccount({
            playerId
          }),
          parseLimit(request)
        )
      );
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, toProgressionResponse(account, parseLimit(request)));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/player-accounts/me", async (request, response) => {
    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        displayName?: string | null;
        lastRoomId?: string | null;
      };

      if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: displayName"
          }
        });
        return;
      }

      if (body.lastRoomId !== undefined && body.lastRoomId !== null && typeof body.lastRoomId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: lastRoomId"
          }
        });
        return;
      }

      const patch: PlayerAccountProfilePatch = {
        ...(body.displayName !== undefined ? { displayName: body.displayName ?? "" } : {}),
        ...(body.lastRoomId !== undefined ? { lastRoomId: body.lastRoomId } : {})
      };

      if (!store) {
        const account = createLocalModeAccount({
          playerId: authSession.playerId,
          displayName: patch.displayName ?? authSession.displayName,
          lastRoomId: patch.lastRoomId,
          loginId: authSession.loginId
        });
        sendJson(response, 200, {
          account,
          session: issueNextAuthSession(account, authSession)
        });
        return;
      }

      const account =
        Object.keys(patch).length === 0
          ? await store.ensurePlayerAccount({
              playerId: authSession.playerId,
              displayName: authSession.displayName
            })
          : await store.savePlayerAccountProfile(authSession.playerId, patch);

      sendJson(response, 200, {
        account,
        session: issueNextAuthSession(account, authSession)
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/player-accounts/:playerId", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    const authSession = resolveAuthSessionFromRequest(request);
    if (authSession && authSession.playerId !== playerId) {
      sendForbidden(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        displayName?: string | null;
        lastRoomId?: string | null;
      };

      if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: displayName"
          }
        });
        return;
      }

      if (body.lastRoomId !== undefined && body.lastRoomId !== null && typeof body.lastRoomId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: lastRoomId"
          }
        });
        return;
      }

      const patch: PlayerAccountProfilePatch = {
        ...(body.displayName !== undefined ? { displayName: body.displayName ?? "" } : {}),
        ...(body.lastRoomId !== undefined ? { lastRoomId: body.lastRoomId } : {})
      };

      if (!store) {
        const account = createLocalModeAccount({
          playerId,
          displayName: patch.displayName ?? authSession?.displayName ?? playerId,
          lastRoomId: patch.lastRoomId,
          loginId: authSession?.playerId === playerId ? authSession.loginId : undefined
        });
        sendJson(response, 200, {
          account,
          ...(authSession?.playerId === playerId ? { session: issueNextAuthSession(account, authSession) } : {})
        });
        return;
      }

      if (!authSession) {
        sendUnauthorized(response);
        return;
      }

      const account =
        Object.keys(patch).length === 0
          ? await store.ensurePlayerAccount({
              playerId: authSession.playerId,
              displayName: authSession.displayName
            })
          : await store.savePlayerAccountProfile(playerId, patch);

      sendJson(response, 200, {
        account,
        session: issueNextAuthSession(account, authSession)
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });
}
