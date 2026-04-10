import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildConfigChangeRiskSummary,
  buildReleaseGateSummaryReport,
  evaluateReconnectSoakGate,
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

function isoHoursAgo(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

test("buildReleaseGateSummaryReport marks all gates passed when snapshot, H5 smoke, and WeChat validation pass", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-pass.json");
  const manualEvidenceLedgerPath = path.join(
    workspace,
    "artifacts",
    "release-readiness",
    "manual-release-evidence-owner-ledger-abc123.md"
  );
  const wechatArtifactsDir = path.join(workspace, "artifacts", "wechat-release");
  const wechatRcValidationPath = path.join(wechatArtifactsDir, "codex.wechat.rc-validation-report.json");
  const wechatCandidateSummaryPath = path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json");
  const wechatCommercialVerificationPath = path.join(wechatArtifactsDir, "codex.wechat.commercial-verification-abc123.json");
  const configCenterLibraryPath = path.join(workspace, "configs", ".config-center-library.json");

  writeJson(snapshotPath, {
    generatedAt: isoHoursAgo(2),
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
    generatedAt: isoHoursAgo(2),
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
  writeJson(reconnectSoakPath, {
    generatedAt: isoHoursAgo(2),
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 384,
      invariantChecks: 2304
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
  writeJson(wechatRcValidationPath, {
    generatedAt: isoHoursAgo(2),
    commit: "abc123",
    summary: {
      status: "passed",
      failedChecks: 0,
      failureSummary: []
    }
  });
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: isoHoursAgo(1),
    candidate: {
      revision: "abc123",
      status: "ready"
    },
    evidence: {
      package: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatArtifactsDir, "codex.wechat.package.json")
      },
      validation: {
        status: "passed",
        summary: "ok",
        artifactPath: wechatRcValidationPath
      },
      smoke: {
        summary: "ok",
        status: "passed",
        artifactPath: path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json")
      },
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "wechat-devtools-export-review",
            title: "Candidate-scoped WeChat package install/launch verification recorded",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: isoHoursAgo(3),
            revision: "abc123",
            artifactPath: "artifacts/wechat-release/codex.wechat.install-launch-evidence.json"
          },
          {
            id: "wechat-device-runtime-review",
            title: "Physical-device WeChat runtime validated for this candidate",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: isoHoursAgo(3),
            revision: "abc123",
            artifactPath: "artifacts/wechat-release/device-runtime-review.json"
          },
          {
            id: "wechat-release-checklist",
            title: "WeChat RC checklist and blockers reviewed",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: isoHoursAgo(3),
            revision: "abc123",
            artifactPath: "artifacts/wechat-release/checklist-review.json"
          }
        ]
      }
    },
    blockers: []
  });
  writeJson(wechatCommercialVerificationPath, {
    generatedAt: isoHoursAgo(1),
    candidate: {
      revision: "abc123",
      status: "ready"
    },
    summary: {
      status: "ready",
      blockerCount: 0,
      requiredPendingChecks: 0,
      requiredFailedChecks: 0,
      requiredMetadataFailures: 0,
      acceptedRiskCount: 1,
      conclusion: "Commercial verification is ready for external launch review."
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
  fs.mkdirSync(path.dirname(manualEvidenceLedgerPath), { recursive: true });
  fs.writeFileSync(
    manualEvidenceLedgerPath,
    `# Manual Release Evidence Owner Ledger

## Candidate

- Candidate: \`rc-2026-04-02\`
- Target revision: \`abc123\`
- Release owner: \`release-oncall\`
- Last updated: \`${isoHoursAgo(3)}\`
- Linked readiness snapshot: \`artifacts/release-readiness/release-readiness-pass.json\`
`,
    "utf8"
  );

  const report = buildReleaseGateSummaryReport(
    {
      snapshotPath,
      h5SmokePath,
      reconnectSoakPath,
      wechatArtifactsDir,
      manualEvidenceLedgerPath,
      targetSurface: "wechat",
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
  assert.equal(report.triage.blockers.length, 0);
  assert.equal(report.triage.warnings.length, 1);
  assert.match(report.triage.warnings[0]?.summary ?? "", /HIGH risk/);
  assert.equal(report.summary.totalGates, 5);
  assert.equal(report.gates.every((gate) => gate.status === "passed"), true);
  assert.equal(report.gates[2]?.id, "multiplayer-reconnect-soak");
  assert.equal(report.gates[4]?.id, "phase1-evidence-consistency");
  assert.equal(report.configChangeRisk.status, "available");
  assert.equal(report.configChangeRisk.overallRisk, "high");
  assert.equal(report.configChangeRisk.recommendRehearsal, true);
  assert.match(report.configChangeRisk.summary, /最高风险 HIGH/);
  assert.match(renderMarkdown(report), /Overall status: \*\*PASSED\*\*/);
  assert.match(renderMarkdown(report), /## Selected Inputs/);
  assert.match(renderMarkdown(report), /## Triage Summary/);
  assert.match(renderMarkdown(report), /### Warnings \(1\)/);
  assert.match(renderMarkdown(report), /Config changes are HIGH risk for wechat/);
  assert.match(renderMarkdown(report), /release-readiness-pass\.json/);
  assert.match(renderMarkdown(report), /colyseus-reconnect-soak-summary-pass\.json/);
  assert.match(renderMarkdown(report), /Reconnect soak evidence is present and passing for this candidate/);
  assert.match(renderMarkdown(report), /codex\.wechat\.release-candidate-summary\.json/);
  assert.match(renderMarkdown(report), /codex\.wechat\.commercial-verification-abc123\.json/);
  assert.match(renderMarkdown(report), /manual-release-evidence-owner-ledger-abc123\.md/);
  assert.match(renderMarkdown(report), /### Manual Evidence Ownership/);
  assert.match(renderMarkdown(report), /owner=release-oncall/);
  assert.match(renderMarkdown(report), /artifact=artifacts\/wechat-release\/device-runtime-review\.json/);
  assert.match(renderMarkdown(report), /WeChat package evidence: ok \[required=yes status=passed/);
  assert.match(renderMarkdown(report), /WeChat verify evidence: ok \[required=yes status=passed/);
  assert.match(renderMarkdown(report), /WeChat smoke evidence: ok \[required=yes status=passed/);
  assert.match(
    renderMarkdown(report),
    /WeChat commercial verification: Commercial verification is ready for external launch review\. \[required=no status=passed/
  );
  assert.match(renderMarkdown(report), /Config Change Risk Summary/);
  assert.match(renderMarkdown(report), /Recommend rehearsal: yes/);
});

test("buildReleaseGateSummaryReport warns when WeChat commercial verification is missing for the current candidate", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-pass.json");
  const wechatArtifactsDir = path.join(workspace, "artifacts", "wechat-release");
  const wechatCandidateSummaryPath = path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json");

  writeJson(snapshotPath, {
    generatedAt: isoHoursAgo(1),
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
    generatedAt: isoHoursAgo(1),
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    execution: {
      status: "passed",
      exitCode: 0,
      finishedAt: isoHoursAgo(1)
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0
    }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: isoHoursAgo(1),
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 12,
      invariantChecks: 48
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
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: isoHoursAgo(1),
    candidate: {
      revision: "abc123",
      status: "ready"
    },
    evidence: {
      package: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatArtifactsDir, "codex.wechat.package.json")
      },
      validation: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatArtifactsDir, "codex.wechat.rc-validation-report.json")
      },
      smoke: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json")
      },
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: []
      }
    },
    blockers: []
  });

  const report = buildReleaseGateSummaryReport(
    {
      snapshotPath,
      h5SmokePath,
      reconnectSoakPath,
      wechatArtifactsDir,
      targetSurface: "wechat"
    },
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  assert.equal(report.summary.status, "passed");
  assert.ok(report.triage.warnings.some((entry) => entry.id === "wechat-commercial-verification:warning"));
  assert.match(
    report.triage.warnings.find((entry) => entry.id === "wechat-commercial-verification:warning")?.summary ?? "",
    /not ready for external launch review/
  );
  assert.match(renderMarkdown(report), /WeChat commercial verification: `<missing>`/);
  assert.match(
    renderMarkdown(report),
    /WeChat commercial verification: External-launch commercial verification is not attached yet\./
  );
});

test("buildReleaseGateSummaryReport discovers nested candidate rehearsal evidence for wechat surface", () => {
  const workspace = createTempWorkspace();
  const rehearsalDir = path.join(workspace, "artifacts", "release-readiness", "phase1-candidate-rehearsal-local");
  const snapshotPath = path.join(rehearsalDir, "release-readiness-phase1-mainline-abc123.json");
  const dashboardPath = path.join(rehearsalDir, "release-readiness-dashboard-phase1-mainline-abc123.json");
  const h5SmokePath = path.join(rehearsalDir, "client-release-candidate-smoke-phase1-mainline-abc123.json");
  const reconnectSoakPath = path.join(rehearsalDir, "colyseus-reconnect-soak-summary-phase1-mainline-abc123.json");
  const wechatArtifactsDir = path.join(rehearsalDir, "wechat-release-phase1-mainline-abc123");
  const wechatRcValidationPath = path.join(wechatArtifactsDir, "codex.wechat.rc-validation-report.json");
  const wechatCandidateSummaryPath = path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json");
  const wechatSmokeReportPath = path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json");

  writeJson(snapshotPath, {
    generatedAt: isoHoursAgo(1),
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
  writeJson(dashboardPath, {
    generatedAt: new Date().toISOString(),
    summary: {
      status: "warning"
    }
  });
  writeJson(h5SmokePath, {
    generatedAt: isoHoursAgo(1),
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    execution: {
      status: "passed",
      exitCode: 0,
      finishedAt: isoHoursAgo(1)
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0
    }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: isoHoursAgo(1),
    candidate: {
      name: "phase1-mainline",
      revision: "abc123"
    },
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    verdict: {
      status: "passed",
      summary: "same-revision reconnect soak ok"
    },
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 96,
      invariantChecks: 512
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
  writeJson(wechatRcValidationPath, {
    generatedAt: isoHoursAgo(1),
    commit: "abc123",
    summary: {
      status: "passed",
      failedChecks: 0,
      failureSummary: []
    }
  });
  writeJson(wechatSmokeReportPath, {
    artifact: {
      sourceRevision: "abc123"
    },
    execution: {
      executedAt: isoHoursAgo(1),
      result: "passed",
      summary: "same-revision smoke ok"
    },
    cases: [
      {
        id: "wechat-launch",
        required: true,
        status: "passed"
      }
    ]
  });
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: isoHoursAgo(1),
    candidate: {
      revision: "abc123",
      status: "ready"
    },
    evidence: {
      package: {
        status: "passed",
        summary: "package ok",
        artifactPath: path.join(wechatArtifactsDir, "codex.wechat.package.json")
      },
      validation: {
        status: "passed",
        summary: "validation ok",
        artifactPath: wechatRcValidationPath
      },
      smoke: {
        status: "passed",
        summary: "smoke ok",
        artifactPath: wechatSmokeReportPath
      },
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "wechat-devtools-export-review",
            title: "Candidate-scoped WeChat package install/launch verification recorded",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: isoHoursAgo(1),
            revision: "abc123",
            artifactPath: path.join(wechatArtifactsDir, "codex.wechat.install-launch-evidence.json")
          }
        ]
      }
    },
    blockers: []
  });

  const previousCwd = process.cwd();
  process.chdir(workspace);
  try {
    const report = buildReleaseGateSummaryReport(
      { targetSurface: "wechat" },
      {
        commit: "abc123",
        shortCommit: "abc123",
        branch: "test-branch",
        dirty: false
      }
    );

    assert.equal(report.summary.status, "passed");
    assert.deepEqual(report.summary.failedGateIds, []);
    assert.equal(report.inputs.snapshotPath && fs.realpathSync(report.inputs.snapshotPath), fs.realpathSync(snapshotPath));
    assert.equal(report.inputs.h5SmokePath && fs.realpathSync(report.inputs.h5SmokePath), fs.realpathSync(h5SmokePath));
    assert.equal(report.inputs.reconnectSoakPath && fs.realpathSync(report.inputs.reconnectSoakPath), fs.realpathSync(reconnectSoakPath));
    assert.equal(report.inputs.wechatArtifactsDir && fs.realpathSync(report.inputs.wechatArtifactsDir), fs.realpathSync(wechatArtifactsDir));
    assert.equal(
      report.inputs.wechatCandidateSummaryPath && fs.realpathSync(report.inputs.wechatCandidateSummaryPath),
      fs.realpathSync(wechatCandidateSummaryPath)
    );
    assert.equal(
      report.inputs.wechatRcValidationPath && fs.realpathSync(report.inputs.wechatRcValidationPath),
      fs.realpathSync(wechatRcValidationPath)
    );
    assert.equal(
      report.inputs.wechatSmokeReportPath && fs.realpathSync(report.inputs.wechatSmokeReportPath),
      fs.realpathSync(wechatSmokeReportPath)
    );
  } finally {
    process.chdir(previousCwd);
  }
});

test("buildReleaseGateSummaryReport marks reconnect soak evidence stale when the artifact is old for the current candidate", () => {
  const workspace = createTempWorkspace();
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-stale.json");

  writeJson(reconnectSoakPath, {
    generatedAt: "2026-03-20T08:33:00.000Z",
    candidate: {
      name: "phase1-rc",
      revision: "abc123"
    },
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 384,
      invariantChecks: 2304
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

  const report = buildReleaseGateSummaryReport(
    {
      reconnectSoakPath,
      targetSurface: "h5"
    },
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  const reconnectEvidence = report.releaseSurface.evidence.find((entry) => entry.id === "multiplayer-reconnect-soak");
  assert.equal(reconnectEvidence?.summary, "Reconnect soak evidence is stale for this candidate.");
  assert.equal(reconnectEvidence?.freshness, "stale");
});

test("buildReleaseGateSummaryReport surfaces stale manual evidence ledger ownership before the release call", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-pass.json");
  const wechatArtifactsDir = path.join(workspace, "artifacts", "wechat-release");
  const manualEvidenceLedgerPath = path.join(
    workspace,
    "artifacts",
    "release-readiness",
    "manual-release-evidence-owner-ledger-abc123.md"
  );

  writeJson(snapshotPath, {
    generatedAt: isoHoursAgo(2),
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
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(h5SmokePath, {
    generatedAt: isoHoursAgo(2),
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
      total: 1,
      passed: 1,
      failed: 0
    }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: isoHoursAgo(2),
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 12,
      invariantChecks: 12
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

  fs.mkdirSync(path.dirname(manualEvidenceLedgerPath), { recursive: true });
  fs.mkdirSync(wechatArtifactsDir, { recursive: true });
  fs.writeFileSync(
    manualEvidenceLedgerPath,
    `# Manual Release Evidence Owner Ledger

## Candidate

- Candidate: \`phase1-rc\`
- Target revision: \`abc123\`
- Release owner: \`release-oncall\`
- Last updated: \`${isoHoursAgo(2)}\`
- Linked readiness snapshot: \`artifacts/release-readiness/release-readiness-pass.json\`

## Ledger

| Evidence type | Candidate | Revision | Owner | Status | Last updated | Artifact path / link | Notes / blocker context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`runtime-observability-review\` | \`phase1-rc\` | \`abc123\` | \`\` | \`pending\` | \`${isoHoursAgo(80)}\` | \`artifacts/wechat-release/runtime-observability-signoff.json\` | Waiting on release-environment captures. |
`,
    "utf8"
  );

  const report = buildReleaseGateSummaryReport(
    {
      snapshotPath,
      h5SmokePath,
      reconnectSoakPath,
      wechatArtifactsDir,
      manualEvidenceLedgerPath,
      targetSurface: "h5"
    },
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  assert.equal(report.summary.status, "failed");
  assert.equal(report.triage.blockers.length, 2);
  assert.deepEqual(
    report.triage.blockers.map((entry) => entry.gateId),
    ["manual-evidence-ledger", "manual-evidence-ledger"]
  );
  assert.match(report.triage.blockers[0]?.summary ?? "", /blocking row/);
  assert.match(report.triage.blockers[1]?.summary ?? "", /runtime-observability-review/);
  assert.match(report.triage.blockers[1]?.summary ?? "", /owner missing/);
  assert.match(report.triage.blockers[1]?.summary ?? "", /freshness=stale/);
  const ledgerRollup = report.releaseSurface.evidence.find((entry) => entry.id === "manual-evidence-ledger");
  assert.equal(ledgerRollup?.status, "failed");
  assert.match(ledgerRollup?.summary ?? "", /blocking row/);
  const ledgerRow = report.releaseSurface.evidence.find((entry) => entry.id === "manual-ledger:runtime-observability-review");
  assert.equal(ledgerRow?.status, "failed");
  assert.match(ledgerRow?.summary ?? "", /owner missing/);
  assert.match(ledgerRow?.summary ?? "", /freshness=stale/);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Manual evidence owner ledger blocked h5/);
  assert.match(markdown, /Ledger: runtime-observability-review blocked h5/);
  assert.match(markdown, /owner=<missing>/);
  assert.match(markdown, /freshness=stale/);
});

test("buildReleaseGateSummaryReport marks reconnect soak evidence failing when the candidate verdict failed", () => {
  const workspace = createTempWorkspace();
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-fail.json");

  writeJson(reconnectSoakPath, {
    generatedAt: "2026-04-02T08:33:00.000Z",
    candidate: {
      name: "phase1-rc",
      revision: "abc123"
    },
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "failed",
    verdict: {
      status: "failed",
      summary: "Reconnect soak evidence is failing for this candidate revision."
    },
    summary: {
      failedScenarios: 1,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 384,
      invariantChecks: 2304
    },
    results: [
      {
        scenario: "reconnect_soak",
        failedRooms: 1,
        runtimeHealthAfterCleanup: {
          activeRoomCount: 0,
          connectionCount: 0,
          activeBattleCount: 0,
          heroCount: 0
        }
      }
    ]
  });

  const report = buildReleaseGateSummaryReport(
    {
      reconnectSoakPath,
      targetSurface: "h5"
    },
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  const reconnectEvidence = report.releaseSurface.evidence.find((entry) => entry.id === "multiplayer-reconnect-soak");
  const reconnectGate = report.gates.find((entry) => entry.id === "multiplayer-reconnect-soak");
  assert.equal(reconnectEvidence?.summary, "Reconnect soak evidence is failing for this candidate.");
  assert.equal(reconnectEvidence?.status, "failed");
  assert.match(reconnectGate?.summary ?? "", /Reconnect soak gate failed/);
});

test("buildReleaseGateSummaryReport reports blocked WeChat device evidence distinctly from failures", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-fail.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-pass.json");
  const wechatSmokeReportPath = path.join(workspace, "artifacts", "wechat-release", "codex.wechat.smoke-report.json");
  const wechatArtifactsDir = path.dirname(wechatSmokeReportPath);

  writeJson(snapshotPath, {
    generatedAt: isoHoursAgo(2),
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
    generatedAt: isoHoursAgo(2),
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
  writeJson(reconnectSoakPath, {
    generatedAt: isoHoursAgo(2),
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 384,
      invariantChecks: 2304
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
  writeJson(wechatSmokeReportPath, {
    artifact: {
      sourceRevision: "abc123"
    },
    execution: {
      executedAt: isoHoursAgo(1),
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
      reconnectSoakPath,
      wechatArtifactsDir,
      wechatSmokeReportPath,
      targetSurface: "wechat"
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
  assert.deepEqual(
    report.triage.blockers.map((entry) => entry.gateId),
    ["release-readiness", "wechat-release"]
  );
  assert.match(report.triage.blockers[0]?.nextStep ?? "", /release:gate:summary -- --target-surface wechat/);
  assert.match(report.triage.blockers[1]?.summary ?? "", /blocked wechat/i);
  assert.match(report.gates[0]?.summary ?? "", /not release-ready/);
  assert.match(report.gates[3]?.summary ?? "", /blocked/i);
  assert.match(
    report.gates[3]?.failures.join("\n") ?? "",
    /blocked pending device evidence|WeChat smoke case is blocked|WeChat candidate summary status is "blocked"|Manual review pending/
  );
  assert.match(renderMarkdown(report), /### Blockers \(2\)/);
  assert.match(renderMarkdown(report), /Release readiness snapshot blocked wechat/);
  assert.match(renderMarkdown(report), /### Manual Evidence Ownership/);
  assert.match(renderMarkdown(report), /No required manual evidence items are attached to the target surface/);
});

test("buildReleaseGateSummaryReport marks pending candidate-level WeChat evidence before sign-off", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-pass.json");
  const wechatArtifactsDir = path.join(workspace, "artifacts", "wechat-release");
  const wechatRcValidationPath = path.join(wechatArtifactsDir, "codex.wechat.rc-validation-report.json");
  const wechatCandidateSummaryPath = path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-04-02T08:30:00.000Z",
    revision: { commit: "abc123", shortCommit: "abc123", branch: "test-branch", dirty: false },
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "e2e-smoke", required: true, status: "passed" }]
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-02T08:32:00.000Z",
    revision: { commit: "abc123", shortCommit: "abc123", branch: "test-branch", dirty: false },
    execution: { status: "passed", exitCode: 0 },
    summary: { total: 2, passed: 2, failed: 0 }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-04-02T08:33:00.000Z",
    revision: { commit: "abc123", shortCommit: "abc123" },
    status: "passed",
    summary: { failedScenarios: 0, scenarioNames: ["reconnect_soak"] },
    soakSummary: { reconnectAttempts: 384, invariantChecks: 2304 },
    results: [
      {
        scenario: "reconnect_soak",
        failedRooms: 0,
        runtimeHealthAfterCleanup: { activeRoomCount: 0, connectionCount: 0, activeBattleCount: 0, heroCount: 0 }
      }
    ]
  });
  writeJson(wechatRcValidationPath, {
    generatedAt: "2026-04-02T08:35:00.000Z",
    commit: "abc123",
    summary: { status: "passed", failedChecks: 0, failureSummary: [] }
  });
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: "2026-04-02T08:40:00.000Z",
    candidate: { revision: "abc123", status: "blocked" },
    evidence: {
      package: {
        status: "passed",
        summary: "ok",
        artifactPath: path.join(wechatArtifactsDir, "codex.wechat.package.json")
      },
      validation: {
        status: "passed",
        summary: "ok",
        artifactPath: wechatRcValidationPath
      },
      smoke: {
        status: "skipped",
        summary: "Smoke report not present.",
        artifactPath: path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json")
      },
      manualReview: {
        status: "blocked",
        requiredPendingChecks: 1,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "wechat-devtools-export-review",
            title: "Candidate-scoped WeChat package install/launch verification recorded",
            required: true,
            status: "pending",
            artifactPath: "artifacts/wechat-release/codex.wechat.install-launch-evidence.json"
          }
        ]
      }
    },
    blockers: [
      {
        id: "manual:wechat-devtools-export-review",
        summary: "Manual review pending: Candidate-scoped WeChat package install/launch verification recorded."
      }
    ]
  });

  const report = buildReleaseGateSummaryReport(
    {
      snapshotPath,
      h5SmokePath,
      reconnectSoakPath,
      wechatArtifactsDir,
      targetSurface: "wechat"
    },
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    }
  );

  assert.equal(report.summary.status, "failed");
  assert.equal(report.releaseSurface.status, "failed");
  assert.equal(report.releaseSurface.evidence.find((entry) => entry.id === "wechat-candidate-summary")?.status, "pending");
  assert.equal(report.releaseSurface.evidence.find((entry) => entry.id === "wechat-smoke-evidence")?.status, "pending");
  assert.equal(report.releaseSurface.evidence.find((entry) => entry.id === "manual:wechat-devtools-export-review")?.status, "pending");
  assert.match(renderMarkdown(report), /WeChat candidate summary is blocked pending required candidate-level package\/verify\/smoke\/manual evidence/);
  assert.match(renderMarkdown(report), /WeChat smoke evidence: Smoke report not present\. \[required=yes status=pending/);
  assert.match(renderMarkdown(report), /Candidate-scoped WeChat package install\/launch verification recorded: "pending"/);
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

  const smokeGate = evaluateWechatGate("wechat", undefined, undefined, wechatSmokeReportPath);
  assert.equal(smokeGate.status, "passed");
  assert.equal(smokeGate.source?.kind, "wechat-smoke-report");
});

test("evaluateReconnectSoakGate fails when cleanup leaves active runtime state behind", () => {
  const workspace = createTempWorkspace();
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-fail.json");

  writeJson(reconnectSoakPath, {
    generatedAt: "2026-03-29T08:33:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 384,
      invariantChecks: 2304
    },
    results: [
      {
        scenario: "reconnect_soak",
        failedRooms: 0,
        runtimeHealthAfterCleanup: {
          activeRoomCount: 1,
          connectionCount: 2,
          activeBattleCount: 0,
          heroCount: 1
        }
      }
    ]
  });

  const gate = evaluateReconnectSoakGate(reconnectSoakPath);
  assert.equal(gate.status, "failed");
  assert.match(gate.summary, /Reconnect soak gate failed/);
  assert.match(gate.failures.join("\n"), /left 1 active room/);
  assert.match(gate.failures.join("\n"), /left 2 live connection/);
});

test("evaluatePhase1EvidenceConsistencyGate fails stale or mismatched candidate evidence", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-pass.json");
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
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-03-29T08:33:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 384,
      invariantChecks: 2304
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
    "wechat",
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    snapshotPath,
    h5SmokePath,
    reconnectSoakPath,
    wechatRcValidationPath,
    undefined,
    undefined,
    undefined
  );

  assert.equal(gate.status, "failed");
  assert.match(gate.summary, /Phase 1 evidence drift detected/);
  assert.match(gate.failures.join("\n"), /stale for H5 packaged RC smoke/);
  assert.match(gate.failures.join("\n"), /commit mismatch/);
});

test("evaluatePhase1EvidenceConsistencyGate fails when Phase 1 evidence timestamps drift too far apart", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-pass.json");
  const wechatRcValidationPath = path.join(workspace, "artifacts", "wechat-release", "codex.wechat.rc-validation-report.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-03-20T08:30:00.000Z",
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
    generatedAt: "2026-03-24T08:32:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    execution: {
      status: "passed",
      finishedAt: "2026-03-24T08:32:00.000Z",
      exitCode: 0
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0
    }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-03-24T08:31:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 384,
      invariantChecks: 2304
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
  writeJson(wechatRcValidationPath, {
    generatedAt: "2026-03-24T09:00:00.000Z",
    commit: "abc123",
    summary: {
      status: "passed",
      failedChecks: 0,
      failureSummary: []
    }
  });

  const gate = evaluatePhase1EvidenceConsistencyGate(
    "wechat",
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    snapshotPath,
    h5SmokePath,
    reconnectSoakPath,
    wechatRcValidationPath,
    undefined,
    undefined,
    undefined
  );

  assert.equal(gate.status, "failed");
  assert.match(gate.failures.join("\n"), /timestamps drift by 9[67]h/);
  assert.match(gate.failures.join("\n"), /release-readiness-pass\.json/);
  assert.match(gate.failures.join("\n"), /codex\.wechat\.rc-validation-report\.json/);
});

test("evaluatePhase1EvidenceConsistencyGate fails when manual evidence owner ledger drifts from the candidate revision", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-pass.json");
  const wechatCandidateSummaryPath = path.join(workspace, "artifacts", "wechat-release", "codex.wechat.release-candidate-summary.json");
  const manualEvidenceLedgerPath = path.join(
    workspace,
    "artifacts",
    "release-readiness",
    "manual-release-evidence-owner-ledger-deadbee.md"
  );

  writeJson(snapshotPath, {
    generatedAt: "2026-04-02T08:30:00.000Z",
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
    generatedAt: "2026-04-02T08:32:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    execution: {
      status: "passed",
      finishedAt: "2026-04-02T08:32:00.000Z",
      exitCode: 0
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0
    }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-04-02T08:33:00.000Z",
    revision: {
      commit: "abc123",
      shortCommit: "abc123"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 384,
      invariantChecks: 2304
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
  writeJson(wechatCandidateSummaryPath, {
    generatedAt: "2026-04-02T08:35:00.000Z",
    candidate: {
      revision: "abc123",
      status: "ready"
    },
    evidence: {
      smoke: {
        status: "passed"
      },
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: []
      }
    },
    blockers: []
  });
  fs.mkdirSync(path.dirname(manualEvidenceLedgerPath), { recursive: true });
  fs.writeFileSync(
    manualEvidenceLedgerPath,
    `# Manual Release Evidence Owner Ledger

## Candidate

- Candidate: \`rc-2026-04-02\`
- Target revision: \`deadbeef\`
- Release owner: \`release-oncall\`
- Last updated: \`2026-04-02T08:40:00.000Z\`
- Linked readiness snapshot: \`artifacts/release-readiness/release-readiness-pass.json\`
`,
    "utf8"
  );

  const gate = evaluatePhase1EvidenceConsistencyGate(
    "wechat",
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    snapshotPath,
    h5SmokePath,
    reconnectSoakPath,
    undefined,
    wechatCandidateSummaryPath,
    undefined,
    manualEvidenceLedgerPath
  );

  assert.equal(gate.status, "failed");
  assert.match(gate.failures.join("\n"), /Manual evidence owner ledger/);
  assert.match(gate.failures.join("\n"), /does not match candidate abc123/);
});

test("buildReleaseGateSummaryReport fails when all artifacts are stale for the current candidate", () => {
  const workspace = createTempWorkspace();
  const snapshotPath = path.join(workspace, "artifacts", "release-readiness", "release-readiness-pass.json");
  const h5SmokePath = path.join(workspace, "artifacts", "release-readiness", "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(workspace, "artifacts", "release-readiness", "colyseus-reconnect-soak-summary-pass.json");
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
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-03-29T08:33:00.000Z",
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbee"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 384,
      invariantChecks: 2304
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
      reconnectSoakPath,
      wechatRcValidationPath,
      targetSurface: "wechat"
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
  assert.match(report.gates[4]?.summary ?? "", /artifact commit deadbeef.*does not match candidate abc123/);
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
