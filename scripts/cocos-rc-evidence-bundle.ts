import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  cocosPresentationReadiness,
  getCocosPresentationReleaseGate
} from "../apps/cocos-client/assets/scripts/cocos-presentation-readiness.ts";

type BuildSurface = "creator_preview" | "wechat_preview" | "wechat_upload_candidate" | "other";
type EvidenceStatus = "pending" | "blocked" | "passed" | "failed" | "not_applicable";
type SnapshotResult = "pending" | "blocked" | "passed" | "failed" | "partial";
type PresentationChecklistStatus = "pass" | "waived-controlled-test" | "fail";
type PresentationSignoffStatus = "approved" | "approved-for-controlled-test" | "hold";

interface Args {
  candidate: string;
  outputDir: string;
  owner?: string;
  buildSurface: BuildSurface;
  server?: string;
  creatorVersion?: string;
  wechatClient?: string;
  device?: string;
  notes?: string;
  wechatSmokeReportPath?: string;
  releaseReadinessSnapshotPath?: string;
  force: boolean;
}

interface LinkedEvidenceRef {
  path: string;
  summary?: string;
  result?: string;
  sourceRevision?: string;
}

interface CanonicalEvidenceField {
  id: string;
  label: string;
  required: boolean;
  value: string;
  notes: string;
  evidence: string[];
}

interface JourneyStep {
  id: string;
  title: string;
  required: boolean;
  status: EvidenceStatus;
  notes: string;
  evidence: string[];
  sourceRefs: string[];
}

interface CheckpointLedgerEntry {
  id: string;
  title: string;
  status: EvidenceStatus;
  summary: string;
  artifactPath: string;
  phase: string;
  roomId: string;
  playerId: string;
  connectionStatus: string;
  lastUpdateReason: string;
  telemetryCheckpoints: string[];
}

interface FailureSummary {
  summary: string;
  regressedJourneySegments: Array<{
    id: string;
    title: string;
    status: EvidenceStatus;
    reason: string;
  }>;
  blockedJourneySegments: Array<{
    id: string;
    title: string;
    status: EvidenceStatus;
    reason: string;
  }>;
  lackingJourneyEvidence: Array<{
    id: string;
    title: string;
    status: EvidenceStatus;
    reason: string;
  }>;
  lackingRequiredEvidence: Array<{
    id: string;
    label: string;
    reason: string;
  }>;
}

interface CocosReleaseCandidateSnapshot {
  schemaVersion: 1;
  candidate: {
    name: string;
    scope: string;
    branch: string;
    commit: string;
    shortCommit: string;
    buildSurface: BuildSurface;
  };
  execution: {
    owner: string;
    executedAt: string;
    overallStatus: SnapshotResult;
    summary: string;
    notes: string;
  };
  environment: {
    server: string;
    cocosCreatorVersion: string;
    wechatClient: string;
    device: string;
  };
  linkedEvidence: {
    primaryJourneyEvidence?: LinkedEvidenceRef;
    releaseReadinessSnapshot?: LinkedEvidenceRef;
    wechatSmokeReport?: LinkedEvidenceRef;
  };
  requiredEvidence: CanonicalEvidenceField[];
  journey: JourneyStep[];
  failureSummary: FailureSummary;
  checkpointLedger?: {
    source: "primary-journey-evidence";
    milestoneDir: string;
    entryCount: number;
    entries: CheckpointLedgerEntry[];
  };
}

interface MainJourneyManifestStep {
  id: string;
  title: string;
  status: EvidenceStatus;
  notes: string;
  evidence: string[];
  flags: {
    placeholder: boolean;
    manualOnly: boolean;
    reason: string;
  };
}

interface MainJourneyManifest {
  schemaVersion: 1;
  candidate: {
    name: string;
    revision: {
      branch: string;
      commit: string;
      shortCommit: string;
    };
    buildSurface: BuildSurface;
  };
  generatedAt: string;
  summary: string;
  linkedEvidence: {
    snapshot: string;
    primaryJourneyEvidence: string;
    primaryJourneyEvidenceMarkdown: string;
  };
  canonicalSteps: MainJourneyManifestStep[];
}

interface BundleManifest {
  schemaVersion: 1;
  bundle: {
    generatedAt: string;
    outputDir: string;
    candidate: string;
    buildSurface: BuildSurface;
    branch: string;
    commit: string;
    shortCommit: string;
    overallStatus: SnapshotResult;
    owner: string;
    summary: string;
  };
  artifacts: {
    primaryJourneyEvidence: string;
    primaryJourneyEvidenceMarkdown: string;
    mainJourneyManifest: string;
    mainJourneyManifestMarkdown: string;
    mainJourneyReplayGate: string;
    mainJourneyReplayGateMarkdown: string;
    snapshot: string;
    summaryMarkdown: string;
    presentationSignoff: string;
    presentationSignoffMarkdown: string;
    checklistMarkdown: string;
    blockersMarkdown: string;
  };
  linkedEvidence: CocosReleaseCandidateSnapshot["linkedEvidence"];
  journey: Array<{
    id: string;
    title: string;
    status: EvidenceStatus;
    evidenceCount: number;
  }>;
  checkpointLedger?: {
    source: "primary-journey-evidence";
    entryCount: number;
    milestoneDir: string;
    entries: Array<{
      id: string;
      title: string;
      status: EvidenceStatus;
      artifactPath: string;
      telemetryCheckpointCount: number;
    }>;
  };
  requiredEvidence: Array<{
    id: string;
    label: string;
    filled: boolean;
    evidenceCount: number;
  }>;
  review: {
    phase1Gate: string;
    attachHint: string;
    functionalEvidence: {
      status: SnapshotResult;
      summary: string;
    };
    mainJourneyReplayGate: {
      status: "passed" | "failed";
      summary: string;
      presentationStatus: "approved" | "approved-for-controlled-test" | "hold" | "missing";
    };
    presentationSignoff: {
      status: PresentationSignoffStatus;
      summary: string;
    };
  };
  failureSummary: FailureSummary;
}

interface PresentationChecklistItem {
  id: string;
  area: string;
  status: PresentationChecklistStatus;
  blockingPolicy: "blocking" | "acceptable-controlled-test-gap";
  detail: string;
  evidence: string[];
  owner: string;
  followUp: string;
}

interface MainJourneyReplayGateReport {
  summary: {
    status: "passed" | "failed";
    summary: string;
  };
  triage: {
    presentationStatus: "approved" | "approved-for-controlled-test" | "hold" | "missing";
  };
}

