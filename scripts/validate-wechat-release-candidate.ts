import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseManualCheckArg, parseManualChecksFile } from "./release-readiness-snapshot.ts";

type CheckStatus = "passed" | "failed" | "skipped";
type GateStatus = "passed" | "failed";
type CandidateStatus = "ready" | "blocked";
type EvidenceFreshness = "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp";
type SmokeExecutionResult = "pending" | "blocked" | "passed" | "failed";
type SmokeStatus = "pending" | "blocked" | "passed" | "failed" | "not_applicable";

interface ReconnectRecoveryEvidence {
  roomId: string;
  reconnectPrompt: string;
  restoredState: string;
}

interface ShareRoundtripEvidence {
  shareScene: string;
  shareQuery: string;
  roundtripState: string;
}

interface Args {
  artifactsDir?: string;
  archivePath?: string;
  metadataPath?: string;
  reportPath?: string;
  summaryPath?: string;
  markdownPath?: string;
  expectedRevision?: string;
  version?: string;
  smokeReportPath?: string;
  uploadReceiptPath?: string;
  manualChecksPath?: string;
  manualChecks: string[];
  requireSmokeReport: boolean;
}

interface WechatMinigameReleasePackageMetadata {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  projectName: string;
  appId: string;
  archiveFileName: string;
  archiveBytes: number;
  archiveSha256: string;
  releaseManifestFile: string;
  exportedBuildDir: string;
  packagedBuildDir: string;
  fileCount: number;
  sourceRevision?: string;
  runtimeRemoteUrl?: string;
  remoteAssetRoot?: string;
}

interface UploadReceipt {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  projectName: string;
  artifactArchiveFileName: string;
  artifactArchiveSha256: string;
  artifactMetadataPath: string;
  sourceRevision?: string;
  uploadVersion: string;
  uploadDescription: string;
  uploadAppId: string;
  artifactAppId: string;
  usedAppIdOverride: boolean;
  uploadRobot: number;
  uploadedAt: string;
}

interface WechatMinigameSmokeCase {
  id: "login-lobby" | "room-entry" | "reconnect-recovery" | "share-roundtrip" | "key-assets";
  title: string;
  status: SmokeStatus;
  required: boolean;
  notes: string;
  evidence: string[];
  steps: string[];
  requiredEvidence?: ReconnectRecoveryEvidence | ShareRoundtripEvidence;
}

interface WechatMinigameSmokeReport {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  projectName: string;
  appId: string;
  artifact: {
    archiveFileName: string;
    archiveSha256: string;
    artifactsDir?: string;
    metadataPath: string;
    sourceRevision?: string;
    runtimeRemoteUrl?: string;
    remoteAssetRoot?: string;
  };
  execution: {
    tester: string;
    device: string;
    clientVersion: string;
    executedAt: string;
    result: SmokeExecutionResult;
    summary: string;
  };
  cases: WechatMinigameSmokeCase[];
}

interface ValidationCheck {
  id: string;
  title: string;
  status: CheckStatus;
  required: boolean;
  summary: string;
  artifactPath?: string;
  command?: string;
  exitCode?: number | null;
  stdoutTail?: string;
  stderrTail?: string;
}

interface ValidationReport {
  schemaVersion: 1;
  generatedAt: string;
  version: string | null;
  commit: string | null;
  artifact: {
    artifactsDir?: string;
    archivePath: string;
    metadataPath: string;
    smokeReportPath?: string;
    uploadReceiptPath?: string;
  };
  summary: {
    status: GateStatus;
    totalChecks: number;
    failedChecks: number;
    failureSummary: string[];
  };
  checks: ValidationCheck[];
}

interface ManualReviewCheck {
  id: string;
  title: string;
  required: boolean;
  status: "passed" | "failed" | "pending" | "not_applicable";
  notes: string;
  evidence: string[];
  source: "default" | "file" | "cli";
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  blockerIds?: string[];
  waiver?: {
    approvedBy?: string;
    approvedAt?: string;
    reason?: string;
    expiresAt?: string;
  };
}

interface CandidateSummary {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    revision: string | null;
    version: string | null;
    projectName: string;
    appId: string;
    status: CandidateStatus;
  };
  artifacts: {
    artifactsDir?: string;
    archivePath: string;
    metadataPath: string;
    validationReportPath: string;
    summaryPath: string;
    smokeReportPath: string;
    uploadReceiptPath: string;
    markdownPath: string;
  };
  evidence: {
    package: {
      status: CheckStatus;
      summary: string;
      artifactPath: string;
    };
    validation: {
      status: CheckStatus;
      summary: string;
      artifactPath: string;
    };
    smoke: {
      status: CheckStatus;
      summary: string;
      artifactPath: string;
    };
    deviceRuntime: {
      status: CandidateStatus;
      freshness: EvidenceFreshness;
      artifactPath: string;
      execution: {
        tester: string;
        device: string;
        clientVersion: string;
        executedAt: string;
        result: SmokeExecutionResult;
        summary: string;
      };
      cases: WechatMinigameSmokeCase[];
    } | null;
    upload: {
      status: CheckStatus;
      summary: string;
      artifactPath: string;
    };
    manualReview: {
      status: CandidateStatus;
      totalChecks: number;
      completedChecks: number;
      requiredPendingChecks: number;
      requiredFailedChecks: number;
      requiredMetadataFailures: number;
      checks: ManualReviewCheck[];
    };
  };
  blockers: Array<{
    id: string;
    summary: string;
    artifactPath?: string;
    nextCommand?: string;
  }>;
}

