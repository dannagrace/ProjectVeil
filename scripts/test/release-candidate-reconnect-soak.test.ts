import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildCandidateReconnectSoakReport, renderMarkdown } from "../release-candidate-reconnect-soak.ts";

test("buildCandidateReconnectSoakReport records a passing candidate-scoped soak verdict", () => {
  const outputPath = path.resolve("artifacts", "release-readiness", "colyseus-reconnect-soak-summary-rc-abc1234.json");
  const markdownOutputPath = path.resolve("artifacts", "release-readiness", "colyseus-reconnect-soak-summary-rc-abc1234.md");
  const report = buildCandidateReconnectSoakReport(
    {
      schemaVersion: 1,
      artifactType: "stress-runtime-metrics",
      generatedAt: "2026-04-02T09:00:00.000Z",
      revision: {
        commit: "abc1234",
        shortCommit: "abc1234"
      },
      status: "passed",
      summary: {
        totalScenarios: 1,
        failedScenarios: 0,
        scenarioNames: ["reconnect_soak"]
      },
      soakSummary: {
        reconnectCycles: 8,
        reconnectAttempts: 384,
        invariantChecks: 2304,
        worldReconnectCycles: 320,
        battleReconnectCycles: 64,
        finalBattleRooms: 4,
        finalDayRange: {
          min: 3,
          max: 5
        }
      },
      results: [
        {
          scenario: "reconnect_soak",
          rooms: 48,
          successfulRooms: 48,
          failedRooms: 0,
          completedActions: 0,
          durationMs: 600000,
          runtimeHealthAfterCleanup: {
            activeRoomCount: 0,
            connectionCount: 0,
            activeBattleCount: 0,
            heroCount: 0
          }
        }
      ]
    },
    {
      candidate: "phase1-rc",
      candidateRevision: "abc1234",
      outputPath,
      markdownOutputPath
    }
  );

  assert.equal(report.verdict.status, "passed");
  assert.match(report.verdict.summary, /present and passing/);
  assert.equal(report.scenarioMatrix[0]?.cleanupHealthy, true);
  assert.equal(report.reviewSignals.durationMinutes, 10);
  assert.match(renderMarkdown(report), /Candidate Reconnect Soak/);
  assert.match(renderMarkdown(report), /Scenario Matrix/);
  assert.match(renderMarkdown(report), /Minimum profile/);
});

test("buildCandidateReconnectSoakReport records failure details for revision drift and cleanup leaks", () => {
  const report = buildCandidateReconnectSoakReport(
    {
      schemaVersion: 1,
      artifactType: "stress-runtime-metrics",
      generatedAt: "2026-04-02T09:00:00.000Z",
      revision: {
        commit: "def5678",
        shortCommit: "def5678"
      },
      status: "failed",
      summary: {
        totalScenarios: 1,
        failedScenarios: 1,
        scenarioNames: ["reconnect_soak"]
      },
      soakSummary: {
        reconnectCycles: 8,
        reconnectAttempts: 384,
        invariantChecks: 2304,
        worldReconnectCycles: 320,
        battleReconnectCycles: 64,
        finalBattleRooms: 4,
        finalDayRange: {
          min: 3,
          max: 5
        }
      },
      results: [
        {
          scenario: "reconnect_soak",
          rooms: 48,
          successfulRooms: 47,
          failedRooms: 1,
          completedActions: 0,
          durationMs: 600000,
          runtimeHealthAfterCleanup: {
            activeRoomCount: 1,
            connectionCount: 0,
            activeBattleCount: 0,
            heroCount: 0
          },
          errorMessage: "room parity mismatch"
        }
      ]
    },
    {
      candidate: "phase1-rc",
      candidateRevision: "abc1234",
      outputPath: path.resolve("artifacts", "release-readiness", "failed.json"),
      markdownOutputPath: path.resolve("artifacts", "release-readiness", "failed.md")
    }
  );

  assert.equal(report.verdict.status, "failed");
  assert.match(report.verdict.summary, /targets def5678/);
  assert.equal(report.failures.length, 1);
  assert.equal(report.scenarioMatrix[0]?.cleanupHealthy, false);
});
