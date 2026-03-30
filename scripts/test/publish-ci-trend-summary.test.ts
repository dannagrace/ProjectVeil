import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCiTrendSummaryReport, renderCiTrendSummaryMarkdown } from "../publish-ci-trend-summary.ts";

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-ci-trend-summary-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createRuntimeReport(overrides?: {
  generatedAt?: string;
  currentFailedCheckIds?: string[];
  actionStatus?: "passed" | "failed";
  actionActual?: number;
  errorStatus?: "passed" | "failed";
  errorActual?: string;
}) {
  return {
    schemaVersion: 1,
    generatedAt: overrides?.generatedAt ?? "2026-03-30T02:00:00.000Z",
    baseline: {
      baselineId: "server-runtime-regression",
      title: "Runtime baseline",
      path: "/tmp/runtime-baseline.json"
    },
    artifact: {
      path: "/tmp/runtime-current.json",
      revision: {
        commit: "cur",
        shortCommit: "cur",
        branch: "feature",
        dirty: false
      }
    },
    summary: {
      status:
        (overrides?.currentFailedCheckIds ?? ["reconnect:actionsPerSecond"]).length > 0 ? "failed" : "passed",
      totalChecks: 2,
      passedChecks: 2 - (overrides?.currentFailedCheckIds ?? ["reconnect:actionsPerSecond"]).length,
      failedChecks: (overrides?.currentFailedCheckIds ?? ["reconnect:actionsPerSecond"]).length,
      failedCheckIds: overrides?.currentFailedCheckIds ?? ["reconnect:actionsPerSecond"]
    },
    scenarios: [
      {
        scenario: "reconnect",
        status:
          (overrides?.currentFailedCheckIds ?? ["reconnect:actionsPerSecond"]).length > 0 ? "failed" : "passed",
        checks: [
          {
            id: "reconnect:actionsPerSecond",
            metric: "actionsPerSecond",
            status: overrides?.actionStatus ?? "failed",
            threshold: {
              kind: "min",
              value: 100
            },
            actual: overrides?.actionActual ?? 91,
            sourcePath: "actionsPerSecond",
            message: `reconnect actionsPerSecond should be at least 100; received ${overrides?.actionActual ?? 91}.`
          },
          {
            id: "reconnect:errorMessage",
            metric: "errorMessage",
            status: overrides?.errorStatus ?? "passed",
            threshold: {
              kind: "empty",
              value: ""
            },
            actual: overrides?.errorActual ?? "",
            sourcePath: "errorMessage",
            message:
              (overrides?.errorStatus ?? "passed") === "failed"
                ? `reconnect reported error: ${overrides?.errorActual ?? "timeout"}.`
                : "reconnect reported no scenario error."
          }
        ]
      }
    ]
  };
}

function createReleaseGateReport(overrides?: {
  generatedAt?: string;
  releaseReadinessStatus?: "passed" | "failed";
  wechatStatus?: "passed" | "failed";
}) {
  const releaseReadinessStatus = overrides?.releaseReadinessStatus ?? "passed";
  const wechatStatus = overrides?.wechatStatus ?? "failed";
  const failedGateIds = [
    ...(releaseReadinessStatus === "failed" ? ["release-readiness"] : []),
    ...(wechatStatus === "failed" ? ["wechat-release"] : [])
  ];

  return {
    schemaVersion: 1,
    generatedAt: overrides?.generatedAt ?? "2026-03-30T03:00:00.000Z",
    revision: {
      commit: "cur",
      shortCommit: "cur",
      branch: "feature",
      dirty: false
    },
    summary: {
      status: failedGateIds.length > 0 ? "failed" : "passed",
      totalGates: 3,
      passedGates: 3 - failedGateIds.length,
      failedGates: failedGateIds.length,
      failedGateIds
    },
    inputs: {},
    gates: [
      {
        id: "release-readiness",
        label: "Release readiness snapshot",
        status: releaseReadinessStatus,
        summary:
          releaseReadinessStatus === "failed"
            ? "Snapshot is not release-ready: missing evidence."
            : "Snapshot passed.",
        failures: releaseReadinessStatus === "failed" ? ["missing evidence"] : []
      },
      {
        id: "h5-release-candidate-smoke",
        label: "H5 packaged RC smoke",
        status: "passed",
        summary: "H5 smoke passed.",
        failures: []
      },
      {
        id: "wechat-release",
        label: "WeChat release validation",
        status: wechatStatus,
        summary:
          wechatStatus === "failed"
            ? "WeChat RC validation failed: reconnect-recovery"
            : "WeChat RC validation passed.",
        failures: wechatStatus === "failed" ? ["reconnect-recovery"] : [],
        source: {
          kind: "wechat-rc-validation",
          path: "/tmp/wechat-current.json"
        }
      }
    ]
  };
}

