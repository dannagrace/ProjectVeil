import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { appendEventLogEntries, type EventLogEntry } from "@veil/shared/event-log";
import { emitAnalyticsEvent } from "@server/domain/ops/analytics";
import {
  AccountTokenDeliveryConfigurationError,
  AccountTokenDeliveryError,
  clearAccountTokenDeliveryState,
  deliverAccountToken,
  readAccountRegistrationDeliveryMode,
  readPasswordRecoveryDeliveryMode
} from "@server/adapters/account-token-delivery";
import {
  recordAuthAccountBinding,
  recordAuthAccountLogin,
  recordAuthAccountRegistration,
  recordAuthCredentialStuffingBlocked,
  recordAuthGuestLogin,
  recordAuthInvalidCredentials,
  recordAuthLogout,
  recordAuthRateLimited,
  recordAuthTokenDeliveryFailure,
  recordAuthRefresh,
  recordAuthSessionCheck,
  recordAuthSessionFailure,
  removeAuthAccountSessionsForPlayer,
  setAuthAccountLockCount,
  setAuthCredentialStuffingSourceCount,
  setAuthGuestSessionCount,
  setPendingAuthRecoveryCount,
  setPendingAuthRegistrationCount,
  upsertAuthAccountSession
} from "@server/domain/ops/observability";
import { issueDailyLoginReward } from "@server/domain/economy/daily-login-rewards";
import { deriveWechatMinorProtection } from "@server/domain/ops/minor-protection";
import {
  type PlayerAccountBanSnapshot,
  type PlayerAccountSnapshot,
  type RoomSnapshotStore
} from "@server/persistence";
import { resolveTrustedRequestIp } from "@server/infra/request-ip";
import { isPlayerBanActive } from "@server/domain/player-ban";
import { assertDisplayNameAvailableOrThrow } from "@server/domain/account/display-name-rules";
import { resolveFeatureEntitlementsForPlayer } from "@server/domain/battle/feature-flags";
import { loadLaunchRuntimeState, resolveLaunchMaintenanceAccess } from "@server/domain/ops/launch-runtime-state";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import { createRedisClient, readRedisUrl, type RedisClientLike } from "@server/infra/redis";
import { cacheWechatSessionKey, readWechatSessionKeyTtlSeconds, resetWechatSessionKeyCache } from "@server/adapters/wechat-session-key";

export type AuthMode = "guest" | "account";
export type AuthProvider = "guest" | "account-password" | "wechat-mini-game";

export interface GuestAuthSession {
  token: string;
  refreshToken?: string;
  playerId: string;
  displayName: string;
  authMode: AuthMode;
  provider: AuthProvider;
  loginId?: string;
  sessionId?: string;
  sessionVersion?: number;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string;
  refreshExpiresAt?: string;
}

interface GuestAuthTokenPayload {
  playerId: string;
  displayName: string;
  authMode?: AuthMode;
  provider?: AuthProvider;
  loginId?: string;
  sessionId?: string;
  sessionVersion?: number;
  tokenKind?: "access" | "refresh";
  nonce?: string;
  issuedAt: string;
  expiresAt: string;
}

interface AuthRuntimeConfig {
  rateLimitWindowMs: number;
  rateLimitMax: number;
  lockoutThreshold: number;
  lockoutDurationMs: number;
  credentialStuffingWindowMs: number;
  credentialStuffingDistinctLoginIdThreshold: number;
  credentialStuffingBlockDurationMs: number;
  maxGuestSessions: number;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  guestTokenTtlSeconds: number;
}

