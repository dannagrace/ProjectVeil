import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { connect as connectTls, TLSSocket } from "node:tls";
import {
  recordAuthTokenDeliveryAttempt,
  recordAuthTokenDeliveryDeadLetter,
  recordAuthTokenDeliveryDeadLetterDrop,
  recordAuthTokenDeliveryFencedWriteRejected,
  recordAuthTokenDeliveryFailure,
  recordAuthTokenDeliveryProcessingLockLost,
  recordAuthTokenDeliveryProcessingLockReleaseStale,
  recordAuthTokenDeliveryProcessingLockRenewFailure,
  recordAuthTokenDeliveryQueuePumpFailure,
  recordAuthTokenDeliveryRequest,
  recordAuthTokenDeliveryRetry,
  recordAuthTokenDeliverySuccess,
  setAuthTokenDeliveryDeadLetterCapacity,
  setAuthTokenDeliveryDeadLetterCount,
  setAuthTokenDeliveryQueueCount,
  setAuthTokenDeliveryQueueLatency
} from "@server/domain/ops/observability";
import {
  createRedisClient,
  readRedisUrl,
  type RedisClientLike
} from "@server/infra/redis";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";

export type AccountTokenDeliveryKind = "account-registration" | "password-recovery";
export type AccountTokenDeliveryMode = "disabled" | "dev-token" | "smtp" | "webhook";
export type AccountTokenDeliveryStatus = "disabled" | "delivered" | "dev-token" | "retry_scheduled";
export type AccountTokenDeliveryFailureReason =
  | "misconfigured"
  | "network"
  | "smtp_4xx"
  | "smtp_5xx"
  | "smtp_protocol"
  | "timeout"
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

interface BaseDeliveryConfig {
  kind: Extract<AccountTokenDeliveryMode, "smtp" | "webhook">;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

interface WebhookDeliveryConfig extends BaseDeliveryConfig {
  kind: "webhook";
  url: string;
  bearerToken?: string;
}

interface SmtpDeliveryConfig extends BaseDeliveryConfig {
  kind: "smtp";
  host: string;
  port: number;
  secure: boolean;
  ignoreTlsErrors: boolean;
  from: string;
  recipientDomain: string;
  ehloName: string;
  username?: string;
  password?: string;
}

type TransportDeliveryConfig = WebhookDeliveryConfig | SmtpDeliveryConfig;

interface QueuedDeliveryEntry {
  key: string;
  payload: AccountTokenDeliveryPayload;
  config: TransportDeliveryConfig;
  attemptCount: number;
  maxAttempts: number;
  queuedAt: number;
  nextAttemptAt: number;
  lastError?: {
    message: string;
    failureReason: AccountTokenDeliveryFailureReason;
    statusCode?: number;
  };
}

export interface AccountTokenDeliveryQueueEntrySnapshot {
  key: string;
  kind: AccountTokenDeliveryKind;
  loginId: string;
  playerId?: string;
  requestedDisplayName?: string;
  deliveryMode: Extract<AccountTokenDeliveryMode, "smtp" | "webhook">;
  attemptCount: number;
  maxAttempts: number;
  queuedAt: string;
  nextAttemptAt: string;
  expiresAt: string;
  lastError?: {
    message: string;
    failureReason: AccountTokenDeliveryFailureReason;
    statusCode?: number;
  };
}

export interface AccountTokenDeliveryQueuePersistence {
  readonly deadLetterMaxEntries?: number;
  loadQueuedDeliveries(): Promise<QueuedDeliveryEntry[]>;
  loadDeadLetterDeliveries(): Promise<QueuedDeliveryEntry[]>;
  loadDeadLetterDelivery(key: string): Promise<QueuedDeliveryEntry | null>;
  saveQueuedDelivery(entry: QueuedDeliveryEntry, lockToken?: string): Promise<void>;
  deleteQueuedDelivery(key: string, lockToken?: string): Promise<void>;
  saveDeadLetterDelivery(entry: QueuedDeliveryEntry, lockToken?: string): Promise<string[]>;
  deleteDeadLetterDelivery(key: string, lockToken?: string): Promise<void>;
  clear?(): Promise<void>;
  acquireProcessingLock?(ttlMs: number): Promise<string | null>;
  renewProcessingLock?(ttlMs: number, lockToken?: string): Promise<void>;
  releaseProcessingLock?(lockToken?: string): Promise<boolean | void>;
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

const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000;
const DEFAULT_DELIVERY_MAX_ATTEMPTS = 4;
const DEFAULT_DELIVERY_RETRY_BASE_DELAY_MS = 5_000;
const DEFAULT_DELIVERY_RETRY_MAX_DELAY_MS = 60_000;
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTPS_PORT = 465;
const DEFAULT_QUEUE_PERSISTENCE_NAMESPACE = "veil:account-token-delivery";
const DEFAULT_DEAD_LETTER_MAX_ENTRIES = 1_000;
const QUEUE_PROCESSING_LOCK_TTL_MS = 30_000;
const QUEUE_PROCESSING_LOCK_RENEW_FAILURE_TOLERANCE = 2;

interface QueueProcessingLockContext {
  isLockLost(): boolean;
  token?: string;
}

const queuedDeliveries = new Map<string, QueuedDeliveryEntry>();
const deadLetterDeliveries = new Map<string, QueuedDeliveryEntry>();
let queueTimer: NodeJS.Timeout | null = null;
let queueProcessing = false;
let queuePersistence: AccountTokenDeliveryQueuePersistence | null = null;
let queuePersistenceInitialization: Promise<void> | null = null;
let ownedRedisClient: RedisClientLike | null = null;
let deadLetterCapacityLimit: number | null = null;

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

function parseEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function isProductionEnvironment(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV?.trim().toLowerCase() === "production";
}

function readDeliveryMode(
  rawMode: string | undefined,
  env: NodeJS.ProcessEnv,
  envKey: string
): AccountTokenDeliveryMode {
  const normalized = rawMode?.trim().toLowerCase();
  if (!normalized) {
    if (isProductionEnvironment(env)) {
      throw new AccountTokenDeliveryConfigurationError(
        `${envKey} must be configured before production startup`
      );
    }
    return "dev-token";
  }

  if (normalized === "disabled" || normalized === "smtp" || normalized === "webhook") {
    return normalized;
  }

  if (normalized === "dev-token") {
    if (isProductionEnvironment(env)) {
      throw new AccountTokenDeliveryConfigurationError(
        `${envKey} cannot use dev-token in production`
      );
    }
    return "dev-token";
  }

  throw new AccountTokenDeliveryConfigurationError(
    `Unsupported value "${rawMode}" for ${envKey}`
  );
}

function readSharedTransportConfig(env: NodeJS.ProcessEnv): Pick<
  BaseDeliveryConfig,
  "timeoutMs" | "maxAttempts" | "retryBaseDelayMs" | "retryMaxDelayMs"
> {
  return {
    timeoutMs: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_TIMEOUT_MS ?? env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_TIMEOUT_MS,
      DEFAULT_DELIVERY_TIMEOUT_MS,
      { minimum: 1, integer: true }
    ),
    maxAttempts: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_MAX_ATTEMPTS ?? env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_MAX_ATTEMPTS,
      DEFAULT_DELIVERY_MAX_ATTEMPTS,
      { minimum: 1, integer: true }
    ),
    retryBaseDelayMs: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_RETRY_BASE_DELAY_MS ?? env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_BASE_DELAY_MS,
      DEFAULT_DELIVERY_RETRY_BASE_DELAY_MS,
      { minimum: 1, integer: true }
    ),
    retryMaxDelayMs: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_RETRY_MAX_DELAY_MS ?? env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_MAX_DELAY_MS,
      DEFAULT_DELIVERY_RETRY_MAX_DELAY_MS,
      { minimum: 1, integer: true }
    )
  };
}

