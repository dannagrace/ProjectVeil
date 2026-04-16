import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildCandidateRevisionTriageDigestFromPaths,
  renderMarkdown as renderCandidateRevisionTriageDigestMarkdown
} from "./candidate-revision-triage-digest.ts";
import {
  buildPhase1ExitDossierFreshnessGateReport,
  renderMarkdown as renderPhase1ExitDossierFreshnessGateMarkdown
} from "./phase1-exit-dossier-freshness-gate.ts";
import {
  buildPhase1ExitAudit,
  renderMarkdown as renderPhase1ExitAuditMarkdown
} from "./phase1-exit-audit.ts";
import {
  buildReleaseEvidenceIndexReport,
  renderReleaseEvidenceIndexMarkdown
} from "./release-evidence-index.ts";
import {
  appendFreshnessHistory,
  buildOwnerReminderReport,
  buildSameCandidateEvidenceAuditReport,
  parseManualEvidenceOwnerLedger,
  renderMarkdown as renderCandidateEvidenceAuditMarkdown,
  renderOwnerReminderMarkdown
} from "./same-candidate-evidence-audit.ts";
import { findNearestReleaseReadinessDir, updateReleaseCandidateManifest } from "./release-candidate-manifest.ts";
import { renderMarkdown, type RehearsalArtifacts, type RehearsalReport } from "./phase1-candidate-rehearsal-markdown.ts";

type StageStatus = "passed" | "failed" | "skipped";
type TargetSurface = "h5" | "wechat";

