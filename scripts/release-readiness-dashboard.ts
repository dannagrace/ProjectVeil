import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type GateStatus = "pass" | "warn" | "fail";
type EvidenceAvailability = "present" | "missing";
type EvidenceFreshness = "unknown" | "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp";

interface Args {
  serverUrl?: string;
  snapshotPath?: string;
  cocosRcPath?: string;
  primaryClientDiagnosticsPath?: string;
  reconnectSoakPath?: string;
  persistencePath?: string;
  wechatArtifactsDir?: string;
  wechatSmokeReportPath?: string;
  wechatPackageMetadataPath?: string;
  candidateRevision?: string;
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
  revision?: {
    commit?: string;
    shortCommit?: string;
    branch?: string;
  };
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
  candidate?: {
    commit?: string;
    shortCommit?: string;
  };
  execution?: {
    overallStatus?: "pending" | "passed" | "failed" | "partial";
    executedAt?: string;
    summary?: string;
  };
}

interface PrimaryClientDiagnosticSnapshotsArtifact {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  summary?: {
    status?: "passed";
    checkpointCount?: number;
    categoryIds?: string[];
    checkpointIds?: string[];
  };
  checkpoints?: Array<{
    id?: string;
    category?: "progression" | "inventory" | "combat" | "reconnect";
    capturedAt?: string;
  }>;
}

interface ReconnectSoakArtifact {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  status?: "passed" | "failed";
  summary?: {
    failedScenarios?: number;
    scenarioNames?: string[];
  };
  soakSummary?: {
    reconnectAttempts?: number;
    invariantChecks?: number;
    worldReconnectCycles?: number;
    battleReconnectCycles?: number;
  } | null;
  results?: Array<{
    scenario?: string;
    failedRooms?: number;
    runtimeHealthAfterCleanup?: {
      activeRoomCount?: number;
      connectionCount?: number;
      activeBattleCount?: number;
      heroCount?: number;
    };
  }>;
}

interface Phase1PersistenceReleaseReport {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  effectiveStorageMode?: string;
  storageDescription?: string;
  summary?: {
    status?: "passed";
    assertionCount?: number;
  };
  contentValidation?: {
    valid?: boolean;
    bundleCount?: number;
    summary?: string;
    issueCount?: number;
  };
  persistenceRegression?: {
    mapPackId?: string;
    assertions?: string[];
  };
}

interface EvidenceItem {
  label: string;
  path: string;
  status: GateStatus;
  availability: EvidenceAvailability;
  freshness: EvidenceFreshness;
  observedAt?: string;
  sourceRevision?: string;
  summary: string;
  reasonCodes: string[];
}

interface GateReport {
  id: string;
  label: string;
  status: GateStatus;
  summary: string;
  failReasons: string[];
  warnReasons: string[];
  details: string[];
  evidence: EvidenceItem[];
}

interface DashboardReport {
  schemaVersion: 1;
  generatedAt: string;
  overallStatus: GateStatus;
  summary: string;
  goNoGo: GoNoGoReport;
  inputs: {
    serverUrl?: string;
    snapshotPath?: string;
    cocosRcPath?: string;
    primaryClientDiagnosticsPath?: string;
    reconnectSoakPath?: string;
    persistencePath?: string;
    wechatArtifactsDir?: string;
    wechatSmokeReportPath?: string;
    wechatPackageMetadataPath?: string;
    candidateRevision?: string;
  };
  gates: GateReport[];
}

type GoNoGoDecision = "ready" | "pending" | "blocked";
type RevisionStatus = "aligned" | "mismatch" | "unknown";

interface GoNoGoEvidenceRef {
  label: string;
  path: string;
  sourceRevision?: string;
  observedAt?: string;
  status: GateStatus;
  availability: EvidenceAvailability;
  freshness: EvidenceFreshness;
  matchesCandidate?: boolean;
}

interface GoNoGoReport {
  decision: GoNoGoDecision;
  summary: string;
  candidateRevision?: string;
  revisionStatus: RevisionStatus;
  requiredFailed: number;
  requiredPending: number;
  blockers: string[];
  pending: string[];
  candidateConsistencyFindings: CandidateConsistencyFinding[];
  evidence: GoNoGoEvidenceRef[];
}

type CandidateConsistencyFindingCode =
  | "candidate_revision_mismatch"
  | "candidate_revision_metadata_missing"
  | "candidate_evidence_stale";

