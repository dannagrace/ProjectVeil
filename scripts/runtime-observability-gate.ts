import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildRuntimeObservabilityEvidenceReport,
  commitsMatch,
  getRevision,
  type EndpointStatus,
  type EvidenceFreshness,
  type RuntimeObservabilityEvidenceReport,
  type TargetSurface,
  readRuntimeObservabilityEvidenceReport
} from "./runtime-observability-evidence.ts";

export type GateStatus = "passed" | "failed";

interface Args {
  candidate?: string;
  candidateRevision?: string;
  serverUrl?: string;
  targetSurface: TargetSurface;
  targetEnvironment?: string;
  captureReportPath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  maxSampleAgeMinutes: number;
}

export interface RuntimeObservabilityEndpointReport {
  id: "runtime-health" | "auth-readiness" | "runtime-metrics";
  label: string;
  url: string;
  status: EndpointStatus;
  httpStatus?: number;
  summary: string;
  observedAt?: string;
  freshness: EvidenceFreshness;
  details: string[];
  keyReadinessFields: Record<string, number | string | boolean | null>;
}

export interface RuntimeObservabilityGateReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: RuntimeObservabilityEvidenceReport["candidate"];
  targetEnvironment: RuntimeObservabilityEvidenceReport["targetEnvironment"];
  summary: {
    status: GateStatus;
    headline: string;
    endpointStatuses: Record<RuntimeObservabilityEndpointReport["id"], EndpointStatus>;
  };
  readiness: RuntimeObservabilityEvidenceReport["readiness"];
  evidenceSource?: {
    artifactPath: string;
    generatedAt?: string;
  };
  endpoints: RuntimeObservabilityEndpointReport[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let serverUrl: string | undefined;
  let targetSurface: TargetSurface = "wechat";
  let targetEnvironment: string | undefined;
  let captureReportPath: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let maxSampleAgeMinutes = 30;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--candidate" && next) {
      candidate = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--candidate-revision" && next) {
      candidateRevision = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--server-url" && next) {
      serverUrl = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--target-surface" && next) {
      if (next !== "h5" && next !== "wechat") {
        fail(`Unsupported --target-surface value: ${next}`);
      }
      targetSurface = next;
      index += 1;
      continue;
    }
    if (arg === "--target-environment" && next) {
      targetEnvironment = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--capture-report" && next) {
      captureReportPath = path.resolve(next);
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
    if (arg === "--max-sample-age-minutes" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`Invalid --max-sample-age-minutes value: ${next}`);
      }
      maxSampleAgeMinutes = parsed;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!captureReportPath && !serverUrl?.trim()) {
    fail("Missing required runtime evidence input. Pass --server-url <base-url> or --capture-report <path>.");
  }

  return {
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    ...(serverUrl ? { serverUrl } : {}),
    targetSurface,
    ...(targetEnvironment ? { targetEnvironment } : {}),
    ...(captureReportPath ? { captureReportPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    maxSampleAgeMinutes
  };
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "candidate";
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeFile(filePath: string, content: string): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function getDefaultOutputPaths(args: Args, shortRevision: string): { jsonPath: string; markdownPath: string } {
  const candidateName = args.candidate?.trim() || shortRevision;
  const baseName = `runtime-observability-gate-${slugify(candidateName)}-${shortRevision}`;
  return {
    jsonPath: path.resolve(args.outputPath ?? path.join(DEFAULT_RELEASE_READINESS_DIR, `${baseName}.json`)),
    markdownPath: path.resolve(args.markdownOutputPath ?? path.join(DEFAULT_RELEASE_READINESS_DIR, `${baseName}.md`))
  };
}

async function loadEvidence(args: Args): Promise<{ report: RuntimeObservabilityEvidenceReport; artifactPath?: string }> {
  if (args.captureReportPath) {
    return {
      report: readRuntimeObservabilityEvidenceReport(args.captureReportPath),
      artifactPath: args.captureReportPath
    };
  }
  return {
    report: await buildRuntimeObservabilityEvidenceReport({
      candidate: args.candidate,
      candidateRevision: args.candidateRevision,
      serverUrl: args.serverUrl!,
      targetSurface: args.targetSurface,
      targetEnvironment: args.targetEnvironment,
      maxSampleAgeMinutes: args.maxSampleAgeMinutes
    })
  };
}

function validateEvidence(args: Args, evidence: RuntimeObservabilityEvidenceReport): void {
  if (args.candidate?.trim() && evidence.candidate.name !== args.candidate.trim()) {
    fail(`Capture report candidate mismatch: expected ${args.candidate.trim()}, received ${evidence.candidate.name}.`);
  }
  if (args.candidateRevision?.trim() && !commitsMatch(evidence.candidate.revision, args.candidateRevision)) {
    fail(`Capture report revision mismatch: expected ${args.candidateRevision}, received ${evidence.candidate.revision}.`);
  }
  if (evidence.candidate.targetSurface !== args.targetSurface) {
    fail(`Capture report target surface mismatch: expected ${args.targetSurface}, received ${evidence.candidate.targetSurface}.`);
  }
  if (args.serverUrl?.trim() && evidence.targetEnvironment.serverUrl !== args.serverUrl.replace(/\/$/, "")) {
    fail(`Capture report server URL mismatch: expected ${args.serverUrl.replace(/\/$/, "")}, received ${evidence.targetEnvironment.serverUrl}.`);
  }
  if (args.targetEnvironment?.trim() && evidence.targetEnvironment.label !== args.targetEnvironment.trim()) {
    fail(`Capture report target environment mismatch: expected ${args.targetEnvironment.trim()}, received ${evidence.targetEnvironment.label ?? "<missing>"}.`);
  }
}

export async function buildRuntimeObservabilityGateReport(args: Args): Promise<RuntimeObservabilityGateReport> {
  const { report: evidence, artifactPath } = await loadEvidence(args);
  validateEvidence(args, evidence);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: evidence.candidate,
    targetEnvironment: evidence.targetEnvironment,
    summary: {
      status: evidence.summary.status,
      headline:
        evidence.summary.status === "passed"
          ? "Runtime health, auth readiness, and metrics passed for the target environment."
          : `Runtime observability gate failed for ${evidence.endpoints.filter((entry) => entry.status !== "passed").map((entry) => entry.label).join(", ")}.`,
      endpointStatuses: evidence.summary.endpointStatuses
    },
    readiness: evidence.readiness,
    ...(artifactPath
      ? {
          evidenceSource: {
            artifactPath: toRelativePath(artifactPath),
            generatedAt: evidence.generatedAt
          }
        }
      : {}),
    endpoints: evidence.endpoints.map(({ capture: _capture, ...endpoint }) => endpoint)
  };
}

export function renderMarkdown(report: RuntimeObservabilityGateReport): string {
  const lines: string[] = [];
  lines.push("# Runtime Observability Gate", "");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Revision: \`${report.candidate.revision}\``);
  lines.push(`- Branch: \`${report.candidate.branch}\``);
  lines.push(`- Git tree: \`${report.candidate.dirty ? "dirty" : "clean"}\``);
  lines.push(`- Target surface: \`${report.candidate.targetSurface}\``);
  lines.push(`- Target environment: \`${report.targetEnvironment.label ?? report.targetEnvironment.serverUrl}\``);
  lines.push(`- Target base URL: \`${report.targetEnvironment.serverUrl}\``);
  if (report.evidenceSource) {
    lines.push(`- Runtime observability evidence: \`${report.evidenceSource.artifactPath}\``);
    if (report.evidenceSource.generatedAt) {
      lines.push(`- Evidence captured at: \`${report.evidenceSource.generatedAt}\``);
    }
  }
  lines.push(`- Overall status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Headline: ${report.summary.headline}`, "");

  lines.push("## Readiness Snapshot", "");
  lines.push(`- Active rooms: ${report.readiness.activeRoomCount ?? "<missing>"}`);
  lines.push(`- Connections: ${report.readiness.connectionCount ?? "<missing>"}`);
  lines.push(`- Active battles: ${report.readiness.activeBattleCount ?? "<missing>"}`);
  lines.push(`- Heroes: ${report.readiness.heroCount ?? "<missing>"}`);
  lines.push(`- Gameplay actions: ${report.readiness.actionMessagesTotal ?? "<missing>"}`);
  lines.push(`- Guest sessions: ${report.readiness.activeGuestSessionCount ?? "<missing>"}`);
  lines.push(`- Account sessions: ${report.readiness.activeAccountSessionCount ?? "<missing>"}`);
  lines.push(`- Account lockouts: ${report.readiness.activeAccountLockCount ?? "<missing>"}`);
  lines.push(`- Pending registrations: ${report.readiness.pendingRegistrationCount ?? "<missing>"}`);
  lines.push(`- Pending recoveries: ${report.readiness.pendingRecoveryCount ?? "<missing>"}`);
  lines.push(`- Token delivery queue: ${report.readiness.tokenDeliveryQueueCount ?? "<missing>"}`);
  lines.push(`- Token delivery dead letters: ${report.readiness.tokenDeliveryDeadLetterCount ?? "<missing>"}`);
  lines.push(`- WeChat login mode: ${report.readiness.wechatLoginMode ?? "<missing>"}`);
  lines.push(`- WeChat credentials: ${report.readiness.wechatCredentialsStatus ?? "<missing>"}`);
  lines.push(`- Auth headline: ${report.readiness.authHeadline ?? "<missing>"}`, "");

  lines.push("## Endpoint Results", "");
  for (const endpoint of report.endpoints) {
    lines.push(`### ${endpoint.label}`, "");
    lines.push(`- Status: \`${endpoint.status}\``);
    lines.push(`- URL: \`${endpoint.url}\``);
    if (endpoint.httpStatus !== undefined) {
      lines.push(`- HTTP status: \`${endpoint.httpStatus}\``);
    }
    lines.push(`- Summary: ${endpoint.summary}`);
    lines.push(`- Freshness: \`${endpoint.freshness}\``);
    if (endpoint.observedAt) {
      lines.push(`- Observed at: \`${endpoint.observedAt}\``);
    }
    if (endpoint.details.length > 0) {
      lines.push("- Details:");
      for (const detail of endpoint.details) {
        lines.push(`  - ${detail}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const revision = args.captureReportPath
    ? readRuntimeObservabilityEvidenceReport(args.captureReportPath).candidate.shortRevision
    : getRevision(args.candidateRevision).shortCommit;
  const outputPaths = getDefaultOutputPaths(args, revision);
  const report = await buildRuntimeObservabilityGateReport(args);
  writeJsonFile(outputPaths.jsonPath, report);
  writeFile(outputPaths.markdownPath, renderMarkdown(report));

  console.log(`Wrote runtime observability gate JSON: ${toRelativePath(outputPaths.jsonPath)}`);
  console.log(`Wrote runtime observability gate Markdown: ${toRelativePath(outputPaths.markdownPath)}`);
  console.log(`Candidate: ${report.candidate.name}`);
  console.log(`Revision: ${report.candidate.revision}`);
  console.log(`Overall status: ${report.summary.status}`);

  if (report.summary.status !== "passed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
    .then(() => {
      process.exit(process.exitCode ?? 0);
    })
    .catch((error) => {
      console.error(`Runtime observability gate failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
