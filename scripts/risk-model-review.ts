import fs from "node:fs";
import path from "node:path";

export interface RiskReviewRow {
  playerId: string;
  displayName: string;
  score: number;
  severity: "medium" | "high";
  reasons: string[];
  reviewStatus: "pending" | "warned" | "cleared" | "banned";
}

export interface RiskModelReviewReport {
  generatedAt: string;
  totalFlagged: number;
  highRiskCount: number;
  pendingCount: number;
  items: RiskReviewRow[];
}

export function buildRiskModelReviewReport(
  items: RiskReviewRow[],
  generatedAt = new Date().toISOString()
): RiskModelReviewReport {
  return {
    generatedAt,
    totalFlagged: items.length,
    highRiskCount: items.filter((item) => item.severity === "high").length,
    pendingCount: items.filter((item) => item.reviewStatus === "pending").length,
    items: [...items].sort((left, right) => right.score - left.score || left.playerId.localeCompare(right.playerId))
  };
}

export function renderRiskModelReviewMarkdown(report: RiskModelReviewReport): string {
  const lines = [
    "# Risk Model Review",
    "",
    `Generated at: \`${report.generatedAt}\``,
    "",
    `- Flagged players: \`${report.totalFlagged}\``,
    `- High risk: \`${report.highRiskCount}\``,
    `- Pending review: \`${report.pendingCount}\``,
    "",
    "| Player | Score | Severity | Review status | Reasons |",
    "| --- | ---: | --- | --- | --- |"
  ];
  for (const item of report.items) {
    lines.push(`| ${item.displayName} (\`${item.playerId}\`) | ${item.score} | ${item.severity} | ${item.reviewStatus} | ${item.reasons.join(" / ")} |`);
  }
  return lines.join("\n");
}

export function runRiskModelReview(inputPath: string, outputPath = path.resolve(process.cwd(), "reports", "risk-model-review.md")): string {
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8")) as { items?: RiskReviewRow[] };
  const report = buildRiskModelReviewReport(raw.items ?? []);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderRiskModelReviewMarkdown(report));
  return outputPath;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath) {
    throw new Error("Usage: node --import tsx ./scripts/risk-model-review.ts <risk-queue.json> [output-path]");
  }
  const resolvedOutputPath = runRiskModelReview(path.resolve(process.cwd(), inputPath), outputPath ? path.resolve(process.cwd(), outputPath) : undefined);
  console.log(`Wrote risk model review markdown: ${resolvedOutputPath}`);
}
