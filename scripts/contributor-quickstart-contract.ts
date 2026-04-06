import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type ContractStageStatus = "passed" | "failed";
export type ContractReportStatus = "passed" | "failed";

export interface QuickstartContractDefinition {
  doctorScript: string;
  validateQuickstartScript: string;
  h5BuildScript: string;
  h5DevScript: string;
  serverUrl: string;
  healthChecks: string[];
}

export interface ContractStage {
  id: string;
  label: string;
  category: "alignment" | "runtime";
  status: ContractStageStatus;
  summary: string;
  remediation: string;
  details: string[];
  command?: string;
  exitCode?: number | null;
  durationMs?: number;
  stdoutTail?: string;
  stderrTail?: string;
}

export interface ContributorQuickstartContractReport {
  schemaVersion: 1;
  generatedAt: string;
  summary: {
    status: ContractReportStatus;
    totalStages: number;
    failedStages: number;
    headline: string;
  };
  contract: QuickstartContractDefinition;
  inputs: {
    readmePath: string;
    packageJsonPath: string;
    quickstartValidatorPath: string;
    runtimeSkipped: boolean;
  };
  artifacts: {
    jsonPath: string;
    markdownPath: string;
  };
  stages: ContractStage[];
}

interface PackageJsonScripts {
  scripts?: Record<string, string>;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface RunOptions {
  cwd: string;
}

interface Args {
  readmePath: string;
  packageJsonPath: string;
  quickstartValidatorPath: string;
  outputPath?: string;
  markdownOutputPath?: string;
  skipRuntime: boolean;
}

interface RunContributorQuickstartContractOptions {
  repoRoot: string;
  readmePath: string;
  packageJsonPath: string;
  quickstartValidatorPath: string;
  outputPath: string;
  markdownOutputPath: string;
  skipRuntime: boolean;
}

interface ContractDeps {
  readFileSync?: (filePath: string, encoding: BufferEncoding) => string;
  writeFileSync?: (filePath: string, content: string, encoding: BufferEncoding) => void;
  mkdirSync?: typeof fs.mkdirSync;
  now?: () => Date;
  loadContract?: (filePath: string) => Promise<QuickstartContractDefinition>;
  runScript?: (scriptName: string, options: RunOptions) => RunResult;
}

const OUTPUT_TAIL_CHARS = 6_000;
const DEFAULT_README_PATH = path.resolve("README.md");
const DEFAULT_PACKAGE_JSON_PATH = path.resolve("package.json");
const DEFAULT_QUICKSTART_VALIDATOR_PATH = path.resolve("scripts", "validate-local-dev-quickstart.mjs");

function parseArgs(argv: string[]): Args {
  let readmePath = DEFAULT_README_PATH;
  let packageJsonPath = DEFAULT_PACKAGE_JSON_PATH;
  let quickstartValidatorPath = DEFAULT_QUICKSTART_VALIDATOR_PATH;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let skipRuntime = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--readme" && next) {
      readmePath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--package-json" && next) {
      packageJsonPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--quickstart-validator" && next) {
      quickstartValidatorPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--skip-runtime") {
      skipRuntime = true;
      continue;
    }
    if (arg === "--help") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    readmePath,
    packageJsonPath,
    quickstartValidatorPath,
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    skipRuntime
  };
}

function printUsage(): void {
  console.log(
    "Usage: npm run validate:quickstart:contract -- [--output <path>] [--markdown-output <path>] [--skip-runtime]"
  );
}

function readGitShortCommit(): string {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return "working-tree";
}

function defaultOutputPath(): string {
  return path.resolve(
    "artifacts",
    "release-readiness",
    `contributor-quickstart-contract-${readGitShortCommit()}.json`
  );
}

function defaultMarkdownOutputPath(outputPath: string): string {
  return outputPath.replace(/\.json$/i, ".md");
}

function trimTail(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > OUTPUT_TAIL_CHARS ? trimmed.slice(-OUTPUT_TAIL_CHARS) : trimmed;
}

