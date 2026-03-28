import assert from "node:assert/strict";
import test from "node:test";
import {
  clearStoredAuthSession,
  getAuthSessionStorageKey,
  readStoredAuthSession,
  syncCurrentAuthSession,
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

test("syncCurrentAuthSession refreshes an expired access token and persists the rotated session", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>([
    [
      getAuthSessionStorageKey(),
      JSON.stringify({
        playerId: "player-auth",
        displayName: "访客骑士",
        authMode: "account",
        loginId: "veil-ranger",
        token: "expired-access",
        refreshToken: "refresh-token",
        source: "remote"
      })
    ]
  ]);
  const requests: Array<{ url: string; authorization?: string }> = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(key: string): string | null {
          return values.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          values.set(key, value);
        },
        removeItem(key: string): void {
          values.delete(key);
        }
      }
    }
  });

  let callIndex = 0;
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      authorization: (init?.headers as Record<string, string> | undefined)?.Authorization
    });
    callIndex += 1;

    if (callIndex === 1) {
      return new Response(JSON.stringify({ error: { code: "token_expired" } }), { status: 401 });
    }
    if (callIndex === 2) {
      return new Response(
        JSON.stringify({
          session: {
            token: "fresh-access",
            refreshToken: "fresh-refresh",
            playerId: "player-auth",
            displayName: "访客骑士",
            authMode: "account",
            loginId: "veil-ranger"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        session: {
          token: "fresh-access",
          refreshToken: "fresh-refresh",
          playerId: "player-auth",
          displayName: "访客骑士",
          authMode: "account",
          loginId: "veil-ranger"
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const session = await syncCurrentAuthSession();
    assert.equal(session?.token, "fresh-access");
    assert.equal(session?.refreshToken, "fresh-refresh");
    assert.deepEqual(requests.map((entry) => entry.authorization), [
      "Bearer expired-access",
      "Bearer refresh-token",
      "Bearer fresh-access"
    ]);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});
