import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type HealthStatus = "healthy" | "warning" | "blocking";
type FindingSeverity = "blocker" | "warning" | "info";
type SignalStatus = "pass" | "warn" | "fail";
type ReleaseHealthSignalId =
  | "release-readiness"
  | "release-gate"
  | "ci-trend"
  | "coverage"
  | "sync-governance";

interface Args {
  releaseReadinessPath?: string;
  releaseGateSummaryPath?: string;
  ciTrendSummaryPath?: string;
  coverageSummaryPath?: string;
  syncGovernancePath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface ReleaseReadinessSnapshot {
  generatedAt?: string;
  summary?: {
    status?: "passed" | "failed" | "pending" | "partial";
    requiredFailed?: number;
    requiredPending?: number;
  };
  checks?: Array<{
    id?: string;
    title?: string;
    status?: "passed" | "failed" | "pending" | "not_applicable";
    required?: boolean;
  }>;
}

interface ReleaseGateSummaryReport {
  generatedAt?: string;
  summary?: {
    status?: "passed" | "failed";
    failedGateIds?: string[];
  };
  gates?: Array<{
    id?: string;
    label?: string;
    status?: "passed" | "failed";
    summary?: string;
    failures?: string[];
    source?: {
      path?: string;
    };
  }>;
}

interface CiTrendSummaryReport {
  generatedAt?: string;
  summary?: {
    overallStatus?: "passed" | "failed";
    totalFindings?: number;
    newFindings?: number;
    ongoingFindings?: number;
    recoveredFindings?: number;
  };
  runtime?: {
    findings?: TrendFinding[];
  };
  releaseGate?: {
    findings?: TrendFinding[];
  };
}

interface TrendFinding {
  id?: string;
  status?: "new" | "ongoing" | "recovered";
  summary?: string;
}

interface CoverageSummaryEntry {
  scope: string;
  lineThreshold: number;
  branchThreshold: number;
  functionThreshold: number;
  metrics: {
    lines: number;
    branches: number;
    functions: number;
  } | null;
  failures: Array<{
    metric: "lines" | "branches" | "functions";
    actual: number | null;
    threshold: number;
  }>;
}

interface SyncGovernanceMatrixReport {
  generatedAt?: string;
  execution?: {
    status?: "passed" | "failed";
  };
  summary?: {
    passed?: number;
    failed?: number;
    skipped?: number;
  };
  scenarios?: Array<{
    id?: string;
    title?: string;
    status?: "passed" | "failed" | "skipped";
  }>;
}

interface ReleaseHealthSource {
  path: string;
  generatedAt?: string;
}

export interface ReleaseHealthFinding {
  id: string;
  signalId: ReleaseHealthSignalId;
  severity: FindingSeverity;
  summary: string;
  source?: ReleaseHealthSource;
}

export interface ReleaseHealthSignal {
  id: ReleaseHealthSignalId;
  label: string;
  status: SignalStatus;
  summary: string;
  source?: ReleaseHealthSource;
  details: string[];
}

export interface ReleaseHealthSummaryReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  summary: {
    status: HealthStatus;
    signalCount: number;
    blockerCount: number;
    warningCount: number;
    infoCount: number;
    blockingSignalIds: ReleaseHealthSignalId[];
    warningSignalIds: ReleaseHealthSignalId[];
  };
  inputs: {
    releaseReadinessPath?: string;
    releaseGateSummaryPath?: string;
    ciTrendSummaryPath?: string;
    coverageSummaryPath?: string;
    syncGovernancePath?: string;
  };
  signals: ReleaseHealthSignal[];
  findings: ReleaseHealthFinding[];
}

function getDefaultReleaseReadinessDir(): string {
  return path.resolve("artifacts", "release-readiness");
}

function getDefaultCoverageSummaryPath(): string {
  return path.resolve(".coverage", "summary.json");
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let releaseReadinessPath: string | undefined;
  let releaseGateSummaryPath: string | undefined;
  let ciTrendSummaryPath: string | undefined;
  let coverageSummaryPath: string | undefined;
  let syncGovernancePath: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--release-readiness" && next) {
      releaseReadinessPath = next;
      index += 1;
      continue;
    }
    if (arg === "--release-gate-summary" && next) {
      releaseGateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--ci-trend-summary" && next) {
      ciTrendSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--coverage-summary" && next) {
      coverageSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--sync-governance" && next) {
      syncGovernancePath = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = next;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(releaseReadinessPath ? { releaseReadinessPath } : {}),
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    ...(ciTrendSummaryPath ? { ciTrendSummaryPath } : {}),
    ...(coverageSummaryPath ? { coverageSummaryPath } : {}),
    ...(syncGovernancePath ? { syncGovernancePath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {})
  };
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

function resolveLatestFile(dirPath: string, matcher: (entry: string) => boolean): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }

  const candidates = fs
    .readdirSync(dirPath)
    .filter((entry) => matcher(entry))
    .map((entry) => path.join(dirPath, entry))
    .filter((entry) => fs.statSync(entry).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  return candidates[0];
}