interface ValidateAuthSessionResult {
  session: GuestAuthSession | null;
  errorCode?: "unauthorized" | "token_expired" | "token_kind_invalid" | "session_revoked" | "account_banned";
  ban?: PlayerAccountBanSnapshot;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface AccountLockoutState {
  failedAttempts: number[];
  lockedUntil?: number;
}

interface CredentialStuffingState {
  failedAttempts: Array<{ at: number; loginId: string }>;
  blockedUntil?: number;
}

interface WechatMiniGameLoginConfig {
  mode: "disabled" | "mock" | "production";
  mockCode: string;
  code2SessionUrl: string;
  appId?: string;
  appSecret?: string;
}

interface WechatMiniGameCode2SessionPayload {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

interface WechatMiniGameIdentity {
  openId: string;
  unionId?: string;
  sessionKey: string;
}

interface AccountAuthSessionState {
  sessionVersion: number;
  refreshSessionId?: string;
  refreshTokenHash?: string;
  refreshTokenExpiresAt?: string;
}

interface GuestSessionClusterDependencies {
  createRedisClient?: typeof createRedisClient;
  env?: NodeJS.ProcessEnv;
  redisClient?: RedisClientLike | null;
}

type GuestSessionClusterOrderRedisClient = RedisClientLike & {
  zadd(key: string, score: number | string, member: string): Promise<number>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<number>;
};

interface PasswordRecoveryState {
  playerId: string;
  loginId: string;
  tokenHash: string;
  deliveryToken: string;
  issuedAt: string;
  expiresAt: string;
}

interface AccountRegistrationState {
  loginId: string;
  requestedDisplayName: string;
  tokenHash: string;
  deliveryToken: string;
  issuedAt: string;
  expiresAt: string;
}

interface StoredGuestAuthSession extends Omit<GuestAuthSession, "token" | "refreshToken"> {
  tokenHash: string;
  token?: string;
}

const MIN_ACCOUNT_PASSWORD_LENGTH = 8;
const MAX_ACCOUNT_PASSWORD_LENGTH = 128;
const COMMON_WEAK_ACCOUNT_PASSWORDS = new Set([
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "111111",
  "000000",
  "password",
  "password1",
  "password12",
  "password123",
  "qwerty",
  "qwerty123",
  "admin",
  "admin123",
  "letmein",
  "letmein1",
  "welcome",
  "welcome1",
  "iloveyou",
  "abc123",
  "hunter2"
]);
const DEFAULT_RATE_LIMIT_AUTH_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_AUTH_MAX = 10;
const DEFAULT_AUTH_LOCKOUT_THRESHOLD = 10;
const DEFAULT_AUTH_LOCKOUT_DURATION_MINUTES = 15;
const DEFAULT_AUTH_CREDENTIAL_STUFFING_WINDOW_MS = 5 * 60_000;
const DEFAULT_AUTH_CREDENTIAL_STUFFING_DISTINCT_LOGIN_ID_THRESHOLD = 5;
const DEFAULT_AUTH_CREDENTIAL_STUFFING_BLOCK_DURATION_MINUTES = 15;
const DEFAULT_MAX_GUEST_SESSIONS = 10_000;
const DEFAULT_AUTH_ACCESS_TTL_SECONDS = 60 * 60;
const DEFAULT_AUTH_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_GUEST_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_ACCOUNT_REGISTRATION_TTL_MINUTES = 15;
const DEFAULT_PASSWORD_RECOVERY_TTL_MINUTES = 15;
const AUTH_RATE_LIMIT_CLUSTER_KEY_PREFIX = "veil:auth-rate-limit:";
const ACCOUNT_LOCKOUT_CLUSTER_KEY_PREFIX = "veil:auth-account-lockout:";
const CREDENTIAL_STUFFING_CLUSTER_KEY_PREFIX = "veil:auth-credential-stuffing:";
const ACCOUNT_REGISTRATION_CLUSTER_KEY_PREFIX = "veil:auth-account-registration:";
const PASSWORD_RECOVERY_CLUSTER_KEY_PREFIX = "veil:auth-password-recovery:";
const AUTH_RATE_LIMIT_REDIS_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local current = redis.call("INCR", key)
if current == 1 then
  redis.call("PEXPIRE", key, window_ms)
end
local ttl = redis.call("PTTL", key)
if ttl < 0 then
  ttl = window_ms
end
if current > max then
  return {0, ttl}
end
return {1, ttl}
`;

const authRateLimitCounters = new Map<string, number[]>();
const accountLockoutStateByLoginId = new Map<string, AccountLockoutState>();
const credentialStuffingStateByIp = new Map<string, CredentialStuffingState>();
const guestSessionsById = new Map<string, StoredGuestAuthSession>();
const accountAuthStateByPlayerId = new Map<string, AccountAuthSessionState>();
const accountRegistrationStateByLoginId = new Map<string, AccountRegistrationState>();
const passwordRecoveryStateByLoginId = new Map<string, PasswordRecoveryState>();
let nonProductionAuthSecret: string | null = null;
let guestSessionClusterClientOverride: RedisClientLike | null | undefined;
let guestSessionClusterClientCache: RedisClientLike | null | undefined;
let lastGuestSessionClusterOrderScore = 0;
const GUEST_SESSION_CLUSTER_KEY_PREFIX = "veil:guest-session:";
const GUEST_SESSION_CLUSTER_ORDER_KEY = "veil:guest-session-order";

function readAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configuredSecret = readRuntimeSecret("VEIL_AUTH_SECRET", env);
  if (configuredSecret) {
    return configuredSecret;
  }
  if (env.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new Error("VEIL_AUTH_SECRET must be configured for production auth signing");
  }

  nonProductionAuthSecret ??= randomBytes(32).toString("hex");
  return nonProductionAuthSecret;
}

function resolveGuestSessionClusterClient(
  deps: GuestSessionClusterDependencies = {}
): RedisClientLike | null {
  if (deps.redisClient !== undefined) {
    return deps.redisClient;
  }
  if (guestSessionClusterClientOverride !== undefined) {
    return guestSessionClusterClientOverride;
  }
  if (guestSessionClusterClientCache !== undefined) {
    return guestSessionClusterClientCache;
  }

  const env = deps.env ?? process.env;
  const redisUrl = readRedisUrl(env);
  guestSessionClusterClientCache = redisUrl
    ? (deps.createRedisClient ?? createRedisClient)(redisUrl)
    : null;
  return guestSessionClusterClientCache;
}

function buildGuestSessionClusterKey(sessionId: string): string {
  return `${GUEST_SESSION_CLUSTER_KEY_PREFIX}${sessionId}`;
}

function getGuestSessionTtlMs(session: Pick<GuestAuthSession, "expiresAt">): number {
  return Math.max(1, new Date(session.expiresAt).getTime() - nowMs());
}

function timingSafeCompareBuffer(actualBuffer: Buffer, expectedBuffer: Buffer): boolean {
  if (actualBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(Buffer.alloc(expectedBuffer.length), expectedBuffer);
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function timingSafeCompareHexDigest(actual: string, expected: string): boolean {
  return timingSafeCompareBuffer(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function hashGuestSessionToken(token: string): string {
  return createHmac("sha256", readAuthSecret()).update(`guest-session:${token}`).digest("hex");
}

function storeGuestSessionTokenHash(session: GuestAuthSession): StoredGuestAuthSession {
  return {
    playerId: session.playerId,
    displayName: session.displayName,
    authMode: session.authMode,
    provider: session.provider,
    ...(session.loginId ? { loginId: session.loginId } : {}),
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    ...(session.sessionVersion != null ? { sessionVersion: session.sessionVersion } : {}),
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    lastUsedAt: session.lastUsedAt,
    ...(session.refreshExpiresAt ? { refreshExpiresAt: session.refreshExpiresAt } : {}),
    tokenHash: hashGuestSessionToken(session.token)
  };
}

function normalizeStoredGuestSession(input: unknown): StoredGuestAuthSession | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<Record<keyof StoredGuestAuthSession, unknown>>;
  if (
    typeof candidate.playerId !== "string" ||
    typeof candidate.displayName !== "string" ||
    typeof candidate.authMode !== "string" ||
    typeof candidate.provider !== "string" ||
    typeof candidate.sessionId !== "string" ||
    typeof candidate.issuedAt !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    typeof candidate.lastUsedAt !== "string"
  ) {
    return null;
  }
  if (candidate.tokenHash !== undefined && typeof candidate.tokenHash !== "string") {
    return null;
  }
  if (candidate.token !== undefined && typeof candidate.token !== "string") {
    return null;
  }
  if (!candidate.tokenHash && !candidate.token) {
    return null;
  }
  const loginId = normalizeLoginId(candidate.loginId as string | undefined);
  const tokenHash = candidate.tokenHash ?? hashGuestSessionToken(candidate.token as string);
  return {
    playerId: candidate.playerId,
    displayName: candidate.displayName,
    authMode: normalizeAuthMode(candidate.authMode as AuthMode, loginId),
    provider: normalizeAuthProvider({
      provider: candidate.provider as AuthProvider,
      authMode: candidate.authMode as AuthMode,
      loginId
    }),
    ...(loginId ? { loginId } : {}),
    sessionId: candidate.sessionId,
    ...(typeof candidate.sessionVersion === "number" ? { sessionVersion: candidate.sessionVersion } : {}),
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
    lastUsedAt: candidate.lastUsedAt,
    tokenHash
  };
}

function validateStoredGuestSessionToken(session: StoredGuestAuthSession, token: string): boolean {
  return timingSafeCompareHexDigest(hashGuestSessionToken(token), session.tokenHash);
}

function hydrateGuestSession(session: StoredGuestAuthSession, token: string): GuestAuthSession {
  return {
    token,
    playerId: session.playerId,
    displayName: session.displayName,
    authMode: session.authMode,
    provider: session.provider,
    ...(session.loginId ? { loginId: session.loginId } : {}),
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    ...(session.sessionVersion != null ? { sessionVersion: session.sessionVersion } : {}),
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    lastUsedAt: session.lastUsedAt,
    ...(session.refreshExpiresAt ? { refreshExpiresAt: session.refreshExpiresAt } : {})
  };
}

function resolveGuestSessionClusterOrderScore(timestamp: string): number {
  const parsedTimestamp = Date.parse(timestamp);
  const score = Number.isFinite(parsedTimestamp) ? parsedTimestamp : nowMs();
  lastGuestSessionClusterOrderScore = Math.max(score, lastGuestSessionClusterOrderScore + 1);
  return lastGuestSessionClusterOrderScore;
}

function resolveGuestSessionClusterOrderClient(redisClient: RedisClientLike): GuestSessionClusterOrderRedisClient {
  return redisClient as GuestSessionClusterOrderRedisClient;
}

async function trimGuestSessionClusterOrder(
  redisClient: GuestSessionClusterOrderRedisClient,
  maxGuestSessions: number
): Promise<void> {
  for (;;) {
    const size = await redisClient.zcard(GUEST_SESSION_CLUSTER_ORDER_KEY);
    const excessCount = size - maxGuestSessions;
    if (excessCount <= 0) {
      break;
    }

    const oldestSessionIds = await redisClient.zrange(GUEST_SESSION_CLUSTER_ORDER_KEY, 0, excessCount - 1);
    if (oldestSessionIds.length === 0) {
      break;
    }

    await redisClient.zrem(GUEST_SESSION_CLUSTER_ORDER_KEY, ...oldestSessionIds);
    await redisClient.del(...oldestSessionIds.map((sessionId) => buildGuestSessionClusterKey(sessionId)));
  }
}

async function persistGuestSessionClusterState(
  session: GuestAuthSession,
  config = readAuthRuntimeConfig(),
  deps: GuestSessionClusterDependencies = {}
): Promise<void> {
  if (session.authMode !== "guest" || !session.sessionId) {
    return;
  }

  const redisClient = resolveGuestSessionClusterClient(deps);
  if (!redisClient) {
    return;
  }

  await redisClient.set(
    buildGuestSessionClusterKey(session.sessionId),
    JSON.stringify(storeGuestSessionTokenHash(session)),
    "PX",
    getGuestSessionTtlMs(session)
  );
  const orderRedisClient = resolveGuestSessionClusterOrderClient(redisClient);
  await orderRedisClient.zadd(
    GUEST_SESSION_CLUSTER_ORDER_KEY,
    resolveGuestSessionClusterOrderScore(session.lastUsedAt),
    session.sessionId
  );
  await trimGuestSessionClusterOrder(orderRedisClient, config.maxGuestSessions);
}

async function touchGuestSessionClusterState(
  sessionId: string,
  token: string,
  deps: GuestSessionClusterDependencies = {}
): Promise<GuestAuthSession | null> {
  const redisClient = resolveGuestSessionClusterClient(deps);
  if (!redisClient) {
    return touchGuestSession(sessionId, token);
  }

  const serializedSession = await redisClient.get(buildGuestSessionClusterKey(sessionId));
  if (!serializedSession) {
    return null;
  }

  try {
    const existingSession = normalizeStoredGuestSession(JSON.parse(serializedSession));
    if (!existingSession || !validateStoredGuestSessionToken(existingSession, token)) {
      return null;
    }

    const nextSession: StoredGuestAuthSession = {
      ...existingSession,
      lastUsedAt: new Date().toISOString()
    };

    await redisClient.set(
      buildGuestSessionClusterKey(sessionId),
      JSON.stringify(nextSession),
      "PX",
      getGuestSessionTtlMs(nextSession)
    );
    await resolveGuestSessionClusterOrderClient(redisClient).zadd(
      GUEST_SESSION_CLUSTER_ORDER_KEY,
      resolveGuestSessionClusterOrderScore(nextSession.lastUsedAt),
      sessionId
    );
    return hydrateGuestSession(nextSession, token);
  } catch {
    return null;
  }
}

async function revokeGuestSessionClusterState(
  sessionId: string,
  deps: GuestSessionClusterDependencies = {}
): Promise<boolean> {
  const redisClient = resolveGuestSessionClusterClient(deps);
  if (!redisClient) {
    const revoked = guestSessionsById.delete(sessionId);
    syncAuthStateTelemetry();
    return revoked;
  }

  const deletedCount = await redisClient.del(buildGuestSessionClusterKey(sessionId));
  await resolveGuestSessionClusterOrderClient(redisClient).zrem(GUEST_SESSION_CLUSTER_ORDER_KEY, sessionId);
  guestSessionsById.delete(sessionId);
  syncAuthStateTelemetry();
  return deletedCount > 0;
}

async function finalizeGuestSessionForResponse(session: GuestAuthSession): Promise<GuestAuthSession> {
  if (session.authMode === "guest" && session.sessionId) {
    await persistGuestSessionClusterState(session);
  }
  return session;
}

function timingSafeCompareTokenSignature(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  return timingSafeCompareBuffer(actualBuffer, expectedBuffer);
}

function countActiveAccountLockouts(): number {
  const currentTime = nowMs();
  let count = 0;

  for (const [loginId, state] of accountLockoutStateByLoginId.entries()) {
    if (state.lockedUntil && state.lockedUntil > currentTime) {
      count += 1;
      continue;
    }

    if (state.failedAttempts.length === 0) {
      accountLockoutStateByLoginId.delete(loginId);
    }
  }

  return count;
}

function countActiveCredentialStuffingBlocks(): number {
  const currentTime = nowMs();
  let count = 0;

  for (const [ip, state] of credentialStuffingStateByIp.entries()) {
    if (state.blockedUntil && state.blockedUntil > currentTime) {
      count += 1;
      continue;
    }

    if (state.failedAttempts.length === 0) {
      credentialStuffingStateByIp.delete(ip);
    }
  }

  return count;
}

function syncAuthStateTelemetry(): void {
  setAuthGuestSessionCount(guestSessionsById.size);
  setAuthAccountLockCount(countActiveAccountLockouts());
  setAuthCredentialStuffingSourceCount(countActiveCredentialStuffingBlocks());
  setPendingAuthRegistrationCount(accountRegistrationStateByLoginId.size);
  setPendingAuthRecoveryCount(passwordRecoveryStateByLoginId.size);
}

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

function readAuthRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AuthRuntimeConfig {
  return {
    rateLimitWindowMs: parseEnvNumber(env.VEIL_RATE_LIMIT_AUTH_WINDOW_MS, DEFAULT_RATE_LIMIT_AUTH_WINDOW_MS, {
      minimum: 1,
      integer: true
    }),
    rateLimitMax: parseEnvNumber(env.VEIL_RATE_LIMIT_AUTH_MAX, DEFAULT_RATE_LIMIT_AUTH_MAX, {
      minimum: 1,
      integer: true
    }),
    lockoutThreshold: parseEnvNumber(env.VEIL_AUTH_LOCKOUT_THRESHOLD, DEFAULT_AUTH_LOCKOUT_THRESHOLD, {
      minimum: 1,
      integer: true
    }),
    lockoutDurationMs:
      parseEnvNumber(env.VEIL_AUTH_LOCKOUT_DURATION_MINUTES, DEFAULT_AUTH_LOCKOUT_DURATION_MINUTES, {
        minimum: 1 / 60_000
      }) * 60_000,
    credentialStuffingWindowMs: parseEnvNumber(
      env.VEIL_AUTH_CREDENTIAL_STUFFING_WINDOW_MS,
      DEFAULT_AUTH_CREDENTIAL_STUFFING_WINDOW_MS,
      {
        minimum: 1,
        integer: true
      }
    ),
    credentialStuffingDistinctLoginIdThreshold: parseEnvNumber(
      env.VEIL_AUTH_CREDENTIAL_STUFFING_DISTINCT_LOGIN_IDS,
      DEFAULT_AUTH_CREDENTIAL_STUFFING_DISTINCT_LOGIN_ID_THRESHOLD,
      {
        minimum: 2,
        integer: true
      }
    ),
    credentialStuffingBlockDurationMs:
      parseEnvNumber(
        env.VEIL_AUTH_CREDENTIAL_STUFFING_BLOCK_DURATION_MINUTES,
        DEFAULT_AUTH_CREDENTIAL_STUFFING_BLOCK_DURATION_MINUTES,
        {
          minimum: 1 / 60_000
        }
      ) * 60_000,
    maxGuestSessions: parseEnvNumber(env.VEIL_MAX_GUEST_SESSIONS, DEFAULT_MAX_GUEST_SESSIONS, {
      minimum: 1,
      integer: true
    }),
    accessTtlSeconds: parseEnvNumber(env.VEIL_AUTH_ACCESS_TTL_SECONDS, DEFAULT_AUTH_ACCESS_TTL_SECONDS, {
      minimum: 1,
      integer: true
    }),
    refreshTtlSeconds: parseEnvNumber(env.VEIL_AUTH_REFRESH_TTL_SECONDS, DEFAULT_AUTH_REFRESH_TTL_SECONDS, {
      minimum: 1,
      integer: true
    }),
    guestTokenTtlSeconds: parseEnvNumber(env.VEIL_AUTH_GUEST_TTL_SECONDS, DEFAULT_GUEST_TOKEN_TTL_SECONDS, {
      minimum: 1,
      integer: true
    })
  };
}

function nowMs(): number {
  return Date.now();
}

function toIsoTimestamp(offsetSeconds = 0): string {
  return new Date(nowMs() + offsetSeconds * 1000).toISOString();
}

function isExpiredTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.getTime() <= nowMs();
}

function hashRefreshToken(token: string): string {
  return createHmac("sha256", readAuthSecret()).update(`refresh:${token}`).digest("hex");
}

function hashPasswordRecoveryToken(token: string): string {
  return createHmac("sha256", readAuthSecret()).update(`password-recovery:${token}`).digest("hex");
}

function hashAccountRegistrationToken(token: string): string {
  return createHmac("sha256", readAuthSecret()).update(`account-registration:${token}`).digest("hex");
}

function cacheAccountAuthState(input: {
  playerId: string;
  accountSessionVersion: number;
  refreshSessionId?: string;
  refreshTokenHash?: string;
  refreshTokenExpiresAt?: string;
}): void {
  accountAuthStateByPlayerId.set(input.playerId, {
    sessionVersion: input.accountSessionVersion,
    ...(input.refreshSessionId ? { refreshSessionId: input.refreshSessionId } : {}),
    ...(input.refreshTokenHash ? { refreshTokenHash: input.refreshTokenHash } : {}),
    ...(input.refreshTokenExpiresAt ? { refreshTokenExpiresAt: input.refreshTokenExpiresAt } : {})
  });
}

export function cachePlayerAccountAuthState(input: {
  playerId: string;
  accountSessionVersion: number;
  refreshSessionId?: string;
  refreshTokenHash?: string;
  refreshTokenExpiresAt?: string;
}): void {
  cacheAccountAuthState(input);
}

function readWechatMiniGameLoginConfig(env: NodeJS.ProcessEnv = process.env): WechatMiniGameLoginConfig {
  const isTestEnvironment = env.NODE_ENV?.trim().toLowerCase() === "test";
  const normalizedMode = env.VEIL_WECHAT_MINIGAME_LOGIN_MODE?.trim().toLowerCase();
  const wechatAppSecret = readRuntimeSecret("WECHAT_APP_SECRET", env);
  const hasWechatCredentials = Boolean(env.WECHAT_APP_ID?.trim() && wechatAppSecret);
  const defaultMode = isTestEnvironment ? "mock" : hasWechatCredentials ? "production" : "disabled";
  const mode =
    normalizedMode === "mock" && isTestEnvironment
      ? "mock"
      : normalizedMode === "production" || normalizedMode === "code2session"
        ? "production"
        : normalizedMode === "disabled"
          ? "disabled"
          : defaultMode;
  return {
    mode,
    mockCode: env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE?.trim() || "wechat-dev-code",
    code2SessionUrl: env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL?.trim() || "https://api.weixin.qq.com/sns/jscode2session",
    ...(env.WECHAT_APP_ID?.trim() ? { appId: env.WECHAT_APP_ID.trim() } : {}),
    ...(wechatAppSecret ? { appSecret: wechatAppSecret } : {})
  };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function sendMaintenanceModeIfBlocked(
  response: ServerResponse,
  identity: {
    playerId?: string | null;
    loginId?: string | null;
  }
): Promise<boolean> {
  const state = await loadLaunchRuntimeState();
  const maintenance = resolveLaunchMaintenanceAccess(state, identity);
  if (!maintenance.blocked) {
    return false;
  }

  sendJson(response, 503, {
    error: {
      code: "maintenance_mode_active",
      message: maintenance.message
    },
    maintenanceMode: {
      active: maintenance.active,
      title: maintenance.title,
      message: maintenance.message,
      ...(maintenance.nextOpenAt ? { nextOpenAt: maintenance.nextOpenAt } : {})
    }
  });
  return true;
}

function toErrorPayload(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "error" : "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createGuestPlayerId(): string {
  return `guest-${randomUUID().slice(0, 8)}`;
}

function normalizePlayerId(playerId?: string | null): string {
  return playerId?.trim() || createGuestPlayerId();
}

function normalizeDisplayName(playerId: string, displayName?: string | null): string {
  const normalizedDisplayName = displayName?.trim();
  return normalizedDisplayName && normalizedDisplayName.length > 0 ? normalizedDisplayName : playerId;
}

function normalizeLoginId(loginId?: string | null): string | undefined {
  const normalized = loginId?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function normalizeSessionId(sessionId?: string | null): string | undefined {
  const normalized = sessionId?.trim();
  return normalized ? normalized : undefined;
}

function normalizeSessionVersion(sessionVersion?: number | null): number | undefined {
  if (sessionVersion == null || !Number.isFinite(sessionVersion)) {
    return undefined;
  }
  return Math.max(0, Math.floor(sessionVersion));
}

function resolveDeviceLabel(request: Pick<IncomingMessage, "headers">): string {
  const userAgent = request.headers["user-agent"];
  const raw = Array.isArray(userAgent) ? userAgent[0] : userAgent;
  const normalized = raw?.trim();
  return normalized ? normalized.slice(0, 191) : "Unknown device";
}

function normalizeAuthMode(authMode?: string | null, loginId?: string | null): AuthMode {
  return authMode === "account" || Boolean(normalizeLoginId(loginId)) ? "account" : "guest";
}

function normalizeAuthProvider(input?: {
  provider?: string | null | undefined;
  authMode?: string | null | undefined;
  loginId?: string | null | undefined;
}): AuthProvider {
  if (
    input?.provider === "guest" ||
    input?.provider === "account-password" ||
    input?.provider === "wechat-mini-game"
  ) {
    return input.provider;
  }
  return normalizeAuthMode(input?.authMode, input?.loginId) === "account" ? "account-password" : "guest";
}

function normalizeAccountLoginId(loginId?: string | null): string {
  const normalized = loginId?.trim().toLowerCase();
  if (!normalized) {
    throw new Error("loginId must not be empty");
  }

  if (!/^[a-z0-9][a-z0-9_-]{2,39}$/.test(normalized)) {
    throw new Error("loginId must be 3-40 chars and use only lowercase letters, digits, underscores, or hyphens");
  }

  return normalized;
}

function normalizeAccountPassword(password?: string | null): string {
  if (typeof password !== "string") {
    throw new Error("password must be a string");
  }

  const normalized = password.trim();
  if (normalized.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters`);
  }
  if (normalized.length > MAX_ACCOUNT_PASSWORD_LENGTH) {
    throw new Error(`password must be at most ${MAX_ACCOUNT_PASSWORD_LENGTH} characters`);
  }
  if (!/[A-Za-z]/.test(normalized) || !/\d/.test(normalized)) {
    throw new Error("password must include at least one letter and one number");
  }
  if (COMMON_WEAK_ACCOUNT_PASSWORDS.has(normalized.toLowerCase())) {
    throw new Error("password is too common");
  }

  return normalized;
}

