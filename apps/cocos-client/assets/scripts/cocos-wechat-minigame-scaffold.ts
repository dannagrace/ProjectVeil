export type CocosWechatMiniGameEnvVersion = "develop" | "trial" | "release";

export interface CocosWechatMiniGameScaffoldConfig {
  platform: "wechat-game";
  creatorVersion: string;
  appId: string;
  envVersion: CocosWechatMiniGameEnvVersion;
  mainPackageBudgetMB: number;
  preloadBundles: string[];
  remoteBundles: string[];
  assetCdnBaseUrl: string;
  loginExchangePath: string;
  socketDomains: string[];
  requestDomains: string[];
  notes?: string | undefined;
}

export interface CocosWechatMiniGameScaffoldIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isOriginListWithProtocol(values: string[], protocol: "https:" | "wss:"): boolean {
  return values.every((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === protocol && (parsed.pathname === "/" || parsed.pathname === "");
    } catch {
      return false;
    }
  });
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateCocosWechatMiniGameScaffoldConfig(
  config: CocosWechatMiniGameScaffoldConfig
): CocosWechatMiniGameScaffoldIssue[] {
  const issues: CocosWechatMiniGameScaffoldIssue[] = [];
  const preloadBundles = normalizeStringList(config.preloadBundles);
  const remoteBundles = normalizeStringList(config.remoteBundles);
  const socketDomains = normalizeStringList(config.socketDomains);
  const requestDomains = normalizeStringList(config.requestDomains);

  if (config.platform !== "wechat-game") {
    issues.push({
      severity: "error",
      code: "invalid_platform",
      message: "platform must be \"wechat-game\" for the issue #30 scaffold."
    });
  }

  if (!isNonEmptyString(config.creatorVersion)) {
    issues.push({
      severity: "error",
      code: "creator_version_required",
      message: "creatorVersion must be a non-empty string."
    });
  }

  if (!isNonEmptyString(config.appId)) {
    issues.push({
      severity: "error",
      code: "app_id_required",
      message: "appId must be a non-empty string."
    });
  } else if (config.appId === "wx-your-app-id") {
    issues.push({
      severity: "warning",
      code: "placeholder_app_id",
      message: "appId is still using the placeholder value."
    });
  }

  if (!["develop", "trial", "release"].includes(config.envVersion)) {
    issues.push({
      severity: "error",
      code: "invalid_env_version",
      message: "envVersion must be one of develop, trial, or release."
    });
  }

  if (typeof config.mainPackageBudgetMB !== "number" || !Number.isFinite(config.mainPackageBudgetMB)) {
    issues.push({
      severity: "error",
      code: "invalid_main_package_budget",
      message: "mainPackageBudgetMB must be a finite number."
    });
  } else {
    if (config.mainPackageBudgetMB <= 0) {
      issues.push({
        severity: "error",
        code: "main_package_budget_non_positive",
        message: "mainPackageBudgetMB must be greater than 0."
      });
    }
    if (config.mainPackageBudgetMB >= 4) {
      issues.push({
        severity: "error",
        code: "main_package_budget_too_large",
        message: "mainPackageBudgetMB must stay below the 4MB mini-game main package limit."
      });
    }
  }

  if (preloadBundles.length === 0) {
    issues.push({
      severity: "error",
      code: "preload_bundles_required",
      message: "At least one preload bundle is required for the mini-game main package plan."
    });
  }

  if (hasDuplicates(preloadBundles)) {
    issues.push({
      severity: "error",
      code: "duplicate_preload_bundles",
      message: "preloadBundles must not contain duplicates."
    });
  }

  if (hasDuplicates(remoteBundles)) {
    issues.push({
      severity: "error",
      code: "duplicate_remote_bundles",
      message: "remoteBundles must not contain duplicates."
    });
  }

  const overlappingBundles = preloadBundles.filter((bundle) => remoteBundles.includes(bundle));
  if (overlappingBundles.length > 0) {
    issues.push({
      severity: "error",
      code: "bundle_overlap",
      message: `Bundles cannot be both preload and remote: ${overlappingBundles.join(", ")}.`
    });
  }

  if (!isNonEmptyString(config.assetCdnBaseUrl) || !isHttpsUrl(config.assetCdnBaseUrl)) {
    issues.push({
      severity: "error",
      code: "invalid_asset_cdn_base_url",
      message: "assetCdnBaseUrl must be an absolute HTTPS URL."
    });
  }

  if (!isNonEmptyString(config.loginExchangePath) || !config.loginExchangePath.startsWith("/")) {
    issues.push({
      severity: "error",
      code: "invalid_login_exchange_path",
      message: "loginExchangePath must be a non-empty absolute path starting with '/'."
    });
  }

  if (socketDomains.length === 0) {
    issues.push({
      severity: "error",
      code: "socket_domains_required",
      message: "socketDomains must list at least one WSS safety domain."
    });
  } else if (!isOriginListWithProtocol(socketDomains, "wss:")) {
    issues.push({
      severity: "error",
      code: "invalid_socket_domains",
      message: "socketDomains must be WSS origins without path segments."
    });
  }

  if (requestDomains.length === 0) {
    issues.push({
      severity: "error",
      code: "request_domains_required",
      message: "requestDomains must list at least one HTTPS safety domain."
    });
  } else if (!isOriginListWithProtocol(requestDomains, "https:")) {
    issues.push({
      severity: "error",
      code: "invalid_request_domains",
      message: "requestDomains must be HTTPS origins without path segments."
    });
  }

  if (!isNonEmptyString(config.notes)) {
    issues.push({
      severity: "warning",
      code: "notes_missing",
      message: "notes is empty; keep a short reminder that this file is still scaffold-only."
    });
  }

  return issues;
}