function readWebhookDeliveryConfig(env: NodeJS.ProcessEnv): WebhookDeliveryConfig {
  const url = env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL?.trim();
  const bearerToken = readRuntimeSecret("VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN", env);
  if (!url) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL must be set when webhook delivery mode is enabled"
    );
  }

  return {
    kind: "webhook",
    url,
    ...(bearerToken ? { bearerToken } : {}),
    ...readSharedTransportConfig(env)
  };
}

function readSmtpDeliveryConfig(env: NodeJS.ProcessEnv): SmtpDeliveryConfig {
  const host = env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_HOST?.trim();
  if (!host) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_SMTP_HOST must be set when smtp delivery mode is enabled"
    );
  }

  const from = env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_FROM?.trim();
  if (!from) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_SMTP_FROM must be set when smtp delivery mode is enabled"
    );
  }

  const recipientDomain = env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN?.trim();
  if (!recipientDomain) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN must be set when smtp delivery mode is enabled"
    );
  }

  const secure = parseEnvBoolean(env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_SECURE, false);
  const username = env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_USERNAME?.trim();
  const password = readRuntimeSecret("VEIL_AUTH_TOKEN_DELIVERY_SMTP_PASSWORD", env);
  if ((username && !password) || (!username && password)) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_SMTP_USERNAME and VEIL_AUTH_TOKEN_DELIVERY_SMTP_PASSWORD must be provided together"
    );
  }

  return {
    kind: "smtp",
    host,
    port: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_PORT,
      secure ? DEFAULT_SMTPS_PORT : DEFAULT_SMTP_PORT,
      { minimum: 1, integer: true }
    ),
    secure,
    ignoreTlsErrors: parseEnvBoolean(env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_IGNORE_TLS_ERRORS, false),
    from,
    recipientDomain: recipientDomain.replace(/^@+/, ""),
    ehloName: env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_EHLO_NAME?.trim() || "projectveil.local",
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...readSharedTransportConfig(env)
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

function normalizeQueueNamespace(namespace: string | undefined): string {
  const trimmed = namespace?.trim().replace(/:+$/g, "");
  return trimmed || DEFAULT_QUEUE_PERSISTENCE_NAMESPACE;
}

function parseQueuedDeliveryEntry(serialized: string): QueuedDeliveryEntry | null {
  try {
    const parsed = JSON.parse(serialized) as Partial<QueuedDeliveryEntry>;
    if (
      typeof parsed.key !== "string" ||
      typeof parsed.attemptCount !== "number" ||
      typeof parsed.maxAttempts !== "number" ||
      typeof parsed.queuedAt !== "number" ||
      typeof parsed.nextAttemptAt !== "number" ||
      !parsed.payload ||
      !parsed.config ||
      (parsed.config.kind !== "smtp" && parsed.config.kind !== "webhook")
    ) {
      return null;
    }
    return parsed as QueuedDeliveryEntry;
  } catch {
    return null;
  }
}

function snapshotQueueEntry(entry: QueuedDeliveryEntry): AccountTokenDeliveryQueueEntrySnapshot {
  return {
    key: entry.key,
    kind: entry.payload.kind,
    loginId: entry.payload.loginId,
    ...(entry.payload.playerId ? { playerId: entry.payload.playerId } : {}),
    ...(entry.payload.requestedDisplayName ? { requestedDisplayName: entry.payload.requestedDisplayName } : {}),
    deliveryMode: entry.config.kind,
    attemptCount: entry.attemptCount,
    maxAttempts: entry.maxAttempts,
    queuedAt: toIsoTimestamp(entry.queuedAt),
    nextAttemptAt: toIsoTimestamp(entry.nextAttemptAt),
    expiresAt: entry.payload.expiresAt,
    ...(entry.lastError ? { lastError: entry.lastError } : {})
  };
}

