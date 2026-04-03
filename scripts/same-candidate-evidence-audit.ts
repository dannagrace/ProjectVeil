import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type FindingCode =
  | "missing"
  | "stale"
  | "revision_mismatch"
  | "candidate_mismatch"
  | "missing_timestamp"
  | "invalid_timestamp"
  | "linked_snapshot_mismatch"
  | "manual_pending"
  | "manual_failed"
  | "metadata_failure"
  | "blocked";
type FamilyStatus = "passed" | "failed";
type AuditStatus = "passed" | "failed";

interface Args {
  candidate: string;
  candidateRevision: string;
  snapshotPath?: string;
  releaseGateSummaryPath?: string;
  cocosRcBundlePath?: string;
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
  linkedEvidence?: {
    releaseReadinessSnapshot?: {
      path?: string;
    };
  };
}

interface ManualEvidenceOwnerLedgerMetadata {
  candidate?: string;
  targetRevision?: string;
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
  summary: string;
  artifactPath?: string;
}

interface ArtifactFamilyReport {
  id:
    | "release-readiness-snapshot"
    | "release-gate-summary"
    | "cocos-rc-bundle"
    | "manual-evidence-ledger"
    | "wechat-release-evidence";
  label: string;
  required: true;
  status: FamilyStatus;
  artifactPath?: string;
  revision?: string;
  candidate?: string;
  generatedAt?: string;
  freshness: "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp" | "missing";
  findings: AuditFinding[];
}

interface SameCandidateEvidenceAuditReport {
  schemaVersion: 2;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
  };
  summary: {
    status: AuditStatus;
    findingCount: number;
    summary: string;
  };
  inputs: {
    snapshotPath?: string;
    releaseGateSummaryPath?: string;
    cocosRcBundlePath?: string;
    manualEvidenceLedgerPath?: string;
    wechatCandidateSummaryPath?: string;
  };
  artifactFamilies: ArtifactFamilyReport[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_WECHAT_ARTIFACTS_DIR = path.resolve("artifacts", "wechat-release");
const MAX_DEFAULT_AGE_HOURS = 72;
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;
const LEDGER_PENDING_STATUSES = new Set(["pending", "in-review"]);
const WECHAT_LEDGER_EVIDENCE_TYPES = new Set([
  "runtime-observability-review",
  "runtime-observability-signoff",
  "wechat-runtime-observability-signoff",
  "wechat-devtools-export-review",
  "wechat-device-runtime-smoke",
  "wechat-device-runtime-review",
  "wechat-release-checklist"
]);

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate = "";
  let candidateRevision = "";
  let snapshotPath: string | undefined;
  let releaseGateSummaryPath: string | undefined;
  let cocosRcBundlePath: string | undefined;
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
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    ...(cocosRcBundlePath ? { cocosRcBundlePath } : {}),
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

function evaluateFreshness(timestamp: string | undefined, maxAgeMs: number): ArtifactFamilyReport["freshness"] {
  if (!timestamp?.trim()) {
    return "missing_timestamp";
  }
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return "invalid_timestamp";
  }
  return Date.now() - parsed > maxAgeMs ? "stale" : "fresh";
}

function parseManualEvidenceOwnerLedger(filePath: string): ManualEvidenceOwnerLedger {
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
      lastUpdated: capture("Last updated"),
      linkedReadinessSnapshot: capture("Linked readiness snapshot")
    },
    rows
  };
}

function compareLinkedSnapshot(
  selectedSnapshotPath: string | undefined,
  linkedSnapshotPath: string | undefined,
  label: string
): AuditFinding | undefined {
  if (!selectedSnapshotPath || !linkedSnapshotPath?.trim()) {
    return undefined;
  }
  const selectedBase = path.basename(selectedSnapshotPath);
  const linkedBase = path.basename(linkedSnapshotPath.trim());
  if (selectedBase === linkedBase) {
    return undefined;
  }
  return {
    code: "linked_snapshot_mismatch",
    summary: `${label} references snapshot ${linkedBase}, but the selected readiness snapshot is ${selectedBase}.`
  };
}

function maybeAddFreshnessFinding(
  findings: AuditFinding[],
  freshness: ArtifactFamilyReport["freshness"],
  label: string,
  timestamp: string | undefined,
  maxAgeMs: number,
  artifactPath?: string
): void {
  if (freshness === "stale") {
    findings.push({
      code: "stale",
      summary: `${label} is older than the ${Math.round(maxAgeMs / (1000 * 60 * 60))}h freshness window.`,
      ...(artifactPath ? { artifactPath } : {})
    });
  } else if (freshness === "missing_timestamp") {
    findings.push({
      code: "missing_timestamp",
      summary: `${label} is missing its generated timestamp.`,
      ...(artifactPath ? { artifactPath } : {})
    });
  } else if (freshness === "invalid_timestamp") {
    findings.push({
      code: "invalid_timestamp",
      summary: `${label} has an invalid generated timestamp (${timestamp ?? "<missing>"}).`,
      ...(artifactPath ? { artifactPath } : {})
    });
  }
}

