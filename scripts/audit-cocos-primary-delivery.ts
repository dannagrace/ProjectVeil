import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type CheckStatus = "passed" | "failed";
type AuditStatus = "passed" | "failed";

interface Args {
  configPath: string;
  artifactsDir: string;
  expectExportedRuntime: boolean;
  outputDir?: string;
  expectedRevision?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  githubStepSummaryPath?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface AuditCheck {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  artifactPath?: string;
  command: string;
  exitCode: number | null;
  stdoutTail?: string;
  stderrTail?: string;
}

interface DeliveryAuditReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  target: {
    client: "apps/cocos-client";
    deliveryTarget: "wechatgame";
    checklistPath: string;
    outputDir: string;
    artifactsDir: string;
  };
  summary: {
    status: AuditStatus;
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    headline: string;
  };
  checks: AuditCheck[];
}

const OUTPUT_TAIL_BYTES = 4000;
const DEFAULT_CONFIG_PATH = "apps/cocos-client/wechat-minigame.build.json";
const DEFAULT_ARTIFACTS_DIR = "artifacts/wechat-release";
const CHECKLIST_PATH = "docs/cocos-primary-client-delivery.md";

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let configPath = DEFAULT_CONFIG_PATH;
  let artifactsDir = DEFAULT_ARTIFACTS_DIR;
  let expectExportedRuntime = false;
  let outputDir: string | undefined;
  let expectedRevision: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let githubStepSummaryPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--config" && next) {
      configPath = next;
      index += 1;
      continue;
    }
    if (arg === "--artifacts-dir" && next) {
      artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--expected-revision" && next) {
      expectedRevision = next.trim() || undefined;
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
    if (arg === "--github-step-summary" && next) {
      githubStepSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--expect-exported-runtime") {
      expectExportedRuntime = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    configPath,
    artifactsDir,
    expectExportedRuntime,
    ...(outputDir ? { outputDir } : {}),
    ...(expectedRevision ? { expectedRevision } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    ...(githubStepSummaryPath ? { githubStepSummaryPath } : {})
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

function getRevision(): GitRevision {
  return {
    commit: readGitValue(["rev-parse", "HEAD"]),
    shortCommit: readGitValue(["rev-parse", "--short", "HEAD"]),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--porcelain"]).length > 0
  };
}

function defaultOutputPath(shortCommit: string): string {
  return path.resolve("artifacts", "release-readiness", `cocos-primary-delivery-audit-${shortCommit}.json`);
}

function defaultMarkdownOutputPath(outputPath: string): string {
  return outputPath.replace(/\.json$/i, ".md");
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function tailText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > OUTPUT_TAIL_BYTES ? trimmed.slice(-OUTPUT_TAIL_BYTES) : trimmed;
}

function runAuditCheck(id: string, title: string, artifactPath: string | undefined, args: string[]): AuditCheck {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });

  const stdoutTail = tailText(result.stdout);
  const stderrTail = tailText(result.stderr);
  const command = [process.execPath, ...args].join(" ");

  if (result.error) {
    return {
      id,
      title,
      status: "failed",
      summary: result.error.message,
      ...(artifactPath ? { artifactPath } : {}),
      command,
      exitCode: result.status,
      ...(stdoutTail ? { stdoutTail } : {}),
      ...(stderrTail ? { stderrTail } : {})
    };
  }

  if (result.status !== 0) {
    return {
      id,
      title,
      status: "failed",
      summary: stderrTail ?? stdoutTail ?? `${title} failed.`,
      ...(artifactPath ? { artifactPath } : {}),
      command,
      exitCode: result.status,
      ...(stdoutTail ? { stdoutTail } : {}),
      ...(stderrTail ? { stderrTail } : {})
    };
  }

  return {
    id,
    title,
    status: "passed",
    summary: stdoutTail ?? `${title} passed.`,
    ...(artifactPath ? { artifactPath } : {}),
    command,
    exitCode: result.status,
    ...(stdoutTail ? { stdoutTail } : {})
  };
}

function buildReport(args: Args, revision: GitRevision): DeliveryAuditReport {
  const resolvedConfigPath = path.resolve(args.configPath);
  const resolvedArtifactsDir = path.resolve(args.artifactsDir);
  const resolvedOutputDir = path.resolve(args.outputDir ?? "apps/cocos-client/build/wechatgame");

  const validateBuildArgs = [
    "--import",
    "tsx",
    "./scripts/validate-wechat-minigame-build.ts",
    "--config",
    resolvedConfigPath,
    "--output-dir",
    resolvedOutputDir
  ];
  if (args.expectExportedRuntime) {
    validateBuildArgs.push("--expect-exported-runtime");
  }

  const validateArtifactArgs = [
    "--import",
    "tsx",
    "./scripts/validate-wechat-release-candidate.ts",
    "--artifacts-dir",
    resolvedArtifactsDir
  ];
  if (args.expectedRevision) {
    validateArtifactArgs.push("--expected-revision", args.expectedRevision);
  }

  const checks: AuditCheck[] = [
    runAuditCheck(
      "exported-build-validation",
      "Exported WeChat build validation",
      resolvedOutputDir,
      validateBuildArgs
    ),
    runAuditCheck(
      "packaged-artifact-audit",
      "Packaged WeChat release artifact audit",
      resolvedArtifactsDir,
      validateArtifactArgs
    )
  ];

  const failedChecks = checks.filter((check) => check.status === "failed");
  const passedChecks = checks.length - failedChecks.length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision,
    target: {
      client: "apps/cocos-client",
      deliveryTarget: "wechatgame",
      checklistPath: CHECKLIST_PATH,
      outputDir: resolvedOutputDir,
      artifactsDir: resolvedArtifactsDir
    },
    summary: {
      status: failedChecks.length === 0 ? "passed" : "failed",
      totalChecks: checks.length,
      passedChecks,
      failedChecks: failedChecks.length,
      headline:
        failedChecks.length === 0
          ? `Primary Cocos client delivery audits passed (${passedChecks}/${checks.length}).`
          : `Primary Cocos client delivery audit failed: ${failedChecks[0]?.title}.`
    },
    checks
  };
}

