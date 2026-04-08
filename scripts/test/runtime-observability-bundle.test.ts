import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRuntimeObservabilityBundleReport, renderMarkdown } from "../runtime-observability-bundle.ts";

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

test("runtime observability bundle writes normalized verdicts and optional room lifecycle evidence", async () => {
  const now = new Date().toISOString();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-runtime-observability-bundle-"));
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
    },
    "https://veil-staging.example.com/api/runtime/room-lifecycle-summary": {
      jsonBody: {
        status: "ok",
        checkedAt: now,
        headline: "Room lifecycle is stable.",
        alerts: [],
        summary: {
          activeRoomCount: 4,
          pendingReconnectCount: 0,
          counters: {
            roomCreatesTotal: 10,
            roomDisposalsTotal: 6,
            battleCompletionsTotal: 5,
            battleAbortsTotal: 0
          },
          recentEvents: [
            {
              timestamp: now,
              kind: "battle.completed",
              roomId: "room-1"
            }
          ]
        }
      }
    }
  });

  try {
    const report = await buildRuntimeObservabilityBundleReport({
      candidate: "phase1-rc",
      candidateRevision: "abc1234",
      targetSurface: "wechat",
      targetEnvironment: "staging",
      serverUrl: "https://veil-staging.example.com",
      outputDir: workspace,
      includeRoomLifecycle: true,
      maxSampleAgeMinutes: 30
    });

    assert.equal(report.summary.status, "passed");
    assert.equal(report.summary.evidenceStatus, "passed");
    assert.equal(report.summary.gateStatus, "passed");
    assert.equal(report.summary.roomLifecycleStatus, "captured");
    assert.match(report.artifacts.evidence.path, /runtime-observability-evidence-/);
    assert.match(report.artifacts.gate.path, /runtime-observability-gate-/);
    assert.equal(report.roomLifecycle.keyReadinessFields.recentEventCount, 1);
    assert.ok(fs.existsSync(path.join(workspace, path.basename(report.artifacts.evidence.path))));
    assert.ok(fs.existsSync(path.join(workspace, path.basename(report.artifacts.gate.path))));

    const markdown = renderMarkdown(report);
    assert.match(markdown, /# Runtime Observability Bundle/);
    assert.match(markdown, /Room lifecycle: `captured`/);
    assert.match(markdown, /Target environment: `staging`/);
  } finally {
    restoreFetch();
  }
});
