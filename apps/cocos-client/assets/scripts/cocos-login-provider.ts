import {
  loginCocosGuestAuthSession,
  loginCocosPasswordAuthSession,
  loginCocosWechatAuthSession
} from "./cocos-lobby.ts";
import type { CocosStoredAuthSession } from "./cocos-session-launch.ts";
import type { CocosRuntimeCapabilities, CocosRuntimePlatform } from "./cocos-runtime-platform.ts";

export type CocosLoginProviderId = "guest" | "account-password" | "wechat-mini-game";

export interface CocosWechatMiniGameRuntimeConfig {
  enabled: boolean;
  appId?: string | undefined;
  exchangePath: string;
  mockCode?: string | undefined;
}

export interface CocosLoginRuntimeConfig {
  wechatMiniGame: CocosWechatMiniGameRuntimeConfig;
}

export interface CocosWechatMiniGameLike {
  login?: ((options: {
    timeout?: number;
    success?: (result: { code?: string }) => void;
    fail?: (error: { errMsg?: string }) => void;
  }) => void) | undefined;
  getUserProfile?: ((options: {
    desc: string;
    lang?: string;
    success?: (result: { userInfo?: { nickName?: string; avatarUrl?: string } }) => void;
    fail?: (error: { errMsg?: string }) => void;
  }) => void) | undefined;
}

export interface CocosLoginProviderEnvironmentLike {
  __PROJECT_VEIL_RUNTIME_CONFIG__?: {
    wechatMiniGame?: {
      enabled?: unknown;
      appId?: unknown;
      exchangePath?: unknown;
      mockCode?: unknown;
    };
  };
  process?: {
    env?: Record<string, string | undefined>;
  };
  wx?: CocosWechatMiniGameLike | null;
}

export interface CocosLoginProviderDescriptor {
  id: CocosLoginProviderId;
  label: string;
  available: boolean;
  message: string;
}

export type CocosLoginRequest =
  | {
      provider: "guest";
      playerId: string;
      displayName: string;
    }
  | {
      provider: "account-password";
      loginId: string;
      password: string;
    }
  | {
      provider: "wechat-mini-game";
      playerId: string;
      displayName: string;
      timeoutMs?: number;
    };

export interface CocosLoginOptions {
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, "setItem"> | null;
  wx?: CocosWechatMiniGameLike | null;
  config?: CocosLoginRuntimeConfig;
  authToken?: string | null;
  privacyConsentAccepted?: boolean;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return null;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveCocosLoginRuntimeConfig(
  environment: CocosLoginProviderEnvironmentLike = globalThis as CocosLoginProviderEnvironmentLike
): CocosLoginRuntimeConfig {
  const runtimeWechat = environment.__PROJECT_VEIL_RUNTIME_CONFIG__?.wechatMiniGame;
  const env = environment.process?.env ?? {};
  const enabled =
    normalizeBoolean(runtimeWechat?.enabled) ??
    normalizeBoolean(env.VEIL_WECHAT_MINIGAME_LOGIN_ENABLED) ??
    Boolean(normalizeString(runtimeWechat?.appId) || normalizeString(runtimeWechat?.mockCode));

  return {
    wechatMiniGame: {
      enabled,
      ...(normalizeString(runtimeWechat?.appId) ?? normalizeString(env.VEIL_WECHAT_MINIGAME_APP_ID)
        ? { appId: normalizeString(runtimeWechat?.appId) ?? normalizeString(env.VEIL_WECHAT_MINIGAME_APP_ID) }
        : {}),
      exchangePath:
        normalizeString(runtimeWechat?.exchangePath) ??
        normalizeString(env.VEIL_WECHAT_MINIGAME_LOGIN_EXCHANGE_PATH) ??
        "/api/auth/wechat-login",
      ...(normalizeString(runtimeWechat?.mockCode) ?? normalizeString(env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE)
        ? {
            mockCode:
              normalizeString(runtimeWechat?.mockCode) ?? normalizeString(env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE)
          }
        : {})
    }
  };
}

export function resolveCocosLoginProviders(input: {
  platform: CocosRuntimePlatform;
  capabilities: CocosRuntimeCapabilities;
  config: CocosLoginRuntimeConfig;
  wx?: CocosWechatMiniGameLike | null;
}): CocosLoginProviderDescriptor[] {
  const providers: CocosLoginProviderDescriptor[] = [
    {
      id: "guest",
      label: "游客进入",
      available: true,
      message: "始终可用，必要时会退化成本地游客会话。"
    },
    {
      id: "account-password",
      label: "账号登录并进入",
      available: input.platform !== "wechat-game",
      message:
        input.platform === "wechat-game"
          ? "小游戏环境优先预留给 wx.login() 交换链路；账号口令仍建议在 H5 调试壳处理。"
          : "H5 调试壳可继续使用现有登录 ID / 口令链路。"
    }
  ];

  const hasWechatRuntime = input.platform === "wechat-game" && input.capabilities.supportsWechatLogin;
  const hasWechatLoginApi = typeof input.wx?.login === "function";
  const canUseMockCode = Boolean(input.config.wechatMiniGame.mockCode);
  providers.push({
    id: "wechat-mini-game",
    label: "微信登录",
    available: hasWechatRuntime && input.config.wechatMiniGame.enabled && hasWechatLoginApi,
    message: !hasWechatRuntime
      ? "仅在微信小游戏运行时暴露。"
      : !input.config.wechatMiniGame.enabled
        ? "小游戏登录交换已留接口，但当前未启用。"
        : hasWechatLoginApi
          ? "将尝试调用 wx.login()，再把 code 交给服务端交换会话。"
          : canUseMockCode
            ? "当前小游戏壳没有暴露 wx.login()，因此入口保持隐藏；开发联调可继续用 mock code 直调接口。"
            : "当前小游戏壳没有暴露 wx.login()。"
  });

  return providers;
}

export async function loginWithCocosProvider(
  remoteUrl: string,
  request: CocosLoginRequest,
  options?: CocosLoginOptions
): Promise<CocosStoredAuthSession> {
  switch (request.provider) {
    case "guest":
      return loginCocosGuestAuthSession(remoteUrl, request.playerId, request.displayName, options);
    case "account-password":
      return loginCocosPasswordAuthSession(remoteUrl, request.loginId, request.password, options);
    case "wechat-mini-game":
      return loginCocosWechatAuthSession(remoteUrl, request.playerId, request.displayName, {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options?.storage ? { storage: options.storage } : {}),
        ...(options?.wx ? { wx: options.wx } : {}),
        ...(request.timeoutMs != null ? { timeoutMs: request.timeoutMs } : {}),
        ...(options?.config?.wechatMiniGame.exchangePath
          ? { exchangePath: options.config.wechatMiniGame.exchangePath }
          : {}),
        ...(options?.config?.wechatMiniGame.mockCode ? { mockCode: options.config.wechatMiniGame.mockCode } : {}),
        ...(options?.authToken ? { authToken: options.authToken } : {}),
        ...(options?.privacyConsentAccepted ? { privacyConsentAccepted: true } : {})
      });
  }
}
