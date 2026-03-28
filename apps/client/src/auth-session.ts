const AUTH_SESSION_STORAGE_KEY = "project-veil:auth-session";
const AUTH_REQUEST_TIMEOUT_MS = 1200;

export interface StoredAuthSession {
  playerId: string;
  displayName: string;
  authMode: "guest" | "account";
  loginId?: string;
  sessionId?: string;
  token?: string;
  refreshToken?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  source: "remote" | "local";
}

interface AuthSessionApiPayload {
  session?: {
    token?: string;
    refreshToken?: string;
    playerId?: string;
    displayName?: string;
    authMode?: "guest" | "account";
    loginId?: string;
    sessionId?: string;
    expiresAt?: string;
    refreshExpiresAt?: string;
  };
}

interface AccountAuthApiPayload extends AuthSessionApiPayload {
  status?: string;
  expiresAt?: string;
  registrationToken?: string;
  recoveryToken?: string;
  account?: {
    playerId?: string;
    displayName?: string;
    loginId?: string;
  };
}

export interface AccountRegistrationRequestResult {
  status: string;
  expiresAt?: string;
  registrationToken?: string;
}

export interface PasswordRecoveryRequestResult {
  status: string;
  expiresAt?: string;
  recoveryToken?: string;
}

function getAuthSessionStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveAuthApiBaseUrl(): string {
  const httpProtocol = window.location.protocol === "https:" ? "https" : "http";
  return `${httpProtocol}://${window.location.hostname || "127.0.0.1"}:2567`;
}

