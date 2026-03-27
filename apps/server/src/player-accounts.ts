import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizePlayerBattleReplaySummaries } from "../../../packages/shared/src/index";
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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

function toReplayResponse(account: PlayerAccountSnapshot, limit?: number): { items: PlayerAccountSnapshot["recentBattleReplays"] } {
  const items = normalizePlayerBattleReplaySummaries(account.recentBattleReplays);
  const safeLimit = limit == null ? undefined : Math.max(1, Math.floor(limit));
  return {
    items: safeLimit == null ? items : items.slice(0, safeLimit)
  };
}

function sendStoreUnavailable(response: ServerResponse): void {
  sendJson(response, 503, {
    error: {
      code: "player_accounts_unavailable",
      message: "Player account persistence requires configured room persistence storage"
    }
  });
}

function sendUnauthorized(response: ServerResponse): void {
  sendJson(response, 401, {
    error: {
      code: "unauthorized",
      message: "Guest auth session is missing or invalid"
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
      sendStoreUnavailable(response);
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
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
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
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
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

  app.get("/api/player-accounts/:playerId", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
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
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
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

  app.put("/api/player-accounts/me", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

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
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/player-accounts/:playerId", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
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

      const account =
        Object.keys(patch).length === 0
          ? await store.ensurePlayerAccount({ playerId })
          : await store.savePlayerAccountProfile(playerId, patch);

      sendJson(response, 200, { account });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });
}
