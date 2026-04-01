import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type BuildSurface = "creator_preview" | "wechat_preview" | "wechat_upload_candidate" | "other";
type EvidenceStatus = "pending" | "blocked" | "passed" | "failed" | "not_applicable";
type SnapshotResult = "pending" | "blocked" | "passed" | "failed" | "partial";

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
  checkpointLedger?: {
    source: "primary-journey-evidence";
    milestoneDir: string;
    entryCount: number;
    entries: CheckpointLedgerEntry[];
  };
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
    snapshot: string;
    summaryMarkdown: string;
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

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
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
  lines.push(`- Snapshot: \`${toRepoRelative(artifacts.snapshot)}\``);
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
  lines.push(snapshot.execution.summary);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderChecklist(snapshot: CocosReleaseCandidateSnapshot, artifactPaths: BundleManifest["artifacts"]): string {
  const template = fs.readFileSync(CHECKLIST_TEMPLATE_PATH, "utf8");
  const date = (snapshot.execution.executedAt || new Date().toISOString()).slice(0, 10);
  return template
    .replace("rc-YYYY-MM-DD", snapshot.candidate.name)
    .replace("creator_preview | wechat_preview | wechat_upload_candidate", snapshot.candidate.buildSurface)
    .replace("<git-sha>", snapshot.candidate.commit)
    .replace("<name>", snapshot.execution.owner || "<name>")
    .replace("<YYYY-MM-DD>", date)
    .replace("artifacts/release-readiness/<candidate>.json", toRepoRelative(artifactPaths.summaryMarkdown).replace(/\.md$/, ".json"))
    .replace("artifacts/release-evidence/<candidate>.<surface>.json", toRepoRelative(artifactPaths.snapshot));
}

function renderBlockers(snapshot: CocosReleaseCandidateSnapshot, artifactPaths: BundleManifest["artifacts"]): string {
  const template = fs.readFileSync(BLOCKERS_TEMPLATE_PATH, "utf8");
  const lastUpdated = snapshot.execution.executedAt || new Date().toISOString();
  return template
    .replace("rc-YYYY-MM-DD", snapshot.candidate.name)
    .replace("creator_preview | wechat_preview | wechat_upload_candidate", snapshot.candidate.buildSurface)
    .replace("<git-sha>", snapshot.candidate.commit)
    .replace("<name>", snapshot.execution.owner || "<name>")
    .replace("<YYYY-MM-DD HH:mm TZ>", lastUpdated)
    .replace("artifacts/release-evidence/<candidate>.<surface>.json", toRepoRelative(artifactPaths.snapshot));
}

function toRepoRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function buildManifest(snapshot: CocosReleaseCandidateSnapshot, artifacts: BundleManifest["artifacts"], outputDir: string): BundleManifest {
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
      attachHint: "Attach the markdown summary to CI artifacts or PR comments, and keep the JSON manifest alongside the snapshot."
    }
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
    snapshot: path.resolve(snapshotPath),
    summaryMarkdown: path.resolve(summaryMarkdownPath),
    checklistMarkdown: path.resolve(checklistPath),
    blockersMarkdown: path.resolve(blockersPath)
  };

  writeTextFile(summaryMarkdownPath, renderBundleMarkdown(snapshot, artifacts), args.force);
  writeTextFile(checklistPath, renderChecklist(snapshot, artifacts), args.force);
  writeTextFile(blockersPath, renderBlockers(snapshot, artifacts), args.force);
  writeJsonFile(manifestPath, buildManifest(snapshot, artifacts, outputDir), args.force);

  console.log(`Wrote Cocos RC evidence bundle: ${toRepoRelative(manifestPath)}`);
  console.log(`  Candidate: ${snapshot.candidate.name}`);
  console.log(`  Surface: ${snapshot.candidate.buildSurface}`);
  console.log(`  Result: ${snapshot.execution.overallStatus}`);
}

main();
