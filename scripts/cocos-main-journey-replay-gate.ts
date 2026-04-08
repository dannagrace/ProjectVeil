import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type GateStatus = "passed" | "failed";
type PresentationStatus = "approved" | "approved-for-controlled-test" | "hold" | "missing";
type FindingCode =
  | "missing"
  | "candidate_mismatch"
  | "revision_mismatch"
  | "linked_artifact_mismatch"
  | "missing_step"
  | "non_passing_step"
  | "functional_failure";

interface Args {
  candidate: string;
  expectedRevision?: string;
  primaryJourneyEvidencePath?: string;
  cocosRcSnapshotPath?: string;
  cocosRcBundlePath?: string;
  presentationSignoffPath?: string;
  checklistPath?: string;
  blockersPath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
}

interface PrimaryJourneyEvidenceArtifact {
  candidate?: {
    name?: string;
    commit?: string;
    shortCommit?: string;
  };
  execution?: {
    overallStatus?: "passed" | "failed";
    completedAt?: string;
    summary?: string;
  };
  journey?: Array<{
    id?: string;
    title?: string;
    status?: string;
    summary?: string;
  }>;
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
    primaryJourneyEvidence?: {
      path?: string;
    };
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
    presentationSignoff?: string;
    checklistMarkdown?: string;
    blockersMarkdown?: string;
  };
  review?: {
    functionalEvidence?: {
      status?: string;
      summary?: string;
    };
    presentationSignoff?: {
      status?: PresentationStatus;
      summary?: string;
    };
  };
}

interface PresentationSignoffArtifact {
  candidate?: {
    name?: string;
    commit?: string;
    shortCommit?: string;
  };
  signoff?: {
    status?: PresentationStatus;
    summary?: string;
    blockingItems?: string[];
    controlledTestGaps?: string[];
  };
}

interface GateFinding {
  code: FindingCode;
  summary: string;
  artifactPath?: string;
}

interface ArtifactCheck {
  id: "primary-journey-evidence" | "cocos-rc-snapshot" | "cocos-rc-bundle" | "presentation-signoff" | "checklist" | "blockers";
  label: string;
  artifactPath?: string;
  candidate?: string;
  revision?: string;
  status: GateStatus;
  findings: GateFinding[];
}

interface JourneyCoverageEntry {
  id: string;
  title: string;
  status: string;
  summary: string;
}

