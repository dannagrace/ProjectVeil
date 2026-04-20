import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type FreshnessStatus = "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp" | "missing";
type GateStatus = "passed" | "failed";
type FindingCode =
  | "missing"
  | "stale"
  | "revision_mismatch"
  | "candidate_mismatch"
  | "missing_timestamp"
  | "invalid_timestamp"
  | "missing_link"
  | "linked_snapshot_mismatch"
  | "linked_gate_mismatch"
  | "linked_ledger_mismatch"
  | "phase1_exit_gate_mismatch";

interface Args {
  candidate: string;
  candidateRevision: string;
  dossierPath?: string;
  exitAuditPath?: string;
  snapshotPath?: string;
  releaseGateSummaryPath?: string;
  manualEvidenceLedgerPath?: string;
  outputDir?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  maxAgeHours: number;
}

interface DossierExitGate {
  result?: string;
  summary?: string;
  blockingSections?: string[];
  pendingSections?: string[];
  acceptedRiskSections?: string[];
}

interface Phase1CandidateDossier {
  generatedAt?: string;
  candidate?: {
    name?: string;
    revision?: string;
  };
  inputs?: {
    snapshotPath?: string;
  };
  artifacts?: {
    releaseGateSummaryPath?: string;
  };
  phase1ExitEvidenceGate?: DossierExitGate;
}

interface Phase1ExitAuditReport {
  generatedAt?: string;
  candidate?: {
    name?: string;
    revision?: string;
  };
  inputs?: {
    snapshotPath?: string;
    releaseGateSummaryPath?: string;
    manualEvidenceLedgerPath?: string;
  };
  phase1ExitEvidenceGate?: DossierExitGate;
}

interface ReleaseReadinessSnapshot {
  generatedAt?: string;
  revision?: {
    commit?: string;
  };
}

interface ReleaseGateSummaryReport {
  generatedAt?: string;
  revision?: {
    commit?: string;
  };
  inputs?: {
    snapshotPath?: string;
  };
}

interface ManualEvidenceOwnerLedgerRow {
  evidenceType: string;
  candidate?: string;
  revision?: string;
  status?: string;
  lastUpdated?: string;
  artifactPath?: string;
  notes?: string;
}

interface ManualEvidenceOwnerLedger {
  metadata: {
    candidate?: string;
    targetRevision?: string;
    lastUpdated?: string;
    linkedReadinessSnapshot?: string;
  };
  rows: ManualEvidenceOwnerLedgerRow[];
}

interface FreshnessGateFinding {
  code: FindingCode;
  summary: string;
  artifactPath?: string;
}

interface ArtifactFamilyReport {
  id:
    | "phase1-candidate-dossier"
    | "phase1-exit-audit"
    | "release-readiness-snapshot"
    | "release-gate-summary"
    | "manual-evidence-owner-ledger";
  label: string;
  artifactPath?: string;
  status: GateStatus;
  candidate?: string;
  revision?: string;
  generatedAt?: string;
  freshness: FreshnessStatus;
  findings: FreshnessGateFinding[];
}

interface Phase1ExitDossierFreshnessGateReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
  };
  summary: {
    status: GateStatus;
    findingCount: number;
    summary: string;
  };
  inputs: {
    dossierPath?: string;
    exitAuditPath?: string;
    snapshotPath?: string;
    releaseGateSummaryPath?: string;
    manualEvidenceLedgerPath?: string;
    maxAgeHours: number;
  };
  artifactFamilies: ArtifactFamilyReport[];
  findings: FreshnessGateFinding[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_MAX_AGE_HOURS = 48;
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate = "";
  let candidateRevision = "";
  let dossierPath: string | undefined;
  let exitAuditPath: string | undefined;
  let snapshotPath: string | undefined;
  let releaseGateSummaryPath: string | undefined;
  let manualEvidenceLedgerPath: string | undefined;
  let outputDir: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let maxAgeHours = DEFAULT_MAX_AGE_HOURS;

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
    if (arg === "--dossier" && next) {
      dossierPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--exit-audit" && next) {
      exitAuditPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--snapshot" && next) {
      snapshotPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--release-gate-summary" && next) {
      releaseGateSummaryPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--manual-evidence-ledger" && next) {
      manualEvidenceLedgerPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = next.trim();
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
    ...(dossierPath ? { dossierPath } : {}),
    ...(exitAuditPath ? { exitAuditPath } : {}),
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    ...(manualEvidenceLedgerPath ? { manualEvidenceLedgerPath } : {}),
    ...(outputDir ? { outputDir } : {}),
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

function createFinding(code: FindingCode, summary: string, artifactPath?: string): FreshnessGateFinding {
  return {
    code,
    summary,
    ...(artifactPath ? { artifactPath } : {})
  };
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

function resolveLatestBundleArtifactPath(
  dirPath: string,
  directoryMatcher: (entry: string) => boolean,
  artifactFileName: string,
  preferredMatcher?: (entry: string) => boolean
): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }

  const candidates = fs
    .readdirSync(dirPath)
    .filter((entry) => directoryMatcher(entry))
    .map((entry) => path.join(dirPath, entry, artifactFileName))
    .filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  if (preferredMatcher) {
    const preferred = candidates.find((filePath) => preferredMatcher(path.basename(path.dirname(filePath))));
    if (preferred) {
      return preferred;
    }
  }

  return candidates[0];
}

function resolveDossierPath(args: Args): string | undefined {
  if (args.dossierPath) {
    return path.resolve(args.dossierPath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return (
    resolveLatestBundleArtifactPath(
      DEFAULT_RELEASE_READINESS_DIR,
      (entry) => entry.startsWith("phase1-candidate-dossier-"),
      "phase1-candidate-dossier.json",
      (entry) => entry.includes(`phase1-candidate-dossier-${candidateSlug}-`)
    ) ??
    resolveLatestFile(
      DEFAULT_RELEASE_READINESS_DIR,
      (entry) => entry.endsWith(".json") && entry.startsWith(`phase1-candidate-dossier-${candidateSlug}-`)
    )
  );
}

function resolveExitAuditPath(args: Args): string | undefined {
  if (args.exitAuditPath) {
    return path.resolve(args.exitAuditPath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return (
    resolveLatestBundleArtifactPath(
      DEFAULT_RELEASE_READINESS_DIR,
      (entry) => entry.startsWith("phase1-exit-audit-"),
      "phase1-exit-audit.json",
      (entry) => entry.includes(`phase1-exit-audit-${candidateSlug}-`)
    ) ??
    resolveLatestFile(
      DEFAULT_RELEASE_READINESS_DIR,
      (entry) => entry.endsWith(".json") && entry.startsWith(`phase1-exit-audit-${candidateSlug}-`)
    )
  );
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
      !entry.startsWith("release-readiness-dashboard-")
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
      status: columns[4].replace(/^`|`$/g, ""),
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

function maybeAddFreshnessFinding(
  findings: FreshnessGateFinding[],
  freshness: FreshnessStatus,
  label: string,
  timestamp: string | undefined,
  maxAgeMs: number,
  artifactPath?: string
): void {
  if (freshness === "stale") {
    findings.push(
      createFinding("stale", `${label} is older than the ${Math.round(maxAgeMs / (1000 * 60 * 60))}h freshness window.`, artifactPath)
    );
  } else if (freshness === "missing_timestamp") {
    findings.push(createFinding("missing_timestamp", `${label} is missing its generated timestamp.`, artifactPath));
  } else if (freshness === "invalid_timestamp") {
    findings.push(createFinding("invalid_timestamp", `${label} has an invalid timestamp (${timestamp ?? "<missing>"}).`, artifactPath));
  }
}

function maybeAddCandidateFinding(
  findings: FreshnessGateFinding[],
  label: string,
  expectedCandidate: string,
  actualCandidate: string | undefined,
  artifactPath?: string
): void {
  if (actualCandidate?.trim() && actualCandidate.trim() !== expectedCandidate) {
    findings.push(
      createFinding("candidate_mismatch", `${label} reports candidate ${actualCandidate}, expected ${expectedCandidate}.`, artifactPath)
    );
  }
}

function maybeAddRevisionFinding(
  findings: FreshnessGateFinding[],
  label: string,
  expectedRevision: string,
  actualRevision: string | undefined,
  artifactPath?: string
): void {
  if (!revisionsMatch(actualRevision, expectedRevision)) {
    findings.push(
      createFinding("revision_mismatch", `${label} reports revision ${actualRevision ?? "<missing>"}, expected ${expectedRevision}.`, artifactPath)
    );
  }
}

function maybeAddLinkedArtifactFinding(
  findings: FreshnessGateFinding[],
  code: Extract<FindingCode, "linked_snapshot_mismatch" | "linked_gate_mismatch" | "linked_ledger_mismatch">,
  label: string,
  selectedArtifactPath: string | undefined,
  linkedArtifactPath: string | undefined,
  artifactPath?: string
): void {
  if (!selectedArtifactPath || !linkedArtifactPath?.trim()) {
    return;
  }
  const selectedBase = path.basename(selectedArtifactPath);
  const linkedBase = path.basename(linkedArtifactPath.trim());
  if (selectedBase !== linkedBase) {
    findings.push(createFinding(code, `${label} references ${linkedBase}, but the selected artifact is ${selectedBase}.`, artifactPath));
  }
}

function compareExitGates(left: DossierExitGate | undefined, right: DossierExitGate | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  const normalizeList = (values: string[] | undefined): string[] => [...(values ?? [])].sort();
  return (
    left.result === right.result &&
    left.summary === right.summary &&
    JSON.stringify(normalizeList(left.blockingSections)) === JSON.stringify(normalizeList(right.blockingSections)) &&
    JSON.stringify(normalizeList(left.pendingSections)) === JSON.stringify(normalizeList(right.pendingSections)) &&
    JSON.stringify(normalizeList(left.acceptedRiskSections)) === JSON.stringify(normalizeList(right.acceptedRiskSections))
  );
}

export function buildPhase1ExitDossierFreshnessGateReport(args: Args): Phase1ExitDossierFreshnessGateReport {
  const maxAgeMs = args.maxAgeHours * 60 * 60 * 1000;
  const dossierPath = resolveDossierPath(args);
  const exitAuditPath = resolveExitAuditPath(args);
  const snapshotPath = resolveSnapshotPath(args);
  const releaseGateSummaryPath = resolveReleaseGateSummaryPath(args);
  const manualEvidenceLedgerPath = resolveManualEvidenceLedgerPath(args);
  const artifactFamilies: ArtifactFamilyReport[] = [];

  let parsedDossier: Phase1CandidateDossier | undefined;
  let parsedExitAudit: Phase1ExitAuditReport | undefined;

  const addMissingFamily = (
    id: ArtifactFamilyReport["id"],
    label: string,
    artifactPath: string | undefined,
    summary: string
  ): void => {
    artifactFamilies.push({
      id,
      label,
      ...(artifactPath ? { artifactPath } : {}),
      status: "failed",
      freshness: "missing",
      findings: [createFinding("missing", summary, artifactPath)]
    });
  };

  if (!dossierPath || !fs.existsSync(dossierPath)) {
    addMissingFamily(
      "phase1-candidate-dossier",
      "Phase 1 candidate dossier",
      dossierPath,
      "Phase 1 candidate dossier is missing. Run `npm run release -- phase1:candidate-dossier` or pass `--dossier`."
    );
  } else {
    parsedDossier = readJsonFile<Phase1CandidateDossier>(dossierPath);
    const findings: FreshnessGateFinding[] = [];
    const freshness = evaluateFreshness(parsedDossier.generatedAt, maxAgeMs);
    maybeAddCandidateFinding(findings, "Phase 1 candidate dossier", args.candidate, parsedDossier.candidate?.name, dossierPath);
    maybeAddRevisionFinding(findings, "Phase 1 candidate dossier", args.candidateRevision, parsedDossier.candidate?.revision, dossierPath);
    maybeAddFreshnessFinding(findings, freshness, "Phase 1 candidate dossier", parsedDossier.generatedAt, maxAgeMs, dossierPath);
    if (!parsedDossier.inputs?.snapshotPath?.trim()) {
      findings.push(createFinding("missing_link", "Phase 1 candidate dossier does not record a linked release readiness snapshot.", dossierPath));
    } else {
      maybeAddLinkedArtifactFinding(
        findings,
        "linked_snapshot_mismatch",
        "Phase 1 candidate dossier",
        snapshotPath,
        parsedDossier.inputs.snapshotPath,
        dossierPath
      );
    }
    if (!parsedDossier.artifacts?.releaseGateSummaryPath?.trim()) {
      findings.push(createFinding("missing_link", "Phase 1 candidate dossier does not record a linked release gate summary artifact.", dossierPath));
    } else {
      maybeAddLinkedArtifactFinding(
        findings,
        "linked_gate_mismatch",
        "Phase 1 candidate dossier",
        releaseGateSummaryPath,
        parsedDossier.artifacts.releaseGateSummaryPath,
        dossierPath
      );
    }

    artifactFamilies.push({
      id: "phase1-candidate-dossier",
      label: "Phase 1 candidate dossier",
      artifactPath: dossierPath,
      status: findings.length > 0 ? "failed" : "passed",
      candidate: parsedDossier.candidate?.name,
      revision: parsedDossier.candidate?.revision,
      generatedAt: parsedDossier.generatedAt,
      freshness,
      findings
    });
  }

  if (!exitAuditPath || !fs.existsSync(exitAuditPath)) {
    addMissingFamily(
      "phase1-exit-audit",
      "Phase 1 exit audit",
      exitAuditPath,
      "Phase 1 exit audit is missing. Run `npm run release -- phase1:exit-audit` or pass `--exit-audit`."
    );
  } else {
    parsedExitAudit = readJsonFile<Phase1ExitAuditReport>(exitAuditPath);
    const findings: FreshnessGateFinding[] = [];
    const freshness = evaluateFreshness(parsedExitAudit.generatedAt, maxAgeMs);
    maybeAddCandidateFinding(findings, "Phase 1 exit audit", args.candidate, parsedExitAudit.candidate?.name, exitAuditPath);
    maybeAddRevisionFinding(findings, "Phase 1 exit audit", args.candidateRevision, parsedExitAudit.candidate?.revision, exitAuditPath);
    maybeAddFreshnessFinding(findings, freshness, "Phase 1 exit audit", parsedExitAudit.generatedAt, maxAgeMs, exitAuditPath);
    if (!parsedExitAudit.inputs?.snapshotPath?.trim()) {
      findings.push(createFinding("missing_link", "Phase 1 exit audit does not record a linked release readiness snapshot.", exitAuditPath));
    } else {
      maybeAddLinkedArtifactFinding(
        findings,
        "linked_snapshot_mismatch",
        "Phase 1 exit audit",
        snapshotPath,
        parsedExitAudit.inputs.snapshotPath,
        exitAuditPath
      );
    }
    if (!parsedExitAudit.inputs?.releaseGateSummaryPath?.trim()) {
      findings.push(createFinding("missing_link", "Phase 1 exit audit does not record a linked release gate summary artifact.", exitAuditPath));
    } else {
      maybeAddLinkedArtifactFinding(
        findings,
        "linked_gate_mismatch",
        "Phase 1 exit audit",
        releaseGateSummaryPath,
        parsedExitAudit.inputs.releaseGateSummaryPath,
        exitAuditPath
      );
    }
    if (!parsedExitAudit.inputs?.manualEvidenceLedgerPath?.trim()) {
      findings.push(createFinding("missing_link", "Phase 1 exit audit does not record a linked manual evidence owner ledger.", exitAuditPath));
    } else {
      maybeAddLinkedArtifactFinding(
        findings,
        "linked_ledger_mismatch",
        "Phase 1 exit audit",
        manualEvidenceLedgerPath,
        parsedExitAudit.inputs.manualEvidenceLedgerPath,
        exitAuditPath
      );
    }
    if (!compareExitGates(parsedDossier?.phase1ExitEvidenceGate, parsedExitAudit.phase1ExitEvidenceGate)) {
      findings.push(
        createFinding(
          "phase1_exit_gate_mismatch",
          "Phase 1 exit audit does not match the dossier's embedded Phase 1 exit evidence gate result/sections.",
          exitAuditPath
        )
      );
    }

    artifactFamilies.push({
      id: "phase1-exit-audit",
      label: "Phase 1 exit audit",
      artifactPath: exitAuditPath,
      status: findings.length > 0 ? "failed" : "passed",
      candidate: parsedExitAudit.candidate?.name,
      revision: parsedExitAudit.candidate?.revision,
      generatedAt: parsedExitAudit.generatedAt,
      freshness,
      findings
    });
  }

  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    addMissingFamily(
      "release-readiness-snapshot",
      "Release readiness snapshot",
      snapshotPath,
      "Release readiness snapshot is missing. Run `npm run release -- readiness:snapshot` or pass `--snapshot`."
    );
  } else {
    const snapshot = readJsonFile<ReleaseReadinessSnapshot>(snapshotPath);
    const findings: FreshnessGateFinding[] = [];
    const freshness = evaluateFreshness(snapshot.generatedAt, maxAgeMs);
    maybeAddRevisionFinding(findings, "Release readiness snapshot", args.candidateRevision, snapshot.revision?.commit, snapshotPath);
    maybeAddFreshnessFinding(findings, freshness, "Release readiness snapshot", snapshot.generatedAt, maxAgeMs, snapshotPath);
    artifactFamilies.push({
      id: "release-readiness-snapshot",
      label: "Release readiness snapshot",
      artifactPath: snapshotPath,
      status: findings.length > 0 ? "failed" : "passed",
      revision: snapshot.revision?.commit,
      generatedAt: snapshot.generatedAt,
      freshness,
      findings
    });
  }

  if (!releaseGateSummaryPath || !fs.existsSync(releaseGateSummaryPath)) {
    addMissingFamily(
      "release-gate-summary",
      "Release gate summary",
      releaseGateSummaryPath,
      "Release gate summary is missing. Run `npm run release -- gate:summary` or pass `--release-gate-summary`."
    );
  } else {
    const gateSummary = readJsonFile<ReleaseGateSummaryReport>(releaseGateSummaryPath);
    const findings: FreshnessGateFinding[] = [];
    const freshness = evaluateFreshness(gateSummary.generatedAt, maxAgeMs);
    maybeAddRevisionFinding(findings, "Release gate summary", args.candidateRevision, gateSummary.revision?.commit, releaseGateSummaryPath);
    maybeAddFreshnessFinding(findings, freshness, "Release gate summary", gateSummary.generatedAt, maxAgeMs, releaseGateSummaryPath);
    if (!gateSummary.inputs?.snapshotPath?.trim()) {
      findings.push(createFinding("missing_link", "Release gate summary does not record a linked release readiness snapshot.", releaseGateSummaryPath));
    } else {
      maybeAddLinkedArtifactFinding(
        findings,
        "linked_snapshot_mismatch",
        "Release gate summary",
        snapshotPath,
        gateSummary.inputs.snapshotPath,
        releaseGateSummaryPath
      );
    }
    artifactFamilies.push({
      id: "release-gate-summary",
      label: "Release gate summary",
      artifactPath: releaseGateSummaryPath,
      status: findings.length > 0 ? "failed" : "passed",
      revision: gateSummary.revision?.commit,
      generatedAt: gateSummary.generatedAt,
      freshness,
      findings
    });
  }

  if (!manualEvidenceLedgerPath || !fs.existsSync(manualEvidenceLedgerPath)) {
    addMissingFamily(
      "manual-evidence-owner-ledger",
      "Manual evidence owner ledger",
      manualEvidenceLedgerPath,
      "Manual evidence owner ledger is missing. Pass `--manual-evidence-ledger` or refresh the candidate-scoped ledger."
    );
  } else {
    const ledger = parseManualEvidenceOwnerLedger(manualEvidenceLedgerPath);
    const findings: FreshnessGateFinding[] = [];
    const freshness = evaluateFreshness(ledger.metadata.lastUpdated, maxAgeMs);
    maybeAddCandidateFinding(findings, "Manual evidence owner ledger", args.candidate, ledger.metadata.candidate, manualEvidenceLedgerPath);
    maybeAddRevisionFinding(findings, "Manual evidence owner ledger", args.candidateRevision, ledger.metadata.targetRevision, manualEvidenceLedgerPath);
    maybeAddFreshnessFinding(findings, freshness, "Manual evidence owner ledger", ledger.metadata.lastUpdated, maxAgeMs, manualEvidenceLedgerPath);
    if (!ledger.metadata.linkedReadinessSnapshot?.trim()) {
      findings.push(
        createFinding("missing_link", "Manual evidence owner ledger does not record a linked release readiness snapshot.", manualEvidenceLedgerPath)
      );
    } else {
      maybeAddLinkedArtifactFinding(
        findings,
        "linked_snapshot_mismatch",
        "Manual evidence owner ledger",
        snapshotPath,
        ledger.metadata.linkedReadinessSnapshot,
        manualEvidenceLedgerPath
      );
    }
    for (const row of ledger.rows) {
      if (row.candidate?.trim() && row.candidate !== args.candidate) {
        findings.push(
          createFinding(
            "candidate_mismatch",
            `Manual evidence owner ledger row ${row.evidenceType} reports candidate ${row.candidate}, expected ${args.candidate}.`,
            manualEvidenceLedgerPath
          )
        );
      }
      if (row.revision?.trim() && !revisionsMatch(row.revision, args.candidateRevision)) {
        findings.push(
          createFinding(
            "revision_mismatch",
            `Manual evidence owner ledger row ${row.evidenceType} reports revision ${row.revision}, expected ${args.candidateRevision}.`,
            manualEvidenceLedgerPath
          )
        );
      }
    }
    artifactFamilies.push({
      id: "manual-evidence-owner-ledger",
      label: "Manual evidence owner ledger",
      artifactPath: manualEvidenceLedgerPath,
      status: findings.length > 0 ? "failed" : "passed",
      candidate: ledger.metadata.candidate,
      revision: ledger.metadata.targetRevision,
      generatedAt: ledger.metadata.lastUpdated,
      freshness,
      findings
    });
  }

  const findings = artifactFamilies.flatMap((family) => family.findings);
  const status: GateStatus = findings.length > 0 ? "failed" : "passed";
  const leadFinding = findings[0];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: args.candidate,
      revision: args.candidateRevision
    },
    summary: {
      status,
      findingCount: findings.length,
      summary:
        status === "passed"
          ? `Phase 1 exit dossier evidence is fresh and same-revision aligned for ${args.candidate} at ${args.candidateRevision}.`
          : `Phase 1 exit dossier freshness gate failed: ${leadFinding?.summary ?? "unknown finding"}.`
    },
    inputs: {
      ...(dossierPath ? { dossierPath } : {}),
      ...(exitAuditPath ? { exitAuditPath } : {}),
      ...(snapshotPath ? { snapshotPath } : {}),
      ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
      ...(manualEvidenceLedgerPath ? { manualEvidenceLedgerPath } : {}),
      maxAgeHours: args.maxAgeHours
    },
    artifactFamilies,
    findings
  };
}

export function renderMarkdown(report: Phase1ExitDossierFreshnessGateReport): string {
  const lines: string[] = [];
  lines.push("# Phase 1 Exit Dossier Freshness Gate", "");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Candidate revision: \`${report.candidate.revision}\``);
  lines.push(`- Freshness window: \`${report.inputs.maxAgeHours}h\``);
  lines.push(`- Overall status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Findings: ${report.summary.findingCount}`);
  lines.push(`- Summary: ${report.summary.summary}`, "");
  lines.push("## Selected Inputs", "");
  lines.push(`- Phase 1 candidate dossier: \`${report.inputs.dossierPath ? toRelativePath(report.inputs.dossierPath) : "<missing>"}\``);
  lines.push(`- Phase 1 exit audit: \`${report.inputs.exitAuditPath ? toRelativePath(report.inputs.exitAuditPath) : "<missing>"}\``);
  lines.push(`- Release readiness snapshot: \`${report.inputs.snapshotPath ? toRelativePath(report.inputs.snapshotPath) : "<missing>"}\``);
  lines.push(`- Release gate summary: \`${report.inputs.releaseGateSummaryPath ? toRelativePath(report.inputs.releaseGateSummaryPath) : "<missing>"}\``);
  lines.push(`- Manual evidence owner ledger: \`${report.inputs.manualEvidenceLedgerPath ? toRelativePath(report.inputs.manualEvidenceLedgerPath) : "<missing>"}\``, "");
  lines.push("## Findings", "");
  if (report.findings.length === 0) {
    lines.push("- No freshness or same-revision findings.", "");
  } else {
    for (const finding of report.findings) {
      lines.push(`- \`${finding.code}\` ${finding.summary}${finding.artifactPath ? ` (artifact: \`${toRelativePath(finding.artifactPath)}\`)` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Artifact Families", "");
  for (const family of report.artifactFamilies) {
    lines.push(`### ${family.label}`, "");
    lines.push(`- Status: **${family.status.toUpperCase()}**`);
    lines.push(`- Artifact: \`${family.artifactPath ? toRelativePath(family.artifactPath) : "<missing>"}\``);
    lines.push(`- Candidate: \`${family.candidate ?? "<n/a>"}\``);
    lines.push(`- Revision: \`${family.revision ?? "<missing>"}\``);
    lines.push(`- Generated at: \`${family.generatedAt ?? "<missing>"}\``);
    lines.push(`- Freshness: \`${family.freshness}\``);
    if (family.findings.length === 0) {
      lines.push("- Findings: none.", "");
      continue;
    }
    lines.push("- Findings:");
    for (const finding of family.findings) {
      lines.push(`  - \`${finding.code}\` ${finding.summary}${finding.artifactPath ? ` (artifact: \`${toRelativePath(finding.artifactPath)}\`)` : ""}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function runPhase1ExitDossierFreshnessGateCli(argv = process.argv): void {
  const args = parseArgs(argv);
  const report = buildPhase1ExitDossierFreshnessGateReport(args);
  const defaultOutputDir = path.resolve(
    args.outputDir ?? DEFAULT_RELEASE_READINESS_DIR,
    args.outputDir ? "" : "."
  );
  const shortRevision = args.candidateRevision.slice(0, 12);
  const defaultJsonPath = args.outputDir
    ? path.join(defaultOutputDir, "phase1-exit-dossier-freshness-gate.json")
    : path.join(defaultOutputDir, `phase1-exit-dossier-freshness-gate-${slugifyCandidate(args.candidate)}-${shortRevision}.json`);
  const defaultMarkdownPath = args.outputDir
    ? path.join(defaultOutputDir, "phase1-exit-dossier-freshness-gate.md")
    : path.join(defaultOutputDir, `phase1-exit-dossier-freshness-gate-${slugifyCandidate(args.candidate)}-${shortRevision}.md`);
  const outputPath = path.resolve(args.outputPath ?? defaultJsonPath);
  const markdownOutputPath = path.resolve(args.markdownOutputPath ?? defaultMarkdownPath);

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote Phase 1 exit dossier freshness gate JSON: ${toRelativePath(outputPath)}`);
  console.log(`Wrote Phase 1 exit dossier freshness gate Markdown: ${toRelativePath(markdownOutputPath)}`);

  if (report.summary.status !== "passed") {
    throw new Error(report.summary.summary);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runPhase1ExitDossierFreshnessGateCli();
  } catch (error) {
    console.error(`Phase 1 exit dossier freshness gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
