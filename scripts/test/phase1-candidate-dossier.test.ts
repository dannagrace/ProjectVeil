import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

function writeRuntimeGateArtifact(
  artifactsDir: string,
  revision: string,
  overrides?: {
    status?: "passed" | "failed";
    headline?: string;
    endpointStatuses?: Partial<Record<"runtime-health" | "auth-readiness" | "runtime-metrics", "passed" | "warn" | "failed">>;
  }
): string {
  const runtimeGatePath = path.join(artifactsDir, `runtime-observability-gate-${revision}.json`);
  writeJson(runtimeGatePath, {
    schemaVersion: 1,
    generatedAt: "2026-04-05T08:45:05.000Z",
    candidate: {
      name: "phase1-rc",
      revision,
      shortRevision: revision,
      branch: "main",
      dirty: false,
      targetSurface: "wechat"
    },
    targetEnvironment: {
      label: "staging",
      serverUrl: "https://veil-staging.example.com"
    },
    summary: {
      status: overrides?.status ?? "passed",
      headline: overrides?.headline ?? "Runtime health, auth readiness, and metrics passed for the target environment.",
      endpointStatuses: {
        "runtime-health": overrides?.endpointStatuses?.["runtime-health"] ?? "passed",
        "auth-readiness": overrides?.endpointStatuses?.["auth-readiness"] ?? "passed",
        "runtime-metrics": overrides?.endpointStatuses?.["runtime-metrics"] ?? "passed"
      }
    },
    readiness: {
      activeRoomCount: 3,
      connectionCount: 11,
      activeBattleCount: 1,
      heroCount: 5,
      actionMessagesTotal: 182,
      worldActionsTotal: 140,
      battleActionsTotal: 42,
      activeGuestSessionCount: 4,
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
        status: overrides?.endpointStatuses?.["runtime-health"] ?? "passed",
        httpStatus: 200,
        summary: "Runtime health responded with an OK payload.",
        observedAt: "2026-04-05T08:45:00.000Z",
        freshness: "fresh",
        details: ["activeRooms=3", "connections=11", "actions=182"],
        keyReadinessFields: {
          activeRoomCount: 3,
          connectionCount: 11,
          actionMessagesTotal: 182
        }
      },
      {
        id: "auth-readiness",
        label: "Auth readiness",
        url: "https://veil-staging.example.com/api/runtime/auth-readiness",
        status: overrides?.endpointStatuses?.["auth-readiness"] ?? "passed",
        httpStatus: 200,
        summary: overrides?.headline ?? "Auth readiness is healthy.",
        observedAt: "2026-04-05T08:45:05.000Z",
        freshness: "fresh",
        details: ["lockouts=0", "pendingRegistrations=0", "pendingRecoveries=0"],
        keyReadinessFields: {
          activeAccountLockCount: 0,
          pendingRegistrationCount: 0,
          pendingRecoveryCount: 0
        }
      },
      {
        id: "runtime-metrics",
        label: "Runtime metrics",
        url: "https://veil-staging.example.com/api/runtime/metrics",
        status: overrides?.endpointStatuses?.["runtime-metrics"] ?? "passed",
        httpStatus: 200,
        summary: "Runtime metrics exposed the required Prometheus counters.",
        observedAt: "2026-04-05T08:45:05.000Z",
        freshness: "fresh",
        details: ["Required Prometheus metrics are present."],
        keyReadinessFields: {
          veil_active_room_count: true,
          veil_connection_count: true,
          veil_gameplay_action_messages_total: true,
          veil_auth_account_sessions: true,
          veil_auth_token_delivery_queue_count: true
        }
      }
    ]
  });
  return runtimeGatePath;
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
  const runtimeObservabilityGatePath = writeRuntimeGateArtifact(artifactsDir, revision);
  const syncGovernancePath = path.join(artifactsDir, "sync-governance-matrix-pass.json");
  const ciTrendSummaryPath = path.join(artifactsDir, "ci-trend-summary.json");
  const coverageSummaryPath = path.join(workspace, ".coverage", "summary.json");
  const configCenterLibraryPath = path.join(workspace, "configs", ".config-center-library.json");
  const wechatCandidateSummaryPath = path.join(wechatDir, "codex.wechat.release-candidate-summary.json");
  writeJson(snapshotPath, {
    generatedAt: "2026-04-05T08:30:00.000Z",
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
          approvedAt: "2026-04-05T08:20:00.000Z",
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
    generatedAt: "2026-04-05T08:32:00.000Z",
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
    generatedAt: "2026-04-05T08:33:00.000Z",
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
      generatedAt: "2026-04-05T08:34:00.000Z",
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
    generatedAt: "2026-04-05T08:40:00.000Z",
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
            id: "wechat-devtools-export-review",
            title: "Real WeChat export imported and launched in Developer Tools",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: "2026-04-05T08:39:00.000Z",
            revision,
            artifactPath: path.join(wechatDir, "devtools-export-review.json")
          },
          {
            id: "wechat-device-runtime-review",
            title: "Physical-device WeChat runtime validated for this candidate",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: "2026-04-05T08:40:00.000Z",
            revision,
            artifactPath: path.join(wechatDir, "device-runtime-review.json")
          }
        ]
      }
    },
    blockers: []
  });
  writeJson(persistencePath, {
    generatedAt: "2026-04-05T08:41:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    },
    requestedStorageMode: "mysql",
    effectiveStorageMode: "mysql",
    storageDescription: "MySQL snapshot store backed by VEIL_MYSQL_*.",
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
    generatedAt: "2026-04-05T08:42:00.000Z",
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
    generatedAt: "2026-04-05T08:43:00.000Z",
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

  const dossier = await buildPhase1CandidateDossier({
    candidate: "phase1-rc",
    candidateRevision: revision,
    runtimeObservabilityGatePath,
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
  assert.match(
    dossier.sections.find((section) => section.id === "phase1-persistence")?.summary ?? "",
    /verified storage mode mysql/i
  );
  assert.deepEqual(
    dossier.sections.find((section) => section.id === "phase1-persistence")?.details.includes("verifiedStorage=mysql"),
    true
  );
  assert.equal(dossier.acceptedRisks[0]?.label, "Unit and integration regression");
  assert.match(dossier.acceptedRisks[0]?.reason ?? "", /accepted for this RC only/i);

  const markdown = renderMarkdown(dossier);
  assert.match(markdown, /# Phase 1 Candidate Dossier/);
  assert.match(markdown, /Generated at:/);
  assert.match(markdown, /Branch: `[^`]+`/);
  assert.match(markdown, /Git tree: `(clean|dirty)`/);
  assert.match(markdown, /## Selected Inputs/);
  assert.match(markdown, /Runtime observability gate: `.*runtime-observability-gate-abc1234\.json`/);
  assert.match(markdown, /Release readiness snapshot: `.*release-readiness-pass\.json`/);
  assert.match(markdown, /Cocos RC bundle: `.*cocos-rc-evidence-bundle-pass\.json`/);
  assert.match(markdown, /WeChat candidate summary: `.*codex\.wechat\.release-candidate-summary\.json`/);
  assert.match(markdown, /Phase 1 persistence: `.*phase1-release-persistence-regression-abc1234\.json`/);
  assert.match(markdown, /Overall status: \*\*ACCEPTED_RISK\*\*/);
  assert.match(markdown, /verifiedStorage=mysql/);
  assert.match(markdown, /storage=mysql assertions=6 contentValid=true/);
  assert.match(markdown, /## Phase 1 Exit Evidence Gate/);
  assert.match(markdown, /Phase 1 exit evidence gate: `accepted_risk`/);
  assert.match(markdown, /Release readiness snapshot/);
  assert.match(markdown, /Runtime health\/auth-readiness\/metrics/);
  assert.match(markdown, /Reconnect soak evidence/);
  assert.match(markdown, /Accepted Risks/);
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
  const runtimeObservabilityGatePath = writeRuntimeGateArtifact(artifactsDir, revision, {
    status: "failed",
    headline: "Runtime observability gate failed for Auth readiness.",
    endpointStatuses: {
      "auth-readiness": "warn"
    }
  });

  writeJson(snapshotPath, {
    generatedAt: "2026-04-05T08:30:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-05T08:32:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    execution: { status: "passed", exitCode: 0 },
    summary: { total: 2, passed: 2, failed: 0 }
  });
  writeJson(cocosBundlePath, {
    bundle: {
      generatedAt: "2026-04-05T08:34:00.000Z",
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
    generatedAt: "2026-04-05T08:33:00.000Z",
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
    generatedAt: "2026-04-05T08:40:00.000Z",
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
            id: "wechat-devtools-export-review",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: "2026-04-05T08:39:00.000Z",
            revision,
            artifactPath: path.join(wechatDir, "devtools-export-review.json")
          },
          {
            id: "wechat-device-runtime-review",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: "2026-04-05T08:40:00.000Z",
            revision,
            artifactPath: path.join(wechatDir, "device-runtime-review.json")
          }
        ]
      }
    },
    blockers: []
  });
  writeJson(persistencePath, {
    generatedAt: "2026-04-05T08:41:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    requestedStorageMode: "memory",
    effectiveStorageMode: "memory",
    storageDescription: "In-memory snapshot store.",
    summary: { status: "passed", assertionCount: 6 },
    contentValidation: { valid: true, bundleCount: 5, summary: "All shipped content packs validated.", issueCount: 0 },
    persistenceRegression: { mapPackId: "phase1", assertions: ["room hydration reapplied resources"] }
  });

  const dossier = await buildPhase1CandidateDossier({
    candidate: "phase1-rc",
    candidateRevision: revision,
    runtimeObservabilityGatePath,
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
  assert.equal(dossier.sections.find((section) => section.id === "runtime-health")?.result, "failed");
  assert.equal(dossier.phase1ExitEvidenceGate.result, "failed");
  assert.equal(dossier.summary.status, "failed");
  assert.match(dossier.phase1ExitEvidenceGate.summary, /blocked/i);
  assert.equal(dossier.phase1ExitEvidenceGate.blockingSections.includes("Release gate summary"), true);
});

test("phase1 candidate dossier marks stale persistence evidence as pending and keeps the verified storage mode visible", async () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const revision = "abc1234";

  const snapshotPath = path.join(artifactsDir, "release-readiness-pass.json");
  const h5SmokePath = path.join(artifactsDir, "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(artifactsDir, "colyseus-reconnect-soak-summary-pass.json");
  const cocosBundlePath = path.join(artifactsDir, "cocos-rc-evidence-bundle-pass.json");
  const persistencePath = path.join(artifactsDir, `phase1-release-persistence-regression-${revision}.json`);
  const runtimeObservabilityGatePath = writeRuntimeGateArtifact(artifactsDir, revision);

  writeJson(snapshotPath, {
    generatedAt: "2026-04-05T08:30:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-05T08:32:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    execution: { status: "passed", exitCode: 0 },
    summary: { total: 2, passed: 2, failed: 0 }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-04-05T08:33:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    status: "passed",
    summary: { failedScenarios: 0, scenarioNames: ["reconnect_soak"] },
    soakSummary: { reconnectAttempts: 64, invariantChecks: 256 },
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
      generatedAt: "2026-04-05T08:34:00.000Z",
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
  writeJson(persistencePath, {
    generatedAt: "2026-03-20T08:41:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    requestedStorageMode: "memory",
    effectiveStorageMode: "memory",
    storageDescription: "In-memory snapshot store.",
    summary: { status: "passed", assertionCount: 6 },
    contentValidation: { valid: true, bundleCount: 5, summary: "All shipped content packs validated.", issueCount: 0 },
    persistenceRegression: { mapPackId: "phase1", assertions: ["room hydration reapplied resources"] }
  });

  const dossier = await buildPhase1CandidateDossier({
    candidate: "phase1-rc",
    candidateRevision: revision,
    runtimeObservabilityGatePath,
    snapshotPath,
    h5SmokePath,
    reconnectSoakPath,
    cocosBundlePath,
    persistencePath,
    targetSurface: "h5",
    maxEvidenceAgeHours: 72
  });

  assert.equal(dossier.sections.find((section) => section.id === "phase1-persistence")?.result, "pending");
  assert.match(
    dossier.sections.find((section) => section.id === "phase1-persistence")?.summary ?? "",
    /verified memory storage, but the artifact is stale/i
  );
  assert.deepEqual(
    dossier.sections.find((section) => section.id === "phase1-persistence")?.details.includes("verifiedStorage=memory"),
    true
  );
  assert.deepEqual(
    dossier.summary.requiredPending.includes("Phase 1 persistence/content-pack validation"),
    true
  );

  const markdown = renderMarkdown(dossier);
  assert.match(markdown, /Phase 1 persistence\/content-pack validation: `pending` required · freshness=stale · revision=abc1234/);
  assert.match(markdown, /verifiedStorage=memory/);
  assert.match(markdown, /persistence freshness=stale/);
});

test("phase1 candidate dossier blocks Phase 1 sign-off when required WeChat manual evidence is still pending", async () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const wechatDir = path.join(workspace, "artifacts", "wechat-release");
  const revision = "abc1234";

  const snapshotPath = path.join(artifactsDir, "release-readiness-pass.json");
  const h5SmokePath = path.join(artifactsDir, "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(artifactsDir, "colyseus-reconnect-soak-summary-pass.json");
  const cocosBundlePath = path.join(artifactsDir, "cocos-rc-evidence-bundle-pass.json");
  const persistencePath = path.join(artifactsDir, `phase1-release-persistence-regression-${revision}.json`);
  const runtimeObservabilityGatePath = writeRuntimeGateArtifact(artifactsDir, revision);
  const wechatCandidateSummaryPath = path.join(wechatDir, "codex.wechat.release-candidate-summary.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-04-05T08:30:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-05T08:32:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    execution: { status: "passed", exitCode: 0 },
    summary: { total: 2, passed: 2, failed: 0 }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-04-05T08:33:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    status: "passed",
    summary: { failedScenarios: 0, scenarioNames: ["reconnect_soak"] },
    soakSummary: { reconnectAttempts: 12, invariantChecks: 48 },
    results: [
      {
        scenario: "reconnect_soak",
        failedRooms: 0,
        runtimeHealthAfterCleanup: { activeRoomCount: 0, connectionCount: 0, activeBattleCount: 0, heroCount: 0 }
      }
    ]
  });
  writeJson(cocosBundlePath, {
    bundle: {
      generatedAt: "2026-04-05T08:34:00.000Z",
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
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: "2026-04-05T08:40:00.000Z",
    candidate: { revision, status: "blocked" },
    evidence: {
      package: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatDir, "codex.wechat.package.json")
      },
      validation: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatDir, "codex.wechat.rc-validation-report.json")
      },
      smoke: {
        status: "skipped",
        summary: "Smoke report not present.",
        artifactPath: path.join(wechatDir, "codex.wechat.smoke-report.json")
      },
      manualReview: {
        status: "blocked",
        requiredPendingChecks: 1,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "wechat-devtools-export-review",
            title: "Real WeChat export imported and launched in Developer Tools",
            required: true,
            status: "pending",
            notes: "Import the packaged candidate into WeChat Developer Tools.",
            artifactPath: path.join(wechatDir, "devtools-export-review.json")
          }
        ]
      }
    },
    blockers: [{ id: "manual:wechat-devtools-export-review", summary: "Manual review pending: Real WeChat export imported and launched in Developer Tools." }]
  });
  writeJson(persistencePath, {
    generatedAt: "2026-04-05T08:41:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    requestedStorageMode: "memory",
    effectiveStorageMode: "memory",
    storageDescription: "In-memory snapshot store.",
    summary: { status: "passed", assertionCount: 6 },
    contentValidation: { valid: true, bundleCount: 5, summary: "All shipped content packs validated.", issueCount: 0 },
    persistenceRegression: { mapPackId: "phase1", assertions: ["room hydration reapplied resources"] }
  });

  const dossier = await buildPhase1CandidateDossier({
    candidate: "phase1-rc",
    candidateRevision: revision,
    runtimeObservabilityGatePath,
    snapshotPath,
    h5SmokePath,
    reconnectSoakPath,
    wechatCandidateSummaryPath,
    cocosBundlePath,
    persistencePath,
    targetSurface: "wechat",
    maxEvidenceAgeHours: 72
  });

  const wechatSection = dossier.sections.find((section) => section.id === "wechat-release");
  assert.equal(wechatSection?.result, "failed");
  assert.match(wechatSection?.summary ?? "", /blocked by missing, failed, or mismatched candidate-level package\/verify\/smoke\/manual evidence/);
  assert.match(wechatSection?.details.join("\n") ?? "", /package status=passed/);
  assert.match(wechatSection?.details.join("\n") ?? "", /verify status=passed/);
  assert.match(wechatSection?.details.join("\n") ?? "", /smoke status=skipped/);
  assert.match(wechatSection?.details.join("\n") ?? "", /manual review pending=1/);
  assert.equal(dossier.phase1ExitEvidenceGate.result, "failed");
  assert.match(dossier.phase1ExitEvidenceGate.summary, /blocked by WeChat release evidence/);
  assert.match(renderMarkdown(dossier), /Phase 1 exit evidence gate: `failed`/);
});

test("phase1 candidate dossier CLI writes a stable candidate bundle directory with supporting summaries", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const revision = "abc1234";
  const outputDir = path.join(workspace, "artifacts", "release-dossiers", "phase1-rc-abc1234");
  const repoRoot = path.resolve(process.cwd());

  const snapshotPath = path.join(artifactsDir, "release-readiness-pass.json");
  const h5SmokePath = path.join(artifactsDir, "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(artifactsDir, "colyseus-reconnect-soak-summary-pass.json");
  const cocosBundlePath = path.join(artifactsDir, "cocos-rc-evidence-bundle-pass.json");
  const persistencePath = path.join(artifactsDir, `phase1-release-persistence-regression-${revision}.json`);
  const syncGovernancePath = path.join(artifactsDir, "sync-governance-matrix-pass.json");
  const ciTrendSummaryPath = path.join(artifactsDir, "ci-trend-summary.json");
  const coverageSummaryPath = path.join(workspace, ".coverage", "summary.json");
  const configCenterLibraryPath = path.join(workspace, "configs", ".config-center-library.json");
  const runtimeObservabilityGatePath = writeRuntimeGateArtifact(artifactsDir, revision);

  writeJson(snapshotPath, {
    generatedAt: "2026-04-05T08:30:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-05T08:32:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    execution: { status: "passed", exitCode: 0 },
    summary: { total: 2, passed: 2, failed: 0 }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-04-05T08:33:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    status: "passed",
    summary: { failedScenarios: 0, scenarioNames: ["reconnect_soak"] },
    soakSummary: { reconnectAttempts: 64, invariantChecks: 256 },
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
      generatedAt: "2026-04-05T08:34:00.000Z",
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
  writeJson(persistencePath, {
    generatedAt: "2026-04-05T08:41:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    requestedStorageMode: "memory",
    effectiveStorageMode: "memory",
    storageDescription: "In-memory snapshot store.",
    summary: { status: "passed", assertionCount: 6 },
    contentValidation: { valid: true, bundleCount: 5, summary: "All shipped content packs validated.", issueCount: 0 },
    persistenceRegression: { mapPackId: "phase1", assertions: ["room hydration reapplied resources"] }
  });
  writeJson(syncGovernancePath, {
    generatedAt: "2026-04-05T08:42:00.000Z",
    execution: { status: "passed" },
    summary: { passed: 2, failed: 0, skipped: 0 },
    scenarios: [{ id: "room-push-redaction", status: "passed" }]
  });
  writeJson(ciTrendSummaryPath, {
    generatedAt: "2026-04-05T08:43:00.000Z",
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

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "./scripts/phase1-candidate-dossier.ts",
      "--candidate",
      "phase1-rc",
      "--candidate-revision",
      revision,
      "--target-surface",
      "h5",
      "--snapshot",
      snapshotPath,
      "--h5-smoke",
      h5SmokePath,
      "--reconnect-soak",
      reconnectSoakPath,
      "--runtime-observability-gate",
      runtimeObservabilityGatePath,
      "--cocos-bundle",
      cocosBundlePath,
      "--phase1-persistence",
      persistencePath,
      "--sync-governance",
      syncGovernancePath,
      "--ci-trend-summary",
      ciTrendSummaryPath,
      "--coverage-summary",
      coverageSummaryPath,
      "--config-center-library",
      configCenterLibraryPath,
      "--output-dir",
      outputDir
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const dossierJsonPath = path.join(outputDir, "phase1-candidate-dossier.json");
  const dossierMarkdownPath = path.join(outputDir, "phase1-candidate-dossier.md");
  const runtimeObservabilityDossierPath = path.join(outputDir, "runtime-observability-dossier.json");
  const runtimeObservabilityDossierMarkdownPath = path.join(outputDir, "runtime-observability-dossier.md");
  const releaseGateSummaryPath = path.join(outputDir, "release-gate-summary.json");
  const releaseGateMarkdownPath = path.join(outputDir, "release-gate-summary.md");
  const releaseHealthSummaryPath = path.join(outputDir, "release-health-summary.json");
  const releaseHealthMarkdownPath = path.join(outputDir, "release-health-summary.md");

  for (const filePath of [
    dossierJsonPath,
    dossierMarkdownPath,
    runtimeObservabilityDossierPath,
    runtimeObservabilityDossierMarkdownPath,
    releaseGateSummaryPath,
    releaseGateMarkdownPath,
    releaseHealthSummaryPath,
    releaseHealthMarkdownPath
  ]) {
    assert.equal(fs.existsSync(filePath), true, `${filePath} should exist`);
  }

  const dossier = JSON.parse(fs.readFileSync(dossierJsonPath, "utf8")) as {
    artifacts?: {
      outputDir: string;
      runtimeObservabilityDossierPath: string;
      releaseGateSummaryPath: string;
      releaseHealthSummaryPath: string;
    };
    sections: Array<{ id: string; artifactPath?: string }>;
  };
  assert.equal(dossier.artifacts?.outputDir, outputDir);
  assert.equal(dossier.artifacts?.runtimeObservabilityDossierPath, runtimeObservabilityDossierPath);
  assert.equal(dossier.artifacts?.releaseGateSummaryPath, releaseGateSummaryPath);
  assert.equal(dossier.artifacts?.releaseHealthSummaryPath, releaseHealthSummaryPath);
  assert.equal(dossier.sections.find((section) => section.id === "release-gate")?.artifactPath, releaseGateSummaryPath);
  assert.equal(dossier.sections.find((section) => section.id === "release-health")?.artifactPath, releaseHealthSummaryPath);

  const runtimeObservabilityDossier = JSON.parse(fs.readFileSync(runtimeObservabilityDossierPath, "utf8")) as {
    summary: {
      status: string;
      runtimeStatus: string;
      reconnectStatus: string;
    };
    sections: Array<{ id: string }>;
  };
  assert.equal(runtimeObservabilityDossier.summary.status, "passed");
  assert.equal(runtimeObservabilityDossier.summary.runtimeStatus, "passed");
  assert.equal(runtimeObservabilityDossier.summary.reconnectStatus, "passed");
  assert.deepEqual(
    runtimeObservabilityDossier.sections.map((section) => section.id),
    ["runtime-health", "reconnect-soak"]
  );

  const markdown = fs.readFileSync(dossierMarkdownPath, "utf8");
  assert.match(markdown, /## Generated Bundle/);
  assert.match(markdown, /runtime-observability-dossier\.json/);
  assert.match(markdown, /release-gate-summary\.json/);
  assert.match(markdown, /release-health-summary\.json/);

  const runtimeMarkdown = fs.readFileSync(runtimeObservabilityDossierMarkdownPath, "utf8");
  assert.match(runtimeMarkdown, /# Runtime Observability Dossier/);
  assert.match(runtimeMarkdown, /Reconnect\/session-recovery status: `passed`/);
});
