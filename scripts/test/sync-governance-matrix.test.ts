import assert from "node:assert/strict";
import test from "node:test";

import { buildScenarioGrepPattern, buildSummary, collectScenarioResults } from "../sync-governance-matrix.ts";

test("buildScenarioGrepPattern escapes scenario titles into an anchored union", () => {
  const pattern = buildScenarioGrepPattern([
    {
      id: "sample",
      title: "scenario (alpha) + beta?",
      category: "room-push",
      risk: "demo"
    }
  ]);

  assert.equal(pattern, "(?:scenario \\(alpha\\) \\+ beta\\?)");
});

test("collectScenarioResults maps required scenarios from a Playwright JSON report", () => {
  const results = collectScenarioResults(
    {
      suites: [
        {
          specs: [
            {
              title: "scenario-a",
              ok: true,
              tests: [
                {
                  projectName: "chromium",
                  results: [{ status: "passed", duration: 120 }]
                }
              ]
            },
            {
              title: "scenario-b",
              ok: false,
              tests: [
                {
                  projectName: "chromium",
                  results: [{ status: "failed", duration: 45 }]
                }
              ]
            }
          ]
        }
      ]
    },
    [
      {
        id: "scenario-a",
        title: "scenario-a",
        category: "room-push",
        risk: "risk-a"
      },
      {
        id: "scenario-b",
        title: "scenario-b",
        category: "prediction-correction",
        risk: "risk-b"
      }
    ]
  );

  assert.deepEqual(
    results.map((entry) => ({ id: entry.id, status: entry.status, durationMs: entry.durationMs })),
    [
      { id: "scenario-a", status: "passed", durationMs: 120 },
      { id: "scenario-b", status: "failed", durationMs: 45 }
    ]
  );
  assert.deepEqual(buildSummary(results), {
    total: 2,
    passed: 1,
    failed: 1,
    skipped: 0
  });
});

test("collectScenarioResults fails when a required scenario is absent from the report", () => {
  assert.throws(
    () =>
      collectScenarioResults(
        {
          suites: []
        },
        [
          {
            id: "missing",
            title: "missing scenario",
            category: "room-recovery",
            risk: "missing risk"
          }
        ]
      ),
    /missing required sync-governance scenario/
  );
});