function normalizeLines(block: string): string[] {
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function extractFiveMinuteSetupCommands(readmeText: string): string[] {
  const match = readmeText.match(/### 5-Minute Setup\s+```bash\s*([\s\S]*?)```/);
  return match ? normalizeLines(match[1]) : [];
}

function endpointDocChecks(contract: QuickstartContractDefinition): Array<{ label: string; matcher: string | RegExp }> {
  return [
    { label: "H5 debug shell command", matcher: `npm run ${contract.h5DevScript}` },
    { label: "H5 debug shell URL", matcher: "http://127.0.0.1:5173/" },
    { label: "runtime health URL", matcher: `${contract.serverUrl}/api/runtime/health` },
    { label: "auth-readiness endpoint mention", matcher: /auth-readiness/ },
    { label: "lobby endpoint mention", matcher: /lobby/ }
  ];
}

function buildAlignmentStages(
  readmeText: string,
  packageJson: PackageJsonScripts,
  contract: QuickstartContractDefinition
): ContractStage[] {
  const scripts = packageJson.scripts ?? {};
  const setupCommands = extractFiveMinuteSetupCommands(readmeText);
  const expectedSetup = ["nvm use", "npm ci --no-audit --no-fund", `npm run ${contract.doctorScript}`, `npm run ${contract.validateQuickstartScript}`];
  const missingSetupCommands = expectedSetup.filter((command) => !setupCommands.includes(command));

  const scriptRequirements: Array<[string, string]> = [
    [contract.doctorScript, "doctor entry point"],
    [contract.validateQuickstartScript, "quickstart validator entry point"],
    [contract.h5BuildScript, "H5 build entry point"],
    [contract.h5DevScript, "H5 debug shell entry point"]
  ];
  const missingScripts = scriptRequirements.filter(([scriptName]) => !scripts[scriptName]);

  const missingReadmeRuntimeMentions = endpointDocChecks(contract)
    .filter(({ matcher }) => {
      if (typeof matcher === "string") {
        return !readmeText.includes(matcher);
      }
      return !matcher.test(readmeText);
    })
    .map(({ label }) => label);

  return [
    {
      id: "readme-5-minute-setup",
      label: "README 5-minute setup stays on the documented path",
      category: "alignment",
      status: missingSetupCommands.length === 0 ? "passed" : "failed",
      summary:
        missingSetupCommands.length === 0
          ? "README still routes contributors through `npm run doctor` and `npm run validate:quickstart`."
          : "README quickstart setup block drifted from the maintained contributor path.",
      remediation:
        "Update the `README.md` 5-Minute Setup block so it includes the maintained `nvm use`, `npm ci`, `npm run doctor`, and `npm run validate:quickstart` sequence.",
      details:
        missingSetupCommands.length === 0
          ? [`Setup block: ${setupCommands.join(" -> ")}`]
          : missingSetupCommands.map((command) => `Missing setup command: \`${command}\``)
    },
    {
      id: "package-script-entrypoints",
      label: "Package entry points keep the quickstart contract reachable",
      category: "alignment",
      status: missingScripts.length === 0 ? "passed" : "failed",
      summary:
        missingScripts.length === 0
          ? "Package scripts still expose the documented contributor entry points."
          : "One or more quickstart package entry points are missing.",
      remediation:
        "Restore the missing `package.json` scripts so README commands, H5 build, and H5 shell boot continue to resolve from the documented quickstart path.",
      details:
        missingScripts.length === 0
          ? scriptRequirements.map(([scriptName]) => `Found script: \`${scriptName}\``)
          : missingScripts.map(([scriptName, label]) => `Missing ${label}: \`${scriptName}\``)
    },
    {
      id: "readme-runtime-promises",
      label: "README runtime promises match the maintained quickstart contract",
      category: "alignment",
      status: missingReadmeRuntimeMentions.length === 0 ? "passed" : "failed",
      summary:
        missingReadmeRuntimeMentions.length === 0
          ? "README still documents H5 shell boot and the runtime endpoints that `validate:quickstart` verifies."
          : "README no longer documents one or more maintained quickstart runtime promises.",
      remediation:
        "Update `README.md` so the quickstart section continues to describe the H5 shell boot path and the runtime health/auth-readiness/lobby checks exercised by `validate:quickstart`.",
      details:
        missingReadmeRuntimeMentions.length === 0
          ? [
              `H5 shell: \`npm run ${contract.h5DevScript}\``,
              `Runtime base URL: \`${contract.serverUrl}\``,
              `Health checks: ${contract.healthChecks.map((entry) => `\`${entry}\``).join(", ")}`
            ]
          : missingReadmeRuntimeMentions.map((label) => `Missing README contract mention: ${label}`)
    }
  ];
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function defaultRunScript(scriptName: string, options: RunOptions): RunResult {
  const result = spawnSync(npmCommand(), ["run", scriptName], {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {})
  };
}

async function defaultLoadContract(filePath: string): Promise<QuickstartContractDefinition> {
  const module = (await import(pathToFileURL(filePath).href)) as {
    QUICKSTART_DOCTOR_SCRIPT?: string;
    QUICKSTART_VALIDATE_SCRIPT?: string;
    QUICKSTART_H5_BUILD_SCRIPT?: string;
    QUICKSTART_H5_DEV_SCRIPT?: string;
    QUICKSTART_SERVER_URL?: string;
    QUICKSTART_HEALTH_CHECKS?: string[];
  };

  const contract = {
    doctorScript: module.QUICKSTART_DOCTOR_SCRIPT,
    validateQuickstartScript: module.QUICKSTART_VALIDATE_SCRIPT,
    h5BuildScript: module.QUICKSTART_H5_BUILD_SCRIPT,
    h5DevScript: module.QUICKSTART_H5_DEV_SCRIPT,
    serverUrl: module.QUICKSTART_SERVER_URL,
    healthChecks: module.QUICKSTART_HEALTH_CHECKS
  };

  if (
    !contract.doctorScript ||
    !contract.validateQuickstartScript ||
    !contract.h5BuildScript ||
    !contract.h5DevScript ||
    !contract.serverUrl ||
    !Array.isArray(contract.healthChecks)
  ) {
    throw new Error(`Quickstart validator contract exports are incomplete in ${filePath}`);
  }

  return contract as QuickstartContractDefinition;
}

function createRuntimeStage(
  label: string,
  scriptName: string,
  repoRoot: string,
  remediation: string,
  runScript: (scriptName: string, options: RunOptions) => RunResult
): ContractStage {
  const startedAt = Date.now();
  const result = runScript(scriptName, { cwd: repoRoot });
  const durationMs = Date.now() - startedAt;
  const stdoutTail = trimTail(result.stdout);
  const stderrTail = trimTail(result.stderr);
  const command = `npm run ${scriptName}`;

  if (result.error) {
    return {
      id: `runtime-${scriptName.replace(/:/g, "-")}`,
      label,
      category: "runtime",
      status: "failed",
      summary: result.error.message,
      remediation,
      details: [`Command: \`${command}\``],
      command,
      exitCode: result.status,
      durationMs,
      ...(stdoutTail ? { stdoutTail } : {}),
      ...(stderrTail ? { stderrTail } : {})
    };
  }

  if (result.status !== 0) {
    return {
      id: `runtime-${scriptName.replace(/:/g, "-")}`,
      label,
      category: "runtime",
      status: "failed",
      summary: stderrTail ?? stdoutTail ?? `\`${command}\` failed.`,
      remediation,
      details: [`Command: \`${command}\``],
      command,
      exitCode: result.status,
      durationMs,
      ...(stdoutTail ? { stdoutTail } : {}),
      ...(stderrTail ? { stderrTail } : {})
    };
  }

  return {
    id: `runtime-${scriptName.replace(/:/g, "-")}`,
    label,
    category: "runtime",
    status: "passed",
    summary: `\`${command}\` completed successfully.`,
    remediation,
    details: [`Command: \`${command}\``],
    command,
    exitCode: result.status,
    durationMs,
    ...(stdoutTail ? { stdoutTail } : {}),
    ...(stderrTail ? { stderrTail } : {})
  };
}

