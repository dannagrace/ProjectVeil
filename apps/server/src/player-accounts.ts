import type { IncomingMessage, ServerResponse } from "node:http";
import {
  applyBattleReplayPlaybackCommand,
  buildPlayerProgressionSnapshot,
  findPlayerBattleReplaySummary,
  getAchievementDefinitions,
  normalizeAchievementProgressQuery,
  normalizeEventLogQuery,
  queryPlayerBattleReplaySummaries,
  queryAchievementProgress,
  queryEventLogEntries,
  type PlayerBattleReplaySummary
} from "../../../packages/shared/src/index";
import { issueNextAuthSession, resolveAuthSessionFromRequest } from "./auth";
import type {
  PlayerAccountProfilePatch,
  PlayerAccountSnapshot,
  PlayerEventHistoryQuery,
  RoomSnapshotStore
} from "./persistence";

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

function parseOffset(request: IncomingMessage): number | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get("offset");
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

function parseNumberQueryParam(request: IncomingMessage, key: string): number | undefined {
  const value = parseOptionalQueryParam(request, key);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTimestampQueryParam(request: IncomingMessage, key: string): string | undefined {
  const value = parseOptionalQueryParam(request, key);
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toReplayResponseFromRequest(
  account: PlayerAccountSnapshot,
  request: IncomingMessage
): { items: PlayerAccountSnapshot["recentBattleReplays"] } {
  const limit = parseLimit(request);
  const roomId = parseOptionalQueryParam(request, "roomId");
  const battleId = parseOptionalQueryParam(request, "battleId");
  const battleKind = parseOptionalQueryParam(request, "battleKind") as
    | PlayerBattleReplaySummary["battleKind"]
    | undefined;
  const playerCamp = parseOptionalQueryParam(request, "playerCamp") as
    | PlayerBattleReplaySummary["playerCamp"]
    | undefined;
  const heroId = parseOptionalQueryParam(request, "heroId");
  const opponentHeroId = parseOptionalQueryParam(request, "opponentHeroId");
  const neutralArmyId = parseOptionalQueryParam(request, "neutralArmyId");
  const result = parseOptionalQueryParam(request, "result") as
    | PlayerBattleReplaySummary["result"]
    | undefined;

  return {
    items: queryPlayerBattleReplaySummaries(account.recentBattleReplays, {
      ...(limit != null ? { limit } : {}),
      ...(roomId ? { roomId } : {}),
      ...(battleId ? { battleId } : {}),
      ...(battleKind ? { battleKind } : {}),
      ...(playerCamp ? { playerCamp } : {}),
      ...(heroId ? { heroId } : {}),
      ...(opponentHeroId ? { opponentHeroId } : {}),
      ...(neutralArmyId ? { neutralArmyId } : {}),
      ...(result ? { result } : {})
    })
  };
}

function toReplayDetailResponse(
  account: PlayerAccountSnapshot,
  replayId?: string | null
): { replay: NonNullable<PlayerAccountSnapshot["recentBattleReplays"]>[number] } | null {
  const replay = findPlayerBattleReplaySummary(account.recentBattleReplays, replayId);
  return replay ? { replay } : null;
}

function toReplayPlaybackResponse(
  account: PlayerAccountSnapshot,
  request: IncomingMessage,
  replayId?: string | null
) {
  const replay = findPlayerBattleReplaySummary(account.recentBattleReplays, replayId);
  if (!replay) {
    return null;
  }

  const currentStepIndex = parseNumberQueryParam(request, "currentStepIndex");
  const status = parseOptionalQueryParam(request, "status") as "paused" | "playing" | undefined;
  const action = parseOptionalQueryParam(request, "action") as "play" | "pause" | "step" | "tick" | "reset" | undefined;
  const repeat = parseNumberQueryParam(request, "repeat");

  return {
    playback: applyBattleReplayPlaybackCommand(replay, {
      ...(currentStepIndex != null ? { currentStepIndex } : {}),
      ...(status ? { status } : {}),
      ...(action ? { action } : {}),
      ...(repeat != null ? { repeat } : {})
    })
  };
}

function toEventLogResponse(
  account: PlayerAccountSnapshot,
  request: IncomingMessage
): { items: PlayerAccountSnapshot["recentEventLog"] } {
  const query = normalizeEventLogQuery({
    limit: parseLimit(request) ?? undefined,
    category: parseOptionalQueryParam(request, "category") as
      | PlayerAccountSnapshot["recentEventLog"][number]["category"]
      | undefined,
    heroId: parseOptionalQueryParam(request, "heroId") ?? undefined,
    achievementId: parseOptionalQueryParam(request, "achievementId") as
      | PlayerAccountSnapshot["recentEventLog"][number]["achievementId"]
      | undefined,
    worldEventType: parseOptionalQueryParam(request, "worldEventType") as
      | PlayerAccountSnapshot["recentEventLog"][number]["worldEventType"]
      | undefined
  });

  return {
    items: queryEventLogEntries(account.recentEventLog, query)
  };
}

function toEventHistoryQuery(request: IncomingMessage): PlayerEventHistoryQuery {
  return normalizeEventLogQuery({
    limit: parseLimit(request) ?? undefined,
    offset: parseOffset(request) ?? undefined,
    category: parseOptionalQueryParam(request, "category") as PlayerAccountSnapshot["recentEventLog"][number]["category"] | undefined,
    heroId: parseOptionalQueryParam(request, "heroId") ?? undefined,
    achievementId: parseOptionalQueryParam(request, "achievementId") as
      | PlayerAccountSnapshot["recentEventLog"][number]["achievementId"]
      | undefined,
    worldEventType: parseOptionalQueryParam(request, "worldEventType") as
      | PlayerAccountSnapshot["recentEventLog"][number]["worldEventType"]
      | undefined,
    since: parseTimestampQueryParam(request, "since") ?? undefined,
    until: parseTimestampQueryParam(request, "until") ?? undefined
  });
}

function toAchievementResponse(account: PlayerAccountSnapshot, request: IncomingMessage): { items: PlayerAccountSnapshot["achievements"] } {
  const query = normalizeAchievementProgressQuery({
    limit: parseLimit(request) ?? undefined,
    achievementId: parseOptionalQueryParam(request, "achievementId") as
      | PlayerAccountSnapshot["achievements"][number]["id"]
      | undefined,
    metric: parseOptionalQueryParam(request, "metric") as
      | PlayerAccountSnapshot["achievements"][number]["metric"]
      | undefined,
    unlocked: parseBooleanQueryParam(request, "unlocked") ?? undefined
  });

  return {
    items: queryAchievementProgress(account.achievements, query)
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

  app.get("/api/player-accounts/achievement-definitions", (_request, response) => {
    sendJson(response, 200, {
      items: getAchievementDefinitions()
    });
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
      sendJson(response, 200, toReplayResponseFromRequest(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/battle-replays/:replayId", async (request, response) => {
    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
      return;
    }

    const replayId = request.params.replayId?.trim();
    if (!replayId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 404, {
        error: {
          code: "player_battle_replay_not_found",
          message: `Player battle replay not found: ${replayId}`
        }
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
      const detail = toReplayDetailResponse(account, replayId);
      if (!detail) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      sendJson(response, 200, detail);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/battle-replays/:replayId/playback", async (request, response) => {
    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
      return;
    }

    const replayId = request.params.replayId?.trim();
    if (!replayId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 404, {
        error: {
          code: "player_battle_replay_not_found",
          message: `Player battle replay not found: ${replayId}`
        }
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
      const playback = toReplayPlaybackResponse(account, request, replayId);
      if (!playback) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      sendJson(response, 200, playback);
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

  app.get("/api/player-accounts/me/event-history", async (request, response) => {
    const authSession = resolveAuthSessionFromRequest(request);
    if (!authSession) {
      sendUnauthorized(response);
      return;
    }

    const query = toEventHistoryQuery(request);
    if (!store) {
      const account = createLocalModeAccount({
        playerId: authSession.playerId,
        displayName: authSession.displayName,
        loginId: authSession.loginId
      });
      const total = queryEventLogEntries(account.recentEventLog, {
        ...query,
        limit: undefined,
        offset: undefined
      }).length;
      const items = queryEventLogEntries(account.recentEventLog, query);
      sendJson(response, 200, {
        items,
        total,
        offset: Math.max(0, Math.floor(query.offset ?? 0)),
        limit: query.limit ?? items.length,
        hasMore: (query.offset ?? 0) + items.length < total
      });
      return;
    }

    try {
      const history = await store.loadPlayerEventHistory(authSession.playerId, query);
      sendJson(response, 200, {
        ...history,
        offset: Math.max(0, Math.floor(query.offset ?? 0)),
        limit: query.limit ?? history.items.length,
        hasMore: (query.offset ?? 0) + history.items.length < history.total
      });
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

      sendJson(response, 200, toReplayResponseFromRequest(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/battle-replays/:replayId", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    const replayId = request.params.replayId?.trim();
    if (!playerId || !replayId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 404, {
        error: {
          code: "player_battle_replay_not_found",
          message: `Player battle replay not found: ${replayId}`
        }
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

      const detail = toReplayDetailResponse(account, replayId);
      if (!detail) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      sendJson(response, 200, detail);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/battle-replays/:replayId/playback", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    const replayId = request.params.replayId?.trim();
    if (!playerId || !replayId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 404, {
        error: {
          code: "player_battle_replay_not_found",
          message: `Player battle replay not found: ${replayId}`
        }
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

      const playback = toReplayPlaybackResponse(account, request, replayId);
      if (!playback) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      sendJson(response, 200, playback);
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

  app.get("/api/player-accounts/:playerId/event-history", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    const query = toEventHistoryQuery(request);
    if (!store) {
      const items = queryEventLogEntries([], query);
      sendJson(response, 200, {
        items,
        total: 0,
        offset: Math.max(0, Math.floor(query.offset ?? 0)),
        limit: query.limit ?? items.length,
        hasMore: false
      });
      return;
    }

    try {
      const history = await store.loadPlayerEventHistory(playerId, query);
      sendJson(response, 200, {
        ...history,
        offset: Math.max(0, Math.floor(query.offset ?? 0)),
        limit: query.limit ?? history.items.length,
        hasMore: (query.offset ?? 0) + history.items.length < history.total
      });
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
