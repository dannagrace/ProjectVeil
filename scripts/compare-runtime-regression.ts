import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ScenarioName = "world_progression" | "battle_settlement" | "reconnect" | "reconnect_soak";
type ComparisonStatus = "passed" | "failed";
type ThresholdKind = "eq" | "min" | "max" | "present" | "empty";

interface Args {
  baselinePath: string;
  artifactPath: string;
  outputPath?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface RuntimeHealthSummary {
  checkedAt: string;
  activeRoomCount: number;
  connectionCount: number;
  activeBattleCount: number;
  heroCount: number;
  connectMessagesTotal: number;
  worldActionsTotal: number;
  battleActionsTotal: number;
  actionMessagesTotal: number;
}

interface ScenarioResult {
  scenario: ScenarioName;
  rooms: number;
  successfulRooms: number;
  failedRooms: number;
  completedActions: number;
  durationMs: number;
  roomsPerSecond: number;
  actionsPerSecond: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  cpuTotalMs: number;
  cpuCoreUtilizationPct: number;
  rssStartMb: number;
  rssPeakMb: number;
  rssEndMb: number;
  heapStartMb: number;
  heapPeakMb: number;
  heapEndMb: number;
  peakActiveHandles: number;
  runtimeHealthAfterConnect?: RuntimeHealthSummary;
  runtimeHealthAfterScenario?: RuntimeHealthSummary;
  errorMessage?: string;
}

interface StressArtifact {
  schemaVersion: 1;
  artifactType?: string;
  generatedAt?: string;
  command?: string;
  revision?: GitRevision;
  status?: ComparisonStatus;
  results: ScenarioResult[];
}

interface RuntimeScenarioThresholds {
  rooms: number;
  successfulRoomsMin: number;
  actionsPerSecondMin: number;
  durationMsMax: number;
  cpuCoreUtilizationPctMax: number;
  runtimeHealthAfterConnect: {
    activeRoomCountEq: number;
    connectionCountEq: number;
  };
  runtimeHealthAfterScenario: {
    worldActionsTotalMin?: number;
    battleActionsTotalMin?: number;
    connectMessagesTotalMin?: number;
    actionMessagesTotalMin?: number;
    connectionCountMin?: number;
  };
}

interface RuntimeRegressionBaseline {
  schemaVersion: 1;
  baselineId: string;
  title: string;
  artifactType: string;
  sourceCommand: string;
  defaults: {
    failedRoomsMax: number;
    rssPeakMbMax: number;
    heapPeakMbMax: number;
    peakActiveHandlesMax: number;
    requireRuntimeHealthAfterConnect: boolean;
    requireRuntimeHealthAfterScenario: boolean;
    requireEmptyErrorMessage: boolean;
  };
  scenarios: Record<string, RuntimeScenarioThresholds>;
}

interface ComparisonCheck {
  id: string;
  metric: string;
  status: ComparisonStatus;
  threshold: {
    kind: ThresholdKind;
    value?: number | string | boolean;
  };
  actual: number | string | boolean | null;
  sourcePath: string;
  message: string;
}

interface ScenarioComparisonResult {
  scenario: string;
  status: ComparisonStatus;
  checks: ComparisonCheck[];
}

interface RuntimeRegressionComparisonReport {
  schemaVersion: 1;
  generatedAt: string;
  baseline: {
    baselineId: string;
    title: string;
    path: string;
  };
  artifact: {
    path: string;
    generatedAt?: string;
    command?: string;
    revision?: GitRevision;
  };
  summary: {
    status: ComparisonStatus;
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    failedCheckIds: string[];
  };
  scenarios: ScenarioComparisonResult[];
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let baselinePath: string | undefined;
  let artifactPath: string | undefined;
  let outputPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--baseline" && next) {
      baselinePath = next;
      index += 1;
      continue;
    }
    if (arg === "--artifact" && next) {
      artifactPath = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!baselinePath) {
    fail("Pass --baseline <path>.");
  }
  if (!artifactPath) {
    fail("Pass --artifact <path>.");
  }

