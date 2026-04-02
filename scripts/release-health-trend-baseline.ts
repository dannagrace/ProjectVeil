import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { renderReviewerFacingMarkdownEntry } from "./release-reporting-contract.ts";

type ReleaseHealthStatus = "healthy" | "warning" | "blocking";
type ReviewerSignalStatus = "pass" | "warn" | "fail";
type TrendDirection = "improved" | "regressed" | "unchanged" | "no-baseline";

interface Args {
  artifactDirs: string[];
  cacheDir?: string;
  limit: number;
  outputPath?: string;
  markdownOutputPath?: string;
}

interface SourceRunMetadata {
  runId?: string;
  runUrl?: string;
  headSha?: string;
  headBranch?: string;
}

interface ReleaseHealthSummaryReport {
  generatedAt?: string;
  revision?: {
    shortCommit?: string;
    branch?: string;
  };
  summary?: {
    status?: ReleaseHealthStatus;
    blockerCount?: number;
    warningCount?: number;
    infoCount?: number;
  };
  triage?: {
    blockers?: Array<{
      signalId?: string;
      title?: string;
      summary?: string;
    }>;
  };
}

interface ReleaseGateSummaryReport {
  generatedAt?: string;
  summary?: {
    status?: "passed" | "failed";
  };
  gates?: Array<{
    id?: string;
    label?: string;
    status?: "passed" | "failed";
    summary?: string;
  }>;
}

interface ReleaseReadinessDashboardReport {
  generatedAt?: string;
  goNoGo?: {
    decision?: "ready" | "pending" | "blocked";
    candidateRevision?: string;
    summary?: string;
  };
  gates?: Array<{
    id?: string;
    label?: string;
    status?: "pass" | "warn" | "fail";
    summary?: string;
  }>;
}

interface TrendBlocker {
  id: string;
  label: string;
  signalId?: string;
  summary: string;
}

interface CandidateSignalSnapshot {
  id: string;
  label: string;
  status: ReviewerSignalStatus;
  summary: string;
}

interface CandidateTrendEntry {
  artifactDir: string;
  generatedAt?: string;
  candidateRevision: string;
  branch?: string;
  sourceRun?: SourceRunMetadata;
  releaseHealth: {
    status: ReleaseHealthStatus;
    blockerCount: number;
    warningCount: number;
    infoCount: number;
  };
  releaseGate: {
    status: "passed" | "failed";
  };
  dashboard: {
    decision: "ready" | "pending" | "blocked";
    summary: string;
  };
  blockers: TrendBlocker[];
  signals: CandidateSignalSnapshot[];
}

interface SignalTrendReport {
  id: string;
  label: string;
  current: CandidateSignalSnapshot;
  previous?: CandidateSignalSnapshot;
  direction: TrendDirection;
  summary: string;
  history: string[];
}

export interface ReleaseHealthTrendBaselineReport {
  schemaVersion: 1;
  generatedAt: string;
  summary: {
    candidateCount: number;
    limit: number;
    currentCandidate: string;
    previousCandidate?: string;
    currentReleaseHealthStatus: ReleaseHealthStatus;
    currentReadinessDecision: "ready" | "pending" | "blocked";
    healthyCandidates: number;
    warningCandidates: number;
    blockingCandidates: number;
    newBlockerCount: number;
    knownBlockerCount: number;
    recoveredBlockerCount: number;
    regressingSignalCount: number;
    improvingSignalCount: number;
  };
  inputs: {
    artifactDirs: string[];
    cacheDir?: string;
    limit: number;
  };
  blockers: {
    current: TrendBlocker[];
    previous: TrendBlocker[];
    new: TrendBlocker[];
    known: TrendBlocker[];
    recovered: TrendBlocker[];
  };
  signalTrends: SignalTrendReport[];
  candidates: CandidateTrendEntry[];
}

