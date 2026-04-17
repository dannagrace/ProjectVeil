import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  cacheWechatSessionKey,
  clearCachedWechatSessionKey,
  getCachedWechatSessionKey,
  readWechatSessionKeyTtlSeconds,
  resetWechatSessionKeyCache,
} from "../src/adapters/wechat-session-key";

function withCleanCache(t: TestContext): void {
  resetWechatSessionKeyCache();
  t.after(() => resetWechatSessionKeyCache());
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

test("cacheWechatSessionKey: returns snapshot with correct playerId and sessionKey", (t) => {
  withCleanCache(t);
  const snapshot = cacheWechatSessionKey("player-1", "abc123sessionkey==");
  assert.equal(snapshot.playerId, "player-1");
  assert.equal(snapshot.sessionKey, "abc123sessionkey==");
});

test("cacheWechatSessionKey: expiresAt is a valid future ISO string", (t) => {
  withCleanCache(t);
  const before = Date.now();
  const snapshot = cacheWechatSessionKey("player-2", "sessionkeyvalue==");
  const expiresAtMs = new Date(snapshot.expiresAt).getTime();
  assert.ok(expiresAtMs > before, "expiresAt should be in the future");
  assert.ok(snapshot.expiresAt.endsWith("Z"), "expiresAt should be ISO string ending with Z");
});

test("cacheWechatSessionKey: throws on empty playerId (whitespace only)", (t) => {
  withCleanCache(t);
  assert.throws(
    () => cacheWechatSessionKey("   ", "sessionkeyvalue=="),
    /playerId must not be empty/
  );
});

test("cacheWechatSessionKey: throws on empty sessionKey", (t) => {
  withCleanCache(t);
  assert.throws(
    () => cacheWechatSessionKey("player-3", "   "),
    /sessionKey must not be empty/
  );
});

test("cacheWechatSessionKey: trims whitespace from playerId and sessionKey", (t) => {
  withCleanCache(t);
  const snapshot = cacheWechatSessionKey("  player-4  ", "  trimmedkey==  ");
  assert.equal(snapshot.playerId, "player-4");
  assert.equal(snapshot.sessionKey, "trimmedkey==");
});

// ---------------------------------------------------------------------------
// getCachedWechatSessionKey
// ---------------------------------------------------------------------------

test("getCachedWechatSessionKey: returns null when no entry exists", (t) => {
  withCleanCache(t);
  const result = getCachedWechatSessionKey("nonexistent-player");
  assert.equal(result, null);
});

test("getCachedWechatSessionKey: returns snapshot when entry exists and is not expired", (t) => {
  withCleanCache(t);
  cacheWechatSessionKey("player-5", "validkey==", 3600);
  const result = getCachedWechatSessionKey("player-5");
  assert.ok(result !== null, "should return a snapshot");
  assert.equal(result.playerId, "player-5");
  assert.equal(result.sessionKey, "validkey==");
  assert.ok(result.expiresAt.endsWith("Z"), "expiresAt should be ISO string");
});

test("getCachedWechatSessionKey: expiresAt from get matches expiresAt from cache", (t) => {
  withCleanCache(t);
  const cached = cacheWechatSessionKey("player-6", "anotherkey==", 3600);
  const retrieved = getCachedWechatSessionKey("player-6");
  assert.ok(retrieved !== null);
  assert.equal(retrieved.expiresAt, cached.expiresAt);
});

// ---------------------------------------------------------------------------
// clearCachedWechatSessionKey
// ---------------------------------------------------------------------------

test("clearCachedWechatSessionKey: returns false when key doesn't exist", (t) => {
  withCleanCache(t);
  const result = clearCachedWechatSessionKey("ghost-player");
  assert.equal(result, false);
});

test("clearCachedWechatSessionKey: returns true when key exists and was deleted", (t) => {
  withCleanCache(t);
  cacheWechatSessionKey("player-7", "keytoremove==", 3600);
  const result = clearCachedWechatSessionKey("player-7");
  assert.equal(result, true);
});

test("clearCachedWechatSessionKey: after clear, getCachedWechatSessionKey returns null", (t) => {
  withCleanCache(t);
  cacheWechatSessionKey("player-8", "ephemeralkey==", 3600);
  clearCachedWechatSessionKey("player-8");
  const result = getCachedWechatSessionKey("player-8");
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// resetWechatSessionKeyCache
// ---------------------------------------------------------------------------

test("resetWechatSessionKeyCache: after caching 2 players, reset clears all entries", (t) => {
  withCleanCache(t);
  cacheWechatSessionKey("player-9", "key9==", 3600);
  cacheWechatSessionKey("player-10", "key10==", 3600);
  resetWechatSessionKeyCache();
  assert.equal(getCachedWechatSessionKey("player-9"), null);
  assert.equal(getCachedWechatSessionKey("player-10"), null);
});
