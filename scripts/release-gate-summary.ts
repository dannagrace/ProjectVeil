import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type GateStatus = "passed" | "failed";
type TargetSurface = "h5" | "wechat";
type EvidenceFreshness = "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp" | "unknown";

interface Args {
  snapshotPath?: string;
  h5SmokePath?: string;
  reconnectSoakPath?: string;
  wechatRcValidationPath?: string;
  wechatCandidateSummaryPath?: string;
  wechatSmokeReportPath?: string;
  wechatArtifactsDir?: string;
  configCenterLibraryPath?: string;
  targetSurface: TargetSurface;
  outputPath?: string;
  markdownOutputPath?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface ReleaseReadinessSnapshot {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  summary?: {
    status?: "passed" | "failed" | "pending" | "partial";
    requiredFailed?: number;
    requiredPending?: number;
  };
  checks?: Array<{
    id?: string;
    title?: string;
    status?: "passed" | "failed" | "pending" | "not_applicable";
    required?: boolean;
  }>;
}

interface ReleaseCandidateClientArtifactSmokeReport {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  execution?: {
    status?: "passed" | "failed";
    exitCode?: number;
    finishedAt?: string;
  };
  summary?: {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
    flaky?: number;
  };
}

interface WechatRcValidationReport {
  generatedAt?: string;
  commit?: string | null;
  summary?: {
    status?: "passed" | "failed";
    failedChecks?: number;
    failureSummary?: string[];
  };
  checks?: Array<{
    id?: string;
    status?: "passed" | "failed" | "skipped";
    required?: boolean;
    summary?: string;
  }>;
}

interface WechatReleaseCandidateSummary {
  generatedAt?: string;
  candidate?: {
    revision?: string | null;
    status?: "ready" | "blocked";
  };
  evidence?: {
    smoke?: {
      status?: "passed" | "failed" | "skipped";
      artifactPath?: string;
    };
    manualReview?: {
      status?: "ready" | "blocked";
      requiredPendingChecks?: number;
      requiredFailedChecks?: number;
      requiredMetadataFailures?: number;
      checks?: Array<{
        id?: string;
        title?: string;
        required?: boolean;
        status?: "passed" | "failed" | "pending" | "not_applicable";
        notes?: string;
        evidence?: string[];
        owner?: string;
        recordedAt?: string;
        revision?: string;
        artifactPath?: string;
        blockerIds?: string[];
        waiver?: {
          approvedBy?: string;
          approvedAt?: string;
          reason?: string;
          expiresAt?: string;
        };
      }>;
    };
  };
  blockers?: Array<{
    id?: string;
    summary?: string;
    artifactPath?: string;
    nextCommand?: string;
  }>;
}

interface WechatSmokeReport {
  artifact?: {
    sourceRevision?: string;
  };
  execution?: {
    executedAt?: string;
    result?: "pending" | "blocked" | "passed" | "failed";
    summary?: string;
  };
  cases?: Array<{
    id?: string;
    status?: "pending" | "blocked" | "passed" | "failed" | "not_applicable";
    required?: boolean;
  }>;
}

interface GateSource {
  kind:
    | "release-readiness-snapshot"
    | "h5-release-candidate-smoke"
    | "reconnect-soak"
    | "wechat-rc-validation"
    | "wechat-release-candidate-summary"
    | "wechat-smoke-report";
  path: string;
}

interface GateResult {
  id: "release-readiness" | "h5-release-candidate-smoke" | "multiplayer-reconnect-soak" | "wechat-release" | "phase1-evidence-consistency";
  label: string;
  status: GateStatus;
  required: boolean;
  summary: string;
  failures: string[];
  source?: GateSource;
}

interface Phase1EvidenceReference {
  gateId: "release-readiness" | "h5-release-candidate-smoke" | "multiplayer-reconnect-soak" | "wechat-release";
  label: string;
  source: GateSource;
  commit?: string;
  generatedAt?: string;
  candidateHint?: string;
}

interface ReleaseSurfaceEvidenceItem {
  id: string;
  label: string;
  required: boolean;
  status: GateStatus;
  summary: string;
  freshness: EvidenceFreshness;
  observedAt?: string;
  owner?: string;
  revision?: string;
  artifactPath?: string;
  blockerIds: string[];
  waiverReason?: string;
}

interface ReleaseSurfaceContract {
  targetSurface: TargetSurface;
  status: GateStatus;
  summary: string;
  evidence: ReleaseSurfaceEvidenceItem[];
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

type ConfigDocumentId = "world" | "mapObjects" | "units" | "battleSkills" | "battleBalance";
type ConfigRiskLevel = "low" | "medium" | "high";

interface ConfigDiffEntry {
  path: string;
  kind?: "value" | "field_added" | "field_removed" | "type_changed" | "enum_changed";
  blastRadius?: string[];
}

interface ConfigPublishAuditChange {
  documentId: ConfigDocumentId;
  title?: string;
  changeCount?: number;
  structuralChangeCount?: number;
  diffSummary?: ConfigDiffEntry[];
}

interface ConfigPublishAuditEvent {
  id: string;
  author?: string;
  summary?: string;
  publishedAt: string;
  resultStatus?: "applied" | "failed";
  changes?: ConfigPublishAuditChange[];
}

interface ConfigCenterLibraryState {
  publishAuditHistory?: ConfigPublishAuditEvent[];
}

interface ConfigRiskChangeSummary {
  documentId: ConfigDocumentId;
  title: string;
  riskLevel: ConfigRiskLevel;
  reason: string;
  changeCount: number;
  structuralChangeCount: number;
  impactedModules: string[];
  suggestedValidationActions: string[];
  highlightedPaths: string[];
  recommendCanary: boolean;
  recommendRehearsal: boolean;
}

interface ConfigChangeRiskSummary {
  status: "available" | "missing";
  summary: string;
  source?: {
    path: string;
    publishId: string;
    publishedAt: string;
    author: string;
    releaseSummary: string;
  };
  overallRisk?: ConfigRiskLevel;
  recommendCanary?: boolean;
  recommendRehearsal?: boolean;
  impactedModules?: string[];
  suggestedValidationActions?: string[];
  changes?: ConfigRiskChangeSummary[];
}

interface ReleaseGateSummaryReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  targetSurface: TargetSurface;
  summary: {
    status: GateStatus;
    totalGates: number;
    passedGates: number;
    failedGates: number;
    failedGateIds: string[];
  };
  inputs: {
    snapshotPath?: string;
    h5SmokePath?: string;
    reconnectSoakPath?: string;
    wechatRcValidationPath?: string;
    wechatCandidateSummaryPath?: string;
    wechatSmokeReportPath?: string;
    wechatArtifactsDir?: string;
    configCenterLibraryPath?: string;
  };
  gates: GateResult[];
  releaseSurface: ReleaseSurfaceContract;
  configChangeRisk: ConfigChangeRiskSummary;
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_WECHAT_ARTIFACTS_DIR = path.resolve("artifacts", "wechat-release");
const DEFAULT_CONFIG_CENTER_LIBRARY_PATH = path.resolve("configs", ".config-center-library.json");
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;
const MAX_PHASE1_EVIDENCE_TIMESTAMP_DRIFT_MS = 1000 * 60 * 60 * 72;
const MAX_TARGET_SURFACE_REVIEW_AGE_MS = 1000 * 60 * 60 * 24;
const RISK_PRIORITY: Record<ConfigRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3
};
const CONFIG_TITLE_BY_ID: Record<ConfigDocumentId, string> = {
  world: "World generation",
  mapObjects: "Map objects",
  units: "Units",
  battleSkills: "Battle skills",
  battleBalance: "Battle balance"
};
const CONFIG_RISK_RULES: Record<
  ConfigDocumentId,
  {
    defaultRisk: ConfigRiskLevel;
    title: string;
    impactedModules: string[];
    suggestedValidationActions: string[];
    recommendCanary: boolean;
    recommendRehearsal: boolean;
  }
> = {
  world: {
    defaultRisk: "high",
    title: "World generation",
    impactedModules: ["地图生成", "英雄出生点", "资源分布"],
    suggestedValidationActions: [
      "config-center 地图预览: 核对 seed 下地形/资源/出生点分布",
      "npm run release:readiness:snapshot",
      "npm run smoke:client:release-candidate"
    ],
    recommendCanary: true,
    recommendRehearsal: true
  },
  mapObjects: {
    defaultRisk: "medium",
    title: "Map objects",
    impactedModules: ["地图 POI", "招募库存", "资源矿收益"],
    suggestedValidationActions: [
      "config-center 地图预览: 核对建筑/守军/资源点布局",
      "npm run release:readiness:snapshot",
      "npm run smoke:client:release-candidate"
    ],
    recommendCanary: true,
    recommendRehearsal: false
  },
  units: {
    defaultRisk: "medium",
    title: "Units",
    impactedModules: ["单位数值", "招募库存", "战斗节奏"],
    suggestedValidationActions: [
      "npm run validate:content-pack",
      "npm run validate:battle",
      "npm run smoke:client:release-candidate"
    ],
    recommendCanary: true,
    recommendRehearsal: false
  },
  battleSkills: {
    defaultRisk: "high",
    title: "Battle skills",
    impactedModules: ["战斗技能", "状态效果", "伤害结算"],
    suggestedValidationActions: [
      "npm run validate:content-pack",
      "npm run validate:battle",
      "npm run smoke:client:release-candidate"
    ],
    recommendCanary: true,
    recommendRehearsal: true
  },
  battleBalance: {
    defaultRisk: "high",
    title: "Battle balance",
    impactedModules: ["战斗公式", "环境机关", "PVP ELO"],
    suggestedValidationActions: [
      "npm run validate:battle",
      "npm run release:readiness:snapshot",
      "npm run smoke:client:release-candidate"
    ],
    recommendCanary: true,
    recommendRehearsal: true
  }
};

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let snapshotPath: string | undefined;
  let h5SmokePath: string | undefined;
  let reconnectSoakPath: string | undefined;
  let wechatRcValidationPath: string | undefined;
  let wechatCandidateSummaryPath: string | undefined;
  let wechatSmokeReportPath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let configCenterLibraryPath: string | undefined;
  let targetSurface: TargetSurface = "wechat";
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--snapshot" && next) {
      snapshotPath = next;
      index += 1;
      continue;
    }
    if (arg === "--h5-smoke" && next) {
      h5SmokePath = next;
      index += 1;
      continue;
    }
    if (arg === "--reconnect-soak" && next) {
      reconnectSoakPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-rc-validation" && next) {
      wechatRcValidationPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-candidate-summary" && next) {
      wechatCandidateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-smoke-report" && next) {
      wechatSmokeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-artifacts-dir" && next) {
      wechatArtifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--config-center-library" && next) {
      configCenterLibraryPath = next;
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

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(h5SmokePath ? { h5SmokePath } : {}),
    ...(reconnectSoakPath ? { reconnectSoakPath } : {}),
    ...(wechatRcValidationPath ? { wechatRcValidationPath } : {}),
    ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath } : {}),
    ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(configCenterLibraryPath ? { configCenterLibraryPath } : {}),
    targetSurface,
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {})
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function resolveLatestFile(dirPath: string, matcher: (entry: string) => boolean): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }

  const candidates = fs
    .readdirSync(dirPath)
    .filter((entry) => matcher(entry))
    .map((entry) => path.join(dirPath, entry))
    .filter((entry) => fs.statSync(entry).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  return candidates[0];
}

