import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeObservabilityEvidenceReport, renderMarkdown } from "../runtime-observability-evidence.ts";

type MockResponseInit = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  jsonBody?: unknown;
  textBody?: string;
};

function createMockResponse(init: MockResponseInit): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: async () => init.jsonBody,
    text: async () => init.textBody ?? ""
  } as Response;
}

function installFetchMock(entries: Record<string, MockResponseInit | Error>): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const entry = entries[url];
    if (!entry) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    if (entry instanceof Error) {
      throw entry;
    }
    return createMockResponse(entry);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("runtime observability evidence captures raw endpoint payloads and renders reviewer markdown", async () => {
  const now = new Date().toISOString();
  const restoreFetch = installFetchMock({
    "https://veil-staging.example.com/api/runtime/health": {
      jsonBody: {
        status: "ok",
        checkedAt: now,
        service: "project-veil-runtime",
        runtime: {
          activeRoomCount: 4,
          connectionCount: 12,
          activeBattleCount: 2,
          heroCount: 7,
          gameplayTraffic: {
            worldActionsTotal: 150,
            battleActionsTotal: 30,
            actionMessagesTotal: 180
          },
          auth: {
            activeGuestSessionCount: 5,
            activeAccountSessionCount: 7,
            activeAccountLockCount: 0,
            pendingRegistrationCount: 0,
            pendingRecoveryCount: 0,
            tokenDelivery: {
              queueCount: 0,
              deadLetterCount: 0
            }
          }
        }
      }
    },
    "https://veil-staging.example.com/api/runtime/auth-readiness": {
      jsonBody: {
        status: "ok",
        checkedAt: now,
        headline: "Auth readiness is healthy.",
        alerts: [],
        auth: {
          activeGuestSessionCount: 5,
          activeAccountSessionCount: 7,
          activeAccountLockCount: 0,
          pendingRegistrationCount: 0,
          pendingRecoveryCount: 0,
          tokenDelivery: {
            queueCount: 0,
            deadLetterCount: 0
          },
          wechatLogin: {
            mode: "production",
            credentialsStatus: "configured",
            route: "/api/auth/wechat-login"
          }
        }
      }
    },
    "https://veil-staging.example.com/api/runtime/metrics": {
      textBody: `
veil_active_room_count 4
veil_connection_count 12
veil_gameplay_action_messages_total 180
veil_auth_account_sessions 7
veil_auth_token_delivery_queue_count 0
`
    }
  });

  try {
    const report = await buildRuntimeObservabilityEvidenceReport({
      candidate: "phase1-rc",
      candidateRevision: "abc1234",
      targetSurface: "wechat",
      targetEnvironment: "staging",
      serverUrl: "https://veil-staging.example.com",
      maxSampleAgeMinutes: 30
    });

    assert.equal(report.summary.status, "passed");
    assert.equal(report.endpoints[0]?.capture.kind, "json");
    assert.deepEqual((report.endpoints[0]?.capture.body as { runtime?: { activeRoomCount?: number } }).runtime?.activeRoomCount, 4);
    assert.equal(report.endpoints[2]?.capture.kind, "text");
    assert.match(String(report.endpoints[2]?.capture.body), /veil_active_room_count 4/);

    const markdown = renderMarkdown(report);
    assert.match(markdown, /# Runtime Observability Evidence/);
    assert.match(markdown, /```json/);
    assert.match(markdown, /```text/);
    assert.match(markdown, /Auth readiness is healthy\./);
  } finally {
    restoreFetch();
  }
});
