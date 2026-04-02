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
  | "linked_snapshot_mismatch";
type FamilyStatus = "passed" | "failed";
type AuditStatus = "passed" | "failed";

interface Args {
  candidate: string;
  candidateRevision: string;
  snapshotPath?: string;
  releaseGateSummaryPath?: string;
  cocosRcBundlePath?: string;
  manualEvidenceLedgerPath?: string;
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

interface AuditFinding {
  code: FindingCode;
  summary: string;
}

interface ArtifactFamilyReport {
  id: "release-readiness-snapshot" | "release-gate-summary" | "cocos-rc-bundle" | "manual-evidence-ledger";
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
  schemaVersion: 1;
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
  };
  artifactFamilies: ArtifactFamilyReport[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const MAX_DEFAULT_AGE_HOURS = 72;
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;

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

function normalizeRevision(revision: string | undefined): string | undefined {
  const trimmed = revision?.trim().toLowerCase();
  return trimmed && HEX_REVISION_PATTERN.test(trimmed) ? trimmed : undefined;
}

function revisionsMatch(left: string | undefined, right: string | undefined): boolean {
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

function parseManualEvidenceOwnerLedger(filePath: string): ManualEvidenceOwnerLedgerMetadata {
  const content = fs.readFileSync(filePath, "utf8");
  const capture = (label: string): string | undefined => {
    const match = content.match(new RegExp(`^- ${label}:\\s+\`([^\\n\`]+)\``, "m"));
    return match?.[1]?.trim();
  };

  return {
    candidate: capture("Candidate"),
    targetRevision: capture("Target revision"),
    lastUpdated: capture("Last updated"),
    linkedReadinessSnapshot: capture("Linked readiness snapshot")
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

function addCommonFindings(
  findings: AuditFinding[],
  input: {
    label: string;
    candidate: string | undefined;
    revision: string | undefined;
    generatedAt: string | undefined;
    expectedCandidate: string;
    expectedRevision: string;
    maxAgeMs: number;
  }
): ArtifactFamilyReport["freshness"] {
  const freshness = evaluateFreshness(input.generatedAt, input.maxAgeMs);

  if (input.candidate?.trim() && input.candidate.trim() !== input.expectedCandidate) {
    findings.push({
      code: "candidate_mismatch",
      summary: `${input.label} reports candidate ${input.candidate}, expected ${input.expectedCandidate}.`
    });
  }
  if (!revisionsMatch(input.revision, input.expectedRevision)) {
    findings.push({
      code: "revision_mismatch",
      summary: `${input.label} reports revision ${input.revision ?? "<missing>"}, expected ${input.expectedRevision}.`
    });
  }
  if (freshness === "stale") {
    findings.push({
      code: "stale",
      summary: `${input.label} is older than the ${Math.round(input.maxAgeMs / (1000 * 60 * 60))}h freshness window.`
    });
  } else if (freshness === "missing_timestamp") {
    findings.push({
      code: "missing_timestamp",
      summary: `${input.label} is missing its generated timestamp.`
    });
  } else if (freshness === "invalid_timestamp") {
    findings.push({
      code: "invalid_timestamp",
      summary: `${input.label} has an invalid generated timestamp (${input.generatedAt ?? "<missing>"}).`
    });
  }

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

export function buildSameCandidateEvidenceAuditReport(args: Args): SameCandidateEvidenceAuditReport {
  const snapshotPath = resolveSnapshotPath(args);
  const releaseGateSummaryPath = resolveReleaseGateSummaryPath(args);
  const cocosRcBundlePath = resolveCocosRcBundlePath(args);
  const manualEvidenceLedgerPath = resolveManualEvidenceLedgerPath(args);
  const expectedRevision = args.candidateRevision;
  const maxAgeMs = args.maxAgeHours * 60 * 60 * 1000;

  const artifactFamilies: ArtifactFamilyReport[] = [];

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
      maxAgeMs
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
      maxAgeMs
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
      maxAgeMs
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
    const ledger = parseManualEvidenceOwnerLedger(manualEvidenceLedgerPath);
    const findings: AuditFinding[] = [];
    const freshness = addCommonFindings(findings, {
      label: "Manual evidence owner ledger",
      candidate: ledger.candidate,
      revision: ledger.targetRevision,
      generatedAt: ledger.lastUpdated,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs
    });
    const linkedSnapshotFinding = compareLinkedSnapshot(snapshotPath, ledger.linkedReadinessSnapshot, "Manual evidence owner ledger");
    if (linkedSnapshotFinding) {
      findings.push(linkedSnapshotFinding);
    }
    artifactFamilies.push({
      id: "manual-evidence-ledger",
      label: "Manual evidence owner ledger",
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: manualEvidenceLedgerPath,
      revision: ledger.targetRevision,
      candidate: ledger.candidate,
      generatedAt: ledger.lastUpdated,
      freshness,
      findings
    });
  }

  const findings = artifactFamilies.flatMap((family) => family.findings);
  const status: AuditStatus = findings.length === 0 ? "passed" : "failed";

  return {
    schemaVersion: 1,
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
      ...(manualEvidenceLedgerPath ? { manualEvidenceLedgerPath } : {})
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
        lines.push(`  - \`${finding.code}\` ${finding.summary}`);
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
