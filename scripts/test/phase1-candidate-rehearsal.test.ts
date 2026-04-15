import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runOptionalFailingDiagnosticStage } from "../phase1-candidate-rehearsal.ts";

const repoRoot = path.resolve(__dirname, "../..");
const fixtureBuildDir = path.join(repoRoot, "apps", "cocos-client", "test", "fixtures", "wechatgame-export");
const defaultConfigPath = path.join(repoRoot, "apps", "cocos-client", "wechat-minigame.build.json");

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readGit(command: string[]): string {
  const result = spawnSync("git", command, {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${command.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("release:phase1:candidate-rehearsal assembles stable candidate-scoped rehearsal outputs", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-phase1-rehearsal-"));
  const buildDir = path.join(workspace, "build");
  const sourceArtifactsDir = path.join(workspace, "source-artifacts");
  const outputDir = path.join(workspace, "rehearsal");
  const revision = readGit(["rev-parse", "HEAD"]);
  const shortRevision = readGit(["rev-parse", "--short", "HEAD"]);
  const now = new Date().toISOString();
  fs.cpSync(fixtureBuildDir, buildDir, { recursive: true });

  execFileSync(
    process.execPath,
      [
        "--import",
        "tsx",
        "./scripts/wechat-release-rehearsal.ts",
        "--config",
        defaultConfigPath,
        "--build-dir",
        buildDir,
        "--artifacts-dir",
        sourceArtifactsDir,
        "--source-revision",
        revision,
        "--expected-revision",
        revision
      ],
      {
        cwd: repoRoot,
        stdio: "pipe"
      }
    );

  const h5SmokePath = path.join(workspace, "client-release-candidate-smoke.json");
  writeJson(h5SmokePath, {
    generatedAt: now,
    revision: {
      commit: revision,
      shortCommit: shortRevision
    },
    execution: {
      status: "passed",
      exitCode: 0,
      finishedAt: now
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0
    }
  });

  const reconnectSoakPath = path.join(workspace, "colyseus-reconnect-soak-summary.json");
  writeJson(reconnectSoakPath, {
    generatedAt: now,
    revision: {
      commit: revision,
      shortCommit: shortRevision
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

  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "./scripts/phase1-candidate-rehearsal.ts",
      "--candidate",
      "phase1-mainline",
      "--output-dir",
      outputDir,
      "--h5-smoke",
      h5SmokePath,
      "--reconnect-soak",
      reconnectSoakPath,
      "--wechat-artifacts-dir",
      sourceArtifactsDir,
      "--validate-status",
      "success",
      "--wechat-build-status",
      "success",
      "--client-rc-smoke-status",
      "success",
      "--target-surface",
      "h5"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    }
  );

    assert.match(output, /Phase 1 candidate rehearsal PASSED/);

  const summaryPath = path.join(outputDir, `phase1-candidate-rehearsal-phase1-mainline-${shortRevision}.json`);
  const markdownPath = path.join(outputDir, "SUMMARY.md");
  assert.ok(fs.existsSync(summaryPath));
  assert.ok(fs.existsSync(markdownPath));

  const report = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    summary: {
      status: string;
      releaseGateStatus: string;
      releaseHealthStatus: string;
      phase1CandidateStatus: string;
      stageFailures: string[];
      missingArtifacts: string[];
    };
    artifacts: Record<string, string | undefined>;
    stages: Array<{ id: string; status: string }>;
  };

  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.releaseGateStatus, "passed");
  assert.ok(["healthy", "warning"].includes(report.summary.releaseHealthStatus));
  assert.equal(report.summary.phase1CandidateStatus, "passed");
  assert.deepEqual(report.summary.stageFailures, []);
  assert.deepEqual(report.summary.missingArtifacts, []);
  assert.equal(report.stages.find((stage) => stage.id === "release-readiness-snapshot")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "wechat-candidate-summary")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "cocos-primary-journey-evidence")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "cocos-primary-diagnostics")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "candidate-revision-triage-digest")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "cocos-rc-bundle")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "cocos-main-journey-replay-gate")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "runtime-slo-summary")?.status, "skipped");
  assert.equal(report.stages.find((stage) => stage.id === "runtime-observability-bundle")?.status, "skipped");
  assert.equal(report.stages.find((stage) => stage.id === "phase1-same-revision-evidence-bundle")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "phase1-release-evidence-drift-gate")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "candidate-evidence-audit")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "candidate-evidence-freshness-guard")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "release-evidence-index")?.status, "passed");
  assert.match(report.artifacts.runtimeObservabilityBundlePath ?? "", /runtime-observability-bundle-phase1-mainline-/);
  assert.equal(report.stages.find((stage) => stage.id === "phase1-candidate-dossier")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "phase1-exit-audit")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "phase1-exit-dossier-freshness-gate")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "go-no-go-packet")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.id === "release-pr-summary")?.status, "passed");
  assert.match(report.artifacts.releaseReadinessSnapshotPath ?? "", /release-readiness-phase1-mainline-/);
  assert.match(report.artifacts.cocosPrimaryJourneyEvidencePath ?? "", /cocos-primary-journey-evidence-phase1-mainline-/);
  assert.match(report.artifacts.cocosPrimaryJourneyEvidenceMarkdownPath ?? "", /cocos-primary-journey-evidence-phase1-mainline-/);
  assert.match(report.artifacts.cocosMainJourneyReplayGatePath ?? "", /cocos-main-journey-replay-gate-phase1-mainline-/);
  assert.match(report.artifacts.cocosMainJourneyReplayGateMarkdownPath ?? "", /cocos-main-journey-replay-gate-phase1-mainline-/);
  assert.match(report.artifacts.cocosPrimaryDiagnosticsPath ?? "", /cocos-primary-client-diagnostic-snapshots-/);
  assert.match(report.artifacts.cocosPrimaryDiagnosticsMarkdownPath ?? "", /cocos-primary-client-diagnostic-snapshots-/);
  assert.match(report.artifacts.candidateRevisionTriageInputPath ?? "", /candidate-revision-triage-input-phase1-mainline-/);
  assert.match(report.artifacts.candidateRevisionTriageDigestPath ?? "", /candidate-revision-triage-digest-phase1-mainline-/);
  assert.match(report.artifacts.candidateRevisionTriageDigestMarkdownPath ?? "", /candidate-revision-triage-digest-phase1-mainline-/);
  assert.match(report.artifacts.runtimeSloSummaryPath ?? "", /runtime-slo-summary-phase1-mainline-/);
  assert.match(report.artifacts.runtimeSloSummaryMarkdownPath ?? "", /runtime-slo-summary-phase1-mainline-/);
  assert.match(report.artifacts.runtimeSloSummaryTextPath ?? "", /runtime-slo-summary-phase1-mainline-/);
  assert.match(report.artifacts.cocosBundlePath ?? "", /cocos-rc-evidence-bundle-phase1-mainline-/);
  assert.match(report.artifacts.runtimeObservabilityGatePath ?? "", /runtime-observability-gate-phase1-mainline-/);
  assert.match(report.artifacts.sameRevisionEvidenceBundleManifestPath ?? "", /phase1-same-revision-evidence-bundle-phase1-mainline-/);
  assert.match(report.artifacts.phase1ReleaseEvidenceDriftGatePath ?? "", /phase1-release-evidence-drift-gate-phase1-mainline-/);
  assert.match(report.artifacts.manualEvidenceLedgerPath ?? "", /manual-release-evidence-owner-ledger-phase1-mainline-/);
  assert.match(report.artifacts.releaseReadinessDashboardPath ?? "", /release-readiness-dashboard-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceAuditPath ?? "", /candidate-evidence-audit-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceAuditMarkdownPath ?? "", /candidate-evidence-audit-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceManifestPath ?? "", /candidate-evidence-manifest-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceManifestMarkdownPath ?? "", /candidate-evidence-manifest-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceFreshnessGuardPath ?? "", /candidate-evidence-freshness-guard-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceFreshnessGuardMarkdownPath ?? "", /candidate-evidence-freshness-guard-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceOwnerReminderPath ?? "", /candidate-evidence-owner-reminder-report-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceOwnerReminderMarkdownPath ?? "", /candidate-evidence-owner-reminder-report-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceFreshnessHistoryPath ?? "", /candidate-evidence-freshness-history-phase1-mainline\.json/);
  assert.match(report.artifacts.releaseEvidenceIndexPath ?? "", /current-release-evidence-index-phase1-mainline-/);
  assert.match(report.artifacts.releaseEvidenceIndexMarkdownPath ?? "", /current-release-evidence-index-phase1-mainline-/);
  assert.match(report.artifacts.releaseGateSummaryPath ?? "", /release-gate-summary-/);
  assert.match(report.artifacts.releaseGateMarkdownPath ?? "", /release-gate-summary-/);
  assert.match(report.artifacts.releaseHealthSummaryPath ?? "", /release-health-summary-/);
  assert.match(report.artifacts.releaseHealthMarkdownPath ?? "", /release-health-summary-/);
  assert.match(report.artifacts.ciTrendSummaryPath ?? "", /ci-trend-summary-phase1-mainline-/);
  assert.match(report.artifacts.ciTrendMarkdownPath ?? "", /ci-trend-summary-phase1-mainline-/);
  assert.match(report.artifacts.phase1CandidateDossierPath ?? "", /phase1-candidate-dossier-phase1-mainline-/);
  assert.match(report.artifacts.phase1CandidateDossierMarkdownPath ?? "", /phase1-candidate-dossier-phase1-mainline-/);
  assert.match(report.artifacts.phase1ExitAuditPath ?? "", /phase1-exit-audit-phase1-mainline-/);
  assert.match(report.artifacts.phase1ExitDossierFreshnessGatePath ?? "", /phase1-exit-dossier-freshness-gate-phase1-mainline-/);
  assert.match(report.artifacts.goNoGoPacketPath ?? "", /go-no-go-decision-packet-phase1-mainline-/);
  assert.match(report.artifacts.goNoGoPacketMarkdownPath ?? "", /go-no-go-decision-packet-phase1-mainline-/);
  assert.match(report.artifacts.releasePrCommentPath ?? "", /release-pr-comment-phase1-mainline-/);
  assert.match(report.artifacts.stableH5SmokePath ?? "", /client-release-candidate-smoke-phase1-mainline-/);
  assert.match(report.artifacts.stableReconnectSoakPath ?? "", /colyseus-reconnect-soak-summary-phase1-mainline-/);
  assert.match(report.artifacts.stableWechatArtifactsDir ?? "", /wechat-release-phase1-mainline-/);
  assert.match(report.artifacts.wechatCandidateSummaryPath ?? "", /codex\.wechat\.release-candidate-summary\.json/);
  assert.match(report.artifacts.wechatCandidateMarkdownPath ?? "", /codex\.wechat\.release-candidate-summary\.md/);
  assert.match(report.artifacts.runtimeObservabilityEvidencePath ?? "", /runtime-observability-evidence-phase1-mainline-/);
  assert.match(report.artifacts.runtimeObservabilityGateMarkdownPath ?? "", /runtime-observability-gate-phase1-mainline-/);

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# Phase 1 Candidate Rehearsal/);
  assert.match(markdown, /Release gate summary: `passed`/);
  assert.match(markdown, /Phase 1 dossier summary: `passed`/);
  assert.match(markdown, /## Reviewer Front Door/);
  assert.match(markdown, /canonical packet-level reviewer entrypoint from `SUMMARY\.md`/);
  assert.match(
    markdown,
    new RegExp(
      `- Release candidate manifest markdown: \`${escapeRegex(report.artifacts.candidateEvidenceManifestMarkdownPath ?? "")}\``
    )
  );
  assert.match(
    markdown,
    new RegExp(
      `- Same-candidate evidence audit markdown: \`${escapeRegex(report.artifacts.candidateEvidenceAuditMarkdownPath ?? "")}\``
    )
  );
  assert.match(
    markdown,
    new RegExp(`- Release candidate manifest JSON: \`${escapeRegex(report.artifacts.candidateEvidenceManifestPath ?? "")}\``)
  );
  assert.match(markdown, /Current release evidence index:/);
  assert.match(markdown, /Current release evidence index markdown:/);
  assert.match(markdown, /Release gate summary:/);
  assert.match(markdown, /Release gate summary markdown:/);
  assert.match(markdown, /Release health summary:/);
  assert.match(markdown, /Release health summary markdown:/);
  assert.match(markdown, /CI trend summary:/);
  assert.match(markdown, /CI trend summary markdown:/);
  assert.match(markdown, /Release readiness snapshot:/);
  assert.match(markdown, /Runtime SLO summary markdown:/);
  assert.match(markdown, /Runtime SLO summary:/);
  assert.match(markdown, /Runtime SLO summary text:/);
  assert.match(markdown, new RegExp(`- Runtime observability gate: \`${escapeRegex(report.artifacts.runtimeObservabilityGatePath ?? "")}\``));
  assert.match(markdown, /Runtime observability gate markdown:/);
  assert.match(markdown, /H5 candidate smoke:/);
  assert.match(markdown, /Reconnect soak summary:/);
  assert.match(markdown, /WeChat candidate summary:/);
  assert.match(markdown, /WeChat candidate summary markdown:/);
  assert.match(markdown, /Runtime observability bundle:/);
  assert.match(markdown, /Runtime observability evidence:/);
  assert.match(markdown, /Runtime observability gate:/);
  assert.match(markdown, /Candidate evidence audit:/);
  assert.match(markdown, /Candidate freshness guard:/);
  assert.match(markdown, /Candidate owner reminder:/);
  assert.match(markdown, /Candidate freshness history:/);
  assert.match(markdown, /Release readiness dashboard:/);
  assert.match(markdown, /Same-revision evidence bundle manifest:/);
  assert.match(markdown, /Phase 1 release evidence drift gate:/);
  assert.match(markdown, /Phase 1 exit audit:/);
  assert.match(markdown, /Phase 1 exit dossier freshness gate:/);
  assert.match(markdown, /Phase 1 candidate dossier:/);
  assert.match(markdown, /Phase 1 candidate dossier markdown:/);
  assert.match(markdown, /Manual evidence owner ledger:/);
  assert.match(markdown, /Cocos primary journey evidence:/);
  assert.match(markdown, /Cocos main-journey replay gate:/);
  assert.match(markdown, /Cocos primary diagnostics:/);
  assert.match(markdown, /Candidate revision triage digest:/);
  assert.match(markdown, /Cocos RC bundle:/);
  assert.match(markdown, /Go\/no-go packet:/);
  assert.match(markdown, /Release PR summary:/);
  assert.match(markdown, /cocosPrimaryJourneyEvidencePath:/);
  assert.match(markdown, /cocosPrimaryJourneyEvidenceMarkdownPath:/);
  assert.match(markdown, /cocosMainJourneyReplayGatePath:/);
  assert.match(markdown, /cocosMainJourneyReplayGateMarkdownPath:/);
  assert.match(markdown, /cocosPrimaryDiagnosticsPath:/);
  assert.match(markdown, /candidateRevisionTriageInputPath:/);
  assert.match(markdown, /candidateRevisionTriageDigestPath:/);
  assert.match(markdown, /candidateRevisionTriageDigestMarkdownPath:/);
  assert.match(markdown, /runtimeSloSummaryPath:/);
  assert.match(markdown, /runtimeSloSummaryMarkdownPath:/);
  assert.match(markdown, /runtimeSloSummaryTextPath:/);
  assert.match(markdown, /cocosBundlePath:/);
  assert.match(markdown, /candidateEvidenceAuditPath:/);
  assert.match(markdown, /candidateEvidenceAuditMarkdownPath:/);
  assert.match(markdown, /candidateEvidenceFreshnessGuardPath:/);
  assert.match(markdown, /candidateEvidenceOwnerReminderPath:/);
  assert.match(markdown, /candidateEvidenceFreshnessHistoryPath:/);
  assert.match(markdown, /releaseEvidenceIndexPath:/);
  assert.match(markdown, /releaseEvidenceIndexMarkdownPath:/);
  assert.match(markdown, /releaseGateSummaryPath:/);
  assert.match(markdown, /releaseGateMarkdownPath:/);
  assert.match(markdown, /releaseHealthSummaryPath:/);
  assert.match(markdown, /releaseHealthMarkdownPath:/);
  assert.match(markdown, /ciTrendSummaryPath:/);
  assert.match(markdown, /ciTrendMarkdownPath:/);
  assert.match(markdown, /releaseReadinessSnapshotPath:/);
  assert.match(markdown, /stableH5SmokePath:/);
  assert.match(markdown, /stableReconnectSoakPath:/);
  assert.match(markdown, /wechatCandidateSummaryPath:/);
  assert.match(markdown, /wechatCandidateMarkdownPath:/);
  assert.match(markdown, /runtimeObservabilityBundlePath:/);
  assert.match(markdown, /runtimeObservabilityEvidencePath:/);
  assert.match(markdown, /runtimeObservabilityGatePath:/);
  assert.match(markdown, /runtimeObservabilityGateMarkdownPath:/);
  assert.match(markdown, /sameRevisionEvidenceBundleManifestPath:/);
  assert.match(markdown, /phase1ReleaseEvidenceDriftGatePath:/);
  assert.match(markdown, /phase1ExitAuditPath:/);
  assert.match(markdown, /phase1ExitDossierFreshnessGatePath:/);
  assert.match(markdown, /phase1CandidateDossierMarkdownPath:/);
  assert.match(markdown, /goNoGoPacketPath:/);
  assert.match(markdown, /releasePrCommentPath:/);

  const runtimeSloMarkdownIndex = markdown.indexOf("Runtime SLO summary markdown:");
  const runtimeObservabilityGateIndex = markdown.indexOf("Runtime observability gate:");
  assert.notEqual(runtimeSloMarkdownIndex, -1);
  assert.notEqual(runtimeObservabilityGateIndex, -1);
  assert.ok(runtimeSloMarkdownIndex < runtimeObservabilityGateIndex);
});

