import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type StageStatus = "passed" | "failed" | "skipped";

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
  candidateSummaryJsonPath?: string;
  candidateSummaryMarkdownPath?: string;
}

const OUTPUT_LIMIT = 4000;

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
    requireSmokeReport
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
  const candidateSummaryJson = entries.find((entry) => entry === "codex.wechat.release-candidate-summary.json");
  const candidateSummaryMarkdown = entries.find((entry) => entry === "codex.wechat.release-candidate-summary.md");
  return {
    ...(archive ? { archivePath: path.join(artifactsDir, archive) } : {}),
    ...(metadata ? { metadataPath: path.join(artifactsDir, metadata) } : {}),
    ...(report ? { validationReportPath: path.join(artifactsDir, report) } : {}),
    ...(smoke ? { smokeReportPath: path.join(artifactsDir, smoke) } : {}),
    ...(receipt ? { uploadReceiptPath: path.join(artifactsDir, receipt) } : {}),
    ...(candidateSummaryJson ? { candidateSummaryJsonPath: path.join(artifactsDir, candidateSummaryJson) } : {}),
    ...(candidateSummaryMarkdown
      ? { candidateSummaryMarkdownPath: path.join(artifactsDir, candidateSummaryMarkdown) }
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
  if (artifacts.candidateSummaryJsonPath) {
    artifactLines.push(`- Candidate Summary (JSON): \`${artifacts.candidateSummaryJsonPath}\``);
  }
  if (artifacts.candidateSummaryMarkdownPath) {
    artifactLines.push(`- Candidate Summary (Markdown): \`${artifacts.candidateSummaryMarkdownPath}\``);
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
  const summaryBaseName = revision.shortCommit ? `wechat-release-rehearsal-${revision.shortCommit}` : `wechat-release-rehearsal`;
  const summaryPath = path.resolve(repoRoot, args.summaryPath ?? path.join(args.artifactsDir, `${summaryBaseName}.json`));
  const markdownPath = path.resolve(repoRoot, args.markdownPath ?? path.join(args.artifactsDir, `${summaryBaseName}.md`));

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
    },
    {
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
        ...(args.requireSmokeReport ? ["--require-smoke-report"] : [])
      ]
    }
  ];

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

main();
