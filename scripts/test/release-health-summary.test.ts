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
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  assert.equal(report.summary.status, "healthy");
  assert.equal(report.summary.blockerCount, 0);
  assert.equal(report.summary.warningCount, 0);
  assert.equal(report.summary.infoCount, 5);
  assert.deepEqual(report.summary.blockingSignalIds, []);
  assert.deepEqual(report.summary.warningSignalIds, []);
  assert.match(renderMarkdown(report), /Overall status: \*\*HEALTHY\*\*/);
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
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  assert.equal(report.summary.status, "blocking");
  assert.equal(report.summary.blockerCount > 0, true);
  assert.equal(report.summary.warningCount > 0, true);
  assert.deepEqual(report.summary.blockingSignalIds, ["release-readiness", "release-gate", "sync-governance"]);
  assert.deepEqual(report.summary.warningSignalIds, ["ci-trend", "coverage"]);
  assert.match(renderMarkdown(report), /## Blocker Findings/);
  assert.match(renderMarkdown(report), /## Warning Findings/);
  assert.match(renderMarkdown(report), /Upload receipt mismatch\./);
  assert.match(renderMarkdown(report), /Coverage thresholds failed in 1 scope\(s\)\./);
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
    assert.equal(resolved.ciTrendSummaryPath?.endsWith("artifacts/release-readiness/ci-trend-summary.json"), true);
    assert.equal(resolved.syncGovernancePath?.endsWith("artifacts/release-readiness/sync-governance-matrix-abc123.json"), true);
    assert.equal(resolved.coverageSummaryPath?.endsWith(".coverage/summary.json"), true);
  } finally {
    process.chdir(previousCwd);
  }
});
