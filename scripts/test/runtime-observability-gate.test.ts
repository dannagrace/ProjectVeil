import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeObservabilityGateReport, renderMarkdown } from "../runtime-observability-gate.ts";

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

test("runtime observability gate builds a passing report for a healthy target environment", async () => {
  const restoreFetch = installFetchMock({
    "https://veil-staging.example.com/api/runtime/health": {
      jsonBody: {
        status: "ok",
        checkedAt: new Date().toISOString(),
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
        checkedAt: new Date().toISOString(),
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
    const report = await buildRuntimeObservabilityGateReport({
      candidate: "phase1-rc",
      candidateRevision: "abc1234",
      targetSurface: "wechat",
      targetEnvironment: "staging",
      serverUrl: "https://veil-staging.example.com",
      maxSampleAgeMinutes: 30
    });

    assert.equal(report.summary.status, "passed");
    assert.equal(report.targetEnvironment.label, "staging");
    assert.equal(report.targetEnvironment.serverUrl, "https://veil-staging.example.com");
    assert.equal(report.summary.endpointStatuses["runtime-health"], "passed");
    assert.equal(report.summary.endpointStatuses["auth-readiness"], "passed");
    assert.equal(report.summary.endpointStatuses["runtime-metrics"], "passed");
    assert.equal(report.readiness.activeRoomCount, 4);
    assert.equal(report.readiness.connectionCount, 12);
    assert.equal(report.readiness.actionMessagesTotal, 180);
    assert.equal(report.readiness.activeAccountSessionCount, 7);
    assert.deepEqual(
      report.endpoints.map((endpoint) => endpoint.id),
      ["runtime-health", "auth-readiness", "runtime-metrics"]
    );

    const markdown = renderMarkdown(report);
    assert.match(markdown, /# Runtime Observability Gate/);
    assert.match(markdown, /Target environment: `staging`/);
    assert.match(markdown, /Gameplay actions: 180/);
  } finally {
    restoreFetch();
  }
});

test("runtime observability gate fails when auth readiness warns", async () => {
  const restoreFetch = installFetchMock({
    "https://veil-staging.example.com/api/runtime/health": {
      jsonBody: {
        status: "ok",
        checkedAt: new Date().toISOString(),
        runtime: {
          activeRoomCount: 4,
          connectionCount: 12,
          gameplayTraffic: {
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
        status: "warn",
        checkedAt: new Date().toISOString(),
        headline: "Auth readiness needs operator attention.",
        alerts: ["2 token deliveries waiting for retry"],
        auth: {
          activeGuestSessionCount: 5,
          activeAccountSessionCount: 7,
          activeAccountLockCount: 0,
          pendingRegistrationCount: 0,
          pendingRecoveryCount: 0,
          tokenDelivery: {
            queueCount: 2,
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
veil_auth_token_delivery_queue_count 2
`
    }
  });

  try {
    const report = await buildRuntimeObservabilityGateReport({
      candidate: "phase1-rc",
      candidateRevision: "abc1234",
      targetSurface: "wechat",
      serverUrl: "https://veil-staging.example.com",
      maxSampleAgeMinutes: 30
    });

    assert.equal(report.summary.status, "failed");
    assert.equal(report.summary.endpointStatuses["auth-readiness"], "warn");
    assert.match(report.summary.headline, /Auth readiness/);
  } finally {
    restoreFetch();
  }
});
