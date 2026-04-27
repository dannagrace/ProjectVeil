import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import { createRedisClient, readRedisUrl, type RedisClientLike } from "@server/infra/redis";

interface CachedWechatSessionKeyEntry {
  sessionKey: string;
  expiresAtMs: number;
}

interface RedisWechatSessionKeyEntry {
  version: 1;
  encryptedSessionKey: string;
  iv: string;
  authTag: string;
  expiresAtMs: number;
}

export interface CachedWechatSessionKeySnapshot {
  playerId: string;
  sessionKey: string;
  expiresAt: string;
}

export interface WechatPhoneNumberPayload {
  phoneNumber?: string;
  purePhoneNumber?: string;
  countryCode?: string;
  watermark?: {
    appid?: string;
  };
}

export interface WechatSessionKeyCache {
  cache(playerId: string, sessionKey: string, ttlSeconds?: number): Promise<CachedWechatSessionKeySnapshot>;
  get(playerId: string): Promise<CachedWechatSessionKeySnapshot | null>;
  clear(playerId: string): Promise<boolean>;
  reset(): Promise<void>;
}

export interface WechatSessionKeyCacheOptions {
  redisClient?: RedisClientLike | null;
  redisUrl?: string | null;
  createRedisClient?: typeof createRedisClient;
  env?: NodeJS.ProcessEnv;
  keyPrefix?: string;
  nowMs?: () => number;
}

const DEFAULT_WECHAT_SESSION_KEY_TTL_SECONDS = 2 * 60 * 60;
const WECHAT_SESSION_KEY_REDIS_PREFIX = "veil:wechat-session-key:";
const WECHAT_SESSION_KEY_REDIS_VERSION = 1;

function nowMs(): number {
  return Date.now();
}

function normalizePlayerId(playerId: string): string {
  const normalized = playerId.trim();
  if (!normalized) {
    throw new Error("playerId must not be empty");
  }
  return normalized;
}

