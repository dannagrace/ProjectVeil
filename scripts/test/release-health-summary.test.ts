import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReleaseHealthSummaryReport, renderMarkdown, resolveInputPaths } from "../release-health-summary.ts";

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-release-health-summary-"));
}

function createDashboard(overrides?: {
  generatedAt?: string;
  decision?: "ready" | "pending" | "blocked";
  summary?: string;
  candidateRevision?: string;
}) {
  return {
    generatedAt: overrides?.generatedAt ?? "2026-03-30T12:00:00.000Z",
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

const TEST_REVISION = {
  commit: "abc123",
  shortCommit: "abc123",
  branch: "test-branch",
  dirty: false
} as const;

test("buildReleaseHealthSummaryReport aggregates passing artifacts into a healthy summary", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const releaseGateSummaryPath = path.join(workspace, "artifacts", "release-readiness", "release-gate-summary.json");
  const ciTrendSummaryPath = path.join(workspace, "artifacts", "release-readiness", "ci-trend-summary.json");
  const coverageSummaryPath = path.join(workspace, ".coverage", "summary.json");
  const syncGovernancePath = path.join(workspace, "artifacts", "release-readiness", "sync-governance-matrix-pass.json");

  writeJson(releaseReadinessPath, {
    generatedAt: "2026-03-30T08:00:00.000Z",
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    },
    checks: [
      { id: "npm-test", required: true, status: "passed" },
      { id: "typecheck-ci", required: true, status: "passed" }
    ]
  });
  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-03-30T08:05:00.000Z",
    summary: {
      status: "passed",
      failedGateIds: []
    },
    gates: [
      { id: "release-readiness", status: "passed", summary: "ok" },
      { id: "h5-release-candidate-smoke", status: "passed", summary: "ok" },
      { id: "wechat-release", status: "passed", summary: "ok" }
    ]
  });
  writeJson(ciTrendSummaryPath, {
    generatedAt: "2026-03-30T08:10:00.000Z",
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
      metrics: { lines: 92.1, branches: 74.5, functions: 94.2 },
      failures: []
    }
  ]);
  writeJson(syncGovernancePath, {
    generatedAt: "2026-03-30T08:15:00.000Z",
    execution: { status: "passed" },
    summary: { passed: 4, failed: 0, skipped: 0 },
    scenarios: [{ id: "room-push-redaction", status: "passed" }]
  });

  const report = buildReleaseHealthSummaryReport(
    {
      releaseReadinessPath,
      releaseGateSummaryPath,
      ciTrendSummaryPath,
      coverageSummaryPath,
      syncGovernancePath
    },
    TEST_REVISION
  );

  assert.equal(report.summary.status, "healthy");
  assert.equal(report.summary.blockerCount, 0);
  assert.equal(report.summary.warningCount, 0);
  assert.equal(report.summary.infoCount, 5);
  assert.deepEqual(report.summary.blockingSignalIds, []);
  assert.deepEqual(report.summary.warningSignalIds, []);
  assert.deepEqual(report.triage.blockers, []);
  assert.deepEqual(report.triage.warnings, []);
  assert.match(renderMarkdown(report), /Overall status: \*\*HEALTHY\*\*/);
  assert.match(renderMarkdown(report), /## Triage/);
  assert.match(renderMarkdown(report), /### Blockers \(0\)/);
  assert.match(renderMarkdown(report), /Coverage thresholds passed in 1 scope\(s\)\./);
});