export function createRedisAccountTokenDeliveryQueuePersistence(
  redis: RedisClientLike,
  options: { namespace?: string; deadLetterMaxEntries?: number } = {}
): AccountTokenDeliveryQueuePersistence {
  const namespace = normalizeQueueNamespace(options.namespace);
  const deadLetterMaxEntries =
    options.deadLetterMaxEntries != null && Number.isFinite(options.deadLetterMaxEntries)
      ? Math.max(0, Math.floor(options.deadLetterMaxEntries))
      : DEFAULT_DEAD_LETTER_MAX_ENTRIES;
  const queuedHashKey = `${namespace}:queued`;
  const queuedListKey = `${namespace}:queued-keys`;
  const deadLetterHashKey = `${namespace}:dead-letter`;
  const deadLetterListKey = `${namespace}:dead-letter-keys`;
  const processingLockKey = `${namespace}:processor-lock`;
  const lockOwner = `${process.pid}:${randomUUID()}`;

  const loadEntries = async (hashKey: string, listKey: string): Promise<QueuedDeliveryEntry[]> => {
    const keys = Array.from(new Set(await redis.lrange(listKey, 0, -1)));
    const entries: QueuedDeliveryEntry[] = [];
    for (const key of keys) {
      const serialized = await redis.hget(hashKey, key);
      if (!serialized) {
        await redis.lrem(listKey, 1, key);
        continue;
      }

      const entry = parseQueuedDeliveryEntry(serialized);
      if (!entry) {
        await redis.hdel(hashKey, key);
        await redis.lrem(listKey, 1, key);
        continue;
      }
      entries.push(entry);
    }
    return entries;
  };

  const assertFencedWriteAccepted = (result: unknown): void => {
    if (Number(result) < 0) {
      recordAuthTokenDeliveryFencedWriteRejected();
      throw new Error("Account token delivery fenced write rejected");
    }
  };

  const saveEntry = async (
    hashKey: string,
    listKey: string,
    entry: QueuedDeliveryEntry,
    lockToken?: string
  ): Promise<void> => {
    if (lockToken) {
      assertFencedWriteAccepted(
        await redis.eval(
          [
            "-- account token delivery fenced save",
            "if redis.call('get', KEYS[1]) ~= ARGV[1] then",
            "  return -1",
            "end",
            "local added = redis.call('hset', KEYS[2], ARGV[2], ARGV[3])",
            "if added > 0 then",
            "  redis.call('rpush', KEYS[3], ARGV[2])",
            "end",
            "return 1"
          ].join("\n"),
          3,
          processingLockKey,
          hashKey,
          listKey,
          lockToken,
          entry.key,
          JSON.stringify(entry)
        )
      );
      return;
    }

    const added = await redis.hset(hashKey, entry.key, JSON.stringify(entry));
    if (added > 0) {
      await redis.rpush(listKey, entry.key);
    }
  };

  const deleteEntry = async (
    hashKey: string,
    listKey: string,
    key: string,
    lockToken?: string
  ): Promise<void> => {
    if (lockToken) {
      assertFencedWriteAccepted(
        await redis.eval(
          [
            "-- account token delivery fenced delete",
            "if redis.call('get', KEYS[1]) ~= ARGV[1] then",
            "  return -1",
            "end",
            "local deleted = redis.call('hdel', KEYS[2], ARGV[2])",
            "if deleted > 0 then",
            "  redis.call('lrem', KEYS[3], 1, ARGV[2])",
            "end",
            "return deleted"
          ].join("\n"),
          3,
          processingLockKey,
          hashKey,
          listKey,
          lockToken,
          key
        )
      );
      return;
    }

    const deleted = await redis.hdel(hashKey, key);
    if (deleted > 0) {
      await redis.lrem(listKey, 1, key);
    }
  };

  const loadEntry = async (hashKey: string, listKey: string, key: string): Promise<QueuedDeliveryEntry | null> => {
    const serialized = await redis.hget(hashKey, key);
    if (!serialized) {
      return null;
    }

    const entry = parseQueuedDeliveryEntry(serialized);
    if (!entry) {
      await redis.hdel(hashKey, key);
      await redis.lrem(listKey, 1, key);
      return null;
    }
    return entry;
  };

  const enforceDeadLetterCap = async (): Promise<string[]> => {
    const length = await redis.llen(deadLetterListKey);
    const overflow = length - deadLetterMaxEntries;
    if (overflow <= 0) {
      return [];
    }

    const staleKeys = await redis.lrange(deadLetterListKey, 0, overflow - 1);
    if (staleKeys.length === 0) {
      return [];
    }

    await redis.hdel(deadLetterHashKey, ...staleKeys);
    for (const key of staleKeys) {
      await redis.lrem(deadLetterListKey, 1, key);
    }
    return staleKeys;
  };

  const saveDeadLetterEntry = async (entry: QueuedDeliveryEntry, lockToken?: string): Promise<string[]> => {
    if (lockToken) {
      const result = await redis.eval(
        [
          "-- account token delivery fenced dead-letter save",
          "if redis.call('get', KEYS[1]) ~= ARGV[1] then",
          "  return -1",
          "end",
          "local added = redis.call('hset', KEYS[2], ARGV[2], ARGV[3])",
          "if added > 0 then",
          "  redis.call('rpush', KEYS[3], ARGV[2])",
          "end",
          "local maxEntries = tonumber(ARGV[4])",
          "local overflow = redis.call('llen', KEYS[3]) - maxEntries",
          "if overflow <= 0 then",
          "  return {}",
          "end",
          "local staleKeys = redis.call('lrange', KEYS[3], 0, overflow - 1)",
          "for _, staleKey in ipairs(staleKeys) do",
          "  redis.call('hdel', KEYS[2], staleKey)",
          "end",
          "redis.call('ltrim', KEYS[3], overflow, -1)",
          "return staleKeys"
        ].join("\n"),
        3,
        processingLockKey,
        deadLetterHashKey,
        deadLetterListKey,
        lockToken,
        entry.key,
        JSON.stringify(entry),
        String(deadLetterMaxEntries)
      );
      if (Number(result) < 0) {
        recordAuthTokenDeliveryFencedWriteRejected();
        throw new Error("Account token delivery fenced write rejected");
      }
      return Array.isArray(result) ? result.map(String) : [];
    }
    await saveEntry(deadLetterHashKey, deadLetterListKey, entry);
    return enforceDeadLetterCap();
  };

  return {
    deadLetterMaxEntries,
    loadQueuedDeliveries: () => loadEntries(queuedHashKey, queuedListKey),
    loadDeadLetterDeliveries: () => loadEntries(deadLetterHashKey, deadLetterListKey),
    loadDeadLetterDelivery: (key) => loadEntry(deadLetterHashKey, deadLetterListKey, key),
    saveQueuedDelivery: (entry, lockToken) => saveEntry(queuedHashKey, queuedListKey, entry, lockToken),
    deleteQueuedDelivery: (key, lockToken) => deleteEntry(queuedHashKey, queuedListKey, key, lockToken),
    saveDeadLetterDelivery: (entry, lockToken) => saveDeadLetterEntry(entry, lockToken),
    deleteDeadLetterDelivery: (key, lockToken) => deleteEntry(deadLetterHashKey, deadLetterListKey, key, lockToken),
    clear: () => redis.del(queuedHashKey, queuedListKey, deadLetterHashKey, deadLetterListKey, processingLockKey).then(() => undefined),
    acquireProcessingLock: async (ttlMs) =>
      (await redis.set(processingLockKey, lockOwner, "PX", ttlMs, "NX")) === "OK" ? lockOwner : null,
    renewProcessingLock: async (ttlMs, lockToken = lockOwner) => {
      const renewed = await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        processingLockKey,
        lockToken,
        String(ttlMs)
      );
      if (Number(renewed) !== 1) {
        throw new Error("Account token delivery processing lock renewal lost ownership");
      }
    },
    releaseProcessingLock: async (lockToken = lockOwner) => {
      const released = await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        processingLockKey,
        lockToken
      );
      return Number(released) === 1;
    }
  };
}