function normalizeBase64Field(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} must not be empty`);
  }
  return normalized;
}

function normalizeTtlSeconds(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
    return DEFAULT_WECHAT_SESSION_KEY_TTL_SECONDS;
  }
  return Math.floor(ttlSeconds);
}

function toSnapshot(playerId: string, entry: CachedWechatSessionKeyEntry): CachedWechatSessionKeySnapshot {
  return {
    playerId,
    sessionKey: entry.sessionKey,
    expiresAt: new Date(entry.expiresAtMs).toISOString()
  };
}

function buildRedisKey(keyPrefix: string, playerId: string): string {
  return `${keyPrefix}${playerId}`;
}

function readWechatSessionKeyEncryptionSecret(env: NodeJS.ProcessEnv): string | null {
  return readRuntimeSecret("VEIL_AUTH_SECRET", env) ?? null;
}

function deriveWechatSessionKeyEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(`project-veil:wechat-session-key:${secret}`, "utf8").digest();
}

function buildWechatSessionKeyAad(playerId: string, expiresAtMs: number): Buffer {
  return Buffer.from(`${playerId}:${expiresAtMs}`, "utf8");
}

function encryptWechatSessionKeyForRedis(
  playerId: string,
  sessionKey: string,
  expiresAtMs: number,
  env: NodeJS.ProcessEnv
): RedisWechatSessionKeyEntry | null {
  const secret = readWechatSessionKeyEncryptionSecret(env);
  if (!secret) {
    return null;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveWechatSessionKeyEncryptionKey(secret), iv);
  cipher.setAAD(buildWechatSessionKeyAad(playerId, expiresAtMs));
  const encrypted = Buffer.concat([cipher.update(sessionKey, "utf8"), cipher.final()]);
  return {
    version: WECHAT_SESSION_KEY_REDIS_VERSION,
    encryptedSessionKey: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    expiresAtMs
  };
}

function parseRedisWechatSessionKeyEntry(serialized: string): RedisWechatSessionKeyEntry | null {
  try {
    const parsed = JSON.parse(serialized) as Partial<RedisWechatSessionKeyEntry>;
    if (
      parsed.version !== WECHAT_SESSION_KEY_REDIS_VERSION ||
      typeof parsed.encryptedSessionKey !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.authTag !== "string" ||
      typeof parsed.expiresAtMs !== "number"
    ) {
      return null;
    }
    return parsed as RedisWechatSessionKeyEntry;
  } catch {
    return null;
  }
}

function decryptWechatSessionKeyFromRedis(
  playerId: string,
  entry: RedisWechatSessionKeyEntry,
  env: NodeJS.ProcessEnv
): string | null {
  const secret = readWechatSessionKeyEncryptionSecret(env);
  if (!secret) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveWechatSessionKeyEncryptionKey(secret),
      Buffer.from(entry.iv, "base64")
    );
    decipher.setAAD(buildWechatSessionKeyAad(playerId, entry.expiresAtMs));
    decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(entry.encryptedSessionKey, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return null;
  }
}

async function listRedisKeysByPrefix(redisClient: RedisClientLike, keyPrefix: string): Promise<string[]> {
  if (typeof redisClient.scan !== "function") {
    return [];
  }

  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await redisClient.scan(cursor, "MATCH", `${keyPrefix}*`, "COUNT", "100");
    keys.push(...batch);
    cursor = nextCursor;
  } while (cursor !== "0");
  return keys;
}

export function readWechatSessionKeyTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VEIL_WECHAT_SESSION_KEY_TTL_SECONDS?.trim());
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_WECHAT_SESSION_KEY_TTL_SECONDS;
  }
  return Math.floor(parsed);
}

export function createWechatSessionKeyCache(options: WechatSessionKeyCacheOptions = {}): WechatSessionKeyCache {
  const localCache = new Map<string, CachedWechatSessionKeyEntry>();
  const env = options.env ?? process.env;
  const keyPrefix = options.keyPrefix ?? WECHAT_SESSION_KEY_REDIS_PREFIX;
  const getNowMs = options.nowMs ?? nowMs;
  let redisClientCache: RedisClientLike | null | undefined;

  const resolveRedisClient = (): RedisClientLike | null => {
    if (options.redisClient !== undefined) {
      return options.redisClient;
    }
    if (redisClientCache !== undefined) {
      return redisClientCache;
    }

    const redisUrl = options.redisUrl ?? readRedisUrl(env);
    redisClientCache = redisUrl
      ? (options.createRedisClient ?? createRedisClient)(redisUrl)
      : null;
    return redisClientCache;
  };

  const getLocal = (playerId: string): CachedWechatSessionKeySnapshot | null => {
    const cached = localCache.get(playerId);
    if (!cached) {
      return null;
    }
    if (cached.expiresAtMs <= getNowMs()) {
      localCache.delete(playerId);
      return null;
    }
    return toSnapshot(playerId, cached);
  };

  return {
    async cache(playerId, sessionKey, ttlSeconds = readWechatSessionKeyTtlSeconds(env)) {
      const normalizedPlayerId = normalizePlayerId(playerId);
      const normalizedSessionKey = normalizeBase64Field(sessionKey, "sessionKey");
      const normalizedTtlSeconds = normalizeTtlSeconds(ttlSeconds);
      const expiresAtMs = getNowMs() + normalizedTtlSeconds * 1000;
      const localEntry = {
        sessionKey: normalizedSessionKey,
        expiresAtMs
      };
      localCache.set(normalizedPlayerId, localEntry);

      const redisClient = resolveRedisClient();
      const encryptedEntry = redisClient
        ? encryptWechatSessionKeyForRedis(normalizedPlayerId, normalizedSessionKey, expiresAtMs, env)
        : null;
      if (redisClient && encryptedEntry) {
        try {
          await redisClient.set(
            buildRedisKey(keyPrefix, normalizedPlayerId),
            JSON.stringify(encryptedEntry),
            "EX",
            normalizedTtlSeconds
          );
        } catch {
          // Local Map remains the fallback when Redis is unavailable.
        }
      }

      return toSnapshot(normalizedPlayerId, localEntry);
    },

    async get(playerId) {
      const normalizedPlayerId = normalizePlayerId(playerId);
      const localSnapshot = getLocal(normalizedPlayerId);
      if (localSnapshot) {
        return localSnapshot;
      }

      const redisClient = resolveRedisClient();
      if (!redisClient) {
        return null;
      }

      const redisKey = buildRedisKey(keyPrefix, normalizedPlayerId);
      try {
        const serialized = await redisClient.get(redisKey);
        if (!serialized) {
          return null;
        }

        const redisEntry = parseRedisWechatSessionKeyEntry(serialized);
        if (!redisEntry || redisEntry.expiresAtMs <= getNowMs()) {
          await redisClient.del(redisKey);
          return null;
        }

        const sessionKey = decryptWechatSessionKeyFromRedis(normalizedPlayerId, redisEntry, env);
        if (!sessionKey) {
          return null;
        }

        const localEntry = {
          sessionKey,
          expiresAtMs: redisEntry.expiresAtMs
        };
        localCache.set(normalizedPlayerId, localEntry);
        return toSnapshot(normalizedPlayerId, localEntry);
      } catch {
        return null;
      }
    },

    async clear(playerId) {
      const normalizedPlayerId = normalizePlayerId(playerId);
      const localDeleted = localCache.delete(normalizedPlayerId);
      const redisClient = resolveRedisClient();
      if (!redisClient) {
        return localDeleted;
      }

      try {
        const redisDeleted = await redisClient.del(buildRedisKey(keyPrefix, normalizedPlayerId));
        return localDeleted || redisDeleted > 0;
      } catch {
        return localDeleted;
      }
    },

    async reset() {
      const localRedisKeys = Array.from(localCache.keys()).map((playerId) => buildRedisKey(keyPrefix, playerId));
      localCache.clear();
      const redisClient = resolveRedisClient();
      if (!redisClient) {
        return;
      }

      try {
        const prefixKeys = await listRedisKeysByPrefix(redisClient, keyPrefix);
        const keys = Array.from(new Set([...localRedisKeys, ...prefixKeys]));
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      } catch {
        // Reset is best-effort for Redis; local state is already cleared.
      }
    }
  };
}

const defaultWechatSessionKeyCache = createWechatSessionKeyCache();

export function cacheWechatSessionKey(
  playerId: string,
  sessionKey: string,
  ttlSeconds = readWechatSessionKeyTtlSeconds()
): Promise<CachedWechatSessionKeySnapshot> {
  return defaultWechatSessionKeyCache.cache(playerId, sessionKey, ttlSeconds);
}

export function getCachedWechatSessionKey(playerId: string): Promise<CachedWechatSessionKeySnapshot | null> {
  return defaultWechatSessionKeyCache.get(playerId);
}

export function clearCachedWechatSessionKey(playerId: string): Promise<boolean> {
  return defaultWechatSessionKeyCache.clear(playerId);
}

export function resetWechatSessionKeyCache(): Promise<void> {
  return defaultWechatSessionKeyCache.reset();
}

export async function validateWechatSignature(input: {
  playerId: string;
  rawData: string;
  signature: string;
}): Promise<CachedWechatSessionKeySnapshot | null> {
  const cached = await getCachedWechatSessionKey(input.playerId);
  if (!cached) {
    return null;
  }
  const expectedDigest = createHash("sha1").update(`${input.rawData}${cached.sessionKey}`, "utf8").digest();
  const normalizedSignature = input.signature.trim().toLowerCase();
  if (normalizedSignature.length !== expectedDigest.length * 2) {
    return null;
  }

  const providedDigest = Buffer.from(normalizedSignature, "hex");
  if (providedDigest.length !== expectedDigest.length) {
    return null;
  }

  return timingSafeEqual(expectedDigest, providedDigest) ? cached : null;
}

export async function decryptWechatPhoneNumber(input: {
  playerId: string;
  encryptedData: string;
  iv: string;
  expectedAppId?: string | undefined;
}): Promise<{ cache: CachedWechatSessionKeySnapshot; payload: WechatPhoneNumberPayload } | null> {
  const cache = await getCachedWechatSessionKey(input.playerId);
  if (!cache) {
    return null;
  }

  try {
    const sessionKeyBuffer = Buffer.from(normalizeBase64Field(cache.sessionKey, "sessionKey"), "base64");
    const ivBuffer = Buffer.from(normalizeBase64Field(input.iv, "iv"), "base64");
    const encryptedBuffer = Buffer.from(normalizeBase64Field(input.encryptedData, "encryptedData"), "base64");
    const decipher = createDecipheriv("aes-128-cbc", sessionKeyBuffer, ivBuffer);
    decipher.setAutoPadding(true);
    const decoded = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]).toString("utf8");
    const payload = JSON.parse(decoded) as WechatPhoneNumberPayload;
    const appId = payload.watermark?.appid?.trim();
    if (input.expectedAppId?.trim() && appId && appId !== input.expectedAppId.trim()) {
      return null;
    }
    return {
      cache,
      payload
    };
  } catch {
    return null;
  }
}
