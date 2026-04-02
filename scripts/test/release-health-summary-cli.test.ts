import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-release-health-cli-"));
}

function runReleaseHealthSummary(args: string[]) {
  return spawnSync("node", ["--import", "tsx", "./scripts/release-health-summary.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function createDashboard(overrides?: {
  decision?: "ready" | "pending" | "blocked";
  summary?: string;
  candidateRevision?: string;
}) {
  return {
    generatedAt: "2026-03-30T12:00:00.000Z",
    goNoGo: {
      decision: overrides?.decision ?? "ready",
      summary: overrides?.summary ?? "Candidate is release-ready.",
      candidateRevision: overrides?.candidateRevision ?? "abc1234",
      requiredFailed: 0,
      requiredPending: 0,
      blockers: [],
      pending: []
    }
  };
}

test("release:health:summary exits 0 for a healthy report", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessPath = path.join(workspace, "release-readiness-pass.json");
  const releaseGateSummaryPath = path.join(workspace, "release-gate-summary-pass.json");
  const ciTrendSummaryPath = path.join(workspace, "ci-trend-summary-pass.json");
  const coverageSummaryPath = path.join(workspace, "summary.json");
  const syncGovernancePath = path.join(workspace, "sync-governance-pass.json");
  const outputPath = path.join(workspace, "release-health-summary.json");
  const markdownOutputPath = path.join(workspace, "release-health-summary.md");

  writeJson(releaseReadinessPath, {
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(releaseGateSummaryPath, {
    summary: { status: "passed", failedGateIds: [] },
    gates: [{ id: "release-readiness", status: "passed", summary: "ok" }]
  });
  writeJson(ciTrendSummaryPath, {
    summary: { overallStatus: "passed", totalFindings: 0, newFindings: 0, ongoingFindings: 0, recoveredFindings: 0 },
    runtime: { findings: [] },
    releaseGate: { findings: [] }
  });
  writeJson(coverageSummaryPath, [
    {
      scope: "shared",
      lineThreshold: 90,
      branchThreshold: 70,
      functionThreshold: 90,
      metrics: { lines: 95, branches: 80, functions: 96 },
      failures: []
    }
  ]);
  writeJson(syncGovernancePath, {
    execution: { status: "passed" },
    summary: { passed: 2, failed: 0, skipped: 0 },
    scenarios: [{ id: "room-push-redaction", status: "passed" }]
  });

  const result = runReleaseHealthSummary([
    "--release-readiness",
    releaseReadinessPath,
    "--release-gate-summary",
    releaseGateSummaryPath,
    "--ci-trend-summary",
    ciTrendSummaryPath,
    "--coverage-summary",
    coverageSummaryPath,
    "--sync-governance",
    syncGovernancePath,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Wrote release health JSON summary:/);
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(markdownOutputPath), true);
});

test("release:health:summary exits 1 when release readiness is blocking", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessPath = path.join(workspace, "release-readiness-fail.json");
  const releaseGateSummaryPath = path.join(workspace, "release-gate-summary-pass.json");
  const outputPath = path.join(workspace, "release-health-summary.json");
  const markdownOutputPath = path.join(workspace, "release-health-summary.md");

  writeJson(releaseReadinessPath, {
    summary: { status: "failed", requiredFailed: 1, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "failed" }]
  });
  writeJson(releaseGateSummaryPath, {
    summary: { status: "passed", failedGateIds: [] },
    gates: [{ id: "release-readiness", status: "passed", summary: "ok" }]
  });

  const result = runReleaseHealthSummary([
    "--release-readiness",
    releaseReadinessPath,
    "--release-gate-summary",
    releaseGateSummaryPath,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath
  ]);

  assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.equal(fs.existsSync(outputPath), true);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as { summary: { status: string; blockingSignalIds: string[] } };
  assert.equal(report.summary.status, "blocking");
  assert.deepEqual(report.summary.blockingSignalIds, ["release-readiness"]);
});

