import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CaseStatus = "passed" | "failed" | "skipped";
type ExecutionStatus = "passed" | "failed";

interface Args {
  outputPath?: string;
  reportPath?: string;
}

interface PlaywrightJsonReport {
  stats?: {
    duration?: number;
  };
  suites?: PlaywrightSuite[];
}

interface PlaywrightSuite {
  title?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightSpec {
  title?: string;
  ok?: boolean;
  tests?: PlaywrightTest[];
}

interface PlaywrightTest {
  projectName?: string;
  results?: Array<{
    status?: string;
    duration?: number;
  }>;
}

interface SyncGovernanceScenarioDefinition {
  id: string;
  title: string;
  category: "room-push" | "room-recovery" | "battle-reconnect" | "prediction-correction";
  risk: string;
}

interface SyncGovernanceScenarioResult extends SyncGovernanceScenarioDefinition {
  projectName: string;
  status: CaseStatus;
  durationMs: number;
}

interface SyncGovernanceMatrixReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: {
    commit: string;
    shortCommit: string;
    branch: string;
    dirty: boolean;
  };
  command: {
    fixtureValidation: string;
    playwright: string;
  };
  execution: {
    status: ExecutionStatus;
    exitCode: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    mode: "live" | "report";
    stdoutTail?: string;
    stderrTail?: string;
    rawPlaywrightReportPath: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  scenarios: SyncGovernanceScenarioResult[];
}

const FIXTURE_COMMAND = "npm run validate:e2e:fixtures";
const OUTPUT_TAIL_BYTES = 4000;
const PLAYWRIGHT_REPORTER = "json";
const SCENARIOS: SyncGovernanceScenarioDefinition[] = [
  {
    id: "room-push-redaction",
    title: "second player receives room push updates without leaking another player's move details",
    category: "room-push",
    risk: "Peer updates must converge without exposing another client's private movement trace."
  },
  {
    id: "room-recovery-building-ownership",
    title: "reloading a peer after ownership sync restores the claimed building state from the authority snapshot",
    category: "room-recovery",
    risk: "Peer reload must recover the latest claimed POI state instead of replaying stale room data."
  },
  {
    id: "battle-reconnect-turn-resume",
    title: "players can reload during a PvP battle and resume from the same turn state",
    category: "battle-reconnect",
    risk: "Reconnect during battle cannot fork turn ownership or lose the active encounter session."
  },
  {
    id: "postbattle-lock-correction",
    title: "winner can recover immediately after PvP settlement while loser stays locked by zero movement",
    category: "prediction-correction",
    risk: "Settlement recovery must re-apply authoritative movement locks so local prediction cannot escape zero-move state."
  }
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let outputPath: string | undefined;
  let reportPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--report" && next) {
      reportPath = next;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(outputPath ? { outputPath } : {}),
    ...(reportPath ? { reportPath } : {})
  };
}

function tailText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > OUTPUT_TAIL_BYTES ? normalized.slice(-OUTPUT_TAIL_BYTES) : normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildScenarioGrepPattern(scenarios: readonly SyncGovernanceScenarioDefinition[] = SCENARIOS): string {
  return `(?:${scenarios.map((scenario) => escapeRegExp(scenario.title)).join("|")})`;
}

