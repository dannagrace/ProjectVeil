import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type GateStatus = "pass" | "warn" | "fail";

interface Args {
  serverUrl?: string;
  snapshotPath?: string;
  cocosRcPath?: string;
  wechatArtifactsDir?: string;
  wechatSmokeReportPath?: string;
  wechatPackageMetadataPath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  maxEvidenceAgeDays: number;
}

interface ReleaseReadinessSnapshotCheck {
  id: string;
  status: "passed" | "failed" | "pending" | "not_applicable";
  required: boolean;
}

interface ReleaseReadinessSnapshot {
  generatedAt?: string;
  summary?: {
    status?: "passed" | "failed" | "pending" | "partial";
    requiredFailed?: number;
    requiredPending?: number;
  };
  checks?: ReleaseReadinessSnapshotCheck[];
}

interface AuthReadinessPayload {
  status?: "ok" | "warn";
  checkedAt?: string;
  headline?: string;
  alerts?: string[];
  auth?: {
    activeAccountLockCount?: number;
    pendingRegistrationCount?: number;
    pendingRecoveryCount?: number;
    tokenDelivery?: {
      queueCount?: number;
      deadLetterCount?: number;
    };
  };
}

interface RuntimeHealthPayload {
  status?: "ok";
  checkedAt?: string;
  runtime?: {
    activeRoomCount?: number;
    connectionCount?: number;
    gameplayTraffic?: {
      actionMessagesTotal?: number;
    };
    auth?: {
      activeGuestSessionCount?: number;
      activeAccountSessionCount?: number;
    };
  };
}

interface WechatPackageMetadata {
  schemaVersion?: number;
  archiveFileName?: string;
  archiveSha256?: string;
  sourceRevision?: string;
}

interface WechatSmokeReport {
  execution?: {
    result?: "pending" | "passed" | "failed";
    executedAt?: string;
    tester?: string;
    device?: string;
    summary?: string;
  };
  artifact?: {
    sourceRevision?: string;
    archiveSha256?: string;
  };
  cases?: Array<{
    id: string;
    status: "pending" | "passed" | "failed" | "not_applicable";
  }>;
}

interface CocosReleaseCandidateSnapshot {
  execution?: {
    overallStatus?: "pending" | "passed" | "failed" | "partial";
    executedAt?: string;
    summary?: string;
  };
}

interface EvidenceItem {
  label: string;
  path: string;
  status: GateStatus;
  observedAt?: string;
  summary: string;
}

interface GateReport {
  id: string;
  label: string;
  status: GateStatus;
  summary: string;
  details: string[];
  evidence: EvidenceItem[];
}

