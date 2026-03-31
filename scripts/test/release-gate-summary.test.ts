import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildConfigChangeRiskSummary,
  buildReleaseGateSummaryReport,
  evaluatePhase1EvidenceConsistencyGate,
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
    generatedAt: "2026-03-29T08:30:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
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
    generatedAt: "2026-03-29T08:32:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
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
    generatedAt: "2026-03-29T08:35:00.000Z",
    commit: "abc123",
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
  assert.equal(report.summary.totalGates, 4);
  assert.equal(report.gates.every((gate) => gate.status === "passed"), true);
  assert.equal(report.gates[3]?.id, "phase1-evidence-consistency");
  assert.equal(report.configChangeRisk.status, "available");
  assert.equal(report.configChangeRisk.overallRisk, "high");
  assert.equal(report.configChangeRisk.recommendRehearsal, true);
  assert.match(report.configChangeRisk.summary, /最高风险 HIGH/);
  assert.match(renderMarkdown(report), /Overall status: \*\*PASSED\*\*/);
  assert.match(renderMarkdown(report), /Config Change Risk Summary/);
  assert.match(renderMarkdown(report), /Recommend rehearsal: yes/);
});

test("buildReleaseGateSummaryReport reports blocked WeChat device evidence distinctly from failures", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-fail.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const wechatSmokeReportPath = path.join(workspace, "artifacts", "wechat-release", "codex.wechat.smoke-report.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-03-29T08:30:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
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
    generatedAt: "2026-03-29T08:32:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
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
    artifact: {
      sourceRevision: "abc123"
    },
    execution: {
      executedAt: "2026-03-29T08:40:00.000Z",
      result: "blocked"
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
        status: "blocked"
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
  assert.match(report.gates[2]?.summary ?? "", /blocked/i);
  assert.match(report.gates[2]?.failures.join("\n") ?? "", /blocked pending device evidence|WeChat smoke case is blocked/);
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

test("evaluatePhase1EvidenceConsistencyGate fails stale or mismatched candidate evidence", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const wechatRcValidationPath = path.join(workspace, "artifacts", "wechat-release", "codex.wechat.rc-validation-report.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-03-29T08:30:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    }
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-03-29T08:32:00.000Z",
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbee",
      branch: "test-branch",
      dirty: false
    },
    execution: {
      status: "passed",
      finishedAt: "2026-03-29T08:32:00.000Z",
      exitCode: 0
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0
    }
  });
  writeJson(wechatRcValidationPath, {
    generatedAt: "2026-03-29T08:35:00.000Z",
    commit: "abc123",
    summary: {
      status: "passed",
      failedChecks: 0,
      failureSummary: []
    }
  });

  const gate = evaluatePhase1EvidenceConsistencyGate(
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    snapshotPath,
    h5SmokePath,
    wechatRcValidationPath,
    undefined
  );

  assert.equal(gate.status, "failed");
  assert.match(gate.summary, /Phase 1 evidence drift detected/);
  assert.match(gate.failures.join("\n"), /stale for H5 packaged RC smoke/);
  assert.match(gate.failures.join("\n"), /commit mismatch/);
});

test("buildReleaseGateSummaryReport fails when all artifacts are stale for the current candidate", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const wechatRcValidationPath = path.join(workspace, "artifacts", "wechat-release", "codex.wechat.rc-validation-report.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-03-29T08:30:00.000Z",
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbee",
      branch: "test-branch",
      dirty: false
    },
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    }
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-03-29T08:32:00.000Z",
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbee",
      branch: "test-branch",
      dirty: false
    },
    execution: {
      status: "passed",
      finishedAt: "2026-03-29T08:32:00.000Z",
      exitCode: 0
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0
    }
  });
  writeJson(wechatRcValidationPath, {
    generatedAt: "2026-03-29T08:35:00.000Z",
    commit: "deadbeef",
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
      wechatRcValidationPath
    },
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  assert.equal(report.summary.status, "failed");
  assert.deepEqual(report.summary.failedGateIds, ["phase1-evidence-consistency"]);
  assert.match(report.gates[3]?.summary ?? "", /artifact commit deadbeef does not match candidate abc123/);
  assert.match(renderMarkdown(report), /Phase 1 evidence consistency/);
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