function resolveSnapshotPath(args: Args): string | undefined {
  if (args.snapshotPath) {
    return path.resolve(args.snapshotPath);
  }
  return resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) =>
    entry.startsWith("release-readiness-") && entry.endsWith(".json")
  );
}

function resolveH5SmokePath(args: Args): string | undefined {
  if (args.h5SmokePath) {
    return path.resolve(args.h5SmokePath);
  }
  return resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) =>
    entry.startsWith("client-release-candidate-smoke-") && entry.endsWith(".json")
  );
}

function resolveReconnectSoakPath(args: Args): string | undefined {
  if (args.reconnectSoakPath) {
    return path.resolve(args.reconnectSoakPath);
  }
  const fixedCandidate = path.join(DEFAULT_RELEASE_READINESS_DIR, "colyseus-reconnect-soak-summary.json");
  if (fs.existsSync(fixedCandidate)) {
    return fixedCandidate;
  }
  return resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (entry) =>
    entry.startsWith("colyseus-reconnect-soak-summary") && entry.endsWith(".json")
  );
}

function resolveWechatArtifactsDir(args: Args): string | undefined {
  if (args.wechatArtifactsDir) {
    return path.resolve(args.wechatArtifactsDir);
  }
  if (fs.existsSync(DEFAULT_WECHAT_ARTIFACTS_DIR)) {
    return DEFAULT_WECHAT_ARTIFACTS_DIR;
  }
  return undefined;
}

function resolveWechatRcValidationPath(args: Args, wechatArtifactsDir?: string): string | undefined {
  if (args.wechatRcValidationPath) {
    return path.resolve(args.wechatRcValidationPath);
  }
  if (!wechatArtifactsDir) {
    return undefined;
  }
  const candidate = path.join(wechatArtifactsDir, "codex.wechat.rc-validation-report.json");
  return fs.existsSync(candidate) ? candidate : undefined;
}

function resolveWechatCandidateSummaryPath(args: Args, wechatArtifactsDir?: string): string | undefined {
  if (args.wechatCandidateSummaryPath) {
    return path.resolve(args.wechatCandidateSummaryPath);
  }
  if (!wechatArtifactsDir) {
    return undefined;
  }
  const candidate = path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json");
  return fs.existsSync(candidate) ? candidate : undefined;
}

function resolveWechatSmokeReportPath(args: Args, wechatArtifactsDir?: string): string | undefined {
  if (args.wechatSmokeReportPath) {
    return path.resolve(args.wechatSmokeReportPath);
  }
  if (!wechatArtifactsDir) {
    return undefined;
  }
  const candidate = path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json");
  return fs.existsSync(candidate) ? candidate : undefined;
}

