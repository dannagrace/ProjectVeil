import {
  recordAuthTokenDeliveryAttempt,
  recordAuthTokenDeliveryDeadLetter,
  recordAuthTokenDeliveryFailure,
  recordAuthTokenDeliveryRequest,
  recordAuthTokenDeliveryRetry,
  recordAuthTokenDeliverySuccess,
  setAuthTokenDeliveryDeadLetterCount,
  setAuthTokenDeliveryQueueCount
} from "./observability";

export type AccountTokenDeliveryKind = "account-registration" | "password-recovery";
export type AccountTokenDeliveryMode = "disabled" | "dev-token" | "webhook";
export type AccountTokenDeliveryStatus = "disabled" | "delivered" | "dev-token" | "retry_scheduled";
export type AccountTokenDeliveryFailureReason =
  | "misconfigured"
  | "timeout"
  | "network"
  | "webhook_4xx"
  | "webhook_429"
  | "webhook_5xx";

export interface AccountTokenDeliveryPayload {
  kind: AccountTokenDeliveryKind;
  loginId: string;
  token: string;
  expiresAt: string;
  requestedDisplayName?: string;
  playerId?: string;
}

interface WebhookDeliveryConfig {
  url: string;
  bearerToken?: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

interface QueuedDeliveryEntry {
  key: string;
  payload: AccountTokenDeliveryPayload;
  config: WebhookDeliveryConfig;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lastError?: {
    message: string;
    failureReason: AccountTokenDeliveryFailureReason;
    statusCode?: number;
  };
}

export interface AccountTokenDeliveryResult {
  deliveryMode: AccountTokenDeliveryMode;
  deliveryStatus: AccountTokenDeliveryStatus;
  responseToken?: string;
  attemptCount?: number;
  maxAttempts?: number;
  nextAttemptAt?: string;
}

export class AccountTokenDeliveryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountTokenDeliveryConfigurationError";
  }
}

export class AccountTokenDeliveryError extends Error {
  readonly retryable: boolean;
  readonly failureReason: AccountTokenDeliveryFailureReason;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      failureReason: AccountTokenDeliveryFailureReason;
      statusCode?: number;
    }
  ) {
    super(message);
    this.name = "AccountTokenDeliveryError";
    this.retryable = options.retryable;
    this.failureReason = options.failureReason;
    if (options.statusCode != null) {
      this.statusCode = options.statusCode;
    }
  }
}

const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;
const DEFAULT_WEBHOOK_MAX_ATTEMPTS = 4;
const DEFAULT_WEBHOOK_RETRY_BASE_DELAY_MS = 5_000;
const DEFAULT_WEBHOOK_RETRY_MAX_DELAY_MS = 60_000;

const queuedDeliveries = new Map<string, QueuedDeliveryEntry>();
const deadLetterDeliveries = new Map<string, QueuedDeliveryEntry>();
let queueTimer: NodeJS.Timeout | null = null;
let queueProcessing = false;

function parseEnvNumber(
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

function readDeliveryMode(rawMode: string | undefined): AccountTokenDeliveryMode {
  const normalized = rawMode?.trim().toLowerCase();
  if (normalized === "disabled") {
    return "disabled";
  }
  if (normalized === "webhook") {
    return "webhook";
  }
  return "dev-token";
}

function readWebhookDeliveryConfig(env: NodeJS.ProcessEnv): WebhookDeliveryConfig {
  const url = env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL?.trim();
  if (!url) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL must be set when webhook delivery mode is enabled"
    );
  }

  return {
    url,
    ...(env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN?.trim()
      ? { bearerToken: env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN.trim() }
      : {}),
    timeoutMs: parseEnvNumber(env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_TIMEOUT_MS, DEFAULT_WEBHOOK_TIMEOUT_MS, {
      minimum: 1,
      integer: true
    }),
    maxAttempts: parseEnvNumber(env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_MAX_ATTEMPTS, DEFAULT_WEBHOOK_MAX_ATTEMPTS, {
      minimum: 1,
      integer: true
    }),
    retryBaseDelayMs: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_BASE_DELAY_MS,
      DEFAULT_WEBHOOK_RETRY_BASE_DELAY_MS,
      {
        minimum: 1,
        integer: true
      }
    ),
    retryMaxDelayMs: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_MAX_DELAY_MS,
      DEFAULT_WEBHOOK_RETRY_MAX_DELAY_MS,
      {
        minimum: 1,
        integer: true
      }
    )
  };
}

