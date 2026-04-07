import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPhase1ExitAudit, renderMarkdown } from "../phase1-exit-audit.ts";

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-phase1-exit-audit-"));
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
        details: ["activeRooms=3", "connections=11", "actions=182"]
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
        details: ["lockouts=0", "pendingRegistrations=0", "pendingRecoveries=0"]
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
        details: ["Required Prometheus metrics are present."]
      }
    ]
  });
  return runtimeGatePath;
}

function writePassingArtifacts(workspace: string, revision: string): {
  snapshotPath: string;
  h5SmokePath: string;
  reconnectSoakPath: string;
  cocosBundlePath: string;
  persistencePath: string;
  runtimeObservabilityGatePath: string;
  wechatCandidateSummaryPath: string;
} {
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const wechatDir = path.join(workspace, "artifacts", "wechat-release");
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
    checks: [
      { id: "npm-test", title: "Unit and integration regression", required: true, status: "passed", command: "npm test" },
      { id: "typecheck-ci", required: true, status: "passed", command: "npm run typecheck:ci" },
      { id: "e2e-smoke", required: true, status: "passed", command: "npm run test:e2e:smoke" },
      {
        id: "e2e-multiplayer-smoke",
        required: true,
        status: "passed",
        command: "npm run test:e2e:multiplayer:smoke"
      },
      {
        id: "cocos-release-readiness",
        required: true,
        status: "passed",
        command: "npm run check:cocos-release-readiness"
      }
    ]
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
    soakSummary: { reconnectAttempts: 256, invariantChecks: 1024 },
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
    artifacts: {
      snapshot: path.join(artifactsDir, "cocos-rc-snapshot-phase1-rc.json"),
      checklistMarkdown: path.join(artifactsDir, "cocos-rc-checklist-phase1-rc.md"),
      blockersMarkdown: path.join(artifactsDir, "cocos-rc-blockers-phase1-rc.md"),
      presentationSignoff: path.join(artifactsDir, "cocos-presentation-signoff-phase1-rc.json"),
      presentationSignoffMarkdown: path.join(artifactsDir, "cocos-presentation-signoff-phase1-rc.md")
    },
    review: {
      phase1Gate: "passed"
    },
    journey: [
      { id: "lobby-entry", title: "Lobby entry", status: "passed" },
      { id: "world-journey", title: "World exploration", status: "passed" },
      { id: "battle-journey", title: "Battle settlement", status: "passed" }
    ],
    requiredEvidence: [
      { id: "roomId", label: "Room id recorded", filled: true },
      { id: "presentationSignoff", label: "Presentation sign-off", filled: true }
    ]
  });
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: "2026-04-05T08:40:00.000Z",
    candidate: { revision, version: "1.2.3", status: "ready" },
    evidence: {
      package: { status: "passed", artifactPath: path.join(wechatDir, "veil.package.json") },
      validation: { status: "passed", artifactPath: path.join(wechatDir, "codex.wechat.rc-validation-report.json") },
      smoke: { status: "passed", artifactPath: path.join(wechatDir, "codex.wechat.smoke-report.json") },
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0
      }
    },
    blockers: []
  });
  writeJson(persistencePath, {
    generatedAt: "2026-04-05T08:41:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    requestedStorageMode: "mysql",
    effectiveStorageMode: "mysql",
    storageDescription: "MySQL snapshot store backed by VEIL_MYSQL_*.",
    summary: { status: "passed", assertionCount: 6 },
    contentValidation: { valid: true, summary: "All shipped content packs validated.", issueCount: 0 },
    persistenceRegression: { mapPackId: "phase1", assertions: ["room hydration reapplied resources"] }
  });

  return {
    snapshotPath,
    h5SmokePath,
    reconnectSoakPath,
    cocosBundlePath,
    persistencePath,
    runtimeObservabilityGatePath,
    wechatCandidateSummaryPath
  };
}