function addCommonFindings(
  findings: AuditFinding[],
  input: {
    label: string;
    candidate: string | undefined;
    revision: string | undefined | null;
    generatedAt: string | undefined;
    expectedCandidate: string;
    expectedRevision: string;
    maxAgeMs: number;
    artifactPath?: string;
  }
): ArtifactFamilyReport["freshness"] {
  const freshness = evaluateFreshness(input.generatedAt, input.maxAgeMs);

  if (input.candidate?.trim() && input.candidate.trim() !== input.expectedCandidate) {
    findings.push({
      code: "candidate_mismatch",
      summary: `${input.label} reports candidate ${input.candidate}, expected ${input.expectedCandidate}.`,
      ...(input.artifactPath ? { artifactPath: input.artifactPath } : {})
    });
  }
  if (!revisionsMatch(input.revision, input.expectedRevision)) {
    findings.push({
      code: "revision_mismatch",
      summary: `${input.label} reports revision ${input.revision ?? "<missing>"}, expected ${input.expectedRevision}.`,
      ...(input.artifactPath ? { artifactPath: input.artifactPath } : {})
    });
  }

  maybeAddFreshnessFinding(findings, freshness, input.label, input.generatedAt, input.maxAgeMs, input.artifactPath);
  return freshness;
}

function buildMissingFamily(id: ArtifactFamilyReport["id"], label: string): ArtifactFamilyReport {
  return {
    id,
    label,
    required: true,
    status: "failed",
    freshness: "missing",
    findings: [
      {
        code: "missing",
        summary: `${label} is missing.`
      }
    ]
  };
}

