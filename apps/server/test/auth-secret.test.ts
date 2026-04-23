import assert from "node:assert/strict";
import test from "node:test";
import { issueGuestAuthSession, resetGuestAuthSessions } from "@server/domain/account/auth";
import { resetRuntimeSecretsForTest } from "@server/domain/ops/runtime-secrets";

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
