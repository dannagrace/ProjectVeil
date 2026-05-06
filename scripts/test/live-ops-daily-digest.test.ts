import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

test("live-ops daily digest renders retention and monetization headlines", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-live-ops-digest-"));
  const inputPath = path.join(workspace, "digest-input.json");
  const outputPath = path.join(workspace, "digest.json");
  const markdownOutputPath = path.join(workspace, "digest.md");

  fs.writeFileSync(
    inputPath,
    JSON.stringify(
      {
        generatedAt: "2026-04-17T08:00:00.000Z",
        dau: 1000,
        retainedD1: 420,
        retainedD7: 180,
        purchaseAttempts: 160,
        purchaseCompleted: 64,
        gmvFen: 128000,
        topSkus: [
          { productId: "gem_pack_small", revenueFen: 64000 },
          { productId: "battle_pass", revenueFen: 32000 }
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
      "./scripts/live-ops-daily-digest.ts",
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
    retention: { d1Rate: number; d7Rate: number };
    monetization: { conversionRate: number; gmvFen: number };
    headlines: string[];
  };
  assert.equal(report.retention.d1Rate, 0.42);
  assert.equal(report.retention.d7Rate, 0.18);
  assert.equal(report.monetization.conversionRate, 0.4);
  assert.equal(report.monetization.gmvFen, 128000);
  assert.match(report.headlines[0] ?? "", /DAU 1000, D1 42\.0%, D7 18\.0%/);
  assert.match(report.headlines[1] ?? "", /Purchase funnel 40\.0%/);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /## Monetization/);
  assert.match(markdown, /`gem_pack_small`/);
});
