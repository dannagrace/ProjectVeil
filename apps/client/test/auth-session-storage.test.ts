import assert from "node:assert/strict";
import test from "node:test";
import {
  clearStoredAuthSession,
  getAuthSessionStorageKey,
  readStoredAuthSession,
  writeStoredAuthSession
} from "../src/auth-session";

test("auth session helpers use a stable storage key", () => {
  assert.equal(getAuthSessionStorageKey(), "project-veil:auth-session");
});

test("auth session helpers can persist and clear stored guest sessions", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
    removeItem(key: string): void {
      values.delete(key);
    }
  };

  assert.equal(readStoredAuthSession(storage), null);

  writeStoredAuthSession(storage, {
    token: "signed.token",
    playerId: "player-auth",
    displayName: "访客骑士",
    authMode: "account",
    loginId: "veil-ranger",
    source: "remote"
  });
  assert.deepEqual(readStoredAuthSession(storage), {
    token: "signed.token",
    playerId: "player-auth",
    displayName: "访客骑士",
    authMode: "account",
    loginId: "veil-ranger",
    source: "remote"
  });

  clearStoredAuthSession(storage);
  assert.equal(readStoredAuthSession(storage), null);
});

test("auth session helpers default legacy payloads to guest mode", () => {
  const values = new Map<string, string>();
  values.set(
    getAuthSessionStorageKey(),
    JSON.stringify({
      playerId: "legacy-player",
      displayName: "旧访客",
      token: "legacy.token",
      source: "remote"
    })
  );

  assert.deepEqual(
    readStoredAuthSession({
      getItem(key: string): string | null {
        return values.get(key) ?? null;
      }
    }),
    {
      playerId: "legacy-player",
      displayName: "旧访客",
      authMode: "guest",
      token: "legacy.token",
      source: "remote"
    }
  );
});
