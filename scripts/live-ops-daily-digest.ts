import fs from "node:fs";
import path from "node:path";

interface Args {
  inputPath: string;
  outputPath?: string;
  markdownOutputPath?: string;
}

interface LiveOpsDigestInput {
  generatedAt?: string;
  dau: number;
  retainedD1: number;
  retainedD7: number;
  purchaseAttempts: number;
  purchaseCompleted: number;
  gmvFen: number;
  topSkus: Array<{ productId: string; revenueFen: number }>;
}

interface LiveOpsDigestReport {
  schemaVersion: 1;
  generatedAt: string;
  retention: {
    dau: number;
    retainedD1: number;
    retainedD7: number;
    d1Rate: number;
    d7Rate: number;
  };
  monetization: {
    purchaseAttempts: number;
    purchaseCompleted: number;
    conversionRate: number;
    gmvFen: number;
  };
  topSkus: Array<{ productId: string; revenueFen: number }>;
  headlines: string[];
}

function parseArgs(argv: string[]): Args {
  let inputPath = "";
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--input" && next) {
      inputPath = next;
      index += 1;
      continue;
    }
    if (current === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (current === "--markdown-output" && next) {
      markdownOutputPath = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${current}`);
  }

  if (!inputPath) {
    throw new Error("Pass --input <path>.");
  }

  return { inputPath, outputPath, markdownOutputPath };
}

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function buildLiveOpsDailyDigest(input: LiveOpsDigestInput): LiveOpsDigestReport {
  const d1Rate = input.dau > 0 ? Number((input.retainedD1 / input.dau).toFixed(4)) : 0;
  const d7Rate = input.dau > 0 ? Number((input.retainedD7 / input.dau).toFixed(4)) : 0;
  const conversionRate = input.purchaseAttempts > 0 ? Number((input.purchaseCompleted / input.purchaseAttempts).toFixed(4)) : 0;
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    retention: {
      dau: input.dau,
      retainedD1: input.retainedD1,
      retainedD7: input.retainedD7,
      d1Rate,
      d7Rate
    },
    monetization: {
      purchaseAttempts: input.purchaseAttempts,
      purchaseCompleted: input.purchaseCompleted,
      conversionRate,
      gmvFen: input.gmvFen
    },
    topSkus: input.topSkus.slice(0, 5),
    headlines: [
      `DAU ${input.dau}, D1 ${(d1Rate * 100).toFixed(1)}%, D7 ${(d7Rate * 100).toFixed(1)}%`,
      `Purchase funnel ${(conversionRate * 100).toFixed(1)}% (${input.purchaseCompleted}/${input.purchaseAttempts})`,
      `Top SKU ${input.topSkus[0]?.productId ?? "n/a"}`
    ]
  };
}

export function renderLiveOpsDailyDigestMarkdown(report: LiveOpsDigestReport): string {
  return [
    "# Live Ops Daily Digest",
    "",
    `Generated at: \`${report.generatedAt}\``,
    "",
    "## Headlines",
    "",
    ...report.headlines.map((line) => `- ${line}`),
    "",
    "## Retention",
    "",
    `DAU: ${report.retention.dau}`,
    `D1: ${(report.retention.d1Rate * 100).toFixed(1)}%`,
    `D7: ${(report.retention.d7Rate * 100).toFixed(1)}%`,
    "",
    "## Monetization",
    "",
    `Attempts: ${report.monetization.purchaseAttempts}`,
    `Completed: ${report.monetization.purchaseCompleted}`,
    `Conversion: ${(report.monetization.conversionRate * 100).toFixed(1)}%`,
    `GMV (fen): ${report.monetization.gmvFen}`,
    "",
    "## Top SKUs",
    "",
    "| SKU | Revenue (fen) |",
    "| --- | ---: |",
    ...report.topSkus.map((sku) => `| \`${sku.productId}\` | ${sku.revenueFen} |`)
  ].join("\n").concat("\n");
}

function main(): void {
  const args = parseArgs(process.argv);
  const input = JSON.parse(fs.readFileSync(path.resolve(args.inputPath), "utf8")) as LiveOpsDigestInput;
  const report = buildLiveOpsDailyDigest(input);
  const outputPath = path.resolve(args.outputPath ?? path.join("artifacts", "analytics", "live-ops-daily-digest.json"));
  const markdownOutputPath = path.resolve(args.markdownOutputPath ?? outputPath.replace(/\.json$/i, ".md"));
  ensureDirectory(outputPath);
  ensureDirectory(markdownOutputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownOutputPath, renderLiveOpsDailyDigestMarkdown(report), "utf8");
  console.log(`Wrote live-ops daily digest JSON: ${path.relative(process.cwd(), outputPath)}`);
  console.log(`Wrote live-ops daily digest Markdown: ${path.relative(process.cwd(), markdownOutputPath)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
