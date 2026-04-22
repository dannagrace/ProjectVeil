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

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
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
  const runtimeHealthObservedAt = hoursAgo(0.98);
  const authObservedAt = hoursAgo(0.9);
  const metricsObservedAt = hoursAgo(0.88);
  writeJson(runtimeGatePath, {
    schemaVersion: 1,
    generatedAt: hoursAgo(0.85),
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
        observedAt: runtimeHealthObservedAt,
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
        observedAt: authObservedAt,
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
        observedAt: metricsObservedAt,
        freshness: "fresh",
        details: ["Required Prometheus metrics are present."]
      }
    ]
  });
  return runtimeGatePath;
}

function writeRuntimeEvidenceArtifact(artifactsDir: string, revision: string): string {
  const runtimeEvidencePath = path.join(artifactsDir, `runtime-observability-evidence-phase1-rc-${revision}.json`);
  const runtimeHealthObservedAt = hoursAgo(1.05);
  const authObservedAt = hoursAgo(1.0);
  const metricsObservedAt = hoursAgo(0.95);
  writeJson(runtimeEvidencePath, {
    schemaVersion: 1,
    generatedAt: hoursAgo(0.92),
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
    endpoints: [
      {
        id: "runtime-health",
        observedAt: runtimeHealthObservedAt,
        status: "passed"
      },
      {
        id: "auth-readiness",
        observedAt: authObservedAt,
        status: "passed"
      },
      {
        id: "runtime-metrics",
        observedAt: metricsObservedAt,
        status: "passed"
      }
    ]
  });
  return runtimeEvidencePath;
}

function writeManualEvidenceLedger(
  artifactsDir: string,
  revision: string,
  snapshotPath: string,
  wechatCandidateSummaryPath: string,
  reconnectSoakPath: string
): string {
  const ledgerPath = path.join(artifactsDir, `manual-release-evidence-owner-ledger-phase1-rc-${revision}.md`);
  const runtimeReviewUpdatedAt = hoursAgo(1.25);
  const checklistUpdatedAt = hoursAgo(1.35);
  const blockersUpdatedAt = hoursAgo(1.3);
  const presentationUpdatedAt = hoursAgo(1.28);
  const devtoolsUpdatedAt = hoursAgo(1.2);
  const smokeUpdatedAt = hoursAgo(1.15);
  const reconnectUpdatedAt = hoursAgo(1.1);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(
    ledgerPath,
    `# Manual Release Evidence Owner Ledger

## Candidate

- Candidate: \`phase1-rc\`
- Target revision: \`${revision}\`
- Release owner: \`release-owner\`
- Last updated: \`${runtimeReviewUpdatedAt}\`
- Linked readiness snapshot: \`${snapshotPath}\`

## Ledger

| Evidence type | Candidate | Revision | Owner | Status | Last updated | Artifact path / link | Notes / blocker context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`runtime-observability-review\` | \`phase1-rc\` | \`${revision}\` | \`oncall-ops\` | \`done\` | \`${runtimeReviewUpdatedAt}\` | \`artifacts/wechat-release/runtime-observability-signoff-phase1-rc-${revision}.md\` | Runtime evidence reviewed for the candidate revision. |
| \`cocos-rc-checklist-review\` | \`phase1-rc\` | \`${revision}\` | \`release-owner\` | \`done\` | \`${checklistUpdatedAt}\` | \`artifacts/release-readiness/cocos-rc-checklist-phase1-rc-${revision}.md\` | Checklist reviewed for the same candidate. |
| \`cocos-rc-blockers-review\` | \`phase1-rc\` | \`${revision}\` | \`release-owner\` | \`done\` | \`${blockersUpdatedAt}\` | \`artifacts/release-readiness/cocos-rc-blockers-phase1-rc-${revision}.md\` | No open blockers remain. |
| \`cocos-presentation-signoff\` | \`phase1-rc\` | \`${revision}\` | \`client-lead\` | \`done\` | \`${presentationUpdatedAt}\` | \`artifacts/release-readiness/cocos-presentation-signoff-phase1-rc-${revision}.md\` | Presentation sign-off recorded. |
| \`wechat-devtools-export-review\` | \`phase1-rc\` | \`${revision}\` | \`qa-release\` | \`done\` | \`${devtoolsUpdatedAt}\` | \`${wechatCandidateSummaryPath}\` | DevTools export review is current. |
| \`wechat-device-runtime-smoke\` | \`phase1-rc\` | \`${revision}\` | \`qa-release\` | \`done\` | \`${smokeUpdatedAt}\` | \`artifacts/wechat-release/codex.wechat.smoke-report.json\` | Device runtime smoke is current. |
| \`reconnect-release-followup\` | \`phase1-rc\` | \`${revision}\` | \`server-oncall\` | \`done\` | \`${reconnectUpdatedAt}\` | \`${reconnectSoakPath}\` | Reconnect follow-up is closed. |
`,
    "utf8"
  );
  return ledgerPath;
}

