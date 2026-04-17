export interface CocosWechatHotfixFileEntry {
  path: string;
  sha256: string;
  bytes: number;
  url: string;
  packageRoot?: string;
}

export interface CocosWechatHotfixManifest {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  generatedAt: string;
  version: string;
  sourceRevision?: string;
  baselineRevision?: string;
  remoteAssetRoot: string;
  manifestUrl: string;
  changedFiles: CocosWechatHotfixFileEntry[];
  changedSubpackages: Array<{
    root: string;
    bytes: number;
    fileCount: number;
  }>;
  rollbackVersion?: string;
}

export interface CocosWechatHotfixRuntimeConfig {
  remoteAssetRoot?: string | null;
  manifestUrl?: string | null;
  currentVersion?: string | null;
}

export interface CocosWechatHotfixManifestRuntimeLike {
  __PROJECT_VEIL_RUNTIME_CONFIG__?: {
    wechatMiniGame?: {
      remoteAssetRoot?: unknown;
      hotfixManifestUrl?: unknown;
      hotfixVersion?: unknown;
    } | null;
  } | null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveCocosWechatHotfixRuntimeConfig(
  runtime: CocosWechatHotfixManifestRuntimeLike = globalThis as CocosWechatHotfixManifestRuntimeLike
): CocosWechatHotfixRuntimeConfig {
  const wechatMiniGame = runtime.__PROJECT_VEIL_RUNTIME_CONFIG__?.wechatMiniGame ?? null;
  return {
    remoteAssetRoot: normalizeOptionalString(wechatMiniGame?.remoteAssetRoot),
    manifestUrl: normalizeOptionalString(wechatMiniGame?.hotfixManifestUrl),
    currentVersion: normalizeOptionalString(wechatMiniGame?.hotfixVersion)
  };
}

export function resolveCocosWechatHotfixManifestUrl(
  config: CocosWechatHotfixRuntimeConfig
): string | null {
  if (config.manifestUrl) {
    return config.manifestUrl;
  }
  if (!config.remoteAssetRoot) {
    return null;
  }
  const versionSegment = config.currentVersion ? `${encodeURIComponent(config.currentVersion)}/` : "";
  return `${config.remoteAssetRoot.replace(/\/+$/, "")}/${versionSegment}codex.wechat.hotfix-manifest.json`;
}

export async function loadCocosWechatHotfixManifest(
  fetchImpl: typeof fetch,
  config: CocosWechatHotfixRuntimeConfig
): Promise<CocosWechatHotfixManifest | null> {
  const manifestUrl = resolveCocosWechatHotfixManifestUrl(config);
  if (!manifestUrl) {
    return null;
  }

  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    throw new Error(`wechat_hotfix_manifest_request_failed:${response.status}`);
  }
  return (await response.json()) as CocosWechatHotfixManifest;
}

export function resolveCocosWechatHotfixAssetUrl(
  manifest: CocosWechatHotfixManifest | null | undefined,
  assetPath: string
): string | null {
  if (!manifest || !assetPath.trim()) {
    return null;
  }
  const normalizedPath = assetPath.replace(/^\/+/, "").replace(/\\/g, "/");
  const matched = manifest.changedFiles.find((entry) => entry.path === normalizedPath);
  return matched?.url ?? null;
}
