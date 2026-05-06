import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type StageStatus = "passed" | "failed" | "skipped";
type VerificationStatus = "passed" | "failed";

interface Args {
  configPath: string;
  buildDir?: string;
  artifactsDir: string;
  sourceRevision?: string;
  expectedRevision?: string;
  version?: string;
  packageName?: string;
  summaryPath?: string;
  markdownPath?: string;
  requireSmokeReport: boolean;
  candidate?: string;
  candidateRevision?: string;
  environment?: string;
  operator?: string;
  recordedAt?: string;
  status?: VerificationStatus;
  installStatus?: VerificationStatus;
  launchStatus?: VerificationStatus;
  verificationSummary?: string;
  installSummary?: string;
  launchSummary?: string;
  runtimeEvidencePath?: string;
  manualChecksPath?: string;
  runCommercialVerification: boolean;
  commercialChecksPath?: string;
  commercialFreshnessHours?: number;
  runGoNoGoPacket: boolean;
  dossierPath?: string;
  releaseGateSummaryPath?: string;
  evidence: string[];
}

interface GitRevision {
  commit: string | null;
  shortCommit: string | null;
  branch: string | null;
  dirty: boolean;
}

interface StageDefinition {
  id: string;
  title: string;
  command: string[];
}

interface StageResult {
  id: string;
  title: string;
  status: StageStatus;
  summary: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  stdout?: string;
  stderr?: string;
}

interface RehearsalSummary {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  buildDir: string;
  artifactsDir: string;
  summary: {
    status: "passed" | "failed";
    failureStageId?: string;
    failureStageTitle?: string;
    failureSummary?: string;
    artifacts: DetectedArtifacts;
  };
  stages: StageResult[];
  outputs: {
    json: string;
    markdown: string;
  };
}

interface DetectedArtifacts {
  archivePath?: string;
  metadataPath?: string;
  validationReportPath?: string;
  smokeReportPath?: string;
  uploadReceiptPath?: string;
  installLaunchEvidenceJsonPath?: string;
  installLaunchEvidenceMarkdownPath?: string;
  candidateSummaryJsonPath?: string;
  candidateSummaryMarkdownPath?: string;
  commercialVerificationJsonPath?: string;
  commercialVerificationMarkdownPath?: string;
  goNoGoPacketJsonPath?: string;
  goNoGoPacketMarkdownPath?: string;
}

const OUTPUT_LIMIT = 4000;

function parseStatus(value: string | undefined, flag: string): VerificationStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "passed" || value === "failed") {
    return value;
  }
  throw new Error(`Unsupported ${flag} value: ${value}`);
}