function buildPlaywrightCommand(scenarios: readonly SyncGovernanceScenarioDefinition[] = SCENARIOS): string {
  return `npx playwright test --config=playwright.multiplayer.config.ts --reporter=${PLAYWRIGHT_REPORTER} --grep "${buildScenarioGrepPattern(scenarios)}"`;
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

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function aggregateResultStatus(test: PlaywrightTest | undefined, specOk: boolean | undefined): CaseStatus {
  const statuses = test?.results?.map((entry) => entry.status).filter((status): status is string => Boolean(status)) ?? [];
  if (statuses.some((status) => status === "failed" || status === "timedOut" || status === "interrupted")) {
    return "failed";
  }
  if (statuses.some((status) => status === "passed")) {
    return "passed";
  }
  if (specOk === false) {
    return "failed";
  }
  return "skipped";
}

function collectSpecs(suite: PlaywrightSuite | undefined, entries: Map<string, { projectName: string; status: CaseStatus; durationMs: number }>): void {
  if (!suite) {
    return;
  }

  for (const spec of suite.specs ?? []) {
    const title = spec.title ?? "";
    if (!title) {
      continue;
    }
    const test = spec.tests?.[0];
    entries.set(title, {
      projectName: test?.projectName ?? "default",
      status: aggregateResultStatus(test, spec.ok),
      durationMs: test?.results?.reduce((sum, entry) => sum + (entry.duration ?? 0), 0) ?? 0
    });
  }

  for (const child of suite.suites ?? []) {
    collectSpecs(child, entries);
  }
}

export function collectScenarioResults(
  report: PlaywrightJsonReport,
  scenarios: readonly SyncGovernanceScenarioDefinition[] = SCENARIOS
): SyncGovernanceScenarioResult[] {
  const collected = new Map<string, { projectName: string; status: CaseStatus; durationMs: number }>();
  for (const suite of report.suites ?? []) {
    collectSpecs(suite, collected);
  }

  return scenarios.map((scenario) => {
    const match = collected.get(scenario.title);
    if (!match) {
      fail(`Playwright report is missing required sync-governance scenario: ${scenario.title}`);
    }
    return {
      ...scenario,
      ...match
    };
  });
}

export function buildSummary(scenarios: readonly SyncGovernanceScenarioResult[]): SyncGovernanceMatrixReport["summary"] {
  return {
    total: scenarios.length,
    passed: scenarios.filter((scenario) => scenario.status === "passed").length,
    failed: scenarios.filter((scenario) => scenario.status === "failed").length,
    skipped: scenarios.filter((scenario) => scenario.status === "skipped").length
  };
}

function resolveOutputPath(requestedPath: string | undefined, shortCommit: string): string {
  if (requestedPath) {
    return path.resolve(requestedPath);
  }
  return path.resolve("artifacts", "release-readiness", `sync-governance-matrix-${shortCommit}.json`);
}

function parsePlaywrightReport(raw: string, sourceLabel: string): PlaywrightJsonReport {
  try {
    return JSON.parse(raw) as PlaywrightJsonReport;
  } catch (error) {
    fail(`${sourceLabel} did not contain valid Playwright JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const commit = readGitValue(["rev-parse", "HEAD"]);
  const shortCommit = readGitValue(["rev-parse", "--short", "HEAD"]);
  const branch = readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = readGitValue(["status", "--porcelain"]).length > 0;
  const outputPath = resolveOutputPath(args.outputPath, shortCommit);
  const rawPlaywrightReportPath = args.reportPath
    ? path.resolve(args.reportPath)
    : outputPath.replace(/\.json$/, ".playwright.json");
  const playwrightCommand = buildPlaywrightCommand();
  const startedAtValue = Date.now();
  const startedAt = new Date(startedAtValue).toISOString();

  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  let report: PlaywrightJsonReport;
  let mode: "live" | "report" = "live";

  if (args.reportPath) {
    mode = "report";
    if (!fs.existsSync(rawPlaywrightReportPath)) {
      fail(`Playwright report does not exist: ${rawPlaywrightReportPath}`);
    }
    report = parsePlaywrightReport(fs.readFileSync(rawPlaywrightReportPath, "utf8"), rawPlaywrightReportPath);
  } else {
    const fixtureResult = spawnSync(FIXTURE_COMMAND, {
      cwd: process.cwd(),
      shell: true,
      encoding: "utf8",
      stdio: "inherit"
    });
    if (fixtureResult.status !== 0) {
      fail(`${FIXTURE_COMMAND} failed with exit code ${fixtureResult.status ?? -1}.`);
    }

    const result = spawnSync(playwrightCommand, {
      cwd: process.cwd(),
      shell: true,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20
    });
    exitCode = result.status ?? 1;
    stdout = result.stdout;
    stderr = result.stderr;
    if (!stdout.trim()) {
      fail("Sync-governance matrix did not emit a Playwright JSON report.");
    }
    report = parsePlaywrightReport(stdout, "Playwright stdout");
    writeJsonFile(rawPlaywrightReportPath, report);
  }

  const finishedAtValue = Date.now();
  const finishedAt = new Date(finishedAtValue).toISOString();
  const scenarios = collectScenarioResults(report);
  const summary = buildSummary(scenarios);
  const executionStatus: ExecutionStatus = exitCode === 0 && summary.failed === 0 ? "passed" : "failed";
  const matrix: SyncGovernanceMatrixReport = {
    schemaVersion: 1,
    generatedAt: finishedAt,
    revision: {
      commit,
      shortCommit,
      branch,
      dirty
    },
    command: {
      fixtureValidation: FIXTURE_COMMAND,
      playwright: playwrightCommand
    },
    execution: {
      status: executionStatus,
      exitCode,
      startedAt,
      finishedAt,
      durationMs: finishedAtValue - startedAtValue,
      mode,
      rawPlaywrightReportPath,
      ...(tailText(stdout) ? { stdoutTail: tailText(stdout) } : {}),
      ...(tailText(stderr) ? { stderrTail: tailText(stderr) } : {})
    },
    summary,
    scenarios
  };

  writeJsonFile(outputPath, matrix);

  console.log(`Wrote sync-governance matrix: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
  console.log(`  Status: ${matrix.execution.status}`);
  console.log(`  Scenarios: ${summary.passed} passed / ${summary.failed} failed / ${summary.skipped} skipped`);

  if (matrix.execution.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
