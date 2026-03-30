import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Status = "passed" | "failed";
type FindingStatus = "new" | "ongoing" | "recovered";
type FindingCategory = "runtime-regression" | "release-gate-regression";
type Severity = "high" | "medium";
type ThresholdKind = "eq" | "min" | "max" | "present" | "empty";

interface Args {
  runtimeReportPath?: string;
  previousRuntimeReportPath?: string;
  releaseGateReportPath?: string;
  previousReleaseGateReportPath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  githubStepSummaryPath?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface RuntimeCheck {
  id: string;
  metric: string;
  status: Status;
  threshold: {
    kind: ThresholdKind;
    value?: number | string | boolean;
  };
  actual: number | string | boolean | null;
  sourcePath: string;
  message: string;
}

interface RuntimeScenarioComparisonResult {
  scenario: string;
  status: Status;
  checks: RuntimeCheck[];
}

interface RuntimeRegressionComparisonReport {
  schemaVersion: 1;
  generatedAt: string;
  baseline: {
    baselineId: string;
    title: string;
    path: string;
  };
  artifact: {
    path: string;
    generatedAt?: string;
    command?: string;
    revision?: GitRevision;
  };
  summary: {
    status: Status;
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    failedCheckIds: string[];
  };
  scenarios: RuntimeScenarioComparisonResult[];
}

interface GateSource {
  kind: "release-readiness-snapshot" | "h5-release-candidate-smoke" | "wechat-rc-validation" | "wechat-smoke-report";
  path: string;
}

interface GateResult {
  id: "release-readiness" | "h5-release-candidate-smoke" | "wechat-release";
  label: string;
  status: Status;
  summary: string;
  failures: string[];
  source?: GateSource;
}

interface ReleaseGateSummaryReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  summary: {
    status: Status;
    totalGates: number;
    passedGates: number;
    failedGates: number;
    failedGateIds: string[];
  };
  inputs: {
    snapshotPath?: string;
    h5SmokePath?: string;
    wechatRcValidationPath?: string;
    wechatSmokeReportPath?: string;
    wechatArtifactsDir?: string;
  };
  gates: GateResult[];
}

interface TrendFinding {
  id: string;
  category: FindingCategory;
  status: FindingStatus;
  severity: Severity;
  summary: string;
  currentStatus: Status;
  previousStatus?: Status;
  sourcePath: string;
  scenario?: string;
  metric?: string;
  gateId?: GateResult["id"];
  threshold?: {
    kind: ThresholdKind;
    value?: number | string | boolean;
  };
  actual?: number | string | boolean | null;
  previousActual?: number | string | boolean | null;
}

interface TrendSectionSummary {
  currentStatus?: Status;
  previousStatus?: Status;
  totals: {
    new: number;
    ongoing: number;
    recovered: number;
  };
}

interface CiTrendSummaryReport {
  schemaVersion: 1;
  generatedAt: string;
  runtime?: {
    current: {
      path: string;
      generatedAt: string;
      baselineId: string;
      baselinePath: string;
      artifactPath: string;
      status: Status;
      failedCheckIds: string[];
      revision?: GitRevision;
    };
    previous?: {
      path: string;
      generatedAt: string;
      status: Status;
      failedCheckIds: string[];
      revision?: GitRevision;
    };
    summary: TrendSectionSummary;
    findings: TrendFinding[];
  };
  releaseGate?: {
    current: {
      path: string;
      generatedAt: string;
      status: Status;
      failedGateIds: string[];
      revision?: GitRevision;
    };
    previous?: {
      path: string;
      generatedAt: string;
      status: Status;
      failedGateIds: string[];
      revision?: GitRevision;
    };
    summary: TrendSectionSummary;
    findings: TrendFinding[];
  };
  summary: {
    overallStatus: Status;
    totalFindings: number;
    newFindings: number;
    ongoingFindings: number;
    recoveredFindings: number;
    findingIds: string[];
  };
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--runtime-report" && next) {
      args.runtimeReportPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--previous-runtime-report" && next) {
      args.previousRuntimeReportPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--release-gate-report" && next) {
      args.releaseGateReportPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--previous-release-gate-report" && next) {
      args.previousReleaseGateReportPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      args.outputPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      args.markdownOutputPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--github-step-summary" && next) {
      args.githubStepSummaryPath = path.resolve(next);
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!args.runtimeReportPath && !args.releaseGateReportPath) {
    fail("Pass at least one of --runtime-report or --release-gate-report.");
  }

  return args;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readOptionalReport<T>(filePath: string | undefined): T | undefined {
  if (!filePath) {
    return undefined;
  }
  if (!fs.existsSync(filePath)) {
    fail(`Report was not found: ${filePath}`);
  }
  return readJsonFile<T>(filePath);
}

function toFindingCounts(findings: TrendFinding[]): TrendSectionSummary["totals"] {
  return {
    new: findings.filter((finding) => finding.status === "new").length,
    ongoing: findings.filter((finding) => finding.status === "ongoing").length,
    recovered: findings.filter((finding) => finding.status === "recovered").length
  };
}