interface Args {
  candidate: string;
  outputDir: string;
  h5SmokePath?: string;
  reconnectSoakPath?: string;
  runtimeReportPath?: string;
  serverUrl?: string;
  wechatArtifactsDir?: string;
  validateStatus?: string;
  wechatBuildStatus?: string;
  clientRcSmokeStatus?: string;
  targetSurface: TargetSurface;
  runUrl?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface StageDefinition {
  id: string;
  title: string;
  command?: string[];
  run: () => StageResult | Promise<StageResult>;
}

interface StageResult {
  id: string;
  title: string;
  status: StageStatus;
  summary: string;
  command?: string;
  exitCode?: number | null;
  outputs?: string[];
}

interface SameRevisionManifest {
  artifacts?: {
    manualEvidenceLedger?: {
      path?: string;
    };
    releaseReadinessDashboard?: {
      path?: string;
    };
  };
}

interface PrimaryDiagnosticsCheckpointArtifact {
  checkpoints?: Array<{
    diagnostics?: {
      errorEvents?: unknown[];
    };
  }>;
}

interface Phase1CandidateDossierLinkedArtifacts {
  phase1ExitEvidenceGate?: {
    result?: string;
    summary?: string;
    blockingSections?: string[];
    pendingSections?: string[];
    acceptedRiskSections?: string[];
  };
  artifacts?: {
    releaseGateSummaryPath?: string;
  };
}

const OUTPUT_LIMIT = 4000;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate = "phase1-mainline";
  let outputDir = path.join("artifacts", "release-readiness", "phase1-candidate-rehearsal");
  let h5SmokePath: string | undefined;
  let reconnectSoakPath: string | undefined;
  let runtimeReportPath: string | undefined;
  let serverUrl: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let validateStatus: string | undefined;
  let wechatBuildStatus: string | undefined;
  let clientRcSmokeStatus: string | undefined;
  let targetSurface: TargetSurface = "h5";
  let runUrl: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--candidate" && next) {
      candidate = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--h5-smoke" && next) {
      h5SmokePath = next;
      index += 1;
      continue;
    }
    if (arg === "--reconnect-soak" && next) {
      reconnectSoakPath = next;
      index += 1;
      continue;
    }
    if (arg === "--runtime-report" && next) {
      runtimeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--server-url" && next) {
      serverUrl = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-artifacts-dir" && next) {
      wechatArtifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--validate-status" && next) {
      validateStatus = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-build-status" && next) {
      wechatBuildStatus = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--client-rc-smoke-status" && next) {
      clientRcSmokeStatus = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--target-surface" && next) {
      if (next !== "h5" && next !== "wechat") {
        fail(`Unsupported --target-surface value: ${next}`);
      }
      targetSurface = next;
      index += 1;
      continue;
    }
    if (arg === "--run-url" && next) {
      runUrl = next.trim();
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    candidate,
    outputDir,
    ...(h5SmokePath ? { h5SmokePath } : {}),
    ...(reconnectSoakPath ? { reconnectSoakPath } : {}),
    ...(runtimeReportPath ? { runtimeReportPath } : {}),
    ...(serverUrl ? { serverUrl } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(validateStatus ? { validateStatus } : {}),
    ...(wechatBuildStatus ? { wechatBuildStatus } : {}),
    ...(clientRcSmokeStatus ? { clientRcSmokeStatus } : {}),
    targetSurface,
    ...(runUrl ? { runUrl } : {})
  };
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

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "candidate";
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonFile(filePath: string, payload: unknown): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeFile(filePath: string, content: string): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function writeSyntheticReleaseReadinessDashboard(
  filePath: string,
  input: {
    candidate: string;
    candidateRevision: string;
    snapshotPath: string;
    cocosBundlePath: string;
    reconnectPath: string;
    persistencePath: string;
  }
): void {
  writeJsonFile(filePath, {
    generatedAt: new Date().toISOString(),
    overallStatus: "warning",
    inputs: {
      candidate: input.candidate,
      candidateRevision: input.candidateRevision,
      snapshotPath: input.snapshotPath,
      cocosRcPath: input.cocosBundlePath,
      reconnectSoakPath: input.reconnectPath,
      persistencePath: input.persistencePath
    },
    goNoGo: {
      decision: "needs-review",
      summary: "Synthetic candidate-rehearsal dashboard used to pin same-revision evidence inputs for the drift gate.",
      candidateRevision: input.candidateRevision,
      revisionStatus: "aligned",
      requiredFailed: 0,
      requiredPending: 0
    }
  });
}

function buildCandidateRevisionTriageInput(
  sourcePath: string
): {
  schemaVersion: 1;
  generatedAt: string;
  sourceArtifact: string;
  checkpointCount: number;
  errorEvents: unknown[];
} {
  const artifact = readRequiredJson<PrimaryDiagnosticsCheckpointArtifact>(sourcePath);
  const checkpoints = Array.isArray(artifact.checkpoints) ? artifact.checkpoints : [];
  const errorEvents = checkpoints.flatMap((checkpoint) =>
    Array.isArray(checkpoint.diagnostics?.errorEvents) ? checkpoint.diagnostics.errorEvents : []
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceArtifact: toRelative(sourcePath),
    checkpointCount: checkpoints.length,
    errorEvents
  };
}

function toRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function formatCommand(args: string[]): string {
  return args
    .map((part) => (/[^A-Za-z0-9_./:-]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function tailText(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length <= OUTPUT_LIMIT ? normalized : normalized.slice(-OUTPUT_LIMIT);
}

function runCommandStage(id: string, title: string, command: string[], outputs: string[]): StageResult {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  const stdout = tailText(result.stdout);
  const stderr = tailText(result.stderr);
  if (result.error) {
    return {
      id,
      title,
      status: "failed",
      summary: result.error.message,
      command: formatCommand(command),
      exitCode: result.status ?? 1,
      outputs: outputs.map(toRelative)
    };
  }
  if (result.status !== 0) {
    const summary = stderr ?? stdout ?? `Command exited with code ${result.status}.`;
    return {
      id,
      title,
      status: "failed",
      summary,
      command: formatCommand(command),
      exitCode: result.status,
      outputs: outputs.map(toRelative)
    };
  }
  return {
    id,
    title,
    status: "passed",
    summary: stdout?.split(/\r?\n/)[0] ?? "ok",
    command: formatCommand(command),
    exitCode: result.status,
    outputs: outputs.map(toRelative)
  };
}

export function runOptionalFailingDiagnosticStage(id: string, title: string, command: string[], outputs: string[]): StageResult {
  // Snapshot pre-run modification times so we can detect whether outputs were
  // freshly written by this invocation versus inherited as stale artifacts from
  // a previous run on the same candidate/revision.
  const preRunMtimes = new Map<string, number>();
  for (const filePath of outputs) {
    try {
      preRunMtimes.set(filePath, fs.statSync(filePath).mtimeMs);
    } catch {
      // File does not yet exist — expected on first run.
    }
  }

  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  const stdout = tailText(result.stdout);
  const stderr = tailText(result.stderr);
  if (result.error) {
    return {
      id,
      title,
      status: "failed",
      summary: result.error.message,
      command: formatCommand(command),
      exitCode: result.status ?? 1,
      outputs: outputs.map(toRelative)
    };
  }

  const missingOutputs = outputs.filter((filePath) => !fs.existsSync(filePath));
  if (missingOutputs.length > 0) {
    return {
      id,
      title,
      status: "failed",
      summary: `Expected output(s) missing: ${missingOutputs.map(toRelative).join(", ")}`,
      command: formatCommand(command),
      exitCode: result.status,
      outputs: outputs.map(toRelative)
    };
  }

  if (result.status !== 0 && result.status !== 1) {
    const summary = stderr ?? stdout ?? `Command exited with code ${result.status}.`;
    return {
      id,
      title,
      status: "failed",
      summary,
      command: formatCommand(command),
      exitCode: result.status,
      outputs: outputs.map(toRelative)
    };
  }

  // For a non-zero exit (the expected candidate_gate diagnostic code 1), verify
  // that every output file was freshly written by this invocation. Stale artifacts
  // left over from a previous run on the same candidate/revision must not mask a
  // real current-run failure.
  //
  // Freshness is determined by mtime advancement: if a file's mtime did not
  // increase from the pre-run snapshot, it was not written by this invocation.
  // This is the only reliable signal — a wall-clock tolerance window (e.g. 2 s)
  // was previously used to accommodate coarse-grained filesystems (FAT32, NFS),
  // but that window also accepted stale artifacts from very recent prior runs
  // whose mtimes happened to fall inside the tolerance, producing false-positive
  // passes.  Requiring a strict mtime increase eliminates that class of false
  // positive.  On coarse filesystems where a write lands in the same mtime bucket
  // as the prior write, we err conservatively: the stage is reported as failed
  // (safe direction) rather than granting a spurious pass.
  if (result.status !== 0) {
    const staleOutputs = outputs.filter((filePath) => {
      try {
        const currentMtime = fs.statSync(filePath).mtimeMs;
        const priorMtime = preRunMtimes.get(filePath);
        // A file absent before the run is always considered fresh (new output).
        // A file that existed before is stale unless its mtime strictly advanced,
        // proving it was written during this invocation.
        return priorMtime !== undefined && currentMtime <= priorMtime;
      } catch {
        return true; // Cannot stat — treat as stale/missing.
      }
    });
    if (staleOutputs.length > 0) {
      const summary = stderr ?? stdout ?? `Command exited with code ${result.status}.`;
      return {
        id,
        title,
        status: "failed",
        summary: `${summary} (artifact(s) not refreshed by this invocation: ${staleOutputs.map(toRelative).join(", ")})`,
        command: formatCommand(command),
        exitCode: result.status,
        outputs: outputs.map(toRelative)
      };
    }

    // Distinguish expected candidate_gate diagnostic behavior (exits 1 cleanly with
    // no stderr output after writing all artifacts) from real CLI failures that can
    // still write artifacts before throwing.  A subprocess that crashes after writing
    // outputs (e.g. missing profile, network error) will emit an error to stderr and
    // exit 1 via its catch handler.  No stderr output means the exit code 1 was a
    // deliberate gate-failure signal, not an unhandled exception.
    if (stderr) {
      return {
        id,
        title,
        status: "failed",
        summary: stderr,
        command: formatCommand(command),
        exitCode: result.status,
        outputs: outputs.map(toRelative)
      };
    }
  }

  const outputLines = `${stdout ?? ""}\n${stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return {
    id,
    title,
    status: "passed",
    summary: outputLines.at(-1) ?? "ok",
    command: formatCommand(command),
    exitCode: result.status,
    outputs: outputs.map(toRelative)
  };
}

function copyFileIfPresent(sourcePath: string | undefined, destinationPath: string): boolean {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }
  ensureDir(destinationPath);
  fs.copyFileSync(sourcePath, destinationPath);
  return true;
}

function copyDirectory(sourceDir: string, destinationDir: string): void {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
      continue;
    }
    ensureDir(destinationPath);
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function readOptionalJson(filePath: string | undefined): any {
  if (!filePath || !fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readRequiredJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function resolveManifestArtifactPath(manifestPath: string, value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return path.isAbsolute(value) ? value : path.resolve(value);
}

function resolveDossierReleaseGateSummaryPath(dossierPath: string, fallbackPath: string): string {
  if (!fs.existsSync(dossierPath)) {
    return fallbackPath;
  }
  const dossier = readRequiredJson<Phase1CandidateDossierLinkedArtifacts>(dossierPath);
  const resolved = dossier.artifacts?.releaseGateSummaryPath
    ? resolveManifestArtifactPath(dossierPath, dossier.artifacts.releaseGateSummaryPath)
    : undefined;
  return resolved && fs.existsSync(resolved) ? resolved : fallbackPath;
}

function findFirstMatching(outputDir: string, prefix: string, suffix: string): string | undefined {
  if (!fs.existsSync(outputDir)) {
    return undefined;
  }
  return fs
    .readdirSync(outputDir)
    .sort()
    .map((entry) => path.join(outputDir, entry))
    .find((entry) => path.basename(entry).startsWith(prefix) && entry.endsWith(suffix));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const revision = getRevision();
  const candidateSlug = slugify(args.candidate);
  const outputDir = path.resolve(args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const artifacts: RehearsalArtifacts = {};
  const stageResults: StageResult[] = [];
  const nodeExec = process.execPath;

  const stableH5SmokePath = path.join(outputDir, `client-release-candidate-smoke-${candidateSlug}-${revision.shortCommit}.json`);
  const stableReconnectSoakPath = path.join(outputDir, `colyseus-reconnect-soak-summary-${candidateSlug}-${revision.shortCommit}.json`);
  const stableRuntimeReportPath = path.join(outputDir, `runtime-regression-report-${candidateSlug}-${revision.shortCommit}.json`);
  const runtimeObservabilityBundleDir = path.join(outputDir, `runtime-observability-bundle-${candidateSlug}-${revision.shortCommit}`);
  const runtimeSloSummaryPath = path.join(runtimeObservabilityBundleDir, `runtime-slo-summary-${candidateSlug}-${revision.shortCommit}.json`);
  const runtimeSloSummaryMarkdownPath = path.join(
    runtimeObservabilityBundleDir,
    `runtime-slo-summary-${candidateSlug}-${revision.shortCommit}.md`
  );
  const runtimeSloSummaryTextPath = path.join(runtimeObservabilityBundleDir, `runtime-slo-summary-${candidateSlug}-${revision.shortCommit}.txt`);
  const runtimeObservabilityBundlePath = path.join(runtimeObservabilityBundleDir, "runtime-observability-bundle.json");
  const runtimeObservabilityBundleMarkdownPath = path.join(runtimeObservabilityBundleDir, "runtime-observability-bundle.md");
  const runtimeObservabilityEvidencePath = path.join(
    runtimeObservabilityBundleDir,
    `runtime-observability-evidence-${candidateSlug}-${revision.shortCommit}.json`
  );
  const runtimeObservabilityEvidenceMarkdownPath = path.join(
    runtimeObservabilityBundleDir,
    `runtime-observability-evidence-${candidateSlug}-${revision.shortCommit}.md`
  );
  const runtimeObservabilityGatePath = path.join(
    runtimeObservabilityBundleDir,
    `runtime-observability-gate-${candidateSlug}-${revision.shortCommit}.json`
  );
  const runtimeObservabilityGateMarkdownPath = path.join(
    runtimeObservabilityBundleDir,
    `runtime-observability-gate-${candidateSlug}-${revision.shortCommit}.md`
  );
  const stableWechatArtifactsDir = path.join(outputDir, `wechat-release-${candidateSlug}-${revision.shortCommit}`);
  const releaseReadinessSnapshotPath = path.join(outputDir, `release-readiness-${candidateSlug}-${revision.shortCommit}.json`);
  const persistencePath = path.join(outputDir, `phase1-release-persistence-regression-${candidateSlug}-${revision.shortCommit}.json`);
  const cocosPrimaryJourneyEvidencePath = path.join(
    outputDir,
    `cocos-primary-journey-evidence-${candidateSlug}-${revision.shortCommit}.json`
  );
  const cocosPrimaryJourneyEvidenceMarkdownPath = path.join(
    outputDir,
    `cocos-primary-journey-evidence-${candidateSlug}-${revision.shortCommit}.md`
  );
  const cocosMainJourneyReplayGatePath = path.join(
    outputDir,
    `cocos-main-journey-replay-gate-${candidateSlug}-${revision.shortCommit}.json`
  );
  const cocosMainJourneyReplayGateMarkdownPath = path.join(
    outputDir,
    `cocos-main-journey-replay-gate-${candidateSlug}-${revision.shortCommit}.md`
  );
  const cocosPrimaryDiagnosticsPath = path.join(
    outputDir,
    `cocos-primary-client-diagnostic-snapshots-${revision.shortCommit}-${candidateSlug}.json`
  );
  const cocosPrimaryDiagnosticsMarkdownPath = path.join(
    outputDir,
    `cocos-primary-client-diagnostic-snapshots-${revision.shortCommit}-${candidateSlug}.md`
  );
  const candidateRevisionTriageInputPath = path.join(
    outputDir,
    `candidate-revision-triage-input-${candidateSlug}-${revision.shortCommit}.json`
  );
  const candidateRevisionTriageDigestPath = path.join(
    outputDir,
    `candidate-revision-triage-digest-${candidateSlug}-${revision.shortCommit}.json`
  );
  const candidateRevisionTriageDigestMarkdownPath = path.join(
    outputDir,
    `candidate-revision-triage-digest-${candidateSlug}-${revision.shortCommit}.md`
  );
  const releaseGateSummaryPath = path.join(outputDir, `release-gate-summary-${candidateSlug}-${revision.shortCommit}.json`);
  const releaseGateMarkdownPath = path.join(outputDir, `release-gate-summary-${candidateSlug}-${revision.shortCommit}.md`);
  const ciTrendSummaryPath = path.join(outputDir, `ci-trend-summary-${candidateSlug}-${revision.shortCommit}.json`);
  const ciTrendMarkdownPath = path.join(outputDir, `ci-trend-summary-${candidateSlug}-${revision.shortCommit}.md`);
  const releaseHealthSummaryPath = path.join(outputDir, `release-health-summary-${candidateSlug}-${revision.shortCommit}.json`);
  const releaseHealthMarkdownPath = path.join(outputDir, `release-health-summary-${candidateSlug}-${revision.shortCommit}.md`);
  const syntheticDashboardPath = path.join(outputDir, `release-readiness-dashboard-${candidateSlug}-${revision.shortCommit}.json`);
  const releaseReadinessDashboardMarkdownPath = syntheticDashboardPath.replace(/\.json$/, ".md");
  const sameRevisionEvidenceBundleDir = path.join(outputDir, `phase1-same-revision-evidence-bundle-${candidateSlug}-${revision.shortCommit}`);
  const sameRevisionEvidenceBundleManifestPath = path.join(
    sameRevisionEvidenceBundleDir,
    "phase1-same-revision-evidence-bundle-manifest.json"
  );
  const sameRevisionEvidenceBundleMarkdownPath = path.join(sameRevisionEvidenceBundleDir, "phase1-same-revision-evidence-bundle.md");
  const phase1ReleaseEvidenceDriftGatePath = path.join(
    outputDir,
    `phase1-release-evidence-drift-gate-${candidateSlug}-${revision.shortCommit}.json`
  );
  const phase1ReleaseEvidenceDriftGateMarkdownPath = path.join(
    outputDir,
    `phase1-release-evidence-drift-gate-${candidateSlug}-${revision.shortCommit}.md`
  );
  const manualEvidenceLedgerPath = path.join(outputDir, `manual-release-evidence-owner-ledger-${candidateSlug}-${revision.shortCommit}.md`);
  const candidateEvidenceAuditPath = path.join(outputDir, `candidate-evidence-audit-${candidateSlug}-${revision.shortCommit}.json`);
  const candidateEvidenceAuditMarkdownPath = path.join(outputDir, `candidate-evidence-audit-${candidateSlug}-${revision.shortCommit}.md`);
  const candidateEvidenceFreshnessGuardPath = path.join(
    outputDir,
    `candidate-evidence-freshness-guard-${candidateSlug}-${revision.shortCommit}.json`
  );
  const candidateEvidenceFreshnessGuardMarkdownPath = path.join(
    outputDir,
    `candidate-evidence-freshness-guard-${candidateSlug}-${revision.shortCommit}.md`
  );
  const candidateEvidenceOwnerReminderPath = path.join(
    outputDir,
    `candidate-evidence-owner-reminder-report-${candidateSlug}-${revision.shortCommit}.json`
  );
  const candidateEvidenceOwnerReminderMarkdownPath = path.join(
    outputDir,
    `candidate-evidence-owner-reminder-report-${candidateSlug}-${revision.shortCommit}.md`
  );
  const candidateEvidenceFreshnessHistoryPath = path.join(outputDir, `candidate-evidence-freshness-history-${candidateSlug}.json`);
  const releaseEvidenceIndexPath = path.join(outputDir, `current-release-evidence-index-${candidateSlug}-${revision.shortCommit}.json`);
  const releaseEvidenceIndexMarkdownPath = path.join(
    outputDir,
    `current-release-evidence-index-${candidateSlug}-${revision.shortCommit}.md`
  );
  const phase1CandidateDossierPath = path.join(outputDir, `phase1-candidate-dossier-${candidateSlug}-${revision.shortCommit}.json`);
  const phase1CandidateDossierMarkdownPath = path.join(outputDir, `phase1-candidate-dossier-${candidateSlug}-${revision.shortCommit}.md`);
  const phase1ExitAuditPath = path.join(outputDir, `phase1-exit-audit-${candidateSlug}-${revision.shortCommit}.json`);
  const phase1ExitAuditMarkdownPath = path.join(outputDir, `phase1-exit-audit-${candidateSlug}-${revision.shortCommit}.md`);
  const phase1ExitDossierFreshnessGatePath = path.join(
    outputDir,
    `phase1-exit-dossier-freshness-gate-${candidateSlug}-${revision.shortCommit}.json`
  );
  const phase1ExitDossierFreshnessGateMarkdownPath = path.join(
    outputDir,
    `phase1-exit-dossier-freshness-gate-${candidateSlug}-${revision.shortCommit}.md`
  );
  const goNoGoPacketPath = path.join(outputDir, `go-no-go-decision-packet-${candidateSlug}-${revision.shortCommit}.json`);
  const goNoGoPacketMarkdownPath = path.join(outputDir, `go-no-go-decision-packet-${candidateSlug}-${revision.shortCommit}.md`);
  const releasePrCommentPath = path.join(outputDir, `release-pr-comment-${candidateSlug}-${revision.shortCommit}.md`);
  const summaryPath = path.join(outputDir, `phase1-candidate-rehearsal-${candidateSlug}-${revision.shortCommit}.json`);
  const markdownPath = path.join(outputDir, "SUMMARY.md");

  artifacts.releaseReadinessSnapshotPath = toRelative(releaseReadinessSnapshotPath);
  artifacts.persistencePath = toRelative(persistencePath);
  artifacts.cocosPrimaryJourneyEvidencePath = toRelative(cocosPrimaryJourneyEvidencePath);
  artifacts.cocosPrimaryJourneyEvidenceMarkdownPath = toRelative(cocosPrimaryJourneyEvidenceMarkdownPath);
  artifacts.cocosMainJourneyReplayGatePath = toRelative(cocosMainJourneyReplayGatePath);
  artifacts.cocosMainJourneyReplayGateMarkdownPath = toRelative(cocosMainJourneyReplayGateMarkdownPath);
  artifacts.cocosPrimaryDiagnosticsPath = toRelative(cocosPrimaryDiagnosticsPath);
  artifacts.cocosPrimaryDiagnosticsMarkdownPath = toRelative(cocosPrimaryDiagnosticsMarkdownPath);
  artifacts.candidateRevisionTriageInputPath = toRelative(candidateRevisionTriageInputPath);
  artifacts.candidateRevisionTriageDigestPath = toRelative(candidateRevisionTriageDigestPath);
  artifacts.candidateRevisionTriageDigestMarkdownPath = toRelative(candidateRevisionTriageDigestMarkdownPath);
  // runtimeSloSummary paths are set lazily inside the runtime-slo-summary stage only
  // when --server-url is provided and the stage actually runs and produces the files.
  // Do NOT advertise nonexistent paths when the stage is skipped.
  artifacts.runtimeObservabilityBundlePath = toRelative(runtimeObservabilityBundlePath);
  artifacts.runtimeObservabilityBundleMarkdownPath = toRelative(runtimeObservabilityBundleMarkdownPath);
  artifacts.runtimeObservabilityEvidencePath = toRelative(runtimeObservabilityEvidencePath);
  artifacts.runtimeObservabilityEvidenceMarkdownPath = toRelative(runtimeObservabilityEvidenceMarkdownPath);
  artifacts.runtimeObservabilityGatePath = toRelative(runtimeObservabilityGatePath);
  artifacts.runtimeObservabilityGateMarkdownPath = toRelative(runtimeObservabilityGateMarkdownPath);
  artifacts.releaseGateSummaryPath = toRelative(releaseGateSummaryPath);
  artifacts.releaseGateMarkdownPath = toRelative(releaseGateMarkdownPath);
  artifacts.ciTrendSummaryPath = toRelative(ciTrendSummaryPath);
  artifacts.ciTrendMarkdownPath = toRelative(ciTrendMarkdownPath);
  artifacts.releaseHealthSummaryPath = toRelative(releaseHealthSummaryPath);
  artifacts.releaseHealthMarkdownPath = toRelative(releaseHealthMarkdownPath);
  artifacts.sameRevisionEvidenceBundleManifestPath = toRelative(sameRevisionEvidenceBundleManifestPath);
  artifacts.sameRevisionEvidenceBundleMarkdownPath = toRelative(sameRevisionEvidenceBundleMarkdownPath);
  artifacts.phase1ReleaseEvidenceDriftGatePath = toRelative(phase1ReleaseEvidenceDriftGatePath);
  artifacts.phase1ReleaseEvidenceDriftGateMarkdownPath = toRelative(phase1ReleaseEvidenceDriftGateMarkdownPath);
  artifacts.candidateEvidenceAuditPath = toRelative(candidateEvidenceAuditPath);
  artifacts.candidateEvidenceAuditMarkdownPath = toRelative(candidateEvidenceAuditMarkdownPath);
  artifacts.candidateEvidenceFreshnessGuardPath = toRelative(candidateEvidenceFreshnessGuardPath);
  artifacts.candidateEvidenceFreshnessGuardMarkdownPath = toRelative(candidateEvidenceFreshnessGuardMarkdownPath);
  artifacts.candidateEvidenceOwnerReminderPath = toRelative(candidateEvidenceOwnerReminderPath);
  artifacts.candidateEvidenceOwnerReminderMarkdownPath = toRelative(candidateEvidenceOwnerReminderMarkdownPath);
  artifacts.candidateEvidenceFreshnessHistoryPath = toRelative(candidateEvidenceFreshnessHistoryPath);
  artifacts.releaseEvidenceIndexPath = toRelative(releaseEvidenceIndexPath);
  artifacts.releaseEvidenceIndexMarkdownPath = toRelative(releaseEvidenceIndexMarkdownPath);
  artifacts.phase1CandidateDossierPath = toRelative(phase1CandidateDossierPath);
  artifacts.phase1CandidateDossierMarkdownPath = toRelative(phase1CandidateDossierMarkdownPath);
  artifacts.phase1ExitAuditPath = toRelative(phase1ExitAuditPath);
  artifacts.phase1ExitAuditMarkdownPath = toRelative(phase1ExitAuditMarkdownPath);
  artifacts.phase1ExitDossierFreshnessGatePath = toRelative(phase1ExitDossierFreshnessGatePath);
  artifacts.phase1ExitDossierFreshnessGateMarkdownPath = toRelative(phase1ExitDossierFreshnessGateMarkdownPath);
  artifacts.goNoGoPacketPath = toRelative(goNoGoPacketPath);
  artifacts.goNoGoPacketMarkdownPath = toRelative(goNoGoPacketMarkdownPath);
  artifacts.releasePrCommentPath = toRelative(releasePrCommentPath);
  artifacts.summaryPath = toRelative(summaryPath);
  artifacts.markdownPath = toRelative(markdownPath);

  const buildCandidateEvidenceReport = () =>
    buildSameCandidateEvidenceAuditReport({
      candidate: args.candidate,
      candidateRevision: revision.commit,
      targetSurface: args.targetSurface,
      snapshotPath: releaseReadinessSnapshotPath,
      releaseGateSummaryPath,
      cocosRcBundlePath:
        findFirstMatching(outputDir, "cocos-rc-evidence-bundle-", ".json") ?? path.join(outputDir, "missing-cocos-bundle.json"),
      ...(fs.existsSync(runtimeObservabilityEvidencePath) ? { runtimeObservabilityEvidencePath } : {}),
      ...(fs.existsSync(runtimeObservabilityGatePath) ? { runtimeObservabilityGatePath } : {}),
      manualEvidenceLedgerPath,
      ...(artifacts.stableWechatArtifactsDir ? { wechatArtifactsDir: stableWechatArtifactsDir } : {}),
      ...(artifacts.wechatCandidateSummaryPath
        ? { wechatCandidateSummaryPath: path.resolve(artifacts.wechatCandidateSummaryPath) }
        : {}),
      maxAgeHours: 72
    });

  const stageDefinitions: StageDefinition[] = [
    {
      id: "stabilize-inputs",
      title: "Assemble stable rehearsal inputs",
      run: () => {
        const copied: string[] = [];
        if (copyFileIfPresent(args.h5SmokePath, stableH5SmokePath)) {
          artifacts.stableH5SmokePath = toRelative(stableH5SmokePath);
          copied.push(toRelative(stableH5SmokePath));
        }
        if (copyFileIfPresent(args.reconnectSoakPath, stableReconnectSoakPath)) {
          artifacts.stableReconnectSoakPath = toRelative(stableReconnectSoakPath);
          copied.push(toRelative(stableReconnectSoakPath));
        }
        if (copyFileIfPresent(args.runtimeReportPath, stableRuntimeReportPath)) {
          artifacts.stableRuntimeReportPath = toRelative(stableRuntimeReportPath);
          copied.push(toRelative(stableRuntimeReportPath));
        }
        if (args.wechatArtifactsDir && fs.existsSync(args.wechatArtifactsDir)) {
          copyDirectory(args.wechatArtifactsDir, stableWechatArtifactsDir);
          artifacts.stableWechatArtifactsDir = toRelative(stableWechatArtifactsDir);
          copied.push(toRelative(stableWechatArtifactsDir));
        }

        return {
          id: "stabilize-inputs",
          title: "Assemble stable rehearsal inputs",
          status: copied.length > 0 ? "passed" : "skipped",
          summary: copied.length > 0 ? `Prepared ${copied.length} stable input path(s).` : "No external rehearsal inputs were provided.",
          outputs: copied
        };
      }
    },
    {
      id: "release-readiness-snapshot",
      title: "Build release readiness snapshot",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/ci-release-readiness-snapshot.ts",
        "--validate-status",
        args.validateStatus ?? "pending",
        "--wechat-build-status",
        args.wechatBuildStatus ?? "pending",
        "--client-rc-smoke-status",
        args.clientRcSmokeStatus ?? "pending",
        "--output",
        releaseReadinessSnapshotPath
      ],
      run: () =>
        runCommandStage("release-readiness-snapshot", "Build release readiness snapshot", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/ci-release-readiness-snapshot.ts",
          "--validate-status",
          args.validateStatus ?? "pending",
          "--wechat-build-status",
          args.wechatBuildStatus ?? "pending",
          "--client-rc-smoke-status",
          args.clientRcSmokeStatus ?? "pending",
          "--output",
          releaseReadinessSnapshotPath
        ], [releaseReadinessSnapshotPath])
    },
    {
      id: "wechat-candidate-summary",
      title: "Refresh WeChat candidate summary",
      run: () => {
        if (!artifacts.stableWechatArtifactsDir) {
          return {
            id: "wechat-candidate-summary",
            title: "Refresh WeChat candidate summary",
            status: "skipped",
            summary: "No WeChat artifacts directory was provided."
          };
        }
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/validate-wechat-release-candidate.ts",
          "--artifacts-dir",
          stableWechatArtifactsDir,
          "--expected-revision",
          revision.commit
        ];
        const result = runCommandStage("wechat-candidate-summary", "Refresh WeChat candidate summary", command, [
          path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.json"),
          path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.md")
        ]);
        artifacts.wechatCandidateSummaryPath = toRelative(path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.json"));
        artifacts.wechatCandidateMarkdownPath = toRelative(path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.md"));
        return result;
      }
    },
    {
      id: "phase1-persistence",
      title: "Run Phase 1 persistence regression",
      run: () =>
        runCommandStage("phase1-persistence", "Run Phase 1 persistence regression", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/phase1-release-persistence-regression.ts",
          "--output",
          persistencePath
        ], [persistencePath])
    },
    {
      id: "cocos-primary-journey-evidence",
      title: "Build Cocos primary journey evidence",
      run: () =>
        runCommandStage("cocos-primary-journey-evidence", "Build Cocos primary journey evidence", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/cocos-primary-client-journey-evidence.ts",
          "--candidate",
          args.candidate,
          "--output",
          cocosPrimaryJourneyEvidencePath,
          "--markdown-output",
          cocosPrimaryJourneyEvidenceMarkdownPath,
          "--owner",
          "codex",
          "--server",
          args.targetSurface
        ], [cocosPrimaryJourneyEvidencePath, cocosPrimaryJourneyEvidenceMarkdownPath])
    },
    {
      id: "cocos-primary-diagnostics",
      title: "Build Cocos primary diagnostics",
      run: () =>
        runCommandStage("cocos-primary-diagnostics", "Build Cocos primary diagnostics", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/cocos-primary-client-diagnostic-snapshots.ts",
          "--output",
          cocosPrimaryDiagnosticsPath,
          "--markdown-output",
          cocosPrimaryDiagnosticsMarkdownPath
        ], [cocosPrimaryDiagnosticsPath, cocosPrimaryDiagnosticsMarkdownPath])
    },
    {
      id: "candidate-revision-triage-digest",
      title: "Build candidate revision triage digest",
      run: () => {
        if (!fs.existsSync(cocosPrimaryDiagnosticsPath)) {
          return {
            id: "candidate-revision-triage-digest",
            title: "Build candidate revision triage digest",
            status: "failed",
            summary: "Cocos primary diagnostics must exist before the candidate revision triage digest can be generated.",
            outputs: [
              candidateRevisionTriageInputPath,
              candidateRevisionTriageDigestPath,
              candidateRevisionTriageDigestMarkdownPath
            ].map(toRelative)
          };
        }

        const triageInput = buildCandidateRevisionTriageInput(cocosPrimaryDiagnosticsPath);
        writeJsonFile(candidateRevisionTriageInputPath, triageInput);
        const digest = buildCandidateRevisionTriageDigestFromPaths({
          candidate: args.candidate,
          candidateRevision: revision.commit,
          inputPaths: [candidateRevisionTriageInputPath]
        });
        writeJsonFile(candidateRevisionTriageDigestPath, digest);
        writeFile(candidateRevisionTriageDigestMarkdownPath, renderCandidateRevisionTriageDigestMarkdown(digest));

        return {
          id: "candidate-revision-triage-digest",
          title: "Build candidate revision triage digest",
          status: "passed",
          summary: `Built triage digest from ${triageInput.errorEvents.length} error event(s) across ${triageInput.checkpointCount} Cocos diagnostic checkpoint(s).`,
          outputs: [
            candidateRevisionTriageInputPath,
            candidateRevisionTriageDigestPath,
            candidateRevisionTriageDigestMarkdownPath
          ].map(toRelative)
        };
      }
    },
    {
      id: "cocos-rc-bundle",
      title: "Build Cocos RC evidence bundle",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/cocos-rc-evidence-bundle.ts",
          "--candidate",
          args.candidate,
          "--build-surface",
          "wechat_preview",
          "--output-dir",
          outputDir,
          "--release-readiness-snapshot",
          releaseReadinessSnapshotPath,
          "--force"
        ];
        return runCommandStage("cocos-rc-bundle", "Build Cocos RC evidence bundle", command, [outputDir]);
      }
    },
    {
      id: "cocos-main-journey-replay-gate",
      title: "Stage Cocos main-journey replay gate",
      run: () => {
        const outputs = [cocosMainJourneyReplayGatePath, cocosMainJourneyReplayGateMarkdownPath];
        const missingOutputs = outputs.filter((filePath) => !fs.existsSync(filePath));
        if (missingOutputs.length > 0) {
          return {
            id: "cocos-main-journey-replay-gate",
            title: "Stage Cocos main-journey replay gate",
            status: "failed",
            summary: "Cocos RC bundle did not produce the expected main-journey replay gate artifacts.",
            outputs: outputs.map(toRelative)
          };
        }

        return {
          id: "cocos-main-journey-replay-gate",
          title: "Stage Cocos main-journey replay gate",
          status: "passed",
          summary: "Cocos RC bundle produced the main-journey replay gate artifacts for reviewer staging.",
          outputs: outputs.map(toRelative)
        };
      }
    },
    {
      id: "runtime-slo-summary",
      title: "Capture runtime SLO summary",
      run: () => {
        if (!args.serverUrl) {
          return {
            id: "runtime-slo-summary",
            title: "Capture runtime SLO summary",
            status: "skipped",
            summary: "No --server-url was provided, so the runtime SLO summary was skipped."
          };
        }

        const sloResult = runOptionalFailingDiagnosticStage("runtime-slo-summary", "Capture runtime SLO summary", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/runtime-slo-summary.ts",
          "--server-url",
          args.serverUrl,
          "--profile",
          "candidate_gate",
          "--output",
          runtimeSloSummaryPath,
          "--markdown-output",
          runtimeSloSummaryMarkdownPath,
          "--text-output",
          runtimeSloSummaryTextPath
        ], [runtimeSloSummaryPath, runtimeSloSummaryMarkdownPath, runtimeSloSummaryTextPath]);

        // Only advertise artifact paths that were actually produced by this invocation.
        if (fs.existsSync(runtimeSloSummaryPath)) {
          artifacts.runtimeSloSummaryPath = toRelative(runtimeSloSummaryPath);
        }
        if (fs.existsSync(runtimeSloSummaryMarkdownPath)) {
          artifacts.runtimeSloSummaryMarkdownPath = toRelative(runtimeSloSummaryMarkdownPath);
        }
        if (fs.existsSync(runtimeSloSummaryTextPath)) {
          artifacts.runtimeSloSummaryTextPath = toRelative(runtimeSloSummaryTextPath);
        }

        return sloResult;
      }
    },
    {
      id: "runtime-observability-bundle",
      title: "Capture runtime observability bundle",
      run: () => {
        if (!args.serverUrl) {
          return {
            id: "runtime-observability-bundle",
            title: "Capture runtime observability bundle",
            status: "skipped",
            summary: "No --server-url was provided, so the target-environment runtime observability bundle was skipped."
          };
        }

        return runCommandStage("runtime-observability-bundle", "Capture runtime observability bundle", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/runtime-observability-bundle.ts",
          "--candidate",
          args.candidate,
          "--candidate-revision",
          revision.commit,
          "--target-surface",
          args.targetSurface,
          "--target-environment",
          args.targetSurface,
          "--server-url",
          args.serverUrl,
          "--output-dir",
          runtimeObservabilityBundleDir,
          "--output",
          runtimeObservabilityBundlePath,
          "--markdown-output",
          runtimeObservabilityBundleMarkdownPath
        ], [
          runtimeObservabilityBundlePath,
          runtimeObservabilityBundleMarkdownPath,
          runtimeObservabilityEvidencePath,
          runtimeObservabilityEvidenceMarkdownPath,
          runtimeObservabilityGatePath,
          runtimeObservabilityGateMarkdownPath
        ]);
      }
    },
    {
      id: "release-gate-summary",
      title: "Build release gate summary",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/release-gate-summary.ts",
          "--target-surface",
          args.targetSurface,
          "--snapshot",
          releaseReadinessSnapshotPath,
          "--output",
          releaseGateSummaryPath,
          "--markdown-output",
          releaseGateMarkdownPath
        ];
        const cocosReconnectReplayPath =
          findFirstMatching(outputDir, "cocos-rc-reconnect-replay-", ".json") ?? path.join(outputDir, "missing-cocos-rc-reconnect-replay.json");
        if (fs.existsSync(cocosReconnectReplayPath)) {
          command.push("--cocos-rc-reconnect-replay", cocosReconnectReplayPath);
        }
        if (artifacts.stableH5SmokePath) {
          command.push("--h5-smoke", stableH5SmokePath);
        }
        if (artifacts.stableReconnectSoakPath) {
          command.push("--reconnect-soak", stableReconnectSoakPath);
        }
        if (artifacts.stableWechatArtifactsDir) {
          command.push("--wechat-artifacts-dir", stableWechatArtifactsDir);
        }
        return runCommandStage("release-gate-summary", "Build release gate summary", command, [
          releaseGateSummaryPath,
          releaseGateMarkdownPath
        ]);
      }
    },
    {
      id: "ci-trend-summary",
      title: "Build CI trend summary",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/publish-ci-trend-summary.ts",
          "--output",
          ciTrendSummaryPath,
          "--markdown-output",
          ciTrendMarkdownPath,
          "--release-gate-report",
          releaseGateSummaryPath
        ];
        if (artifacts.stableRuntimeReportPath) {
          command.push("--runtime-report", stableRuntimeReportPath);
        }
        return runCommandStage("ci-trend-summary", "Build CI trend summary", command, [
          ciTrendSummaryPath,
          ciTrendMarkdownPath
        ]);
      }
    },
    {
      id: "release-health-summary",
      title: "Build release health summary",
      run: () =>
        runCommandStage("release-health-summary", "Build release health summary", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/release-health-summary.ts",
          "--release-readiness",
          releaseReadinessSnapshotPath,
          "--release-gate-summary",
          releaseGateSummaryPath,
          "--ci-trend-summary",
          ciTrendSummaryPath,
          "--output",
          releaseHealthSummaryPath,
          "--markdown-output",
          releaseHealthMarkdownPath
        ], [releaseHealthSummaryPath, releaseHealthMarkdownPath])
    },
    {
      id: "phase1-same-revision-evidence-bundle",
      title: "Build Phase 1 same-revision evidence bundle",
      run: () => {
        const cocosBundlePath =
          findFirstMatching(outputDir, "cocos-rc-evidence-bundle-", ".json") ?? path.join(outputDir, "missing-cocos-bundle.json");
        const cocosBundle = fs.existsSync(cocosBundlePath)
          ? readRequiredJson<{ artifacts?: { snapshot?: string } }>(cocosBundlePath)
          : undefined;
        const reconnectPath = artifacts.stableReconnectSoakPath ? stableReconnectSoakPath : path.join(outputDir, "missing-reconnect-soak.json");
        writeSyntheticReleaseReadinessDashboard(syntheticDashboardPath, {
          candidate: args.candidate,
          candidateRevision: revision.commit,
          snapshotPath: releaseReadinessSnapshotPath,
          cocosBundlePath: cocosBundle?.artifacts?.snapshot ? path.resolve(cocosBundle.artifacts.snapshot) : cocosBundlePath,
          reconnectPath,
          persistencePath
        });

        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/phase1-same-revision-evidence-bundle.ts",
          "--candidate",
          args.candidate,
          "--candidate-revision",
          revision.commit,
          "--target-surface",
          args.targetSurface,
          "--output-dir",
          sameRevisionEvidenceBundleDir,
          "--snapshot",
          releaseReadinessSnapshotPath,
          "--reconnect-soak",
          reconnectPath,
          "--phase1-persistence",
          persistencePath,
          "--cocos-rc-bundle",
          cocosBundlePath,
          "--release-gate-summary",
          releaseGateSummaryPath,
          "--dashboard",
          syntheticDashboardPath
        ];
        if (artifacts.stableH5SmokePath) {
          command.push("--h5-smoke", stableH5SmokePath);
        }
        if (artifacts.stableWechatArtifactsDir) {
          command.push("--wechat-artifacts-dir", stableWechatArtifactsDir);
        }
        return runCommandStage("phase1-same-revision-evidence-bundle", "Build Phase 1 same-revision evidence bundle", command, [
          sameRevisionEvidenceBundleManifestPath,
          sameRevisionEvidenceBundleMarkdownPath
        ]);
      }
    },
    {
      id: "phase1-release-evidence-drift-gate",
      title: "Run Phase 1 release evidence drift gate",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/phase1-release-evidence-drift-gate.ts",
          "--candidate",
          args.candidate,
          "--candidate-revision",
          revision.commit,
          "--same-revision-bundle-manifest",
          sameRevisionEvidenceBundleManifestPath,
          "--output",
          phase1ReleaseEvidenceDriftGatePath,
          "--markdown-output",
          phase1ReleaseEvidenceDriftGateMarkdownPath
        ];
        if (fs.existsSync(runtimeObservabilityGatePath)) {
          command.push("--runtime-observability-gate", runtimeObservabilityGatePath);
        }
        if (fs.existsSync(runtimeObservabilityEvidencePath)) {
          command.push("--runtime-observability-evidence", runtimeObservabilityEvidencePath);
        }
        return runCommandStage("phase1-release-evidence-drift-gate", "Run Phase 1 release evidence drift gate", command, [
          phase1ReleaseEvidenceDriftGatePath,
          phase1ReleaseEvidenceDriftGateMarkdownPath
        ]);
      }
    },
    {
      id: "candidate-evidence-audit",
      title: "Build candidate evidence audit",
      run: () => {
        if (!fs.existsSync(sameRevisionEvidenceBundleManifestPath)) {
          return {
            id: "candidate-evidence-audit",
            title: "Build candidate evidence audit",
            status: "failed",
            summary: "Phase 1 same-revision evidence bundle manifest is missing, so the reviewer audit front-door could not be generated.",
            outputs: [
              candidateEvidenceAuditPath,
              candidateEvidenceAuditMarkdownPath,
              candidateEvidenceOwnerReminderPath,
              candidateEvidenceOwnerReminderMarkdownPath,
              candidateEvidenceFreshnessHistoryPath
            ].map(toRelative)
          };
        }

        const manifest = readRequiredJson<SameRevisionManifest>(sameRevisionEvidenceBundleManifestPath);
        const sourceManualEvidenceLedgerPath = resolveManifestArtifactPath(
          sameRevisionEvidenceBundleManifestPath,
          manifest.artifacts?.manualEvidenceLedger?.path
        );
        const releaseReadinessDashboardPath = resolveManifestArtifactPath(
          sameRevisionEvidenceBundleManifestPath,
          manifest.artifacts?.releaseReadinessDashboard?.path
        );

        if (sourceManualEvidenceLedgerPath) {
          copyFileIfPresent(sourceManualEvidenceLedgerPath, manualEvidenceLedgerPath);
          artifacts.manualEvidenceLedgerPath = toRelative(manualEvidenceLedgerPath);
        }
        if (releaseReadinessDashboardPath) {
          copyFileIfPresent(releaseReadinessDashboardPath, syntheticDashboardPath);
          artifacts.releaseReadinessDashboardPath = toRelative(syntheticDashboardPath);
          const sourceDashboardMarkdownPath = releaseReadinessDashboardPath.replace(/\.json$/, ".md");
          if (copyFileIfPresent(sourceDashboardMarkdownPath, releaseReadinessDashboardMarkdownPath)) {
            artifacts.releaseReadinessDashboardMarkdownPath = toRelative(releaseReadinessDashboardMarkdownPath);
          }
        }

        if (!sourceManualEvidenceLedgerPath || !fs.existsSync(sourceManualEvidenceLedgerPath)) {
          return {
            id: "candidate-evidence-audit",
            title: "Build candidate evidence audit",
            status: "failed",
            summary: "Phase 1 same-revision evidence bundle did not provide a manual evidence owner ledger for the reviewer audit front-door.",
            outputs: [
              candidateEvidenceAuditPath,
              candidateEvidenceAuditMarkdownPath,
              candidateEvidenceOwnerReminderPath,
              candidateEvidenceOwnerReminderMarkdownPath,
              candidateEvidenceFreshnessHistoryPath
            ].map(toRelative)
          };
        }

        const report = buildCandidateEvidenceReport();

        writeJsonFile(candidateEvidenceAuditPath, report);
        writeFile(candidateEvidenceAuditMarkdownPath, renderCandidateEvidenceAuditMarkdown(report));
        const ownerReminderReport = buildOwnerReminderReport(report, parseManualEvidenceOwnerLedger(manualEvidenceLedgerPath));
        writeJsonFile(candidateEvidenceOwnerReminderPath, ownerReminderReport);
        writeFile(candidateEvidenceOwnerReminderMarkdownPath, renderOwnerReminderMarkdown(ownerReminderReport));
        appendFreshnessHistory(candidateEvidenceFreshnessHistoryPath, report);
        const manifestUpdate = updateReleaseCandidateManifest({
          candidate: report.candidate.name,
          candidateRevision: report.candidate.revision,
          releaseReadinessDir: findNearestReleaseReadinessDir(
            candidateEvidenceAuditPath,
            releaseReadinessSnapshotPath,
            releaseGateSummaryPath
          ),
          entries: [
            {
              id: "candidate-evidence-audit",
              label: "Candidate evidence audit",
              category: "reviewer-entrypoint",
              required: true,
              producedAt: report.generatedAt,
              summary: report.summary.summary,
              producerScript: "./scripts/same-candidate-evidence-audit.ts",
              artifacts: {
                jsonPath: candidateEvidenceAuditPath,
                markdownPath: candidateEvidenceAuditMarkdownPath
              },
              metadata: {
                status: report.summary.status,
                blockerCount: report.summary.blockerCount,
                warningCount: report.summary.warningCount,
                targetSurface: report.candidate.targetSurface
              },
              sources: [
                ...Object.entries(report.inputs)
                  .filter(([key, value]) => key !== "targetSurface" && typeof value === "string" && value.trim().length > 0)
                  .map(([key, value]) => ({
                    label: `Input ${key}`,
                    kind: "artifact" as const,
                    path: value as string
                  })),
                ...report.artifactFamilies
                  .filter((family) => family.artifactPath)
                  .map((family) => ({
                    label: family.label,
                    kind: "artifact" as const,
                    path: family.artifactPath as string
                  }))
              ]
            },
            {
              id: "candidate-evidence-owner-reminder",
              label: "Candidate evidence owner reminder",
              category: "release-evidence",
              required: false,
              producedAt: ownerReminderReport.generatedAt,
              summary: ownerReminderReport.summary.summary,
              producerScript: "./scripts/same-candidate-evidence-audit.ts",
              artifacts: {
                jsonPath: candidateEvidenceOwnerReminderPath,
                markdownPath: candidateEvidenceOwnerReminderMarkdownPath
              },
              metadata: {
                status: ownerReminderReport.summary.status,
                itemCount: ownerReminderReport.summary.itemCount
              },
              sources: [
                {
                  label: "Candidate evidence audit",
                  kind: "artifact",
                  path: candidateEvidenceAuditPath
                }
              ]
            },
            {
              id: "candidate-evidence-freshness-history",
              label: "Candidate evidence freshness history",
              category: "release-evidence",
              required: false,
              producedAt: report.generatedAt,
              summary: "Append-only audit freshness history for the candidate.",
              producerScript: "./scripts/same-candidate-evidence-audit.ts",
              artifacts: {
                jsonPath: candidateEvidenceFreshnessHistoryPath
              },
              metadata: {
                status: report.summary.status
              },
              sources: [
                {
                  label: "Candidate evidence audit",
                  kind: "artifact",
                  path: candidateEvidenceAuditPath
                }
              ]
            }
          ]
        });
        artifacts.candidateEvidenceManifestPath = toRelative(manifestUpdate.manifestJsonPath);
        artifacts.candidateEvidenceManifestMarkdownPath = toRelative(manifestUpdate.manifestMarkdownPath);

        return {
          id: "candidate-evidence-audit",
          title: "Build candidate evidence audit",
          status: "passed",
          summary: `Audit verdict ${report.summary.status}; reviewer front-door artifact generated successfully.`,
          outputs: [
            candidateEvidenceAuditPath,
            candidateEvidenceAuditMarkdownPath,
            candidateEvidenceOwnerReminderPath,
            candidateEvidenceOwnerReminderMarkdownPath,
            candidateEvidenceFreshnessHistoryPath
          ].map(toRelative)
        };
      }
    },
    {
      id: "candidate-evidence-freshness-guard",
      title: "Build candidate evidence freshness guard",
      run: () => {
        if (!fs.existsSync(candidateEvidenceAuditPath)) {
          return {
            id: "candidate-evidence-freshness-guard",
            title: "Build candidate evidence freshness guard",
            status: "failed",
            summary: "Candidate evidence audit must exist before the dedicated freshness guard can be staged.",
            outputs: [candidateEvidenceFreshnessGuardPath, candidateEvidenceFreshnessGuardMarkdownPath].map(toRelative)
          };
        }

        const report = buildCandidateEvidenceReport();
        writeJsonFile(candidateEvidenceFreshnessGuardPath, report);
        writeFile(candidateEvidenceFreshnessGuardMarkdownPath, renderCandidateEvidenceAuditMarkdown(report));

        return {
          id: "candidate-evidence-freshness-guard",
          title: "Build candidate evidence freshness guard",
          status: "passed",
          summary: `Freshness guard verdict ${report.summary.status}; reviewer gate artifact generated successfully.`,
          outputs: [candidateEvidenceFreshnessGuardPath, candidateEvidenceFreshnessGuardMarkdownPath].map(toRelative)
        };
      }
    },
    {
      id: "release-evidence-index",
      title: "Build current release evidence index",
      run: () => {
        const report = buildReleaseEvidenceIndexReport(
          {
            releaseReadinessDir: outputDir,
            wechatArtifactsDir: artifacts.stableWechatArtifactsDir ? stableWechatArtifactsDir : path.join(outputDir, "missing-wechat-artifacts"),
            maxAgeHours: 72,
            outputPath: releaseEvidenceIndexPath,
            markdownOutputPath: releaseEvidenceIndexMarkdownPath
          },
          revision
        );

        writeJsonFile(releaseEvidenceIndexPath, report);
        writeFile(releaseEvidenceIndexMarkdownPath, renderReleaseEvidenceIndexMarkdown(report));

        return {
          id: "release-evidence-index",
          title: "Build current release evidence index",
          status: report.summary.status === "failed" ? "failed" : "passed",
          summary: `Evidence index verdict ${report.summary.status}; ${report.summary.summary}`,
          outputs: [releaseEvidenceIndexPath, releaseEvidenceIndexMarkdownPath].map(toRelative)
        };
      }
    },
    {
      id: "phase1-candidate-dossier",
      title: "Build Phase 1 candidate dossier",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/phase1-candidate-dossier.ts",
          "--candidate",
          args.candidate,
          "--candidate-revision",
          revision.commit,
          "--target-surface",
          args.targetSurface,
          "--snapshot",
          releaseReadinessSnapshotPath,
          "--cocos-bundle",
          findFirstMatching(outputDir, "cocos-rc-evidence-bundle-", ".json") ?? path.join(outputDir, "missing-cocos-bundle.json"),
          "--phase1-persistence",
          persistencePath,
          "--reconnect-soak",
          artifacts.stableReconnectSoakPath ? stableReconnectSoakPath : path.join(outputDir, "missing-reconnect-soak.json"),
          "--ci-trend-summary",
          ciTrendSummaryPath,
        "--output",
        phase1CandidateDossierPath,
        "--markdown-output",
        phase1CandidateDossierMarkdownPath
      ];
      const cocosReconnectReplayPath =
        findFirstMatching(outputDir, "cocos-rc-reconnect-replay-", ".json") ?? path.join(outputDir, "missing-cocos-rc-reconnect-replay.json");
      if (fs.existsSync(cocosReconnectReplayPath)) {
        command.push("--cocos-rc-reconnect-replay", cocosReconnectReplayPath);
      }
      if (artifacts.stableH5SmokePath) {
        command.push("--h5-smoke", stableH5SmokePath);
      }
        if (artifacts.stableWechatArtifactsDir) {
          command.push("--wechat-artifacts-dir", stableWechatArtifactsDir);
        }
        if (args.serverUrl) {
          command.push("--server-url", args.serverUrl);
        }
        if (fs.existsSync(runtimeObservabilityGatePath)) {
          command.push("--runtime-observability-gate", runtimeObservabilityGatePath);
        }
        return runCommandStage("phase1-candidate-dossier", "Build Phase 1 candidate dossier", command, [
          phase1CandidateDossierPath,
          phase1CandidateDossierMarkdownPath
        ]);
      }
    },
    {
      id: "phase1-exit-audit",
      title: "Build Phase 1 exit audit",
      run: () => {
        const dossierReleaseGateSummaryPath = resolveDossierReleaseGateSummaryPath(phase1CandidateDossierPath, releaseGateSummaryPath);
        const reportPromise = buildPhase1ExitAudit({
          candidate: args.candidate,
          candidateRevision: revision.commit,
          targetSurface: args.targetSurface,
          snapshotPath: releaseReadinessSnapshotPath,
          releaseGateSummaryPath: dossierReleaseGateSummaryPath,
          ...(artifacts.wechatCandidateSummaryPath
            ? { wechatCandidateSummaryPath: path.resolve(artifacts.wechatCandidateSummaryPath) }
            : {}),
          ...(artifacts.stableWechatArtifactsDir ? { wechatArtifactsDir: stableWechatArtifactsDir } : {}),
          ...(artifacts.stableH5SmokePath ? { h5SmokePath: stableH5SmokePath } : {}),
          ...(artifacts.stableReconnectSoakPath ? { reconnectSoakPath: stableReconnectSoakPath } : {}),
          ...(artifacts.manualEvidenceLedgerPath ? { manualEvidenceLedgerPath } : {}),
          ...(artifacts.cocosBundlePath ? { cocosBundlePath: path.resolve(artifacts.cocosBundlePath) } : {}),
          persistencePath,
          ciTrendSummaryPath,
          ...(fs.existsSync(runtimeObservabilityEvidencePath) ? { runtimeObservabilityEvidencePath } : {}),
          ...(fs.existsSync(runtimeObservabilityGatePath) ? { runtimeObservabilityGatePath } : {}),
          ...(args.serverUrl ? { serverUrl: args.serverUrl } : {}),
          outputPath: phase1ExitAuditPath,
          markdownOutputPath: phase1ExitAuditMarkdownPath,
          maxEvidenceAgeHours: 48
        });

        return reportPromise.then((report) => {
          const stagedDossier = fs.existsSync(phase1CandidateDossierPath)
            ? readRequiredJson<Phase1CandidateDossierLinkedArtifacts>(phase1CandidateDossierPath)
            : undefined;
          const normalizedReport = {
            ...report,
            ...(stagedDossier?.phase1ExitEvidenceGate ? { phase1ExitEvidenceGate: stagedDossier.phase1ExitEvidenceGate } : {}),
            inputs: {
              ...report.inputs,
              snapshotPath: releaseReadinessSnapshotPath,
              releaseGateSummaryPath: dossierReleaseGateSummaryPath,
              ...(artifacts.manualEvidenceLedgerPath ? { manualEvidenceLedgerPath } : {})
            }
          };

          writeJsonFile(phase1ExitAuditPath, normalizedReport);
          writeFile(phase1ExitAuditMarkdownPath, renderPhase1ExitAuditMarkdown(normalizedReport));
          return {
            id: "phase1-exit-audit",
            title: "Build Phase 1 exit audit",
            status: "passed" as StageStatus,
            summary: `Exit audit verdict ${normalizedReport.summary.status}; final reviewer gate artifact generated successfully.`,
            outputs: [phase1ExitAuditPath, phase1ExitAuditMarkdownPath].map(toRelative)
          };
        });
      }
    },
    {
      id: "phase1-exit-dossier-freshness-gate",
      title: "Build Phase 1 exit dossier freshness gate",
      run: () => {
        const dossierReleaseGateSummaryPath = resolveDossierReleaseGateSummaryPath(phase1CandidateDossierPath, releaseGateSummaryPath);
        const report = buildPhase1ExitDossierFreshnessGateReport({
          candidate: args.candidate,
          candidateRevision: revision.commit,
          dossierPath: phase1CandidateDossierPath,
          exitAuditPath: phase1ExitAuditPath,
          snapshotPath: releaseReadinessSnapshotPath,
          releaseGateSummaryPath: dossierReleaseGateSummaryPath,
          ...(artifacts.manualEvidenceLedgerPath ? { manualEvidenceLedgerPath } : {}),
          outputPath: phase1ExitDossierFreshnessGatePath,
          markdownOutputPath: phase1ExitDossierFreshnessGateMarkdownPath,
          maxAgeHours: 48
        });

        writeJsonFile(phase1ExitDossierFreshnessGatePath, report);
        writeFile(phase1ExitDossierFreshnessGateMarkdownPath, renderPhase1ExitDossierFreshnessGateMarkdown(report));

        return {
          id: "phase1-exit-dossier-freshness-gate",
          title: "Build Phase 1 exit dossier freshness gate",
          status: report.summary.status === "passed" ? "passed" : "failed",
          summary: report.summary.summary,
          outputs: [phase1ExitDossierFreshnessGatePath, phase1ExitDossierFreshnessGateMarkdownPath].map(toRelative)
        };
      }
    },
    {
      id: "go-no-go-packet",
      title: "Build go/no-go decision packet",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/release-go-no-go-decision-packet.ts",
          "--candidate",
          args.candidate,
          "--candidate-revision",
          revision.commit,
          "--dossier",
          phase1CandidateDossierPath,
          "--release-gate-summary",
          releaseGateSummaryPath,
          "--output",
          goNoGoPacketPath,
          "--markdown-output",
          goNoGoPacketMarkdownPath
        ];
        if (artifacts.stableWechatArtifactsDir) {
          command.push("--wechat-artifacts-dir", stableWechatArtifactsDir);
        }
        return runCommandStage("go-no-go-packet", "Build go/no-go decision packet", command, [
          goNoGoPacketPath,
          goNoGoPacketMarkdownPath
        ]);
      }
    },
    {
      id: "release-pr-summary",
      title: "Build release PR summary",
      run: () =>
        runCommandStage("release-pr-summary", "Build release PR summary", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/release-pr-comment.ts",
          "--release-gate-summary",
          releaseGateSummaryPath,
          "--release-health-summary",
          releaseHealthSummaryPath,
          "--go-no-go-packet",
          goNoGoPacketPath,
          "--output",
          releasePrCommentPath
        ], [releasePrCommentPath])
    }
  ];

  for (const stage of stageDefinitions) {
    const result = await Promise.resolve(stage.run());
    stageResults.push(result);
  }

  const cocosBundlePath = findFirstMatching(outputDir, "cocos-rc-evidence-bundle-", ".json");
  const cocosBundleMarkdownPath = findFirstMatching(outputDir, "cocos-rc-evidence-bundle-", ".md");
  const cocosRcReconnectReplayPath = findFirstMatching(outputDir, "cocos-rc-reconnect-replay-", ".json");
  const cocosRcReconnectReplayMarkdownPath = findFirstMatching(outputDir, "cocos-rc-reconnect-replay-", ".md");
  const candidateEvidenceManifestPath = findFirstMatching(outputDir, "candidate-evidence-manifest-", ".json");
  const candidateEvidenceManifestMarkdownPath = findFirstMatching(outputDir, "candidate-evidence-manifest-", ".md");
  if (candidateEvidenceManifestPath) {
    artifacts.candidateEvidenceManifestPath = toRelative(candidateEvidenceManifestPath);
  }
  if (candidateEvidenceManifestMarkdownPath) {
    artifacts.candidateEvidenceManifestMarkdownPath = toRelative(candidateEvidenceManifestMarkdownPath);
  }
  if (cocosBundlePath) {
    artifacts.cocosBundlePath = toRelative(cocosBundlePath);
  }
  if (cocosBundleMarkdownPath) {
    artifacts.cocosBundleMarkdownPath = toRelative(cocosBundleMarkdownPath);
  }
  if (cocosRcReconnectReplayPath) {
    artifacts.cocosRcReconnectReplayPath = toRelative(cocosRcReconnectReplayPath);
  }
  if (cocosRcReconnectReplayMarkdownPath) {
    artifacts.cocosRcReconnectReplayMarkdownPath = toRelative(cocosRcReconnectReplayMarkdownPath);
  }

  const releaseGate = readOptionalJson(releaseGateSummaryPath);
  const releaseHealth = readOptionalJson(releaseHealthSummaryPath);
  const dossier = readOptionalJson(phase1CandidateDossierPath);
  const requiredArtifacts = [
    releaseReadinessSnapshotPath,
    persistencePath,
    cocosPrimaryJourneyEvidencePath,
    cocosPrimaryJourneyEvidenceMarkdownPath,
    cocosMainJourneyReplayGatePath,
    cocosMainJourneyReplayGateMarkdownPath,
    cocosPrimaryDiagnosticsPath,
    cocosPrimaryDiagnosticsMarkdownPath,
    candidateRevisionTriageInputPath,
    candidateRevisionTriageDigestPath,
    candidateRevisionTriageDigestMarkdownPath,
    releaseGateSummaryPath,
    releaseGateMarkdownPath,
    ciTrendSummaryPath,
    ciTrendMarkdownPath,
    releaseHealthSummaryPath,
    releaseHealthMarkdownPath,
    sameRevisionEvidenceBundleManifestPath,
    sameRevisionEvidenceBundleMarkdownPath,
    phase1ReleaseEvidenceDriftGatePath,
    phase1ReleaseEvidenceDriftGateMarkdownPath,
    candidateEvidenceAuditPath,
    candidateEvidenceAuditMarkdownPath,
    candidateEvidenceFreshnessGuardPath,
    candidateEvidenceFreshnessGuardMarkdownPath,
    candidateEvidenceOwnerReminderPath,
    candidateEvidenceOwnerReminderMarkdownPath,
    candidateEvidenceFreshnessHistoryPath,
    syntheticDashboardPath,
    releaseEvidenceIndexPath,
    releaseEvidenceIndexMarkdownPath,
    phase1CandidateDossierPath,
    phase1CandidateDossierMarkdownPath,
    phase1ExitAuditPath,
    phase1ExitAuditMarkdownPath,
    phase1ExitDossierFreshnessGatePath,
    phase1ExitDossierFreshnessGateMarkdownPath,
    goNoGoPacketPath,
    goNoGoPacketMarkdownPath,
    releasePrCommentPath
  ];
  if (args.serverUrl) {
    requiredArtifacts.push(runtimeObservabilityBundlePath, runtimeObservabilityBundleMarkdownPath);
    requiredArtifacts.push(runtimeObservabilityEvidencePath, runtimeObservabilityEvidenceMarkdownPath);
    requiredArtifacts.push(runtimeObservabilityGatePath, runtimeObservabilityGateMarkdownPath);
  }
  if (artifacts.stableH5SmokePath) {
    requiredArtifacts.push(stableH5SmokePath);
  }
  if (artifacts.stableReconnectSoakPath) {
    requiredArtifacts.push(stableReconnectSoakPath);
  }
  if (artifacts.stableWechatArtifactsDir) {
    requiredArtifacts.push(path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.json"));
    requiredArtifacts.push(path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.md"));
  }
  if (artifacts.releaseReadinessDashboardMarkdownPath) {
    requiredArtifacts.push(releaseReadinessDashboardMarkdownPath);
  }
  if (candidateEvidenceManifestPath) {
    requiredArtifacts.push(candidateEvidenceManifestPath);
  }
  if (candidateEvidenceManifestMarkdownPath) {
    requiredArtifacts.push(candidateEvidenceManifestMarkdownPath);
  }
  if (cocosBundlePath) {
    requiredArtifacts.push(cocosBundlePath);
  }
  if (cocosBundleMarkdownPath) {
    requiredArtifacts.push(cocosBundleMarkdownPath);
  }
  if (cocosRcReconnectReplayPath) {
    requiredArtifacts.push(cocosRcReconnectReplayPath);
  }
  if (cocosRcReconnectReplayMarkdownPath) {
    requiredArtifacts.push(cocosRcReconnectReplayMarkdownPath);
  }

  const missingArtifacts = requiredArtifacts.filter((filePath) => !fs.existsSync(filePath)).map(toRelative);
  const stageFailures = stageResults
    .filter((stage) => stage.status === "failed")
    .map((stage) => `${stage.title}: ${stage.summary}`);
  const status = stageFailures.length === 0 && missingArtifacts.length === 0 ? "passed" : "failed";

  const report: RehearsalReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: args.candidate,
      revision: revision.commit,
      shortRevision: revision.shortCommit,
      branch: revision.branch,
      dirty: revision.dirty,
      targetSurface: args.targetSurface
    },
    summary: {
      status,
      stageFailures,
      missingArtifacts,
      releaseGateStatus: String(releaseGate?.summary?.status ?? "unknown"),
      releaseHealthStatus: String(releaseHealth?.summary?.status ?? "unknown"),
      phase1CandidateStatus: String(dossier?.summary?.status ?? "unknown")
    },
    ...(args.runUrl ? { runUrl: args.runUrl } : {}),
    artifactBundleDir: toRelative(outputDir),
    artifacts,
    stages: stageResults
  };

  writeJsonFile(summaryPath, report);
  writeFile(markdownPath, renderMarkdown(report));

  console.log(`Phase 1 candidate rehearsal ${status.toUpperCase()}`);
  console.log(`Candidate: ${args.candidate}`);
  console.log(`Revision: ${revision.shortCommit}`);
  console.log(`Structured summary: ${toRelative(summaryPath)}`);
  console.log(`Markdown summary: ${toRelative(markdownPath)}`);
  console.log(`Release gate status: ${report.summary.releaseGateStatus}`);
  console.log(`Release health status: ${report.summary.releaseHealthStatus}`);
  console.log(`Phase 1 dossier status: ${report.summary.phase1CandidateStatus}`);

  if (status === "failed") {
    if (stageFailures.length > 0) {
      console.error("Stage failures:");
      for (const failure of stageFailures) {
        console.error(`  - ${failure}`);
      }
    }
    if (missingArtifacts.length > 0) {
      console.error("Missing artifacts:");
      for (const artifact of missingArtifacts) {
        console.error(`  - ${artifact}`);
      }
    }
    process.exitCode = 1;
  }
}

const executedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedDirectly) {
  main().catch((error) => {
    console.error(`Phase 1 candidate rehearsal failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
