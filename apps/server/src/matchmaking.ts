import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMatchmakingHeroSnapshot,
  estimateMatchmakingWaitSeconds,
  normalizeEloRating,
  normalizeMatchmakingRequest,
  selectBestMatchPair,
  type HeroState,
  type MatchResult,
  type MatchmakingRequest
} from "../../../packages/shared/src/index";
import { validateAuthSessionFromRequest } from "./auth";
import { recordMatchmakingRateLimited } from "./observability";
import type { RoomSnapshotStore } from "./persistence";

export const DEFAULT_MATCHMAKING_QUEUE_TTL_SECONDS = 5 * 60;
const DEFAULT_RATE_LIMIT_MATCHMAKING_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MATCHMAKING_MAX = 30;

interface MatchmakingRuntimeConfig {
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

const matchmakingRateLimitCounters = new Map<string, number[]>();

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

function nowMs(): number {
  return Date.now();
}

function parseEnvNumber(
  value: string | undefined,
  fallback: number,
  options: { minimum?: number; integer?: boolean } = {}
): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = options.integer ? Math.floor(parsed) : parsed;
  if (options.minimum != null && normalized < options.minimum) {
    return fallback;
  }

  return normalized;
}

function readMatchmakingRuntimeConfig(env: NodeJS.ProcessEnv = process.env): MatchmakingRuntimeConfig {
  return {
    rateLimitWindowMs: parseEnvNumber(
      env.VEIL_RATE_LIMIT_MATCHMAKING_WINDOW_MS,
      DEFAULT_RATE_LIMIT_MATCHMAKING_WINDOW_MS,
      {
        minimum: 1,
        integer: true
      }
    ),
    rateLimitMax: parseEnvNumber(env.VEIL_RATE_LIMIT_MATCHMAKING_MAX, DEFAULT_RATE_LIMIT_MATCHMAKING_MAX, {
      minimum: 1,
      integer: true
    })
  };
}

function readHeaderValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0]?.trim() || null : value?.trim() || null;
}

function readHeaderCsvValue(value: string | string[] | undefined): string | null {
  const headerValue = readHeaderValue(value);
  return headerValue?.split(",")[0]?.trim() || null;
}

function resolveRequestIp(request: Pick<IncomingMessage, "headers" | "socket">): string {
  const forwardedFor = readHeaderCsvValue(request.headers["x-forwarded-for"]);
  const rawIp = forwardedFor || request.socket.remoteAddress?.trim() || "unknown";
  return rawIp.startsWith("::ffff:") ? rawIp.slice("::ffff:".length) : rawIp;
}

function consumeSlidingWindowRateLimit(key: string, config = readMatchmakingRuntimeConfig()): RateLimitResult {
  const currentTime = nowMs();
  const windowStart = currentTime - config.rateLimitWindowMs;
  const timestamps = (matchmakingRateLimitCounters.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  if (timestamps.length >= config.rateLimitMax) {
    matchmakingRateLimitCounters.set(key, timestamps);
    const oldestTimestamp = timestamps[0] ?? currentTime;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldestTimestamp + config.rateLimitWindowMs - currentTime) / 1000))
    };
  }

  timestamps.push(currentTime);
  matchmakingRateLimitCounters.set(key, timestamps);
  return { allowed: true };
}

function enforceMatchmakingRateLimit(
  request: Pick<IncomingMessage, "headers" | "socket">,
  response: ServerResponse,
  endpointKey: string
): boolean {
  const rateLimitResult = consumeSlidingWindowRateLimit(`${endpointKey}:${resolveRequestIp(request)}`);
  if (rateLimitResult.allowed) {
    return true;
  }

  recordMatchmakingRateLimited();
  response.setHeader("Retry-After", String(rateLimitResult.retryAfterSeconds ?? 1));
  sendJson(response, 429, {
    error: {
      code: "rate_limited",
      message: "Too many matchmaking requests, please retry later"
    }
  });
  return false;
}

async function requireAuthSession(
  request: IncomingMessage,
  response: ServerResponse,
  store: RoomSnapshotStore | null
): Promise<{ playerId: string; displayName: string } | null> {
  const result = await validateAuthSessionFromRequest(request, store);
  if (result.session) {
    return result.session;
  }

  sendJson(response, 401, {
    error: {
      code: result.errorCode ?? "unauthorized",
      message: "Authentication required"
    }
  });
  return null;
}

function resolveHeroFromRoomSnapshot(playerId: string, heroCandidates: HeroState[]): HeroState | null {
  const primaryHero = heroCandidates.find((hero) => hero.playerId === playerId);
  return primaryHero ?? null;
}