const OUTPUT_TAIL_BYTES = 4000;
const MANUAL_REVIEW_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const AUTO_MANUAL_CHECK_FILENAMES = [
  "codex.wechat.manual-review.json",
  "wechat-manual-review.json",
  "wechat-manual-checks.json"
] as const;
const DEFAULT_MANUAL_CHECKS: ManualReviewCheck[] = [
  {
    id: "wechat-devtools-export-review",
    title: "Candidate-scoped WeChat package install/launch verification recorded",
    required: true,
    status: "pending",
    notes:
      "Generate and attach the candidate-scoped WeChat package install/launch verification artifact for the same revision. Keep this check pending while evidence is missing, and mark it failed if install/import or first launch regressed.",
    evidence: [
      "artifacts/wechat-release/codex.wechat.install-launch-evidence.json",
      "artifacts/wechat-release/codex.wechat.install-launch-evidence.md"
    ],
    source: "default"
  },
  {
    id: "wechat-device-runtime-review",
    title: "Physical-device WeChat runtime validated for this candidate",
    required: true,
    status: "pending",
    notes: "Attach the smoke report and supporting captures from a physical-device or WeChat real-device-debugging runtime pass against the same candidate revision.",
    evidence: [
      "artifacts/wechat-release/codex.wechat.smoke-report.json",
      "login-lobby capture",
      "room-entry capture",
      "reconnect-recovery capture",
      "share-roundtrip capture",
      "key-assets capture"
    ],
    source: "default"
  },
  {
    id: "wechat-runtime-observability-signoff",
    title: "WeChat runtime observability reviewed for this candidate",
    required: true,
    status: "pending",
    notes:
      "Attach the same-revision runtime observability review for the release environment, including /api/runtime/health, /api/runtime/diagnostic-snapshot, and /api/runtime/metrics evidence plus any approved follow-ups.",
    evidence: [
      "artifacts/wechat-release/runtime-observability-signoff.json",
      "/api/runtime/health payload",
      "/api/runtime/diagnostic-snapshot capture",
      "/api/runtime/metrics scrape or export"
    ],
    source: "default"
  },
  {
    id: "wechat-release-checklist",
    title: "WeChat RC checklist and blockers reviewed",
    required: true,
    status: "pending",
    notes: "Attach the completed RC checklist and blocker register for the same packaged candidate.",
    evidence: [
      "docs/release-evidence/cocos-wechat-rc-checklist.template.md",
      "docs/release-evidence/cocos-wechat-rc-blockers.template.md"
    ],
    source: "default"
  }
];

const USAGE = [
  "Usage: npm run validate -- wechat-rc -- --artifacts-dir <release-artifacts-dir>",
  "   or: npm run validate -- wechat-rc -- --archive <tar.gz> --metadata <package.json>"
].join("\n");

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let artifactsDir: string | undefined;
  let archivePath: string | undefined;
  let metadataPath: string | undefined;
  let reportPath: string | undefined;
  let summaryPath: string | undefined;
  let markdownPath: string | undefined;
  let expectedRevision: string | undefined;
  let version: string | undefined;
  let smokeReportPath: string | undefined;
  let uploadReceiptPath: string | undefined;
  let manualChecksPath: string | undefined;
  const manualChecks: string[] = [];
  let requireSmokeReport = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--artifacts-dir" && next) {
      artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--archive" && next) {
      archivePath = next;
      index += 1;
      continue;
    }
    if (arg === "--metadata" && next) {
      metadataPath = next;
      index += 1;
      continue;
    }
    if (arg === "--report" && next) {
      reportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--summary" && next) {
      summaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--markdown" && next) {
      markdownPath = next;
      index += 1;
      continue;
    }
    if (arg === "--expected-revision" && next) {
      expectedRevision = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--version" && next) {
      version = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--smoke-report" && next) {
      smokeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--upload-receipt" && next) {
      uploadReceiptPath = next;
      index += 1;
      continue;
    }
    if (arg === "--manual-checks" && next) {
      manualChecksPath = next;
      index += 1;
      continue;
    }
    if (arg === "--manual-check" && next) {
      manualChecks.push(next);
      index += 1;
      continue;
    }
    if (arg === "--require-smoke-report") {
      requireSmokeReport = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(artifactsDir ? { artifactsDir } : {}),
    ...(archivePath ? { archivePath } : {}),
    ...(metadataPath ? { metadataPath } : {}),
    ...(reportPath ? { reportPath } : {}),
    ...(summaryPath ? { summaryPath } : {}),
    ...(markdownPath ? { markdownPath } : {}),
    ...(expectedRevision ? { expectedRevision } : {}),
    ...(version ? { version } : {}),
    ...(smokeReportPath ? { smokeReportPath } : {}),
    ...(uploadReceiptPath ? { uploadReceiptPath } : {}),
    ...(manualChecksPath ? { manualChecksPath } : {}),
    manualChecks,
    requireSmokeReport
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function tailText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > OUTPUT_TAIL_BYTES ? normalized.slice(-OUTPUT_TAIL_BYTES) : normalized;
}

