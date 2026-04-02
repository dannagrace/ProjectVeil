import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatReadinessTrendHealthySummary,
  formatReadinessTrendNoBaselineSummary,
  formatReadinessTrendRegressionSummary,
  formatReadinessTrendUnchangedUnreadySummary,
  type ReadinessDecision
} from "./release-reporting-contract.ts";

type HealthStatus = "healthy" | "warning" | "blocking";
type FindingSeverity = "blocker" | "warning" | "info";
type SignalStatus = "pass" | "warn" | "fail";
type ReleaseHealthSignalId =
  | "release-readiness"
  | "release-gate"
  | "readiness-trend"
  | "ci-trend"
  | "coverage"
  | "sync-governance";

interface Args {
  releaseReadinessPath?: string;
  releaseGateSummaryPath?: string;
  releaseReadinessDashboardPath?: string;
  previousReleaseReadinessDashboardPath?: string;
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
    command?: string;
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
    required?: boolean;
    summary?: string;
    failures?: string[];
    source?: {
      kind?:
        | "release-readiness-snapshot"
        | "h5-release-candidate-smoke"
        | "wechat-rc-validation"
        | "wechat-release-candidate-summary"
        | "wechat-smoke-report";
      path?: string;
    };
  }>;
}

interface ReleaseReadinessDashboardReport {
  generatedAt?: string;
  goNoGo?: {
    decision?: "ready" | "pending" | "blocked";
    summary?: string;
    candidateRevision?: string;
    requiredFailed?: number;
    requiredPending?: number;
    blockers?: string[];
    pending?: string[];
  };
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

export interface ReleaseHealthArtifactReference {
  label: string;
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

export interface ReleaseHealthTriageEntry {
  id: string;
  signalId: ReleaseHealthSignalId;
  severity: Exclude<FindingSeverity, "info">;
  title: string;
  summary: string;
  nextStep: string;
  details: string[];
  artifacts: ReleaseHealthArtifactReference[];
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
    releaseReadinessDashboardPath?: string;
    previousReleaseReadinessDashboardPath?: string;
    ciTrendSummaryPath?: string;
    coverageSummaryPath?: string;
    syncGovernancePath?: string;
  };
  triage: {
    blockers: ReleaseHealthTriageEntry[];
    warnings: ReleaseHealthTriageEntry[];
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
  let releaseReadinessDashboardPath: string | undefined;
  let previousReleaseReadinessDashboardPath: string | undefined;
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
    if (arg === "--release-readiness-dashboard" && next) {
      releaseReadinessDashboardPath = next;
      index += 1;
      continue;
    }
    if (arg === "--previous-release-readiness-dashboard" && next) {
      previousReleaseReadinessDashboardPath = next;
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
    ...(releaseReadinessDashboardPath ? { releaseReadinessDashboardPath } : {}),
    ...(previousReleaseReadinessDashboardPath ? { previousReleaseReadinessDashboardPath } : {}),
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
  const explicitReleaseReadinessDashboardPath = args.releaseReadinessDashboardPath
    ? path.resolve(args.releaseReadinessDashboardPath)
    : undefined;
  const explicitPreviousReleaseReadinessDashboardPath = args.previousReleaseReadinessDashboardPath
    ? path.resolve(args.previousReleaseReadinessDashboardPath)
    : undefined;
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

  const releaseReadinessDashboardPath =
    explicitReleaseReadinessDashboardPath ??
    (fs.existsSync(path.resolve(getDefaultReleaseReadinessDir(), "release-readiness-dashboard.json"))
      ? path.resolve(getDefaultReleaseReadinessDir(), "release-readiness-dashboard.json")
      : undefined);

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
    ...(releaseReadinessDashboardPath ? { releaseReadinessDashboardPath } : {}),
    ...(explicitPreviousReleaseReadinessDashboardPath
      ? { previousReleaseReadinessDashboardPath: explicitPreviousReleaseReadinessDashboardPath }
      : {}),
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

function toDisplayPath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function createArtifactReference(label: string, filePath: string | undefined, generatedAt?: string): ReleaseHealthArtifactReference[] {
  if (!filePath) {
    return [];
  }
  return [
    {
      label,
      path: filePath,
      ...(generatedAt ? { generatedAt } : {})
    }
  ];
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

function buildTriageEntry(
  id: string,
  signalId: ReleaseHealthSignalId,
  severity: Exclude<FindingSeverity, "info">,
  title: string,
  summary: string,
  nextStep: string,
  details: string[],
  artifacts: ReleaseHealthArtifactReference[]
): ReleaseHealthTriageEntry {
  return {
    id,
    signalId,
    severity,
    title,
    summary,
    nextStep,
    details,
    artifacts
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
  const failingGates = (report.gates ?? []).filter((gate) => gate.required !== false && gate.status === "failed");

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

function getReadinessDecisionRank(decision: ReleaseReadinessDashboardReport["goNoGo"] extends { decision?: infer T } ? T : never): number {
  if (decision === "ready") {
    return 2;
  }
  if (decision === "pending") {
    return 1;
  }
  return 0;
}

function normalizeReadinessDecision(
  decision: ReleaseReadinessDashboardReport["goNoGo"] extends { decision?: infer T } ? T : never
): ReadinessDecision {
  return decision === "ready" || decision === "pending" ? decision : "blocked";
}

function getDashboardCandidateRevision(report: ReleaseReadinessDashboardReport | undefined): string {
  return report?.goNoGo?.candidateRevision ?? "<unverified>";
}

function evaluateReadinessTrendSignal(
  currentPath: string | undefined,
  previousPath: string | undefined
): { signal?: ReleaseHealthSignal; findings: ReleaseHealthFinding[] } {
  if (!currentPath) {
    return { findings: [] };
  }

  if (!fs.existsSync(currentPath)) {
    return {
      signal: buildSignal(
        "readiness-trend",
        "Candidate readiness trend",
        "warn",
        "Current release readiness dashboard is missing, so candidate trend could not be computed.",
        ["Generate the dashboard first so the candidate revision can be compared against prior history."]
      ),
      findings: [
        buildFinding(
          "readiness-trend:missing-current",
          "readiness-trend",
          "warning",
          "Current release readiness dashboard is missing, so candidate trend could not be computed."
        )
      ]
    };
  }

  const currentReport = readJsonFile<ReleaseReadinessDashboardReport>(currentPath);
  const currentSource = createSource(currentPath, currentReport.generatedAt);
  const currentDecision = normalizeReadinessDecision(currentReport.goNoGo?.decision);
  const currentCandidate = getDashboardCandidateRevision(currentReport);
  const currentSummary = currentReport.goNoGo?.summary?.trim() || `Current candidate is ${currentDecision}.`;

  if (!previousPath || !fs.existsSync(previousPath)) {
    const status: SignalStatus = currentDecision === "ready" ? "pass" : "warn";
    const summary = formatReadinessTrendNoBaselineSummary(currentCandidate, currentDecision);
    return {
      signal: buildSignal("readiness-trend", "Candidate readiness trend", status, summary, [currentSummary], currentSource),
      findings: [
        buildFinding(
          `readiness-trend:${status === "pass" ? "passed" : "warning"}-no-baseline`,
          "readiness-trend",
          status === "pass" ? "info" : "warning",
          summary,
          currentSource
        )
      ]
    };
  }

  const previousReport = readJsonFile<ReleaseReadinessDashboardReport>(previousPath);
  const previousDecision = normalizeReadinessDecision(previousReport.goNoGo?.decision);
  const previousCandidate = getDashboardCandidateRevision(previousReport);
  const previousSummary = previousReport.goNoGo?.summary?.trim() || `Previous candidate was ${previousDecision}.`;
  const currentRank = getReadinessDecisionRank(currentDecision);
  const previousRank = getReadinessDecisionRank(previousDecision);
  const details = [
    `current=${currentCandidate}:${currentDecision}`,
    `previous=${previousCandidate}:${previousDecision}`,
    `current summary: ${currentSummary}`,
    `previous summary: ${previousSummary}`
  ];

  if (currentRank < previousRank) {
    const summary = formatReadinessTrendRegressionSummary(previousDecision, previousCandidate, currentDecision, currentCandidate);
    return {
      signal: buildSignal("readiness-trend", "Candidate readiness trend", "warn", summary, details, currentSource),
      findings: [buildFinding("readiness-trend:regressed", "readiness-trend", "warning", summary, currentSource)]
    };
  }

  if (currentRank === previousRank && currentDecision !== "ready") {
    const summary = formatReadinessTrendUnchangedUnreadySummary(currentDecision, previousCandidate, currentCandidate);
    return {
      signal: buildSignal("readiness-trend", "Candidate readiness trend", "warn", summary, details, currentSource),
      findings: [buildFinding("readiness-trend:unchanged-unready", "readiness-trend", "warning", summary, currentSource)]
    };
  }

  const summary = formatReadinessTrendHealthySummary(previousDecision, previousCandidate, currentDecision, currentCandidate);
  return {
    signal: buildSignal("readiness-trend", "Candidate readiness trend", "pass", summary, details, currentSource),
    findings: [buildFinding("readiness-trend:passed", "readiness-trend", "info", summary, currentSource)]
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

function buildReleaseReadinessTriage(filePath: string | undefined): ReleaseHealthTriageEntry[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return [
      buildTriageEntry(
        "release-readiness:missing",
        "release-readiness",
        "blocker",
        "Release readiness snapshot",
        "Release readiness snapshot is missing, so the branch gate state is unknown.",
        "Run `npm run release:readiness:snapshot` to rebuild the snapshot, then inspect the required checks it records.",
        [],
        []
      )
    ];
  }

  const report = readJsonFile<ReleaseReadinessSnapshot>(filePath);
  const requiredChecks = (report.checks ?? []).filter((check) => check.required !== false);
  const unresolvedCheck = requiredChecks.find((check) => check.status === "failed" || check.status === "pending");
  if (!unresolvedCheck && report.summary?.status === "passed") {
    return [];
  }

  const summary = unresolvedCheck
    ? `Required release-readiness check is ${unresolvedCheck.status}: ${unresolvedCheck.title ?? unresolvedCheck.id ?? "unknown-check"} (${unresolvedCheck.id ?? "unknown-check"}).`
    : `Release readiness summary status is ${JSON.stringify(report.summary?.status ?? "missing")}.`;
  const nextStep = unresolvedCheck?.command
    ? `Re-run \`${unresolvedCheck.command}\`, then inspect \`${toDisplayPath(filePath)}\` for the recorded stdout/stderr tail and updated check status.`
    : `Open \`${toDisplayPath(filePath)}\` and clear the unresolved required checks before rebuilding the release gate summary.`;

  return [
    buildTriageEntry(
      "release-readiness:triage",
      "release-readiness",
      "blocker",
      "Release readiness snapshot",
      summary,
      nextStep,
      unresolvedCheck ? [`Check id: ${unresolvedCheck.id ?? "unknown-check"}.`] : [],
      createArtifactReference("Release readiness snapshot", filePath, report.generatedAt)
    )
  ];
}

function buildReleaseGateNextStep(gate: NonNullable<ReleaseGateSummaryReport["gates"]>[number], fallbackPath: string): string {
  const sourcePath = gate.source?.path ?? fallbackPath;
  if (gate.id === "release-readiness") {
    return `Open \`${toDisplayPath(sourcePath)}\` and clear the failing or pending readiness checks, then rerun \`npm run release:gate:summary\`.`;
  }
  if (gate.id === "h5-release-candidate-smoke") {
    return `Open \`${toDisplayPath(sourcePath)}\`, rerun \`npm run smoke:client:release-candidate\` to reproduce the packaged H5 failure, then rerun \`npm run release:gate:summary\`.`;
  }
  if (gate.id === "wechat-release") {
    const command =
      gate.source?.kind === "wechat-smoke-report"
        ? "npm run smoke:wechat-release -- --check"
        : "npm run validate:wechat-rc";
    return `Open \`${toDisplayPath(sourcePath)}\`, rerun \`${command}\` to refresh the WeChat evidence, then rerun \`npm run release:gate:summary\`.`;
  }
  return `Open \`${toDisplayPath(sourcePath)}\` to inspect the failing gate evidence, then rerun \`npm run release:gate:summary\`.`;
}

function buildReleaseGateTriage(filePath: string | undefined): ReleaseHealthTriageEntry[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return [
      buildTriageEntry(
        "release-gate:missing",
        "release-gate",
        "blocker",
        "Release gate summary",
        "Release gate summary is missing, so packaged release evidence was not normalized.",
        "Run `npm run release:gate:summary` after producing the readiness and release artifacts.",
        [],
        []
      )
    ];
  }

  const report = readJsonFile<ReleaseGateSummaryReport>(filePath);
  const failingGates = (report.gates ?? []).filter((gate) => gate.required !== false && gate.status === "failed");
  if (failingGates.length === 0 && report.summary?.status === "passed") {
    return [];
  }

  const firstGate = failingGates[0];
  const summary = firstGate
    ? `${firstGate.label ?? firstGate.id ?? "Release gate"} failed: ${firstGate.failures?.[0] ?? firstGate.summary ?? "no detail recorded"}.`
    : `Release gate overall status is ${JSON.stringify(report.summary?.status ?? "missing")}.`;

  return [
    buildTriageEntry(
      "release-gate:triage",
      "release-gate",
      "blocker",
      "Release gate summary",
      summary,
      firstGate
        ? buildReleaseGateNextStep(firstGate, filePath)
        : `Open \`${toDisplayPath(filePath)}\` to inspect the failed gate summary, then rerun \`npm run release:gate:summary\`.`,
      failingGates.map((gate) => `${gate.id ?? gate.label ?? "unknown-gate"}: ${gate.failures?.[0] ?? gate.summary ?? "failed"}`),
      [
        ...createArtifactReference("Release gate summary", filePath, report.generatedAt),
        ...failingGates.flatMap((gate) =>
          createArtifactReference(gate.label ?? gate.id ?? "Underlying release artifact", gate.source?.path)
        )
      ]
    )
  ];
}

function buildCiTrendTriage(filePath: string | undefined): ReleaseHealthTriageEntry[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return [
      buildTriageEntry(
        "ci-trend:missing",
        "ci-trend",
        "warning",
        "CI trend summary",
        "CI trend summary is missing, so recent regressions cannot be compared against the prior baseline.",
        "Run `npm run ci:trend-summary` when current and previous release artifacts are available.",
        [],
        []
      )
    ];
  }

  const report = readJsonFile<CiTrendSummaryReport>(filePath);
  const activeFindings = [...(report.runtime?.findings ?? []), ...(report.releaseGate?.findings ?? [])].filter(
    (finding) => finding.status !== "recovered"
  );
  if (report.summary?.overallStatus !== "failed" && activeFindings.length === 0) {
    return [];
  }

  return [
    buildTriageEntry(
      "ci-trend:triage",
      "ci-trend",
      "warning",
      "CI trend summary",
      activeFindings[0]?.summary?.trim() || `CI trend overall status is ${JSON.stringify(report.summary?.overallStatus ?? "missing")}.`,
      `Open \`${toDisplayPath(filePath)}\` and compare the new or ongoing regressions against the current runtime and release-gate artifacts before retrying the affected job.`,
      activeFindings.map((finding) => finding.summary?.trim()).filter((value): value is string => Boolean(value)),
      createArtifactReference("CI trend summary", filePath, report.generatedAt)
    )
  ];
}

function buildReadinessTrendTriage(
  currentPath: string | undefined,
  previousPath: string | undefined
): ReleaseHealthTriageEntry[] {
  if (!currentPath) {
    return [];
  }

  if (!fs.existsSync(currentPath)) {
    return [
      buildTriageEntry(
        "readiness-trend:missing-current",
        "readiness-trend",
        "warning",
        "Candidate readiness trend",
        "Current release readiness dashboard is missing, so candidate history cannot be compared.",
        "Run `npm run release:readiness:dashboard` for the candidate revision before rebuilding the release health summary.",
        [],
        []
      )
    ];
  }

  const currentReport = readJsonFile<ReleaseReadinessDashboardReport>(currentPath);
  const currentDecision = normalizeReadinessDecision(currentReport.goNoGo?.decision);
  const currentCandidate = getDashboardCandidateRevision(currentReport);

  if (!previousPath || !fs.existsSync(previousPath)) {
    if (currentDecision === "ready") {
      return [];
    }
    return [
      buildTriageEntry(
        "readiness-trend:no-baseline",
        "readiness-trend",
        "warning",
        "Candidate readiness trend",
        formatReadinessTrendNoBaselineSummary(currentCandidate, currentDecision),
        "Keep publishing the history artifact for each candidate revision so future readiness deltas can be compared.",
        [currentReport.goNoGo?.summary?.trim() || `Current candidate is ${currentDecision}.`],
        createArtifactReference("Current release readiness dashboard", currentPath, currentReport.generatedAt)
      )
    ];
  }

  const previousReport = readJsonFile<ReleaseReadinessDashboardReport>(previousPath);
  const previousDecision = normalizeReadinessDecision(previousReport.goNoGo?.decision);
  const previousCandidate = getDashboardCandidateRevision(previousReport);
  const currentRank = getReadinessDecisionRank(currentDecision);
  const previousRank = getReadinessDecisionRank(previousDecision);

  if (currentRank > previousRank || (currentRank === previousRank && currentDecision === "ready")) {
    return [];
  }

  const summary =
    currentRank < previousRank
      ? formatReadinessTrendRegressionSummary(previousDecision, previousCandidate, currentDecision, currentCandidate)
      : formatReadinessTrendUnchangedUnreadySummary(currentDecision, previousCandidate, currentCandidate);

  return [
    buildTriageEntry(
      "readiness-trend:triage",
      "readiness-trend",
      "warning",
      "Candidate readiness trend",
      summary,
      `Open \`${toDisplayPath(currentPath)}\` and \`${toDisplayPath(previousPath)}\` to compare the candidate blockers or pending checks before advancing the next revision.`,
      [
        `Current summary: ${currentReport.goNoGo?.summary?.trim() || `Current candidate is ${currentDecision}.`}`,
        `Previous summary: ${previousReport.goNoGo?.summary?.trim() || `Previous candidate was ${previousDecision}.`}`
      ],
      [
        ...createArtifactReference("Current release readiness dashboard", currentPath, currentReport.generatedAt),
        ...createArtifactReference("Previous release readiness dashboard", previousPath, previousReport.generatedAt)
      ]
    )
  ];
}

function buildCoverageTriage(filePath: string | undefined): ReleaseHealthTriageEntry[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return [
      buildTriageEntry(
        "coverage:missing",
        "coverage",
        "warning",
        "Coverage summary",
        "Coverage summary is missing, so line, branch, and function thresholds were not evaluated.",
        "Run `npm run test:coverage:ci` to regenerate `.coverage/summary.json`.",
        [],
        []
      )
    ];
  }

  const report = readJsonFile<CoverageSummaryEntry[]>(filePath);
  const failingScopes = report.filter((entry) => entry.failures.length > 0);
  if (failingScopes.length === 0) {
    return [];
  }

  const firstScope = failingScopes[0];
  const firstFailure = firstScope.failures[0];
  const actualValue = firstFailure?.actual == null ? "missing" : `${firstFailure.actual}%`;

  return [
    buildTriageEntry(
      "coverage:triage",
      "coverage",
      "warning",
      "Coverage summary",
      `${firstScope.scope} ${firstFailure?.metric ?? "coverage"} coverage is ${actualValue} against a ${firstFailure?.threshold ?? "unknown"}% floor.`,
      `Open \`${toDisplayPath(filePath)}\` to inspect the failing scope, raise coverage above the threshold, then rerun \`npm run test:coverage:ci\`.`,
      failingScopes.map((entry) => `${entry.scope}: ${entry.failures.length} threshold failure(s).`),
      createArtifactReference("Coverage summary", filePath)
    )
  ];
}

function buildSyncGovernanceTriage(filePath: string | undefined): ReleaseHealthTriageEntry[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return [
      buildTriageEntry(
        "sync-governance:missing",
        "sync-governance",
        "warning",
        "Sync governance matrix",
        "Sync governance matrix is missing, so deterministic replay coverage was not verified.",
        "Run `npm run test:sync-governance:matrix -- --output artifacts/release-readiness/sync-governance-matrix.json` to rebuild the matrix artifact.",
        [],
        []
      )
    ];
  }

  const report = readJsonFile<SyncGovernanceMatrixReport>(filePath);
  const failedScenarios = (report.scenarios ?? []).filter((scenario) => scenario.status === "failed");
  if (report.execution?.status === "passed" && failedScenarios.length === 0) {
    return [];
  }

  return [
    buildTriageEntry(
      "sync-governance:triage",
      "sync-governance",
      "blocker",
      "Sync governance matrix",
      failedScenarios[0]
        ? `Sync governance scenario failed: ${failedScenarios[0].title ?? failedScenarios[0].id ?? "unknown-scenario"}.`
        : `Sync governance execution status is ${JSON.stringify(report.execution?.status ?? "missing")}.`,
      `Open \`${toDisplayPath(filePath)}\`, reproduce the failing deterministic sync scenario, then rerun \`npm run test:sync-governance:matrix -- --output artifacts/release-readiness/sync-governance-matrix.json\`.`,
      failedScenarios.map((scenario) => scenario.title ?? scenario.id ?? "unknown-scenario"),
      createArtifactReference("Sync governance matrix", filePath, report.generatedAt)
    )
  ];
}

function buildTriageReport(inputs: ReleaseHealthSummaryReport["inputs"]): ReleaseHealthSummaryReport["triage"] {
  const syncGovernanceTriage = buildSyncGovernanceTriage(inputs.syncGovernancePath);
  return {
    blockers: [
      ...buildReleaseReadinessTriage(inputs.releaseReadinessPath),
      ...buildReleaseGateTriage(inputs.releaseGateSummaryPath),
      ...syncGovernanceTriage.filter((entry) => entry.severity === "blocker")
    ],
    warnings: [
      ...buildReadinessTrendTriage(inputs.releaseReadinessDashboardPath, inputs.previousReleaseReadinessDashboardPath),
      ...buildCiTrendTriage(inputs.ciTrendSummaryPath),
      ...buildCoverageTriage(inputs.coverageSummaryPath),
      ...syncGovernanceTriage.filter((entry) => entry.severity === "warning")
    ]
  };
}

export function buildReleaseHealthSummaryReport(args: Args, revision: GitRevision): ReleaseHealthSummaryReport {
  const inputs = resolveInputPaths(args);
  const readinessTrend = evaluateReadinessTrendSignal(
    inputs.releaseReadinessDashboardPath,
    inputs.previousReleaseReadinessDashboardPath
  );
  const signalResults = [
    evaluateReleaseReadinessSignal(inputs.releaseReadinessPath),
    evaluateReleaseGateSignal(inputs.releaseGateSummaryPath),
    ...(readinessTrend.signal ? [readinessTrend] : []),
    evaluateCiTrendSignal(inputs.ciTrendSummaryPath),
    evaluateCoverageSignal(inputs.coverageSummaryPath),
    evaluateSyncGovernanceSignal(inputs.syncGovernancePath)
  ];
  const signals = signalResults.map((entry) => entry.signal);
  const findings = signalResults.flatMap((entry) => entry.findings);
  const blockerCount = findings.filter((finding) => finding.severity === "blocker").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;
  const triage = buildTriageReport(inputs);

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
    triage,
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

  lines.push("## Triage");
  lines.push("");
  lines.push(`### Blockers (${report.triage.blockers.length})`);
  lines.push("");
  if (report.triage.blockers.length === 0) {
    lines.push("- None.");
  } else {
    for (const entry of report.triage.blockers) {
      lines.push(`- **${entry.title}**: ${entry.summary}`);
      lines.push(`  Next step: ${entry.nextStep}`);
      if (entry.artifacts.length > 0) {
        lines.push(`  Artifacts: ${entry.artifacts.map((artifact) => `\`${toDisplayPath(artifact.path)}\``).join(", ")}`);
      }
    }
  }
  lines.push("");
  lines.push(`### Warnings (${report.triage.warnings.length})`);
  lines.push("");
  if (report.triage.warnings.length === 0) {
    lines.push("- None.");
  } else {
    for (const entry of report.triage.warnings) {
      lines.push(`- **${entry.title}**: ${entry.summary}`);
      lines.push(`  Next step: ${entry.nextStep}`);
      if (entry.artifacts.length > 0) {
        lines.push(`  Artifacts: ${entry.artifacts.map((artifact) => `\`${toDisplayPath(artifact.path)}\``).join(", ")}`);
      }
    }
  }
  lines.push("");

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
      lines.push(`- Source: \`${toDisplayPath(signal.source.path)}\``);
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
