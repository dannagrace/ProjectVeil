import { Buffer } from "node:buffer";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export const RUNTIME_SECRET_KEYS = [
  "ADMIN_SECRET",
  "SUPPORT_MODERATOR_SECRET",
  "SUPPORT_SUPERVISOR_SECRET",
  "VEIL_ADMIN_TOKEN",
  "VEIL_AUTH_SECRET",
  "VEIL_AUTH_TOKEN_DELIVERY_SMTP_PASSWORD",
  "VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN",
  "VEIL_MYSQL_PASSWORD",
  "VEIL_WECHAT_GROUP_CHALLENGE_SECRET",
  "VEIL_WECHAT_PAY_API_V3_KEY",
  "VEIL_WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_APP_SECRET"
] as const;

export type RuntimeSecretKey = (typeof RUNTIME_SECRET_KEYS)[number];
export type RuntimeSecretProvider = "env" | "aws-secrets-manager";

export interface RuntimeSecretLoaderDependencies {
  createAwsSecretsManagerClient(region?: string): {
    send(command: GetSecretValueCommand): Promise<{ SecretString?: string; SecretBinary?: Uint8Array }>;
  };
}

const runtimeSecretKeySet = new Set<string>(RUNTIME_SECRET_KEYS);
let runtimeSecrets = new Map<RuntimeSecretKey, string>();

function normalizeSecretValue(value: string): string {
  return value.trim();
}

function readRequiredEnvValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} must be set when VEIL_SECRET_PROVIDER=aws-secrets-manager`);
  }
  return value;
}

function detectRuntimeSecretProvider(env: NodeJS.ProcessEnv): RuntimeSecretProvider {
  const normalized = env.VEIL_SECRET_PROVIDER?.trim().toLowerCase();
  if (!normalized || normalized === "env") {
    return "env";
  }
  if (normalized === "aws" || normalized === "aws-secrets-manager" || normalized === "aws_secrets_manager") {
    return "aws-secrets-manager";
  }

  throw new Error(`Unsupported VEIL_SECRET_PROVIDER "${env.VEIL_SECRET_PROVIDER}"`);
}

function getAwsRegion(env: NodeJS.ProcessEnv): string | undefined {
  return (
    env.VEIL_AWS_SECRETS_MANAGER_REGION?.trim() ||
    env.AWS_REGION?.trim() ||
    env.AWS_DEFAULT_REGION?.trim() ||
    undefined
  );
}

function createDefaultDependencies(): RuntimeSecretLoaderDependencies {
  return {
    createAwsSecretsManagerClient(region?: string) {
      return new SecretsManagerClient(region ? { region } : {});
    }
  };
}

function parseAwsSecretPayload(secretPayload: string): Map<RuntimeSecretKey, string> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(secretPayload);
  } catch (error) {
    throw new Error(
      `AWS Secrets Manager payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AWS Secrets Manager payload must be a JSON object");
  }

  const nextSecrets = new Map<RuntimeSecretKey, string>();
  for (const [key, value] of Object.entries(parsed)) {
    if (!runtimeSecretKeySet.has(key)) {
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(`Secret "${key}" must be a string value in AWS Secrets Manager`);
    }

    const normalized = normalizeSecretValue(value);
    if (!normalized) {
      throw new Error(`Secret "${key}" must not be blank in AWS Secrets Manager`);
    }
    nextSecrets.set(key as RuntimeSecretKey, normalized);
  }

  return nextSecrets;
}

function readAwsSecretText(payload: { SecretString?: string; SecretBinary?: Uint8Array }): string {
  if (typeof payload.SecretString === "string" && payload.SecretString.trim()) {
    return payload.SecretString;
  }
  if (payload.SecretBinary) {
    return Buffer.from(payload.SecretBinary).toString("utf8");
  }

  throw new Error("AWS Secrets Manager returned an empty secret payload");
}

function maybeRequireSecret(
  env: NodeJS.ProcessEnv,
  key: RuntimeSecretKey,
  conditions: Array<boolean>,
  missing: RuntimeSecretKey[]
): void {
  if (!conditions.every(Boolean)) {
    return;
  }
  if (runtimeSecrets.has(key)) {
    return;
  }
  if (env[key]?.trim()) {
    return;
  }

  missing.push(key);
}