function normalizeAccountLoginPassword(password?: string | null): string {
  if (typeof password !== "string") {
    throw new Error("password must be a string");
  }

  const normalized = password.trim();
  if (!normalized) {
    throw new Error("password must not be empty");
  }
  if (normalized.length > MAX_ACCOUNT_PASSWORD_LENGTH) {
    throw new Error(`password must be at most ${MAX_ACCOUNT_PASSWORD_LENGTH} characters`);
  }

  return normalized;
}

function normalizePasswordRecoveryToken(token?: string | null): string {
  const normalized = token?.trim();
  if (!normalized) {
    throw new Error("recoveryToken must not be empty");
  }

  return normalized;
}

function normalizeAccountRegistrationToken(token?: string | null): string {
  const normalized = token?.trim();
  if (!normalized) {
    throw new Error("registrationToken must not be empty");
  }

  return normalized;
}

function createFormalAccountPlayerId(): string {
  return `account-${randomUUID().slice(0, 8)}`;
}

function normalizeRequestedRegistrationDisplayName(loginId: string, displayName?: string | null): string {
  return normalizeDisplayName(loginId, displayName);
}

function readAccountRegistrationTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  return (
    parseEnvNumber(env.VEIL_ACCOUNT_REGISTRATION_TTL_MINUTES, DEFAULT_ACCOUNT_REGISTRATION_TTL_MINUTES, {
      minimum: 1 / 60_000
    }) * 60_000
  );
}

function readPasswordRecoveryTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  return (
    parseEnvNumber(env.VEIL_PASSWORD_RECOVERY_TTL_MINUTES, DEFAULT_PASSWORD_RECOVERY_TTL_MINUTES, {
      minimum: 1 / 60_000
    }) * 60_000
  );
}

function createAccountAuditLogEntry(
  playerId: string,
  description: string,
  timestamp = new Date().toISOString()
): EventLogEntry {
  return {
    id: `${playerId}:${timestamp}:account:${randomUUID().slice(0, 8)}`,
    timestamp,
    roomId: "auth",
    playerId,
    category: "account",
    description,
    rewards: []
  };
}

async function appendAccountAuditLog(
  store: RoomSnapshotStore,
  playerId: string,
  description: string,
  timestamp = new Date().toISOString()
): Promise<void> {
  const account = await store.ensurePlayerAccount({ playerId });
  await store.savePlayerAccountProgress(playerId, {
    recentEventLog: appendEventLogEntries(account.recentEventLog, [createAccountAuditLogEntry(playerId, description, timestamp)])
  });
}

async function resolveActiveBanForPlayer(
  store: RoomSnapshotStore | null,
  playerId: string
): Promise<PlayerAccountBanSnapshot | null> {
  if (!store) {
    return null;
  }

  if (!store.loadPlayerBan) {
    return null;
  }

  const ban = await store.loadPlayerBan(playerId);
  return isPlayerBanActive(ban) ? ban : null;
}

function createPasswordRecoveryToken(): string {
  return randomBytes(24).toString("base64url");
}

function createAccountRegistrationToken(): string {
  return randomBytes(24).toString("base64url");
}

function getLocalAccountRegistrationState(loginId: string): AccountRegistrationState | null {
  const existing = accountRegistrationStateByLoginId.get(loginId);
  if (!existing) {
    return null;
  }

  if (isExpiredTimestamp(existing.expiresAt)) {
    accountRegistrationStateByLoginId.delete(loginId);
    clearAccountTokenDeliveryState("account-registration", loginId);
    syncAuthStateTelemetry();
    return null;
  }

  return existing;
}

function buildAccountRegistrationClusterKey(loginId: string): string {
  return `${ACCOUNT_REGISTRATION_CLUSTER_KEY_PREFIX}${loginId}`;
}

function getAccountRegistrationStateTtlMs(state: AccountRegistrationState): number {
  return Math.max(1, new Date(state.expiresAt).getTime() - nowMs());
}

function normalizeAccountRegistrationState(input: unknown): AccountRegistrationState | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<Record<keyof AccountRegistrationState, unknown>>;
  if (
    typeof candidate.loginId !== "string" ||
    typeof candidate.requestedDisplayName !== "string" ||
    typeof candidate.tokenHash !== "string" ||
    typeof candidate.deliveryToken !== "string" ||
    typeof candidate.issuedAt !== "string" ||
    typeof candidate.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    loginId: candidate.loginId,
    requestedDisplayName: candidate.requestedDisplayName,
    tokenHash: candidate.tokenHash,
    deliveryToken: candidate.deliveryToken,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt
  };
}

async function getAccountRegistrationState(loginId: string): Promise<AccountRegistrationState | null> {
  const redisClient = resolveGuestSessionClusterClient();
  if (!redisClient) {
    return getLocalAccountRegistrationState(loginId);
  }

  try {
    const serialized = await redisClient.get(buildAccountRegistrationClusterKey(loginId));
    if (!serialized) {
      return null;
    }
    const state = normalizeAccountRegistrationState(JSON.parse(serialized));
    if (!state) {
      await redisClient.del(buildAccountRegistrationClusterKey(loginId));
      return null;
    }
    if (isExpiredTimestamp(state.expiresAt)) {
      await redisClient.del(buildAccountRegistrationClusterKey(loginId));
      await clearAccountTokenDeliveryState("account-registration", loginId);
      return null;
    }
    accountRegistrationStateByLoginId.set(loginId, state);
    syncAuthStateTelemetry();
    return state;
  } catch {
    return getLocalAccountRegistrationState(loginId);
  }
}

async function storeAccountRegistrationState(loginId: string, requestedDisplayName: string, token: string): Promise<AccountRegistrationState> {
  await clearAccountTokenDeliveryState("account-registration", loginId);
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(nowMs() + readAccountRegistrationTtlMs()).toISOString();
  const state: AccountRegistrationState = {
    loginId,
    requestedDisplayName,
    tokenHash: hashAccountRegistrationToken(token),
    deliveryToken: token,
    issuedAt,
    expiresAt
  };
  accountRegistrationStateByLoginId.set(loginId, state);
  syncAuthStateTelemetry();
  const redisClient = resolveGuestSessionClusterClient();
  if (redisClient) {
    try {
      await redisClient.set(
        buildAccountRegistrationClusterKey(loginId),
        JSON.stringify(state),
        "PX",
        getAccountRegistrationStateTtlMs(state)
      );
    } catch {
      // Keep local fallback state when Redis is unavailable.
    }
  }
  return state;
}

async function consumeAccountRegistrationState(loginId: string, token: string): Promise<AccountRegistrationState | null> {
  const state = await getAccountRegistrationState(loginId);
  if (!state) {
    return null;
  }

  if (!timingSafeCompareHexDigest(hashAccountRegistrationToken(token), state.tokenHash)) {
    return null;
  }

  accountRegistrationStateByLoginId.delete(loginId);
  const redisClient = resolveGuestSessionClusterClient();
  if (redisClient) {
    try {
      await redisClient.del(buildAccountRegistrationClusterKey(loginId));
    } catch {
      // Local deletion below still prevents reuse on this pod.
    }
  }
  await clearAccountTokenDeliveryState("account-registration", loginId);
  syncAuthStateTelemetry();
  return state;
}

function getLocalPasswordRecoveryState(loginId: string): PasswordRecoveryState | null {
  const existing = passwordRecoveryStateByLoginId.get(loginId);
  if (!existing) {
    return null;
  }

  if (isExpiredTimestamp(existing.expiresAt)) {
    passwordRecoveryStateByLoginId.delete(loginId);
    clearAccountTokenDeliveryState("password-recovery", loginId);
    syncAuthStateTelemetry();
    return null;
  }

  return existing;
}

function buildPasswordRecoveryClusterKey(loginId: string): string {
  return `${PASSWORD_RECOVERY_CLUSTER_KEY_PREFIX}${loginId}`;
}

function getPasswordRecoveryStateTtlMs(state: PasswordRecoveryState): number {
  return Math.max(1, new Date(state.expiresAt).getTime() - nowMs());
}

function normalizePasswordRecoveryState(input: unknown): PasswordRecoveryState | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<Record<keyof PasswordRecoveryState, unknown>>;
  if (
    typeof candidate.playerId !== "string" ||
    typeof candidate.loginId !== "string" ||
    typeof candidate.tokenHash !== "string" ||
    typeof candidate.deliveryToken !== "string" ||
    typeof candidate.issuedAt !== "string" ||
    typeof candidate.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    playerId: candidate.playerId,
    loginId: candidate.loginId,
    tokenHash: candidate.tokenHash,
    deliveryToken: candidate.deliveryToken,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt
  };
}

async function getPasswordRecoveryState(loginId: string): Promise<PasswordRecoveryState | null> {
  const redisClient = resolveGuestSessionClusterClient();
  if (!redisClient) {
    return getLocalPasswordRecoveryState(loginId);
  }

  try {
    const serialized = await redisClient.get(buildPasswordRecoveryClusterKey(loginId));
    if (!serialized) {
      return null;
    }
    const state = normalizePasswordRecoveryState(JSON.parse(serialized));
    if (!state) {
      await redisClient.del(buildPasswordRecoveryClusterKey(loginId));
      return null;
    }
    if (isExpiredTimestamp(state.expiresAt)) {
      await redisClient.del(buildPasswordRecoveryClusterKey(loginId));
      await clearAccountTokenDeliveryState("password-recovery", loginId);
      return null;
    }
    passwordRecoveryStateByLoginId.set(loginId, state);
    syncAuthStateTelemetry();
    return state;
  } catch {
    return getLocalPasswordRecoveryState(loginId);
  }
}

async function storePasswordRecoveryState(playerId: string, loginId: string, token: string): Promise<PasswordRecoveryState> {
  await clearAccountTokenDeliveryState("password-recovery", loginId);
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(nowMs() + readPasswordRecoveryTtlMs()).toISOString();
  const state: PasswordRecoveryState = {
    playerId,
    loginId,
    tokenHash: hashPasswordRecoveryToken(token),
    deliveryToken: token,
    issuedAt,
    expiresAt
  };
  passwordRecoveryStateByLoginId.set(loginId, state);
  syncAuthStateTelemetry();
  const redisClient = resolveGuestSessionClusterClient();
  if (redisClient) {
    try {
      await redisClient.set(
        buildPasswordRecoveryClusterKey(loginId),
        JSON.stringify(state),
        "PX",
        getPasswordRecoveryStateTtlMs(state)
      );
    } catch {
      // Keep local fallback state when Redis is unavailable.
    }
  }
  return state;
}

async function consumePasswordRecoveryState(loginId: string, token: string): Promise<PasswordRecoveryState | null> {
  const state = await getPasswordRecoveryState(loginId);
  if (!state) {
    return null;
  }

  if (!timingSafeCompareHexDigest(hashPasswordRecoveryToken(token), state.tokenHash)) {
    return null;
  }

  passwordRecoveryStateByLoginId.delete(loginId);
  const redisClient = resolveGuestSessionClusterClient();
  if (redisClient) {
    try {
      await redisClient.del(buildPasswordRecoveryClusterKey(loginId));
    } catch {
      // Local deletion below still prevents reuse on this pod.
    }
  }
  await clearAccountTokenDeliveryState("password-recovery", loginId);
  syncAuthStateTelemetry();
  return state;
}

function normalizeWechatMiniGameCode(code?: string | null): string {
  const normalized = code?.trim();
  if (!normalized) {
    throw new Error("wechat_code_required");
  }
  return normalized;
}

function normalizeAvatarUrl(avatarUrl?: string | null): string | undefined {
  const normalized = avatarUrl?.trim();
  return normalized ? normalized : undefined;
}

function sendPrivacyConsentRequired(response: ServerResponse): void {
  sendJson(response, 403, {
    error: {
      code: "privacy_consent_required",
      message: "Privacy consent must be accepted before continuing"
    }
  });
}

async function ensurePlayerPrivacyConsent(
  response: ServerResponse,
  store: RoomSnapshotStore | null,
  account: PlayerAccountSnapshot,
  privacyConsentAccepted?: boolean | null
): Promise<PlayerAccountSnapshot | null> {
  if (!store || account.privacyConsentAt) {
    return account;
  }

  if (privacyConsentAccepted !== true) {
    sendPrivacyConsentRequired(response);
    return null;
  }

  return store.savePlayerAccountPrivacyConsent(account.playerId);
}

export function createWechatMiniGamePlayerId(openId: string): string {
  const normalizedOpenId = openId.trim();
  if (!normalizedOpenId) {
    throw new Error("wechat_openid_required");
  }

  return `wechat-${createHmac("sha256", readAuthSecret()).update(`wechat:${normalizedOpenId}`).digest("hex").slice(0, 16)}`;
}

function isWechatMiniGamePlayerId(playerId: string): boolean {
  return playerId.trim().toLowerCase().startsWith("wechat-");
}

function isAccountBackedPlayerAccount(account: PlayerAccountSnapshot | null | undefined): boolean {
  return Boolean(account?.loginId || account?.wechatMiniGameOpenId);
}

function isGuestPlayerIdReserved(input: {
  playerId: string;
  account?: PlayerAccountSnapshot | null;
  loginIdOwner?: PlayerAccountSnapshot | null;
}): boolean {
  return (
    isWechatMiniGamePlayerId(input.playerId) ||
    isAccountBackedPlayerAccount(input.account) ||
    Boolean(input.loginIdOwner)
  );
}

const WECHAT_GUEST_UPGRADE_NOTICE = "您的游客进度将合并到新账号";

function hasPlayerAccountProgress(account: PlayerAccountSnapshot | null | undefined): boolean {
  if (!account) {
    return false;
  }

  return (
    (account.gems ?? 0) > 0 ||
    (account.seasonXp ?? 0) > 0 ||
    (account.loginStreak ?? 0) > 0 ||
    (account.dailyPlayMinutes ?? 0) > 0 ||
    (account.globalResources.gold ?? 0) > 0 ||
    (account.globalResources.wood ?? 0) > 0 ||
    (account.globalResources.ore ?? 0) > 0 ||
    account.achievements.length > 0 ||
    (account.recentBattleReplays?.length ?? 0) > 0 ||
    (account.seasonBadges?.length ?? 0) > 0 ||
    (account.seasonPassClaimedTiers?.length ?? 0) > 0 ||
    (account.mailbox?.length ?? 0) > 0 ||
    (account.cosmeticInventory?.ownedIds.length ?? 0) > 0 ||
    account.campaignProgress !== undefined ||
    account.dailyDungeonState !== undefined ||
    account.seasonalEventStates !== undefined ||
    (account.tutorialStep ?? 0) > 0
  );
}