function resolveArtifactsFromDirectory(artifactsDir: string): { artifactsDir: string; archivePath: string; metadataPath: string } {
  const resolvedArtifactsDir = path.resolve(artifactsDir);
  if (!fs.existsSync(resolvedArtifactsDir)) {
    fail(`Artifacts directory does not exist: ${resolvedArtifactsDir}`);
  }

  const entries = fs.readdirSync(resolvedArtifactsDir);
  const archives = entries.filter((entry) => entry.endsWith(".tar.gz")).sort();
  const sidecars = entries.filter((entry) => entry.endsWith(".package.json")).sort();
  if (archives.length !== 1) {
    fail(`Expected exactly one release archive in ${resolvedArtifactsDir}, found ${archives.length}.`);
  }
  if (sidecars.length !== 1) {
    fail(`Expected exactly one release sidecar in ${resolvedArtifactsDir}, found ${sidecars.length}.`);
  }

  const archiveFileName = archives[0];
  const sidecarFileName = sidecars[0];
  if (!archiveFileName || !sidecarFileName) {
    fail(`Unable to resolve release archive and sidecar in ${resolvedArtifactsDir}.`);
  }

  return {
    artifactsDir: resolvedArtifactsDir,
    archivePath: path.join(resolvedArtifactsDir, archiveFileName),
    metadataPath: path.join(resolvedArtifactsDir, sidecarFileName)
  };
}

function resolveArtifacts(args: Args): { artifactsDir?: string; archivePath: string; metadataPath: string } {
  if (args.artifactsDir) {
    return resolveArtifactsFromDirectory(args.artifactsDir);
  }
  if (!args.archivePath || !args.metadataPath) {
    fail(`Pass either --artifacts-dir <dir> or both --archive <tar.gz> and --metadata <package.json>.\n${USAGE}`);
  }

  return {
    archivePath: path.resolve(args.archivePath),
    metadataPath: path.resolve(args.metadataPath)
  };
}

function defaultReportPath(artifactsDir: string | undefined, metadataPath: string): string {
  if (artifactsDir) {
    return path.join(artifactsDir, "codex.wechat.rc-validation-report.json");
  }
  return path.join(path.dirname(metadataPath), "codex.wechat.rc-validation-report.json");
}

function defaultSummaryPath(artifactsDir: string | undefined, metadataPath: string): string {
  const baseDir = artifactsDir ?? path.dirname(metadataPath);
  return path.join(baseDir, "codex.wechat.release-candidate-summary.json");
}

function defaultMarkdownPath(artifactsDir: string | undefined, metadataPath: string): string {
  const baseDir = artifactsDir ?? path.dirname(metadataPath);
  return path.join(baseDir, "codex.wechat.release-candidate-summary.md");
}

function validatePackageMetadataShape(metadata: WechatMinigameReleasePackageMetadata, archivePath: string): void {
  if (metadata.schemaVersion !== 1) {
    fail(`Release sidecar schemaVersion must be 1, received ${JSON.stringify(metadata.schemaVersion)}.`);
  }
  if (metadata.buildTemplatePlatform !== "wechatgame") {
    fail(
      `Release sidecar buildTemplatePlatform must be "wechatgame", received ${JSON.stringify(metadata.buildTemplatePlatform)}.`
    );
  }
  if (!metadata.projectName?.trim()) {
    fail("Release sidecar is missing projectName.");
  }
  if (!metadata.appId?.trim()) {
    fail("Release sidecar is missing appId.");
  }
  if (!metadata.archiveFileName?.trim()) {
    fail("Release sidecar is missing archiveFileName.");
  }
  if (!metadata.archiveSha256 || !/^[a-f0-9]{64}$/.test(metadata.archiveSha256)) {
    fail("Release sidecar archiveSha256 must be a 64-character lowercase hex string.");
  }
  if (!Number.isFinite(metadata.archiveBytes) || metadata.archiveBytes <= 0) {
    fail(`Release sidecar archiveBytes must be a positive number, received ${JSON.stringify(metadata.archiveBytes)}.`);
  }
  if (!metadata.releaseManifestFile?.trim()) {
    fail("Release sidecar is missing releaseManifestFile.");
  }
  if (!metadata.packagedBuildDir?.trim()) {
    fail("Release sidecar is missing packagedBuildDir.");
  }
  if (!Number.isInteger(metadata.fileCount) || metadata.fileCount <= 0) {
    fail(`Release sidecar fileCount must be a positive integer, received ${JSON.stringify(metadata.fileCount)}.`);
  }
  if (path.basename(archivePath) !== metadata.archiveFileName) {
    fail(`Release sidecar archiveFileName mismatch: ${metadata.archiveFileName} !== ${path.basename(archivePath)}`);
  }
}

function resolveOptionalArtifactPath(explicitPath: string | undefined, fallbackPath: string): string | undefined {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return fs.existsSync(fallbackPath) ? fallbackPath : undefined;
}

