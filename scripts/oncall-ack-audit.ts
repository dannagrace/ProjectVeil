import fs from "node:fs";
import path from "node:path";

interface Args {
  inputPath: string;
  outputPath?: string;
  markdownOutputPath?: string;
}

interface IncidentRecord {
  id: string;
  service: string;
  severity: string;
  owner: string;
  openedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

interface IncidentAuditInput {
  incidents: IncidentRecord[];
}

interface AckAuditReport {
  schemaVersion: 1;
  generatedAt: string;
  totals: {
    incidentCount: number;
    acknowledgedCount: number;
    resolvedCount: number;
  };
  timing: {
    medianAckMinutes: number | null;
    medianResolveMinutes: number | null;
    averageAckMinutes: number | null;
    averageResolveMinutes: number | null;
  };
  byOwner: Array<{
    owner: string;
    incidentCount: number;
    acknowledgedCount: number;
    resolvedCount: number;
  }>;
  breaches: Array<{
    incidentId: string;
    owner: string;
    reason: string;
  }>;
}

function parseArgs(argv: string[]): Args {
  let inputPath = "";
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--input" && next) {
      inputPath = next;
      index += 1;
      continue;
    }
    if (current === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (current === "--markdown-output" && next) {
      markdownOutputPath = next;
      index += 1;
      continue;
    }
    if (current === "--help") {
      console.log("Usage: tsx scripts/oncall-ack-audit.ts --input incidents.json [--output report.json] [--markdown-output report.md]");
      process.exit(0);
    }
    throw new Error(`Unknown or incomplete argument: ${current}`);
  }

  if (!inputPath) {
    throw new Error("Pass --input <path>.");
  }

  return { inputPath, outputPath, markdownOutputPath };
}

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath: string): IncidentAuditInput {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as IncidentAuditInput;
}

function minutesBetween(start: string, end: string | undefined): number | null {
  if (!end) {
    return null;
  }
  const diffMs = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(diffMs)) {
    return null;
  }
  return Math.max(0, Number((diffMs / 60_000).toFixed(2)));
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  return Number((((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2).toFixed(2));
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function buildAckAuditReport(input: IncidentAuditInput, generatedAt = new Date().toISOString()): AckAuditReport {
  const ackDurations = input.incidents.map((incident) => minutesBetween(incident.openedAt, incident.acknowledgedAt)).filter((value): value is number => value !== null);
  const resolveDurations = input.incidents
    .map((incident) => minutesBetween(incident.openedAt, incident.resolvedAt))
    .filter((value): value is number => value !== null);

  const ownerMap = new Map<string, { incidentCount: number; acknowledgedCount: number; resolvedCount: number }>();
  const breaches: AckAuditReport["breaches"] = [];

  for (const incident of input.incidents) {
    const current = ownerMap.get(incident.owner) ?? { incidentCount: 0, acknowledgedCount: 0, resolvedCount: 0 };
    current.incidentCount += 1;
    if (incident.acknowledgedAt) current.acknowledgedCount += 1;
    if (incident.resolvedAt) current.resolvedCount += 1;
    ownerMap.set(incident.owner, current);

    const ackMinutes = minutesBetween(incident.openedAt, incident.acknowledgedAt);
    const resolveMinutes = minutesBetween(incident.openedAt, incident.resolvedAt);
    if (ackMinutes === null) {
      breaches.push({ incidentId: incident.id, owner: incident.owner, reason: "missing_acknowledgement" });
    } else if (ackMinutes > 10) {
      breaches.push({ incidentId: incident.id, owner: incident.owner, reason: "ack_over_10m" });
    }
    if (resolveMinutes !== null && resolveMinutes > 60) {
      breaches.push({ incidentId: incident.id, owner: incident.owner, reason: "resolve_over_60m" });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt,
    totals: {
      incidentCount: input.incidents.length,
      acknowledgedCount: input.incidents.filter((incident) => incident.acknowledgedAt).length,
      resolvedCount: input.incidents.filter((incident) => incident.resolvedAt).length
    },
    timing: {
      medianAckMinutes: median(ackDurations),
      medianResolveMinutes: median(resolveDurations),
      averageAckMinutes: average(ackDurations),
      averageResolveMinutes: average(resolveDurations)
    },
    byOwner: [...ownerMap.entries()]
      .map(([owner, summary]) => ({
        owner,
        incidentCount: summary.incidentCount,
        acknowledgedCount: summary.acknowledgedCount,
        resolvedCount: summary.resolvedCount
      }))
      .sort((left, right) => left.owner.localeCompare(right.owner)),
    breaches
  };
}

export function renderAckAuditMarkdown(report: AckAuditReport): string {
  const lines = [
    "# On-call Ack Audit",
    "",
    `Generated at: \`${report.generatedAt}\``,
    "",
    `Incidents: ${report.totals.incidentCount}`,
    `Acknowledged: ${report.totals.acknowledgedCount}`,
    `Resolved: ${report.totals.resolvedCount}`,
    `Median MTTA: ${report.timing.medianAckMinutes ?? "n/a"} min`,
    `Median MTTR: ${report.timing.medianResolveMinutes ?? "n/a"} min`,
    "",
    "## Owners",
    "",
    "| Owner | Incidents | Acked | Resolved |",
    "| --- | ---: | ---: | ---: |",
    ...report.byOwner.map(
      (entry) => `| \`${entry.owner}\` | ${entry.incidentCount} | ${entry.acknowledgedCount} | ${entry.resolvedCount} |`
    ),
    "",
    "## Breaches",
    ""
  ];

  if (report.breaches.length === 0) {
    lines.push("No MTTA / MTTR breaches.");
  } else {
    lines.push("| Incident | Owner | Reason |", "| --- | --- | --- |");
    for (const breach of report.breaches) {
      lines.push(`| \`${breach.incidentId}\` | \`${breach.owner}\` | \`${breach.reason}\` |`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function main(): void {
  const args = parseArgs(process.argv);
  const report = buildAckAuditReport(readJson(path.resolve(args.inputPath)));
  const outputPath = path.resolve(args.outputPath ?? path.join("artifacts", "ops", "oncall-ack-audit.json"));
  const markdownOutputPath = path.resolve(args.markdownOutputPath ?? outputPath.replace(/\.json$/i, ".md"));
  ensureDirectory(outputPath);
  ensureDirectory(markdownOutputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownOutputPath, renderAckAuditMarkdown(report), "utf8");
  console.log(`Wrote on-call ack audit JSON: ${path.relative(process.cwd(), outputPath)}`);
  console.log(`Wrote on-call ack audit Markdown: ${path.relative(process.cwd(), markdownOutputPath)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