function createGuestPlayerId(): string {
  return `guest-${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
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

function asStoredAuthSession(
  payload: AuthSessionApiPayload["session"],
  source: StoredAuthSession["source"],
  fallback: Pick<StoredAuthSession, "playerId" | "displayName" | "authMode"> &
    Partial<Pick<StoredAuthSession, "loginId" | "sessionId" | "token" | "refreshToken" | "expiresAt" | "refreshExpiresAt">>
): StoredAuthSession {
  const playerId = normalizePlayerId(payload?.playerId ?? fallback.playerId);
  const loginId = normalizeLoginId(payload?.loginId ?? fallback.loginId);
  const authMode = payload?.authMode === "account" || loginId ? "account" : fallback.authMode;

  return {
    playerId,
    displayName: normalizeDisplayName(playerId, payload?.displayName ?? fallback.displayName),
    authMode,
    ...(loginId ? { loginId } : {}),
    ...(payload?.sessionId ? { sessionId: payload.sessionId } : fallback.sessionId ? { sessionId: fallback.sessionId } : {}),
    ...(payload?.token ? { token: payload.token } : fallback.token ? { token: fallback.token } : {}),
    ...(payload?.refreshToken ? { refreshToken: payload.refreshToken } : fallback.refreshToken ? { refreshToken: fallback.refreshToken } : {}),
    ...(payload?.expiresAt ? { expiresAt: payload.expiresAt } : fallback.expiresAt ? { expiresAt: fallback.expiresAt } : {}),
    ...(payload?.refreshExpiresAt
      ? { refreshExpiresAt: payload.refreshExpiresAt }
      : fallback.refreshExpiresAt
        ? { refreshExpiresAt: fallback.refreshExpiresAt }
        : {}),
    source
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      let errorCode = "unknown";
      try {
        const payload = (await response.json()) as { error?: { code?: string } };
        errorCode = payload.error?.code?.trim() || errorCode;
      } catch {
        errorCode = "unknown";
      }
      throw new Error(`auth_request_failed:${response.status}:${errorCode}`);
    }

    return (await response.json()) as unknown;
  } finally {
    window.clearTimeout(timeout);
  }
}

function getAuthStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  return getAuthSessionStorage();
}

export function getAuthSessionStorageKey(): string {
  return AUTH_SESSION_STORAGE_KEY;
}

export function readStoredAuthSession(
  storage: Pick<Storage, "getItem"> = getAuthSessionStorage() ?? { getItem: () => null }
): StoredAuthSession | null {
  const raw = storage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      playerId?: unknown;
      displayName?: unknown;
      authMode?: unknown;
      loginId?: unknown;
      sessionId?: unknown;
      token?: unknown;
      refreshToken?: unknown;
      expiresAt?: unknown;
      refreshExpiresAt?: unknown;
      source?: unknown;
    };
    if (typeof parsed.playerId !== "string" || typeof parsed.displayName !== "string") {
      return null;
    }

    const loginId = typeof parsed.loginId === "string" ? normalizeLoginId(parsed.loginId) : undefined;
    return {
      playerId: parsed.playerId,
      displayName: parsed.displayName,
      authMode: parsed.authMode === "account" || loginId ? "account" : "guest",
      ...(loginId ? { loginId } : {}),
      ...(typeof parsed.sessionId === "string" ? { sessionId: parsed.sessionId } : {}),
      ...(typeof parsed.token === "string" ? { token: parsed.token } : {}),
      ...(typeof parsed.refreshToken === "string" ? { refreshToken: parsed.refreshToken } : {}),
      ...(typeof parsed.expiresAt === "string" ? { expiresAt: parsed.expiresAt } : {}),
      ...(typeof parsed.refreshExpiresAt === "string" ? { refreshExpiresAt: parsed.refreshExpiresAt } : {}),
      source: parsed.source === "remote" ? "remote" : "local"
    };
  } catch {
    return null;
  }
}

export function writeStoredAuthSession(
  storage: Pick<Storage, "setItem">,
  session: StoredAuthSession
): void {
  storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredAuthSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export function storeAuthSession(session: StoredAuthSession): StoredAuthSession {
  const storage = getAuthStorage();
  if (storage) {
    writeStoredAuthSession(storage, session);
  }

  return session;
}

export function clearCurrentAuthSession(): void {
  const storage = getAuthStorage();
  if (storage) {
    clearStoredAuthSession(storage);
  }
}

export function buildAuthHeaders(token?: string | null): HeadersInit {
  return token?.trim()
    ? {
        Authorization: `Bearer ${token.trim()}`
      }
    : {};
}

function isAuthError(error: unknown, status: number, code?: string): boolean {
  return (
    error instanceof Error &&
    error.message === `auth_request_failed:${status}:${code ?? "unknown"}`
  );
}

function mergeHeaders(headers: HeadersInit | undefined, token?: string | null): HeadersInit {
  return {
    ...(headers ?? {}),
    ...buildAuthHeaders(token)
  };
}

export async function refreshCurrentAuthSession(
  currentSession: StoredAuthSession | null = readStoredAuthSession()
): Promise<StoredAuthSession | null> {
  if (!currentSession?.refreshToken) {
    clearCurrentAuthSession();
    return null;
  }

  try {
    const payload = (await fetchJson(`${resolveAuthApiBaseUrl()}/api/auth/refresh`, {
      method: "POST",
      headers: buildAuthHeaders(currentSession.refreshToken)
    })) as AuthSessionApiPayload;
    const session = asStoredAuthSession(payload.session, "remote", currentSession);
    return storeAuthSession(session);
  } catch {
    clearCurrentAuthSession();
    return null;
  }
}

export async function fetchAuthJson(
  url: string,
  init: RequestInit = {},
  currentSession: StoredAuthSession | null = readStoredAuthSession()
): Promise<unknown> {
  const requestWithToken = {
    ...init,
    headers: mergeHeaders(init.headers, currentSession?.token)
  } satisfies RequestInit;

  try {
    return await fetchJson(url, requestWithToken);
  } catch (error) {
    if (isAuthError(error, 401, "token_expired") && currentSession?.refreshToken) {
      const refreshedSession = await refreshCurrentAuthSession(currentSession);
      if (!refreshedSession?.token) {
        throw error;
      }
      return fetchJson(url, {
        ...init,
        headers: mergeHeaders(init.headers, refreshedSession.token)
      });
    }

    if (error instanceof Error && error.message.startsWith("auth_request_failed:401:")) {
      clearCurrentAuthSession();
    }
    throw error;
  }
}

export async function logoutCurrentAuthSession(): Promise<void> {
  const currentSession = readStoredAuthSession();
  if (currentSession?.token) {
    try {
      await fetchJson(`${resolveAuthApiBaseUrl()}/api/auth/logout`, {
        method: "POST",
        headers: buildAuthHeaders(currentSession.token)
      });
    } catch {
      // Local cleanup should still proceed.
    }
  }
  clearCurrentAuthSession();
}

export async function loginGuestAuthSession(playerId: string, displayName: string): Promise<StoredAuthSession> {
  const normalizedPlayerId = normalizePlayerId(playerId);
  const normalizedDisplayName = normalizeDisplayName(normalizedPlayerId, displayName);

  try {
    const payload = (await fetchJson(`${resolveAuthApiBaseUrl()}/api/auth/guest-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        playerId: normalizedPlayerId,
        displayName: normalizedDisplayName
      })
    })) as AuthSessionApiPayload;
    const session = asStoredAuthSession(payload.session, "remote", {
      playerId: normalizedPlayerId,
      displayName: normalizedDisplayName,
      authMode: "guest"
    });
    return storeAuthSession(session);
  } catch {
    const session: StoredAuthSession = {
      playerId: normalizedPlayerId,
      displayName: normalizedDisplayName,
      authMode: "guest",
      source: "local"
    };
    return storeAuthSession(session);
  }
}