interface MainJourneyReplayGateReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    expectedRevision: string;
  };
  summary: {
    status: GateStatus;
    infrastructureFailureCount: number;
    evidenceDriftCount: number;
    presentationBlockerCount: number;
    summary: string;
  };
  inputs: {
    primaryJourneyEvidencePath?: string;
    cocosRcSnapshotPath?: string;
    cocosRcBundlePath?: string;
    presentationSignoffPath?: string;
    checklistPath?: string;
    blockersPath?: string;
  };
  coverage: {
    requiredSteps: JourneyCoverageEntry[];
  };
  artifacts: ArtifactCheck[];
  triage: {
    infrastructureFailures: GateFinding[];
    evidenceDrift: GateFinding[];
    presentationBlockers: string[];
    controlledTestGaps: string[];
    functionalStatus: string;
    functionalSummary: string;
    presentationStatus: PresentationStatus;
    presentationSummary: string;
  };
}

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");
const REQUIRED_STEPS: Array<{ id: string; title: string }> = [
  { id: "lobby-entry", title: "Lobby / login" },
  { id: "room-join", title: "Room join" },
  { id: "map-explore", title: "Map exploration" },
  { id: "first-battle", title: "Encounter battle" },
  { id: "battle-settlement", title: "Settlement" },
  { id: "reconnect-restore", title: "Reconnect / session recovery" }
];
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate = "";
  let expectedRevision: string | undefined;
  let primaryJourneyEvidencePath: string | undefined;
  let cocosRcSnapshotPath: string | undefined;
  let cocosRcBundlePath: string | undefined;
  let presentationSignoffPath: string | undefined;
  let checklistPath: string | undefined;
  let blockersPath: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;

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
    if (arg === "--cocos-rc-bundle" && next) {
      cocosRcBundlePath = next;
      index += 1;
      continue;
    }
    if (arg === "--presentation-signoff" && next) {
      presentationSignoffPath = next;
      index += 1;
      continue;
    }
    if (arg === "--checklist" && next) {
      checklistPath = next;
      index += 1;
      continue;
    }
    if (arg === "--blockers" && next) {
      blockersPath = next;
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

  if (!candidate) {
    fail("Missing required argument: --candidate");
  }

  return {
    candidate,
    ...(expectedRevision ? { expectedRevision } : {}),
    ...(primaryJourneyEvidencePath ? { primaryJourneyEvidencePath } : {}),
    ...(cocosRcSnapshotPath ? { cocosRcSnapshotPath } : {}),
    ...(cocosRcBundlePath ? { cocosRcBundlePath } : {}),
    ...(presentationSignoffPath ? { presentationSignoffPath } : {}),
    ...(checklistPath ? { checklistPath } : {}),
    ...(blockersPath ? { blockersPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {})
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
  const entries = fs
    .readdirSync(dirPath)
    .filter((entry) => matcher(entry))
    .sort((left, right) => {
      const leftPath = path.join(dirPath, left);
      const rightPath = path.join(dirPath, right);
      return fs.statSync(rightPath).mtimeMs - fs.statSync(leftPath).mtimeMs;
    });
  if (preferredMatcher) {
    const preferred = entries.find((entry) => preferredMatcher(entry));
    if (preferred) {
      return path.join(dirPath, preferred);
    }
  }
  return entries[0] ? path.join(dirPath, entries[0]) : undefined;
}

function resolveInputPath(
  explicitPath: string | undefined,
  dirMatcher: (entry: string) => boolean,
  preferredMatcher?: (entry: string) => boolean
): string | undefined {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return resolveLatestFile(DEFAULT_OUTPUT_DIR, dirMatcher, preferredMatcher);
}

function parseMarkdownHeader(filePath: string): { candidate?: string; revision?: string } {
  const content = fs.readFileSync(filePath, "utf8");
  const candidate = content.match(/^- Candidate:\s+`([^`]+)`/m)?.[1];
  const revision = content.match(/^- Commit:\s+`([^`]+)`/m)?.[1];
  return {
    ...(candidate ? { candidate } : {}),
    ...(revision ? { revision } : {})
  };
}

function buildMissingArtifact(id: ArtifactCheck["id"], label: string): ArtifactCheck {
  return {
    id,
    label,
    status: "failed",
    findings: [{ code: "missing", summary: `${label} is missing.` }]
  };
}

function compareLinkedArtifact(expectedPath: string | undefined, actualPath: string | undefined, source: string, artifactPath: string): GateFinding | null {
  if (!expectedPath || !actualPath) {
    return null;
  }
  const normalizedExpected = path.resolve(expectedPath);
  const normalizedActual = path.resolve(actualPath);
  if (normalizedExpected === normalizedActual) {
    return null;
  }
  return {
    code: "linked_artifact_mismatch",
    summary: `${source} links ${toRelativePath(normalizedActual)}, expected ${toRelativePath(normalizedExpected)}.`,
    artifactPath
  };
}

export function buildMainJourneyReplayGateReport(args: Args): MainJourneyReplayGateReport {
  const expectedRevision = args.expectedRevision ?? readGitValue(["rev-parse", "HEAD"]);
  const candidateSlug = slugifyCandidate(args.candidate);
  const primaryJourneyEvidencePath = resolveInputPath(
    args.primaryJourneyEvidencePath,
    (entry) => entry.startsWith("cocos-primary-journey-evidence-") && entry.endsWith(".json"),
    (entry) => entry.includes(`cocos-primary-journey-evidence-${candidateSlug}-`)
  );
  const cocosRcSnapshotPath = resolveInputPath(
    args.cocosRcSnapshotPath,
    (entry) => entry.startsWith("cocos-rc-snapshot-") && entry.endsWith(".json"),
    (entry) => entry.includes(`cocos-rc-snapshot-${candidateSlug}-`)
  );
  const cocosRcBundlePath = resolveInputPath(
    args.cocosRcBundlePath,
    (entry) => entry.startsWith("cocos-rc-evidence-bundle-") && entry.endsWith(".json"),
    (entry) => entry.includes(`cocos-rc-evidence-bundle-${candidateSlug}-`)
  );
  const presentationSignoffPath = resolveInputPath(
    args.presentationSignoffPath,
    (entry) => entry.startsWith("cocos-presentation-signoff-") && entry.endsWith(".json"),
    (entry) => entry.includes(`cocos-presentation-signoff-${candidateSlug}-`)
  );
  const checklistPath = resolveInputPath(
    args.checklistPath,
    (entry) => entry.startsWith("cocos-rc-checklist-") && entry.endsWith(".md"),
    (entry) => entry.includes(`cocos-rc-checklist-${candidateSlug}-`)
  );
  const blockersPath = resolveInputPath(
    args.blockersPath,
    (entry) => entry.startsWith("cocos-rc-blockers-") && entry.endsWith(".md"),
    (entry) => entry.includes(`cocos-rc-blockers-${candidateSlug}-`)
  );

  const artifacts: ArtifactCheck[] = [];
  const evidenceDrift: GateFinding[] = [];
  const infrastructureFailures: GateFinding[] = [];
  let functionalStatus = "missing";
  let functionalSummary = "Primary-client journey evidence is missing.";
  let presentationStatus: PresentationStatus = "missing";
  let presentationSummary = "Presentation sign-off is missing.";
  let presentationBlockers: string[] = [];
  let controlledTestGaps: string[] = [];
  const requiredSteps = REQUIRED_STEPS.map((step) => ({
    id: step.id,
    title: step.title,
    status: "missing",
    summary: "Step is missing from primary journey evidence."
  }));

  if (!primaryJourneyEvidencePath || !fs.existsSync(primaryJourneyEvidencePath)) {
    artifacts.push(buildMissingArtifact("primary-journey-evidence", "Primary journey evidence"));
    evidenceDrift.push({ code: "missing", summary: "Primary journey evidence is missing.", artifactPath: primaryJourneyEvidencePath });
    for (const step of requiredSteps) {
      infrastructureFailures.push({
        code: "missing_step",
        summary: `Primary journey evidence is missing required step ${step.id}.`,
        artifactPath: primaryJourneyEvidencePath
      });
    }
  } else {
    const artifact = readJsonFile<PrimaryJourneyEvidenceArtifact>(primaryJourneyEvidencePath);
    const findings: GateFinding[] = [];
    if (artifact.candidate?.name !== args.candidate) {
      findings.push({
        code: "candidate_mismatch",
        summary: `Primary journey evidence reports candidate ${artifact.candidate?.name ?? "<missing>"}, expected ${args.candidate}.`,
        artifactPath: primaryJourneyEvidencePath
      });
    }
    if (!revisionsMatch(artifact.candidate?.commit ?? artifact.candidate?.shortCommit, expectedRevision)) {
      findings.push({
        code: "revision_mismatch",
        summary: `Primary journey evidence reports revision ${artifact.candidate?.commit ?? artifact.candidate?.shortCommit ?? "<missing>"}, expected ${expectedRevision}.`,
        artifactPath: primaryJourneyEvidencePath
      });
    }
    functionalStatus = artifact.execution?.overallStatus ?? "missing";
    functionalSummary = artifact.execution?.summary ?? functionalSummary;
    if (artifact.execution?.overallStatus !== "passed") {
      infrastructureFailures.push({
        code: "functional_failure",
        summary: `Primary journey evidence is ${artifact.execution?.overallStatus ?? "missing"}: ${artifact.execution?.summary ?? "No summary provided."}`,
        artifactPath: primaryJourneyEvidencePath
      });
    }

    const journeyEntries = new Map((artifact.journey ?? []).map((entry) => [entry.id ?? "", entry]));
    for (const step of requiredSteps) {
      const journeyEntry = journeyEntries.get(step.id);
      if (!journeyEntry) {
        step.status = "missing";
        step.summary = "Step is missing from primary journey evidence.";
        infrastructureFailures.push({
          code: "missing_step",
          summary: `Primary journey evidence does not include required step ${step.id}.`,
          artifactPath: primaryJourneyEvidencePath
        });
        continue;
      }
      step.status = journeyEntry.status ?? "missing";
      step.summary = journeyEntry.summary ?? "";
      if (journeyEntry.status !== "passed") {
        infrastructureFailures.push({
          code: "non_passing_step",
          summary: `Primary journey step ${step.id} is ${journeyEntry.status ?? "missing"}${journeyEntry.summary ? `: ${journeyEntry.summary}` : "."}`,
          artifactPath: primaryJourneyEvidencePath
        });
      }
    }
    artifacts.push({
      id: "primary-journey-evidence",
      label: "Primary journey evidence",
      artifactPath: primaryJourneyEvidencePath,
      candidate: artifact.candidate?.name,
      revision: artifact.candidate?.commit ?? artifact.candidate?.shortCommit,
      status: findings.length === 0 ? "passed" : "failed",
      findings
    });
    evidenceDrift.push(...findings);
  }

  if (!cocosRcSnapshotPath || !fs.existsSync(cocosRcSnapshotPath)) {
    artifacts.push(buildMissingArtifact("cocos-rc-snapshot", "Cocos RC snapshot"));
    evidenceDrift.push({ code: "missing", summary: "Cocos RC snapshot is missing.", artifactPath: cocosRcSnapshotPath });
  } else {
    const snapshot = readJsonFile<CocosRcSnapshot>(cocosRcSnapshotPath);
    const findings: GateFinding[] = [];
    if (snapshot.candidate?.name !== args.candidate) {
      findings.push({
        code: "candidate_mismatch",
        summary: `Cocos RC snapshot reports candidate ${snapshot.candidate?.name ?? "<missing>"}, expected ${args.candidate}.`,
        artifactPath: cocosRcSnapshotPath
      });
    }
    if (!revisionsMatch(snapshot.candidate?.commit ?? snapshot.candidate?.shortCommit, expectedRevision)) {
      findings.push({
        code: "revision_mismatch",
        summary: `Cocos RC snapshot reports revision ${snapshot.candidate?.commit ?? snapshot.candidate?.shortCommit ?? "<missing>"}, expected ${expectedRevision}.`,
        artifactPath: cocosRcSnapshotPath
      });
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
      artifactPath: cocosRcSnapshotPath,
      candidate: snapshot.candidate?.name,
      revision: snapshot.candidate?.commit ?? snapshot.candidate?.shortCommit,
      status: findings.length === 0 ? "passed" : "failed",
      findings
    });
    evidenceDrift.push(...findings);
  }

  if (!cocosRcBundlePath || !fs.existsSync(cocosRcBundlePath)) {
    artifacts.push(buildMissingArtifact("cocos-rc-bundle", "Cocos RC bundle"));
    evidenceDrift.push({ code: "missing", summary: "Cocos RC bundle is missing.", artifactPath: cocosRcBundlePath });
  } else {
    const bundle = readJsonFile<CocosRcBundleManifest>(cocosRcBundlePath);
    const findings: GateFinding[] = [];
    if (bundle.bundle?.candidate !== args.candidate) {
      findings.push({
        code: "candidate_mismatch",
        summary: `Cocos RC bundle reports candidate ${bundle.bundle?.candidate ?? "<missing>"}, expected ${args.candidate}.`,
        artifactPath: cocosRcBundlePath
      });
    }
    if (!revisionsMatch(bundle.bundle?.commit ?? bundle.bundle?.shortCommit, expectedRevision)) {
      findings.push({
        code: "revision_mismatch",
        summary: `Cocos RC bundle reports revision ${bundle.bundle?.commit ?? bundle.bundle?.shortCommit ?? "<missing>"}, expected ${expectedRevision}.`,
        artifactPath: cocosRcBundlePath
      });
    }
    for (const finding of [
      compareLinkedArtifact(primaryJourneyEvidencePath, bundle.artifacts?.primaryJourneyEvidence, "Cocos RC bundle", cocosRcBundlePath),
      compareLinkedArtifact(cocosRcSnapshotPath, bundle.artifacts?.snapshot, "Cocos RC bundle", cocosRcBundlePath),
      compareLinkedArtifact(presentationSignoffPath, bundle.artifacts?.presentationSignoff, "Cocos RC bundle", cocosRcBundlePath),
      compareLinkedArtifact(checklistPath, bundle.artifacts?.checklistMarkdown, "Cocos RC bundle", cocosRcBundlePath),
      compareLinkedArtifact(blockersPath, bundle.artifacts?.blockersMarkdown, "Cocos RC bundle", cocosRcBundlePath)
    ]) {
      if (finding) {
        findings.push(finding);
      }
    }
    functionalStatus = bundle.review?.functionalEvidence?.status ?? functionalStatus;
    functionalSummary = bundle.review?.functionalEvidence?.summary ?? functionalSummary;
    presentationStatus = bundle.review?.presentationSignoff?.status ?? presentationStatus;
    presentationSummary = bundle.review?.presentationSignoff?.summary ?? presentationSummary;
    artifacts.push({
      id: "cocos-rc-bundle",
      label: "Cocos RC bundle",
      artifactPath: cocosRcBundlePath,
      candidate: bundle.bundle?.candidate,
      revision: bundle.bundle?.commit ?? bundle.bundle?.shortCommit,
      status: findings.length === 0 ? "passed" : "failed",
      findings
    });
    evidenceDrift.push(...findings);
  }

  if (!presentationSignoffPath || !fs.existsSync(presentationSignoffPath)) {
    artifacts.push(buildMissingArtifact("presentation-signoff", "Presentation sign-off"));
  } else {
    const signoff = readJsonFile<PresentationSignoffArtifact>(presentationSignoffPath);
    const findings: GateFinding[] = [];
    if (signoff.candidate?.name && signoff.candidate.name !== args.candidate) {
      findings.push({
        code: "candidate_mismatch",
        summary: `Presentation sign-off reports candidate ${signoff.candidate.name}, expected ${args.candidate}.`,
        artifactPath: presentationSignoffPath
      });
    }
    if (
      signoff.candidate?.commit || signoff.candidate?.shortCommit
        ? !revisionsMatch(signoff.candidate?.commit ?? signoff.candidate?.shortCommit, expectedRevision)
        : false
    ) {
      findings.push({
        code: "revision_mismatch",
        summary: `Presentation sign-off reports revision ${signoff.candidate?.commit ?? signoff.candidate?.shortCommit ?? "<missing>"}, expected ${expectedRevision}.`,
        artifactPath: presentationSignoffPath
      });
    }
    presentationStatus = signoff.signoff?.status ?? presentationStatus;
    presentationSummary = signoff.signoff?.summary ?? presentationSummary;
    presentationBlockers = signoff.signoff?.blockingItems ?? presentationBlockers;
    controlledTestGaps = signoff.signoff?.controlledTestGaps ?? controlledTestGaps;
    artifacts.push({
      id: "presentation-signoff",
      label: "Presentation sign-off",
      artifactPath: presentationSignoffPath,
      candidate: signoff.candidate?.name,
      revision: signoff.candidate?.commit ?? signoff.candidate?.shortCommit,
      status: findings.length === 0 ? "passed" : "failed",
      findings
    });
    evidenceDrift.push(...findings);
  }

  for (const [id, label, filePath] of [
    ["checklist", "RC checklist", checklistPath],
    ["blockers", "RC blockers", blockersPath]
  ] as const) {
    if (!filePath || !fs.existsSync(filePath)) {
      artifacts.push(buildMissingArtifact(id, label));
      evidenceDrift.push({ code: "missing", summary: `${label} is missing.`, artifactPath: filePath });
      continue;
    }
    const header = parseMarkdownHeader(filePath);
    const findings: GateFinding[] = [];
    if (header.candidate !== args.candidate) {
      findings.push({
        code: "candidate_mismatch",
        summary: `${label} reports candidate ${header.candidate ?? "<missing>"}, expected ${args.candidate}.`,
        artifactPath: filePath
      });
    }
    if (!revisionsMatch(header.revision, expectedRevision)) {
      findings.push({
        code: "revision_mismatch",
        summary: `${label} reports revision ${header.revision ?? "<missing>"}, expected ${expectedRevision}.`,
        artifactPath: filePath
      });
    }
    artifacts.push({
      id,
      label,
      artifactPath: filePath,
      candidate: header.candidate,
      revision: header.revision,
      status: findings.length === 0 ? "passed" : "failed",
      findings
    });
    evidenceDrift.push(...findings);
  }

  const status: GateStatus = infrastructureFailures.length === 0 && evidenceDrift.length === 0 ? "passed" : "failed";
  const summary =
    status === "passed"
      ? presentationBlockers.length > 0
        ? `Main-journey replay evidence passed for ${args.candidate} at ${expectedRevision}; presentation blockers remain tracked separately.`
        : `Main-journey replay evidence passed for ${args.candidate} at ${expectedRevision}.`
      : `Main-journey replay evidence failed: ${(infrastructureFailures[0] ?? evidenceDrift[0])?.summary ?? "unknown failure"}`;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: args.candidate,
      expectedRevision
    },
    summary: {
      status,
      infrastructureFailureCount: infrastructureFailures.length,
      evidenceDriftCount: evidenceDrift.length,
      presentationBlockerCount: presentationBlockers.length,
      summary
    },
    inputs: {
      ...(primaryJourneyEvidencePath ? { primaryJourneyEvidencePath } : {}),
      ...(cocosRcSnapshotPath ? { cocosRcSnapshotPath } : {}),
      ...(cocosRcBundlePath ? { cocosRcBundlePath } : {}),
      ...(presentationSignoffPath ? { presentationSignoffPath } : {}),
      ...(checklistPath ? { checklistPath } : {}),
      ...(blockersPath ? { blockersPath } : {})
    },
    coverage: {
      requiredSteps
    },
    artifacts,
    triage: {
      infrastructureFailures,
      evidenceDrift,
      presentationBlockers,
      controlledTestGaps,
      functionalStatus,
      functionalSummary,
      presentationStatus,
      presentationSummary
    }
  };
}

