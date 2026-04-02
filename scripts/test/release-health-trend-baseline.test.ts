import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReleaseHealthTrendBaselineComparisonReport,
  buildReleaseHealthTrendBaselineReport,
  renderComparisonMarkdown,
  renderMarkdown
} from "../release-health-trend-baseline.ts";

const repoRoot = path.resolve(__dirname, "../..");

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-release-health-trend-"));
}

function createCandidateDir(
  workspace: string,
  name: string,
  options: {
    generatedAt: string;
    candidateRevision: string;
    releaseHealthStatus: "healthy" | "warning" | "blocking";
    warningCount?: number;
    dashboardDecision: "ready" | "pending" | "blocked";
    blockers: Array<{ signalId: string; title: string; summary: string }>;
    releaseGateStatuses: Partial<Record<"h5-release-candidate-smoke" | "multiplayer-reconnect-soak" | "wechat-release", "passed" | "failed">>;
    dashboardStatuses: Partial<Record<"server-health" | "auth-readiness", "pass" | "warn" | "fail">>;
    omittedReleaseGateIds?: Array<"h5-release-candidate-smoke" | "multiplayer-reconnect-soak" | "wechat-release">;
    omittedDashboardGateIds?: Array<"server-health" | "auth-readiness">;
  }
): string {
  const dir = path.join(workspace, name);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "release-health-summary.json"), {
    generatedAt: options.generatedAt,
    revision: {
      shortCommit: options.candidateRevision,
      branch: "main"
    },
    summary: {
      status: options.releaseHealthStatus,
      blockerCount: options.blockers.length,
      warningCount: options.warningCount ?? (options.releaseHealthStatus === "warning" ? 1 : 0),
      infoCount: 3
    },
    triage: {
      blockers: options.blockers
    }
  });
  writeJson(path.join(dir, "release-gate-summary.json"), {
    generatedAt: options.generatedAt,
    summary: {
      status: Object.values(options.releaseGateStatuses).every((status) => status === "passed") ? "passed" : "failed"
    },
    gates: [
      {
        id: "h5-release-candidate-smoke",
        label: "H5 packaged RC smoke",
        status: options.releaseGateStatuses["h5-release-candidate-smoke"] ?? "passed",
        summary: "H5 smoke gate"
      },
      {
        id: "multiplayer-reconnect-soak",
        label: "Multiplayer reconnect soak",
        status: options.releaseGateStatuses["multiplayer-reconnect-soak"] ?? "passed",
        summary: "Reconnect soak gate"
      },
      {
        id: "wechat-release",
        label: "WeChat release validation",
        status: options.releaseGateStatuses["wechat-release"] ?? "passed",
        summary: "WeChat gate"
      }
    ].filter((gate) => !options.omittedReleaseGateIds?.includes(gate.id as "h5-release-candidate-smoke" | "multiplayer-reconnect-soak" | "wechat-release"))
  });
  writeJson(path.join(dir, "release-readiness-dashboard.json"), {
    generatedAt: options.generatedAt,
    goNoGo: {
      decision: options.dashboardDecision,
      candidateRevision: options.candidateRevision,
      summary: `Candidate ${options.candidateRevision} is ${options.dashboardDecision}.`
    },
    gates: [
      {
        id: "server-health",
        label: "Server health",
        status: options.dashboardStatuses["server-health"] ?? "pass",
        summary: "Server health gate"
      },
      {
        id: "auth-readiness",
        label: "Auth readiness",
        status: options.dashboardStatuses["auth-readiness"] ?? "pass",
        summary: "Auth readiness gate"
      }
    ].filter((gate) => !options.omittedDashboardGateIds?.includes(gate.id as "server-health" | "auth-readiness"))
  });
  writeJson(path.join(dir, "source-run.json"), {
    runId: name,
    runUrl: `https://example.com/runs/${name}`,
    headSha: options.candidateRevision,
    headBranch: "main"
  });
  return dir;
}

