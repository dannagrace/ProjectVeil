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
  const mainJourneyManifestFile = files.find((entry) => entry.startsWith("cocos-main-journey-manifest-") && entry.endsWith(".json"));
  const mainJourneyManifestMarkdownFile = files.find((entry) => entry.startsWith("cocos-main-journey-manifest-") && entry.endsWith(".md"));
  const mainJourneyReplayGateFile = files.find((entry) => entry.startsWith("cocos-main-journey-replay-gate-") && entry.endsWith(".json"));
  const mainJourneyReplayGateMarkdownFile = files.find((entry) => entry.startsWith("cocos-main-journey-replay-gate-") && entry.endsWith(".md"));
  const presentationSignoffFile = files.find((entry) => entry.startsWith("cocos-presentation-signoff-") && entry.endsWith(".json"));
  const presentationSignoffMarkdownFile = files.find((entry) => entry.startsWith("cocos-presentation-signoff-") && entry.endsWith(".md"));
  const checklistFile = files.find((entry) => entry.startsWith("cocos-rc-checklist-") && entry.endsWith(".md"));
  const blockersFile = files.find((entry) => entry.startsWith("cocos-rc-blockers-") && entry.endsWith(".md"));

  assert.ok(primaryJourneyFile);
  assert.ok(primaryJourneyMarkdownFile);
  assert.ok(manifestFile);
  assert.ok(summaryFile);
  assert.ok(snapshotFile);
  assert.ok(mainJourneyManifestFile);
  assert.ok(mainJourneyManifestMarkdownFile);
  assert.ok(mainJourneyReplayGateFile);
  assert.ok(mainJourneyReplayGateMarkdownFile);
  assert.ok(presentationSignoffFile);
  assert.ok(presentationSignoffMarkdownFile);
  assert.ok(checklistFile);
  assert.ok(blockersFile);
  assert.match(manifestFile ?? "", /rc-issue-507-/);

  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, manifestFile!), "utf8")) as {
    bundle: { candidate: string; buildSurface: string; overallStatus: string };
    failureSummary: {
      summary: string;
      regressedJourneySegments: Array<{ id: string }>;
      blockedJourneySegments: Array<{ id: string }>;
      lackingJourneyEvidence: Array<{ id: string }>;
      lackingRequiredEvidence: Array<{ id: string }>;
    };
    artifacts: {
      primaryJourneyEvidence: string;
      primaryJourneyEvidenceMarkdown: string;
      mainJourneyManifest: string;
      mainJourneyManifestMarkdown: string;
      mainJourneyReplayGate: string;
      mainJourneyReplayGateMarkdown: string;
      snapshot: string;
      summaryMarkdown: string;
      presentationSignoff: string;
      presentationSignoffMarkdown: string;
      checklistMarkdown: string;
      blockersMarkdown: string;
    };
    review: {
      functionalEvidence: { status: string; summary: string };
      mainJourneyReplayGate: { status: string; summary: string; presentationStatus: string };
      presentationSignoff: { status: string; summary: string };
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
  assert.equal(path.basename(manifest.artifacts.mainJourneyManifest), mainJourneyManifestFile);
  assert.equal(path.basename(manifest.artifacts.mainJourneyManifestMarkdown), mainJourneyManifestMarkdownFile);
  assert.equal(path.basename(manifest.artifacts.mainJourneyReplayGate), mainJourneyReplayGateFile);
  assert.equal(path.basename(manifest.artifacts.mainJourneyReplayGateMarkdown), mainJourneyReplayGateMarkdownFile);
  assert.equal(manifest.journey.find((entry) => entry.id === "lobby-entry")?.status, "passed");
  assert.equal(manifest.checkpointLedger?.entryCount, 7);
  assert.ok((manifest.checkpointLedger?.entries.find((entry) => entry.id === "battle-settlement")?.telemetryCheckpointCount ?? -1) >= 0);
  assert.match(manifest.checkpointLedger?.entries.find((entry) => entry.id === "battle-settlement")?.artifactPath ?? "", /05-battle-settlement\.json$/);
  assert.equal(manifest.requiredEvidence.find((entry) => entry.id === "roomId")?.filled, true);
  assert.equal(path.basename(manifest.artifacts.snapshot), snapshotFile);
  assert.equal(path.basename(manifest.artifacts.summaryMarkdown), summaryFile);
  assert.equal(path.basename(manifest.artifacts.presentationSignoff), presentationSignoffFile);
  assert.equal(path.basename(manifest.artifacts.presentationSignoffMarkdown), presentationSignoffMarkdownFile);
  assert.equal(path.basename(manifest.artifacts.checklistMarkdown), checklistFile);
  assert.equal(path.basename(manifest.artifacts.blockersMarkdown), blockersFile);
  assert.equal(manifest.review.functionalEvidence.status, "passed");
  assert.match(manifest.review.functionalEvidence.summary, /lobby, room, and reconnect/);
  assert.equal(manifest.review.mainJourneyReplayGate.status, "passed");
  assert.equal(manifest.review.mainJourneyReplayGate.presentationStatus, "hold");
  assert.match(manifest.review.mainJourneyReplayGate.summary, /presentation blockers remain tracked separately/);
  assert.equal(manifest.review.presentationSignoff.status, "hold");
  assert.match(manifest.review.presentationSignoff.summary, /presentation sign-off remains on hold/);
  assert.equal(manifest.failureSummary.summary, "No regressions or evidence gaps recorded.");
  assert.equal(manifest.failureSummary.regressedJourneySegments.length, 0);
  assert.equal(manifest.failureSummary.blockedJourneySegments.length, 0);
  assert.equal(manifest.failureSummary.lackingJourneyEvidence.length, 0);
  assert.equal(manifest.failureSummary.lackingRequiredEvidence.length, 0);

  const summaryMarkdown = fs.readFileSync(path.join(outputDir, summaryFile!), "utf8");
  assert.match(summaryMarkdown, /# Cocos RC Evidence Bundle/);
  assert.match(summaryMarkdown, /Overall status: `passed`/);
  assert.match(summaryMarkdown, /Primary journey evidence:/);
  assert.match(summaryMarkdown, /Main-journey manifest:/);
  assert.match(summaryMarkdown, /Main-journey replay gate JSON:/);
  assert.match(summaryMarkdown, /Main-journey replay gate markdown:/);
  assert.match(summaryMarkdown, /Presentation sign-off JSON:/);
  assert.match(summaryMarkdown, /Presentation sign-off markdown:/);
  assert.match(summaryMarkdown, /Functional evidence status: `passed`/);
  assert.match(summaryMarkdown, /Lobby entry \| `passed` \| 2 item\(s\)/);
  assert.match(summaryMarkdown, /## Checkpoint Ledger/);
  assert.match(summaryMarkdown, /Battle settlement/);

  const mainJourneyManifest = JSON.parse(fs.readFileSync(path.join(outputDir, mainJourneyManifestFile!), "utf8")) as {
    candidate: { name: string; revision: { shortCommit: string } };
    canonicalSteps: Array<{ id: string; title: string; flags: { placeholder: boolean; manualOnly: boolean } }>;
  };
  assert.equal(mainJourneyManifest.candidate.name, "rc-issue-507");
  assert.match(mainJourneyManifest.candidate.revision.shortCommit, /^[0-9a-f]+$/);
  assert.deepEqual(
    mainJourneyManifest.canonicalSteps.map((step) => step.id),
    ["lobby-entry", "room-join", "map-explore", "first-battle", "battle-settlement", "reconnect-restore"]
  );
  assert.equal(mainJourneyManifest.canonicalSteps.find((step) => step.id === "map-explore")?.flags.placeholder, true);
  assert.equal(mainJourneyManifest.canonicalSteps.find((step) => step.id === "room-join")?.flags.manualOnly, false);

  const mainJourneyManifestMarkdown = fs.readFileSync(path.join(outputDir, mainJourneyManifestMarkdownFile!), "utf8");
  assert.match(mainJourneyManifestMarkdown, /# Cocos Main-Journey Evidence Manifest/);
  assert.match(mainJourneyManifestMarkdown, /Lobby \/ login/);
  assert.match(mainJourneyManifestMarkdown, /placeholder=yes, manual-only=yes/);
  assert.match(mainJourneyManifestMarkdown, /Room join/);

  const presentationSignoff = JSON.parse(fs.readFileSync(path.join(outputDir, presentationSignoffFile!), "utf8")) as {
    functionalEvidence: { status: string; summary: string };
    checklist: Array<{ area: string; status: string; blockingPolicy: string }>;
    signoff: { status: string; blockingItems: string[]; controlledTestGaps: string[]; summary: string };
  };
  assert.equal(presentationSignoff.functionalEvidence.status, "passed");
  assert.equal(presentationSignoff.signoff.status, "hold");
  assert.ok(presentationSignoff.checklist.some((entry) => entry.area === "Audio" && entry.status === "waived-controlled-test"));
  assert.ok(presentationSignoff.checklist.some((entry) => entry.area === "Animation / transitions" && entry.blockingPolicy === "blocking"));
  assert.ok(presentationSignoff.signoff.blockingItems.includes("Pixel art / scene visuals"));
  assert.ok(presentationSignoff.signoff.controlledTestGaps.includes("Audio"));

  const presentationSignoffMarkdown = fs.readFileSync(path.join(outputDir, presentationSignoffMarkdownFile!), "utf8");
  assert.match(presentationSignoffMarkdown, /# Cocos Presentation Sign-Off/);
  assert.match(presentationSignoffMarkdown, /Candidate: `rc-issue-507`/);
  assert.match(presentationSignoffMarkdown, /Functional evidence status: `passed`/);
  assert.match(presentationSignoffMarkdown, /Presentation sign-off status: `hold`/);
  assert.match(presentationSignoffMarkdown, /waived-controlled-test/);
  assert.match(presentationSignoffMarkdown, /acceptable-controlled-test-gap/);

  const checklistMarkdown = fs.readFileSync(path.join(outputDir, checklistFile!), "utf8");
  assert.match(checklistMarkdown, /Candidate: `rc-issue-507`/);
  assert.match(checklistMarkdown, /cocos-rc-snapshot-rc-issue-507-/);

  const blockersMarkdown = fs.readFileSync(path.join(outputDir, blockersFile!), "utf8");
  assert.match(blockersMarkdown, /Candidate: `rc-issue-507`/);
  assert.match(blockersMarkdown, /cocos-rc-snapshot-rc-issue-507-/);

  const mainJourneyReplayGate = JSON.parse(fs.readFileSync(path.join(outputDir, mainJourneyReplayGateFile!), "utf8")) as {
    summary: { status: string; presentationBlockerCount: number };
    triage: { presentationStatus: string; presentationBlockers: string[]; infrastructureFailures: unknown[] };
  };
  assert.equal(mainJourneyReplayGate.summary.status, "passed");
  assert.ok(mainJourneyReplayGate.summary.presentationBlockerCount >= 1);
  assert.equal(mainJourneyReplayGate.triage.presentationStatus, "hold");
  assert.equal(mainJourneyReplayGate.triage.infrastructureFailures.length, 0);
  assert.ok(mainJourneyReplayGate.triage.presentationBlockers.includes("Pixel art / scene visuals"));

  const mainJourneyReplayGateMarkdown = fs.readFileSync(path.join(outputDir, mainJourneyReplayGateMarkdownFile!), "utf8");
  assert.match(mainJourneyReplayGateMarkdown, /# Cocos Main-Journey Replay Gate/);
  assert.match(mainJourneyReplayGateMarkdown, /Reviewer Workflow/);
});