function readGitValue(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function getRevision(): GitRevision {
  return {
    commit: readGitValue(["rev-parse", "HEAD"]),
    shortCommit: readGitValue(["rev-parse", "--short", "HEAD"]),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--porcelain"]).length > 0
  };
}

export function resolveInputPaths(args: Args): ReleaseHealthSummaryReport["inputs"] {
  const explicitReleaseReadinessPath = args.releaseReadinessPath ? path.resolve(args.releaseReadinessPath) : undefined;
  const explicitReleaseGateSummaryPath = args.releaseGateSummaryPath ? path.resolve(args.releaseGateSummaryPath) : undefined;
  const explicitCiTrendSummaryPath = args.ciTrendSummaryPath ? path.resolve(args.ciTrendSummaryPath) : undefined;
  const explicitCoverageSummaryPath = args.coverageSummaryPath ? path.resolve(args.coverageSummaryPath) : undefined;
  const explicitSyncGovernancePath = args.syncGovernancePath ? path.resolve(args.syncGovernancePath) : undefined;

  const releaseReadinessPath =
    explicitReleaseReadinessPath ??
    resolveLatestFile(
      getDefaultReleaseReadinessDir(),
      (entry) =>
        entry.startsWith("release-readiness-") &&
        entry.endsWith(".json") &&
        !entry.startsWith("release-readiness-dashboard")
    );

  const releaseGateSummaryPath =
    explicitReleaseGateSummaryPath ??
    (fs.existsSync(path.resolve(getDefaultReleaseReadinessDir(), "release-gate-summary.json"))
      ? path.resolve(getDefaultReleaseReadinessDir(), "release-gate-summary.json")
      : resolveLatestFile(getDefaultReleaseReadinessDir(), (entry) => entry.startsWith("release-gate-summary-") && entry.endsWith(".json")));

  const ciTrendSummaryPath =
    explicitCiTrendSummaryPath ??
    (fs.existsSync(path.resolve(getDefaultReleaseReadinessDir(), "ci-trend-summary.json"))
      ? path.resolve(getDefaultReleaseReadinessDir(), "ci-trend-summary.json")
      : undefined);

  const coverageSummaryPath =
    explicitCoverageSummaryPath ?? (fs.existsSync(getDefaultCoverageSummaryPath()) ? getDefaultCoverageSummaryPath() : undefined);

  const syncGovernancePath =
    explicitSyncGovernancePath ??
    resolveLatestFile(getDefaultReleaseReadinessDir(), (entry) => entry.startsWith("sync-governance-matrix-") && entry.endsWith(".json"));

  return {
    ...(releaseReadinessPath ? { releaseReadinessPath } : {}),
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    ...(ciTrendSummaryPath ? { ciTrendSummaryPath } : {}),
    ...(coverageSummaryPath ? { coverageSummaryPath } : {}),
    ...(syncGovernancePath ? { syncGovernancePath } : {})
  };
}

function createSource(pathValue: string | undefined, generatedAt?: string): ReleaseHealthSource | undefined {
  if (!pathValue) {
    return undefined;
  }
  return {
    path: pathValue,
    ...(generatedAt ? { generatedAt } : {})
  };
}

function buildSignal(
  id: ReleaseHealthSignalId,
  label: string,
  status: SignalStatus,
  summary: string,
  details: string[],
  source?: ReleaseHealthSource
): ReleaseHealthSignal {
  return {
    id,
    label,
    status,
    summary,
    details,
    ...(source ? { source } : {})
  };
}

function buildFinding(
  id: string,
  signalId: ReleaseHealthSignalId,
  severity: FindingSeverity,
  summary: string,
  source?: ReleaseHealthSource
): ReleaseHealthFinding {
  return {
    id,
    signalId,
    severity,
    summary,
    ...(source ? { source } : {})
  };
}

function evaluateReleaseReadinessSignal(filePath: string | undefined): { signal: ReleaseHealthSignal; findings: ReleaseHealthFinding[] } {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      signal: buildSignal(
        "release-readiness",
        "Release readiness snapshot",
        "fail",
        "Release readiness snapshot is missing.",
        ["Run `npm run release:readiness:snapshot` to publish the current regression/build gate state."]
      ),
      findings: [buildFinding("release-readiness:missing", "release-readiness", "blocker", "Release readiness snapshot is missing.")]
    };
  }

  const report = readJsonFile<ReleaseReadinessSnapshot>(filePath);
  const source = createSource(filePath, report.generatedAt);
  const requiredChecks = (report.checks ?? []).filter((check) => check.required !== false);
  const failedChecks = requiredChecks.filter((check) => check.status === "failed");
  const pendingChecks = requiredChecks.filter((check) => check.status === "pending");
  const details: string[] = [];

  if (report.summary?.status !== "passed") {
    details.push(`Snapshot summary status is ${JSON.stringify(report.summary?.status ?? "missing")}.`);
  }
  if ((report.summary?.requiredFailed ?? 0) > 0) {
    details.push(`Required failed checks: ${report.summary?.requiredFailed}.`);
  }
  if ((report.summary?.requiredPending ?? 0) > 0) {
    details.push(`Required pending checks: ${report.summary?.requiredPending}.`);
  }
  for (const check of failedChecks) {
    details.push(`Failed required check: ${check.id ?? check.title ?? "unknown-check"}.`);
  }
  for (const check of pendingChecks) {
    details.push(`Pending required check: ${check.id ?? check.title ?? "unknown-check"}.`);
  }

  if (details.length > 0) {
    return {
      signal: buildSignal(
        "release-readiness",
        "Release readiness snapshot",
        "fail",
        `Release readiness is blocked by ${details[0]}`,
        details,
        source
      ),
      findings: details.map((detail, index) =>
        buildFinding(`release-readiness:blocker-${index + 1}`, "release-readiness", "blocker", detail, source)
      )
    };
  }

  return {
    signal: buildSignal(
      "release-readiness",
      "Release readiness snapshot",
      "pass",
      `Release readiness snapshot passed ${requiredChecks.length} required checks.`,
      [],
      source
    ),
    findings: [
      buildFinding(
        "release-readiness:passed",
        "release-readiness",
        "info",
        `Release readiness snapshot passed ${requiredChecks.length} required checks.`,
        source
      )
    ]
  };
}

