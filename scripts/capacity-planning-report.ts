import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

type ScenarioName = "world_progression" | "battle_settlement" | "reconnect" | "reconnect_soak";
type ComparisonStatus = "passed" | "failed";

interface ScenarioResult {
  scenario: ScenarioName;
  rooms: number;
  successfulRooms: number;
  failedRooms: number;
  durationMs: number;
  actionsPerSecond: number;
  cpuCoreUtilizationPct: number;
  rssPeakMb: number;
  heapPeakMb: number;
  requestLatencyP50Ms: number;
  requestLatencyP95Ms: number;
  requestLatencyMaxMs: number;
  errorMessage?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface StressArtifact {
  schemaVersion: 1;
  artifactType: "stress-runtime-metrics";
  generatedAt: string;
  command: string;
  revision: GitRevision;
  status: ComparisonStatus;
  results: ScenarioResult[];
}

interface CapacityPlanningArgs {
  roomSteps: number[];
  scenarios: ScenarioName[];
  sampleIntervalMs: number;
  reconnectPauseMs: number;
  maxBattleTurns: number;
  artifactDir: string;
  summaryJsonPath: string;
  summaryMarkdownPath: string;
  stressScriptPath: string;
  latencyHardLimitMs: number;
  instanceMonthlyCostUsd: number;
  peakConcurrencyRatio: number;
  playersPerRoom: number;
}

interface CapacitySampleSummary {
  rooms: number;
  artifactPath: string;
  status: ComparisonStatus;
  scenarioCount: number;
  failedScenarios: number;
  worstScenario: ScenarioName;
  worstLatencyP95Ms: number;
  worstLatencyMaxMs: number;
  peakCpuCoreUtilizationPct: number;
  peakRssMb: number;
  peakHeapMb: number;
  averageActionsPerSecond: number;
  notes: string[];
}

interface CapacityPlanningReport {
  schemaVersion: 1;
  artifactType: "capacity-planning-report";
  generatedAt: string;
  revision?: GitRevision;
  environment: {
    hostname: string;
    cpuCount: number;
    totalMemoryMb: number;
    platform: string;
    release: string;
  };
  assumptions: {
    latencyHardLimitMs: number;
    peakConcurrencyRatio: number;
    playersPerRoom: number;
    instanceMonthlyCostUsd: number;
  };
  samples: CapacitySampleSummary[];
  summary: {
    safeLimitRooms: number;
    alertThresholdRooms: number;
    firstLatencyBreachRooms: number | null;
    scaleOutTriggerRooms: number;
    scaleOutReason: string;
    estimatedPeakRoomsPer1000Dau: number;
    estimatedInstancesPer1000Dau: number;
    estimatedMonthlyCostPer1000DauUsd: number;
  };
}

function fail(message: string): never {
  throw new Error(message);
}

function parseIntegerList(rawValue: string, flagName: string): number[] {
  const values = rawValue
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) {
    fail(`${flagName} must contain at least one positive integer`);
  }

  return values;
}

function parseScenarioList(rawValue: string): ScenarioName[] {
  const scenarios = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as ScenarioName[];
  const knownScenarios = new Set<ScenarioName>(["world_progression", "battle_settlement", "reconnect", "reconnect_soak"]);
  if (scenarios.length === 0 || scenarios.some((scenario) => !knownScenarios.has(scenario))) {
    fail(`--scenarios must be a comma-separated subset of ${Array.from(knownScenarios).join(", ")}`);
  }
  return scenarios;
}

function parseNumber(rawValue: string, flagName: string, minimumExclusive = 0): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= minimumExclusive) {
    fail(`${flagName} must be a number greater than ${minimumExclusive}`);
  }
  return value;
}

