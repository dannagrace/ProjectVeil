import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRiskModelReviewReport, renderRiskModelReviewMarkdown, runRiskModelReview } from "../risk-model-review.ts";

test("risk model review report summarizes pending high-risk rows", () => {
  const report = buildRiskModelReviewReport([
    {
      playerId: "player-risk",
      displayName: "Risky",
      score: 72,
      severity: "high",
      reasons: ["重复对手异常"],
      reviewStatus: "pending"
    }
  ]);
  assert.equal(report.totalFlagged, 1);
  assert.equal(report.highRiskCount, 1);
  assert.match(renderRiskModelReviewMarkdown(report), /Risk Model Review/);
});

test("runRiskModelReview writes markdown output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "risk-review-"));
  const inputPath = path.join(dir, "risk-queue.json");
  const outputPath = path.join(dir, "risk-model-review.md");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      items: [
        {
          playerId: "player-risk",
          displayName: "Risky",
          score: 72,
          severity: "high",
          reasons: ["重复对手异常"],
          reviewStatus: "pending"
        }
      ]
    }),
    "utf8"
  );

  const writtenPath = runRiskModelReview(inputPath, outputPath);
  assert.equal(writtenPath, outputPath);
  assert.equal(fs.existsSync(outputPath), true);
});
