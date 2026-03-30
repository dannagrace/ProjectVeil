import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface Args {
  releaseGateSummaryPath?: string;
  releaseHealthSummaryPath?: string;
  outputPath?: string;
  runUrl?: string;
}

interface ReleaseGateSummaryReport {
  generatedAt: string;
  revision: {
    shortCommit: string;
    branch: string;
  };
  summary: {
    status: "passed" | "failed";
    passedGates: number;
    totalGates: number;
  };
  gates: Array<{
    id: string;
    label: string;
    status: "passed" | "failed";
    summary: string;
    failures?: string[];
  }>;
}

interface ReleaseHealthSummaryReport {
  generatedAt: string;
  summary: {
    status: "healthy" | "warning" | "blocking";
    blockerCount: number;
    warningCount: number;
    infoCount: number;
  };
  signals: Array<{
    id: string;
    label: string;
    status: "pass" | "warn" | "fail";
    summary: string;
    details: string[];
  }>;
}

const COMMENT_MARKER = "<!-- project-veil-release-summary -->";

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let releaseGateSummaryPath: string | undefined;
  let releaseHealthSummaryPath: string | undefined;
  let outputPath: string | undefined;
  let runUrl: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--release-gate-summary" && next) {
      releaseGateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--release-health-summary" && next) {
      releaseHealthSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--run-url" && next) {
      runUrl = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    ...(releaseHealthSummaryPath ? { releaseHealthSummaryPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(runUrl ? { runUrl } : {})
  };
}

function readJsonFile<T>(filePath: string | undefined): T {
  if (!filePath) {
    fail("Missing required file path.");
  }
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8")) as T;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function summarizeGate(gate: ReleaseGateSummaryReport["gates"][number]): string {
  const statusLabel = gate.status === "passed" ? "PASS" : "FAIL";
  const firstFailure = gate.failures?.find((failure) => failure.trim().length > 0);
  return `- **${gate.label}**: \`${statusLabel}\` ${firstFailure ?? gate.summary}`;
}

function summarizeHealthSignal(signal: ReleaseHealthSummaryReport["signals"][number]): string {
  const statusLabel = signal.status.toUpperCase();
  const firstDetail = signal.details.find((detail) => detail.trim().length > 0);
  return `- **${signal.label}**: \`${statusLabel}\` ${firstDetail ?? signal.summary}`;
}

export function renderPrComment(
  releaseGateReport: ReleaseGateSummaryReport,
  releaseHealthReport: ReleaseHealthSummaryReport,
  runUrl?: string
): string {
  const healthSignals = releaseHealthReport.signals.filter(
    (signal) => signal.id !== "release-readiness" && signal.id !== "release-gate"
  );

  const lines = [
    COMMENT_MARKER,
    "## Release Automation Summary",
    "",
    `- Revision: \`${releaseGateReport.revision.shortCommit}\` on \`${releaseGateReport.revision.branch}\``,
    `- Release readiness: **${releaseGateReport.summary.status.toUpperCase()}** (${releaseGateReport.summary.passedGates}/${releaseGateReport.summary.totalGates} gates passing)`,
    `- Release health: **${releaseHealthReport.summary.status.toUpperCase()}** (${releaseHealthReport.summary.blockerCount} blocker, ${releaseHealthReport.summary.warningCount} warning, ${releaseHealthReport.summary.infoCount} info)`,
    ...(runUrl ? [`- CI run: ${runUrl}`] : []),
    "",
    "### Release Readiness",
    "",
    ...releaseGateReport.gates.map((gate) => summarizeGate(gate)),
    "",
    "### Release Health",
    ""
  ];

  if (healthSignals.length === 0) {
    lines.push("- No additional release-health signals were available beyond release readiness.");
  } else {
    lines.push(...healthSignals.map((signal) => summarizeHealthSignal(signal)));
  }

  lines.push("");
  lines.push(`<sub>Updated from CI artifacts at \`${releaseHealthReport.generatedAt}\`.</sub>`);

  return `${lines.join("\n").trim()}\n`;
}

function main(): void {
  const args = parseArgs(process.argv);
  const releaseGateReport = readJsonFile<ReleaseGateSummaryReport>(args.releaseGateSummaryPath);
  const releaseHealthReport = readJsonFile<ReleaseHealthSummaryReport>(args.releaseHealthSummaryPath);
  const content = renderPrComment(releaseGateReport, releaseHealthReport, args.runUrl);
  const outputPath = path.resolve(args.outputPath ?? path.join("artifacts", "release-readiness", "release-pr-comment.md"));
  writeFile(outputPath, content);
  console.log(`Wrote release PR comment markdown: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
