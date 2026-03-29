import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildConfigChangeRiskSummary,
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
  const configCenterLibraryPath = path.join(workspace, "configs", ".config-center-library.json");

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
  writeJson(configCenterLibraryPath, {
    publishAuditHistory: [
      {
        id: "publish-100",
        author: "planner",
        summary: "Tune world spawn and battle formulas",
        publishedAt: "2026-03-29T08:20:00.000Z",
        resultStatus: "applied",
        changes: [
          {
            documentId: "world",
            title: "World generation",
            changeCount: 2,
            structuralChangeCount: 0,
            diffSummary: [
              {
                path: "resourceSpawn.goldChance",
                kind: "value",
                blastRadius: ["地图生成", "资源分布"]
              }
            ]
          },
          {
            documentId: "battleBalance",
            title: "Battle balance",
            changeCount: 1,
            structuralChangeCount: 0,
            diffSummary: [
              {
                path: "damage.offenseAdvantageStep",
                kind: "value",
                blastRadius: ["战斗公式"]
              }
            ]
          }
        ]
      }
    ]
  });

  const report = buildReleaseGateSummaryReport(
    {
      snapshotPath,
      h5SmokePath,
      wechatArtifactsDir,
      configCenterLibraryPath
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
  assert.equal(report.configChangeRisk.status, "available");
  assert.equal(report.configChangeRisk.overallRisk, "high");
  assert.equal(report.configChangeRisk.recommendRehearsal, true);
  assert.match(report.configChangeRisk.summary, /最高风险 HIGH/);
  assert.match(renderMarkdown(report), /Overall status: \*\*PASSED\*\*/);
  assert.match(renderMarkdown(report), /Config Change Risk Summary/);
  assert.match(renderMarkdown(report), /Recommend rehearsal: yes/);
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

test("buildConfigChangeRiskSummary uses the latest applied publish audit and maps validation actions", () => {
  const workspace = createTempWorkspace();
  const configCenterLibraryPath = path.join(workspace, "configs", ".config-center-library.json");

  writeJson(configCenterLibraryPath, {
    publishAuditHistory: [
      {
        id: "publish-failed",
        author: "dev-a",
        summary: "broken attempt",
        publishedAt: "2026-03-29T08:00:00.000Z",
        resultStatus: "failed",
        changes: [
          {
            documentId: "world",
            title: "World generation",
            changeCount: 1,
            structuralChangeCount: 0,
            diffSummary: [{ path: "width", kind: "value" }]
          }
        ]
      },
      {
        id: "publish-applied",
        author: "dev-b",
        summary: "rebalance units and recruit posts",
        publishedAt: "2026-03-29T09:00:00.000Z",
        resultStatus: "applied",
        changes: [
          {
            documentId: "mapObjects",
            title: "Map objects",
            changeCount: 4,
            structuralChangeCount: 1,
            diffSummary: [
              {
                path: "buildings[0].recruitCount",
                kind: "value",
                blastRadius: ["招募库存"]
              }
            ]
          },
          {
            documentId: "units",
            title: "Units",
            changeCount: 3,
            structuralChangeCount: 0,
            diffSummary: [
              {
                path: "templates[0].attack",
                kind: "value",
                blastRadius: ["单位数值", "战斗节奏"]
              }
            ]
          }
        ]
      }
    ]
  });

  const summary = buildConfigChangeRiskSummary(configCenterLibraryPath);

  assert.equal(summary.status, "available");
  assert.equal(summary.source?.publishId, "publish-applied");
  assert.equal(summary.overallRisk, "high");
  assert.equal(summary.recommendCanary, true);
  assert.deepEqual(summary.changes?.map((change) => change.documentId), ["mapObjects", "units"]);
  assert.match(summary.changes?.[0]?.reason ?? "", /结构变更/);
  assert.equal(summary.suggestedValidationActions?.includes("npm run validate:battle"), true);
  assert.equal(summary.impactedModules?.includes("招募库存"), true);
});
