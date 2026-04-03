import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildReleaseGateSummaryReport, renderMarkdown as renderReleaseGateMarkdown } from "./release-gate-summary.ts";
import { buildReleaseHealthSummaryReport, renderMarkdown as renderReleaseHealthMarkdown } from "./release-health-summary.ts";

type TargetSurface = "h5" | "wechat";
type EvidenceFreshness = "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp" | "unknown";
type DossierResult = "passed" | "failed" | "pending" | "accepted_risk";

interface Args {
  candidate?: string;
  candidateRevision?: string;
  serverUrl?: string;
  snapshotPath?: string;
  h5SmokePath?: string;
  reconnectSoakPath?: string;
  wechatArtifactsDir?: string;
  wechatCandidateSummaryPath?: string;
  wechatRcValidationPath?: string;
  wechatSmokeReportPath?: string;
  cocosBundlePath?: string;
  persistencePath?: string;
  syncGovernancePath?: string;
  ciTrendSummaryPath?: string;
  coverageSummaryPath?: string;
  configCenterLibraryPath?: string;
  targetSurface: TargetSurface;
  outputDir?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  maxEvidenceAgeHours: number;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface SnapshotCheck {
  id?: string;
  title?: string;
  required?: boolean;
  status?: "passed" | "failed" | "pending" | "not_applicable";
  waiver?: {
    approvedBy?: string;
    approvedAt?: string;
    reason?: string;
    expiresAt?: string;
  };
}

interface ReleaseReadinessSnapshot {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  summary?: {
    status?: "passed" | "failed" | "pending" | "partial";
    requiredFailed?: number;
    requiredPending?: number;
  };
  checks?: SnapshotCheck[];
}

interface CocosBundleManifest {
  bundle?: {
    generatedAt?: string;
    candidate?: string;
    commit?: string;
    shortCommit?: string;
    overallStatus?: "pending" | "blocked" | "passed" | "failed" | "partial";
    summary?: string;
  };
  artifacts?: {
    snapshot?: string;
    summaryMarkdown?: string;
    checklistMarkdown?: string;
    blockersMarkdown?: string;
  };
  review?: {
    phase1Gate?: string;
    attachHint?: string;
  };
  journey?: Array<{
    id?: string;
    title?: string;
    status?: "pending" | "blocked" | "passed" | "failed" | "not_applicable";
  }>;
  requiredEvidence?: Array<{
    id?: string;
    label?: string;
    filled?: boolean;
  }>;
}

interface WechatManualReviewCheck {
  id?: string;
  title?: string;
  required?: boolean;
  status?: "passed" | "failed" | "pending" | "not_applicable";
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  notes?: string;
  waiver?: {
    approvedBy?: string;
    approvedAt?: string;
    reason?: string;
    expiresAt?: string;
  };
}

interface WechatCandidateSummary {
  generatedAt?: string;
  candidate?: {
    revision?: string | null;
    version?: string | null;
    status?: "ready" | "blocked";
  };
  artifacts?: {
    validationReportPath?: string;
    summaryPath?: string;
    smokeReportPath?: string;
    uploadReceiptPath?: string;
    markdownPath?: string;
  };
  evidence?: {
    package?: {
      status?: "passed" | "failed" | "skipped";
      summary?: string;
      artifactPath?: string;
    };
    validation?: {
      status?: "passed" | "failed" | "skipped";
      summary?: string;
      artifactPath?: string;
    };
    smoke?: {
      status?: "passed" | "failed" | "skipped";
      summary?: string;
      artifactPath?: string;
    };
    upload?: {
      status?: "passed" | "failed" | "skipped";
      summary?: string;
      artifactPath?: string;
    };
    manualReview?: {
      status?: "ready" | "blocked";
      requiredPendingChecks?: number;
      requiredFailedChecks?: number;
      requiredMetadataFailures?: number;
      checks?: WechatManualReviewCheck[];
    };
  };
  blockers?: Array<{
    id?: string;
    summary?: string;
    artifactPath?: string;
    nextCommand?: string;
  }>;
}

interface WechatRcValidationReport {
  generatedAt?: string;
  commit?: string | null;
  summary?: {
    status?: "passed" | "failed";
    failedChecks?: number;
    failureSummary?: string[];
  };
}

interface WechatSmokeReport {
  artifact?: {
    sourceRevision?: string;
  };
  execution?: {
    executedAt?: string;
    result?: "pending" | "blocked" | "passed" | "failed";
    summary?: string;
  };
  cases?: Array<{
    id?: string;
    required?: boolean;
    status?: "pending" | "blocked" | "passed" | "failed" | "not_applicable";
  }>;
}

interface Phase1PersistenceReleaseReport {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  requestedStorageMode?: string;
  effectiveStorageMode?: string;
  storageDescription?: string;
  summary?: {
    status?: "passed";
    assertionCount?: number;
  };
  contentValidation?: {
    valid?: boolean;
    bundleCount?: number;
    summary?: string;
    issueCount?: number;
  };
  persistenceRegression?: {
    mapPackId?: string;
    assertions?: string[];
  };
}

interface ReconnectSoakArtifact {
  generatedAt?: string;
  candidate?: {
    name?: string;
    revision?: string;
    shortRevision?: string;
  };
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  status?: "passed" | "failed";
  summary?: {
    failedScenarios?: number;
    scenarioNames?: string[];
  };
  soakSummary?: {
    reconnectAttempts?: number;
    invariantChecks?: number;
  } | null;
  results?: Array<{
    scenario?: string;
    failedRooms?: number;
    runtimeHealthAfterCleanup?: {
      activeRoomCount?: number;
      connectionCount?: number;
      activeBattleCount?: number;
      heroCount?: number;
    };
  }>;
  verdict?: {
    status?: "passed" | "failed";
    summary?: string;
  };
}

interface RuntimeHealthPayload {
  status?: "ok";
  checkedAt?: string;
  runtime?: {
    activeRoomCount?: number;
    connectionCount?: number;
    gameplayTraffic?: {
      actionMessagesTotal?: number;
    };
  };
}

interface AuthReadinessPayload {
  status?: "ok" | "warn";
  checkedAt?: string;
  headline?: string;
  alerts?: string[];
  auth?: {
    activeAccountLockCount?: number;
    pendingRegistrationCount?: number;
    pendingRecoveryCount?: number;
    tokenDelivery?: {
      queueCount?: number;
      deadLetterCount?: number;
    };
  };
}

interface DossierEvidenceRef {
  label: string;
  path: string;
  summary: string;
  observedAt?: string;
  freshness: EvidenceFreshness;
  revision?: string;
}

interface DossierAcceptedRisk {
  id: string;
  label: string;
  reason: string;
  approvedBy?: string;
  approvedAt?: string;
  expiresAt?: string;
  artifactPath?: string;
  revision?: string;
}

interface DossierSection {
  id:
    | "release-readiness"
    | "cocos-rc-bundle"
    | "wechat-release"
    | "runtime-health"
    | "reconnect-soak"
    | "phase1-persistence"
    | "phase1-exit-evidence-gate"
    | "release-gate"
    | "release-health";
  label: string;
  required: boolean;
  result: DossierResult;
  summary: string;
  artifactPath?: string;
  observedAt?: string;
  freshness: EvidenceFreshness;
  revision?: string;
  details: string[];
  evidence: DossierEvidenceRef[];
  acceptedRisks: DossierAcceptedRisk[];
}

interface Phase1ExitEvidenceGate {
  result: DossierResult;
  summary: string;
  blockingSections: string[];
  pendingSections: string[];
  acceptedRiskSections: string[];
}

interface Phase1CandidateDossier {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    branch: string;
    dirty: boolean;
    targetSurface: TargetSurface;
  };
  summary: {
    status: DossierResult;
    totalSections: number;
    requiredFailed: string[];
    requiredPending: string[];
    acceptedRiskCount: number;
    freshness: Record<EvidenceFreshness, number>;
  };
  phase1ExitEvidenceGate: Phase1ExitEvidenceGate;
  inputs: {
    serverUrl?: string;
    snapshotPath?: string;
    h5SmokePath?: string;
    reconnectSoakPath?: string;
    wechatArtifactsDir?: string;
    wechatCandidateSummaryPath?: string;
    wechatRcValidationPath?: string;
    wechatSmokeReportPath?: string;
    cocosBundlePath?: string;
    persistencePath?: string;
    syncGovernancePath?: string;
    ciTrendSummaryPath?: string;
    coverageSummaryPath?: string;
    configCenterLibraryPath?: string;
  };
  artifacts?: {
    outputDir: string;
    dossierJsonPath: string;
    dossierMarkdownPath: string;
    runtimeObservabilityDossierPath: string;
    runtimeObservabilityDossierMarkdownPath: string;
    releaseGateSummaryPath: string;
    releaseGateMarkdownPath: string;
    releaseHealthSummaryPath: string;
    releaseHealthMarkdownPath: string;
  };
  sections: DossierSection[];
  acceptedRisks: DossierAcceptedRisk[];
}

