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

function writeJourneyMilestones(workspace: string): Record<string, string> {
  const milestoneDir = path.join(workspace, "milestones");
  const files: Record<string, string> = {
    "lobby-entry": path.join(milestoneDir, "01-lobby-entry.json"),
    "room-join": path.join(milestoneDir, "02-room-join.json"),
    "map-explore": path.join(milestoneDir, "03-map-explore.json"),
    "first-battle": path.join(milestoneDir, "04-first-battle.json"),
    "battle-settlement": path.join(milestoneDir, "05-battle-settlement.json"),
    "reconnect-restore": path.join(milestoneDir, "06-reconnect-restore.json"),
    "return-to-world": path.join(milestoneDir, "07-return-to-world.json")
  };

  for (const [stepId, filePath] of Object.entries(files)) {
    writeJson(filePath, {
      phase: stepId,
      identity: {
        roomId: "room-primary-journey",
        playerId: "player-account"
      },
      room: {
        diagnosticsConnectionStatus: stepId === "reconnect-restore" ? "reconnecting" : "connected",
        lastUpdateReason: `journey.${stepId}`
      },
      diagnostics: {
        primaryClientTelemetry:
          stepId === "battle-settlement"
            ? [
                { checkpoint: "encounter.started" },
                { checkpoint: "hero.progressed" },
                { checkpoint: "encounter.resolved" }
              ]
            : stepId === "first-battle"
              ? [{ checkpoint: "encounter.started" }]
              : []
      }
    });
  }

  return files;
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
    failureSummary: {
      summary: string;
      regressedJourneySegments: Array<{ id: string }>;
      blockedJourneySegments: Array<{ id: string }>;
      lackingJourneyEvidence: Array<{ id: string }>;
      lackingRequiredEvidence: Array<{ id: string }>;
    };
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
  assert.equal(snapshot.failureSummary.regressedJourneySegments.length, 0);
  assert.equal(snapshot.failureSummary.blockedJourneySegments.length, 0);
  assert.deepEqual(
    snapshot.failureSummary.lackingJourneyEvidence.map((entry) => entry.id),
    ["map-explore", "first-battle", "battle-settlement", "return-to-world"]
  );
  assert.deepEqual(snapshot.failureSummary.lackingRequiredEvidence.map((entry) => entry.id), ["firstBattleResult"]);
  assert.match(snapshot.failureSummary.summary, /Journey segments lacking evidence: map-explore, first-battle, battle-settlement, return-to-world/);
});