async function summarizeMigrationProgress(store: RoomSnapshotStore, account: PlayerAccountSnapshot): Promise<{
  hasProgress: boolean;
  heroCount: number;
  hasQuestState: boolean;
}> {
  const [heroArchives, questState] = await Promise.all([
    store.loadPlayerHeroArchives([account.playerId]),
    store.loadPlayerQuestState?.(account.playerId)
  ]);
  return {
    hasProgress:
      hasPlayerAccountProgress(account) ||
      heroArchives.length > 0 ||
      (questState?.activeQuestIds.length ?? 0) > 0 ||
      (questState?.rotations.length ?? 0) > 0,
    heroCount: heroArchives.length,
    hasQuestState: Boolean(questState && (questState.activeQuestIds.length > 0 || questState.rotations.length > 0))
  };
}

async function exchangeWechatMiniGameCode(
  code: string,
  config: WechatMiniGameLoginConfig,
  fetchImpl: typeof fetch = fetch
): Promise<WechatMiniGameIdentity> {
  if (config.mode === "mock") {
    if (code !== config.mockCode) {
      throw new Error("invalid_wechat_code");
    }

    return {
      openId: `mock-openid:${code}`,
      sessionKey: Buffer.from(`mock-session-key:${code}`, "utf8").toString("base64")
    };
  }

  if (config.mode !== "production" || !config.appId || !config.appSecret) {
    throw new Error("wechat_login_not_enabled");
  }

  const requestUrl = new URL(config.code2SessionUrl);
  requestUrl.searchParams.set("appid", config.appId);
  requestUrl.searchParams.set("secret", config.appSecret);
  requestUrl.searchParams.set("js_code", code);
  requestUrl.searchParams.set("grant_type", "authorization_code");

  const response = await fetchImpl(requestUrl, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error("wechat_code2session_failed");
  }

  const payload = (await response.json()) as WechatMiniGameCode2SessionPayload;
  if (payload.errcode) {
    if (payload.errcode === 40029) {
      throw new Error("invalid_wechat_code");
    }
    throw new Error(`wechat_code2session_failed:${payload.errcode}`);
  }

  const openId = payload.openid?.trim();
  const sessionKey = payload.session_key?.trim();
  if (!openId || !sessionKey) {
    throw new Error("wechat_code2session_failed");
  }

  return {
    openId,
    ...(payload.unionid?.trim() ? { unionId: payload.unionid.trim() } : {}),
    sessionKey
  };
}

