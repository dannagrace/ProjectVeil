import fs from "node:fs";
import path from "node:path";

export interface HpaScaleCheckpoint {
  at: string;
  replicas: number;
  activeRooms: number;
  connectedPlayers: number;
  cpuUtilizationPct?: number;
}

export interface HpaScaleDrillReport {
  schemaVersion: 1;
  artifactType: "hpa-scale-drill";
  generatedAt: string;
  summary: {
    status: "passed" | "failed";
    scaledFromReplicas: number;
    scaledToReplicas: number;
    expectedTargetReplicas: number;
    scaleOutLatencySeconds: number | null;
    thresholdActiveRooms: number;
    headline: string;
  };
  peak: {
    activeRooms: number;
    connectedPlayers: number;
    cpuUtilizationPct: number;
  };
  checkpoints: HpaScaleCheckpoint[];
}

interface CliOptions {
  inputPath: string;
  outputDir: string;
  thresholdActiveRooms: number;
  targetReplicas: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  let inputPath = "";
  let outputDir = path.resolve(process.cwd(), "artifacts", "ops");
  let thresholdActiveRooms = 16;
  let targetReplicas = 4;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--input" && next) {
      inputPath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (argument === "--output-dir" && next) {
      outputDir = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (argument === "--threshold-active-rooms" && next) {
      thresholdActiveRooms = parsePositiveInteger(next, "--threshold-active-rooms");
      index += 1;
      continue;
    }
    if (argument === "--target-replicas" && next) {
      targetReplicas = parsePositiveInteger(next, "--target-replicas");
      index += 1;
      continue;
    }
  }

  if (!inputPath) {
    fail("Missing required --input <hpa-checkpoints.json> argument");
  }

  return {
    inputPath,
    outputDir,
    thresholdActiveRooms,
    targetReplicas
  };
}

function normalizeCheckpoints(input: unknown): HpaScaleCheckpoint[] {
  const raw = Array.isArray(input)
    ? input
    : Array.isArray((input as { checkpoints?: unknown[] } | null)?.checkpoints)
      ? ((input as { checkpoints: unknown[] }).checkpoints ?? [])
      : [];

  return raw
    .map((entry) => {
      const record = entry as Partial<HpaScaleCheckpoint>;
      const at = typeof record.at === "string" ? record.at : "";
      const timestamp = new Date(at);
      const replicas = Math.max(0, Math.floor(record.replicas ?? 0));
      const activeRooms = Math.max(0, Math.floor(record.activeRooms ?? 0));
      const connectedPlayers = Math.max(0, Math.floor(record.connectedPlayers ?? 0));
      if (!at || Number.isNaN(timestamp.getTime()) || replicas <= 0) {
        return null;
      }
      return {
        at: timestamp.toISOString(),
        replicas,
        activeRooms,
        connectedPlayers,
        ...(Number.isFinite(record.cpuUtilizationPct) ? { cpuUtilizationPct: Number(record.cpuUtilizationPct) } : {})
      } satisfies HpaScaleCheckpoint;
    })
    .filter((entry): entry is HpaScaleCheckpoint => Boolean(entry))
    .sort((left, right) => left.at.localeCompare(right.at));
}

