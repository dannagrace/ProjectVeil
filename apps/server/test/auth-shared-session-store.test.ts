import assert from "node:assert/strict";
import test from "node:test";
import Redis from "ioredis-mock";
import {
  issueGuestAuthSession,
  resetGuestAuthSessions,
  revokeGuestAuthSession,
  setGuestSessionClusterClientForTest,
  validateGuestAuthToken
} from "@server/domain/account/auth";

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