function buildDeliveryKey(payload: Pick<AccountTokenDeliveryPayload, "kind" | "loginId">): string {
  return `${payload.kind}:${payload.loginId.trim().toLowerCase()}`;
}

function isExpired(expiresAt: string): boolean {
  const timestamp = new Date(expiresAt).getTime();
  return Number.isNaN(timestamp) || timestamp <= Date.now();
}

function toIsoTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function syncQueueTelemetry(): void {
  setAuthTokenDeliveryQueueCount(queuedDeliveries.size);
  setAuthTokenDeliveryDeadLetterCount(deadLetterDeliveries.size);
}

function computeRetryDelayMs(attemptCount: number, config: WebhookDeliveryConfig): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * 2 ** exponent);
}

function clearQueueTimer(): void {
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
}

function scheduleQueuePump(): void {
  clearQueueTimer();
  if (queuedDeliveries.size === 0) {
    return;
  }

  const nextAttemptAt = Math.min(...Array.from(queuedDeliveries.values()).map((entry) => entry.nextAttemptAt));
  const delayMs = Math.max(0, nextAttemptAt - Date.now());
  queueTimer = setTimeout(() => {
    queueTimer = null;
    void processQueuedDeliveries();
  }, delayMs);
}

function markDeadLetter(entry: QueuedDeliveryEntry, error: AccountTokenDeliveryError, attemptNumber: number): void {
  queuedDeliveries.delete(entry.key);
  deadLetterDeliveries.set(entry.key, {
    ...entry,
    attemptCount: attemptNumber,
    lastError: {
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
    }
  });
  recordAuthTokenDeliveryDeadLetter();
  recordAuthTokenDeliveryAttempt({
    kind: entry.payload.kind,
    loginId: entry.payload.loginId,
    deliveryMode: "webhook",
    status: "dead-lettered",
    attemptCount: attemptNumber,
    maxAttempts: entry.maxAttempts,
    retryable: error.retryable,
    message: error.message,
    failureReason: error.failureReason,
    ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
  });
  syncQueueTelemetry();
}

