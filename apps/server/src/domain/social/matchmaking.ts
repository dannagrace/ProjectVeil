import type { IncomingMessage, ServerResponse } from "node:http";
import type { HeroState } from "@veil/shared/models";
import { countRemainingProtectedPvpMatches } from "@veil/shared/progression";
import { createMatchmakingHeroSnapshot, estimateMatchmakingWaitSeconds, type MatchmakingRequest, type MatchResult, normalizeEloRating, normalizeMatchmakingRequest, selectBestMatchPair } from "@veil/shared/social";
import { resolveMapVariantIdForRoom } from "@veil/shared/world";
import { validateAuthSessionFromRequest } from "@server/domain/account/auth";
import { sendMobilePushNotification } from "@server/adapters/mobile-push";
import {
  recordMatchmakingLockLost,
  recordMatchmakingLockReleaseStale,
  recordMatchmakingLockRenewFailure,
  recordMatchmakingRateLimited,
  setMatchmakingQueueDepth
} from "@server/domain/ops/observability";
import type { RoomSnapshotStore } from "@server/persistence";
import {
  consumeRedisBackedOrLocalRateLimit,
  createLocalRateLimitState,
  type RateLimitResult
} from "@server/infra/http-rate-limit";
import { createRedisClient, readRedisUrl, type RedisClientLike } from "@server/infra/redis";
import { resolveTrustedRequestIp } from "@server/infra/request-ip";
import { sendWechatSubscribeMessage } from "@server/adapters/wechat-subscribe";

export const DEFAULT_MATCHMAKING_QUEUE_TTL_SECONDS = 5 * 60;
const DEFAULT_RATE_LIMIT_MATCHMAKING_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MATCHMAKING_MAX = 30;
const MATCHMAKING_LOCK_RENEW_FAILURE_TOLERANCE = 2;

interface MatchmakingLockContext {
  isLockLost(): boolean;
}