function issueSignedToken(payload: GuestAuthTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", readAuthSecret()).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function issueAuthSession(input: {
  playerId: string;
  displayName: string;
  authMode?: AuthMode;
  provider?: AuthProvider;
  loginId?: string | null;
  sessionId?: string | null;
  sessionVersion?: number | null;
  tokenKind?: "access" | "refresh";
  ttlSeconds: number;
}): GuestAuthSession {
  const issuedAt = toIsoTimestamp();
  const expiresAt = toIsoTimestamp(input.ttlSeconds);
  const loginId = normalizeLoginId(input.loginId);
  const sessionId = normalizeSessionId(input.sessionId);
  const sessionVersion = normalizeSessionVersion(input.sessionVersion);
  const authMode = normalizeAuthMode(input.authMode, loginId);
  const provider = normalizeAuthProvider({
    provider: input.provider,
    authMode,
    loginId
  });
  const payload: GuestAuthTokenPayload = {
    playerId: input.playerId,
    displayName: input.displayName,
    authMode,
    provider,
    ...(loginId ? { loginId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionVersion != null ? { sessionVersion } : {}),
    ...(input.tokenKind ? { tokenKind: input.tokenKind } : {}),
    nonce: randomUUID(),
    issuedAt,
    expiresAt
  };

  return {
    token: issueSignedToken(payload),
    playerId: input.playerId,
    displayName: input.displayName,
    authMode,
    provider,
    ...(loginId ? { loginId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionVersion != null ? { sessionVersion } : {}),
    issuedAt,
    expiresAt,
    lastUsedAt: issuedAt
  };
}

function issueGuestAccessSession(
  input: { playerId: string; displayName: string; provider?: AuthProvider; sessionId?: string | null },
  config = readAuthRuntimeConfig()
): GuestAuthSession {
  return issueAuthSession({
    ...input,
    authMode: "guest",
    provider: input.provider ?? "guest",
    sessionId: input.sessionId ?? randomUUID(),
    ttlSeconds: config.guestTokenTtlSeconds
  });
}

function issueAccountAccessSession(
  input: {
    playerId: string;
    displayName: string;
    loginId: string;
    provider?: AuthProvider;
    sessionId?: string | null;
    sessionVersion?: number | null;
  },
  config = readAuthRuntimeConfig()
): GuestAuthSession {
  return issueAuthSession({
    ...input,
    authMode: "account",
    provider: input.provider ?? "account-password",
    tokenKind: "access",
    ttlSeconds: config.accessTtlSeconds
  });
}

function issueAccountRefreshSession(
  input: {
    playerId: string;
    displayName: string;
    loginId: string;
    provider?: AuthProvider;
    sessionId: string;
    sessionVersion: number;
  },
  config = readAuthRuntimeConfig()
): GuestAuthSession {
  return issueAuthSession({
    ...input,
    authMode: "account",
    provider: input.provider ?? "account-password",
    tokenKind: "refresh",
    ttlSeconds: config.refreshTtlSeconds
  });
}

export function issueGuestAuthSession(input: { playerId: string; displayName: string }): GuestAuthSession {
  const session = issueGuestAccessSession({
    ...input,
    provider: "guest",
    sessionId: randomUUID()
  });
  registerGuestSession(session);
  return session;
}

export function issueAccountAuthSession(input: {
  playerId: string;
  displayName: string;
  loginId: string;
  sessionId?: string | null;
  sessionVersion?: number | null;
}): GuestAuthSession {
  return issueAccountAccessSession(input);
}

export function issueWechatMiniGameAuthSession(input: {
  playerId: string;
  displayName: string;
  loginId?: string | null;
  sessionId?: string | null;
  sessionVersion?: number | null;
}): GuestAuthSession {
  const loginId = normalizeLoginId(input.loginId);
  if (loginId) {
    return issueAccountAccessSession({
      playerId: input.playerId,
      displayName: input.displayName,
      loginId,
      provider: "wechat-mini-game",
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.sessionVersion !== undefined ? { sessionVersion: input.sessionVersion } : {})
    });
  }

  const session = issueGuestAccessSession({
    playerId: input.playerId,
    displayName: input.displayName,
    provider: "wechat-mini-game",
    sessionId: input.sessionId ?? randomUUID()
  });
  registerGuestSession(session);
  return session;
}

async function handleWechatLogin(
  request: IncomingMessage,
  response: ServerResponse,
  store: RoomSnapshotStore | null
): Promise<void> {
  let authSession: GuestAuthSession | null = null;
  const authToken = readGuestAuthTokenFromRequest(request);
  if (authToken) {
    const validation = await validateAuthToken(authToken, store);
    if (!validation.session) {
      sendAuthFailure(response, validation.errorCode, validation.ban);
      return;
    }
    authSession = validation.session;
  }
  const body = (await readJsonBody(request)) as {
    code?: string | null;
    playerId?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    migrationChoice?: string | null;
    privacyConsentAccepted?: boolean | null;
    birthdate?: string | null;
    ageVerified?: boolean | null;
    isAdult?: boolean | null;
    ageRange?: string | null;
  };

  if (body.code !== undefined && body.code !== null && typeof body.code !== "string") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected string field: code"
      }
    });
    return;
  }

  if (body.playerId !== undefined && body.playerId !== null && typeof body.playerId !== "string") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected optional string field: playerId"
      }
    });
    return;
  }

  if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected optional string field: displayName"
      }
    });
    return;
  }

  if (body.avatarUrl !== undefined && body.avatarUrl !== null && typeof body.avatarUrl !== "string") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected optional string field: avatarUrl"
      }
    });
    return;
  }

  if (body.migrationChoice !== undefined && body.migrationChoice !== null && typeof body.migrationChoice !== "string") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected optional string field: migrationChoice"
      }
    });
    return;
  }

  if (body.privacyConsentAccepted !== undefined && body.privacyConsentAccepted !== null && typeof body.privacyConsentAccepted !== "boolean") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected optional boolean field: privacyConsentAccepted"
      }
    });
    return;
  }

  if (body.ageVerified !== undefined && body.ageVerified !== null && typeof body.ageVerified !== "boolean") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected optional boolean field: ageVerified"
      }
    });
    return;
  }

  if (body.birthdate !== undefined && body.birthdate !== null && typeof body.birthdate !== "string") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected optional string field: birthdate"
      }
    });
    return;
  }

  if (body.isAdult !== undefined && body.isAdult !== null && typeof body.isAdult !== "boolean") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected optional boolean field: isAdult"
      }
    });
    return;
  }

  if (body.ageRange !== undefined && body.ageRange !== null && typeof body.ageRange !== "string") {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "Expected optional string field: ageRange"
      }
    });
    return;
  }

  const code = normalizeWechatMiniGameCode(body.code);
  const avatarUrl = normalizeAvatarUrl(body.avatarUrl);
  const maintenanceContext = body.playerId != null ? { playerId: body.playerId } : {};
  if (await sendMaintenanceModeIfBlocked(response, maintenanceContext)) {
    return;
  }
  const migrationChoice = body.migrationChoice?.trim();
  if (
    migrationChoice !== undefined &&
    migrationChoice !== "" &&
    migrationChoice !== "keep_guest" &&
    migrationChoice !== "keep_registered"
  ) {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: "migrationChoice must be keep_guest or keep_registered"
      }
    });
    return;
  }
  const now = new Date();
  let minorProtection: ReturnType<typeof deriveWechatMinorProtection>;
  try {
    minorProtection = deriveWechatMinorProtection({
      ...(body.birthdate !== undefined ? { birthdate: body.birthdate } : {}),
      ...(body.ageVerified !== undefined ? { ageVerified: body.ageVerified } : {}),
      ...(body.isAdult !== undefined ? { isAdult: body.isAdult } : {}),
      ...(body.ageRange !== undefined ? { ageRange: body.ageRange } : {})
    }, now);
  } catch (error) {
    sendJson(response, 400, {
      error: {
        code: "invalid_payload",
        message: error instanceof Error ? error.message : String(error)
      }
    });
    return;
  }
  const wechatConfig = readWechatMiniGameLoginConfig();

  let identity: WechatMiniGameIdentity;
  try {
    identity = await exchangeWechatMiniGameCode(code, wechatConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : "wechat_login_not_enabled";
    if (message === "wechat_login_not_enabled") {
      sendJson(response, 501, {
        error: {
          code: "wechat_login_not_enabled",
          message: "WeChat login exchange exists, but code2Session is not configured"
        }
      });
      return;
    }

    if (message === "invalid_wechat_code") {
      sendJson(response, 401, {
        error: {
          code: "invalid_wechat_code",
          message:
            wechatConfig.mode === "mock" ? "WeChat mock code is incorrect" : "WeChat code is invalid or expired"
        }
      });
      return;
    }

    sendJson(response, 502, {
      error: {
        code: "wechat_code2session_failed",
        message
      }
    });
    return;
  }

  let playerId = authSession?.playerId ?? normalizePlayerId(body.playerId || createWechatMiniGamePlayerId(identity.openId));
  let displayName = normalizeDisplayName(playerId, body.displayName ?? authSession?.displayName);
  let loginId = authSession?.loginId;
  let rewardAccount: PlayerAccountSnapshot | null = null;
  let accountMigration:
    | {
        notice: string;
        previousGuestPlayerId: string;
        migratedToPlayerId: string;
        strategy: "keep_guest" | "keep_registered";
      }
    | undefined;

  if (store) {
    const boundAccount = await store.loadPlayerAccountByWechatMiniGameOpenId(identity.openId);
    const wechatIdentity = {
      openId: identity.openId,
      ...(identity.unionId ? { unionId: identity.unionId } : {}),
      ...(body.displayName?.trim() ? { displayName: body.displayName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...minorProtection
    };
    if (authSession?.authMode === "guest") {
      const guestAccount =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      if (guestAccount.guestMigratedToPlayerId) {
        if (authSession.sessionId) {
          revokeGuestAuthSession(authSession.sessionId);
        }
        sendJson(response, 409, {
          error: {
            code: "guest_account_migrated",
            message: `Guest account has already been migrated to ${guestAccount.guestMigratedToPlayerId}`
          }
        });
        return;
      }

      const targetPlayerId = boundAccount?.playerId ?? createWechatMiniGamePlayerId(identity.openId);
      if (boundAccount && boundAccount.playerId !== guestAccount.playerId) {
        const [guestSummary, registeredSummary] = await Promise.all([
          summarizeMigrationProgress(store, guestAccount),
          summarizeMigrationProgress(store, boundAccount)
        ]);
        if (registeredSummary.hasProgress && migrationChoice !== "keep_guest" && migrationChoice !== "keep_registered") {
          sendJson(response, 409, {
            error: {
              code: "wechat_guest_upgrade_conflict",
              message: "Registered WeChat account already has progression. Choose which progression to keep."
            },
            migrationConflict: {
              notice: WECHAT_GUEST_UPGRADE_NOTICE,
              guest: {
                playerId: guestAccount.playerId,
                hasProgress: guestSummary.hasProgress,
                heroCount: guestSummary.heroCount,
                hasQuestState: guestSummary.hasQuestState
              },
              registered: {
                playerId: boundAccount.playerId,
                hasProgress: registeredSummary.hasProgress,
                heroCount: registeredSummary.heroCount,
                hasQuestState: registeredSummary.hasQuestState
              },
              choices: ["keep_registered", "keep_guest"]
            }
          });
          return;
        }
      }

      const strategy = migrationChoice === "keep_registered" ? "keep_registered" : "keep_guest";
      let migratedAccount = (
        await store.migrateGuestToRegistered({
          guestPlayerId: guestAccount.playerId,
          targetPlayerId,
          progressSource: strategy === "keep_registered" ? "target" : "guest",
          wechatIdentity
        })
      ).account;
      const consentedAccount = await ensurePlayerPrivacyConsent(response, store, migratedAccount, body.privacyConsentAccepted);
      if (!consentedAccount) {
        return;
      }
      migratedAccount = consentedAccount;
      if (authSession.sessionId) {
        revokeGuestAuthSession(authSession.sessionId);
      }
      playerId = migratedAccount.playerId;
      displayName = migratedAccount.displayName;
      loginId = migratedAccount.loginId;
      rewardAccount = migratedAccount;
      accountMigration = {
        notice: WECHAT_GUEST_UPGRADE_NOTICE,
        previousGuestPlayerId: guestAccount.playerId,
        migratedToPlayerId: migratedAccount.playerId,
        strategy
      };
    } else if (boundAccount && authSession && boundAccount.playerId !== authSession.playerId) {
      sendJson(response, 409, {
        error: {
          code: "wechat_identity_already_bound",
          message: "This WeChat identity is already bound to another account"
        }
      });
      return;
    }

    const requestedPlayerId = body.playerId?.trim();
    if (!authSession && requestedPlayerId) {
      const existingRequestedAccount = await store.loadPlayerAccount(requestedPlayerId);
      if (!existingRequestedAccount) {
        playerId = normalizePlayerId(requestedPlayerId);
      } else if (!boundAccount || existingRequestedAccount.playerId !== boundAccount.playerId) {
        sendJson(response, 409, {
          error: {
            code: "wechat_player_id_conflict",
            message: "Cannot bind WeChat identity to an existing unauthenticated playerId"
          }
        });
        return;
      }
    }

    if (rewardAccount) {
      // Guest upgrade already migrated/bound through the atomic store path above.
    } else if (boundAccount) {
      let syncedAccount = await store.bindPlayerAccountWechatMiniGameIdentity(boundAccount.playerId, {
        ...wechatIdentity
      });
      const consentedAccount = await ensurePlayerPrivacyConsent(response, store, syncedAccount, body.privacyConsentAccepted);
      if (!consentedAccount) {
        return;
      }
      syncedAccount = consentedAccount;
      playerId = syncedAccount.playerId;
      displayName = syncedAccount.displayName;
      loginId = syncedAccount.loginId;
      rewardAccount = syncedAccount;
    } else {
      const targetPlayerId = authSession?.playerId ?? playerId;
      let boundAccountResult = await store.bindPlayerAccountWechatMiniGameIdentity(targetPlayerId, {
        ...wechatIdentity
      });
      const consentedAccount = await ensurePlayerPrivacyConsent(response, store, boundAccountResult, body.privacyConsentAccepted);
      if (!consentedAccount) {
        return;
      }
      boundAccountResult = consentedAccount;
      playerId = boundAccountResult.playerId;
      displayName = boundAccountResult.displayName;
      loginId = boundAccountResult.loginId;
      rewardAccount = boundAccountResult;
    }
  } else if (!authSession && body.playerId?.trim()) {
    playerId = normalizePlayerId(body.playerId);
    displayName = normalizeDisplayName(playerId, body.displayName);
  }

  const activeBan = await resolveActiveBanForPlayer(store, playerId);
  if (activeBan) {
    sendAuthFailure(response, "account_banned", activeBan);
    return;
  }

  await cacheWechatSessionKey(playerId, identity.sessionKey, readWechatSessionKeyTtlSeconds());

  const dailyLoginReward = store && rewardAccount ? await issueDailyLoginReward(store, rewardAccount) : null;

  sendJson(response, 200, {
    session:
      store && loginId
        ? await createAccountSessionBundle(store, {
            playerId,
            displayName,
            loginId,
            provider: "wechat-mini-game",
            deviceLabel: resolveDeviceLabel(request)
          })
        : issueWechatMiniGameAuthSession({
            playerId,
            displayName,
            ...(loginId ? { loginId } : {})
          }),
    ...(dailyLoginReward?.claimed
      ? {
          dailyLoginReward: {
            streak: dailyLoginReward.streak,
            reward: dailyLoginReward.reward
          }
        }
      : {}),
    ...(accountMigration ? { accountMigration } : {})
  });
  if (store && loginId) {
    recordAuthAccountLogin();
  } else {
    recordAuthGuestLogin();
  }
}

export function issueNextAuthSession(
  input: {
    playerId: string;
    displayName: string;
    loginId?: string | null;
    sessionId?: string | null;
    sessionVersion?: number | null;
  },
  currentSession?: Pick<GuestAuthSession, "authMode" | "loginId" | "provider" | "sessionId" | "sessionVersion"> | null
): GuestAuthSession {
  const loginId = normalizeLoginId(input.loginId);
  if (currentSession?.authMode === "account" && loginId) {
    const nextSessionId = input.sessionId ?? currentSession.sessionId;
    const nextSessionVersion = input.sessionVersion ?? currentSession.sessionVersion;
    return issueAccountAccessSession({
      playerId: input.playerId,
      displayName: input.displayName,
      loginId,
      ...(currentSession.provider ? { provider: currentSession.provider } : {}),
      ...(nextSessionId !== undefined ? { sessionId: nextSessionId } : {}),
      ...(nextSessionVersion !== undefined ? { sessionVersion: nextSessionVersion } : {})
    });
  }

  const nextGuestSessionId = input.sessionId ?? currentSession?.sessionId;
  const nextGuestSession = issueGuestAccessSession({
    playerId: input.playerId,
    displayName: input.displayName,
    provider: currentSession?.provider ?? "guest",
    ...(nextGuestSessionId !== undefined ? { sessionId: nextGuestSessionId } : {})
  });
  registerGuestSession(nextGuestSession);
  return nextGuestSession;
}

function resolveAuthSession(token: string): GuestAuthSession | null {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return null;
  }

  const [encodedPayload, signature] = normalizedToken.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", readAuthSecret()).update(encodedPayload).digest("base64url");
  if (!timingSafeCompareTokenSignature(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as GuestAuthTokenPayload;
    if (
      typeof payload.playerId !== "string" ||
      typeof payload.displayName !== "string" ||
      typeof payload.issuedAt !== "string" ||
      typeof payload.expiresAt !== "string"
    ) {
      return null;
    }

    const loginId = normalizeLoginId(payload.loginId);
    const sessionId = normalizeSessionId(payload.sessionId);
    const sessionVersion = normalizeSessionVersion(payload.sessionVersion);
    const session = {
      token: normalizedToken,
      playerId: payload.playerId,
      displayName: payload.displayName,
      authMode: normalizeAuthMode(payload.authMode, payload.loginId),
      provider: normalizeAuthProvider(payload),
      ...(loginId ? { loginId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(sessionVersion != null ? { sessionVersion } : {}),
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      lastUsedAt: new Date().toISOString()
    };
    if (isExpiredTimestamp(session.expiresAt)) {
      return null;
    }
    if (payload.tokenKind !== "refresh" && session.authMode === "guest" && session.sessionId) {
      return touchGuestSession(session.sessionId, normalizedToken);
    }

    return session;
  } catch {
    return null;
  }
}

export const resolveGuestAuthSession = resolveAuthSession;

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }

  return value?.trim() || null;
}

export function readGuestAuthTokenFromRequest(request: Pick<IncomingMessage, "headers">): string | null {
  const authorization = readHeaderValue(request.headers.authorization);
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }

  return readHeaderValue(request.headers["x-veil-auth"]);
}

export function resolveAuthSessionFromRequest(request: Pick<IncomingMessage, "headers">): GuestAuthSession | null {
  const token = readGuestAuthTokenFromRequest(request);
  return token ? resolveAuthSession(token) : null;
}

export const resolveGuestAuthSessionFromRequest = resolveAuthSessionFromRequest;

async function validateAuthToken(
  token: string,
  store: RoomSnapshotStore | null,
  expectedKind: "access" | "refresh" = "access"
): Promise<ValidateAuthSessionResult> {
  recordAuthSessionCheck();
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    recordAuthSessionFailure("unauthorized");
    return { session: null, errorCode: "unauthorized" };
  }

  const [encodedPayload, signature] = normalizedToken.split(".");
  if (!encodedPayload || !signature) {
    recordAuthSessionFailure("unauthorized");
    return { session: null, errorCode: "unauthorized" };
  }

  const expectedSignature = createHmac("sha256", readAuthSecret()).update(encodedPayload).digest("base64url");
  if (!timingSafeCompareTokenSignature(signature, expectedSignature)) {
    recordAuthSessionFailure("unauthorized");
    return { session: null, errorCode: "unauthorized" };
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as GuestAuthTokenPayload;
    if (
      typeof payload.playerId !== "string" ||
      typeof payload.displayName !== "string" ||
      typeof payload.issuedAt !== "string" ||
      typeof payload.expiresAt !== "string"
    ) {
      recordAuthSessionFailure("unauthorized");
      return { session: null, errorCode: "unauthorized" };
    }

    const tokenKind = payload.tokenKind ?? "access";
    if (tokenKind !== expectedKind) {
      recordAuthSessionFailure("token_kind_invalid");
      return { session: null, errorCode: "token_kind_invalid" };
    }

    const loginId = normalizeLoginId(payload.loginId);
    const sessionId = normalizeSessionId(payload.sessionId);
    const sessionVersion = normalizeSessionVersion(payload.sessionVersion);
    const session: GuestAuthSession = {
      token: normalizedToken,
      playerId: payload.playerId,
      displayName: payload.displayName,
      authMode: normalizeAuthMode(payload.authMode, payload.loginId),
      provider: normalizeAuthProvider(payload),
      ...(loginId ? { loginId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(sessionVersion != null ? { sessionVersion } : {}),
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      lastUsedAt: new Date().toISOString()
    };

    if (isExpiredTimestamp(session.expiresAt)) {
      recordAuthSessionFailure("token_expired");
      return { session: null, errorCode: "token_expired" };
    }

    if (session.authMode === "guest") {
      const account = store ? await store.loadPlayerAccount(session.playerId) : null;
      if (
        session.provider === "guest" &&
        isGuestPlayerIdReserved({
          playerId: session.playerId,
          account
        })
      ) {
        if (session.sessionId) {
          await revokeGuestSessionClusterState(session.sessionId);
        }
        recordAuthSessionFailure("session_revoked");
        return { session: null, errorCode: "session_revoked" };
      }

      const activeBan = await resolveActiveBanForPlayer(store, session.playerId);
      if (activeBan) {
        recordAuthSessionFailure("account_banned");
        return { session: null, errorCode: "account_banned", ban: activeBan };
      }
      if (account?.guestMigratedToPlayerId) {
        if (session.sessionId) {
          await revokeGuestSessionClusterState(session.sessionId);
        }
        recordAuthSessionFailure("session_revoked");
        return { session: null, errorCode: "session_revoked" };
      }
      if (session.sessionId) {
        const touchedSession = await touchGuestSessionClusterState(session.sessionId, normalizedToken);
        if (!touchedSession) {
          recordAuthSessionFailure("session_revoked");
          return { session: null, errorCode: "session_revoked" };
        }
        return { session: touchedSession };
      }
      return { session };
    }

    if (!store) {
      return { session };
    }

    const activeBan = await resolveActiveBanForPlayer(store, session.playerId);
    if (activeBan) {
      recordAuthSessionFailure("account_banned");
      return { session: null, errorCode: "account_banned", ban: activeBan };
    }

    const authAccount = await store.loadPlayerAccountAuthByPlayerId(session.playerId);
    if (!authAccount) {
      if (session.sessionVersion != null) {
        recordAuthSessionFailure("session_revoked");
      }
      return session.sessionVersion == null ? { session } : { session: null, errorCode: "session_revoked" };
    }

    if (
      session.sessionVersion != null &&
      session.sessionVersion !== authAccount.accountSessionVersion
    ) {
      recordAuthSessionFailure("session_revoked");
      return { session: null, errorCode: "session_revoked" };
    }

    if (expectedKind === "refresh") {
      if (!session.sessionId) {
        recordAuthSessionFailure("session_revoked");
        return { session: null, errorCode: "session_revoked" };
      }
      const authDeviceSession = await store.loadPlayerAccountAuthSession(session.playerId, session.sessionId);
      if (!authDeviceSession) {
        recordAuthSessionFailure("session_revoked");
        return { session: null, errorCode: "session_revoked" };
      }
      if (isExpiredTimestamp(authDeviceSession.refreshTokenExpiresAt)) {
        recordAuthSessionFailure("token_expired");
        return { session: null, errorCode: "token_expired" };
      }
      if (!timingSafeCompareHexDigest(hashRefreshToken(normalizedToken), authDeviceSession.refreshTokenHash)) {
        recordAuthSessionFailure("session_revoked");
        return { session: null, errorCode: "session_revoked" };
      }
      await store.touchPlayerAccountAuthSession(session.playerId, session.sessionId, session.lastUsedAt);
      return {
        session: {
          ...session,
          refreshExpiresAt: authDeviceSession.refreshTokenExpiresAt
        }
      };
    }

    if (session.sessionId) {
      const authDeviceSession = await store.loadPlayerAccountAuthSession(session.playerId, session.sessionId);
      if (!authDeviceSession) {
        recordAuthSessionFailure("session_revoked");
        return { session: null, errorCode: "session_revoked" };
      }
      await store.touchPlayerAccountAuthSession(session.playerId, session.sessionId, session.lastUsedAt);
    }

    return {
      session: {
        ...session,
        sessionVersion: authAccount.accountSessionVersion
      }
    };
  } catch {
    recordAuthSessionFailure("unauthorized");
    return { session: null, errorCode: "unauthorized" };
  }
}

export async function validateGuestAuthToken(
  token: string,
  store: RoomSnapshotStore | null,
  expectedKind: "access" | "refresh" = "access"
): Promise<ValidateAuthSessionResult> {
  return validateAuthToken(token, store, expectedKind);
}

export async function validateAuthSessionFromRequest(
  request: Pick<IncomingMessage, "headers">,
  store: RoomSnapshotStore | null,
  expectedKind: "access" | "refresh" = "access"
): Promise<ValidateAuthSessionResult> {
  const token = readGuestAuthTokenFromRequest(request);
  if (!token) {
    recordAuthSessionCheck();
    recordAuthSessionFailure("unauthorized");
    return { session: null, errorCode: "unauthorized" };
  }

  return validateAuthToken(token, store, expectedKind);
}

async function createAccountSessionBundle(
  store: RoomSnapshotStore,
  input: {
    playerId: string;
    displayName: string;
    loginId: string;
    provider?: AuthProvider;
    refreshSessionId?: string;
    deviceLabel?: string;
  }
): Promise<GuestAuthSession> {
  const refreshSessionId = input.refreshSessionId ?? randomUUID();
  const existingAuth = await store.loadPlayerAccountAuthByPlayerId(input.playerId);
  if (!existingAuth) {
    throw new Error("account_auth_not_found");
  }
  const refreshSession = issueAccountRefreshSession({
    playerId: input.playerId,
    displayName: input.displayName,
    loginId: input.loginId,
    ...(input.provider ? { provider: input.provider } : {}),
    sessionId: refreshSessionId,
    sessionVersion: existingAuth.accountSessionVersion
  });
  await store.savePlayerAccountAuthSession(input.playerId, {
    refreshSessionId,
    refreshTokenHash: hashRefreshToken(refreshSession.token),
    refreshTokenExpiresAt: refreshSession.expiresAt,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.deviceLabel ? { deviceLabel: input.deviceLabel } : {}),
    lastUsedAt: refreshSession.issuedAt
  });
  upsertAuthAccountSession(input.playerId, refreshSessionId, input.provider ?? "account-password");
  const finalizedAuth = await store.loadPlayerAccountAuthByPlayerId(input.playerId);
  if (!finalizedAuth) {
    throw new Error("account_auth_not_found");
  }
  cacheAccountAuthState({
    playerId: finalizedAuth.playerId,
    accountSessionVersion: finalizedAuth.accountSessionVersion,
    ...(finalizedAuth.refreshSessionId ? { refreshSessionId: finalizedAuth.refreshSessionId } : {}),
    ...(finalizedAuth.refreshTokenHash ? { refreshTokenHash: finalizedAuth.refreshTokenHash } : {}),
    ...(finalizedAuth.refreshTokenExpiresAt ? { refreshTokenExpiresAt: finalizedAuth.refreshTokenExpiresAt } : {})
  });

  const finalizedAccess = issueAccountAccessSession({
    playerId: input.playerId,
    displayName: input.displayName,
    loginId: input.loginId,
    ...(input.provider ? { provider: input.provider } : {}),
    sessionId: refreshSessionId,
    sessionVersion: finalizedAuth.accountSessionVersion
  });

  return {
    ...finalizedAccess,
    refreshToken: refreshSession.token,
    refreshExpiresAt: refreshSession.expiresAt
  };
}

export function hashAccountPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyAccountPassword(password: string, passwordHash: string): boolean {
  const [algorithm, salt, expectedHash] = passwordHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHash) {
    return false;
  }

  const actualHash = scryptSync(password, salt, 64).toString("hex");
  const actualBuffer = Buffer.from(actualHash, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendStoreUnavailable(response: ServerResponse): void {
  sendJson(response, 503, {
    error: {
      code: "auth_persistence_unavailable",
      message: "Account auth requires configured room persistence storage"
    }
  });
}

function sendAccountTokenDeliveryFailure(
  response: ServerResponse,
  error: unknown,
  kind: "account-registration" | "password-recovery"
): void {
  if (error instanceof AccountTokenDeliveryConfigurationError) {
    recordAuthTokenDeliveryFailure("misconfigured");
    sendJson(response, 503, {
      error: {
        code: `${kind.replace(/-/g, "_")}_delivery_misconfigured`,
        message: error.message
      }
    });
    return;
  }

  if (error instanceof AccountTokenDeliveryError) {
    sendJson(response, 502, {
      error: {
        code: `${kind.replace(/-/g, "_")}_delivery_failed`,
        message: error.message
      }
    });
    return;
  }

  throw error;
}

function sendAuthFailure(
  response: ServerResponse,
  errorCode: ValidateAuthSessionResult["errorCode"],
  ban?: PlayerAccountBanSnapshot | null,
  fallbackMessage = "Guest auth session is missing or invalid"
): void {
  const code = errorCode ?? "unauthorized";
  if (code === "account_banned") {
    sendJson(response, 403, {
      error: {
        code,
        message: "Account is banned",
        reason: ban?.banReason ?? "No reason provided",
        ...(ban?.banExpiry ? { expiry: ban.banExpiry } : {})
      }
    });
    return;
  }

  const message =
    code === "token_expired"
      ? "Auth token has expired"
      : code === "token_kind_invalid"
        ? "Auth token kind is invalid for this route"
        : code === "session_revoked"
          ? "Auth session has been revoked"
          : fallbackMessage;
  sendJson(response, 401, {
    error: {
      code,
      message
    }
  });
}

function sendGuestPlayerIdReserved(response: ServerResponse): void {
  sendJson(response, 409, {
    error: {
      code: "guest_player_id_reserved",
      message: "Player ID is reserved for account login"
    }
  });
}

function resolveRequestIp(request: Pick<IncomingMessage, "headers" | "socket">): string {
  return resolveTrustedRequestIp(request);
}

function consumeSlidingWindowRateLimit(key: string, config = readAuthRuntimeConfig()): RateLimitResult {
  const currentTime = nowMs();
  const windowStart = currentTime - config.rateLimitWindowMs;
  const timestamps = (authRateLimitCounters.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  if (timestamps.length >= config.rateLimitMax) {
    authRateLimitCounters.set(key, timestamps);
    const oldestTimestamp = timestamps[0] ?? currentTime;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldestTimestamp + config.rateLimitWindowMs - currentTime) / 1000))
    };
  }

  timestamps.push(currentTime);
  authRateLimitCounters.set(key, timestamps);
  return { allowed: true };
}

