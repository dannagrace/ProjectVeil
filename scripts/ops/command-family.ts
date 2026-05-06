import { spawnSync } from "node:child_process";

import { assertSupportedRuntime } from "../runtime-preflight.mjs";
import registryData from "./command-registry.json" with { type: "json" };

export type CommandFamilyName = keyof typeof registryData;

export type CommandRegistryEntry = {
  legacyScript: string;
  name: string;
  runner: string;
};

type FamilyConfig = {
  defaultRunner?: string;
  description: string;
  emptyState: string;
  usage: string;
};

const FAMILY_CONFIG: Record<CommandFamilyName, FamilyConfig> = {
  release: {
    description: "Unified release workflow entrypoint for candidate prep, gates, evidence, and launch packets.",
    emptyState: "No subcommand prints this help.",
    usage: "npm run release -- [command] [-- args...]",
  },
  validate: {
    description: "Unified validation entrypoint for config, content, build, environment, and readiness checks.",
    emptyState: "No subcommand prints this help.",
    usage: "npm run validate -- [command] [-- args...]",
  },
  smoke: {
    description: "Unified smoke entrypoint for client, Cocos, CI, and WeChat sanity checks.",
    emptyState: "No subcommand prints this help.",
    usage: "npm run smoke -- [command] [-- args...]",
  },
  test: {
    defaultRunner: "node --import tsx ./scripts/run-root-tests.ts",
    description: "Unified test entrypoint for focused suites, regressions, coverage, and end-to-end harnesses.",
    emptyState: "No subcommand runs the root test suite.",
    usage: "npm test -- [command] [-- args...]",
  },
  db: {
    description: "Unified database entrypoint for migrations, restores, snapshots, and room-profile maintenance.",
    emptyState: "No subcommand prints this help.",
    usage: "npm run db -- [command] [-- args...]",
  },
  typecheck: {
    defaultRunner: "tsc -p tsconfig.base.json --noEmit",
    description: "Unified typecheck entrypoint for workspace, app, and ops-tooling compiler gates.",
    emptyState: "No subcommand runs the workspace base typecheck.",
    usage: "npm run typecheck -- [command] [-- args...]",
  },
  dev: {
    description: "Unified development entrypoint for local server and H5 shell workflows.",
    emptyState: "No subcommand prints this help.",
    usage: "npm run dev -- [command] [-- args...]",
  },
};

const TOKEN_OVERRIDES: Record<string, string> = {
  ab: "A/B",
  ci: "CI",
  cocos: "Cocos",
  db: "DB",
  e2e: "E2E",
  gm: "GM",
  h5: "H5",
  hpa: "HPA",
  k8s: "K8s",
  mysql: "MySQL",
  ops: "Ops",
  pvp: "PVP",
  pve: "PVE",
  rc: "RC",
  redis: "Redis",
  slo: "SLO",
  ugc: "UGC",
  wechat: "WeChat",
};

const FAMILY_SUMMARY_PREFIX: Record<CommandFamilyName, string> = {
  release: "Run",
  validate: "Validate",
  smoke: "Smoke-test",
  test: "Run",
  db: "Execute",
  typecheck: "Typecheck",
  dev: "Start",
};

function capitalizeWord(word: string): string {
  if (word.length === 0) {
    return word;
  }

  return `${word[0].toUpperCase()}${word.slice(1)}`;
}

function humanizeToken(token: string): string {
  const override = TOKEN_OVERRIDES[token.toLowerCase()];
  if (override) {
    return override;
  }

  return capitalizeWord(token);
}

export function humanizeCommandName(name: string): string {
  return name
    .split(/[:.-]/g)
    .filter((part) => part.length > 0)
    .map((part) => humanizeToken(part))
    .join(" ");
}

export function getCommandRegistry(): typeof registryData {
  return registryData;
}

export function getFamilyCommands(family: CommandFamilyName): CommandRegistryEntry[] {
  return [...registryData[family].commands].sort((left, right) => left.name.localeCompare(right.name));
}

export function getFamilyCommand(family: CommandFamilyName, name: string): CommandRegistryEntry | undefined {
  return getFamilyCommands(family).find((entry) => entry.name === name);
}

export function getFamilyUsage(family: CommandFamilyName): string {
  return FAMILY_CONFIG[family].usage;
}

export function getFamilyDescription(family: CommandFamilyName): string {
  return FAMILY_CONFIG[family].description;
}

export function getCommandSummary(family: CommandFamilyName, entry: CommandRegistryEntry): string {
  const subject = humanizeCommandName(entry.name);
  const prefix = FAMILY_SUMMARY_PREFIX[family];

  switch (family) {
    case "release":
      return `${prefix} the ${subject} release workflow.`;
    case "validate":
      return `${prefix} ${subject}.`;
    case "smoke":
      return `${prefix} ${subject}.`;
    case "test":
      return `${prefix} the ${subject} test suite.`;
    case "db":
      return `${prefix} the ${subject} database task.`;
    case "typecheck":
      return `${prefix} ${subject}.`;
    case "dev":
      return `${prefix} the ${subject} development workflow.`;
    default: {
      const exhaustiveCheck: never = family;
      throw new Error(`Unhandled command family: ${exhaustiveCheck}`);
    }
  }
}