function resolveConfigCenterLibraryPath(args: Args): string | undefined {
  const candidate = args.configCenterLibraryPath
    ? path.resolve(args.configCenterLibraryPath)
    : DEFAULT_CONFIG_CENTER_LIBRARY_PATH;
  return fs.existsSync(candidate) ? candidate : undefined;
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

function getRevision(): GitRevision {
  return {
    commit: readGitValue(["rev-parse", "HEAD"]),
    shortCommit: readGitValue(["rev-parse", "--short", "HEAD"]),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--porcelain"]).length > 0
  };
}

function missingGate(
  id: GateResult["id"],
  label: string,
  summary: string,
  failures: string[],
  required = true
): GateResult {
  return {
    id,
    label,
    required,
    status: "failed",
    summary,
    failures
  };
}

export function evaluateReleaseReadinessGate(
  snapshotPath: string | undefined
): GateResult {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    return missingGate(
      "release-readiness",
      "Release readiness snapshot",
      "Missing release readiness snapshot.",
      ["Snapshot artifact was not found."]
    );
  }

  const snapshot = readJsonFile<ReleaseReadinessSnapshot>(snapshotPath);
  const failures: string[] = [];
  const requiredChecks = (snapshot.checks ?? []).filter((check) => check.required !== false);
  const failedRequiredChecks = requiredChecks.filter((check) => check.status === "failed");
  const pendingRequiredChecks = requiredChecks.filter((check) => check.status === "pending");

  if (snapshot.summary?.status !== "passed") {
    failures.push(`Snapshot summary status is ${JSON.stringify(snapshot.summary?.status ?? "missing")}.`);
  }
  if ((snapshot.summary?.requiredFailed ?? 0) > 0) {
    failures.push(`Snapshot reports ${snapshot.summary?.requiredFailed} required failed check(s).`);
  }
  if ((snapshot.summary?.requiredPending ?? 0) > 0) {
    failures.push(`Snapshot reports ${snapshot.summary?.requiredPending} required pending check(s).`);
  }
  for (const check of failedRequiredChecks) {
    failures.push(`Required snapshot check failed: ${check.id ?? check.title ?? "unknown-check"}.`);
  }
  for (const check of pendingRequiredChecks) {
    failures.push(`Required snapshot check is still pending: ${check.id ?? check.title ?? "unknown-check"}.`);
  }

  return {
    id: "release-readiness",
    label: "Release readiness snapshot",
    required: true,
    status: failures.length === 0 ? "passed" : "failed",
    summary:
      failures.length === 0
        ? `Snapshot passed with ${requiredChecks.length} required checks satisfied.`
        : `Snapshot is not release-ready: ${failures[0]}`,
    failures,
    source: {
      kind: "release-readiness-snapshot",
      path: snapshotPath
    }
  };
}

export function evaluateH5SmokeGate(h5SmokePath: string | undefined): GateResult {
  if (!h5SmokePath || !fs.existsSync(h5SmokePath)) {
    return missingGate(
      "h5-release-candidate-smoke",
      "H5 packaged RC smoke",
      "Missing H5 packaged RC smoke report.",
      ["H5 packaged release-candidate smoke artifact was not found."]
    );
  }

  const report = readJsonFile<ReleaseCandidateClientArtifactSmokeReport>(h5SmokePath);
  const failures: string[] = [];

  if (report.execution?.status !== "passed") {
    failures.push(`H5 smoke execution status is ${JSON.stringify(report.execution?.status ?? "missing")}.`);
  }
  if ((report.summary?.failed ?? 0) > 0) {
    failures.push(`H5 smoke reports ${report.summary?.failed} failed case(s).`);
  }

  return {
    id: "h5-release-candidate-smoke",
    label: "H5 packaged RC smoke",
    required: true,
    status: failures.length === 0 ? "passed" : "failed",
    summary:
      failures.length === 0
        ? `H5 packaged RC smoke passed ${report.summary?.passed ?? 0}/${report.summary?.total ?? 0} cases.`
        : `H5 packaged RC smoke failed: ${failures[0]}`,
    failures,
    source: {
      kind: "h5-release-candidate-smoke",
      path: h5SmokePath
    }
  };
}

export function evaluateReconnectSoakGate(reconnectSoakPath: string | undefined): GateResult {
  if (!reconnectSoakPath || !fs.existsSync(reconnectSoakPath)) {
    return missingGate(
      "multiplayer-reconnect-soak",
      "Multiplayer reconnect soak",
      "Missing multiplayer reconnect soak artifact.",
      ["Reconnect soak artifact was not found."]
    );
  }

  const report = readJsonFile<ReconnectSoakArtifact>(reconnectSoakPath);
  const failures: string[] = [];
  const reconnectSoakResult = report.results?.find((entry) => entry.scenario === "reconnect_soak");
  const cleanup = reconnectSoakResult?.runtimeHealthAfterCleanup;

  if (report.status !== "passed") {
    failures.push(`Reconnect soak artifact status is ${JSON.stringify(report.status ?? "missing")}.`);
  }
  if ((report.summary?.failedScenarios ?? 0) > 0) {
    failures.push(`Reconnect soak artifact reports ${report.summary?.failedScenarios} failed scenario(s).`);
  }
  if (!report.summary?.scenarioNames?.includes("reconnect_soak")) {
    failures.push("Reconnect soak artifact does not include the reconnect_soak scenario.");
  }
  if (!reconnectSoakResult) {
    failures.push("Reconnect soak result is missing from the artifact.");
  }
  if ((reconnectSoakResult?.failedRooms ?? 0) > 0) {
    failures.push(`Reconnect soak reports ${reconnectSoakResult?.failedRooms} failed room(s).`);
  }
  if ((report.soakSummary?.reconnectAttempts ?? 0) <= 0) {
    failures.push("Reconnect soak artifact did not record any reconnect attempts.");
  }
  if ((report.soakSummary?.invariantChecks ?? 0) <= 0) {
    failures.push("Reconnect soak artifact did not record any invariant checks.");
  }
  if (!cleanup) {
    failures.push("Reconnect soak cleanup counters are missing.");
  } else {
    if (cleanup.activeRoomCount !== 0) {
      failures.push(`Reconnect soak cleanup left ${cleanup.activeRoomCount} active room(s).`);
    }
    if (cleanup.connectionCount !== 0) {
      failures.push(`Reconnect soak cleanup left ${cleanup.connectionCount} live connection(s).`);
    }
    if (cleanup.activeBattleCount !== 0) {
      failures.push(`Reconnect soak cleanup left ${cleanup.activeBattleCount} active battle(s).`);
    }
    if (cleanup.heroCount !== 0) {
      failures.push(`Reconnect soak cleanup left ${cleanup.heroCount} hero snapshot(s) in active rooms.`);
    }
  }

  const cleanupSummary = cleanup
    ? `cleanup rooms=${cleanup.activeRoomCount} connections=${cleanup.connectionCount} battles=${cleanup.activeBattleCount}`
    : "cleanup counters missing";

  return {
    id: "multiplayer-reconnect-soak",
    label: "Multiplayer reconnect soak",
    required: true,
    status: failures.length === 0 ? "passed" : "failed",
    summary:
      failures.length === 0
        ? `Reconnect soak passed ${report.soakSummary?.reconnectAttempts ?? 0} reconnects and ${report.soakSummary?.invariantChecks ?? 0} invariant checks; ${cleanupSummary}.`
        : `Reconnect soak gate failed: ${failures[0]}`,
    failures,
    source: {
      kind: "reconnect-soak",
      path: reconnectSoakPath
    }
  };
}