async function deliverViaWebhook(payload: AccountTokenDeliveryPayload, config: WebhookDeliveryConfig): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {})
      },
      body: JSON.stringify({
        event: payload.kind,
        loginId: payload.loginId,
        token: payload.token,
        expiresAt: payload.expiresAt,
        ...(payload.requestedDisplayName ? { requestedDisplayName: payload.requestedDisplayName } : {}),
        ...(payload.playerId ? { playerId: payload.playerId } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const failureReason: AccountTokenDeliveryFailureReason =
        response.status === 429
          ? "webhook_429"
          : response.status >= 500
            ? "webhook_5xx"
            : "webhook_4xx";
      throw new AccountTokenDeliveryError(
        `Token delivery webhook returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`.trim(),
        {
          retryable: response.status === 429 || response.status >= 500,
          failureReason,
          statusCode: response.status
        }
      );
    }
  } catch (error) {
    if (error instanceof AccountTokenDeliveryError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new AccountTokenDeliveryError(`Token delivery webhook timed out after ${config.timeoutMs}ms`, {
        retryable: true,
        failureReason: "timeout"
      });
    }
    throw new AccountTokenDeliveryError(
      `Token delivery webhook request failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        retryable: true,
        failureReason: "network"
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

async function processQueuedDelivery(entry: QueuedDeliveryEntry): Promise<void> {
  if (isExpired(entry.payload.expiresAt)) {
    markDeadLetter(
      entry,
      new AccountTokenDeliveryError("Token delivery retry exhausted because the token expired before delivery succeeded", {
        retryable: false,
        failureReason: "timeout"
      }),
      entry.attemptCount
    );
    return;
  }

  const attemptNumber = entry.attemptCount + 1;
  try {
    await deliverViaWebhook(entry.payload, entry.config);
    queuedDeliveries.delete(entry.key);
    deadLetterDeliveries.delete(entry.key);
    recordAuthTokenDeliverySuccess();
    recordAuthTokenDeliveryAttempt({
      kind: entry.payload.kind,
      loginId: entry.payload.loginId,
      deliveryMode: "webhook",
      status: "delivered",
      attemptCount: attemptNumber,
      maxAttempts: entry.maxAttempts,
      retryable: false,
      message: "Token delivery webhook accepted the payload"
    });
    syncQueueTelemetry();
  } catch (error) {
    if (!(error instanceof AccountTokenDeliveryError)) {
      throw error;
    }

    recordAuthTokenDeliveryFailure(error.failureReason);

    if (!error.retryable || attemptNumber >= entry.maxAttempts) {
      markDeadLetter(entry, error, attemptNumber);
      return;
    }

    const nextAttemptAt = Date.now() + computeRetryDelayMs(attemptNumber, entry.config);
    queuedDeliveries.set(entry.key, {
      ...entry,
      attemptCount: attemptNumber,
      nextAttemptAt,
      lastError: {
        message: error.message,
        failureReason: error.failureReason,
        ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
      }
    });
    recordAuthTokenDeliveryRetry();
    recordAuthTokenDeliveryAttempt({
      kind: entry.payload.kind,
      loginId: entry.payload.loginId,
      deliveryMode: "webhook",
      status: "retry_scheduled",
      attemptCount: attemptNumber,
      maxAttempts: entry.maxAttempts,
      retryable: true,
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {}),
      nextAttemptAt: toIsoTimestamp(nextAttemptAt)
    });
    syncQueueTelemetry();
  }
}

async function processQueuedDeliveries(): Promise<void> {
  if (queueProcessing) {
    scheduleQueuePump();
    return;
  }

  queueProcessing = true;
  try {
    while (true) {
      const dueEntry = Array.from(queuedDeliveries.values())
        .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt)[0];
      if (!dueEntry || dueEntry.nextAttemptAt > Date.now()) {
        break;
      }

      await processQueuedDelivery(dueEntry);
    }
  } finally {
    queueProcessing = false;
    scheduleQueuePump();
  }
}

function queueRetry(payload: AccountTokenDeliveryPayload, config: WebhookDeliveryConfig, error: AccountTokenDeliveryError): AccountTokenDeliveryResult {
  const key = buildDeliveryKey(payload);
  const existing = queuedDeliveries.get(key);
  if (existing && existing.payload.token === payload.token) {
    return {
      deliveryMode: "webhook",
      deliveryStatus: "retry_scheduled",
      attemptCount: existing.attemptCount,
      maxAttempts: existing.maxAttempts,
      nextAttemptAt: toIsoTimestamp(existing.nextAttemptAt)
    };
  }

  const nextAttemptAt = Date.now() + computeRetryDelayMs(1, config);
  queuedDeliveries.set(key, {
    key,
    payload,
    config,
    attemptCount: 1,
    maxAttempts: config.maxAttempts,
    nextAttemptAt,
    lastError: {
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
    }
  });
  deadLetterDeliveries.delete(key);
  recordAuthTokenDeliveryRetry();
  recordAuthTokenDeliveryAttempt({
    kind: payload.kind,
    loginId: payload.loginId,
    deliveryMode: "webhook",
    status: "retry_scheduled",
    attemptCount: 1,
    maxAttempts: config.maxAttempts,
    retryable: true,
    message: error.message,
    failureReason: error.failureReason,
    ...(error.statusCode != null ? { statusCode: error.statusCode } : {}),
    nextAttemptAt: toIsoTimestamp(nextAttemptAt)
  });
  syncQueueTelemetry();
  scheduleQueuePump();

  return {
    deliveryMode: "webhook",
    deliveryStatus: "retry_scheduled",
    attemptCount: 1,
    maxAttempts: config.maxAttempts,
    nextAttemptAt: toIsoTimestamp(nextAttemptAt)
  };
}

export function readAccountRegistrationDeliveryMode(env: NodeJS.ProcessEnv = process.env): AccountTokenDeliveryMode {
  return readDeliveryMode(env.VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE);
}

export function readPasswordRecoveryDeliveryMode(env: NodeJS.ProcessEnv = process.env): AccountTokenDeliveryMode {
  return readDeliveryMode(env.VEIL_PASSWORD_RECOVERY_DELIVERY_MODE);
}

export function clearAccountTokenDeliveryState(kind: AccountTokenDeliveryKind, loginId: string): void {
  const key = buildDeliveryKey({ kind, loginId });
  queuedDeliveries.delete(key);
  deadLetterDeliveries.delete(key);
  syncQueueTelemetry();
  scheduleQueuePump();
}

export function resetAccountTokenDeliveryState(): void {
  clearQueueTimer();
  queuedDeliveries.clear();
  deadLetterDeliveries.clear();
  queueProcessing = false;
  syncQueueTelemetry();
}

export async function deliverAccountToken(
  mode: AccountTokenDeliveryMode,
  payload: AccountTokenDeliveryPayload,
  env: NodeJS.ProcessEnv = process.env
): Promise<AccountTokenDeliveryResult> {
  recordAuthTokenDeliveryRequest();

  if (mode === "disabled") {
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: mode,
      status: "disabled",
      attemptCount: 0,
      maxAttempts: 0,
      retryable: false,
      message: "Account token delivery is disabled"
    });
    return { deliveryMode: mode, deliveryStatus: "disabled" };
  }

  if (mode === "dev-token") {
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: mode,
      status: "dev-token",
      attemptCount: 0,
      maxAttempts: 0,
      retryable: false,
      message: "Account token returned in-band for development"
    });
    return {
      deliveryMode: mode,
      deliveryStatus: "dev-token",
      responseToken: payload.token
    };
  }

  const config = readWebhookDeliveryConfig(env);
  const key = buildDeliveryKey(payload);
  const existing = queuedDeliveries.get(key);
  if (existing && existing.payload.token === payload.token && !isExpired(existing.payload.expiresAt)) {
    return {
      deliveryMode: "webhook",
      deliveryStatus: "retry_scheduled",
      attemptCount: existing.attemptCount,
      maxAttempts: existing.maxAttempts,
      nextAttemptAt: toIsoTimestamp(existing.nextAttemptAt)
    };
  }

  try {
    await deliverViaWebhook(payload, config);
    queuedDeliveries.delete(key);
    deadLetterDeliveries.delete(key);
    recordAuthTokenDeliverySuccess();
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: "webhook",
      status: "delivered",
      attemptCount: 1,
      maxAttempts: config.maxAttempts,
      retryable: false,
      message: "Token delivery webhook accepted the payload"
    });
    syncQueueTelemetry();
    return {
      deliveryMode: "webhook",
      deliveryStatus: "delivered",
      attemptCount: 1,
      maxAttempts: config.maxAttempts
    };
  } catch (error) {
    if (!(error instanceof AccountTokenDeliveryError)) {
      throw error;
    }

    recordAuthTokenDeliveryFailure(error.failureReason);

    if (error.retryable && config.maxAttempts > 1 && !isExpired(payload.expiresAt)) {
      return queueRetry(payload, config, error);
    }

    deadLetterDeliveries.set(key, {
      key,
      payload,
      config,
      attemptCount: 1,
      maxAttempts: config.maxAttempts,
      nextAttemptAt: Date.now(),
      lastError: {
        message: error.message,
        failureReason: error.failureReason,
        ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
      }
    });
    recordAuthTokenDeliveryDeadLetter();
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: "webhook",
      status: "dead-lettered",
      attemptCount: 1,
      maxAttempts: config.maxAttempts,
      retryable: error.retryable,
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
    });
    syncQueueTelemetry();
    throw error;
  }
}
