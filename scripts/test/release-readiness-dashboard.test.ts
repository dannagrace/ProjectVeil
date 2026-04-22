import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function runDashboard(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/release-readiness-dashboard.ts", ...args], {
      cwd,
      encoding: "utf8",
      stdio: "pipe"
    });
    return { stdout, status: 0 };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; status?: number };
    return {
      stdout: execError.stdout ?? "",
      status: execError.status ?? 1
    };
  }
}

test("release-readiness dashboard keeps stale and partial mixed-surface evidence reviewable", () => {
  const workspaceDir = createTempDir("veil-release-dashboard-edge-");
  const outputPath = path.join(workspaceDir, "dashboard.json");
  const markdownOutputPath = path.join(workspaceDir, "dashboard.md");
  const snapshotPath = path.join(workspaceDir, "release-readiness.json");
  const cocosRcPath = path.join(workspaceDir, "cocos-rc.json");
  const reconnectSoakPath = path.join(workspaceDir, "colyseus-reconnect-soak-summary.json");
  const persistencePath = path.join(workspaceDir, "phase1-release-persistence-regression-abc1234.json");
  const wechatArtifactsDir = path.join(workspaceDir, "wechat-artifacts");
  const smokeReportPath = path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json");

  const snapshotGeneratedAt = hoursAgo(24 * 15);
  const reconnectGeneratedAt = hoursAgo(24 * 15);
  const cocosExecutedAt = hoursAgo(2);
  const persistenceGeneratedAt = hoursAgo(1.5);
  const smokeExecutedAt = hoursAgo(1.75);

  writeJson(snapshotPath, {
    generatedAt: snapshotGeneratedAt,
    revision: {
      shortCommit: "abc1234"
    },
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "passed", required: true },
      { id: "cocos-primary-journey", status: "passed", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });
  writeJson(cocosRcPath, {
    candidate: {
      shortCommit: "abc1234"
    },
    execution: {
      overallStatus: "failed",
      executedAt: cocosExecutedAt,
      summary: "Primary journey hit a release-blocking regression."
    }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: reconnectGeneratedAt,
    revision: {
      shortCommit: "abc1234"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 96,
      invariantChecks: 384
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
  writeJson(persistencePath, {
    generatedAt: persistenceGeneratedAt,
    revision: {
      shortCommit: "abc1234"
    },
    effectiveStorageMode: "memory",
    summary: {
      status: "passed",
      assertionCount: 4
    },
    contentValidation: {
      valid: true,
      bundleCount: 5,
      summary: "All shipped content packs validated.",
      issueCount: 0
    },
    persistenceRegression: {
      mapPackId: "phase1",
      assertions: ["room hydration preserved resources"]
    }
  });
  writeJson(smokeReportPath, {
    artifact: {
      sourceRevision: "abc1234"
    },
    execution: {
      result: "passed",
      executedAt: smokeExecutedAt,
      summary: "Smoke suite passed."
    },
    cases: [
      { id: "login-lobby", status: "passed" }
    ]
  });

  const result = runDashboard(
    [
      "--snapshot",
      snapshotPath,
      "--cocos-rc",
      cocosRcPath,
      "--reconnect-soak",
      reconnectSoakPath,
      "--phase1-persistence",
      persistencePath,
      "--wechat-artifacts-dir",
      wechatArtifactsDir,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    path.resolve(__dirname, "../..")
  );

  assert.equal(result.status, 1);

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    overallStatus: string;
    summary: string;
    goNoGo: {
      decision: string;
      blockers: string[];
      pending: string[];
    };
    gates: Array<{
      id: string;
      status: string;
      details: string[];
      failReasons: string[];
      warnReasons: string[];
    }>;
  };
  assert.equal(report.overallStatus, "fail");
  assert.equal(report.goNoGo.decision, "blocked");
  assert.equal(report.goNoGo.blockers.includes("Smoke/build/package validation"), true);
  assert.equal(report.goNoGo.blockers.includes("Critical readiness evidence"), true);
  assert.equal(report.goNoGo.pending.includes("Server health"), true);
  assert.equal(report.goNoGo.pending.includes("Auth readiness"), true);
  assert.deepEqual(
    report.gates.map((gate) => [gate.id, gate.status]),
    [
      ["server-health", "warn"],
      ["auth-readiness", "warn"],
      ["build-package-validation", "fail"],
      ["reconnect-soak", "warn"],
      ["phase1-persistence", "pass"],
      ["same-candidate-evidence", "warn"],
      ["critical-evidence", "fail"]
    ]
  );
  assert.deepEqual(report.gates.find((gate) => gate.id === "build-package-validation")?.failReasons, [
    "wechat_package_metadata_missing"
  ]);
  assert.deepEqual(report.gates.find((gate) => gate.id === "reconnect-soak")?.warnReasons, ["reconnect_soak_stale"]);
  assert.deepEqual(report.gates.find((gate) => gate.id === "same-candidate-evidence")?.warnReasons, [
    "same_candidate_evidence_audit_not_checked"
  ]);
  assert.match(report.gates.find((gate) => gate.id === "critical-evidence")?.details.join("\n") ?? "", /older than 14 day\(s\)/);
  assert.match(report.gates.find((gate) => gate.id === "critical-evidence")?.details.join("\n") ?? "", /Primary-client diagnostic snapshots: missing artifact/);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /## Blocker Drill-Down/);
  assert.match(markdown, /## Server health[\s\S]*- Evidence: unavailable\./);
  assert.match(markdown, /## Auth readiness[\s\S]*- Evidence: unavailable\./);
  assert.match(markdown, /## Same-candidate evidence[\s\S]*Candidate-level evidence audit not selected/);
  assert.match(markdown, /WeChat package metadata missing\./);
  assert.match(markdown, /Primary-client diagnostic snapshots: FAIL \(/);
  assert.match(markdown, new RegExp(`Cocos RC snapshot: FAIL @ ${cocosExecutedAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(
    markdown,
    new RegExp(`older than 14 day\\(s\\) \\(${snapshotGeneratedAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`)
  );
});
