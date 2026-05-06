import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findNearestReleaseReadinessDir, updateReleaseCandidateManifest } from "./release-candidate-manifest.ts";

type FindingCode =
  | "missing"
  | "stale"
  | "revision_mismatch"
  | "candidate_mismatch"
  | "missing_timestamp"
  | "invalid_timestamp"
  | "linked_snapshot_mismatch"
  | "linked_artifact_mismatch"
  | "manual_pending"
  | "manual_failed"
  | "metadata_failure"
  | "blocked";
type TargetSurface = "auto" | "h5" | "wechat";
type FindingSeverity = "blocking" | "warning";
type FamilyStatus = "passed" | "warning" | "failed";
type AuditStatus = FamilyStatus;
type FreshnessStatus = "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp" | "missing";
type ManualEvidenceFamilyId =
  | "runtime-observability"
  | "cocos-rc-signoff"
  | "wechat-release-signoff"
  | "reconnect-followup";

interface Args {
  candidate: string;
  candidateRevision: string;
  targetSurface: TargetSurface;
  snapshotPath?: string;
  releaseGateSummaryPath?: string;
  cocosRcBundlePath?: string;
  runtimeObservabilityEvidencePath?: string;
  runtimeObservabilityGatePath?: string;
  manualEvidenceLedgerPath?: string;
  wechatArtifactsDir?: string;
  wechatCandidateSummaryPath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  maxAgeHours: number;
}

interface ReleaseReadinessSnapshot {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
}

interface ReleaseGateSummaryReport {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  inputs?: {
    snapshotPath?: string;
  };
}

interface CocosRcBundleManifest {
  bundle?: {
    generatedAt?: string;
    candidate?: string;
    commit?: string;
    shortCommit?: string;
  };
  artifacts?: {
    primaryJourneyEvidence?: string;
    snapshot?: string;
  };
  linkedEvidence?: {
    releaseReadinessSnapshot?: {
      path?: string;
    };
  };
}

interface CocosRcSnapshotArtifact {
  candidate?: {
    name?: string;
    commit?: string;
    shortCommit?: string;
  };
  execution?: {
    executedAt?: string;
  };
  linkedEvidence?: {
    primaryJourneyEvidence?: {
      path?: string;
    };
    releaseReadinessSnapshot?: {
      path?: string;
    };
  };
}

interface CocosPrimaryJourneyEvidenceArtifact {
  candidate?: {
    name?: string;
    commit?: string;
    shortCommit?: string;
  };
  execution?: {
    completedAt?: string;
  };
}

interface RuntimeObservabilityEvidenceReport {
  generatedAt?: string;
  candidate?: {
    name?: string;
    revision?: string;
    shortRevision?: string;
    targetSurface?: "h5" | "wechat";
  };
}

interface RuntimeObservabilityGateReport {
  generatedAt?: string;
  candidate?: {
    name?: string;
    revision?: string;
    shortRevision?: string;
    targetSurface?: "h5" | "wechat";
  };
  evidenceSource?: {
    artifactPath?: string;
  };
}

interface ManualEvidenceOwnerLedgerMetadata {
  candidate?: string;
  targetRevision?: string;
  releaseOwner?: string;
  lastUpdated?: string;
  linkedReadinessSnapshot?: string;
}

interface ManualEvidenceOwnerLedgerRow {
  evidenceType: string;
  candidate?: string;
  revision?: string;
  owner?: string;
  status?: string;
  lastUpdated?: string;
  artifactPath?: string;
  notes?: string;
}

interface ManualEvidenceOwnerLedger {
  metadata: ManualEvidenceOwnerLedgerMetadata;
  rows: ManualEvidenceOwnerLedgerRow[];
}

interface WechatManualReviewCheck {
  id?: string;
  title?: string;
  required?: boolean;
  status?: string;
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  notes?: string;
}

interface WechatCandidateSummary {
  generatedAt?: string;
  candidate?: {
    revision?: string | null;
    status?: string;
  };
  evidence?: {
    manualReview?: {
      status?: string;
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
  }>;
}

interface AuditFinding {
  code: FindingCode;
  severity: FindingSeverity;
  summary: string;
  artifactPath?: string;
}

interface AuditTriageEntry {
  scope: "artifact-family" | "manual-contract";
  familyId: string;
  familyLabel: string;
  code: FindingCode;
  severity: FindingSeverity;
  summary: string;
  artifactPath?: string;
}

interface ManualEvidenceFamilyReport {
  id: ManualEvidenceFamilyId;
  label: string;
  severity: FindingSeverity;
  required: boolean;
  applicable: boolean;
  status: FamilyStatus;
  summary: string;
  artifactPaths: string[];
  findings: AuditFinding[];
}

interface ManualEvidenceContractReport {
  status: AuditStatus;
  summary: string;
  requiredFamilies: ManualEvidenceFamilyReport[];
}

interface ArtifactFamilyReport {
  id:
    | "release-readiness-snapshot"
    | "release-gate-summary"
    | "cocos-rc-bundle"
    | "cocos-rc-snapshot"
    | "cocos-primary-journey-evidence"
    | "runtime-observability-evidence"
    | "runtime-observability-gate"
    | "manual-evidence-ledger"
    | "wechat-release-evidence";
  label: string;
  severity: FindingSeverity;
  required: boolean;
  applicable: boolean;
  status: FamilyStatus;
  artifactPath?: string;
  revision?: string;
  candidate?: string;
  generatedAt?: string;
  freshness: FreshnessStatus;
  findings: AuditFinding[];
}

interface CandidateEvidenceAuditReport {
  schemaVersion: 4;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    targetSurface: Exclude<TargetSurface, "auto"> | "auto";
  };
  summary: {
    status: AuditStatus;
    blockerCount: number;
    warningCount: number;
    findingCount: number;
    summary: string;
  };
  inputs: {
    targetSurface: TargetSurface;
    snapshotPath?: string;
    releaseGateSummaryPath?: string;
    cocosRcBundlePath?: string;
    runtimeObservabilityEvidencePath?: string;
    runtimeObservabilityGatePath?: string;
    manualEvidenceLedgerPath?: string;
    wechatCandidateSummaryPath?: string;
  };
  triage: {
    blockers: AuditTriageEntry[];
    warnings: AuditTriageEntry[];
  };
  manualEvidenceContract: ManualEvidenceContractReport;
  artifactFamilies: ArtifactFamilyReport[];
}

type OwnerReminderCondition = "stale_artifact" | "missing_artifact" | "missing_owner_assignment";

interface OwnerReminderEntry {
  artifactFamilyId: ArtifactFamilyReport["id"];
  artifactFamilyLabel: string;
  condition: OwnerReminderCondition;
  severity: FindingSeverity;
  summary: string;
  artifactPath?: string;
  expectedOwners: string[];
  ownerLedgerEvidenceTypes: string[];
  ownerLedgerReference: string;
  sourceFindingCodes: FindingCode[];
}

interface CandidateOwnerReminderReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    targetSurface: Exclude<TargetSurface, "auto"> | "auto";
  };
  summary: {
    status: AuditStatus;
    itemCount: number;
    missingArtifactCount: number;
    staleArtifactCount: number;
    missingOwnerAssignmentCount: number;
    summary: string;
  };
  inputs: {
    manualEvidenceLedgerPath?: string;
  };
  items: OwnerReminderEntry[];
}

interface CandidateEvidenceFreshnessHistoryEntry {
  auditTimestamp: string;
  candidateRevision: string;
  targetSurface: Exclude<TargetSurface, "auto"> | "auto";
  overallStatus: AuditStatus;
  blockerCount: number;
  warningCount: number;
  findingCount: number;
  summary: string;
  blockingFindings: AuditTriageEntry[];
  warnings: AuditTriageEntry[];
  artifactFamilies: Array<{
    id: ArtifactFamilyReport["id"];
    label: string;
    status: FamilyStatus;
    freshness: FreshnessStatus;
    generatedAt?: string;
    revision?: string;
    candidate?: string;
    artifactPath?: string;
    findingCodes: FindingCode[];
  }>;
}

interface CandidateEvidenceFreshnessHistoryReport {
  schemaVersion: 1;
  candidate: {
    name: string;
  };
  generatedAt: string;
  entries: CandidateEvidenceFreshnessHistoryEntry[];
}