function isWechatEvidenceApplicable(ledger: ManualEvidenceOwnerLedger | undefined, wechatCandidateSummaryPath: string | undefined): boolean {
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

export function buildSameCandidateEvidenceAuditReport(args: Args): SameCandidateEvidenceAuditReport {
  const snapshotPath = resolveSnapshotPath(args);
  const releaseGateSummaryPath = resolveReleaseGateSummaryPath(args);
  const cocosRcBundlePath = resolveCocosRcBundlePath(args);
  const manualEvidenceLedgerPath = resolveManualEvidenceLedgerPath(args);
  const wechatCandidateSummaryPath = resolveWechatCandidateSummaryPath(args);
  const expectedRevision = args.candidateRevision;
  const maxAgeMs = args.maxAgeHours * 60 * 60 * 1000;

  const artifactFamilies: ArtifactFamilyReport[] = [];
  const parsedLedger =
    manualEvidenceLedgerPath && fs.existsSync(manualEvidenceLedgerPath) ? parseManualEvidenceOwnerLedger(manualEvidenceLedgerPath) : undefined;

  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    artifactFamilies.push(buildMissingFamily("release-readiness-snapshot", "Release readiness snapshot"));
  } else {
    const snapshot = readJsonFile<ReleaseReadinessSnapshot>(snapshotPath);
    const findings: AuditFinding[] = [];
    const freshness = addCommonFindings(findings, {
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
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: snapshotPath,
      revision: snapshot.revision?.commit ?? snapshot.revision?.shortCommit,
      generatedAt: snapshot.generatedAt,
      freshness,
      findings
    });
  }

  if (!releaseGateSummaryPath || !fs.existsSync(releaseGateSummaryPath)) {
    artifactFamilies.push(buildMissingFamily("release-gate-summary", "Release gate summary"));
  } else {
    const report = readJsonFile<ReleaseGateSummaryReport>(releaseGateSummaryPath);
    const findings: AuditFinding[] = [];
    const freshness = addCommonFindings(findings, {
      label: "Release gate summary",
      candidate: undefined,
      revision: report.revision?.commit ?? report.revision?.shortCommit,
      generatedAt: report.generatedAt,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: releaseGateSummaryPath
    });
    const linkedSnapshotFinding = compareLinkedSnapshot(snapshotPath, report.inputs?.snapshotPath, "Release gate summary");
    if (linkedSnapshotFinding) {
      findings.push(linkedSnapshotFinding);
    }
    artifactFamilies.push({
      id: "release-gate-summary",
      label: "Release gate summary",
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: releaseGateSummaryPath,
      revision: report.revision?.commit ?? report.revision?.shortCommit,
      generatedAt: report.generatedAt,
      freshness,
      findings
    });
  }

  if (!cocosRcBundlePath || !fs.existsSync(cocosRcBundlePath)) {
    artifactFamilies.push(buildMissingFamily("cocos-rc-bundle", "Cocos RC bundle"));
  } else {
    const bundle = readJsonFile<CocosRcBundleManifest>(cocosRcBundlePath);
    const findings: AuditFinding[] = [];
    const freshness = addCommonFindings(findings, {
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
      "Cocos RC bundle"
    );
    if (linkedSnapshotFinding) {
      findings.push(linkedSnapshotFinding);
    }
    artifactFamilies.push({
      id: "cocos-rc-bundle",
      label: "Cocos RC bundle",
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: cocosRcBundlePath,
      revision: bundle.bundle?.commit ?? bundle.bundle?.shortCommit,
      candidate: bundle.bundle?.candidate,
      generatedAt: bundle.bundle?.generatedAt,
      freshness,
      findings
    });
  }

  if (!manualEvidenceLedgerPath || !fs.existsSync(manualEvidenceLedgerPath)) {
    artifactFamilies.push(buildMissingFamily("manual-evidence-ledger", "Manual evidence owner ledger"));
  } else {
    const ledger = parsedLedger ?? parseManualEvidenceOwnerLedger(manualEvidenceLedgerPath);
    const findings: AuditFinding[] = [];
    const freshness = addCommonFindings(findings, {
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
      "Manual evidence owner ledger"
    );
    if (linkedSnapshotFinding) {
      findings.push(linkedSnapshotFinding);
    }
    for (const row of ledger.rows) {
      if ((row.status ?? "").toLowerCase() === "waived") {
        continue;
      }
      if (LEDGER_PENDING_STATUSES.has((row.status ?? "").toLowerCase())) {
        findings.push({
          code: "manual_pending",
          summary: `Manual evidence ledger still lists ${row.evidenceType} as ${row.status}.`,
          ...(row.artifactPath ? { artifactPath: row.artifactPath } : {})
        });
      }
      const rowFreshness = evaluateFreshness(row.lastUpdated, maxAgeMs);
      maybeAddFreshnessFinding(
        findings,
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
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: manualEvidenceLedgerPath,
      revision: ledger.metadata.targetRevision,
      candidate: ledger.metadata.candidate,
      generatedAt: ledger.metadata.lastUpdated,
      freshness,
      findings
    });
  }

  if (isWechatEvidenceApplicable(parsedLedger, wechatCandidateSummaryPath)) {
    if (!wechatCandidateSummaryPath || !fs.existsSync(wechatCandidateSummaryPath)) {
      artifactFamilies.push(buildMissingFamily("wechat-release-evidence", "WeChat release evidence summary"));
    } else {
      const summary = readJsonFile<WechatCandidateSummary>(wechatCandidateSummaryPath);
      const findings: AuditFinding[] = [];
      const freshness = addCommonFindings(findings, {
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
        findings.push({
          code: "manual_pending",
          summary: `WeChat release evidence still has ${manualReview?.requiredPendingChecks} required manual review item(s) pending.`,
          artifactPath: wechatCandidateSummaryPath
        });
      }
      if ((manualReview?.requiredFailedChecks ?? 0) > 0) {
        findings.push({
          code: "manual_failed",
          summary: `WeChat release evidence reports ${manualReview?.requiredFailedChecks} required manual review failure(s).`,
          artifactPath: wechatCandidateSummaryPath
        });
      }
      if ((manualReview?.requiredMetadataFailures ?? 0) > 0) {
        findings.push({
          code: "metadata_failure",
          summary: `WeChat release evidence reports ${manualReview?.requiredMetadataFailures} manual review metadata failure(s).`,
          artifactPath: wechatCandidateSummaryPath
        });
      }

      const runtimeObservabilityCheck = findRuntimeObservabilityCheck(manualReview?.checks);
      if (!runtimeObservabilityCheck) {
        findings.push({
          code: "missing",
          summary: "WeChat release evidence is missing a runtime observability sign-off check.",
          artifactPath: wechatCandidateSummaryPath
        });
      } else {
        const runtimeArtifactPath = runtimeObservabilityCheck.artifactPath || wechatCandidateSummaryPath;
        if (runtimeObservabilityCheck.status === "pending") {
          findings.push({
            code: "manual_pending",
            summary: `Runtime observability sign-off is still pending: ${runtimeObservabilityCheck.title ?? runtimeObservabilityCheck.id ?? "runtime observability"}.`,
            artifactPath: runtimeArtifactPath
          });
        } else if (runtimeObservabilityCheck.status === "failed") {
          findings.push({
            code: "manual_failed",
            summary: `Runtime observability sign-off failed: ${runtimeObservabilityCheck.title ?? runtimeObservabilityCheck.id ?? "runtime observability"}.`,
            artifactPath: runtimeArtifactPath
          });
        }
        if (!revisionsMatch(runtimeObservabilityCheck.revision, expectedRevision)) {
          findings.push({
            code: "revision_mismatch",
            summary: `Runtime observability sign-off reports revision ${runtimeObservabilityCheck.revision ?? "<missing>"}, expected ${expectedRevision}.`,
            artifactPath: runtimeArtifactPath
          });
        }
        const runtimeFreshness = evaluateFreshness(runtimeObservabilityCheck.recordedAt, maxAgeMs);
        maybeAddFreshnessFinding(
          findings,
          runtimeFreshness,
          "Runtime observability sign-off",
          runtimeObservabilityCheck.recordedAt,
          maxAgeMs,
          runtimeArtifactPath
        );
      }

      if (summary.candidate?.status === "blocked" && (summary.blockers?.length ?? 0) > 0) {
        for (const blocker of selectRelevantWechatBlockers(summary.blockers)?.slice(0, 3) ?? []) {
          findings.push({
            code: "blocked",
            summary: `WeChat release evidence is blocked: ${blocker.summary ?? blocker.id ?? "unknown blocker"}.`,
            artifactPath: blocker.artifactPath ?? wechatCandidateSummaryPath
          });
        }
      }

      artifactFamilies.push({
        id: "wechat-release-evidence",
        label: "WeChat release evidence summary",
        required: true,
        status: findings.length === 0 ? "passed" : "failed",
        artifactPath: wechatCandidateSummaryPath,
        revision: summary.candidate?.revision ?? undefined,
        generatedAt: summary.generatedAt,
        freshness,
        findings
      });
    }
  }

  const findings = artifactFamilies.flatMap((family) => family.findings);
  const status: AuditStatus = findings.length === 0 ? "passed" : "failed";

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: args.candidate,
      revision: expectedRevision
    },
    summary: {
      status,
      findingCount: findings.length,
      summary:
        status === "passed"
          ? `Same-candidate evidence is current for ${args.candidate} at ${expectedRevision}.`
          : `Same-candidate evidence drift detected: ${findings[0]?.summary}`
    },
    inputs: {
      ...(snapshotPath ? { snapshotPath } : {}),
      ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
      ...(cocosRcBundlePath ? { cocosRcBundlePath } : {}),
      ...(manualEvidenceLedgerPath ? { manualEvidenceLedgerPath } : {}),
      ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath } : {})
    },
    artifactFamilies
  };
}