test("buildReleaseHealthSummaryReport classifies blockers and warnings from mixed artifact health", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-fail.json");
  const releaseGateSummaryPath = path.join(workspace, "artifacts", "release-readiness", "release-gate-summary.json");
  const coverageSummaryPath = path.join(workspace, ".coverage", "summary.json");
  const syncGovernancePath = path.join(workspace, "artifacts", "release-readiness", "sync-governance-matrix-fail.json");

  writeJson(releaseReadinessPath, {
    generatedAt: "2026-03-30T09:00:00.000Z",
    summary: {
      status: "partial",
      requiredFailed: 1,
      requiredPending: 1
    },
    checks: [
      { id: "npm-test", required: true, status: "failed" },
      { id: "e2e-smoke", required: true, status: "pending" }
    ]
  });
  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-03-30T09:05:00.000Z",
    summary: {
      status: "failed",
      failedGateIds: ["wechat-release"]
    },
    gates: [
      {
        id: "wechat-release",
        status: "failed",
        summary: "WeChat validation failed",
        failures: ["Upload receipt mismatch."]
      }
    ]
  });
  writeJson(coverageSummaryPath, [
    {
      scope: "server",
      lineThreshold: 75,
      branchThreshold: 65,
      functionThreshold: 75,
      metrics: { lines: 74.5, branches: 70, functions: 76 },
      failures: [{ metric: "lines", actual: 74.5, threshold: 75 }]
    }
  ]);
  writeJson(syncGovernancePath, {
    generatedAt: "2026-03-30T09:10:00.000Z",
    execution: { status: "failed" },
    summary: { passed: 3, failed: 1, skipped: 0 },
    scenarios: [{ id: "battle-reconnect-turn-resume", status: "failed" }]
  });

  const report = buildReleaseHealthSummaryReport(
    {
      releaseReadinessPath,
      releaseGateSummaryPath,
      coverageSummaryPath,
      syncGovernancePath
    },
    TEST_REVISION
  );

  assert.equal(report.summary.status, "blocking");
  assert.equal(report.summary.blockerCount > 0, true);
  assert.equal(report.summary.warningCount > 0, true);
  assert.deepEqual(report.summary.blockingSignalIds, ["release-readiness", "release-gate", "sync-governance"]);
  assert.deepEqual(report.summary.warningSignalIds, ["ci-trend", "coverage"]);
  assert.deepEqual(report.triage.blockers.map((entry) => entry.signalId), [
    "release-readiness",
    "release-gate",
    "sync-governance"
  ]);
  assert.deepEqual(report.triage.warnings.map((entry) => entry.signalId), ["ci-trend", "coverage"]);
  assert.match(report.triage.blockers[0]?.nextStep ?? "", /release-readiness/);
  assert.match(report.triage.blockers[1]?.nextStep ?? "", /npm run validate -- wechat-rc/);
  assert.match(report.triage.warnings[1]?.summary ?? "", /server lines coverage/);
  assert.match(renderMarkdown(report), /## Blocker Findings/);
  assert.match(renderMarkdown(report), /## Warning Findings/);
  assert.match(renderMarkdown(report), /### Blockers \(3\)/);
  assert.match(renderMarkdown(report), /Next step: Open `.*release-readiness-fail\.json` and clear the unresolved required checks/);
  assert.match(renderMarkdown(report), /Next step: Open `.*release-gate-summary\.json`, rerun `npm run validate -- wechat-rc`/);
  assert.match(renderMarkdown(report), /Upload receipt mismatch\./);
  assert.match(renderMarkdown(report), /Coverage thresholds failed in 1 scope\(s\)\./);
});

test("buildReleaseHealthSummaryReport uses fallback details for sparse degraded artifacts", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-sparse.json");
  const releaseGateSummaryPath = path.join(workspace, "artifacts", "release-readiness", "release-gate-summary-sparse.json");
  const ciTrendSummaryPath = path.join(workspace, "artifacts", "release-readiness", "ci-trend-summary-sparse.json");
  const coverageSummaryPath = path.join(workspace, ".coverage", "summary.json");
  const syncGovernancePath = path.join(workspace, "artifacts", "release-readiness", "sync-governance-matrix-sparse.json");

  writeJson(releaseReadinessPath, {
    generatedAt: "2026-03-30T10:00:00.000Z",
    summary: {
      status: "pending",
      requiredFailed: 0,
      requiredPending: 0
    },
    checks: []
  });
  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-03-30T10:05:00.000Z",
    summary: {
      status: "failed",
      failedGateIds: []
    },
    gates: []
  });
  writeJson(ciTrendSummaryPath, {
    generatedAt: "2026-03-30T10:10:00.000Z",
    summary: {
      overallStatus: "failed",
      totalFindings: 3,
      newFindings: 0,
      ongoingFindings: 0,
      recoveredFindings: 3
    },
    runtime: { findings: [{ status: "recovered", summary: "Recovered runtime regression." }] },
    releaseGate: { findings: [] }
  });
  writeJson(coverageSummaryPath, [
    {
      scope: "client",
      lineThreshold: 85,
      branchThreshold: 70,
      functionThreshold: 85,
      metrics: null,
      failures: [{ metric: "functions", actual: null, threshold: 85 }]
    }
  ]);
  writeJson(syncGovernancePath, {
    generatedAt: "2026-03-30T10:15:00.000Z",
    execution: { status: "failed" },
    summary: { passed: 0, failed: 0, skipped: 2 },
    scenarios: [{ id: "lobby-rejoin", status: "skipped" }]
  });

  const report = buildReleaseHealthSummaryReport(
    {
      releaseReadinessPath,
      releaseGateSummaryPath,
      ciTrendSummaryPath,
      coverageSummaryPath,
      syncGovernancePath
    },
    TEST_REVISION
  );

  assert.equal(report.summary.status, "blocking");
  assert.deepEqual(report.summary.blockingSignalIds, ["release-readiness", "release-gate", "sync-governance"]);
  assert.deepEqual(report.summary.warningSignalIds, ["ci-trend", "coverage"]);
  assert.equal(report.triage.blockers.length, 3);
  assert.equal(report.triage.warnings.length, 2);
  assert.deepEqual(
    report.findings.filter((finding) => finding.severity === "blocker").map((finding) => finding.summary),
    [
      'Snapshot summary status is "pending".',
      'Release gate overall status is "failed".',
      'Sync governance execution status is "failed".'
    ]
  );
  assert.deepEqual(
    report.findings.filter((finding) => finding.severity === "warning").map((finding) => finding.summary),
    [
      'CI trend overall status is "failed".',
      "client functions coverage output is missing (floor 85%)."
    ]
  );
  assert.match(report.triage.blockers[0]?.summary ?? "", /summary status is "pending"/);
  assert.match(report.triage.blockers[2]?.summary ?? "", /execution status is "failed"/);
  assert.match(report.triage.warnings[0]?.nextStep ?? "", /compare the new or ongoing regressions/);
  assert.match(report.triage.warnings[1]?.nextStep ?? "", /npm test -- coverage:ci/);
  assert.match(renderMarkdown(report), /Snapshot summary status is "pending"\./);
  assert.match(renderMarkdown(report), /Release gate overall status is "failed"\./);
  assert.match(renderMarkdown(report), /Sync governance execution status is "failed"\./);
  assert.match(renderMarkdown(report), /client functions coverage output is missing \(floor 85%\)\./);
});