function resolveAutoManualChecksPath(args: Args): string | undefined {
  if (args.manualChecksPath || args.manualChecks.length > 0) {
    return undefined;
  }

  const candidateRoots = new Set<string>();
  if (args.artifactsDir) {
    candidateRoots.add(path.resolve(args.artifactsDir));
  }
  if (args.metadataPath) {
    candidateRoots.add(path.dirname(path.resolve(args.metadataPath)));
  }

  for (const root of candidateRoots) {
    for (const filename of AUTO_MANUAL_CHECK_FILENAMES) {
      const candidatePath = path.join(root, filename);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return undefined;
}

function readManualChecks(args: Args): ManualReviewCheck[] {
  const manualChecksPath = args.manualChecksPath ?? resolveAutoManualChecksPath(args);

  if (!manualChecksPath && args.manualChecks.length === 0) {
    return DEFAULT_MANUAL_CHECKS.map((check) => ({ ...check, evidence: [...check.evidence] }));
  }

  const fromFile = manualChecksPath
    ? parseManualChecksFile(manualChecksPath).map((check) => ({
        id: check.id,
        title: check.title,
        required: check.required,
        status: check.status,
        notes: check.notes,
        evidence: [...check.evidence],
        source: "file" as const,
        ...(check.owner ? { owner: check.owner } : {}),
        ...(check.recordedAt ? { recordedAt: check.recordedAt } : {}),
        ...(check.revision ? { revision: check.revision } : {}),
        ...(check.artifactPath ? { artifactPath: check.artifactPath } : {}),
        ...(check.blockerIds ? { blockerIds: [...check.blockerIds] } : {}),
        ...(check.waiver ? { waiver: { ...check.waiver } } : {})
      }))
    : [];
  const fromCli = args.manualChecks.map((value) => {
    const check = parseManualCheckArg(value);
    return {
      id: check.id,
      title: check.title,
      required: check.required,
      status: check.status,
      notes: check.notes,
      evidence: [...check.evidence],
      source: "cli" as const,
      ...(check.owner ? { owner: check.owner } : {}),
      ...(check.recordedAt ? { recordedAt: check.recordedAt } : {}),
      ...(check.revision ? { revision: check.revision } : {}),
      ...(check.artifactPath ? { artifactPath: check.artifactPath } : {}),
      ...(check.blockerIds ? { blockerIds: [...check.blockerIds] } : {}),
      ...(check.waiver ? { waiver: { ...check.waiver } } : {})
    };
  });

  const checks = [...fromFile, ...fromCli];
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.id)) {
      fail(`Duplicate manual review check id detected: ${check.id}`);
    }
    seen.add(check.id);
  }
  return checks;
}

function evaluateManualReviewFreshness(recordedAt: string | undefined, generatedAtMs: number): EvidenceFreshness {
  if (!recordedAt?.trim()) {
    return "missing_timestamp";
  }
  const recordedAtMs = Date.parse(recordedAt);
  if (Number.isNaN(recordedAtMs)) {
    return "invalid_timestamp";
  }
  return generatedAtMs - recordedAtMs > MANUAL_REVIEW_MAX_AGE_MS ? "stale" : "fresh";
}

function collectManualReviewMetadataFailures(
  check: ManualReviewCheck,
  commit: string | null,
  generatedAtMs: number
): string[] {
  if (!check.required || check.status !== "passed") {
    return [];
  }

  const failures: string[] = [];
  if (!check.owner?.trim()) {
    failures.push(`Manual review is missing owner: ${check.title}.`);
  }
  if (!check.revision?.trim()) {
    failures.push(`Manual review is missing revision binding: ${check.title}.`);
  } else if (commit && check.revision !== commit) {
    failures.push(`Manual review revision mismatch for ${check.title}: expected ${commit}, got ${check.revision}.`);
  }

  const freshness = evaluateManualReviewFreshness(check.recordedAt, generatedAtMs);
  if (freshness === "missing_timestamp") {
    failures.push(`Manual review is missing recordedAt timestamp: ${check.title}.`);
  } else if (freshness === "invalid_timestamp") {
    failures.push(`Manual review has invalid recordedAt timestamp for ${check.title}: ${check.recordedAt}.`);
  } else if (freshness === "stale") {
    failures.push(`Manual review is stale for ${check.title}: ${check.recordedAt} is older than 24h.`);
  }

  return failures;
}

function requireCheck(checks: ValidationCheck[], id: string): ValidationCheck {
  const match = checks.find((check) => check.id === id);
  if (!match) {
    fail(`Missing validation check: ${id}`);
  }
  return match;
}

