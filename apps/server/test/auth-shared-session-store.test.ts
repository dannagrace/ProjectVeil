import assert from "node:assert/strict";
import test from "node:test";
import Redis from "ioredis-mock";
import {
  __authStateInternals,
  __authRateLimitInternals,
  issueGuestAuthSession,
  resetGuestAuthSessions,
  revokeGuestAuthSession,
  setGuestSessionClusterClientForTest,
  validateGuestAuthToken
} from "@server/domain/account/auth";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "@server/domain/ops/observability";

function waitForClusterSync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("guest auth validation accepts sessions from shared Redis after local state is cleared", async () => {
  const redis = new Redis();
  resetGuestAuthSessions();
  setGuestSessionClusterClientForTest(redis as never);

  try {
    const session = issueGuestAuthSession({
      playerId: "shared-guest-player",
      displayName: "Shared Guest"
    });

    await waitForClusterSync();

    resetGuestAuthSessions();
    setGuestSessionClusterClientForTest(redis as never);

    const result = await validateGuestAuthToken(session.token, null);
    assert.equal(result.errorCode, undefined);
    assert.equal(result.session?.playerId, "shared-guest-player");
  } finally {
    setGuestSessionClusterClientForTest(undefined);
    await redis.quit();
    resetGuestAuthSessions();
  }
});

test("shared Redis guest sessions store new bearer tokens hashed at rest", async () => {
  const redis = new Redis();
  resetGuestAuthSessions();
  setGuestSessionClusterClientForTest(redis as never);

  try {
    const session = issueGuestAuthSession({
      playerId: "hashed-guest-player",
      displayName: "Hashed Guest"
    });

    await waitForClusterSync();

    const serialized = await redis.get(`veil:guest-session:${session.sessionId}`);
    assert.equal(typeof serialized, "string");
    const stored = JSON.parse(serialized as string) as { token?: string; tokenHash?: string };
    assert.equal(stored.token, undefined);
    assert.equal(typeof stored.tokenHash, "string");
    assert.notEqual(stored.tokenHash, session.token);
    assert.equal((serialized as string).includes(session.token), false);
  } finally {
    setGuestSessionClusterClientForTest(undefined);
    await redis.quit();
    resetGuestAuthSessions();
  }
});

test("shared Redis guest validation accepts legacy plaintext sessions and rewrites them hashed", async () => {
  const redis = new Redis();
  resetGuestAuthSessions();
  setGuestSessionClusterClientForTest(redis as never);

  try {
    const session = issueGuestAuthSession({
      playerId: "legacy-plaintext-guest-player",
      displayName: "Legacy Plaintext Guest"
    });

    await waitForClusterSync();
    await redis.set(
      `veil:guest-session:${session.sessionId}`,
      JSON.stringify({
        ...session,
        lastUsedAt: session.issuedAt
      })
    );

    resetGuestAuthSessions();
    setGuestSessionClusterClientForTest(redis as never);

    const result = await validateGuestAuthToken(session.token, null);
    assert.equal(result.errorCode, undefined);
    assert.equal(result.session?.playerId, "legacy-plaintext-guest-player");

    const rewritten = await redis.get(`veil:guest-session:${session.sessionId}`);
    assert.equal(typeof rewritten, "string");
    const stored = JSON.parse(rewritten as string) as { token?: string; tokenHash?: string };
    assert.equal(stored.token, undefined);
    assert.equal(typeof stored.tokenHash, "string");
    assert.notEqual(stored.tokenHash, session.token);
    assert.equal((rewritten as string).includes(session.token), false);
  } finally {
    setGuestSessionClusterClientForTest(undefined);
    await redis.quit();
    resetGuestAuthSessions();
  }
});

test("revoking a guest auth session removes it from the shared Redis session store", async () => {
  const redis = new Redis();
  resetGuestAuthSessions();
  setGuestSessionClusterClientForTest(redis as never);

  try {
    const session = issueGuestAuthSession({
      playerId: "revoked-guest-player",
      displayName: "Revoked Guest"
    });

    await waitForClusterSync();
    assert.equal(revokeGuestAuthSession(session.sessionId!), true);
    await waitForClusterSync();

    resetGuestAuthSessions();
    setGuestSessionClusterClientForTest(redis as never);

    const result = await validateGuestAuthToken(session.token, null);
    assert.equal(result.session, null);
    assert.equal(result.errorCode, "session_revoked");
  } finally {
    setGuestSessionClusterClientForTest(undefined);
    await redis.quit();
    resetGuestAuthSessions();
  }
});

test("account registration and password recovery Redis fallback failures are observable", async () => {
  resetGuestAuthSessions();
  resetRuntimeObservability();
  const redis = {
    async get() {
      throw new Error("redis read unavailable");
    },
    async set() {
      throw new Error("redis write unavailable");
    },
    async del() {
      return 0;
    }
  };
  const originalError = console.error;
  console.error = () => undefined;
  setGuestSessionClusterClientForTest(redis as never);

  try {
    await __authStateInternals.storeAccountRegistrationState("fallback-register", "Fallback", "register-token");
    assert.equal(
      (await __authStateInternals.getAccountRegistrationState("fallback-register"))?.loginId,
      "fallback-register"
    );

    await __authStateInternals.storePasswordRecoveryState("player-fallback", "fallback-recovery", "recovery-token");
    assert.equal(
      (await __authStateInternals.getPasswordRecoveryState("fallback-recovery"))?.loginId,
      "fallback-recovery"
    );

    const metrics = buildPrometheusMetricsDocument();
    assert.match(metrics, /^veil_auth_account_registration_state_redis_read_failures_total 1$/m);
    assert.match(metrics, /^veil_auth_account_registration_state_redis_write_failures_total 1$/m);
    assert.match(metrics, /^veil_auth_password_recovery_state_redis_read_failures_total 1$/m);
    assert.match(metrics, /^veil_auth_password_recovery_state_redis_write_failures_total 1$/m);
  } finally {
    console.error = originalError;
    setGuestSessionClusterClientForTest(undefined);
    resetGuestAuthSessions();
    resetRuntimeObservability();
  }
});