test("buildReleaseHealthSummaryReport aggregates degraded warning signals without blockers", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const releaseGateSummaryPath = path.join(workspace, "artifacts", "release-readiness", "release-gate-summary-pass.json");
  const ciTrendSummaryPath = path.join(workspace, "artifacts", "release-readiness", "ci-trend-summary-degraded.json");
  const coverageSummaryPath = path.join(workspace, ".coverage", "summary.json");
  const syncGovernancePath = path.join(workspace, "artifacts", "release-readiness", "sync-governance-matrix-pass.json");

  writeJson(releaseReadinessPath, {
    generatedAt: "2026-03-30T11:00:00.000Z",
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-03-30T11:05:00.000Z",
    summary: {
      status: "passed",
      failedGateIds: []
    },
    gates: [{ id: "wechat-release", status: "passed", summary: "ok" }]
  });
  writeJson(ciTrendSummaryPath, {
    generatedAt: "2026-03-30T11:10:00.000Z",
    summary: {
      overallStatus: "passed",
      totalFindings: 3,
      newFindings: 1,
      ongoingFindings: 2,
      recoveredFindings: 1
    },
    runtime: {
      findings: [
        { id: "runtime-latency", status: "new", summary: "Runtime latency regressed by 18%." },
        { id: "runtime-flake", status: "recovered", summary: "Recovered runtime flake." }
      ]
    },
    releaseGate: {
      findings: [{ id: "wechat-gate-duration", status: "ongoing", summary: "WeChat gate duration remains elevated." }]
    }
  });
  writeJson(coverageSummaryPath, [
    {
      scope: "shared",
      lineThreshold: 90,
      branchThreshold: 75,
      functionThreshold: 90,
      metrics: { lines: 88.5, branches: 72.1, functions: 93.4 },
      failures: [
        { metric: "lines", actual: 88.5, threshold: 90 },
        { metric: "branches", actual: 72.1, threshold: 75 }
      ]
    },
    {
      scope: "server",
      lineThreshold: 80,
      branchThreshold: 70,
      functionThreshold: 80,
      metrics: { lines: 82.4, branches: 73.8, functions: 81.2 },
      failures: []
    }
  ]);
  writeJson(syncGovernancePath, {
    generatedAt: "2026-03-30T11:15:00.000Z",
    execution: { status: "passed" },
    summary: { passed: 2, failed: 0, skipped: 0 },
    scenarios: [{ id: "room-push-redaction", status: "passed" }]
  });

  const report = buildReleaseHealthSummaryReport(
    {
      releaseReadinessPath,
      releaseGateSummaryPath,
      ciTrendSummaryPath,
      coverageSummaryPath,
      syncGovernancePath
    },
    TEST_REVISION
  );

  assert.equal(report.summary.status, "warning");
  assert.equal(report.summary.blockerCount, 0);
  assert.equal(report.summary.warningCount, 4);
  assert.deepEqual(report.summary.blockingSignalIds, []);
  assert.deepEqual(report.summary.warningSignalIds, ["ci-trend", "coverage"]);
  assert.deepEqual(report.triage.blockers, []);
  assert.deepEqual(report.triage.warnings.map((entry) => entry.signalId), ["ci-trend", "coverage"]);
  assert.deepEqual(
    report.findings.filter((finding) => finding.signalId === "ci-trend").map((finding) => finding.summary),
    ["Runtime latency regressed by 18%.", "WeChat gate duration remains elevated."]
  );
  assert.deepEqual(
    report.findings.filter((finding) => finding.signalId === "coverage").map((finding) => finding.summary),
    [
      "shared lines coverage is 88.50%, below the 90% floor.",
      "shared branches coverage is 72.10%, below the 75% floor."
    ]
  );
  assert.match(renderMarkdown(report), /Overall status: \*\*WARNING\*\*/);
  assert.match(renderMarkdown(report), /CI trend shows 2 active regression finding\(s\)\./);
  assert.match(renderMarkdown(report), /Coverage thresholds failed in 1 scope\(s\)\./);
});

