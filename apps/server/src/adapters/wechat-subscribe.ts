import type { RoomSnapshotStore } from "@server/persistence";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import { getNotificationPreferenceValue } from "@server/adapters/wechat-social";

export type WechatSubscribeTemplateKey = "match_found" | "turn_reminder" | "reengagement";

interface WechatSubscribeRuntimeConfig {
  appId: string;
  appSecret: string;
  matchFoundTemplateId: string;
  turnReminderTemplateId: string;
  reengagementTemplateId: string;
  tokenUrl: string;
  sendUrl: string;
}

interface WechatAccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

interface WechatSubscribeSendResponse {
  errcode?: number;
  errmsg?: string;
}

interface WechatSubscribeLoggerLike {
  error(message: string, details?: unknown): void;
}

interface WechatSubscribeSendOptions {
  store?: RoomSnapshotStore | null;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  logger?: WechatSubscribeLoggerLike;
}

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

function normalizeConfigValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readWechatSubscribeRuntimeConfig(env: NodeJS.ProcessEnv = process.env): WechatSubscribeRuntimeConfig | null {
  const appId = normalizeConfigValue(env.WECHAT_APP_ID);
  const appSecret = normalizeConfigValue(readRuntimeSecret("WECHAT_APP_SECRET", env));
  const matchFoundTemplateId = normalizeConfigValue(env.VEIL_WECHAT_MATCH_FOUND_TMPL_ID);
  const turnReminderTemplateId = normalizeConfigValue(env.VEIL_WECHAT_TURN_REMINDER_TMPL_ID);
  const reengagementTemplateId = normalizeConfigValue(env.VEIL_WECHAT_REENGAGEMENT_TMPL_ID) ?? turnReminderTemplateId;
  if (!appId || !appSecret || !matchFoundTemplateId || !turnReminderTemplateId || !reengagementTemplateId) {
    return null;
  }

  return {
    appId,
    appSecret,
    matchFoundTemplateId,
    turnReminderTemplateId,
    reengagementTemplateId,
    tokenUrl: normalizeConfigValue(env.VEIL_WECHAT_SUBSCRIBE_ACCESS_TOKEN_URL) ?? "https://api.weixin.qq.com/cgi-bin/token",
    sendUrl: normalizeConfigValue(env.VEIL_WECHAT_SUBSCRIBE_SEND_URL) ?? "https://api.weixin.qq.com/cgi-bin/message/subscribe/send"
  };
}

function getTemplateId(config: WechatSubscribeRuntimeConfig, templateKey: WechatSubscribeTemplateKey): string {
  if (templateKey === "match_found") {
    return config.matchFoundTemplateId;
  }
  if (templateKey === "reengagement") {
    return config.reengagementTemplateId;
  }
  return config.turnReminderTemplateId;
}

function normalizeSubscribeMessageData(data: Record<string, unknown>): Record<string, { value: string }> {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [
        key,
        {
          value:
            typeof value === "string"
              ? value
              : typeof value === "number" || typeof value === "boolean"
                ? String(value)
                : JSON.stringify(value)
        }
      ])
  );
}

async function readWechatAccessToken(
  config: WechatSubscribeRuntimeConfig,
  options: Required<Pick<WechatSubscribeSendOptions, "fetchImpl" | "now" | "logger">>
): Promise<string | null> {
  const currentTime = options.now();
  if (cachedAccessToken && cachedAccessToken.expiresAtMs > currentTime) {
    return cachedAccessToken.token;
  }

  const tokenUrl = new URL(config.tokenUrl);
  tokenUrl.searchParams.set("grant_type", "client_credential");
  tokenUrl.searchParams.set("appid", config.appId);
  tokenUrl.searchParams.set("secret", config.appSecret);

  try {
    const response = await options.fetchImpl(tokenUrl, { method: "GET" });
    const payload = (await response.json()) as WechatAccessTokenResponse;
    if (!response.ok || payload.errcode || !payload.access_token) {
      options.logger.error("[wechat-subscribe] Failed to obtain WeChat access token", {
        statusCode: response.status,
        payload
      });
      return null;
    }

    const expiresInSeconds = Math.max(60, Math.floor(payload.expires_in ?? 7200));
    cachedAccessToken = {
      token: payload.access_token,
      expiresAtMs: currentTime + Math.max(60_000, (expiresInSeconds - 60) * 1000)
    };
    return cachedAccessToken.token;
  } catch (error) {
    options.logger.error("[wechat-subscribe] Failed to fetch WeChat access token", { error });
    return null;
  }
}

export function resetWechatSubscribeRuntimeForTests(): void {
  cachedAccessToken = null;
}

export async function sendWechatSubscribeMessage(
  playerId: string,
  templateKey: WechatSubscribeTemplateKey,
  data: Record<string, unknown>,
  options: WechatSubscribeSendOptions = {}
): Promise<boolean> {
  const store = options.store ?? null;
  const logger = options.logger ?? console;
  const config = readWechatSubscribeRuntimeConfig(options.env);
  if (!store || !config) {
    return false;
  }

  const account = await store.loadPlayerAccount(playerId);
  if (!account?.wechatMiniGameOpenId?.trim()) {
    return false;
  }

  const preferenceKey = templateKey === "match_found" ? "matchFound" : templateKey === "reengagement" ? "reengagement" : "turnReminder";
  if (!getNotificationPreferenceValue(account.notificationPreferences, preferenceKey)) {
    return false;
  }

  const accessToken = await readWechatAccessToken(config, {
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => Date.now()),
    logger
  });
  if (!accessToken) {
    return false;
  }

  const requestUrl = new URL(config.sendUrl);
  requestUrl.searchParams.set("access_token", accessToken);
  const requestBody = {
    touser: account.wechatMiniGameOpenId!.trim(),
    template_id: getTemplateId(config, templateKey),
    data: normalizeSubscribeMessageData(data)
  };

  try {
    const response = await (options.fetchImpl ?? fetch)(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(requestBody)
    });
    const payload = (await response.json()) as WechatSubscribeSendResponse;
    if (!response.ok || (payload.errcode ?? 0) !== 0) {
      logger.error("[wechat-subscribe] Failed to send WeChat subscribe message", {
        playerId,
        templateKey,
        statusCode: response.status,
        payload
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error("[wechat-subscribe] Failed to send WeChat subscribe message", {
      playerId,
      templateKey,
      error
    });
    return false;
  }
}