interface RuntimeObservabilityDossier {
  schemaVersion: 1;
  generatedAt: string;
  candidate: Phase1CandidateDossier["candidate"];
  targetEnvironment: {
    serverUrl?: string;
  };
  summary: {
    status: DossierResult;
    headline: string;
    runtimeStatus: DossierResult;
    reconnectStatus: DossierResult;
  };
  artifacts?: {
    jsonPath: string;
    markdownPath: string;
  };
  sections: Array<Pick<DossierSection, "id" | "label" | "result" | "summary" | "artifactPath" | "observedAt" | "freshness" | "revision" | "details" | "evidence">>;
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_WECHAT_ARTIFACTS_DIR = path.resolve("artifacts", "wechat-release");
const DEFAULT_CONFIG_CENTER_LIBRARY_PATH = path.resolve("configs", ".config-center-library.json");
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;
const REQUIRED_RUNTIME_METRICS = [
  "veil_active_room_count",
  "veil_connection_count",
  "veil_gameplay_action_messages_total",
  "veil_auth_account_sessions",
  "veil_auth_token_delivery_queue_count"
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let serverUrl: string | undefined;
  let snapshotPath: string | undefined;
  let h5SmokePath: string | undefined;
  let reconnectSoakPath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let wechatCandidateSummaryPath: string | undefined;
  let wechatRcValidationPath: string | undefined;
  let wechatSmokeReportPath: string | undefined;
  let cocosBundlePath: string | undefined;
  let persistencePath: string | undefined;
  let syncGovernancePath: string | undefined;
  let ciTrendSummaryPath: string | undefined;
  let coverageSummaryPath: string | undefined;
  let configCenterLibraryPath: string | undefined;
  let targetSurface: TargetSurface = "wechat";
  let outputDir: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let maxEvidenceAgeHours = 72;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--candidate" && next) {
      candidate = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--candidate-revision" && next) {
      candidateRevision = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--server-url" && next) {
      serverUrl = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--snapshot" && next) {
      snapshotPath = next;
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
    if (arg === "--wechat-artifacts-dir" && next) {
      wechatArtifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-candidate-summary" && next) {
      wechatCandidateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-rc-validation" && next) {
      wechatRcValidationPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-smoke-report" && next) {
      wechatSmokeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--cocos-bundle" && next) {
      cocosBundlePath = next;
      index += 1;
      continue;
    }
    if (arg === "--phase1-persistence" && next) {
      persistencePath = next;
      index += 1;
      continue;
    }
    if (arg === "--sync-governance" && next) {
      syncGovernancePath = next;
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
    if (arg === "--config-center-library" && next) {
      configCenterLibraryPath = next;
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
    if (arg === "--output-dir" && next) {
      outputDir = next;
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
    if (arg === "--max-evidence-age-hours" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`--max-evidence-age-hours must be a positive number, received ${next}`);
      }
      maxEvidenceAgeHours = parsed;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    ...(serverUrl ? { serverUrl } : {}),
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(h5SmokePath ? { h5SmokePath } : {}),
    ...(reconnectSoakPath ? { reconnectSoakPath } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath } : {}),
    ...(wechatRcValidationPath ? { wechatRcValidationPath } : {}),
    ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
    ...(cocosBundlePath ? { cocosBundlePath } : {}),
    ...(persistencePath ? { persistencePath } : {}),
    ...(syncGovernancePath ? { syncGovernancePath } : {}),
    ...(ciTrendSummaryPath ? { ciTrendSummaryPath } : {}),
    ...(coverageSummaryPath ? { coverageSummaryPath } : {}),
    ...(configCenterLibraryPath ? { configCenterLibraryPath } : {}),
    targetSurface,
    ...(outputDir ? { outputDir } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    maxEvidenceAgeHours
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

function resolveWechatArtifactsDir(args: Args): string | undefined {
  if (args.wechatArtifactsDir) {
    return path.resolve(args.wechatArtifactsDir);
  }
  return fs.existsSync(DEFAULT_WECHAT_ARTIFACTS_DIR) ? DEFAULT_WECHAT_ARTIFACTS_DIR : undefined;
}

function resolveOptionalPath(explicitPath: string | undefined, fallback: string | undefined): string | undefined {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  if (!fallback) {
    return undefined;
  }
  return fs.existsSync(fallback) ? fallback : undefined;
}

function resolveInputPaths(args: Args): Phase1CandidateDossier["inputs"] {
  const wechatArtifactsDir = resolveWechatArtifactsDir(args);
  return {
    ...(args.serverUrl ? { serverUrl: args.serverUrl } : {}),
    ...(resolveOptionalPath(
      args.snapshotPath,
      resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("release-readiness-") && entry.endsWith(".json"))
    )
      ? { snapshotPath: resolveOptionalPath(
          args.snapshotPath,
          resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("release-readiness-") && entry.endsWith(".json"))
        )! }
      : {}),
    ...(resolveOptionalPath(
      args.h5SmokePath,
      resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("client-release-candidate-smoke-") && entry.endsWith(".json"))
    )
      ? { h5SmokePath: resolveOptionalPath(
          args.h5SmokePath,
          resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("client-release-candidate-smoke-") && entry.endsWith(".json"))
        )! }
      : {}),
    ...(resolveOptionalPath(
      args.reconnectSoakPath,
      fs.existsSync(path.join(DEFAULT_RELEASE_READINESS_DIR, "colyseus-reconnect-soak-summary.json"))
        ? path.join(DEFAULT_RELEASE_READINESS_DIR, "colyseus-reconnect-soak-summary.json")
        : resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("colyseus-reconnect-soak-summary") && entry.endsWith(".json"))
    )
      ? { reconnectSoakPath: resolveOptionalPath(
          args.reconnectSoakPath,
          fs.existsSync(path.join(DEFAULT_RELEASE_READINESS_DIR, "colyseus-reconnect-soak-summary.json"))
            ? path.join(DEFAULT_RELEASE_READINESS_DIR, "colyseus-reconnect-soak-summary.json")
            : resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("colyseus-reconnect-soak-summary") && entry.endsWith(".json"))
        )! }
      : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(resolveOptionalPath(args.wechatCandidateSummaryPath, wechatArtifactsDir ? path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json") : undefined)
      ? { wechatCandidateSummaryPath: resolveOptionalPath(args.wechatCandidateSummaryPath, wechatArtifactsDir ? path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json") : undefined)! }
      : {}),
    ...(resolveOptionalPath(args.wechatRcValidationPath, wechatArtifactsDir ? path.join(wechatArtifactsDir, "codex.wechat.rc-validation-report.json") : undefined)
      ? { wechatRcValidationPath: resolveOptionalPath(args.wechatRcValidationPath, wechatArtifactsDir ? path.join(wechatArtifactsDir, "codex.wechat.rc-validation-report.json") : undefined)! }
      : {}),
    ...(resolveOptionalPath(args.wechatSmokeReportPath, wechatArtifactsDir ? path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json") : undefined)
      ? { wechatSmokeReportPath: resolveOptionalPath(args.wechatSmokeReportPath, wechatArtifactsDir ? path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json") : undefined)! }
      : {}),
    ...(resolveOptionalPath(
      args.cocosBundlePath,
      resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("cocos-rc-evidence-bundle-") && entry.endsWith(".json"))
    )
      ? { cocosBundlePath: resolveOptionalPath(
          args.cocosBundlePath,
          resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("cocos-rc-evidence-bundle-") && entry.endsWith(".json"))
        )! }
      : {}),
    ...(resolveOptionalPath(
      args.persistencePath,
      resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("phase1-release-persistence-regression-") && entry.endsWith(".json"))
    )
      ? { persistencePath: resolveOptionalPath(
          args.persistencePath,
          resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("phase1-release-persistence-regression-") && entry.endsWith(".json"))
        )! }
      : {}),
    ...(resolveOptionalPath(
      args.syncGovernancePath,
      resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("sync-governance-matrix-") && entry.endsWith(".json"))
    )
      ? { syncGovernancePath: resolveOptionalPath(
          args.syncGovernancePath,
          resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("sync-governance-matrix-") && entry.endsWith(".json"))
        )! }
      : {}),
    ...(resolveOptionalPath(args.ciTrendSummaryPath, path.join(DEFAULT_RELEASE_READINESS_DIR, "ci-trend-summary.json"))
      ? { ciTrendSummaryPath: resolveOptionalPath(args.ciTrendSummaryPath, path.join(DEFAULT_RELEASE_READINESS_DIR, "ci-trend-summary.json"))! }
      : {}),
    ...(resolveOptionalPath(args.coverageSummaryPath, path.resolve(".coverage", "summary.json"))
      ? { coverageSummaryPath: resolveOptionalPath(args.coverageSummaryPath, path.resolve(".coverage", "summary.json"))! }
      : {}),
    ...(resolveOptionalPath(args.configCenterLibraryPath, DEFAULT_CONFIG_CENTER_LIBRARY_PATH)
      ? { configCenterLibraryPath: resolveOptionalPath(args.configCenterLibraryPath, DEFAULT_CONFIG_CENTER_LIBRARY_PATH)! }
      : {})
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

function getRevision(candidateRevision?: string): GitRevision {
  const gitCommit = readGitValue(["rev-parse", "HEAD"]);
  const commit = candidateRevision?.trim() || gitCommit;
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--porcelain"]).length > 0
  };
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "candidate";
}

