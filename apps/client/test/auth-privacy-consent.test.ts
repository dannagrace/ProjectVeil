import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmAccountRegistration,
  deleteCurrentPlayerAccount,
  getAuthSessionStorageKey,
  loginGuestAuthSession,
  loginPasswordAuthSession
} from "../src/auth-session";

test("h5 auth helpers forward privacy consent and clear storage after deletion", async () => {
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
        token: "account.token",
        source: "remote"
      })
    ]
  ]);
  const requests: Array<{ url: string; body: string }> = [];

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
      body: String(init?.body ?? "")
    });
    callIndex += 1;

    if (callIndex === 1) {
      return new Response(
        JSON.stringify({
          session: {
            token: "guest.token",
            playerId: "guest-privacy",
            displayName: "隐私旅人",
            authMode: "guest"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (callIndex === 2) {
      return new Response(
        JSON.stringify({
          session: {
            token: "account.token.next",
            playerId: "account-player",
            displayName: "隐私旅人",
            authMode: "account",
            loginId: "veil-ranger"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (callIndex === 3) {
      return new Response(
        JSON.stringify({
          account: {
            playerId: "account-player",
            displayName: "隐私旅人",
            loginId: "veil-ranger"
          },
          session: {
            token: "account.token.confirmed",
            playerId: "account-player",
            displayName: "隐私旅人",
            authMode: "account",
            loginId: "veil-ranger"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        deleted: {
          playerId: "account-player",
          displayName: "deleted-account-player"
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await loginGuestAuthSession("guest-privacy", "隐私旅人", {
      privacyConsentAccepted: true
    });
    await loginPasswordAuthSession("Veil-Ranger", "hunter22", {
      privacyConsentAccepted: true
    });
    await confirmAccountRegistration("Veil-Ranger", "dev-registration-token", "hunter22", {
      privacyConsentAccepted: true
    });
    const deleted = await deleteCurrentPlayerAccount();

    assert.match(requests[0]?.body ?? "", /"privacyConsentAccepted":true/);
    assert.match(requests[1]?.body ?? "", /"privacyConsentAccepted":true/);
    assert.match(requests[2]?.body ?? "", /"privacyConsentAccepted":true/);
    assert.equal(deleted?.playerId, "account-player");
    assert.equal(values.has(getAuthSessionStorageKey()), false);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});
