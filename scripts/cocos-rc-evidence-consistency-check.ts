import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CheckStatus = "passed" | "failed";
type FreshnessStatus = "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp" | "missing";
type FindingCode =
  | "missing"
  | "candidate_mismatch"
  | "revision_mismatch"
  | "stale"
  | "missing_timestamp"
  | "invalid_timestamp"
  | "linked_artifact_mismatch";

interface Args {
  candidate: string;
  expectedRevision?: string;
  releaseReadinessSnapshotPath?: string;
  releaseGateSummaryPath?: string;
  primaryJourneyEvidencePath?: string;
  cocosRcSnapshotPath?: string;
  cocosMainJourneyManifestPath?: string;
  cocosRcBundlePath?: string;
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

interface ReleaseGateSummary {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  inputs?: {
    snapshotPath?: string;
  };
}

interface PrimaryJourneyEvidence {
  candidate?: {
    name?: string;
    commit?: string;
    shortCommit?: string;
  };
  execution?: {
    completedAt?: string;
  };
}

interface CocosRcSnapshot {
  candidate?: {
    name?: string;
    commit?: string;
    shortCommit?: string;
  };
  execution?: {
    executedAt?: string;
  };
  linkedEvidence?: {
    releaseReadinessSnapshot?: {
      path?: string;
    };
    primaryJourneyEvidence?: {
      path?: string;
    };
  };
}

interface CocosMainJourneyManifest {
  candidate?: {
    name?: string;
    revision?: {
      commit?: string;
      shortCommit?: string;
    };
  };
  generatedAt?: string;
  linkedEvidence?: {
    snapshot?: string;
    primaryJourneyEvidence?: string;
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
    mainJourneyManifest?: string;
    snapshot?: string;
  };
  linkedEvidence?: {
    releaseReadinessSnapshot?: {
      path?: string;
    };
  };
}

interface CheckFinding {
  code: FindingCode;
  summary: string;
  artifactPath?: string;
}

interface ArtifactCheckReport {
  id:
    | "release-readiness-snapshot"
    | "release-gate-summary"
    | "primary-journey-evidence"
    | "cocos-rc-snapshot"
    | "cocos-main-journey-manifest"
    | "cocos-rc-bundle";
  label: string;
  required: true;
  status: CheckStatus;
  artifactPath?: string;
  candidate?: string;
  revision?: string;
  generatedAt?: string;
  freshness: FreshnessStatus;
  findings: CheckFinding[];
}

interface CocosRcEvidenceConsistencyReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    expectedRevision: string;
  };
  summary: {
    status: CheckStatus;
    findingCount: number;
    summary: string;
  };
  inputs: {
    releaseReadinessSnapshotPath?: string;
    releaseGateSummaryPath?: string;
    primaryJourneyEvidencePath?: string;
    cocosRcSnapshotPath?: string;
    cocosMainJourneyManifestPath?: string;
    cocosRcBundlePath?: string;
  };
  artifacts: ArtifactCheckReport[];
}

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");
const MAX_DEFAULT_AGE_HOURS = 24;
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate = "";
  let expectedRevision: string | undefined;
  let releaseReadinessSnapshotPath: string | undefined;
  let releaseGateSummaryPath: string | undefined;
  let primaryJourneyEvidencePath: string | undefined;
  let cocosRcSnapshotPath: string | undefined;
  let cocosMainJourneyManifestPath: string | undefined;
  let cocosRcBundlePath: string | undefined;
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
    if (arg === "--expected-revision" && next) {
      expectedRevision = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--release-readiness-snapshot" && next) {
      releaseReadinessSnapshotPath = next;
      index += 1;
      continue;
    }
    if (arg === "--release-gate-summary" && next) {
      releaseGateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--primary-journey-evidence" && next) {
      primaryJourneyEvidencePath = next;
      index += 1;
      continue;
    }
    if (arg === "--cocos-rc-snapshot" && next) {
      cocosRcSnapshotPath = next;
      index += 1;
      continue;
    }
    if (arg === "--cocos-main-journey-manifest" && next) {
      cocosMainJourneyManifestPath = next;
      index += 1;
      continue;
    }
    if (arg === "--cocos-rc-bundle" && next) {
      cocosRcBundlePath = next;
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

  return {
    candidate,
    ...(expectedRevision ? { expectedRevision } : {}),
    ...(releaseReadinessSnapshotPath ? { releaseReadinessSnapshotPath } : {}),
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    ...(primaryJourneyEvidencePath ? { primaryJourneyEvidencePath } : {}),
    ...(cocosRcSnapshotPath ? { cocosRcSnapshotPath } : {}),
    ...(cocosMainJourneyManifestPath ? { cocosMainJourneyManifestPath } : {}),
    ...(cocosRcBundlePath ? { cocosRcBundlePath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    maxAgeHours
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
    .replace(/[^a-z0-9._-]+/g, "-")
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

function resolveReleaseReadinessSnapshotPath(args: Args): string | undefined {
  if (args.releaseReadinessSnapshotPath) {
    return path.resolve(args.releaseReadinessSnapshotPath);
  }
  return resolveLatestFile(
    DEFAULT_OUTPUT_DIR,
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
  const fixed = path.join(DEFAULT_OUTPUT_DIR, "release-gate-summary.json");
  if (fs.existsSync(fixed)) {
    return fixed;
  }
  return resolveLatestFile(DEFAULT_OUTPUT_DIR, (entry) => entry.endsWith(".json") && entry.startsWith("release-gate-summary-"));
}

function resolvePrimaryJourneyEvidencePath(args: Args): string | undefined {
  if (args.primaryJourneyEvidencePath) {
    return path.resolve(args.primaryJourneyEvidencePath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return resolveLatestFile(
    DEFAULT_OUTPUT_DIR,
    (entry) => entry.endsWith(".json") && entry.startsWith("cocos-primary-journey-evidence-"),
    (entry) => entry.includes(`cocos-primary-journey-evidence-${candidateSlug}-`)
  );
}

function resolveCocosRcSnapshotPath(args: Args): string | undefined {
  if (args.cocosRcSnapshotPath) {
    return path.resolve(args.cocosRcSnapshotPath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return resolveLatestFile(
    DEFAULT_OUTPUT_DIR,
    (entry) => entry.endsWith(".json") && entry.startsWith("cocos-rc-snapshot-"),
    (entry) => entry.includes(`cocos-rc-snapshot-${candidateSlug}-`)
  );
}

function resolveCocosMainJourneyManifestPath(args: Args): string | undefined {
  if (args.cocosMainJourneyManifestPath) {
    return path.resolve(args.cocosMainJourneyManifestPath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return resolveLatestFile(
    DEFAULT_OUTPUT_DIR,
    (entry) => entry.endsWith(".json") && entry.startsWith("cocos-main-journey-manifest-"),
    (entry) => entry.includes(`cocos-main-journey-manifest-${candidateSlug}-`)
  );
}

function resolveCocosRcBundlePath(args: Args): string | undefined {
  if (args.cocosRcBundlePath) {
    return path.resolve(args.cocosRcBundlePath);
  }
  const candidateSlug = slugifyCandidate(args.candidate);
  return resolveLatestFile(
    DEFAULT_OUTPUT_DIR,
    (entry) => entry.endsWith(".json") && entry.startsWith("cocos-rc-evidence-bundle-"),
    (entry) => entry.includes(`cocos-rc-evidence-bundle-${candidateSlug}-`)
  );
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

function addFreshnessFinding(
  findings: CheckFinding[],
  freshness: FreshnessStatus,
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

function compareLinkedArtifact(
  selectedArtifactPath: string | undefined,
  linkedArtifactPath: string | undefined,
  label: string,
  artifactPath?: string
): CheckFinding | undefined {
  if (!selectedArtifactPath || !linkedArtifactPath?.trim()) {
    return undefined;
  }
  const selectedBase = path.basename(selectedArtifactPath);
  const linkedBase = path.basename(linkedArtifactPath.trim());
  if (selectedBase === linkedBase) {
    return undefined;
  }
  return {
    code: "linked_artifact_mismatch",
    summary: `${label} references ${linkedBase}, but the selected artifact is ${selectedBase}.`,
    ...(artifactPath ? { artifactPath } : {})
  };
}

function addCommonFindings(
  findings: CheckFinding[],
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
): FreshnessStatus {
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

  addFreshnessFinding(findings, freshness, input.label, input.generatedAt, input.maxAgeMs, input.artifactPath);
  return freshness;
}

function buildMissingArtifact(
  id: ArtifactCheckReport["id"],
  label: string
): ArtifactCheckReport {
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

export function buildCocosRcEvidenceConsistencyReport(args: Args): CocosRcEvidenceConsistencyReport {
  const expectedRevision = args.expectedRevision ?? readGitValue(["rev-parse", "HEAD"]);
  const maxAgeMs = args.maxAgeHours * 60 * 60 * 1000;
  const releaseReadinessSnapshotPath = resolveReleaseReadinessSnapshotPath(args);
  const releaseGateSummaryPath = resolveReleaseGateSummaryPath(args);
  const primaryJourneyEvidencePath = resolvePrimaryJourneyEvidencePath(args);
  const cocosRcSnapshotPath = resolveCocosRcSnapshotPath(args);
  const cocosMainJourneyManifestPath = resolveCocosMainJourneyManifestPath(args);
  const cocosRcBundlePath = resolveCocosRcBundlePath(args);

  const artifacts: ArtifactCheckReport[] = [];

  if (!releaseReadinessSnapshotPath || !fs.existsSync(releaseReadinessSnapshotPath)) {
    artifacts.push(buildMissingArtifact("release-readiness-snapshot", "Release readiness snapshot"));
  } else {
    const snapshot = readJsonFile<ReleaseReadinessSnapshot>(releaseReadinessSnapshotPath);
    const findings: CheckFinding[] = [];
    const freshness = addCommonFindings(findings, {
      label: "Release readiness snapshot",
      candidate: undefined,
      revision: snapshot.revision?.commit ?? snapshot.revision?.shortCommit,
      generatedAt: snapshot.generatedAt,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: releaseReadinessSnapshotPath
    });
    artifacts.push({
      id: "release-readiness-snapshot",
      label: "Release readiness snapshot",
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: releaseReadinessSnapshotPath,
      revision: snapshot.revision?.commit ?? snapshot.revision?.shortCommit,
      generatedAt: snapshot.generatedAt,
      freshness,
      findings
    });
  }

  if (!releaseGateSummaryPath || !fs.existsSync(releaseGateSummaryPath)) {
    artifacts.push(buildMissingArtifact("release-gate-summary", "Release gate summary"));
  } else {
    const summary = readJsonFile<ReleaseGateSummary>(releaseGateSummaryPath);
    const findings: CheckFinding[] = [];
    const freshness = addCommonFindings(findings, {
      label: "Release gate summary",
      candidate: undefined,
      revision: summary.revision?.commit ?? summary.revision?.shortCommit,
      generatedAt: summary.generatedAt,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: releaseGateSummaryPath
    });
    const snapshotLinkFinding = compareLinkedArtifact(
      releaseReadinessSnapshotPath,
      summary.inputs?.snapshotPath,
      "Release gate summary",
      releaseGateSummaryPath
    );
    if (snapshotLinkFinding) {
      findings.push(snapshotLinkFinding);
    }
    artifacts.push({
      id: "release-gate-summary",
      label: "Release gate summary",
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: releaseGateSummaryPath,
      revision: summary.revision?.commit ?? summary.revision?.shortCommit,
      generatedAt: summary.generatedAt,
      freshness,
      findings
    });
  }

  if (!primaryJourneyEvidencePath || !fs.existsSync(primaryJourneyEvidencePath)) {
    artifacts.push(buildMissingArtifact("primary-journey-evidence", "Primary journey evidence"));
  } else {
    const evidence = readJsonFile<PrimaryJourneyEvidence>(primaryJourneyEvidencePath);
    const findings: CheckFinding[] = [];
    const freshness = addCommonFindings(findings, {
      label: "Primary journey evidence",
      candidate: evidence.candidate?.name,
      revision: evidence.candidate?.commit ?? evidence.candidate?.shortCommit,
      generatedAt: evidence.execution?.completedAt,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: primaryJourneyEvidencePath
    });
    artifacts.push({
      id: "primary-journey-evidence",
      label: "Primary journey evidence",
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: primaryJourneyEvidencePath,
      candidate: evidence.candidate?.name,
      revision: evidence.candidate?.commit ?? evidence.candidate?.shortCommit,
      generatedAt: evidence.execution?.completedAt,
      freshness,
      findings
    });
  }

  if (!cocosRcSnapshotPath || !fs.existsSync(cocosRcSnapshotPath)) {
    artifacts.push(buildMissingArtifact("cocos-rc-snapshot", "Cocos RC snapshot"));
  } else {
    const snapshot = readJsonFile<CocosRcSnapshot>(cocosRcSnapshotPath);
    const findings: CheckFinding[] = [];
    const freshness = addCommonFindings(findings, {
      label: "Cocos RC snapshot",
      candidate: snapshot.candidate?.name,
      revision: snapshot.candidate?.commit ?? snapshot.candidate?.shortCommit,
      generatedAt: snapshot.execution?.executedAt,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: cocosRcSnapshotPath
    });
    const readinessLinkFinding = compareLinkedArtifact(
      releaseReadinessSnapshotPath,
      snapshot.linkedEvidence?.releaseReadinessSnapshot?.path,
      "Cocos RC snapshot",
      cocosRcSnapshotPath
    );
    if (readinessLinkFinding) {
      findings.push(readinessLinkFinding);
    }
    const journeyLinkFinding = compareLinkedArtifact(
      primaryJourneyEvidencePath,
      snapshot.linkedEvidence?.primaryJourneyEvidence?.path,
      "Cocos RC snapshot",
      cocosRcSnapshotPath
    );
    if (journeyLinkFinding) {
      findings.push(journeyLinkFinding);
    }
    artifacts.push({
      id: "cocos-rc-snapshot",
      label: "Cocos RC snapshot",
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: cocosRcSnapshotPath,
      candidate: snapshot.candidate?.name,
      revision: snapshot.candidate?.commit ?? snapshot.candidate?.shortCommit,
      generatedAt: snapshot.execution?.executedAt,
      freshness,
      findings
    });
  }

  if (!cocosMainJourneyManifestPath || !fs.existsSync(cocosMainJourneyManifestPath)) {
    artifacts.push(buildMissingArtifact("cocos-main-journey-manifest", "Cocos main-journey manifest"));
  } else {
    const manifest = readJsonFile<CocosMainJourneyManifest>(cocosMainJourneyManifestPath);
    const findings: CheckFinding[] = [];
    const freshness = addCommonFindings(findings, {
      label: "Cocos main-journey manifest",
      candidate: manifest.candidate?.name,
      revision: manifest.candidate?.revision?.commit ?? manifest.candidate?.revision?.shortCommit,
      generatedAt: manifest.generatedAt,
      expectedCandidate: args.candidate,
      expectedRevision,
      maxAgeMs,
      artifactPath: cocosMainJourneyManifestPath
    });
    const snapshotLinkFinding = compareLinkedArtifact(
      releaseReadinessSnapshotPath,
      manifest.linkedEvidence?.snapshot,
      "Cocos main-journey manifest",
      cocosMainJourneyManifestPath
    );
    if (snapshotLinkFinding) {
      findings.push(snapshotLinkFinding);
    }
    const journeyLinkFinding = compareLinkedArtifact(
      primaryJourneyEvidencePath,
      manifest.linkedEvidence?.primaryJourneyEvidence,
      "Cocos main-journey manifest",
      cocosMainJourneyManifestPath
    );
    if (journeyLinkFinding) {
      findings.push(journeyLinkFinding);
    }
    artifacts.push({
      id: "cocos-main-journey-manifest",
      label: "Cocos main-journey manifest",
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: cocosMainJourneyManifestPath,
      candidate: manifest.candidate?.name,
      revision: manifest.candidate?.revision?.commit ?? manifest.candidate?.revision?.shortCommit,
      generatedAt: manifest.generatedAt,
      freshness,
      findings
    });
  }

  if (!cocosRcBundlePath || !fs.existsSync(cocosRcBundlePath)) {
    artifacts.push(buildMissingArtifact("cocos-rc-bundle", "Cocos RC bundle"));
  } else {
    const bundle = readJsonFile<CocosRcBundleManifest>(cocosRcBundlePath);
    const findings: CheckFinding[] = [];
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
    const readinessLinkFinding = compareLinkedArtifact(
      releaseReadinessSnapshotPath,
      bundle.linkedEvidence?.releaseReadinessSnapshot?.path,
      "Cocos RC bundle",
      cocosRcBundlePath
    );
    if (readinessLinkFinding) {
      findings.push(readinessLinkFinding);
    }
    const journeyLinkFinding = compareLinkedArtifact(
      primaryJourneyEvidencePath,
      bundle.artifacts?.primaryJourneyEvidence,
      "Cocos RC bundle",
      cocosRcBundlePath
    );
    if (journeyLinkFinding) {
      findings.push(journeyLinkFinding);
    }
    const mainJourneyLinkFinding = compareLinkedArtifact(
      cocosMainJourneyManifestPath,
      bundle.artifacts?.mainJourneyManifest,
      "Cocos RC bundle",
      cocosRcBundlePath
    );
    if (mainJourneyLinkFinding) {
      findings.push(mainJourneyLinkFinding);
    }
    const snapshotLinkFinding = compareLinkedArtifact(
      cocosRcSnapshotPath,
      bundle.artifacts?.snapshot,
      "Cocos RC bundle",
      cocosRcBundlePath
    );
    if (snapshotLinkFinding) {
      findings.push(snapshotLinkFinding);
    }
    artifacts.push({
      id: "cocos-rc-bundle",
      label: "Cocos RC bundle",
      required: true,
      status: findings.length === 0 ? "passed" : "failed",
      artifactPath: cocosRcBundlePath,
      candidate: bundle.bundle?.candidate,
      revision: bundle.bundle?.commit ?? bundle.bundle?.shortCommit,
      generatedAt: bundle.bundle?.generatedAt,
      freshness,
      findings
    });
  }

  const findings = artifacts.flatMap((artifact) => artifact.findings);
  const status: CheckStatus = findings.length === 0 ? "passed" : "failed";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: args.candidate,
      expectedRevision
    },
    summary: {
      status,
      findingCount: findings.length,
      summary:
        status === "passed"
          ? `Cocos RC evidence is consistent and fresh for ${args.candidate} at ${expectedRevision}.`
          : `Cocos RC evidence drift detected: ${findings[0]?.summary ?? "unknown finding"}`
    },
    inputs: {
      ...(releaseReadinessSnapshotPath ? { releaseReadinessSnapshotPath } : {}),
      ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
      ...(primaryJourneyEvidencePath ? { primaryJourneyEvidencePath } : {}),
      ...(cocosRcSnapshotPath ? { cocosRcSnapshotPath } : {}),
      ...(cocosMainJourneyManifestPath ? { cocosMainJourneyManifestPath } : {}),
      ...(cocosRcBundlePath ? { cocosRcBundlePath } : {})
    },
    artifacts
  };
}

export function renderMarkdown(report: CocosRcEvidenceConsistencyReport): string {
  const lines: string[] = [];
  lines.push("# Cocos RC Evidence Consistency Check");
  lines.push("");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Expected revision: \`${report.candidate.expectedRevision}\``);
  lines.push(`- Overall status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Summary: ${report.summary.summary}`);
  lines.push("");
  lines.push("## Selected Inputs");
  lines.push("");
  lines.push(
    `- Release readiness snapshot: \`${report.inputs.releaseReadinessSnapshotPath ? toRelativePath(report.inputs.releaseReadinessSnapshotPath) : "<missing>"}\``
  );
  lines.push(`- Release gate summary: \`${report.inputs.releaseGateSummaryPath ? toRelativePath(report.inputs.releaseGateSummaryPath) : "<missing>"}\``);
  lines.push(
    `- Primary journey evidence: \`${report.inputs.primaryJourneyEvidencePath ? toRelativePath(report.inputs.primaryJourneyEvidencePath) : "<missing>"}\``
  );
  lines.push(`- Cocos RC snapshot: \`${report.inputs.cocosRcSnapshotPath ? toRelativePath(report.inputs.cocosRcSnapshotPath) : "<missing>"}\``);
  lines.push(
    `- Cocos main-journey manifest: \`${report.inputs.cocosMainJourneyManifestPath ? toRelativePath(report.inputs.cocosMainJourneyManifestPath) : "<missing>"}\``
  );
  lines.push(`- Cocos RC bundle: \`${report.inputs.cocosRcBundlePath ? toRelativePath(report.inputs.cocosRcBundlePath) : "<missing>"}\``);
  lines.push("");
  lines.push("## Artifact Checks");
  lines.push("");

  for (const artifact of report.artifacts) {
    lines.push(`### ${artifact.label}`);
    lines.push("");
    lines.push(`- Status: **${artifact.status.toUpperCase()}**`);
    lines.push(`- Artifact: \`${artifact.artifactPath ? toRelativePath(artifact.artifactPath) : "<missing>"}\``);
    lines.push(`- Candidate: \`${artifact.candidate ?? "<n/a>"}\``);
    lines.push(`- Revision: \`${artifact.revision ?? "<missing>"}\``);
    lines.push(`- Generated at: \`${artifact.generatedAt ?? "<missing>"}\``);
    lines.push(`- Freshness: \`${artifact.freshness}\``);
    if (artifact.findings.length === 0) {
      lines.push("- Findings: none.");
    } else {
      lines.push("- Findings:");
      for (const finding of artifact.findings) {
        lines.push(
          `  - \`${finding.code}\` ${finding.summary}${finding.artifactPath ? ` (artifact: \`${toRelativePath(finding.artifactPath)}\`)` : ""}`
        );
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPath(args: Args, expectedRevision: string): string {
  if (args.outputPath) {
    return path.resolve(args.outputPath);
  }
  return path.resolve(
    DEFAULT_OUTPUT_DIR,
    `cocos-rc-evidence-consistency-${slugifyCandidate(args.candidate)}-${expectedRevision.slice(0, 12)}.json`
  );
}

function defaultMarkdownOutputPath(args: Args, expectedRevision: string): string {
  if (args.markdownOutputPath) {
    return path.resolve(args.markdownOutputPath);
  }
  return path.resolve(
    DEFAULT_OUTPUT_DIR,
    `cocos-rc-evidence-consistency-${slugifyCandidate(args.candidate)}-${expectedRevision.slice(0, 12)}.md`
  );
}

function main(): void {
  const args = parseArgs(process.argv);
  const report = buildCocosRcEvidenceConsistencyReport(args);
  const outputPath = defaultOutputPath(args, report.candidate.expectedRevision);
  const markdownOutputPath = defaultMarkdownOutputPath(args, report.candidate.expectedRevision);

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote Cocos RC evidence consistency JSON: ${toRelativePath(outputPath)}`);
  console.log(`Wrote Cocos RC evidence consistency Markdown: ${toRelativePath(markdownOutputPath)}`);

  if (report.summary.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
