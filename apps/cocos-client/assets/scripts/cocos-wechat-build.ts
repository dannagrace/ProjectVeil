import fs from "node:fs";
import path from "node:path";

export type WechatMinigameOrientation = "portrait" | "landscape";

export interface WechatMinigameNetworkTimeoutMs {
  request: number;
  connectSocket: number;
  uploadFile: number;
  downloadFile: number;
}

export interface WechatMinigameDomainMatrix {
  request: string[];
  socket: string[];
  uploadFile: string[];
  downloadFile: string[];
}

export interface WechatMinigameSubpackageExpectation {
  root: string;
  label?: string;
}

export interface WechatMinigameBuildConfig {
  projectName: string;
  appId: string;
  orientation: WechatMinigameOrientation;
  buildOutputDir: string;
  runtimeRemoteUrl?: string;
  mainPackageBudgetMb: number;
  totalSubpackageBudgetMb: number;
  networkTimeoutMs: WechatMinigameNetworkTimeoutMs;
  domains: WechatMinigameDomainMatrix;
  expectedSubpackages: WechatMinigameSubpackageExpectation[];
  remoteAssetRoot?: string;
}

interface WechatMinigameGameJson {
  deviceOrientation: WechatMinigameOrientation;
  networkTimeout: WechatMinigameNetworkTimeoutMs;
}

interface WechatMinigameProjectConfig {
  projectname: string;
  appid: string;
  compileType: "game";
}

interface WechatMinigameBuildManifest {
  projectName: string;
  buildOutputDir: string;
  buildTemplatePlatform: "wechatgame";
  runtimeRemoteUrl?: string;
  budgets: {
    mainPackageMb: number;
    totalSubpackageMb: number;
  };
  remoteAssetRoot?: string;
  domains: WechatMinigameDomainMatrix;
  requiredDomains: WechatMinigameDomainMatrix;
  missingConfiguredDomains: WechatMinigameDomainMatrix;
  expectedSubpackages: WechatMinigameSubpackageExpectation[];
}

export interface WechatMinigameTemplateArtifacts {
  gameJson: WechatMinigameGameJson;
  projectConfigJson: WechatMinigameProjectConfig;
  manifestJson: WechatMinigameBuildManifest;
  releaseChecklistMarkdown: string;
}

export interface WechatMinigameSubpackageSize {
  root: string;
  bytes: number;
}

export interface WechatMinigameBuildAnalysis {
  outputDir: string;
  totalBytes: number;
  mainPackageBytes: number;
  mainPackageBudgetBytes: number;
  totalSubpackageBytes: number;
  totalSubpackageBudgetBytes: number;
  subpackages: WechatMinigameSubpackageSize[];
  missingExpectedSubpackages: string[];
  warnings: string[];
  errors: string[];
}

export interface WechatMinigameDomainCoverage {
  required: WechatMinigameDomainMatrix;
  missing: WechatMinigameDomainMatrix;
}

const DEFAULT_PROJECT_NAME = "Project Veil";
const DEFAULT_APP_ID = "touristappid";
const DEFAULT_BUILD_OUTPUT_DIR = "build/wechatgame";
const DEFAULT_MAIN_PACKAGE_BUDGET_MB = 4;
const DEFAULT_TOTAL_SUBPACKAGE_BUDGET_MB = 30;
const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOrientation(value: unknown): WechatMinigameOrientation {
  return value === "landscape" ? "landscape" : "portrait";
}

function normalizeBudget(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeTimeout(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 1_000 ? Math.round(numeric) : DEFAULT_TIMEOUT_MS;
}

function normalizeDirectory(value: unknown, fallback: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }

  const withForwardSlashes = normalized.replace(/\\/g, "/");
  return withForwardSlashes.replace(/^\.\/+/, "").replace(/\/+$/, "") || fallback;
}