test("buildReleaseHealthTrendBaselineReport highlights new vs known blockers and signal regressions", () => {
  const workspace = createTempWorkspace();
  const currentDir = createCandidateDir(workspace, "current", {
    generatedAt: "2026-04-03T09:00:00.000Z",
    candidateRevision: "cur1234",
    releaseHealthStatus: "blocking",
    dashboardDecision: "blocked",
    blockers: [
      {
        signalId: "release-gate",
        title: "Release gate summary",
        summary: "Release gate summary failed: WeChat validation failed"
      },
      {
        signalId: "sync-governance",
        title: "Sync governance",
        summary: "Sync governance matrix is failing."
      }
    ],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "failed",
      "wechat-release": "failed"
    },
    dashboardStatuses: {
      "server-health": "warn",
      "auth-readiness": "pass"
    }
  });
  const previousDir = createCandidateDir(workspace, "previous", {
    generatedAt: "2026-04-02T09:00:00.000Z",
    candidateRevision: "prev9876",
    releaseHealthStatus: "blocking",
    dashboardDecision: "pending",
    blockers: [
      {
        signalId: "release-gate",
        title: "Release gate summary",
        summary: "Release gate summary failed: WeChat validation failed"
      },
      {
        signalId: "coverage",
        title: "Coverage thresholds",
        summary: "Coverage thresholds failed in 1 scope(s)."
      }
    ],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "passed",
      "wechat-release": "passed"
    },
    dashboardStatuses: {
      "server-health": "pass",
      "auth-readiness": "warn"
    }
  });
  createCandidateDir(workspace, "older", {
    generatedAt: "2026-04-01T09:00:00.000Z",
    candidateRevision: "old1111",
    releaseHealthStatus: "healthy",
    dashboardDecision: "ready",
    blockers: [],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "passed",
      "wechat-release": "passed"
    },
    dashboardStatuses: {
      "server-health": "pass",
      "auth-readiness": "pass"
    }
  });

  const report = buildReleaseHealthTrendBaselineReport({
    artifactDirs: [currentDir, previousDir],
    limit: 2
  });

  assert.equal(report.summary.candidateCount, 2);
  assert.equal(report.summary.currentCandidate, "cur1234");
  assert.equal(report.summary.previousCandidate, "prev9876");
  assert.equal(report.summary.newBlockerCount, 1);
  assert.equal(report.summary.knownBlockerCount, 1);
  assert.equal(report.summary.recoveredBlockerCount, 1);
  assert.deepEqual(report.blockers.new.map((blocker) => blocker.signalId), ["sync-governance"]);
  assert.deepEqual(report.blockers.known.map((blocker) => blocker.signalId), ["release-gate"]);
  assert.deepEqual(report.blockers.recovered.map((blocker) => blocker.signalId), ["coverage"]);
  assert.equal(report.signalTrends.find((signal) => signal.id === "multiplayer-reconnect-soak")?.direction, "regressed");
  assert.equal(report.signalTrends.find((signal) => signal.id === "server-health")?.direction, "regressed");
  assert.equal(report.signalTrends.find((signal) => signal.id === "auth-readiness")?.direction, "improved");

  const markdown = renderMarkdown(report);
  assert.match(markdown, /## Blocker Delta/);
  assert.match(markdown, /1 newly introduced, 1 already known, 1 recovered/);
  assert.match(markdown, /sync-governance: Sync governance matrix is failing\./);
  assert.match(markdown, /coverage: Coverage thresholds failed in 1 scope\(s\)\./);
  assert.match(
    markdown,
    /Multiplayer reconnect soak regressed from PASS at prev9876 to FAIL at cur1234\./
  );
  assert.match(markdown, /History: cur1234:fail -> prev9876:pass/);
});

test("release:health:trend-baseline CLI scans the cache dir and writes stable outputs", () => {
  const workspace = createTempWorkspace();
  const cacheDir = path.join(workspace, "cache");
  createCandidateDir(cacheDir, "run-101", {
    generatedAt: "2026-04-03T09:00:00.000Z",
    candidateRevision: "cur1234",
    releaseHealthStatus: "warning",
    dashboardDecision: "pending",
    blockers: [],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "passed",
      "wechat-release": "passed"
    },
    dashboardStatuses: {
      "server-health": "pass",
      "auth-readiness": "warn"
    }
  });
  createCandidateDir(cacheDir, "run-100", {
    generatedAt: "2026-04-02T09:00:00.000Z",
    candidateRevision: "prev9876",
    releaseHealthStatus: "healthy",
    dashboardDecision: "ready",
    blockers: [],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "passed",
      "wechat-release": "passed"
    },
    dashboardStatuses: {
      "server-health": "pass",
      "auth-readiness": "pass"
    }
  });

  const outputPath = path.join(workspace, "release-health-trend-baseline.json");
  const markdownOutputPath = path.join(workspace, "release-health-trend-baseline.md");
  const result = spawnSync(
    "node",
    ["--import", "tsx", "./scripts/release-health-trend-baseline.ts", "--cache-dir", cacheDir, "--limit", "2", "--output", outputPath, "--markdown-output", markdownOutputPath],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stdout, /Wrote release health trend baseline JSON:/);
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(markdownOutputPath), true);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: {
      candidateCount: number;
      currentCandidate: string;
      previousCandidate?: string;
    };
  };
  assert.equal(report.summary.candidateCount, 2);
  assert.equal(report.summary.currentCandidate, "cur1234");
  assert.equal(report.summary.previousCandidate, "prev9876");
});