function evaluateReleaseGateSignal(filePath: string | undefined): { signal: ReleaseHealthSignal; findings: ReleaseHealthFinding[] } {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      signal: buildSignal(
        "release-gate",
        "Release gate summary",
        "fail",
        "Release gate summary is missing.",
        ["Run `npm run release:gate:summary` after producing the readiness and release artifacts."]
      ),
      findings: [buildFinding("release-gate:missing", "release-gate", "blocker", "Release gate summary is missing.")]
    };
  }

  const report = readJsonFile<ReleaseGateSummaryReport>(filePath);
  const source = createSource(filePath, report.generatedAt);
  const failingGates = (report.gates ?? []).filter((gate) => gate.status === "failed");

  if (report.summary?.status !== "passed" || failingGates.length > 0) {
    const details = failingGates.flatMap((gate) => {
      const failures = gate.failures?.length ? gate.failures : [gate.summary ?? `${gate.id ?? "unknown-gate"} failed.`];
      return failures.map((failure) => `${gate.id ?? gate.label ?? "unknown-gate"}: ${failure}`);
    });
    if (details.length === 0) {
      details.push(`Release gate overall status is ${JSON.stringify(report.summary?.status ?? "missing")}.`);
    }

    return {
      signal: buildSignal("release-gate", "Release gate summary", "fail", `Release gate summary failed: ${details[0]}`, details, source),
      findings: details.map((detail, index) =>
        buildFinding(`release-gate:blocker-${index + 1}`, "release-gate", "blocker", detail, source)
      )
    };
  }

  return {
    signal: buildSignal("release-gate", "Release gate summary", "pass", "All release gates are currently passing.", [], source),
    findings: [buildFinding("release-gate:passed", "release-gate", "info", "All release gates are currently passing.", source)]
  };
}