function normalizeUrlList(value: unknown, protocols: string[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const candidate = normalizeString(item);
    if (!candidate) {
      continue;
    }

    try {
      const parsed = new URL(candidate);
      if (!protocols.includes(parsed.protocol)) {
        continue;
      }
      const origin = parsed.origin;
      if (!origin || origin === "null") {
        continue;
      }
      if (!seen.has(origin)) {
        seen.add(origin);
        normalized.push(origin);
      }
    } catch {
      continue;
    }
  }

  return normalized;
}

function normalizeExpectedSubpackages(value: unknown): WechatMinigameSubpackageExpectation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: WechatMinigameSubpackageExpectation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const root = normalizeDirectory((item as { root?: unknown }).root, "");
    if (!root || seen.has(root)) {
      continue;
    }

    seen.add(root);
    const label = normalizeString((item as { label?: unknown }).label);
    normalized.push({
      root,
      ...(label ? { label } : {})
    });
  }

  return normalized;
}

function normalizeRuntimeRemoteUrl(value: unknown): string | undefined {
  const candidate = normalizeString(value);
  if (!candidate) {
    return undefined;
  }

  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
      return undefined;
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function toMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDomainChecklist(title: string, values: string[]): string {
  if (values.length === 0) {
    return `- ${title}: 尚未配置`;
  }

  return `- ${title}: ${values.join(", ")}`;
}

function normalizeSubpackageRootsFromGameJson(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const roots: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const root = normalizeDirectory((item as { root?: unknown }).root, "");
    if (!root || seen.has(root)) {
      continue;
    }

    seen.add(root);
    roots.push(root);
  }

  return roots;
}

function createEmptyDomainMatrix(): WechatMinigameDomainMatrix {
  return {
    request: [],
    socket: [],
    uploadFile: [],
    downloadFile: []
  };
}

