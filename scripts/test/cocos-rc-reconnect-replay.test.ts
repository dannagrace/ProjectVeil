import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

test("release:cocos:rc-reconnect-replay emits candidate-scoped resume and fallback evidence", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-cocos-rc-reconnect-"));
  const outputDir = path.join(workspace, "artifacts", "release-readiness");

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/cocos-rc-reconnect-replay.ts",
      "--candidate",
      "rc-issue-1329",
      "--output-dir",
      outputDir,
      "--owner",
      "release-bot",
      "--server",
      "runtime-harness://ci"
    ],
    {
      cwd: repoRoot,
      stdio: "pipe"
    }
  );

  const files = fs.readdirSync(outputDir).sort();
  const jsonFile = files.find((entry) => entry.startsWith("cocos-rc-reconnect-replay-") && entry.endsWith(".json"));
  const markdownFile = files.find((entry) => entry.startsWith("cocos-rc-reconnect-replay-") && entry.endsWith(".md"));
  const milestoneDir = files.find((entry) => entry.startsWith("cocos-rc-reconnect-replay-") && !entry.endsWith(".json") && !entry.endsWith(".md"));

  assert.ok(jsonFile);
  assert.ok(markdownFile);
  assert.ok(milestoneDir);

  const artifact = JSON.parse(fs.readFileSync(path.join(outputDir, jsonFile!), "utf8")) as {
    artifactType: string;
    candidate: { name: string; shortRevision: string };
    execution: { owner: string; overallStatus: string };
    environment: { server: string };
    artifacts: { milestoneDir: string; markdownPath: string };
    reviewSignals: {
      resumeSuccessVerified: boolean;
      freshJoinFallbackVerified: boolean;
      failureReasons: string[];
    };
    scenarios: Array<{
      id: string;
      status: string;
      observedResumeFailureReason: string | null;
      reconnectTokens: string[];
      joinAttempts: number;
      phaseResults: Array<{ artifactPath: string; status: string }>;
      finalState: { day: number | null; statusSummary: string[] };
    }>;
  };

  assert.equal(artifact.artifactType, "cocos-rc-reconnect-replay");
  assert.equal(artifact.candidate.name, "rc-issue-1329");
  assert.match(artifact.candidate.shortRevision, /^[0-9a-f]+$/);
  assert.equal(artifact.execution.owner, "release-bot");
  assert.equal(artifact.execution.overallStatus, "passed");
  assert.equal(artifact.environment.server, "runtime-harness://ci");
  assert.equal(path.basename(artifact.artifacts.markdownPath), markdownFile);
  assert.match(artifact.artifacts.milestoneDir, /cocos-rc-reconnect-replay-rc-issue-1329-/);
  assert.equal(artifact.reviewSignals.resumeSuccessVerified, true);
  assert.equal(artifact.reviewSignals.freshJoinFallbackVerified, true);
  assert.deepEqual(artifact.reviewSignals.failureReasons, ["transport_lost"]);
  assert.deepEqual(
    artifact.scenarios.map((scenario) => scenario.id),
    ["resume-success", "resume-fallback-fresh-join"]
  );
  assert.equal(artifact.scenarios[0]?.status, "passed");
  assert.equal(artifact.scenarios[0]?.joinAttempts, 0);
  assert.ok(artifact.scenarios[0]?.reconnectTokens.includes("resume-success-token"));
  assert.equal(artifact.scenarios[1]?.status, "passed");
  assert.equal(artifact.scenarios[1]?.observedResumeFailureReason, "transport_lost");
  assert.equal(artifact.scenarios[1]?.joinAttempts, 1);
  assert.ok(artifact.scenarios[1]?.reconnectTokens.includes("stale-reconnect-token"));
  assert.equal(artifact.scenarios[1]?.finalState.day, 9);
  assert.ok(artifact.scenarios[1]?.finalState.statusSummary.some((entry) => entry.includes("day=9")));
  assert.ok(artifact.scenarios.every((scenario) => scenario.phaseResults.every((step) => step.status === "passed")));

  const milestoneFiles = fs.readdirSync(path.join(outputDir, milestoneDir!)).sort();
  assert.deepEqual(milestoneFiles, [
    "01-resume-fallback-replay.json",
    "01-resume-success-bootstrap.json",
    "02-resume-fallback-fresh-join.json",
    "02-resume-success-restored.json"
  ]);

  const markdown = fs.readFileSync(path.join(outputDir, markdownFile!), "utf8");
  assert.match(markdown, /# Cocos RC Reconnect Replay/);
  assert.match(markdown, /Resume success verified: `true`/);
  assert.match(markdown, /Fresh-join fallback verified: `true`/);
  assert.match(markdown, /Stored-token resume succeeds/);
  assert.match(markdown, /Resume failure falls back to fresh join/);
  assert.match(markdown, /transport_lost/);
});