function validateAwsManagedSecrets(env: NodeJS.ProcessEnv): void {
  const missing: RuntimeSecretKey[] = [];
  const normalizedWechatMode = env.VEIL_WECHAT_MINIGAME_LOGIN_MODE?.trim().toLowerCase();
  const requiresWechatSecret = normalizedWechatMode === "production" || normalizedWechatMode === "code2session";
  const hasWechatPayRuntime =
    Boolean(env.VEIL_WECHAT_PAY_APP_ID?.trim()) ||
    Boolean(env.VEIL_WECHAT_PAY_MERCHANT_ID?.trim()) ||
    Boolean(env.VEIL_WECHAT_PAY_NOTIFY_URL?.trim());
  const mysqlEnabled = Boolean(env.VEIL_MYSQL_HOST?.trim() && env.VEIL_MYSQL_USER?.trim());
  const deliveryModeValues = [
    env.VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE?.trim().toLowerCase(),
    env.VEIL_PASSWORD_RECOVERY_DELIVERY_MODE?.trim().toLowerCase()
  ];
  const usesWebhookDelivery = deliveryModeValues.includes("webhook");
  const usesSmtpDelivery = deliveryModeValues.includes("smtp");
  const hasWebhookBearerToken = Boolean(env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL?.trim());
  const hasSmtpUsername = Boolean(env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_USERNAME?.trim());

  maybeRequireSecret(env, "VEIL_AUTH_SECRET", [true], missing);
  maybeRequireSecret(env, "ADMIN_SECRET", [true], missing);
  maybeRequireSecret(env, "SUPPORT_MODERATOR_SECRET", [true], missing);
  maybeRequireSecret(env, "SUPPORT_SUPERVISOR_SECRET", [true], missing);
  maybeRequireSecret(env, "VEIL_ADMIN_TOKEN", [true], missing);
  maybeRequireSecret(env, "VEIL_MYSQL_PASSWORD", [mysqlEnabled], missing);
  maybeRequireSecret(env, "WECHAT_APP_SECRET", [requiresWechatSecret], missing);
  maybeRequireSecret(env, "VEIL_WECHAT_GROUP_CHALLENGE_SECRET", [requiresWechatSecret], missing);
  maybeRequireSecret(env, "VEIL_WECHAT_PAY_API_V3_KEY", [hasWechatPayRuntime], missing);
  maybeRequireSecret(env, "VEIL_WECHAT_PAY_PRIVATE_KEY", [hasWechatPayRuntime], missing);
  maybeRequireSecret(env, "VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN", [usesWebhookDelivery, hasWebhookBearerToken], missing);
  maybeRequireSecret(env, "VEIL_AUTH_TOKEN_DELIVERY_SMTP_PASSWORD", [usesSmtpDelivery, hasSmtpUsername], missing);

  if (missing.length > 0) {
    throw new Error(`AWS Secrets Manager secret bundle is missing required keys: ${missing.join(", ")}`);
  }
}

export function readRuntimeSecret(key: RuntimeSecretKey, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const runtimeValue = runtimeSecrets.get(key)?.trim();
  if (runtimeValue) {
    return runtimeValue;
  }

  const envValue = env[key]?.trim();
  return envValue ? envValue : undefined;
}

export async function loadRuntimeSecrets(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Partial<RuntimeSecretLoaderDependencies> = {}
): Promise<void> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies
  };
  const provider = detectRuntimeSecretProvider(env);
  runtimeSecrets = new Map();

  if (provider === "env") {
    return;
  }

  const secretId = readRequiredEnvValue(env, "VEIL_AWS_SECRETS_MANAGER_SECRET_ID");
  const client = deps.createAwsSecretsManagerClient(getAwsRegion(env));
  const payload = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  runtimeSecrets = parseAwsSecretPayload(readAwsSecretText(payload));
  validateAwsManagedSecrets(env);
}

export function setRuntimeSecretsForTest(values: Partial<Record<RuntimeSecretKey, string>>): void {
  runtimeSecrets = new Map(
    Object.entries(values)
      .filter((entry): entry is [RuntimeSecretKey, string] => runtimeSecretKeySet.has(entry[0]) && typeof entry[1] === "string")
      .map(([key, value]) => [key, normalizeSecretValue(value)])
  );
}

export function resetRuntimeSecretsForTest(): void {
  runtimeSecrets = new Map();
}