interface PresentationSignoffArtifact {
  schemaVersion: 1;
  candidate: {
    name: string;
    buildSurface: BuildSurface;
    branch: string;
    commit: string;
    shortCommit: string;
  };
  generatedAt: string;
  reviewer: {
    owner: string;
    reviewDate: string;
  };
  linkedEvidence: {
    snapshot: string;
    bundleSummary: string;
    blockers: string;
    canonicalDoc: string;
  };
  functionalEvidence: {
    status: SnapshotResult;
    summary: string;
  };
  controlledTestPolicy: {
    blocking: string[];
    acceptable: string[];
  };
  automatedReadiness: {
    summary: string;
    nextStep: string;
  };
  checklist: PresentationChecklistItem[];
  signoff: {
    status: PresentationSignoffStatus;
    summary: string;
    blockingItems: string[];
    controlledTestGaps: string[];
  };
}

const DEFAULT_OUTPUT_DIR = path.join("artifacts", "release-readiness");
const CHECKLIST_TEMPLATE_PATH = path.resolve("docs", "release-evidence", "cocos-wechat-rc-checklist.template.md");
const BLOCKERS_TEMPLATE_PATH = path.resolve("docs", "release-evidence", "cocos-wechat-rc-blockers.template.md");

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate = "";
  let outputDir = DEFAULT_OUTPUT_DIR;
  let owner: string | undefined;
  let buildSurface: BuildSurface = "creator_preview";
  let server: string | undefined;
  let creatorVersion: string | undefined;
  let wechatClient: string | undefined;
  let device: string | undefined;
  let notes: string | undefined;
  let wechatSmokeReportPath: string | undefined;
  let releaseReadinessSnapshotPath: string | undefined;
  let force = false;

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
    if (arg === "--owner" && next) {
      owner = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--build-surface" && next) {
      buildSurface = parseBuildSurface(next);
      index += 1;
      continue;
    }
    if (arg === "--server" && next) {
      server = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--creator-version" && next) {
      creatorVersion = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-client" && next) {
      wechatClient = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--device" && next) {
      device = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--notes" && next) {
      notes = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-smoke-report" && next) {
      wechatSmokeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--release-readiness-snapshot" && next) {
      releaseReadinessSnapshotPath = next;
      index += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!candidate) {
    fail("--candidate is required.");
  }

  return {
    candidate,
    outputDir,
    ...(owner ? { owner } : {}),
    buildSurface,
    ...(server ? { server } : {}),
    ...(creatorVersion ? { creatorVersion } : {}),
    ...(wechatClient ? { wechatClient } : {}),
    ...(device ? { device } : {}),
    ...(notes ? { notes } : {}),
    ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
    ...(releaseReadinessSnapshotPath ? { releaseReadinessSnapshotPath } : {}),
    force
  };
}

function parseBuildSurface(value: string): BuildSurface {
  if (
    value === "creator_preview" ||
    value === "wechat_preview" ||
    value === "wechat_upload_candidate" ||
    value === "other"
  ) {
    return value;
  }
  fail(`Unsupported build surface: ${value}`);
}

