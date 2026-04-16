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
    "npm",
    [
      "exec",
      "--yes",
      "tsx",
      "--",
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
    pmSummary: {
      focusChainLabel: string;
      focusStages: Array<{
        id: string;
        reachedCount: number;
        dropOffCount: number;
      }>;
      narrative: string[];
    };
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
  assert.equal(report.pmSummary.focusChainLabel, "Tutorial Completed -> First Campaign Mission Started -> First Battle Settled -> First Reward Claimed");
  assert.deepEqual(report.pmSummary.focusStages, [
    {
      id: "onboarding_completed",
      label: "Onboarding Completed",
      reachedCount: 5,
      dropOffCount: 0,
      dropOffRateFromPrevious: 0
    },
    {
      id: "first_campaign_mission_started",
      label: "First Campaign Mission Started",
      reachedCount: 4,
      dropOffCount: 1,
      dropOffRateFromPrevious: 0.2
    },
    {
      id: "first_battle_settled",
      label: "First Battle Settled",
      reachedCount: 3,
      dropOffCount: 1,
      dropOffRateFromPrevious: 0.25
    },
    {
      id: "first_reward_claimed",
      label: "First Reward Claimed",
      reachedCount: 2,
      dropOffCount: 1,
      dropOffRateFromPrevious: 0.3333
    }
  ]);
  assert.match(report.pmSummary.narrative[0] ?? "", /2\/6 entrants reached the full post-tutorial chain/);
  assert.equal(report.stageReports.find((stage) => stage.id === "tutorial_step_2_seen")?.reachedCount, 5);
  assert.equal(report.stageReports.find((stage) => stage.id === "tutorial_step_3_seen")?.dropOffCount, 0);
  assert.equal(report.stageReports.find((stage) => stage.id === "onboarding_completed")?.reachedCount, 5);
  assert.equal(report.stageReports.find((stage) => stage.id === "first_campaign_mission_started")?.reachedCount, 4);
  assert.equal(report.stageReports.find((stage) => stage.id === "first_battle_settled")?.reachedCount, 3);
  assert.equal(report.stageReports.find((stage) => stage.id === "first_battle_settled")?.dropOffCount, 1);
  assert.equal(report.stageReports.find((stage) => stage.id === "first_reward_claimed")?.reachedCount, 2);
  assert.equal(report.stageReports.find((stage) => stage.id === "first_reward_claimed")?.dropOffCount, 1);
  assert.deepEqual(
    report.topFailureReasons.map((failure) => [failure.reason, failure.count, failure.playerCount]),
    [
      ["manual_exit", 2, 1],
      ["disconnect", 1, 1],
      ["timeout", 1, 1],
      ["validation_failure", 1, 1]
    ]
  );
  assert.equal(report.observability.entrantsWithFailureEvidence, 4);
  assert.equal(report.observability.entrantsWithoutFailureEvidence, 2);
  assert.equal(report.regressions.some((item) => item.startsWith("completion_rate_below_threshold:")), true);
  assert.equal(report.regressions.some((item) => item.startsWith("median_completion_time_above_threshold:")), true);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /## PM Summary/);
  assert.match(markdown, /Focus chain: Tutorial Completed -> First Campaign Mission Started -> First Battle Settled -> First Reward Claimed/);
  assert.match(markdown, /## Canonical Stages/);
  assert.match(markdown, /## Focus Chain/);
  assert.match(markdown, /Completion rate: 33\.3%/);
  assert.match(markdown, /First Campaign Mission Started/);
  assert.match(markdown, /First Reward Claimed/);
  assert.match(markdown, /`disconnect` count=1/);
  assert.match(markdown, /Failure reason coverage: 4\/6 entrants/);
});