test("buildReleaseHealthSummaryReport reports candidate readiness trend regressions across revisions", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const releaseGateSummaryPath = path.join(workspace, "artifacts", "release-readiness", "release-gate-summary-pass.json");
  const currentDashboardPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-dashboard.json");
  const previousDashboardPath = path.join(workspace, "baseline", "release-readiness-dashboard.json");

  writeJson(releaseReadinessPath, {
    generatedAt: "2026-03-30T11:00:00.000Z",
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-03-30T11:05:00.000Z",
    summary: { status: "passed", failedGateIds: [] },
    gates: [{ id: "wechat-release", status: "passed", summary: "ok" }]
  });
  writeJson(
    currentDashboardPath,
    createDashboard({
      generatedAt: "2026-03-30T12:00:00.000Z",
      decision: "blocked",
      summary: "Candidate is blocked by stale WeChat smoke evidence.",
      candidateRevision: "cur1234"
    })
  );
  writeJson(
    previousDashboardPath,
    createDashboard({
      generatedAt: "2026-03-29T12:00:00.000Z",
      decision: "ready",
      summary: "Candidate is release-ready.",
      candidateRevision: "prev9876"
    })
  );

  const report = buildReleaseHealthSummaryReport(
    {
      releaseReadinessPath,
      releaseGateSummaryPath,
      releaseReadinessDashboardPath: currentDashboardPath,
      previousReleaseReadinessDashboardPath: previousDashboardPath
    },
    TEST_REVISION
  );

  assert.equal(report.summary.status, "warning");
  assert.deepEqual(report.summary.blockingSignalIds, []);
  assert.equal(report.summary.warningSignalIds.includes("readiness-trend"), true);
  assert.equal(report.signals.some((signal) => signal.id === "readiness-trend"), true);
  assert.equal(report.triage.warnings.some((entry) => entry.signalId === "readiness-trend"), true);
  assert.deepEqual(
    report.findings.filter((finding) => finding.signalId === "readiness-trend").map((finding) => finding.summary),
    ["Candidate readiness regressed from ready at prev9876 to blocked at cur1234."]
  );
  assert.match(
    renderMarkdown(report),
    /- \*\*Candidate readiness trend\*\*: Candidate readiness regressed from ready at prev9876 to blocked at cur1234\.\n  Next step: Open `.*release-readiness-dashboard\.json` and `.*release-readiness-dashboard\.json` to compare the candidate blockers or pending checks before advancing the next revision\.\n  Artifacts: `.*release-readiness-dashboard\.json`, `.*release-readiness-dashboard\.json`/
  );
});