function getGitValue(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function slugifyCandidate(candidate: string): string {
  const slug = candidate
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "cocos-rc";
}

function writeTextFile(filePath: string, content: string, force: boolean): void {
  if (!force && fs.existsSync(filePath)) {
    fail(`Output file already exists: ${filePath}. Pass --force to overwrite.`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJsonFile(filePath: string, payload: unknown, force: boolean): void {
  writeTextFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, force);
}

function runSnapshotCommand(args: Args, snapshotPath: string): void {
  const commandArgs = [
    "--import",
    "tsx",
    "./scripts/cocos-release-candidate-snapshot.ts",
    "--candidate",
    args.candidate,
    "--build-surface",
    args.buildSurface,
    "--output",
    snapshotPath
  ];

  if (args.owner) {
    commandArgs.push("--owner", args.owner);
  }
  if (args.server) {
    commandArgs.push("--server", args.server);
  }
  if (args.creatorVersion) {
    commandArgs.push("--creator-version", args.creatorVersion);
  }
  if (args.wechatClient) {
    commandArgs.push("--wechat-client", args.wechatClient);
  }
  if (args.device) {
    commandArgs.push("--device", args.device);
  }
  if (args.notes) {
    commandArgs.push("--notes", args.notes);
  }
  if (args.wechatSmokeReportPath) {
    commandArgs.push("--wechat-smoke-report", args.wechatSmokeReportPath);
  }
  commandArgs.push("--primary-journey-evidence", path.join(path.dirname(snapshotPath), `cocos-primary-journey-evidence-${slugifyCandidate(args.candidate)}-${getGitValue(["rev-parse", "--short", "HEAD"])}.json`));
  if (args.releaseReadinessSnapshotPath) {
    commandArgs.push("--release-readiness-snapshot", args.releaseReadinessSnapshotPath);
  }
  if (args.force) {
    commandArgs.push("--force");
  }

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(result.stderr.trim() || result.stdout.trim() || "Failed to generate Cocos RC snapshot.");
  }
}

function runPrimaryJourneyEvidenceCommand(args: Args, outputPath: string, markdownOutputPath: string): void {
  const commandArgs = [
    "--import",
    "tsx",
    "./scripts/cocos-primary-client-journey-evidence.ts",
    "--candidate",
    args.candidate,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath
  ];

  if (args.owner) {
    commandArgs.push("--owner", args.owner);
  }
  if (args.server) {
    commandArgs.push("--server", args.server);
  }

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(result.stderr.trim() || result.stdout.trim() || "Failed to generate primary-client journey evidence.");
  }
}

function runMainJourneyReplayGateCommand(
  args: Args,
  artifacts: Pick<
    BundleManifest["artifacts"],
    "primaryJourneyEvidence" | "snapshot" | "presentationSignoff" | "checklistMarkdown" | "blockersMarkdown"
  >,
  bundleManifestPath: string,
  outputPath: string,
  markdownOutputPath: string
): MainJourneyReplayGateReport {
  const commandArgs = [
    "--import",
    "tsx",
    "./scripts/cocos-main-journey-replay-gate.ts",
    "--candidate",
    args.candidate,
    "--expected-revision",
    getGitValue(["rev-parse", "HEAD"]),
    "--primary-journey-evidence",
    artifacts.primaryJourneyEvidence,
    "--cocos-rc-snapshot",
    artifacts.snapshot,
    "--cocos-rc-bundle",
    bundleManifestPath,
    "--presentation-signoff",
    artifacts.presentationSignoff,
    "--checklist",
    artifacts.checklistMarkdown,
    "--blockers",
    artifacts.blockersMarkdown,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath
  ];

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0 && result.status !== 1) {
    fail(result.stderr.trim() || result.stdout.trim() || "Failed to generate main-journey replay gate.");
  }
  if (!fs.existsSync(outputPath)) {
    fail("Main-journey replay gate did not write the expected JSON output.");
  }
  return readJsonFile<MainJourneyReplayGateReport>(outputPath);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function isManualOnlyEvidence(evidence: string[]): boolean {
  return !evidence.some((entry) => !entry.endsWith(".json"));
}

function buildMainJourneyManifest(snapshot: CocosReleaseCandidateSnapshot, artifacts: BundleManifest["artifacts"]): MainJourneyManifest {
  const canonicalStepIds = new Map<string, string>([
    ["lobby-entry", "Lobby / login"],
    ["room-join", "Room join"],
    ["map-explore", "Map exploration"],
    ["first-battle", "Encounter battle"],
    ["battle-settlement", "Settlement"],
    ["reconnect-restore", "Reconnect / session recovery"]
  ]);

  const canonicalSteps = snapshot.journey
    .filter((step) => canonicalStepIds.has(step.id))
    .map((step) => {
      const manualOnly = isManualOnlyEvidence(step.evidence);
      return {
        id: step.id,
        title: canonicalStepIds.get(step.id) ?? step.title,
        status: step.status,
        notes: step.notes,
        evidence: step.evidence,
        flags: {
          placeholder: manualOnly,
          manualOnly,
          reason: manualOnly
            ? "Only runtime-diagnostics JSON evidence is attached for this step; add manual Creator/WeChat captures if the candidate review requires surface proof."
            : "Surface-visible evidence is attached for this step."
        }
      };
    });

  return {
    schemaVersion: 1,
    candidate: {
      name: snapshot.candidate.name,
      revision: {
        branch: snapshot.candidate.branch,
        commit: snapshot.candidate.commit,
        shortCommit: snapshot.candidate.shortCommit
      },
      buildSurface: snapshot.candidate.buildSurface
    },
    generatedAt: new Date().toISOString(),
    summary:
      "Candidate-scoped canonical Cocos main-journey manifest for lobby/login, room join, map exploration, encounter battle, settlement, and reconnect/session recovery.",
    linkedEvidence: {
      snapshot: toRepoRelative(artifacts.snapshot),
      primaryJourneyEvidence: toRepoRelative(artifacts.primaryJourneyEvidence),
      primaryJourneyEvidenceMarkdown: toRepoRelative(artifacts.primaryJourneyEvidenceMarkdown)
    },
    canonicalSteps
  };
}

function renderMainJourneyManifestMarkdown(manifest: MainJourneyManifest): string {
  const lines: string[] = [];
  lines.push("# Cocos Main-Journey Evidence Manifest");
  lines.push("");
  lines.push(`- Candidate: \`${manifest.candidate.name}\``);
  lines.push(`- Revision: \`${manifest.candidate.revision.shortCommit}\` (${manifest.candidate.revision.branch})`);
  lines.push(`- Commit: \`${manifest.candidate.revision.commit}\``);
  lines.push(`- Surface: \`${manifest.candidate.buildSurface}\``);
  lines.push(`- Generated at: \`${manifest.generatedAt}\``);
  lines.push("");
  lines.push(manifest.summary);
  lines.push("");
  lines.push("## Linked Evidence");
  lines.push("");
  lines.push(`- RC snapshot: \`${manifest.linkedEvidence.snapshot}\``);
  lines.push(`- Primary journey evidence JSON: \`${manifest.linkedEvidence.primaryJourneyEvidence}\``);
  lines.push(`- Primary journey evidence Markdown: \`${manifest.linkedEvidence.primaryJourneyEvidenceMarkdown}\``);
  lines.push("");
  lines.push("## Canonical Main Journey");
  lines.push("");
  lines.push("| Step | Status | Evidence locations | Flags |");
  lines.push("| --- | --- | --- | --- |");
  for (const step of manifest.canonicalSteps) {
    const evidence = step.evidence.length > 0 ? step.evidence.map((entry) => `\`${entry}\``).join("<br>") : "_none_";
    const flags = [`placeholder=${step.flags.placeholder ? "yes" : "no"}`, `manual-only=${step.flags.manualOnly ? "yes" : "no"}`].join(", ");
    lines.push(`| ${step.title} | \`${step.status}\` | ${evidence} | ${flags} |`);
  }
  lines.push("");
  lines.push("## Flag Notes");
  lines.push("");
  for (const step of manifest.canonicalSteps) {
    lines.push(`- ${step.title}: ${step.flags.reason}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderBundleMarkdown(snapshot: CocosReleaseCandidateSnapshot, artifacts: BundleManifest["artifacts"]): string {
  const lines: string[] = [];
  lines.push("# Cocos RC Evidence Bundle");
  lines.push("");
  lines.push(`- Candidate: \`${snapshot.candidate.name}\``);
  lines.push(`- Surface: \`${snapshot.candidate.buildSurface}\``);
  lines.push(`- Commit: \`${snapshot.candidate.shortCommit}\` (${snapshot.candidate.branch})`);
  lines.push(`- Overall status: \`${snapshot.execution.overallStatus}\``);
  lines.push(`- Owner: ${snapshot.execution.owner || "_unassigned_"}`);
  lines.push(`- Generated evidence packet for Phase 1 exit criterion 4 in \`artifacts/release-readiness/\`.`);
  lines.push("");
  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- Primary journey evidence: \`${toRepoRelative(artifacts.primaryJourneyEvidence)}\``);
  lines.push(`- Primary journey markdown: \`${toRepoRelative(artifacts.primaryJourneyEvidenceMarkdown)}\``);
  lines.push(`- Main-journey manifest: \`${toRepoRelative(artifacts.mainJourneyManifest)}\``);
  lines.push(`- Main-journey manifest markdown: \`${toRepoRelative(artifacts.mainJourneyManifestMarkdown)}\``);
  lines.push(`- Main-journey replay gate JSON: \`${toRepoRelative(artifacts.mainJourneyReplayGate)}\``);
  lines.push(`- Main-journey replay gate markdown: \`${toRepoRelative(artifacts.mainJourneyReplayGateMarkdown)}\``);
  lines.push(`- Snapshot: \`${toRepoRelative(artifacts.snapshot)}\``);
  lines.push(`- Presentation sign-off JSON: \`${toRepoRelative(artifacts.presentationSignoff)}\``);
  lines.push(`- Presentation sign-off markdown: \`${toRepoRelative(artifacts.presentationSignoffMarkdown)}\``);
  lines.push(`- Checklist: \`${toRepoRelative(artifacts.checklistMarkdown)}\``);
  lines.push(`- Blockers: \`${toRepoRelative(artifacts.blockersMarkdown)}\``);
  lines.push(`- Bundle manifest: \`${toRepoRelative(artifacts.summaryMarkdown.replace(/\.md$/, ".json"))}\``);
  lines.push("");
  lines.push("## Canonical Journey");
  lines.push("");
  lines.push("| Step | Status | Evidence |");
  lines.push("| --- | --- | --- |");
  for (const step of snapshot.journey) {
    lines.push(`| ${step.title} | \`${step.status}\` | ${step.evidence.length} item(s) |`);
  }
  lines.push("");
  if (snapshot.checkpointLedger?.entries.length) {
    lines.push("## Checkpoint Ledger");
    lines.push("");
    lines.push("| Step | Phase | Telemetry checkpoints | Artifact |");
    lines.push("| --- | --- | --- | --- |");
    for (const entry of snapshot.checkpointLedger.entries) {
      lines.push(
        `| ${entry.title} | \`${entry.phase || "<none>"}\` | ${entry.telemetryCheckpoints.length > 0 ? `\`${entry.telemetryCheckpoints.join(", ")}\`` : "_none_"} | \`${entry.artifactPath}\` |`
      );
    }
    lines.push("");
  }
  lines.push("## Required Evidence");
  lines.push("");
  lines.push("| Field | Value | Evidence |");
  lines.push("| --- | --- | --- |");
  for (const field of snapshot.requiredEvidence) {
    lines.push(`| \`${field.id}\` | ${field.value ? `\`${field.value}\`` : "_missing_"} | ${field.evidence.length} item(s) |`);
  }
  lines.push("");
  if (
    snapshot.linkedEvidence.primaryJourneyEvidence ||
    snapshot.linkedEvidence.releaseReadinessSnapshot ||
    snapshot.linkedEvidence.wechatSmokeReport
  ) {
    lines.push("## Linked Evidence");
    lines.push("");
    if (snapshot.linkedEvidence.primaryJourneyEvidence) {
      lines.push(`- Primary journey evidence: \`${toRepoRelative(snapshot.linkedEvidence.primaryJourneyEvidence.path)}\``);
    }
    if (snapshot.linkedEvidence.releaseReadinessSnapshot) {
      lines.push(`- Release readiness snapshot: \`${toRepoRelative(snapshot.linkedEvidence.releaseReadinessSnapshot.path)}\``);
    }
    if (snapshot.linkedEvidence.wechatSmokeReport) {
      lines.push(`- WeChat smoke report: \`${toRepoRelative(snapshot.linkedEvidence.wechatSmokeReport.path)}\``);
    }
    lines.push("");
  }
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Functional evidence status: \`${snapshot.execution.overallStatus}\``);
  lines.push(snapshot.execution.summary);
  if (
    snapshot.failureSummary.regressedJourneySegments.length > 0 ||
    snapshot.failureSummary.blockedJourneySegments.length > 0 ||
    snapshot.failureSummary.lackingJourneyEvidence.length > 0 ||
    snapshot.failureSummary.lackingRequiredEvidence.length > 0
  ) {
    lines.push("");
    lines.push("## Failure Summary");
    lines.push("");
    lines.push(snapshot.failureSummary.summary);
    lines.push("");
    for (const step of snapshot.failureSummary.regressedJourneySegments) {
      lines.push(`- Regressed: \`${step.id}\` (${step.title}) - ${step.reason}`);
    }
    for (const step of snapshot.failureSummary.blockedJourneySegments) {
      lines.push(`- Blocked: \`${step.id}\` (${step.title}) - ${step.reason}`);
    }
    for (const step of snapshot.failureSummary.lackingJourneyEvidence) {
      lines.push(`- Missing segment evidence: \`${step.id}\` (${step.title}) - ${step.reason}`);
    }
    for (const field of snapshot.failureSummary.lackingRequiredEvidence) {
      lines.push(`- Missing required evidence: \`${field.id}\` (${field.label}) - ${field.reason}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildFunctionalEvidenceReview(snapshot: CocosReleaseCandidateSnapshot): BundleManifest["review"]["functionalEvidence"] {
  return {
    status: snapshot.execution.overallStatus,
    summary: snapshot.execution.summary
  };
}

function buildMainJourneyReplayGateReview(
  report: Pick<MainJourneyReplayGateReport, "summary" | "triage">
): BundleManifest["review"]["mainJourneyReplayGate"] {
  return {
    status: report.summary.status,
    summary: report.summary.summary,
    presentationStatus: report.triage.presentationStatus
  };
}

function buildPresentationChecklist(snapshot: CocosReleaseCandidateSnapshot): PresentationChecklistItem[] {
  const releaseGate = getCocosPresentationReleaseGate(cocosPresentationReadiness);
  const owner = snapshot.execution.owner || "<name>";
  const checklist: PresentationChecklistItem[] = [
    {
      id: "pixel-art-scene-visuals",
      area: "Pixel art / scene visuals",
      status: cocosPresentationReadiness.pixel.stage === "production" ? "pass" : "fail",
      blockingPolicy: cocosPresentationReadiness.pixel.stage === "production" ? "acceptable-controlled-test-gap" : "blocking",
      detail: `${cocosPresentationReadiness.pixel.headline}; ${cocosPresentationReadiness.pixel.detail}`,
      evidence: ["cocos-presentation-readiness", "release bundle summary", "Creator/WeChat captures"],
      owner,
      followUp: cocosPresentationReadiness.pixel.stage === "production" ? "none" : "Replace placeholder or mixed visual assets before widening external evaluation."
    },
    {
      id: "audio-fallback-cues",
      area: "Audio",
      status: cocosPresentationReadiness.audio.stage === "production" ? "pass" : "waived-controlled-test",
      blockingPolicy: cocosPresentationReadiness.audio.stage === "production" ? "acceptable-controlled-test-gap" : "acceptable-controlled-test-gap",
      detail: `${cocosPresentationReadiness.audio.headline}; ${cocosPresentationReadiness.audio.detail}`,
      evidence: ["cocos-presentation-readiness", "device smoke notes", "battle capture"],
      owner,
      followUp: cocosPresentationReadiness.audio.stage === "production" ? "none" : "Allowed only for controlled internal testing while reviewer records player-impact notes and owner follow-up."
    },
    {
      id: "animation-transitions",
      area: "Animation / transitions",
      status: releaseGate.blockers.includes("正式动画资产") || releaseGate.blockers.includes("动画回退交付") ? "fail" : "pass",
      blockingPolicy:
        releaseGate.blockers.includes("正式动画资产") || releaseGate.blockers.includes("动画回退交付")
          ? "blocking"
          : "acceptable-controlled-test-gap",
      detail: `${cocosPresentationReadiness.animation.headline}; ${cocosPresentationReadiness.animation.detail}`,
      evidence: ["cocos-presentation-readiness", "primary journey evidence", "battle diagnostics markdown"],
      owner,
      followUp:
        releaseGate.blockers.includes("正式动画资产") || releaseGate.blockers.includes("动画回退交付")
          ? "Close fallback animation delivery before broader external review."
          : "none"
    },
    {
      id: "hud-copy-readability",
      area: "HUD / copy / readability",
      status: "waived-controlled-test",
      blockingPolicy: "acceptable-controlled-test-gap",
      detail:
        "Manual reviewer must verify Lobby -> world -> battle -> settlement -> reconnect copy remains readable and does not hide required state, even when automation only proves the journey is functionally passed.",
      evidence: ["primary journey evidence markdown", "manual Creator/WeChat screenshots", "RC checklist"],
      owner,
      followUp: "If any copy/state confusion affects first-session comprehension, upgrade this row to fail and link the blocker."
    },
    {
      id: "automation-reported-substitutions",
      area: "Asset substitutions from automation",
      status: releaseGate.ready ? "pass" : "fail",
      blockingPolicy: releaseGate.ready ? "acceptable-controlled-test-gap" : "blocking",
      detail:
        releaseGate.ready
          ? "Automation reports production-intent presentation coverage for the tracked asset families."
          : `Automation still reports unresolved presentation substitutions: ${releaseGate.blockers.join(", ")}.`,
      evidence: ["cocos-presentation-readiness", "bundle manifest", "RC blocker log"],
      owner,
      followUp: releaseGate.ready ? "none" : "List each unresolved substitution in the candidate blocker log or a follow-up issue before sign-off."
    }
  ];

  return checklist;
}

function summarizePresentationSignoff(
  snapshot: CocosReleaseCandidateSnapshot,
  checklist: PresentationChecklistItem[]
): PresentationSignoffArtifact["signoff"] {
  const blockingItems = checklist.filter((item) => item.status === "fail").map((item) => item.area);
  const controlledTestGaps = checklist.filter((item) => item.status === "waived-controlled-test").map((item) => item.area);
  const status: PresentationSignoffStatus =
    blockingItems.length > 0 ? "hold" : controlledTestGaps.length > 0 ? "approved-for-controlled-test" : "approved";
  const summary =
    status === "hold"
      ? `Candidate ${snapshot.candidate.name} is functionally ${snapshot.execution.overallStatus}, but presentation sign-off remains on hold: ${blockingItems.join(", ")}.`
      : status === "approved-for-controlled-test"
        ? `Candidate ${snapshot.candidate.name} functionally passes, but presentation still carries controlled-test-only gaps: ${controlledTestGaps.join(", ")}.`
        : `Candidate ${snapshot.candidate.name} has both functional pass evidence and presentation sign-off coverage for the tracked fallback surfaces.`;

  return {
    status,
    summary,
    blockingItems,
    controlledTestGaps
  };
}

function buildPresentationSignoffArtifact(
  snapshot: CocosReleaseCandidateSnapshot,
  artifacts: BundleManifest["artifacts"]
): PresentationSignoffArtifact {
  const checklist = buildPresentationChecklist(snapshot);
  const signoff = summarizePresentationSignoff(snapshot, checklist);

  return {
    schemaVersion: 1,
    candidate: {
      name: snapshot.candidate.name,
      buildSurface: snapshot.candidate.buildSurface,
      branch: snapshot.candidate.branch,
      commit: snapshot.candidate.commit,
      shortCommit: snapshot.candidate.shortCommit
    },
    generatedAt: new Date().toISOString(),
    reviewer: {
      owner: snapshot.execution.owner,
      reviewDate: (snapshot.execution.executedAt || new Date().toISOString()).slice(0, 10)
    },
    linkedEvidence: {
      snapshot: toRepoRelative(artifacts.snapshot),
      bundleSummary: toRepoRelative(artifacts.summaryMarkdown),
      blockers: toRepoRelative(artifacts.blockersMarkdown),
      canonicalDoc: "docs/cocos-phase1-presentation-signoff.md"
    },
    functionalEvidence: buildFunctionalEvidenceReview(snapshot),
    controlledTestPolicy: {
      blocking: [
        "Any placeholder or fallback issue that makes the first-session journey look materially incomplete for wider external evaluation.",
        "Any missing or fallback animation/visual surface already reported as blocking by cocos-presentation-readiness.",
        "Any presentation issue that hides room identity, reconnect state, battle result, or other release-required evidence."
      ],
      acceptable: [
        "Audio polish gaps may be accepted only for controlled internal testing when the candidate remains functionally passed and the reviewer records owner plus follow-up.",
        "HUD/copy/readability review may stay controlled-test-only when wording is understandable and no required state is obscured.",
        "Controlled-test waivers must stay out of broad external review until the same candidate or a successor closes the gap."
      ]
    },
    automatedReadiness: {
      summary: cocosPresentationReadiness.summary,
      nextStep: cocosPresentationReadiness.nextStep
    },
    checklist,
    signoff
  };
}

function buildPresentationSignoffReview(snapshot: CocosReleaseCandidateSnapshot): BundleManifest["review"]["presentationSignoff"] {
  const artifact = summarizePresentationSignoff(snapshot, buildPresentationChecklist(snapshot));
  return {
    status: artifact.status,
    summary: artifact.summary
  };
}

function renderPresentationSignoffSummary(
  snapshot: CocosReleaseCandidateSnapshot,
  artifacts: BundleManifest["artifacts"]
): string {
  const signoff = buildPresentationSignoffArtifact(snapshot, artifacts);
  const lines: string[] = [];

  lines.push("# Cocos Presentation Sign-Off");
  lines.push("");
  lines.push("This generated artifact is the candidate-scoped presentation fallback checklist and sign-off record that travels with the RC bundle.");
  lines.push("");
  lines.push("## Candidate Header");
  lines.push("");
  lines.push(`- Candidate: \`${signoff.candidate.name}\``);
  lines.push(`- Commit: \`${signoff.candidate.commit}\``);
  lines.push(`- Surface: \`${signoff.candidate.buildSurface}\``);
  lines.push(`- Owner: ${signoff.reviewer.owner || "_unassigned_"}`);
  lines.push(`- Review date: \`${signoff.reviewer.reviewDate}\``);
  lines.push(`- Linked RC snapshot: \`${signoff.linkedEvidence.snapshot}\``);
  lines.push(`- Linked blocker log: \`${signoff.linkedEvidence.blockers}\``);
  lines.push(`- Canonical process doc: \`${signoff.linkedEvidence.canonicalDoc}\``);
  lines.push("");
  lines.push("## Evidence Split");
  lines.push("");
  lines.push(`- Functional evidence status: \`${signoff.functionalEvidence.status}\``);
  lines.push(`- Functional evidence summary: ${signoff.functionalEvidence.summary}`);
  lines.push(`- Presentation sign-off status: \`${signoff.signoff.status}\``);
  lines.push(`- Presentation sign-off summary: ${signoff.signoff.summary}`);
  lines.push("");
  lines.push("## Controlled-Test Policy");
  lines.push("");
  lines.push("- Blocking gaps:");
  for (const rule of signoff.controlledTestPolicy.blocking) {
    lines.push(`  - ${rule}`);
  }
  lines.push("- Acceptable only for controlled internal testing:");
  for (const rule of signoff.controlledTestPolicy.acceptable) {
    lines.push(`  - ${rule}`);
  }
  lines.push("");
  lines.push("## Checklist");
  lines.push("");
  lines.push("| Area | Status | Policy | Detail | Evidence | Follow-up |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const item of signoff.checklist) {
    lines.push(
      `| ${item.area} | \`${item.status}\` | \`${item.blockingPolicy}\` | ${item.detail} | ${item.evidence.map((entry) => `\`${entry}\``).join("<br>")} | ${item.followUp} |`
    );
  }
  lines.push("");
  lines.push("## Reviewer Decision");
  lines.push("");
  lines.push(`- Phase 1 presentation sign-off: \`${signoff.signoff.status}\``);
  lines.push(`- Summary: ${signoff.signoff.summary}`);
  lines.push(`- Blocking items, if any: ${signoff.signoff.blockingItems.length > 0 ? signoff.signoff.blockingItems.join(", ") : "_none_"}.`);
  lines.push(
    `- Controlled-test gaps, if any: ${signoff.signoff.controlledTestGaps.length > 0 ? signoff.signoff.controlledTestGaps.join(", ") : "_none_"}.`
  );
  lines.push(`- Attach this markdown plus \`${toRepoRelative(artifacts.presentationSignoff)}\` with the RC snapshot and blocker log.`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function renderChecklist(snapshot: CocosReleaseCandidateSnapshot, artifactPaths: BundleManifest["artifacts"]): string {
  const template = fs.readFileSync(CHECKLIST_TEMPLATE_PATH, "utf8");
  const recordedAt = snapshot.execution.executedAt || new Date().toISOString();
  const date = recordedAt.slice(0, 10);
  const signoff = summarizePresentationSignoff(snapshot, buildPresentationChecklist(snapshot));
  const releaseReadinessSnapshotPath = snapshot.linkedEvidence.releaseReadinessSnapshot?.path
    ? toRepoRelative(snapshot.linkedEvidence.releaseReadinessSnapshot.path)
    : "_not linked in this bundle_";
  const releaseGateSummaryPath = `artifacts/release-readiness/release-gate-summary-${snapshot.candidate.shortCommit}.json`;
  const ownerLedgerPath = `artifacts/release-readiness/manual-release-evidence-owner-ledger-${slugifyCandidate(snapshot.candidate.name)}-${snapshot.candidate.shortCommit}.md`;
  const canonicalJourneySteps = snapshot.journey.filter((step) => step.id !== "return-to-world");
  const autoFilled = [
    "",
    "## Auto-Filled Main-Journey Evidence",
    "",
    `- Canonical regeneration command: \`npm run release:cocos-rc:bundle -- --candidate ${snapshot.candidate.name} --build-surface ${snapshot.candidate.buildSurface}\``,
    `- Bundle manifest: \`${toRepoRelative(artifactPaths.summaryMarkdown).replace(/\.md$/, ".json")}\``,
    `- Primary journey evidence JSON: \`${toRepoRelative(artifactPaths.primaryJourneyEvidence)}\``,
    `- Primary journey evidence Markdown: \`${toRepoRelative(artifactPaths.primaryJourneyEvidenceMarkdown)}\``,
    `- Main-journey replay gate JSON: \`${toRepoRelative(artifactPaths.mainJourneyReplayGate)}\``,
    `- Main-journey replay gate Markdown: \`${toRepoRelative(artifactPaths.mainJourneyReplayGateMarkdown)}\``,
    `- Automated functional status: \`${snapshot.execution.overallStatus}\``,
    `- Presentation sign-off status: \`${signoff.status}\``,
    "",
    "### Canonical Journey Snapshot",
    "",
    "| Step | Status | Evidence | Notes |",
    "| --- | --- | --- | --- |",
    ...canonicalJourneySteps.map((step) => {
      const notes = step.notes || "_none_";
      return `| ${step.title} | \`${step.status}\` | ${step.evidence.length > 0 ? step.evidence.map((entry) => `\`${entry}\``).join("<br>") : "_none_"} | ${notes} |`;
    }),
    "",
    "### Required Evidence Snapshot",
    "",
    "| Field | Value | Evidence |",
    "| --- | --- | --- |",
    ...snapshot.requiredEvidence.map((field) => {
      const value = field.value.trim() ? `\`${field.value}\`` : "_missing_";
      const evidence = field.evidence.length > 0 ? field.evidence.map((entry) => `\`${entry}\``).join("<br>") : "_none_";
      return `| \`${field.id}\` | ${value} | ${evidence} |`;
    }),
    "",
    "### Automated Gate Call",
    "",
    snapshot.failureSummary.summary,
    ""
  ].join("\n");

  return `${template
    .replaceAll("rc-YYYY-MM-DD", snapshot.candidate.name)
    .replaceAll("creator_preview | wechat_preview | wechat_upload_candidate", snapshot.candidate.buildSurface)
    .replaceAll("<git-sha>", snapshot.candidate.commit)
    .replaceAll("<name>", snapshot.execution.owner || "<name>")
    .replaceAll("<YYYY-MM-DDTHH:MM:SSZ>", recordedAt)
    .replaceAll("<YYYY-MM-DD>", date)
    .replaceAll("<recorded-at>", recordedAt)
    .replaceAll("artifacts/release-readiness/<candidate>.json", releaseReadinessSnapshotPath)
    .replaceAll("artifacts/release-readiness/release-gate-summary-<short-sha>.json", releaseGateSummaryPath)
    .replaceAll("artifacts/release-readiness/manual-release-evidence-owner-ledger-<short-sha>.md", ownerLedgerPath)
    .replaceAll("artifacts/release-evidence/<candidate>.<surface>.json", toRepoRelative(artifactPaths.snapshot))
    }${autoFilled}\n`;
}

