import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapacityPlanningReport,
  renderCapacityPlanningMarkdown,
  summarizeCapacitySample
} from "../capacity-planning-report.ts";

function createStressArtifact(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "stress-runtime-metrics",
    generatedAt: "2026-04-12T01:00:00.000Z",
    command: "npm run stress:rooms",
    revision: {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    status: "passed",
    results: [
      {
        scenario: "world_progression",
        rooms: 100,
        successfulRooms: 100,
        failedRooms: 0,
        durationMs: 920,
        actionsPerSecond: 210,
        cpuCoreUtilizationPct: 41.2,
        rssPeakMb: 280,
        heapPeakMb: 82,
        requestLatencyP50Ms: 28,
        requestLatencyP95Ms: 72,
        requestLatencyMaxMs: 111
      },
      {
        scenario: "battle_settlement",
        rooms: 100,
        successfulRooms: 100,
        failedRooms: 0,
        durationMs: 995,
        actionsPerSecond: 260,
        cpuCoreUtilizationPct: 48.5,
        rssPeakMb: 301,
        heapPeakMb: 90,
        requestLatencyP50Ms: 31,
        requestLatencyP95Ms: 88,
        requestLatencyMaxMs: 135
      },
      {
        scenario: "reconnect",
        rooms: 100,
        successfulRooms: 100,
        failedRooms: 0,
        durationMs: 1060,
        actionsPerSecond: 187,
        cpuCoreUtilizationPct: 39.4,
        rssPeakMb: 287,
        heapPeakMb: 85,
        requestLatencyP50Ms: 26,
        requestLatencyP95Ms: 79,
        requestLatencyMaxMs: 121
      }
    ].map((result) => ({ ...result, ...overrides }))
  };
}

test("summarizeCapacitySample marks a sample failed when p95 latency breaches the hard limit", () => {
  const sample = summarizeCapacitySample("/tmp/stress-rooms-200.json", createStressArtifact({ rooms: 200, requestLatencyP95Ms: 132 }) as never, 100);

  assert.equal(sample.rooms, 200);
  assert.equal(sample.status, "failed");
  assert.match(sample.notes.join(" "), /breached 100ms/);
});

test("buildCapacityPlanningReport derives safe limits and cost estimates from ordered samples", () => {
  const report = buildCapacityPlanningReport(
    [
      {
        rooms: 10,
        artifactPath: "stress-rooms-10.json",
        status: "passed",
        scenarioCount: 3,
        failedScenarios: 0,
        worstScenario: "battle_settlement",
        worstLatencyP95Ms: 15,
        worstLatencyMaxMs: 30,
        peakCpuCoreUtilizationPct: 10,
        peakRssMb: 140,
        peakHeapMb: 40,
        averageActionsPerSecond: 150,
        notes: []
      },
      {
        rooms: 100,
        artifactPath: "stress-rooms-100.json",
        status: "passed",
        scenarioCount: 3,
        failedScenarios: 0,
        worstScenario: "battle_settlement",
        worstLatencyP95Ms: 84,
        worstLatencyMaxMs: 140,
        peakCpuCoreUtilizationPct: 48,
        peakRssMb: 301,
        peakHeapMb: 90,
        averageActionsPerSecond: 219,
        notes: []
      },
      {
        rooms: 200,
        artifactPath: "stress-rooms-200.json",
        status: "failed",
        scenarioCount: 3,
        failedScenarios: 0,
        worstScenario: "battle_settlement",
        worstLatencyP95Ms: 132,
        worstLatencyMaxMs: 240,
        peakCpuCoreUtilizationPct: 82,
        peakRssMb: 420,
        peakHeapMb: 130,
        averageActionsPerSecond: 240,
        notes: ["p95 request latency breached 100ms"]
      }
    ],
    {
      latencyHardLimitMs: 100,
      peakConcurrencyRatio: 0.1,
      playersPerRoom: 2,
      instanceMonthlyCostUsd: 48
    }
  );

  assert.equal(report.summary.safeLimitRooms, 100);
  assert.equal(report.summary.alertThresholdRooms, 80);
  assert.equal(report.summary.firstLatencyBreachRooms, 200);
  assert.equal(report.summary.scaleOutTriggerRooms, 80);
  assert.equal(report.summary.estimatedPeakRoomsPer1000Dau, 50);
  assert.equal(report.summary.estimatedInstancesPer1000Dau, 0.5);
  assert.equal(report.summary.estimatedMonthlyCostPer1000DauUsd, 24);
});

test("renderCapacityPlanningMarkdown includes the published thresholds", () => {
  const report = buildCapacityPlanningReport(
    [
      {
        rooms: 100,
        artifactPath: "stress-rooms-100.json",
        status: "passed",
        scenarioCount: 3,
        failedScenarios: 0,
        worstScenario: "battle_settlement",
        worstLatencyP95Ms: 84,
        worstLatencyMaxMs: 140,
        peakCpuCoreUtilizationPct: 48,
        peakRssMb: 301,
        peakHeapMb: 90,
        averageActionsPerSecond: 219,
        notes: []
      }
    ],
    {
      latencyHardLimitMs: 100,
      peakConcurrencyRatio: 0.1,
      playersPerRoom: 2,
      instanceMonthlyCostUsd: 48
    }
  );

  const markdown = renderCapacityPlanningMarkdown(report);

  assert.match(markdown, /Safe limit per instance: 100 concurrent rooms/);
  assert.match(markdown, /Prometheus warning threshold: 80 active rooms/);
  assert.match(markdown, /\$24\/month/);
});