async function resolveMatchmakingHero(
  store: RoomSnapshotStore,
  playerId: string,
  preferredRoomId?: string
): Promise<HeroState | null> {
  const roomId = preferredRoomId?.trim();
  if (roomId) {
    const roomSnapshot = await store.load(roomId);
    const hero = roomSnapshot ? resolveHeroFromRoomSnapshot(playerId, roomSnapshot.state.heroes) : null;
    if (hero) {
      return hero;
    }
  }

  const archives = await store.loadPlayerHeroArchives([playerId]);
  const archivedHero = archives.find((archive) => archive.playerId === playerId)?.hero ?? null;
  return archivedHero;
}

interface MatchmakingStatusQueued {
  status: "queued";
  position: number;
  estimatedWaitSeconds: number;
}

interface MatchmakingStatusMatched {
  status: "matched";
  roomId: string;
  playerIds: [string, string];
  seedOverride: number;
}

interface MatchmakingStatusIdle {
  status: "idle";
}

type MatchmakingStatusResponse = MatchmakingStatusQueued | MatchmakingStatusMatched | MatchmakingStatusIdle;

export class MatchmakingService {
  private readonly queueByPlayerId = new Map<string, MatchmakingRequest>();
  private readonly queueOrder: string[] = [];
  private readonly queuePositionByPlayerId = new Map<string, number>();
  private readonly resultsByPlayerId = new Map<string, MatchResult>();
  private nextMatchSequence = 1;

  enqueue(request: MatchmakingRequest, now = new Date()): MatchmakingStatusQueued {
    const normalized = normalizeMatchmakingRequest(request);
    this.resultsByPlayerId.delete(normalized.playerId);

    this.removeQueuedPlayer(normalized.playerId);
    this.queueByPlayerId.set(normalized.playerId, normalized);
    this.insertQueuedPlayer(normalized);
    const status = this.getQueuedStatus(normalized.playerId);
    this.matchQueuedPlayers(now);
    if (!status) {
      throw new Error(`Failed to enqueue player for matchmaking: ${normalized.playerId}`);
    }
    return status;
  }

  dequeue(playerId: string): boolean {
    const normalizedPlayerId = playerId.trim();
    this.resultsByPlayerId.delete(normalizedPlayerId);
    return this.removeQueuedPlayer(normalizedPlayerId);
  }

  getStatus(playerId: string): MatchmakingStatusResponse {
    const normalizedPlayerId = playerId.trim();
    const result = this.resultsByPlayerId.get(normalizedPlayerId);
    if (result) {
      return {
        status: "matched",
        roomId: result.roomId,
        playerIds: result.playerIds,
        seedOverride: result.seedOverride
      };
    }

    return this.getQueuedStatus(normalizedPlayerId) ?? { status: "idle" };
  }

  private getQueuedStatus(playerId: string): MatchmakingStatusQueued | null {
    const normalizedPlayerId = playerId.trim();
    const position = this.queuePositionByPlayerId.get(normalizedPlayerId);
    if (position == null) {
      return null;
    }

    return {
      status: "queued",
      position,
      estimatedWaitSeconds: estimateMatchmakingWaitSeconds(position)
    };
  }

  private createMatchResult(players: [MatchmakingRequest, MatchmakingRequest], now: Date): MatchResult {
    const orderedPlayerIds = [players[0].playerId, players[1].playerId].sort() as [string, string];
    const sequence = this.nextMatchSequence;
    this.nextMatchSequence += 1;

    return {
      roomId: `pvp-match-${now.getTime()}-${sequence}`,
      playerIds: orderedPlayerIds,
      seedOverride: ((now.getTime() + sequence) >>> 0) || sequence
    };
  }

  private matchQueuedPlayers(now: Date): void {
    while (this.queueByPlayerId.size >= 2) {
      const queue = Array.from(this.queueByPlayerId.values());
      const selection = selectBestMatchPair(queue, now);
      if (!selection) {
        return;
      }

      const [left, right] = selection.players;
      this.removeQueuedPlayer(left.playerId);
      this.removeQueuedPlayer(right.playerId);

      const result = this.createMatchResult([left, right], now);
      this.resultsByPlayerId.set(left.playerId, result);
      this.resultsByPlayerId.set(right.playerId, result);
    }
  }

  pruneStaleEntries(maxAgeMs: number, now = new Date()): number {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      return 0;
    }
    const referenceTime = now.getTime();
    if (!Number.isFinite(referenceTime)) {
      return 0;
    }