test("runOptionalFailingDiagnosticStage: stale artifacts from a prior run with exit code 1 are reported as failed", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-optional-stage-stale-"));
  try {
    const outputA = path.join(workspace, "output-a.json");
    const outputB = path.join(workspace, "output-b.md");

    // Pre-create stale artifacts that would have been left from a previous invocation.
    fs.writeFileSync(outputA, '{"stale":true}\n', "utf8");
    fs.writeFileSync(outputB, "# Stale\n", "utf8");

    // Command exits with code 1 but does NOT write or touch the output files,
    // simulating a server-unreachable failure during a rerun.
    const result = runOptionalFailingDiagnosticStage(
      "test-stage",
      "Test Stage",
      [process.execPath, "-e", "process.exit(1)"],
      [outputA, outputB]
    );

    assert.equal(result.status, "failed", "stale artifacts + exit 1 must be reported as failed, not passed");
    assert.equal(result.exitCode, 1);
    assert.match(result.summary, /not refreshed by this invocation/, "summary must identify the stale artifact problem");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("runOptionalFailingDiagnosticStage: freshly written artifacts with exit code 1 are reported as passed", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-optional-stage-fresh-"));
  try {
    const outputA = path.join(workspace, "output-a.json");
    const outputB = path.join(workspace, "output-b.md");

    // No pre-existing files — command writes them fresh and exits 1 (the expected
    // candidate_gate diagnostic case where the gate itself fails but artifacts are produced).
    const writeScript = [
      "const fs = require('fs');",
      `fs.writeFileSync(${JSON.stringify(outputA)}, '{}\\n');`,
      `fs.writeFileSync(${JSON.stringify(outputB)}, '#ok\\n');`,
      "process.exit(1);"
    ].join(" ");

    const result = runOptionalFailingDiagnosticStage(
      "test-stage",
      "Test Stage",
      [process.execPath, "-e", writeScript],
      [outputA, outputB]
    );

    assert.equal(result.status, "passed", "freshly written artifacts + exit 1 must be reported as passed");
    assert.equal(result.exitCode, 1);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("runOptionalFailingDiagnosticStage: exit code 2 is always reported as failed regardless of artifacts", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-optional-stage-exit2-"));
  try {
    const outputA = path.join(workspace, "output-a.json");

    // Command writes the artifact but exits with code 2 (not 0 or 1).
    const writeScript = [
      "const fs = require('fs');",
      `fs.writeFileSync(${JSON.stringify(outputA)}, '{}\\n');`,
      "process.exit(2);"
    ].join(" ");

    const result = runOptionalFailingDiagnosticStage(
      "test-stage",
      "Test Stage",
      [process.execPath, "-e", writeScript],
      [outputA]
    );

    assert.equal(result.status, "failed", "exit code 2 must always be reported as failed");
    assert.equal(result.exitCode, 2);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