function buildCandidateSummary(
  checks: ValidationCheck[],
  manualChecks: ManualReviewCheck[],
  metadata: WechatMinigameReleasePackageMetadata,
  artifacts: { artifactsDir?: string; archivePath: string; metadataPath: string },
  smokeReport: WechatMinigameSmokeReport | null,
  reportPath: string,
  summaryPath: string,
  markdownPath: string,
  commit: string | null,
  version: string | null
): CandidateSummary {
  const packageCheck = requireCheck(checks, "package-sidecar");
  const verifyCheck = requireCheck(checks, "artifact-verify");
  const smokeCheck = requireCheck(checks, "smoke-report");
  const uploadCheck = requireCheck(checks, "upload-receipt");
  const blockers: CandidateSummary["blockers"] = [];
  const generatedAt = new Date().toISOString();
  const generatedAtMs = Date.parse(generatedAt);
  const manualMetadataFailures = manualChecks.flatMap((check) => collectManualReviewMetadataFailures(check, commit, generatedAtMs));
  const smokeFreshness = smokeReport ? evaluateManualReviewFreshness(smokeReport.execution.executedAt, generatedAtMs) : "missing_timestamp";

  for (const check of checks) {
    if (check.status === "failed") {
      blockers.push({
        id: check.id,
        summary: check.summary,
        ...(check.artifactPath ? { artifactPath: check.artifactPath } : {}),
        ...(check.command ? { nextCommand: check.command } : {})
      });
    }
  }
  if (smokeCheck.status === "skipped") {
    blockers.push({
      id: "smoke-report-missing",
      summary: "Candidate summary is blocked until codex.wechat.smoke-report.json is generated and validated for the same revision.",
      artifactPath: smokeCheck.artifactPath,
      nextCommand: "npm run smoke -- wechat-release -- --artifacts-dir <release-artifacts-dir> --check [--expected-revision <git-sha>]"
    });
  } else if (smokeReport) {
    if (smokeFreshness === "missing_timestamp") {
      blockers.push({
        id: "smoke-report-metadata",
        summary: "Smoke report is missing execution.executedAt; WeChat device/runtime evidence must include a capture timestamp.",
        artifactPath: smokeCheck.artifactPath
      });
    } else if (smokeFreshness === "invalid_timestamp") {
      blockers.push({
        id: "smoke-report-metadata",
        summary: `Smoke report execution.executedAt is invalid: ${smokeReport.execution.executedAt}.`,
        artifactPath: smokeCheck.artifactPath
      });
    } else if (smokeFreshness === "stale") {
      blockers.push({
        id: "smoke-report-stale",
        summary: `Smoke report is stale: ${smokeReport.execution.executedAt} is older than 24h for this RC summary.`,
        artifactPath: smokeCheck.artifactPath,
        nextCommand: "npm run smoke -- wechat-release -- --artifacts-dir <release-artifacts-dir> --check [--expected-revision <git-sha>]"
      });
    }
  }

  for (const check of manualChecks) {
    if (!check.required || check.status === "passed" || check.status === "not_applicable") {
      continue;
    }
    blockers.push({
      id: `manual:${check.id}`,
      summary:
        check.status === "failed"
          ? `Manual review failed: ${check.title}. ${check.notes}`.trim()
          : `Manual review pending: ${check.title}. ${check.notes}`.trim()
    });
  }
  for (const failure of manualMetadataFailures) {
    blockers.push({
      id: "manual-review-metadata",
      summary: failure
    });
  }

  const requiredPendingChecks = manualChecks.filter((check) => check.required && check.status === "pending").length;
  const requiredFailedChecks = manualChecks.filter((check) => check.required && check.status === "failed").length;
  const completedChecks = manualChecks.filter((check) => check.status === "passed" || check.status === "not_applicable").length;
  const requiredMetadataFailures = manualMetadataFailures.length;
  const status: CandidateStatus = blockers.length === 0 ? "ready" : "blocked";

  return {
    schemaVersion: 1,
    generatedAt,
    candidate: {
      revision: commit,
      version,
      projectName: metadata.projectName,
      appId: metadata.appId,
      status
    },
    artifacts: {
      ...(artifacts.artifactsDir ? { artifactsDir: artifacts.artifactsDir } : {}),
      archivePath: artifacts.archivePath,
      metadataPath: artifacts.metadataPath,
      validationReportPath: reportPath,
      summaryPath,
      smokeReportPath:
        smokeCheck.artifactPath ??
        path.join(artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath), "codex.wechat.smoke-report.json"),
      uploadReceiptPath:
        uploadCheck.artifactPath ??
        path.join(
          artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath),
          `${path.basename(artifacts.metadataPath, ".package.json")}.upload.json`
        ),
      markdownPath
    },
    evidence: {
      package: {
        status: packageCheck.status,
        summary: packageCheck.summary,
        artifactPath: packageCheck.artifactPath ?? artifacts.metadataPath
      },
      validation: {
        status: verifyCheck.status,
        summary: verifyCheck.summary,
        artifactPath: reportPath
      },
      smoke: {
        status: smokeCheck.status,
        summary: smokeCheck.summary,
        artifactPath:
          smokeCheck.artifactPath ??
          path.join(artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath), "codex.wechat.smoke-report.json")
      },
      deviceRuntime: smokeReport
        ? {
            status: smokeCheck.status === "passed" && smokeFreshness === "fresh" ? "ready" : "blocked",
            freshness: smokeFreshness,
            artifactPath:
              smokeCheck.artifactPath ??
              path.join(artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath), "codex.wechat.smoke-report.json"),
            execution: smokeReport.execution,
            cases: smokeReport.cases
          }
        : null,
      upload: {
        status: uploadCheck.status,
        summary: uploadCheck.summary,
        artifactPath:
          uploadCheck.artifactPath ??
          path.join(
            artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath),
            `${path.basename(artifacts.metadataPath, ".package.json")}.upload.json`
          )
      },
      manualReview: {
        status: requiredPendingChecks === 0 && requiredFailedChecks === 0 && requiredMetadataFailures === 0 ? "ready" : "blocked",
        totalChecks: manualChecks.length,
        completedChecks,
        requiredPendingChecks,
        requiredFailedChecks,
        requiredMetadataFailures,
        checks: manualChecks
      }
    },
    blockers
  };
}