export async function configureAccountTokenDeliveryQueuePersistence(
  persistence: AccountTokenDeliveryQueuePersistence | null
): Promise<void> {
  clearQueueTimer();
  queuePersistence = persistence;
  deadLetterCapacityLimit = persistence?.deadLetterMaxEntries ?? null;
  queuedDeliveries.clear();
  deadLetterDeliveries.clear();

  if (queuePersistence) {
    const [queued, loadedDeadLetters] = await Promise.all([
      queuePersistence.loadQueuedDeliveries(),
      queuePersistence.loadDeadLetterDeliveries()
    ]);
    const deadLetters = await trimHydratedDeadLetters(queuePersistence, loadedDeadLetters);
    for (const entry of queued) {
      queuedDeliveries.set(entry.key, entry);
    }
    for (const entry of deadLetters) {
      deadLetterDeliveries.set(entry.key, entry);
    }
  }

  syncQueueTelemetry();
  scheduleQueuePump();
}

async function ensureAccountTokenDeliveryQueuePersistence(env: NodeJS.ProcessEnv): Promise<void> {
  if (queuePersistence) {
    return;
  }

  if (queuePersistenceInitialization) {
    await queuePersistenceInitialization;
    return;
  }

  const redisUrl = readRedisUrl(env);
  if (!redisUrl) {
    if (isProductionEnvironment(env)) {
      throw new AccountTokenDeliveryConfigurationError(
        "REDIS_URL must be configured for production account-token delivery retry persistence"
      );
    }
    return;
  }

  queuePersistenceInitialization = (async () => {
    ownedRedisClient = createRedisClient(redisUrl);
    await configureAccountTokenDeliveryQueuePersistence(
      createRedisAccountTokenDeliveryQueuePersistence(ownedRedisClient)
    );
  })().finally(() => {
    queuePersistenceInitialization = null;
  });
  await queuePersistenceInitialization;
}

async function saveQueuedDelivery(entry: QueuedDeliveryEntry, lock?: QueueProcessingLockContext): Promise<void> {
  if (queuePersistence) {
    await queuePersistence.saveQueuedDelivery(entry, lock?.token);
  }
}

async function deleteQueuedDelivery(key: string, lock?: QueueProcessingLockContext): Promise<void> {
  if (queuePersistence) {
    await queuePersistence.deleteQueuedDelivery(key, lock?.token);
  }
}

async function saveDeadLetterDelivery(entry: QueuedDeliveryEntry, lock?: QueueProcessingLockContext): Promise<string[]> {
  if (queuePersistence) {
    return queuePersistence.saveDeadLetterDelivery(entry, lock?.token);
  }
  return [];
}

async function deleteDeadLetterDelivery(key: string, lock?: QueueProcessingLockContext): Promise<void> {
  if (queuePersistence) {
    await queuePersistence.deleteDeadLetterDelivery(key, lock?.token);
  }
}

async function closeRedisClient(redis: RedisClientLike | null): Promise<void> {
  await redis?.quit?.();
}

async function trimHydratedDeadLetters(
  persistence: AccountTokenDeliveryQueuePersistence,
  deadLetters: QueuedDeliveryEntry[]
): Promise<QueuedDeliveryEntry[]> {
  const maxEntries = persistence.deadLetterMaxEntries;
  if (maxEntries == null || deadLetters.length <= maxEntries) {
    return deadLetters;
  }

  const overflow = Math.max(0, Math.floor(deadLetters.length - maxEntries));
  const droppedEntries = deadLetters.slice(0, overflow);
  for (const entry of droppedEntries) {
    await persistence.deleteDeadLetterDelivery(entry.key);
  }
  recordAuthTokenDeliveryDeadLetterDrop(droppedEntries.length);
  return deadLetters.slice(overflow);
}

