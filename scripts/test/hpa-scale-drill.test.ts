import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildHpaScaleDrillReport,
  renderHpaScaleDrillMarkdown,
  runHpaScaleDrill
} from "../hpa-scale-drill.ts";

test("buildHpaScaleDrillReport reports a passing 2x scale-out window", () => {
  const report = buildHpaScaleDrillReport(
    [
      { at: "2026-04-17T09:00:00.000Z", replicas: 2, activeRooms: 10, connectedPlayers: 20, cpuUtilizationPct: 51 },
      { at: "2026-04-17T09:00:20.000Z", replicas: 2, activeRooms: 16, connectedPlayers: 32, cpuUtilizationPct: 78 },
      { at: "2026-04-17T09:01:05.000Z", replicas: 4, activeRooms: 24, connectedPlayers: 48, cpuUtilizationPct: 63 }
    ],
    {
      thresholdActiveRooms: 16,
      targetReplicas: 4
    }
  );

  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.scaledFromReplicas, 2);
  assert.equal(report.summary.scaledToReplicas, 4);
  assert.equal(report.summary.scaleOutLatencySeconds, 45);
});

test("renderHpaScaleDrillMarkdown includes the scale-out headline", () => {
  const markdown = renderHpaScaleDrillMarkdown(
    buildHpaScaleDrillReport(
      [
        { at: "2026-04-17T09:00:00.000Z", replicas: 2, activeRooms: 10, connectedPlayers: 20 },
        { at: "2026-04-17T09:00:20.000Z", replicas: 2, activeRooms: 16, connectedPlayers: 32 },
        { at: "2026-04-17T09:01:05.000Z", replicas: 4, activeRooms: 24, connectedPlayers: 48 }
      ],
      {
        thresholdActiveRooms: 16,
        targetReplicas: 4
      }
    )
  );

  assert.match(markdown, /Overall status: `passed`/);
  assert.match(markdown, /HPA 在 45 秒内从 2 扩到 4 副本/);
});

test("runHpaScaleDrill writes JSON and markdown artifacts", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hpa-scale-drill-"));
  const inputPath = path.join(workspace, "hpa-checkpoints.json");
  const outputDir = path.join(workspace, "artifacts");

  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      checkpoints: [
        { at: "2026-04-17T09:00:00.000Z", replicas: 2, activeRooms: 10, connectedPlayers: 20 },
        { at: "2026-04-17T09:00:20.000Z", replicas: 2, activeRooms: 16, connectedPlayers: 32 },
        { at: "2026-04-17T09:01:05.000Z", replicas: 4, activeRooms: 24, connectedPlayers: 48 }
      ]
    }),
    "utf8"
  );

  const result = runHpaScaleDrill({
    inputPath,
    outputDir,
    thresholdActiveRooms: 16,
    targetReplicas: 4
  });

  assert.equal(result.report.summary.status, "passed");
  assert.equal(fs.existsSync(result.jsonPath), true);
  assert.equal(fs.existsSync(result.markdownPath), true);
});
