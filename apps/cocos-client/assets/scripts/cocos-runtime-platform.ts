export type CocosRuntimePlatform = "browser" | "wechat-game" | "unknown";

export type CocosRuntimeAuthFlow = "standard" | "wechat-session-bridge";
export type CocosRuntimeConfigCenterAccess = "external-window" | "manual-link";
export type CocosRuntimeLaunchQuerySource = "location-search" | "wechat-launch-options" | "none";

export interface CocosRuntimeCapabilities {
  platform: CocosRuntimePlatform;
  authFlow: CocosRuntimeAuthFlow;
  configCenterAccess: CocosRuntimeConfigCenterAccess;
  launchQuerySource: CocosRuntimeLaunchQuerySource;
  supportsBrowserHistory: boolean;
  supportsWechatLogin: boolean;
}

interface WechatLaunchOptionsLike {
  query?: Record<string, unknown> | null;
}

interface WechatMiniGameLike {
  getLaunchOptionsSync?: (() => WechatLaunchOptionsLike | null | undefined) | undefined;
  login?: ((options: {
    timeout?: number;
    success?: (result: { code?: string }) => void;
    fail?: (error: { errMsg?: string }) => void;
  }) => void) | undefined;
}

export interface CocosRuntimeEnvironmentLike {
  location?: Pick<Location, "search"> | null;
  history?: Pick<History, "replaceState"> | null;
  wx?: WechatMiniGameLike | null;
}

function normalizeQueryValue(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function serializeCocosLaunchQuery(query?: Record<string, unknown> | null): string {
  if (!query) {
    return "";
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const normalizedItem = normalizeQueryValue(item);
        if (normalizedItem) {
          searchParams.append(key, normalizedItem);
        }
      }
      continue;
    }

    const normalizedValue = normalizeQueryValue(value);
    if (normalizedValue) {
      searchParams.set(key, normalizedValue);
    }
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
}

export function detectCocosRuntimePlatform(
  environment: CocosRuntimeEnvironmentLike = globalThis as CocosRuntimeEnvironmentLike
): CocosRuntimePlatform {
  if (environment.wx && typeof environment.wx.getLaunchOptionsSync === "function") {
    return "wechat-game";
  }
  if (environment.location) {
    return "browser";
  }
  return "unknown";
}

export function resolveCocosRuntimeCapabilities(platform: CocosRuntimePlatform): CocosRuntimeCapabilities {
  switch (platform) {
    case "wechat-game":
      return {
        platform,
        authFlow: "wechat-session-bridge",
        configCenterAccess: "manual-link",
        launchQuerySource: "wechat-launch-options",
        supportsBrowserHistory: false,
        supportsWechatLogin: true
      };
    case "browser":
      return {
        platform,
        authFlow: "standard",
        configCenterAccess: "external-window",
        launchQuerySource: "location-search",
        supportsBrowserHistory: true,
        supportsWechatLogin: false
      };
    default:
      return {
        platform,
        authFlow: "standard",
        configCenterAccess: "manual-link",
        launchQuerySource: "none",
        supportsBrowserHistory: false,
        supportsWechatLogin: false
      };
  }
}

export function readCocosRuntimeLaunchSearch(
  environment: CocosRuntimeEnvironmentLike = globalThis as CocosRuntimeEnvironmentLike
): string {
  const platform = detectCocosRuntimePlatform(environment);
  if (platform === "wechat-game") {
    const launchOptions = environment.wx?.getLaunchOptionsSync?.();
    return serializeCocosLaunchQuery(launchOptions?.query);
  }
  if (platform === "browser") {
    return environment.location?.search?.trim() ?? "";
  }
  return "";
}