test("compare mode flags blocker, warning, missing-evidence, and signal regressions against the baseline", () => {
  const workspace = createTempWorkspace();
  const currentDir = createCandidateDir(workspace, "current", {
    generatedAt: "2026-04-03T09:00:00.000Z",
    candidateRevision: "cur1234",
    releaseHealthStatus: "blocking",
    warningCount: 3,
    dashboardDecision: "blocked",
    blockers: [
      {
        signalId: "release-gate",
        title: "Release gate summary",
        summary: "Release gate summary failed: WeChat validation failed"
      },
      {
        signalId: "sync-governance",
        title: "Sync governance",
        summary: "Sync governance matrix is failing."
      }
    ],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "passed"
    },
    omittedReleaseGateIds: ["wechat-release"],
    dashboardStatuses: {
      "server-health": "warn",
      "auth-readiness": "fail"
    }
  });
  const baselineA = createCandidateDir(workspace, "baseline-a", {
    generatedAt: "2026-04-02T09:00:00.000Z",
    candidateRevision: "base111",
    releaseHealthStatus: "healthy",
    dashboardDecision: "ready",
    blockers: [],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "passed",
      "wechat-release": "passed"
    },
    dashboardStatuses: {
      "server-health": "pass",
      "auth-readiness": "pass"
    }
  });
  const baselineB = createCandidateDir(workspace, "baseline-b", {
    generatedAt: "2026-04-01T09:00:00.000Z",
    candidateRevision: "base222",
    releaseHealthStatus: "warning",
    dashboardDecision: "pending",
    blockers: [],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "passed",
      "wechat-release": "passed"
    },
    dashboardStatuses: {
      "server-health": "pass",
      "auth-readiness": "warn"
    }
  });

  const report = buildReleaseHealthTrendBaselineComparisonReport({
    artifactDirs: [currentDir, baselineA, baselineB],
    limit: 3,
    compareCurrent: true
  });

  assert.equal(report.summary.status, "fail");
  assert.deepEqual(report.summary.baselineCandidates, ["base111", "base222"]);
  assert.equal(report.summary.baselineSelection, "non-blocking-history");
  assert.equal(report.baseline.blockerCountMedian, 0);
  assert.equal(report.baseline.warningCountMedian, 1);
  assert.equal(report.findings.find((finding) => finding.category === "blocker-count")?.severity, "blocking");
  assert.equal(report.findings.find((finding) => finding.category === "warning-count")?.severity, "warning");
  assert.equal(report.findings.find((finding) => finding.category === "missing-evidence")?.signalId, "wechat-release");
  assert.equal(report.findings.find((finding) => finding.signalId === "candidate-readiness")?.severity, "blocking");
  assert.equal(report.findings.find((finding) => finding.signalId === "server-health")?.severity, "warning");

  const markdown = renderComparisonMarkdown(report);
  assert.match(markdown, /## Findings/);
  assert.match(markdown, /Current candidate: `cur1234`/);
  assert.match(markdown, /baseline median of 0/);
  assert.match(markdown, /WeChat release validation is missing for cur1234; it was present in 2\/2 baseline candidates\./);
  assert.match(markdown, /## Baseline Heuristics/);
});

test("compare CLI writes compare artifacts with stable default filenames", () => {
  const workspace = createTempWorkspace();
  const cacheDir = path.join(workspace, "cache");
  createCandidateDir(cacheDir, "run-101", {
    generatedAt: "2026-04-03T09:00:00.000Z",
    candidateRevision: "cur1234",
    releaseHealthStatus: "warning",
    dashboardDecision: "pending",
    blockers: [],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "passed"
    },
    dashboardStatuses: {
      "server-health": "pass",
      "auth-readiness": "warn"
    }
  });
  createCandidateDir(cacheDir, "run-100", {
    generatedAt: "2026-04-02T09:00:00.000Z",
    candidateRevision: "prev9876",
    releaseHealthStatus: "healthy",
    dashboardDecision: "ready",
    blockers: [],
    releaseGateStatuses: {
      "h5-release-candidate-smoke": "passed",
      "multiplayer-reconnect-soak": "passed",
      "wechat-release": "passed"
    },
    dashboardStatuses: {
      "server-health": "pass",
      "auth-readiness": "pass"
    }
  });

  const result = spawnSync("node", ["--import", "tsx", "./scripts/release-health-trend-baseline.ts", "--cache-dir", cacheDir, "--limit", "2", "--compare-current"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stdout, /Wrote release health trend compare JSON:/);
  assert.equal(fs.existsSync(path.join(repoRoot, "artifacts", "release-readiness", "release-health-trend-compare.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "artifacts", "release-readiness", "release-health-trend-compare.md")), true);
  fs.rmSync(path.join(repoRoot, "artifacts", "release-readiness", "release-health-trend-compare.json"), { force: true });
  fs.rmSync(path.join(repoRoot, "artifacts", "release-readiness", "release-health-trend-compare.md"), { force: true });
});
