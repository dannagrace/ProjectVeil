import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
  assert.match(report.artifacts.cocosBundlePath ?? "", /cocos-rc-evidence-bundle-phase1-mainline-/);
  assert.match(report.artifacts.runtimeObservabilityGatePath ?? "", /runtime-observability-gate-phase1-mainline-/);
  assert.match(report.artifacts.sameRevisionEvidenceBundleManifestPath ?? "", /phase1-same-revision-evidence-bundle-phase1-mainline-/);
  assert.match(report.artifacts.phase1ReleaseEvidenceDriftGatePath ?? "", /phase1-release-evidence-drift-gate-phase1-mainline-/);
  assert.match(report.artifacts.manualEvidenceLedgerPath ?? "", /manual-release-evidence-owner-ledger-phase1-mainline-/);
  assert.match(report.artifacts.releaseReadinessDashboardPath ?? "", /release-readiness-dashboard-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceAuditPath ?? "", /candidate-evidence-audit-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceFreshnessGuardPath ?? "", /candidate-evidence-freshness-guard-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceFreshnessGuardMarkdownPath ?? "", /candidate-evidence-freshness-guard-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceOwnerReminderPath ?? "", /candidate-evidence-owner-reminder-report-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceOwnerReminderMarkdownPath ?? "", /candidate-evidence-owner-reminder-report-phase1-mainline-/);
  assert.match(report.artifacts.candidateEvidenceFreshnessHistoryPath ?? "", /candidate-evidence-freshness-history-phase1-mainline\.json/);
  assert.match(report.artifacts.releaseEvidenceIndexPath ?? "", /current-release-evidence-index-phase1-mainline-/);
  assert.match(report.artifacts.releaseGateSummaryPath ?? "", /release-gate-summary-/);
  assert.match(report.artifacts.releaseHealthSummaryPath ?? "", /release-health-summary-/);
  assert.match(report.artifacts.ciTrendSummaryPath ?? "", /ci-trend-summary-phase1-mainline-/);
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

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# Phase 1 Candidate Rehearsal/);
  assert.match(markdown, /Release gate summary: `passed`/);
  assert.match(markdown, /Phase 1 dossier summary: `passed`/);
  assert.match(markdown, /## Reviewer Front Door/);
  assert.match(markdown, /canonical packet-level reviewer entrypoint from `SUMMARY\.md`/);
  assert.match(markdown, /Current release evidence index:/);
  assert.match(markdown, /Release gate summary:/);
  assert.match(markdown, /Release health summary:/);
  assert.match(markdown, /CI trend summary:/);
  assert.match(markdown, /Release readiness snapshot:/);
  assert.match(markdown, new RegExp(`- Runtime observability gate: \`${escapeRegex(report.artifacts.runtimeObservabilityGatePath ?? "")}\``));
  assert.match(markdown, /H5 candidate smoke:/);
  assert.match(markdown, /Reconnect soak summary:/);
  assert.match(markdown, /WeChat candidate summary:/);
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
  assert.match(markdown, /cocosBundlePath:/);
  assert.match(markdown, /candidateEvidenceAuditPath:/);
  assert.match(markdown, /candidateEvidenceFreshnessGuardPath:/);
  assert.match(markdown, /candidateEvidenceOwnerReminderPath:/);
  assert.match(markdown, /candidateEvidenceFreshnessHistoryPath:/);
  assert.match(markdown, /releaseEvidenceIndexPath:/);
  assert.match(markdown, /releaseGateSummaryPath:/);
  assert.match(markdown, /releaseHealthSummaryPath:/);
  assert.match(markdown, /ciTrendSummaryPath:/);
  assert.match(markdown, /releaseReadinessSnapshotPath:/);
  assert.match(markdown, /stableH5SmokePath:/);
  assert.match(markdown, /stableReconnectSoakPath:/);
  assert.match(markdown, /wechatCandidateSummaryPath:/);
  assert.match(markdown, /wechatCandidateMarkdownPath:/);
  assert.match(markdown, /runtimeObservabilityBundlePath:/);
  assert.match(markdown, /runtimeObservabilityEvidencePath:/);
  assert.match(markdown, /runtimeObservabilityGatePath:/);
  assert.match(markdown, /sameRevisionEvidenceBundleManifestPath:/);
  assert.match(markdown, /phase1ReleaseEvidenceDriftGatePath:/);
  assert.match(markdown, /phase1ExitAuditPath:/);
  assert.match(markdown, /phase1ExitDossierFreshnessGatePath:/);
  assert.match(markdown, /phase1CandidateDossierMarkdownPath:/);
  assert.match(markdown, /goNoGoPacketPath:/);
  assert.match(markdown, /releasePrCommentPath:/);
});
