import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

interface CachedWechatSessionKeyEntry {
  sessionKey: string;
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

const DEFAULT_WECHAT_SESSION_KEY_TTL_SECONDS = 2 * 60 * 60;
const wechatSessionKeyCache = new Map<string, CachedWechatSessionKeyEntry>();

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

export function readWechatSessionKeyTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VEIL_WECHAT_SESSION_KEY_TTL_SECONDS?.trim());
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_WECHAT_SESSION_KEY_TTL_SECONDS;
  }
  return Math.floor(parsed);
}

export function cacheWechatSessionKey(playerId: string, sessionKey: string, ttlSeconds = readWechatSessionKeyTtlSeconds()): CachedWechatSessionKeySnapshot {
  const normalizedPlayerId = normalizePlayerId(playerId);
  const normalizedSessionKey = normalizeBase64Field(sessionKey, "sessionKey");
  const expiresAtMs = nowMs() + ttlSeconds * 1000;
  wechatSessionKeyCache.set(normalizedPlayerId, {
    sessionKey: normalizedSessionKey,
    expiresAtMs
  });
  return {
    playerId: normalizedPlayerId,
    sessionKey: normalizedSessionKey,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

export function getCachedWechatSessionKey(playerId: string): CachedWechatSessionKeySnapshot | null {
  const normalizedPlayerId = normalizePlayerId(playerId);
  const cached = wechatSessionKeyCache.get(normalizedPlayerId);
  if (!cached) {
    return null;
  }
  if (cached.expiresAtMs <= nowMs()) {
    wechatSessionKeyCache.delete(normalizedPlayerId);
    return null;
  }
  return {
    playerId: normalizedPlayerId,
    sessionKey: cached.sessionKey,
    expiresAt: new Date(cached.expiresAtMs).toISOString()
  };
}

export function clearCachedWechatSessionKey(playerId: string): boolean {
  return wechatSessionKeyCache.delete(normalizePlayerId(playerId));
}

export function resetWechatSessionKeyCache(): void {
  wechatSessionKeyCache.clear();
}

export function validateWechatSignature(input: {
  playerId: string;
  rawData: string;
  signature: string;
}): CachedWechatSessionKeySnapshot | null {
  const cached = getCachedWechatSessionKey(input.playerId);
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

export function decryptWechatPhoneNumber(input: {
  playerId: string;
  encryptedData: string;
  iv: string;
  expectedAppId?: string | undefined;
}): { cache: CachedWechatSessionKeySnapshot; payload: WechatPhoneNumberPayload } | null {
  const cache = getCachedWechatSessionKey(input.playerId);
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