function parseArgs(argv: string[]): CapacityPlanningArgs {
  const defaults: CapacityPlanningArgs = {
    roomSteps: [10, 50, 100, 200],
    scenarios: ["world_progression", "reconnect"],
    sampleIntervalMs: 100,
    reconnectPauseMs: 150,
    maxBattleTurns: 24,
    artifactDir: path.resolve("artifacts", "release-readiness", "capacity-planning"),
    summaryJsonPath: path.resolve("artifacts", "release-readiness", "capacity-planning-summary.json"),
    summaryMarkdownPath: path.resolve("artifacts", "release-readiness", "capacity-planning-summary.md"),
    stressScriptPath: path.resolve("scripts", "stress-concurrent-rooms.ts"),
    latencyHardLimitMs: 100,
    instanceMonthlyCostUsd: 48,
    peakConcurrencyRatio: 0.1,
    playersPerRoom: 2
  };

  const args = { ...defaults };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--room-steps" || arg === "--room-steps=") && next) {
      args.roomSteps = parseIntegerList(next, "--room-steps");
      index += 1;
      continue;
    }
    if (arg.startsWith("--room-steps=")) {
      args.roomSteps = parseIntegerList(arg.slice("--room-steps=".length), "--room-steps");
      continue;
    }
    if ((arg === "--scenarios" || arg === "--scenarios=") && next) {
      args.scenarios = parseScenarioList(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--scenarios=")) {
      args.scenarios = parseScenarioList(arg.slice("--scenarios=".length));
      continue;
    }
    if (arg === "--artifact-dir" && next) {
      args.artifactDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--summary-json" && next) {
      args.summaryJsonPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--summary-markdown" && next) {
      args.summaryMarkdownPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--stress-script" && next) {
      args.stressScriptPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--sample-interval-ms" && next) {
      args.sampleIntervalMs = parseNumber(next, "--sample-interval-ms");
      index += 1;
      continue;
    }
    if (arg === "--reconnect-pause-ms" && next) {
      args.reconnectPauseMs = parseNumber(next, "--reconnect-pause-ms");
      index += 1;
      continue;
    }
    if (arg === "--max-battle-turns" && next) {
      args.maxBattleTurns = parseNumber(next, "--max-battle-turns");
      index += 1;
      continue;
    }
    if (arg === "--latency-hard-limit-ms" && next) {
      args.latencyHardLimitMs = parseNumber(next, "--latency-hard-limit-ms");
      index += 1;
      continue;
    }
    if (arg === "--instance-monthly-cost-usd" && next) {
      args.instanceMonthlyCostUsd = parseNumber(next, "--instance-monthly-cost-usd");
      index += 1;
      continue;
    }
    if (arg === "--peak-concurrency-ratio" && next) {
      args.peakConcurrencyRatio = parseNumber(next, "--peak-concurrency-ratio");
      index += 1;
      continue;
    }
    if (arg === "--players-per-room" && next) {
      args.playersPerRoom = parseNumber(next, "--players-per-room");
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return args;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function computeConcurrency(rooms: number): number {
  return Math.max(4, Math.min(48, Math.ceil(rooms / 8)));
}

export function summarizeCapacitySample(artifactPath: string, artifact: StressArtifact, latencyHardLimitMs: number): CapacitySampleSummary {
  const notes: string[] = [];
  const worstLatencyScenario =
    artifact.results.reduce((worst, result) => {
      if (!worst || result.requestLatencyP95Ms > worst.requestLatencyP95Ms) {
        return result;
      }
      return worst;
    }, undefined as ScenarioResult | undefined) ?? artifact.results[0];

  if (!worstLatencyScenario) {
    fail(`Stress artifact ${artifactPath} did not contain any scenario results`);
  }

  const failedScenarios = artifact.results.filter((result) => result.failedRooms > 0);
  if (failedScenarios.length > 0) {
    notes.push(`${failedScenarios.length} scenario(s) reported failed rooms`);
  }
  const roundedWorstLatencyP95Ms = Number(worstLatencyScenario.requestLatencyP95Ms.toFixed(0));
  if (roundedWorstLatencyP95Ms > latencyHardLimitMs) {
    notes.push(`p95 action latency breached ${latencyHardLimitMs}ms`);
  }

  const peakCpuCoreUtilizationPct = Math.max(...artifact.results.map((result) => result.cpuCoreUtilizationPct));
  const peakRssMb = Math.max(...artifact.results.map((result) => result.rssPeakMb));
  const peakHeapMb = Math.max(...artifact.results.map((result) => result.heapPeakMb));
  const averageActionsPerSecond = Number(
    (
      artifact.results.reduce((sum, result) => sum + result.actionsPerSecond, 0) /
      Math.max(1, artifact.results.length)
    ).toFixed(2)
  );

  return {
    rooms: worstLatencyScenario.rooms,
    artifactPath: path.relative(process.cwd(), artifactPath).replace(/\\/g, "/"),
    status: failedScenarios.length > 0 || roundedWorstLatencyP95Ms > latencyHardLimitMs ? "failed" : "passed",
    scenarioCount: artifact.results.length,
    failedScenarios: failedScenarios.length,
    worstScenario: worstLatencyScenario.scenario,
    worstLatencyP95Ms: worstLatencyScenario.requestLatencyP95Ms,
    worstLatencyMaxMs: Math.max(...artifact.results.map((result) => result.requestLatencyMaxMs)),
    peakCpuCoreUtilizationPct,
    peakRssMb,
    peakHeapMb,
    averageActionsPerSecond,
    notes
  };
}

export function buildCapacityPlanningReport(
  samples: CapacitySampleSummary[],
  options: Pick<
    CapacityPlanningArgs,
    "latencyHardLimitMs" | "peakConcurrencyRatio" | "playersPerRoom" | "instanceMonthlyCostUsd"
  >,
  revision?: GitRevision
): CapacityPlanningReport {
  const orderedSamples = [...samples].sort((left, right) => left.rooms - right.rooms);
  const passingSamples = orderedSamples.filter((sample) => sample.status === "passed");
  if (passingSamples.length === 0) {
    fail("Capacity planning needs at least one passing sample");
  }

  const firstLatencyBreach = orderedSamples.find((sample) => sample.status === "failed");
  const safeLimitRooms = firstLatencyBreach
    ? passingSamples.filter((sample) => sample.rooms < firstLatencyBreach.rooms).at(-1)?.rooms ?? passingSamples[0]!.rooms
    : passingSamples.at(-1)!.rooms;
  const alertThresholdRooms = Math.max(1, Math.floor(safeLimitRooms * 0.8));
  const estimatedPeakRoomsPer1000Dau = Math.ceil((1000 * options.peakConcurrencyRatio) / options.playersPerRoom);
  const estimatedInstancesPer1000Dau = Number((estimatedPeakRoomsPer1000Dau / safeLimitRooms).toFixed(2));
  const estimatedMonthlyCostPer1000DauUsd = Number((estimatedInstancesPer1000Dau * options.instanceMonthlyCostUsd).toFixed(2));

  return {
    schemaVersion: 1,
    artifactType: "capacity-planning-report",
    generatedAt: new Date().toISOString(),
    ...(revision ? { revision } : {}),
    environment: {
      hostname: os.hostname(),
      cpuCount: Math.max(1, os.cpus().length),
      totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      platform: os.platform(),
      release: os.release()
    },
    assumptions: {
      latencyHardLimitMs: options.latencyHardLimitMs,
      peakConcurrencyRatio: options.peakConcurrencyRatio,
      playersPerRoom: options.playersPerRoom,
      instanceMonthlyCostUsd: options.instanceMonthlyCostUsd
    },
    samples: orderedSamples,
    summary: {
      safeLimitRooms,
      alertThresholdRooms,
      firstLatencyBreachRooms: firstLatencyBreach?.rooms ?? null,
      scaleOutTriggerRooms: alertThresholdRooms,
      scaleOutReason: `Scale out when a single node sustains ${alertThresholdRooms}+ active rooms because that is 80% of the current ${safeLimitRooms}-room safe limit.`,
      estimatedPeakRoomsPer1000Dau,
      estimatedInstancesPer1000Dau,
      estimatedMonthlyCostPer1000DauUsd
    }
  };
}

export function renderCapacityPlanningMarkdown(report: CapacityPlanningReport): string {
  const lines = [
    "# Project Veil Capacity Planning Summary",
    "",
    `Generated at: ${report.generatedAt}`,
    report.revision ? `Revision: ${report.revision.shortCommit} (${report.revision.branch})` : "",
    "",
    "## Capacity Summary",
    "",
    `- Safe limit per instance: ${report.summary.safeLimitRooms} concurrent rooms`,
    `- Prometheus warning threshold: ${report.summary.alertThresholdRooms} active rooms`,
    `- First sampled latency breach: ${report.summary.firstLatencyBreachRooms ?? "not reached in sampled range"}`,
    `- Scale-out trigger: ${report.summary.scaleOutReason}`,
    `- Estimated peak rooms per 1000 DAU: ${report.summary.estimatedPeakRoomsPer1000Dau}`,
    `- Estimated instance count per 1000 DAU: ${report.summary.estimatedInstancesPer1000Dau}`,
    `- Estimated app-server cost per 1000 DAU: $${report.summary.estimatedMonthlyCostPer1000DauUsd}/month`,
    "",
    "## Sample Results",
    "",
    "| Rooms | Status | Worst Scenario | P95 Latency (ms) | Max Latency (ms) | Peak CPU Core % | Peak RSS MB | Peak Heap MB | Avg Actions/s | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ];

  for (const sample of report.samples) {
    lines.push(
      `| ${sample.rooms} | ${sample.status} | ${sample.worstScenario} | ${sample.worstLatencyP95Ms} | ${sample.worstLatencyMaxMs} | ${sample.peakCpuCoreUtilizationPct} | ${sample.peakRssMb} | ${sample.peakHeapMb} | ${sample.averageActionsPerSecond} | ${sample.notes.join("; ") || "within limit"} |`
    );
  }

  lines.push(
    "",
    "## Assumptions",
    "",
    `- Hard latency limit: p95 action latency must stay <= ${report.assumptions.latencyHardLimitMs} ms.`,
    `- Cost estimate basis: $${report.assumptions.instanceMonthlyCostUsd}/month per server instance.`,
    `- DAU planning basis: peak concurrent users = DAU * ${report.assumptions.peakConcurrencyRatio}, ${report.assumptions.playersPerRoom} players per room.`
  );

  return `${lines.filter(Boolean).join("\n")}\n`;
}

function runStressSample(rooms: number, options: CapacityPlanningArgs): StressArtifact {
  const concurrency = computeConcurrency(rooms);
  const artifactPath = path.join(options.artifactDir, `stress-rooms-${rooms}.json`);
  const command = [
    process.execPath,
    "--import",
    "tsx",
    options.stressScriptPath,
    `--rooms=${rooms}`,
    `--scenarios=${options.scenarios.join(",")}`,
    `--connect-concurrency=${concurrency}`,
    `--action-concurrency=${concurrency}`,
    `--sample-interval-ms=${options.sampleIntervalMs}`,
    `--reconnect-pause-ms=${options.reconnectPauseMs}`,
    `--max-battle-turns=${options.maxBattleTurns}`,
    `--artifact-path=${artifactPath}`
  ];

  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    fail(`Stress sample for ${rooms} rooms failed with exit code ${result.status ?? "unknown"}`);
  }

  return readJsonFile<StressArtifact>(artifactPath);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.artifactDir, { recursive: true });

  const sampleArtifacts = args.roomSteps.map((rooms) => {
    const artifactPath = path.join(args.artifactDir, `stress-rooms-${rooms}.json`);
    const artifact = runStressSample(rooms, args);
    return summarizeCapacitySample(artifactPath, artifact, args.latencyHardLimitMs);
  });
  const revision = readJsonFile<StressArtifact>(path.join(args.artifactDir, `stress-rooms-${args.roomSteps[0]}.json`)).revision;
  const report = buildCapacityPlanningReport(sampleArtifacts, args, revision);

  writeTextFile(args.summaryJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeTextFile(args.summaryMarkdownPath, renderCapacityPlanningMarkdown(report));

  console.log(`Wrote capacity planning report: ${path.relative(process.cwd(), args.summaryJsonPath).replace(/\\/g, "/")}`);
  console.log(`Wrote capacity planning markdown: ${path.relative(process.cwd(), args.summaryMarkdownPath).replace(/\\/g, "/")}`);
}

const isEntrypoint = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isEntrypoint) {
  void main().catch((error) => {
    console.error(`Capacity planning report failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