export function renderMarkdown(report: MainJourneyReplayGateReport): string {
  const lines: string[] = [];
  lines.push("# Cocos Main-Journey Replay Gate");
  lines.push("");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Expected revision: \`${report.candidate.expectedRevision}\``);
  lines.push(`- Overall status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Summary: ${report.summary.summary}`);
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  lines.push(`- Primary journey evidence: \`${report.inputs.primaryJourneyEvidencePath ? toRelativePath(report.inputs.primaryJourneyEvidencePath) : "<missing>"}\``);
  lines.push(`- Cocos RC snapshot: \`${report.inputs.cocosRcSnapshotPath ? toRelativePath(report.inputs.cocosRcSnapshotPath) : "<missing>"}\``);
  lines.push(`- Cocos RC bundle: \`${report.inputs.cocosRcBundlePath ? toRelativePath(report.inputs.cocosRcBundlePath) : "<missing>"}\``);
  lines.push(`- Presentation sign-off: \`${report.inputs.presentationSignoffPath ? toRelativePath(report.inputs.presentationSignoffPath) : "<missing>"}\``);
  lines.push(`- RC checklist: \`${report.inputs.checklistPath ? toRelativePath(report.inputs.checklistPath) : "<missing>"}\``);
  lines.push(`- RC blockers: \`${report.inputs.blockersPath ? toRelativePath(report.inputs.blockersPath) : "<missing>"}\``);
  lines.push("");
  lines.push("## Required Main Journey Coverage");
  lines.push("");
  lines.push("| Step | Status | Summary |");
  lines.push("| --- | --- | --- |");
  for (const step of report.coverage.requiredSteps) {
    lines.push(`| ${step.title} | \`${step.status}\` | ${step.summary || "_none_"} |`);
  }
  lines.push("");
  lines.push("## Triage");
  lines.push("");
  lines.push(`- Functional evidence status: \`${report.triage.functionalStatus}\``);
  lines.push(`- Functional evidence summary: ${report.triage.functionalSummary}`);
  lines.push(`- Presentation status: \`${report.triage.presentationStatus}\``);
  lines.push(`- Presentation summary: ${report.triage.presentationSummary}`);
  lines.push("");
  lines.push("### Infrastructure Failures");
  lines.push("");
  if (report.triage.infrastructureFailures.length === 0) {
    lines.push("- None.");
  } else {
    for (const finding of report.triage.infrastructureFailures) {
      lines.push(`- \`${finding.code}\` ${finding.summary}${finding.artifactPath ? ` (\`${toRelativePath(finding.artifactPath)}\`)` : ""}`);
    }
  }
  lines.push("");
  lines.push("### Evidence Drift");
  lines.push("");
  if (report.triage.evidenceDrift.length === 0) {
    lines.push("- None.");
  } else {
    for (const finding of report.triage.evidenceDrift) {
      lines.push(`- \`${finding.code}\` ${finding.summary}${finding.artifactPath ? ` (\`${toRelativePath(finding.artifactPath)}\`)` : ""}`);
    }
  }
  lines.push("");
  lines.push("### Presentation Blockers");
  lines.push("");
  if (report.triage.presentationBlockers.length === 0) {
    lines.push("- None.");
  } else {
    for (const blocker of report.triage.presentationBlockers) {
      lines.push(`- ${blocker}`);
    }
  }
  if (report.triage.controlledTestGaps.length > 0) {
    lines.push("");
    lines.push("### Controlled-Test Gaps");
    lines.push("");
    for (const gap of report.triage.controlledTestGaps) {
      lines.push(`- ${gap}`);
    }
  }
  lines.push("");
  lines.push("## Artifact Checks");
  lines.push("");
  for (const artifact of report.artifacts) {
    lines.push(`### ${artifact.label}`);
    lines.push("");
    lines.push(`- Status: **${artifact.status.toUpperCase()}**`);
    lines.push(`- Artifact: \`${artifact.artifactPath ? toRelativePath(artifact.artifactPath) : "<missing>"}\``);
    lines.push(`- Candidate: \`${artifact.candidate ?? "<missing>"}\``);
    lines.push(`- Revision: \`${artifact.revision ?? "<missing>"}\``);
    if (artifact.findings.length === 0) {
      lines.push("- Findings: none.");
    } else {
      lines.push("- Findings:");
      for (const finding of artifact.findings) {
        lines.push(`  - \`${finding.code}\` ${finding.summary}`);
      }
    }
    lines.push("");
  }
  lines.push("## Reviewer Workflow");
  lines.push("");
  lines.push("1. Confirm the six required journey steps are all `passed` before using this packet as primary-client release evidence.");
  lines.push("2. Treat `Infrastructure Failures` and `Evidence Drift` as gate failures for the candidate revision.");
  lines.push("3. Treat `Presentation Blockers` as a separate sign-off track; they do not replace failed journey coverage or mixed-revision evidence.");
  lines.push("4. Attach this Markdown with the bundle manifest when reviewers need one candidate-scoped summary for the main journey.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function defaultOutputPath(args: Args, expectedRevision: string): string {
  if (args.outputPath) {
    return path.resolve(args.outputPath);
  }
  return path.resolve(
    DEFAULT_OUTPUT_DIR,
    `cocos-main-journey-replay-gate-${slugifyCandidate(args.candidate)}-${expectedRevision.slice(0, 12)}.json`
  );
}

function defaultMarkdownOutputPath(args: Args, expectedRevision: string): string {
  if (args.markdownOutputPath) {
    return path.resolve(args.markdownOutputPath);
  }
  return path.resolve(
    DEFAULT_OUTPUT_DIR,
    `cocos-main-journey-replay-gate-${slugifyCandidate(args.candidate)}-${expectedRevision.slice(0, 12)}.md`
  );
}

function main(): void {
  const args = parseArgs(process.argv);
  const report = buildMainJourneyReplayGateReport(args);
  const outputPath = defaultOutputPath(args, report.candidate.expectedRevision);
  const markdownOutputPath = defaultMarkdownOutputPath(args, report.candidate.expectedRevision);

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote Cocos main-journey replay gate JSON: ${toRelativePath(outputPath)}`);
  console.log(`Wrote Cocos main-journey replay gate Markdown: ${toRelativePath(markdownOutputPath)}`);

  if (report.summary.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