export function evaluateWechatGate(
  targetSurface: TargetSurface,
  wechatRcValidationPath: string | undefined,
  wechatCandidateSummaryPath: string | undefined,
  wechatSmokeReportPath: string | undefined
): GateResult {
  const required = targetSurface === "wechat";
  if (wechatCandidateSummaryPath && fs.existsSync(wechatCandidateSummaryPath)) {
    const summary = readJsonFile<WechatReleaseCandidateSummary>(wechatCandidateSummaryPath);
    const failures: string[] = [];

    if (summary.candidate?.status !== "ready") {
      failures.push(`WeChat candidate summary status is ${JSON.stringify(summary.candidate?.status ?? "missing")}.`);
    }
    if (summary.evidence?.smoke?.status !== "passed") {
      failures.push(`WeChat candidate smoke evidence is ${JSON.stringify(summary.evidence?.smoke?.status ?? "missing")}.`);
    }
    if (summary.evidence?.manualReview?.status !== "ready") {
      failures.push(`WeChat manual review status is ${JSON.stringify(summary.evidence?.manualReview?.status ?? "missing")}.`);
    }
    if ((summary.evidence?.manualReview?.requiredPendingChecks ?? 0) > 0) {
      failures.push(`WeChat manual review reports ${summary.evidence?.manualReview?.requiredPendingChecks} required pending check(s).`);
    }
    if ((summary.evidence?.manualReview?.requiredFailedChecks ?? 0) > 0) {
      failures.push(`WeChat manual review reports ${summary.evidence?.manualReview?.requiredFailedChecks} required failed check(s).`);
    }
    if ((summary.evidence?.manualReview?.requiredMetadataFailures ?? 0) > 0) {
      failures.push(
        `WeChat manual review reports ${summary.evidence?.manualReview?.requiredMetadataFailures} metadata freshness or ownership failure(s).`
      );
    }
    for (const blocker of summary.blockers ?? []) {
      if (blocker.summary?.trim()) {
        failures.push(blocker.summary.trim());
      }
    }

    return {
      id: "wechat-release",
      label: "WeChat release validation",
      required,
      status: failures.length === 0 ? "passed" : "failed",
      summary:
        failures.length === 0
          ? "WeChat candidate summary passed."
          : `WeChat candidate summary failed: ${failures[0]}`,
      failures,
      source: {
        kind: "wechat-release-candidate-summary",
        path: wechatCandidateSummaryPath
      }
    };
  }

  if (wechatRcValidationPath && fs.existsSync(wechatRcValidationPath)) {
    const report = readJsonFile<WechatRcValidationReport>(wechatRcValidationPath);
    const failures: string[] = [];

    if (report.summary?.status !== "passed") {
      failures.push(`WeChat RC validation status is ${JSON.stringify(report.summary?.status ?? "missing")}.`);
    }
    if ((report.summary?.failedChecks ?? 0) > 0) {
      failures.push(`WeChat RC validation reports ${report.summary?.failedChecks} failed check(s).`);
    }
    for (const line of report.summary?.failureSummary ?? []) {
      failures.push(line);
    }

    return {
      id: "wechat-release",
      label: "WeChat release validation",
      required,
      status: failures.length === 0 ? "passed" : "failed",
      summary:
        failures.length === 0
          ? "WeChat RC validation passed."
          : `WeChat RC validation failed: ${failures[0]}`,
      failures,
      source: {
        kind: "wechat-rc-validation",
        path: wechatRcValidationPath
      }
    };
  }

  if (!wechatSmokeReportPath || !fs.existsSync(wechatSmokeReportPath)) {
    return missingGate(
      "wechat-release",
      "WeChat release validation",
      "Missing WeChat RC validation or smoke evidence.",
      ["Neither codex.wechat.release-candidate-summary.json, codex.wechat.rc-validation-report.json, nor codex.wechat.smoke-report.json was found."],
      required
    );
  }

  const report = readJsonFile<WechatSmokeReport>(wechatSmokeReportPath);
  const failures: string[] = [];
  const requiredCases = (report.cases ?? []).filter((entry) => entry.required !== false);
  const failedCases = requiredCases.filter((entry) => entry.status === "failed");
  const blockedCases = requiredCases.filter((entry) => entry.status === "blocked");
  const pendingCases = requiredCases.filter((entry) => entry.status === "pending");

  if (report.execution?.result !== "passed") {
    if (report.execution?.result === "blocked" || report.execution?.result === "pending" || report.execution?.result === undefined) {
      failures.push(`WeChat smoke evidence is blocked: execution result is ${JSON.stringify(report.execution?.result ?? "missing")}.`);
    } else {
      failures.push(`WeChat smoke execution result is ${JSON.stringify(report.execution?.result)}.`);
    }
  }
  for (const entry of failedCases) {
    failures.push(`WeChat smoke case failed: ${entry.id ?? "unknown-case"}.`);
  }
  for (const entry of blockedCases) {
    failures.push(`WeChat smoke case is blocked: ${entry.id ?? "unknown-case"}.`);
  }
  for (const entry of pendingCases) {
    failures.push(`WeChat smoke case is blocked pending device evidence: ${entry.id ?? "unknown-case"}.`);
  }

  const blocked = failures.some((entry) => entry.includes("blocked"));
  return {
    id: "wechat-release",
    label: "WeChat release validation",
    required,
    status: failures.length === 0 ? "passed" : "failed",
    summary:
      failures.length === 0
        ? `WeChat smoke report passed ${requiredCases.length} required cases.`
        : blocked
          ? `WeChat smoke report blocked: ${failures[0]}`
          : `WeChat smoke report failed: ${failures[0]}`,
    failures,
    source: {
      kind: "wechat-smoke-report",
      path: wechatSmokeReportPath
    }
  };
}