async function consumeClusterRateLimit(
  redisClient: RedisClientLike,
  key: string,
  config = readAuthRuntimeConfig()
): Promise<RateLimitResult> {
  const result = (await redisClient.eval(
    AUTH_RATE_LIMIT_REDIS_SCRIPT,
    1,
    `${AUTH_RATE_LIMIT_CLUSTER_KEY_PREFIX}${key}`,
    String(config.rateLimitMax),
    String(config.rateLimitWindowMs)
  )) as [number, number] | null;
  const [allowedFlag, ttlMs] = Array.isArray(result) ? result : [1, config.rateLimitWindowMs];
  if (allowedFlag === 1) {
    return { allowed: true };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((ttlMs ?? config.rateLimitWindowMs) / 1000))
  };
}

async function consumeAuthRateLimit(key: string, config = readAuthRuntimeConfig()): Promise<RateLimitResult> {
  const redisClient = resolveGuestSessionClusterClient();
  if (!redisClient) {
    return consumeSlidingWindowRateLimit(key, config);
  }

  try {
    return await consumeClusterRateLimit(redisClient, key, config);
  } catch {
    return consumeSlidingWindowRateLimit(key, config);
  }
}

async function enforceAuthRateLimit(
  request: Pick<IncomingMessage, "headers" | "socket">,
  response: ServerResponse,
  endpointKey: string
): Promise<boolean> {
  const rateLimitResult = await consumeAuthRateLimit(`${endpointKey}:${resolveRequestIp(request)}`);
  if (rateLimitResult.allowed) {
    return true;
  }

  recordAuthRateLimited();
  response.setHeader("Retry-After", String(rateLimitResult.retryAfterSeconds ?? 1));
  sendJson(response, 429, {
    error: {
      code: "rate_limited",
      message: "Too many authentication attempts, please retry later"
    }
  });
  return false;
}

function pruneAccountLockoutSnapshot(
  state: AccountLockoutState,
  config = readAuthRuntimeConfig(),
  currentTime = nowMs()
): AccountLockoutState {
  const windowStart = currentTime - config.rateLimitWindowMs;
  return {
    failedAttempts: state.failedAttempts.filter((timestamp) => timestamp > windowStart),
    ...(state.lockedUntil && state.lockedUntil > currentTime ? { lockedUntil: state.lockedUntil } : {})
  };
}

function pruneAccountLockoutState(loginId: string, config = readAuthRuntimeConfig()): AccountLockoutState {
  const currentTime = nowMs();
  const existingState = accountLockoutStateByLoginId.get(loginId) ?? { failedAttempts: [] };
  const nextState = pruneAccountLockoutSnapshot(existingState, config, currentTime);

  if (nextState.failedAttempts.length === 0 && !nextState.lockedUntil) {
    accountLockoutStateByLoginId.delete(loginId);
    syncAuthStateTelemetry();
    return nextState;
  }

  accountLockoutStateByLoginId.set(loginId, nextState);
  syncAuthStateTelemetry();
  return nextState;
}

function buildAccountLockoutClusterKey(loginId: string): string {
  return `${ACCOUNT_LOCKOUT_CLUSTER_KEY_PREFIX}${loginId}`;
}

function getAccountLockoutTtlMs(state: AccountLockoutState, config = readAuthRuntimeConfig()): number {
  const lockoutTtlMs = state.lockedUntil ? state.lockedUntil - nowMs() : 0;
  return Math.max(1, config.rateLimitWindowMs, lockoutTtlMs);
}

async function loadAccountLockoutState(loginId: string, config = readAuthRuntimeConfig()): Promise<AccountLockoutState> {
  const redisClient = resolveGuestSessionClusterClient();
  if (!redisClient) {
    return pruneAccountLockoutState(loginId, config);
  }

  try {
    const serialized = await redisClient.get(buildAccountLockoutClusterKey(loginId));
    if (!serialized) {
      return { failedAttempts: [] };
    }
    const parsed = JSON.parse(serialized) as AccountLockoutState;
    const nextState = pruneAccountLockoutSnapshot(
      {
        failedAttempts: Array.isArray(parsed.failedAttempts) ? parsed.failedAttempts : [],
        ...(typeof parsed.lockedUntil === "number" ? { lockedUntil: parsed.lockedUntil } : {})
      },
      config
    );
    if (nextState.failedAttempts.length === 0 && !nextState.lockedUntil) {
      await redisClient.del(buildAccountLockoutClusterKey(loginId));
    }
    return nextState;
  } catch {
    return pruneAccountLockoutState(loginId, config);
  }
}

async function saveAccountLockoutState(
  loginId: string,
  state: AccountLockoutState,
  config = readAuthRuntimeConfig()
): Promise<void> {
  const redisClient = resolveGuestSessionClusterClient();
  if (!redisClient) {
    if (state.failedAttempts.length === 0 && !state.lockedUntil) {
      accountLockoutStateByLoginId.delete(loginId);
    } else {
      accountLockoutStateByLoginId.set(loginId, state);
    }
    syncAuthStateTelemetry();
    return;
  }

  try {
    if (state.failedAttempts.length === 0 && !state.lockedUntil) {
      await redisClient.del(buildAccountLockoutClusterKey(loginId));
      return;
    }
    await redisClient.set(
      buildAccountLockoutClusterKey(loginId),
      JSON.stringify(state),
      "PX",
      getAccountLockoutTtlMs(state, config)
    );
  } catch {
    accountLockoutStateByLoginId.set(loginId, state);
    syncAuthStateTelemetry();
  }
}

async function getAccountLockedUntil(loginId: string): Promise<number | null> {
  return (await loadAccountLockoutState(loginId)).lockedUntil ?? null;
}

async function recordAccountLoginFailure(loginId: string, config = readAuthRuntimeConfig()): Promise<number | null> {
  const currentTime = nowMs();
  const nextState = await loadAccountLockoutState(loginId, config);
  nextState.failedAttempts.push(currentTime);
  if (nextState.failedAttempts.length > config.lockoutThreshold) {
    nextState.lockedUntil = currentTime + config.lockoutDurationMs;
  }
  await saveAccountLockoutState(loginId, nextState, config);
  return nextState.lockedUntil ?? null;
}

async function clearAccountLoginFailures(loginId: string): Promise<void> {
  const redisClient = resolveGuestSessionClusterClient();
  if (redisClient) {
    try {
      await redisClient.del(buildAccountLockoutClusterKey(loginId));
    } catch {
      accountLockoutStateByLoginId.delete(loginId);
      syncAuthStateTelemetry();
    }
    return;
  }
  accountLockoutStateByLoginId.delete(loginId);
  syncAuthStateTelemetry();
}

function pruneCredentialStuffingSnapshot(
  state: CredentialStuffingState,
  config = readAuthRuntimeConfig(),
  currentTime = nowMs()
): CredentialStuffingState {
  const windowStart = currentTime - config.credentialStuffingWindowMs;
  return {
    failedAttempts: state.failedAttempts.filter((attempt) => attempt.at > windowStart),
    ...(state.blockedUntil && state.blockedUntil > currentTime
      ? { blockedUntil: state.blockedUntil }
      : {})
  };
}

function saveLocalCredentialStuffingState(ip: string, nextState: CredentialStuffingState): void {
  if (nextState.failedAttempts.length === 0 && !nextState.blockedUntil) {
    credentialStuffingStateByIp.delete(ip);
  } else {
    credentialStuffingStateByIp.set(ip, nextState);
  }
  syncAuthStateTelemetry();
}

function pruneCredentialStuffingState(ip: string, config = readAuthRuntimeConfig()): CredentialStuffingState {
  const existingState = credentialStuffingStateByIp.get(ip) ?? { failedAttempts: [] };
  const nextState = pruneCredentialStuffingSnapshot(existingState, config);
  saveLocalCredentialStuffingState(ip, nextState);
  return nextState;
}

function buildCredentialStuffingClusterKey(ip: string): string {
  return `${CREDENTIAL_STUFFING_CLUSTER_KEY_PREFIX}${ip}`;
}

function getCredentialStuffingTtlMs(state: CredentialStuffingState, config = readAuthRuntimeConfig()): number {
  const blockedTtlMs = state.blockedUntil ? state.blockedUntil - nowMs() : 0;
  return Math.max(1, config.credentialStuffingWindowMs, blockedTtlMs);
}

function normalizeCredentialStuffingState(input: unknown): CredentialStuffingState {
  if (!input || typeof input !== "object") {
    return { failedAttempts: [] };
  }
  const candidate = input as {
    failedAttempts?: Array<{ at?: unknown; loginId?: unknown }>;
    blockedUntil?: unknown;
  };
  return {
    failedAttempts: Array.isArray(candidate.failedAttempts)
      ? candidate.failedAttempts
          .filter(
            (attempt): attempt is { at: number; loginId: string } =>
              typeof attempt.at === "number" &&
              Number.isFinite(attempt.at) &&
              typeof attempt.loginId === "string" &&
              attempt.loginId.length > 0
          )
          .map((attempt) => ({ at: attempt.at, loginId: attempt.loginId }))
      : [],
    ...(typeof candidate.blockedUntil === "number" && Number.isFinite(candidate.blockedUntil)
      ? { blockedUntil: candidate.blockedUntil }
      : {})
  };
}