test("buildCiTrendSummaryReport compares current and previous artifacts with stable finding ids", () => {
  const workspace = createTempWorkspace();
  const currentRuntimePath = path.join(workspace, "runtime-current.json");
  const previousRuntimePath = path.join(workspace, "runtime-previous.json");
  const currentReleaseGatePath = path.join(workspace, "release-gate-current.json");
  const previousReleaseGatePath = path.join(workspace, "release-gate-previous.json");

  writeJson(currentRuntimePath, createRuntimeReport());
  writeJson(
    previousRuntimePath,
    createRuntimeReport({
      generatedAt: "2026-03-29T02:00:00.000Z",
      currentFailedCheckIds: ["reconnect:errorMessage"],
      actionStatus: "passed",
      actionActual: 103,
      errorStatus: "failed",
      errorActual: "timeout"
    })
  );
  writeJson(currentReleaseGatePath, createReleaseGateReport());
  writeJson(
    previousReleaseGatePath,
    createReleaseGateReport({
      generatedAt: "2026-03-29T03:00:00.000Z",
      releaseReadinessStatus: "failed",
      wechatStatus: "passed"
    })
  );

  const report = buildCiTrendSummaryReport({
    runtimeReportPath: currentRuntimePath,
    previousRuntimeReportPath: previousRuntimePath,
    releaseGateReportPath: currentReleaseGatePath,
    previousReleaseGateReportPath: previousReleaseGatePath
  });

  assert.equal(report.summary.overallStatus, "failed");
  assert.equal(report.summary.newFindings, 2);
  assert.equal(report.summary.ongoingFindings, 0);
  assert.equal(report.summary.recoveredFindings, 2);
  assert.deepEqual(report.summary.findingIds, [
    "runtime:reconnect:actionsPerSecond",
    "runtime:reconnect:errorMessage",
    "release-gate:release-readiness",
    "release-gate:wechat-release"
  ]);
  assert.deepEqual(report.runtime?.summary.totals, { new: 1, ongoing: 0, recovered: 1 });
  assert.deepEqual(report.releaseGate?.summary.totals, { new: 1, ongoing: 0, recovered: 1 });

  const markdown = renderCiTrendSummaryMarkdown(report);
  assert.match(markdown, /Overall status: \*\*FAILED\*\*/);
  assert.match(markdown, /NEW reconnect:actionsPerSecond/);
  assert.match(markdown, /RECOVERED release-readiness/);
});

test("buildCiTrendSummaryReport treats current failures as new when no previous artifact is provided", () => {
  const workspace = createTempWorkspace();
  const currentRuntimePath = path.join(workspace, "runtime-current.json");

  writeJson(currentRuntimePath, createRuntimeReport());

  const report = buildCiTrendSummaryReport({
    runtimeReportPath: currentRuntimePath
  });

  assert.equal(report.summary.totalFindings, 1);
  assert.equal(report.summary.newFindings, 1);
  assert.equal(report.summary.ongoingFindings, 0);
  assert.equal(report.summary.recoveredFindings, 0);
  assert.equal(report.runtime?.findings[0]?.id, "runtime:reconnect:actionsPerSecond");
});
