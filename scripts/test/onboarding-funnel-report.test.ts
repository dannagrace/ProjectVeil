import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");
const eventsFixturePath = path.join(repoRoot, "scripts/test/fixtures/onboarding-funnel-events.json");
const diagnosticsFixturePath = path.join(repoRoot, "scripts/test/fixtures/onboarding-funnel-diagnostics.json");

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-onboarding-funnel-"));
}

test("onboarding funnel report aggregates completion, timings, drop-off, and failure reasons", () => {
  const workspace = createTempWorkspace();
  const outputPath = path.join(workspace, "onboarding-funnel-report.json");
  const markdownOutputPath = path.join(workspace, "onboarding-funnel-report.md");

  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/onboarding-funnel-report.ts",
      "--input",
      eventsFixturePath,
      "--diagnostics",
      diagnosticsFixturePath,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stdout, /Completion rate: 33\.3%/);
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(markdownOutputPath), true);

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: {
      entrants: number;
      completed: number;
      completionRate: number;
      medianCompletionSeconds: number | null;
      medianCompletionMinutes: number | null;
    };
    regressions: string[];
    stageReports: Array<{
      id: string;
      reachedCount: number;
      dropOffCount: number;
    }>;
    topFailureReasons: Array<{
      reason: string;
      count: number;
      playerCount: number;
    }>;
    observability: {
      entrantsWithFailureEvidence: number;
      entrantsWithoutFailureEvidence: number;
    };
  };

  assert.deepEqual(report.summary, {
    entrants: 6,
    completed: 2,
    completionRate: 0.3333,
    medianCompletionSeconds: 420,
    medianCompletionMinutes: 7
  });
  assert.equal(report.stageReports.find((stage) => stage.id === "tutorial_step_2_seen")?.reachedCount, 4);
  assert.equal(report.stageReports.find((stage) => stage.id === "tutorial_step_3_seen")?.dropOffCount, 1);
  assert.equal(report.stageReports.find((stage) => stage.id === "onboarding_completed")?.dropOffCount, 1);
  assert.deepEqual(
    report.topFailureReasons.map((failure) => [failure.reason, failure.count, failure.playerCount]),
    [
      ["disconnect", 1, 1],
      ["manual_exit", 1, 1],
      ["timeout", 1, 1],
      ["validation_failure", 1, 1]
    ]
  );
  assert.equal(report.observability.entrantsWithFailureEvidence, 4);
  assert.equal(report.observability.entrantsWithoutFailureEvidence, 2);
  assert.equal(report.regressions.some((item) => item.startsWith("completion_rate_below_threshold:")), true);
  assert.equal(report.regressions.some((item) => item.startsWith("median_completion_time_above_threshold:")), true);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /## Canonical Stages/);
  assert.match(markdown, /Completion rate: 33\.3%/);
  assert.match(markdown, /`disconnect` count=1/);
  assert.match(markdown, /Failure reason coverage: 4\/6 entrants/);
});
