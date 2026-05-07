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
        actionsPerSecondMin: 60,
        durationMsMax: 2500,
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

function createStabilizedStressArtifact() {
  const baseRuntimeHealth = {
    checkedAt: "2026-05-07T08:49:00.000Z",
    activeRoomCount: 48,
    connectionCount: 48,
    activeBattleCount: 0,
    heroCount: 96,
    connectMessagesTotal: 48,
    worldActionsTotal: 0,
    battleActionsTotal: 0,
    actionMessagesTotal: 0
  };

  return {
    schemaVersion: 1,
    artifactType: "stress-runtime-metrics",
    generatedAt: "2026-05-07T08:49:00.000Z",
    command: "node --import tsx ./scripts/stress-concurrent-rooms.ts --rooms=48 --connect-concurrency=12 --action-concurrency=12 --sample-interval-ms=100 --reconnect-pause-ms=150",
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
        durationMs: 2400,
        roomsPerSecond: 20,
        actionsPerSecond: 62,
        cpuUserMs: 100,
        cpuSystemMs: 20,
        cpuTotalMs: 120,
        cpuCoreUtilizationPct: 5,
        rssStartMb: 180,
        rssPeakMb: 230,
        rssEndMb: 220,
        heapStartMb: 60,
        heapPeakMb: 95,
        heapEndMb: 80,
        peakActiveHandles: 110,
        requestLatencyP50Ms: 25,
        requestLatencyP95Ms: 100,
        requestLatencyMaxMs: 120,
        runtimeHealthAfterConnect: baseRuntimeHealth,
        runtimeHealthAfterScenario: {
          ...baseRuntimeHealth,
          worldActionsTotal: 96,
          actionMessagesTotal: 96
        },
        errorMessage: ""
      },
      {
        scenario: "battle_settlement",
        rooms: 48,
        successfulRooms: 48,
        failedRooms: 0,
        completedActions: 456,
        durationMs: 8800,
        roomsPerSecond: 5.45,
        actionsPerSecond: 46,
        cpuUserMs: 100,
        cpuSystemMs: 20,
        cpuTotalMs: 120,
        cpuCoreUtilizationPct: 5,
        rssStartMb: 180,
        rssPeakMb: 240,
        rssEndMb: 220,
        heapStartMb: 60,
        heapPeakMb: 95,
        heapEndMb: 80,
        peakActiveHandles: 110,
        requestLatencyP50Ms: 35,
        requestLatencyP95Ms: 160,
        requestLatencyMaxMs: 220,
        runtimeHealthAfterConnect: baseRuntimeHealth,
        runtimeHealthAfterScenario: {
          ...baseRuntimeHealth,
          worldActionsTotal: 336,
          battleActionsTotal: 168,
          actionMessagesTotal: 504
        },
        errorMessage: ""
      },
      {
        scenario: "reconnect",
        rooms: 48,
        successfulRooms: 48,
        failedRooms: 0,
        completedActions: 144,
        durationMs: 1950,
        roomsPerSecond: 24.62,
        actionsPerSecond: 81,
        cpuUserMs: 100,
        cpuSystemMs: 20,
        cpuTotalMs: 120,
        cpuCoreUtilizationPct: 5,
        rssStartMb: 180,
        rssPeakMb: 230,
        rssEndMb: 220,
        heapStartMb: 60,
        heapPeakMb: 95,
        heapEndMb: 80,
        peakActiveHandles: 110,
        requestLatencyP50Ms: 6,
        requestLatencyP95Ms: 12,
        requestLatencyMaxMs: 15,
        runtimeHealthAfterConnect: baseRuntimeHealth,
        runtimeHealthAfterScenario: {
          ...baseRuntimeHealth,
          connectMessagesTotal: 192,
          worldActionsTotal: 384,
          battleActionsTotal: 168,
          actionMessagesTotal: 552
        },
        errorMessage: ""
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
    actionsPerSecond: 40,
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

test("checked-in runtime baseline accepts the stabilized stress harness shape", () => {
  const baselinePath = path.resolve("configs/runtime-regression-baseline.json");
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const artifact = createStabilizedStressArtifact();

  const report = buildRuntimeRegressionReport(baseline, artifact, baselinePath, "stabilized-stress-artifact.json");

  assert.equal(report.summary.status, "passed");
  assert.deepEqual(report.summary.failedCheckIds, []);
});
