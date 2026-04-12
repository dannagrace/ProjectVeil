import { createSign } from "node:crypto";
import { connect } from "node:http2";
import type { MobilePushTokenRegistration } from "../../../packages/shared/src/index";
import type { RoomSnapshotStore } from "./persistence";
import { removeMobilePushToken } from "./mobile-push-tokens";
import { getNotificationPreferenceValue } from "./wechat-social";

export type MobilePushTemplateKey = "match_found" | "turn_reminder";
type MobilePushPreferenceKey = "matchFound" | "turnReminder";
type MobilePushDeliveryResult = "sent" | "failed" | "invalid_token" | "skipped";

interface MobilePushLoggerLike {
  error(message: string, details?: unknown): void;
}

interface MobilePushNotificationMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

interface ApnsRuntimeConfig {
  keyId: string;
  teamId: string;
  privateKey: string;
  topic: string;
  host: string;
}

interface FcmRuntimeConfig {
  serverKey: string;
  sendUrl: string;
}

interface MobilePushRuntimeOptions {
  store?: RoomSnapshotStore | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  logger?: MobilePushLoggerLike;
  now?: () => number;
  connectHttp2Impl?: typeof connect;
  sendApnsImpl?: (
    registration: MobilePushTokenRegistration,
    message: MobilePushNotificationMessage,
    config: ApnsRuntimeConfig,
    options: Required<Pick<MobilePushRuntimeOptions, "connectHttp2Impl" | "logger" | "now">>
  ) => Promise<MobilePushDeliveryResult>;
  sendFcmImpl?: (
    registration: MobilePushTokenRegistration,
    message: MobilePushNotificationMessage,
    config: FcmRuntimeConfig,
    options: Required<Pick<MobilePushRuntimeOptions, "fetchImpl" | "logger">>
  ) => Promise<MobilePushDeliveryResult>;
}

function normalizeConfigValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readApnsRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ApnsRuntimeConfig | null {
  const keyId = normalizeConfigValue(env.VEIL_APNS_KEY_ID);
  const teamId = normalizeConfigValue(env.VEIL_APNS_TEAM_ID);
  const privateKey = normalizeConfigValue(env.VEIL_APNS_PRIVATE_KEY);
  const topic = normalizeConfigValue(env.VEIL_APNS_TOPIC);
  if (!keyId || !teamId || !privateKey || !topic) {
    return null;
  }

  const useSandbox = env.VEIL_APNS_USE_SANDBOX?.trim()
    ? env.VEIL_APNS_USE_SANDBOX.trim().toLowerCase() !== "false"
    : env.NODE_ENV !== "production";

  return {
    keyId,
    teamId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    topic,
    host: normalizeConfigValue(env.VEIL_APNS_HOST) ?? (useSandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com")
  };
}

function readFcmRuntimeConfig(env: NodeJS.ProcessEnv = process.env): FcmRuntimeConfig | null {
  const serverKey = normalizeConfigValue(env.VEIL_FCM_SERVER_KEY);
  if (!serverKey) {
    return null;
  }

  return {
    serverKey,
    sendUrl: normalizeConfigValue(env.VEIL_FCM_SEND_URL) ?? "https://fcm.googleapis.com/fcm/send"
  };
}

function toPreferenceKey(templateKey: MobilePushTemplateKey): MobilePushPreferenceKey {
  return templateKey === "match_found" ? "matchFound" : "turnReminder";
}

function stringifyDataValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function buildNotificationMessage(
  templateKey: MobilePushTemplateKey,
  data: Record<string, unknown>
): MobilePushNotificationMessage {
  if (templateKey === "match_found") {
    const opponentName = typeof data.opponentName === "string" && data.opponentName.trim() ? data.opponentName.trim() : "Opponent";
    const mapName = typeof data.mapName === "string" && data.mapName.trim() ? data.mapName.trim() : "the arena";
    return {
      title: "Match Found",
      body: `${opponentName} is ready on ${mapName}.`,
      data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, stringifyDataValue(value)]))
    };
  }

  const roomId = typeof data.roomId === "string" && data.roomId.trim() ? data.roomId.trim() : "your async match";
  const turnNumber = typeof data.turnNumber === "number" ? Math.max(1, Math.floor(data.turnNumber)) : 1;
  return {
    title: "Your Turn",
    body: `Turn ${turnNumber} is waiting in ${roomId}.`,
    data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, stringifyDataValue(value)]))
  };
}

