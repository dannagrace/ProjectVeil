import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPhase1CandidateDossier, renderMarkdown } from "../phase1-candidate-dossier.ts";

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-phase1-dossier-"));
}

function startRuntimeServer() {
  const server = http.createServer((request, response) => {
    if (request.url === "/api/runtime/health") {
      response.writeHead(200, { "content-type": "application/json", connection: "close" });
      response.end(
        JSON.stringify({
          status: "ok",
          checkedAt: "2026-04-02T08:45:00.000Z",
          runtime: {
            activeRoomCount: 3,
            connectionCount: 11,
            gameplayTraffic: {
              actionMessagesTotal: 182
            }
          }
        })
      );
      return;
    }
    if (request.url === "/api/runtime/auth-readiness") {
      response.writeHead(200, { "content-type": "application/json", connection: "close" });
      response.end(
        JSON.stringify({
          status: "ok",
          checkedAt: "2026-04-02T08:45:05.000Z",
          headline: "Auth readiness is healthy.",
          alerts: [],
          auth: {
            activeAccountLockCount: 0,
            pendingRegistrationCount: 0,
            pendingRecoveryCount: 0,
            tokenDelivery: {
              queueCount: 0,
              deadLetterCount: 0
            }
          }
        })
      );
      return;
    }
    if (request.url === "/api/runtime/metrics") {
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4", connection: "close" });
      response.end(`
# HELP veil_active_room_count Active rooms
veil_active_room_count 3
veil_connection_count 11
veil_gameplay_action_messages_total 182
veil_auth_account_sessions 7
veil_auth_token_delivery_queue_count 0
`);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });

  return new Promise<{ server: http.Server; url: string }>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve runtime server address."));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

test("phase1 candidate dossier aggregates Phase 1 evidence into one accepted-risk dossier", async () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const wechatDir = path.join(workspace, "artifacts", "wechat-release");
  const revision = "abc1234";

  const snapshotPath = path.join(artifactsDir, "release-readiness-pass.json");
  const h5SmokePath = path.join(artifactsDir, "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(artifactsDir, "colyseus-reconnect-soak-summary-pass.json");
  const cocosBundlePath = path.join(artifactsDir, "cocos-rc-evidence-bundle-pass.json");
  const persistencePath = path.join(artifactsDir, `phase1-release-persistence-regression-${revision}.json`);
  const syncGovernancePath = path.join(artifactsDir, "sync-governance-matrix-pass.json");
  const ciTrendSummaryPath = path.join(artifactsDir, "ci-trend-summary.json");
  const coverageSummaryPath = path.join(workspace, ".coverage", "summary.json");
  const configCenterLibraryPath = path.join(workspace, "configs", ".config-center-library.json");
  const wechatCandidateSummaryPath = path.join(wechatDir, "codex.wechat.release-candidate-summary.json");
  writeJson(snapshotPath, {
    generatedAt: "2026-04-02T08:30:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    },
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    },
    checks: [
      {
        id: "npm-test",
        title: "Unit and integration regression",
        required: true,
        status: "passed",
        waiver: {
          approvedBy: "release-manager",
          approvedAt: "2026-04-02T08:20:00.000Z",
          reason: "Documented flaky shard accepted for this RC only."
        }
      },
      {
        id: "typecheck-ci",
        required: true,
        status: "passed"
      }
    ]
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-02T08:32:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    },
    execution: {
      status: "passed",
      exitCode: 0
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0
    }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-04-02T08:33:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 256,
      invariantChecks: 1024
    },
    results: [
      {
        scenario: "reconnect_soak",
        failedRooms: 0,
        runtimeHealthAfterCleanup: {
          activeRoomCount: 0,
          connectionCount: 0,
          activeBattleCount: 0,
          heroCount: 0
        }
      }
    ]
  });
  writeJson(cocosBundlePath, {
    bundle: {
      generatedAt: "2026-04-02T08:34:00.000Z",
      candidate: "phase1-rc",
      commit: revision,
      shortCommit: revision,
      overallStatus: "passed",
      summary: "Cocos RC evidence is complete."
    },
    artifacts: {
      snapshot: path.join(artifactsDir, "cocos-rc-snapshot-phase1-rc.json"),
      summaryMarkdown: path.join(artifactsDir, "cocos-rc-evidence-bundle-phase1-rc.md"),
      checklistMarkdown: path.join(artifactsDir, "cocos-rc-checklist-phase1-rc.md"),
      blockersMarkdown: path.join(artifactsDir, "cocos-rc-blockers-phase1-rc.md")
    },
    review: {
      phase1Gate: "passed",
      attachHint: "Attach the checklist/blocker markdown in the release PR."
    },
    journey: [
      {
        id: "lobby-entry",
        title: "Lobby entry",
        status: "passed"
      }
    ],
    requiredEvidence: [
      {
        id: "roomId",
        label: "Room id recorded",
        filled: true
      }
    ]
  });
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: "2026-04-02T08:40:00.000Z",
    candidate: {
      revision,
      version: "1.2.3",
      status: "ready"
    },
    evidence: {
      package: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatDir, "veil.package.json")
      },
      validation: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatDir, "codex.wechat.rc-validation-report.json")
      },
      smoke: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatDir, "codex.wechat.smoke-report.json")
      },
      upload: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatDir, "veil.upload.json")
      },
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "wechat-runtime-review",
            title: "Runtime health/auth-readiness/metrics reviewed for this candidate",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: "2026-04-02T08:39:00.000Z",
            revision,
            artifactPath: path.join(wechatDir, "runtime-review.json")
          }
        ]
      }
    },
    blockers: []
  });
  writeJson(persistencePath, {
    generatedAt: "2026-04-02T08:41:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    },
    summary: {
      status: "passed",
      assertionCount: 6
    },
    contentValidation: {
      valid: true,
      bundleCount: 5,
      summary: "All shipped content packs validated.",
      issueCount: 0
    },
    persistenceRegression: {
      mapPackId: "phase1",
      assertions: ["room hydration reapplied resources"]
    }
  });
  writeJson(syncGovernancePath, {
    generatedAt: "2026-04-02T08:42:00.000Z",
    execution: {
      status: "passed"
    },
    summary: {
      passed: 3,
      failed: 0,
      skipped: 0
    },
    scenarios: [
      {
        id: "room-push-redaction",
        status: "passed"
      }
    ]
  });
  writeJson(ciTrendSummaryPath, {
    generatedAt: "2026-04-02T08:43:00.000Z",
    summary: {
      overallStatus: "passed",
      totalFindings: 0,
      newFindings: 0,
      ongoingFindings: 0,
      recoveredFindings: 0
    },
    runtime: { findings: [] },
    releaseGate: { findings: [] }
  });
  writeJson(coverageSummaryPath, [
    {
      scope: "shared",
      lineThreshold: 90,
      branchThreshold: 70,
      functionThreshold: 90,
      metrics: {
        lines: 95,
        branches: 80,
        functions: 96
      },
      failures: []
    }
  ]);
  writeJson(configCenterLibraryPath, {
    publishAuditHistory: []
  });

  const runtime = await startRuntimeServer();
  try {
    const dossier = await buildPhase1CandidateDossier({
      candidate: "phase1-rc",
      candidateRevision: revision,
      serverUrl: runtime.url,
      snapshotPath,
      h5SmokePath,
      reconnectSoakPath,
      cocosBundlePath,
      wechatCandidateSummaryPath,
      persistencePath,
      syncGovernancePath,
      ciTrendSummaryPath,
      coverageSummaryPath,
      configCenterLibraryPath,
      targetSurface: "wechat",
      maxEvidenceAgeHours: 72
    });

    assert.equal(dossier.candidate.name, "phase1-rc");
    assert.equal(dossier.candidate.revision, revision);
    assert.equal(dossier.candidate.targetSurface, "wechat");
    assert.equal(dossier.summary.status, "accepted_risk");
    assert.deepEqual(dossier.summary.requiredFailed, []);
    assert.deepEqual(dossier.summary.requiredPending, []);
    assert.equal(dossier.summary.acceptedRiskCount, 1);
    assert.equal(dossier.phase1ExitEvidenceGate.result, "accepted_risk");
    assert.equal(dossier.phase1ExitEvidenceGate.acceptedRiskSections[0], "Release readiness snapshot");
    assert.equal(dossier.sections.find((section) => section.id === "release-gate")?.result, "passed");
    assert.equal(dossier.sections.find((section) => section.id === "phase1-exit-evidence-gate")?.result, "accepted_risk");
    assert.equal(dossier.sections.find((section) => section.id === "runtime-health")?.result, "passed");
    assert.equal(dossier.sections.find((section) => section.id === "reconnect-soak")?.result, "passed");
    assert.equal(dossier.sections.find((section) => section.id === "phase1-persistence")?.result, "passed");
    assert.equal(dossier.acceptedRisks[0]?.label, "Unit and integration regression");
    assert.match(dossier.acceptedRisks[0]?.reason ?? "", /accepted for this RC only/i);

    const markdown = renderMarkdown(dossier);
    assert.match(markdown, /# Phase 1 Candidate Dossier/);
    assert.match(markdown, /Overall status: \*\*ACCEPTED_RISK\*\*/);
    assert.match(markdown, /## Phase 1 Exit Evidence Gate/);
    assert.match(markdown, /Phase 1 exit evidence gate: `accepted_risk`/);
    assert.match(markdown, /Release readiness snapshot/);
    assert.match(markdown, /Runtime health\/auth-readiness\/metrics/);
    assert.match(markdown, /Reconnect soak evidence/);
    assert.match(markdown, /Accepted Risks/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      runtime.server.closeAllConnections?.();
      runtime.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("phase1 candidate dossier fails the single exit evidence gate when the release gate summary is blocking", async () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const wechatDir = path.join(workspace, "artifacts", "wechat-release");
  const revision = "abc1234";

  const snapshotPath = path.join(artifactsDir, "release-readiness-pass.json");
  const h5SmokePath = path.join(artifactsDir, "client-release-candidate-smoke-pass.json");
  const cocosBundlePath = path.join(artifactsDir, "cocos-rc-evidence-bundle-pass.json");
  const reconnectSoakPath = path.join(artifactsDir, "colyseus-reconnect-soak-summary-pass.json");
  const persistencePath = path.join(artifactsDir, `phase1-release-persistence-regression-${revision}.json`);
  const wechatCandidateSummaryPath = path.join(wechatDir, "codex.wechat.release-candidate-summary.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-04-02T08:30:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-02T08:32:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    execution: { status: "passed", exitCode: 0 },
    summary: { total: 2, passed: 2, failed: 0 }
  });
  writeJson(cocosBundlePath, {
    bundle: {
      generatedAt: "2026-04-02T08:34:00.000Z",
      candidate: "phase1-rc",
      commit: revision,
      shortCommit: revision,
      overallStatus: "passed",
      summary: "Cocos RC evidence is complete."
    },
    review: { phase1Gate: "passed" },
    journey: [{ id: "lobby-entry", status: "passed" }],
    requiredEvidence: [{ id: "roomId", label: "Room id recorded", filled: true }]
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-04-02T08:33:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    status: "failed",
    summary: { failedScenarios: 1, scenarioNames: ["reconnect_soak"] },
    soakSummary: { reconnectAttempts: 12, invariantChecks: 48 },
    results: [
      {
        scenario: "reconnect_soak",
        failedRooms: 1,
        runtimeHealthAfterCleanup: {
          activeRoomCount: 1,
          connectionCount: 1,
          activeBattleCount: 0,
          heroCount: 0
        }
      }
    ]
  });
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: "2026-04-02T08:40:00.000Z",
    candidate: { revision, status: "ready" },
    evidence: {
      smoke: { status: "passed", artifactPath: path.join(wechatDir, "codex.wechat.smoke-report.json") },
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "wechat-runtime-review",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: "2026-04-02T08:39:00.000Z",
            revision,
            artifactPath: path.join(wechatDir, "runtime-review.json")
          }
        ]
      }
    },
    blockers: []
  });
  writeJson(persistencePath, {
    generatedAt: "2026-04-02T08:41:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    summary: { status: "passed", assertionCount: 6 },
    contentValidation: { valid: true, bundleCount: 5, summary: "All shipped content packs validated.", issueCount: 0 },
    persistenceRegression: { mapPackId: "phase1", assertions: ["room hydration reapplied resources"] }
  });

  const runtime = await startRuntimeServer();
  try {
    const dossier = await buildPhase1CandidateDossier({
      candidate: "phase1-rc",
      candidateRevision: revision,
      serverUrl: runtime.url,
      snapshotPath,
      h5SmokePath,
      reconnectSoakPath,
      cocosBundlePath,
      wechatCandidateSummaryPath,
      persistencePath,
      targetSurface: "wechat",
      maxEvidenceAgeHours: 72
    });

    assert.equal(dossier.sections.find((section) => section.id === "release-gate")?.result, "failed");
    assert.equal(dossier.sections.find((section) => section.id === "reconnect-soak")?.result, "failed");
    assert.equal(dossier.phase1ExitEvidenceGate.result, "failed");
    assert.equal(dossier.summary.status, "failed");
    assert.match(dossier.phase1ExitEvidenceGate.summary, /blocked/i);
    assert.equal(dossier.phase1ExitEvidenceGate.blockingSections.includes("Release gate summary"), true);
  } finally {
    await new Promise<void>((resolve, reject) => {
      runtime.server.closeAllConnections?.();
      runtime.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