interface DashboardReport {
  schemaVersion: 1;
  generatedAt: string;
  overallStatus: GateStatus;
  summary: string;
  inputs: {
    serverUrl?: string;
    snapshotPath?: string;
    cocosRcPath?: string;
    wechatArtifactsDir?: string;
    wechatSmokeReportPath?: string;
    wechatPackageMetadataPath?: string;
  };
  gates: GateReport[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_RELEASE_EVIDENCE_DIR = path.resolve("artifacts", "release-evidence");
const REQUIRED_SNAPSHOT_CHECK_IDS = ["npm-test", "typecheck-ci", "e2e-smoke", "e2e-multiplayer-smoke", "wechat-build-check"] as const;
const REQUIRED_METRICS = [
  "veil_active_room_count",
  "veil_connection_count",
  "veil_gameplay_action_messages_total",
  "veil_auth_account_sessions",
  "veil_auth_token_delivery_queue_count"
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let serverUrl: string | undefined;
  let snapshotPath: string | undefined;
  let cocosRcPath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let wechatSmokeReportPath: string | undefined;
  let wechatPackageMetadataPath: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let maxEvidenceAgeDays = 14;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--server-url" && next) {
      serverUrl = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--snapshot" && next) {
      snapshotPath = next;
      index += 1;
      continue;
    }
    if (arg === "--cocos-rc" && next) {
      cocosRcPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-artifacts-dir" && next) {
      wechatArtifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-smoke-report" && next) {
      wechatSmokeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-package-metadata" && next) {
      wechatPackageMetadataPath = next;
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
    if (arg === "--max-evidence-age-days" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        fail(`--max-evidence-age-days must be a positive integer, received ${JSON.stringify(next)}.`);
      }
      maxEvidenceAgeDays = parsed;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(serverUrl ? { serverUrl } : {}),
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(cocosRcPath ? { cocosRcPath } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
    ...(wechatPackageMetadataPath ? { wechatPackageMetadataPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    maxEvidenceAgeDays
  };
}

function resolveLatestJsonFile(dirPath: string): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }
  const candidates = fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .filter((entry) => fs.statSync(entry).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0];
}

function resolveWechatArtifacts(args: Args): { smokeReportPath?: string; packageMetadataPath?: string } {
  const smokeReportPath = args.wechatSmokeReportPath
    ? path.resolve(args.wechatSmokeReportPath)
    : args.wechatArtifactsDir
      ? path.resolve(args.wechatArtifactsDir, "codex.wechat.smoke-report.json")
      : undefined;

  let packageMetadataPath = args.wechatPackageMetadataPath ? path.resolve(args.wechatPackageMetadataPath) : undefined;
  if (!packageMetadataPath && args.wechatArtifactsDir && fs.existsSync(path.resolve(args.wechatArtifactsDir))) {
    const artifactsDir = path.resolve(args.wechatArtifactsDir);
    const entries = fs
      .readdirSync(artifactsDir)
      .filter((entry) => entry.endsWith(".package.json"))
      .sort((left, right) =>
        fs.statSync(path.join(artifactsDir, right)).mtimeMs - fs.statSync(path.join(artifactsDir, left)).mtimeMs
      );
    if (entries[0]) {
      packageMetadataPath = path.join(artifactsDir, entries[0]);
    }
  }

  return {
    ...(smokeReportPath ? { smokeReportPath } : {}),
    ...(packageMetadataPath ? { packageMetadataPath } : {})
  };
}

function readJsonFile<T>(filePath: string | undefined): T | undefined {
  if (!filePath) {
    return undefined;
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as T;
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeTextFile(filePath: string, content: string): void {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function statusRank(status: GateStatus): number {
  if (status === "fail") {
    return 2;
  }
  if (status === "warn") {
    return 1;
  }
  return 0;
}

function mergeStatuses(statuses: GateStatus[]): GateStatus {
  if (statuses.some((status) => status === "fail")) {
    return "fail";
  }
  if (statuses.some((status) => status === "warn")) {
    return "warn";
  }
  return "pass";
}

function parseIsoDate(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function describeAge(observedAt: string | undefined, maxAgeDays: number): { status: GateStatus; detail: string } {
  if (!observedAt) {
    return {
      status: "warn",
      detail: "timestamp missing"
    };
  }
  const observedMs = parseIsoDate(observedAt);
  if (observedMs === undefined) {
    return {
      status: "warn",
      detail: `timestamp invalid (${observedAt})`
    };
  }
  const ageMs = Date.now() - observedMs;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1_000;
  if (ageMs > maxAgeMs) {
    return {
      status: "warn",
      detail: `older than ${maxAgeDays} day(s) (${observedAt})`
    };
  }
  return {
    status: "pass",
    detail: observedAt
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return response.text();
}

function buildHealthGate(
  serverUrl: string | undefined,
  healthPayload: RuntimeHealthPayload | undefined,
  metricsText: string | undefined,
  metricsError: string | undefined
): GateReport {
  if (!serverUrl) {
    return {
      id: "server-health",
      label: "Server health",
      status: "warn",
      summary: "Live runtime endpoints were not checked.",
      details: ["Pass --server-url <base-url> to probe /api/runtime/health and /api/runtime/metrics."],
      evidence: []
    };
  }

  if (!healthPayload) {
    return {
      id: "server-health",
      label: "Server health",
      status: "fail",
      summary: "Runtime health endpoint could not be read.",
      details: [metricsError ? `Metrics endpoint error: ${metricsError}` : "Health endpoint request failed."],
      evidence: []
    };
  }

  const details = [
    `checkedAt=${healthPayload.checkedAt ?? "<missing>"}`,
    `activeRooms=${healthPayload.runtime?.activeRoomCount ?? 0} connections=${healthPayload.runtime?.connectionCount ?? 0}`,
    `actionMessages=${healthPayload.runtime?.gameplayTraffic?.actionMessagesTotal ?? 0}`
  ];
  const missingMetrics = metricsText
    ? REQUIRED_METRICS.filter((metric) => !metricsText.includes(metric))
    : [...REQUIRED_METRICS];
  if (missingMetrics.length > 0) {
    details.push(`Missing metrics: ${missingMetrics.join(", ")}`);
  }
  const status = healthPayload.status === "ok" && missingMetrics.length === 0 ? "pass" : "fail";

  return {
    id: "server-health",
    label: "Server health",
    status,
    summary:
      status === "pass"
        ? "Runtime health and core metrics endpoints are available."
        : "Runtime health or required metrics evidence is incomplete.",
    details,
    evidence: [
      {
        label: "Runtime health",
        path: `${serverUrl.replace(/\/$/, "")}/api/runtime/health`,
        status: healthPayload.status === "ok" ? "pass" : "fail",
        observedAt: healthPayload.checkedAt,
        summary: `status=${healthPayload.status ?? "<missing>"}`
      },
      {
        label: "Runtime metrics",
        path: `${serverUrl.replace(/\/$/, "")}/api/runtime/metrics`,
        status: missingMetrics.length === 0 ? "pass" : "fail",
        observedAt: healthPayload.checkedAt,
        summary: missingMetrics.length === 0 ? "Required Prometheus metrics present." : `Missing ${missingMetrics.length} required metric(s).`
      }
    ]
  };
}

function buildAuthGate(serverUrl: string | undefined, authPayload: AuthReadinessPayload | undefined, error?: string): GateReport {
  if (!serverUrl) {
    return {
      id: "auth-readiness",
      label: "Auth readiness",
      status: "warn",
      summary: "Live auth-readiness evidence was not checked.",
      details: ["Pass --server-url <base-url> to probe /api/runtime/auth-readiness."],
      evidence: []
    };
  }

  if (!authPayload) {
    return {
      id: "auth-readiness",
      label: "Auth readiness",
      status: "fail",
      summary: "Auth readiness endpoint could not be read.",
      details: [error ?? "Request failed."],
      evidence: []
    };
  }

  const alerts = authPayload.alerts ?? [];
  const status: GateStatus = authPayload.status === "ok" ? "pass" : "warn";

  return {
    id: "auth-readiness",
    label: "Auth readiness",
    status,
    summary: authPayload.headline?.trim() || (status === "pass" ? "Auth readiness is healthy." : "Auth readiness raised alerts."),
    details: [
      `checkedAt=${authPayload.checkedAt ?? "<missing>"}`,
      `lockouts=${authPayload.auth?.activeAccountLockCount ?? 0} pendingRegistrations=${authPayload.auth?.pendingRegistrationCount ?? 0} pendingRecoveries=${authPayload.auth?.pendingRecoveryCount ?? 0}`,
      `deliveryQueue=${authPayload.auth?.tokenDelivery?.queueCount ?? 0} deadLetters=${authPayload.auth?.tokenDelivery?.deadLetterCount ?? 0}`,
      ...(alerts.length > 0 ? alerts : ["No auth alerts reported."])
    ],
    evidence: [
      {
        label: "Auth readiness",
        path: `${serverUrl.replace(/\/$/, "")}/api/runtime/auth-readiness`,
        status,
        observedAt: authPayload.checkedAt,
        summary: authPayload.headline?.trim() || `status=${authPayload.status ?? "<missing>"}`
      }
    ]
  };
}

export function summarizeSnapshot(snapshotPath: string | undefined, snapshot: ReleaseReadinessSnapshot | undefined): {
  status: GateStatus;
  detail: string;
  evidence?: EvidenceItem;
} {
  if (!snapshotPath || !snapshot) {
    return {
      status: "warn",
      detail: "Release readiness snapshot missing."
    };
  }

  const checksById = new Map((snapshot.checks ?? []).map((check) => [check.id, check]));
  const missingRequiredChecks = REQUIRED_SNAPSHOT_CHECK_IDS.filter((id) => !checksById.has(id));
  const failedRequiredChecks = REQUIRED_SNAPSHOT_CHECK_IDS.filter((id) => checksById.get(id)?.status === "failed");
  const pendingRequiredChecks = REQUIRED_SNAPSHOT_CHECK_IDS.filter((id) => checksById.get(id)?.status === "pending");

  let status: GateStatus = "pass";
  if (snapshot.summary?.status === "failed" || failedRequiredChecks.length > 0 || missingRequiredChecks.length > 0) {
    status = "fail";
  } else if (
    snapshot.summary?.status === "pending" ||
    snapshot.summary?.status === "partial" ||
    pendingRequiredChecks.length > 0
  ) {
    status = "warn";
  }

  const parts = [`snapshot=${snapshot.summary?.status ?? "<missing>"}`];
  if (failedRequiredChecks.length > 0) {
    parts.push(`failed=${failedRequiredChecks.join(", ")}`);
  }
  if (pendingRequiredChecks.length > 0) {
    parts.push(`pending=${pendingRequiredChecks.join(", ")}`);
  }
  if (missingRequiredChecks.length > 0) {
    parts.push(`missing=${missingRequiredChecks.join(", ")}`);
  }

  return {
    status,
    detail: parts.join(" | "),
    evidence: {
      label: "Release readiness snapshot",
      path: snapshotPath,
      status,
      observedAt: snapshot.generatedAt,
      summary: parts.join(" | ")
    }
  };
}

export function summarizeWechatPackage(metadataPath: string | undefined, metadata: WechatPackageMetadata | undefined): {
  status: GateStatus;
  detail: string;
  evidence?: EvidenceItem;
} {
  if (!metadataPath || !metadata) {
    return {
      status: "warn",
      detail: "WeChat package metadata missing."
    };
  }

  const archiveFileName = metadata.archiveFileName?.trim();
  const archiveSha256 = metadata.archiveSha256?.trim();
  const archivePath = archiveFileName ? path.join(path.dirname(metadataPath), archiveFileName) : undefined;
  const archiveExists = archivePath ? fs.existsSync(archivePath) : false;
  const valid = metadata.schemaVersion === 1 && Boolean(archiveFileName) && Boolean(archiveSha256) && archiveExists;
  const status: GateStatus = valid ? "pass" : "fail";
  return {
    status,
    detail: valid
      ? `archive=${archiveFileName} sha=${archiveSha256?.slice(0, 12)}…`
      : "Sidecar, archive, or SHA evidence is incomplete.",
    evidence: {
      label: "WeChat package metadata",
      path: metadataPath,
      status,
      observedAt: new Date(fs.statSync(metadataPath).mtimeMs).toISOString(),
      summary: valid
        ? `archive=${archiveFileName} sha=${archiveSha256?.slice(0, 12)}…`
        : "Package metadata is incomplete or the archive is missing."
    }
  };
}

export function summarizeWechatSmoke(reportPath: string | undefined, report: WechatSmokeReport | undefined): {
  status: GateStatus;
  detail: string;
  evidence?: EvidenceItem;
} {
  if (!reportPath || !report) {
    return {
      status: "warn",
      detail: "WeChat smoke report missing."
    };
  }

  const result = report.execution?.result;
  const failedCases = (report.cases ?? []).filter((entry) => entry.status === "failed").map((entry) => entry.id);
  const pendingCases = (report.cases ?? []).filter((entry) => entry.status === "pending").map((entry) => entry.id);

  let status: GateStatus = "warn";
  if (result === "passed" && failedCases.length === 0 && pendingCases.length === 0) {
    status = "pass";
  } else if (result === "failed" || failedCases.length > 0) {
    status = "fail";
  }

  const parts = [`result=${result ?? "<missing>"}`];
  if (failedCases.length > 0) {
    parts.push(`failed=${failedCases.join(", ")}`);
  }
  if (pendingCases.length > 0) {
    parts.push(`pending=${pendingCases.join(", ")}`);
  }

  return {
    status,
    detail: parts.join(" | "),
    evidence: {
      label: "WeChat smoke report",
      path: reportPath,
      status,
      observedAt: report.execution?.executedAt,
      summary: parts.join(" | ")
    }
  };
}

export function summarizeCocosRc(snapshotPath: string | undefined, snapshot: CocosReleaseCandidateSnapshot | undefined): {
  status: GateStatus;
  detail: string;
  evidence?: EvidenceItem;
} {
  if (!snapshotPath || !snapshot) {
    return {
      status: "warn",
      detail: "Cocos RC snapshot missing."
    };
  }

  const overallStatus = snapshot.execution?.overallStatus;
  const status: GateStatus =
    overallStatus === "passed" ? "pass" : overallStatus === "failed" ? "fail" : "warn";

  return {
    status,
    detail: `overallStatus=${overallStatus ?? "<missing>"}${snapshot.execution?.summary ? ` | ${snapshot.execution.summary}` : ""}`,
    evidence: {
      label: "Cocos RC snapshot",
      path: snapshotPath,
      status,
      observedAt: snapshot.execution?.executedAt,
      summary: `overallStatus=${overallStatus ?? "<missing>"}`
    }
  };
}

export function buildBuildPackageGate(
  snapshotSummary: ReturnType<typeof summarizeSnapshot>,
  packageSummary: ReturnType<typeof summarizeWechatPackage>,
  smokeSummary: ReturnType<typeof summarizeWechatSmoke>
): GateReport {
  const status = mergeStatuses([snapshotSummary.status, packageSummary.status, smokeSummary.status]);
  return {
    id: "build-package-validation",
    label: "Smoke/build/package validation",
    status,
    summary:
      status === "pass"
        ? "Automated regression, WeChat package sidecar, and smoke report all passed."
        : status === "fail"
          ? "One or more release validation surfaces failed."
          : "Release validation evidence is incomplete or still pending.",
    details: [snapshotSummary.detail, packageSummary.detail, smokeSummary.detail],
    evidence: [snapshotSummary.evidence, packageSummary.evidence, smokeSummary.evidence].filter(
      (entry): entry is EvidenceItem => Boolean(entry)
    )
  };
}

export function buildCriticalEvidenceGate(
  maxEvidenceAgeDays: number,
  evidenceItems: Array<EvidenceItem | undefined>
): GateReport {
  const presentEvidence = evidenceItems.filter((entry): entry is EvidenceItem => Boolean(entry));
  if (presentEvidence.length === 0) {
    return {
      id: "critical-evidence",
      label: "Critical readiness evidence",
      status: "warn",
      summary: "No recent readiness evidence files were found.",
      details: [
        "Generate or point the dashboard at release snapshot, WeChat smoke report, and Cocos RC snapshot evidence files."
      ],
      evidence: []
    };
  }

  const ageChecks = presentEvidence.map((entry) => ({
    entry,
    age: describeAge(entry.observedAt, maxEvidenceAgeDays)
  }));
  const statuses = ageChecks.map(({ entry, age }) => (statusRank(age.status) > statusRank(entry.status) ? age.status : entry.status));
  const status = mergeStatuses(statuses);

  return {
    id: "critical-evidence",
    label: "Critical readiness evidence",
    status,
    summary:
      status === "pass"
        ? "Recent release evidence is present for the key Phase 1 gates."
        : status === "fail"
          ? "Recent evidence includes failing readiness signals."
          : "Some readiness evidence is missing or older than the freshness target.",
    details: ageChecks.map(({ entry, age }) => `${entry.label}: ${age.detail}`),
    evidence: presentEvidence
  };
}

function buildOverallSummary(gates: GateReport[]): string {
  const failed = gates.filter((gate) => gate.status === "fail").map((gate) => gate.label);
  const warned = gates.filter((gate) => gate.status === "warn").map((gate) => gate.label);
  if (failed.length > 0) {
    return `Fail: ${failed.join(", ")}.`;
  }
  if (warned.length > 0) {
    return `Warn: ${warned.join(", ")}.`;
  }
  return "Pass: key Phase 1 release-readiness gates are green.";
}

function renderMarkdown(report: DashboardReport): string {
  const lines: string[] = [];
  lines.push("# Phase 1 Release Readiness Dashboard");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Overall status: ${report.overallStatus.toUpperCase()}`);
  lines.push(`- Summary: ${report.summary}`);
  lines.push("");
  lines.push("| Gate | Status | Summary |");
  lines.push("| --- | --- | --- |");
  for (const gate of report.gates) {
    lines.push(`| ${gate.label} | ${gate.status.toUpperCase()} | ${gate.summary} |`);
  }
  lines.push("");

  for (const gate of report.gates) {
    lines.push(`## ${gate.label}`);
    lines.push("");
    lines.push(`- Status: ${gate.status.toUpperCase()}`);
    lines.push(`- Summary: ${gate.summary}`);
    for (const detail of gate.details) {
      lines.push(`- ${detail}`);
    }
    if (gate.evidence.length > 0) {
      lines.push("- Evidence:");
      for (const item of gate.evidence) {
        const observedAt = item.observedAt ? ` @ ${item.observedAt}` : "";
        lines.push(`  - ${item.label}: ${item.status.toUpperCase()}${observedAt} (${item.path})`);
        lines.push(`    - ${item.summary}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPaths(): { jsonPath: string; markdownPath: string } {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const baseName = `phase1-release-dashboard-${timestamp}`;
  return {
    jsonPath: path.resolve(DEFAULT_RELEASE_READINESS_DIR, `${baseName}.json`),
    markdownPath: path.resolve(DEFAULT_RELEASE_READINESS_DIR, `${baseName}.md`)
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const outputDefaults = defaultOutputPaths();
  const resolvedSnapshotPath = args.snapshotPath
    ? path.resolve(args.snapshotPath)
    : resolveLatestJsonFile(DEFAULT_RELEASE_READINESS_DIR);
  const resolvedCocosRcPath = args.cocosRcPath ? path.resolve(args.cocosRcPath) : resolveLatestJsonFile(DEFAULT_RELEASE_EVIDENCE_DIR);
  const wechatArtifacts = resolveWechatArtifacts(args);

  const snapshot = readJsonFile<ReleaseReadinessSnapshot>(resolvedSnapshotPath);
  const cocosRcSnapshot = readJsonFile<CocosReleaseCandidateSnapshot>(resolvedCocosRcPath);
  const wechatSmokeReport = readJsonFile<WechatSmokeReport>(wechatArtifacts.smokeReportPath);
  const wechatPackageMetadata = readJsonFile<WechatPackageMetadata>(wechatArtifacts.packageMetadataPath);

  let healthPayload: RuntimeHealthPayload | undefined;
  let authPayload: AuthReadinessPayload | undefined;
  let metricsText: string | undefined;
  let healthError: string | undefined;
  let authError: string | undefined;
  let metricsError: string | undefined;

  if (args.serverUrl) {
    const normalizedServerUrl = args.serverUrl.replace(/\/$/, "");
    try {
      healthPayload = await fetchJson<RuntimeHealthPayload>(`${normalizedServerUrl}/api/runtime/health`);
    } catch (error) {
      healthError = error instanceof Error ? error.message : String(error);
    }
    try {
      authPayload = await fetchJson<AuthReadinessPayload>(`${normalizedServerUrl}/api/runtime/auth-readiness`);
    } catch (error) {
      authError = error instanceof Error ? error.message : String(error);
    }
    try {
      metricsText = await fetchText(`${normalizedServerUrl}/api/runtime/metrics`);
    } catch (error) {
      metricsError = error instanceof Error ? error.message : String(error);
    }
  }

  const snapshotSummary = summarizeSnapshot(resolvedSnapshotPath, snapshot);
  const packageSummary = summarizeWechatPackage(wechatArtifacts.packageMetadataPath, wechatPackageMetadata);
  const smokeSummary = summarizeWechatSmoke(wechatArtifacts.smokeReportPath, wechatSmokeReport);
  const cocosRcSummary = summarizeCocosRc(resolvedCocosRcPath, cocosRcSnapshot);

  const gates = [
    buildHealthGate(args.serverUrl, healthPayload, metricsText, healthError ?? metricsError),
    buildAuthGate(args.serverUrl, authPayload, authError),
    buildBuildPackageGate(snapshotSummary, packageSummary, smokeSummary),
    buildCriticalEvidenceGate(args.maxEvidenceAgeDays, [
      snapshotSummary.evidence,
      packageSummary.evidence,
      smokeSummary.evidence,
      cocosRcSummary.evidence
    ])
  ];

  const report: DashboardReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    overallStatus: mergeStatuses(gates.map((gate) => gate.status)),
    summary: buildOverallSummary(gates),
    inputs: {
      ...(args.serverUrl ? { serverUrl: args.serverUrl } : {}),
      ...(resolvedSnapshotPath ? { snapshotPath: resolvedSnapshotPath } : {}),
      ...(resolvedCocosRcPath ? { cocosRcPath: resolvedCocosRcPath } : {}),
      ...(args.wechatArtifactsDir ? { wechatArtifactsDir: path.resolve(args.wechatArtifactsDir) } : {}),
      ...(wechatArtifacts.smokeReportPath ? { wechatSmokeReportPath: wechatArtifacts.smokeReportPath } : {}),
      ...(wechatArtifacts.packageMetadataPath ? { wechatPackageMetadataPath: wechatArtifacts.packageMetadataPath } : {})
    },
    gates
  };

  const jsonOutputPath = path.resolve(args.outputPath ?? outputDefaults.jsonPath);
  const markdownOutputPath = path.resolve(args.markdownOutputPath ?? outputDefaults.markdownPath);

  writeTextFile(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeTextFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote release-readiness dashboard JSON: ${toRelativePath(jsonOutputPath)}`);
  console.log(`Wrote release-readiness dashboard Markdown: ${toRelativePath(markdownOutputPath)}`);
  console.log(`Overall status: ${report.overallStatus}`);
  for (const gate of report.gates) {
    console.log(`- ${gate.label}: ${gate.status} (${gate.summary})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