function renderCandidateMarkdown(summary: CandidateSummary): string {
  const lines: string[] = [];
  lines.push("# WeChat Release Candidate Summary", "");
  lines.push(`- Candidate status: \`${summary.candidate.status}\``);
  lines.push(`- Revision: \`${summary.candidate.revision ?? "unknown"}\``);
  lines.push(`- Version: \`${summary.candidate.version ?? "unknown"}\``);
  lines.push(`- Project: \`${summary.candidate.projectName}\``);
  lines.push(`- App ID: \`${summary.candidate.appId}\``, "");
  lines.push("## Evidence", "");
  lines.push(
    `- Package metadata: \`${summary.evidence.package.status}\` (${summary.evidence.package.summary}) -> \`${path.relative(process.cwd(), summary.evidence.package.artifactPath).replace(/\\\\/g, "/")}\``
  );
  lines.push(
    `- Artifact validation: \`${summary.evidence.validation.status}\` (${summary.evidence.validation.summary}) -> \`${path.relative(process.cwd(), summary.artifacts.validationReportPath).replace(/\\\\/g, "/")}\``
  );
  lines.push(
    `- Smoke evidence: \`${summary.evidence.smoke.status}\` (${summary.evidence.smoke.summary}) -> \`${path.relative(process.cwd(), summary.evidence.smoke.artifactPath).replace(/\\\\/g, "/")}\``
  );
  if (summary.evidence.deviceRuntime) {
    lines.push(
      `- Device runtime evidence: \`${summary.evidence.deviceRuntime.status}\` (freshness: \`${summary.evidence.deviceRuntime.freshness}\`) -> \`${path.relative(process.cwd(), summary.evidence.deviceRuntime.artifactPath).replace(/\\\\/g, "/")}\``
    );
  }
  lines.push(
    `- Upload receipt: \`${summary.evidence.upload.status}\` (${summary.evidence.upload.summary}) -> \`${path.relative(process.cwd(), summary.evidence.upload.artifactPath).replace(/\\\\/g, "/")}\``,
    ""
  );
  if (summary.evidence.deviceRuntime) {
    lines.push("## Device Runtime Evidence", "");
    lines.push(`- Result: \`${summary.evidence.deviceRuntime.execution.result}\``);
    lines.push(`- Executed at: \`${summary.evidence.deviceRuntime.execution.executedAt}\``);
    lines.push(`- Tester: \`${summary.evidence.deviceRuntime.execution.tester}\``);
    lines.push(`- Device: \`${summary.evidence.deviceRuntime.execution.device}\``);
    lines.push(`- Client version: \`${summary.evidence.deviceRuntime.execution.clientVersion}\``);
    lines.push(`- Summary: ${summary.evidence.deviceRuntime.execution.summary}`, "");
    for (const entry of summary.evidence.deviceRuntime.cases) {
      lines.push(
        `- \`${entry.status}\` ${entry.id}: ${entry.title}${entry.notes ? ` - ${entry.notes}` : ""}${entry.evidence.length > 0 ? ` Evidence: ${entry.evidence.join(", ")}` : ""}`
      );
      if (entry.id === "reconnect-recovery" && entry.requiredEvidence) {
        const requiredEvidence = entry.requiredEvidence as ReconnectRecoveryEvidence;
        lines.push(
          `  reconnect details: roomId=${requiredEvidence.roomId}; reconnectPrompt=${requiredEvidence.reconnectPrompt}; restoredState=${requiredEvidence.restoredState}`
        );
      }
      if (entry.id === "share-roundtrip" && entry.requiredEvidence) {
        const requiredEvidence = entry.requiredEvidence as ShareRoundtripEvidence;
        lines.push(
          `  share details: shareScene=${requiredEvidence.shareScene}; shareQuery=${requiredEvidence.shareQuery}; roundtripState=${requiredEvidence.roundtripState}`
        );
      }
    }
    lines.push("");
  }
  lines.push("## Manual Review", "");
  for (const check of summary.evidence.manualReview.checks) {
    const evidence = check.evidence.length > 0 ? ` Evidence: ${check.evidence.join(", ")}` : "";
    const metadata = [
      check.owner ? `owner=${check.owner}` : "",
      check.recordedAt ? `recordedAt=${check.recordedAt}` : "",
      check.revision ? `revision=${check.revision}` : "",
      check.waiver?.reason ? `waiver=${check.waiver.reason}` : ""
    ]
      .filter((value) => value.length > 0)
      .join(" ");
    lines.push(
      `- \`${check.status}\` ${check.title}${check.notes ? ` - ${check.notes}` : ""}${evidence}${metadata ? ` Metadata: ${metadata}` : ""}`
    );
  }
  lines.push("", "## Blockers", "");
  if (summary.blockers.length === 0) {
    lines.push("- None.");
  } else {
    for (const blocker of summary.blockers) {
      lines.push(`- ${blocker.id}: ${blocker.summary}`);
    }
  }
  lines.push(
    "",
    `Validation report: \`${path.relative(process.cwd(), summary.artifacts.validationReportPath).replace(/\\/g, "/")}\``,
    `Summary JSON: \`${path.relative(process.cwd(), summary.artifacts.summaryPath).replace(/\\/g, "/")}\``
  );
  return `${lines.join("\n")}\n`;
}

function runCommandCheck(
  title: string,
  artifactPath: string | undefined,
  args: string[]
): ValidationCheck {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });

  const stderrTail = tailText(result.stderr);
  const stdoutTail = tailText(result.stdout);
  if (result.error) {
    return {
      id: title,
      title,
      status: "failed",
      required: true,
      summary: result.error.message,
      ...(artifactPath ? { artifactPath } : {}),
      command: [process.execPath, ...args].join(" "),
      exitCode: result.status,
      ...(stdoutTail ? { stdoutTail } : {}),
      ...(stderrTail ? { stderrTail } : {})
    };
  }

  if (result.status !== 0) {
    return {
      id: title,
      title,
      status: "failed",
      required: true,
      summary: stderrTail ?? stdoutTail ?? `Command exited with code ${result.status}.`,
      ...(artifactPath ? { artifactPath } : {}),
      command: [process.execPath, ...args].join(" "),
      exitCode: result.status,
      ...(stdoutTail ? { stdoutTail } : {}),
      ...(stderrTail ? { stderrTail } : {})
    };
  }

  return {
    id: title,
    title,
    status: "passed",
    required: true,
    summary: "ok",
    ...(artifactPath ? { artifactPath } : {}),
    command: [process.execPath, ...args].join(" "),
    exitCode: result.status,
    ...(stdoutTail ? { stdoutTail } : {}),
    ...(stderrTail ? { stderrTail } : {})
  };
}

