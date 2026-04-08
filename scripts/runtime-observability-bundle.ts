import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildRuntimeObservabilityEvidenceReport,
  evaluateFreshness,
  getRevision,
  renderMarkdown as renderEvidenceMarkdown,
  type EvidenceFreshness,
  type RuntimeObservabilityEvidenceReport,
  type TargetSurface
} from "./runtime-observability-evidence.ts";
import {
  buildRuntimeObservabilityGateReport,
  renderMarkdown as renderGateMarkdown,
  type RuntimeObservabilityGateReport
} from "./runtime-observability-gate.ts";

type BundleStatus = "passed" | "failed";
type RoomLifecycleStatus = "captured" | "warn" | "failed" | "skipped";

interface Args {
  candidate?: string;
  candidateRevision?: string;
  serverUrl: string;
  targetSurface: TargetSurface;
  targetEnvironment?: string;
  outputDir?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  includeRoomLifecycle: boolean;
  maxSampleAgeMinutes: number;
}

interface RoomLifecyclePayload {
  status?: "ok" | "warn";
  checkedAt?: string;
  service?: string;
  headline?: string;
  alerts?: string[];
  summary?: {
    activeRoomCount?: number;
    pendingReconnectCount?: number;
    counters?: {
      roomCreatesTotal?: number;
      roomDisposalsTotal?: number;
      battleCompletionsTotal?: number;
      battleAbortsTotal?: number;
    };
    recentEvents?: Array<{
      timestamp?: string;
      kind?: string;
      roomId?: string;
      playerId?: string;
      battleId?: string;
      reason?: string;
    }>;
  };
}

interface RoomLifecycleCapture {
  requested: boolean;
  status: RoomLifecycleStatus;
  url: string;
  summary: string;
  freshness: EvidenceFreshness;
  observedAt?: string;
  httpStatus?: number;
  details: string[];
  keyReadinessFields: Record<string, number | string | boolean | null>;
  capture?: {
    kind: "json";
    body: unknown;
  };
}

interface BundleArtifactRef {
  path: string;
  markdownPath: string;
}

export interface RuntimeObservabilityBundleReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: RuntimeObservabilityEvidenceReport["candidate"];
  targetEnvironment: RuntimeObservabilityEvidenceReport["targetEnvironment"];
  summary: {
    status: BundleStatus;
    headline: string;
    evidenceStatus: RuntimeObservabilityEvidenceReport["summary"]["status"];
    gateStatus: RuntimeObservabilityGateReport["summary"]["status"];
    roomLifecycleStatus: RoomLifecycleStatus;
  };
  artifacts: {
    bundle: BundleArtifactRef;
    evidence: BundleArtifactRef;
    gate: BundleArtifactRef;
  };
  captureOptions: {
    includeRoomLifecycle: boolean;
    maxSampleAgeMinutes: number;
  };
  readiness: RuntimeObservabilityEvidenceReport["readiness"];
  evidence: RuntimeObservabilityEvidenceReport;
  gate: RuntimeObservabilityGateReport;
  roomLifecycle: RoomLifecycleCapture;
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
  let outputDir: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let includeRoomLifecycle = false;
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
    if (arg === "--output-dir" && next) {
      outputDir = next;
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
    if (arg === "--include-room-lifecycle") {
      includeRoomLifecycle = true;
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

  if (!serverUrl?.trim()) {
    fail("Missing required --server-url <base-url>.");
  }

  return {
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    serverUrl,
    targetSurface,
    ...(targetEnvironment ? { targetEnvironment } : {}),
    ...(outputDir ? { outputDir } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    includeRoomLifecycle,
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

function getOutputPaths(args: Args): {
  bundleJsonPath: string;
  bundleMarkdownPath: string;
  evidenceJsonPath: string;
  evidenceMarkdownPath: string;
  gateJsonPath: string;
  gateMarkdownPath: string;
} {
  const revision = getRevision(args.candidateRevision);
  const candidateName = args.candidate?.trim() || revision.shortCommit;
  const candidateSlug = slugify(candidateName);
  const defaultOutputDir = path.resolve(
    args.outputDir ??
      path.join(DEFAULT_RELEASE_READINESS_DIR, `runtime-observability-bundle-${candidateSlug}-${revision.shortCommit}`)
  );
  const bundleJsonPath = path.resolve(args.outputPath ?? path.join(defaultOutputDir, "runtime-observability-bundle.json"));
  const bundleMarkdownPath = path.resolve(
    args.markdownOutputPath ?? path.join(defaultOutputDir, "runtime-observability-bundle.md")
  );

  return {
    bundleJsonPath,
    bundleMarkdownPath,
    evidenceJsonPath: path.join(defaultOutputDir, `runtime-observability-evidence-${candidateSlug}-${revision.shortCommit}.json`),
    evidenceMarkdownPath: path.join(defaultOutputDir, `runtime-observability-evidence-${candidateSlug}-${revision.shortCommit}.md`),
    gateJsonPath: path.join(defaultOutputDir, `runtime-observability-gate-${candidateSlug}-${revision.shortCommit}.json`),
    gateMarkdownPath: path.join(defaultOutputDir, `runtime-observability-gate-${candidateSlug}-${revision.shortCommit}.md`)
  };
}

async function fetchJsonPayload<T>(url: string): Promise<{ response: Response; payload: T }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return {
    response,
    payload: (await response.json()) as T
  };
}

async function captureRoomLifecycle(args: Args): Promise<RoomLifecycleCapture> {
  const serverUrl = args.serverUrl.replace(/\/$/, "");
  const url = `${serverUrl}/api/runtime/room-lifecycle-summary`;
  if (!args.includeRoomLifecycle) {
    return {
      requested: false,
      status: "skipped",
      url,
      summary: "Room lifecycle evidence capture was not requested.",
      freshness: "missing_timestamp",
      details: [],
      keyReadinessFields: {}
    };
  }

  try {
    const { response, payload } = await fetchJsonPayload<RoomLifecyclePayload>(url);
    const freshness = evaluateFreshness(payload.checkedAt, args.maxSampleAgeMinutes * 60 * 1_000);
    const hasAlerts = (payload.alerts?.length ?? 0) > 0;
    const status: RoomLifecycleStatus =
      payload.status === "ok" && !hasAlerts && freshness === "fresh"
        ? "captured"
        : payload.status === "warn" || hasAlerts || freshness !== "fresh"
          ? "warn"
          : "failed";
    const details = [
      payload.headline?.trim() || `status=${payload.status ?? "missing"}`,
      `activeRooms=${payload.summary?.activeRoomCount ?? 0}`,
      `pendingReconnects=${payload.summary?.pendingReconnectCount ?? 0}`,
      `roomCreates=${payload.summary?.counters?.roomCreatesTotal ?? 0}`,
      `roomDisposals=${payload.summary?.counters?.roomDisposalsTotal ?? 0}`,
      `battleCompletions=${payload.summary?.counters?.battleCompletionsTotal ?? 0}`,
      `battleAborts=${payload.summary?.counters?.battleAbortsTotal ?? 0}`,
      `recentEvents=${payload.summary?.recentEvents?.length ?? 0}`
    ];
    for (const alert of payload.alerts ?? []) {
      details.push(`alert=${alert}`);
    }
    if (freshness !== "fresh") {
      details.push(`room lifecycle sample freshness is ${freshness}`);
    }

    return {
      requested: true,
      status,
      url,
      summary:
        status === "captured"
          ? payload.headline?.trim() || "Room lifecycle evidence captured."
          : payload.headline?.trim() || "Room lifecycle evidence reported warnings.",
      freshness,
      observedAt: payload.checkedAt,
      httpStatus: response.status,
      details,
      keyReadinessFields: {
        activeRoomCount: payload.summary?.activeRoomCount ?? null,
        pendingReconnectCount: payload.summary?.pendingReconnectCount ?? null,
        roomCreatesTotal: payload.summary?.counters?.roomCreatesTotal ?? null,
        roomDisposalsTotal: payload.summary?.counters?.roomDisposalsTotal ?? null,
        battleCompletionsTotal: payload.summary?.counters?.battleCompletionsTotal ?? null,
        battleAbortsTotal: payload.summary?.counters?.battleAbortsTotal ?? null,
        recentEventCount: payload.summary?.recentEvents?.length ?? null
      },
      capture: {
        kind: "json",
        body: payload
      }
    };
  } catch (error) {
    return {
      requested: true,
      status: "failed",
      url,
      summary: "Room lifecycle evidence capture failed.",
      freshness: "missing_timestamp",
      details: [error instanceof Error ? error.message : String(error)],
      keyReadinessFields: {},
      capture: {
        kind: "json",
        body: {
          error: error instanceof Error ? error.message : String(error)
        }
      }
    };
  }
}

export async function buildRuntimeObservabilityBundleReport(args: Args): Promise<RuntimeObservabilityBundleReport> {
  const outputPaths = getOutputPaths(args);
  const evidence = await buildRuntimeObservabilityEvidenceReport({
    candidate: args.candidate,
    candidateRevision: args.candidateRevision,
    serverUrl: args.serverUrl,
    targetSurface: args.targetSurface,
    targetEnvironment: args.targetEnvironment,
    outputPath: outputPaths.evidenceJsonPath,
    markdownOutputPath: outputPaths.evidenceMarkdownPath,
    maxSampleAgeMinutes: args.maxSampleAgeMinutes
  });
  writeJsonFile(outputPaths.evidenceJsonPath, evidence);
  writeFile(outputPaths.evidenceMarkdownPath, renderEvidenceMarkdown(evidence));

  const gate = await buildRuntimeObservabilityGateReport({
    candidate: args.candidate,
    candidateRevision: args.candidateRevision,
    targetSurface: args.targetSurface,
    targetEnvironment: args.targetEnvironment,
    captureReportPath: outputPaths.evidenceJsonPath,
    maxSampleAgeMinutes: args.maxSampleAgeMinutes
  });
  writeJsonFile(outputPaths.gateJsonPath, gate);
  writeFile(outputPaths.gateMarkdownPath, renderGateMarkdown(gate));

  const roomLifecycle = await captureRoomLifecycle(args);
  const summaryStatus: BundleStatus =
    gate.summary.status === "passed" && (!roomLifecycle.requested || roomLifecycle.status !== "failed") ? "passed" : "failed";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: evidence.candidate,
    targetEnvironment: evidence.targetEnvironment,
    summary: {
      status: summaryStatus,
      headline:
        summaryStatus === "passed"
          ? "Runtime observability bundle is ready for candidate review."
          : `Runtime observability bundle is blocked by ${gate.summary.status !== "passed" ? "core runtime gate failures" : "room lifecycle capture failure"}.`,
      evidenceStatus: evidence.summary.status,
      gateStatus: gate.summary.status,
      roomLifecycleStatus: roomLifecycle.status
    },
    artifacts: {
      bundle: {
        path: toRelativePath(outputPaths.bundleJsonPath),
        markdownPath: toRelativePath(outputPaths.bundleMarkdownPath)
      },
      evidence: {
        path: toRelativePath(outputPaths.evidenceJsonPath),
        markdownPath: toRelativePath(outputPaths.evidenceMarkdownPath)
      },
      gate: {
        path: toRelativePath(outputPaths.gateJsonPath),
        markdownPath: toRelativePath(outputPaths.gateMarkdownPath)
      }
    },
    captureOptions: {
      includeRoomLifecycle: args.includeRoomLifecycle,
      maxSampleAgeMinutes: args.maxSampleAgeMinutes
    },
    readiness: evidence.readiness,
    evidence,
    gate,
    roomLifecycle
  };
}

export function renderMarkdown(report: RuntimeObservabilityBundleReport): string {
  const lines: string[] = [];
  lines.push("# Runtime Observability Bundle", "");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Revision: \`${report.candidate.revision}\``);
  lines.push(`- Branch: \`${report.candidate.branch}\``);
  lines.push(`- Git tree: \`${report.candidate.dirty ? "dirty" : "clean"}\``);
  lines.push(`- Target surface: \`${report.candidate.targetSurface}\``);
  lines.push(`- Target environment: \`${report.targetEnvironment.label ?? report.targetEnvironment.serverUrl}\``);
  lines.push(`- Target base URL: \`${report.targetEnvironment.serverUrl}\``);
  lines.push(`- Bundle status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Headline: ${report.summary.headline}`);
  lines.push(`- Runtime evidence artifact: \`${report.artifacts.evidence.path}\``);
  lines.push(`- Runtime gate artifact: \`${report.artifacts.gate.path}\``);
  lines.push("");

  lines.push("## Verdicts", "");
  lines.push(`- Runtime evidence: \`${report.summary.evidenceStatus}\``);
  lines.push(`- Runtime gate: \`${report.summary.gateStatus}\``);
  lines.push(`- Room lifecycle: \`${report.summary.roomLifecycleStatus}\``);
  lines.push("");

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
  lines.push("");

  lines.push("## Core Endpoints", "");
  for (const endpoint of report.gate.endpoints) {
    lines.push(`- ${endpoint.label}: \`${endpoint.status}\` (${endpoint.summary})`);
  }
  lines.push("");

  lines.push("## Room Lifecycle", "");
  lines.push(`- Requested: \`${report.roomLifecycle.requested ? "yes" : "no"}\``);
  lines.push(`- Status: \`${report.roomLifecycle.status}\``);
  lines.push(`- Summary: ${report.roomLifecycle.summary}`);
  if (report.roomLifecycle.observedAt) {
    lines.push(`- Observed at: \`${report.roomLifecycle.observedAt}\``);
  }
  if (report.roomLifecycle.details.length > 0) {
    lines.push("- Details:");
    for (const detail of report.roomLifecycle.details) {
      lines.push(`  - ${detail}`);
    }
  }
  lines.push("");

  lines.push("## Artifact Paths", "");
  lines.push(`- Bundle JSON: \`${report.artifacts.bundle.path}\``);
  lines.push(`- Bundle Markdown: \`${report.artifacts.bundle.markdownPath}\``);
  lines.push(`- Evidence JSON: \`${report.artifacts.evidence.path}\``);
  lines.push(`- Evidence Markdown: \`${report.artifacts.evidence.markdownPath}\``);
  lines.push(`- Gate JSON: \`${report.artifacts.gate.path}\``);
  lines.push(`- Gate Markdown: \`${report.artifacts.gate.markdownPath}\``);
  return `${lines.join("\n").trim()}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const outputPaths = getOutputPaths(args);
  const report = await buildRuntimeObservabilityBundleReport(args);
  writeJsonFile(outputPaths.bundleJsonPath, report);
  writeFile(outputPaths.bundleMarkdownPath, renderMarkdown(report));

  console.log(`Wrote runtime observability bundle JSON: ${toRelativePath(outputPaths.bundleJsonPath)}`);
  console.log(`Wrote runtime observability bundle Markdown: ${toRelativePath(outputPaths.bundleMarkdownPath)}`);
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
      console.error(`Runtime observability bundle failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
