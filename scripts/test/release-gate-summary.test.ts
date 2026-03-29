import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReleaseGateSummaryReport,
  evaluateWechatGate,
  renderMarkdown
} from "../release-gate-summary.ts";

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-release-gate-summary-"));
}

test("buildReleaseGateSummaryReport marks all gates passed when snapshot, H5 smoke, and WeChat validation pass", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const wechatArtifactsDir = path.join(workspace, "artifacts", "wechat-release");
  const wechatRcValidationPath = path.join(wechatArtifactsDir, "codex.wechat.rc-validation-report.json");

  writeJson(snapshotPath, {
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    },
    checks: [
      {
        id: "e2e-smoke",
        required: true,
        status: "passed"
      }
    ]
  });
  writeJson(h5SmokePath, {
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
  writeJson(wechatRcValidationPath, {
    summary: {
      status: "passed",
      failedChecks: 0,
      failureSummary: []
    }
  });

  const report = buildReleaseGateSummaryReport(
    {
      snapshotPath,
      h5SmokePath,
      wechatArtifactsDir
    },
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  assert.equal(report.summary.status, "passed");
  assert.deepEqual(report.summary.failedGateIds, []);
  assert.equal(report.gates.every((gate) => gate.status === "passed"), true);
  assert.match(renderMarkdown(report), /Overall status: \*\*PASSED\*\*/);
});

test("buildReleaseGateSummaryReport fails when required evidence is pending or missing", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-fail.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const wechatSmokeReportPath = path.join(workspace, "artifacts", "wechat-release", "codex.wechat.smoke-report.json");

  writeJson(snapshotPath, {
    summary: {
      status: "pending",
      requiredFailed: 0,
      requiredPending: 1
    },
    checks: [
      {
        id: "e2e-multiplayer-smoke",
        required: true,
        status: "pending"
      }
    ]
  });
  writeJson(h5SmokePath, {
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
  writeJson(wechatSmokeReportPath, {
    execution: {
      result: "passed"
    },
    cases: [
      {
        id: "login-lobby",
        required: true,
        status: "passed"
      },
      {
        id: "reconnect-recovery",
        required: true,
        status: "pending"
      }
    ]
  });

  const report = buildReleaseGateSummaryReport(
    {
      snapshotPath,
      h5SmokePath,
      wechatSmokeReportPath
    },
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  assert.equal(report.summary.status, "failed");
  assert.deepEqual(report.summary.failedGateIds, ["release-readiness", "wechat-release"]);
  assert.match(report.gates[0]?.summary ?? "", /not release-ready/);
  assert.match(report.gates[2]?.summary ?? "", /failed/i);
});

test("evaluateWechatGate prefers RC validation and falls back to smoke report", () => {
  const workspace = createTempWorkspace();
  const wechatSmokeReportPath = path.join(workspace, "codex.wechat.smoke-report.json");

  writeJson(wechatSmokeReportPath, {
    execution: {
      result: "passed"
    },
    cases: [
      {
        id: "login-lobby",
        required: true,
        status: "passed"
      }
    ]
  });

  const smokeGate = evaluateWechatGate(undefined, wechatSmokeReportPath);
  assert.equal(smokeGate.status, "passed");
  assert.equal(smokeGate.source?.kind, "wechat-smoke-report");
});
