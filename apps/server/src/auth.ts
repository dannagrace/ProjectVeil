import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSnapshotStore } from "./persistence";

export type AuthMode = "guest" | "account";

export interface GuestAuthSession {
  token: string;
  playerId: string;
  displayName: string;
  authMode: AuthMode;
  loginId?: string;
  issuedAt: string;
  lastUsedAt: string;
}

interface GuestAuthTokenPayload {
  playerId: string;
  displayName: string;
  authMode?: AuthMode;
  loginId?: string;
  issuedAt: string;
}

const AUTH_SECRET = process.env.VEIL_AUTH_SECRET?.trim() || "project-veil-dev-secret";
const MIN_ACCOUNT_PASSWORD_LENGTH = 6;

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

function normalizeAuthMode(authMode?: string | null, loginId?: string | null): AuthMode {
  return authMode === "account" || Boolean(normalizeLoginId(loginId)) ? "account" : "guest";
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

export function issueAuthSession(input: {
  playerId: string;
  displayName: string;
  authMode?: AuthMode;
  loginId?: string | null;
}): GuestAuthSession {
  const timestamp = new Date().toISOString();
  const loginId = normalizeLoginId(input.loginId);
  const authMode = normalizeAuthMode(input.authMode, loginId);
  const payload: GuestAuthTokenPayload = {
    playerId: input.playerId,
    displayName: input.displayName,
    authMode,
    ...(loginId ? { loginId } : {}),
    issuedAt: timestamp
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", AUTH_SECRET).update(encodedPayload).digest("base64url");

  return {
    token: `${encodedPayload}.${signature}`,
    playerId: input.playerId,
    displayName: input.displayName,
    authMode,
    ...(loginId ? { loginId } : {}),
    issuedAt: timestamp,
    lastUsedAt: timestamp
  };
}

export function issueGuestAuthSession(input: { playerId: string; displayName: string }): GuestAuthSession {
  return issueAuthSession({
    ...input,
    authMode: "guest"
  });
}

export function issueAccountAuthSession(input: {
  playerId: string;
  displayName: string;
  loginId: string;
}): GuestAuthSession {
  return issueAuthSession({
    ...input,
    authMode: "account"
  });
}

export function issueNextAuthSession(
  input: {
    playerId: string;
    displayName: string;
    loginId?: string | null;
  },
  currentSession?: Pick<GuestAuthSession, "authMode" | "loginId"> | null
): GuestAuthSession {
  const loginId = normalizeLoginId(input.loginId);
  if (currentSession?.authMode === "account" && loginId) {
    return issueAccountAuthSession({
      playerId: input.playerId,
      displayName: input.displayName,
      loginId
    });
  }

  return issueGuestAuthSession({
    playerId: input.playerId,
    displayName: input.displayName
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
    return {
      token: normalizedToken,
      playerId: payload.playerId,
      displayName: payload.displayName,
      authMode: normalizeAuthMode(payload.authMode, payload.loginId),
      ...(loginId ? { loginId } : {}),
      issuedAt: payload.issuedAt,
      lastUsedAt: new Date().toISOString()
    };
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

export function resetGuestAuthSessions(): void {
  // Stateless signed guest tokens do not need in-memory cleanup.
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

  app.post("/api/auth/account-login", async (request, response) => {
    if (!store) {
      sendStoreUnavailable(response);
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
      const authAccount = await store.loadPlayerAccountAuthByLoginId(loginId);
      if (!authAccount || !verifyAccountPassword(password, authAccount.passwordHash)) {
        sendJson(response, 401, {
          error: {
            code: "invalid_credentials",
            message: "Login ID or password is incorrect"
          }
        });
        return;
      }

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