function parseArgs(argv: string[]): Args {
  let configPath = "apps/cocos-client/wechat-minigame.build.json";
  let buildDir: string | undefined;
  let artifactsDir = "artifacts/wechat-release";
  let sourceRevision: string | undefined;
  let expectedRevision: string | undefined;
  let version: string | undefined;
  let packageName: string | undefined;
  let summaryPath: string | undefined;
  let markdownPath: string | undefined;
  let requireSmokeReport = false;
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let environment: string | undefined;
  let operator: string | undefined;
  let recordedAt: string | undefined;
  let status: VerificationStatus | undefined;
  let installStatus: VerificationStatus | undefined;
  let launchStatus: VerificationStatus | undefined;
  let verificationSummary: string | undefined;
  let installSummary: string | undefined;
  let launchSummary: string | undefined;
  let runtimeEvidencePath: string | undefined;
  let manualChecksPath: string | undefined;
  let runCommercialVerification = false;
  let commercialChecksPath: string | undefined;
  let commercialFreshnessHours: number | undefined;
  let runGoNoGoPacket = false;
  let dossierPath: string | undefined;
  let releaseGateSummaryPath: string | undefined;
  const evidence: string[] = [];

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--config" && next) {
      configPath = next;
      index += 1;
      continue;
    }
    if (arg === "--build-dir" && next) {
      buildDir = next;
      index += 1;
      continue;
    }
    if (arg === "--artifacts-dir" && next) {
      artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--source-revision" && next) {
      sourceRevision = next.trim() || undefined;
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
    if (arg === "--package-name" && next) {
      packageName = next.trim() || undefined;
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
    if (arg === "--require-smoke-report") {
      requireSmokeReport = true;
      continue;
    }
    if (arg === "--expect-exported-runtime") {
      continue;
    }
    if (arg === "--candidate" && next) {
      candidate = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--candidate-revision" && next) {
      candidateRevision = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--environment" && next) {
      environment = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--operator" && next) {
      operator = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--recorded-at" && next) {
      recordedAt = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      status = parseStatus(next.trim(), "--status");
      index += 1;
      continue;
    }
    if (arg === "--install-status" && next) {
      installStatus = parseStatus(next.trim(), "--install-status");
      index += 1;
      continue;
    }
    if (arg === "--launch-status" && next) {
      launchStatus = parseStatus(next.trim(), "--launch-status");
      index += 1;
      continue;
    }
    if (arg === "--verification-summary" && next) {
      verificationSummary = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--install-summary" && next) {
      installSummary = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--launch-summary" && next) {
      launchSummary = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--runtime-evidence" && next) {
      runtimeEvidencePath = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--manual-checks" && next) {
      manualChecksPath = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--run-commercial-verification") {
      runCommercialVerification = true;
      continue;
    }
    if (arg === "--commercial-checks" && next) {
      commercialChecksPath = next.trim() || undefined;
      runCommercialVerification = true;
      index += 1;
      continue;
    }
    if (arg === "--commercial-freshness-hours" && next) {
      commercialFreshnessHours = Number.parseInt(next, 10);
      if (!Number.isFinite(commercialFreshnessHours) || commercialFreshnessHours <= 0) {
        throw new Error(`--commercial-freshness-hours must be a positive integer, received: ${next}`);
      }
      runCommercialVerification = true;
      index += 1;
      continue;
    }
    if (arg === "--run-go-no-go-packet") {
      runGoNoGoPacket = true;
      continue;
    }
    if (arg === "--dossier" && next) {
      dossierPath = next.trim() || undefined;
      runGoNoGoPacket = true;
      index += 1;
      continue;
    }
    if (arg === "--release-gate-summary" && next) {
      releaseGateSummaryPath = next.trim() || undefined;
      runGoNoGoPacket = true;
      index += 1;
      continue;
    }
    if (arg === "--evidence" && next) {
      const value = next.trim();
      if (value) {
        evidence.push(value);
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    configPath,
    ...(buildDir ? { buildDir } : {}),
    artifactsDir,
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(expectedRevision ? { expectedRevision } : {}),
    ...(version ? { version } : {}),
    ...(packageName ? { packageName } : {}),
    ...(summaryPath ? { summaryPath } : {}),
    ...(markdownPath ? { markdownPath } : {}),
    requireSmokeReport,
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    ...(environment ? { environment } : {}),
    ...(operator ? { operator } : {}),
    ...(recordedAt ? { recordedAt } : {}),
    ...(status ? { status } : {}),
    ...(installStatus ? { installStatus } : {}),
    ...(launchStatus ? { launchStatus } : {}),
    ...(verificationSummary ? { verificationSummary } : {}),
    ...(installSummary ? { installSummary } : {}),
    ...(launchSummary ? { launchSummary } : {}),
    ...(runtimeEvidencePath ? { runtimeEvidencePath } : {}),
    ...(manualChecksPath ? { manualChecksPath } : {}),
    runCommercialVerification,
    ...(commercialChecksPath ? { commercialChecksPath } : {}),
    ...(commercialFreshnessHours ? { commercialFreshnessHours } : {}),
    runGoNoGoPacket,
    ...(dossierPath ? { dossierPath } : {}),
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    evidence
  };
}

function readGit(command: string[]): string | null {
  const result = spawnSync("git", command, { encoding: "utf8" });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return null;
}

function readGitRevision(): GitRevision {
  const commit = readGit(["rev-parse", "HEAD"]);
  const shortCommit = readGit(["rev-parse", "--short", "HEAD"]);
  const branch = readGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = readGit(["status", "--porcelain"]);
  return {
    commit,
    shortCommit,
    branch,
    dirty: Boolean(status && status.length > 0)
  };
}

function formatCommand(args: string[]): string {
  return args
    .map((part) => {
      if (/[^A-Za-z0-9_\-/.]/.test(part)) {
        return JSON.stringify(part);
      }
      return part;
    })
    .join(" ");
}

function tailOutput(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= OUTPUT_LIMIT) {
    return normalized;
  }
  return normalized.slice(-OUTPUT_LIMIT);
}

function buildFailureSummary(stderr?: string, stdout?: string, exitCode?: number | null): string {
  if (stderr?.trim()) {
    return stderr.trim().split(/\r?\n/)[0] ?? `Command exited with code ${exitCode ?? -1}.`;
  }
  if (stdout?.trim()) {
    return stdout.trim().split(/\r?\n/)[0] ?? `Command exited with code ${exitCode ?? -1}.`;
  }
  return `Command exited with code ${exitCode ?? -1}.`;
}

function runStage(stage: StageDefinition): StageResult {
  const start = Date.now();
  const result = spawnSync(stage.command[0], stage.command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const durationMs = Date.now() - start;
  const stdout = tailOutput(result.stdout);
  const stderr = tailOutput(result.stderr);
  if (result.error) {
    return {
      id: stage.id,
      title: stage.title,
      status: "failed",
      summary: result.error.message,
      command: formatCommand(stage.command),
      exitCode: result.status ?? 1,
      durationMs,
      ...(stdout ? { stdout } : {}),
      ...(stderr ? { stderr } : {})
    };
  }
  if (result.status !== 0) {
    return {
      id: stage.id,
      title: stage.title,
      status: "failed",
      summary: buildFailureSummary(stderr, stdout, result.status),
      command: formatCommand(stage.command),
      exitCode: result.status,
      durationMs,
      ...(stdout ? { stdout } : {}),
      ...(stderr ? { stderr } : {})
    };
  }
  const successLine = stdout?.split(/\r?\n/)[0] ?? "ok";
  return {
    id: stage.id,
    title: stage.title,
    status: "passed",
    summary: successLine,
    command: formatCommand(stage.command),
    exitCode: result.status,
    durationMs,
    ...(stdout ? { stdout } : {}),
    ...(stderr ? { stderr } : {})
  };
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeFile(filePath: string, content: string): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function toRelative(targetPath: string): string {
  return path.relative(process.cwd(), targetPath).replace(/\\/g, "/");
}

function detectArtifacts(artifactsDir: string): DetectedArtifacts {
  if (!fs.existsSync(artifactsDir)) {
    return {};
  }
  const entries = fs.readdirSync(artifactsDir);
  const archive = entries.find((entry) => entry.endsWith(".tar.gz"));
  const metadata = entries.find((entry) => entry.endsWith(".package.json"));
  const report = entries.find((entry) => entry === "codex.wechat.rc-validation-report.json");
  const smoke = entries.find((entry) => entry === "codex.wechat.smoke-report.json");
  const receipt = entries.find((entry) => entry.endsWith(".upload.json"));
  const installLaunchEvidenceJson = entries.find((entry) => entry === "codex.wechat.install-launch-evidence.json");
  const installLaunchEvidenceMarkdown = entries.find((entry) => entry === "codex.wechat.install-launch-evidence.md");
  const candidateSummaryJson = entries.find((entry) => entry === "codex.wechat.release-candidate-summary.json");
  const candidateSummaryMarkdown = entries.find((entry) => entry === "codex.wechat.release-candidate-summary.md");
  const goNoGoPacketJson = entries.find((entry) => entry === "codex.wechat.go-no-go-decision-packet.json");
  const goNoGoPacketMarkdown = entries.find((entry) => entry === "codex.wechat.go-no-go-decision-packet.md");
  const commercialVerificationJson = entries
    .filter((entry) => entry.startsWith("codex.wechat.commercial-verification-") && entry.endsWith(".json"))
    .sort()[0];
  const commercialVerificationMarkdown = entries
    .filter((entry) => entry.startsWith("codex.wechat.commercial-verification-") && entry.endsWith(".md"))
    .sort()[0];
  return {
    ...(archive ? { archivePath: path.join(artifactsDir, archive) } : {}),
    ...(metadata ? { metadataPath: path.join(artifactsDir, metadata) } : {}),
    ...(report ? { validationReportPath: path.join(artifactsDir, report) } : {}),
    ...(smoke ? { smokeReportPath: path.join(artifactsDir, smoke) } : {}),
    ...(receipt ? { uploadReceiptPath: path.join(artifactsDir, receipt) } : {}),
    ...(installLaunchEvidenceJson ? { installLaunchEvidenceJsonPath: path.join(artifactsDir, installLaunchEvidenceJson) } : {}),
    ...(installLaunchEvidenceMarkdown ? { installLaunchEvidenceMarkdownPath: path.join(artifactsDir, installLaunchEvidenceMarkdown) } : {}),
    ...(candidateSummaryJson ? { candidateSummaryJsonPath: path.join(artifactsDir, candidateSummaryJson) } : {}),
    ...(candidateSummaryMarkdown
      ? { candidateSummaryMarkdownPath: path.join(artifactsDir, candidateSummaryMarkdown) }
      : {}),
    ...(goNoGoPacketJson ? { goNoGoPacketJsonPath: path.join(artifactsDir, goNoGoPacketJson) } : {}),
    ...(goNoGoPacketMarkdown ? { goNoGoPacketMarkdownPath: path.join(artifactsDir, goNoGoPacketMarkdown) } : {}),
    ...(commercialVerificationJson
      ? { commercialVerificationJsonPath: path.join(artifactsDir, commercialVerificationJson) }
      : {}),
    ...(commercialVerificationMarkdown
      ? { commercialVerificationMarkdownPath: path.join(artifactsDir, commercialVerificationMarkdown) }
      : {})
  };
}

function renderMarkdown(summary: RehearsalSummary): string {
  const lines: string[] = [];
  lines.push("# WeChat Release Rehearsal\n\n");
  const statusLine = summary.summary.status === "passed"
    ? "Passed"
    : `Failed at ${summary.summary.failureStageTitle ?? summary.summary.failureStageId ?? "unknown stage"}`;
  lines.push(`- Status: **${statusLine}**\n`);
  if (summary.revision.commit) {
    lines.push(`- Commit: ${summary.revision.commit}${summary.revision.dirty ? " (dirty)" : ""}\n`);
  }
  if (summary.revision.branch) {
    lines.push(`- Branch: ${summary.revision.branch}\n`);
  }
  lines.push(`- Build Dir: \`${summary.buildDir}\`\n`);
  lines.push(`- Artifacts Dir: \`${summary.artifactsDir}\`\n\n`);
  lines.push("| Stage | Status | Notes |\n| --- | --- | --- |\n");
  for (const stage of summary.stages) {
    const safeSummary = stage.summary.replace(/\|/g, "\\|");
    lines.push(`| ${stage.title} | ${stage.status.toUpperCase()} | ${safeSummary} |\n`);
  }
  if (summary.summary.failureSummary) {
    lines.push("\n## Failure Diagnostics\n\n");
    lines.push(`${summary.summary.failureSummary}\n`);
  }
  const artifacts = summary.summary.artifacts;
  const artifactLines: string[] = [];
  if (artifacts.archivePath) {
    artifactLines.push(`- Archive: \`${artifacts.archivePath}\``);
  }
  if (artifacts.metadataPath) {
    artifactLines.push(`- Sidecar: \`${artifacts.metadataPath}\``);
  }
  if (artifacts.validationReportPath) {
    artifactLines.push(`- Validation Report: \`${artifacts.validationReportPath}\``);
  }
  if (artifacts.smokeReportPath) {
    artifactLines.push(`- Smoke Report: \`${artifacts.smokeReportPath}\``);
  }
  if (artifacts.uploadReceiptPath) {
    artifactLines.push(`- Upload Receipt: \`${artifacts.uploadReceiptPath}\``);
  }
  if (artifacts.installLaunchEvidenceJsonPath) {
    artifactLines.push(`- Install/Launch Evidence (JSON): \`${artifacts.installLaunchEvidenceJsonPath}\``);
  }
  if (artifacts.installLaunchEvidenceMarkdownPath) {
    artifactLines.push(`- Install/Launch Evidence (Markdown): \`${artifacts.installLaunchEvidenceMarkdownPath}\``);
  }
  if (artifacts.candidateSummaryJsonPath) {
    artifactLines.push(`- Candidate Summary (JSON): \`${artifacts.candidateSummaryJsonPath}\``);
  }
  if (artifacts.candidateSummaryMarkdownPath) {
    artifactLines.push(`- Candidate Summary (Markdown): \`${artifacts.candidateSummaryMarkdownPath}\``);
  }
  if (artifacts.goNoGoPacketJsonPath) {
    artifactLines.push(`- Go/No-Go Packet (JSON): \`${artifacts.goNoGoPacketJsonPath}\``);
  }
  if (artifacts.goNoGoPacketMarkdownPath) {
    artifactLines.push(`- Go/No-Go Packet (Markdown): \`${artifacts.goNoGoPacketMarkdownPath}\``);
  }
  if (artifacts.commercialVerificationJsonPath) {
    artifactLines.push(`- Commercial Verification (JSON): \`${artifacts.commercialVerificationJsonPath}\``);
  }
  if (artifacts.commercialVerificationMarkdownPath) {
    artifactLines.push(`- Commercial Verification (Markdown): \`${artifacts.commercialVerificationMarkdownPath}\``);
  }
  if (artifactLines.length > 0) {
    lines.push("\n## Artifacts\n\n");
    lines.push(artifactLines.join("\n"));
    lines.push("\n");
  }
  return lines.join("");
}

function main(): void {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const revision = readGitRevision();
  const resolvedConfigPath = path.resolve(repoRoot, args.configPath);
  const config = JSON.parse(fs.readFileSync(resolvedConfigPath, "utf8")) as { buildOutputDir?: string };
  const resolvedBuildDir = path.resolve(repoRoot, args.buildDir ?? config.buildOutputDir ?? "build/wechatgame");
  const resolvedArtifactsDir = path.resolve(repoRoot, args.artifactsDir);
  const sourceRevision = args.sourceRevision ?? revision.commit ?? undefined;
  const expectedRevision = args.expectedRevision ?? sourceRevision;
  const resolvedRuntimeEvidencePath = args.runtimeEvidencePath ? path.resolve(repoRoot, args.runtimeEvidencePath) : undefined;
  const resolvedManualChecksPath = args.manualChecksPath ? path.resolve(repoRoot, args.manualChecksPath) : undefined;
  const resolvedCommercialChecksPath = args.commercialChecksPath ? path.resolve(repoRoot, args.commercialChecksPath) : undefined;
  const resolvedDossierPath = args.dossierPath ? path.resolve(repoRoot, args.dossierPath) : undefined;
  const resolvedReleaseGateSummaryPath = args.releaseGateSummaryPath ? path.resolve(repoRoot, args.releaseGateSummaryPath) : undefined;
  const summaryBaseName = revision.shortCommit ? `wechat-release-rehearsal-${revision.shortCommit}` : `wechat-release-rehearsal`;
  const summaryPath = path.resolve(repoRoot, args.summaryPath ?? path.join(args.artifactsDir, `${summaryBaseName}.json`));
  const markdownPath = path.resolve(repoRoot, args.markdownPath ?? path.join(args.artifactsDir, `${summaryBaseName}.md`));
  const smokeReportPath = path.join(resolvedArtifactsDir, "codex.wechat.smoke-report.json");
  const goNoGoPacketJsonPath = path.join(resolvedArtifactsDir, "codex.wechat.go-no-go-decision-packet.json");
  const goNoGoPacketMarkdownPath = path.join(resolvedArtifactsDir, "codex.wechat.go-no-go-decision-packet.md");

  const hasInstallLaunchOptions =
    Boolean(
      args.candidate ||
        args.candidateRevision ||
        args.environment ||
        args.operator ||
        args.recordedAt ||
        args.status ||
        args.installStatus ||
        args.launchStatus ||
        args.verificationSummary ||
        args.installSummary ||
        args.launchSummary
    ) || args.evidence.length > 0;
  const shouldRecordInstallLaunchEvidence = hasInstallLaunchOptions;

  if (hasInstallLaunchOptions) {
    if (!args.candidate?.trim()) {
      throw new Error("Pass --candidate <candidate-name> when recording WeChat install/launch evidence in the rehearsal.");
    }
    if (!args.environment?.trim()) {
      throw new Error("Pass --environment <wechat-devtools|device-lab|qa-phone> when recording WeChat install/launch evidence.");
    }
    if (!args.operator?.trim()) {
      throw new Error("Pass --operator <name> when recording WeChat install/launch evidence.");
    }
    if (!args.status && !args.installStatus && !args.launchStatus) {
      throw new Error("Pass --status <passed|failed> or explicit --install-status/--launch-status when recording WeChat install/launch evidence.");
    }
  }

  fs.mkdirSync(resolvedArtifactsDir, { recursive: true });

  const nodeExec = process.execPath;
  const stageDefinitions: StageDefinition[] = [
    {
      id: "prepare",
      title: "Prepare release metadata",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/prepare-wechat-minigame-release.ts",
        "--config",
        resolvedConfigPath,
        "--output-dir",
        resolvedBuildDir,
        "--expect-exported-runtime",
        ...(sourceRevision ? ["--source-revision", sourceRevision] : [])
      ]
    },
    {
      id: "package",
      title: "Package release artifact",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/package-wechat-minigame-release.ts",
        "--config",
        resolvedConfigPath,
        "--output-dir",
        resolvedBuildDir,
        "--artifacts-dir",
        resolvedArtifactsDir,
        "--expect-exported-runtime",
        ...(sourceRevision ? ["--source-revision", sourceRevision] : []),
        ...(args.packageName ? ["--package-name", args.packageName] : [])
      ]
    },
    {
      id: "verify",
      title: "Verify packaged artifact",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/verify-wechat-minigame-artifact.ts",
        "--artifacts-dir",
        resolvedArtifactsDir,
        ...(expectedRevision ? ["--expected-revision", expectedRevision] : [])
      ]
    }
  ];

  if (shouldRecordInstallLaunchEvidence) {
    stageDefinitions.push({
      id: "install-launch-evidence",
      title: "Record WeChat install/launch evidence",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/wechat-package-install-launch-evidence.ts",
        "--artifacts-dir",
        resolvedArtifactsDir,
        "--candidate",
        args.candidate!.trim(),
        ...(args.candidateRevision?.trim() ? ["--candidate-revision", args.candidateRevision.trim()] : []),
        "--environment",
        args.environment!.trim(),
        "--operator",
        args.operator!.trim(),
        ...(args.recordedAt?.trim() ? ["--recorded-at", args.recordedAt.trim()] : []),
        ...(args.status ? ["--status", args.status] : []),
        ...(args.installStatus ? ["--install-status", args.installStatus] : []),
        ...(args.launchStatus ? ["--launch-status", args.launchStatus] : []),
        ...(args.verificationSummary?.trim() ? ["--summary", args.verificationSummary.trim()] : []),
        ...(args.installSummary?.trim() ? ["--install-summary", args.installSummary.trim()] : []),
        ...(args.launchSummary?.trim() ? ["--launch-summary", args.launchSummary.trim()] : []),
        ...args.evidence.flatMap((entry) => ["--evidence", entry])
      ]
    });
  }

  if (resolvedRuntimeEvidencePath) {
    stageDefinitions.push({
      id: "smoke",
      title: "Generate WeChat smoke report",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/smoke-wechat-minigame-release.ts",
        "--artifacts-dir",
        resolvedArtifactsDir,
        "--report",
        smokeReportPath,
        "--runtime-evidence",
        resolvedRuntimeEvidencePath,
        "--force"
      ]
    });
  }

  stageDefinitions.push({
      id: "validate",
      title: "Validate release candidate",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/validate-wechat-release-candidate.ts",
        "--artifacts-dir",
        resolvedArtifactsDir,
        ...(expectedRevision ? ["--expected-revision", expectedRevision] : []),
        ...(args.version ? ["--version", args.version] : []),
        ...(args.requireSmokeReport ? ["--require-smoke-report"] : []),
        ...(resolvedManualChecksPath ? ["--manual-checks", resolvedManualChecksPath] : [])
      ]
    }
  );

  if (args.runCommercialVerification) {
    stageDefinitions.push({
      id: "commercial-verification",
      title: "Generate commercial verification summary",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/wechat-commercial-verification.ts",
        "--artifacts-dir",
        resolvedArtifactsDir,
        ...(resolvedCommercialChecksPath ? ["--checks", resolvedCommercialChecksPath] : []),
        ...(args.candidate?.trim() ? ["--candidate", args.candidate.trim()] : []),
        ...((args.candidateRevision ?? expectedRevision)?.trim()
          ? ["--candidate-revision", (args.candidateRevision ?? expectedRevision)!.trim()]
          : []),
        ...(args.commercialFreshnessHours ? ["--freshness-hours", String(args.commercialFreshnessHours)] : [])
      ]
    });
  }

  if (args.runGoNoGoPacket) {
    stageDefinitions.push({
      id: "go-no-go-packet",
      title: "Generate go/no-go decision packet",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/release-go-no-go-decision-packet.ts",
        "--wechat-artifacts-dir",
        resolvedArtifactsDir,
        ...(args.candidate?.trim() ? ["--candidate", args.candidate.trim()] : []),
        ...((args.candidateRevision ?? expectedRevision)?.trim()
          ? ["--candidate-revision", (args.candidateRevision ?? expectedRevision)!.trim()]
          : []),
        ...(resolvedDossierPath ? ["--dossier", resolvedDossierPath] : []),
        ...(resolvedReleaseGateSummaryPath ? ["--release-gate-summary", resolvedReleaseGateSummaryPath] : []),
        "--output",
        goNoGoPacketJsonPath,
        "--markdown-output",
        goNoGoPacketMarkdownPath
      ]
    });
  }

  const stageResults: StageResult[] = [];
  let failureStage: StageResult | undefined;

  for (const stage of stageDefinitions) {
    if (failureStage) {
      stageResults.push({
        id: stage.id,
        title: stage.title,
        status: "skipped",
        summary: `Skipped because ${failureStage.id} failed`,
        command: formatCommand(stage.command),
        exitCode: null,
        durationMs: 0
      });
      continue;
    }

    const result = runStage(stage);
    stageResults.push(result);
    if (result.status === "failed") {
      failureStage = result;
    }
  }

  const detectedArtifacts = detectArtifacts(resolvedArtifactsDir);
  const relativeArtifacts: DetectedArtifacts = Object.fromEntries(
    Object.entries(detectedArtifacts).map(([key, value]) => [key, value ? toRelative(value) : value])
  ) as DetectedArtifacts;

  const report: RehearsalSummary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision,
    buildDir: toRelative(resolvedBuildDir),
    artifactsDir: toRelative(resolvedArtifactsDir),
    summary: {
      status: failureStage ? "failed" : "passed",
      ...(failureStage
        ? {
            failureStageId: failureStage.id,
            failureStageTitle: failureStage.title,
            failureSummary: failureStage.summary
          }
        : {}),
      artifacts: relativeArtifacts
    },
    stages: stageResults,
    outputs: {
      json: toRelative(summaryPath),
      markdown: toRelative(markdownPath)
    }
  };

  writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFile(markdownPath, renderMarkdown(report));

  const statusLabel = failureStage ? `FAILED (${failureStage.title})` : "PASSED";
  console.log(`WeChat release rehearsal ${statusLabel}`);
  console.log(`Structured summary: ${toRelative(summaryPath)}`);
  console.log(`Markdown summary: ${toRelative(markdownPath)}`);

  if (failureStage) {
    console.error(`${failureStage.title} failed: ${failureStage.summary}`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
