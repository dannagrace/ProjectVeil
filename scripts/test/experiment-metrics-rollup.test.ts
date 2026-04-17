import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runExperimentMetricsRollup } from "../experiment-metrics-rollup.ts";

test("experiment metrics rollup emits JSON, CSV, and markdown with significance columns", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "experiment-rollup-"));
  const inputPath = path.join(workspace, "analytics-events.json");
  const outputDir = path.join(workspace, "artifacts");

  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      events: [
        {
          name: "experiment_exposure",
          at: "2026-05-10T00:00:00.000Z",
          playerId: "player-a",
          source: "server",
          payload: {
            experimentKey: "shop_headline_2026_05",
            experimentName: "Shop Headline May 2026",
            variant: "control",
            bucket: 10,
            surface: "shop_panel",
            owner: "monetization"
          }
        },
        {
          name: "experiment_exposure",
          at: "2026-05-10T00:00:00.000Z",
          playerId: "player-b",
          source: "server",
          payload: {
            experimentKey: "shop_headline_2026_05",
            experimentName: "Shop Headline May 2026",
            variant: "value",
            bucket: 60,
            surface: "shop_panel",
            owner: "monetization"
          }
        },
        {
          name: "experiment_conversion",
          at: "2026-05-10T01:00:00.000Z",
          playerId: "player-b",
          source: "server",
          payload: {
            experimentKey: "shop_headline_2026_05",
            experimentName: "Shop Headline May 2026",
            variant: "value",
            bucket: 60,
            conversion: "shop_purchase",
            owner: "monetization"
          }
        },
        {
          name: "purchase_completed",
          at: "2026-05-10T01:05:00.000Z",
          playerId: "player-b",
          source: "server",
          payload: {
            purchaseId: "purchase-b",
            productId: "gem_pack_small",
            totalPrice: 30,
            paymentMethod: "wechat_pay",
            orderStatus: "completed"
          }
        }
      ]
    }),
    "utf8"
  );

  const result = runExperimentMetricsRollup({
    inputPath,
    outputDir,
    experimentKey: "shop_headline_2026_05"
  });

  assert.equal(result.summaries.length, 1);
  const summary = result.summaries[0]!;
  assert.equal(summary.experimentKey, "shop_headline_2026_05");
  assert.equal(summary.metrics?.variants.find((entry) => entry.variant === "value")?.conversions, 1);
  assert.equal(summary.metrics?.variants.find((entry) => entry.variant === "value")?.revenue, 30);

  const csv = fs.readFileSync(result.csvPath, "utf8");
  assert.match(csv, /experiment_key,variant,exposures,conversions/);
  assert.match(csv, /shop_headline_2026_05,value,1,1/);

  const markdown = fs.readFileSync(result.markdownPath, "utf8");
  assert.match(markdown, /# Experiment Metrics Rollup/);
  assert.match(markdown, /Shop Headline May 2026/);
  assert.match(markdown, /\| Variant \| Exposures \| Conversions \| CVR \|/);
});