interface CandidateConsistencyFinding {
  code: CandidateConsistencyFindingCode;
  label: string;
  path: string;
  summary: string;
  expectedRevision?: string;
  observedRevision?: string;
  observedAt?: string;
  freshness?: EvidenceFreshness;
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_RELEASE_EVIDENCE_DIR = path.resolve("artifacts", "release-evidence");
const REQUIRED_SNAPSHOT_CHECK_IDS = ["npm-test", "typecheck-ci", "e2e-smoke", "e2e-multiplayer-smoke", "cocos-primary-journey", "wechat-build-check"] as const;
const REQUIRED_PRIMARY_DIAGNOSTIC_CATEGORY_IDS = ["progression", "inventory", "combat", "reconnect"] as const;
const REQUIRED_PRIMARY_DIAGNOSTIC_CHECKPOINT_IDS = [
  "progression-review",
  "inventory-overflow",
  "combat-loop",
  "reconnect-cached-replay",
  "reconnect-recovery"
] as const;
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
  let primaryClientDiagnosticsPath: string | undefined;
  let reconnectSoakPath: string | undefined;
  let persistencePath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let wechatSmokeReportPath: string | undefined;
  let wechatPackageMetadataPath: string | undefined;
  let candidateRevision: string | undefined;
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
    if (arg === "--primary-client-diagnostics" && next) {
      primaryClientDiagnosticsPath = next;
      index += 1;
      continue;
    }
    if (arg === "--reconnect-soak" && next) {
      reconnectSoakPath = next;
      index += 1;
      continue;
    }
    if (arg === "--phase1-persistence" && next) {
      persistencePath = next;
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
    if (arg === "--candidate-revision" && next) {
      candidateRevision = next.trim();
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
    ...(primaryClientDiagnosticsPath ? { primaryClientDiagnosticsPath } : {}),
    ...(reconnectSoakPath ? { reconnectSoakPath } : {}),
    ...(persistencePath ? { persistencePath } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
    ...(wechatPackageMetadataPath ? { wechatPackageMetadataPath } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    maxEvidenceAgeDays
  };
}

function resolveLatestMatchingJsonFile(dirPath: string, matcher: (entry: string) => boolean): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }
  const candidates = fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json") && matcher(entry))
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

function normalizeRevision(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function revisionsMatch(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeRevision(left);
  const normalizedRight = normalizeRevision(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function countSnapshotOutcomes(snapshot: ReleaseReadinessSnapshot | undefined): { requiredFailed: number; requiredPending: number } {
  if (!snapshot) {
    return { requiredFailed: 0, requiredPending: 0 };
  }

  if (
    typeof snapshot.summary?.requiredFailed === "number" &&
    Number.isFinite(snapshot.summary.requiredFailed) &&
    typeof snapshot.summary?.requiredPending === "number" &&
    Number.isFinite(snapshot.summary.requiredPending)
  ) {
    return {
      requiredFailed: snapshot.summary.requiredFailed,
      requiredPending: snapshot.summary.requiredPending
    };
  }

  const requiredChecks = (snapshot.checks ?? []).filter((check) => check.required);
  return {
    requiredFailed: requiredChecks.filter((check) => check.status === "failed").length,
    requiredPending: requiredChecks.filter((check) => check.status === "pending").length
  };
}

function resolveCandidateRevision(inputRevision: string | undefined, revisions: string[]): string | undefined {
  if (inputRevision?.trim()) {
    return inputRevision.trim();
  }

  const [firstRevision] = revisions;
  if (!firstRevision) {
    return undefined;
  }
  return revisions.every((revision) => revisionsMatch(firstRevision, revision)) ? firstRevision : undefined;
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

function createEvidenceItem(input: {
  label: string;
  path: string;
  status: GateStatus;
  observedAt?: string;
  summary: string;
  availability?: EvidenceAvailability;
  freshness?: EvidenceFreshness;
  sourceRevision?: string;
  reasonCodes?: string[];
}): EvidenceItem {
  return {
    label: input.label,
    path: input.path,
    status: input.status,
    availability: input.availability ?? "present",
    freshness: input.freshness ?? "unknown",
    observedAt: input.observedAt,
    sourceRevision: input.sourceRevision,
    summary: input.summary,
    reasonCodes: input.reasonCodes ?? []
  };
}

interface EvidenceSummary {
  status: GateStatus;
  detail: string;
  evidence: EvidenceItem;
  failReasons: string[];
  warnReasons: string[];
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
      failReasons: [],
      warnReasons: ["server_runtime_not_checked"],
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
      failReasons: ["server_health_unavailable"],
      warnReasons: [],
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
    failReasons: status === "fail" ? ["server_health_incomplete"] : [],
    warnReasons: [],
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
        availability: "present",
        freshness: "unknown",
        observedAt: healthPayload.checkedAt,
        summary: `status=${healthPayload.status ?? "<missing>"}`,
        reasonCodes: healthPayload.status === "ok" ? [] : ["server_health_status_not_ok"]
      },
      {
        label: "Runtime metrics",
        path: `${serverUrl.replace(/\/$/, "")}/api/runtime/metrics`,
        status: missingMetrics.length === 0 ? "pass" : "fail",
        availability: "present",
        freshness: "unknown",
        observedAt: healthPayload.checkedAt,
        summary: missingMetrics.length === 0 ? "Required Prometheus metrics present." : `Missing ${missingMetrics.length} required metric(s).`,
        reasonCodes: missingMetrics.length === 0 ? [] : ["server_metrics_missing_required"]
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
      failReasons: [],
      warnReasons: ["auth_readiness_not_checked"],
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
      failReasons: ["auth_readiness_unavailable"],
      warnReasons: [],
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
    failReasons: [],
    warnReasons: status === "warn" ? ["auth_readiness_alerts_present"] : [],
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
        availability: "present",
        freshness: "unknown",
        observedAt: authPayload.checkedAt,
        summary: authPayload.headline?.trim() || `status=${authPayload.status ?? "<missing>"}`,
        reasonCodes: status === "warn" ? ["auth_readiness_alerts_present"] : []
      }
    ]
  };
}

export function summarizeSnapshot(snapshotPath: string | undefined, snapshot: ReleaseReadinessSnapshot | undefined): {
  status: GateStatus;
  detail: string;
  evidence: EvidenceItem;
  failReasons: string[];
  warnReasons: string[];
} {
  if (!snapshotPath || !snapshot) {
    return {
      status: "fail",
      detail: "Release readiness snapshot missing.",
      evidence: createEvidenceItem({
        label: "Release readiness snapshot",
        path: snapshotPath ?? "<missing-release-readiness-snapshot>",
        status: "fail",
        availability: "missing",
        summary: "Release readiness snapshot missing.",
        reasonCodes: ["release_readiness_snapshot_missing"]
      }),
      failReasons: ["release_readiness_snapshot_missing"],
      warnReasons: []
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

  const failReasons: string[] = [];
  const warnReasons: string[] = [];
  if (snapshot.summary?.status === "failed") {
    failReasons.push("release_readiness_snapshot_failed");
  }
  if (failedRequiredChecks.length > 0) {
    failReasons.push("release_readiness_required_checks_failed");
  }
  if (missingRequiredChecks.length > 0) {
    failReasons.push("release_readiness_required_checks_missing");
  }
  if (snapshot.summary?.status === "pending" || snapshot.summary?.status === "partial") {
    warnReasons.push("release_readiness_snapshot_pending");
  }
  if (pendingRequiredChecks.length > 0) {
    warnReasons.push("release_readiness_required_checks_pending");
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
    evidence: createEvidenceItem({
      label: "Release readiness snapshot",
      path: snapshotPath,
      status,
      observedAt: snapshot.generatedAt,
      sourceRevision: snapshot.revision?.shortCommit ?? snapshot.revision?.commit,
      summary: parts.join(" | "),
      reasonCodes: status === "fail" ? failReasons : warnReasons
    }),
    failReasons,
    warnReasons
  };
}

export function summarizeWechatPackage(metadataPath: string | undefined, metadata: WechatPackageMetadata | undefined): {
  status: GateStatus;
  detail: string;
  evidence: EvidenceItem;
  failReasons: string[];
  warnReasons: string[];
} {
  if (!metadataPath || !metadata) {
    return {
      status: "fail",
      detail: "WeChat package metadata missing.",
      evidence: createEvidenceItem({
        label: "WeChat package metadata",
        path: metadataPath ?? "<missing-wechat-package-metadata>",
        status: "fail",
        availability: "missing",
        summary: "WeChat package metadata missing.",
        reasonCodes: ["wechat_package_metadata_missing"]
      }),
      failReasons: ["wechat_package_metadata_missing"],
      warnReasons: []
    };
  }

  const archiveFileName = metadata.archiveFileName?.trim();
  const archiveSha256 = metadata.archiveSha256?.trim();
  const archivePath = archiveFileName ? path.join(path.dirname(metadataPath), archiveFileName) : undefined;
  const archiveExists = archivePath ? fs.existsSync(archivePath) : false;
  const valid = metadata.schemaVersion === 1 && Boolean(archiveFileName) && Boolean(archiveSha256) && archiveExists;
  const status: GateStatus = valid ? "pass" : "fail";
  const failReasons = valid ? [] : ["wechat_package_metadata_incomplete"];
  return {
    status,
    detail: valid
      ? `archive=${archiveFileName} sha=${archiveSha256?.slice(0, 12)}…`
      : "Sidecar, archive, or SHA evidence is incomplete.",
    evidence: createEvidenceItem({
      label: "WeChat package metadata",
      path: metadataPath,
      status,
      observedAt: new Date(fs.statSync(metadataPath).mtimeMs).toISOString(),
      sourceRevision: metadata.sourceRevision,
      summary: valid
        ? `archive=${archiveFileName} sha=${archiveSha256?.slice(0, 12)}…`
        : "Package metadata is incomplete or the archive is missing.",
      reasonCodes: failReasons
    }),
    failReasons,
    warnReasons: []
  };
}

export function summarizeWechatSmoke(reportPath: string | undefined, report: WechatSmokeReport | undefined): {
  status: GateStatus;
  detail: string;
  evidence: EvidenceItem;
  failReasons: string[];
  warnReasons: string[];
} {
  if (!reportPath || !report) {
    return {
      status: "fail",
      detail: "WeChat smoke report missing.",
      evidence: createEvidenceItem({
        label: "WeChat smoke report",
        path: reportPath ?? "<missing-wechat-smoke-report>",
        status: "fail",
        availability: "missing",
        summary: "WeChat smoke report missing.",
        reasonCodes: ["wechat_smoke_report_missing"]
      }),
      failReasons: ["wechat_smoke_report_missing"],
      warnReasons: []
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
  const failReasons: string[] = [];
  const warnReasons: string[] = [];
  if (result === "failed" || failedCases.length > 0) {
    failReasons.push("wechat_smoke_failed");
  }
  if (result !== "passed" && status === "warn") {
    warnReasons.push("wechat_smoke_pending");
  }
  if (pendingCases.length > 0) {
    warnReasons.push("wechat_smoke_cases_pending");
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
    evidence: createEvidenceItem({
      label: "WeChat smoke report",
      path: reportPath,
      status,
      observedAt: report.execution?.executedAt,
      sourceRevision: report.artifact?.sourceRevision,
      summary: parts.join(" | "),
      reasonCodes: status === "fail" ? failReasons : warnReasons
    }),
    failReasons,
    warnReasons
  };
}

export function summarizeCocosRc(snapshotPath: string | undefined, snapshot: CocosReleaseCandidateSnapshot | undefined): {
  status: GateStatus;
  detail: string;
  evidence: EvidenceItem;
  failReasons: string[];
  warnReasons: string[];
} {
  if (!snapshotPath || !snapshot) {
    return {
      status: "fail",
      detail: "Cocos RC snapshot missing.",
      evidence: createEvidenceItem({
        label: "Cocos RC snapshot",
        path: snapshotPath ?? "<missing-cocos-rc-snapshot>",
        status: "fail",
        availability: "missing",
        summary: "Cocos RC snapshot missing.",
        reasonCodes: ["cocos_rc_snapshot_missing"]
      }),
      failReasons: ["cocos_rc_snapshot_missing"],
      warnReasons: []
    };
  }

  const overallStatus = snapshot.execution?.overallStatus;
  const status: GateStatus =
    overallStatus === "passed" ? "pass" : overallStatus === "failed" ? "fail" : "warn";
  const failReasons = status === "fail" ? ["cocos_rc_snapshot_failed"] : [];
  const warnReasons = status === "warn" ? ["cocos_rc_snapshot_pending"] : [];

  return {
    status,
    detail: `overallStatus=${overallStatus ?? "<missing>"}${snapshot.execution?.summary ? ` | ${snapshot.execution.summary}` : ""}`,
    evidence: createEvidenceItem({
      label: "Cocos RC snapshot",
      path: snapshotPath,
      status,
      observedAt: snapshot.execution?.executedAt,
      sourceRevision: snapshot.candidate?.shortCommit ?? snapshot.candidate?.commit,
      summary: `overallStatus=${overallStatus ?? "<missing>"}`,
      reasonCodes: status === "fail" ? failReasons : warnReasons
    }),
    failReasons,
    warnReasons
  };
}

export function summarizePrimaryClientDiagnostics(
  artifactPath: string | undefined,
  artifact: PrimaryClientDiagnosticSnapshotsArtifact | undefined
): {
  status: GateStatus;
  detail: string;
  evidence: EvidenceItem;
  failReasons: string[];
  warnReasons: string[];
} {
  if (!artifactPath || !artifact) {
    return {
      status: "fail",
      detail: "Primary-client diagnostic snapshots missing.",
      evidence: createEvidenceItem({
        label: "Primary-client diagnostic snapshots",
        path: artifactPath ?? "<missing-primary-client-diagnostic-snapshots>",
        status: "fail",
        availability: "missing",
        summary: "Primary-client diagnostic snapshots missing.",
        reasonCodes: ["primary_client_diagnostic_snapshots_missing"]
      }),
      failReasons: ["primary_client_diagnostic_snapshots_missing"],
      warnReasons: []
    };
  }

  const checkpointIds = new Set(
    (artifact.summary?.checkpointIds ?? artifact.checkpoints?.map((checkpoint) => checkpoint.id).filter(Boolean) ?? []) as string[]
  );
  const categoryIds = new Set(
    (artifact.summary?.categoryIds ?? artifact.checkpoints?.map((checkpoint) => checkpoint.category).filter(Boolean) ?? []) as string[]
  );
  const missingCheckpointIds = REQUIRED_PRIMARY_DIAGNOSTIC_CHECKPOINT_IDS.filter((id) => !checkpointIds.has(id));
  const missingCategoryIds = REQUIRED_PRIMARY_DIAGNOSTIC_CATEGORY_IDS.filter((id) => !categoryIds.has(id));
  const status: GateStatus = missingCheckpointIds.length === 0 && missingCategoryIds.length === 0 ? "pass" : "fail";
  const failReasons = status === "fail" ? ["primary_client_diagnostic_snapshots_incomplete"] : [];
  const details = [`checkpoints=${artifact.summary?.checkpointCount ?? artifact.checkpoints?.length ?? 0}`];
  if (missingCheckpointIds.length > 0) {
    details.push(`missingCheckpointIds=${missingCheckpointIds.join(",")}`);
  }
  if (missingCategoryIds.length > 0) {
    details.push(`missingCategoryIds=${missingCategoryIds.join(",")}`);
  }

  return {
    status,
    detail: details.join(" | "),
    evidence: createEvidenceItem({
      label: "Primary-client diagnostic snapshots",
      path: artifactPath,
      status,
      observedAt: artifact.generatedAt,
      sourceRevision: artifact.revision?.shortCommit ?? artifact.revision?.commit,
      summary: details.join(" | "),
      reasonCodes: failReasons
    }),
    failReasons,
    warnReasons: []
  };
}

export function buildBuildPackageGate(
  snapshotSummary: ReturnType<typeof summarizeSnapshot>,
  packageSummary: ReturnType<typeof summarizeWechatPackage>,
  smokeSummary: ReturnType<typeof summarizeWechatSmoke>
): GateReport {
  const status = mergeStatuses([snapshotSummary.status, packageSummary.status, smokeSummary.status]);
  const failReasons = [...snapshotSummary.failReasons, ...packageSummary.failReasons, ...smokeSummary.failReasons];
  const warnReasons = [...snapshotSummary.warnReasons, ...packageSummary.warnReasons, ...smokeSummary.warnReasons];
  return {
    id: "build-package-validation",
    label: "Smoke/build/package validation",
    status,
    failReasons,
    warnReasons,
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
      status: "fail",
      summary: "Critical readiness evidence is missing.",
      failReasons: ["critical_evidence_missing"],
      warnReasons: [],
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
  const evaluatedEvidence = ageChecks.map(({ entry, age }) => {
    let freshness: EvidenceFreshness = "fresh";
    let freshnessReasonCode: string | undefined;
    if (entry.availability === "missing") {
      freshness = "unknown";
    } else if (!entry.observedAt) {
      freshness = "missing_timestamp";
      freshnessReasonCode = "evidence_timestamp_missing";
    } else if (parseIsoDate(entry.observedAt) === undefined) {
      freshness = "invalid_timestamp";
      freshnessReasonCode = "evidence_timestamp_invalid";
    } else if (age.status === "warn") {
      freshness = "stale";
      freshnessReasonCode = "evidence_stale";
    }

    const status = statusRank(age.status) > statusRank(entry.status) ? age.status : entry.status;
    return {
      status,
      age,
      entry: {
        ...entry,
        freshness,
        reasonCodes: freshnessReasonCode && !entry.reasonCodes.includes(freshnessReasonCode)
          ? [...entry.reasonCodes, freshnessReasonCode]
          : entry.reasonCodes
      }
    };
  });
  const statuses = evaluatedEvidence.map(({ status }) => status);
  const status = mergeStatuses(statuses);
  const failReasons = [...new Set(evaluatedEvidence.flatMap(({ entry }) => (entry.status === "fail" ? entry.reasonCodes : [])))];
  const warnReasons = [
    ...new Set(
      evaluatedEvidence.flatMap(({ entry, status: evaluatedStatus }) =>
        evaluatedStatus === "warn" ? entry.reasonCodes : []
      )
    )
  ];

  return {
    id: "critical-evidence",
    label: "Critical readiness evidence",
    status,
    failReasons,
    warnReasons,
    summary:
      status === "pass"
        ? "Recent release evidence is present for the key Phase 1 gates."
        : status === "fail"
          ? "Critical readiness evidence is missing or includes failing signals."
          : "Some readiness evidence is missing or older than the freshness target.",
    details: evaluatedEvidence.map(({ entry, age }) => `${entry.label}: ${entry.availability === "missing" ? "missing artifact" : age.detail}`),
    evidence: evaluatedEvidence.map(({ entry }) => entry)
  };
}

export function summarizeReconnectSoak(
  artifactPath: string | undefined,
  artifact: ReconnectSoakArtifact | undefined,
  maxEvidenceAgeDays: number
): EvidenceSummary {
  if (!artifactPath || !artifact) {
    return {
      status: "fail",
      detail: "Reconnect soak artifact missing.",
      evidence: createEvidenceItem({
        label: "Reconnect soak summary",
        path: artifactPath ?? "<missing-reconnect-soak-artifact>",
        status: "fail",
        availability: "missing",
        summary: "Reconnect soak artifact missing.",
        reasonCodes: ["reconnect_soak_artifact_missing"]
      }),
      failReasons: ["reconnect_soak_artifact_missing"],
      warnReasons: []
    };
  }

  const reconnectResult = artifact.results?.find((entry) => entry.scenario === "reconnect_soak");
  const cleanup = reconnectResult?.runtimeHealthAfterCleanup;
  const lingeringCleanupMetrics = [
    ["activeRoomCount", cleanup?.activeRoomCount ?? 0],
    ["connectionCount", cleanup?.connectionCount ?? 0],
    ["activeBattleCount", cleanup?.activeBattleCount ?? 0],
    ["heroCount", cleanup?.heroCount ?? 0]
  ].filter(([, value]) => value > 0);

  const failReasons: string[] = [];
  if (artifact.status !== "passed") {
    failReasons.push("reconnect_soak_failed");
  }
  if ((artifact.summary?.failedScenarios ?? 0) > 0 || (reconnectResult?.failedRooms ?? 0) > 0) {
    failReasons.push("reconnect_soak_rooms_failed");
  }
  if ((artifact.soakSummary?.reconnectAttempts ?? 0) <= 0 || (artifact.soakSummary?.invariantChecks ?? 0) <= 0) {
    failReasons.push("reconnect_soak_counters_missing");
  }
  if (lingeringCleanupMetrics.length > 0) {
    failReasons.push("reconnect_soak_cleanup_incomplete");
  }

  const age = describeAge(artifact.generatedAt, maxEvidenceAgeDays);
  const warnReasons = failReasons.length === 0 && age.status === "warn" ? ["reconnect_soak_stale"] : [];
  const status: GateStatus = failReasons.length > 0 ? "fail" : age.status === "warn" ? "warn" : "pass";

  const parts = [
    `status=${artifact.status ?? "<missing>"}`,
    `reconnectAttempts=${artifact.soakSummary?.reconnectAttempts ?? 0}`,
    `invariantChecks=${artifact.soakSummary?.invariantChecks ?? 0}`,
    `cleanup=${lingeringCleanupMetrics.length === 0 ? "clean" : lingeringCleanupMetrics.map(([label, value]) => `${label}=${value}`).join(",")}`
  ];
  if (artifact.summary?.scenarioNames?.length) {
    parts.push(`scenarios=${artifact.summary.scenarioNames.join(",")}`);
  }
  if (warnReasons.length > 0) {
    parts.push(age.detail);
  }

  return {
    status,
    detail: parts.join(" | "),
    evidence: createEvidenceItem({
      label: "Reconnect soak summary",
      path: artifactPath,
      status,
      observedAt: artifact.generatedAt,
      sourceRevision: artifact.revision?.shortCommit ?? artifact.revision?.commit,
      summary: parts.join(" | "),
      reasonCodes: status === "fail" ? failReasons : warnReasons
    }),
    failReasons,
    warnReasons
  };
}

export function summarizePhase1Persistence(
  artifactPath: string | undefined,
  artifact: Phase1PersistenceReleaseReport | undefined,
  maxEvidenceAgeDays: number
): EvidenceSummary {
  if (!artifactPath || !artifact) {
    return {
      status: "fail",
      detail: "Phase 1 persistence regression artifact missing.",
      evidence: createEvidenceItem({
        label: "Phase 1 persistence regression",
        path: artifactPath ?? "<missing-phase1-persistence-artifact>",
        status: "fail",
        availability: "missing",
        summary: "Phase 1 persistence regression artifact missing.",
        reasonCodes: ["phase1_persistence_artifact_missing"]
      }),
      failReasons: ["phase1_persistence_artifact_missing"],
      warnReasons: []
    };
  }

  const failReasons: string[] = [];
  if (artifact.summary?.status !== "passed") {
    failReasons.push("phase1_persistence_failed");
  }
  if (artifact.contentValidation?.valid !== true) {
    failReasons.push("phase1_content_validation_failed");
  }
  if ((artifact.summary?.assertionCount ?? 0) <= 0 || (artifact.persistenceRegression?.assertions?.length ?? 0) <= 0) {
    failReasons.push("phase1_persistence_assertions_missing");
  }

  const age = describeAge(artifact.generatedAt, maxEvidenceAgeDays);
  const warnReasons = failReasons.length === 0 && age.status === "warn" ? ["phase1_persistence_stale"] : [];
  const status: GateStatus = failReasons.length > 0 ? "fail" : age.status === "warn" ? "warn" : "pass";

  const parts = [
    `status=${artifact.summary?.status ?? "<missing>"}`,
    `contentValid=${artifact.contentValidation?.valid === true}`,
    `assertions=${artifact.summary?.assertionCount ?? artifact.persistenceRegression?.assertions?.length ?? 0}`,
    `storage=${artifact.effectiveStorageMode ?? "<missing>"}`,
    `mapPack=${artifact.persistenceRegression?.mapPackId ?? "<missing>"}`
  ];
  if (artifact.contentValidation?.summary?.trim()) {
    parts.push(artifact.contentValidation.summary.trim());
  }
  if (warnReasons.length > 0) {
    parts.push(age.detail);
  }

  return {
    status,
    detail: parts.join(" | "),
    evidence: createEvidenceItem({
      label: "Phase 1 persistence regression",
      path: artifactPath,
      status,
      observedAt: artifact.generatedAt,
      sourceRevision: artifact.revision?.shortCommit ?? artifact.revision?.commit,
      summary: parts.join(" | "),
      reasonCodes: status === "fail" ? failReasons : warnReasons
    }),
    failReasons,
    warnReasons
  };
}

export function buildArtifactGate(
  id: string,
  label: string,
  summary: EvidenceSummary,
  passedSummary: string,
  warnSummary: string,
  failedSummary: string
): GateReport {
  return {
    id,
    label,
    status: summary.status,
    failReasons: summary.failReasons,
    warnReasons: summary.warnReasons,
    summary: summary.status === "pass" ? passedSummary : summary.status === "warn" ? warnSummary : failedSummary,
    details: [summary.detail],
    evidence: [summary.evidence]
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

export function buildGoNoGoReport(input: {
  candidateRevision?: string;
  maxEvidenceAgeDays: number;
  snapshot: ReleaseReadinessSnapshot | undefined;
  gates: GateReport[];
  evidence: Array<EvidenceItem | undefined>;
}): GoNoGoReport {
  const snapshotCounts = countSnapshotOutcomes(input.snapshot);
  const goNoGoEvidence = input.evidence
    .filter((entry): entry is EvidenceItem => Boolean(entry))
    .map((entry) => ({
      label: entry.label,
      path: entry.path,
      sourceRevision: entry.sourceRevision,
      observedAt: entry.observedAt,
      status: entry.status,
      availability: entry.availability,
      freshness: entry.freshness
    }));
  const knownRevisions = goNoGoEvidence
    .map((entry) => entry.sourceRevision?.trim())
    .filter((entry): entry is string => Boolean(entry));
  const expectedCandidateRevision = input.candidateRevision?.trim();
  const candidateRevision = resolveCandidateRevision(expectedCandidateRevision, knownRevisions);
  const mismatchedEvidence = candidateRevision
    ? goNoGoEvidence.filter((entry) => entry.sourceRevision && !revisionsMatch(candidateRevision, entry.sourceRevision))
    : [];
  const candidateConsistencyFindings: CandidateConsistencyFinding[] = [
    ...mismatchedEvidence.map((entry) => ({
      code: "candidate_revision_mismatch" as const,
      label: entry.label,
      path: entry.path,
      summary: `Expected candidate revision ${candidateRevision}, but ${entry.label} reports ${entry.sourceRevision ?? "<missing>"}.`,
      expectedRevision: candidateRevision,
      observedRevision: entry.sourceRevision,
      observedAt: entry.observedAt,
      freshness: entry.freshness
    })),
    ...(expectedCandidateRevision
      ? goNoGoEvidence
          .filter((entry) => entry.availability === "present" && !entry.sourceRevision?.trim())
          .map((entry) => ({
            code: "candidate_revision_metadata_missing" as const,
            label: entry.label,
            path: entry.path,
            summary: `Expected candidate revision ${expectedCandidateRevision}, but ${entry.label} is missing revision metadata.`,
            expectedRevision: expectedCandidateRevision,
            observedAt: entry.observedAt,
            freshness: entry.freshness
          }))
      : []),
    ...(expectedCandidateRevision
      ? goNoGoEvidence
          .filter((entry) =>
            entry.availability === "present" &&
            (entry.freshness === "stale" || entry.freshness === "missing_timestamp" || entry.freshness === "invalid_timestamp")
          )
          .map((entry) => ({
            code: "candidate_evidence_stale" as const,
            label: entry.label,
            path: entry.path,
            summary:
              entry.freshness === "stale"
                ? `${entry.label} is older than the ${input.maxEvidenceAgeDays}-day freshness window for candidate ${expectedCandidateRevision}.`
                : entry.freshness === "missing_timestamp"
                  ? `${entry.label} is missing a timestamp, so candidate ${expectedCandidateRevision} freshness cannot be verified.`
                  : `${entry.label} has an invalid timestamp (${entry.observedAt ?? "<missing>"}), so candidate ${expectedCandidateRevision} freshness cannot be verified.`,
            expectedRevision: expectedCandidateRevision,
            observedRevision: entry.sourceRevision,
            observedAt: entry.observedAt,
            freshness: entry.freshness
          }))
      : [])
  ];
  const revisionStatus: RevisionStatus =
    mismatchedEvidence.length > 0 ? "mismatch" : candidateRevision ? "aligned" : "unknown";

  const blockingGates = input.gates.filter((gate) => gate.status === "fail").map((gate) => gate.label);
  const pendingGates = input.gates.filter((gate) => gate.status === "warn").map((gate) => gate.label);
  const blockers = [
    ...(snapshotCounts.requiredFailed > 0 ? [`requiredFailed=${snapshotCounts.requiredFailed}`] : []),
    ...[...new Set(candidateConsistencyFindings.map((finding) => finding.code))],
    ...blockingGates
  ];
  const pending = [
    ...(snapshotCounts.requiredPending > 0 ? [`requiredPending=${snapshotCounts.requiredPending}`] : []),
    ...(revisionStatus === "unknown" ? ["candidate_revision_unverified"] : []),
    ...pendingGates
  ];
  const decision: GoNoGoDecision =
    blockers.length > 0 ? "blocked" : pending.length > 0 ? "pending" : "ready";

  return {
    decision,
    summary:
      decision === "ready"
        ? `Ready: requiredFailed=0, requiredPending=0, and the Phase 1 evidence set is current for ${candidateRevision ?? "the candidate revision"}.`
        : decision === "blocked"
          ? `Blocked: ${blockers.join(", ")}.`
          : `Pending: ${pending.join(", ")}.`,
    ...(candidateRevision ? { candidateRevision } : {}),
    revisionStatus,
    requiredFailed: snapshotCounts.requiredFailed,
    requiredPending: snapshotCounts.requiredPending,
    blockers,
    pending,
    candidateConsistencyFindings,
    evidence: goNoGoEvidence.map((entry) => ({
      ...entry,
      ...(candidateRevision && entry.sourceRevision ? { matchesCandidate: revisionsMatch(candidateRevision, entry.sourceRevision) } : {})
    }))
  };
}

function renderMarkdown(report: DashboardReport): string {
  const lines: string[] = [];
  lines.push("# Phase 1 Release Readiness Dashboard");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Overall status: ${report.overallStatus.toUpperCase()}`);
  lines.push(`- Summary: ${report.summary}`);
  lines.push(`- Go/No-Go decision: ${report.goNoGo.decision.toUpperCase()}`);
  lines.push(`- Go/No-Go summary: ${report.goNoGo.summary}`);
  lines.push(`- Required failed: ${report.goNoGo.requiredFailed}`);
  lines.push(`- Required pending: ${report.goNoGo.requiredPending}`);
  lines.push(`- Candidate revision: ${report.goNoGo.candidateRevision ?? "<unverified>"}`);
  lines.push(`- Revision status: ${report.goNoGo.revisionStatus.toUpperCase()}`);
  lines.push("");
  lines.push("## Phase 1 Go/No-Go");
  lines.push("");
  lines.push(`- Decision: ${report.goNoGo.decision.toUpperCase()}`);
  lines.push(`- Summary: ${report.goNoGo.summary}`);
  lines.push(`- Required failed: ${report.goNoGo.requiredFailed}`);
  lines.push(`- Required pending: ${report.goNoGo.requiredPending}`);
  lines.push(`- Candidate revision: ${report.goNoGo.candidateRevision ?? "<unverified>"}`);
  lines.push(`- Revision status: ${report.goNoGo.revisionStatus.toUpperCase()}`);
  if (report.goNoGo.blockers.length > 0) {
    lines.push(`- Blockers: ${report.goNoGo.blockers.join(", ")}`);
  }
  if (report.goNoGo.pending.length > 0) {
    lines.push(`- Pending: ${report.goNoGo.pending.join(", ")}`);
  }
  if (report.goNoGo.candidateConsistencyFindings.length > 0) {
    lines.push("- Candidate consistency findings:");
    for (const finding of report.goNoGo.candidateConsistencyFindings) {
      lines.push(`  - ${finding.summary} (${finding.path})`);
    }
  }
  if (report.goNoGo.evidence.length > 0) {
    lines.push("- Evidence:");
    for (const item of report.goNoGo.evidence) {
      const observedAt = item.observedAt ? ` @ ${item.observedAt}` : "";
      const revision = item.sourceRevision ? ` revision=${item.sourceRevision}` : "";
      const candidateMatch = typeof item.matchesCandidate === "boolean" ? ` matchesCandidate=${item.matchesCandidate}` : "";
      lines.push(
        `  - ${item.label}: ${item.status.toUpperCase()}${observedAt} (${item.path}) [availability=${item.availability} freshness=${item.freshness}${revision}${candidateMatch}]`
      );
    }
    lines.push("");
  }
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
    if (gate.failReasons.length > 0) {
      lines.push(`- Fail reasons: ${gate.failReasons.join(", ")}`);
    }
    if (gate.warnReasons.length > 0) {
      lines.push(`- Warn reasons: ${gate.warnReasons.join(", ")}`);
    }
    for (const detail of gate.details) {
      lines.push(`- ${detail}`);
    }
    if (gate.evidence.length > 0) {
      lines.push("- Evidence:");
      for (const item of gate.evidence) {
        const observedAt = item.observedAt ? ` @ ${item.observedAt}` : "";
        lines.push(
          `  - ${item.label}: ${item.status.toUpperCase()}${observedAt} (${item.path}) [availability=${item.availability} freshness=${item.freshness}]`
        );
        lines.push(`    - ${item.summary}`);
        if (item.reasonCodes.length > 0) {
          lines.push(`    - reasonCodes=${item.reasonCodes.join(",")}`);
        }
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
    : resolveLatestMatchingJsonFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("release-readiness-"));
  const resolvedCocosRcPath = args.cocosRcPath
    ? path.resolve(args.cocosRcPath)
    : resolveLatestMatchingJsonFile(DEFAULT_RELEASE_EVIDENCE_DIR, (entry) => entry.endsWith(".json"));
  const resolvedPrimaryClientDiagnosticsPath = args.primaryClientDiagnosticsPath
    ? path.resolve(args.primaryClientDiagnosticsPath)
    : resolveLatestMatchingJsonFile(DEFAULT_RELEASE_READINESS_DIR, (entry) =>
        entry.startsWith("cocos-primary-client-diagnostic-snapshots-")
      );
  const resolvedReconnectSoakPath = args.reconnectSoakPath
    ? path.resolve(args.reconnectSoakPath)
    : resolveLatestMatchingJsonFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("colyseus-reconnect-soak-summary"));
  const resolvedPersistencePath = args.persistencePath
    ? path.resolve(args.persistencePath)
    : resolveLatestMatchingJsonFile(DEFAULT_RELEASE_READINESS_DIR, (entry) => entry.startsWith("phase1-release-persistence-regression-"));
  const wechatArtifacts = resolveWechatArtifacts(args);

  const snapshot = readJsonFile<ReleaseReadinessSnapshot>(resolvedSnapshotPath);
  const cocosRcSnapshot = readJsonFile<CocosReleaseCandidateSnapshot>(resolvedCocosRcPath);
  const primaryClientDiagnostics = readJsonFile<PrimaryClientDiagnosticSnapshotsArtifact>(resolvedPrimaryClientDiagnosticsPath);
  const reconnectSoakArtifact = readJsonFile<ReconnectSoakArtifact>(resolvedReconnectSoakPath);
  const persistenceArtifact = readJsonFile<Phase1PersistenceReleaseReport>(resolvedPersistencePath);
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
  const primaryClientDiagnosticsSummary = summarizePrimaryClientDiagnostics(
    resolvedPrimaryClientDiagnosticsPath,
    primaryClientDiagnostics
  );
  const reconnectSoakSummary = summarizeReconnectSoak(resolvedReconnectSoakPath, reconnectSoakArtifact, args.maxEvidenceAgeDays);
  const persistenceSummary = summarizePhase1Persistence(resolvedPersistencePath, persistenceArtifact, args.maxEvidenceAgeDays);

  const criticalEvidenceGate = buildCriticalEvidenceGate(args.maxEvidenceAgeDays, [
    snapshotSummary.evidence,
    packageSummary.evidence,
    smokeSummary.evidence,
    cocosRcSummary.evidence,
    primaryClientDiagnosticsSummary.evidence,
    reconnectSoakSummary.evidence,
    persistenceSummary.evidence
  ]);

  const gates = [
    buildHealthGate(args.serverUrl, healthPayload, metricsText, healthError ?? metricsError),
    buildAuthGate(args.serverUrl, authPayload, authError),
    buildBuildPackageGate(snapshotSummary, packageSummary, smokeSummary),
    buildArtifactGate(
      "reconnect-soak",
      "Reconnect soak evidence",
      reconnectSoakSummary,
      "Reconnect soak evidence passed with clean room teardown.",
      "Reconnect soak evidence exists, but freshness needs review.",
      "Reconnect soak evidence is missing or failing."
    ),
    buildArtifactGate(
      "phase1-persistence",
      "Phase 1 persistence evidence",
      persistenceSummary,
      "Phase 1 persistence regression and shipped content validation passed.",
      "Phase 1 persistence evidence exists, but freshness needs review.",
      "Phase 1 persistence evidence is missing or failing."
    ),
    criticalEvidenceGate
  ];

  const report: DashboardReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    overallStatus: mergeStatuses(gates.map((gate) => gate.status)),
    summary: buildOverallSummary(gates),
    goNoGo: buildGoNoGoReport({
      candidateRevision: args.candidateRevision,
      maxEvidenceAgeDays: args.maxEvidenceAgeDays,
      snapshot,
      gates,
      evidence: criticalEvidenceGate.evidence
    }),
    inputs: {
      ...(args.serverUrl ? { serverUrl: args.serverUrl } : {}),
      ...(resolvedSnapshotPath ? { snapshotPath: resolvedSnapshotPath } : {}),
      ...(resolvedCocosRcPath ? { cocosRcPath: resolvedCocosRcPath } : {}),
      ...(resolvedPrimaryClientDiagnosticsPath ? { primaryClientDiagnosticsPath: resolvedPrimaryClientDiagnosticsPath } : {}),
      ...(resolvedReconnectSoakPath ? { reconnectSoakPath: resolvedReconnectSoakPath } : {}),
      ...(resolvedPersistencePath ? { persistencePath: resolvedPersistencePath } : {}),
      ...(args.wechatArtifactsDir ? { wechatArtifactsDir: path.resolve(args.wechatArtifactsDir) } : {}),
      ...(wechatArtifacts.smokeReportPath ? { wechatSmokeReportPath: wechatArtifacts.smokeReportPath } : {}),
      ...(wechatArtifacts.packageMetadataPath ? { wechatPackageMetadataPath: wechatArtifacts.packageMetadataPath } : {}),
      ...(args.candidateRevision ? { candidateRevision: args.candidateRevision } : {})
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
  console.log(`Go/No-Go decision: ${report.goNoGo.decision}`);
  console.log(`Required failed: ${report.goNoGo.requiredFailed}`);
  console.log(`Required pending: ${report.goNoGo.requiredPending}`);
  console.log(`Candidate revision: ${report.goNoGo.candidateRevision ?? "<unverified>"}`);
  for (const finding of report.goNoGo.candidateConsistencyFindings) {
    console.log(`! Candidate consistency: ${finding.summary} (${toRelativePath(path.resolve(finding.path))})`);
  }
  for (const gate of report.gates) {
    console.log(`- ${gate.label}: ${gate.status} (${gate.summary})`);
  }
  if (report.goNoGo.candidateConsistencyFindings.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
