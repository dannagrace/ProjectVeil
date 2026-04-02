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

  writeJson(snapshotPath, {
    generatedAt: "2026-03-01T00:00:00.000Z",
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
      executedAt: "2026-03-30T00:10:00.000Z",
      summary: "Primary journey hit a release-blocking regression."
    }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-03-01T00:00:00.000Z",
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
    generatedAt: "2026-03-30T00:20:00.000Z",
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
      executedAt: "2026-03-30T00:05:00.000Z",
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

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Overall status: fail/);
  assert.match(result.stdout, /Go\/No-Go decision: blocked/);

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
      ["critical-evidence", "fail"]
    ]
  );
  assert.deepEqual(report.gates.find((gate) => gate.id === "build-package-validation")?.failReasons, [
    "wechat_package_metadata_missing"
  ]);
  assert.deepEqual(report.gates.find((gate) => gate.id === "reconnect-soak")?.warnReasons, ["reconnect_soak_stale"]);
  assert.match(report.gates.find((gate) => gate.id === "critical-evidence")?.details.join("\n") ?? "", /older than 14 day\(s\)/);
  assert.match(report.gates.find((gate) => gate.id === "critical-evidence")?.details.join("\n") ?? "", /Primary-client diagnostic snapshots: missing artifact/);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /## Server health[\s\S]*- Evidence: unavailable\./);
  assert.match(markdown, /## Auth readiness[\s\S]*- Evidence: unavailable\./);
  assert.match(markdown, /WeChat package metadata missing\./);
  assert.match(markdown, /Primary-client diagnostic snapshots: FAIL \(/);
  assert.match(markdown, /Cocos RC snapshot: FAIL @ 2026-03-30T00:10:00.000Z/);
  assert.match(markdown, /older than 14 day\(s\) \(2026-03-01T00:00:00.000Z\)/);
});