function applyDeadLetterDrops(droppedKeys: string[]): void {
  if (droppedKeys.length === 0) {
    return;
  }

  for (const key of droppedKeys) {
    deadLetterDeliveries.delete(key);
  }
  recordAuthTokenDeliveryDeadLetterDrop(droppedKeys.length);
}

function syncQueueTelemetry(): void {
  setAuthTokenDeliveryQueueCount(queuedDeliveries.size);
  setAuthTokenDeliveryDeadLetterCount(deadLetterDeliveries.size);
  setAuthTokenDeliveryDeadLetterCapacity({
    maxEntries: deadLetterCapacityLimit,
    usedRatio:
      deadLetterCapacityLimit != null && deadLetterCapacityLimit > 0
        ? deadLetterDeliveries.size / deadLetterCapacityLimit
        : null
  });
  if (queuedDeliveries.size === 0) {
    setAuthTokenDeliveryQueueLatency({
      oldestQueuedLatencyMs: null,
      nextAttemptDelayMs: null
    });
    return;
  }

  const now = Date.now();
  const queuedEntries = Array.from(queuedDeliveries.values());
  const oldestQueuedAt = Math.min(...queuedEntries.map((entry) => entry.queuedAt));
  const nextAttemptAt = Math.min(...queuedEntries.map((entry) => entry.nextAttemptAt));
  setAuthTokenDeliveryQueueLatency({
    oldestQueuedLatencyMs: now - oldestQueuedAt,
    nextAttemptDelayMs: Math.max(0, nextAttemptAt - now)
  });
}

function computeRetryDelayMs(attemptCount: number, config: TransportDeliveryConfig): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * 2 ** exponent);
}

function clearQueueTimer(): void {
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
}