function renderMarkdown(report: DeliveryAuditReport): string {
  const lines = [
    "# Primary Cocos Client Delivery Audit",
    "",
    `- Generated at: \`${report.generatedAt}\``,
    `- Revision: \`${report.revision.shortCommit}\` on \`${report.revision.branch}\`${report.revision.dirty ? " (dirty)" : ""}`,
    `- Overall status: **${report.summary.status.toUpperCase()}**`,
    `- Target: \`${report.target.client}\` -> \`${report.target.deliveryTarget}\``,
    `- Checklist: \`${report.target.checklistPath}\``,
    "",
    "## Automated Audits",
    ""
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.status === "passed" ? "PASSED" : "FAILED"} ${check.title}: ${check.summary}`);
  }

  lines.push("", "## Manual Checklist", "", `- Follow \`${report.target.checklistPath}\` before release sign-off.`, "");
  return lines.join("\n");
}

function appendFile(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.appendFileSync(targetPath, `${content.endsWith("\n") ? content : `${content}\n`}`, "utf8");
}

function main(): void {
  const args = parseArgs(process.argv);
  const revision = getRevision();
  const report = buildReport(args, revision);
  const outputPath = path.resolve(args.outputPath ?? defaultOutputPath(revision.shortCommit));
  const markdownOutputPath = path.resolve(args.markdownOutputPath ?? defaultMarkdownOutputPath(outputPath));
  const markdown = renderMarkdown(report);

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, `${markdown}\n`);

  if (args.githubStepSummaryPath) {
    appendFile(args.githubStepSummaryPath, markdown);
  }

  console.log(`Primary Cocos delivery audit: ${report.summary.headline}`);
  for (const check of report.checks) {
    console.log(`- ${check.status}: ${check.title}`);
  }
  console.log(`Overall status: ${report.summary.status}`);
  console.log(`JSON: ${path.relative(process.cwd(), outputPath)}`);
  console.log(`Markdown: ${path.relative(process.cwd(), markdownOutputPath)}`);

  if (report.summary.status === "failed") {
    process.exitCode = 1;
  }
}

main();
