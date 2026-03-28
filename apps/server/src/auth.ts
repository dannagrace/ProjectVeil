import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSnapshotStore } from "./persistence";

export type AuthMode = "guest" | "account";
export type AuthProvider = "guest" | "account-password" | "wechat-mini-game";

export interface GuestAuthSession {
  token: string;
  playerId: string;
  displayName: string;
  authMode: AuthMode;
  provider: AuthProvider;
  loginId?: string;
  sessionId?: string;
  issuedAt: string;
  lastUsedAt: string;
}

interface GuestAuthTokenPayload {
  playerId: string;
  displayName: string;
  authMode?: AuthMode;
  provider?: AuthProvider;
  loginId?: string;
  sessionId?: string;
  issuedAt: string;
}

interface AuthRuntimeConfig {
  rateLimitWindowMs: number;
  rateLimitMax: number;
  lockoutThreshold: number;
  lockoutDurationMs: number;
  maxGuestSessions: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface AccountLockoutState {
  failedAttempts: number[];
  lockedUntil?: number;
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
}

const AUTH_SECRET = process.env.VEIL_AUTH_SECRET?.trim() || "project-veil-dev-secret";
const MIN_ACCOUNT_PASSWORD_LENGTH = 6;
const DEFAULT_RATE_LIMIT_AUTH_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_AUTH_MAX = 10;
const DEFAULT_AUTH_LOCKOUT_THRESHOLD = 10;
const DEFAULT_AUTH_LOCKOUT_DURATION_MINUTES = 15;
const DEFAULT_MAX_GUEST_SESSIONS = 10_000;

const authRateLimitCounters = new Map<string, number[]>();
const accountLockoutStateByLoginId = new Map<string, AccountLockoutState>();
const guestSessionsById = new Map<string, GuestAuthSession>();

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
    maxGuestSessions: parseEnvNumber(env.VEIL_MAX_GUEST_SESSIONS, DEFAULT_MAX_GUEST_SESSIONS, {
      minimum: 1,
      integer: true
    })
  };
}

function nowMs(): number {
  return Date.now();
}