function createApnsJwt(config: ApnsRuntimeConfig, now: number): string {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: "ES256", kid: config.keyId })).toString("base64url");
  const encodedPayload = Buffer.from(
    JSON.stringify({
      iss: config.teamId,
      iat: Math.floor(now / 1000)
    })
  ).toString("base64url");
  const signer = createSign("sha256");
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign(config.privateKey).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function sendApnsNotification(
  registration: MobilePushTokenRegistration,
  message: MobilePushNotificationMessage,
  config: ApnsRuntimeConfig,
  options: Required<Pick<MobilePushRuntimeOptions, "connectHttp2Impl" | "logger" | "now">>
): Promise<MobilePushDeliveryResult> {
  const session = options.connectHttp2Impl(config.host);

  try {
    const response = await new Promise<{ headers: Record<string, string | number | string[] | undefined>; body: string }>((resolve, reject) => {
      const request = session.request({
        ":method": "POST",
        ":path": `/3/device/${encodeURIComponent(registration.token)}`,
        authorization: `bearer ${createApnsJwt(config, options.now())}`,
        "apns-topic": config.topic,
        "apns-push-type": "alert",
        "content-type": "application/json"
      });

      const chunks: Buffer[] = [];
      let headers: Record<string, string | number | string[] | undefined> = {};
      request.on("response", (nextHeaders) => {
        headers = nextHeaders;
      });
      request.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      request.on("end", () => {
        resolve({
          headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
      request.on("error", reject);
      request.end(
        JSON.stringify({
          aps: {
            alert: {
              title: message.title,
              body: message.body
            },
            sound: "default"
          },
          ...message.data
        })
      );
    });

    const statusCode = Number(response.headers[":status"] ?? 0);
    if (statusCode >= 200 && statusCode < 300) {
      return "sent";
    }

    const payload = response.body ? (JSON.parse(response.body) as { reason?: string }) : {};
    if (payload.reason === "BadDeviceToken" || payload.reason === "Unregistered" || payload.reason === "DeviceTokenNotForTopic") {
      return "invalid_token";
    }

    options.logger.error("[mobile-push] APNs send failed", {
      platform: registration.platform,
      statusCode,
      tokenSuffix: registration.token.slice(-8),
      payload
    });
    return "failed";
  } catch (error) {
    options.logger.error("[mobile-push] APNs send failed", {
      platform: registration.platform,
      tokenSuffix: registration.token.slice(-8),
      error
    });
    return "failed";
  } finally {
    session.close();
  }
}

async function sendFcmNotification(
  registration: MobilePushTokenRegistration,
  message: MobilePushNotificationMessage,
  config: FcmRuntimeConfig,
  options: Required<Pick<MobilePushRuntimeOptions, "fetchImpl" | "logger">>
): Promise<MobilePushDeliveryResult> {
  try {
    const response = await options.fetchImpl(config.sendUrl, {
      method: "POST",
      headers: {
        Authorization: `key=${config.serverKey}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        to: registration.token,
        notification: {
          title: message.title,
          body: message.body
        },
        data: message.data,
        priority: "high"
      })
    });
    const payload = (await response.json()) as { results?: Array<{ error?: string }> };
    const errorCode = payload.results?.[0]?.error;

    if (response.ok && !errorCode) {
      return "sent";
    }
    if (errorCode === "InvalidRegistration" || errorCode === "NotRegistered") {
      return "invalid_token";
    }

    options.logger.error("[mobile-push] FCM send failed", {
      platform: registration.platform,
      statusCode: response.status,
      tokenSuffix: registration.token.slice(-8),
      payload
    });
    return "failed";
  } catch (error) {
    options.logger.error("[mobile-push] FCM send failed", {
      platform: registration.platform,
      tokenSuffix: registration.token.slice(-8),
      error
    });
    return "failed";
  }
}

export async function sendMobilePushNotification(
  playerId: string,
  templateKey: MobilePushTemplateKey,
  data: Record<string, unknown>,
  options: MobilePushRuntimeOptions = {}
): Promise<boolean> {
  const store = options.store ?? null;
  if (!store) {
    return false;
  }

  const logger = options.logger ?? console;
  const account = await store.loadPlayerAccount(playerId);
  if (!account?.pushTokens?.length) {
    return false;
  }
  if (!getNotificationPreferenceValue(account.notificationPreferences, toPreferenceKey(templateKey))) {
    return false;
  }

  const apnsConfig = readApnsRuntimeConfig(options.env);
  const fcmConfig = readFcmRuntimeConfig(options.env);
  const message = buildNotificationMessage(templateKey, data);
  const sendApnsImpl = options.sendApnsImpl ?? sendApnsNotification;
  const sendFcmImpl = options.sendFcmImpl ?? sendFcmNotification;
  const connectHttp2Impl = options.connectHttp2Impl ?? connect;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  let anySent = false;
  let nextPushTokens: MobilePushTokenRegistration[] | undefined = account.pushTokens;
  let shouldPersistPrunedTokens = false;

  for (const registration of account.pushTokens) {
    let result: MobilePushDeliveryResult = "skipped";
    if (registration.platform === "ios" && apnsConfig) {
      result = await sendApnsImpl(registration, message, apnsConfig, { connectHttp2Impl, logger, now });
    } else if (registration.platform === "android" && fcmConfig) {
      result = await sendFcmImpl(registration, message, fcmConfig, { fetchImpl, logger });
    }

    if (result === "sent") {
      anySent = true;
    } else if (result === "invalid_token") {
      shouldPersistPrunedTokens = true;
      nextPushTokens = removeMobilePushToken(nextPushTokens, {
        platform: registration.platform,
        token: registration.token
      });
    }
  }

  if (shouldPersistPrunedTokens) {
    try {
      await store.savePlayerAccountProfile(playerId, { pushTokens: nextPushTokens ?? null });
    } catch (error) {
      logger.error("[mobile-push] Failed to prune invalid mobile push token", {
        playerId,
        error
      });
    }
  }

  return anySent;
}