function pushUniqueDomain(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function buildRequestOriginFromRemoteUrl(runtimeRemoteUrl: string): string {
  const parsed = new URL(runtimeRemoteUrl);
  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function buildSocketOriginFromRemoteUrl(runtimeRemoteUrl: string): string {
  const parsed = new URL(runtimeRemoteUrl);
  parsed.protocol = parsed.protocol === "https:" || parsed.protocol === "wss:" ? "wss:" : "ws:";
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function hasAnyDomainEntries(matrix: WechatMinigameDomainMatrix): boolean {
  return (
    matrix.request.length > 0 ||
    matrix.socket.length > 0 ||
    matrix.uploadFile.length > 0 ||
    matrix.downloadFile.length > 0
  );
}

export function buildWechatMinigameDomainCoverage(
  config: WechatMinigameBuildConfig
): WechatMinigameDomainCoverage {
  const required = createEmptyDomainMatrix();

  if (config.runtimeRemoteUrl) {
    pushUniqueDomain(required.request, buildRequestOriginFromRemoteUrl(config.runtimeRemoteUrl));
    pushUniqueDomain(required.socket, buildSocketOriginFromRemoteUrl(config.runtimeRemoteUrl));
  }

  if (config.remoteAssetRoot) {
    pushUniqueDomain(required.downloadFile, new URL(config.remoteAssetRoot).origin);
  }

  return {
    required,
    missing: {
      request: required.request.filter((domain) => !config.domains.request.includes(domain)),
      socket: required.socket.filter((domain) => !config.domains.socket.includes(domain)),
      uploadFile: required.uploadFile.filter((domain) => !config.domains.uploadFile.includes(domain)),
      downloadFile: required.downloadFile.filter((domain) => !config.domains.downloadFile.includes(domain))
    }
  };
}

function listFilesRecursively(rootDir: string, currentDir = rootDir): Array<{ relativePath: string; bytes: number }> {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files: Array<{ relativePath: string; bytes: number }> = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(rootDir, fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === ".DS_Store") {
      continue;
    }

    const stats = fs.statSync(fullPath);
    files.push({
      relativePath: path.relative(rootDir, fullPath).replace(/\\/g, "/"),
      bytes: stats.size
    });
  }

  return files;
}

export function normalizeWechatMinigameBuildConfig(input: unknown): WechatMinigameBuildConfig {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const normalizedRuntimeRemoteUrl = normalizeRuntimeRemoteUrl(candidate.runtimeRemoteUrl);
  const remoteAssetRoot = normalizeString(candidate.remoteAssetRoot);
  const normalizedRemoteAssetRoot = remoteAssetRoot
    ? (() => {
        try {
          const parsed = new URL(remoteAssetRoot);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return undefined;
          }
          return parsed.href.replace(/\/+$/, "");
        } catch {
          return undefined;
        }
      })()
    : undefined;

  return {
    projectName: normalizeString(candidate.projectName) ?? DEFAULT_PROJECT_NAME,
    appId: normalizeString(candidate.appId) ?? DEFAULT_APP_ID,
    orientation: normalizeOrientation(candidate.orientation),
    buildOutputDir: normalizeDirectory(candidate.buildOutputDir, DEFAULT_BUILD_OUTPUT_DIR),
    ...(normalizedRuntimeRemoteUrl ? { runtimeRemoteUrl: normalizedRuntimeRemoteUrl } : {}),
    mainPackageBudgetMb: normalizeBudget(candidate.mainPackageBudgetMb, DEFAULT_MAIN_PACKAGE_BUDGET_MB),
    totalSubpackageBudgetMb: normalizeBudget(candidate.totalSubpackageBudgetMb, DEFAULT_TOTAL_SUBPACKAGE_BUDGET_MB),
    networkTimeoutMs: {
      request: normalizeTimeout((candidate.networkTimeoutMs as Record<string, unknown> | undefined)?.request),
      connectSocket: normalizeTimeout((candidate.networkTimeoutMs as Record<string, unknown> | undefined)?.connectSocket),
      uploadFile: normalizeTimeout((candidate.networkTimeoutMs as Record<string, unknown> | undefined)?.uploadFile),
      downloadFile: normalizeTimeout((candidate.networkTimeoutMs as Record<string, unknown> | undefined)?.downloadFile)
    },
    domains: {
      request: normalizeUrlList((candidate.domains as Record<string, unknown> | undefined)?.request, ["http:", "https:"]),
      socket: normalizeUrlList((candidate.domains as Record<string, unknown> | undefined)?.socket, ["ws:", "wss:"]),
      uploadFile: normalizeUrlList((candidate.domains as Record<string, unknown> | undefined)?.uploadFile, ["http:", "https:"]),
      downloadFile: normalizeUrlList(
        (candidate.domains as Record<string, unknown> | undefined)?.downloadFile,
        ["http:", "https:"]
      )
    },
    expectedSubpackages: normalizeExpectedSubpackages(candidate.expectedSubpackages),
    ...(normalizedRemoteAssetRoot ? { remoteAssetRoot: normalizedRemoteAssetRoot } : {})
  };
}

export function buildWechatMinigameTemplateArtifacts(
  config: WechatMinigameBuildConfig
): WechatMinigameTemplateArtifacts {
  const domainCoverage = buildWechatMinigameDomainCoverage(config);
  const gameJson: WechatMinigameGameJson = {
    deviceOrientation: config.orientation,
    networkTimeout: config.networkTimeoutMs
  };

  const projectConfigJson: WechatMinigameProjectConfig = {
    projectname: config.projectName,
    appid: config.appId,
    compileType: "game"
  };

  const manifestJson: WechatMinigameBuildManifest = {
    projectName: config.projectName,
    buildOutputDir: config.buildOutputDir,
    buildTemplatePlatform: "wechatgame",
    ...(config.runtimeRemoteUrl ? { runtimeRemoteUrl: config.runtimeRemoteUrl } : {}),
    budgets: {
      mainPackageMb: config.mainPackageBudgetMb,
      totalSubpackageMb: config.totalSubpackageBudgetMb
    },
    ...(config.remoteAssetRoot ? { remoteAssetRoot: config.remoteAssetRoot } : {}),
    domains: config.domains,
    requiredDomains: domainCoverage.required,
    missingConfiguredDomains: domainCoverage.missing,
    expectedSubpackages: config.expectedSubpackages
  };

  const expectedSubpackageLines =
    config.expectedSubpackages.length > 0
      ? config.expectedSubpackages.map((subpackage) => `- ${subpackage.label ?? subpackage.root}: \`${subpackage.root}\``)
      : ["- 当前未在仓库配置显式分包计划；请在 Cocos Creator 中把目标 Asset Bundle 标为 Mini Game Subpackage。"];

  const releaseChecklistMarkdown = [
    "# WeChat Mini Game Build Checklist",
    "",
    `- Build target: \`wechatgame\``,
    `- Project name: \`${config.projectName}\``,
    `- Build output dir: \`${config.buildOutputDir}\``,
    `- Runtime remote URL: ${config.runtimeRemoteUrl ? `\`${config.runtimeRemoteUrl}\`` : "尚未配置"}`,
    `- Main package budget: ${config.mainPackageBudgetMb} MB`,
    `- Total subpackage budget: ${config.totalSubpackageBudgetMb} MB`,
    `- Device orientation: \`${config.orientation}\``,
    `- Remote asset root: ${config.remoteAssetRoot ? config.remoteAssetRoot : "尚未配置"}`,
    "",
    "## Expected Subpackages",
    ...expectedSubpackageLines,
    "",
    "## Domain Checklist",
    formatDomainChecklist("request 合法域名", config.domains.request),
    formatDomainChecklist("socket 合法域名", config.domains.socket),
    formatDomainChecklist("uploadFile 合法域名", config.domains.uploadFile),
    formatDomainChecklist("downloadFile 合法域名", config.domains.downloadFile),
    "",
    "## Required Domain Origins",
    formatDomainChecklist("request 运行时域名", domainCoverage.required.request),
    formatDomainChecklist("socket 运行时域名", domainCoverage.required.socket),
    formatDomainChecklist("uploadFile 运行时域名", domainCoverage.required.uploadFile),
    formatDomainChecklist("downloadFile 运行时域名", domainCoverage.required.downloadFile),
    "",
    "## Missing Domain Coverage",
    ...(hasAnyDomainEntries(domainCoverage.missing)
      ? [
          formatDomainChecklist("request 缺口", domainCoverage.missing.request),
          formatDomainChecklist("socket 缺口", domainCoverage.missing.socket),
          formatDomainChecklist("uploadFile 缺口", domainCoverage.missing.uploadFile),
          formatDomainChecklist("downloadFile 缺口", domainCoverage.missing.downloadFile)
        ]
      : ["- 当前配置已覆盖已知 request/socket/downloadFile 域名。"]),
    "",
    "## Follow-up",
    "- 在 Cocos Creator 的微信小游戏构建目标中执行正式导出。",
    "- 若资源需要分包，请把对应 Asset Bundle 的 Compression Type 设为 Mini Game Subpackage。",
    "- 导出后运行 `npm run validate:wechat-build -- --output-dir <wechatgame-build-dir>` 校验 4MB / 30MB 预算。",
    "- 把远程资源目录上传到 CDN 后，再在微信开发者工具中补齐域名白名单。"
  ].join("\n");

  return {
    gameJson,
    projectConfigJson,
    manifestJson,
    releaseChecklistMarkdown
  };
}