function buildRuntimeTrend(
  currentPath: string,
  current: RuntimeRegressionComparisonReport,
  previousPath: string | undefined,
  previous: RuntimeRegressionComparisonReport | undefined
): CiTrendSummaryReport["runtime"] {
  const previousChecks = new Map<string, RuntimeCheck>();
  for (const scenario of previous?.scenarios ?? []) {
    for (const check of scenario.checks) {
      previousChecks.set(check.id, check);
    }
  }

  const findings: TrendFinding[] = [];

  for (const scenario of current.scenarios) {
    for (const check of scenario.checks) {
      const previousCheck = previousChecks.get(check.id);

      if (check.status === "failed") {
        findings.push({
          id: `runtime:${check.id}`,
          category: "runtime-regression",
          status: previousCheck?.status === "failed" ? "ongoing" : "new",
          severity: check.metric === "errorMessage" ? "high" : "medium",
          summary: check.message,
          currentStatus: "failed",
          sourcePath: current.artifact.path,
          scenario: scenario.scenario,
          metric: check.metric,
          threshold: check.threshold,
          actual: check.actual,
          ...(previousCheck?.status ? { previousStatus: previousCheck.status } : {}),
          ...(previousCheck ? { previousActual: previousCheck.actual } : {})
        });
      } else if (previousCheck?.status === "failed") {
        findings.push({
          id: `runtime:${check.id}`,
          category: "runtime-regression",
          status: "recovered",
          severity: "medium",
          summary: `${scenario.scenario} ${check.metric} recovered to within threshold.`,
          currentStatus: "passed",
          previousStatus: "failed",
          sourcePath: current.artifact.path,
          scenario: scenario.scenario,
          metric: check.metric,
          threshold: check.threshold,
          actual: check.actual,
          previousActual: previousCheck.actual
        });
      }
    }
  }

  return {
    current: {
      path: currentPath,
      generatedAt: current.generatedAt,
      baselineId: current.baseline.baselineId,
      baselinePath: current.baseline.path,
      artifactPath: current.artifact.path,
      status: current.summary.status,
      failedCheckIds: current.summary.failedCheckIds,
      ...(current.artifact.revision ? { revision: current.artifact.revision } : {})
    },
    ...(previous && previousPath
      ? {
          previous: {
            path: previousPath,
            generatedAt: previous.generatedAt,
            status: previous.summary.status,
            failedCheckIds: previous.summary.failedCheckIds,
            revision: previous.artifact.revision
          }
        }
      : {}),
    summary: {
      currentStatus: current.summary.status,
      ...(previous ? { previousStatus: previous.summary.status } : {}),
      totals: toFindingCounts(findings)
    },
    findings
  };
}

function buildReleaseGateTrend(
  currentPath: string,
  current: ReleaseGateSummaryReport,
  previousPath: string | undefined,
  previous: ReleaseGateSummaryReport | undefined
): CiTrendSummaryReport["releaseGate"] {
  const previousGates = new Map<GateResult["id"], GateResult>();
  for (const gate of previous?.gates ?? []) {
    previousGates.set(gate.id, gate);
  }

  const findings: TrendFinding[] = [];

  for (const gate of current.gates) {
    const previousGate = previousGates.get(gate.id);

    if (gate.status === "failed") {
      findings.push({
        id: `release-gate:${gate.id}`,
        category: "release-gate-regression",
        status: previousGate?.status === "failed" ? "ongoing" : "new",
        severity: "high",
        summary: gate.summary,
        currentStatus: "failed",
        sourcePath: gate.source?.path ?? currentPath,
        gateId: gate.id,
        ...(previousGate?.status ? { previousStatus: previousGate.status } : {})
      });
    } else if (previousGate?.status === "failed") {
      findings.push({
        id: `release-gate:${gate.id}`,
        category: "release-gate-regression",
        status: "recovered",
        severity: "medium",
        summary: `${gate.label} recovered and is now passing.`,
        currentStatus: "passed",
        previousStatus: "failed",
        sourcePath: gate.source?.path ?? currentPath,
        gateId: gate.id
      });
    }
  }

  return {
    current: {
      path: currentPath,
      generatedAt: current.generatedAt,
      status: current.summary.status,
      failedGateIds: current.summary.failedGateIds,
      revision: current.revision
    },
    ...(previous && previousPath
      ? {
          previous: {
            path: previousPath,
            generatedAt: previous.generatedAt,
            status: previous.summary.status,
            failedGateIds: previous.summary.failedGateIds,
            revision: previous.revision
          }
        }
      : {}),
    summary: {
      currentStatus: current.summary.status,
      ...(previous ? { previousStatus: previous.summary.status } : {}),
      totals: toFindingCounts(findings)
    },
    findings
  };
}

