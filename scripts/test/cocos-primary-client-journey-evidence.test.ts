import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildArtifact } from "../cocos-primary-client-journey-evidence.ts";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("release:cocos:primary-journey-evidence exports candidate-scoped JSON, markdown, checkpoint-ledger, and blocker artifacts", async () => {
  const workspace = createTempDir("veil-primary-journey-");
  const outputPath = path.join(workspace, "primary-journey.json");
  const markdownOutputPath = path.join(workspace, "primary-journey.md");
  const repoRoot = path.resolve(__dirname, "../..");
  const previousCwd = process.cwd();
  process.chdir(repoRoot);
  try {
    await buildArtifact({
      candidate: "rc-primary-journey",
      outputPath,
      markdownOutputPath,
      owner: "codex"
    });
  } finally {
    process.chdir(previousCwd);
  }

  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(markdownOutputPath), true);

  const artifact = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    candidate: { name: string };
    execution: { owner: string; overallStatus: string; summary: string; durationMs: number };
    environment: { evidenceMode: string };
    artifacts: { milestoneDir: string };
    journey: Array<{
      id: string;
      status: string;
      evidence: string[];
      timing?: { startedAt: string; completedAt: string; durationMs: number };
    }>;
    requiredEvidence: Array<{ id: string; value: string; evidence: string[] }>;
    failureSummary: {
      summary: string;
      regressedJourneySegments: Array<{ id: string }>;
      blockedJourneySegments: Array<{ id: string }>;
      lackingJourneyEvidence: Array<{ id: string }>;
      lackingRequiredEvidence: Array<{ id: string }>;
    };
    checkpointLedger: {
      source: string;
      entryCount: number;
      entries: Array<{ id: string; artifactPath: string; phase: string; telemetryCheckpoints: string[] }>;
    };
  };

  assert.equal(artifact.candidate.name, "rc-primary-journey");
  assert.equal(artifact.execution.owner, "codex");
  assert.equal(artifact.execution.overallStatus, "passed");
  assert.match(artifact.execution.summary, /Headless primary-client journey evidence passed/);
  assert.ok(artifact.execution.durationMs >= 0);
  assert.equal(artifact.environment.evidenceMode, "headless-runtime-diagnostics");
  assert.deepEqual(
    artifact.journey.map((step) => step.id),
    ["lobby-entry", "room-join", "map-explore", "first-battle", "battle-settlement", "reconnect-restore", "return-to-world"]
  );
  assert.ok(artifact.journey.every((step) => step.status === "passed"));
  assert.ok(artifact.journey.every((step) => (step.timing?.durationMs ?? -1) >= 0));
  assert.ok(artifact.journey.every((step) => Boolean(step.timing?.startedAt) && Boolean(step.timing?.completedAt)));
  assert.equal(artifact.requiredEvidence.find((field) => field.id === "roomId")?.value, "room-primary-journey");
  assert.match(artifact.requiredEvidence.find((field) => field.id === "reconnectPrompt")?.value ?? "", /连接已恢复/);
  assert.equal(
    artifact.requiredEvidence.find((field) => field.id === "firstBattleResult")?.value,
    "attacker_victory; gold +12; experience +25"
  );
  assert.equal(artifact.failureSummary.summary, "No regressions or evidence gaps recorded.");
  assert.equal(artifact.failureSummary.regressedJourneySegments.length, 0);
  assert.equal(artifact.failureSummary.blockedJourneySegments.length, 0);
  assert.equal(artifact.failureSummary.lackingJourneyEvidence.length, 0);
  assert.equal(artifact.failureSummary.lackingRequiredEvidence.length, 0);
  assert.equal(artifact.checkpointLedger.source, "primary-journey-evidence");
  assert.equal(artifact.checkpointLedger.entryCount, 7);
  assert.equal(artifact.checkpointLedger.entries.find((entry) => entry.id === "room-join")?.phase, "room-join");
  assert.match(artifact.checkpointLedger.entries.find((entry) => entry.id === "battle-settlement")?.artifactPath ?? "", /05-battle-settlement\.json$/);
  assert.ok(
    (artifact.checkpointLedger.entries.find((entry) => entry.id === "battle-settlement")?.telemetryCheckpoints.length ?? -1) >= 0
  );

  const milestoneDir = path.resolve(path.resolve(__dirname, "../.."), artifact.artifacts.milestoneDir);
  const milestoneFiles = fs.readdirSync(milestoneDir).sort();
  assert.deepEqual(milestoneFiles, [
    "01-lobby-entry.json",
    "02-room-join.json",
    "03-map-explore.json",
    "04-first-battle.json",
    "05-battle-settlement.json",
    "06-reconnect-restore.json",
    "07-return-to-world.json"
  ]);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /# Cocos Primary-Client Journey Evidence/);
  assert.match(markdown, /Battle settlement/);
  assert.match(markdown, /Duration: `\d+ms`/);
  assert.match(markdown, /Timing/);
  assert.match(markdown, /headless-runtime-diagnostics/);
  assert.match(markdown, /## Checkpoint Ledger/);
  assert.match(markdown, /## Blocker Drill-Down/);
  assert.match(markdown, /No open blocker or evidence gap recorded/);
});
