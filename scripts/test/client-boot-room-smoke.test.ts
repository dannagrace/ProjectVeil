import assert from "node:assert/strict";
import test from "node:test";

import { createSmokeGuestAuthContext, createSmokeGuestAuthHeaders, resolveSmokeRuntimeTargets } from "../client-boot-room-smoke";

test("resolveSmokeRuntimeTargets honors explicit playwright runtime target env", () => {
  const targets = resolveSmokeRuntimeTargets({
    VEIL_PLAYWRIGHT_SERVER_ORIGIN: "http://127.0.0.1:2867",
    VEIL_PLAYWRIGHT_CLIENT_ORIGIN: "http://127.0.0.1:4473",
    VEIL_PLAYWRIGHT_SERVER_WS_URL: "ws://127.0.0.1:2867"
  });

  assert.deepEqual(targets, {
    serverUrl: "http://127.0.0.1:2867",
    clientUrl: "http://127.0.0.1:4473",
    serverWsUrl: "ws://127.0.0.1:2867"
  });
});

test("resolveSmokeRuntimeTargets falls back to localhost defaults", () => {
  const targets = resolveSmokeRuntimeTargets({});

  assert.deepEqual(targets, {
    serverUrl: "http://127.0.0.1:2567",
    clientUrl: "http://127.0.0.1:4173",
    serverWsUrl: "ws://127.0.0.1:2567"
  });
});

test("createSmokeGuestAuthHeaders issues a real guest token for protected lobby probes", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const headers = await createSmokeGuestAuthHeaders(
    async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          session: {
            playerId: "guest-123456",
            displayName: "Smoke Runner",
            token: "guest-token-123"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    },
    {
      serverUrl: "http://127.0.0.1:2867",
      clientUrl: "http://127.0.0.1:4473",
      serverWsUrl: "ws://127.0.0.1:2867"
    }
  );

  assert.deepEqual(headers, { Authorization: "Bearer guest-token-123" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "http://127.0.0.1:2867/api/auth/guest-login");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.match(String(requests[0]?.init?.body), /"privacyConsentAccepted":true/);
});

test("createSmokeGuestAuthContext returns the issued player identity for room join", async () => {
  const context = await createSmokeGuestAuthContext(
    async () =>
      new Response(
        JSON.stringify({
          session: {
            playerId: "guest-123456",
            displayName: "Smoke Runner",
            token: "guest-token-456"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      ),
    {
      serverUrl: "http://127.0.0.1:2867",
      clientUrl: "http://127.0.0.1:4473",
      serverWsUrl: "ws://127.0.0.1:2867"
    }
  );

  assert.deepEqual(context, {
    headers: {
      Authorization: "Bearer guest-token-456"
    },
    token: "guest-token-456",
    playerId: "guest-123456",
    displayName: "Smoke Runner"
  });
});