export function renderFamilyHelp(family: CommandFamilyName): string {
  const commands = getFamilyCommands(family);
  const widestCommand = commands.reduce((max, entry) => Math.max(max, entry.name.length), 0);
  const lines = [
    `Usage: ${getFamilyUsage(family)}`,
    "",
    getFamilyDescription(family),
    "",
    FAMILY_CONFIG[family].emptyState,
    "",
    "Commands:",
  ];

  for (const entry of commands) {
    lines.push(`  ${entry.name.padEnd(widestCommand)}  ${getCommandSummary(family, entry)}`);
  }

  lines.push("");

  return `${lines.join("\n").trimEnd()}\n`;
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

function stripNodeStackTrace(stderr: string): string {
  if (!/\n\s+at\s|\.ts:\d+:\d+|Node\.js v\d+/.test(stderr)) {
    return stderr;
  }

  const lines = stderr.split(/\r?\n/);
  const errorLine = lines.find((line) => /^(?:Error|TypeError|SyntaxError|RangeError):\s/.test(line.trim()));
  if (errorLine) {
    return `${errorLine.trim()}\n`;
  }

  return stderr
    .split(/\r?\n\s+at\s/)[0]
    .replace(/\n?\s*\^+\s*$/m, "")
    .trimEnd() + "\n";
}

function runCommand(command: string, args: string[]): number {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : args;
  const commandLine = [command, ...forwardedArgs.map((arg) => shellQuote(arg))].join(" ");
  const result = spawnSync(commandLine, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 50,
    shell: true,
    stdio: ["inherit", "inherit", "pipe"],
  });
  const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr?.toString() ?? "";

  if (typeof result.status === "number") {
    if (stderr) {
      process.stderr.write(result.status === 0 ? stderr : stripNodeStackTrace(stderr));
    }
    return result.status;
  }

  if (result.error) {
    console.error(result.error.message);
  }

  return 1;
}

function isForwardedHelpRequest(args: string[]): boolean {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : args;
  return forwardedArgs.length === 1 && (forwardedArgs[0] === "--help" || forwardedArgs[0] === "-h" || forwardedArgs[0] === "help");
}

type RunFamilyCliOptions = {
  argv: string[];
  assertSupportedRuntimeImpl?: RuntimePreflightAssert;
  family: CommandFamilyName;
};

type RuntimePreflightAssert = (options: { commandName: string }) => unknown;

const RUNTIME_PREFLIGHT_FAMILIES = new Set<CommandFamilyName>(["dev", "release", "smoke", "test"]);

function runRuntimePreflight(
  family: CommandFamilyName,
  commandName: string,
  assertSupportedRuntimeImpl: RuntimePreflightAssert = assertSupportedRuntime
): number {
  if (!RUNTIME_PREFLIGHT_FAMILIES.has(family)) {
    return 0;
  }

  try {
    assertSupportedRuntimeImpl({ commandName });
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runFamilyCli({ argv, assertSupportedRuntimeImpl, family }: RunFamilyCliOptions): number {
  const defaultRunner = FAMILY_CONFIG[family].defaultRunner;
  const [commandName, ...rest] = argv;

  if (!commandName) {
    if (defaultRunner) {
      const preflightExitCode = runRuntimePreflight(family, getFamilyUsage(family), assertSupportedRuntimeImpl);
      if (preflightExitCode !== 0) {
        return preflightExitCode;
      }
      return runCommand(defaultRunner, []);
    }

    process.stdout.write(renderFamilyHelp(family));
    return 0;
  }

  if (commandName === "--help" || commandName === "-h" || commandName === "help") {
    process.stdout.write(renderFamilyHelp(family));
    return 0;
  }

  const entry = getFamilyCommand(family, commandName);
  if (!entry) {
    console.error(`Unknown ${family} command: ${commandName}\n`);
    process.stderr.write(renderFamilyHelp(family));
    return 1;
  }

  if (isForwardedHelpRequest(rest)) {
    process.stdout.write(renderFamilyHelp(family));
    return 0;
  }

  const preflightExitCode = runRuntimePreflight(family, cliInvocationForCommand(family, commandName), assertSupportedRuntimeImpl);
  if (preflightExitCode !== 0) {
    return preflightExitCode;
  }

  return runCommand(entry.runner, rest);
}

export function cliInvocationForCommand(family: CommandFamilyName, commandName: string): string {
  if (family === "test") {
    return `npm test -- ${commandName}`;
  }

  return `npm run ${family} -- ${commandName}`;
}

export const COMMAND_FAMILY_ORDER: CommandFamilyName[] = ["release", "validate", "smoke", "test", "db", "typecheck", "dev"];