function normalizeCommit(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !HEX_REVISION_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function commitsMatch(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeCommit(left);
  const normalizedRight = normalizeCommit(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function evaluateFreshness(timestamp: string | undefined, maxAgeMs: number): EvidenceFreshness {
  if (!timestamp?.trim()) {
    return "missing_timestamp";
  }
  const observedAtMs = Date.parse(timestamp);
  if (Number.isNaN(observedAtMs)) {
    return "invalid_timestamp";
  }
  return Date.now() - observedAtMs > maxAgeMs ? "stale" : "fresh";
}

function buildAcceptedRisk(
  id: string,
  label: string,
  reason: string,
  artifactPath?: string,
  revision?: string,
  approvedBy?: string,
  approvedAt?: string,
  expiresAt?: string
): DossierAcceptedRisk {
  return {
    id,
    label,
    reason,
    ...(approvedBy ? { approvedBy } : {}),
    ...(approvedAt ? { approvedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(artifactPath ? { artifactPath } : {}),
    ...(revision ? { revision } : {})
  };
}

function summarizeRiskList(risks: DossierAcceptedRisk[]): string[] {
  return risks.map((risk) => `${risk.label}: ${risk.reason}`);
}

function relativeArtifactPath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return response.text();
}

async function buildRuntimeSection(
  targetSurface: TargetSurface,
  serverUrl: string | undefined,
  maxAgeMs: number
): Promise<DossierSection> {
  if (!serverUrl) {
    return {
      id: "runtime-health",
      label: "Runtime health/auth-readiness/metrics",
      required: true,
      result: targetSurface === "wechat" ? "pending" : "passed",
      summary:
        targetSurface === "wechat"
          ? "Live runtime evidence was not sampled for this candidate."
          : "Live runtime sampling was not requested for this target surface.",
      freshness: "unknown",
      details:
        targetSurface === "wechat"
          ? ["Pass --server-url <base-url> to sample /api/runtime/health, /api/runtime/auth-readiness, and /api/runtime/metrics."]
          : ["No --server-url was provided; dossier relies on packaged-artifact and reconnect-soak evidence for this target surface."],
      evidence: [],
      acceptedRisks: []
    };
  }

  const normalizedServerUrl = serverUrl.replace(/\/$/, "");
  let healthPayload: RuntimeHealthPayload | undefined;
  let authPayload: AuthReadinessPayload | undefined;
  let metricsText: string | undefined;
  const details: string[] = [];
  const evidence: DossierEvidenceRef[] = [];
  let hardFailure = false;
  let pending = false;

  try {
    healthPayload = await fetchJson<RuntimeHealthPayload>(`${normalizedServerUrl}/api/runtime/health`);
  } catch (error) {
    hardFailure = true;
    details.push(`Runtime health probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    authPayload = await fetchJson<AuthReadinessPayload>(`${normalizedServerUrl}/api/runtime/auth-readiness`);
  } catch (error) {
    hardFailure = true;
    details.push(`Auth readiness probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    metricsText = await fetchText(`${normalizedServerUrl}/api/runtime/metrics`);
  } catch (error) {
    hardFailure = true;
    details.push(`Runtime metrics probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const observedAt = healthPayload?.checkedAt ?? authPayload?.checkedAt;
  const freshness = evaluateFreshness(observedAt, maxAgeMs);

  if (healthPayload) {
    details.push(
      `health activeRooms=${healthPayload.runtime?.activeRoomCount ?? 0} connections=${healthPayload.runtime?.connectionCount ?? 0} actionMessages=${healthPayload.runtime?.gameplayTraffic?.actionMessagesTotal ?? 0}`
    );
    evidence.push({
      label: "Runtime health",
      path: `${normalizedServerUrl}/api/runtime/health`,
      summary: `status=${healthPayload.status ?? "missing"}`,
      observedAt: healthPayload.checkedAt,
      freshness: evaluateFreshness(healthPayload.checkedAt, maxAgeMs)
    });
    if (healthPayload.status !== "ok") {
      hardFailure = true;
      details.push(`Runtime health status is ${JSON.stringify(healthPayload.status ?? "missing")}.`);
    }
  }

  if (authPayload) {
    const authSummary = authPayload.headline?.trim() || `status=${authPayload.status ?? "missing"}`;
    details.push(
      `auth lockouts=${authPayload.auth?.activeAccountLockCount ?? 0} pendingRegistrations=${authPayload.auth?.pendingRegistrationCount ?? 0} pendingRecoveries=${authPayload.auth?.pendingRecoveryCount ?? 0}`
    );
    evidence.push({
      label: "Auth readiness",
      path: `${normalizedServerUrl}/api/runtime/auth-readiness`,
      summary: authSummary,
      observedAt: authPayload.checkedAt,
      freshness: evaluateFreshness(authPayload.checkedAt, maxAgeMs)
    });
    if (authPayload.status === "warn") {
      pending = true;
      for (const alert of authPayload.alerts ?? []) {
        details.push(`auth alert: ${alert}`);
      }
    }
    if (authPayload.status !== "ok" && authPayload.status !== "warn") {
      hardFailure = true;
      details.push(`Auth readiness status is ${JSON.stringify(authPayload.status ?? "missing")}.`);
    }
  }

  const missingMetrics = metricsText
    ? REQUIRED_RUNTIME_METRICS.filter((metric) => !metricsText.includes(metric))
    : [...REQUIRED_RUNTIME_METRICS];
  evidence.push({
    label: "Runtime metrics",
    path: `${normalizedServerUrl}/api/runtime/metrics`,
    summary: missingMetrics.length === 0 ? "Required Prometheus metrics present." : `Missing metrics: ${missingMetrics.join(", ")}`,
    observedAt,
    freshness
  });
  if (missingMetrics.length > 0) {
    hardFailure = true;
    details.push(`Missing metrics: ${missingMetrics.join(", ")}`);
  }
  if (freshness === "stale" || freshness === "missing_timestamp" || freshness === "invalid_timestamp") {
    pending = true;
  }

  return {
    id: "runtime-health",
    label: "Runtime health/auth-readiness/metrics",
    required: true,
    result: hardFailure ? "failed" : pending ? "pending" : "passed",
    summary: hardFailure
      ? "Runtime health sampling failed or returned incomplete evidence."
      : pending
        ? "Runtime endpoints responded, but auth or freshness evidence still needs review."
        : "Runtime health, auth readiness, and required metrics were sampled for this candidate.",
    observedAt,
    freshness,
    details,
    evidence,
    acceptedRisks: []
  };
}

function buildSnapshotSection(
  snapshotPath: string | undefined,
  candidateRevision: string,
  maxAgeMs: number
): DossierSection {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    return {
      id: "release-readiness",
      label: "Release readiness snapshot",
      required: true,
      result: "pending",
      summary: "Release readiness snapshot artifact is missing.",
      artifactPath: snapshotPath,
      freshness: "unknown",
      details: ["Run npm run release:readiness:snapshot for the candidate revision."],
      evidence: [],
      acceptedRisks: []
    };
  }

  const snapshot = readJsonFile<ReleaseReadinessSnapshot>(snapshotPath);
  const freshness = evaluateFreshness(snapshot.generatedAt, maxAgeMs);
  const requiredChecks = (snapshot.checks ?? []).filter((check) => check.required !== false);
  const failedChecks = requiredChecks.filter((check) => check.status === "failed");
  const pendingChecks = requiredChecks.filter((check) => check.status === "pending");
  const details: string[] = [];

  if ((snapshot.summary?.requiredFailed ?? 0) > 0) {
    details.push(`requiredFailed=${snapshot.summary?.requiredFailed}`);
  }
  if ((snapshot.summary?.requiredPending ?? 0) > 0) {
    details.push(`requiredPending=${snapshot.summary?.requiredPending}`);
  }
  for (const check of failedChecks) {
    details.push(`failed check: ${check.id ?? check.title ?? "unknown-check"}`);
  }
  for (const check of pendingChecks) {
    details.push(`pending check: ${check.id ?? check.title ?? "unknown-check"}`);
  }
  if (!commitsMatch(snapshot.revision?.commit ?? snapshot.revision?.shortCommit, candidateRevision)) {
    details.push(
      `revision mismatch: expected ${candidateRevision}, observed ${snapshot.revision?.commit ?? snapshot.revision?.shortCommit ?? "missing"}`
    );
  }
  if (freshness !== "fresh") {
    details.push(`snapshot freshness=${freshness}`);
  }

  const acceptedRisks = requiredChecks
    .filter((check) => check.waiver?.reason?.trim())
    .map((check) =>
      buildAcceptedRisk(
        `snapshot:${check.id ?? check.title ?? "unknown-check"}`,
        check.title ?? check.id ?? "Release readiness waiver",
        check.waiver?.reason?.trim() ?? "",
        snapshotPath,
        snapshot.revision?.commit ?? snapshot.revision?.shortCommit,
        check.waiver?.approvedBy?.trim(),
        check.waiver?.approvedAt?.trim(),
        check.waiver?.expiresAt?.trim()
      )
    );

  let result: DossierResult = "passed";
  if (snapshot.summary?.status === "failed" || failedChecks.length > 0 || !commitsMatch(snapshot.revision?.commit ?? snapshot.revision?.shortCommit, candidateRevision)) {
    result = "failed";
  } else if (
    snapshot.summary?.status === "pending" ||
    snapshot.summary?.status === "partial" ||
    pendingChecks.length > 0 ||
    freshness !== "fresh"
  ) {
    result = "pending";
  } else if (acceptedRisks.length > 0) {
    result = "accepted_risk";
  }

  return {
    id: "release-readiness",
    label: "Release readiness snapshot",
    required: true,
    result,
    summary:
      result === "failed"
        ? "Release readiness snapshot still has failing or mismatched required evidence."
        : result === "pending"
          ? "Release readiness snapshot exists, but some required evidence is still pending or stale."
          : acceptedRisks.length > 0
            ? "Release readiness snapshot passed with recorded waivers."
            : "Release readiness snapshot passed for this candidate.",
    artifactPath: snapshotPath,
    observedAt: snapshot.generatedAt,
    freshness,
    revision: snapshot.revision?.commit ?? snapshot.revision?.shortCommit,
    details,
    evidence: [
      {
        label: "Release readiness snapshot",
        path: snapshotPath,
        summary: `status=${snapshot.summary?.status ?? "missing"}`,
        observedAt: snapshot.generatedAt,
        freshness,
        revision: snapshot.revision?.commit ?? snapshot.revision?.shortCommit
      }
    ],
    acceptedRisks
  };
}

function buildCocosSection(bundlePath: string | undefined, candidateRevision: string, maxAgeMs: number): DossierSection {
  if (!bundlePath || !fs.existsSync(bundlePath)) {
    return {
      id: "cocos-rc-bundle",
      label: "Cocos RC bundle",
      required: true,
      result: "pending",
      summary: "Cocos RC bundle manifest is missing.",
      artifactPath: bundlePath,
      freshness: "unknown",
      details: ["Run npm run release:cocos-rc:bundle for the candidate."],
      evidence: [],
      acceptedRisks: []
    };
  }

  const manifest = readJsonFile<CocosBundleManifest>(bundlePath);
  const freshness = evaluateFreshness(manifest.bundle?.generatedAt, maxAgeMs);
  const missingRequiredEvidence = (manifest.requiredEvidence ?? []).filter((entry) => entry.filled === false);
  const failedJourney = (manifest.journey ?? []).filter((entry) => entry.status === "failed" || entry.status === "blocked");
  const pendingJourney = (manifest.journey ?? []).filter((entry) => entry.status === "pending");
  const details: string[] = [];

  if (missingRequiredEvidence.length > 0) {
    details.push(`missing required evidence: ${missingRequiredEvidence.map((entry) => entry.id ?? entry.label ?? "unknown").join(", ")}`);
  }
  if (failedJourney.length > 0) {
    details.push(`failed journey steps: ${failedJourney.map((entry) => entry.id ?? entry.title ?? "unknown").join(", ")}`);
  }
  if (pendingJourney.length > 0) {
    details.push(`pending journey steps: ${pendingJourney.map((entry) => entry.id ?? entry.title ?? "unknown").join(", ")}`);
  }
  if (!commitsMatch(manifest.bundle?.commit ?? manifest.bundle?.shortCommit, candidateRevision)) {
    details.push(`revision mismatch: expected ${candidateRevision}, observed ${manifest.bundle?.commit ?? manifest.bundle?.shortCommit ?? "missing"}`);
  }
  if (manifest.review?.phase1Gate?.trim()) {
    details.push(`phase1 gate: ${manifest.review.phase1Gate.trim()}`);
  }
  if (manifest.review?.attachHint?.trim()) {
    details.push(`attach hint: ${manifest.review.attachHint.trim()}`);
  }

  let result: DossierResult = "passed";
  if (
    manifest.bundle?.overallStatus === "failed" ||
    manifest.bundle?.overallStatus === "blocked" ||
    failedJourney.length > 0 ||
    missingRequiredEvidence.length > 0 ||
    !commitsMatch(manifest.bundle?.commit ?? manifest.bundle?.shortCommit, candidateRevision)
  ) {
    result = "failed";
  } else if (manifest.bundle?.overallStatus === "pending" || manifest.bundle?.overallStatus === "partial" || pendingJourney.length > 0 || freshness !== "fresh") {
    result = "pending";
  }

  const evidence: DossierEvidenceRef[] = [
    {
      label: "Cocos RC bundle manifest",
      path: bundlePath,
      summary: manifest.bundle?.summary?.trim() || `status=${manifest.bundle?.overallStatus ?? "missing"}`,
      observedAt: manifest.bundle?.generatedAt,
      freshness,
      revision: manifest.bundle?.commit ?? manifest.bundle?.shortCommit
    }
  ];
  if (manifest.artifacts?.snapshot) {
    evidence.push({
      label: "Cocos RC snapshot",
      path: manifest.artifacts.snapshot,
      summary: "Linked Cocos RC snapshot",
      freshness: "unknown"
    });
  }
  if (manifest.artifacts?.checklistMarkdown) {
    evidence.push({
      label: "Cocos RC checklist",
      path: manifest.artifacts.checklistMarkdown,
      summary: "Linked checklist markdown",
      freshness: "unknown"
    });
  }
  if (manifest.artifacts?.blockersMarkdown) {
    evidence.push({
      label: "Cocos RC blockers",
      path: manifest.artifacts.blockersMarkdown,
      summary: "Linked blockers markdown",
      freshness: "unknown"
    });
  }

  return {
    id: "cocos-rc-bundle",
    label: "Cocos RC bundle",
    required: true,
    result,
    summary:
      result === "failed"
        ? "Cocos RC bundle is incomplete or points at another revision."
        : result === "pending"
          ? "Cocos RC bundle exists, but some journey or freshness evidence is still pending."
          : "Cocos RC bundle is aligned with this candidate revision.",
    artifactPath: bundlePath,
    observedAt: manifest.bundle?.generatedAt,
    freshness,
    revision: manifest.bundle?.commit ?? manifest.bundle?.shortCommit,
    details,
    evidence,
    acceptedRisks: []
  };
}

function buildWechatSection(
  targetSurface: TargetSurface,
  candidateSummaryPath: string | undefined,
  validationPath: string | undefined,
  smokeReportPath: string | undefined,
  candidateRevision: string,
  maxAgeMs: number
): DossierSection {
  const required = targetSurface === "wechat";

  if (candidateSummaryPath && fs.existsSync(candidateSummaryPath)) {
    const summary = readJsonFile<WechatCandidateSummary>(candidateSummaryPath);
    const freshness = evaluateFreshness(summary.generatedAt, maxAgeMs);
    const manualReview = summary.evidence?.manualReview;
    const details = [...(summary.blockers ?? []).map((blocker) => blocker.summary?.trim()).filter((value): value is string => Boolean(value))];
    const acceptedRisks = (manualReview?.checks ?? [])
      .filter((check) => check.waiver?.reason?.trim())
      .map((check) =>
        buildAcceptedRisk(
          `wechat:${check.id ?? check.title ?? "unknown-check"}`,
          check.title ?? check.id ?? "WeChat manual review waiver",
          check.waiver?.reason?.trim() ?? "",
          check.artifactPath ?? candidateSummaryPath,
          check.revision ?? summary.candidate?.revision ?? undefined,
          check.waiver?.approvedBy?.trim(),
          check.waiver?.approvedAt?.trim(),
          check.waiver?.expiresAt?.trim()
        )
      );

    if ((manualReview?.requiredPendingChecks ?? 0) > 0) {
      details.push(`manual review pending=${manualReview?.requiredPendingChecks}`);
    }
    if ((manualReview?.requiredFailedChecks ?? 0) > 0) {
      details.push(`manual review failed=${manualReview?.requiredFailedChecks}`);
    }
    if ((manualReview?.requiredMetadataFailures ?? 0) > 0) {
      details.push(`manual review metadata failures=${manualReview?.requiredMetadataFailures}`);
    }
    if (!commitsMatch(summary.candidate?.revision ?? undefined, candidateRevision)) {
      details.push(`revision mismatch: expected ${candidateRevision}, observed ${summary.candidate?.revision ?? "missing"}`);
    }
    if (freshness !== "fresh") {
      details.push(`wechat evidence freshness=${freshness}`);
    }

    let result: DossierResult = "passed";
    if (
      summary.candidate?.status === "blocked" &&
      ((manualReview?.requiredFailedChecks ?? 0) > 0 ||
        (manualReview?.requiredMetadataFailures ?? 0) > 0 ||
        summary.evidence?.smoke?.status === "failed" ||
        !commitsMatch(summary.candidate?.revision ?? undefined, candidateRevision))
    ) {
      result = "failed";
    } else if (
      summary.candidate?.status !== "ready" ||
      (manualReview?.requiredPendingChecks ?? 0) > 0 ||
      summary.evidence?.smoke?.status === "skipped" ||
      freshness !== "fresh"
    ) {
      result = "pending";
    } else if (acceptedRisks.length > 0) {
      result = "accepted_risk";
    }

    const evidence: DossierEvidenceRef[] = [
      {
        label: "WeChat candidate summary",
        path: candidateSummaryPath,
        summary: `candidate=${summary.candidate?.status ?? "missing"}`,
        observedAt: summary.generatedAt,
        freshness,
        revision: summary.candidate?.revision ?? undefined
      }
    ];
    for (const check of manualReview?.checks ?? []) {
      if (!check.artifactPath) {
        continue;
      }
      evidence.push({
        label: check.title ?? check.id ?? "WeChat manual review",
        path: check.artifactPath,
        summary: `status=${check.status ?? "missing"}`,
        observedAt: check.recordedAt,
        freshness: evaluateFreshness(check.recordedAt, maxAgeMs),
        revision: check.revision
      });
    }

    return {
      id: "wechat-release",
      label: "WeChat release evidence",
      required,
      result,
      summary:
        result === "failed"
          ? "WeChat candidate summary is blocked by failed or mismatched required evidence."
          : result === "pending"
            ? "WeChat candidate summary exists, but required smoke/manual review evidence is still pending."
            : acceptedRisks.length > 0
              ? "WeChat candidate evidence passed with recorded waivers."
              : "WeChat candidate evidence is aligned with this revision.",
      artifactPath: candidateSummaryPath,
      observedAt: summary.generatedAt,
      freshness,
      revision: summary.candidate?.revision ?? undefined,
      details,
      evidence,
      acceptedRisks
    };
  }

  if (validationPath && fs.existsSync(validationPath)) {
    const report = readJsonFile<WechatRcValidationReport>(validationPath);
    const freshness = evaluateFreshness(report.generatedAt, maxAgeMs);
    const details = [...(report.summary?.failureSummary ?? [])];
    if (!commitsMatch(report.commit ?? undefined, candidateRevision)) {
      details.push(`revision mismatch: expected ${candidateRevision}, observed ${report.commit ?? "missing"}`);
    }
    const result: DossierResult =
      report.summary?.status === "passed" && commitsMatch(report.commit ?? undefined, candidateRevision) && freshness === "fresh"
        ? "passed"
        : report.summary?.status === "failed" || !commitsMatch(report.commit ?? undefined, candidateRevision)
          ? "failed"
          : "pending";
    return {
      id: "wechat-release",
      label: "WeChat release evidence",
      required,
      result,
      summary:
        result === "passed"
          ? "WeChat RC validation passed for this revision."
          : result === "failed"
            ? "WeChat RC validation failed or points at another revision."
            : "WeChat RC validation exists, but freshness still needs attention.",
      artifactPath: validationPath,
      observedAt: report.generatedAt,
      freshness,
      revision: report.commit ?? undefined,
      details,
      evidence: [
        {
          label: "WeChat RC validation report",
          path: validationPath,
          summary: `status=${report.summary?.status ?? "missing"}`,
          observedAt: report.generatedAt,
          freshness,
          revision: report.commit ?? undefined
        }
      ],
      acceptedRisks: []
    };
  }

  if (smokeReportPath && fs.existsSync(smokeReportPath)) {
    const report = readJsonFile<WechatSmokeReport>(smokeReportPath);
    const freshness = evaluateFreshness(report.execution?.executedAt, maxAgeMs);
    const failedCases = (report.cases ?? []).filter((entry) => entry.required !== false && entry.status === "failed");
    const pendingCases = (report.cases ?? []).filter(
      (entry) => entry.required !== false && (entry.status === "pending" || entry.status === "blocked")
    );
    const details = [
      ...failedCases.map((entry) => `failed case: ${entry.id ?? "unknown-case"}`),
      ...pendingCases.map((entry) => `pending case: ${entry.id ?? "unknown-case"}`)
    ];
    if (!commitsMatch(report.artifact?.sourceRevision ?? undefined, candidateRevision)) {
      details.push(`revision mismatch: expected ${candidateRevision}, observed ${report.artifact?.sourceRevision ?? "missing"}`);
    }
    let result: DossierResult = "passed";
    if (report.execution?.result === "failed" || failedCases.length > 0 || !commitsMatch(report.artifact?.sourceRevision ?? undefined, candidateRevision)) {
      result = "failed";
    } else if (report.execution?.result === "pending" || report.execution?.result === "blocked" || pendingCases.length > 0 || freshness !== "fresh") {
      result = "pending";
    }
    return {
      id: "wechat-release",
      label: "WeChat release evidence",
      required,
      result,
      summary:
        result === "passed"
          ? "WeChat smoke report passed for this revision."
          : result === "failed"
            ? "WeChat smoke report failed or points at another revision."
            : "WeChat smoke report exists, but candidate evidence is still pending.",
      artifactPath: smokeReportPath,
      observedAt: report.execution?.executedAt,
      freshness,
      revision: report.artifact?.sourceRevision ?? undefined,
      details,
      evidence: [
        {
          label: "WeChat smoke report",
          path: smokeReportPath,
          summary: report.execution?.summary?.trim() || `result=${report.execution?.result ?? "missing"}`,
          observedAt: report.execution?.executedAt,
          freshness,
          revision: report.artifact?.sourceRevision ?? undefined
        }
      ],
      acceptedRisks: []
    };
  }

  return {
    id: "wechat-release",
    label: "WeChat release evidence",
    required,
    result: required ? "pending" : "pending",
    summary: "No WeChat candidate summary, RC validation, or smoke report was selected.",
    freshness: "unknown",
    details: ["Run npm run validate:wechat-rc or produce codex.wechat.release-candidate-summary.json for this candidate."],
    evidence: [],
    acceptedRisks: []
  };
}

function buildPersistenceSection(persistencePath: string | undefined, candidateRevision: string, maxAgeMs: number): DossierSection {
  if (!persistencePath || !fs.existsSync(persistencePath)) {
    return {
      id: "phase1-persistence",
      label: "Phase 1 persistence/content-pack validation",
      required: true,
      result: "pending",
      summary: "Phase 1 persistence evidence is missing, so the verified storage mode is not visible for this candidate.",
      artifactPath: persistencePath,
      freshness: "unknown",
      details: ["Run npm run test:phase1-release-persistence for the candidate revision on the intended storage mode."],
      evidence: [],
      acceptedRisks: []
    };
  }

  const report = readJsonFile<Phase1PersistenceReleaseReport>(persistencePath);
  const freshness = evaluateFreshness(report.generatedAt, maxAgeMs);
  const revision = report.revision?.commit ?? report.revision?.shortCommit;
  const effectiveStorageMode = report.effectiveStorageMode?.trim();
  const requestedStorageMode = report.requestedStorageMode?.trim();
  const details: string[] = [];
  if (report.contentValidation?.summary?.trim()) {
    details.push(report.contentValidation.summary.trim());
  }
  if ((report.contentValidation?.issueCount ?? 0) > 0) {
    details.push(`content validation issues=${report.contentValidation?.issueCount}`);
  }
  if (effectiveStorageMode) {
    details.push(`verifiedStorage=${effectiveStorageMode}`);
  } else {
    details.push("verifiedStorage=<missing>");
  }
  if (requestedStorageMode && requestedStorageMode !== effectiveStorageMode) {
    details.push(`requestedStorage=${requestedStorageMode}`);
  }
  if (report.storageDescription?.trim()) {
    details.push(report.storageDescription.trim());
  }
  if (report.persistenceRegression?.mapPackId?.trim()) {
    details.push(`mapPack=${report.persistenceRegression.mapPackId.trim()}`);
  }
  if (!commitsMatch(revision, candidateRevision)) {
    details.push(`revision mismatch: expected ${candidateRevision}, observed ${revision ?? "missing"}`);
  }
  if (freshness !== "fresh") {
    details.push(`persistence freshness=${freshness}`);
  }

  let result: DossierResult = "passed";
  if (
    report.summary?.status !== "passed" ||
    report.contentValidation?.valid !== true ||
    !commitsMatch(revision, candidateRevision) ||
    !effectiveStorageMode
  ) {
    result = "failed";
  } else if (freshness !== "fresh") {
    result = "pending";
  }

  return {
    id: "phase1-persistence",
    label: "Phase 1 persistence/content-pack validation",
    required: true,
    result,
    summary:
      result === "failed"
        ? "Phase 1 persistence evidence is not aligned with this candidate or does not record a verified storage mode."
        : result === "pending"
          ? `Phase 1 persistence evidence verified ${effectiveStorageMode} storage, but the artifact is stale for this candidate.`
          : `Phase 1 persistence regression and content-pack validation passed with verified storage mode ${effectiveStorageMode}.`,
    artifactPath: persistencePath,
    observedAt: report.generatedAt,
    freshness,
    revision,
    details,
    evidence: [
      {
        label: "Phase 1 persistence regression",
        path: persistencePath,
        summary: `storage=${effectiveStorageMode ?? "<missing>"} assertions=${report.summary?.assertionCount ?? 0} contentValid=${report.contentValidation?.valid === true}`,
        observedAt: report.generatedAt,
        freshness,
        revision
      }
    ],
    acceptedRisks: []
  };
}

function buildReconnectSoakSection(reconnectSoakPath: string | undefined, candidateRevision: string, maxAgeMs: number): DossierSection {
  if (!reconnectSoakPath || !fs.existsSync(reconnectSoakPath)) {
    return {
      id: "reconnect-soak",
      label: "Reconnect soak evidence",
      required: true,
      result: "pending",
      summary: "Reconnect soak artifact is missing.",
      artifactPath: reconnectSoakPath,
      freshness: "unknown",
      details: ["Run npm run release:reconnect-soak -- --candidate <candidate-name> --candidate-revision <git-sha>."],
      evidence: [],
      acceptedRisks: []
    };
  }

  const report = readJsonFile<ReconnectSoakArtifact>(reconnectSoakPath);
  const freshness = evaluateFreshness(report.generatedAt, maxAgeMs);
  const revision = report.candidate?.revision ?? report.revision?.commit ?? report.revision?.shortCommit;
  const reconnectResult = report.results?.find((entry) => entry.scenario === "reconnect_soak");
  const cleanup = reconnectResult?.runtimeHealthAfterCleanup;
  const lingeringCleanupMetrics = [
    ["activeRoomCount", cleanup?.activeRoomCount ?? 0],
    ["connectionCount", cleanup?.connectionCount ?? 0],
    ["activeBattleCount", cleanup?.activeBattleCount ?? 0],
    ["heroCount", cleanup?.heroCount ?? 0]
  ].filter(([, value]) => value > 0);

  const details: string[] = [
    `reconnectAttempts=${report.soakSummary?.reconnectAttempts ?? 0}`,
    `invariantChecks=${report.soakSummary?.invariantChecks ?? 0}`
  ];
  if (report.summary?.scenarioNames?.length) {
    details.push(`scenarios=${report.summary.scenarioNames.join(",")}`);
  }
  if (lingeringCleanupMetrics.length > 0) {
    details.push(`cleanup=${lingeringCleanupMetrics.map(([label, value]) => `${label}=${value}`).join(",")}`);
  }
  if (!commitsMatch(revision, candidateRevision)) {
    details.push(`revision mismatch: expected ${candidateRevision}, observed ${revision ?? "missing"}`);
  }
  if (freshness !== "fresh") {
    details.push(`reconnect soak freshness=${freshness}`);
  }

  let result: DossierResult = "passed";
  if (
    report.status !== "passed" ||
    report.verdict?.status === "failed" ||
    (report.summary?.failedScenarios ?? 0) > 0 ||
    (reconnectResult?.failedRooms ?? 0) > 0 ||
    (report.soakSummary?.reconnectAttempts ?? 0) <= 0 ||
    (report.soakSummary?.invariantChecks ?? 0) <= 0 ||
    lingeringCleanupMetrics.length > 0 ||
    !commitsMatch(revision, candidateRevision)
  ) {
    result = "failed";
  } else if (freshness !== "fresh") {
    result = "pending";
  }

  return {
    id: "reconnect-soak",
    label: "Reconnect soak evidence",
    required: true,
    result,
    summary:
      result === "failed"
        ? "Reconnect soak evidence is failing for this candidate."
        : result === "pending"
          ? "Reconnect soak evidence is stale for this candidate."
          : "Reconnect soak evidence is present and passing for this candidate.",
    artifactPath: reconnectSoakPath,
    observedAt: report.generatedAt,
    freshness,
    revision,
    details,
    evidence: [
      {
        label: "Reconnect soak summary",
        path: reconnectSoakPath,
        summary: `reconnectAttempts=${report.soakSummary?.reconnectAttempts ?? 0} invariantChecks=${report.soakSummary?.invariantChecks ?? 0}`,
        observedAt: report.generatedAt,
        freshness,
        revision
      }
    ],
    acceptedRisks: []
  };
}

function buildDerivedSection(
  id: DossierSection["id"],
  label: string,
  required: boolean,
  status: "passed" | "failed" | "pending" | "partial" | "blocking" | "warning" | "healthy",
  artifactPath: string | undefined,
  generatedAt: string | undefined,
  details: string[],
  summaryWhenPassed: string,
  summaryWhenPending: string,
  summaryWhenFailed: string
): DossierSection {
  const freshness = evaluateFreshness(generatedAt, 1000 * 60 * 60 * 72);
  let result: DossierResult = "passed";
  if (status === "failed" || status === "blocking") {
    result = "failed";
  } else if (status === "pending" || status === "partial" || status === "warning" || freshness !== "fresh") {
    result = "pending";
  }
  return {
    id,
    label,
    required,
    result,
    summary: result === "failed" ? summaryWhenFailed : result === "pending" ? summaryWhenPending : summaryWhenPassed,
    ...(artifactPath ? { artifactPath } : {}),
    observedAt: generatedAt,
    freshness,
    details,
    evidence: artifactPath
      ? [
          {
            label,
            path: artifactPath,
            summary: `status=${status}`,
            observedAt: generatedAt,
            freshness
          }
        ]
      : [],
    acceptedRisks: []
  };
}

function buildOverallStatus(requiredFailed: string[], requiredPending: string[], acceptedRiskCount: number, exitGate: Phase1ExitEvidenceGate): DossierResult {
  if (requiredFailed.length > 0 || exitGate.result === "failed") {
    return "failed";
  }
  if (requiredPending.length > 0 || exitGate.result === "pending") {
    return "pending";
  }
  if (acceptedRiskCount > 0) {
    return "accepted_risk";
  }
  return "passed";
}

function replaceSectionArtifactPath(sections: DossierSection[], id: DossierSection["id"], artifactPath: string): DossierSection[] {
  return sections.map((section) => (section.id === id ? { ...section, artifactPath } : section));
}

function replaceSectionEvidence(
  sections: DossierSection[],
  id: DossierSection["id"],
  evidence: DossierEvidenceRef[]
): DossierSection[] {
  return sections.map((section) => (section.id === id ? { ...section, evidence } : section));
}

export function buildRuntimeObservabilityDossier(
  dossier: Phase1CandidateDossier,
  artifactPaths?: RuntimeObservabilityDossier["artifacts"]
): RuntimeObservabilityDossier {
  const runtimeSection = dossier.sections.find((section) => section.id === "runtime-health");
  const reconnectSection = dossier.sections.find((section) => section.id === "reconnect-soak");
  if (!runtimeSection || !reconnectSection) {
    fail("Phase 1 candidate dossier is missing runtime-health or reconnect-soak sections.");
  }

  const summaryStatus =
    runtimeSection.result === "failed" || reconnectSection.result === "failed"
      ? "failed"
      : runtimeSection.result === "pending" || reconnectSection.result === "pending"
        ? "pending"
        : runtimeSection.result === "accepted_risk" || reconnectSection.result === "accepted_risk"
          ? "accepted_risk"
          : "passed";
  const headline =
    summaryStatus === "failed"
      ? "Target-environment runtime observability or reconnect evidence failed for this candidate."
      : summaryStatus === "pending"
        ? "Target-environment runtime observability is partially ready, but reviewer follow-up is still required."
        : summaryStatus === "accepted_risk"
          ? "Target-environment runtime observability passed with accepted risk."
          : "Target-environment runtime observability and reconnect evidence are aligned with this candidate.";

  return {
    schemaVersion: 1,
    generatedAt: dossier.generatedAt,
    candidate: dossier.candidate,
    targetEnvironment: {
      ...(dossier.inputs.serverUrl ? { serverUrl: dossier.inputs.serverUrl } : {})
    },
    summary: {
      status: summaryStatus,
      headline,
      runtimeStatus: runtimeSection.result,
      reconnectStatus: reconnectSection.result
    },
    ...(artifactPaths ? { artifacts: artifactPaths } : {}),
    sections: [runtimeSection, reconnectSection].map((section) => ({
      id: section.id,
      label: section.label,
      result: section.result,
      summary: section.summary,
      ...(section.artifactPath ? { artifactPath: section.artifactPath } : {}),
      ...(section.observedAt ? { observedAt: section.observedAt } : {}),
      freshness: section.freshness,
      ...(section.revision ? { revision: section.revision } : {}),
      details: [...section.details],
      evidence: section.evidence.map((entry) => ({ ...entry }))
    }))
  };
}

function buildSupportingReports(
  inputs: Phase1CandidateDossier["inputs"],
  args: Args,
  revision: GitRevision
): {
  gateReport: ReturnType<typeof buildReleaseGateSummaryReport>;
  healthReport: ReturnType<typeof buildReleaseHealthSummaryReport>;
} {
  const gateReport = buildReleaseGateSummaryReport(
    {
      ...(inputs.snapshotPath ? { snapshotPath: inputs.snapshotPath } : {}),
      ...(inputs.h5SmokePath ? { h5SmokePath: inputs.h5SmokePath } : {}),
      ...(inputs.reconnectSoakPath ? { reconnectSoakPath: inputs.reconnectSoakPath } : {}),
      ...(inputs.wechatArtifactsDir ? { wechatArtifactsDir: inputs.wechatArtifactsDir } : {}),
      ...(inputs.wechatCandidateSummaryPath ? { wechatCandidateSummaryPath: inputs.wechatCandidateSummaryPath } : {}),
      ...(inputs.wechatRcValidationPath ? { wechatRcValidationPath: inputs.wechatRcValidationPath } : {}),
      ...(inputs.wechatSmokeReportPath ? { wechatSmokeReportPath: inputs.wechatSmokeReportPath } : {}),
      ...(inputs.configCenterLibraryPath ? { configCenterLibraryPath: inputs.configCenterLibraryPath } : {}),
      targetSurface: args.targetSurface
    },
    revision
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-phase1-dossier-"));
  const tempGatePath = path.join(tempDir, "release-gate-summary.json");
  writeJsonFile(tempGatePath, gateReport);

  const healthReport = buildReleaseHealthSummaryReport(
    {
      ...(inputs.snapshotPath ? { releaseReadinessPath: inputs.snapshotPath } : {}),
      releaseGateSummaryPath: tempGatePath,
      ...(inputs.ciTrendSummaryPath ? { ciTrendSummaryPath: inputs.ciTrendSummaryPath } : {}),
      ...(inputs.coverageSummaryPath ? { coverageSummaryPath: inputs.coverageSummaryPath } : {}),
      ...(inputs.syncGovernancePath ? { syncGovernancePath: inputs.syncGovernancePath } : {})
    },
    revision
  );

  return {
    gateReport,
    healthReport
  };
}

function resolveBundlePaths(args: Args, dossier: Phase1CandidateDossier): Phase1CandidateDossier["artifacts"] {
  const defaultOutputDir = path.resolve(
    DEFAULT_RELEASE_READINESS_DIR,
    `phase1-candidate-dossier-${slugify(dossier.candidate.name)}-${dossier.candidate.shortRevision}`
  );
  const outputDir = path.resolve(args.outputDir ?? defaultOutputDir);
  const dossierJsonPath = path.resolve(args.outputPath ?? path.join(outputDir, "phase1-candidate-dossier.json"));
  const dossierMarkdownPath = path.resolve(args.markdownOutputPath ?? path.join(outputDir, "phase1-candidate-dossier.md"));
  const bundleDir = path.dirname(dossierJsonPath);
  return {
    outputDir: bundleDir,
    dossierJsonPath,
    dossierMarkdownPath,
    runtimeObservabilityDossierPath: path.join(bundleDir, "runtime-observability-dossier.json"),
    runtimeObservabilityDossierMarkdownPath: path.join(bundleDir, "runtime-observability-dossier.md"),
    releaseGateSummaryPath: path.join(bundleDir, "release-gate-summary.json"),
    releaseGateMarkdownPath: path.join(bundleDir, "release-gate-summary.md"),
    releaseHealthSummaryPath: path.join(bundleDir, "release-health-summary.json"),
    releaseHealthMarkdownPath: path.join(bundleDir, "release-health-summary.md")
  };
}

export function renderRuntimeObservabilityMarkdown(dossier: RuntimeObservabilityDossier): string {
  const lines: string[] = [];
  lines.push("# Runtime Observability Dossier", "");
  lines.push(`- Generated at: \`${dossier.generatedAt}\``);
  lines.push(`- Candidate: \`${dossier.candidate.name}\``);
  lines.push(`- Revision: \`${dossier.candidate.revision}\``);
  lines.push(`- Branch: \`${dossier.candidate.branch}\``);
  lines.push(`- Target surface: \`${dossier.candidate.targetSurface}\``);
  lines.push(`- Target environment: \`${dossier.targetEnvironment.serverUrl ?? "<missing>"}\``);
  lines.push(`- Overall status: **${dossier.summary.status.toUpperCase()}**`);
  lines.push(`- Headline: ${dossier.summary.headline}`);
  lines.push(`- Runtime endpoint status: \`${dossier.summary.runtimeStatus}\``);
  lines.push(`- Reconnect/session-recovery status: \`${dossier.summary.reconnectStatus}\``, "");

  if (dossier.artifacts) {
    lines.push("## Generated Bundle", "");
    lines.push(`- JSON: \`${relativeArtifactPath(dossier.artifacts.jsonPath)}\``);
    lines.push(`- Markdown: \`${relativeArtifactPath(dossier.artifacts.markdownPath)}\``, "");
  }

  lines.push("## Evidence Summary", "");
  for (const section of dossier.sections) {
    lines.push(`### ${section.label}`, "");
    lines.push(`- Result: \`${section.result}\``);
    lines.push(`- Summary: ${section.summary}`);
    lines.push(`- Freshness: \`${section.freshness}\``);
    if (section.observedAt) {
      lines.push(`- Observed at: \`${section.observedAt}\``);
    }
    if (section.revision) {
      lines.push(`- Revision: \`${section.revision}\``);
    }
    if (section.artifactPath) {
      lines.push(`- Artifact: \`${relativeArtifactPath(section.artifactPath)}\``);
    }
    if (section.details.length > 0) {
      lines.push("- Details:");
      for (const detail of section.details) {
        lines.push(`  - ${detail}`);
      }
    }
    if (section.evidence.length > 0) {
      lines.push("- Evidence:");
      for (const entry of section.evidence) {
        const extras = [entry.observedAt ? `observedAt=${entry.observedAt}` : "", entry.revision ? `revision=${entry.revision}` : "", `freshness=${entry.freshness}`]
          .filter((value) => value.length > 0)
          .join(" ");
        lines.push(`  - ${entry.label}: \`${entry.path}\` (${entry.summary}${extras ? `; ${extras}` : ""})`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function buildPhase1ExitEvidenceGateSection(sections: DossierSection[], generatedAt: string | undefined): {
  section: DossierSection;
  gate: Phase1ExitEvidenceGate;
} {
  const scopedSections = sections.filter((section) => section.id !== "release-health");
  const blockingSections = scopedSections.filter((section) => section.result === "failed").map((section) => section.label);
  const pendingSections = scopedSections.filter((section) => section.result === "pending").map((section) => section.label);
  const acceptedRiskSections = scopedSections.filter((section) => section.result === "accepted_risk").map((section) => section.label);
  const details = [
    ...blockingSections.map((label) => `blocking: ${label}`),
    ...pendingSections.map((label) => `pending: ${label}`),
    ...acceptedRiskSections.map((label) => `accepted risk: ${label}`)
  ];
  const freshness = evaluateFreshness(generatedAt, 1000 * 60 * 60 * 72);
  let result: DossierResult = "passed";
  if (blockingSections.length > 0) {
    result = "failed";
  } else if (pendingSections.length > 0 || freshness !== "fresh") {
    result = "pending";
  } else if (acceptedRiskSections.length > 0) {
    result = "accepted_risk";
  }

  const summary =
    result === "failed"
      ? `Candidate-level Phase 1 exit evidence is blocked by ${blockingSections.join(", ")}.`
      : result === "pending"
        ? pendingSections.length > 0
          ? `Candidate-level Phase 1 exit evidence is still pending for ${pendingSections.join(", ")}.`
          : "Candidate-level Phase 1 exit evidence needs a fresh gate sample."
        : result === "accepted_risk"
          ? `Candidate-level Phase 1 exit evidence passed with accepted risks in ${acceptedRiskSections.join(", ")}.`
          : "Candidate-level Phase 1 exit evidence is current for this revision.";

  return {
    section: {
      id: "phase1-exit-evidence-gate",
      label: "Phase 1 exit evidence gate",
      required: true,
      result,
      summary,
      observedAt: generatedAt,
      freshness,
      details,
      evidence: [],
      acceptedRisks: []
    },
    gate: {
      result,
      summary,
      blockingSections,
      pendingSections,
      acceptedRiskSections
    }
  };
}

export function renderMarkdown(dossier: Phase1CandidateDossier): string {
  const lines: string[] = [];
  lines.push("# Phase 1 Candidate Dossier", "");
  lines.push(`- Generated at: \`${dossier.generatedAt}\``);
  lines.push(`- Candidate: \`${dossier.candidate.name}\``);
  lines.push(`- Revision: \`${dossier.candidate.revision}\``);
  lines.push(`- Branch: \`${dossier.candidate.branch}\``);
  lines.push(`- Git tree: \`${dossier.candidate.dirty ? "dirty" : "clean"}\``);
  lines.push(`- Target surface: \`${dossier.candidate.targetSurface}\``);
  lines.push(`- Overall status: **${dossier.summary.status.toUpperCase()}**`);
  lines.push(`- Required failed: ${dossier.summary.requiredFailed.length}`);
  lines.push(`- Required pending: ${dossier.summary.requiredPending.length}`);
  lines.push(`- Phase 1 exit evidence gate: \`${dossier.phase1ExitEvidenceGate.result}\``);
  lines.push(`- Phase 1 exit summary: ${dossier.phase1ExitEvidenceGate.summary}`);
  lines.push(`- Accepted risks: ${dossier.summary.acceptedRiskCount}`, "");

  lines.push("## Selected Inputs", "");
  lines.push(`- Runtime server: \`${dossier.inputs.serverUrl ?? "<missing>"}\``);
  lines.push(`- Release readiness snapshot: \`${dossier.inputs.snapshotPath ? relativeArtifactPath(dossier.inputs.snapshotPath) : "<missing>"}\``);
  lines.push(`- H5 smoke: \`${dossier.inputs.h5SmokePath ? relativeArtifactPath(dossier.inputs.h5SmokePath) : "<missing>"}\``);
  lines.push(`- Cocos RC bundle: \`${dossier.inputs.cocosBundlePath ? relativeArtifactPath(dossier.inputs.cocosBundlePath) : "<missing>"}\``);
  lines.push(`- WeChat artifacts dir: \`${dossier.inputs.wechatArtifactsDir ? relativeArtifactPath(dossier.inputs.wechatArtifactsDir) : "<missing>"}\``);
  lines.push(
    `- WeChat candidate summary: \`${dossier.inputs.wechatCandidateSummaryPath ? relativeArtifactPath(dossier.inputs.wechatCandidateSummaryPath) : "<missing>"}\``
  );
  lines.push(`- WeChat RC validation: \`${dossier.inputs.wechatRcValidationPath ? relativeArtifactPath(dossier.inputs.wechatRcValidationPath) : "<missing>"}\``);
  lines.push(`- WeChat smoke fallback: \`${dossier.inputs.wechatSmokeReportPath ? relativeArtifactPath(dossier.inputs.wechatSmokeReportPath) : "<missing>"}\``);
  lines.push(`- Reconnect soak: \`${dossier.inputs.reconnectSoakPath ? relativeArtifactPath(dossier.inputs.reconnectSoakPath) : "<missing>"}\``);
  lines.push(`- Phase 1 persistence: \`${dossier.inputs.persistencePath ? relativeArtifactPath(dossier.inputs.persistencePath) : "<missing>"}\``);
  lines.push(`- Sync governance: \`${dossier.inputs.syncGovernancePath ? relativeArtifactPath(dossier.inputs.syncGovernancePath) : "<missing>"}\``);
  lines.push(`- CI trend summary: \`${dossier.inputs.ciTrendSummaryPath ? relativeArtifactPath(dossier.inputs.ciTrendSummaryPath) : "<missing>"}\``);
  lines.push(`- Coverage summary: \`${dossier.inputs.coverageSummaryPath ? relativeArtifactPath(dossier.inputs.coverageSummaryPath) : "<missing>"}\``);
  lines.push(`- Config audit: \`${dossier.inputs.configCenterLibraryPath ? relativeArtifactPath(dossier.inputs.configCenterLibraryPath) : "<missing>"}\``, "");

  if (dossier.artifacts) {
    lines.push("## Generated Bundle", "");
    lines.push(`- Output dir: \`${relativeArtifactPath(dossier.artifacts.outputDir)}\``);
    lines.push(`- Dossier JSON: \`${relativeArtifactPath(dossier.artifacts.dossierJsonPath)}\``);
    lines.push(`- Dossier Markdown: \`${relativeArtifactPath(dossier.artifacts.dossierMarkdownPath)}\``);
    lines.push(`- Runtime observability dossier JSON: \`${relativeArtifactPath(dossier.artifacts.runtimeObservabilityDossierPath)}\``);
    lines.push(`- Runtime observability dossier Markdown: \`${relativeArtifactPath(dossier.artifacts.runtimeObservabilityDossierMarkdownPath)}\``);
    lines.push(`- Release gate summary JSON: \`${relativeArtifactPath(dossier.artifacts.releaseGateSummaryPath)}\``);
    lines.push(`- Release gate summary Markdown: \`${relativeArtifactPath(dossier.artifacts.releaseGateMarkdownPath)}\``);
    lines.push(`- Release health summary JSON: \`${relativeArtifactPath(dossier.artifacts.releaseHealthSummaryPath)}\``);
    lines.push(`- Release health summary Markdown: \`${relativeArtifactPath(dossier.artifacts.releaseHealthMarkdownPath)}\``, "");
  }

  lines.push("## Phase 1 Exit Evidence Gate", "");
  lines.push(`- Result: \`${dossier.phase1ExitEvidenceGate.result}\``);
  lines.push(`- Summary: ${dossier.phase1ExitEvidenceGate.summary}`);
  if (dossier.phase1ExitEvidenceGate.blockingSections.length > 0) {
    lines.push(`- Blocking sections: ${dossier.phase1ExitEvidenceGate.blockingSections.join(", ")}`);
  }
  if (dossier.phase1ExitEvidenceGate.pendingSections.length > 0) {
    lines.push(`- Pending sections: ${dossier.phase1ExitEvidenceGate.pendingSections.join(", ")}`);
  }
  if (dossier.phase1ExitEvidenceGate.acceptedRiskSections.length > 0) {
    lines.push(`- Accepted-risk sections: ${dossier.phase1ExitEvidenceGate.acceptedRiskSections.join(", ")}`);
  }
  lines.push("");

  lines.push("## Section Summary", "");
  for (const section of dossier.sections) {
    lines.push(
      `- ${section.label}: \`${section.result}\`${section.required ? " required" : " advisory"}${section.freshness !== "unknown" ? ` · freshness=${section.freshness}` : ""}${section.revision ? ` · revision=${section.revision}` : ""}`
    );
    lines.push(`  Summary: ${section.summary}`);
    if (section.artifactPath) {
      lines.push(`  Artifact: \`${relativeArtifactPath(section.artifactPath)}\``);
    }
  }
  lines.push("");

  lines.push("## Required Findings", "");
  if (dossier.summary.requiredFailed.length === 0 && dossier.summary.requiredPending.length === 0) {
    lines.push("- None.");
  } else {
    for (const entry of dossier.summary.requiredFailed) {
      lines.push(`- FAILED: ${entry}`);
    }
    for (const entry of dossier.summary.requiredPending) {
      lines.push(`- PENDING: ${entry}`);
    }
  }
  lines.push("");

  lines.push("## Accepted Risks", "");
  if (dossier.acceptedRisks.length === 0) {
    lines.push("- None.");
  } else {
    for (const risk of dossier.acceptedRisks) {
      const metadata = [risk.approvedBy ? `approvedBy=${risk.approvedBy}` : "", risk.approvedAt ? `approvedAt=${risk.approvedAt}` : ""]
        .filter((value) => value.length > 0)
        .join(" ");
      lines.push(`- ${risk.label}: ${risk.reason}${metadata ? ` (${metadata})` : ""}`);
    }
  }
  lines.push("");

  lines.push("## Details", "");
  for (const section of dossier.sections) {
    lines.push(`### ${section.label}`, "");
    lines.push(`- Result: \`${section.result}\``);
    lines.push(`- Required: ${section.required ? "yes" : "no"}`);
    lines.push(`- Freshness: \`${section.freshness}\``);
    if (section.observedAt) {
      lines.push(`- Observed at: \`${section.observedAt}\``);
    }
    if (section.revision) {
      lines.push(`- Revision: \`${section.revision}\``);
    }
    if (section.artifactPath) {
      lines.push(`- Artifact: \`${relativeArtifactPath(section.artifactPath)}\``);
    }
    lines.push(`- Summary: ${section.summary}`);
    if (section.details.length > 0) {
      lines.push("- Details:");
      for (const detail of section.details) {
        lines.push(`  - ${detail}`);
      }
    }
    if (section.evidence.length > 0) {
      lines.push("- Evidence:");
      for (const entry of section.evidence) {
        const extras = [entry.observedAt ? `observedAt=${entry.observedAt}` : "", entry.revision ? `revision=${entry.revision}` : "", `freshness=${entry.freshness}`]
          .filter((value) => value.length > 0)
          .join(" ");
        lines.push(`  - ${entry.label}: \`${entry.path}\` (${entry.summary}${extras ? `; ${extras}` : ""})`);
      }
    }
    if (section.acceptedRisks.length > 0) {
      lines.push("- Accepted risks:");
      for (const risk of section.acceptedRisks) {
        lines.push(`  - ${risk.label}: ${risk.reason}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export async function buildPhase1CandidateDossier(args: Args): Promise<Phase1CandidateDossier> {
  const revision = getRevision(args.candidateRevision);
  const inputs = resolveInputPaths(args);
  const maxAgeMs = args.maxEvidenceAgeHours * 60 * 60 * 1000;

  const snapshotSection = buildSnapshotSection(inputs.snapshotPath, revision.commit, maxAgeMs);
  const cocosSection = buildCocosSection(inputs.cocosBundlePath, revision.commit, maxAgeMs);
  const wechatSection = buildWechatSection(
    args.targetSurface,
    inputs.wechatCandidateSummaryPath,
    inputs.wechatRcValidationPath,
    inputs.wechatSmokeReportPath,
    revision.commit,
    maxAgeMs
  );
  const runtimeSection = await buildRuntimeSection(args.targetSurface, inputs.serverUrl, maxAgeMs);
  const reconnectSoakSection = buildReconnectSoakSection(inputs.reconnectSoakPath, revision.commit, maxAgeMs);
  const persistenceSection = buildPersistenceSection(inputs.persistencePath, revision.commit, maxAgeMs);

  const { gateReport, healthReport } = buildSupportingReports(inputs, args, revision);

  const releaseGateSection = buildDerivedSection(
    "release-gate",
    "Release gate summary",
    false,
    gateReport.summary.status,
    undefined,
    gateReport.generatedAt,
    gateReport.gates.filter((gate) => gate.status === "failed").flatMap((gate) => gate.failures.length > 0 ? gate.failures : [gate.summary]),
    "Unified release gate summary passed.",
    "Unified release gate summary still has pending/stale evidence.",
    "Unified release gate summary failed."
  );
  const releaseHealthSection = buildDerivedSection(
    "release-health",
    "Release health summary",
    false,
    healthReport.summary.status,
    undefined,
    healthReport.generatedAt,
    [
      `blockers=${healthReport.summary.blockerCount}`,
      `warnings=${healthReport.summary.warningCount}`,
      ...healthReport.triage.blockers.map((entry) => entry.summary),
      ...healthReport.triage.warnings.map((entry) => entry.summary)
    ],
    "Release health summary is healthy.",
    "Release health summary raised warnings.",
    "Release health summary is blocking."
  );
  const { section: phase1ExitEvidenceGateSection, gate: phase1ExitEvidenceGate } = buildPhase1ExitEvidenceGateSection(
    [snapshotSection, cocosSection, wechatSection, runtimeSection, reconnectSoakSection, persistenceSection, releaseGateSection],
    gateReport.generatedAt
  );

  const sections: DossierSection[] = [
    phase1ExitEvidenceGateSection,
    snapshotSection,
    cocosSection,
    wechatSection,
    runtimeSection,
    reconnectSoakSection,
    persistenceSection,
    releaseGateSection,
    releaseHealthSection
  ];
  const requiredFailed = sections.filter((section) => section.required && section.result === "failed").map((section) => section.label);
  const requiredPending = sections.filter((section) => section.required && section.result === "pending").map((section) => section.label);
  const acceptedRisks = sections.flatMap((section) => section.acceptedRisks);
  const freshnessSummary: Record<EvidenceFreshness, number> = {
    fresh: 0,
    stale: 0,
    missing_timestamp: 0,
    invalid_timestamp: 0,
    unknown: 0
  };
  for (const section of sections) {
    freshnessSummary[section.freshness] += 1;
  }

  const candidateName =
    args.candidate?.trim() ||
    (cocosSection.artifactPath && fs.existsSync(cocosSection.artifactPath)
      ? readJsonFile<CocosBundleManifest>(cocosSection.artifactPath).bundle?.candidate?.trim()
      : "") ||
    revision.shortCommit;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: candidateName,
      revision: revision.commit,
      shortRevision: revision.shortCommit,
      branch: revision.branch,
      dirty: revision.dirty,
      targetSurface: args.targetSurface
    },
    summary: {
      status: buildOverallStatus(requiredFailed, requiredPending, acceptedRisks.length, phase1ExitEvidenceGate),
      totalSections: sections.length,
      requiredFailed,
      requiredPending,
      acceptedRiskCount: acceptedRisks.length,
      freshness: freshnessSummary
    },
    phase1ExitEvidenceGate,
    inputs,
    sections,
    acceptedRisks
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const revision = getRevision(args.candidateRevision);
  const inputs = resolveInputPaths(args);
  const { gateReport, healthReport } = buildSupportingReports(inputs, args, revision);
  let dossier = await buildPhase1CandidateDossier(args);
  const artifacts = resolveBundlePaths(args, dossier);
  const runtimeObservabilityDossier = buildRuntimeObservabilityDossier(dossier, {
    jsonPath: artifacts.runtimeObservabilityDossierPath,
    markdownPath: artifacts.runtimeObservabilityDossierMarkdownPath
  });

  writeJsonFile(artifacts.releaseGateSummaryPath, gateReport);
  writeFile(artifacts.releaseGateMarkdownPath, renderReleaseGateMarkdown(gateReport));
  writeJsonFile(artifacts.releaseHealthSummaryPath, healthReport);
  writeFile(artifacts.releaseHealthMarkdownPath, renderReleaseHealthMarkdown(healthReport));
  writeJsonFile(artifacts.runtimeObservabilityDossierPath, runtimeObservabilityDossier);
  writeFile(artifacts.runtimeObservabilityDossierMarkdownPath, renderRuntimeObservabilityMarkdown(runtimeObservabilityDossier));

  dossier = {
    ...dossier,
    artifacts,
    sections: replaceSectionEvidence(
      replaceSectionEvidence(
        replaceSectionArtifactPath(
          replaceSectionArtifactPath(dossier.sections, "release-gate", artifacts.releaseGateSummaryPath),
          "release-health",
          artifacts.releaseHealthSummaryPath
        ),
        "release-gate",
        [
          {
            label: "Release gate summary",
            path: artifacts.releaseGateSummaryPath,
            summary: `status=${gateReport.summary.status}`,
            observedAt: gateReport.generatedAt,
            freshness: evaluateFreshness(gateReport.generatedAt, 1000 * 60 * 60 * 72)
          },
          {
            label: "Release gate summary markdown",
            path: artifacts.releaseGateMarkdownPath,
            summary: "Reviewer-facing release gate summary markdown.",
            observedAt: gateReport.generatedAt,
            freshness: evaluateFreshness(gateReport.generatedAt, 1000 * 60 * 60 * 72)
          }
        ]
      ),
      "release-health",
      [
        {
          label: "Release health summary",
          path: artifacts.releaseHealthSummaryPath,
          summary: `status=${healthReport.summary.status}`,
          observedAt: healthReport.generatedAt,
          freshness: evaluateFreshness(healthReport.generatedAt, 1000 * 60 * 60 * 72)
        },
        {
          label: "Release health summary markdown",
          path: artifacts.releaseHealthMarkdownPath,
          summary: "Reviewer-facing release health summary markdown.",
          observedAt: healthReport.generatedAt,
          freshness: evaluateFreshness(healthReport.generatedAt, 1000 * 60 * 60 * 72)
        }
      ]
    )
  };

  writeJsonFile(artifacts.dossierJsonPath, dossier);
  writeFile(artifacts.dossierMarkdownPath, renderMarkdown(dossier));

  console.log(`Wrote Phase 1 candidate dossier bundle: ${path.relative(process.cwd(), artifacts.outputDir).replace(/\\/g, "/")}`);
  console.log(`Wrote Phase 1 candidate dossier JSON: ${path.relative(process.cwd(), artifacts.dossierJsonPath).replace(/\\/g, "/")}`);
  console.log(`Wrote Phase 1 candidate dossier Markdown: ${path.relative(process.cwd(), artifacts.dossierMarkdownPath).replace(/\\/g, "/")}`);
  console.log(`Wrote runtime observability dossier JSON: ${path.relative(process.cwd(), artifacts.runtimeObservabilityDossierPath).replace(/\\/g, "/")}`);
  console.log(`Wrote release gate summary JSON: ${path.relative(process.cwd(), artifacts.releaseGateSummaryPath).replace(/\\/g, "/")}`);
  console.log(`Wrote release health summary JSON: ${path.relative(process.cwd(), artifacts.releaseHealthSummaryPath).replace(/\\/g, "/")}`);
  console.log(`Candidate: ${dossier.candidate.name}`);
  console.log(`Revision: ${dossier.candidate.revision}`);
  console.log(`Overall status: ${dossier.summary.status}`);
  console.log(`Required failed: ${dossier.summary.requiredFailed.length}`);
  console.log(`Required pending: ${dossier.summary.requiredPending.length}`);
  const acceptedRisks = dossier.acceptedRisks;
  if (acceptedRisks.length > 0) {
    for (const line of summarizeRiskList(acceptedRisks)) {
      console.log(`Accepted risk: ${line}`);
    }
  }

  if (dossier.summary.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
    .then(() => {
      process.exit(process.exitCode ?? 0);
    })
    .catch((error) => {
      console.error(`Phase 1 candidate dossier failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
