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

test("release:cocos-rc:bundle generates candidate-scoped summary, snapshot, and markdown attachments", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-cocos-rc-bundle-"));
  const outputDir = path.join(workspace, "artifacts", "release-readiness");
  const smokeReportPath = path.join(workspace, "codex.wechat.smoke-report.json");

  writeJson(smokeReportPath, {
    execution: {
      tester: "bundle-bot",
      device: "iPad Mini",
      clientVersion: "WeChat 8.0.52",
      executedAt: "2026-04-01T20:40:00+08:00",
      result: "passed",
      summary: "Imported smoke evidence covered lobby, room, and reconnect."
    },
    artifact: {
      sourceRevision: "abc1234"
    },
    cases: [
      {
        id: "login-lobby",
        status: "passed",
        notes: "Lobby entered.",
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
        notes: "Recovered room-alpha after reconnect.",
        evidence: ["artifacts/wechat-release/reconnect.mp4"],
        requiredEvidence: {
          roomId: "room-alpha",
          reconnectPrompt: "连接已恢复",
          restoredState: "Restored world HUD after reconnect."
        }
      }
    ]
  });

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/cocos-rc-evidence-bundle.ts",
      "--candidate",
      "rc-issue-507",
      "--build-surface",
      "wechat_preview",
      "--owner",
      "release-bot",
      "--server",
      "wss://example.invalid",
      "--wechat-smoke-report",
      smokeReportPath,
      "--output-dir",
      outputDir
    ],
    {
      cwd: repoRoot,
      stdio: "pipe"
    }
  );

  const files = fs.readdirSync(outputDir).sort();
  const primaryJourneyFile = files.find((entry) => entry.startsWith("cocos-primary-journey-evidence-") && entry.endsWith(".json"));
  const primaryJourneyMarkdownFile = files.find((entry) => entry.startsWith("cocos-primary-journey-evidence-") && entry.endsWith(".md"));
  const manifestFile = files.find((entry) => entry.startsWith("cocos-rc-evidence-bundle-") && entry.endsWith(".json"));
  const summaryFile = files.find((entry) => entry.startsWith("cocos-rc-evidence-bundle-") && entry.endsWith(".md"));
  const snapshotFile = files.find((entry) => entry.startsWith("cocos-rc-snapshot-") && entry.endsWith(".json"));
  const checklistFile = files.find((entry) => entry.startsWith("cocos-rc-checklist-") && entry.endsWith(".md"));
  const blockersFile = files.find((entry) => entry.startsWith("cocos-rc-blockers-") && entry.endsWith(".md"));

  assert.ok(primaryJourneyFile);
  assert.ok(primaryJourneyMarkdownFile);
  assert.ok(manifestFile);
  assert.ok(summaryFile);
  assert.ok(snapshotFile);
  assert.ok(checklistFile);
  assert.ok(blockersFile);
  assert.match(manifestFile ?? "", /rc-issue-507-/);

  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, manifestFile!), "utf8")) as {
    bundle: { candidate: string; buildSurface: string; overallStatus: string };
    artifacts: {
      primaryJourneyEvidence: string;
      primaryJourneyEvidenceMarkdown: string;
      snapshot: string;
      summaryMarkdown: string;
      checklistMarkdown: string;
      blockersMarkdown: string;
    };
    journey: Array<{ id: string; status: string }>;
    checkpointLedger?: {
      entryCount: number;
      entries: Array<{ id: string; artifactPath: string; telemetryCheckpointCount: number }>;
    };
    requiredEvidence: Array<{ id: string; filled: boolean }>;
  };
  assert.equal(manifest.bundle.candidate, "rc-issue-507");
  assert.equal(manifest.bundle.buildSurface, "wechat_preview");
  assert.equal(manifest.bundle.overallStatus, "passed");
  assert.equal(path.basename(manifest.artifacts.primaryJourneyEvidence), primaryJourneyFile);
  assert.equal(path.basename(manifest.artifacts.primaryJourneyEvidenceMarkdown), primaryJourneyMarkdownFile);
  assert.equal(manifest.journey.find((entry) => entry.id === "lobby-entry")?.status, "passed");
  assert.equal(manifest.checkpointLedger?.entryCount, 7);
  assert.ok((manifest.checkpointLedger?.entries.find((entry) => entry.id === "battle-settlement")?.telemetryCheckpointCount ?? -1) >= 0);
  assert.match(manifest.checkpointLedger?.entries.find((entry) => entry.id === "battle-settlement")?.artifactPath ?? "", /05-battle-settlement\.json$/);
  assert.equal(manifest.requiredEvidence.find((entry) => entry.id === "roomId")?.filled, true);
  assert.equal(path.basename(manifest.artifacts.snapshot), snapshotFile);
  assert.equal(path.basename(manifest.artifacts.summaryMarkdown), summaryFile);
  assert.equal(path.basename(manifest.artifacts.checklistMarkdown), checklistFile);
  assert.equal(path.basename(manifest.artifacts.blockersMarkdown), blockersFile);

  const summaryMarkdown = fs.readFileSync(path.join(outputDir, summaryFile!), "utf8");
  assert.match(summaryMarkdown, /# Cocos RC Evidence Bundle/);
  assert.match(summaryMarkdown, /Overall status: `passed`/);
  assert.match(summaryMarkdown, /Primary journey evidence:/);
  assert.match(summaryMarkdown, /Lobby entry \| `passed` \| 2 item\(s\)/);
  assert.match(summaryMarkdown, /## Checkpoint Ledger/);
  assert.match(summaryMarkdown, /Battle settlement/);

  const checklistMarkdown = fs.readFileSync(path.join(outputDir, checklistFile!), "utf8");
  assert.match(checklistMarkdown, /Candidate: `rc-issue-507`/);
  assert.match(checklistMarkdown, /cocos-rc-snapshot-rc-issue-507-/);

  const blockersMarkdown = fs.readFileSync(path.join(outputDir, blockersFile!), "utf8");
  assert.match(blockersMarkdown, /Candidate: `rc-issue-507`/);
  assert.match(blockersMarkdown, /cocos-rc-snapshot-rc-issue-507-/);
});