function validateUploadReceipt(
  uploadReceiptPath: string,
  metadata: WechatMinigameReleasePackageMetadata,
  metadataPath: string,
  expectedVersion?: string,
  expectedRevision?: string
): ValidationCheck {
  const receipt = readJsonFile<UploadReceipt>(uploadReceiptPath);
  if (receipt.schemaVersion !== 1) {
    fail(`Upload receipt schemaVersion must be 1, received ${JSON.stringify(receipt.schemaVersion)}.`);
  }
  if (receipt.buildTemplatePlatform !== "wechatgame") {
    fail(
      `Upload receipt buildTemplatePlatform must be "wechatgame", received ${JSON.stringify(receipt.buildTemplatePlatform)}.`
    );
  }
  if (!receipt.uploadVersion?.trim()) {
    fail("Upload receipt is missing uploadVersion.");
  }
  if (!receipt.uploadedAt?.trim()) {
    fail("Upload receipt is missing uploadedAt.");
  }
  if (receipt.projectName !== metadata.projectName) {
    fail(`Upload receipt projectName mismatch: ${receipt.projectName} !== ${metadata.projectName}`);
  }
  if (receipt.artifactArchiveFileName !== metadata.archiveFileName) {
    fail(
      `Upload receipt artifactArchiveFileName mismatch: ${receipt.artifactArchiveFileName} !== ${metadata.archiveFileName}`
    );
  }
  if (receipt.artifactArchiveSha256 !== metadata.archiveSha256) {
    fail("Upload receipt artifactArchiveSha256 does not match release sidecar.");
  }

  const expectedMetadataRelativePath = path.relative(process.cwd(), metadataPath).replace(/\\/g, "/");
  if (receipt.artifactMetadataPath !== expectedMetadataRelativePath) {
    fail(
      `Upload receipt artifactMetadataPath mismatch: ${receipt.artifactMetadataPath} !== ${expectedMetadataRelativePath}`
    );
  }
  if (expectedVersion && receipt.uploadVersion !== expectedVersion) {
    fail(`Release candidate version mismatch: expected ${expectedVersion}, receipt=${receipt.uploadVersion}`);
  }
  if (metadata.sourceRevision && receipt.sourceRevision && metadata.sourceRevision !== receipt.sourceRevision) {
    fail(
      `Revision mismatch between release sidecar and upload receipt: ${metadata.sourceRevision} !== ${receipt.sourceRevision}`
    );
  }
  if (expectedRevision) {
    if (!receipt.sourceRevision) {
      fail(`Upload receipt is missing sourceRevision; expected ${expectedRevision}.`);
    }
    if (receipt.sourceRevision !== expectedRevision) {
      fail(`Release candidate commit mismatch: expected ${expectedRevision}, receipt=${receipt.sourceRevision}`);
    }
  }

  return {
    id: "upload-receipt",
    title: "Upload receipt validation",
    status: "passed",
    required: Boolean(expectedVersion),
    summary: "ok",
    artifactPath: uploadReceiptPath
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const checks: ValidationCheck[] = [];
  const artifacts = resolveArtifacts(args);
  const metadata = readJsonFile<WechatMinigameReleasePackageMetadata>(artifacts.metadataPath);
  const smokeReportPath = resolveOptionalArtifactPath(
    args.smokeReportPath,
    path.join(artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath), "codex.wechat.smoke-report.json")
  );
  const uploadReceiptPath = resolveOptionalArtifactPath(
    args.uploadReceiptPath,
    path.join(
      artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath),
      `${path.basename(artifacts.metadataPath, ".package.json")}.upload.json`
    )
  );
  const reportPath = path.resolve(args.reportPath ?? defaultReportPath(artifacts.artifactsDir, artifacts.metadataPath));
  const summaryPath = path.resolve(args.summaryPath ?? defaultSummaryPath(artifacts.artifactsDir, artifacts.metadataPath));
  const markdownPath = path.resolve(args.markdownPath ?? defaultMarkdownPath(artifacts.artifactsDir, artifacts.metadataPath));
  const manualChecks = readManualChecks(args);
  const commit = metadata.sourceRevision ?? args.expectedRevision ?? null;
  let version = args.version ?? null;
  let exitCode = 0;
  let smokeReport: WechatMinigameSmokeReport | null = null;

  try {
    validatePackageMetadataShape(metadata, artifacts.archivePath);
    checks.push({
      id: "package-sidecar",
      title: "Release sidecar metadata",
      status: "passed",
      required: true,
      summary: "ok",
      artifactPath: artifacts.metadataPath
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      id: "package-sidecar",
      title: "Release sidecar metadata",
      status: "failed",
      required: true,
      summary: message,
      artifactPath: artifacts.metadataPath
    });
    exitCode = 1;
  }

  const verifyArgs = [
    "--import",
    "tsx",
    "./scripts/verify-wechat-minigame-artifact.ts",
    "--archive",
    artifacts.archivePath,
    "--metadata",
    artifacts.metadataPath
  ];
  if (args.expectedRevision) {
    verifyArgs.push("--expected-revision", args.expectedRevision);
  }
  const verifyCheck = runCommandCheck("artifact-verify", artifacts.archivePath, verifyArgs);
  verifyCheck.id = "artifact-verify";
  verifyCheck.title = "Release archive verification";
  checks.push(verifyCheck);
  if (verifyCheck.status === "failed") {
    exitCode = 1;
  }

  if (smokeReportPath) {
    const smokeArgs = [
      "--import",
      "tsx",
      "./scripts/smoke-wechat-minigame-release.ts",
      "--metadata",
      artifacts.metadataPath,
      "--report",
      smokeReportPath,
      "--check"
    ];
    if (args.expectedRevision) {
      smokeArgs.push("--expected-revision", args.expectedRevision);
    }
    const smokeCheck = runCommandCheck("smoke-report", smokeReportPath, smokeArgs);
    smokeCheck.id = "smoke-report";
    smokeCheck.title = "Smoke report validation";
    smokeCheck.required = args.requireSmokeReport;
    if (smokeCheck.status === "passed" && fs.existsSync(smokeReportPath)) {
      smokeReport = readJsonFile<WechatMinigameSmokeReport>(smokeReportPath);
    }
    if (smokeCheck.status === "failed" || args.requireSmokeReport) {
      checks.push(smokeCheck);
      if (smokeCheck.status === "failed") {
        exitCode = 1;
      }
    } else {
      checks.push(smokeCheck);
    }
  } else if (args.requireSmokeReport) {
    checks.push({
      id: "smoke-report",
      title: "Smoke report validation",
      status: "failed",
      required: true,
      summary: "Required smoke report is missing.",
      artifactPath: path.join(artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath), "codex.wechat.smoke-report.json")
    });
    exitCode = 1;
  } else {
    checks.push({
      id: "smoke-report",
      title: "Smoke report validation",
      status: "skipped",
      required: false,
      summary: "Smoke report not present.",
      artifactPath: path.join(artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath), "codex.wechat.smoke-report.json")
    });
  }

  if (uploadReceiptPath) {
    try {
      const uploadCheck = validateUploadReceipt(
        uploadReceiptPath,
        metadata,
        artifacts.metadataPath,
        args.version,
        args.expectedRevision
      );
      const receipt = readJsonFile<UploadReceipt>(uploadReceiptPath);
      version = receipt.uploadVersion;
      checks.push(uploadCheck);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        id: "upload-receipt",
        title: "Upload receipt validation",
        status: "failed",
        required: Boolean(args.version),
        summary: message,
        artifactPath: uploadReceiptPath
      });
      exitCode = 1;
    }
  } else if (args.version) {
    checks.push({
      id: "upload-receipt",
      title: "Upload receipt validation",
      status: "failed",
      required: true,
      summary: `Upload receipt is required to validate release candidate version ${args.version}.`,
      artifactPath: path.join(
        artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath),
        `${path.basename(artifacts.metadataPath, ".package.json")}.upload.json`
      )
    });
    exitCode = 1;
  } else {
    checks.push({
      id: "upload-receipt",
      title: "Upload receipt validation",
      status: "skipped",
      required: false,
      summary: "Upload receipt not present.",
      artifactPath: path.join(
        artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath),
        `${path.basename(artifacts.metadataPath, ".package.json")}.upload.json`
      )
    });
  }

  const failedChecks = checks.filter((check) => check.status === "failed");
  const report: ValidationReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version,
    commit,
    artifact: {
      ...(artifacts.artifactsDir ? { artifactsDir: artifacts.artifactsDir } : {}),
      archivePath: artifacts.archivePath,
      metadataPath: artifacts.metadataPath,
      ...(smokeReportPath ? { smokeReportPath } : {}),
      ...(uploadReceiptPath ? { uploadReceiptPath } : {})
    },
    summary: {
      status: failedChecks.length > 0 ? "failed" : "passed",
      totalChecks: checks.length,
      failedChecks: failedChecks.length,
      failureSummary: failedChecks.map((check) => `${check.id}: ${check.summary}`)
    },
    checks
  };

  writeJsonFile(reportPath, report);
  const candidateSummary = buildCandidateSummary(
    checks,
    manualChecks,
    metadata,
    artifacts,
    smokeReport,
    reportPath,
    summaryPath,
    markdownPath,
    commit,
    version
  );
  writeJsonFile(summaryPath, candidateSummary);
  fs.writeFileSync(markdownPath, renderCandidateMarkdown(candidateSummary), "utf8");
  console.log(`Wrote release candidate validation report: ${path.relative(process.cwd(), reportPath).replace(/\\/g, "/")}`);
  console.log(`Wrote release candidate summary: ${path.relative(process.cwd(), summaryPath).replace(/\\/g, "/")}`);
  console.log(`Wrote release candidate markdown: ${path.relative(process.cwd(), markdownPath).replace(/\\/g, "/")}`);
  console.log(`Artifact: ${path.relative(process.cwd(), artifacts.archivePath).replace(/\\/g, "/")}`);
  console.log(`Commit: ${commit ?? "unknown"}`);
  console.log(`Version: ${version ?? "unknown"}`);
  console.log(`Result: ${report.summary.status}`);
  console.log(`Candidate status: ${candidateSummary.candidate.status}`);

  if (failedChecks.length > 0) {
    console.error("Failures:");
    for (const failure of report.summary.failureSummary) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = exitCode || 1;
    return;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