test("release:health:summary exits 1 when sync governance is blocking", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessPath = path.join(workspace, "release-readiness-pass.json");
  const releaseGateSummaryPath = path.join(workspace, "release-gate-summary-pass.json");
  const syncGovernancePath = path.join(workspace, "sync-governance-fail.json");
  const outputPath = path.join(workspace, "release-health-summary.json");
  const markdownOutputPath = path.join(workspace, "release-health-summary.md");

  writeJson(releaseReadinessPath, {
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(releaseGateSummaryPath, {
    summary: { status: "passed", failedGateIds: [] },
    gates: [{ id: "release-readiness", status: "passed", summary: "ok" }]
  });
  writeJson(syncGovernancePath, {
    execution: { status: "failed" },
    summary: { passed: 1, failed: 1, skipped: 0 },
    scenarios: [{ id: "battle-reconnect-turn-resume", status: "failed" }]
  });

  const result = runReleaseHealthSummary([
    "--release-readiness",
    releaseReadinessPath,
    "--release-gate-summary",
    releaseGateSummaryPath,
    "--sync-governance",
    syncGovernancePath,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath
  ]);

  assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as { summary: { status: string; blockingSignalIds: string[] } };
  assert.equal(report.summary.status, "blocking");
  assert.deepEqual(report.summary.blockingSignalIds, ["sync-governance"]);
});

test("release:health:summary accepts candidate readiness dashboard trend inputs", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessPath = path.join(workspace, "release-readiness-pass.json");
  const releaseGateSummaryPath = path.join(workspace, "release-gate-summary-pass.json");
  const dashboardPath = path.join(workspace, "release-readiness-dashboard.json");
  const previousDashboardPath = path.join(workspace, "release-readiness-dashboard-prev.json");
  const ciTrendSummaryPath = path.join(workspace, "ci-trend-summary-pass.json");
  const coverageSummaryPath = path.join(workspace, "summary.json");
  const syncGovernancePath = path.join(workspace, "sync-governance-pass.json");
  const outputPath = path.join(workspace, "release-health-summary.json");
  const markdownOutputPath = path.join(workspace, "release-health-summary.md");

  writeJson(releaseReadinessPath, {
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(releaseGateSummaryPath, {
    summary: { status: "passed", failedGateIds: [] },
    gates: [{ id: "release-readiness", status: "passed", summary: "ok" }]
  });
  writeJson(
    dashboardPath,
    createDashboard({
      decision: "blocked",
      summary: "Candidate is blocked by stale evidence.",
      candidateRevision: "cur1234"
    })
  );
  writeJson(previousDashboardPath, createDashboard({ decision: "ready", candidateRevision: "prev9876" }));
  writeJson(ciTrendSummaryPath, {
    summary: { overallStatus: "passed", totalFindings: 0, newFindings: 0, ongoingFindings: 0, recoveredFindings: 0 },
    runtime: { findings: [] },
    releaseGate: { findings: [] }
  });
  writeJson(coverageSummaryPath, [
    {
      scope: "shared",
      lineThreshold: 90,
      branchThreshold: 70,
      functionThreshold: 90,
      metrics: { lines: 95, branches: 80, functions: 96 },
      failures: []
    }
  ]);
  writeJson(syncGovernancePath, {
    execution: { status: "passed" },
    summary: { passed: 2, failed: 0, skipped: 0 },
    scenarios: [{ id: "room-push-redaction", status: "passed" }]
  });

  const result = runReleaseHealthSummary([
    "--release-readiness",
    releaseReadinessPath,
    "--release-gate-summary",
    releaseGateSummaryPath,
    "--ci-trend-summary",
    ciTrendSummaryPath,
    "--coverage-summary",
    coverageSummaryPath,
    "--sync-governance",
    syncGovernancePath,
    "--release-readiness-dashboard",
    dashboardPath,
    "--previous-release-readiness-dashboard",
    previousDashboardPath,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath
  ]);

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; warningSignalIds: string[] };
    signals: Array<{ id: string; summary: string }>;
  };
  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.equal(report.summary.status, "warning");
  assert.equal(report.summary.warningSignalIds.includes("readiness-trend"), true);
  assert.match(report.signals.find((signal) => signal.id === "readiness-trend")?.summary ?? "", /regressed from ready/);
  assert.match(markdown, /### Warnings \(1\)/);
  assert.match(markdown, /\*\*Candidate readiness trend\*\*: Candidate readiness regressed from ready at prev9876 to blocked at cur1234\./);
  assert.match(
    markdown,
    /Next step: Open `.*release-readiness-dashboard\.json` and `.*release-readiness-dashboard-prev\.json` to compare the candidate blockers or pending checks before advancing the next revision\./
  );
  assert.match(
    markdown,
    /Artifacts: `.*release-readiness-dashboard\.json`, `.*release-readiness-dashboard-prev\.json`/
  );
  assert.match(markdown, /### Candidate readiness trend/);
  assert.match(markdown, /- Summary: Candidate readiness regressed from ready at prev9876 to blocked at cur1234\./);
  assert.match(markdown, /current=cur1234:blocked/);
  assert.match(markdown, /previous=prev9876:ready/);
});

test("CI workflow wires same-repo PR history artifacts into readiness trend deltas", () => {
  const workflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(
    workflow,
    /- name: Resolve previous successful history baseline\s+if: \|\s+github\.event_name == 'pull_request' &&\s+github\.event\.pull_request\.head\.repo\.full_name == github\.repository\s+id: history-baseline\s+uses: actions\/github-script@v7/s
  );
  assert.match(
    workflow,
    /- name: Download previous release-readiness history artifact\s+if: steps\.history-baseline\.outputs\.run-id != ''\s+continue-on-error: true\s+uses: actions\/download-artifact@v4\s+with:\s+github-token: \$\{\{ github\.token \}\}\s+repository: \$\{\{ github\.repository \}\}\s+run-id: \$\{\{ steps\.history-baseline\.outputs\.run-id \}\}\s+name: release-readiness-history\s+path: \$\{\{ runner\.temp \}\}\/baseline/s
  );
  assert.match(
    workflow,
    /if \[\[ -f "\$\{RUNNER_TEMP\}\/baseline\/release-readiness-dashboard\.json" \]\]; then\s+args\+=\(--previous-release-readiness-dashboard "\$\{RUNNER_TEMP\}\/baseline\/release-readiness-dashboard\.json"\)\s+fi/s
  );
});