const DEFAULT_CACHE_DIR = path.resolve("artifacts", "release-readiness-history-cache");
const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");
const RELEASE_HEALTH_FILENAME = "release-health-summary.json";
const RELEASE_GATE_FILENAME = "release-gate-summary.json";
const DASHBOARD_FILENAME = "release-readiness-dashboard.json";
const SOURCE_RUN_FILENAME = "source-run.json";

const SIGNAL_SPECS = [
  {
    id: "release-health",
    label: "Release health",
    select(candidate: CandidateTrendEntry): CandidateSignalSnapshot {
      return {
        id: "release-health",
        label: "Release health",
        status: candidate.releaseHealth.status === "healthy" ? "pass" : candidate.releaseHealth.status === "warning" ? "warn" : "fail",
        summary: `Release health is ${candidate.releaseHealth.status}.`
      };
    }
  },
  {
    id: "candidate-readiness",
    label: "Candidate readiness",
    select(candidate: CandidateTrendEntry): CandidateSignalSnapshot {
      return {
        id: "candidate-readiness",
        label: "Candidate readiness",
        status:
          candidate.dashboard.decision === "ready" ? "pass" : candidate.dashboard.decision === "pending" ? "warn" : "fail",
        summary: candidate.dashboard.summary
      };
    }
  },
  {
    id: "multiplayer-reconnect-soak",
    label: "Multiplayer reconnect soak",
    select(candidate: CandidateTrendEntry): CandidateSignalSnapshot {
      return findSignal(candidate, "multiplayer-reconnect-soak", "Multiplayer reconnect soak", "warn", "Reconnect soak signal was not present.");
    }
  },
  {
    id: "h5-release-candidate-smoke",
    label: "H5 packaged RC smoke",
    select(candidate: CandidateTrendEntry): CandidateSignalSnapshot {
      return findSignal(candidate, "h5-release-candidate-smoke", "H5 packaged RC smoke", "warn", "H5 smoke signal was not present.");
    }
  },
  {
    id: "wechat-release",
    label: "WeChat release validation",
    select(candidate: CandidateTrendEntry): CandidateSignalSnapshot {
      return findSignal(candidate, "wechat-release", "WeChat release validation", "warn", "WeChat release signal was not present.");
    }
  },
  {
    id: "server-health",
    label: "Server health",
    select(candidate: CandidateTrendEntry): CandidateSignalSnapshot {
      return findSignal(candidate, "server-health", "Server health", "warn", "Server health signal was not present.");
    }
  },
  {
    id: "auth-readiness",
    label: "Auth readiness",
    select(candidate: CandidateTrendEntry): CandidateSignalSnapshot {
      return findSignal(candidate, "auth-readiness", "Auth readiness", "warn", "Auth readiness signal was not present.");
    }
  }
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  const artifactDirs: string[] = [];
  let cacheDir: string | undefined;
  let limit = 5;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--artifact-dir" && next) {
      artifactDirs.push(next);
      index += 1;
      continue;
    }
    if (arg === "--cache-dir" && next) {
      cacheDir = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`Invalid --limit value: ${next}`);
      }
      limit = parsed;
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
    artifactDirs,
    ...(cacheDir ? { cacheDir } : {}),
    limit,
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {})
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function toDisplayPath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function findSignal(
  candidate: CandidateTrendEntry,
  id: string,
  label: string,
  fallbackStatus: ReviewerSignalStatus,
  fallbackSummary: string
): CandidateSignalSnapshot {
  return (
    candidate.signals.find((signal) => signal.id === id) ?? {
      id,
      label,
      status: fallbackStatus,
      summary: fallbackSummary
    }
  );
}

function normalizeGateStatus(status: "passed" | "failed" | undefined): ReviewerSignalStatus {
  return status === "passed" ? "pass" : "fail";
}

function getSignalRank(status: ReviewerSignalStatus): number {
  if (status === "pass") {
    return 2;
  }
  if (status === "warn") {
    return 1;
  }
  return 0;
}

