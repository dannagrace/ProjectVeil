import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

test("oncall ack audit summarizes MTTA / MTTR and breach rows", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-oncall-audit-"));
  const inputPath = path.join(workspace, "incidents.json");
  const outputPath = path.join(workspace, "ack-audit.json");
  const markdownOutputPath = path.join(workspace, "ack-audit.md");

  fs.writeFileSync(
    inputPath,
    JSON.stringify(
      {
        incidents: [
          {
            id: "alert-1",
            service: "payments",
            severity: "critical",
            owner: "commerce-oncall",
            openedAt: "2026-04-17T00:00:00.000Z",
            acknowledgedAt: "2026-04-17T00:06:00.000Z",
            resolvedAt: "2026-04-17T00:35:00.000Z"
          },
          {
            id: "alert-2",
            service: "runtime",
            severity: "critical",
            owner: "ops-oncall",
            openedAt: "2026-04-17T01:00:00.000Z",
            acknowledgedAt: "2026-04-17T01:18:00.000Z",
            resolvedAt: "2026-04-17T02:20:00.000Z"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/oncall-ack-audit.ts",
      "--input",
      inputPath,
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
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    totals: { incidentCount: number; acknowledgedCount: number; resolvedCount: number };
    timing: { medianAckMinutes: number | null; medianResolveMinutes: number | null };
    breaches: Array<{ incidentId: string; reason: string }>;
  };
  assert.deepEqual(report.totals, {
    incidentCount: 2,
    acknowledgedCount: 2,
    resolvedCount: 2
  });
  assert.equal(report.timing.medianAckMinutes, 12);
  assert.equal(report.timing.medianResolveMinutes, 57.5);
  assert.deepEqual(
    report.breaches.map((breach) => [breach.incidentId, breach.reason]),
    [
      ["alert-2", "ack_over_10m"],
      ["alert-2", "resolve_over_60m"]
    ]
  );

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /Median MTTA: 12 min/);
  assert.match(markdown, /`alert-2`/);
});