test("release:cocos-rc:snapshot imports primary journey evidence into the canonical RC path", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-cocos-primary-journey-snapshot-"));
  const primaryJourneyPath = path.join(workspace, "cocos-primary-journey.json");
  const outputPath = path.join(workspace, "rc.snapshot.json");
  const milestoneFiles = writeJourneyMilestones(workspace);

  writeJson(primaryJourneyPath, {
    candidate: {
      shortCommit: "abc1234"
    },
    execution: {
      owner: "codex",
      completedAt: "2026-04-02T10:30:00+08:00",
      overallStatus: "passed",
      summary: "Primary journey evidence passed for the canonical candidate path."
    },
    environment: {
      server: "ws://127.0.0.1:2567"
    },
    artifacts: {
      milestoneDir: path.join(workspace, "milestones")
    },
    requiredEvidence: [
      {
        id: "roomId",
        value: "room-primary-journey",
        evidence: [milestoneFiles["room-join"]]
      },
      {
        id: "reconnectPrompt",
        value: "连接已恢复",
        evidence: [milestoneFiles["reconnect-restore"]]
      },
      {
        id: "restoredState",
        value: "Restored room-primary-journey on day 5 with preserved world state.",
        evidence: [milestoneFiles["reconnect-restore"]]
      },
      {
        id: "firstBattleResult",
        value: "attacker_victory; gold +12; experience +25",
        evidence: [milestoneFiles["battle-settlement"]]
      }
    ],
    journey: [
      { id: "lobby-entry", status: "passed", summary: "Lobby ok", evidence: [milestoneFiles["lobby-entry"]] },
      { id: "room-join", status: "passed", summary: "Room ok", evidence: [milestoneFiles["room-join"]] },
      { id: "map-explore", status: "passed", summary: "Explore ok", evidence: [milestoneFiles["map-explore"]] },
      { id: "first-battle", status: "passed", summary: "Battle ok", evidence: [milestoneFiles["first-battle"]] },
      { id: "battle-settlement", status: "passed", summary: "Settlement ok", evidence: [milestoneFiles["battle-settlement"]] },
      { id: "reconnect-restore", status: "passed", summary: "Reconnect ok", evidence: [milestoneFiles["reconnect-restore"]] },
      { id: "return-to-world", status: "passed", summary: "Return ok", evidence: [milestoneFiles["return-to-world"]] }
    ]
  });

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/cocos-release-candidate-snapshot.ts",
      "--candidate",
      "rc-issue-563",
      "--primary-journey-evidence",
      primaryJourneyPath,
      "--output",
      outputPath
    ],
    {
      cwd: repoRoot,
      stdio: "pipe"
    }
  );

  const snapshot = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    execution: { owner: string; executedAt: string; overallStatus: string; summary: string };
    environment: { server: string };
    linkedEvidence: { primaryJourneyEvidence?: { path: string } };
    failureSummary: {
      summary: string;
      regressedJourneySegments: Array<{ id: string }>;
      blockedJourneySegments: Array<{ id: string }>;
      lackingJourneyEvidence: Array<{ id: string }>;
      lackingRequiredEvidence: Array<{ id: string }>;
    };
    checkpointLedger?: {
      entryCount: number;
      entries: Array<{ id: string; artifactPath: string; telemetryCheckpoints: string[]; roomId: string }>;
    };
    requiredEvidence: Array<{ id: string; value: string }>;
    journey: Array<{ id: string; status: string; notes: string }>;
  };

  assert.equal(snapshot.execution.owner, "codex");
  assert.equal(snapshot.execution.executedAt, "2026-04-02T10:30:00+08:00");
  assert.equal(snapshot.execution.overallStatus, "passed");
  assert.equal(snapshot.environment.server, "ws://127.0.0.1:2567");
  assert.equal(snapshot.linkedEvidence.primaryJourneyEvidence?.path, path.resolve(primaryJourneyPath));
  assert.equal(snapshot.requiredEvidence.find((entry) => entry.id === "firstBattleResult")?.value, "attacker_victory; gold +12; experience +25");
  assert.equal(snapshot.journey.find((entry) => entry.id === "battle-settlement")?.status, "passed");
  assert.match(snapshot.journey.find((entry) => entry.id === "reconnect-restore")?.notes ?? "", /Reconnect ok/);
  assert.equal(snapshot.checkpointLedger?.entryCount, 7);
  assert.equal(snapshot.checkpointLedger?.entries.find((entry) => entry.id === "battle-settlement")?.artifactPath, milestoneFiles["battle-settlement"]);
  assert.deepEqual(snapshot.checkpointLedger?.entries.find((entry) => entry.id === "battle-settlement")?.telemetryCheckpoints, [
    "encounter.started",
    "hero.progressed",
    "encounter.resolved"
  ]);
  assert.equal(snapshot.checkpointLedger?.entries.find((entry) => entry.id === "room-join")?.roomId, "room-primary-journey");
  assert.equal(snapshot.failureSummary.summary, "No regressions or evidence gaps recorded.");
  assert.equal(snapshot.failureSummary.regressedJourneySegments.length, 0);
  assert.equal(snapshot.failureSummary.blockedJourneySegments.length, 0);
  assert.equal(snapshot.failureSummary.lackingJourneyEvidence.length, 0);
  assert.equal(snapshot.failureSummary.lackingRequiredEvidence.length, 0);
});