function normalizeCommit(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !HEX_REVISION_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function commitsMatch(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeCommit(left);
  const normalizedRight = normalizeCommit(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function relativeReportPath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function evaluateFreshness(timestamp: string | undefined, maxAgeMs: number): EvidenceFreshness {
  if (!timestamp?.trim()) {
    return "missing_timestamp";
  }
  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs)) {
    return "invalid_timestamp";
  }
  return Date.now() - timestampMs > maxAgeMs ? "stale" : "fresh";
}

function createSurfaceEvidenceItem(input: {
  id: string;
  label: string;
  required: boolean;
  status: GateStatus;
  summary: string;
  freshness?: EvidenceFreshness;
  observedAt?: string;
  owner?: string;
  revision?: string;
  artifactPath?: string;
  blockerIds?: string[];
  waiverReason?: string;
}): ReleaseSurfaceEvidenceItem {
  return {
    id: input.id,
    label: input.label,
    required: input.required,
    status: input.status,
    summary: input.summary,
    freshness: input.freshness ?? "unknown",
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
    ...(input.owner ? { owner: input.owner } : {}),
    ...(input.revision ? { revision: input.revision } : {}),
    ...(input.artifactPath ? { artifactPath: input.artifactPath } : {}),
    blockerIds: input.blockerIds ?? [],
    ...(input.waiverReason ? { waiverReason: input.waiverReason } : {})
  };
}

function buildReleaseSurfaceContract(
  targetSurface: TargetSurface,
  snapshotPath: string | undefined,
  h5SmokePath: string | undefined,
  reconnectSoakPath: string | undefined,
  wechatCandidateSummaryPath: string | undefined
): ReleaseSurfaceContract {
  const evidence: ReleaseSurfaceEvidenceItem[] = [];

  evidence.push(
    createSurfaceEvidenceItem({
      id: "release-readiness",
      label: "Release readiness snapshot",
      required: true,
      status: snapshotPath && fs.existsSync(snapshotPath) ? "passed" : "failed",
      summary: snapshotPath && fs.existsSync(snapshotPath) ? "Found release readiness snapshot." : "Release readiness snapshot is missing.",
      freshness: snapshotPath && fs.existsSync(snapshotPath)
        ? evaluateFreshness(readJsonFile<ReleaseReadinessSnapshot>(snapshotPath).generatedAt, MAX_PHASE1_EVIDENCE_TIMESTAMP_DRIFT_MS)
        : "unknown",
      observedAt: snapshotPath && fs.existsSync(snapshotPath) ? readJsonFile<ReleaseReadinessSnapshot>(snapshotPath).generatedAt : undefined,
      artifactPath: snapshotPath
    })
  );

  evidence.push(
    createSurfaceEvidenceItem({
      id: "h5-release-candidate-smoke",
      label: "H5 packaged RC smoke",
      required: true,
      status: h5SmokePath && fs.existsSync(h5SmokePath) ? "passed" : "failed",
      summary: h5SmokePath && fs.existsSync(h5SmokePath) ? "Found H5 packaged RC smoke evidence." : "H5 packaged RC smoke evidence is missing.",
      freshness: h5SmokePath && fs.existsSync(h5SmokePath)
        ? evaluateFreshness(
            readJsonFile<ReleaseCandidateClientArtifactSmokeReport>(h5SmokePath).execution?.finishedAt ??
              readJsonFile<ReleaseCandidateClientArtifactSmokeReport>(h5SmokePath).generatedAt,
            MAX_PHASE1_EVIDENCE_TIMESTAMP_DRIFT_MS
          )
        : "unknown",
      observedAt: h5SmokePath && fs.existsSync(h5SmokePath)
        ? readJsonFile<ReleaseCandidateClientArtifactSmokeReport>(h5SmokePath).execution?.finishedAt ??
          readJsonFile<ReleaseCandidateClientArtifactSmokeReport>(h5SmokePath).generatedAt
        : undefined,
      artifactPath: h5SmokePath
    })
  );

  evidence.push(
    createSurfaceEvidenceItem({
      id: "multiplayer-reconnect-soak",
      label: "Multiplayer reconnect soak",
      required: true,
      status: reconnectSoakPath && fs.existsSync(reconnectSoakPath) ? "passed" : "failed",
      summary: reconnectSoakPath && fs.existsSync(reconnectSoakPath) ? "Found reconnect soak evidence." : "Reconnect soak evidence is missing.",
      freshness: reconnectSoakPath && fs.existsSync(reconnectSoakPath)
        ? evaluateFreshness(readJsonFile<ReconnectSoakArtifact>(reconnectSoakPath).generatedAt, MAX_PHASE1_EVIDENCE_TIMESTAMP_DRIFT_MS)
        : "unknown",
      observedAt: reconnectSoakPath && fs.existsSync(reconnectSoakPath)
        ? readJsonFile<ReconnectSoakArtifact>(reconnectSoakPath).generatedAt
        : undefined,
      artifactPath: reconnectSoakPath
    })
  );

  if (targetSurface === "wechat") {
    if (!wechatCandidateSummaryPath || !fs.existsSync(wechatCandidateSummaryPath)) {
      evidence.push(
        createSurfaceEvidenceItem({
          id: "wechat-candidate-summary",
          label: "WeChat candidate summary",
          required: true,
          status: "failed",
          summary: "WeChat candidate summary is missing.",
          artifactPath: wechatCandidateSummaryPath
        })
      );
    } else {
      const summary = readJsonFile<WechatReleaseCandidateSummary>(wechatCandidateSummaryPath);
      evidence.push(
        createSurfaceEvidenceItem({
          id: "wechat-candidate-summary",
          label: "WeChat candidate summary",
          required: true,
          status: summary.candidate?.status === "ready" ? "passed" : "failed",
          summary:
            summary.candidate?.status === "ready"
              ? "WeChat candidate summary is ready for release review."
              : `WeChat candidate summary is ${JSON.stringify(summary.candidate?.status ?? "missing")}.`,
          freshness: evaluateFreshness(summary.generatedAt, MAX_PHASE1_EVIDENCE_TIMESTAMP_DRIFT_MS),
          observedAt: summary.generatedAt,
          revision: summary.candidate?.revision ?? undefined,
          artifactPath: wechatCandidateSummaryPath
        })
      );

      for (const check of summary.evidence?.manualReview?.checks ?? []) {
        if (check.required === false) {
          continue;
        }
        const freshness = evaluateFreshness(check.recordedAt, MAX_TARGET_SURFACE_REVIEW_AGE_MS);
        const metadataFailures = [
          !check.owner?.trim() ? "owner missing" : "",
          !check.revision?.trim() ? "revision missing" : "",
          freshness !== "fresh" ? `freshness=${freshness}` : ""
        ].filter((value) => value.length > 0);
        evidence.push(
          createSurfaceEvidenceItem({
            id: `manual:${check.id ?? "unknown"}`,
            label: check.title ?? check.id ?? "WeChat manual review",
            required: true,
            status: check.status === "passed" && metadataFailures.length === 0 ? "passed" : "failed",
            summary:
              check.status === "passed" && metadataFailures.length === 0
                ? "Manual review is complete and current."
                : `${JSON.stringify(check.status ?? "missing")} (${metadataFailures.join(", ") || "review unresolved"})`,
            freshness,
            observedAt: check.recordedAt,
            owner: check.owner,
            revision: check.revision,
            artifactPath: check.artifactPath,
            blockerIds: check.blockerIds ?? [],
            waiverReason: check.waiver?.reason
          })
        );
      }
    }
  }

  const failures = evidence.filter(
    (entry) => entry.required && (entry.status === "failed" || entry.freshness === "stale" || entry.freshness === "missing_timestamp" || entry.freshness === "invalid_timestamp")
  );

  return {
    targetSurface,
    status: failures.length === 0 ? "passed" : "failed",
    summary:
      failures.length === 0
        ? `Target surface ${targetSurface} has current required evidence.`
        : `Target surface ${targetSurface} is blocked: ${failures[0]?.label} -> ${failures[0]?.summary}`,
    evidence
  };
}

function deriveCandidateHint(filePath: string, commit: string | undefined): string | undefined {
  const normalizedCommit = normalizeCommit(commit);
  if (normalizedCommit) {
    return normalizedCommit.slice(0, 12);
  }

  const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const revisionMatch = baseName.match(/[a-f0-9]{7,40}/);
  if (revisionMatch) {
    return revisionMatch[0];
  }

  const candidateMatch = baseName.match(/(?:^|[-_.])(rc-[a-z0-9-]+|candidate-[a-z0-9-]+)(?:$|[-_.])/);
  return candidateMatch?.[1];
}

function formatEvidenceDescriptor(entry: Phase1EvidenceReference): string {
  const details = [
    entry.commit ? `commit ${entry.commit}` : "commit <missing>",
    entry.generatedAt ? `generatedAt ${entry.generatedAt}` : "generatedAt <missing>",
    `path ${relativeReportPath(entry.source.path)}`
  ];
  if (entry.candidateHint) {
    details.unshift(`candidate ${entry.candidateHint}`);
  }
  return `${entry.label} (${details.join(", ")})`;
}

function collectPhase1EvidenceReferences(
  targetSurface: TargetSurface,
  snapshotPath: string | undefined,
  h5SmokePath: string | undefined,
  reconnectSoakPath: string | undefined,
  wechatRcValidationPath: string | undefined,
  wechatCandidateSummaryPath: string | undefined,
  wechatSmokeReportPath: string | undefined
): Phase1EvidenceReference[] {
  const evidence: Phase1EvidenceReference[] = [];

  if (snapshotPath && fs.existsSync(snapshotPath)) {
    const snapshot = readJsonFile<ReleaseReadinessSnapshot>(snapshotPath);
    const commit = snapshot.revision?.commit ?? snapshot.revision?.shortCommit;
    evidence.push({
      gateId: "release-readiness",
      label: "Release readiness snapshot",
      source: {
        kind: "release-readiness-snapshot",
        path: snapshotPath
      },
      commit,
      generatedAt: snapshot.generatedAt,
      candidateHint: deriveCandidateHint(snapshotPath, commit)
    });
  }

  if (h5SmokePath && fs.existsSync(h5SmokePath)) {
    const report = readJsonFile<ReleaseCandidateClientArtifactSmokeReport>(h5SmokePath);
    const commit = report.revision?.commit ?? report.revision?.shortCommit;
    evidence.push({
      gateId: "h5-release-candidate-smoke",
      label: "H5 packaged RC smoke",
      source: {
        kind: "h5-release-candidate-smoke",
        path: h5SmokePath
      },
      commit,
      generatedAt: report.execution?.finishedAt ?? report.generatedAt,
      candidateHint: deriveCandidateHint(h5SmokePath, commit)
    });
  }

  if (reconnectSoakPath && fs.existsSync(reconnectSoakPath)) {
    const report = readJsonFile<ReconnectSoakArtifact>(reconnectSoakPath);
    const commit = report.revision?.commit ?? report.revision?.shortCommit;
    evidence.push({
      gateId: "multiplayer-reconnect-soak",
      label: "Multiplayer reconnect soak",
      source: {
        kind: "reconnect-soak",
        path: reconnectSoakPath
      },
      commit,
      generatedAt: report.generatedAt,
      candidateHint: deriveCandidateHint(reconnectSoakPath, commit)
    });
  }

  if (wechatCandidateSummaryPath && fs.existsSync(wechatCandidateSummaryPath)) {
    const report = readJsonFile<WechatReleaseCandidateSummary>(wechatCandidateSummaryPath);
    const commit = report.candidate?.revision ?? undefined;
    evidence.push({
      gateId: "wechat-release",
      label: "WeChat release validation",
      source: {
        kind: "wechat-release-candidate-summary",
        path: wechatCandidateSummaryPath
      },
      commit,
      generatedAt: report.generatedAt,
      candidateHint: deriveCandidateHint(wechatCandidateSummaryPath, commit)
    });
  } else if (wechatRcValidationPath && fs.existsSync(wechatRcValidationPath)) {
    const report = readJsonFile<WechatRcValidationReport>(wechatRcValidationPath);
    const commit = report.commit ?? undefined;
    evidence.push({
      gateId: "wechat-release",
      label: "WeChat release validation",
      source: {
        kind: "wechat-rc-validation",
        path: wechatRcValidationPath
      },
      commit,
      generatedAt: report.generatedAt,
      candidateHint: deriveCandidateHint(wechatRcValidationPath, commit)
    });
  } else if (targetSurface === "wechat" && wechatSmokeReportPath && fs.existsSync(wechatSmokeReportPath)) {
    const report = readJsonFile<WechatSmokeReport>(wechatSmokeReportPath);
    const commit = report.artifact?.sourceRevision;
    evidence.push({
      gateId: "wechat-release",
      label: "WeChat release validation",
      source: {
        kind: "wechat-smoke-report",
        path: wechatSmokeReportPath
      },
      commit,
      generatedAt: report.execution?.executedAt,
      candidateHint: deriveCandidateHint(wechatSmokeReportPath, commit)
    });
  }

  return evidence;
}

export function evaluatePhase1EvidenceConsistencyGate(
  targetSurface: TargetSurface,
  revision: GitRevision,
  snapshotPath: string | undefined,
  h5SmokePath: string | undefined,
  reconnectSoakPath: string | undefined,
  wechatRcValidationPath: string | undefined,
  wechatCandidateSummaryPath: string | undefined,
  wechatSmokeReportPath: string | undefined
): GateResult {
  const failures: string[] = [];
  const expectedArtifacts: Array<Pick<Phase1EvidenceReference, "gateId" | "label">> = [
    { gateId: "release-readiness", label: "Release readiness snapshot" },
    { gateId: "h5-release-candidate-smoke", label: "H5 packaged RC smoke" },
    { gateId: "multiplayer-reconnect-soak", label: "Multiplayer reconnect soak" },
    ...(targetSurface === "wechat" ? [{ gateId: "wechat-release" as const, label: "WeChat release validation" }] : [])
  ];
  const evidence = collectPhase1EvidenceReferences(
    targetSurface,
    snapshotPath,
    h5SmokePath,
    reconnectSoakPath,
    wechatRcValidationPath,
    wechatCandidateSummaryPath,
    wechatSmokeReportPath
  );
  const expectedCommit = revision.commit;
  const expectedCandidateHint = normalizeCommit(revision.commit)?.slice(0, 12) ?? revision.shortCommit.toLowerCase();

  for (const expected of expectedArtifacts) {
    if (!evidence.some((entry) => entry.gateId === expected.gateId)) {
      failures.push(`Phase 1 evidence is missing for ${expected.label}.`);
    }
  }

  for (const entry of evidence) {
    if (!normalizeCommit(entry.commit)) {
      failures.push(`Phase 1 evidence is missing revision metadata for ${entry.label} at ${relativeReportPath(entry.source.path)}.`);
      continue;
    }
    if (!commitsMatch(entry.commit, expectedCommit)) {
      failures.push(
        `Phase 1 evidence is stale for ${entry.label}: artifact commit ${entry.commit} at ${relativeReportPath(entry.source.path)} does not match candidate ${revision.shortCommit}.`
      );
    }
    if (entry.candidateHint && entry.candidateHint !== expectedCandidateHint && !commitsMatch(entry.candidateHint, expectedCommit)) {
      failures.push(
        `Phase 1 evidence candidate mismatch for ${entry.label}: candidate ${entry.candidateHint} from ${relativeReportPath(entry.source.path)} does not align with ${revision.shortCommit}.`
      );
    }
    if (!entry.generatedAt?.trim()) {
      failures.push(`Phase 1 evidence is missing a generated timestamp for ${entry.label} at ${relativeReportPath(entry.source.path)}.`);
      continue;
    }
    if (Number.isNaN(Date.parse(entry.generatedAt))) {
      failures.push(
        `Phase 1 evidence has an invalid generated timestamp for ${entry.label} at ${relativeReportPath(entry.source.path)}: ${entry.generatedAt}.`
      );
    }
  }

  for (let index = 0; index < evidence.length; index += 1) {
    const left = evidence[index];
    if (!left) {
      continue;
    }
    for (let innerIndex = index + 1; innerIndex < evidence.length; innerIndex += 1) {
      const right = evidence[innerIndex];
      if (!right) {
        continue;
      }
      if (!commitsMatch(left.commit, right.commit)) {
        failures.push(`Phase 1 evidence commit mismatch: ${formatEvidenceDescriptor(left)} vs ${formatEvidenceDescriptor(right)}.`);
      }
      if (left.candidateHint && right.candidateHint && left.candidateHint !== right.candidateHint && !commitsMatch(left.candidateHint, right.candidateHint)) {
        failures.push(
          `Phase 1 evidence candidate mismatch: ${left.label} uses ${left.candidateHint} at ${relativeReportPath(left.source.path)} vs ${right.label} uses ${right.candidateHint} at ${relativeReportPath(right.source.path)}.`
        );
      }
    }
  }

  const datedEvidence = evidence
    .map((entry) => {
      const generatedAtMs = entry.generatedAt ? Date.parse(entry.generatedAt) : Number.NaN;
      return Number.isNaN(generatedAtMs) ? undefined : { entry, generatedAtMs };
    })
    .filter((entry): entry is { entry: Phase1EvidenceReference; generatedAtMs: number } => Boolean(entry))
    .sort((left, right) => left.generatedAtMs - right.generatedAtMs);

  if (datedEvidence.length >= 2) {
    const oldest = datedEvidence[0];
    const newest = datedEvidence[datedEvidence.length - 1];
    const driftMs = newest.generatedAtMs - oldest.generatedAtMs;
    if (driftMs > MAX_PHASE1_EVIDENCE_TIMESTAMP_DRIFT_MS) {
      failures.push(
        `Phase 1 evidence timestamps drift by ${Math.round(driftMs / (1000 * 60 * 60))}h between ${relativeReportPath(oldest.entry.source.path)} (${oldest.entry.generatedAt}) and ${relativeReportPath(newest.entry.source.path)} (${newest.entry.generatedAt}); refresh evidence for one candidate revision.`
      );
    }
  }

  const uniqueCommitCount = new Set(evidence.map((entry) => normalizeCommit(entry.commit)).filter((entry): entry is string => Boolean(entry))).size;
  const summary =
    failures.length === 0
      ? `Phase 1 evidence matches candidate ${revision.shortCommit} across ${evidence.length} artifacts.`
      : `Phase 1 evidence drift detected: ${failures[0]}`;

  return {
    id: "phase1-evidence-consistency",
    label: "Phase 1 evidence consistency",
    required: true,
    status: failures.length === 0 ? "passed" : "failed",
    summary,
    failures: failures.length === 0 && uniqueCommitCount === 1 ? [] : failures,
    source: evidence[0]?.source
  };
}

function uniqueStrings(items: Iterable<string>): string[] {
  return Array.from(new Set([...items].filter((value) => value.length > 0)));
}

function maxRiskLevel(levels: Iterable<ConfigRiskLevel>): ConfigRiskLevel {
  let highest: ConfigRiskLevel = "low";
  for (const level of levels) {
    if (RISK_PRIORITY[level] > RISK_PRIORITY[highest]) {
      highest = level;
    }
  }
  return highest;
}

function summarizeRiskReason(change: ConfigPublishAuditChange, riskLevel: ConfigRiskLevel): string {
  const pathHints = uniqueStrings((change.diffSummary ?? []).map((entry) => entry.path)).slice(0, 3);
  const parts = [`${change.changeCount ?? 0} 项变更`];
  if ((change.structuralChangeCount ?? 0) > 0) {
    parts.push(`${change.structuralChangeCount} 项结构变更`);
  }
  if (pathHints.length > 0) {
    parts.push(`关注字段: ${pathHints.join(", ")}`);
  }
  if (riskLevel === "high" && (change.structuralChangeCount ?? 0) === 0) {
    parts.push("命中高敏感配置域");
  }
  return parts.join("；");
}

function classifyConfigRisk(change: ConfigPublishAuditChange): ConfigRiskChangeSummary {
  const rule = CONFIG_RISK_RULES[change.documentId];
  const highlightedPaths = uniqueStrings((change.diffSummary ?? []).map((entry) => entry.path)).slice(0, 4);
  const blastRadius = uniqueStrings((change.diffSummary ?? []).flatMap((entry) => entry.blastRadius ?? []));
  const changeCount = change.changeCount ?? 0;
  const structuralChangeCount = change.structuralChangeCount ?? 0;
  let riskLevel = rule.defaultRisk;

  if (change.documentId === "mapObjects") {
    const highSignal = highlightedPaths.some((entry) =>
      /(buildings|neutralArmies|guaranteedResources|reward|recruitCount|income|unitTemplateId)/.test(entry)
    );
    if (highSignal || structuralChangeCount > 0 || changeCount >= 8) {
      riskLevel = "high";
    }
  } else if (change.documentId === "units") {
    const highSignal = highlightedPaths.some((entry) =>
      /(attack|defense|minDamage|maxDamage|maxHp|initiative|skills|templateId)/.test(entry)
    );
    if (highSignal || structuralChangeCount > 0 || changeCount >= 10) {
      riskLevel = "high";
    }
  } else if (
    (change.documentId === "battleSkills" || change.documentId === "battleBalance" || change.documentId === "world") &&
    changeCount > 0
  ) {
    riskLevel = "high";
  }

  return {
    documentId: change.documentId,
    title: change.title ?? rule.title ?? CONFIG_TITLE_BY_ID[change.documentId],
    riskLevel,
    reason: summarizeRiskReason(change, riskLevel),
    changeCount,
    structuralChangeCount,
    impactedModules: uniqueStrings([...rule.impactedModules, ...blastRadius]),
    suggestedValidationActions: [...rule.suggestedValidationActions],
    highlightedPaths,
    recommendCanary: rule.recommendCanary || structuralChangeCount > 0,
    recommendRehearsal: rule.recommendRehearsal || structuralChangeCount > 0
  };
}

export function buildConfigChangeRiskSummary(configCenterLibraryPath: string | undefined): ConfigChangeRiskSummary {
  if (!configCenterLibraryPath || !fs.existsSync(configCenterLibraryPath)) {
    return {
      status: "missing",
      summary: "Config-center publish audit not found; config risk summary unavailable."
    };
  }

  const state = readJsonFile<ConfigCenterLibraryState>(configCenterLibraryPath);
  const publishEvent = (state.publishAuditHistory ?? []).find((entry) => entry.resultStatus === "applied");
  if (!publishEvent || (publishEvent.changes ?? []).length === 0) {
    return {
      status: "missing",
      summary: "No applied config-center publish event found; config risk summary unavailable."
    };
  }

  const changes = (publishEvent.changes ?? [])
    .filter((change): change is ConfigPublishAuditChange => change.documentId in CONFIG_RISK_RULES)
    .map((change) => classifyConfigRisk(change))
    .sort((left, right) => RISK_PRIORITY[right.riskLevel] - RISK_PRIORITY[left.riskLevel]);

  if (changes.length === 0) {
    return {
      status: "missing",
      summary: "Latest applied config publish did not touch tracked release-gated config documents."
    };
  }

  const overallRisk = maxRiskLevel(changes.map((change) => change.riskLevel));
  const recommendCanary = changes.some((change) => change.recommendCanary);
  const recommendRehearsal = changes.some((change) => change.recommendRehearsal);
  const impactedModules = uniqueStrings(changes.flatMap((change) => change.impactedModules));
  const suggestedValidationActions = uniqueStrings(changes.flatMap((change) => change.suggestedValidationActions));

  return {
    status: "available",
    summary: `${changes.length} 个配置文档变更，最高风险 ${overallRisk.toUpperCase()}。`,
    source: {
      path: configCenterLibraryPath,
      publishId: publishEvent.id,
      publishedAt: publishEvent.publishedAt,
      author: publishEvent.author ?? "unknown",
      releaseSummary: publishEvent.summary ?? ""
    },
    overallRisk,
    recommendCanary,
    recommendRehearsal,
    impactedModules,
    suggestedValidationActions,
    changes
  };
}

export function buildReleaseGateSummaryReport(args: Args, revision: GitRevision): ReleaseGateSummaryReport {
  const snapshotPath = resolveSnapshotPath(args);
  const h5SmokePath = resolveH5SmokePath(args);
  const reconnectSoakPath = resolveReconnectSoakPath(args);
  const wechatArtifactsDir = resolveWechatArtifactsDir(args);
  const wechatRcValidationPath = resolveWechatRcValidationPath(args, wechatArtifactsDir);
  const wechatCandidateSummaryPath = resolveWechatCandidateSummaryPath(args, wechatArtifactsDir);
  const wechatSmokeReportPath = resolveWechatSmokeReportPath(args, wechatArtifactsDir);
  const configCenterLibraryPath = resolveConfigCenterLibraryPath(args);
  const releaseSurface = buildReleaseSurfaceContract(
    args.targetSurface,
    snapshotPath,
    h5SmokePath,
    reconnectSoakPath,
    wechatCandidateSummaryPath
  );

  const gates = [
    evaluateReleaseReadinessGate(snapshotPath),
    evaluateH5SmokeGate(h5SmokePath),
    evaluateReconnectSoakGate(reconnectSoakPath),
    evaluateWechatGate(args.targetSurface, wechatRcValidationPath, wechatCandidateSummaryPath, wechatSmokeReportPath),
    evaluatePhase1EvidenceConsistencyGate(
      args.targetSurface,
      revision,
      snapshotPath,
      h5SmokePath,
      reconnectSoakPath,
      wechatRcValidationPath,
      wechatCandidateSummaryPath,
      wechatSmokeReportPath
    )
  ];
  const failedGates = gates.filter((gate) => gate.required && gate.status === "failed");

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision,
    targetSurface: args.targetSurface,
    summary: {
      status: failedGates.length === 0 && releaseSurface.status === "passed" ? "passed" : "failed",
      totalGates: gates.length,
      passedGates: gates.filter((gate) => !gate.required || gate.status === "passed").length,
      failedGates: failedGates.length,
      failedGateIds: failedGates.map((gate) => gate.id)
    },
    inputs: {
      ...(snapshotPath ? { snapshotPath } : {}),
      ...(h5SmokePath ? { h5SmokePath } : {}),
      ...(reconnectSoakPath ? { reconnectSoakPath } : {}),
      ...(wechatRcValidationPath ? { wechatRcValidationPath } : {}),
      ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath } : {}),
      ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
      ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
      ...(configCenterLibraryPath ? { configCenterLibraryPath } : {})
    },
    gates,
    releaseSurface,
    configChangeRisk: buildConfigChangeRiskSummary(configCenterLibraryPath)
  };
}