function compareSignals(current: CandidateSignalSnapshot, previous?: CandidateSignalSnapshot): TrendDirection {
  if (!previous) {
    return "no-baseline";
  }
  const currentRank = getSignalRank(current.status);
  const previousRank = getSignalRank(previous.status);
  if (currentRank > previousRank) {
    return "improved";
  }
  if (currentRank < previousRank) {
    return "regressed";
  }
  return "unchanged";
}

function formatTrendSummary(
  label: string,
  current: CandidateSignalSnapshot,
  previous: CandidateSignalSnapshot | undefined,
  currentCandidate: string,
  previousCandidate: string | undefined,
  direction: TrendDirection
): string {
  if (!previous || !previousCandidate || direction === "no-baseline") {
    return `${label} is ${current.status.toUpperCase()} for ${currentCandidate}; no previous candidate baseline was available.`;
  }
  if (direction === "regressed") {
    return `${label} regressed from ${previous.status.toUpperCase()} at ${previousCandidate} to ${current.status.toUpperCase()} at ${currentCandidate}.`;
  }
  if (direction === "improved") {
    return `${label} improved from ${previous.status.toUpperCase()} at ${previousCandidate} to ${current.status.toUpperCase()} at ${currentCandidate}.`;
  }
  return `${label} remained ${current.status.toUpperCase()} across ${previousCandidate} and ${currentCandidate}.`;
}

function summarizeBlocker(blocker: TrendBlocker): string {
  return blocker.signalId ? `${blocker.signalId}: ${blocker.summary}` : blocker.summary;
}

function normalizeBlockerId(signalId: string | undefined, title: string, summary: string): string {
  return [signalId ?? "unknown-signal", title.trim().toLowerCase(), summary.trim().toLowerCase()].join("::");
}

function normalizeReleaseHealthStatus(status: ReleaseHealthStatus | undefined): ReleaseHealthStatus {
  return status === "healthy" || status === "warning" ? status : "blocking";
}

function normalizeDashboardDecision(
  decision: ReleaseReadinessDashboardReport["goNoGo"] extends { decision?: infer T } ? T : never
): "ready" | "pending" | "blocked" {
  return decision === "ready" || decision === "pending" ? decision : "blocked";
}

function collectSignals(
  releaseGate: ReleaseGateSummaryReport,
  dashboard: ReleaseReadinessDashboardReport | undefined
): CandidateSignalSnapshot[] {
  const signals: CandidateSignalSnapshot[] = [];

  for (const gate of releaseGate.gates ?? []) {
    if (!gate.id || !gate.label) {
      continue;
    }
    signals.push({
      id: gate.id,
      label: gate.label,
      status: normalizeGateStatus(gate.status),
      summary: gate.summary?.trim() || `${gate.label} is ${gate.status ?? "unknown"}.`
    });
  }

  for (const gate of dashboard?.gates ?? []) {
    if (!gate.id || !gate.label || (gate.id !== "server-health" && gate.id !== "auth-readiness")) {
      continue;
    }
    signals.push({
      id: gate.id,
      label: gate.label,
      status: gate.status === "pass" || gate.status === "warn" ? gate.status : "fail",
      summary: gate.summary?.trim() || `${gate.label} is ${gate.status ?? "unknown"}.`
    });
  }

  return signals;
}

function getCandidateGeneratedAt(
  releaseHealth: ReleaseHealthSummaryReport,
  releaseGate: ReleaseGateSummaryReport,
  dashboard: ReleaseReadinessDashboardReport | undefined
): string | undefined {
  return releaseHealth.generatedAt ?? releaseGate.generatedAt ?? dashboard?.generatedAt;
}