async function loadCredentialStuffingState(
  ip: string,
  config = readAuthRuntimeConfig()
): Promise<CredentialStuffingState> {
  const redisClient = resolveGuestSessionClusterClient();
  if (!redisClient) {
    return pruneCredentialStuffingState(ip, config);
  }

  try {
    const serialized = await redisClient.get(buildCredentialStuffingClusterKey(ip));
    if (!serialized) {
      return { failedAttempts: [] };
    }
    const nextState = pruneCredentialStuffingSnapshot(normalizeCredentialStuffingState(JSON.parse(serialized)), config);
    if (nextState.failedAttempts.length === 0 && !nextState.blockedUntil) {
      await redisClient.del(buildCredentialStuffingClusterKey(ip));
    }
    return nextState;
  } catch {
    return pruneCredentialStuffingState(ip, config);
  }
}

async function saveCredentialStuffingState(
  ip: string,
  state: CredentialStuffingState,
  config = readAuthRuntimeConfig()
): Promise<void> {
  const redisClient = resolveGuestSessionClusterClient();
  if (!redisClient) {
    saveLocalCredentialStuffingState(ip, state);
    return;
  }

  try {
    if (state.failedAttempts.length === 0 && !state.blockedUntil) {
      await redisClient.del(buildCredentialStuffingClusterKey(ip));
      return;
    }
    await redisClient.set(
      buildCredentialStuffingClusterKey(ip),
      JSON.stringify(state),
      "PX",
      getCredentialStuffingTtlMs(state, config)
    );
  } catch {
    saveLocalCredentialStuffingState(ip, state);
  }
}

async function getCredentialStuffingBlockedUntil(ip: string): Promise<number | null> {
  return (await loadCredentialStuffingState(ip)).blockedUntil ?? null;
}

async function recordCredentialStuffingFailure(
  ip: string,
  loginId: string,
  config = readAuthRuntimeConfig()
): Promise<number | null> {
  const currentTime = nowMs();
  const nextState = await loadCredentialStuffingState(ip, config);
  nextState.failedAttempts.push({
    at: currentTime,
    loginId
  });
  const distinctLoginIdCount = new Set(nextState.failedAttempts.map((attempt) => attempt.loginId)).size;
  if (distinctLoginIdCount > config.credentialStuffingDistinctLoginIdThreshold) {
    nextState.blockedUntil = Math.max(
      nextState.blockedUntil ?? 0,
      currentTime + config.credentialStuffingBlockDurationMs
    );
  }
  await saveCredentialStuffingState(ip, nextState, config);
  return nextState.blockedUntil ?? null;
}

function sendAccountLocked(response: ServerResponse, lockedUntilMs: number): void {
  const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntilMs - nowMs()) / 1000));
  response.setHeader("Retry-After", String(retryAfterSeconds));
  sendJson(response, 403, {
    error: {
      code: "account_locked",
      message: "Account login is temporarily locked",
      lockedUntil: new Date(lockedUntilMs).toISOString()
    }
  });
}

function sendCredentialStuffingBlocked(response: ServerResponse, blockedUntilMs: number): void {
  const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntilMs - nowMs()) / 1000));
  recordAuthRateLimited();
  recordAuthCredentialStuffingBlocked();
  response.setHeader("Retry-After", String(retryAfterSeconds));
  sendJson(response, 429, {
    error: {
      code: "credential_stuffing_blocked",
      message: "Too many failed login attempts across multiple accounts from this source",
      blockedUntil: new Date(blockedUntilMs).toISOString()
    }
  });
}

function registerGuestSession(session: GuestAuthSession, config = readAuthRuntimeConfig()): void {
  if (session.authMode !== "guest" || !session.sessionId) {
    return;
  }

  while (guestSessionsById.size >= config.maxGuestSessions) {
    const oldestSessionId = guestSessionsById.keys().next().value;
    if (!oldestSessionId) {
      break;
    }
    guestSessionsById.delete(oldestSessionId);
  }

  guestSessionsById.set(session.sessionId, storeGuestSessionTokenHash(session));
  syncAuthStateTelemetry();
  void persistGuestSessionClusterState(session, config).catch(() => undefined);
}

function touchGuestSession(sessionId: string, token: string): GuestAuthSession | null {
  const existingSession = guestSessionsById.get(sessionId);
  if (!existingSession || !validateStoredGuestSessionToken(existingSession, token)) {
    return null;
  }

  const nextSession: StoredGuestAuthSession = {
    ...existingSession,
    lastUsedAt: new Date().toISOString()
  };
  guestSessionsById.delete(sessionId);
  guestSessionsById.set(sessionId, nextSession);
  return hydrateGuestSession(nextSession, token);
}

export function revokeGuestAuthSession(sessionId: string): boolean {
  const revoked = guestSessionsById.delete(sessionId);
  void revokeGuestSessionClusterState(sessionId).catch(() => undefined);
  syncAuthStateTelemetry();
  return revoked;
}

export function resetGuestAuthSessions(): void {
  authRateLimitCounters.clear();
  accountLockoutStateByLoginId.clear();
  credentialStuffingStateByIp.clear();
  guestSessionsById.clear();
  accountAuthStateByPlayerId.clear();
  accountRegistrationStateByLoginId.clear();
  passwordRecoveryStateByLoginId.clear();
  lastGuestSessionClusterOrderScore = 0;
  guestSessionClusterClientOverride = undefined;
  guestSessionClusterClientCache = undefined;
  void resetWechatSessionKeyCache();
  syncAuthStateTelemetry();
}

export function setGuestSessionClusterClientForTest(client: RedisClientLike | null | undefined): void {
  guestSessionClusterClientOverride = client;
  guestSessionClusterClientCache = undefined;
}

export const __authRateLimitInternals = {
  consumeAuthRateLimit,
  consumeSlidingWindowRateLimit,
  AUTH_RATE_LIMIT_REDIS_SCRIPT
};