export async function runContributorQuickstartContract(
  options: RunContributorQuickstartContractOptions,
  deps: ContractDeps = {}
): Promise<ContributorQuickstartContractReport> {
  const readFileSync = deps.readFileSync ?? fs.readFileSync.bind(fs);
  const writeFileSync = deps.writeFileSync ?? fs.writeFileSync.bind(fs);
  const mkdirSync = deps.mkdirSync ?? fs.mkdirSync.bind(fs);
  const now = deps.now ?? (() => new Date());
  const loadContract = deps.loadContract ?? defaultLoadContract;
  const runScript = deps.runScript ?? defaultRunScript;

  const readmeText = readFileSync(options.readmePath, "utf8");
  const packageJson = JSON.parse(readFileSync(options.packageJsonPath, "utf8")) as PackageJsonScripts;
  const contract = await loadContract(options.quickstartValidatorPath);

  const stages = buildAlignmentStages(readmeText, packageJson, contract);
  if (!options.skipRuntime) {
    stages.push(
      createRuntimeStage(
        "Doctor command still validates the documented prerequisites path",
        contract.doctorScript,
        options.repoRoot,
        "Inspect the doctor output, restore any missing prerequisites or script wiring, and keep the README prerequisites section aligned with the fixed command behavior.",
        runScript
      ),
      createRuntimeStage(
        "Quickstart validator still exercises the advertised H5 build and server boot flow",
        contract.validateQuickstartScript,
        options.repoRoot,
        "Inspect the validator output, restore the H5 build or runtime boot path, and keep the README quickstart claims aligned with the repaired behavior.",
        runScript
      )
    );
  }

  const failedStages = stages.filter((stage) => stage.status === "failed");
  const report: ContributorQuickstartContractReport = {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    summary: {
      status: failedStages.length === 0 ? "passed" : "failed",
      totalStages: stages.length,
      failedStages: failedStages.length,
      headline:
        failedStages.length === 0
          ? "Contributor quickstart contract passed."
          : `Contributor quickstart contract failed ${failedStages.length} of ${stages.length} stage(s).`
    },
    contract,
    inputs: {
      readmePath: options.readmePath,
      packageJsonPath: options.packageJsonPath,
      quickstartValidatorPath: options.quickstartValidatorPath,
      runtimeSkipped: options.skipRuntime
    },
    artifacts: {
      jsonPath: options.outputPath,
      markdownPath: options.markdownOutputPath
    },
    stages
  };

  mkdirSync(path.dirname(options.outputPath), { recursive: true });
  mkdirSync(path.dirname(options.markdownOutputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownOutputPath, `${renderContributorQuickstartContractMarkdown(report)}\n`, "utf8");
  return report;
}

export function renderContributorQuickstartContractMarkdown(
  report: ContributorQuickstartContractReport
): string {
  const lines = [
    "## Contributor Quickstart Contract Audit",
    "",
    `- Status: \`${report.summary.status.toUpperCase()}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Runtime stages: ${report.inputs.runtimeSkipped ? "skipped" : "executed"}`,
    `- Artifacts: \`${report.artifacts.jsonPath}\`, \`${report.artifacts.markdownPath}\``,
    "",
    "### Maintained contract",
    `- Doctor: \`npm run ${report.contract.doctorScript}\``,
    `- Quickstart validator: \`npm run ${report.contract.validateQuickstartScript}\``,
    `- H5 build: \`npm run ${report.contract.h5BuildScript}\``,
    `- H5 shell: \`npm run ${report.contract.h5DevScript}\``,
    `- Runtime base URL: \`${report.contract.serverUrl}\``,
    `- Health checks: ${report.contract.healthChecks.map((entry) => `\`${entry}\``).join(", ")}`,
    "",
    "### Stages"
  ];

  for (const stage of report.stages) {
    lines.push(`- **${stage.label}**: \`${stage.status.toUpperCase()}\` ${stage.summary}`);
    lines.push(`  Remediation: ${stage.remediation}`);
    for (const detail of stage.details) {
      lines.push(`  Detail: ${detail}`);
    }
    if (stage.command) {
      lines.push(`  Command: \`${stage.command}\``);
    }
    if (typeof stage.exitCode === "number") {
      lines.push(`  Exit code: ${stage.exitCode}`);
    }
    if (typeof stage.durationMs === "number") {
      lines.push(`  Duration: ${stage.durationMs}ms`);
    }
    if (stage.stdoutTail) {
      lines.push("  Stdout tail:");
      lines.push("");
      lines.push("  ```text");
      lines.push(...stage.stdoutTail.split("\n").map((line) => `  ${line}`));
      lines.push("  ```");
    }
    if (stage.stderrTail) {
      lines.push("  Stderr tail:");
      lines.push("");
      lines.push("  ```text");
      lines.push(...stage.stderrTail.split("\n").map((line) => `  ${line}`));
      lines.push("  ```");
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const outputPath = args.outputPath ?? defaultOutputPath();
  const markdownOutputPath = args.markdownOutputPath ?? defaultMarkdownOutputPath(outputPath);
  const report = await runContributorQuickstartContract({
    repoRoot: process.cwd(),
    readmePath: args.readmePath,
    packageJsonPath: args.packageJsonPath,
    quickstartValidatorPath: args.quickstartValidatorPath,
    outputPath,
    markdownOutputPath,
    skipRuntime: args.skipRuntime
  });

  console.log(report.summary.headline);
  console.log(`Wrote quickstart contract JSON: ${report.artifacts.jsonPath}`);
  console.log(`Wrote quickstart contract Markdown: ${report.artifacts.markdownPath}`);

  if (report.summary.status !== "passed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[validate:quickstart:contract] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
