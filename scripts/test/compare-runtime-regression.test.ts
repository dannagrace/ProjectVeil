import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRuntimeRegressionReport,
  renderRuntimeRegressionSummary
} from "../compare-runtime-regression.ts";

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-runtime-regression-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createBaseline() {
  return {
    schemaVersion: 1,
    baselineId: "server-runtime-regression",
    title: "Key server runtime regression baseline",
    artifactType: "stress-runtime-metrics",
    sourceCommand: "npm run stress:rooms:baseline",
    defaults: {
      failedRoomsMax: 0,
      rssPeakMbMax: 320,
      heapPeakMbMax: 110,
      peakActiveHandlesMax: 120,
      requireRuntimeHealthAfterConnect: true,
      requireRuntimeHealthAfterScenario: true,
      requireEmptyErrorMessage: true
    },
    scenarios: {
      world_progression: {
        rooms: 48,
        successfulRoomsMin: 48,
        actionsPerSecondMin: 150,
        durationMsMax: 1200,
        cpuCoreUtilizationPctMax: 80,
        runtimeHealthAfterConnect: {
          activeRoomCountEq: 48,
          connectionCountEq: 48
        },
        runtimeHealthAfterScenario: {
          worldActionsTotalMin: 96
        }
      }
    }
  };
}

function createArtifact(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    artifactType: "stress-runtime-metrics",
    generatedAt: "2026-03-30T01:00:00.000Z",
    command: "npm run stress:rooms:baseline",
    revision: {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    results: [
      {
        scenario: "world_progression",
        rooms: 48,
        successfulRooms: 48,
        failedRooms: 0,
        completedActions: 144,
        durationMs: 821.43,
        roomsPerSecond: 58.43,
        actionsPerSecond: 175.3,
        cpuUserMs: 100,
        cpuSystemMs: 20,
        cpuTotalMs: 120,
        cpuCoreUtilizationPct: 71.5,
        rssStartMb: 120,
        rssPeakMb: 213.95,
        rssEndMb: 180,
        heapStartMb: 30,
        heapPeakMb: 55.42,
        heapEndMb: 40,
        peakActiveHandles: 105,
        runtimeHealthAfterConnect: {
          checkedAt: "2026-03-30T01:00:00.000Z",
          activeRoomCount: 48,
          connectionCount: 48,
          activeBattleCount: 0,
          heroCount: 96,
          connectMessagesTotal: 48,
          worldActionsTotal: 0,
          battleActionsTotal: 0,
          actionMessagesTotal: 0
        },
        runtimeHealthAfterScenario: {
          checkedAt: "2026-03-30T01:00:01.000Z",
          activeRoomCount: 48,
          connectionCount: 48,
          activeBattleCount: 48,
          heroCount: 96,
          connectMessagesTotal: 48,
          worldActionsTotal: 96,
          battleActionsTotal: 0,
          actionMessagesTotal: 96
        },
        errorMessage: "",
        ...overrides
      }
    ]
  };
}

test("buildRuntimeRegressionReport passes when the artifact stays within thresholds", () => {
  const workspace = createTempWorkspace();
  const baselinePath = path.join(workspace, "baseline.json");
  const artifactPath = path.join(workspace, "artifact.json");
  const baseline = createBaseline();
  const artifact = createArtifact();

  writeJson(baselinePath, baseline);
  writeJson(artifactPath, artifact);

  const report = buildRuntimeRegressionReport(baseline, artifact, baselinePath, artifactPath);

  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.failedChecks, 0);
  assert.match(renderRuntimeRegressionSummary(report), /Runtime regression baseline: PASSED/);
});

test("buildRuntimeRegressionReport fails when throughput and memory regress", () => {
  const workspace = createTempWorkspace();
  const baselinePath = path.join(workspace, "baseline.json");
  const artifactPath = path.join(workspace, "artifact.json");
  const baseline = createBaseline();
  const artifact = createArtifact({
    actionsPerSecond: 120,
    rssPeakMb: 340,
    errorMessage: "scenario timeout"
  });

  writeJson(baselinePath, baseline);
  writeJson(artifactPath, artifact);

  const report = buildRuntimeRegressionReport(baseline, artifact, baselinePath, artifactPath);

  assert.equal(report.summary.status, "failed");
  assert.equal(report.summary.failedChecks > 0, true);
  assert.equal(report.summary.failedCheckIds.includes("world_progression:actionsPerSecond"), true);
  assert.equal(report.summary.failedCheckIds.includes("world_progression:rssPeakMb"), true);
  assert.equal(report.summary.failedCheckIds.includes("world_progression:errorMessage"), true);
});