export function renderMarkdown(report: SameCandidateEvidenceAuditReport): string {
  const lines: string[] = [];
  lines.push("# Same-Candidate Evidence Audit");
  lines.push("");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Candidate revision: \`${report.candidate.revision}\``);
  lines.push(`- Overall status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Summary: ${report.summary.summary}`);
  lines.push("");
  lines.push("## Selected Inputs");
  lines.push("");
  lines.push(`- Release readiness snapshot: \`${report.inputs.snapshotPath ? toRelativePath(report.inputs.snapshotPath) : "<missing>"}\``);
  lines.push(`- Release gate summary: \`${report.inputs.releaseGateSummaryPath ? toRelativePath(report.inputs.releaseGateSummaryPath) : "<missing>"}\``);
  lines.push(`- Cocos RC bundle: \`${report.inputs.cocosRcBundlePath ? toRelativePath(report.inputs.cocosRcBundlePath) : "<missing>"}\``);
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
          `  - \`${finding.code}\` ${finding.summary}${finding.artifactPath ? ` (artifact: \`${finding.artifactPath}\`)` : ""}`
        );
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPath(args: Args): string {
  if (args.outputPath) {
    return path.resolve(args.outputPath);
  }
  return path.resolve(
    DEFAULT_RELEASE_READINESS_DIR,
    `same-candidate-evidence-audit-${slugifyCandidate(args.candidate)}-${args.candidateRevision.slice(0, 12)}.json`
  );
}

function defaultMarkdownOutputPath(args: Args): string {
  if (args.markdownOutputPath) {
    return path.resolve(args.markdownOutputPath);
  }
  return path.resolve(
    DEFAULT_RELEASE_READINESS_DIR,
    `same-candidate-evidence-audit-${slugifyCandidate(args.candidate)}-${args.candidateRevision.slice(0, 12)}.md`
  );
}

function main(): void {
  const args = parseArgs(process.argv);
  const report = buildSameCandidateEvidenceAuditReport(args);
  const outputPath = defaultOutputPath(args);
  const markdownOutputPath = defaultMarkdownOutputPath(args);

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote same-candidate evidence audit JSON: ${toRelativePath(outputPath)}`);
  console.log(`Wrote same-candidate evidence audit Markdown: ${toRelativePath(markdownOutputPath)}`);

  if (report.summary.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
