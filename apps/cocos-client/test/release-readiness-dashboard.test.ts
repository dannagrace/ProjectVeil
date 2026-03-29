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
  const wechatArtifactsDir = path.join(workspaceDir, "wechat-artifacts");
  const packageMetadataPath = path.join(wechatArtifactsDir, "project-veil.package.json");
  const archivePath = path.join(wechatArtifactsDir, "project-veil.tar.gz");
  const smokeReportPath = path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-03-29T08:00:00.000Z",
    summary: {
      status: "passed"
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "passed", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });
  writeJson(cocosRcPath, {
    execution: {
      overallStatus: "passed",
      executedAt: "2026-03-29T08:20:00.000Z",
      summary: "Canonical gameplay journey passed."
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
        "--wechat-artifacts-dir",
        wechatArtifactsDir,
        "--output",
        outputPath,
        "--markdown-output",
        markdownOutputPath
      ],
      path.resolve(__dirname, "../../..")
    );

    assert.match(output, /Overall status: pass/);
    const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
      overallStatus: string;
      gates: Array<{ id: string; status: string }>;
    };
    assert.equal(report.overallStatus, "pass");
    assert.deepEqual(
      report.gates.map((gate) => [gate.id, gate.status]),
      [
        ["server-health", "pass"],
        ["auth-readiness", "pass"],
        ["build-package-validation", "pass"],
        ["critical-evidence", "pass"]
      ]
    );
    assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Phase 1 Release Readiness Dashboard/);
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
  const wechatArtifactsDir = path.join(workspaceDir, "wechat-artifacts");
  const packageMetadataPath = path.join(wechatArtifactsDir, "project-veil.package.json");
  const smokeReportPath = path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-03-29T08:00:00.000Z",
    summary: {
      status: "failed"
    },
    checks: [
      { id: "npm-test", status: "failed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "passed", required: true },
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
    execution: {
      result: "pending",
      executedAt: "2026-03-29T08:15:00.000Z"
    },
    cases: [
      { id: "login-lobby", status: "pending" }
    ]
  });

  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/release-readiness-dashboard.ts",
      "--snapshot",
      snapshotPath,
      "--wechat-artifacts-dir",
      wechatArtifactsDir,
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

  assert.match(output, /Overall status: fail/);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    overallStatus: string;
    gates: Array<{ id: string; status: string }>;
  };
  assert.equal(report.overallStatus, "fail");
  assert.deepEqual(
    report.gates.map((gate) => [gate.id, gate.status]),
    [
      ["server-health", "warn"],
      ["auth-readiness", "warn"],
      ["build-package-validation", "fail"],
      ["critical-evidence", "fail"]
    ]
  );
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Release validation evidence is incomplete or still pending|One or more release validation surfaces failed/);
});
