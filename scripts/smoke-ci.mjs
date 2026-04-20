import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertSupportedRuntime } from "./runtime-preflight.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultStages = [
  {
    id: "doctor",
    script: "doctor",
    label: "Repository doctor",
    remediation: "Inspect the doctor output and restore the documented Node/npm or optional prerequisite setup before retrying."
  },
  {
    id: "validate-quickstart",
    script: "validate:quickstart",
    label: "Contributor quickstart validation",
    remediation: "Inspect the quickstart validator output and repair the H5 build or local server boot path before retrying."
  },
  {
    id: "smoke-client-boot-room",
    script: "smoke:client:boot-room",
    label: "Client boot-room smoke",
    remediation: "Inspect the captured server/client logs and repair the lobby boot or room-join path before retrying."
  }
];

function nowIso() {
  return new Date().toISOString();
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function readGitShortCommit() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return "unknown";
  }
  return result.stdout.trim() || "unknown";
}

function toPosixPath(targetPath) {
  return targetPath.replace(/\\/g, "/");
}

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function relativeToRepo(targetPath) {
  return toPosixPath(path.relative(repoRoot, targetPath));
}

export function parseSmokeCiArgs(argv) {
  const options = {
    output: undefined,
    markdownOutput: undefined,
    logDir: undefined,
    githubStepSummary: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--output" && next) {
      options.output = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      options.markdownOutput = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--log-dir" && next) {
      options.logDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--github-step-summary" && next) {
      options.githubStepSummary = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function renderSmokeCiHelp() {
  return [
    "Usage: npm run smoke -- ci -- [--output <path>] [--markdown-output <path>] [--log-dir <dir>] [--github-step-summary <path>]",
    "",
    "Runs the repository smoke gate stages in order:",
    "  - npm run doctor",
    "  - npm run validate -- quickstart",
    "  - npm run smoke -- client:boot-room"
  ].join("\n");
}

export function renderSmokeCiMarkdown(report) {
  const lines = [
    "## Repository Smoke CI",
    "",
    `- Revision: \`${report.revision}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Overall result: \`${report.summary.status.toUpperCase()}\``,
    `- Passed stages: \`${report.summary.passedStages}\` / \`${report.summary.totalStages}\``,
    `- Logs: \`${report.logsDirRelative}\``,
    ""
  ];

  for (const stage of report.stages) {
    lines.push(`### ${stage.label}`);
    lines.push("");
    lines.push(`- Command: \`${stage.command}\``);
    lines.push(`- Result: \`${stage.status.toUpperCase()}\``);
    lines.push(`- Duration: \`${formatDurationMs(stage.durationMs)}\``);
    lines.push(`- Log: \`${stage.logPathRelative}\``);
    if (stage.failureMessage) {
      lines.push(`- Failure: ${stage.failureMessage}`);
    }
    if (stage.remediation) {
      lines.push(`- Remediation: ${stage.remediation}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

async function runStageCommand(stage, logPath, spawnImpl = spawn) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const logHandle = await fs.open(logPath, "w");
  const logStream = logHandle.createWriteStream();

  const startedAt = Date.now();
  let failureMessage = null;

  try {
    await new Promise((resolve, reject) => {
      const child = spawnImpl(npmCommand(), ["run", stage.script], {
        cwd: repoRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      child.stdout?.on("data", (chunk) => {
        process.stdout.write(chunk);
        logStream.write(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        process.stderr.write(chunk);
        logStream.write(chunk);
      });

      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        const message = signal
          ? `${stage.script} terminated with signal ${signal}`
          : `${stage.script} exited with code ${code ?? 1}`;
        reject(new Error(message));
      });
    });
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await new Promise((resolve) => logStream.end(resolve));
    await logHandle.close();
  }

  return {
    status: failureMessage ? "failed" : "passed",
    durationMs: Date.now() - startedAt,
    failureMessage
  };
}

export async function executeSmokeCi(options = {}, deps = {}) {
  const revision = (deps.getShortCommitImpl ?? readGitShortCommit)();
  const output = options.output ?? path.resolve(repoRoot, "artifacts", "release-readiness", `smoke-ci-${revision}.json`);
  const markdownOutput =
    options.markdownOutput ?? path.resolve(repoRoot, "artifacts", "release-readiness", `smoke-ci-${revision}.md`);
  const logDir = options.logDir ?? path.resolve(repoRoot, "artifacts", "release-readiness", `smoke-ci-logs-${revision}`);
  const runStageCommandImpl = deps.runStageCommandImpl ?? runStageCommand;
  const generatedAt = (deps.nowIsoImpl ?? nowIso)();

  await fs.mkdir(logDir, { recursive: true });

  const stages = [];
  let encounteredFailure = false;

  for (const [index, stage] of defaultStages.entries()) {
    const logPath = path.resolve(logDir, `${String(index + 1).padStart(2, "0")}-${stage.id}.log`);
    const command = `npm run ${stage.script}`;
    if (encounteredFailure) {
      stages.push({
        id: stage.id,
        label: stage.label,
        command,
        status: "skipped",
        durationMs: 0,
        remediation: "Skipped because an earlier smoke stage failed.",
        failureMessage: null,
        logPath,
        logPathRelative: relativeToRepo(logPath)
      });
      continue;
    }

    const result = await runStageCommandImpl(stage, logPath);
    if (result.status === "failed") {
      encounteredFailure = true;
    }
    stages.push({
      id: stage.id,
      label: stage.label,
      command,
      status: result.status,
      durationMs: result.durationMs,
      remediation: result.status === "failed" ? stage.remediation : null,
      failureMessage: result.failureMessage,
      logPath,
      logPathRelative: relativeToRepo(logPath)
    });
  }

  const passedStages = stages.filter((stage) => stage.status === "passed").length;
  const failedStages = stages.filter((stage) => stage.status === "failed").length;
  const skippedStages = stages.filter((stage) => stage.status === "skipped").length;

  const report = {
    revision,
    generatedAt,
    outputPath: output,
    markdownOutputPath: markdownOutput,
    logsDir: logDir,
    logsDirRelative: relativeToRepo(logDir),
    summary: {
      status: failedStages > 0 ? "failed" : "passed",
      totalStages: stages.length,
      passedStages,
      failedStages,
      skippedStages
    },
    stages
  };

  const markdown = renderSmokeCiMarkdown(report);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(path.dirname(markdownOutput), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  await fs.writeFile(markdownOutput, markdown);

  if (options.githubStepSummary) {
    await fs.mkdir(path.dirname(options.githubStepSummary), { recursive: true });
    await fs.appendFile(options.githubStepSummary, `${markdown}\n`);
  }

  return report;
}

export async function runSmokeCiCli(argv, deps = {}) {
  (deps.assertSupportedRuntimeImpl ?? assertSupportedRuntime)({
    commandName: "npm run smoke -- ci",
    repoRoot
  });

  const options = parseSmokeCiArgs(argv);
  if (options.help) {
    console.log(renderSmokeCiHelp());
    return null;
  }

  const report = await executeSmokeCi(options, deps);
  console.log(`Wrote smoke CI JSON summary: ${relativeToRepo(report.outputPath)}`);
  console.log(`Wrote smoke CI Markdown summary: ${relativeToRepo(report.markdownOutputPath)}`);

  process.exitCode = report.summary.status === "passed" ? 0 : 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSmokeCiCli(process.argv.slice(2)).catch((error) => {
    console.error(`[smoke:ci] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