export async function loginPasswordAuthSession(loginId: string, password: string): Promise<StoredAuthSession> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  const payload = (await fetchJson(`${resolveAuthApiBaseUrl()}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: normalizedLoginId,
      password
    })
  })) as AuthSessionApiPayload;

  const session = asStoredAuthSession(payload.session, "remote", {
    playerId: normalizedLoginId,
    displayName: normalizedLoginId,
    authMode: "account",
    loginId: normalizedLoginId
  });
  return storeAuthSession(session);
}

export async function requestAccountRegistration(
  loginId: string,
  displayName?: string
): Promise<AccountRegistrationRequestResult> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  const payload = (await fetchJson(`${resolveAuthApiBaseUrl()}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: normalizedLoginId,
      ...(displayName?.trim() ? { displayName: displayName.trim() } : {})
    })
  })) as AccountAuthApiPayload;

  return {
    status: payload.status ?? "registration_requested",
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    ...(payload.registrationToken ? { registrationToken: payload.registrationToken } : {})
  };
}

export async function confirmAccountRegistration(
  loginId: string,
  registrationToken: string,
  password: string
): Promise<StoredAuthSession> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  const payload = (await fetchJson(`${resolveAuthApiBaseUrl()}/api/auth/account-registration/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: normalizedLoginId,
      registrationToken,
      password
    })
  })) as AccountAuthApiPayload;

  const session = asStoredAuthSession(payload.session, "remote", {
    playerId: payload.account?.playerId?.trim() || normalizedLoginId,
    displayName: payload.account?.displayName?.trim() || normalizedLoginId,
    authMode: "account",
    loginId: payload.account?.loginId?.trim() || normalizedLoginId
  });
  return storeAuthSession(session);
}

export async function requestPasswordRecovery(loginId: string): Promise<PasswordRecoveryRequestResult> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  const payload = (await fetchJson(`${resolveAuthApiBaseUrl()}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: normalizedLoginId
    })
  })) as AccountAuthApiPayload;

  return {
    status: payload.status ?? "recovery_requested",
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    ...(payload.recoveryToken ? { recoveryToken: payload.recoveryToken } : {})
  };
}

export async function confirmPasswordRecovery(
  loginId: string,
  recoveryToken: string,
  newPassword: string
): Promise<void> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  await fetchJson(`${resolveAuthApiBaseUrl()}/api/auth/password-recovery/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: normalizedLoginId,
      recoveryToken,
      newPassword
    })
  });
}

export async function syncCurrentAuthSession(): Promise<StoredAuthSession | null> {
  const currentSession = readStoredAuthSession();
  if (!currentSession?.token) {
    return currentSession;
  }

  try {
    const payload = (await fetchAuthJson(
      `${resolveAuthApiBaseUrl()}/api/auth/session`,
      {
        headers: {}
      },
      currentSession
    )) as AuthSessionApiPayload;
    const session = asStoredAuthSession(payload.session, "remote", currentSession);
    return storeAuthSession(session);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("auth_request_failed:401:")) {
      clearCurrentAuthSession();
      return null;
    }

    return currentSession;
  }
}
