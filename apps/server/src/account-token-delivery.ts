export type AccountTokenDeliveryKind = "account-registration" | "password-recovery";
export type AccountTokenDeliveryMode = "disabled" | "dev-token" | "webhook";

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
}

export interface AccountTokenDeliveryResult {
  deliveryMode: AccountTokenDeliveryMode;
  responseToken?: string;
}

export class AccountTokenDeliveryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountTokenDeliveryConfigurationError";
  }
}

export class AccountTokenDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountTokenDeliveryError";
  }
}

const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;

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
    })
  };
}

export function readAccountRegistrationDeliveryMode(env: NodeJS.ProcessEnv = process.env): AccountTokenDeliveryMode {
  return readDeliveryMode(env.VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE);
}

export function readPasswordRecoveryDeliveryMode(env: NodeJS.ProcessEnv = process.env): AccountTokenDeliveryMode {
  return readDeliveryMode(env.VEIL_PASSWORD_RECOVERY_DELIVERY_MODE);
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
      throw new AccountTokenDeliveryError(
        `Token delivery webhook returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`.trim()
      );
    }
  } catch (error) {
    if (error instanceof AccountTokenDeliveryError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new AccountTokenDeliveryError(`Token delivery webhook timed out after ${config.timeoutMs}ms`);
    }
    throw new AccountTokenDeliveryError(
      `Token delivery webhook request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function deliverAccountToken(
  mode: AccountTokenDeliveryMode,
  payload: AccountTokenDeliveryPayload,
  env: NodeJS.ProcessEnv = process.env
): Promise<AccountTokenDeliveryResult> {
  if (mode === "disabled") {
    return { deliveryMode: mode };
  }

  if (mode === "dev-token") {
    return {
      deliveryMode: mode,
      responseToken: payload.token
    };
  }

  await deliverViaWebhook(payload, readWebhookDeliveryConfig(env));
  return { deliveryMode: mode };
}