export function buildCiTrendSummaryReport(args: Args): CiTrendSummaryReport {
  const currentRuntime = readOptionalReport<RuntimeRegressionComparisonReport>(args.runtimeReportPath);
  const previousRuntime = readOptionalReport<RuntimeRegressionComparisonReport>(args.previousRuntimeReportPath);
  const currentReleaseGate = readOptionalReport<ReleaseGateSummaryReport>(args.releaseGateReportPath);
  const previousReleaseGate = readOptionalReport<ReleaseGateSummaryReport>(args.previousReleaseGateReportPath);

  const runtime =
    currentRuntime && args.runtimeReportPath
      ? buildRuntimeTrend(args.runtimeReportPath, currentRuntime, args.previousRuntimeReportPath, previousRuntime)
      : undefined;
  const releaseGate =
    currentReleaseGate && args.releaseGateReportPath
      ? buildReleaseGateTrend(
          args.releaseGateReportPath,
          currentReleaseGate,
          args.previousReleaseGateReportPath,
          previousReleaseGate
        )
      : undefined;

  const findings = [...(runtime?.findings ?? []), ...(releaseGate?.findings ?? [])];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(runtime ? { runtime } : {}),
    ...(releaseGate ? { releaseGate } : {}),
    summary: {
      overallStatus: findings.some((finding) => finding.status !== "recovered") ? "failed" : "passed",
      totalFindings: findings.length,
      newFindings: findings.filter((finding) => finding.status === "new").length,
      ongoingFindings: findings.filter((finding) => finding.status === "ongoing").length,
      recoveredFindings: findings.filter((finding) => finding.status === "recovered").length,
      findingIds: findings.map((finding) => finding.id)
    }
  };
}

function formatTotals(label: string, section: TrendSectionSummary | undefined): string {
  if (!section) {
    return `- ${label}: not included`;
  }

  const statusParts = [`current ${section.currentStatus?.toUpperCase() ?? "UNKNOWN"}`];
  if (section.previousStatus) {
    statusParts.push(`previous ${section.previousStatus.toUpperCase()}`);
  }

  return `- ${label}: ${statusParts.join(", ")}; new ${section.totals.new}, ongoing ${section.totals.ongoing}, recovered ${section.totals.recovered}`;
}

function formatFinding(finding: TrendFinding): string {
  const prefix = finding.status === "new" ? "NEW" : finding.status === "ongoing" ? "ONGOING" : "RECOVERED";
  const target = finding.category === "runtime-regression" ? `${finding.scenario}:${finding.metric}` : finding.gateId;
  return `- ${prefix} ${target}: ${finding.summary}`;
}

export function renderCiTrendSummaryMarkdown(report: CiTrendSummaryReport): string {
  const lines = [
    "# CI Trend Summary",
    "",
    `- Generated at: \`${report.generatedAt}\``,
    `- Overall status: **${report.summary.overallStatus.toUpperCase()}**`,
    `- Findings: ${report.summary.totalFindings} total (${report.summary.newFindings} new, ${report.summary.ongoingFindings} ongoing, ${report.summary.recoveredFindings} recovered)`,
    "",
    "## Signals",
    "",
    formatTotals("Runtime regression", report.runtime?.summary),
    formatTotals("Release gate", report.releaseGate?.summary),
    ""
  ];

  const activeFindings = [
    ...(report.runtime?.findings ?? []).filter((finding) => finding.status !== "recovered"),
    ...(report.releaseGate?.findings ?? []).filter((finding) => finding.status !== "recovered")
  ];
  const recoveredFindings = [
    ...(report.runtime?.findings ?? []).filter((finding) => finding.status === "recovered"),
    ...(report.releaseGate?.findings ?? []).filter((finding) => finding.status === "recovered")
  ];

  if (activeFindings.length > 0) {
    lines.push("## Active Regressions", "");
    for (const finding of activeFindings) {
      lines.push(formatFinding(finding));
    }
    lines.push("");
  }

  if (recoveredFindings.length > 0) {
    lines.push("## Recovered Since Previous Artifact", "");
    for (const finding of recoveredFindings) {
      lines.push(formatFinding(finding));
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPath(args: Args): string | undefined {
  return args.outputPath ?? path.resolve("artifacts", "release-readiness", "ci-trend-summary.json");
}

function defaultMarkdownOutputPath(args: Args): string | undefined {
  return args.markdownOutputPath ?? path.resolve("artifacts", "release-readiness", "ci-trend-summary.md");
}

function main(): void {
  const args = parseArgs(process.argv);
  const report = buildCiTrendSummaryReport(args);
  const markdown = renderCiTrendSummaryMarkdown(report);
  const outputPath = defaultOutputPath(args);
  const markdownOutputPath = defaultMarkdownOutputPath(args);

  if (outputPath) {
    writeJsonFile(outputPath, report);
  }
  if (markdownOutputPath) {
    writeFile(markdownOutputPath, markdown);
  }
  if (args.githubStepSummaryPath) {
    fs.appendFileSync(args.githubStepSummaryPath, `\n${markdown}\n`, "utf8");
  }

  console.log(markdown.trim());
  console.log("CI_TREND_SUMMARY_JSON_START");
  console.log(JSON.stringify(report, null, 2));
  console.log("CI_TREND_SUMMARY_JSON_END");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