interface MatchmakingRuntimeConfig {
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

interface MatchmakingRuntimeDependencies {
  sendWechatSubscribeMessage(
    playerId: string,
    templateKey: "match_found",
    data: Record<string, unknown>,
    options?: { store?: RoomSnapshotStore | null }
  ): Promise<boolean>;
  sendMobilePushNotification(
    playerId: string,
    templateKey: "match_found",
    data: Record<string, unknown>,
    options?: { store?: RoomSnapshotStore | null }
  ): Promise<boolean>;
}

const MATCHMAKING_RATE_LIMIT_CLUSTER_KEY_PREFIX = "veil:matchmaking-rate-limit:";
const matchmakingRateLimitState = createLocalRateLimitState();
const defaultMatchmakingRuntimeDependencies: MatchmakingRuntimeDependencies = {
  sendWechatSubscribeMessage: (playerId, templateKey, data, options) =>
    sendWechatSubscribeMessage(playerId, templateKey, data, options),
  sendMobilePushNotification: (playerId, templateKey, data, options) =>
    sendMobilePushNotification(playerId, templateKey, data, options)
};
let matchmakingRuntimeDependencies: MatchmakingRuntimeDependencies = defaultMatchmakingRuntimeDependencies;

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

function resolveRequestIp(request: Pick<IncomingMessage, "headers" | "socket">): string {
  return resolveTrustedRequestIp(request);
}

async function consumeMatchmakingRateLimit(
  key: string,
  redisClient: RedisClientLike | null,
  config = readMatchmakingRuntimeConfig()
): Promise<RateLimitResult> {
  return consumeRedisBackedOrLocalRateLimit({
    redisClient,
    localState: matchmakingRateLimitState,
    key,
    redisKey: `${MATCHMAKING_RATE_LIMIT_CLUSTER_KEY_PREFIX}${key}`,
    config: { windowMs: config.rateLimitWindowMs },
    max: config.rateLimitMax,
    now: nowMs
  });
}

async function enforceMatchmakingRateLimit(
  request: Pick<IncomingMessage, "headers" | "socket">,
  response: ServerResponse,
  endpointKey: string,
  redisClient: RedisClientLike | null
): Promise<boolean> {
  const rateLimitResult = await consumeMatchmakingRateLimit(`${endpointKey}:${resolveRequestIp(request)}`, redisClient);
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
  getQueueDepth(): number | Promise<number>;
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

interface MatchmakingRateLimitOptions {
  rateLimitRedisClient?: RedisClientLike | null;
  rateLimitRedisUrl?: string | null;
  rateLimitCreateRedisClient?: typeof createRedisClient;
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

  getQueueDepth(): number {
    return this.queueOrder.length;
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
    return this.withLock(async (lock) => {
      const normalized = normalizeMatchmakingRequest(request);

      await this.redis.hdel(this.resultKey, normalized.playerId);

      await this.redis.hset(this.requestKey, normalized.playerId, JSON.stringify(normalized));
      await this.redis.zadd(this.queueKey, getQueuedPlayerScore(normalized), normalized.playerId);

      const status = await this.getQueuedStatus(normalized.playerId);
      await this.matchQueuedPlayers(now, lock);
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
      const removed = await this.redis.zrem(this.queueKey, normalizedPlayerId);
      return removed > 0;
    });
  }

  async getStatus(playerId: string): Promise<MatchmakingStatusResponse> {
    const normalizedPlayerId = playerId.trim();
    const result = await this.consumeMatchResult(normalizedPlayerId);
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

  private async consumeMatchResult(playerId: string): Promise<string | null> {
    return (await this.redis.eval(
      [
        "local result = redis.call('hget', KEYS[1], ARGV[1])",
        "if result then",
        "  redis.call('hdel', KEYS[1], ARGV[1])",
        "end",
        "return result"
      ].join("\n"),
      1,
      this.resultKey,
      playerId
    )) as string | null;
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
      const queueIds = await this.redis.zrange(this.queueKey, 0, -1);
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

      await this.redis.zrem(this.queueKey, ...expiredPlayerIds);
      await this.redis.hdel(this.requestKey, ...expiredPlayerIds);
      await this.redis.hdel(this.resultKey, ...expiredPlayerIds);
      return expiredPlayerIds.length;
    });
  }

  async close(): Promise<void> {
    await this.redis.quit?.();
  }

  async getQueueDepth(): Promise<number> {
    return await this.redis.zcard(this.queueKey);
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
    const position = await this.redis.zrank(this.queueKey, playerId.trim());
    if (position == null) {
      return null;
    }

    return {
      status: "queued",
      position: position + 1,
      estimatedWaitSeconds: estimateMatchmakingWaitSeconds(position + 1)
    };
  }

  private async loadQueueRequests(): Promise<Map<string, MatchmakingRequest>> {
    const queueIds = await this.redis.zrange(this.queueKey, 0, -1);
    const requestsByPlayerId = new Map<string, MatchmakingRequest>();
    if (queueIds.length === 0) {
      return requestsByPlayerId;
    }

    const encodedRequests =
      typeof this.redis.hmget === "function"
        ? await this.redis.hmget(this.requestKey, ...queueIds)
        : await Promise.all(queueIds.map((playerId) => this.redis.hget(this.requestKey, playerId)));

    for (const [index, playerId] of queueIds.entries()) {
      const encoded = encodedRequests[index];
      if (encoded) {
        requestsByPlayerId.set(playerId, JSON.parse(encoded) as MatchmakingRequest);
      }
    }

    return requestsByPlayerId;
  }

  private createMatchResult(
    players: [MatchmakingRequest, MatchmakingRequest],
    now: Date,
    sequence: number
  ): MatchResult {
    const orderedPlayerIds = [players[0].playerId, players[1].playerId].sort() as [string, string];

    return {
      roomId: `pvp-match-${now.getTime()}-${sequence}`,
      playerIds: orderedPlayerIds,
      seedOverride: ((now.getTime() + sequence) >>> 0) || sequence
    };
  }

  private async matchQueuedPlayers(now: Date, lock?: MatchmakingLockContext): Promise<void> {
    const requestsByPlayerId = await this.loadQueueRequests();
    const matchedPairs: Array<[MatchmakingRequest, MatchmakingRequest]> = [];

    while (!lock?.isLockLost() && requestsByPlayerId.size >= 2) {
      const queue = Array.from(requestsByPlayerId.values());
      const selection = selectBestMatchPair(queue, now);
      if (!selection) {
        break;
      }

      const [left, right] = selection.players;
      requestsByPlayerId.delete(left.playerId);
      requestsByPlayerId.delete(right.playerId);
      matchedPairs.push([left, right]);
    }

    if (matchedPairs.length === 0 || lock?.isLockLost()) {
      return;
    }

    const lastSequence = Number(
      await this.redis.eval(
        "return redis.call('incrby', KEYS[1], ARGV[1])",
        1,
        this.sequenceKey,
        String(matchedPairs.length)
      )
    );
    const firstSequence = lastSequence - matchedPairs.length + 1;
    const batchArgs: string[] = [];
    const notifications: Array<{ result: MatchResult; players: [MatchmakingRequest, MatchmakingRequest] }> = [];

    for (const [index, players] of matchedPairs.entries()) {
      const [left, right] = players;
      const result = this.createMatchResult(players, now, firstSequence + index);
      const encodedResult = JSON.stringify(result);
      batchArgs.push(left.playerId, right.playerId, encodedResult);
      notifications.push({ result, players });
    }

    await this.redis.eval(
      [
        "for index = 1, #ARGV, 3 do",
        "  local left = ARGV[index]",
        "  local right = ARGV[index + 1]",
        "  local result = ARGV[index + 2]",
        "  redis.call('zrem', KEYS[1], left, right)",
        "  redis.call('hdel', KEYS[2], left, right)",
        "  redis.call('hset', KEYS[3], left, result)",
        "  redis.call('hset', KEYS[3], right, result)",
        "end",
        "return #ARGV / 3"
      ].join("\n"),
      3,
      this.queueKey,
      this.requestKey,
      this.resultKey,
      ...batchArgs
    );

    for (const { result, players } of notifications) {
      this.onMatchCreated?.(result, players);
    }
  }

  private async withLock<T>(action: (lock: MatchmakingLockContext) => Promise<T>): Promise<T> {
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

    let lockLost = false;
    let consecutiveRenewFailures = 0;
    const renewInterval = setInterval(() => {
      if (lockLost) {
        return;
      }
      void this.renewLock(token)
        .then(() => {
          consecutiveRenewFailures = 0;
        })
        .catch((error: unknown) => {
          recordMatchmakingLockRenewFailure();
          consecutiveRenewFailures += 1;
          console.warn("[matchmaking] Redis lock renewal failed", {
            error: error instanceof Error ? error.message : String(error)
          });
          if (consecutiveRenewFailures >= MATCHMAKING_LOCK_RENEW_FAILURE_TOLERANCE) {
            lockLost = true;
            recordMatchmakingLockLost();
            clearInterval(renewInterval);
          }
        });
    }, Math.max(100, Math.floor(this.lockTimeoutMs / 2)));

    try {
      const result = await action({ isLockLost: () => lockLost });
      if (lockLost) {
        throw new Error("Matchmaking lock lost mid-action; results discarded");
      }
      return result;
    } finally {
      clearInterval(renewInterval);
      const released = await this.releaseLock(token);
      if (!released) {
        recordMatchmakingLockReleaseStale();
      }
    }
  }

  private async renewLock(token: string): Promise<void> {
    const renewed = await this.redis.eval(
      [
        "if redis.call('get', KEYS[1]) == ARGV[1] then",
        "  return redis.call('pexpire', KEYS[1], ARGV[2])",
        "end",
        "return 0"
      ].join("\n"),
      1,
      this.lockKey,
      token,
      String(this.lockTimeoutMs)
    );
    if (Number(renewed) !== 1) {
      throw new Error("Redis matchmaking lock renewal lost ownership");
    }
  }

  private async releaseLock(token: string): Promise<boolean> {
    const released = await this.redis.eval(
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
    return Number(released) === 1;
  }
}

function compareQueuedPlayers(left: MatchmakingRequest, right: MatchmakingRequest): number {
  return left.enqueuedAt.localeCompare(right.enqueuedAt) || left.playerId.localeCompare(right.playerId);
}

function getQueuedPlayerScore(request: MatchmakingRequest): number {
  const enqueuedAtMs = new Date(request.enqueuedAt).getTime();
  return Number.isFinite(enqueuedAtMs) ? enqueuedAtMs : 0;
}

let configuredMatchmakingNotificationStore: RoomSnapshotStore | null = null;
let configuredMatchmakingService: MatchmakingServiceController = createConfiguredMatchmakingService();

export function configureMatchmakingRuntimeDependencies(overrides: Partial<MatchmakingRuntimeDependencies>): void {
  matchmakingRuntimeDependencies = {
    ...matchmakingRuntimeDependencies,
    ...overrides
  };
}

export function resetMatchmakingRuntimeDependencies(): void {
  matchmakingRuntimeDependencies = defaultMatchmakingRuntimeDependencies;
}

export function resetMatchmakingService(): void {
  void configuredMatchmakingService.close?.();
  configuredMatchmakingNotificationStore = null;
  configuredMatchmakingService = createConfiguredMatchmakingService();
  matchmakingRateLimitState.counters.clear();
  matchmakingRateLimitState.lastPrunedAtMs = 0;
  setMatchmakingQueueDepth(0);
}

async function refreshMatchmakingQueueDepth(service: MatchmakingServiceController): Promise<void> {
  setMatchmakingQueueDepth(await Promise.resolve(service.getQueueDepth()));
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
        try {
          await matchmakingRuntimeDependencies.sendWechatSubscribeMessage(
            playerId,
            "match_found",
            {
              mapName: describeMatchmakingMapName(account?.lastRoomId ?? result.roomId),
              opponentName: opponentAccount?.displayName?.trim() || opponentId
            },
            { store }
          );
          await matchmakingRuntimeDependencies.sendMobilePushNotification(
            playerId,
            "match_found",
            {
              mapName: describeMatchmakingMapName(account?.lastRoomId ?? result.roomId),
              opponentName: opponentAccount?.displayName?.trim() || opponentId,
              roomId: result.roomId
            },
            { store }
          );
        } catch (error) {
          console.error("[matchmaking] Failed to send match-found notification", {
            roomId: result.roomId,
            playerId,
            opponentId,
            error
          });
        }
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

function resolveMatchmakingRateLimitRedisClient(options: MatchmakingRateLimitOptions): RedisClientLike | null {
  if (options.rateLimitRedisClient !== undefined) {
    return options.rateLimitRedisClient;
  }

  const redisUrl = options.rateLimitRedisUrl ?? readRedisUrl();
  return redisUrl ? (options.rateLimitCreateRedisClient ?? createRedisClient)(redisUrl) : null;
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
  } & MatchmakingRateLimitOptions
): void {
  configuredMatchmakingNotificationStore = options.store;
  const service = options.service ?? configuredMatchmakingService;
  const queueTtlMs = resolveQueueTtlMs(options.queueTtlSeconds);
  const rateLimitRedisClient = resolveMatchmakingRateLimitRedisClient(options);

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
    if (!(await enforceMatchmakingRateLimit(request, response, "enqueue", rateLimitRedisClient))) {
      return;
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

    if (queueTtlMs > 0) {
      await Promise.resolve(service.pruneStaleEntries(queueTtlMs));
      await refreshMatchmakingQueueDepth(service);
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
        enqueuedAt: new Date().toISOString(),
        protectedPvpMatchesRemaining: countRemainingProtectedPvpMatches(account.recentBattleReplays)
      }));
      await refreshMatchmakingQueueDepth(service);
      sendJson(response, 200, queued);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  const cancelHandler = async (request: IncomingMessage, response: ServerResponse) => {
    if (!(await enforceMatchmakingRateLimit(request, response, "cancel", rateLimitRedisClient))) {
      return;
    }

    const authSession = await requireAuthSession(request, response, options.store);
    if (!authSession) {
      return;
    }

    try {
      const dequeued = await Promise.resolve(service.dequeue(authSession.playerId));
      await refreshMatchmakingQueueDepth(service);
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
    if (!(await enforceMatchmakingRateLimit(request, response, "status", rateLimitRedisClient))) {
      return;
    }

    const authSession = await requireAuthSession(request, response, options.store);
    if (!authSession) {
      return;
    }

    try {
      await refreshMatchmakingQueueDepth(service);
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