function getSortTimestamp(entry: CandidateTrendEntry): number {
  const parsed = entry.generatedAt ? Date.parse(entry.generatedAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function loadCandidateArtifactDir(artifactDir: string): CandidateTrendEntry {
  const resolvedDir = path.resolve(artifactDir);
  const releaseHealthPath = path.join(resolvedDir, RELEASE_HEALTH_FILENAME);
  const releaseGatePath = path.join(resolvedDir, RELEASE_GATE_FILENAME);

  if (!fs.existsSync(releaseHealthPath) || !fs.existsSync(releaseGatePath)) {
    fail(`Artifact directory ${resolvedDir} must contain ${RELEASE_HEALTH_FILENAME} and ${RELEASE_GATE_FILENAME}.`);
  }

  const releaseHealth = readJsonFile<ReleaseHealthSummaryReport>(releaseHealthPath);
  const releaseGate = readJsonFile<ReleaseGateSummaryReport>(releaseGatePath);
  const dashboardPath = path.join(resolvedDir, DASHBOARD_FILENAME);
  const dashboard = fs.existsSync(dashboardPath) ? readJsonFile<ReleaseReadinessDashboardReport>(dashboardPath) : undefined;
  const sourceRunPath = path.join(resolvedDir, SOURCE_RUN_FILENAME);
  const sourceRun = fs.existsSync(sourceRunPath) ? readJsonFile<SourceRunMetadata>(sourceRunPath) : undefined;
  const blockers = (releaseHealth.triage?.blockers ?? []).map((blocker) => {
    const title = blocker.title?.trim() || blocker.signalId?.trim() || "Unknown blocker";
    const summary = blocker.summary?.trim() || title;
    return {
      id: normalizeBlockerId(blocker.signalId, title, summary),
      label: title,
      signalId: blocker.signalId,
      summary
    };
  });
  const candidateRevision =
    dashboard?.goNoGo?.candidateRevision?.trim() ||
    sourceRun?.headSha?.trim() ||
    releaseHealth.revision?.shortCommit?.trim() ||
    "<unverified>";

  const entry: CandidateTrendEntry = {
    artifactDir: resolvedDir,
    generatedAt: getCandidateGeneratedAt(releaseHealth, releaseGate, dashboard),
    candidateRevision,
    ...(releaseHealth.revision?.branch ? { branch: releaseHealth.revision.branch } : {}),
    ...(sourceRun ? { sourceRun } : {}),
    releaseHealth: {
      status: normalizeReleaseHealthStatus(releaseHealth.summary?.status),
      blockerCount: releaseHealth.summary?.blockerCount ?? blockers.length,
      warningCount: releaseHealth.summary?.warningCount ?? 0,
      infoCount: releaseHealth.summary?.infoCount ?? 0
    },
    releaseGate: {
      status: releaseGate.summary?.status === "passed" ? "passed" : "failed"
    },
    dashboard: {
      decision: normalizeDashboardDecision(dashboard?.goNoGo?.decision),
      summary: dashboard?.goNoGo?.summary?.trim() || `Candidate ${candidateRevision} is ${normalizeDashboardDecision(dashboard?.goNoGo?.decision)}.`
    },
    blockers,
    signals: []
  };
  entry.signals = collectSignals(releaseGate, dashboard);
  return entry;
}

function collectArtifactDirs(args: Args): string[] {
  const explicit = args.artifactDirs.map((artifactDir) => path.resolve(artifactDir));
  if (explicit.length > 0) {
    return [...new Set(explicit)];
  }

  const cacheDir = path.resolve(args.cacheDir ?? DEFAULT_CACHE_DIR);
  if (!fs.existsSync(cacheDir) || !fs.statSync(cacheDir).isDirectory()) {
    fail(
      `No artifact directories were provided and cache dir ${cacheDir} does not exist. Pass --artifact-dir <dir> or populate ${cacheDir}.`
    );
  }

  const candidates: string[] = [];
  if (fs.existsSync(path.join(cacheDir, RELEASE_HEALTH_FILENAME)) && fs.existsSync(path.join(cacheDir, RELEASE_GATE_FILENAME))) {
    candidates.push(cacheDir);
  }
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidateDir = path.join(cacheDir, entry.name);
    if (fs.existsSync(path.join(candidateDir, RELEASE_HEALTH_FILENAME)) && fs.existsSync(path.join(candidateDir, RELEASE_GATE_FILENAME))) {
      candidates.push(candidateDir);
    }
  }

  if (candidates.length === 0) {
    fail(
      `No candidate artifact directories were found under ${cacheDir}. Each directory must contain ${RELEASE_HEALTH_FILENAME} and ${RELEASE_GATE_FILENAME}.`
    );
  }

  return [...new Set(candidates)];
}

export function buildReleaseHealthTrendBaselineReport(args: Args): ReleaseHealthTrendBaselineReport {
  const artifactDirs = collectArtifactDirs(args);
  const candidates = artifactDirs.map((artifactDir) => loadCandidateArtifactDir(artifactDir));
  const sortedCandidates = candidates
    .sort((left, right) => getSortTimestamp(right) - getSortTimestamp(left) || left.artifactDir.localeCompare(right.artifactDir))
    .slice(0, args.limit);

  if (sortedCandidates.length === 0) {
    fail("No candidate artifacts were available after sorting.");
  }

  const [current, previous] = sortedCandidates;
  const currentBlockersById = new Map(current.blockers.map((blocker) => [blocker.id, blocker]));
  const previousBlockersById = new Map((previous?.blockers ?? []).map((blocker) => [blocker.id, blocker]));
  const newBlockers = current.blockers.filter((blocker) => !previousBlockersById.has(blocker.id));
  const knownBlockers = current.blockers.filter((blocker) => previousBlockersById.has(blocker.id));
  const recoveredBlockers = (previous?.blockers ?? []).filter((blocker) => !currentBlockersById.has(blocker.id));
  const signalTrends = SIGNAL_SPECS.map((spec) => {
    const currentSignal = spec.select(current);
    const previousSignal = previous ? spec.select(previous) : undefined;
    const direction = compareSignals(currentSignal, previousSignal);
    return {
      id: spec.id,
      label: spec.label,
      current: currentSignal,
      ...(previousSignal ? { previous: previousSignal } : {}),
      direction,
      summary: formatTrendSummary(spec.label, currentSignal, previousSignal, current.candidateRevision, previous?.candidateRevision, direction),
      history: sortedCandidates.map((candidate) => {
        const signal = spec.select(candidate);
        return `${candidate.candidateRevision}:${signal.status}`;
      })
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      candidateCount: sortedCandidates.length,
      limit: args.limit,
      currentCandidate: current.candidateRevision,
      ...(previous ? { previousCandidate: previous.candidateRevision } : {}),
      currentReleaseHealthStatus: current.releaseHealth.status,
      currentReadinessDecision: current.dashboard.decision,
      healthyCandidates: sortedCandidates.filter((candidate) => candidate.releaseHealth.status === "healthy").length,
      warningCandidates: sortedCandidates.filter((candidate) => candidate.releaseHealth.status === "warning").length,
      blockingCandidates: sortedCandidates.filter((candidate) => candidate.releaseHealth.status === "blocking").length,
      newBlockerCount: newBlockers.length,
      knownBlockerCount: knownBlockers.length,
      recoveredBlockerCount: recoveredBlockers.length,
      regressingSignalCount: signalTrends.filter((signal) => signal.direction === "regressed").length,
      improvingSignalCount: signalTrends.filter((signal) => signal.direction === "improved").length
    },
    inputs: {
      artifactDirs: sortedCandidates.map((candidate) => candidate.artifactDir),
      ...(args.cacheDir ? { cacheDir: path.resolve(args.cacheDir) } : {}),
      limit: args.limit
    },
    blockers: {
      current: current.blockers,
      previous: previous?.blockers ?? [],
      new: newBlockers,
      known: knownBlockers,
      recovered: recoveredBlockers
    },
    signalTrends,
    candidates: sortedCandidates
  };
}

export function renderMarkdown(report: ReleaseHealthTrendBaselineReport): string {
  const current = report.candidates[0];
  const previous = report.candidates[1];
  const lines = [
    "# Release Health Trend Baseline",
    "",
    `- Generated at: \`${report.generatedAt}\``,
    `- Candidates compared: ${report.summary.candidateCount}`,
    `- Current candidate: \`${report.summary.currentCandidate}\``,
    `- Current release health: **${report.summary.currentReleaseHealthStatus.toUpperCase()}**`,
    `- Current readiness decision: \`${report.summary.currentReadinessDecision}\``,
    `- Recent health mix: ${report.summary.healthyCandidates} healthy, ${report.summary.warningCandidates} warning, ${report.summary.blockingCandidates} blocking`,
    ""
  ];

  lines.push("## Blocker Delta", "");
  lines.push(
    ...renderReviewerFacingMarkdownEntry(
      "Release blockers",
      `${report.summary.newBlockerCount} newly introduced, ${report.summary.knownBlockerCount} already known, ${report.summary.recoveredBlockerCount} recovered since the previous candidate.`,
      {
        status: report.summary.newBlockerCount > 0 ? "warn" : current.blockers.length > 0 ? "fail" : "pass",
        artifacts: [{ path: current.artifactDir }, ...(previous ? [{ path: previous.artifactDir }] : [])],
        toDisplayPath
      }
    )
  );
  if (report.blockers.new.length > 0) {
    lines.push("- New blockers:");
    for (const blocker of report.blockers.new) {
      lines.push(`  - ${summarizeBlocker(blocker)}`);
    }
  }
  if (report.blockers.known.length > 0) {
    lines.push("- Known blockers:");
    for (const blocker of report.blockers.known) {
      lines.push(`  - ${summarizeBlocker(blocker)}`);
    }
  }
  if (report.blockers.recovered.length > 0) {
    lines.push("- Recovered blockers:");
    for (const blocker of report.blockers.recovered) {
      lines.push(`  - ${summarizeBlocker(blocker)}`);
    }
  }
  if (
    report.blockers.new.length === 0 &&
    report.blockers.known.length === 0 &&
    report.blockers.recovered.length === 0 &&
    report.blockers.current.length === 0
  ) {
    lines.push("- No blockers across the current and previous candidates.");
  }
  lines.push("");

  lines.push("## Signal Trends", "");
  for (const signal of report.signalTrends) {
    lines.push(
      ...renderReviewerFacingMarkdownEntry(signal.label, signal.summary, {
        status: signal.current.status
      })
    );
    lines.push(`  History: ${signal.history.join(" -> ")}`);
  }
  lines.push("");

  lines.push("## Recent Candidates", "");
  for (const candidate of report.candidates) {
    lines.push(
      `- \`${candidate.candidateRevision}\`: release health=${candidate.releaseHealth.status}, readiness=${candidate.dashboard.decision}, blockers=${candidate.blockers.length}`
    );
    if (candidate.sourceRun?.runUrl) {
      lines.push(`  Source run: ${candidate.sourceRun.runUrl}`);
    }
    lines.push(`  Artifacts: \`${toDisplayPath(candidate.artifactDir)}\``);
  }
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPath(args: Args): string {
  if (args.outputPath) {
    return path.resolve(args.outputPath);
  }
  return path.join(DEFAULT_OUTPUT_DIR, "release-health-trend-baseline.json");
}

function defaultMarkdownOutputPath(args: Args): string {
  if (args.markdownOutputPath) {
    return path.resolve(args.markdownOutputPath);
  }
  return path.join(DEFAULT_OUTPUT_DIR, "release-health-trend-baseline.md");
}

function main(): void {
  const args = parseArgs(process.argv);
  const report = buildReleaseHealthTrendBaselineReport(args);
  const outputPath = defaultOutputPath(args);
  const markdownOutputPath = defaultMarkdownOutputPath(args);

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote release health trend baseline JSON: ${toDisplayPath(outputPath)}`);
  console.log(`Wrote release health trend baseline Markdown: ${toDisplayPath(markdownOutputPath)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
