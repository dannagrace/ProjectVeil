import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type GateStatus = "passed" | "failed";

interface Args {
  snapshotPath?: string;
  h5SmokePath?: string;
  wechatRcValidationPath?: string;
  wechatSmokeReportPath?: string;
  wechatArtifactsDir?: string;
  configCenterLibraryPath?: string;
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
  execution?: {
    status?: "passed" | "failed";
    exitCode?: number;
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

interface WechatSmokeReport {
  execution?: {
    result?: "pending" | "passed" | "failed";
    summary?: string;
  };
  cases?: Array<{
    id?: string;
    status?: "pending" | "passed" | "failed" | "not_applicable";
    required?: boolean;
  }>;
}

interface GateSource {
  kind: "release-readiness-snapshot" | "h5-release-candidate-smoke" | "wechat-rc-validation" | "wechat-smoke-report";
  path: string;
}

interface GateResult {
  id: "release-readiness" | "h5-release-candidate-smoke" | "wechat-release";
  label: string;
  status: GateStatus;
  summary: string;
  failures: string[];
  source?: GateSource;
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
    wechatRcValidationPath?: string;
    wechatSmokeReportPath?: string;
    wechatArtifactsDir?: string;
    configCenterLibraryPath?: string;
  };
  gates: GateResult[];
  configChangeRisk: ConfigChangeRiskSummary;
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_WECHAT_ARTIFACTS_DIR = path.resolve("artifacts", "wechat-release");
const DEFAULT_CONFIG_CENTER_LIBRARY_PATH = path.resolve("configs", ".config-center-library.json");
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
  let wechatRcValidationPath: string | undefined;
  let wechatSmokeReportPath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let configCenterLibraryPath: string | undefined;
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
    if (arg === "--wechat-rc-validation" && next) {
      wechatRcValidationPath = next;
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
    ...(wechatRcValidationPath ? { wechatRcValidationPath } : {}),
    ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(configCenterLibraryPath ? { configCenterLibraryPath } : {}),
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
  failures: string[]
): GateResult {
  return {
    id,
    label,
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

export function evaluateWechatGate(
  wechatRcValidationPath: string | undefined,
  wechatSmokeReportPath: string | undefined
): GateResult {
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
      ["Neither codex.wechat.rc-validation-report.json nor codex.wechat.smoke-report.json was found."]
    );
  }

  const report = readJsonFile<WechatSmokeReport>(wechatSmokeReportPath);
  const failures: string[] = [];
  const requiredCases = (report.cases ?? []).filter((entry) => entry.required !== false);
  const failedCases = requiredCases.filter((entry) => entry.status === "failed");
  const pendingCases = requiredCases.filter((entry) => entry.status === "pending");

  if (report.execution?.result !== "passed") {
    failures.push(`WeChat smoke execution result is ${JSON.stringify(report.execution?.result ?? "missing")}.`);
  }
  for (const entry of failedCases) {
    failures.push(`WeChat smoke case failed: ${entry.id ?? "unknown-case"}.`);
  }
  for (const entry of pendingCases) {
    failures.push(`WeChat smoke case is still pending: ${entry.id ?? "unknown-case"}.`);
  }

  return {
    id: "wechat-release",
    label: "WeChat release validation",
    status: failures.length === 0 ? "passed" : "failed",
    summary:
      failures.length === 0
        ? `WeChat smoke report passed ${requiredCases.length} required cases.`
        : `WeChat smoke report failed: ${failures[0]}`,
    failures,
    source: {
      kind: "wechat-smoke-report",
      path: wechatSmokeReportPath
    }
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
  const wechatArtifactsDir = resolveWechatArtifactsDir(args);
  const wechatRcValidationPath = resolveWechatRcValidationPath(args, wechatArtifactsDir);
  const wechatSmokeReportPath = resolveWechatSmokeReportPath(args, wechatArtifactsDir);
  const configCenterLibraryPath = resolveConfigCenterLibraryPath(args);

  const gates = [
    evaluateReleaseReadinessGate(snapshotPath),
    evaluateH5SmokeGate(h5SmokePath),
    evaluateWechatGate(wechatRcValidationPath, wechatSmokeReportPath)
  ];
  const failedGates = gates.filter((gate) => gate.status === "failed");

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision,
    summary: {
      status: failedGates.length === 0 ? "passed" : "failed",
      totalGates: gates.length,
      passedGates: gates.length - failedGates.length,
      failedGates: failedGates.length,
      failedGateIds: failedGates.map((gate) => gate.id)
    },
    inputs: {
      ...(snapshotPath ? { snapshotPath } : {}),
      ...(h5SmokePath ? { h5SmokePath } : {}),
      ...(wechatRcValidationPath ? { wechatRcValidationPath } : {}),
      ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
      ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
      ...(configCenterLibraryPath ? { configCenterLibraryPath } : {})
    },
    gates,
    configChangeRisk: buildConfigChangeRiskSummary(configCenterLibraryPath)
  };
}

export function renderMarkdown(report: ReleaseGateSummaryReport): string {
  const lines = [
    "# Release Gate Summary",
    "",
    `- Generated at: \`${report.generatedAt}\``,
    `- Revision: \`${report.revision.shortCommit}\` on \`${report.revision.branch}\``,
    `- Overall status: **${report.summary.status.toUpperCase()}**`,
    ""
  ];

  for (const gate of report.gates) {
    lines.push(`## ${gate.label}`);
    lines.push("");
    lines.push(`- Status: **${gate.status.toUpperCase()}**`);
    lines.push(`- Summary: ${gate.summary}`);
    if (gate.source) {
      lines.push(`- Source: \`${path.relative(process.cwd(), gate.source.path).replace(/\\/g, "/")}\``);
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
    lines.push(
      `- Source: \`${path.relative(process.cwd(), report.configChangeRisk.source.path).replace(/\\/g, "/")}\``
    );
    lines.push(`- Config publish: \`${report.configChangeRisk.source.publishId}\` by \`${report.configChangeRisk.source.author}\``);
    lines.push(`- Published at: \`${report.configChangeRisk.source.publishedAt}\``);
    if (report.configChangeRisk.source.releaseSummary) {
      lines.push(`- Publish summary: ${report.configChangeRisk.source.releaseSummary}`);
    }
  }
  if (report.configChangeRisk.status === "available") {
    lines.push(`- Overall risk: **${report.configChangeRisk.overallRisk?.toUpperCase()}**`);
    lines.push(
      `- Recommend gray release / canary: ${report.configChangeRisk.recommendCanary ? "yes" : "no"}`
    );
    lines.push(`- Recommend rehearsal: ${report.configChangeRisk.recommendRehearsal ? "yes" : "no"}`);
    lines.push(`- Impacted modules: ${(report.configChangeRisk.impactedModules ?? []).join(", ")}`);
    lines.push(`- Suggested validation: ${(report.configChangeRisk.suggestedValidationActions ?? []).join(" | ")}`);
    lines.push("- Changes:");
    for (const change of report.configChangeRisk.changes ?? []) {
      const pathSummary = change.highlightedPaths.length > 0 ? ` | 字段: ${change.highlightedPaths.join(", ")}` : "";
      lines.push(
        `  - ${change.documentId} [${change.riskLevel.toUpperCase()}]: ${change.reason}${pathSummary}`
      );
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
