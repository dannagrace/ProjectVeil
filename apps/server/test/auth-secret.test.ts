import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { issueGuestAuthSession, resetGuestAuthSessions } from "@server/domain/account/auth";
import { resetRuntimeSecretsForTest } from "@server/infra/runtime-secrets";

test("issueGuestAuthSession rejects production signing when VEIL_AUTH_SECRET is missing", { concurrency: false }, () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAuthSecret = process.env.VEIL_AUTH_SECRET;

  resetGuestAuthSessions();
  resetRuntimeSecretsForTest();
  delete process.env.VEIL_AUTH_SECRET;
  process.env.NODE_ENV = "production";

  try {
    assert.throws(
      () =>
        issueGuestAuthSession({
          playerId: "player-production-secret",
          displayName: "Production Secret"
        }),
      /VEIL_AUTH_SECRET/
    );
  } finally {
    resetGuestAuthSessions();
    resetRuntimeSecretsForTest();
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAuthSecret === undefined) {
      delete process.env.VEIL_AUTH_SECRET;
    } else {
      process.env.VEIL_AUTH_SECRET = previousAuthSecret;
    }
  }
});

test("auth token signature validation uses timing-safe comparisons", async () => {
  const sourcePath = fileURLToPath(new URL("../src/domain/account/auth.ts", import.meta.url));
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /\btimingSafeCompareTokenSignature\b/);
  assert.doesNotMatch(source, /signature\s*!==\s*expectedSignature/);
});

test("auth tokens include a random nonce before signing", async () => {
  const sourcePath = fileURLToPath(new URL("../src/domain/account/auth.ts", import.meta.url));
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /nonce\?: string/);
  assert.match(source, /nonce: randomUUID\(\)/);
});

test("account token hashes and refresh token hashes use timing-safe comparisons", async () => {
  const sourcePath = fileURLToPath(new URL("../src/domain/account/auth.ts", import.meta.url));
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /\btimingSafeCompareHexDigest\b/);
  assert.doesNotMatch(source, /state\.tokenHash\s*!==\s*hashAccountRegistrationToken\(token\)/);
  assert.doesNotMatch(source, /state\.tokenHash\s*!==\s*hashPasswordRecoveryToken\(token\)/);
  assert.doesNotMatch(source, /authDeviceSession\.refreshTokenHash\s*!==\s*hashRefreshToken\(normalizedToken\)/);
});

test("guest session storage hashes bearer tokens at rest", async () => {
  const sourcePath = fileURLToPath(new URL("../src/domain/account/auth.ts", import.meta.url));
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /\bhashGuestSessionToken\b/);
  assert.doesNotMatch(source, /guestSessionsById\.set\([^,]+,\s*session\)/);
  assert.doesNotMatch(source, /existingSession\.token\s*!==\s*token/);
});

test("guest session cluster ordering uses sorted-set operations instead of list scans", async () => {
  const sourcePath = fileURLToPath(new URL("../src/domain/account/auth.ts", import.meta.url));
  const source = await readFile(sourcePath, "utf8");
  const orderKeyUsages = source.match(/\.(?:lrem|rpush|llen|lindex|zadd|zcard|zrange|zrem|zremrangebyrank)\(\s*GUEST_SESSION_CLUSTER_ORDER_KEY/g) ?? [];

  assert.ok(orderKeyUsages.some((usage) => usage.includes(".zadd(")));
  assert.ok(orderKeyUsages.some((usage) => usage.includes(".zcard(")));
  assert.ok(orderKeyUsages.some((usage) => usage.includes(".zrange(")));
  assert.ok(orderKeyUsages.some((usage) => usage.includes(".zrem(")));
  assert.equal(orderKeyUsages.some((usage) => usage.includes(".lrem(")), false);
  assert.equal(orderKeyUsages.some((usage) => usage.includes(".rpush(")), false);
  assert.equal(orderKeyUsages.some((usage) => usage.includes(".llen(")), false);
  assert.equal(orderKeyUsages.some((usage) => usage.includes(".lindex(")), false);
});