test("resolveInputPaths discovers the latest local artifacts", () => {
  const workspace = createTempWorkspace();
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);
    writeJson(path.join(workspace, "artifacts", "release-readiness", "release-readiness-2026-03-29T00-00-00.000Z.json"), {
      summary: { status: "passed" }
    });
    writeJson(path.join(workspace, "artifacts", "release-readiness", "release-gate-summary.json"), {
      summary: { status: "passed" }
    });
    writeJson(path.join(workspace, "artifacts", "release-readiness", "release-readiness-dashboard.json"), createDashboard());
    writeJson(path.join(workspace, "artifacts", "release-readiness", "ci-trend-summary.json"), {
      summary: { overallStatus: "passed" }
    });
    writeJson(path.join(workspace, "artifacts", "release-readiness", "sync-governance-matrix-abc123.json"), {
      execution: { status: "passed" }
    });
    writeJson(path.join(workspace, ".coverage", "summary.json"), []);

    const resolved = resolveInputPaths({});
    assert.equal(resolved.releaseReadinessPath?.endsWith("release-readiness-2026-03-29T00-00-00.000Z.json"), true);
    assert.equal(resolved.releaseGateSummaryPath?.endsWith("artifacts/release-readiness/release-gate-summary.json"), true);
    assert.equal(resolved.releaseReadinessDashboardPath?.endsWith("artifacts/release-readiness/release-readiness-dashboard.json"), true);
    assert.equal(resolved.ciTrendSummaryPath?.endsWith("artifacts/release-readiness/ci-trend-summary.json"), true);
    assert.equal(resolved.syncGovernancePath?.endsWith("artifacts/release-readiness/sync-governance-matrix-abc123.json"), true);
    assert.equal(resolved.coverageSummaryPath?.endsWith(".coverage/summary.json"), true);
  } finally {
    process.chdir(previousCwd);
  }
});