export function buildHpaScaleDrillReport(
  checkpoints: HpaScaleCheckpoint[],
  options: Pick<CliOptions, "thresholdActiveRooms" | "targetReplicas">
): HpaScaleDrillReport {
  if (checkpoints.length === 0) {
    fail("At least one HPA checkpoint is required");
  }

  const thresholdCheckpoint = checkpoints.find((entry) => entry.activeRooms >= options.thresholdActiveRooms) ?? null;
  const targetCheckpoint = checkpoints.find((entry) => entry.replicas >= options.targetReplicas) ?? null;
  const firstCheckpoint = checkpoints[0]!;
  const peak = checkpoints.reduce(
    (current, checkpoint) => ({
      activeRooms: Math.max(current.activeRooms, checkpoint.activeRooms),
      connectedPlayers: Math.max(current.connectedPlayers, checkpoint.connectedPlayers),
      cpuUtilizationPct: Math.max(current.cpuUtilizationPct, checkpoint.cpuUtilizationPct ?? 0)
    }),
    { activeRooms: 0, connectedPlayers: 0, cpuUtilizationPct: 0 }
  );

  const scaleOutLatencySeconds =
    thresholdCheckpoint && targetCheckpoint
      ? Math.max(0, Math.round((new Date(targetCheckpoint.at).getTime() - new Date(thresholdCheckpoint.at).getTime()) / 1000))
      : null;
  const status =
    thresholdCheckpoint && targetCheckpoint && targetCheckpoint.replicas >= options.targetReplicas ? "passed" : "failed";

  return {
    schemaVersion: 1,
    artifactType: "hpa-scale-drill",
    generatedAt: new Date().toISOString(),
    summary: {
      status,
      scaledFromReplicas: firstCheckpoint.replicas,
      scaledToReplicas: targetCheckpoint?.replicas ?? checkpoints[checkpoints.length - 1]!.replicas,
      expectedTargetReplicas: options.targetReplicas,
      scaleOutLatencySeconds,
      thresholdActiveRooms: options.thresholdActiveRooms,
      headline:
        status === "passed"
          ? `HPA 在 ${scaleOutLatencySeconds ?? 0} 秒内从 ${firstCheckpoint.replicas} 扩到 ${targetCheckpoint?.replicas ?? options.targetReplicas} 副本。`
          : `HPA 未在目标窗口内扩到 ${options.targetReplicas} 副本，需复查 autoscaling 配置或观测链路。`
    },
    peak,
    checkpoints
  };
}

export function renderHpaScaleDrillMarkdown(report: HpaScaleDrillReport): string {
  const lines = [
    "# Capacity Scale Drill",
    "",
    `Overall status: \`${report.summary.status}\``,
    "",
    `- Threshold active rooms: \`${report.summary.thresholdActiveRooms}\``,
    `- Scale result: \`${report.summary.scaledFromReplicas} -> ${report.summary.scaledToReplicas}\` (target \`${report.summary.expectedTargetReplicas}\`)`,
    `- Scale-out latency: \`${report.summary.scaleOutLatencySeconds ?? "n/a"}s\``,
    `- Peak active rooms: \`${report.peak.activeRooms}\``,
    `- Peak connected players: \`${report.peak.connectedPlayers}\``,
    `- Peak CPU utilization: \`${report.peak.cpuUtilizationPct.toFixed(1)}%\``,
    "",
    report.summary.headline,
    "",
    "## Checkpoints",
    "",
    "| At | Replicas | Active rooms | Connected players | CPU |",
    "| --- | ---: | ---: | ---: | ---: |"
  ];

  for (const checkpoint of report.checkpoints) {
    lines.push(
      `| ${checkpoint.at} | ${checkpoint.replicas} | ${checkpoint.activeRooms} | ${checkpoint.connectedPlayers} | ${(checkpoint.cpuUtilizationPct ?? 0).toFixed(1)}% |`
    );
  }

  return lines.join("\n");
}

export function runHpaScaleDrill(options: CliOptions): {
  report: HpaScaleDrillReport;
  jsonPath: string;
  markdownPath: string;
} {
  const checkpoints = normalizeCheckpoints(JSON.parse(fs.readFileSync(options.inputPath, "utf8")));
  const report = buildHpaScaleDrillReport(checkpoints, options);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = path.join(options.outputDir, "hpa-scale-drill.json");
  const markdownPath = path.join(options.outputDir, "hpa-scale-drill.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(markdownPath, renderHpaScaleDrillMarkdown(report));
  return { report, jsonPath, markdownPath };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const result = runHpaScaleDrill(parseArgs(process.argv.slice(2)));
  console.log(`Wrote HPA scale drill JSON: ${result.jsonPath}`);
  console.log(`Wrote HPA scale drill markdown: ${result.markdownPath}`);
}
