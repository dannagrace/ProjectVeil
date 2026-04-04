import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMatchmakingHeroSnapshot,
  estimateMatchmakingWaitSeconds,
  normalizeEloRating,
  normalizeMatchmakingRequest,
  selectBestMatchPair,
  resolveMapVariantIdForRoom,
  type HeroState,
  type MatchResult,
  type MatchmakingRequest
} from "../../../packages/shared/src/index";
import { validateAuthSessionFromRequest } from "./auth";
import { recordMatchmakingRateLimited } from "./observability";
import type { RoomSnapshotStore } from "./persistence";
import { createRedisClient, readRedisUrl, type RedisClientLike } from "./redis";
import { sendWechatSubscribeMessage } from "./wechat-subscribe";

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

  if (result.errorCode === "account_banned") {
    sendJson(response, 403, {
      error: {
        code: "account_banned",
        message: "Account is banned",
        reason: result.ban?.banReason ?? "No reason provided",
        ...(result.ban?.banExpiry ? { expiry: result.ban.banExpiry } : {})
      }
    });
    return null;
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

export interface MatchmakingServiceController {
  enqueue(request: MatchmakingRequest, now?: Date): MatchmakingStatusQueued | Promise<MatchmakingStatusQueued>;
  dequeue(playerId: string): boolean | Promise<boolean>;
  getStatus(playerId: string): MatchmakingStatusResponse | Promise<MatchmakingStatusResponse>;
  pruneStaleEntries(maxAgeMs: number, now?: Date): number | Promise<number>;
  close?(): Promise<void>;
}

interface RedisMatchmakingServiceOptions {
  redisUrl?: string;
  redisClient?: RedisClientLike;
  keyPrefix?: string;
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
  onMatchCreated?: (result: MatchResult, players: [MatchmakingRequest, MatchmakingRequest]) => void;
}

export class MatchmakingService implements MatchmakingServiceController {
  private readonly queueByPlayerId = new Map<string, MatchmakingRequest>();
  private readonly queueOrder: string[] = [];
  private readonly queuePositionByPlayerId = new Map<string, number>();
  private readonly resultsByPlayerId = new Map<string, MatchResult>();
  private nextMatchSequence = 1;
  private readonly onMatchCreated: ((result: MatchResult, players: [MatchmakingRequest, MatchmakingRequest]) => void) | undefined;

  constructor(options: { onMatchCreated?: (result: MatchResult, players: [MatchmakingRequest, MatchmakingRequest]) => void } = {}) {
    this.onMatchCreated = options.onMatchCreated;
  }

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
      this.onMatchCreated?.(result, [left, right]);
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

export class RedisMatchmakingService implements MatchmakingServiceController {
  private readonly redis: RedisClientLike;
  private readonly keyPrefix: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;
  private readonly onMatchCreated: ((result: MatchResult, players: [MatchmakingRequest, MatchmakingRequest]) => void) | undefined;

  constructor(options: RedisMatchmakingServiceOptions = {}) {
    const redisUrl = options.redisUrl ?? readRedisUrl();
    if (!options.redisClient && !redisUrl) {
      throw new Error("REDIS_URL is required to enable Redis matchmaking");
    }

    this.redis = options.redisClient ?? createRedisClient(redisUrl!);
    this.keyPrefix = options.keyPrefix?.trim() || "veil:matchmaking";
    this.lockTimeoutMs = Math.max(250, Math.floor(options.lockTimeoutMs ?? 5_000));
    this.lockRetryDelayMs = Math.max(10, Math.floor(options.lockRetryDelayMs ?? 50));
    this.onMatchCreated = options.onMatchCreated;
  }

  async enqueue(request: MatchmakingRequest, now = new Date()): Promise<MatchmakingStatusQueued> {
    return this.withLock(async () => {
      const normalized = normalizeMatchmakingRequest(request);
      const requestsByPlayerId = await this.loadQueueRequests();

      await this.redis.hdel(this.resultKey, normalized.playerId);
      requestsByPlayerId.delete(normalized.playerId);
      await this.redis.lrem(this.queueKey, 0, normalized.playerId);

      const queueIds = await this.redis.lrange(this.queueKey, 0, -1);
      const insertAt = this.findInsertIndex(
        normalized,
        queueIds.map((playerId) => requestsByPlayerId.get(playerId)).filter((value): value is MatchmakingRequest => value != null)
      );

      await this.redis.hset(this.requestKey, normalized.playerId, JSON.stringify(normalized));
      if (insertAt >= queueIds.length) {
        await this.redis.rpush(this.queueKey, normalized.playerId);
      } else {
        const pivotPlayerId = queueIds[insertAt];
        if (!pivotPlayerId) {
          await this.redis.rpush(this.queueKey, normalized.playerId);
        } else {
          await this.redis.linsert(this.queueKey, "BEFORE", pivotPlayerId, normalized.playerId);
        }
      }

      const status = await this.getQueuedStatus(normalized.playerId);
      await this.matchQueuedPlayers(now);
      if (!status) {
        throw new Error(`Failed to enqueue player for matchmaking: ${normalized.playerId}`);
      }
      return status;
    });
  }

  async dequeue(playerId: string): Promise<boolean> {
    return this.withLock(async () => {
      const normalizedPlayerId = playerId.trim();
      await this.redis.hdel(this.resultKey, normalizedPlayerId);
      await this.redis.hdel(this.requestKey, normalizedPlayerId);
      const removed = await this.redis.lrem(this.queueKey, 0, normalizedPlayerId);
      return removed > 0;
    });
  }

  async getStatus(playerId: string): Promise<MatchmakingStatusResponse> {
    const normalizedPlayerId = playerId.trim();
    const result = await this.redis.hget(this.resultKey, normalizedPlayerId);
    if (result) {
      const parsed = JSON.parse(result) as MatchResult;
      return {
        status: "matched",
        roomId: parsed.roomId,
        playerIds: parsed.playerIds,
        seedOverride: parsed.seedOverride
      };
    }

    return (await this.getQueuedStatus(normalizedPlayerId)) ?? { status: "idle" };
  }

  async pruneStaleEntries(maxAgeMs: number, now = new Date()): Promise<number> {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      return 0;
    }

    const referenceTime = now.getTime();
    if (!Number.isFinite(referenceTime)) {
      return 0;
    }

    return this.withLock(async () => {
      const requestsByPlayerId = await this.loadQueueRequests();
      const queueIds = await this.redis.lrange(this.queueKey, 0, -1);
      const expiredPlayerIds = queueIds.filter((playerId) => {
        const request = requestsByPlayerId.get(playerId);
        if (!request) {
          return true;
        }

        const enqueuedAtMs = new Date(request.enqueuedAt).getTime();
        return Number.isNaN(enqueuedAtMs) || referenceTime - enqueuedAtMs > maxAgeMs;
      });

      if (expiredPlayerIds.length === 0) {
        return 0;
      }

      for (const playerId of expiredPlayerIds) {
        await this.redis.lrem(this.queueKey, 0, playerId);
        await this.redis.hdel(this.requestKey, playerId);
        await this.redis.hdel(this.resultKey, playerId);
      }
      return expiredPlayerIds.length;
    });
  }

  async close(): Promise<void> {
    await this.redis.quit?.();
  }

  private get lockKey(): string {
    return `${this.keyPrefix}:lock`;
  }

  private get queueKey(): string {
    return `${this.keyPrefix}:queue`;
  }

  private get requestKey(): string {
    return `${this.keyPrefix}:requests`;
  }

  private get resultKey(): string {
    return `${this.keyPrefix}:results`;
  }

  private get sequenceKey(): string {
    return `${this.keyPrefix}:sequence`;
  }

  private async getQueuedStatus(playerId: string): Promise<MatchmakingStatusQueued | null> {
    const queueIds = await this.redis.lrange(this.queueKey, 0, -1);
    const position = queueIds.indexOf(playerId.trim());
    if (position < 0) {
      return null;
    }

    return {
      status: "queued",
      position: position + 1,
      estimatedWaitSeconds: estimateMatchmakingWaitSeconds(position + 1)
    };
  }

  private async loadQueueRequests(): Promise<Map<string, MatchmakingRequest>> {
    const queueIds = await this.redis.lrange(this.queueKey, 0, -1);
    const requestsByPlayerId = new Map<string, MatchmakingRequest>();

    for (const playerId of queueIds) {
      const encoded = await this.redis.hget(this.requestKey, playerId);
      if (encoded) {
        requestsByPlayerId.set(playerId, JSON.parse(encoded) as MatchmakingRequest);
      }
    }

    return requestsByPlayerId;
  }

  private findInsertIndex(request: MatchmakingRequest, queue: MatchmakingRequest[]): number {
    for (let index = 0; index < queue.length; index += 1) {
      const existingRequest = queue[index];
      if (existingRequest && compareQueuedPlayers(request, existingRequest) < 0) {
        return index;
      }
    }

    return queue.length;
  }

  private async createMatchResult(players: [MatchmakingRequest, MatchmakingRequest], now: Date): Promise<MatchResult> {
    const orderedPlayerIds = [players[0].playerId, players[1].playerId].sort() as [string, string];
    const sequence = await this.redis.incr(this.sequenceKey);

    return {
      roomId: `pvp-match-${now.getTime()}-${sequence}`,
      playerIds: orderedPlayerIds,
      seedOverride: ((now.getTime() + sequence) >>> 0) || sequence
    };
  }

  private async matchQueuedPlayers(now: Date): Promise<void> {
    while ((await this.redis.llen(this.queueKey)) >= 2) {
      const requestsByPlayerId = await this.loadQueueRequests();
      const queue = Array.from(requestsByPlayerId.values());
      const selection = selectBestMatchPair(queue, now);
      if (!selection) {
        return;
      }

      const [left, right] = selection.players;
      await this.redis.lrem(this.queueKey, 0, left.playerId);
      await this.redis.lrem(this.queueKey, 0, right.playerId);
      await this.redis.hdel(this.requestKey, left.playerId, right.playerId);

      const result = await this.createMatchResult([left, right], now);
      const encodedResult = JSON.stringify(result);
      await this.redis.hset(this.resultKey, left.playerId, encodedResult);
      await this.redis.hset(this.resultKey, right.playerId, encodedResult);
      this.onMatchCreated?.(result, [left, right]);
    }
  }

  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const timeoutAt = Date.now() + this.lockTimeoutMs;

    while (true) {
      const acquired = await this.redis.set(this.lockKey, token, "PX", this.lockTimeoutMs, "NX");
      if (acquired === "OK") {
        break;
      }

      if (Date.now() >= timeoutAt) {
        throw new Error("Timed out waiting for Redis matchmaking lock");
      }

      await delay(this.lockRetryDelayMs);
    }

    try {
      return await action();
    } finally {
      await this.releaseLock(token);
    }
  }

  private async releaseLock(token: string): Promise<void> {
    await this.redis.eval(
      [
        "if redis.call('get', KEYS[1]) == ARGV[1] then",
        "  return redis.call('del', KEYS[1])",
        "end",
        "return 0"
      ].join("\n"),
      1,
      this.lockKey,
      token
    );
  }
}

