import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ProductionRollbackDrillMode = "simulate" | "execute";
type ProductionRollbackDrillStatus = "passed" | "failed" | "pending";
type DrillSmokeStatus = "passed" | "failed";
type DrillRollbackStatus = "succeeded" | "failed" | "skipped";

interface Args {
  candidate: string;
  mode: ProductionRollbackDrillMode;
  namespace: string;
  stableDeployment: string;
  canaryDeployment: string;
  stableService: string;
  canaryService: string;
  canaryIngress: string;
  canaryManifestDir: string;
  canaryWeight: number;
  imageTag?: string;
  smokeCommand: string;
  simulateSmokeStatus: DrillSmokeStatus;
  simulateRollbackStatus: Exclude<DrillRollbackStatus, "skipped">;
  outputPath?: string;
  markdownOutputPath?: string;
}

interface CommandExecutionResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface ProductionRollbackDrillCommandLog {
  label: string;
  command: string[];
  executed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface ProductionRollbackDrillDependencies {
  runCommand?: (command: string, args: string[]) => CommandExecutionResult;
  now?: () => Date;
}

interface OutputPaths {
  json: string;
  markdown: string;
}

export interface ProductionRollbackDrillReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    revision: string;
    shortRevision: string;
    imageTag?: string;
    targetSurface: "wechat";
    stage: "production";
  };
  mode: ProductionRollbackDrillMode;
  status: ProductionRollbackDrillStatus;
  summary: {
    headline: string;
    autoRollbackCovered: boolean;
    executedAgainstCluster: boolean;
    smokeFailed: boolean;
    rollbackRecovered: boolean;
    requiredFreshnessDays: number;
  };
  rollout: {
    namespace: string;
    stableDeployment: string;
    canaryDeployment: string;
    stableService: string;
    canaryService: string;
    canaryIngress: string;
    canaryManifestDir: string;
    canaryWeight: number;
  };
  smoke: {
    command: string[];
    status: DrillSmokeStatus | "skipped";
    exitCode: number | null;
    summary: string;
  };
  rollback: {
    attempted: boolean;
    status: DrillRollbackStatus;
    summary: string;
    commands: string[][];
  };
  commands: ProductionRollbackDrillCommandLog[];
  evidence: {
    runbookPath: string;
    k8sCanaryDir: string;
  };
}

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_CANARY_MANIFEST_DIR = path.resolve("k8s", "canary");
const DEFAULT_RUNBOOK_PATH = path.resolve("docs", "production-rollback-drill.md");
const DEFAULT_SMOKE_COMMAND = "curl -fsS http://127.0.0.1:2567/api/runtime/health";
const REQUIRED_FRESHNESS_DAYS = 30;

function fail(message: string): never {
  throw new Error(message);
}

function toArtifactToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown";
  }
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "unknown";
}

function shortenRevision(revision: string): string {
  return revision.trim().slice(0, 12) || "unknown";
}

function parseArgs(argv: string[]): Args {
  let candidate: string | undefined;
  let mode: ProductionRollbackDrillMode = "simulate";
  let namespace = "project-veil";
  let stableDeployment = "project-veil-server";
  let canaryDeployment = "project-veil-server-canary";
  let stableService = "project-veil-server";
  let canaryService = "project-veil-server-canary";
  let canaryIngress = "project-veil-server-canary";
  let canaryManifestDir = DEFAULT_CANARY_MANIFEST_DIR;
  let canaryWeight = 10;
  let imageTag: string | undefined;
  let smokeCommand = DEFAULT_SMOKE_COMMAND;
  let simulateSmokeStatus: DrillSmokeStatus = "failed";
  let simulateRollbackStatus: Exclude<DrillRollbackStatus, "skipped"> = "succeeded";
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
    if (arg === "--mode" && next) {
      if (next !== "simulate" && next !== "execute") {
        fail(`Unsupported --mode value: ${next}`);
      }
      mode = next;
      index += 1;
      continue;
    }
    if (arg === "--namespace" && next) {
      namespace = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--stable-deployment" && next) {
      stableDeployment = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--canary-deployment" && next) {
      canaryDeployment = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--stable-service" && next) {
      stableService = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--canary-service" && next) {
      canaryService = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--canary-ingress" && next) {
      canaryIngress = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--canary-manifest-dir" && next) {
      canaryManifestDir = path.resolve(next.trim());
      index += 1;
      continue;
    }
    if (arg === "--canary-weight" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
        fail(`Unsupported --canary-weight value: ${next}`);
      }
      canaryWeight = parsed;
      index += 1;
      continue;
    }
    if (arg === "--image-tag" && next) {
      imageTag = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--smoke-command" && next) {
      smokeCommand = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--simulate-smoke-status" && next) {
      if (next !== "passed" && next !== "failed") {
        fail(`Unsupported --simulate-smoke-status value: ${next}`);
      }
      simulateSmokeStatus = next;
      index += 1;
      continue;
    }
    if (arg === "--simulate-rollback-status" && next) {
      if (next !== "succeeded" && next !== "failed") {
        fail(`Unsupported --simulate-rollback-status value: ${next}`);
      }
      simulateRollbackStatus = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = path.resolve(next.trim());
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = path.resolve(next.trim());
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!candidate) {
    fail("Missing required --candidate <revision>.");
  }

  return {
    candidate,
    mode,
    namespace,
    stableDeployment,
    canaryDeployment,
    stableService,
    canaryService,
    canaryIngress,
    canaryManifestDir,
    canaryWeight,
    ...(imageTag ? { imageTag } : {}),
    smokeCommand,
    simulateSmokeStatus,
    simulateRollbackStatus,
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {})
  };
}