function scheduleQueuePump(minDelayMs = 0): void {
  clearQueueTimer();
  if (queuedDeliveries.size === 0) {
    return;
  }

  const nextAttemptAt = Math.min(...Array.from(queuedDeliveries.values()).map((entry) => entry.nextAttemptAt));
  const delayMs = Math.max(minDelayMs, nextAttemptAt - Date.now());
  queueTimer = setTimeout(() => {
    queueTimer = null;
    void processQueuedDeliveries().catch((error: unknown) => {
      recordAuthTokenDeliveryQueuePumpFailure();
      console.warn("[account-token-delivery] Queue pump failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      scheduleQueuePump(1_000);
    });
  }, delayMs);
}

async function markDeadLetter(
  entry: QueuedDeliveryEntry,
  error: AccountTokenDeliveryError,
  attemptNumber: number,
  lock?: QueueProcessingLockContext
): Promise<void> {
  const deadLetterEntry = {
    ...entry,
    attemptCount: attemptNumber,
    lastError: {
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
    }
  };
  queuedDeliveries.delete(entry.key);
  deadLetterDeliveries.set(entry.key, deadLetterEntry);
  await deleteQueuedDelivery(entry.key, lock);
  applyDeadLetterDrops(await saveDeadLetterDelivery(deadLetterEntry, lock));
  recordAuthTokenDeliveryDeadLetter();
  recordAuthTokenDeliveryAttempt({
    kind: entry.payload.kind,
    loginId: entry.payload.loginId,
    deliveryMode: entry.config.kind,
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

function createSmtpFailure(code: number, message: string): AccountTokenDeliveryError {
  return new AccountTokenDeliveryError(message, {
    retryable: code >= 400 && code < 500,
    failureReason: code >= 400 && code < 500 ? "smtp_4xx" : "smtp_5xx",
    statusCode: code
  });
}

function createSmtpRecipientAddress(loginId: string, recipientDomain: string): string {
  return `${loginId.trim().toLowerCase()}@${recipientDomain}`;
}

function renderSmtpSubject(payload: AccountTokenDeliveryPayload): string {
  return payload.kind === "account-registration"
    ? `[ProjectVeil] Registration token for ${payload.loginId}`
    : `[ProjectVeil] Password recovery token for ${payload.loginId}`;
}

function renderSmtpTextBody(payload: AccountTokenDeliveryPayload, recipient: string): string {
  const intro =
    payload.kind === "account-registration"
      ? "Use the registration token below to finish creating your ProjectVeil account."
      : "Use the password recovery token below to reset your ProjectVeil password.";
  return [
    intro,
    "",
    `Login ID: ${payload.loginId}`,
    `Delivery recipient: ${recipient}`,
    `Token: ${payload.token}`,
    `Expires at: ${payload.expiresAt}`,
    ...(payload.requestedDisplayName ? [`Display name: ${payload.requestedDisplayName}`] : []),
    ...(payload.playerId ? [`Player ID: ${payload.playerId}`] : []),
    "",
    "If you did not request this token, you can ignore this email."
  ].join("\r\n");
}

function createSmtpMessage(payload: AccountTokenDeliveryPayload, config: SmtpDeliveryConfig): { recipient: string; data: string } {
  const recipient = createSmtpRecipientAddress(payload.loginId, config.recipientDomain);
  const body = renderSmtpTextBody(payload, recipient);
  const lines = [
    `From: ${config.from}`,
    `To: ${recipient}`,
    `Subject: ${renderSmtpSubject(payload)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body
  ];

  const normalizedLines = lines
    .join("\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line));
  return {
    recipient,
    data: `${normalizedLines.join("\r\n")}\r\n`
  };
}

class SmtpClient {
  private readonly socket: Socket | TLSSocket;
  private buffer = "";
  private readonly responseQueue: string[] = [];
  private readonly responseWaiters: Array<(response: string) => void> = [];
  private readonly errorWaiters: Array<(error: Error) => void> = [];
  private closed = false;

  constructor(socket: Socket | TLSSocket, private readonly timeoutMs: number) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk: string | Buffer) => {
      this.onData(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    socket.on("timeout", () => {
      this.fail(new Error(`SMTP connection timed out after ${timeoutMs}ms`));
      socket.destroy();
    });
    socket.on("error", (error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    socket.on("close", () => {
      this.closed = true;
      this.fail(new Error("SMTP connection closed before the delivery completed"));
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const lineBreakIndex = this.buffer.indexOf("\r\n");
      if (lineBreakIndex < 0) {
        return;
      }
      const line = this.buffer.slice(0, lineBreakIndex);
      this.buffer = this.buffer.slice(lineBreakIndex + 2);
      if (!/^\d{3}[\s-]/.test(line)) {
        continue;
      }
      if (line[3] === "-") {
        continue;
      }
      this.pushResponse(line);
    }
  }

  private pushResponse(response: string): void {
    const waiter = this.responseWaiters.shift();
    if (waiter) {
      waiter(response);
      return;
    }
    this.responseQueue.push(response);
  }

  private fail(error: Error): void {
    while (this.errorWaiters.length > 0) {
      const reject = this.errorWaiters.shift();
      reject?.(error);
    }
  }

  async readResponse(): Promise<{ code: number; message: string }> {
    if (this.responseQueue.length > 0) {
      const response = this.responseQueue.shift()!;
      return this.parseResponse(response);
    }

    const response = await new Promise<string>((resolve, reject) => {
      this.responseWaiters.push(resolve);
      this.errorWaiters.push(reject);
    });
    return this.parseResponse(response);
  }

  private parseResponse(line: string): { code: number; message: string } {
    const match = /^(\d{3})\s?(.*)$/.exec(line);
    if (!match) {
      throw new AccountTokenDeliveryError(`SMTP server returned an invalid response: ${line}`, {
        retryable: false,
        failureReason: "smtp_protocol"
      });
    }
    return {
      code: Number(match[1]),
      message: match[2] || line
    };
  }

  async sendLine(line: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${line}\r\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async sendData(data: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${data}\r\n.\r\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await new Promise<void>((resolve) => {
      this.socket.end(() => resolve());
    });
  }
}

async function expectSmtpResponse(
  client: SmtpClient,
  allowedCodes: number[],
  context: string
): Promise<{ code: number; message: string }> {
  const response = await client.readResponse();
  if (allowedCodes.includes(response.code)) {
    return response;
  }
  if (response.code >= 400 && response.code < 600) {
    throw createSmtpFailure(response.code, `SMTP ${context} failed with ${response.code} ${response.message}`.trim());
  }
  throw new AccountTokenDeliveryError(`SMTP ${context} returned unexpected status ${response.code} ${response.message}`.trim(), {
    retryable: false,
    failureReason: "smtp_protocol",
    statusCode: response.code
  });
}

async function sendSmtpCommand(
  client: SmtpClient,
  command: string,
  allowedCodes: number[],
  context: string
): Promise<{ code: number; message: string }> {
  await client.sendLine(command);
  return expectSmtpResponse(client, allowedCodes, context);
}

async function connectSmtp(config: SmtpDeliveryConfig): Promise<SmtpClient> {
  const socket = config.secure
    ? connectTls({
        host: config.host,
        port: config.port,
        rejectUnauthorized: !config.ignoreTlsErrors
      })
    : new Socket();

  const connectedSocket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    socket.once("error", onError);
    if (config.secure) {
      (socket as TLSSocket).once("secureConnect", () => {
        socket.off("error", onError);
        resolve(socket);
      });
    } else {
      socket.connect(config.port, config.host, () => {
        socket.off("error", onError);
        resolve(socket);
      });
    }
  });

  return new SmtpClient(connectedSocket, config.timeoutMs);
}

async function deliverViaSmtp(payload: AccountTokenDeliveryPayload, config: SmtpDeliveryConfig): Promise<void> {
  const client = await connectSmtp(config).catch((error: unknown) => {
    if (error instanceof AccountTokenDeliveryError) {
      throw error;
    }
    throw new AccountTokenDeliveryError(`Token delivery SMTP connection failed: ${error instanceof Error ? error.message : String(error)}`, {
      retryable: true,
      failureReason: "network"
    });
  });

  try {
    await expectSmtpResponse(client, [220], "greeting");
    await sendSmtpCommand(client, `EHLO ${config.ehloName}`, [250], "EHLO");

    if (config.username && config.password) {
      const credentials = Buffer.from(`\u0000${config.username}\u0000${config.password}`, "utf8").toString("base64");
      const authResponse = await sendSmtpCommand(client, `AUTH PLAIN ${credentials}`, [235, 334], "AUTH");
      if (authResponse.code === 334) {
        await client.sendLine(credentials);
        await expectSmtpResponse(client, [235], "AUTH challenge");
      }
    }

    const message = createSmtpMessage(payload, config);
    await sendSmtpCommand(client, `MAIL FROM:<${config.from}>`, [250], "MAIL FROM");
    await sendSmtpCommand(client, `RCPT TO:<${message.recipient}>`, [250, 251], "RCPT TO");
    await sendSmtpCommand(client, "DATA", [354], "DATA");
    await client.sendData(message.data);
    await expectSmtpResponse(client, [250], "message body");
    await client.sendLine("QUIT");
  } catch (error) {
    if (error instanceof AccountTokenDeliveryError) {
      throw error;
    }
    if (error instanceof Error && /timed out/i.test(error.message)) {
      throw new AccountTokenDeliveryError(error.message, {
        retryable: true,
        failureReason: "timeout"
      });
    }
    throw new AccountTokenDeliveryError(`Token delivery SMTP request failed: ${error instanceof Error ? error.message : String(error)}`, {
      retryable: true,
      failureReason: "network"
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function deliverViaTransport(payload: AccountTokenDeliveryPayload, config: TransportDeliveryConfig): Promise<void> {
  if (config.kind === "smtp") {
    await deliverViaSmtp(payload, config);
    return;
  }
  await deliverViaWebhook(payload, config);
}

function successMessageForDeliveryMode(mode: Extract<AccountTokenDeliveryMode, "smtp" | "webhook">): string {
  return mode === "smtp" ? "Token delivery SMTP transport accepted the message" : "Token delivery webhook accepted the payload";
}

async function processQueuedDelivery(entry: QueuedDeliveryEntry, lock?: QueueProcessingLockContext): Promise<void> {
  if (isExpired(entry.payload.expiresAt)) {
    await markDeadLetter(
      entry,
      new AccountTokenDeliveryError("Token delivery retry exhausted because the token expired before delivery succeeded", {
        retryable: false,
        failureReason: "timeout"
      }),
      entry.attemptCount,
      lock
    );
    return;
  }

  const attemptNumber = entry.attemptCount + 1;
  try {
    await deliverViaTransport(entry.payload, entry.config);
    queuedDeliveries.delete(entry.key);
    deadLetterDeliveries.delete(entry.key);
    await deleteQueuedDelivery(entry.key, lock);
    await deleteDeadLetterDelivery(entry.key, lock);
    recordAuthTokenDeliverySuccess();
    recordAuthTokenDeliveryAttempt({
      kind: entry.payload.kind,
      loginId: entry.payload.loginId,
      deliveryMode: entry.config.kind,
      status: "delivered",
      attemptCount: attemptNumber,
      maxAttempts: entry.maxAttempts,
      retryable: false,
      message: successMessageForDeliveryMode(entry.config.kind)
    });
    syncQueueTelemetry();
  } catch (error) {
    if (!(error instanceof AccountTokenDeliveryError)) {
      throw error;
    }

    recordAuthTokenDeliveryFailure(error.failureReason);

    if (!error.retryable || attemptNumber >= entry.maxAttempts) {
      await markDeadLetter(entry, error, attemptNumber, lock);
      return;
    }

    const nextAttemptAt = Date.now() + computeRetryDelayMs(attemptNumber, entry.config);
    const queuedEntry = {
      ...entry,
      attemptCount: attemptNumber,
      queuedAt: entry.queuedAt,
      nextAttemptAt,
      lastError: {
        message: error.message,
        failureReason: error.failureReason,
        ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
      }
    };
    queuedDeliveries.set(entry.key, queuedEntry);
    await saveQueuedDelivery(queuedEntry, lock);
    recordAuthTokenDeliveryRetry();
    recordAuthTokenDeliveryAttempt({
      kind: entry.payload.kind,
      loginId: entry.payload.loginId,
      deliveryMode: entry.config.kind,
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

async function withQueueProcessingLock(action: (lock: QueueProcessingLockContext) => Promise<void>): Promise<void> {
  const persistence = queuePersistence;
  if (!persistence?.acquireProcessingLock) {
    await action({ isLockLost: () => false });
    return;
  }

  const lockToken = await persistence.acquireProcessingLock(QUEUE_PROCESSING_LOCK_TTL_MS);
  if (!lockToken) {
    scheduleQueuePump();
    return;
  }

  let lockLost = false;
  let consecutiveRenewFailures = 0;
  const renewInterval =
    persistence.renewProcessingLock &&
    setInterval(() => {
      if (lockLost) {
        return;
      }
      void persistence
        .renewProcessingLock?.(QUEUE_PROCESSING_LOCK_TTL_MS, lockToken)
        .then(() => {
          consecutiveRenewFailures = 0;
        })
        .catch((error: unknown) => {
          recordAuthTokenDeliveryProcessingLockRenewFailure();
          consecutiveRenewFailures += 1;
          console.warn("[account-token-delivery] Processing lock renewal failed", {
            error: error instanceof Error ? error.message : String(error)
          });
          if (consecutiveRenewFailures >= QUEUE_PROCESSING_LOCK_RENEW_FAILURE_TOLERANCE) {
            lockLost = true;
            recordAuthTokenDeliveryProcessingLockLost();
            if (renewInterval) {
              clearInterval(renewInterval);
            }
          }
        });
  }, Math.max(100, Math.floor(QUEUE_PROCESSING_LOCK_TTL_MS / 2)));

  try {
    await action({ isLockLost: () => lockLost, token: lockToken });
    if (lockLost) {
      throw new Error("Account token delivery processing lock lost mid-action; remaining entries deferred");
    }
  } finally {
    if (renewInterval) {
      clearInterval(renewInterval);
    }
    const released = await persistence.releaseProcessingLock?.(lockToken);
    if (released === false) {
      recordAuthTokenDeliveryProcessingLockReleaseStale();
    }
  }
}

async function processQueuedDeliveries(): Promise<void> {
  if (queueProcessing) {
    scheduleQueuePump();
    return;
  }

  queueProcessing = true;
  try {
    await withQueueProcessingLock(async (lock) => {
      while (!lock.isLockLost()) {
        const dueEntry = Array.from(queuedDeliveries.values()).sort(
          (left, right) => left.nextAttemptAt - right.nextAttemptAt
        )[0];
        if (!dueEntry || dueEntry.nextAttemptAt > Date.now()) {
          break;
        }

        await processQueuedDelivery(dueEntry, lock);
      }
    });
  } finally {
    queueProcessing = false;
    scheduleQueuePump();
  }
}

async function queueRetry(
  payload: AccountTokenDeliveryPayload,
  config: TransportDeliveryConfig,
  error: AccountTokenDeliveryError
): Promise<AccountTokenDeliveryResult> {
  const key = buildDeliveryKey(payload);
  const existing = queuedDeliveries.get(key);
  if (existing && existing.payload.token === payload.token) {
    return {
      deliveryMode: config.kind,
      deliveryStatus: "retry_scheduled",
      attemptCount: existing.attemptCount,
      maxAttempts: existing.maxAttempts,
      nextAttemptAt: toIsoTimestamp(existing.nextAttemptAt)
    };
  }

  const nextAttemptAt = Date.now() + computeRetryDelayMs(1, config);
  const queuedEntry = {
    key,
    payload,
    config,
    attemptCount: 1,
    maxAttempts: config.maxAttempts,
    queuedAt: Date.now(),
    nextAttemptAt,
    lastError: {
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
    }
  };
  queuedDeliveries.set(key, queuedEntry);
  deadLetterDeliveries.delete(key);
  await saveQueuedDelivery(queuedEntry);
  await deleteDeadLetterDelivery(key);
  recordAuthTokenDeliveryRetry();
  recordAuthTokenDeliveryAttempt({
    kind: payload.kind,
    loginId: payload.loginId,
    deliveryMode: config.kind,
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
    deliveryMode: config.kind,
    deliveryStatus: "retry_scheduled",
    attemptCount: 1,
    maxAttempts: config.maxAttempts,
    nextAttemptAt: toIsoTimestamp(nextAttemptAt)
  };
}

function readTransportDeliveryConfig(mode: Extract<AccountTokenDeliveryMode, "smtp" | "webhook">, env: NodeJS.ProcessEnv): TransportDeliveryConfig {
  return mode === "smtp" ? readSmtpDeliveryConfig(env) : readWebhookDeliveryConfig(env);
}

export function readAccountRegistrationDeliveryMode(env: NodeJS.ProcessEnv = process.env): AccountTokenDeliveryMode {
  return readDeliveryMode(env.VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE, env, "VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE");
}

export function readPasswordRecoveryDeliveryMode(env: NodeJS.ProcessEnv = process.env): AccountTokenDeliveryMode {
  return readDeliveryMode(env.VEIL_PASSWORD_RECOVERY_DELIVERY_MODE, env, "VEIL_PASSWORD_RECOVERY_DELIVERY_MODE");
}

export async function clearAccountTokenDeliveryState(kind: AccountTokenDeliveryKind, loginId: string): Promise<void> {
  const key = buildDeliveryKey({ kind, loginId });
  queuedDeliveries.delete(key);
  deadLetterDeliveries.delete(key);
  await deleteQueuedDelivery(key);
  await deleteDeadLetterDelivery(key);
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

export async function shutdownAccountTokenDeliveryQueuePersistence(): Promise<void> {
  deadLetterCapacityLimit = null;
  resetAccountTokenDeliveryState();
  queuePersistence = null;
  queuePersistenceInitialization = null;
  if (ownedRedisClient) {
    await closeRedisClient(ownedRedisClient);
    ownedRedisClient = null;
  }
}

export async function listAccountTokenDeliveryDeadLetters(): Promise<AccountTokenDeliveryQueueEntrySnapshot[]> {
  let entries = Array.from(deadLetterDeliveries.values());
  if (queuePersistence) {
    entries = await trimHydratedDeadLetters(queuePersistence, await queuePersistence.loadDeadLetterDeliveries());
    deadLetterDeliveries.clear();
    for (const entry of entries) {
      deadLetterDeliveries.set(entry.key, entry);
    }
    syncQueueTelemetry();
  }

  return entries
    .sort((left, right) => right.nextAttemptAt - left.nextAttemptAt)
    .map(snapshotQueueEntry);
}

export async function requeueAccountTokenDeliveryDeadLetter(
  key: string
): Promise<AccountTokenDeliveryQueueEntrySnapshot | null> {
  const entry = queuePersistence
    ? await queuePersistence.loadDeadLetterDelivery(key)
    : deadLetterDeliveries.get(key);
  if (!entry) {
    return null;
  }

  const queuedEntry: QueuedDeliveryEntry = {
    ...entry,
    attemptCount: 0,
    queuedAt: Date.now(),
    nextAttemptAt: Date.now()
  };
  deadLetterDeliveries.delete(key);
  queuedDeliveries.set(key, queuedEntry);
  await deleteDeadLetterDelivery(key);
  await saveQueuedDelivery(queuedEntry);
  syncQueueTelemetry();
  scheduleQueuePump();
  return snapshotQueueEntry(queuedEntry);
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
    if (isProductionEnvironment(env)) {
      throw new AccountTokenDeliveryConfigurationError(
        "dev-token account token delivery is not allowed in production"
      );
    }

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

  await ensureAccountTokenDeliveryQueuePersistence(env);
  const config = readTransportDeliveryConfig(mode, env);
  const key = buildDeliveryKey(payload);
  const existing = queuedDeliveries.get(key);
  if (existing && existing.payload.token === payload.token && !isExpired(existing.payload.expiresAt)) {
    return {
      deliveryMode: config.kind,
      deliveryStatus: "retry_scheduled",
      attemptCount: existing.attemptCount,
      maxAttempts: existing.maxAttempts,
      nextAttemptAt: toIsoTimestamp(existing.nextAttemptAt)
    };
  }

  try {
    await deliverViaTransport(payload, config);
    queuedDeliveries.delete(key);
    deadLetterDeliveries.delete(key);
    await deleteQueuedDelivery(key);
    await deleteDeadLetterDelivery(key);
    recordAuthTokenDeliverySuccess();
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: config.kind,
      status: "delivered",
      attemptCount: 1,
      maxAttempts: config.maxAttempts,
      retryable: false,
      message: successMessageForDeliveryMode(config.kind)
    });
    syncQueueTelemetry();
    return {
      deliveryMode: config.kind,
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
      return await queueRetry(payload, config, error);
    }

    const deadLetterEntry = {
      key,
      payload,
      config,
      attemptCount: 1,
      maxAttempts: config.maxAttempts,
      nextAttemptAt: Date.now(),
      queuedAt: Date.now(),
      lastError: {
        message: error.message,
        failureReason: error.failureReason,
        ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
      }
    };
    deadLetterDeliveries.set(key, deadLetterEntry);
    applyDeadLetterDrops(await saveDeadLetterDelivery(deadLetterEntry));
    recordAuthTokenDeliveryDeadLetter();
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: config.kind,
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