export function analyzeWechatMinigameBuildOutput(
  outputDir: string,
  config: WechatMinigameBuildConfig
): WechatMinigameBuildAnalysis {
  const domainCoverage = buildWechatMinigameDomainCoverage(config);
  const resolvedOutputDir = path.resolve(outputDir);
  if (!fs.existsSync(resolvedOutputDir)) {
    return {
      outputDir: resolvedOutputDir,
      totalBytes: 0,
      mainPackageBytes: 0,
      mainPackageBudgetBytes: Math.round(config.mainPackageBudgetMb * 1024 * 1024),
      totalSubpackageBytes: 0,
      totalSubpackageBudgetBytes: Math.round(config.totalSubpackageBudgetMb * 1024 * 1024),
      subpackages: [],
      missingExpectedSubpackages: config.expectedSubpackages.map((subpackage) => subpackage.root),
      warnings: [],
      errors: [`Build output directory does not exist: ${resolvedOutputDir}`]
    };
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  const files = listFilesRecursively(resolvedOutputDir);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const gameJsonPath = path.join(resolvedOutputDir, "game.json");
  let actualSubpackageRoots: string[] = [];
  if (fs.existsSync(gameJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(gameJsonPath, "utf8")) as { subpackages?: unknown };
      actualSubpackageRoots = normalizeSubpackageRootsFromGameJson(parsed.subpackages);
    } catch {
      warnings.push("Unable to parse build output game.json; subpackage sizing fell back to config expectations.");
    }
  } else {
    warnings.push("Build output game.json is missing; subpackage sizing fell back to config expectations.");
  }

  const sizedSubpackageRoots =
    actualSubpackageRoots.length > 0
      ? actualSubpackageRoots
      : config.expectedSubpackages.map((subpackage) => subpackage.root);

  if (sizedSubpackageRoots.length === 0 && config.expectedSubpackages.length === 0) {
    warnings.push("No subpackages were detected or configured for this build.");
  }

  const subpackages = sizedSubpackageRoots.map((root) => {
    const bytes = files
      .filter((file) => file.relativePath === root || file.relativePath.startsWith(`${root}/`))
      .reduce((sum, file) => sum + file.bytes, 0);
    return { root, bytes };
  });
  const totalSubpackageBytes = subpackages.reduce((sum, subpackage) => sum + subpackage.bytes, 0);
  const mainPackageBytes = totalBytes - totalSubpackageBytes;
  const mainPackageBudgetBytes = Math.round(config.mainPackageBudgetMb * 1024 * 1024);
  const totalSubpackageBudgetBytes = Math.round(config.totalSubpackageBudgetMb * 1024 * 1024);

  if (mainPackageBytes > mainPackageBudgetBytes) {
    errors.push(
      `Main package exceeded budget: ${toMb(mainPackageBytes)} > ${toMb(mainPackageBudgetBytes)}.`
    );
  }
  if (totalSubpackageBytes > totalSubpackageBudgetBytes) {
    errors.push(
      `Total subpackages exceeded budget: ${toMb(totalSubpackageBytes)} > ${toMb(totalSubpackageBudgetBytes)}.`
    );
  }

  const missingExpectedSubpackages = config.expectedSubpackages
    .map((subpackage) => subpackage.root)
    .filter((root) => !actualSubpackageRoots.includes(root));
  if (missingExpectedSubpackages.length > 0) {
    warnings.push(
      `Expected subpackages missing from build output: ${missingExpectedSubpackages.join(", ")}`
    );
  }

  if (!config.runtimeRemoteUrl) {
    warnings.push("Runtime remote URL is not configured; request/socket domain coverage cannot be derived.");
  }

  if (domainCoverage.missing.request.length > 0) {
    warnings.push(
      `Runtime request domain checklist is missing: ${domainCoverage.missing.request.join(", ")}`
    );
  }
  if (domainCoverage.missing.socket.length > 0) {
    warnings.push(`Runtime socket domain checklist is missing: ${domainCoverage.missing.socket.join(", ")}`);
  }
  if (domainCoverage.missing.uploadFile.length > 0) {
    warnings.push(
      `Runtime uploadFile domain checklist is missing: ${domainCoverage.missing.uploadFile.join(", ")}`
    );
  }
  if (domainCoverage.missing.downloadFile.length > 0) {
    warnings.push(
      `Runtime downloadFile domain checklist is missing: ${domainCoverage.missing.downloadFile.join(", ")}`
    );
  }

  return {
    outputDir: resolvedOutputDir,
    totalBytes,
    mainPackageBytes,
    mainPackageBudgetBytes,
    totalSubpackageBytes,
    totalSubpackageBudgetBytes,
    subpackages,
    missingExpectedSubpackages,
    warnings,
    errors
  };
}