function compareQueuedPlayers(left: MatchmakingRequest, right: MatchmakingRequest): number {
  return left.enqueuedAt.localeCompare(right.enqueuedAt) || left.playerId.localeCompare(right.playerId);
}

let configuredMatchmakingNotificationStore: RoomSnapshotStore | null = null;
let configuredMatchmakingService: MatchmakingServiceController = createConfiguredMatchmakingService();

export function resetMatchmakingService(): void {
  void configuredMatchmakingService.close?.();
  configuredMatchmakingNotificationStore = null;
  configuredMatchmakingService = createConfiguredMatchmakingService();
  matchmakingRateLimitCounters.clear();
}

function describeMatchmakingMapName(roomId: string): string {
  const normalizedRoomId = roomId.trim();
  if (!normalizedRoomId) {
    return "Default";
  }

  const variantId = resolveMapVariantIdForRoom(normalizedRoomId);
  return variantId
    .split(/[_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

async function notifyPlayersAboutMatchFound(
  result: MatchResult,
  players: [MatchmakingRequest, MatchmakingRequest]
): Promise<void> {
  const store = configuredMatchmakingNotificationStore;
  if (!store) {
    return;
  }

  try {
    const playerIds = players.map((player) => player.playerId);
    const accounts = await store.loadPlayerAccounts(playerIds);
    const accountsByPlayerId = new Map(accounts.map((account) => [account.playerId, account]));

    await Promise.all(
      playerIds.map(async (playerId) => {
        const opponentId = playerIds.find((candidatePlayerId) => candidatePlayerId !== playerId);
        if (!opponentId) {
          return;
        }

        const account = accountsByPlayerId.get(playerId);
        const opponentAccount = accountsByPlayerId.get(opponentId);
        await sendWechatSubscribeMessage(
          playerId,
          "match_found",
          {
            mapName: describeMatchmakingMapName(account?.lastRoomId ?? result.roomId),
            opponentName: opponentAccount?.displayName?.trim() || opponentId
          },
          { store }
        );
      })
    );
  } catch (error) {
    console.error("[matchmaking] Failed to send WeChat match-found notifications", {
      roomId: result.roomId,
      playerIds: result.playerIds,
      error
    });
  }
}

function createConfiguredMatchmakingService(env: NodeJS.ProcessEnv = process.env): MatchmakingServiceController {
  const redisUrl = readRedisUrl(env);
  const onMatchCreated = (result: MatchResult, players: [MatchmakingRequest, MatchmakingRequest]) => {
    void notifyPlayersAboutMatchFound(result, players);
  };
  return redisUrl
    ? new RedisMatchmakingService({ redisUrl, onMatchCreated })
    : new MatchmakingService({ onMatchCreated });
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
    service?: MatchmakingServiceController;
    queueTtlSeconds?: number;
  }
): void {
  configuredMatchmakingNotificationStore = options.store;
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
      await Promise.resolve(service.pruneStaleEntries(queueTtlMs));
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

      const queued = await Promise.resolve(service.enqueue({
        playerId: authSession.playerId,
        heroSnapshot: createMatchmakingHeroSnapshot(hero),
        rating: normalizeEloRating(account.eloRating),
        enqueuedAt: new Date().toISOString()
      }));
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
      const dequeued = await Promise.resolve(service.dequeue(authSession.playerId));
      sendJson(response, 200, {
        status: dequeued ? "dequeued" : "idle"
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
      sendJson(response, 200, await Promise.resolve(service.getStatus(authSession.playerId)));
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

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
