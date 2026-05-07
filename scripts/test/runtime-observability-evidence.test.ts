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

type FetchCall = {
  url: string;
  init?: RequestInit;
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

function installFetchMock(entries: Record<string, MockResponseInit | Error>, calls: FetchCall[] = []): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
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

function getRequestHeader(call: FetchCall | undefined, name: string): string | undefined {
  const headers = call?.init?.headers;
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  }
  return headers[name] ?? headers[name.toLowerCase()];
}

test("runtime observability evidence captures raw endpoint payloads and renders reviewer markdown", async () => {
  const now = new Date().toISOString();
  const calls: FetchCall[] = [];
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
  }, calls);

  try {
    const report = await buildRuntimeObservabilityEvidenceReport({
      candidate: "phase1-rc",
      candidateRevision: "abc1234",
      targetSurface: "wechat",
      targetEnvironment: "staging",
      serverUrl: "https://veil-staging.example.com",
      adminToken: "release-admin-token",
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

    assert.equal(getRequestHeader(calls.find((call) => call.url.endsWith("/api/runtime/health")), "x-veil-admin-token"), undefined);
    assert.equal(
      getRequestHeader(calls.find((call) => call.url.endsWith("/api/runtime/auth-readiness")), "x-veil-admin-token"),
      "release-admin-token"
    );
    assert.equal(
      getRequestHeader(calls.find((call) => call.url.endsWith("/api/runtime/metrics")), "x-veil-admin-token"),
      "release-admin-token"
    );
  } finally {
    restoreFetch();
  }
});

test("runtime observability evidence accepts local-dev degraded in-memory health payloads", async () => {
  const now = new Date().toISOString();
  const restoreFetch = installFetchMock({
    "http://127.0.0.1:2627/api/runtime/health": {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      jsonBody: {
        status: "warn",
        checkedAt: now,
        service: "project-veil-server",
        runtime: {
          persistence: {
            status: "degraded",
            storage: "memory",
            message: "In-memory room persistence active; room data will not survive process restarts."
          },
          activeRoomCount: 0,
          connectionCount: 0,
          activeBattleCount: 0,
          heroCount: 0,
          gameplayTraffic: {
            worldActionsTotal: 1,
            battleActionsTotal: 2,
            actionMessagesTotal: 3
          },
          auth: {
            activeGuestSessionCount: 1,
            activeAccountSessionCount: 2,
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
    "http://127.0.0.1:2627/api/runtime/auth-readiness": {
      jsonBody: {
        status: "ok",
        checkedAt: now,
        headline: "Auth readiness is healthy.",
        alerts: [],
        auth: {
          activeGuestSessionCount: 1,
          activeAccountSessionCount: 2,
          activeAccountLockCount: 0,
          pendingRegistrationCount: 0,
          pendingRecoveryCount: 0,
          tokenDelivery: {
            queueCount: 0,
            deadLetterCount: 0
          },
          wechatLogin: {
            mode: "disabled",
            credentialsStatus: "not_required",
            route: "/api/auth/wechat-login"
          }
        }
      }
    },
    "http://127.0.0.1:2627/api/runtime/metrics": {
      textBody: `
veil_active_room_count 0
veil_connection_count 0
veil_gameplay_action_messages_total 3
veil_auth_account_sessions 2
veil_auth_token_delivery_queue_count 0
`
    }
  });

  try {
    const report = await buildRuntimeObservabilityEvidenceReport({
      candidate: "local-dev-smoke",
      candidateRevision: "abc1234",
      targetSurface: "h5",
      targetEnvironment: "local-dev",
      serverUrl: "http://127.0.0.1:2627",
      adminToken: "dev-admin-token",
      maxSampleAgeMinutes: 30
    });

    const health = report.endpoints.find((endpoint) => endpoint.id === "runtime-health");
    assert.equal(report.summary.status, "passed");
    assert.equal(health?.status, "passed");
    assert.equal(health?.httpStatus, 503);
    assert.equal(report.readiness.activeRoomCount, 0);
    assert.equal(report.readiness.actionMessagesTotal, 3);
    assert.match(health?.details.join("\n") ?? "", /degraded in-memory runtime health accepted/);
  } finally {
    restoreFetch();
  }
});