function resolveOutputPaths(args: Args): OutputPaths {
  const token = toArtifactToken(args.candidate);
  return {
    json: args.outputPath ?? path.join(DEFAULT_OUTPUT_DIR, `production-rollback-drill-${token}.json`),
    markdown: args.markdownOutputPath ?? path.join(DEFAULT_OUTPUT_DIR, `production-rollback-drill-${token}.md`)
  };
}

function createCommandRunner(runCommand: ProductionRollbackDrillDependencies["runCommand"]) {
  if (runCommand) {
    return runCommand;
  }
  return (command: string, args: string[]): CommandExecutionResult => {
    const result = spawnSync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    return {
      status: typeof result.status === "number" ? result.status : null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  };
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function pushCommandLog(
  logs: ProductionRollbackDrillCommandLog[],
  label: string,
  command: string[],
  executed: boolean,
  result: CommandExecutionResult
): void {
  logs.push({
    label,
    command,
    executed,
    exitCode: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  });
}

function renderHeadline(status: ProductionRollbackDrillStatus, mode: ProductionRollbackDrillMode, rollbackRecovered: boolean): string {
  if (status === "passed") {
    return rollbackRecovered
      ? "Production rollback drill exercised the auto-rollback path and recovered the canary."
      : "Production rollback drill passed.";
  }
  if (status === "pending") {
    return mode === "simulate"
      ? "Simulated rollback drill covered the failure path, but a live production execution is still required."
      : "Production rollback drill is pending follow-up.";
  }
  return "Production rollback drill did not complete the required auto-rollback recovery path.";
}

export function buildProductionRollbackDrillReport(
  args: Args,
  deps: ProductionRollbackDrillDependencies = {}
): ProductionRollbackDrillReport {
  const now = deps.now ?? (() => new Date());
  const runCommand = createCommandRunner(deps.runCommand);
  const commandLogs: ProductionRollbackDrillCommandLog[] = [];

  const applyCommand = ["apply", "-k", args.canaryManifestDir, "-n", args.namespace];
  const setImageCommand = args.imageTag
    ? ["set", "image", `deployment/${args.canaryDeployment}`, `server=${args.imageTag}`, "-n", args.namespace]
    : undefined;
  const weightCommand = [
    "annotate",
    "ingress",
    args.canaryIngress,
    `nginx.ingress.kubernetes.io/canary-weight=${args.canaryWeight}`,
    "--overwrite",
    "-n",
    args.namespace
  ];
  const smokeCommand = ["sh", "-lc", args.smokeCommand];
  const rollbackCommand = ["rollout", "undo", `deployment/${args.canaryDeployment}`, "-n", args.namespace];

  let smokeStatus: ProductionRollbackDrillReport["smoke"]["status"] = "skipped";
  let smokeExitCode: number | null = null;
  let smokeSummary = "Smoke was not started.";
  let rollbackAttempted = false;
  let rollbackStatus: DrillRollbackStatus = "skipped";
  let rollbackSummary = "Rollback was not required.";

  if (args.mode === "execute") {
    const applyResult = runCommand("kubectl", applyCommand);
    pushCommandLog(commandLogs, "Apply canary manifests", ["kubectl", ...applyCommand], true, applyResult);
    if (applyResult.status !== 0) {
      smokeSummary = "Canary manifests failed to apply.";
      rollbackSummary = "Rollback was skipped because canary deploy never became runnable.";
      return {
        schemaVersion: 1,
        generatedAt: now().toISOString(),
        candidate: {
          revision: args.candidate,
          shortRevision: shortenRevision(args.candidate),
          ...(args.imageTag ? { imageTag: args.imageTag } : {}),
          targetSurface: "wechat",
          stage: "production"
        },
        mode: args.mode,
        status: "failed",
        summary: {
          headline: renderHeadline("failed", args.mode, false),
          autoRollbackCovered: false,
          executedAgainstCluster: true,
          smokeFailed: false,
          rollbackRecovered: false,
          requiredFreshnessDays: REQUIRED_FRESHNESS_DAYS
        },
        rollout: {
          namespace: args.namespace,
          stableDeployment: args.stableDeployment,
          canaryDeployment: args.canaryDeployment,
          stableService: args.stableService,
          canaryService: args.canaryService,
          canaryIngress: args.canaryIngress,
          canaryManifestDir: args.canaryManifestDir,
          canaryWeight: args.canaryWeight
        },
        smoke: {
          command: smokeCommand,
          status: "skipped",
          exitCode: smokeExitCode,
          summary: smokeSummary
        },
        rollback: {
          attempted: rollbackAttempted,
          status: rollbackStatus,
          summary: rollbackSummary,
          commands: [["kubectl", ...rollbackCommand]]
        },
        commands: commandLogs,
        evidence: {
          runbookPath: DEFAULT_RUNBOOK_PATH,
          k8sCanaryDir: args.canaryManifestDir
        }
      };
    }

    if (setImageCommand) {
      const setImageResult = runCommand("kubectl", setImageCommand);
      pushCommandLog(commandLogs, "Pin canary image tag", ["kubectl", ...setImageCommand], true, setImageResult);
      if (setImageResult.status !== 0) {
        smokeSummary = "Canary image tag pin failed before smoke started.";
        rollbackSummary = "Rollback was skipped because the canary image was never pinned.";
        return {
          schemaVersion: 1,
          generatedAt: now().toISOString(),
          candidate: {
            revision: args.candidate,
            shortRevision: shortenRevision(args.candidate),
            ...(args.imageTag ? { imageTag: args.imageTag } : {}),
            targetSurface: "wechat",
            stage: "production"
          },
          mode: args.mode,
          status: "failed",
          summary: {
            headline: renderHeadline("failed", args.mode, false),
            autoRollbackCovered: false,
            executedAgainstCluster: true,
            smokeFailed: false,
            rollbackRecovered: false,
            requiredFreshnessDays: REQUIRED_FRESHNESS_DAYS
          },
          rollout: {
            namespace: args.namespace,
            stableDeployment: args.stableDeployment,
            canaryDeployment: args.canaryDeployment,
            stableService: args.stableService,
            canaryService: args.canaryService,
            canaryIngress: args.canaryIngress,
            canaryManifestDir: args.canaryManifestDir,
            canaryWeight: args.canaryWeight
          },
          smoke: {
            command: smokeCommand,
            status: "skipped",
            exitCode: smokeExitCode,
            summary: smokeSummary
          },
          rollback: {
            attempted: rollbackAttempted,
            status: rollbackStatus,
            summary: rollbackSummary,
            commands: [["kubectl", ...rollbackCommand]]
          },
          commands: commandLogs,
          evidence: {
            runbookPath: DEFAULT_RUNBOOK_PATH,
            k8sCanaryDir: args.canaryManifestDir
          }
        };
      }
    }

    const weightResult = runCommand("kubectl", weightCommand);
    pushCommandLog(commandLogs, "Shift ingress canary weight", ["kubectl", ...weightCommand], true, weightResult);
    if (weightResult.status !== 0) {
      smokeSummary = "Canary weight update failed before smoke started.";
      rollbackSummary = "Rollback was skipped because the canary never entered weighted traffic.";
      return {
        schemaVersion: 1,
        generatedAt: now().toISOString(),
        candidate: {
          revision: args.candidate,
          shortRevision: shortenRevision(args.candidate),
          ...(args.imageTag ? { imageTag: args.imageTag } : {}),
          targetSurface: "wechat",
          stage: "production"
        },
        mode: args.mode,
        status: "failed",
        summary: {
          headline: renderHeadline("failed", args.mode, false),
          autoRollbackCovered: false,
          executedAgainstCluster: true,
          smokeFailed: false,
          rollbackRecovered: false,
          requiredFreshnessDays: REQUIRED_FRESHNESS_DAYS
        },
        rollout: {
          namespace: args.namespace,
          stableDeployment: args.stableDeployment,
          canaryDeployment: args.canaryDeployment,
          stableService: args.stableService,
          canaryService: args.canaryService,
          canaryIngress: args.canaryIngress,
          canaryManifestDir: args.canaryManifestDir,
          canaryWeight: args.canaryWeight
        },
        smoke: {
          command: smokeCommand,
          status: "skipped",
          exitCode: smokeExitCode,
          summary: smokeSummary
        },
        rollback: {
          attempted: rollbackAttempted,
          status: rollbackStatus,
          summary: rollbackSummary,
          commands: [["kubectl", ...rollbackCommand]]
        },
        commands: commandLogs,
        evidence: {
          runbookPath: DEFAULT_RUNBOOK_PATH,
          k8sCanaryDir: args.canaryManifestDir
        }
      };
    }

    const smokeResult = runCommand(smokeCommand[0]!, smokeCommand.slice(1));
    pushCommandLog(commandLogs, "Run canary smoke command", smokeCommand, true, smokeResult);
    smokeExitCode = smokeResult.status;
    smokeStatus = smokeResult.status === 0 ? "passed" : "failed";
    smokeSummary =
      smokeStatus === "passed"
        ? "Canary smoke passed, so the rollback path was not exercised."
        : "Canary smoke failed and triggered auto-rollback.";

    if (smokeStatus === "failed") {
      rollbackAttempted = true;
      const rollbackResult = runCommand("kubectl", rollbackCommand);
      pushCommandLog(commandLogs, "Rollback canary deployment", ["kubectl", ...rollbackCommand], true, rollbackResult);
      rollbackStatus = rollbackResult.status === 0 ? "succeeded" : "failed";
      rollbackSummary =
        rollbackStatus === "succeeded"
          ? "Automatic rollback succeeded after the smoke failure."
          : "Automatic rollback failed after the smoke failure.";
    }
  } else {
    pushCommandLog(commandLogs, "Apply canary manifests", ["kubectl", ...applyCommand], false, {
      status: null,
      stdout: "",
      stderr: ""
    });
    if (setImageCommand) {
      pushCommandLog(commandLogs, "Pin canary image tag", ["kubectl", ...setImageCommand], false, {
        status: null,
        stdout: "",
        stderr: ""
      });
    }
    pushCommandLog(commandLogs, "Shift ingress canary weight", ["kubectl", ...weightCommand], false, {
      status: null,
      stdout: "",
      stderr: ""
    });
    pushCommandLog(commandLogs, "Run canary smoke command", smokeCommand, false, {
      status: null,
      stdout: "",
      stderr: ""
    });

    smokeStatus = args.simulateSmokeStatus;
    smokeSummary =
      smokeStatus === "failed"
        ? "Simulated canary smoke failure would trigger rollback."
        : "Simulated canary smoke passed, so rollback would not run.";
    if (smokeStatus === "failed") {
      rollbackAttempted = true;
      rollbackStatus = args.simulateRollbackStatus;
      rollbackSummary =
        rollbackStatus === "succeeded"
          ? "Simulated rollback recovered the canary."
          : "Simulated rollback also failed.";
      pushCommandLog(commandLogs, "Rollback canary deployment", ["kubectl", ...rollbackCommand], false, {
        status: null,
        stdout: "",
        stderr: ""
      });
    }
  }

  const smokeFailed = smokeStatus === "failed";
  const rollbackRecovered = rollbackAttempted && rollbackStatus === "succeeded";
  const autoRollbackCovered = smokeFailed && rollbackRecovered;
  const executedAgainstCluster = args.mode === "execute";
  const status: ProductionRollbackDrillStatus =
    autoRollbackCovered && executedAgainstCluster
      ? "passed"
      : autoRollbackCovered
        ? "pending"
        : "failed";

  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    candidate: {
      revision: args.candidate,
      shortRevision: shortenRevision(args.candidate),
      ...(args.imageTag ? { imageTag: args.imageTag } : {}),
      targetSurface: "wechat",
      stage: "production"
    },
    mode: args.mode,
    status,
    summary: {
      headline: renderHeadline(status, args.mode, rollbackRecovered),
      autoRollbackCovered,
      executedAgainstCluster,
      smokeFailed,
      rollbackRecovered,
      requiredFreshnessDays: REQUIRED_FRESHNESS_DAYS
    },
    rollout: {
      namespace: args.namespace,
      stableDeployment: args.stableDeployment,
      canaryDeployment: args.canaryDeployment,
      stableService: args.stableService,
      canaryService: args.canaryService,
      canaryIngress: args.canaryIngress,
      canaryManifestDir: args.canaryManifestDir,
      canaryWeight: args.canaryWeight
    },
    smoke: {
      command: smokeCommand,
      status: smokeStatus,
      exitCode: smokeExitCode,
      summary: smokeSummary
    },
    rollback: {
      attempted: rollbackAttempted,
      status: rollbackStatus,
      summary: rollbackSummary,
      commands: rollbackAttempted ? [["kubectl", ...rollbackCommand]] : []
    },
    commands: commandLogs,
    evidence: {
      runbookPath: DEFAULT_RUNBOOK_PATH,
      k8sCanaryDir: args.canaryManifestDir
    }
  };
}

export function renderProductionRollbackDrillMarkdown(report: ProductionRollbackDrillReport): string {
  const lines = [
    "# Production Rollback Drill",
    "",
    `- Generated at: \`${report.generatedAt}\``,
    `- Candidate revision: \`${report.candidate.revision}\``,
    `- Mode: \`${report.mode}\``,
    `- Status: **${report.status.toUpperCase()}**`,
    `- Headline: ${report.summary.headline}`,
    "",
    "## Rollout Context",
    "",
    `- Namespace: \`${report.rollout.namespace}\``,
    `- Stable deployment: \`${report.rollout.stableDeployment}\``,
    `- Canary deployment: \`${report.rollout.canaryDeployment}\``,
    `- Stable service: \`${report.rollout.stableService}\``,
    `- Canary service: \`${report.rollout.canaryService}\``,
    `- Canary ingress: \`${report.rollout.canaryIngress}\``,
    `- Canary manifests: \`${path.relative(process.cwd(), report.rollout.canaryManifestDir).replace(/\\/g, "/")}\``,
    `- Canary weight: \`${report.rollout.canaryWeight}%\``,
    "",
    "## Drill Outcome",
    "",
    `- Executed against cluster: ${report.summary.executedAgainstCluster ? "yes" : "no"}`,
    `- Smoke failed: ${report.summary.smokeFailed ? "yes" : "no"}`,
    `- Auto rollback covered: ${report.summary.autoRollbackCovered ? "yes" : "no"}`,
    `- Rollback recovered: ${report.summary.rollbackRecovered ? "yes" : "no"}`,
    `- Freshness requirement: within ${report.summary.requiredFreshnessDays} days`,
    "",
    "## Smoke",
    "",
    `- Command: \`${report.smoke.command.join(" ")}\``,
    `- Status: \`${report.smoke.status}\``,
    `- Exit code: \`${report.smoke.exitCode ?? "<none>"}\``,
    `- Summary: ${report.smoke.summary}`,
    "",
    "## Rollback",
    "",
    `- Attempted: ${report.rollback.attempted ? "yes" : "no"}`,
    `- Status: \`${report.rollback.status}\``,
    `- Summary: ${report.rollback.summary}`,
  ];

  if (report.rollback.commands.length > 0) {
    lines.push("- Commands:");
    for (const command of report.rollback.commands) {
      lines.push(`  - \`${command.join(" ")}\``);
    }
  }

  lines.push("");
  lines.push("## Command Log");
  lines.push("");
  for (const command of report.commands) {
    lines.push(
      `- ${command.label}: \`${command.command.join(" ")}\` [executed=${command.executed ? "yes" : "no"} exitCode=${
        command.exitCode ?? "<none>"
      }]`
    );
  }

  lines.push("");
  lines.push("## References");
  lines.push("");
  lines.push(`- Runbook: \`${path.relative(process.cwd(), report.evidence.runbookPath).replace(/\\/g, "/")}\``);
  lines.push(`- Canary manifests: \`${path.relative(process.cwd(), report.evidence.k8sCanaryDir).replace(/\\/g, "/")}\``);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export function runProductionRollbackDrillCli(argv = process.argv): number {
  const args = parseArgs(argv);
  const outputPaths = resolveOutputPaths(args);
  const report = buildProductionRollbackDrillReport(args);
  writeFile(outputPaths.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFile(outputPaths.markdown, renderProductionRollbackDrillMarkdown(report));

  console.log(`Wrote production rollback drill JSON: ${path.relative(process.cwd(), outputPaths.json).replace(/\\/g, "/")}`);
  console.log(
    `Wrote production rollback drill Markdown: ${path.relative(process.cwd(), outputPaths.markdown).replace(/\\/g, "/")}`
  );
  console.log(report.summary.headline);

  return report.status === "failed" ? 1 : 0;
}

const executedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedDirectly) {
  try {
    process.exitCode = runProductionRollbackDrillCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
