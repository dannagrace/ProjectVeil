import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import {
  cacheWechatSessionKey,
  clearCachedWechatSessionKey,
  createWechatSessionKeyCache,
  getCachedWechatSessionKey,
  readWechatSessionKeyTtlSeconds,
  resetWechatSessionKeyCache,
  validateWechatSignature,
} from "@server/adapters/wechat-session-key";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "@server/domain/ops/observability";

function withCleanCache(t: TestContext): void {
  void resetWechatSessionKeyCache();
  t.after(() => resetWechatSessionKeyCache());
}

function signWechatRawData(rawData: string, sessionKey: string): string {
  return createHash("sha1").update(`${rawData}${sessionKey}`, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// readWechatSessionKeyTtlSeconds
// ---------------------------------------------------------------------------

test("readWechatSessionKeyTtlSeconds: no env var → 7200", () => {
  const result = readWechatSessionKeyTtlSeconds({});
  assert.equal(result, 7200);
});

test("readWechatSessionKeyTtlSeconds: valid value 3600 → 3600", () => {
  const result = readWechatSessionKeyTtlSeconds({ VEIL_WECHAT_SESSION_KEY_TTL_SECONDS: "3600" });
  assert.equal(result, 3600);
});

test("readWechatSessionKeyTtlSeconds: value 0 → 7200 (below minimum)", () => {
  const result = readWechatSessionKeyTtlSeconds({ VEIL_WECHAT_SESSION_KEY_TTL_SECONDS: "0" });
  assert.equal(result, 7200);
});

test("readWechatSessionKeyTtlSeconds: negative value -100 → 7200", () => {
  const result = readWechatSessionKeyTtlSeconds({ VEIL_WECHAT_SESSION_KEY_TTL_SECONDS: "-100" });
  assert.equal(result, 7200);
});

test("readWechatSessionKeyTtlSeconds: non-numeric 'abc' → 7200 (NaN)", () => {
  const result = readWechatSessionKeyTtlSeconds({ VEIL_WECHAT_SESSION_KEY_TTL_SECONDS: "abc" });
  assert.equal(result, 7200);
});

test("readWechatSessionKeyTtlSeconds: float 3600.9 → 3600 (floored)", () => {
  const result = readWechatSessionKeyTtlSeconds({ VEIL_WECHAT_SESSION_KEY_TTL_SECONDS: "3600.9" });
  assert.equal(result, 3600);
});

// ---------------------------------------------------------------------------
// cacheWechatSessionKey
// ---------------------------------------------------------------------------

test("cacheWechatSessionKey: returns snapshot with correct playerId and sessionKey", async (t) => {
  withCleanCache(t);
  const snapshot = await cacheWechatSessionKey("player-1", "abc123sessionkey==");
  assert.equal(snapshot.playerId, "player-1");
  assert.equal(snapshot.sessionKey, "abc123sessionkey==");
});

test("cacheWechatSessionKey: expiresAt is a valid future ISO string", async (t) => {
  withCleanCache(t);
  const before = Date.now();
  const snapshot = await cacheWechatSessionKey("player-2", "sessionkeyvalue==");
  const expiresAtMs = new Date(snapshot.expiresAt).getTime();
  assert.ok(expiresAtMs > before, "expiresAt should be in the future");
  assert.ok(snapshot.expiresAt.endsWith("Z"), "expiresAt should be ISO string ending with Z");
});

test("cacheWechatSessionKey: throws on empty playerId (whitespace only)", async (t) => {
  withCleanCache(t);
  await assert.rejects(
    () => cacheWechatSessionKey("   ", "sessionkeyvalue=="),
    /playerId must not be empty/
  );
});

test("cacheWechatSessionKey: throws on empty sessionKey", async (t) => {
  withCleanCache(t);
  await assert.rejects(
    () => cacheWechatSessionKey("player-3", "   "),
    /sessionKey must not be empty/
  );
});

test("cacheWechatSessionKey: trims whitespace from playerId and sessionKey", async (t) => {
  withCleanCache(t);
  const snapshot = await cacheWechatSessionKey("  player-4  ", "  trimmedkey==  ");
  assert.equal(snapshot.playerId, "player-4");
  assert.equal(snapshot.sessionKey, "trimmedkey==");
});

test("cacheWechatSessionKey: records Redis write fallback without dropping local cache", async () => {
  resetRuntimeObservability();
  const originalWarn = console.warn;
  console.warn = () => undefined;
  const cache = createWechatSessionKeyCache({
    env: { VEIL_AUTH_SECRET: "test-secret" },
    redisClient: {
      async set() {
        throw new Error("redis write unavailable");
      }
    } as never
  });

  const snapshot = await cache.cache("player-redis-write", "session-key==", 60);

  assert.equal(snapshot.playerId, "player-redis-write");
  assert.equal((await cache.get("player-redis-write"))?.sessionKey, "session-key==");
  assert.match(buildPrometheusMetricsDocument(), /^veil_wechat_session_key_cache_redis_write_failures_total 1$/m);
  console.warn = originalWarn;
  resetRuntimeObservability();
});

// ---------------------------------------------------------------------------
// getCachedWechatSessionKey
// ---------------------------------------------------------------------------

test("getCachedWechatSessionKey: returns null when no entry exists", async (t) => {
  withCleanCache(t);
  const result = await getCachedWechatSessionKey("nonexistent-player");
  assert.equal(result, null);
});

test("getCachedWechatSessionKey: returns snapshot when entry exists and is not expired", async (t) => {
  withCleanCache(t);
  await cacheWechatSessionKey("player-5", "validkey==", 3600);
  const result = await getCachedWechatSessionKey("player-5");
  assert.ok(result !== null, "should return a snapshot");
  assert.equal(result.playerId, "player-5");
  assert.equal(result.sessionKey, "validkey==");
  assert.ok(result.expiresAt.endsWith("Z"), "expiresAt should be ISO string");
});

test("getCachedWechatSessionKey: expiresAt from get matches expiresAt from cache", async (t) => {
  withCleanCache(t);
  const cached = await cacheWechatSessionKey("player-6", "anotherkey==", 3600);
  const retrieved = await getCachedWechatSessionKey("player-6");
  assert.ok(retrieved !== null);
  assert.equal(retrieved.expiresAt, cached.expiresAt);
});

test("getCachedWechatSessionKey: records Redis read fallback when shared cache is unavailable", async () => {
  resetRuntimeObservability();
  const originalWarn = console.warn;
  console.warn = () => undefined;
  const cache = createWechatSessionKeyCache({
    env: { VEIL_AUTH_SECRET: "test-secret" },
    redisClient: {
      async get() {
        throw new Error("redis read unavailable");
      }
    } as never
  });

  assert.equal(await cache.get("player-redis-read"), null);
  assert.match(buildPrometheusMetricsDocument(), /^veil_wechat_session_key_cache_redis_read_failures_total 1$/m);
  console.warn = originalWarn;
  resetRuntimeObservability();
});

// ---------------------------------------------------------------------------
// clearCachedWechatSessionKey
// ---------------------------------------------------------------------------

test("clearCachedWechatSessionKey: returns false when key doesn't exist", async (t) => {
  withCleanCache(t);
  const result = await clearCachedWechatSessionKey("ghost-player");
  assert.equal(result, false);
});

test("clearCachedWechatSessionKey: returns true when key exists and was deleted", async (t) => {
  withCleanCache(t);
  await cacheWechatSessionKey("player-7", "keytoremove==", 3600);
  const result = await clearCachedWechatSessionKey("player-7");
  assert.equal(result, true);
});

test("clearCachedWechatSessionKey: after clear, getCachedWechatSessionKey returns null", async (t) => {
  withCleanCache(t);
  await cacheWechatSessionKey("player-8", "ephemeralkey==", 3600);
  await clearCachedWechatSessionKey("player-8");
  const result = await getCachedWechatSessionKey("player-8");
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// resetWechatSessionKeyCache
// ---------------------------------------------------------------------------

test("resetWechatSessionKeyCache: after caching 2 players, reset clears all entries", async (t) => {
  withCleanCache(t);
  await cacheWechatSessionKey("player-9", "key9==", 3600);
  await cacheWechatSessionKey("player-10", "key10==", 3600);
  await resetWechatSessionKeyCache();
  assert.equal(await getCachedWechatSessionKey("player-9"), null);
  assert.equal(await getCachedWechatSessionKey("player-10"), null);
});

// ---------------------------------------------------------------------------
// validateWechatSignature
// ---------------------------------------------------------------------------

test("validateWechatSignature: accepts valid SHA1 signature and rejects malformed or mismatched signatures", async (t) => {
  withCleanCache(t);
  const sessionKey = "wechat-session-key";
  const rawData = JSON.stringify({ nickname: "veil-player", avatarUrl: "https://example.test/avatar.png" });
  const signature = signWechatRawData(rawData, sessionKey);
  await cacheWechatSessionKey("player-signature", sessionKey, 3600);

  assert.equal(
    (await validateWechatSignature({ playerId: "player-signature", rawData, signature }))?.playerId,
    "player-signature"
  );
  assert.equal(await validateWechatSignature({ playerId: "player-signature", rawData, signature: signature.slice(0, -2) }), null);
  assert.equal(await validateWechatSignature({ playerId: "player-signature", rawData, signature: `00${signature.slice(2)}` }), null);
});

test("validateWechatSignature: compares SHA1 signatures with timingSafeEqual", () => {
  const source = readFileSync(new URL("../src/adapters/wechat-session-key.ts", import.meta.url), "utf8");

  assert.match(source, /timingSafeEqual/);
  assert.doesNotMatch(source, /digest\s*===\s*input\.signature/);
  assert.doesNotMatch(source, /signature.*===.*digest/);
});