test("account registration and password recovery Redis consume delete failures are observable", async () => {
  resetGuestAuthSessions();
  resetRuntimeObservability();
  const redis = new Redis();
  setGuestSessionClusterClientForTest(redis as never);
  const originalError = console.error;
  const errors: string[] = [];
  const originalDel = redis.del.bind(redis);
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    await __authStateInternals.storeAccountRegistrationState("consume-register", "Consume Register", "register-token");
    await __authStateInternals.storePasswordRecoveryState("player-consume", "consume-recovery", "recovery-token");

    redis.del = (async (...keys: string[]) => {
      if (
        keys.some(
          (key) =>
            key.startsWith("veil:auth-account-registration:") || key.startsWith("veil:auth-password-recovery:")
        )
      ) {
        throw new Error("redis delete unavailable");
      }
      return originalDel(...keys);
    }) as typeof redis.del;

    assert.equal(
      (await __authStateInternals.consumeAccountRegistrationState("consume-register", "register-token"))?.loginId,
      "consume-register"
    );
    assert.equal(
      (await __authStateInternals.consumePasswordRecoveryState("consume-recovery", "recovery-token"))?.loginId,
      "consume-recovery"
    );

    const metrics = buildPrometheusMetricsDocument();
    assert.match(metrics, /^veil_auth_account_registration_state_redis_delete_failures_total 1$/m);
    assert.match(metrics, /^veil_auth_password_recovery_state_redis_delete_failures_total 1$/m);
    assert.deepEqual(errors, [
      "[auth] account-registration state delete failed after local consume",
      "[auth] password-recovery state delete failed after local consume"
    ]);
  } finally {
    console.error = originalError;
    setGuestSessionClusterClientForTest(undefined);
    await redis.quit();
    resetGuestAuthSessions();
    resetRuntimeObservability();
  }
});

test("shared Redis guest session order enforces the global guest-session limit across resets", async () => {
  const redis = new Redis();
  const previousMaxGuestSessions = process.env.VEIL_MAX_GUEST_SESSIONS;
  process.env.VEIL_MAX_GUEST_SESSIONS = "2";
  resetGuestAuthSessions();
  setGuestSessionClusterClientForTest(redis as never);

  try {
    const first = issueGuestAuthSession({
      playerId: "guest-limit-1",
      displayName: "Guest Limit One"
    });
    const second = issueGuestAuthSession({
      playerId: "guest-limit-2",
      displayName: "Guest Limit Two"
    });
    const third = issueGuestAuthSession({
      playerId: "guest-limit-3",
      displayName: "Guest Limit Three"
    });

    await waitForClusterSync();
    resetGuestAuthSessions();
    setGuestSessionClusterClientForTest(redis as never);

    const firstResult = await validateGuestAuthToken(first.token, null);
    const secondResult = await validateGuestAuthToken(second.token, null);
    const thirdResult = await validateGuestAuthToken(third.token, null);

    assert.equal(firstResult.errorCode, "session_revoked");
    assert.equal(secondResult.session?.playerId, "guest-limit-2");
    assert.equal(thirdResult.session?.playerId, "guest-limit-3");
  } finally {
    if (previousMaxGuestSessions === undefined) {
      delete process.env.VEIL_MAX_GUEST_SESSIONS;
    } else {
      process.env.VEIL_MAX_GUEST_SESSIONS = previousMaxGuestSessions;
    }
    setGuestSessionClusterClientForTest(undefined);
    await redis.quit();
    resetGuestAuthSessions();
  }
});

test("auth rate limit counters are shared through Redis across local resets", async () => {
  const redis = new Redis();
  resetGuestAuthSessions();
  setGuestSessionClusterClientForTest(redis as never);
  const rateLimitConfig = {
    rateLimitWindowMs: 60_000,
    rateLimitMax: 2,
    lockoutThreshold: 10,
    lockoutDurationMs: 15 * 60_000,
    credentialStuffingWindowMs: 5 * 60_000,
    credentialStuffingDistinctLoginIdThreshold: 5,
    credentialStuffingBlockDurationMs: 15 * 60_000,
    maxGuestSessions: 10_000,
    authAccessTtlSeconds: 60 * 60,
    authRefreshTtlSeconds: 30 * 24 * 60 * 60,
    guestTokenTtlSeconds: 7 * 24 * 60 * 60,
    accountRegistrationTtlMs: 15 * 60_000,
    passwordRecoveryTtlMs: 15 * 60_000
  };

  try {
    const first = await __authRateLimitInternals.consumeAuthRateLimit("guest-login:198.51.100.20", rateLimitConfig);
    resetGuestAuthSessions();
    setGuestSessionClusterClientForTest(redis as never);
    const second = await __authRateLimitInternals.consumeAuthRateLimit("guest-login:198.51.100.20", rateLimitConfig);
    resetGuestAuthSessions();
    setGuestSessionClusterClientForTest(redis as never);
    const third = await __authRateLimitInternals.consumeAuthRateLimit("guest-login:198.51.100.20", rateLimitConfig);

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false);
    assert.equal(third.retryAfterSeconds, 60);
  } finally {
    setGuestSessionClusterClientForTest(undefined);
    await redis.quit();
    resetGuestAuthSessions();
  }
});