function writePassingArtifacts(workspace: string, revision: string): {
  snapshotPath: string;
  releaseGateSummaryPath: string;
  h5SmokePath: string;
  reconnectSoakPath: string;
  cocosBundlePath: string;
  persistencePath: string;
  runtimeObservabilityEvidencePath: string;
  runtimeObservabilityGatePath: string;
  wechatCandidateSummaryPath: string;
  manualEvidenceLedgerPath: string;
} {
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const wechatDir = path.join(workspace, "artifacts", "wechat-release");
  const snapshotPath = path.join(artifactsDir, "release-readiness-pass.json");
  const releaseGateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const h5SmokePath = path.join(artifactsDir, "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(artifactsDir, "colyseus-reconnect-soak-summary-pass.json");
  const cocosBundlePath = path.join(artifactsDir, "cocos-rc-evidence-bundle-pass.json");
  const cocosSnapshotPath = path.join(artifactsDir, `cocos-rc-snapshot-phase1-rc-${revision}.json`);
  const primaryJourneyEvidencePath = path.join(artifactsDir, `cocos-primary-journey-evidence-phase1-rc-${revision}.json`);
  const checklistMarkdownPath = path.join(artifactsDir, `cocos-rc-checklist-phase1-rc-${revision}.md`);
  const blockersMarkdownPath = path.join(artifactsDir, `cocos-rc-blockers-phase1-rc-${revision}.md`);
  const presentationSignoffPath = path.join(artifactsDir, `cocos-presentation-signoff-phase1-rc-${revision}.json`);
  const presentationSignoffMarkdownPath = path.join(artifactsDir, `cocos-presentation-signoff-phase1-rc-${revision}.md`);
  const persistencePath = path.join(artifactsDir, `phase1-release-persistence-regression-${revision}.json`);
  const runtimeObservabilityEvidencePath = writeRuntimeEvidenceArtifact(artifactsDir, revision);
  const runtimeObservabilityGatePath = writeRuntimeGateArtifact(artifactsDir, revision);
  const wechatCandidateSummaryPath = path.join(wechatDir, "codex.wechat.release-candidate-summary.json");
  const snapshotGeneratedAt = hoursAgo(1.6);
  const h5SmokeGeneratedAt = hoursAgo(1.5);
  const reconnectGeneratedAt = hoursAgo(1.45);
  const cocosGeneratedAt = hoursAgo(1.4);
  const wechatSummaryGeneratedAt = hoursAgo(1.3);
  const runtimeReviewRecordedAt = hoursAgo(1.25);
  const devtoolsRecordedAt = hoursAgo(1.2);
  const smokeRecordedAt = hoursAgo(1.15);
  const persistenceGeneratedAt = hoursAgo(1.1);
  const releaseGateGeneratedAt = hoursAgo(1.55);
  const cocosSnapshotExecutedAt = hoursAgo(1.35);
  const primaryJourneyCompletedAt = hoursAgo(1.32);

  writeJson(snapshotPath, {
    generatedAt: snapshotGeneratedAt,
    revision: { commit: revision, shortCommit: revision },
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [
      { id: "npm-test", title: "Unit and integration regression", required: true, status: "passed", command: "npm test" },
      { id: "typecheck-ci", required: true, status: "passed", command: "npm run typecheck -- ci" },
      { id: "e2e-smoke", required: true, status: "passed", command: "npm test -- e2e:smoke" },
      {
        id: "e2e-multiplayer-smoke",
        required: true,
        status: "passed",
        command: "npm test -- e2e:multiplayer:smoke"
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
    generatedAt: h5SmokeGeneratedAt,
    revision: { commit: revision, shortCommit: revision },
    execution: { status: "passed", exitCode: 0 },
    summary: { total: 2, passed: 2, failed: 0 }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: reconnectGeneratedAt,
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
      generatedAt: cocosGeneratedAt,
      candidate: "phase1-rc",
      commit: revision,
      shortCommit: revision,
      overallStatus: "passed",
      summary: "Cocos RC evidence is complete."
    },
    artifacts: {
      snapshot: cocosSnapshotPath,
      primaryJourneyEvidence: primaryJourneyEvidencePath,
      checklistMarkdown: checklistMarkdownPath,
      blockersMarkdown: blockersMarkdownPath,
      presentationSignoff: presentationSignoffPath,
      presentationSignoffMarkdown: presentationSignoffMarkdownPath
    },
    linkedEvidence: {
      releaseReadinessSnapshot: {
        path: snapshotPath
      }
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
  writeJson(cocosSnapshotPath, {
    candidate: {
      name: "phase1-rc",
      commit: revision,
      shortCommit: revision
    },
    execution: {
      executedAt: cocosSnapshotExecutedAt,
      overallStatus: "passed",
      summary: "Cocos RC snapshot is current for the candidate revision."
    },
    linkedEvidence: {
      releaseReadinessSnapshot: {
        path: snapshotPath
      },
      primaryJourneyEvidence: {
        path: primaryJourneyEvidencePath
      }
    }
  });
  writeJson(primaryJourneyEvidencePath, {
    candidate: {
      name: "phase1-rc",
      commit: revision,
      shortCommit: revision
    },
    execution: {
      completedAt: primaryJourneyCompletedAt
    }
  });
  fs.writeFileSync(checklistMarkdownPath, "# Checklist\n", "utf8");
  fs.writeFileSync(blockersMarkdownPath, "# Blockers\n", "utf8");
  writeJson(presentationSignoffPath, {
    generatedAt: hoursAgo(1.3),
    candidate: {
      name: "phase1-rc",
      revision
    },
    status: "passed"
  });
  fs.writeFileSync(presentationSignoffMarkdownPath, "# Presentation sign-off\n", "utf8");
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: wechatSummaryGeneratedAt,
    candidate: { revision, version: "1.2.3", status: "ready" },
    evidence: {
      package: { status: "passed", artifactPath: path.join(wechatDir, "veil.package.json") },
      validation: { status: "passed", artifactPath: path.join(wechatDir, "codex.wechat.rc-validation-report.json") },
      smoke: { status: "passed", artifactPath: path.join(wechatDir, "codex.wechat.smoke-report.json") },
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "runtime-observability-signoff",
            title: "Runtime observability sign-off",
            required: true,
            status: "done",
            owner: "oncall-ops",
            recordedAt: runtimeReviewRecordedAt,
            revision,
            artifactPath: path.join(wechatDir, `runtime-observability-signoff-phase1-rc-${revision}.md`)
          },
          {
            id: "wechat-devtools-export-review",
            title: "WeChat DevTools export review",
            required: true,
            status: "done",
            owner: "qa-release",
            recordedAt: devtoolsRecordedAt,
            revision,
            artifactPath: wechatCandidateSummaryPath
          },
          {
            id: "wechat-device-runtime-smoke",
            title: "WeChat device runtime smoke",
            required: true,
            status: "done",
            owner: "qa-release",
            recordedAt: smokeRecordedAt,
            revision,
            artifactPath: path.join(wechatDir, "codex.wechat.smoke-report.json")
          }
        ]
      }
    },
    blockers: []
  });
  writeJson(persistencePath, {
    generatedAt: persistenceGeneratedAt,
    revision: { commit: revision, shortCommit: revision },
    requestedStorageMode: "mysql",
    effectiveStorageMode: "mysql",
    storageDescription: "MySQL snapshot store backed by VEIL_MYSQL_*.",
    summary: { status: "passed", assertionCount: 6 },
    contentValidation: { valid: true, summary: "All shipped content packs validated.", issueCount: 0 },
    persistenceRegression: { mapPackId: "phase1", assertions: ["room hydration reapplied resources"] }
  });
  writeJson(releaseGateSummaryPath, {
    generatedAt: releaseGateGeneratedAt,
    revision: { commit: revision, shortCommit: revision },
    inputs: { snapshotPath }
  });
  const manualEvidenceLedgerPath = writeManualEvidenceLedger(
    artifactsDir,
    revision,
    snapshotPath,
    wechatCandidateSummaryPath,
    reconnectSoakPath
  );

  return {
    snapshotPath,
    releaseGateSummaryPath,
    h5SmokePath,
    reconnectSoakPath,
    cocosBundlePath,
    persistencePath,
    runtimeObservabilityEvidencePath,
    runtimeObservabilityGatePath,
    wechatCandidateSummaryPath,
    manualEvidenceLedgerPath
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
  assert.equal(report.candidateEvidenceAudit.status, "pass");
  assert.equal(report.criteria.every((entry) => entry.sourceArtifacts.length > 0), true);
  assert.equal(
    report.criteria
      .find((entry) => entry.id === "cocos-primary-client-evidence")
      ?.sourceArtifacts.some((artifact) => artifact.label === "Cocos presentation sign-off checklist"),
    true
  );
  assert.equal(
    report.criteria
      .find((entry) => entry.id === "known-blockers")
      ?.sourceArtifacts.some((artifact) => artifact.label === "Manual evidence owner ledger"),
    true
  );

  const markdown = renderMarkdown(report);
  assert.match(markdown, /# Phase 1 Exit Audit/);
  assert.match(markdown, /Overall status: \*\*PASS\*\*/);
  assert.match(markdown, /## Candidate Evidence Audit/);
  assert.match(markdown, /Blocking findings: 0/);
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
      { id: "typecheck-ci", required: true, status: "passed", command: "npm run typecheck -- ci" },
      { id: "e2e-smoke", required: true, status: "passed", command: "npm test -- e2e:smoke" },
      {
        id: "e2e-multiplayer-smoke",
        required: true,
        status: "passed",
        command: "npm test -- e2e:multiplayer:smoke"
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

test("phase1 exit audit fails known blockers when the manual owner ledger still has pending sign-offs", async () => {
  const workspace = createTempWorkspace();
  const revision = "abc1234";
  const inputs = writePassingArtifacts(workspace, revision);

  fs.writeFileSync(
    inputs.manualEvidenceLedgerPath,
    fs
      .readFileSync(inputs.manualEvidenceLedgerPath, "utf8")
      .replace("| `runtime-observability-review` | `phase1-rc` | `abc1234` | `oncall-ops` | `done` |", "| `runtime-observability-review` | `phase1-rc` | `abc1234` | `oncall-ops` | `pending` |"),
    "utf8"
  );

  const report = await buildPhase1ExitAudit({
    candidate: "phase1-rc",
    candidateRevision: revision,
    targetSurface: "wechat",
    maxEvidenceAgeHours: 72,
    ...inputs
  });

  assert.equal(report.summary.status, "fail");
  assert.equal(report.candidateEvidenceAudit.status, "fail");
  assert.equal(report.criteria.find((entry) => entry.id === "known-blockers")?.status, "fail");
  assert.equal(
    report.criteria
      .find((entry) => entry.id === "known-blockers")
      ?.details.some((detail) => detail.includes("manual_pending")),
    true
  );
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
      "--release-gate-summary",
      inputs.releaseGateSummaryPath,
      "--h5-smoke",
      inputs.h5SmokePath,
      "--reconnect-soak",
      inputs.reconnectSoakPath,
      "--runtime-observability-evidence",
      inputs.runtimeObservabilityEvidencePath,
      "--runtime-observability-gate",
      inputs.runtimeObservabilityGatePath,
      "--manual-evidence-ledger",
      inputs.manualEvidenceLedgerPath,
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
  assert.match(markdown, /## Candidate Evidence Audit/);
  assert.match(markdown, /### 5\. WeChat release evidence is current when WeChat is the target surface\./);
});