export function registerAuthRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null
): void {
  const accountRegistrationDeliveryMode = readAccountRegistrationDeliveryMode();
  const passwordRecoveryDeliveryMode = readPasswordRecoveryDeliveryMode();

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/auth/session", async (request, response) => {
    try {
      const { session: authSession, errorCode, ban } = await validateAuthSessionFromRequest(request, store);
      if (!authSession) {
        sendAuthFailure(response, errorCode, ban);
        return;
      }

      let nextSession = authSession;
      if (store) {
        const account = await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        });
        nextSession = issueNextAuthSession(
          {
            playerId: account.playerId,
            displayName: account.displayName,
            ...(account.loginId ? { loginId: account.loginId } : {}),
            ...(account.refreshSessionId ? { sessionId: account.refreshSessionId } : {}),
            ...(account.accountSessionVersion != null ? { sessionVersion: account.accountSessionVersion } : {})
          },
          authSession
        );
      }

      sendJson(response, 200, {
        session: await finalizeGuestSessionForResponse(nextSession)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/refresh", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    try {
      const { session: refreshSession, errorCode, ban } = await validateAuthSessionFromRequest(request, store, "refresh");
      if (!refreshSession || refreshSession.authMode !== "account" || !refreshSession.loginId) {
        sendAuthFailure(response, errorCode, ban, "Refresh token is missing or invalid");
        return;
      }

      const account = await store.ensurePlayerAccount({
        playerId: refreshSession.playerId,
        displayName: refreshSession.displayName
      });
      const session = await createAccountSessionBundle(store, {
        playerId: account.playerId,
        displayName: account.displayName,
        loginId: refreshSession.loginId,
        provider: refreshSession.provider,
        ...(refreshSession.sessionId ? { refreshSessionId: refreshSession.sessionId } : {}),
        deviceLabel: resolveDeviceLabel(request)
      });
      recordAuthRefresh();
      sendJson(response, 200, { session });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/wechat-session-key/refresh", async (request, response) => {
    try {
      const { session: authSession, errorCode, ban } = await validateAuthSessionFromRequest(request, store);
      if (!authSession) {
        sendAuthFailure(response, errorCode, ban);
        return;
      }

      const body = (await readJsonBody(request)) as {
        code?: string | null;
      };
      if (body.code !== undefined && body.code !== null && typeof body.code !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: code"
          }
        });
        return;
      }

      const identity = await exchangeWechatMiniGameCode(normalizeWechatMiniGameCode(body.code), readWechatMiniGameLoginConfig());
      if (store) {
        const boundAccount = await store.loadPlayerAccountByWechatMiniGameOpenId(identity.openId);
        if (boundAccount && boundAccount.playerId !== authSession.playerId) {
          sendJson(response, 409, {
            error: {
              code: "wechat_identity_already_bound",
              message: "This WeChat identity is already bound to another account"
            }
          });
          return;
        }
      }

      const cached = await cacheWechatSessionKey(authSession.playerId, identity.sessionKey, readWechatSessionKeyTtlSeconds());
      sendJson(response, 200, {
        ok: true,
        playerId: authSession.playerId,
        refreshedAt: new Date().toISOString(),
        expiresAt: cached.expiresAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "wechat_session_key_refresh_failed";
      if (message === "wechat_login_not_enabled") {
        sendJson(response, 501, {
          error: {
            code: "wechat_login_not_enabled",
            message: "WeChat login exchange exists, but code2Session is not configured"
          }
        });
        return;
      }

      if (message === "invalid_wechat_code") {
        sendJson(response, 401, {
          error: {
            code: "invalid_wechat_code",
            message: "WeChat code is invalid or expired"
          }
        });
        return;
      }

      sendJson(response, 502, {
        error: {
          code: "wechat_code2session_failed",
          message
        }
      });
    }
  });

  app.post("/api/auth/logout", async (request, response) => {
    try {
      const { session: authSession, errorCode, ban } = await validateAuthSessionFromRequest(request, store);
      if (!authSession) {
        sendAuthFailure(response, errorCode, ban);
        return;
      }

      if (authSession.authMode === "account" && store) {
        const revokedAuth = await store.revokePlayerAccountAuthSessions(authSession.playerId);
        if (revokedAuth) {
          cacheAccountAuthState({
            playerId: revokedAuth.playerId,
            accountSessionVersion: revokedAuth.accountSessionVersion
          });
        }
        removeAuthAccountSessionsForPlayer(authSession.playerId);
      } else if (authSession.authMode === "guest" && authSession.sessionId) {
        guestSessionsById.delete(authSession.sessionId);
        syncAuthStateTelemetry();
      }

      recordAuthLogout();
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/guest-login", async (request, response) => {
    if (!(await enforceAuthRateLimit(request, response, "guest-login"))) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        displayName?: string | null;
        privacyConsentAccepted?: boolean | null;
      };

      if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: displayName"
          }
        });
        return;
      }

      if (body.privacyConsentAccepted !== undefined && body.privacyConsentAccepted !== null && typeof body.privacyConsentAccepted !== "boolean") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional boolean field: privacyConsentAccepted"
          }
        });
        return;
      }

      let playerId = createGuestPlayerId();
      let displayName = normalizeDisplayName(playerId, body.displayName);
      if (await sendMaintenanceModeIfBlocked(response, { playerId })) {
        return;
      }
      const existingAccount = store ? await store.loadPlayerAccount(playerId) : null;
      const loginIdOwner = store ? await store.loadPlayerAccountByLoginId(playerId) : null;
      if (
        isGuestPlayerIdReserved({
          playerId,
          account: existingAccount,
          loginIdOwner
        })
      ) {
        sendGuestPlayerIdReserved(response);
        return;
      }
      await assertDisplayNameAvailableOrThrow(store, displayName, playerId);

      if (store) {
        if (existingAccount?.guestMigratedToPlayerId) {
          sendJson(response, 409, {
            error: {
              code: "guest_account_migrated",
              message: `Guest account has already been migrated to ${existingAccount.guestMigratedToPlayerId}`
            }
          });
          return;
        }
        let account = await store.ensurePlayerAccount({
          playerId,
          displayName
        });
        const consentedAccount = await ensurePlayerPrivacyConsent(response, store, account, body.privacyConsentAccepted);
        if (!consentedAccount) {
          return;
        }
        account = consentedAccount;
        const activeBan = await resolveActiveBanForPlayer(store, account.playerId);
        if (activeBan) {
          sendAuthFailure(response, "account_banned", activeBan);
          return;
        }
        playerId = account.playerId;
        displayName = account.displayName;
        const dailyLoginReward = await issueDailyLoginReward(store, account);
        const session = issueGuestAuthSession({
          playerId,
          displayName
        });
        sendJson(response, 200, {
          session: await finalizeGuestSessionForResponse(session),
          ...(dailyLoginReward.claimed
            ? {
                dailyLoginReward: {
                  streak: dailyLoginReward.streak,
                  reward: dailyLoginReward.reward
                }
              }
            : {})
        });
        recordAuthGuestLogin();
        return;
      }

      const session = issueGuestAuthSession({
        playerId,
        displayName
      });
      sendJson(response, 200, {
        session: await finalizeGuestSessionForResponse(session)
      });
      recordAuthGuestLogin();
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  for (const routePath of ["/api/auth/wechat-login", "/api/auth/wechat-mini-game-login"]) {
    app.post(routePath, async (request, response) => {
      try {
        await handleWechatLogin(request, response, store);
      } catch (error) {
        sendJson(response, 400, { error: toErrorPayload(error) });
      }
    });
  }

  app.post("/api/auth/account-login", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    if (!(await enforceAuthRateLimit(request, response, "account-login"))) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        loginId?: string | null;
        password?: string | null;
        privacyConsentAccepted?: boolean | null;
      };

      if (body.loginId !== undefined && body.loginId !== null && typeof body.loginId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: loginId"
          }
        });
        return;
      }

      if (body.password !== undefined && body.password !== null && typeof body.password !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: password"
          }
        });
        return;
      }

      if (body.privacyConsentAccepted !== undefined && body.privacyConsentAccepted !== null && typeof body.privacyConsentAccepted !== "boolean") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional boolean field: privacyConsentAccepted"
          }
        });
        return;
      }

      const loginId = normalizeAccountLoginId(body.loginId);
      const password = normalizeAccountLoginPassword(body.password);
      if (await sendMaintenanceModeIfBlocked(response, { loginId })) {
        return;
      }
      const requestIp = resolveRequestIp(request);

      const sourceBlockedUntil = await getCredentialStuffingBlockedUntil(requestIp);
      if (sourceBlockedUntil) {
        sendCredentialStuffingBlocked(response, sourceBlockedUntil);
        return;
      }

      const lockedUntil = await getAccountLockedUntil(loginId);
      if (lockedUntil) {
        sendAccountLocked(response, lockedUntil);
        return;
      }

      const authAccount = await store.loadPlayerAccountAuthByLoginId(loginId);
      if (!authAccount || !verifyAccountPassword(password, authAccount.passwordHash)) {
        recordAuthInvalidCredentials();
        const credentialStuffingBlockedUntil = await recordCredentialStuffingFailure(requestIp, loginId);
        const nextLockedUntil = await recordAccountLoginFailure(loginId);
        if (credentialStuffingBlockedUntil) {
          sendCredentialStuffingBlocked(response, credentialStuffingBlockedUntil);
        } else if (nextLockedUntil) {
          sendAccountLocked(response, nextLockedUntil);
        } else {
          sendJson(response, 401, {
            error: {
              code: "invalid_credentials",
              message: "Login ID or password is incorrect"
            }
          });
        }
        return;
      }

      await clearAccountLoginFailures(loginId);
      let account = await store.ensurePlayerAccount({
        playerId: authAccount.playerId,
        displayName: authAccount.displayName
      });
      const consentedAccount = await ensurePlayerPrivacyConsent(response, store, account, body.privacyConsentAccepted);
      if (!consentedAccount) {
        return;
      }
      account = consentedAccount;
      const activeBan = await resolveActiveBanForPlayer(store, account.playerId);
      if (activeBan) {
        sendAuthFailure(response, "account_banned", activeBan);
        return;
      }
      const dailyLoginReward = await issueDailyLoginReward(store, account);
      sendJson(response, 200, {
        account: dailyLoginReward.account,
        session: await createAccountSessionBundle(store, {
          playerId: account.playerId,
          displayName: account.displayName,
          loginId,
          deviceLabel: resolveDeviceLabel(request)
        }),
        ...(dailyLoginReward.claimed
          ? {
              dailyLoginReward: {
                streak: dailyLoginReward.streak,
                reward: dailyLoginReward.reward
              }
            }
          : {})
      });
      recordAuthAccountLogin();
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/account-registration/request", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    if (!(await enforceAuthRateLimit(request, response, "account-registration-request"))) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        loginId?: string | null;
        displayName?: string | null;
      };

      if (body.loginId !== undefined && body.loginId !== null && typeof body.loginId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: loginId"
          }
        });
        return;
      }

      if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: displayName"
          }
        });
        return;
      }

      const loginId = normalizeAccountLoginId(body.loginId);
      if (await sendMaintenanceModeIfBlocked(response, { loginId })) {
        return;
      }
      const existingAuthAccount = await store.loadPlayerAccountAuthByLoginId(loginId);
      if (existingAuthAccount) {
        sendJson(response, 409, {
          error: {
            code: "login_id_taken",
            message: "Login ID is already registered"
          }
        });
        return;
      }

      const requestedDisplayName = normalizeRequestedRegistrationDisplayName(loginId, body.displayName);
      await assertDisplayNameAvailableOrThrow(store, requestedDisplayName);
      const existingRegistrationState = await getAccountRegistrationState(loginId);
      const registrationState =
        existingRegistrationState?.requestedDisplayName === requestedDisplayName
          ? existingRegistrationState
          : await storeAccountRegistrationState(loginId, requestedDisplayName, createAccountRegistrationToken());

      try {
        const delivery = await deliverAccountToken(accountRegistrationDeliveryMode, {
          kind: "account-registration",
          loginId,
          token: registrationState.deliveryToken,
          expiresAt: registrationState.expiresAt,
          requestedDisplayName
        });

        sendJson(response, 202, {
          status: "registration_requested",
          expiresAt: registrationState.expiresAt,
          deliveryStatus: delivery.deliveryStatus,
          ...(delivery.attemptCount != null ? { deliveryAttemptCount: delivery.attemptCount } : {}),
          ...(delivery.maxAttempts != null ? { deliveryMaxAttempts: delivery.maxAttempts } : {}),
          ...(delivery.nextAttemptAt ? { deliveryNextAttemptAt: delivery.nextAttemptAt } : {}),
          ...(delivery.responseToken ? { registrationToken: delivery.responseToken } : {})
        });
      } catch (error) {
        sendAccountTokenDeliveryFailure(response, error, "account-registration");
      }
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/account-registration/confirm", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    if (!(await enforceAuthRateLimit(request, response, "account-registration-confirm"))) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        loginId?: string | null;
        registrationToken?: string | null;
        password?: string | null;
        privacyConsentAccepted?: boolean | null;
      };

      if (body.loginId !== undefined && body.loginId !== null && typeof body.loginId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: loginId"
          }
        });
        return;
      }

      if (body.registrationToken !== undefined && body.registrationToken !== null && typeof body.registrationToken !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: registrationToken"
          }
        });
        return;
      }

      if (body.password !== undefined && body.password !== null && typeof body.password !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: password"
          }
        });
        return;
      }

      if (body.privacyConsentAccepted !== undefined && body.privacyConsentAccepted !== null && typeof body.privacyConsentAccepted !== "boolean") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional boolean field: privacyConsentAccepted"
          }
        });
        return;
      }

      const loginId = normalizeAccountLoginId(body.loginId);
      const registrationToken = normalizeAccountRegistrationToken(body.registrationToken);
      const password = normalizeAccountPassword(body.password);
      if (await sendMaintenanceModeIfBlocked(response, { loginId })) {
        return;
      }
      if (body.privacyConsentAccepted !== true) {
        sendPrivacyConsentRequired(response);
        return;
      }
      const pendingRegistrationState = await getAccountRegistrationState(loginId);
      if (!pendingRegistrationState) {
        sendJson(response, 401, {
          error: {
            code: "invalid_registration_token",
            message: "Registration token is invalid or expired"
          }
        });
        return;
      }

      const registrationState = await consumeAccountRegistrationState(loginId, registrationToken);
      if (!registrationState) {
        sendJson(response, 401, {
          error: {
            code: "invalid_registration_token",
            message: "Registration token is invalid or expired"
          }
        });
        return;
      }

      const existingAuthAccount = await store.loadPlayerAccountAuthByLoginId(loginId);
      if (existingAuthAccount) {
        sendJson(response, 409, {
          error: {
            code: "login_id_taken",
            message: "Login ID is already registered"
          }
        });
        return;
      }

      const playerId = createFormalAccountPlayerId();
      const createdAccount = await store.ensurePlayerAccount({
        playerId,
        displayName: registrationState.requestedDisplayName
      });
      const account = await store.bindPlayerAccountCredentials(createdAccount.playerId, {
        loginId,
        passwordHash: hashAccountPassword(password)
      });
      await appendAccountAuditLog(store, account.playerId, `发起正式注册申请，预留登录 ID ${loginId}。`, registrationState.issuedAt);
      await appendAccountAuditLog(store, account.playerId, "完成正式账号注册，并签发首个账号会话。");

      sendJson(response, 200, {
        account: (await store.loadPlayerAccount(account.playerId)) ?? account,
        session: await createAccountSessionBundle(store, {
          playerId: account.playerId,
          displayName: account.displayName,
          loginId,
          deviceLabel: resolveDeviceLabel(request)
        })
      });
      recordAuthAccountRegistration();
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/password-recovery/request", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    if (!(await enforceAuthRateLimit(request, response, "password-recovery-request"))) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        loginId?: string | null;
      };

      if (body.loginId !== undefined && body.loginId !== null && typeof body.loginId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: loginId"
          }
        });
        return;
      }

      const loginId = normalizeAccountLoginId(body.loginId);
      if (await sendMaintenanceModeIfBlocked(response, { loginId })) {
        return;
      }
      const authAccount = await store.loadPlayerAccountAuthByLoginId(loginId);
      if (!authAccount) {
        sendJson(response, 202, {
          status: "recovery_requested"
        });
        return;
      }

      let recoveryState = await getPasswordRecoveryState(loginId);
      if (!recoveryState || recoveryState.playerId !== authAccount.playerId) {
        recoveryState = await storePasswordRecoveryState(authAccount.playerId, loginId, createPasswordRecoveryToken());
        await appendAccountAuditLog(
          store,
          authAccount.playerId,
          passwordRecoveryDeliveryMode === "dev-token" ? "发起密码找回申请，已生成开发态重置令牌。" : "发起密码找回申请。"
        );
      }

      try {
        const delivery = await deliverAccountToken(passwordRecoveryDeliveryMode, {
          kind: "password-recovery",
          loginId,
          playerId: authAccount.playerId,
          token: recoveryState.deliveryToken,
          expiresAt: recoveryState.expiresAt
        });

        sendJson(response, 202, {
          status: "recovery_requested",
          expiresAt: recoveryState.expiresAt,
          deliveryStatus: delivery.deliveryStatus,
          ...(delivery.attemptCount != null ? { deliveryAttemptCount: delivery.attemptCount } : {}),
          ...(delivery.maxAttempts != null ? { deliveryMaxAttempts: delivery.maxAttempts } : {}),
          ...(delivery.nextAttemptAt ? { deliveryNextAttemptAt: delivery.nextAttemptAt } : {}),
          ...(delivery.responseToken ? { recoveryToken: delivery.responseToken } : {})
        });
      } catch (error) {
        sendAccountTokenDeliveryFailure(response, error, "password-recovery");
      }
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/password-recovery/confirm", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    if (!(await enforceAuthRateLimit(request, response, "password-recovery-confirm"))) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        loginId?: string | null;
        recoveryToken?: string | null;
        newPassword?: string | null;
      };

      if (body.loginId !== undefined && body.loginId !== null && typeof body.loginId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: loginId"
          }
        });
        return;
      }

      if (body.recoveryToken !== undefined && body.recoveryToken !== null && typeof body.recoveryToken !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: recoveryToken"
          }
        });
        return;
      }

      if (body.newPassword !== undefined && body.newPassword !== null && typeof body.newPassword !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: newPassword"
          }
        });
        return;
      }

      const loginId = normalizeAccountLoginId(body.loginId);
      const recoveryToken = normalizePasswordRecoveryToken(body.recoveryToken);
      const newPassword = normalizeAccountPassword(body.newPassword);
      if (await sendMaintenanceModeIfBlocked(response, { loginId })) {
        return;
      }
      const pendingRecoveryState = await getPasswordRecoveryState(loginId);
      if (!pendingRecoveryState) {
        sendJson(response, 401, {
          error: {
            code: "invalid_recovery_token",
            message: "Password recovery token is invalid or expired"
          }
        });
        return;
      }

      const recoveryState = await consumePasswordRecoveryState(loginId, recoveryToken);
      if (!recoveryState) {
        sendJson(response, 401, {
          error: {
            code: "invalid_recovery_token",
            message: "Password recovery token is invalid or expired"
          }
        });
        return;
      }

      const authAccount = await store.loadPlayerAccountAuthByLoginId(loginId);
      if (!authAccount || authAccount.playerId !== recoveryState.playerId) {
        sendJson(response, 401, {
          error: {
            code: "invalid_recovery_token",
            message: "Password recovery token is invalid or expired"
          }
        });
        return;
      }

      const credentialBoundAt = new Date().toISOString();
      const revokedAuth = await store.revokePlayerAccountAuthSessions(authAccount.playerId, {
        passwordHash: hashAccountPassword(newPassword),
        credentialBoundAt
      });
      if (revokedAuth) {
        cacheAccountAuthState({
          playerId: revokedAuth.playerId,
          accountSessionVersion: revokedAuth.accountSessionVersion
        });
      }
      removeAuthAccountSessionsForPlayer(authAccount.playerId);
      await clearAccountLoginFailures(loginId);
      await appendAccountAuditLog(store, authAccount.playerId, "通过密码找回流程重置口令，并撤销旧会话。", credentialBoundAt);
      const account =
        (await store.loadPlayerAccount(authAccount.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authAccount.playerId,
          displayName: authAccount.displayName
        }));

      sendJson(response, 200, {
        account
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/account-bind", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    if (!(await enforceAuthRateLimit(request, response, "account-bind"))) {
      return;
    }

    try {
      const { session: authSession, errorCode, ban } = await validateAuthSessionFromRequest(request, store);
      if (!authSession) {
        sendAuthFailure(response, errorCode, ban);
        return;
      }

      const body = (await readJsonBody(request)) as {
        loginId?: string | null;
        password?: string | null;
        privacyConsentAccepted?: boolean | null;
      };

      if (body.loginId !== undefined && body.loginId !== null && typeof body.loginId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: loginId"
          }
        });
        return;
      }

      if (body.password !== undefined && body.password !== null && typeof body.password !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: password"
          }
        });
        return;
      }

      if (body.privacyConsentAccepted !== undefined && body.privacyConsentAccepted !== null && typeof body.privacyConsentAccepted !== "boolean") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional boolean field: privacyConsentAccepted"
          }
        });
        return;
      }

      const loginId = normalizeAccountLoginId(body.loginId);
      const password = normalizeAccountPassword(body.password);
      const existingAccount = await store.ensurePlayerAccount({
        playerId: authSession.playerId,
        displayName: authSession.displayName
      });
      const consentedAccount = await ensurePlayerPrivacyConsent(response, store, existingAccount, body.privacyConsentAccepted);
      if (!consentedAccount) {
        return;
      }
      const account = await store.bindPlayerAccountCredentials(authSession.playerId, {
        loginId,
        passwordHash: hashAccountPassword(password)
      });
      const accountPortalCopyExperiment = resolveFeatureEntitlementsForPlayer(account.playerId).experiments.find(
        (experiment) => experiment.experimentKey === "account_portal_copy" && experiment.assigned
      );

      if (accountPortalCopyExperiment) {
        emitAnalyticsEvent("experiment_conversion", {
          playerId: account.playerId,
          roomId: account.lastRoomId ?? "account-bind",
          payload: {
            experimentKey: accountPortalCopyExperiment.experimentKey,
            experimentName: accountPortalCopyExperiment.experimentName,
            variant: accountPortalCopyExperiment.variant,
            bucket: accountPortalCopyExperiment.bucket,
            conversion: "account_bound",
            owner: accountPortalCopyExperiment.owner
          }
        });
      }

      sendJson(response, 200, {
        account,
        session: await createAccountSessionBundle(store, {
          playerId: account.playerId,
          displayName: account.displayName,
          loginId,
          deviceLabel: resolveDeviceLabel(request)
        })
      });
      recordAuthAccountBinding();
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });
}