interface ManualEvidenceSource {
  label: string;
  candidate?: string;
  revision?: string;
  observedAt?: string;
  status?: string;
  artifactPath?: string;
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_WECHAT_ARTIFACTS_DIR = path.resolve("artifacts", "wechat-release");
const MAX_DEFAULT_AGE_HOURS = 72;
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;
const LEDGER_PENDING_STATUSES = new Set(["pending", "in-review"]);
const WECHAT_LEDGER_EVIDENCE_TYPES = new Set([
  "wechat-runtime-observability-signoff",
  "wechat-devtools-export-review",
  "wechat-device-runtime-smoke",
  "wechat-device-runtime-review",
  "wechat-release-checklist"
]);
const RUNTIME_OBSERVABILITY_LEDGER_EVIDENCE_TYPES = new Set([
  "runtime-observability-review",
  "runtime-observability-signoff",
  "wechat-runtime-observability-signoff"
]);
const COCOS_RC_SIGNOFF_LEDGER_EVIDENCE_TYPES = new Set([
  "cocos-rc-checklist-review",
  "cocos-rc-blockers-review",
  "cocos-presentation-signoff"
]);
const WECHAT_RELEASE_SIGNOFF_LEDGER_EVIDENCE_TYPES = new Set([
  "wechat-devtools-export-review",
  "wechat-device-runtime-smoke",
  "wechat-device-runtime-review",
  "wechat-release-checklist",
  "wechat-runtime-observability-signoff"
]);

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate = "";
  let candidateRevision = "";
  let targetSurface: TargetSurface = "auto";
  let snapshotPath: string | undefined;
  let releaseGateSummaryPath: string | undefined;
  let cocosRcBundlePath: string | undefined;
  let runtimeObservabilityEvidencePath: string | undefined;
  let runtimeObservabilityGatePath: string | undefined;
  let manualEvidenceLedgerPath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let wechatCandidateSummaryPath: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let maxAgeHours = MAX_DEFAULT_AGE_HOURS;

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
    if (arg === "--target-surface" && next) {
      if (next !== "auto" && next !== "h5" && next !== "wechat") {
        fail(`Unsupported --target-surface value: ${next}`);
      }
      targetSurface = next;
      index += 1;
      continue;
    }
    if (arg === "--snapshot" && next) {
      snapshotPath = next;
      index += 1;
      continue;
    }
    if (arg === "--release-gate-summary" && next) {
      releaseGateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--cocos-rc-bundle" && next) {
      cocosRcBundlePath = next;
      index += 1;
      continue;
    }
    if (arg === "--runtime-observability-evidence" && next) {
      runtimeObservabilityEvidencePath = next;
      index += 1;
      continue;
    }
    if (arg === "--runtime-observability-gate" && next) {
      runtimeObservabilityGatePath = next;
      index += 1;
      continue;
    }
    if (arg === "--manual-evidence-ledger" && next) {
      manualEvidenceLedgerPath = next;
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
    if (arg === "--max-age-hours" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`--max-age-hours must be a positive integer. Received: ${next}`);
      }
      maxAgeHours = parsed;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!candidate) {
    fail("Missing required argument: --candidate");
  }
  if (!candidateRevision) {
    fail("Missing required argument: --candidate-revision");
  }

  return {
    candidate,
    candidateRevision,
    targetSurface,
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    ...(cocosRcBundlePath ? { cocosRcBundlePath } : {}),
    ...(runtimeObservabilityEvidencePath ? { runtimeObservabilityEvidencePath } : {}),
    ...(runtimeObservabilityGatePath ? { runtimeObservabilityGatePath } : {}),
    ...(manualEvidenceLedgerPath ? { manualEvidenceLedgerPath } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    maxAgeHours
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

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function slugifyCandidate(candidate: string): string {
  return candidate
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRevision(revision: string | undefined | null): string | undefined {
  const trimmed = revision?.trim().toLowerCase();
  return trimmed && HEX_REVISION_PATTERN.test(trimmed) ? trimmed : undefined;
}

function revisionsMatch(left: string | undefined | null, right: string | undefined | null): boolean {
  const normalizedLeft = normalizeRevision(left);
  const normalizedRight = normalizeRevision(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function resolveLatestFile(
  dirPath: string,
  matcher: (entry: string) => boolean,
  preferredMatcher?: (entry: string) => boolean
): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }

  const files = fs
    .readdirSync(dirPath)
    .filter((entry) => matcher(entry))
    .map((entry) => path.join(dirPath, entry))
    .filter((entry) => fs.statSync(entry).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  if (preferredMatcher) {
    const preferred = files.find((filePath) => preferredMatcher(path.basename(filePath)));
    if (preferred) {
      return preferred;
    }
  }
  return files[0];
}

function resolveSnapshotPath(args: Args): string | undefined {
  if (args.snapshotPath) {
    return path.resolve(args.snapshotPath);
  }
  return resolveLatestFile(
    DEFAULT_RELEASE_READINESS_DIR,
    (entry) =>
      entry.endsWith(".json") &&
      entry.startsWith("release-readiness-") &&
      !entry.startsWith("release-readiness-dashboard-"),
    undefined
  );
}

function resolveReleaseGateSummaryPath(args: Args): string | undefined {
  if (args.releaseGateSummaryPath) {
    return path.resolve(args.releaseGateSummaryPath);
  }
  const fixed = path.join(DEFAULT_RELEASE_READINESS_DIR, "release-gate-summary.json");
  if (fs.existsSync(fixed)) {
    return fixed;
  }
  return resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.endsWith(".json") && entry.startsWith("release-gate-summary-"));
}

function resolveCocosRcBundlePath(args: Args): string | undefined {
  if (args.cocosRcBundlePath) {
    return path.resolve(args.cocosRcBundlePath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return resolveLatestFile(
    DEFAULT_RELEASE_READINESS_DIR,
    (entry) => entry.endsWith(".json") && entry.startsWith("cocos-rc-evidence-bundle-"),
    (entry) => entry.includes(`cocos-rc-evidence-bundle-${candidateSlug}-`)
  );
}

function resolveRuntimeObservabilityEvidencePath(args: Args): string | undefined {
  if (args.runtimeObservabilityEvidencePath) {
    return path.resolve(args.runtimeObservabilityEvidencePath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return resolveLatestFile(
    DEFAULT_RELEASE_READINESS_DIR,
    (entry) => entry.endsWith(".json") && entry.startsWith("runtime-observability-evidence-"),
    (entry) => entry.includes(`runtime-observability-evidence-${candidateSlug}-`)
  );
}

function resolveRuntimeObservabilityGatePath(args: Args): string | undefined {
  if (args.runtimeObservabilityGatePath) {
    return path.resolve(args.runtimeObservabilityGatePath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return resolveLatestFile(
    DEFAULT_RELEASE_READINESS_DIR,
    (entry) => entry.endsWith(".json") && entry.startsWith("runtime-observability-gate-"),
    (entry) => entry.includes(`runtime-observability-gate-${candidateSlug}-`)
  );
}

function resolveManualEvidenceLedgerPath(args: Args): string | undefined {
  if (args.manualEvidenceLedgerPath) {
    return path.resolve(args.manualEvidenceLedgerPath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return resolveLatestFile(
    DEFAULT_RELEASE_READINESS_DIR,
    (entry) => entry.endsWith(".md") && entry.includes("manual-release-evidence-owner-ledger"),
    (entry) => entry.includes(`manual-release-evidence-owner-ledger-${candidateSlug}-`) || entry.includes(`manual-release-evidence-owner-ledger-${candidateSlug}.`)
  );
}

function resolveWechatCandidateSummaryPath(args: Args): string | undefined {
  if (args.wechatCandidateSummaryPath) {
    return path.resolve(args.wechatCandidateSummaryPath);
  }
  const artifactsDir = path.resolve(args.wechatArtifactsDir ?? DEFAULT_WECHAT_ARTIFACTS_DIR);
  const direct = path.join(artifactsDir, "codex.wechat.release-candidate-summary.json");
  return fs.existsSync(direct) ? direct : undefined;
}

function evaluateFreshness(timestamp: string | undefined, maxAgeMs: number): FreshnessStatus {
  if (!timestamp?.trim()) {
    return "missing_timestamp";
  }
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return "invalid_timestamp";
  }
  return Date.now() - parsed > maxAgeMs ? "stale" : "fresh";
}

export function parseManualEvidenceOwnerLedger(filePath: string): ManualEvidenceOwnerLedger {
  const content = fs.readFileSync(filePath, "utf8");
  const capture = (label: string): string | undefined => {
    const match = content.match(new RegExp(`^- ${label}:\\s+\`([^\\n\`]+)\``, "m"));
    return match?.[1]?.trim();
  };

  const rows: ManualEvidenceOwnerLedgerRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) {
      continue;
    }
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((entry) => entry.trim());
    if (columns.length !== 8) {
      continue;
    }
    if (columns[0] === "Evidence type" || columns.every((entry) => /^-+$/.test(entry.replace(/\s+/g, "")))) {
      continue;
    }
    rows.push({
      evidenceType: columns[0].replace(/^`|`$/g, ""),
      candidate: columns[1].replace(/^`|`$/g, ""),
      revision: columns[2].replace(/^`|`$/g, ""),
      owner: columns[3].replace(/^`|`$/g, ""),
      status: columns[4].replace(/^`|`$/g, "").toLowerCase(),
      lastUpdated: columns[5].replace(/^`|`$/g, ""),
      artifactPath: columns[6].replace(/^`|`$/g, ""),
      notes: columns[7]
    });
  }

  return {
    metadata: {
      candidate: capture("Candidate"),
      targetRevision: capture("Target revision"),
      releaseOwner: capture("Release owner"),
      lastUpdated: capture("Last updated"),
      linkedReadinessSnapshot: capture("Linked readiness snapshot")
    },
    rows
  };
}

function createFinding(
  severity: FindingSeverity,
  code: FindingCode,
  summary: string,
  artifactPath?: string
): AuditFinding {
  return {
    severity,
    code,
    summary,
    ...(artifactPath ? { artifactPath } : {})
  };
}

function getStatusFromCounts(blockerCount: number, warningCount: number): AuditStatus {
  if (blockerCount > 0) {
    return "failed";
  }
  if (warningCount > 0) {
    return "warning";
  }
  return "passed";
}

function getFamilyStatus(findings: AuditFinding[], severity: FindingSeverity): FamilyStatus {
  if (findings.length === 0) {
    return "passed";
  }
  return severity === "blocking" ? "failed" : "warning";
}

function compareLinkedArtifact(
  selectedArtifactPath: string | undefined,
  linkedArtifactPath: string | undefined,
  label: string,
  severity: FindingSeverity
): AuditFinding | undefined {
  if (!selectedArtifactPath || !linkedArtifactPath?.trim()) {
    return undefined;
  }
  const selectedBase = path.basename(selectedArtifactPath);
  const linkedBase = path.basename(linkedArtifactPath.trim());
  if (selectedBase === linkedBase) {
    return undefined;
  }
  return createFinding(
    severity,
    "linked_artifact_mismatch",
    `${label} references ${linkedBase}, but the selected artifact is ${selectedBase}.`
  );
}

function compareLinkedSnapshot(
  selectedSnapshotPath: string | undefined,
  linkedSnapshotPath: string | undefined,
  label: string,
  severity: FindingSeverity
): AuditFinding | undefined {
  if (!selectedSnapshotPath || !linkedSnapshotPath?.trim()) {
    return undefined;
  }
  const selectedBase = path.basename(selectedSnapshotPath);
  const linkedBase = path.basename(linkedSnapshotPath.trim());
  if (selectedBase === linkedBase) {
    return undefined;
  }
  return createFinding(
    severity,
    "linked_snapshot_mismatch",
    `${label} references snapshot ${linkedBase}, but the selected readiness snapshot is ${selectedBase}.`
  );
}

function maybeAddFreshnessFinding(
  findings: AuditFinding[],
  severity: FindingSeverity,
  freshness: FreshnessStatus,
  label: string,
  timestamp: string | undefined,
  maxAgeMs: number,
  artifactPath?: string
): void {
  if (freshness === "stale") {
    findings.push(
      createFinding(
        severity,
        "stale",
        `${label} is older than the ${Math.round(maxAgeMs / (1000 * 60 * 60))}h freshness window.`,
        artifactPath
      )
    );
  } else if (freshness === "missing_timestamp") {
    findings.push(createFinding(severity, "missing_timestamp", `${label} is missing its generated timestamp.`, artifactPath));
  } else if (freshness === "invalid_timestamp") {
    findings.push(
      createFinding(severity, "invalid_timestamp", `${label} has an invalid generated timestamp (${timestamp ?? "<missing>"}).`, artifactPath)
    );
  }
}

function addCommonFindings(
  findings: AuditFinding[],
  input: {
    severity: FindingSeverity;
    label: string;
    candidate: string | undefined;
    revision: string | undefined | null;
    generatedAt: string | undefined;
    expectedCandidate: string;
    expectedRevision: string;
    maxAgeMs: number;
    artifactPath?: string;
  }
): FreshnessStatus {
  const freshness = evaluateFreshness(input.generatedAt, input.maxAgeMs);

  if (input.candidate?.trim() && input.candidate.trim() !== input.expectedCandidate) {
    findings.push(
      createFinding(
        input.severity,
        "candidate_mismatch",
        `${input.label} reports candidate ${input.candidate}, expected ${input.expectedCandidate}.`,
        input.artifactPath
      )
    );
  }
  if (!revisionsMatch(input.revision, input.expectedRevision)) {
    findings.push(
      createFinding(
        input.severity,
        "revision_mismatch",
        `${input.label} reports revision ${input.revision ?? "<missing>"}, expected ${input.expectedRevision}.`,
        input.artifactPath
      )
    );
  }

  maybeAddFreshnessFinding(findings, input.severity, freshness, input.label, input.generatedAt, input.maxAgeMs, input.artifactPath);
  return freshness;
}

function buildMissingFamily(
  id: ArtifactFamilyReport["id"],
  label: string,
  severity: FindingSeverity,
  required: boolean,
  applicable: boolean
): ArtifactFamilyReport {
  const findings = applicable ? [createFinding(severity, "missing", `${label} is missing.`)] : [];
  return {
    id,
    label,
    severity,
    required,
    applicable,
    status: getFamilyStatus(findings, severity),
    freshness: applicable ? "missing" : "fresh",
    findings
  };
}

function isWechatEvidenceApplicable(
  ledger: ManualEvidenceOwnerLedger | undefined,
  wechatCandidateSummaryPath: string | undefined
): boolean {
  if (wechatCandidateSummaryPath && fs.existsSync(wechatCandidateSummaryPath)) {
    return true;
  }
  return (
    ledger?.rows.some((row) => {
      if (!WECHAT_LEDGER_EVIDENCE_TYPES.has(row.evidenceType)) {
        return false;
      }
      return (row.status ?? "").toLowerCase() !== "waived";
    }) ?? false
  );
}

function isWechatSurfaceRequired(input: {
  targetSurface: TargetSurface;
  ledger: ManualEvidenceOwnerLedger | undefined;
  wechatCandidateSummaryPath: string | undefined;
  runtimeObservabilityEvidencePath: string | undefined;
  runtimeObservabilityGatePath: string | undefined;
}): boolean {
  if (input.targetSurface === "wechat") {
    return true;
  }
  if (input.targetSurface === "h5") {
    return false;
  }
  return Boolean(
    isWechatEvidenceApplicable(input.ledger, input.wechatCandidateSummaryPath) ||
      input.runtimeObservabilityEvidencePath ||
      input.runtimeObservabilityGatePath
  );
}

function findRuntimeObservabilityCheck(checks: WechatManualReviewCheck[] | undefined): WechatManualReviewCheck | undefined {
  return checks?.find((check) => {
    const matcher = `${check.id ?? ""} ${check.title ?? ""}`.toLowerCase();
    return matcher.includes("observability");
  });
}

function selectRelevantWechatBlockers(blockers: WechatCandidateSummary["blockers"]): WechatCandidateSummary["blockers"] {
  const prioritized = blockers?.filter((blocker) => {
    const matcher = `${blocker.id ?? ""} ${blocker.summary ?? ""}`.toLowerCase();
    return matcher.includes("manual") || matcher.includes("smoke") || matcher.includes("observability");
  });
  return prioritized && prioritized.length > 0 ? prioritized : blockers;
}

function normalizeStatus(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function collectManualEvidenceFindings(
  sources: ManualEvidenceSource[],
  expectedCandidate: string,
  expectedRevision: string,
  maxAgeMs: number,
  severity: FindingSeverity
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const source of sources) {
    const status = normalizeStatus(source.status);
    if (source.candidate?.trim() && source.candidate.trim() !== expectedCandidate) {
      findings.push(
        createFinding(
          severity,
          "candidate_mismatch",
          `${source.label} reports candidate ${source.candidate}, expected ${expectedCandidate}.`,
          source.artifactPath
        )
      );
    }
    if (!revisionsMatch(source.revision, expectedRevision)) {
      findings.push(
        createFinding(
          severity,
          "revision_mismatch",
          `${source.label} reports revision ${source.revision ?? "<missing>"}, expected ${expectedRevision}.`,
          source.artifactPath
        )
      );
    }
    if (LEDGER_PENDING_STATUSES.has(status) || status === "pending") {
      findings.push(createFinding(severity, "manual_pending", `${source.label} is still ${source.status ?? "pending"}.`, source.artifactPath));
    } else if (status === "failed" || status === "blocked") {
      findings.push(
        createFinding(
          severity,
          status === "blocked" ? "blocked" : "manual_failed",
          `${source.label} is ${source.status ?? "failed"}.`,
          source.artifactPath
        )
      );
    }
    const freshness = evaluateFreshness(source.observedAt, maxAgeMs);
    maybeAddFreshnessFinding(findings, severity, freshness, source.label, source.observedAt, maxAgeMs, source.artifactPath);
  }
  return findings;
}

function buildManualEvidenceFamilyReport(input: {
  id: ManualEvidenceFamilyId;
  label: string;
  severity: FindingSeverity;
  applicable: boolean;
  sources: ManualEvidenceSource[];
  expectedCandidate: string;
  expectedRevision: string;
  maxAgeMs: number;
}): ManualEvidenceFamilyReport {
  const artifactPaths = [...new Set(input.sources.map((source) => source.artifactPath).filter((value): value is string => Boolean(value)))];
  if (!input.applicable) {
    return {
      id: input.id,
      label: input.label,
      severity: input.severity,
      required: false,
      applicable: false,
      status: "passed",
      summary: `${input.label} is not required for this candidate.`,
      artifactPaths,
      findings: []
    };
  }

  if (input.sources.length === 0) {
    const findings = [createFinding(input.severity, "missing", `${input.label} is missing for candidate ${input.expectedRevision}.`)];
    return {
      id: input.id,
      label: input.label,
      severity: input.severity,
      required: input.severity === "blocking",
      applicable: true,
      status: getFamilyStatus(findings, input.severity),
      summary: `${input.label} is missing for candidate ${input.expectedRevision}.`,
      artifactPaths,
      findings
    };
  }

  const findings = collectManualEvidenceFindings(
    input.sources,
    input.expectedCandidate,
    input.expectedRevision,
    input.maxAgeMs,
    input.severity
  );
  return {
    id: input.id,
    label: input.label,
    severity: input.severity,
    required: input.severity === "blocking",
    applicable: true,
    status: getFamilyStatus(findings, input.severity),
    summary:
      findings.length === 0
        ? `${input.label} is current for candidate ${input.expectedRevision}.`
        : `${input.label} ${input.severity === "blocking" ? "blocks" : "warns for"} candidate ${input.expectedRevision}: ${findings[0]?.summary}`,
    artifactPaths,
    findings
  };
}

function buildManualEvidenceContractReport(input: {
  candidate: string;
  expectedRevision: string;
  maxAgeMs: number;
  wechatSurfaceRequired: boolean;
  ledger: ManualEvidenceOwnerLedger | undefined;
  wechatSummary: WechatCandidateSummary | undefined;
  wechatCandidateSummaryPath: string | undefined;
}): ManualEvidenceContractReport {
  const ledgerRows = input.ledger?.rows ?? [];
  const manualReviewChecks = (input.wechatSummary?.evidence?.manualReview?.checks ?? []).filter((check) => check.required !== false);

  const runtimeObservabilitySources: ManualEvidenceSource[] = [
    ...ledgerRows
      .filter((row) => RUNTIME_OBSERVABILITY_LEDGER_EVIDENCE_TYPES.has(row.evidenceType))
      .map((row) => ({
        label: `Ledger row ${row.evidenceType}`,
        candidate: row.candidate,
        revision: row.revision,
        observedAt: row.lastUpdated,
        status: row.status,
        artifactPath: row.artifactPath
      })),
    ...manualReviewChecks
      .filter((check) => `${check.id ?? ""} ${check.title ?? ""}`.toLowerCase().includes("observability"))
      .map((check) => ({
        label: check.title ?? check.id ?? "WeChat runtime observability sign-off",
        revision: check.revision,
        observedAt: check.recordedAt,
        status: check.status,
        artifactPath: check.artifactPath ?? input.wechatCandidateSummaryPath
      }))
  ];

  const cocosRcSignoffSources: ManualEvidenceSource[] = ledgerRows
    .filter((row) => COCOS_RC_SIGNOFF_LEDGER_EVIDENCE_TYPES.has(row.evidenceType))
    .map((row) => ({
      label: `Ledger row ${row.evidenceType}`,
      candidate: row.candidate,
      revision: row.revision,
      observedAt: row.lastUpdated,
      status: row.status,
      artifactPath: row.artifactPath
    }));

  const wechatReleaseApplicable = input.wechatSurfaceRequired || isWechatEvidenceApplicable(input.ledger, input.wechatCandidateSummaryPath);
  const wechatReleaseSignoffSources: ManualEvidenceSource[] = [
    ...ledgerRows
      .filter((row) => WECHAT_RELEASE_SIGNOFF_LEDGER_EVIDENCE_TYPES.has(row.evidenceType))
      .map((row) => ({
        label: `Ledger row ${row.evidenceType}`,
        candidate: row.candidate,
        revision: row.revision,
        observedAt: row.lastUpdated,
        status: row.status,
        artifactPath: row.artifactPath
      })),
    ...manualReviewChecks
      .filter((check) => {
        const matcher = `${check.id ?? ""} ${check.title ?? ""}`.toLowerCase();
        return matcher.includes("devtools") || matcher.includes("device runtime") || matcher.includes("checklist");
      })
      .map((check) => ({
        label: check.title ?? check.id ?? "WeChat release sign-off",
        revision: check.revision,
        observedAt: check.recordedAt,
        status: check.status,
        artifactPath: check.artifactPath ?? input.wechatCandidateSummaryPath
      }))
  ];

  const reconnectFollowupSources: ManualEvidenceSource[] = ledgerRows
    .filter((row) => {
      const matcher = `${row.evidenceType} ${row.notes ?? ""}`.toLowerCase();
      return matcher.includes("reconnect") || matcher.includes("persistence");
    })
    .map((row) => ({
      label: `Ledger row ${row.evidenceType}`,
      candidate: row.candidate,
      revision: row.revision,
      observedAt: row.lastUpdated,
      status: row.status,
      artifactPath: row.artifactPath
    }));

  const requiredFamilies = [
    buildManualEvidenceFamilyReport({
      id: "runtime-observability",
      label: "Runtime observability review",
      severity: input.wechatSurfaceRequired ? "blocking" : "warning",
      applicable: input.wechatSurfaceRequired || runtimeObservabilitySources.length > 0,
      sources: runtimeObservabilitySources,
      expectedCandidate: input.candidate,
      expectedRevision: input.expectedRevision,
      maxAgeMs: input.maxAgeMs
    }),
    buildManualEvidenceFamilyReport({
      id: "cocos-rc-signoff",
      label: "Cocos RC sign-off",
      severity: "blocking",
      applicable: true,
      sources: cocosRcSignoffSources,
      expectedCandidate: input.candidate,
      expectedRevision: input.expectedRevision,
      maxAgeMs: input.maxAgeMs
    }),
    buildManualEvidenceFamilyReport({
      id: "wechat-release-signoff",
      label: "WeChat release sign-off",
      severity: input.wechatSurfaceRequired ? "blocking" : "warning",
      applicable: wechatReleaseApplicable,
      sources: wechatReleaseSignoffSources,
      expectedCandidate: input.candidate,
      expectedRevision: input.expectedRevision,
      maxAgeMs: input.maxAgeMs
    }),
    buildManualEvidenceFamilyReport({
      id: "reconnect-followup",
      label: "Reconnect or persistence follow-up",
      severity: "warning",
      applicable: reconnectFollowupSources.length > 0,
      sources: reconnectFollowupSources,
      expectedCandidate: input.candidate,
      expectedRevision: input.expectedRevision,
      maxAgeMs: input.maxAgeMs
    })
  ];

  const blockerCount = requiredFamilies.reduce(
    (count, family) => count + family.findings.filter((finding) => finding.severity === "blocking").length,
    0
  );
  const warningCount = requiredFamilies.reduce(
    (count, family) => count + family.findings.filter((finding) => finding.severity === "warning").length,
    0
  );
  const status = getStatusFromCounts(blockerCount, warningCount);
  const leadFamily = requiredFamilies.find((family) => family.findings.length > 0);
  return {
    status,
    summary:
      status === "passed"
        ? `Required manual evidence families are current for ${input.candidate} at ${input.expectedRevision}.`
        : `${status === "failed" ? "Blocking" : "Advisory"} manual evidence family: ${leadFamily?.summary}`,
    requiredFamilies
  };
}

function collectTriageEntries(
  artifactFamilies: ArtifactFamilyReport[],
  manualEvidenceFamilies: ManualEvidenceFamilyReport[]
): { blockers: AuditTriageEntry[]; warnings: AuditTriageEntry[] } {
  const entries: AuditTriageEntry[] = [
    ...artifactFamilies.flatMap((family) =>
      family.findings.map((finding) => ({
        scope: "artifact-family" as const,
        familyId: family.id,
        familyLabel: family.label,
        code: finding.code,
        severity: finding.severity,
        summary: finding.summary,
        ...(finding.artifactPath ? { artifactPath: finding.artifactPath } : {})
      }))
    ),
    ...manualEvidenceFamilies.flatMap((family) =>
      family.findings.map((finding) => ({
        scope: "manual-contract" as const,
        familyId: family.id,
        familyLabel: family.label,
        code: finding.code,
        severity: finding.severity,
        summary: finding.summary,
        ...(finding.artifactPath ? { artifactPath: finding.artifactPath } : {})
      }))
    )
  ];
  return {
    blockers: entries.filter((entry) => entry.severity === "blocking"),
    warnings: entries.filter((entry) => entry.severity === "warning")
  };
}

function getOwnerLedgerEvidenceTypesForArtifactFamily(
  familyId: ArtifactFamilyReport["id"]
): string[] {
  switch (familyId) {
    case "cocos-rc-bundle":
    case "cocos-rc-snapshot":
    case "cocos-primary-journey-evidence":
      return [...COCOS_RC_SIGNOFF_LEDGER_EVIDENCE_TYPES];
    case "runtime-observability-evidence":
    case "runtime-observability-gate":
      return [...RUNTIME_OBSERVABILITY_LEDGER_EVIDENCE_TYPES];
    case "wechat-release-evidence":
      return [...WECHAT_RELEASE_SIGNOFF_LEDGER_EVIDENCE_TYPES];
    default:
      return [];
  }
}

function getReminderCondition(findings: AuditFinding[], hasOwnerAssignment: boolean): OwnerReminderCondition | undefined {
  if (!hasOwnerAssignment) {
    return "missing_owner_assignment";
  }
  if (findings.some((finding) => finding.code === "missing")) {
    return "missing_artifact";
  }
  if (findings.some((finding) => finding.code === "stale")) {
    return "stale_artifact";
  }
  return undefined;
}

export function buildOwnerReminderReport(
  auditReport: CandidateEvidenceAuditReport,
  ledger: ManualEvidenceOwnerLedger | undefined
): CandidateOwnerReminderReport {
  const ledgerPath = auditReport.inputs.manualEvidenceLedgerPath;
  const items: OwnerReminderEntry[] = [];

  for (const family of auditReport.artifactFamilies) {
    const relevantFindings = family.findings.filter((finding) => finding.code === "missing" || finding.code === "stale");
    if (relevantFindings.length === 0) {
      continue;
    }

    const ownerLedgerEvidenceTypes = getOwnerLedgerEvidenceTypesForArtifactFamily(family.id);
    const matchingRows =
      ownerLedgerEvidenceTypes.length === 0
        ? []
        : (ledger?.rows ?? []).filter((row) => ownerLedgerEvidenceTypes.includes(row.evidenceType));
    const expectedOwners = Array.from(
      new Set(
        matchingRows
          .map((row) => row.owner?.trim())
          .filter((owner): owner is string => Boolean(owner))
      )
    );
    const hasOwnerAssignment =
      expectedOwners.length > 0 || (family.id === "manual-evidence-ledger" && Boolean(ledger?.metadata.releaseOwner?.trim()));
    const condition = getReminderCondition(relevantFindings, hasOwnerAssignment);
    if (!condition) {
      continue;
    }

    const ownerLedgerReference =
      family.id === "manual-evidence-ledger" && ledger?.metadata.releaseOwner?.trim()
        ? `release owner \`${ledger.metadata.releaseOwner.trim()}\`${ledgerPath ? ` via \`${toRelativePath(ledgerPath)}\`` : ""}`
        : ownerLedgerEvidenceTypes.length === 0
          ? `no owner ledger evidence mapping is defined for ${family.label}${ledgerPath ? ` in \`${toRelativePath(ledgerPath)}\`` : ""}`
          : matchingRows.length === 0
            ? `ledger is missing expected row(s) for ${ownerLedgerEvidenceTypes.map((type) => `\`${type}\``).join(", ")}${
                ledgerPath ? ` in \`${toRelativePath(ledgerPath)}\`` : ""
              }`
            : `${ownerLedgerEvidenceTypes.map((type) => `\`${type}\``).join(", ")}${ledgerPath ? ` from \`${toRelativePath(ledgerPath)}\`` : ""}`;

    items.push({
      artifactFamilyId: family.id,
      artifactFamilyLabel: family.label,
      condition,
      severity: family.severity,
      summary: relevantFindings.map((finding) => finding.summary).join(" "),
      ...(family.artifactPath ? { artifactPath: family.artifactPath } : {}),
      expectedOwners:
        family.id === "manual-evidence-ledger" && ledger?.metadata.releaseOwner?.trim()
          ? [ledger.metadata.releaseOwner.trim()]
          : expectedOwners,
      ownerLedgerEvidenceTypes,
      ownerLedgerReference,
      sourceFindingCodes: relevantFindings.map((finding) => finding.code)
    });
  }

  const missingArtifactCount = items.filter((item) => item.condition === "missing_artifact").length;
  const staleArtifactCount = items.filter((item) => item.condition === "stale_artifact").length;
  const missingOwnerAssignmentCount = items.filter((item) => item.condition === "missing_owner_assignment").length;
  const status: AuditStatus = items.some((item) => item.severity === "blocking") ? "failed" : items.length > 0 ? "warning" : "passed";

  return {
    schemaVersion: 1,
    generatedAt: auditReport.generatedAt,
    candidate: auditReport.candidate,
    summary: {
      status,
      itemCount: items.length,
      missingArtifactCount,
      staleArtifactCount,
      missingOwnerAssignmentCount,
      summary:
        items.length === 0
          ? `No stale or missing candidate artifacts require owner follow-up for ${auditReport.candidate.name}.`
          : `${items.length} owner reminder item(s): ${missingArtifactCount} missing artifact, ${staleArtifactCount} stale artifact, ${missingOwnerAssignmentCount} missing owner assignment.`
    },
    inputs: {
      ...(ledgerPath ? { manualEvidenceLedgerPath: ledgerPath } : {})
    },
    items
  };
}

function defaultFreshnessHistoryOutputPath(args: Args): string {
  const baseDir = args.outputPath
    ? path.dirname(path.resolve(args.outputPath))
    : args.markdownOutputPath
      ? path.dirname(path.resolve(args.markdownOutputPath))
      : DEFAULT_RELEASE_READINESS_DIR;
  return path.resolve(baseDir, `candidate-evidence-freshness-history-${slugifyCandidate(args.candidate)}.json`);
}

function toHistoryEntry(report: CandidateEvidenceAuditReport): CandidateEvidenceFreshnessHistoryEntry {
  return {
    auditTimestamp: report.generatedAt,
    candidateRevision: report.candidate.revision,
    targetSurface: report.candidate.targetSurface,
    overallStatus: report.summary.status,
    blockerCount: report.summary.blockerCount,
    warningCount: report.summary.warningCount,
    findingCount: report.summary.findingCount,
    summary: report.summary.summary,
    blockingFindings: report.triage.blockers,
    warnings: report.triage.warnings,
    artifactFamilies: report.artifactFamilies.map((family) => ({
      id: family.id,
      label: family.label,
      status: family.status,
      freshness: family.freshness,
      ...(family.generatedAt ? { generatedAt: family.generatedAt } : {}),
      ...(family.revision ? { revision: family.revision } : {}),
      ...(family.candidate ? { candidate: family.candidate } : {}),
      ...(family.artifactPath ? { artifactPath: family.artifactPath } : {}),
      findingCodes: family.findings.map((finding) => finding.code)
    }))
  };
}

function readFreshnessHistory(filePath: string, candidate: string): CandidateEvidenceFreshnessHistoryReport {
  if (!fs.existsSync(filePath)) {
    return {
      schemaVersion: 1,
      candidate: {
        name: candidate
      },
      generatedAt: new Date(0).toISOString(),
      entries: []
    };
  }

  const parsed = readJsonFile<CandidateEvidenceFreshnessHistoryReport>(filePath);
  return {
    schemaVersion: 1,
    candidate: {
      name: parsed.candidate?.name || candidate
    },
    generatedAt: parsed.generatedAt ?? new Date(0).toISOString(),
    entries: Array.isArray(parsed.entries) ? parsed.entries : []
  };
}

export function appendFreshnessHistory(
  historyPath: string,
  report: CandidateEvidenceAuditReport
): CandidateEvidenceFreshnessHistoryReport {
  const history = readFreshnessHistory(historyPath, report.candidate.name);
  const nextHistory: CandidateEvidenceFreshnessHistoryReport = {
    schemaVersion: 1,
    candidate: {
      name: report.candidate.name
    },
    generatedAt: report.generatedAt,
    entries: [...history.entries, toHistoryEntry(report)]
  };
  writeJsonFile(historyPath, nextHistory);
  return nextHistory;
}

export function buildSameCandidateEvidenceAuditReport(args: Args): CandidateEvidenceAuditReport {
  const snapshotPath = resolveSnapshotPath(args);
  const releaseGateSummaryPath = resolveReleaseGateSummaryPath(args);
  const cocosRcBundlePath = resolveCocosRcBundlePath(args);
  const runtimeObservabilityEvidencePath = resolveRuntimeObservabilityEvidencePath(args);
  const runtimeObservabilityGatePath = resolveRuntimeObservabilityGatePath(args);
  const manualEvidenceLedgerPath = resolveManualEvidenceLedgerPath(args);
  const wechatCandidateSummaryPath = resolveWechatCandidateSummaryPath(args);
  const expectedRevision = args.candidateRevision;
  const maxAgeMs = args.maxAgeHours * 60 * 60 * 1000;

  const parsedLedger =
    manualEvidenceLedgerPath && fs.existsSync(manualEvidenceLedgerPath) ? parseManualEvidenceOwnerLedger(manualEvidenceLedgerPath) : undefined;
  const parsedWechatSummary =
    wechatCandidateSummaryPath && fs.existsSync(wechatCandidateSummaryPath)
      ? readJsonFile<WechatCandidateSummary>(wechatCandidateSummaryPath)
      : undefined;
  const wechatSurfaceRequired = isWechatSurfaceRequired({
    targetSurface: args.targetSurface,
    ledger: parsedLedger,
    wechatCandidateSummaryPath,
    runtimeObservabilityEvidencePath,
    runtimeObservabilityGatePath
  });

  const artifactFamilies: ArtifactFamilyReport[] = [];

  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    artifactFamilies.push(buildMissingFamily("release-readiness-snapshot", "Release readiness snapshot", "blocking", true, true));
  } else {
    const snapshot = readJsonFile<ReleaseReadinessSnapshot>(snapshotPath);
    const findings: AuditFinding[] = [];
    const freshness = addCommonFindings(findings, {
      severity: "blocking",
      label: "Release readiness snapshot",
      candidate: undefined,
      revision: snapshot.revision?.commit ?? snapshot.revision?.shortCommit,
      generatedAt: snapshot.generatedAt,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: snapshotPath
    });
    artifactFamilies.push({
      id: "release-readiness-snapshot",
      label: "Release readiness snapshot",
      severity: "blocking",
      required: true,
      applicable: true,
      status: getFamilyStatus(findings, "blocking"),
      artifactPath: snapshotPath,
      revision: snapshot.revision?.commit ?? snapshot.revision?.shortCommit,
      generatedAt: snapshot.generatedAt,
      freshness,
      findings
    });
  }

  if (!releaseGateSummaryPath || !fs.existsSync(releaseGateSummaryPath)) {
    artifactFamilies.push(buildMissingFamily("release-gate-summary", "Release gate summary", "blocking", true, true));
  } else {
    const report = readJsonFile<ReleaseGateSummaryReport>(releaseGateSummaryPath);
    const findings: AuditFinding[] = [];
    const freshness = addCommonFindings(findings, {
      severity: "blocking",
      label: "Release gate summary",
      candidate: undefined,
      revision: report.revision?.commit ?? report.revision?.shortCommit,
      generatedAt: report.generatedAt,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: releaseGateSummaryPath
    });
    const linkedSnapshotFinding = compareLinkedSnapshot(snapshotPath, report.inputs?.snapshotPath, "Release gate summary", "blocking");
    if (linkedSnapshotFinding) {
      findings.push(linkedSnapshotFinding);
    }
    artifactFamilies.push({
      id: "release-gate-summary",
      label: "Release gate summary",
      severity: "blocking",
      required: true,
      applicable: true,
      status: getFamilyStatus(findings, "blocking"),
      artifactPath: releaseGateSummaryPath,
      revision: report.revision?.commit ?? report.revision?.shortCommit,
      generatedAt: report.generatedAt,
      freshness,
      findings
    });
  }

  if (!cocosRcBundlePath || !fs.existsSync(cocosRcBundlePath)) {
    artifactFamilies.push(buildMissingFamily("cocos-rc-bundle", "Cocos RC bundle", "blocking", true, true));
  } else {
    const bundle = readJsonFile<CocosRcBundleManifest>(cocosRcBundlePath);
    const findings: AuditFinding[] = [];
    const freshness = addCommonFindings(findings, {
      severity: "blocking",
      label: "Cocos RC bundle",
      candidate: bundle.bundle?.candidate,
      revision: bundle.bundle?.commit ?? bundle.bundle?.shortCommit,
      generatedAt: bundle.bundle?.generatedAt,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: cocosRcBundlePath
    });
    const linkedSnapshotFinding = compareLinkedSnapshot(
      snapshotPath,
      bundle.linkedEvidence?.releaseReadinessSnapshot?.path,
      "Cocos RC bundle",
      "blocking"
    );
    if (linkedSnapshotFinding) {
      findings.push(linkedSnapshotFinding);
    }
    artifactFamilies.push({
      id: "cocos-rc-bundle",
      label: "Cocos RC bundle",
      severity: "blocking",
      required: true,
      applicable: true,
      status: getFamilyStatus(findings, "blocking"),
      artifactPath: cocosRcBundlePath,
      revision: bundle.bundle?.commit ?? bundle.bundle?.shortCommit,
      candidate: bundle.bundle?.candidate,
      generatedAt: bundle.bundle?.generatedAt,
      freshness,
      findings
    });

    const cocosRcSnapshotPath = bundle.artifacts?.snapshot ? path.resolve(bundle.artifacts.snapshot) : undefined;
    if (!cocosRcSnapshotPath || !fs.existsSync(cocosRcSnapshotPath)) {
      artifactFamilies.push(buildMissingFamily("cocos-rc-snapshot", "Cocos RC snapshot", "blocking", true, true));
    } else {
      const snapshot = readJsonFile<CocosRcSnapshotArtifact>(cocosRcSnapshotPath);
      const snapshotFindings: AuditFinding[] = [];
      const snapshotFreshness = addCommonFindings(snapshotFindings, {
        severity: "blocking",
        label: "Cocos RC snapshot",
        candidate: snapshot.candidate?.name,
        revision: snapshot.candidate?.commit ?? snapshot.candidate?.shortCommit,
        generatedAt: snapshot.execution?.executedAt,
        expectedCandidate: args.candidate,
        expectedRevision,
        maxAgeMs,
        artifactPath: cocosRcSnapshotPath
      });
      const linkedBundleSnapshotFinding = compareLinkedSnapshot(
        snapshotPath,
        snapshot.linkedEvidence?.releaseReadinessSnapshot?.path,
        "Cocos RC snapshot",
        "blocking"
      );
      if (linkedBundleSnapshotFinding) {
        snapshotFindings.push(linkedBundleSnapshotFinding);
      }
      const linkedPrimaryJourneyFinding = compareLinkedArtifact(
        bundle.artifacts?.primaryJourneyEvidence ? path.resolve(bundle.artifacts.primaryJourneyEvidence) : undefined,
        snapshot.linkedEvidence?.primaryJourneyEvidence?.path,
        "Cocos RC snapshot",
        "blocking"
      );
      if (linkedPrimaryJourneyFinding) {
        snapshotFindings.push(linkedPrimaryJourneyFinding);
      }
      artifactFamilies.push({
        id: "cocos-rc-snapshot",
        label: "Cocos RC snapshot",
        severity: "blocking",
        required: true,
        applicable: true,
        status: getFamilyStatus(snapshotFindings, "blocking"),
        artifactPath: cocosRcSnapshotPath,
        revision: snapshot.candidate?.commit ?? snapshot.candidate?.shortCommit,
        candidate: snapshot.candidate?.name,
        generatedAt: snapshot.execution?.executedAt,
        freshness: snapshotFreshness,
        findings: snapshotFindings
      });
    }

    const primaryJourneyEvidencePath = bundle.artifacts?.primaryJourneyEvidence
      ? path.resolve(bundle.artifacts.primaryJourneyEvidence)
      : undefined;
    if (!primaryJourneyEvidencePath || !fs.existsSync(primaryJourneyEvidencePath)) {
      artifactFamilies.push(
        buildMissingFamily("cocos-primary-journey-evidence", "Cocos primary-journey evidence", "blocking", true, true)
      );
    } else {
      const primaryJourneyEvidence = readJsonFile<CocosPrimaryJourneyEvidenceArtifact>(primaryJourneyEvidencePath);
      const primaryJourneyFindings: AuditFinding[] = [];
      const primaryJourneyFreshness = addCommonFindings(primaryJourneyFindings, {
        severity: "blocking",
        label: "Cocos primary-journey evidence",
        candidate: primaryJourneyEvidence.candidate?.name,
        revision: primaryJourneyEvidence.candidate?.commit ?? primaryJourneyEvidence.candidate?.shortCommit,
        generatedAt: primaryJourneyEvidence.execution?.completedAt,
        expectedCandidate: args.candidate,
        expectedRevision,
        maxAgeMs,
        artifactPath: primaryJourneyEvidencePath
      });
      artifactFamilies.push({
        id: "cocos-primary-journey-evidence",
        label: "Cocos primary-journey evidence",
        severity: "blocking",
        required: true,
        applicable: true,
        status: getFamilyStatus(primaryJourneyFindings, "blocking"),
        artifactPath: primaryJourneyEvidencePath,
        revision: primaryJourneyEvidence.candidate?.commit ?? primaryJourneyEvidence.candidate?.shortCommit,
        candidate: primaryJourneyEvidence.candidate?.name,
        generatedAt: primaryJourneyEvidence.execution?.completedAt,
        freshness: primaryJourneyFreshness,
        findings: primaryJourneyFindings
      });
    }
  }

  const runtimeSeverity: FindingSeverity = wechatSurfaceRequired ? "blocking" : "warning";
  const runtimeApplicable = wechatSurfaceRequired || Boolean(runtimeObservabilityEvidencePath || runtimeObservabilityGatePath);

  if (runtimeApplicable) {
    if (!runtimeObservabilityEvidencePath || !fs.existsSync(runtimeObservabilityEvidencePath)) {
      artifactFamilies.push(
        buildMissingFamily(
          "runtime-observability-evidence",
          "Runtime observability evidence",
          runtimeSeverity,
          wechatSurfaceRequired,
          true
        )
      );
    } else {
      const runtimeEvidence = readJsonFile<RuntimeObservabilityEvidenceReport>(runtimeObservabilityEvidencePath);
      const findings: AuditFinding[] = [];
      const freshness = addCommonFindings(findings, {
        severity: runtimeSeverity,
        label: "Runtime observability evidence",
        candidate: runtimeEvidence.candidate?.name,
        revision: runtimeEvidence.candidate?.revision ?? runtimeEvidence.candidate?.shortRevision,
        generatedAt: runtimeEvidence.generatedAt,
        expectedCandidate: args.candidate,
        expectedRevision,
        maxAgeMs,
        artifactPath: runtimeObservabilityEvidencePath
      });
      artifactFamilies.push({
        id: "runtime-observability-evidence",
        label: "Runtime observability evidence",
        severity: runtimeSeverity,
        required: wechatSurfaceRequired,
        applicable: true,
        status: getFamilyStatus(findings, runtimeSeverity),
        artifactPath: runtimeObservabilityEvidencePath,
        revision: runtimeEvidence.candidate?.revision ?? runtimeEvidence.candidate?.shortRevision,
        candidate: runtimeEvidence.candidate?.name,
        generatedAt: runtimeEvidence.generatedAt,
        freshness,
        findings
      });
    }

    if (!runtimeObservabilityGatePath || !fs.existsSync(runtimeObservabilityGatePath)) {
      artifactFamilies.push(
        buildMissingFamily("runtime-observability-gate", "Runtime observability gate", runtimeSeverity, wechatSurfaceRequired, true)
      );
    } else {
      const runtimeGate = readJsonFile<RuntimeObservabilityGateReport>(runtimeObservabilityGatePath);
      const findings: AuditFinding[] = [];
      const freshness = addCommonFindings(findings, {
        severity: runtimeSeverity,
        label: "Runtime observability gate",
        candidate: runtimeGate.candidate?.name,
        revision: runtimeGate.candidate?.revision ?? runtimeGate.candidate?.shortRevision,
        generatedAt: runtimeGate.generatedAt,
        expectedCandidate: args.candidate,
        expectedRevision,
        maxAgeMs,
        artifactPath: runtimeObservabilityGatePath
      });
      const linkedEvidenceFinding = compareLinkedArtifact(
        runtimeObservabilityEvidencePath,
        runtimeGate.evidenceSource?.artifactPath,
        "Runtime observability gate",
        runtimeSeverity
      );
      if (linkedEvidenceFinding) {
        findings.push(linkedEvidenceFinding);
      }
      artifactFamilies.push({
        id: "runtime-observability-gate",
        label: "Runtime observability gate",
        severity: runtimeSeverity,
        required: wechatSurfaceRequired,
        applicable: true,
        status: getFamilyStatus(findings, runtimeSeverity),
        artifactPath: runtimeObservabilityGatePath,
        revision: runtimeGate.candidate?.revision ?? runtimeGate.candidate?.shortRevision,
        candidate: runtimeGate.candidate?.name,
        generatedAt: runtimeGate.generatedAt,
        freshness,
        findings
      });
    }
  }

  if (!manualEvidenceLedgerPath || !fs.existsSync(manualEvidenceLedgerPath)) {
    artifactFamilies.push(buildMissingFamily("manual-evidence-ledger", "Manual evidence owner ledger", "blocking", true, true));
  } else {
    const ledger = parsedLedger ?? parseManualEvidenceOwnerLedger(manualEvidenceLedgerPath);
    const findings: AuditFinding[] = [];
    const freshness = addCommonFindings(findings, {
      severity: "blocking",
      label: "Manual evidence owner ledger",
      candidate: ledger.metadata.candidate,
      revision: ledger.metadata.targetRevision,
      generatedAt: ledger.metadata.lastUpdated,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: manualEvidenceLedgerPath
    });
    const linkedSnapshotFinding = compareLinkedSnapshot(
      snapshotPath,
      ledger.metadata.linkedReadinessSnapshot,
      "Manual evidence owner ledger",
      "blocking"
    );
    if (linkedSnapshotFinding) {
      findings.push(linkedSnapshotFinding);
    }
    for (const row of ledger.rows) {
      if ((row.status ?? "").toLowerCase() === "waived") {
        continue;
      }
      if (LEDGER_PENDING_STATUSES.has((row.status ?? "").toLowerCase())) {
        findings.push(
          createFinding(
            "blocking",
            "manual_pending",
            `Manual evidence ledger still lists ${row.evidenceType} as ${row.status}.`,
            row.artifactPath
          )
        );
      }
      const rowFreshness = evaluateFreshness(row.lastUpdated, maxAgeMs);
      maybeAddFreshnessFinding(
        findings,
        "blocking",
        rowFreshness,
        `Manual evidence ledger row ${row.evidenceType}`,
        row.lastUpdated,
        maxAgeMs,
        row.artifactPath
      );
    }
    artifactFamilies.push({
      id: "manual-evidence-ledger",
      label: "Manual evidence owner ledger",
      severity: "blocking",
      required: true,
      applicable: true,
      status: getFamilyStatus(findings, "blocking"),
      artifactPath: manualEvidenceLedgerPath,
      revision: ledger.metadata.targetRevision,
      candidate: ledger.metadata.candidate,
      generatedAt: ledger.metadata.lastUpdated,
      freshness,
      findings
    });
  }

  const wechatSummaryApplicable = wechatSurfaceRequired || isWechatEvidenceApplicable(parsedLedger, wechatCandidateSummaryPath);
  if (wechatSummaryApplicable) {
    const wechatSeverity: FindingSeverity = wechatSurfaceRequired ? "blocking" : "warning";
    if (!wechatCandidateSummaryPath || !fs.existsSync(wechatCandidateSummaryPath)) {
      artifactFamilies.push(
        buildMissingFamily("wechat-release-evidence", "WeChat release evidence summary", wechatSeverity, wechatSurfaceRequired, true)
      );
    } else {
      const summary = parsedWechatSummary ?? readJsonFile<WechatCandidateSummary>(wechatCandidateSummaryPath);
      const findings: AuditFinding[] = [];
      const freshness = addCommonFindings(findings, {
        severity: wechatSeverity,
        label: "WeChat release evidence summary",
        candidate: undefined,
        revision: summary.candidate?.revision,
        generatedAt: summary.generatedAt,
        expectedCandidate: args.candidate,
        expectedRevision,
        maxAgeMs,
        artifactPath: wechatCandidateSummaryPath
      });

      const manualReview = summary.evidence?.manualReview;
      if ((manualReview?.requiredPendingChecks ?? 0) > 0) {
        findings.push(
          createFinding(
            wechatSeverity,
            "manual_pending",
            `WeChat release evidence still has ${manualReview?.requiredPendingChecks} required manual review item(s) pending.`,
            wechatCandidateSummaryPath
          )
        );
      }
      if ((manualReview?.requiredFailedChecks ?? 0) > 0) {
        findings.push(
          createFinding(
            wechatSeverity,
            "manual_failed",
            `WeChat release evidence reports ${manualReview?.requiredFailedChecks} required manual review failure(s).`,
            wechatCandidateSummaryPath
          )
        );
      }
      if ((manualReview?.requiredMetadataFailures ?? 0) > 0) {
        findings.push(
          createFinding(
            wechatSeverity,
            "metadata_failure",
            `WeChat release evidence reports ${manualReview?.requiredMetadataFailures} manual review metadata failure(s).`,
            wechatCandidateSummaryPath
          )
        );
      }

      const runtimeObservabilityCheck = findRuntimeObservabilityCheck(manualReview?.checks);
      if (!runtimeObservabilityCheck && wechatSurfaceRequired) {
        findings.push(
          createFinding(
            wechatSeverity,
            "missing",
            "WeChat release evidence is missing a runtime observability sign-off check.",
            wechatCandidateSummaryPath
          )
        );
      } else if (runtimeObservabilityCheck) {
        const runtimeArtifactPath = runtimeObservabilityCheck.artifactPath || wechatCandidateSummaryPath;
        if (runtimeObservabilityCheck.status === "pending") {
          findings.push(
            createFinding(
              wechatSeverity,
              "manual_pending",
              `Runtime observability sign-off is still pending: ${
                runtimeObservabilityCheck.title ?? runtimeObservabilityCheck.id ?? "runtime observability"
              }.`,
              runtimeArtifactPath
            )
          );
        } else if (runtimeObservabilityCheck.status === "failed") {
          findings.push(
            createFinding(
              wechatSeverity,
              "manual_failed",
              `Runtime observability sign-off failed: ${
                runtimeObservabilityCheck.title ?? runtimeObservabilityCheck.id ?? "runtime observability"
              }.`,
              runtimeArtifactPath
            )
          );
        }
        if (!revisionsMatch(runtimeObservabilityCheck.revision, expectedRevision)) {
          findings.push(
            createFinding(
              wechatSeverity,
              "revision_mismatch",
              `Runtime observability sign-off reports revision ${runtimeObservabilityCheck.revision ?? "<missing>"}, expected ${expectedRevision}.`,
              runtimeArtifactPath
            )
          );
        }
        const runtimeFreshness = evaluateFreshness(runtimeObservabilityCheck.recordedAt, maxAgeMs);
        maybeAddFreshnessFinding(
          findings,
          wechatSeverity,
          runtimeFreshness,
          "Runtime observability sign-off",
          runtimeObservabilityCheck.recordedAt,
          maxAgeMs,
          runtimeArtifactPath
        );
      }

      if (summary.candidate?.status === "blocked" && (summary.blockers?.length ?? 0) > 0) {
        for (const blocker of selectRelevantWechatBlockers(summary.blockers)?.slice(0, 3) ?? []) {
          findings.push(
            createFinding(
              wechatSeverity,
              "blocked",
              `WeChat release evidence is blocked: ${blocker.summary ?? blocker.id ?? "unknown blocker"}.`,
              blocker.artifactPath ?? wechatCandidateSummaryPath
            )
          );
        }
      }

      artifactFamilies.push({
        id: "wechat-release-evidence",
        label: "WeChat release evidence summary",
        severity: wechatSeverity,
        required: wechatSurfaceRequired,
        applicable: true,
        status: getFamilyStatus(findings, wechatSeverity),
        artifactPath: wechatCandidateSummaryPath,
        revision: summary.candidate?.revision ?? undefined,
        generatedAt: summary.generatedAt,
        freshness,
        findings
      });
    }
  }

  const manualEvidenceContract = buildManualEvidenceContractReport({
    candidate: args.candidate,
    expectedRevision,
    maxAgeMs,
    wechatSurfaceRequired,
    ledger: parsedLedger,
    wechatSummary: parsedWechatSummary,
    wechatCandidateSummaryPath
  });
  const triage = collectTriageEntries(artifactFamilies, manualEvidenceContract.requiredFamilies);
  const status = getStatusFromCounts(triage.blockers.length, triage.warnings.length);
  const leadFinding = triage.blockers[0] ?? triage.warnings[0];

  return {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: args.candidate,
      revision: expectedRevision,
      targetSurface: args.targetSurface
    },
    summary: {
      status,
      blockerCount: triage.blockers.length,
      warningCount: triage.warnings.length,
      findingCount: triage.blockers.length + triage.warnings.length,
      summary:
        status === "passed"
          ? `Candidate-level evidence is current for ${args.candidate} at ${expectedRevision}.`
          : `${status === "failed" ? "Blocking" : "Advisory"} evidence audit finding: ${leadFinding?.summary}`
    },
    inputs: {
      targetSurface: args.targetSurface,
      ...(snapshotPath ? { snapshotPath } : {}),
      ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
      ...(cocosRcBundlePath ? { cocosRcBundlePath } : {}),
      ...(runtimeObservabilityEvidencePath ? { runtimeObservabilityEvidencePath } : {}),
      ...(runtimeObservabilityGatePath ? { runtimeObservabilityGatePath } : {}),
      ...(manualEvidenceLedgerPath ? { manualEvidenceLedgerPath } : {}),
      ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath } : {})
    },
    triage,
    manualEvidenceContract,
    artifactFamilies
  };
}

export function renderMarkdown(report: CandidateEvidenceAuditReport): string {
  const lines: string[] = [];
  lines.push("# Candidate-Level Evidence Audit");
  lines.push("");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Candidate revision: \`${report.candidate.revision}\``);
  lines.push(`- Target surface: \`${report.inputs.targetSurface}\``);
  lines.push(`- Overall status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Blocking findings: ${report.summary.blockerCount}`);
  lines.push(`- Advisory warnings: ${report.summary.warningCount}`);
  lines.push(`- Summary: ${report.summary.summary}`);
  lines.push("");
  lines.push("## Review Triage");
  lines.push("");
  lines.push(report.triage.blockers.length === 0 ? "- Blocking findings: none." : "- Blocking findings:");
  for (const entry of report.triage.blockers) {
    lines.push(
      `  - [${entry.familyLabel}] \`${entry.code}\` ${entry.summary}${entry.artifactPath ? ` (artifact: \`${toRelativePath(entry.artifactPath)}\`)` : ""}`
    );
  }
  lines.push(report.triage.warnings.length === 0 ? "- Advisory warnings: none." : "- Advisory warnings:");
  for (const entry of report.triage.warnings) {
    lines.push(
      `  - [${entry.familyLabel}] \`${entry.code}\` ${entry.summary}${entry.artifactPath ? ` (artifact: \`${toRelativePath(entry.artifactPath)}\`)` : ""}`
    );
  }
  lines.push("");
  lines.push("## Manual Evidence Contract");
  lines.push("");
  lines.push(`- Status: **${report.manualEvidenceContract.status.toUpperCase()}**`);
  lines.push(`- Summary: ${report.manualEvidenceContract.summary}`);
  lines.push("");
  for (const family of report.manualEvidenceContract.requiredFamilies) {
    lines.push(`### ${family.label}`);
    lines.push("");
    lines.push(`- Required: \`${family.required ? "yes" : "no"}\``);
    lines.push(`- Applicable: \`${family.applicable ? "yes" : "no"}\``);
    lines.push(`- Severity: \`${family.severity}\``);
    lines.push(`- Status: **${family.status.toUpperCase()}**`);
    lines.push(`- Summary: ${family.summary}`);
    lines.push(
      `- Artifacts: ${family.artifactPaths.length > 0 ? family.artifactPaths.map((artifactPath) => `\`${toRelativePath(artifactPath)}\``).join(", ") : "<none>"}`
    );
    if (family.findings.length === 0) {
      lines.push("- Findings: none.");
    } else {
      lines.push("- Findings:");
      for (const finding of family.findings) {
        lines.push(
          `  - [${finding.severity}] \`${finding.code}\` ${finding.summary}${finding.artifactPath ? ` (artifact: \`${toRelativePath(finding.artifactPath)}\`)` : ""}`
        );
      }
    }
    lines.push("");
  }
  lines.push("## Selected Inputs");
  lines.push("");
  lines.push(`- Release readiness snapshot: \`${report.inputs.snapshotPath ? toRelativePath(report.inputs.snapshotPath) : "<missing>"}\``);
  lines.push(`- Release gate summary: \`${report.inputs.releaseGateSummaryPath ? toRelativePath(report.inputs.releaseGateSummaryPath) : "<missing>"}\``);
  lines.push(`- Cocos RC bundle: \`${report.inputs.cocosRcBundlePath ? toRelativePath(report.inputs.cocosRcBundlePath) : "<missing>"}\``);
  lines.push(
    `- Runtime observability evidence: \`${report.inputs.runtimeObservabilityEvidencePath ? toRelativePath(report.inputs.runtimeObservabilityEvidencePath) : "<not-selected>"}\``
  );
  lines.push(
    `- Runtime observability gate: \`${report.inputs.runtimeObservabilityGatePath ? toRelativePath(report.inputs.runtimeObservabilityGatePath) : "<not-selected>"}\``
  );
  lines.push(`- Manual evidence owner ledger: \`${report.inputs.manualEvidenceLedgerPath ? toRelativePath(report.inputs.manualEvidenceLedgerPath) : "<missing>"}\``);
  lines.push(
    `- WeChat release evidence summary: \`${report.inputs.wechatCandidateSummaryPath ? toRelativePath(report.inputs.wechatCandidateSummaryPath) : "<not-applicable>"}\``
  );
  lines.push("");
  lines.push("## Artifact Families");
  lines.push("");

  for (const family of report.artifactFamilies) {
    lines.push(`### ${family.label}`);
    lines.push("");
    lines.push(`- Required: \`${family.required ? "yes" : "no"}\``);
    lines.push(`- Applicable: \`${family.applicable ? "yes" : "no"}\``);
    lines.push(`- Severity: \`${family.severity}\``);
    lines.push(`- Status: **${family.status.toUpperCase()}**`);
    lines.push(`- Artifact: \`${family.artifactPath ? toRelativePath(family.artifactPath) : "<missing>"}\``);
    lines.push(`- Revision: \`${family.revision ?? "<missing>"}\``);
    lines.push(`- Candidate: \`${family.candidate ?? "<n/a>"}\``);
    lines.push(`- Generated at: \`${family.generatedAt ?? "<missing>"}\``);
    lines.push(`- Freshness: \`${family.freshness}\``);
    if (family.findings.length === 0) {
      lines.push("- Findings: none.");
    } else {
      lines.push("- Findings:");
      for (const finding of family.findings) {
        lines.push(
          `  - [${finding.severity}] \`${finding.code}\` ${finding.summary}${finding.artifactPath ? ` (artifact: \`${toRelativePath(finding.artifactPath)}\`)` : ""}`
        );
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function renderOwnerReminderMarkdown(report: CandidateOwnerReminderReport): string {
  const lines: string[] = [];
  lines.push("# Candidate Owner Reminder Report");
  lines.push("");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Candidate revision: \`${report.candidate.revision}\``);
  lines.push(`- Target surface: \`${report.candidate.targetSurface}\``);
  lines.push(`- Overall status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Reminder items: ${report.summary.itemCount}`);
  lines.push(`- Missing artifact items: ${report.summary.missingArtifactCount}`);
  lines.push(`- Stale artifact items: ${report.summary.staleArtifactCount}`);
  lines.push(`- Missing owner assignment items: ${report.summary.missingOwnerAssignmentCount}`);
  lines.push(`- Summary: ${report.summary.summary}`);
  lines.push("");
  lines.push("Run this report during candidate review after the current candidate artifacts have been generated and before the final owner reminder/sign-off pass.");
  lines.push(
    `Store the JSON + Markdown outputs in \`${report.inputs.manualEvidenceLedgerPath ? toRelativePath(path.dirname(report.inputs.manualEvidenceLedgerPath)) : "artifacts/release-readiness"}\` with the rest of the candidate evidence bundle.`
  );
  lines.push("");
  lines.push("## Reminder Items");
  lines.push("");

  if (report.items.length === 0) {
    lines.push("- No owner reminder items.");
  } else {
    for (const item of report.items) {
      lines.push(`### ${item.artifactFamilyLabel}`);
      lines.push("");
      lines.push(`- Condition: \`${item.condition}\``);
      lines.push(`- Severity: \`${item.severity}\``);
      lines.push(`- Artifact: \`${item.artifactPath ? toRelativePath(item.artifactPath) : "<missing>"}\``);
      lines.push(`- Expected owners: ${item.expectedOwners.length > 0 ? item.expectedOwners.map((owner) => `\`${owner}\``).join(", ") : "<missing>"}`);
      lines.push(
        `- Owner ledger evidence types: ${
          item.ownerLedgerEvidenceTypes.length > 0 ? item.ownerLedgerEvidenceTypes.map((type) => `\`${type}\``).join(", ") : "<unmapped>"
        }`
      );
      lines.push(`- Owner ledger reference: ${item.ownerLedgerReference}`);
      lines.push(`- Source finding codes: ${item.sourceFindingCodes.map((code) => `\`${code}\``).join(", ")}`);
      lines.push(`- Summary: ${item.summary}`);
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPath(args: Args, outputBaseName = "candidate-evidence-audit"): string {
  if (args.outputPath) {
    return path.resolve(args.outputPath);
  }
  return path.resolve(
    DEFAULT_RELEASE_READINESS_DIR,
    `${outputBaseName}-${slugifyCandidate(args.candidate)}-${args.candidateRevision.slice(0, 12)}.json`
  );
}

function defaultMarkdownOutputPath(args: Args, outputBaseName = "candidate-evidence-audit"): string {
  if (args.markdownOutputPath) {
    return path.resolve(args.markdownOutputPath);
  }
  return path.resolve(
    DEFAULT_RELEASE_READINESS_DIR,
    `${outputBaseName}-${slugifyCandidate(args.candidate)}-${args.candidateRevision.slice(0, 12)}.md`
  );
}

function defaultOwnerReminderOutputPath(args: Args, outputBaseName = "candidate-evidence-owner-reminder-report"): string {
  const baseDir = args.outputPath
    ? path.dirname(path.resolve(args.outputPath))
    : args.markdownOutputPath
      ? path.dirname(path.resolve(args.markdownOutputPath))
      : DEFAULT_RELEASE_READINESS_DIR;
  return path.resolve(
    baseDir,
    `${outputBaseName}-${slugifyCandidate(args.candidate)}-${args.candidateRevision.slice(0, 12)}.json`
  );
}

function defaultOwnerReminderMarkdownOutputPath(args: Args, outputBaseName = "candidate-evidence-owner-reminder-report"): string {
  const baseDir = args.markdownOutputPath
    ? path.dirname(path.resolve(args.markdownOutputPath))
    : args.outputPath
      ? path.dirname(path.resolve(args.outputPath))
      : DEFAULT_RELEASE_READINESS_DIR;
  return path.resolve(
    baseDir,
    `${outputBaseName}-${slugifyCandidate(args.candidate)}-${args.candidateRevision.slice(0, 12)}.md`
  );
}

export function runSameCandidateEvidenceAuditCli(
  argv = process.argv,
  options?: {
    outputBaseName?: string;
    logLabel?: string;
  }
): CandidateEvidenceAuditReport {
  const args = parseArgs(argv);
  const report = buildSameCandidateEvidenceAuditReport(args);
  const outputPath = defaultOutputPath(args, options?.outputBaseName);
  const markdownOutputPath = defaultMarkdownOutputPath(args, options?.outputBaseName);
  const ownerReminderOutputPath = defaultOwnerReminderOutputPath(args);
  const ownerReminderMarkdownOutputPath = defaultOwnerReminderMarkdownOutputPath(args);
  const freshnessHistoryOutputPath = defaultFreshnessHistoryOutputPath(args);
  const logLabel = options?.logLabel ?? "candidate evidence audit";
  const parsedLedger =
    report.inputs.manualEvidenceLedgerPath && fs.existsSync(report.inputs.manualEvidenceLedgerPath)
      ? parseManualEvidenceOwnerLedger(report.inputs.manualEvidenceLedgerPath)
      : undefined;
  const ownerReminderReport = buildOwnerReminderReport(report, parsedLedger);

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));
  writeJsonFile(ownerReminderOutputPath, ownerReminderReport);
  writeFile(ownerReminderMarkdownOutputPath, renderOwnerReminderMarkdown(ownerReminderReport));
  appendFreshnessHistory(freshnessHistoryOutputPath, report);
  const manifestUpdate = updateReleaseCandidateManifest({
    candidate: report.candidate.name,
    candidateRevision: report.candidate.revision,
    releaseReadinessDir: findNearestReleaseReadinessDir(outputPath, report.inputs.snapshotPath, report.inputs.releaseGateSummaryPath),
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
          jsonPath: outputPath,
          markdownPath: markdownOutputPath
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
          jsonPath: ownerReminderOutputPath,
          markdownPath: ownerReminderMarkdownOutputPath
        },
        metadata: {
          status: ownerReminderReport.summary.status,
          itemCount: ownerReminderReport.summary.itemCount
        },
        sources: [
          {
            label: "Candidate evidence audit",
            kind: "artifact",
            path: outputPath
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
          jsonPath: freshnessHistoryOutputPath
        },
        metadata: {
          status: report.summary.status
        },
        sources: [
          {
            label: "Candidate evidence audit",
            kind: "artifact",
            path: outputPath
          }
        ]
      }
    ]
  });

  console.log(`Wrote ${logLabel} JSON: ${toRelativePath(outputPath)}`);
  console.log(`Wrote ${logLabel} Markdown: ${toRelativePath(markdownOutputPath)}`);
  console.log(`Wrote owner reminder JSON: ${toRelativePath(ownerReminderOutputPath)}`);
  console.log(`Wrote owner reminder Markdown: ${toRelativePath(ownerReminderMarkdownOutputPath)}`);
  console.log(`Wrote freshness history JSON: ${toRelativePath(freshnessHistoryOutputPath)}`);
  console.log(`Updated candidate evidence manifest JSON: ${toRelativePath(manifestUpdate.manifestJsonPath)}`);
  console.log(`Updated candidate evidence manifest Markdown: ${toRelativePath(manifestUpdate.manifestMarkdownPath)}`);

  if (report.summary.status === "failed") {
    process.exitCode = 1;
  }
  return report;
}

function main(): void {
  try {
    runSameCandidateEvidenceAuditCli();
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Candidate evidence audit failed: ${message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
