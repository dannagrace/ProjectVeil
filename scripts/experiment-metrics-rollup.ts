import fs from "node:fs";
import path from "node:path";
import { loadFeatureFlagConfig } from "../apps/server/src/domain/battle/feature-flags.ts";
import {
  buildAdminExperimentSummaries,
  type AdminExperimentSummary
} from "../apps/server/src/domain/battle/experiment-assignment.ts";
import type { AnalyticsEvent } from "../packages/shared/src/index.ts";

interface RollupCliOptions {
  inputPath: string;
  outputDir: string;
  experimentKey?: string;
}

function readCliOptions(argv: string[]): RollupCliOptions {
  const args = [...argv];
  let inputPath = "";
  let outputDir = path.resolve(process.cwd(), "artifacts", "experiments");
  let experimentKey: string | undefined;

  while (args.length > 0) {
    const argument = args.shift();
    if (argument === "--input") {
      inputPath = path.resolve(process.cwd(), args.shift() ?? "");
      continue;
    }
    if (argument === "--output-dir") {
      outputDir = path.resolve(process.cwd(), args.shift() ?? "");
      continue;
    }
    if (argument === "--experiment") {
      experimentKey = (args.shift() ?? "").trim() || undefined;
    }
  }

  if (!inputPath) {
    throw new Error("Missing required --input <analytics-events.json> argument");
  }

  return {
    inputPath,
    outputDir,
    ...(experimentKey ? { experimentKey } : {})
  };
}

function readAnalyticsEvents(inputPath: string): AnalyticsEvent[] {
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8")) as
    | { events?: AnalyticsEvent[] }
    | AnalyticsEvent[];
  if (Array.isArray(raw)) {
    return raw;
  }
  return Array.isArray(raw.events) ? raw.events : [];
}

function renderCsv(summaries: AdminExperimentSummary[]): string {
  const header = [
    "experiment_key",
    "variant",
    "exposures",
    "conversions",
    "conversion_rate",
    "purchasers",
    "revenue",
    "arpu",
    "chi_square",
    "welch_t",
    "significant"
  ];
  const rows = summaries.flatMap((summary) =>
    (summary.metrics?.variants ?? []).map((variant) =>
      [
        summary.experimentKey,
        variant.variant,
        variant.exposures,
        variant.conversions,
        variant.conversionRate,
        variant.purchasers,
        variant.revenue,
        variant.arpu,
        variant.chiSquare ?? "",
        variant.welchT ?? "",
        variant.significant ? "yes" : "no"
      ].join(",")
    )
  );
  return [header.join(","), ...rows].join("\n");
}

function renderMarkdown(summaries: AdminExperimentSummary[]): string {
  const lines = ["# Experiment Metrics Rollup", ""];
  for (const summary of summaries) {
    lines.push(`## ${summary.experimentName} (\`${summary.experimentKey}\`)`);
    lines.push("");
    lines.push(`- Owner: \`${summary.owner}\``);
    lines.push(`- Sticky bucket key: \`${summary.stickyBucketKey}\``);
    lines.push(`- Traffic allocation: \`${summary.trafficAllocation}%\``);
    lines.push(`- Summary: ${summary.windowSummary}`);
    lines.push("");
    lines.push("| Variant | Exposures | Conversions | CVR | Purchasers | Revenue | ARPU | Chi-square | Welch t | Significant |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |");
    for (const variant of summary.metrics?.variants ?? []) {
      lines.push(
        `| ${variant.variant} | ${variant.exposures} | ${variant.conversions} | ${variant.conversionRate.toFixed(4)} | ${variant.purchasers} | ${variant.revenue.toFixed(2)} | ${variant.arpu.toFixed(2)} | ${variant.chiSquare?.toFixed(4) ?? "-"} | ${variant.welchT?.toFixed(4) ?? "-"} | ${variant.significant ? "yes" : "no"} |`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function buildExperimentMetricsRollupReport(
  events: AnalyticsEvent[],
  options: { experimentKey?: string } = {}
): AdminExperimentSummary[] {
  const config = loadFeatureFlagConfig();
  const summaries = buildAdminExperimentSummaries(config, events);
  return options.experimentKey
    ? summaries.filter((summary) => summary.experimentKey === options.experimentKey)
    : summaries;
}

export function runExperimentMetricsRollup(cliOptions: RollupCliOptions): {
  jsonPath: string;
  csvPath: string;
  markdownPath: string;
  summaries: AdminExperimentSummary[];
} {
  const events = readAnalyticsEvents(cliOptions.inputPath);
  const summaries = buildExperimentMetricsRollupReport(events, {
    ...(cliOptions.experimentKey ? { experimentKey: cliOptions.experimentKey } : {})
  });
  fs.mkdirSync(cliOptions.outputDir, { recursive: true });

  const baseName = cliOptions.experimentKey ? `experiment-metrics-${cliOptions.experimentKey}` : "experiment-metrics-rollup";
  const jsonPath = path.join(cliOptions.outputDir, `${baseName}.json`);
  const csvPath = path.join(cliOptions.outputDir, `${baseName}.csv`);
  const markdownPath = path.join(cliOptions.outputDir, `${baseName}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2));
  fs.writeFileSync(csvPath, renderCsv(summaries));
  fs.writeFileSync(markdownPath, renderMarkdown(summaries));

  return {
    jsonPath,
    csvPath,
    markdownPath,
    summaries
  };
}

if (import.meta.url === new URL(process.argv[1]!, "file://").href) {
  const result = runExperimentMetricsRollup(readCliOptions(process.argv.slice(2)));
  console.log(`Wrote experiment metrics JSON: ${result.jsonPath}`);
  console.log(`Wrote experiment metrics CSV: ${result.csvPath}`);
  console.log(`Wrote experiment metrics markdown: ${result.markdownPath}`);
}
