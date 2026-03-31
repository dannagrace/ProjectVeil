import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("release:cocos-rc:snapshot imports WeChat smoke evidence into linked journey fields", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-cocos-rc-snapshot-"));
  const smokeReportPath = path.join(workspace, "codex.wechat.smoke-report.json");
  const outputPath = path.join(workspace, "rc.snapshot.json");

  writeJson(smokeReportPath, {
    execution: {
      tester: "codex-bot",
      device: "iPhone 15 Pro",
      clientVersion: "WeChat 8.0.50",
      executedAt: "2026-03-31T10:30:00+08:00",
      result: "passed",
      summary: "Automated WeChat smoke evidence passed for startup, room, and reconnect."
    },
    artifact: {
      sourceRevision: "abc1234"
    },
    cases: [
      {
        id: "login-lobby",
        status: "passed",
        notes: "Cold start reached the lobby.",
        evidence: ["artifacts/wechat-release/lobby.png"]
      },
      {
        id: "room-entry",
        status: "passed",
        notes: "Joined room-alpha.",
        evidence: ["artifacts/wechat-release/room-entry.png"]
      },
      {
        id: "reconnect-recovery",
        status: "passed",
        notes: "Recovered room-alpha after network resume.",
        evidence: ["artifacts/wechat-release/reconnect.mp4"],
        requiredEvidence: {
          roomId: "room-alpha",
          reconnectPrompt: "连接已恢复",
          restoredState: "Restored the same room and HUD state."
        }
      }
    ]
  });

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/cocos-release-candidate-snapshot.ts",
      "--candidate",
      "rc-issue-480",
      "--owner",
      "release-bot",
      "--server",
      "wss://example.invalid",
      "--build-surface",
      "wechat_preview",
      "--wechat-smoke-report",
      smokeReportPath,
      "--output",
      outputPath
    ],
    {
      cwd: repoRoot,
      stdio: "pipe"
    }
  );

  const snapshot = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    execution: { overallStatus: string; summary: string; executedAt: string };
    environment: { device: string; wechatClient: string };
    requiredEvidence: Array<{ id: string; value: string }>;
    journey: Array<{ id: string; status: string; notes: string }>;
  };

  assert.equal(snapshot.execution.overallStatus, "partial");
  assert.equal(snapshot.execution.executedAt, "2026-03-31T10:30:00+08:00");
  assert.equal(snapshot.environment.device, "iPhone 15 Pro");
  assert.equal(snapshot.environment.wechatClient, "WeChat 8.0.50");
  assert.equal(snapshot.requiredEvidence.find((entry) => entry.id === "roomId")?.value, "room-alpha");
  assert.equal(snapshot.journey.find((entry) => entry.id === "lobby-entry")?.status, "passed");
  assert.match(snapshot.journey.find((entry) => entry.id === "reconnect-restore")?.notes ?? "", /Recovered room-alpha/);
  assert.match(snapshot.execution.summary, /Automated WeChat smoke evidence passed/);
});
