import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
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

function execFileAsync(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

test("release:readiness:dashboard aggregates live endpoints and local evidence into a pass report", async () => {
  const workspaceDir = createTempDir("veil-release-dashboard-pass-");
  const outputPath = path.join(workspaceDir, "dashboard.json");
  const markdownOutputPath = path.join(workspaceDir, "dashboard.md");
  const snapshotPath = path.join(workspaceDir, "release-readiness.json");
  const cocosRcPath = path.join(workspaceDir, "cocos-rc.json");
  const primaryClientDiagnosticsPath = path.join(workspaceDir, "cocos-primary-diagnostics.json");
  const reconnectSoakPath = path.join(workspaceDir, "colyseus-reconnect-soak-summary.json");
  const persistencePath = path.join(workspaceDir, "phase1-release-persistence-regression-abc1234.json");
  const wechatArtifactsDir = path.join(workspaceDir, "wechat-artifacts");
  const packageMetadataPath = path.join(wechatArtifactsDir, "project-veil.package.json");
  const archivePath = path.join(wechatArtifactsDir, "project-veil.tar.gz");
  const smokeReportPath = path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-03-29T08:00:00.000Z",
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
      overallStatus: "passed",
      executedAt: "2026-03-29T08:20:00.000Z",
      summary: "Canonical gameplay journey passed."
    }
  });
  writeJson(primaryClientDiagnosticsPath, {
    generatedAt: "2026-03-29T08:18:00.000Z",
    revision: {
      shortCommit: "abc1234"
    },
    summary: {
      status: "passed",
      checkpointCount: 5,
      categoryIds: ["progression", "inventory", "combat", "reconnect"],
      checkpointIds: [
        "progression-review",
        "inventory-overflow",
        "combat-loop",
        "reconnect-cached-replay",
        "reconnect-recovery"
      ]
    },
    checkpoints: []
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-03-29T08:22:00.000Z",
    revision: {
      shortCommit: "abc1234"
    },
    status: "passed",
    summary: {
      failedScenarios: 0,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 192,
      invariantChecks: 768
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
    generatedAt: "2026-03-29T08:24:00.000Z",
    revision: {
      shortCommit: "abc1234"
    },
    effectiveStorageMode: "memory",
    summary: {
      status: "passed",
      assertionCount: 6
    },
    contentValidation: {
      valid: true,
      bundleCount: 5,
      summary: "All shipped content packs validated.",
      issueCount: 0
    },
    persistenceRegression: {
      mapPackId: "phase1",
      assertions: ["room hydration reapplied resources"]
    }
  });
  fs.mkdirSync(wechatArtifactsDir, { recursive: true });
  fs.writeFileSync(archivePath, "archive-binary", "utf8");
  writeJson(packageMetadataPath, {
    schemaVersion: 1,
    archiveFileName: path.basename(archivePath),
    archiveSha256: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd",
    sourceRevision: "abc1234"
  });
  writeJson(smokeReportPath, {
    artifact: {
      sourceRevision: "abc1234",
      archiveSha256: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd"
    },
    execution: {
      result: "passed",
      executedAt: "2026-03-29T08:15:00.000Z",
      tester: "codex",
      device: "iPhone 15 / WeChat 8.0.x",
      summary: "All required smoke cases passed."
    },
    cases: [
      { id: "login-lobby", status: "passed" },
      { id: "room-entry", status: "passed" },
      { id: "reconnect-recovery", status: "passed" },
      { id: "share-roundtrip", status: "passed" },
      { id: "key-assets", status: "passed" }
    ]
  });

  const server = createServer((request, response) => {
    if (request.url === "/api/runtime/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          status: "ok",
          checkedAt: "2026-03-29T08:30:00.000Z",
          runtime: {
            activeRoomCount: 2,
            connectionCount: 3,
            gameplayTraffic: {
              actionMessagesTotal: 42
            },
            auth: {
              activeGuestSessionCount: 1,
              activeAccountSessionCount: 2
            }
          }
        })
      );
      return;
    }
    if (request.url === "/api/runtime/auth-readiness") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          status: "ok",
          checkedAt: "2026-03-29T08:30:00.000Z",
          headline: "auth ready; guest=1 account=2 lockouts=0",
          alerts: [],
          auth: {
            activeAccountLockCount: 0,
            pendingRegistrationCount: 0,
            pendingRecoveryCount: 0,
            tokenDelivery: {
              queueCount: 0,
              deadLetterCount: 0
            }
          }
        })
      );
      return;
    }
    if (request.url === "/api/runtime/metrics") {
      response.setHeader("Content-Type", "text/plain; version=0.0.4");
      response.end(
        [
          "veil_active_room_count 2",
          "veil_connection_count 3",
          "veil_gameplay_action_messages_total 42",
          "veil_auth_account_sessions 2",
          "veil_auth_token_delivery_queue_count 0"
        ].join("\n")
      );
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }

  try {
    const output = await execFileAsync(
      "node",
      [
        "--import",
        "tsx",
        "./scripts/release-readiness-dashboard.ts",
        "--server-url",
        `http://127.0.0.1:${address.port}`,
        "--snapshot",
        snapshotPath,
        "--cocos-rc",
        cocosRcPath,
        "--primary-client-diagnostics",
        primaryClientDiagnosticsPath,
        "--reconnect-soak",
        reconnectSoakPath,
        "--phase1-persistence",
        persistencePath,
        "--wechat-artifacts-dir",
        wechatArtifactsDir,
        "--candidate-revision",
        "abc1234",
        "--output",
        outputPath,
        "--markdown-output",
        markdownOutputPath
      ],
      path.resolve(__dirname, "../../..")
    );

    assert.match(output, /Overall status: pass/);
    assert.match(output, /Go\/No-Go decision: ready/);
    const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
      overallStatus: string;
      goNoGo: {
        decision: string;
        candidateRevision?: string;
        requiredFailed: number;
        requiredPending: number;
        revisionStatus: string;
      };
      gates: Array<{
        id: string;
        status: string;
        failReasons: string[];
        warnReasons: string[];
        evidence: Array<{ availability: string; freshness: string }>;
      }>;
    };
    assert.equal(report.overallStatus, "pass");
    assert.equal(report.goNoGo.decision, "ready");
    assert.equal(report.goNoGo.candidateRevision, "abc1234");
    assert.equal(report.goNoGo.requiredFailed, 0);
    assert.equal(report.goNoGo.requiredPending, 0);
    assert.equal(report.goNoGo.revisionStatus, "aligned");
    assert.deepEqual(
      report.gates.map((gate) => [gate.id, gate.status]),
      [
        ["server-health", "pass"],
        ["auth-readiness", "pass"],
        ["build-package-validation", "pass"],
        ["reconnect-soak", "pass"],
        ["phase1-persistence", "pass"],
        ["critical-evidence", "pass"]
      ]
    );
    assert.deepEqual(report.gates.every((gate) => gate.failReasons.length === 0), true);
    assert.equal(report.gates[5]?.evidence.every((entry) => entry.availability === "present"), true);
    assert.equal(report.gates[5]?.evidence.length, 7);
    assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Phase 1 Go\/No-Go/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("release:readiness:dashboard reports warns and failures when evidence is missing or failing", () => {
  const workspaceDir = createTempDir("veil-release-dashboard-warn-");
  const outputPath = path.join(workspaceDir, "dashboard.json");
  const markdownOutputPath = path.join(workspaceDir, "dashboard.md");
  const snapshotPath = path.join(workspaceDir, "release-readiness.json");
  const reconnectSoakPath = path.join(workspaceDir, "colyseus-reconnect-soak-summary.json");
  const persistencePath = path.join(workspaceDir, "phase1-release-persistence-regression-abc1234.json");
  const wechatArtifactsDir = path.join(workspaceDir, "wechat-artifacts");
  const packageMetadataPath = path.join(wechatArtifactsDir, "project-veil.package.json");
  const smokeReportPath = path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-03-29T08:00:00.000Z",
    revision: {
      shortCommit: "abc1234"
    },
    summary: {
      status: "failed",
      requiredFailed: 1,
      requiredPending: 0
    },
    checks: [
      { id: "npm-test", status: "failed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "passed", required: true },
      { id: "cocos-primary-journey", status: "passed", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });
  fs.mkdirSync(wechatArtifactsDir, { recursive: true });
  writeJson(packageMetadataPath, {
    schemaVersion: 1,
    archiveFileName: "missing-archive.tar.gz",
    archiveSha256: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd"
  });
  writeJson(smokeReportPath, {
    artifact: {
      sourceRevision: "abc1234"
    },
    execution: {
      result: "pending",
      executedAt: "2026-03-29T08:15:00.000Z"
    },
    cases: [
      { id: "login-lobby", status: "pending" }
    ]
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-03-29T08:22:00.000Z",
    revision: {
      shortCommit: "abc1234"
    },
    status: "failed",
    summary: {
      failedScenarios: 1,
      scenarioNames: ["reconnect_soak"]
    },
    soakSummary: {
      reconnectAttempts: 32,
      invariantChecks: 128
    },
    results: [
      {
        scenario: "reconnect_soak",
        failedRooms: 1,
        runtimeHealthAfterCleanup: {
          activeRoomCount: 2,
          connectionCount: 1,
          activeBattleCount: 0,
          heroCount: 0
        }
      }
    ]
  });
  writeJson(persistencePath, {
    generatedAt: "2026-03-29T08:24:00.000Z",
    revision: {
      shortCommit: "abc1234"
    },
    effectiveStorageMode: "memory",
    summary: {
      status: "passed",
      assertionCount: 0
    },
    contentValidation: {
      valid: false,
      bundleCount: 5,
      summary: "Content validation failed.",
      issueCount: 2
    },
    persistenceRegression: {
      mapPackId: "phase1",
      assertions: []
    }
  });

  let output = "";
  try {
    output = execFileSync(
      "node",
      [
        "--import",
        "tsx",
        "./scripts/release-readiness-dashboard.ts",
        "--snapshot",
        snapshotPath,
        "--reconnect-soak",
        reconnectSoakPath,
        "--phase1-persistence",
        persistencePath,
        "--wechat-artifacts-dir",
        wechatArtifactsDir,
        "--candidate-revision",
        "abc1234",
        "--output",
        outputPath,
        "--markdown-output",
        markdownOutputPath
      ],
      {
        cwd: path.resolve(__dirname, "../../.."),
        encoding: "utf8",
        stdio: "pipe"
      }
    );
    assert.fail("expected the dashboard command to exit non-zero");
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; status?: number };
    assert.equal(execError.status, 1);
    output = execError.stdout ?? "";
  }

  assert.match(output, /Overall status: fail/);
  assert.match(output, /Go\/No-Go decision: blocked/);
  assert.match(output, /Candidate consistency: Expected candidate revision abc1234, but WeChat package metadata is missing revision metadata/);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    overallStatus: string;
    goNoGo: {
      decision: string;
      requiredFailed: number;
      requiredPending: number;
      revisionStatus: string;
      blockers: string[];
      candidateConsistencyFindings: Array<{ code: string; path: string; summary: string }>;
    };
    gates: Array<{
      id: string;
      status: string;
      failReasons: string[];
      warnReasons: string[];
      evidence: Array<{ availability: string; freshness: string; reasonCodes: string[] }>;
    }>;
  };
  assert.equal(report.overallStatus, "fail");
  assert.equal(report.goNoGo.decision, "blocked");
  assert.equal(report.goNoGo.requiredFailed, 1);
  assert.equal(report.goNoGo.requiredPending, 0);
  assert.equal(report.goNoGo.revisionStatus, "aligned");
  assert.equal(report.goNoGo.blockers.includes("requiredFailed=1"), true);
  assert.equal(report.goNoGo.blockers.includes("candidate_revision_metadata_missing"), true);
  assert.equal(report.goNoGo.candidateConsistencyFindings.some((finding) => finding.path === packageMetadataPath), true);
  assert.deepEqual(
    report.gates.map((gate) => [gate.id, gate.status]),
    [
      ["server-health", "warn"],
      ["auth-readiness", "warn"],
      ["build-package-validation", "fail"],
      ["reconnect-soak", "fail"],
      ["phase1-persistence", "fail"],
      ["critical-evidence", "fail"]
    ]
  );
  assert.deepEqual(report.gates[2]?.failReasons, [
    "release_readiness_snapshot_failed",
    "release_readiness_required_checks_failed",
    "wechat_package_metadata_incomplete"
  ]);
  assert.deepEqual(report.gates[2]?.warnReasons, ["wechat_smoke_pending", "wechat_smoke_cases_pending"]);
  assert.deepEqual(report.gates[3]?.failReasons, [
    "reconnect_soak_failed",
    "reconnect_soak_rooms_failed",
    "reconnect_soak_cleanup_incomplete"
  ]);
  assert.deepEqual(report.gates[4]?.failReasons, [
    "phase1_content_validation_failed",
    "phase1_persistence_assertions_missing"
  ]);
  assert.equal(report.gates[5]?.evidence.some((entry) => entry.freshness === "fresh"), true);
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Release validation evidence is incomplete or still pending|One or more release validation surfaces failed/);
});