function evaluateCiTrendSignal(filePath: string | undefined): { signal: ReleaseHealthSignal; findings: ReleaseHealthFinding[] } {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      signal: buildSignal(
        "ci-trend",
        "CI trend summary",
        "warn",
        "CI trend summary is missing.",
        ["Run `npm run ci:trend-summary` when current and previous release artifacts are available."]
      ),
      findings: [buildFinding("ci-trend:missing", "ci-trend", "warning", "CI trend summary is missing.")]
    };
  }

  const report = readJsonFile<CiTrendSummaryReport>(filePath);
  const source = createSource(filePath, report.generatedAt);
  const activeFindings = [...(report.runtime?.findings ?? []), ...(report.releaseGate?.findings ?? [])].filter(
    (finding) => finding.status !== "recovered"
  );

  if (report.summary?.overallStatus === "failed" || activeFindings.length > 0) {
    const details = activeFindings.map((finding) => finding.summary?.trim()).filter((value): value is string => Boolean(value));
    if (details.length === 0) {
      details.push(`CI trend overall status is ${JSON.stringify(report.summary?.overallStatus ?? "missing")}.`);
    }

    return {
      signal: buildSignal(
        "ci-trend",
        "CI trend summary",
        "warn",
        `CI trend shows ${activeFindings.length || report.summary?.totalFindings || 0} active regression finding(s).`,
        details,
        source
      ),
      findings: details.map((detail, index) =>
        buildFinding(`ci-trend:warning-${index + 1}`, "ci-trend", "warning", detail, source)
      )
    };
  }

  return {
    signal: buildSignal("ci-trend", "CI trend summary", "pass", "CI trend has no active regressions.", [], source),
    findings: [buildFinding("ci-trend:passed", "ci-trend", "info", "CI trend has no active regressions.", source)]
  };
}

function formatCoverageFailure(scope: string, failure: CoverageSummaryEntry["failures"][number]): string {
  if (failure.actual === null) {
    return `${scope} ${failure.metric} coverage output is missing (floor ${failure.threshold}%).`;
  }
  return `${scope} ${failure.metric} coverage is ${failure.actual.toFixed(2)}%, below the ${failure.threshold}% floor.`;
}

function evaluateCoverageSignal(filePath: string | undefined): { signal: ReleaseHealthSignal; findings: ReleaseHealthFinding[] } {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      signal: buildSignal(
        "coverage",
        "Coverage summary",
        "warn",
        "Coverage summary is missing.",
        ["Run `npm run test:coverage:ci` to publish `.coverage/summary.json` and `.coverage/summary.md`."]
      ),
      findings: [buildFinding("coverage:missing", "coverage", "warning", "Coverage summary is missing.")]
    };
  }

  const report = readJsonFile<CoverageSummaryEntry[]>(filePath);
  const source = createSource(filePath);
  const failingScopes = report.filter((entry) => entry.failures.length > 0);

  if (failingScopes.length > 0) {
    const details = failingScopes.flatMap((entry) => entry.failures.map((failure) => formatCoverageFailure(entry.scope, failure)));
    return {
      signal: buildSignal(
        "coverage",
        "Coverage summary",
        "warn",
        `Coverage thresholds failed in ${failingScopes.length} scope(s).`,
        details,
        source
      ),
      findings: details.map((detail, index) =>
        buildFinding(`coverage:warning-${index + 1}`, "coverage", "warning", detail, source)
      )
    };
  }

  return {
    signal: buildSignal("coverage", "Coverage summary", "pass", `Coverage thresholds passed in ${report.length} scope(s).`, [], source),
    findings: [buildFinding("coverage:passed", "coverage", "info", `Coverage thresholds passed in ${report.length} scope(s).`, source)]
  };
}

function evaluateSyncGovernanceSignal(filePath: string | undefined): { signal: ReleaseHealthSignal; findings: ReleaseHealthFinding[] } {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      signal: buildSignal(
        "sync-governance",
        "Sync governance matrix",
        "warn",
        "Sync governance matrix is missing.",
        ["Run `npm run test:sync-governance:matrix -- --output artifacts/release-readiness/sync-governance-matrix.json` when multiplayer evidence is needed."]
      ),
      findings: [buildFinding("sync-governance:missing", "sync-governance", "warning", "Sync governance matrix is missing.")]
    };
  }

  const report = readJsonFile<SyncGovernanceMatrixReport>(filePath);
  const source = createSource(filePath, report.generatedAt);
  const failedScenarios = (report.scenarios ?? []).filter((scenario) => scenario.status === "failed");

  if (report.execution?.status !== "passed" || failedScenarios.length > 0) {
    const details = failedScenarios.map(
      (scenario) => `Sync governance scenario failed: ${scenario.id ?? scenario.title ?? "unknown-scenario"}.`
    );
    if (details.length === 0) {
      details.push(`Sync governance execution status is ${JSON.stringify(report.execution?.status ?? "missing")}.`);
    }
    return {
      signal: buildSignal(
        "sync-governance",
        "Sync governance matrix",
        "fail",
        `Sync governance matrix failed: ${details[0]}`,
        details,
        source
      ),
      findings: details.map((detail, index) =>
        buildFinding(`sync-governance:blocker-${index + 1}`, "sync-governance", "blocker", detail, source)
      )
    };
  }

  return {
    signal: buildSignal(
      "sync-governance",
      "Sync governance matrix",
      "pass",
      `Sync governance matrix passed ${report.summary?.passed ?? 0} scenario(s).`,
      [],
      source
    ),
    findings: [
      buildFinding(
        "sync-governance:passed",
        "sync-governance",
        "info",
        `Sync governance matrix passed ${report.summary?.passed ?? 0} scenario(s).`,
        source
      )
    ]
  };
}