export function renderMarkdown(report: ReleaseGateSummaryReport): string {
  const lines = [
    "# Release Gate Summary",
    "",
    `- Generated at: \`${report.generatedAt}\``,
    `- Revision: \`${report.revision.shortCommit}\` on \`${report.revision.branch}\``,
    `- Target surface: \`${report.targetSurface}\``,
    `- Overall status: **${report.summary.status.toUpperCase()}**`,
    ""
  ];

  lines.push("## Selected Inputs");
  lines.push("");
  lines.push(`- Snapshot: \`${report.inputs.snapshotPath ? relativeReportPath(report.inputs.snapshotPath) : "<missing>"}\``);
  lines.push(`- H5 smoke: \`${report.inputs.h5SmokePath ? relativeReportPath(report.inputs.h5SmokePath) : "<missing>"}\``);
  lines.push(`- Reconnect soak: \`${report.inputs.reconnectSoakPath ? relativeReportPath(report.inputs.reconnectSoakPath) : "<missing>"}\``);
  lines.push(`- WeChat validation: \`${report.inputs.wechatRcValidationPath ? relativeReportPath(report.inputs.wechatRcValidationPath) : "<missing>"}\``);
  lines.push(
    `- WeChat candidate summary: \`${report.inputs.wechatCandidateSummaryPath ? relativeReportPath(report.inputs.wechatCandidateSummaryPath) : "<missing>"}\``
  );
  lines.push(`- WeChat smoke fallback: \`${report.inputs.wechatSmokeReportPath ? relativeReportPath(report.inputs.wechatSmokeReportPath) : "<missing>"}\``);
  lines.push(`- WeChat artifacts dir: \`${report.inputs.wechatArtifactsDir ? relativeReportPath(report.inputs.wechatArtifactsDir) : "<missing>"}\``);
  lines.push(`- Config audit: \`${report.inputs.configCenterLibraryPath ? relativeReportPath(report.inputs.configCenterLibraryPath) : "<missing>"}\``);
  lines.push("");

  lines.push("## Target Surface Contract");
  lines.push("");
  lines.push(`- Surface: \`${report.releaseSurface.targetSurface}\``);
  lines.push(`- Status: **${report.releaseSurface.status.toUpperCase()}**`);
  lines.push(`- Summary: ${report.releaseSurface.summary}`);
  lines.push("- Evidence:");
  for (const entry of report.releaseSurface.evidence) {
    const details = [
      `required=${entry.required ? "yes" : "no"}`,
      `status=${entry.status}`,
      `freshness=${entry.freshness}`,
      entry.observedAt ? `observedAt=${entry.observedAt}` : "",
      entry.owner ? `owner=${entry.owner}` : "",
      entry.revision ? `revision=${entry.revision}` : "",
      entry.waiverReason ? `waiver=${entry.waiverReason}` : "",
      entry.artifactPath ? `path=${relativeReportPath(entry.artifactPath)}` : ""
    ]
      .filter((value) => value.length > 0)
      .join(" ");
    lines.push(`  - ${entry.label}: ${entry.summary} [${details}]`);
  }
  lines.push("");

  for (const gate of report.gates) {
    lines.push(`## ${gate.label}`);
    lines.push("");
    lines.push(`- Status: **${gate.status.toUpperCase()}**`);
    lines.push(`- Required for target surface: ${gate.required ? "yes" : "no"}`);
    lines.push(`- Summary: ${gate.summary}`);
    if (gate.source) {
      lines.push(`- Source: \`${relativeReportPath(gate.source.path)}\``);
    }
    if (gate.failures.length > 0) {
      lines.push("- Failures:");
      for (const failure of gate.failures) {
        lines.push(`  - ${failure}`);
      }
    }
    lines.push("");
  }

  lines.push("## Config Change Risk Summary");
  lines.push("");
  lines.push(`- Status: ${report.configChangeRisk.summary}`);
  if (report.configChangeRisk.source) {
    lines.push(`- Source: \`${relativeReportPath(report.configChangeRisk.source.path)}\``);
    lines.push(`- Config publish: \`${report.configChangeRisk.source.publishId}\` by \`${report.configChangeRisk.source.author}\``);
    lines.push(`- Published at: \`${report.configChangeRisk.source.publishedAt}\``);
    if (report.configChangeRisk.source.releaseSummary) {
      lines.push(`- Publish summary: ${report.configChangeRisk.source.releaseSummary}`);
    }
  }
  if (report.configChangeRisk.status === "available") {
    lines.push(`- Overall risk: **${report.configChangeRisk.overallRisk?.toUpperCase()}**`);
    lines.push(`- Recommend gray release / canary: ${report.configChangeRisk.recommendCanary ? "yes" : "no"}`);
    lines.push(`- Recommend rehearsal: ${report.configChangeRisk.recommendRehearsal ? "yes" : "no"}`);
    lines.push(`- Impacted modules: ${(report.configChangeRisk.impactedModules ?? []).join(", ")}`);
    lines.push(`- Suggested validation: ${(report.configChangeRisk.suggestedValidationActions ?? []).join(" | ")}`);
    lines.push("- Changes:");
    for (const change of report.configChangeRisk.changes ?? []) {
      const pathSummary = change.highlightedPaths.length > 0 ? ` | 字段: ${change.highlightedPaths.join(", ")}` : "";
      lines.push(`  - ${change.documentId} [${change.riskLevel.toUpperCase()}]: ${change.reason}${pathSummary}`);
    }
  }
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPath(args: Args, shortCommit: string): string {
  if (args.outputPath) {
    return path.resolve(args.outputPath);
  }
  return path.resolve(DEFAULT_RELEASE_READINESS_DIR, `release-gate-summary-${shortCommit}.json`);
}

function defaultMarkdownOutputPath(args: Args, shortCommit: string): string {
  if (args.markdownOutputPath) {
    return path.resolve(args.markdownOutputPath);
  }
  return path.resolve(DEFAULT_RELEASE_READINESS_DIR, `release-gate-summary-${shortCommit}.md`);
}

function main(): void {
  const args = parseArgs(process.argv);
  const revision = getRevision();
  const report = buildReleaseGateSummaryReport(args, revision);
  const outputPath = defaultOutputPath(args, revision.shortCommit);
  const markdownOutputPath = defaultMarkdownOutputPath(args, revision.shortCommit);

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote release gate JSON summary: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
  console.log(`Wrote release gate Markdown summary: ${path.relative(process.cwd(), markdownOutputPath).replace(/\\/g, "/")}`);

  if (report.summary.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