function renderBlockers(snapshot: CocosReleaseCandidateSnapshot, artifactPaths: BundleManifest["artifacts"]): string {
  const template = fs.readFileSync(BLOCKERS_TEMPLATE_PATH, "utf8");
  const lastUpdated = snapshot.execution.executedAt || new Date().toISOString();
  const signoff = summarizePresentationSignoff(snapshot, buildPresentationChecklist(snapshot));
  const automatedFindings = [
    ...snapshot.failureSummary.regressedJourneySegments.map((entry) => `| journey-${entry.id} | P0 | Canonical journey | ${entry.id} | ${entry.reason} | \`${toRepoRelative(artifactPaths.primaryJourneyEvidence)}\` | ${snapshot.execution.owner || "<name>"} | Re-run the candidate-scoped primary journey evidence and close the regression on the same revision. | ${lastUpdated} | open |`),
    ...snapshot.failureSummary.blockedJourneySegments.map((entry) => `| journey-${entry.id} | P0 | Canonical journey | ${entry.id} | ${entry.reason} | \`${toRepoRelative(artifactPaths.primaryJourneyEvidence)}\` | ${snapshot.execution.owner || "<name>"} | Re-run the candidate-scoped primary journey evidence and close the blocker on the same revision. | ${lastUpdated} | open |`),
    ...snapshot.failureSummary.lackingJourneyEvidence.map((entry) => `| journey-${entry.id} | P0 | Canonical journey | ${entry.id} | ${entry.reason} | \`${toRepoRelative(artifactPaths.primaryJourneyEvidence)}\` | ${snapshot.execution.owner || "<name>"} | Re-run \`release:cocos-rc:bundle\` so the missing step is regenerated for this candidate revision. | ${lastUpdated} | open |`),
    ...snapshot.failureSummary.lackingRequiredEvidence.map((entry) => `| required-${entry.id} | P0 | Required evidence | ${entry.id} | ${entry.reason} | \`${toRepoRelative(artifactPaths.primaryJourneyEvidence)}\` | ${snapshot.execution.owner || "<name>"} | Regenerate the canonical primary-journey evidence until the required field is populated for this candidate revision. | ${lastUpdated} | open |`),
    ...signoff.blockingItems.map((entry) => `| presentation-${slugifyCandidate(entry)} | P1 | Presentation sign-off | presentation-signoff | ${entry} remains on hold in the generated presentation sign-off. | \`${toRepoRelative(artifactPaths.presentationSignoff)}\` | ${snapshot.execution.owner || "<name>"} | Resolve the presentation blocker or record an explicit waiver before widening release review. | ${lastUpdated} | open |`)
  ];
  const autoFilled = [
    "",
    "## Auto-Filled Candidate Scope",
    "",
    `- Canonical regeneration command: \`npm run release:cocos-rc:bundle -- --candidate ${snapshot.candidate.name} --build-surface ${snapshot.candidate.buildSurface}\``,
    `- Snapshot: \`${toRepoRelative(artifactPaths.snapshot)}\``,
    `- Primary journey evidence: \`${toRepoRelative(artifactPaths.primaryJourneyEvidence)}\``,
    `- Main-journey replay gate: \`${toRepoRelative(artifactPaths.mainJourneyReplayGate)}\``,
    `- Presentation sign-off: \`${toRepoRelative(artifactPaths.presentationSignoff)}\``,
    `- Automated functional status: \`${snapshot.execution.overallStatus}\``,
    `- Automated gate summary: ${snapshot.failureSummary.summary}`,
    `- Presentation sign-off summary: ${signoff.summary}`,
    "",
    "## Auto-Filled Current Blockers",
    "",
    "| ID | Severity | Area | Surface Evidence ID | Summary | Evidence | Owner | Exit Criteria | Next Update | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(automatedFindings.length > 0
      ? automatedFindings
      : [`| none | n/a | n/a | n/a | No open automated journey or required-evidence blockers for this candidate revision. | \`${toRepoRelative(artifactPaths.primaryJourneyEvidence)}\` | ${snapshot.execution.owner || "<name>"} | n/a | ${lastUpdated} | closed |`]),
    ""
  ].join("\n");

  return `${template
    .replaceAll("rc-YYYY-MM-DD", snapshot.candidate.name)
    .replaceAll("creator_preview | wechat_preview | wechat_upload_candidate", snapshot.candidate.buildSurface)
    .replaceAll("<git-sha>", snapshot.candidate.commit)
    .replaceAll("<name>", snapshot.execution.owner || "<name>")
    .replaceAll("<YYYY-MM-DD HH:mm TZ>", lastUpdated)
    .replaceAll("artifacts/release-readiness/release-gate-summary-<short-sha>.json", `artifacts/release-readiness/release-gate-summary-${snapshot.candidate.shortCommit}.json`)
    .replaceAll(
      "artifacts/release-readiness/manual-release-evidence-owner-ledger-<short-sha>.md",
      `artifacts/release-readiness/manual-release-evidence-owner-ledger-${slugifyCandidate(snapshot.candidate.name)}-${snapshot.candidate.shortCommit}.md`
    )
    .replaceAll("artifacts/release-evidence/<candidate>.<surface>.json", toRepoRelative(artifactPaths.snapshot))}${autoFilled}\n`;
}

function toRepoRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function buildManifest(
  snapshot: CocosReleaseCandidateSnapshot,
  artifacts: BundleManifest["artifacts"],
  outputDir: string,
  mainJourneyReplayGate: Pick<MainJourneyReplayGateReport, "summary" | "triage">
): BundleManifest {
  return {
    schemaVersion: 1,
    bundle: {
      generatedAt: new Date().toISOString(),
      outputDir: toRepoRelative(outputDir),
      candidate: snapshot.candidate.name,
      buildSurface: snapshot.candidate.buildSurface,
      branch: snapshot.candidate.branch,
      commit: snapshot.candidate.commit,
      shortCommit: snapshot.candidate.shortCommit,
      overallStatus: snapshot.execution.overallStatus,
      owner: snapshot.execution.owner,
      summary: snapshot.execution.summary
    },
    artifacts,
    linkedEvidence: snapshot.linkedEvidence,
    journey: snapshot.journey.map((step) => ({
      id: step.id,
      title: step.title,
      status: step.status,
      evidenceCount: step.evidence.length
    })),
    ...(snapshot.checkpointLedger
      ? {
          checkpointLedger: {
            source: snapshot.checkpointLedger.source,
            entryCount: snapshot.checkpointLedger.entryCount,
            milestoneDir: snapshot.checkpointLedger.milestoneDir,
            entries: snapshot.checkpointLedger.entries.map((entry) => ({
              id: entry.id,
              title: entry.title,
              status: entry.status,
              artifactPath: entry.artifactPath,
              telemetryCheckpointCount: entry.telemetryCheckpoints.length
            }))
          }
        }
      : {}),
    requiredEvidence: snapshot.requiredEvidence.map((field) => ({
      id: field.id,
      label: field.label,
      filled: field.value.trim().length > 0,
      evidenceCount: field.evidence.length
    })),
    review: {
      phase1Gate: "Phase 1 exit criterion 4: candidate-specific Cocos primary-client evidence must be current.",
      attachHint:
        "Attach the markdown bundle summary and presentation sign-off summary to CI artifacts or PR comments, and keep the JSON manifest alongside the snapshot.",
      functionalEvidence: buildFunctionalEvidenceReview(snapshot),
      mainJourneyReplayGate: buildMainJourneyReplayGateReview(mainJourneyReplayGate),
      presentationSignoff: buildPresentationSignoffReview(snapshot)
    },
    failureSummary: snapshot.failureSummary
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const commit = getGitValue(["rev-parse", "HEAD"]);
  const shortCommit = getGitValue(["rev-parse", "--short", "HEAD"]);
  const slug = slugifyCandidate(args.candidate);
  const outputDir = path.resolve(args.outputDir);
  const baseName = `${slug}-${shortCommit}`;
  const primaryJourneyEvidencePath = path.join(outputDir, `cocos-primary-journey-evidence-${baseName}.json`);
  const primaryJourneyEvidenceMarkdownPath = path.join(outputDir, `cocos-primary-journey-evidence-${baseName}.md`);
  const snapshotPath = path.join(outputDir, `cocos-rc-snapshot-${baseName}.json`);
  const summaryMarkdownPath = path.join(outputDir, `cocos-rc-evidence-bundle-${baseName}.md`);
  const manifestPath = path.join(outputDir, `cocos-rc-evidence-bundle-${baseName}.json`);
  const mainJourneyManifestPath = path.join(outputDir, `cocos-main-journey-manifest-${baseName}.json`);
  const mainJourneyManifestMarkdownPath = path.join(outputDir, `cocos-main-journey-manifest-${baseName}.md`);
  const mainJourneyReplayGatePath = path.join(outputDir, `cocos-main-journey-replay-gate-${baseName}.json`);
  const mainJourneyReplayGateMarkdownPath = path.join(outputDir, `cocos-main-journey-replay-gate-${baseName}.md`);
  const presentationSignoffPath = path.join(outputDir, `cocos-presentation-signoff-${baseName}.json`);
  const presentationSignoffSummaryPath = path.join(outputDir, `cocos-presentation-signoff-${baseName}.md`);
  const checklistPath = path.join(outputDir, `cocos-rc-checklist-${baseName}.md`);
  const blockersPath = path.join(outputDir, `cocos-rc-blockers-${baseName}.md`);

  runPrimaryJourneyEvidenceCommand(args, primaryJourneyEvidencePath, primaryJourneyEvidenceMarkdownPath);
  runSnapshotCommand(args, snapshotPath);

  const snapshot = readJsonFile<CocosReleaseCandidateSnapshot>(snapshotPath);
  if (snapshot.candidate.commit !== commit || snapshot.candidate.shortCommit !== shortCommit) {
    fail("Generated snapshot revision does not match the current git revision.");
  }

  const artifacts: BundleManifest["artifacts"] = {
    primaryJourneyEvidence: path.resolve(primaryJourneyEvidencePath),
    primaryJourneyEvidenceMarkdown: path.resolve(primaryJourneyEvidenceMarkdownPath),
    mainJourneyManifest: path.resolve(mainJourneyManifestPath),
    mainJourneyManifestMarkdown: path.resolve(mainJourneyManifestMarkdownPath),
    mainJourneyReplayGate: path.resolve(mainJourneyReplayGatePath),
    mainJourneyReplayGateMarkdown: path.resolve(mainJourneyReplayGateMarkdownPath),
    snapshot: path.resolve(snapshotPath),
    summaryMarkdown: path.resolve(summaryMarkdownPath),
    presentationSignoff: path.resolve(presentationSignoffPath),
    presentationSignoffMarkdown: path.resolve(presentationSignoffSummaryPath),
    checklistMarkdown: path.resolve(checklistPath),
    blockersMarkdown: path.resolve(blockersPath)
  };
  const mainJourneyManifest = buildMainJourneyManifest(snapshot, artifacts);
  const presentationSignoff = buildPresentationSignoffArtifact(snapshot, artifacts);

  writeJsonFile(mainJourneyManifestPath, mainJourneyManifest, args.force);
  writeTextFile(mainJourneyManifestMarkdownPath, renderMainJourneyManifestMarkdown(mainJourneyManifest), args.force);
  writeJsonFile(presentationSignoffPath, presentationSignoff, args.force);
  writeTextFile(presentationSignoffSummaryPath, renderPresentationSignoffSummary(snapshot, artifacts), args.force);
  writeTextFile(checklistPath, renderChecklist(snapshot, artifacts), args.force);
  writeTextFile(blockersPath, renderBlockers(snapshot, artifacts), args.force);
  writeJsonFile(
    manifestPath,
    buildManifest(snapshot, artifacts, outputDir, {
      summary: { status: "passed", summary: "Main-journey replay gate pending." },
      triage: { presentationStatus: "missing" }
    }),
    args.force
  );
  const mainJourneyReplayGate = runMainJourneyReplayGateCommand(
    args,
    {
      primaryJourneyEvidence: artifacts.primaryJourneyEvidence,
      snapshot: artifacts.snapshot,
      presentationSignoff: artifacts.presentationSignoff,
      checklistMarkdown: artifacts.checklistMarkdown,
      blockersMarkdown: artifacts.blockersMarkdown
    },
    manifestPath,
    mainJourneyReplayGatePath,
    mainJourneyReplayGateMarkdownPath
  );
  writeTextFile(summaryMarkdownPath, renderBundleMarkdown(snapshot, artifacts), args.force);
  writeJsonFile(manifestPath, buildManifest(snapshot, artifacts, outputDir, mainJourneyReplayGate), true);

  console.log(`Wrote Cocos RC evidence bundle: ${toRepoRelative(manifestPath)}`);
  console.log(`  Candidate: ${snapshot.candidate.name}`);
  console.log(`  Surface: ${snapshot.candidate.buildSurface}`);
  console.log(`  Result: ${snapshot.execution.overallStatus}`);
}

main();
