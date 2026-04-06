import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type TargetSurface = "h5" | "wechat";
export type EndpointStatus = "passed" | "warn" | "failed";
export type EvidenceFreshness = "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp";

interface Args {
  candidate?: string;
  candidateRevision?: string;
  serverUrl: string;
  targetSurface: TargetSurface;
  targetEnvironment?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  maxSampleAgeMinutes: number;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface RuntimeHealthPayload {
  status?: "ok";
  checkedAt?: string;
  service?: string;
  runtime?: {
    activeRoomCount?: number;
    connectionCount?: number;
    activeBattleCount?: number;
    heroCount?: number;
    gameplayTraffic?: {
      connectMessagesTotal?: number;
      worldActionsTotal?: number;
      battleActionsTotal?: number;
      actionMessagesTotal?: number;
      websocketActionRateLimitedTotal?: number;
      websocketActionKickTotal?: number;
    };
    auth?: {
      activeGuestSessionCount?: number;
      activeAccountSessionCount?: number;
      activeAccountLockCount?: number;
      pendingRegistrationCount?: number;
      pendingRecoveryCount?: number;
      tokenDelivery?: {
        queueCount?: number;
        deadLetterCount?: number;
      };
    };
  };
}

interface AuthReadinessPayload {
  status?: "ok" | "warn";
  checkedAt?: string;
  service?: string;
  headline?: string;
  alerts?: string[];
  auth?: {
    activeGuestSessionCount?: number;
    activeAccountSessionCount?: number;
    activeAccountLockCount?: number;
    pendingRegistrationCount?: number;
    pendingRecoveryCount?: number;
    tokenDelivery?: {
      queueCount?: number;
      deadLetterCount?: number;
    };
    wechatLogin?: {
      mode?: string;
      credentialsStatus?: string;
      route?: string;
    };
  };
}

export interface RuntimeObservabilityEvidenceEndpointReport {
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
  capture: {
    kind: "json" | "text";
    body: unknown;
  };
}

export interface RuntimeObservabilityEvidenceReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    branch: string;
    dirty: boolean;
    targetSurface: TargetSurface;
  };
  targetEnvironment: {
    label?: string;
    serverUrl: string;
  };
  summary: {
    status: "passed" | "failed";
    headline: string;
    endpointStatuses: Record<RuntimeObservabilityEvidenceEndpointReport["id"], EndpointStatus>;
  };
  readiness: {
    activeRoomCount: number | null;
    connectionCount: number | null;
    activeBattleCount: number | null;
    heroCount: number | null;
    actionMessagesTotal: number | null;
    worldActionsTotal: number | null;
    battleActionsTotal: number | null;
    activeGuestSessionCount: number | null;
    activeAccountSessionCount: number | null;
    activeAccountLockCount: number | null;
    pendingRegistrationCount: number | null;
    pendingRecoveryCount: number | null;
    tokenDeliveryQueueCount: number | null;
    tokenDeliveryDeadLetterCount: number | null;
    wechatLoginMode: string | null;
    wechatCredentialsStatus: string | null;
    authHeadline: string | null;
  };
  endpoints: RuntimeObservabilityEvidenceEndpointReport[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;
const REQUIRED_RUNTIME_METRICS = [
  "veil_active_room_count",
  "veil_connection_count",
  "veil_gameplay_action_messages_total",
  "veil_auth_account_sessions",
  "veil_auth_token_delivery_queue_count"
] as const;

function fail(message: string): never {
  throw new Error(message);
}

export function parseArgs(argv: string[]): Args {
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let serverUrl: string | undefined;
  let targetSurface: TargetSurface = "wechat";
  let targetEnvironment: string | undefined;
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

  if (!serverUrl?.trim()) {
    fail("Missing required --server-url <base-url>.");
  }

  return {
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    serverUrl,
    targetSurface,
    ...(targetEnvironment ? { targetEnvironment } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    maxSampleAgeMinutes
  };
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

export function getRevision(candidateRevision?: string): GitRevision {
  const gitCommit = readGitValue(["rev-parse", "HEAD"]);
  const commit = candidateRevision?.trim() || gitCommit;
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--porcelain"]).length > 0
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

function normalizeCommit(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !HEX_REVISION_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export function commitsMatch(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeCommit(left);
  const normalizedRight = normalizeCommit(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

export function evaluateFreshness(timestamp: string | undefined, maxAgeMs: number): EvidenceFreshness {
  if (!timestamp?.trim()) {
    return "missing_timestamp";
  }
  const observedAtMs = Date.parse(timestamp);
  if (Number.isNaN(observedAtMs)) {
    return "invalid_timestamp";
  }
  return Date.now() - observedAtMs > maxAgeMs ? "stale" : "fresh";
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

async function fetchResponse(url: string): Promise<Response> {
  try {
    return await fetch(url);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

async function fetchJsonPayload<T>(url: string): Promise<{ response: Response; payload: T }> {
  const response = await fetchResponse(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return {
    response,
    payload: (await response.json()) as T
  };
}

async function fetchTextPayload(url: string): Promise<{ response: Response; payload: string }> {
  const response = await fetchResponse(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return {
    response,
    payload: await response.text()
  };
}

export function getDefaultOutputPaths(args: Args, revision: GitRevision): { jsonPath: string; markdownPath: string } {
  const candidateName = args.candidate?.trim() || revision.shortCommit;
  const baseName = `runtime-observability-evidence-${slugify(candidateName)}-${revision.shortCommit}`;
  return {
    jsonPath: path.resolve(args.outputPath ?? path.join(DEFAULT_RELEASE_READINESS_DIR, `${baseName}.json`)),
    markdownPath: path.resolve(args.markdownOutputPath ?? path.join(DEFAULT_RELEASE_READINESS_DIR, `${baseName}.md`))
  };
}

export function readRuntimeObservabilityEvidenceReport(filePath: string): RuntimeObservabilityEvidenceReport {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as RuntimeObservabilityEvidenceReport;
}

export async function buildRuntimeObservabilityEvidenceReport(args: Args): Promise<RuntimeObservabilityEvidenceReport> {
  const revision = getRevision(args.candidateRevision);
  const serverUrl = args.serverUrl.replace(/\/$/, "");
  const maxAgeMs = args.maxSampleAgeMinutes * 60 * 1_000;
  const candidateName = args.candidate?.trim() || revision.shortCommit;
  const endpoints: RuntimeObservabilityEvidenceEndpointReport[] = [];

  const healthUrl = `${serverUrl}/api/runtime/health`;
  let healthPayload: RuntimeHealthPayload | undefined;
  try {
    const { response, payload } = await fetchJsonPayload<RuntimeHealthPayload>(healthUrl);
    healthPayload = payload;
    const freshness = evaluateFreshness(payload.checkedAt, maxAgeMs);
    const status: EndpointStatus =
      payload.status === "ok" && freshness === "fresh"
        ? "passed"
        : freshness === "stale" || freshness === "missing_timestamp" || freshness === "invalid_timestamp"
          ? "warn"
          : "failed";
    const details = [
      `service=${payload.service ?? "unknown"}`,
      `activeRooms=${payload.runtime?.activeRoomCount ?? 0}`,
      `connections=${payload.runtime?.connectionCount ?? 0}`,
      `battles=${payload.runtime?.activeBattleCount ?? 0}`,
      `heroes=${payload.runtime?.heroCount ?? 0}`,
      `actions=${payload.runtime?.gameplayTraffic?.actionMessagesTotal ?? 0}`
    ];
    if (payload.status !== "ok") {
      details.push(`runtime health status reported ${JSON.stringify(payload.status ?? "missing")}`);
    }
    if (freshness !== "fresh") {
      details.push(`runtime health sample freshness is ${freshness}`);
    }
    endpoints.push({
      id: "runtime-health",
      label: "Runtime health",
      url: healthUrl,
      status,
      httpStatus: response.status,
      summary:
        status === "passed"
          ? "Runtime health responded with an OK payload."
          : payload.status !== "ok"
            ? `Runtime health reported ${JSON.stringify(payload.status ?? "missing")}.`
            : `Runtime health sample is ${freshness}.`,
      observedAt: payload.checkedAt,
      freshness,
      details,
      keyReadinessFields: {
        service: payload.service ?? null,
        activeRoomCount: payload.runtime?.activeRoomCount ?? null,
        connectionCount: payload.runtime?.connectionCount ?? null,
        activeBattleCount: payload.runtime?.activeBattleCount ?? null,
        heroCount: payload.runtime?.heroCount ?? null,
        actionMessagesTotal: payload.runtime?.gameplayTraffic?.actionMessagesTotal ?? null,
        worldActionsTotal: payload.runtime?.gameplayTraffic?.worldActionsTotal ?? null,
        battleActionsTotal: payload.runtime?.gameplayTraffic?.battleActionsTotal ?? null,
        activeGuestSessionCount: payload.runtime?.auth?.activeGuestSessionCount ?? null,
        activeAccountSessionCount: payload.runtime?.auth?.activeAccountSessionCount ?? null
      },
      capture: {
        kind: "json",
        body: payload
      }
    });
  } catch (error) {
    endpoints.push({
      id: "runtime-health",
      label: "Runtime health",
      url: healthUrl,
      status: "failed",
      summary: "Runtime health probe failed.",
      freshness: "missing_timestamp",
      details: [error instanceof Error ? error.message : String(error)],
      keyReadinessFields: {},
      capture: {
        kind: "json",
        body: {
          error: error instanceof Error ? error.message : String(error)
        }
      }
    });
  }

  const authUrl = `${serverUrl}/api/runtime/auth-readiness`;
  let authPayload: AuthReadinessPayload | undefined;
  try {
    const { response, payload } = await fetchJsonPayload<AuthReadinessPayload>(authUrl);
    authPayload = payload;
    const freshness = evaluateFreshness(payload.checkedAt, maxAgeMs);
    const hasAlerts = (payload.alerts?.length ?? 0) > 0;
    const status: EndpointStatus =
      payload.status === "ok" && !hasAlerts && freshness === "fresh"
        ? "passed"
        : payload.status === "warn" || hasAlerts || freshness !== "fresh"
          ? "warn"
          : "failed";
    const details = [
      payload.headline?.trim() || `status=${payload.status ?? "missing"}`,
      `guestSessions=${payload.auth?.activeGuestSessionCount ?? 0}`,
      `accountSessions=${payload.auth?.activeAccountSessionCount ?? 0}`,
      `lockouts=${payload.auth?.activeAccountLockCount ?? 0}`,
      `pendingRegistrations=${payload.auth?.pendingRegistrationCount ?? 0}`,
      `pendingRecoveries=${payload.auth?.pendingRecoveryCount ?? 0}`,
      `tokenQueue=${payload.auth?.tokenDelivery?.queueCount ?? 0}`,
      `tokenDeadLetters=${payload.auth?.tokenDelivery?.deadLetterCount ?? 0}`,
      `wechatMode=${payload.auth?.wechatLogin?.mode ?? "unknown"}`,
      `wechatCredentials=${payload.auth?.wechatLogin?.credentialsStatus ?? "unknown"}`
    ];
    for (const alert of payload.alerts ?? []) {
      details.push(`alert=${alert}`);
    }
    if (freshness !== "fresh") {
      details.push(`auth readiness sample freshness is ${freshness}`);
    }
    endpoints.push({
      id: "auth-readiness",
      label: "Auth readiness",
      url: authUrl,
      status,
      httpStatus: response.status,
      summary:
        status === "passed"
          ? payload.headline?.trim() || "Auth readiness responded with an OK payload."
          : payload.headline?.trim() || `Auth readiness reported ${JSON.stringify(payload.status ?? "missing")}.`,
      observedAt: payload.checkedAt,
      freshness,
      details,
      keyReadinessFields: {
        status: payload.status ?? null,
        activeGuestSessionCount: payload.auth?.activeGuestSessionCount ?? null,
        activeAccountSessionCount: payload.auth?.activeAccountSessionCount ?? null,
        activeAccountLockCount: payload.auth?.activeAccountLockCount ?? null,
        pendingRegistrationCount: payload.auth?.pendingRegistrationCount ?? null,
        pendingRecoveryCount: payload.auth?.pendingRecoveryCount ?? null,
        tokenDeliveryQueueCount: payload.auth?.tokenDelivery?.queueCount ?? null,
        tokenDeliveryDeadLetterCount: payload.auth?.tokenDelivery?.deadLetterCount ?? null,
        wechatLoginMode: payload.auth?.wechatLogin?.mode ?? null,
        wechatCredentialsStatus: payload.auth?.wechatLogin?.credentialsStatus ?? null
      },
      capture: {
        kind: "json",
        body: payload
      }
    });
  } catch (error) {
    endpoints.push({
      id: "auth-readiness",
      label: "Auth readiness",
      url: authUrl,
      status: "failed",
      summary: "Auth readiness probe failed.",
      freshness: "missing_timestamp",
      details: [error instanceof Error ? error.message : String(error)],
      keyReadinessFields: {},
      capture: {
        kind: "json",
        body: {
          error: error instanceof Error ? error.message : String(error)
        }
      }
    });
  }

  const metricsUrl = `${serverUrl}/api/runtime/metrics`;
  try {
    const { response, payload } = await fetchTextPayload(metricsUrl);
    const observedAt = healthPayload?.checkedAt ?? authPayload?.checkedAt;
    const freshness = evaluateFreshness(observedAt, maxAgeMs);
    const missingMetrics = REQUIRED_RUNTIME_METRICS.filter((metric) => !payload.includes(metric));
    const status: EndpointStatus =
      missingMetrics.length === 0 && freshness === "fresh"
        ? "passed"
        : missingMetrics.length === 0
          ? "warn"
          : "failed";
    const details =
      missingMetrics.length === 0
        ? ["Required Prometheus metrics are present."]
        : [`Missing metrics: ${missingMetrics.join(", ")}`];
    if (freshness !== "fresh") {
      details.push(`metrics sample freshness is ${freshness}`);
    }
    endpoints.push({
      id: "runtime-metrics",
      label: "Runtime metrics",
      url: metricsUrl,
      status,
      httpStatus: response.status,
      summary:
        missingMetrics.length === 0
          ? "Runtime metrics exposed the required Prometheus counters."
          : `Runtime metrics are missing ${missingMetrics.length} required counter(s).`,
      observedAt,
      freshness,
      details,
      keyReadinessFields: Object.fromEntries(REQUIRED_RUNTIME_METRICS.map((metric) => [metric, !missingMetrics.includes(metric)])),
      capture: {
        kind: "text",
        body: payload
      }
    });
  } catch (error) {
    endpoints.push({
      id: "runtime-metrics",
      label: "Runtime metrics",
      url: metricsUrl,
      status: "failed",
      summary: "Runtime metrics probe failed.",
      freshness: "missing_timestamp",
      details: [error instanceof Error ? error.message : String(error)],
      keyReadinessFields: Object.fromEntries(REQUIRED_RUNTIME_METRICS.map((metric) => [metric, false])),
      capture: {
        kind: "text",
        body: error instanceof Error ? error.message : String(error)
      }
    });
  }

  const endpointStatuses = {
    "runtime-health": endpoints.find((entry) => entry.id === "runtime-health")?.status ?? "failed",
    "auth-readiness": endpoints.find((entry) => entry.id === "auth-readiness")?.status ?? "failed",
    "runtime-metrics": endpoints.find((entry) => entry.id === "runtime-metrics")?.status ?? "failed"
  } satisfies Record<RuntimeObservabilityEvidenceEndpointReport["id"], EndpointStatus>;
  const failingEndpoints = endpoints.filter((entry) => entry.status !== "passed");
  const summaryStatus = failingEndpoints.length === 0 ? "passed" : "failed";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: candidateName,
      revision: revision.commit,
      shortRevision: revision.shortCommit,
      branch: revision.branch,
      dirty: revision.dirty,
      targetSurface: args.targetSurface
    },
    targetEnvironment: {
      ...(args.targetEnvironment?.trim() ? { label: args.targetEnvironment.trim() } : {}),
      serverUrl
    },
    summary: {
      status: summaryStatus,
      headline:
        summaryStatus === "passed"
          ? "Runtime observability evidence captured cleanly for the target environment."
          : `Runtime observability evidence has failing or stale probes for ${failingEndpoints.map((entry) => entry.label).join(", ")}.`,
      endpointStatuses
    },
    readiness: {
      activeRoomCount: healthPayload?.runtime?.activeRoomCount ?? null,
      connectionCount: healthPayload?.runtime?.connectionCount ?? null,
      activeBattleCount: healthPayload?.runtime?.activeBattleCount ?? null,
      heroCount: healthPayload?.runtime?.heroCount ?? null,
      actionMessagesTotal: healthPayload?.runtime?.gameplayTraffic?.actionMessagesTotal ?? null,
      worldActionsTotal: healthPayload?.runtime?.gameplayTraffic?.worldActionsTotal ?? null,
      battleActionsTotal: healthPayload?.runtime?.gameplayTraffic?.battleActionsTotal ?? null,
      activeGuestSessionCount: authPayload?.auth?.activeGuestSessionCount ?? healthPayload?.runtime?.auth?.activeGuestSessionCount ?? null,
      activeAccountSessionCount: authPayload?.auth?.activeAccountSessionCount ?? healthPayload?.runtime?.auth?.activeAccountSessionCount ?? null,
      activeAccountLockCount: authPayload?.auth?.activeAccountLockCount ?? healthPayload?.runtime?.auth?.activeAccountLockCount ?? null,
      pendingRegistrationCount: authPayload?.auth?.pendingRegistrationCount ?? healthPayload?.runtime?.auth?.pendingRegistrationCount ?? null,
      pendingRecoveryCount: authPayload?.auth?.pendingRecoveryCount ?? healthPayload?.runtime?.auth?.pendingRecoveryCount ?? null,
      tokenDeliveryQueueCount: authPayload?.auth?.tokenDelivery?.queueCount ?? healthPayload?.runtime?.auth?.tokenDelivery?.queueCount ?? null,
      tokenDeliveryDeadLetterCount: authPayload?.auth?.tokenDelivery?.deadLetterCount ?? healthPayload?.runtime?.auth?.tokenDelivery?.deadLetterCount ?? null,
      wechatLoginMode: authPayload?.auth?.wechatLogin?.mode ?? null,
      wechatCredentialsStatus: authPayload?.auth?.wechatLogin?.credentialsStatus ?? null,
      authHeadline: authPayload?.headline ?? null
    },
    endpoints
  };
}

function renderCapture(endpoint: RuntimeObservabilityEvidenceEndpointReport): string[] {
  if (endpoint.capture.kind === "json") {
    return ["```json", JSON.stringify(endpoint.capture.body, null, 2), "```"];
  }
  return ["```text", String(endpoint.capture.body), "```"];
}

export function renderMarkdown(report: RuntimeObservabilityEvidenceReport): string {
  const lines: string[] = [];
  lines.push("# Runtime Observability Evidence", "");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Revision: \`${report.candidate.revision}\``);
  lines.push(`- Branch: \`${report.candidate.branch}\``);
  lines.push(`- Git tree: \`${report.candidate.dirty ? "dirty" : "clean"}\``);
  lines.push(`- Target surface: \`${report.candidate.targetSurface}\``);
  lines.push(`- Target environment: \`${report.targetEnvironment.label ?? report.targetEnvironment.serverUrl}\``);
  lines.push(`- Target base URL: \`${report.targetEnvironment.serverUrl}\``);
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

  lines.push("## Endpoint Captures", "");
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
    lines.push("- Captured payload:");
    lines.push(...renderCapture(endpoint), "");
  }

  return `${lines.join("\n").trim()}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const revision = getRevision(args.candidateRevision);
  const outputPaths = getDefaultOutputPaths(args, revision);
  const report = await buildRuntimeObservabilityEvidenceReport(args);
  writeJsonFile(outputPaths.jsonPath, report);
  writeFile(outputPaths.markdownPath, renderMarkdown(report));

  console.log(`Wrote runtime observability evidence JSON: ${toRelativePath(outputPaths.jsonPath)}`);
  console.log(`Wrote runtime observability evidence Markdown: ${toRelativePath(outputPaths.markdownPath)}`);
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
      console.error(`Runtime observability evidence capture failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