    let removed = 0;
    for (const [playerId, request] of this.queueByPlayerId.entries()) {
      const enqueuedAtMs = new Date(request.enqueuedAt).getTime();
      if (Number.isNaN(enqueuedAtMs) || referenceTime - enqueuedAtMs > maxAgeMs) {
        this.removeQueuedPlayer(playerId);
        this.resultsByPlayerId.delete(playerId);
        removed += 1;
      }
    }
    return removed;
  }

  private insertQueuedPlayer(request: MatchmakingRequest): void {
    let insertAt = this.queueOrder.length;
    for (let index = 0; index < this.queueOrder.length; index += 1) {
      const existingPlayerId = this.queueOrder[index];
      const existingRequest = existingPlayerId ? this.queueByPlayerId.get(existingPlayerId) : null;
      if (!existingRequest || compareQueuedPlayers(request, existingRequest) < 0) {
        insertAt = index;
        break;
      }
    }

    this.queueOrder.splice(insertAt, 0, request.playerId);
    this.reindexQueuePositions(insertAt);
  }

  private removeQueuedPlayer(playerId: string): boolean {
    const normalizedPlayerId = playerId.trim();
    const hadRequest = this.queueByPlayerId.delete(normalizedPlayerId);
    const queuedPosition = this.queuePositionByPlayerId.get(normalizedPlayerId);
    if (queuedPosition == null) {
      return hadRequest;
    }

    this.queueOrder.splice(queuedPosition - 1, 1);
    this.queuePositionByPlayerId.delete(normalizedPlayerId);
    this.reindexQueuePositions(queuedPosition - 1);
    return true;
  }

  private reindexQueuePositions(startIndex = 0): void {
    for (let index = startIndex; index < this.queueOrder.length; index += 1) {
      const playerId = this.queueOrder[index];
      if (playerId) {
        this.queuePositionByPlayerId.set(playerId, index + 1);
      }
    }
  }
}

function compareQueuedPlayers(left: MatchmakingRequest, right: MatchmakingRequest): number {
  return left.enqueuedAt.localeCompare(right.enqueuedAt) || left.playerId.localeCompare(right.playerId);
}

let configuredMatchmakingService = new MatchmakingService();

export function resetMatchmakingService(): void {
  configuredMatchmakingService = new MatchmakingService();
  matchmakingRateLimitCounters.clear();
}

export function registerMatchmakingRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    delete: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  options: {
    store: RoomSnapshotStore | null;
    service?: MatchmakingService;
    queueTtlSeconds?: number;
  }
): void {
  const service = options.service ?? configuredMatchmakingService;
  const queueTtlMs = resolveQueueTtlMs(options.queueTtlSeconds);

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.post("/api/matchmaking/enqueue", async (request, response) => {
    if (!enforceMatchmakingRateLimit(request, response, "enqueue")) {
      return;
    }

    if (queueTtlMs > 0) {
      service.pruneStaleEntries(queueTtlMs);
    }

    const authSession = await requireAuthSession(request, response, options.store);
    if (!authSession) {
      return;
    }

    if (!options.store) {
      sendJson(response, 503, {
        error: {
          code: "matchmaking_store_unavailable",
          message: "Matchmaking persistence is unavailable"
        }
      });
      return;
    }

    try {
      const account =
        (await options.store.loadPlayerAccount(authSession.playerId)) ??
        (await options.store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const hero = await resolveMatchmakingHero(options.store, authSession.playerId, account.lastRoomId);
      if (!hero) {
        sendJson(response, 409, {
          error: {
            code: "matchmaking_hero_not_found",
            message: "Player hero snapshot is required before entering matchmaking"
          }
        });
        return;
      }

      const queued = service.enqueue({
        playerId: authSession.playerId,
        heroSnapshot: createMatchmakingHeroSnapshot(hero),
        rating: normalizeEloRating(account.eloRating),
        enqueuedAt: new Date().toISOString()
      });
      sendJson(response, 200, queued);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  const cancelHandler = async (request: IncomingMessage, response: ServerResponse) => {
    if (!enforceMatchmakingRateLimit(request, response, "cancel")) {
      return;
    }

    const authSession = await requireAuthSession(request, response, options.store);
    if (!authSession) {
      return;
    }

    try {
      sendJson(response, 200, {
        status: service.dequeue(authSession.playerId) ? "dequeued" : "idle"
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  };

  app.delete("/api/matchmaking/cancel", cancelHandler);
  app.delete("/api/matchmaking/dequeue", cancelHandler);

  app.get("/api/matchmaking/status", async (request, response) => {
    if (!enforceMatchmakingRateLimit(request, response, "status")) {
      return;
    }

    const authSession = await requireAuthSession(request, response, options.store);
    if (!authSession) {
      return;
    }

    try {
      sendJson(response, 200, service.getStatus(authSession.playerId));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}

function resolveQueueTtlMs(explicitSeconds: number | undefined): number {
  const normalizedExplicit = normalizePositiveSeconds(explicitSeconds);
  if (normalizedExplicit != null) {
    return normalizedExplicit * 1000;
  }

  const envSeconds = normalizePositiveSeconds(parseEnvSeconds(process.env.VEIL_MATCHMAKING_QUEUE_TTL_SECONDS));
  const seconds = envSeconds ?? DEFAULT_MATCHMAKING_QUEUE_TTL_SECONDS;
  return seconds * 1000;
}

function parseEnvSeconds(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePositiveSeconds(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}