  return {
    baselinePath: path.resolve(baselinePath),
    artifactPath: path.resolve(artifactPath),
    ...(outputPath ? { outputPath: path.resolve(outputPath) } : {})
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createCheck(
  id: string,
  metric: string,
  sourcePath: string,
  kind: ThresholdKind,
  expected: number | string | boolean | undefined,
  actual: number | string | boolean | null,
  passed: boolean,
  message: string
): ComparisonCheck {
  return {
    id,
    metric,
    status: passed ? "passed" : "failed",
    threshold: {
      kind,
      ...(expected === undefined ? {} : { value: expected })
    },
    actual,
    sourcePath,
    message
  };
}

function compareNumber(
  scenario: string,
  metric: string,
  sourcePath: string,
  kind: Extract<ThresholdKind, "eq" | "min" | "max">,
  expected: number,
  actual: number | undefined
): ComparisonCheck {
  const actualValue = actual ?? null;
  const passed =
    typeof actual === "number" &&
    (kind === "eq" ? actual === expected : kind === "min" ? actual >= expected : actual <= expected);
  const comparator = kind === "eq" ? "equal" : kind === "min" ? "be at least" : "be at most";

  return createCheck(
    `${scenario}:${metric}`,
    metric,
    sourcePath,
    kind,
    expected,
    actualValue,
    passed,
    `${scenario} ${metric} should ${comparator} ${expected}; received ${actualValue}.`
  );
}

function comparePresence(scenario: string, metric: string, sourcePath: string, actual: unknown): ComparisonCheck {
  const passed = actual !== undefined && actual !== null;
  return createCheck(
    `${scenario}:${metric}`,
    metric,
    sourcePath,
    "present",
    true,
    passed,
    passed,
    `${scenario} ${metric} ${passed ? "was present." : "was missing."}`
  );
}

function compareEmptyError(scenario: string, actual: string | undefined): ComparisonCheck {
  const passed = !actual;
  return createCheck(
    `${scenario}:errorMessage`,
    "errorMessage",
    "errorMessage",
    "empty",
    "",
    actual ?? "",
    passed,
    passed ? `${scenario} reported no scenario error.` : `${scenario} reported error: ${actual}.`
  );
}

function compareScenario(
  scenario: string,
  thresholds: RuntimeScenarioThresholds,
  defaults: RuntimeRegressionBaseline["defaults"],
  artifact: StressArtifact
): ScenarioComparisonResult {
  const result = artifact.results.find((entry) => entry.scenario === scenario);
  const checks: ComparisonCheck[] = [];

  if (!result) {
    checks.push(
      createCheck(
        `${scenario}:result`,
        "scenarioResult",
        `results[scenario=${scenario}]`,
        "present",
        true,
        null,
        false,
        `Scenario ${scenario} was missing from the runtime artifact.`
      )
    );
    return {
      scenario,
      status: "failed",
      checks
    };
  }

  checks.push(compareNumber(scenario, "rooms", "rooms", "eq", thresholds.rooms, result.rooms));
  checks.push(compareNumber(scenario, "successfulRooms", "successfulRooms", "min", thresholds.successfulRoomsMin, result.successfulRooms));
  checks.push(compareNumber(scenario, "failedRooms", "failedRooms", "max", defaults.failedRoomsMax, result.failedRooms));
  checks.push(compareNumber(scenario, "actionsPerSecond", "actionsPerSecond", "min", thresholds.actionsPerSecondMin, result.actionsPerSecond));
  checks.push(compareNumber(scenario, "durationMs", "durationMs", "max", thresholds.durationMsMax, result.durationMs));
  checks.push(
    compareNumber(
      scenario,
      "cpuCoreUtilizationPct",
      "cpuCoreUtilizationPct",
      "max",
      thresholds.cpuCoreUtilizationPctMax,
      result.cpuCoreUtilizationPct
    )
  );
  checks.push(compareNumber(scenario, "rssPeakMb", "rssPeakMb", "max", defaults.rssPeakMbMax, result.rssPeakMb));
  checks.push(compareNumber(scenario, "heapPeakMb", "heapPeakMb", "max", defaults.heapPeakMbMax, result.heapPeakMb));
  checks.push(
    compareNumber(scenario, "peakActiveHandles", "peakActiveHandles", "max", defaults.peakActiveHandlesMax, result.peakActiveHandles)
  );

  if (defaults.requireRuntimeHealthAfterConnect) {
    checks.push(comparePresence(scenario, "runtimeHealthAfterConnect", "runtimeHealthAfterConnect", result.runtimeHealthAfterConnect));
    checks.push(
      compareNumber(
        scenario,
        "runtimeHealthAfterConnect.activeRoomCount",
        "runtimeHealthAfterConnect.activeRoomCount",
        "eq",
        thresholds.runtimeHealthAfterConnect.activeRoomCountEq,
        result.runtimeHealthAfterConnect?.activeRoomCount
      )
    );
    checks.push(
      compareNumber(
        scenario,
        "runtimeHealthAfterConnect.connectionCount",
        "runtimeHealthAfterConnect.connectionCount",
        "eq",
        thresholds.runtimeHealthAfterConnect.connectionCountEq,
        result.runtimeHealthAfterConnect?.connectionCount
      )
    );
  }

  if (defaults.requireRuntimeHealthAfterScenario) {
    checks.push(comparePresence(scenario, "runtimeHealthAfterScenario", "runtimeHealthAfterScenario", result.runtimeHealthAfterScenario));
    if (typeof thresholds.runtimeHealthAfterScenario.worldActionsTotalMin === "number") {
      checks.push(
        compareNumber(
          scenario,
          "runtimeHealthAfterScenario.worldActionsTotal",
          "runtimeHealthAfterScenario.worldActionsTotal",
          "min",
          thresholds.runtimeHealthAfterScenario.worldActionsTotalMin,
          result.runtimeHealthAfterScenario?.worldActionsTotal
        )
      );
    }
    if (typeof thresholds.runtimeHealthAfterScenario.battleActionsTotalMin === "number") {
      checks.push(
        compareNumber(
          scenario,
          "runtimeHealthAfterScenario.battleActionsTotal",
          "runtimeHealthAfterScenario.battleActionsTotal",
          "min",
          thresholds.runtimeHealthAfterScenario.battleActionsTotalMin,
          result.runtimeHealthAfterScenario?.battleActionsTotal
        )
      );
    }
    if (typeof thresholds.runtimeHealthAfterScenario.connectMessagesTotalMin === "number") {
      checks.push(
        compareNumber(
          scenario,
          "runtimeHealthAfterScenario.connectMessagesTotal",
          "runtimeHealthAfterScenario.connectMessagesTotal",
          "min",
          thresholds.runtimeHealthAfterScenario.connectMessagesTotalMin,
          result.runtimeHealthAfterScenario?.connectMessagesTotal
        )
      );
    }
    if (typeof thresholds.runtimeHealthAfterScenario.actionMessagesTotalMin === "number") {
      checks.push(
        compareNumber(
          scenario,
          "runtimeHealthAfterScenario.actionMessagesTotal",
          "runtimeHealthAfterScenario.actionMessagesTotal",
          "min",
          thresholds.runtimeHealthAfterScenario.actionMessagesTotalMin,
          result.runtimeHealthAfterScenario?.actionMessagesTotal
        )
      );
    }
    if (typeof thresholds.runtimeHealthAfterScenario.connectionCountMin === "number") {
      checks.push(
        compareNumber(
          scenario,
          "runtimeHealthAfterScenario.connectionCount",
          "runtimeHealthAfterScenario.connectionCount",
          "min",
          thresholds.runtimeHealthAfterScenario.connectionCountMin,
          result.runtimeHealthAfterScenario?.connectionCount
        )
      );
    }
  }

  if (defaults.requireEmptyErrorMessage) {
    checks.push(compareEmptyError(scenario, result.errorMessage));
  }

  return {
    scenario,
    status: checks.some((check) => check.status === "failed") ? "failed" : "passed",
    checks
  };
}

export function buildRuntimeRegressionReport(
  baseline: RuntimeRegressionBaseline,
  artifact: StressArtifact,
  baselinePath: string,
  artifactPath: string
): RuntimeRegressionComparisonReport {
  if (baseline.artifactType !== "stress-runtime-metrics") {
    fail(`Unsupported baseline artifactType: ${baseline.artifactType}`);
  }
  if (!Array.isArray(artifact.results)) {
    fail("Runtime artifact is missing results[].");
  }

  const scenarios = Object.entries(baseline.scenarios).map(([scenario, thresholds]) =>
    compareScenario(scenario, thresholds, baseline.defaults, artifact)
  );
  const allChecks = scenarios.flatMap((scenario) => scenario.checks);
  const failedChecks = allChecks.filter((check) => check.status === "failed");

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: {
      baselineId: baseline.baselineId,
      title: baseline.title,
      path: baselinePath
    },
    artifact: {
      path: artifactPath,
      ...(artifact.generatedAt ? { generatedAt: artifact.generatedAt } : {}),
      ...(artifact.command ? { command: artifact.command } : {}),
      ...(artifact.revision ? { revision: artifact.revision } : {})
    },
    summary: {
      status: failedChecks.length > 0 ? "failed" : "passed",
      totalChecks: allChecks.length,
      passedChecks: allChecks.length - failedChecks.length,
      failedChecks: failedChecks.length,
      failedCheckIds: failedChecks.map((check) => check.id)
    },
    scenarios
  };
}

export function renderRuntimeRegressionSummary(report: RuntimeRegressionComparisonReport): string {
  const lines = [
    `Runtime regression baseline: ${report.summary.status.toUpperCase()}`,
    `Checks: ${report.summary.passedChecks}/${report.summary.totalChecks} passed`
  ];

  for (const scenario of report.scenarios) {
    const scenarioFailures = scenario.checks.filter((check) => check.status === "failed");
    lines.push(
      `${scenario.scenario}: ${scenario.status.toUpperCase()} (${scenario.checks.length - scenarioFailures.length}/${scenario.checks.length})`
    );
    for (const failure of scenarioFailures) {
      lines.push(`- ${failure.message}`);
    }
  }

  return lines.join("\n");
}

function main(): void {
  const args = parseArgs(process.argv);
  const baseline = readJsonFile<RuntimeRegressionBaseline>(args.baselinePath);
  const artifact = readJsonFile<StressArtifact>(args.artifactPath);
  const report = buildRuntimeRegressionReport(baseline, artifact, args.baselinePath, args.artifactPath);

  if (args.outputPath) {
    writeJsonFile(args.outputPath, report);
  }

  console.log(renderRuntimeRegressionSummary(report));
  console.log("RUNTIME_REGRESSION_RESULT_JSON_START");
  console.log(JSON.stringify(report, null, 2));
  console.log("RUNTIME_REGRESSION_RESULT_JSON_END");

  if (report.summary.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
