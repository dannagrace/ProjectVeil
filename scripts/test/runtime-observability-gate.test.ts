import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("runtime observability gate can reuse a captured evidence artifact", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-runtime-gate-"));
  const capturePath = path.join(workspace, "runtime-observability-evidence.json");
  fs.writeFileSync(
    capturePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: "2026-04-06T01:00:00.000Z",
        candidate: {
          name: "phase1-rc",
          revision: "abc1234",
          shortRevision: "abc1234",
          branch: "main",
          dirty: false,
          targetSurface: "wechat"
        },
        targetEnvironment: {
          label: "staging",
          serverUrl: "https://veil-staging.example.com"
        },
        summary: {
          status: "passed",
          headline: "Runtime observability evidence captured cleanly for the target environment.",
          endpointStatuses: {
            "runtime-health": "passed",
            "auth-readiness": "passed",
            "runtime-metrics": "passed"
          }
        },
        readiness: {
          activeRoomCount: 4,
          connectionCount: 12,
          activeBattleCount: 2,
          heroCount: 7,
          actionMessagesTotal: 180,
          worldActionsTotal: 150,
          battleActionsTotal: 30,
          activeGuestSessionCount: 5,
          activeAccountSessionCount: 7,
          activeAccountLockCount: 0,
          pendingRegistrationCount: 0,
          pendingRecoveryCount: 0,
          tokenDeliveryQueueCount: 0,
          tokenDeliveryDeadLetterCount: 0,
          wechatLoginMode: "production",
          wechatCredentialsStatus: "configured",
          authHeadline: "Auth readiness is healthy."
        },
        endpoints: [
          {
            id: "runtime-health",
            label: "Runtime health",
            url: "https://veil-staging.example.com/api/runtime/health",
            status: "passed",
            httpStatus: 200,
            summary: "Runtime health responded with an OK payload.",
            observedAt: "2026-04-06T01:00:00.000Z",
            freshness: "fresh",
            details: ["service=project-veil-runtime"],
            keyReadinessFields: {
              activeRoomCount: 4
            },
            capture: {
              kind: "json",
              body: {
                status: "ok"
              }
            }
          },
          {
            id: "auth-readiness",
            label: "Auth readiness",
            url: "https://veil-staging.example.com/api/runtime/auth-readiness",
            status: "passed",
            httpStatus: 200,
            summary: "Auth readiness is healthy.",
            observedAt: "2026-04-06T01:00:00.000Z",
            freshness: "fresh",
            details: ["status=ok"],
            keyReadinessFields: {
              activeAccountSessionCount: 7
            },
            capture: {
              kind: "json",
              body: {
                status: "ok"
              }
            }
          },
          {
            id: "runtime-metrics",
            label: "Runtime metrics",
            url: "https://veil-staging.example.com/api/runtime/metrics",
            status: "passed",
            httpStatus: 200,
            summary: "Runtime metrics exposed the required Prometheus counters.",
            observedAt: "2026-04-06T01:00:00.000Z",
            freshness: "fresh",
            details: ["Required Prometheus metrics are present."],
            keyReadinessFields: {
              veil_active_room_count: true
            },
            capture: {
              kind: "text",
              body: "veil_active_room_count 4"
            }
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const report = await buildRuntimeObservabilityGateReport({
    candidate: "phase1-rc",
    candidateRevision: "abc1234",
    targetSurface: "wechat",
    targetEnvironment: "staging",
    captureReportPath: capturePath,
    maxSampleAgeMinutes: 30
  });

  assert.equal(report.summary.status, "passed");
  assert.equal(report.evidenceSource?.artifactPath, path.relative(process.cwd(), capturePath).replace(/\\/g, "/"));
  assert.equal(report.endpoints.length, 3);
  assert.ok(report.endpoints.every((endpoint) => !("capture" in endpoint)));
});