function readWechatMiniGameLoginConfig(env: NodeJS.ProcessEnv = process.env): WechatMiniGameLoginConfig {
  const normalizedMode = env.VEIL_WECHAT_MINIGAME_LOGIN_MODE?.trim().toLowerCase();
  const mode =
    normalizedMode === "mock" ? "mock" : normalizedMode === "production" || normalizedMode === "code2session" ? "production" : "disabled";
  return {
    mode,
    mockCode: env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE?.trim() || "wechat-dev-code",
    code2SessionUrl: env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL?.trim() || "https://api.weixin.qq.com/sns/jscode2session",
    ...(env.VEIL_WECHAT_MINIGAME_APP_ID?.trim() ? { appId: env.VEIL_WECHAT_MINIGAME_APP_ID.trim() } : {}),
    ...(env.VEIL_WECHAT_MINIGAME_APP_SECRET?.trim() ? { appSecret: env.VEIL_WECHAT_MINIGAME_APP_SECRET.trim() } : {})
  };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
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

  return normalized;
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

export function createWechatMiniGamePlayerId(openId: string): string {
  const normalizedOpenId = openId.trim();
  if (!normalizedOpenId) {
    throw new Error("wechat_openid_required");
  }

  return `wechat-${createHmac("sha256", AUTH_SECRET).update(`wechat:${normalizedOpenId}`).digest("hex").slice(0, 16)}`;
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
      openId: `mock-openid:${code}`
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
  if (!openId) {
    throw new Error("wechat_code2session_failed");
  }

  return {
    openId,
    ...(payload.unionid?.trim() ? { unionId: payload.unionid.trim() } : {})
  };
}

export function issueAuthSession(input: {
  playerId: string;
  displayName: string;
  authMode?: AuthMode;
  provider?: AuthProvider;
  loginId?: string | null;
  sessionId?: string | null;
}): GuestAuthSession {
  const timestamp = new Date().toISOString();
  const loginId = normalizeLoginId(input.loginId);
  const sessionId = normalizeSessionId(input.sessionId);
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
    issuedAt: timestamp
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", AUTH_SECRET).update(encodedPayload).digest("base64url");

  return {
    token: `${encodedPayload}.${signature}`,
    playerId: input.playerId,
    displayName: input.displayName,
    authMode,
    provider,
    ...(loginId ? { loginId } : {}),
    ...(sessionId ? { sessionId } : {}),
    issuedAt: timestamp,
    lastUsedAt: timestamp
  };
}

export function issueGuestAuthSession(input: { playerId: string; displayName: string }): GuestAuthSession {
  const session = issueAuthSession({
    ...input,
    authMode: "guest",
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
}): GuestAuthSession {
  return issueAuthSession({
    ...input,
    authMode: "account",
    provider: "account-password"
  });
}

export function issueWechatMiniGameAuthSession(input: {
  playerId: string;
  displayName: string;
  loginId?: string | null;
}): GuestAuthSession {
  return issueAuthSession({
    ...input,
    provider: "wechat-mini-game"
  });
}

export function issueNextAuthSession(
  input: {
    playerId: string;
    displayName: string;
    loginId?: string | null;
  },
  currentSession?: Pick<GuestAuthSession, "authMode" | "loginId" | "provider"> | null
): GuestAuthSession {
  const loginId = normalizeLoginId(input.loginId);
  if (currentSession?.authMode === "account" && loginId) {
    return issueAccountAuthSession({
      playerId: input.playerId,
      displayName: input.displayName,
      loginId
    });
  }

  return issueAuthSession({
    playerId: input.playerId,
    displayName: input.displayName,
    authMode: "guest",
    provider: currentSession?.provider ?? "guest"
  });
}

export function resolveAuthSession(token: string): GuestAuthSession | null {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return null;
  }

  const [encodedPayload, signature] = normalizedToken.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", AUTH_SECRET).update(encodedPayload).digest("base64url");
  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as GuestAuthTokenPayload;
    if (
      typeof payload.playerId !== "string" ||
      typeof payload.displayName !== "string" ||
      typeof payload.issuedAt !== "string"
    ) {
      return null;
    }

    const loginId = normalizeLoginId(payload.loginId);
    const sessionId = normalizeSessionId(payload.sessionId);
    const session = {
      token: normalizedToken,
      playerId: payload.playerId,
      displayName: payload.displayName,
      authMode: normalizeAuthMode(payload.authMode, payload.loginId),
      provider: normalizeAuthProvider(payload),
      ...(loginId ? { loginId } : {}),
      ...(sessionId ? { sessionId } : {}),
      issuedAt: payload.issuedAt,
      lastUsedAt: new Date().toISOString()
    };
    if (session.provider === "guest" && session.authMode === "guest" && session.sessionId) {
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

export function resolveAuthSessionFromRequest(
  request: Pick<IncomingMessage, "headers">
): GuestAuthSession | null {
  const token = readGuestAuthTokenFromRequest(request);
  return token ? resolveAuthSession(token) : null;
}

export const resolveGuestAuthSessionFromRequest = resolveAuthSessionFromRequest;

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

function readHeaderCsvValue(value: string | string[] | undefined): string | null {
  const headerValue = readHeaderValue(value);
  return headerValue?.split(",")[0]?.trim() || null;
}

function resolveRequestIp(request: Pick<IncomingMessage, "headers" | "socket">): string {
  const forwardedFor = readHeaderCsvValue(request.headers["x-forwarded-for"]);
  const rawIp = forwardedFor || request.socket.remoteAddress?.trim() || "unknown";
  return rawIp.startsWith("::ffff:") ? rawIp.slice("::ffff:".length) : rawIp;
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

function enforceAuthRateLimit(
  request: Pick<IncomingMessage, "headers" | "socket">,
  response: ServerResponse,
  endpointKey: string
): boolean {
  const rateLimitResult = consumeSlidingWindowRateLimit(`${endpointKey}:${resolveRequestIp(request)}`);
  if (rateLimitResult.allowed) {
    return true;
  }

  response.setHeader("Retry-After", String(rateLimitResult.retryAfterSeconds ?? 1));
  sendJson(response, 429, {
    error: {
      code: "rate_limited",
      message: "Too many authentication attempts, please retry later"
    }
  });
  return false;
}

function pruneAccountLockoutState(loginId: string, config = readAuthRuntimeConfig()): AccountLockoutState {
  const currentTime = nowMs();
  const windowStart = currentTime - config.rateLimitWindowMs;
  const existingState = accountLockoutStateByLoginId.get(loginId) ?? { failedAttempts: [] };
  const nextState: AccountLockoutState = {
    failedAttempts: existingState.failedAttempts.filter((timestamp) => timestamp > windowStart),
    ...(existingState.lockedUntil && existingState.lockedUntil > currentTime ? { lockedUntil: existingState.lockedUntil } : {})
  };

  if (nextState.failedAttempts.length === 0 && !nextState.lockedUntil) {
    accountLockoutStateByLoginId.delete(loginId);
    return nextState;
  }

  accountLockoutStateByLoginId.set(loginId, nextState);
  return nextState;
}

function getAccountLockedUntil(loginId: string): number | null {
  return pruneAccountLockoutState(loginId).lockedUntil ?? null;
}

function recordAccountLoginFailure(loginId: string, config = readAuthRuntimeConfig()): number | null {
  const currentTime = nowMs();
  const nextState = pruneAccountLockoutState(loginId, config);
  nextState.failedAttempts.push(currentTime);
  if (nextState.failedAttempts.length >= config.lockoutThreshold) {
    nextState.lockedUntil = currentTime + config.lockoutDurationMs;
  }
  accountLockoutStateByLoginId.set(loginId, nextState);
  return nextState.lockedUntil ?? null;
}

function clearAccountLoginFailures(loginId: string): void {
  accountLockoutStateByLoginId.delete(loginId);
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

function registerGuestSession(session: GuestAuthSession, config = readAuthRuntimeConfig()): void {
  if (session.provider !== "guest" || session.authMode !== "guest" || !session.sessionId) {
    return;
  }

  while (guestSessionsById.size >= config.maxGuestSessions) {
    const oldestSessionId = guestSessionsById.keys().next().value;
    if (!oldestSessionId) {
      break;
    }
    guestSessionsById.delete(oldestSessionId);
  }

  guestSessionsById.set(session.sessionId, session);
}

function touchGuestSession(sessionId: string, token: string): GuestAuthSession | null {
  const existingSession = guestSessionsById.get(sessionId);
  if (!existingSession || existingSession.token !== token) {
    return null;
  }

  const nextSession: GuestAuthSession = {
    ...existingSession,
    lastUsedAt: new Date().toISOString()
  };
  guestSessionsById.delete(sessionId);
  guestSessionsById.set(sessionId, nextSession);
  return nextSession;
}

export function resetGuestAuthSessions(): void {
  authRateLimitCounters.clear();
  accountLockoutStateByLoginId.clear();
  guestSessionsById.clear();
}

export function registerAuthRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null
): void {
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
      const authSession = resolveAuthSessionFromRequest(request);
      if (!authSession) {
        sendJson(response, 401, {
          error: {
            code: "unauthorized",
            message: "Guest auth session is missing or invalid"
          }
        });
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
            ...(account.loginId ? { loginId: account.loginId } : {})
          },
          authSession
        );
      }

      sendJson(response, 200, {
        session: nextSession
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/guest-login", async (request, response) => {
    if (!enforceAuthRateLimit(request, response, "guest-login")) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        playerId?: string | null;
        displayName?: string | null;
      };

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

      let playerId = normalizePlayerId(body.playerId);
      let displayName = normalizeDisplayName(playerId, body.displayName);

      if (store) {
        const account = await store.ensurePlayerAccount({
          playerId,
          displayName
        });
        playerId = account.playerId;
        displayName = account.displayName;
      }

      sendJson(response, 200, {
        session: issueGuestAuthSession({
          playerId,
          displayName
        })
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/wechat-mini-game-login", async (request, response) => {
    try {
      const authSession = resolveAuthSessionFromRequest(request);
      const body = (await readJsonBody(request)) as {
        code?: string | null;
        playerId?: string | null;
        displayName?: string | null;
        avatarUrl?: string | null;
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

      const code = normalizeWechatMiniGameCode(body.code);
      const avatarUrl = normalizeAvatarUrl(body.avatarUrl);
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
              message: "WeChat mini game login exchange exists, but code2Session is not configured"
            }
          });
          return;
        }

        if (message === "invalid_wechat_code") {
          sendJson(response, 401, {
            error: {
              code: "invalid_wechat_code",
              message:
                wechatConfig.mode === "mock"
                  ? "WeChat mini game mock code is incorrect"
                  : "WeChat mini game code is invalid or expired"
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

      if (store) {
        const boundAccount = await store.loadPlayerAccountByWechatMiniGameOpenId(identity.openId);
        if (boundAccount && authSession && boundAccount.playerId !== authSession.playerId) {
          sendJson(response, 409, {
            error: {
              code: "wechat_identity_already_bound",
              message: "This WeChat mini game identity is already bound to another account"
            }
          });
          return;
        }

        const requestedPlayerId = body.playerId?.trim();
        if (!authSession && requestedPlayerId) {
          const existingRequestedAccount = await store.loadPlayerAccount(requestedPlayerId);
          if (!existingRequestedAccount) {
            playerId = normalizePlayerId(requestedPlayerId);
          }
        }

        if (boundAccount) {
          const syncedAccount = await store.bindPlayerAccountWechatMiniGameIdentity(boundAccount.playerId, {
            openId: identity.openId,
            ...(identity.unionId ? { unionId: identity.unionId } : {}),
            ...(body.displayName?.trim() ? { displayName: body.displayName } : {}),
            ...(avatarUrl ? { avatarUrl } : {})
          });
          playerId = syncedAccount.playerId;
          displayName = syncedAccount.displayName;
          loginId = syncedAccount.loginId;
        } else {
          const targetPlayerId = authSession?.playerId ?? playerId;
          const boundAccountResult = await store.bindPlayerAccountWechatMiniGameIdentity(targetPlayerId, {
            openId: identity.openId,
            ...(identity.unionId ? { unionId: identity.unionId } : {}),
            ...(body.displayName?.trim() ? { displayName: body.displayName } : {}),
            ...(avatarUrl ? { avatarUrl } : {})
          });
          playerId = boundAccountResult.playerId;
          displayName = boundAccountResult.displayName;
          loginId = boundAccountResult.loginId;
        }
      } else if (!authSession && body.playerId?.trim()) {
        playerId = normalizePlayerId(body.playerId);
        displayName = normalizeDisplayName(playerId, body.displayName);
      }

      sendJson(response, 200, {
        session: issueWechatMiniGameAuthSession({
          playerId,
          displayName,
          ...(loginId ? { loginId } : {})
        })
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/auth/account-login", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
      return;
    }

    if (!enforceAuthRateLimit(request, response, "account-login")) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        loginId?: string | null;
        password?: string | null;
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

      const loginId = normalizeAccountLoginId(body.loginId);
      const password = normalizeAccountPassword(body.password);
      const lockedUntil = getAccountLockedUntil(loginId);
      if (lockedUntil) {
        sendAccountLocked(response, lockedUntil);
        return;
      }

      const authAccount = await store.loadPlayerAccountAuthByLoginId(loginId);
      if (!authAccount || !verifyAccountPassword(password, authAccount.passwordHash)) {
        const nextLockedUntil = recordAccountLoginFailure(loginId);
        if (nextLockedUntil) {
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

      clearAccountLoginFailures(loginId);
      const account = await store.ensurePlayerAccount({
        playerId: authAccount.playerId,
        displayName: authAccount.displayName
      });
      sendJson(response, 200, {
        account,
        session: issueAccountAuthSession({
          playerId: account.playerId,
          displayName: account.displayName,
          loginId
        })
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

    if (!enforceAuthRateLimit(request, response, "account-bind")) {
      return;
    }

    try {
      const authSession = resolveAuthSessionFromRequest(request);
      if (!authSession) {
        sendJson(response, 401, {
          error: {
            code: "unauthorized",
            message: "Guest auth session is missing or invalid"
          }
        });
        return;
      }

      const body = (await readJsonBody(request)) as {
        loginId?: string | null;
        password?: string | null;
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

      const loginId = normalizeAccountLoginId(body.loginId);
      const password = normalizeAccountPassword(body.password);
      const account = await store.bindPlayerAccountCredentials(authSession.playerId, {
        loginId,
        passwordHash: hashAccountPassword(password)
      });

      sendJson(response, 200, {
        account,
        session: issueAccountAuthSession({
          playerId: account.playerId,
          displayName: account.displayName,
          loginId
        })
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });
}