export function buildReleaseHealthSummaryReport(args: Args, revision: GitRevision): ReleaseHealthSummaryReport {
  const inputs = resolveInputPaths(args);
  const signalResults = [
    evaluateReleaseReadinessSignal(inputs.releaseReadinessPath),
    evaluateReleaseGateSignal(inputs.releaseGateSummaryPath),
    evaluateCiTrendSignal(inputs.ciTrendSummaryPath),
    evaluateCoverageSignal(inputs.coverageSummaryPath),
    evaluateSyncGovernanceSignal(inputs.syncGovernancePath)
  ];
  const signals = signalResults.map((entry) => entry.signal);
  const findings = signalResults.flatMap((entry) => entry.findings);
  const blockerCount = findings.filter((finding) => finding.severity === "blocker").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision,
    summary: {
      status: blockerCount > 0 ? "blocking" : warningCount > 0 ? "warning" : "healthy",
      signalCount: signals.length,
      blockerCount,
      warningCount,
      infoCount,
      blockingSignalIds: signals.filter((signal) => signal.status === "fail").map((signal) => signal.id),
      warningSignalIds: signals.filter((signal) => signal.status === "warn").map((signal) => signal.id)
    },
    inputs,
    signals,
    findings
  };
}

function formatFindingMarkdown(finding: ReleaseHealthFinding): string {
  return `- [${finding.severity.toUpperCase()}] ${finding.summary}`;
}

export function renderMarkdown(report: ReleaseHealthSummaryReport): string {
  const lines = [
    "# Release Health Summary",
    "",
    `- Generated at: \`${report.generatedAt}\``,
    `- Revision: \`${report.revision.shortCommit}\` on \`${report.revision.branch}\``,
    `- Overall status: **${report.summary.status.toUpperCase()}**`,
    `- Findings: ${report.summary.blockerCount} blocker, ${report.summary.warningCount} warning, ${report.summary.infoCount} info`,
    ""
  ];

  const findingsBySeverity: FindingSeverity[] = ["blocker", "warning", "info"];
  for (const severity of findingsBySeverity) {
    const severityFindings = report.findings.filter((finding) => finding.severity === severity);
    if (severityFindings.length === 0) {
      continue;
    }
    lines.push(`## ${severity[0]?.toUpperCase()}${severity.slice(1)} Findings`);
    lines.push("");
    for (const finding of severityFindings) {
      lines.push(formatFindingMarkdown(finding));
    }
    lines.push("");
  }

  lines.push("## Signals");
  lines.push("");
  for (const signal of report.signals) {
    lines.push(`### ${signal.label}`);
    lines.push("");
    lines.push(`- Status: **${signal.status.toUpperCase()}**`);
    lines.push(`- Summary: ${signal.summary}`);
    if (signal.source) {
      lines.push(`- Source: \`${path.relative(process.cwd(), signal.source.path).replace(/\\/g, "/")}\``);
      if (signal.source.generatedAt) {
        lines.push(`- Artifact generated at: \`${signal.source.generatedAt}\``);
      }
    }
    if (signal.details.length > 0) {
      lines.push("- Details:");
      for (const detail of signal.details) {
        lines.push(`  - ${detail}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPath(args: Args, shortCommit: string): string {
  if (args.outputPath) {
    return path.resolve(args.outputPath);
  }
  return path.resolve(getDefaultReleaseReadinessDir(), `release-health-summary-${shortCommit}.json`);
}

function defaultMarkdownOutputPath(args: Args, shortCommit: string): string {
  if (args.markdownOutputPath) {
    return path.resolve(args.markdownOutputPath);
  }
  return path.resolve(getDefaultReleaseReadinessDir(), `release-health-summary-${shortCommit}.md`);
}

function main(): void {
  const args = parseArgs(process.argv);
  const revision = getRevision();
  const report = buildReleaseHealthSummaryReport(args, revision);
  const outputPath = defaultOutputPath(args, revision.shortCommit);
  const markdownOutputPath = defaultMarkdownOutputPath(args, revision.shortCommit);

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote release health JSON summary: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
  console.log(`Wrote release health Markdown summary: ${path.relative(process.cwd(), markdownOutputPath).replace(/\\/g, "/")}`);

  if (report.summary.status === "blocking") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
