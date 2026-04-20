import type {
  SuspiciousActionAlertConfig,
  WebSocketActionRateLimitConfig
} from "@server/transport/colyseus-room/types";
import {
  DEFAULT_SUSPICIOUS_ACTION_THRESHOLD,
  DEFAULT_SUSPICIOUS_ACTION_WINDOW_MS,
  DEFAULT_WS_ACTION_RATE_LIMIT_MAX,
  DEFAULT_WS_ACTION_RATE_LIMIT_WINDOW_MS
} from "@server/transport/colyseus-room/constants";

export function parseEnvNumber(
  value: string | undefined,
  fallback: number,
  options: { minimum?: number; integer?: boolean } = {}
): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = options.integer ? Math.floor(parsed) : parsed;
  if (options.minimum != null && normalized < options.minimum) {
    return fallback;
  }

  return normalized;
}

export function readWebSocketActionRateLimitConfig(env: NodeJS.ProcessEnv = process.env): WebSocketActionRateLimitConfig {
  return {
    windowMs: parseEnvNumber(env.VEIL_RATE_LIMIT_WS_ACTION_WINDOW_MS, DEFAULT_WS_ACTION_RATE_LIMIT_WINDOW_MS, {
      minimum: 1,
      integer: true
    }),
    max: parseEnvNumber(env.VEIL_RATE_LIMIT_WS_ACTION_MAX, DEFAULT_WS_ACTION_RATE_LIMIT_MAX, {
      minimum: 1,
      integer: true
    })
  };
}

export function readSuspiciousActionAlertConfig(env: NodeJS.ProcessEnv = process.env): SuspiciousActionAlertConfig {
  return {
    windowMs: parseEnvNumber(env.VEIL_ANTI_CHEAT_SUSPICIOUS_ACTION_WINDOW_MS, DEFAULT_SUSPICIOUS_ACTION_WINDOW_MS, {
      minimum: 1,
      integer: true
    }),
    threshold: parseEnvNumber(env.VEIL_ANTI_CHEAT_SUSPICIOUS_ACTION_THRESHOLD, DEFAULT_SUSPICIOUS_ACTION_THRESHOLD, {
      minimum: 1,
      integer: true
    })
  };
}