test("phase1 exit audit maps the scorecard criteria into one passing report", async () => {
  const workspace = createTempWorkspace();
  const revision = "abc1234";
  const inputs = writePassingArtifacts(workspace, revision);

  const report = await buildPhase1ExitAudit({
    candidate: "phase1-rc",
    candidateRevision: revision,
    targetSurface: "wechat",
    maxEvidenceAgeHours: 72,
    ...inputs
  });

  assert.equal(report.summary.status, "pass");
  assert.deepEqual(report.summary.blockedCriteria, []);
  assert.deepEqual(report.summary.pendingCriteria, []);
  assert.equal(report.criteria.length, 8);
  assert.equal(report.criteria.find((entry) => entry.id === "bounded-scope")?.status, "pass");
  assert.equal(report.criteria.find((entry) => entry.id === "core-automated-gates")?.status, "pass");
  assert.equal(report.criteria.find((entry) => entry.id === "release-readiness-snapshot")?.status, "pass");
  assert.equal(report.criteria.find((entry) => entry.id === "cocos-primary-client-evidence")?.status, "pass");
  assert.equal(report.criteria.find((entry) => entry.id === "wechat-release-evidence")?.status, "pass");
  assert.equal(report.criteria.find((entry) => entry.id === "runtime-observability")?.status, "pass");
  assert.equal(report.criteria.find((entry) => entry.id === "phase1-data-persistence")?.status, "pass");
  assert.equal(report.criteria.find((entry) => entry.id === "known-blockers")?.status, "pass");
  assert.equal(report.criteria.every((entry) => entry.sourceArtifacts.length > 0), true);
  assert.equal(
    report.criteria
      .find((entry) => entry.id === "cocos-primary-client-evidence")
      ?.sourceArtifacts.some((artifact) => artifact.label === "Cocos presentation sign-off checklist"),
    true
  );

  const markdown = renderMarkdown(report);
  assert.match(markdown, /# Phase 1 Exit Audit/);
  assert.match(markdown, /Overall status: \*\*PASS\*\*/);
  assert.match(markdown, /### 2\. Core automated gates are green\./);
  assert.match(markdown, /npm run check:cocos-release-readiness: passed/);
  assert.match(markdown, /### 8\. Known Phase 1 blockers are closed or explicitly accepted\./);
  assert.match(markdown, /Cocos presentation sign-off checklist:/);
});

test("phase1 exit audit distinguishes blocking failures from stale pending evidence", async () => {
  const workspace = createTempWorkspace();
  const revision = "abc1234";
  const inputs = writePassingArtifacts(workspace, revision);

  writeJson(inputs.snapshotPath, {
    generatedAt: "2026-04-05T08:30:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    summary: { status: "failed", requiredFailed: 1, requiredPending: 0 },
    checks: [
      { id: "npm-test", required: true, status: "failed", command: "npm test" },
      { id: "typecheck-ci", required: true, status: "passed", command: "npm run typecheck:ci" },
      { id: "e2e-smoke", required: true, status: "passed", command: "npm run test:e2e:smoke" },
      {
        id: "e2e-multiplayer-smoke",
        required: true,
        status: "passed",
        command: "npm run test:e2e:multiplayer:smoke"
      },
      {
        id: "cocos-release-readiness",
        required: true,
        status: "passed",
        command: "npm run check:cocos-release-readiness"
      }
    ]
  });
  writeJson(inputs.persistencePath, {
    generatedAt: "2026-03-20T08:41:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    requestedStorageMode: "mysql",
    effectiveStorageMode: "mysql",
    storageDescription: "MySQL snapshot store backed by VEIL_MYSQL_*.",
    summary: { status: "passed", assertionCount: 6 },
    contentValidation: { valid: true, summary: "All shipped content packs validated.", issueCount: 0 },
    persistenceRegression: { mapPackId: "phase1", assertions: ["room hydration reapplied resources"] }
  });

  const report = await buildPhase1ExitAudit({
    candidate: "phase1-rc",
    candidateRevision: revision,
    targetSurface: "wechat",
    maxEvidenceAgeHours: 72,
    ...inputs
  });

  assert.equal(report.summary.status, "fail");
  assert.equal(report.criteria.find((entry) => entry.id === "core-automated-gates")?.status, "fail");
  assert.equal(report.criteria.find((entry) => entry.id === "release-readiness-snapshot")?.status, "fail");
  assert.equal(report.criteria.find((entry) => entry.id === "phase1-data-persistence")?.status, "pending");
  assert.equal(report.summary.blockedCriteria.some((entry) => entry.includes("Core automated gates")), true);
  assert.equal(report.summary.pendingCriteria.some((entry) => entry.includes("Phase 1 data and persistence")), true);
});

test("phase1 exit audit CLI writes stable JSON and Markdown outputs", () => {
  const workspace = createTempWorkspace();
  const revision = "abc1234";
  const inputs = writePassingArtifacts(workspace, revision);
  const outputDir = path.join(workspace, "artifacts", "release-readiness", "phase1-exit-audit");
  const repoRoot = path.resolve(process.cwd());

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "./scripts/phase1-exit-audit.ts",
      "--candidate",
      "phase1-rc",
      "--candidate-revision",
      revision,
      "--target-surface",
      "wechat",
      "--snapshot",
      inputs.snapshotPath,
      "--h5-smoke",
      inputs.h5SmokePath,
      "--reconnect-soak",
      inputs.reconnectSoakPath,
      "--runtime-observability-gate",
      inputs.runtimeObservabilityGatePath,
      "--cocos-bundle",
      inputs.cocosBundlePath,
      "--wechat-candidate-summary",
      inputs.wechatCandidateSummaryPath,
      "--phase1-persistence",
      inputs.persistencePath,
      "--output-dir",
      outputDir
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Phase 1 exit audit PASS/);

  const jsonPath = path.join(outputDir, "phase1-exit-audit.json");
  const markdownPath = path.join(outputDir, "phase1-exit-audit.md");
  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);

  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
    summary: { status: string };
    criteria: Array<{ number: number; status: string; sourceArtifacts: Array<{ path: string }> }>;
  };
  assert.equal(report.summary.status, "pass");
  assert.equal(report.criteria.length, 8);
  assert.equal(report.criteria.every((entry) => entry.sourceArtifacts.length > 0), true);

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# Phase 1 Exit Audit/);
  assert.match(markdown, /### 5\. WeChat release evidence is current when WeChat is the target surface\./);
});
