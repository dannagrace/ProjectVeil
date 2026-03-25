const AUTH_SESSION_STORAGE_KEY = "project-veil:auth-session";
const AUTH_REQUEST_TIMEOUT_MS = 1200;

export interface StoredAuthSession {
  playerId: string;
  displayName: string;
  authMode: "guest" | "account";
  loginId?: string;
  token?: string;
  source: "remote" | "local";
}

interface AuthSessionApiPayload {
  session?: {
    token?: string;
    playerId?: string;
    displayName?: string;
    authMode?: "guest" | "account";
    loginId?: string;
  };
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
    Partial<Pick<StoredAuthSession, "loginId" | "token">>
): StoredAuthSession {
  const playerId = normalizePlayerId(payload?.playerId ?? fallback.playerId);
  const loginId = normalizeLoginId(payload?.loginId ?? fallback.loginId);
  const authMode = payload?.authMode === "account" || loginId ? "account" : fallback.authMode;

  return {
    playerId,
    displayName: normalizeDisplayName(playerId, payload?.displayName ?? fallback.displayName),
    authMode,
    ...(loginId ? { loginId } : {}),
    ...(payload?.token ? { token: payload.token } : fallback.token ? { token: fallback.token } : {}),
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
      throw new Error(`auth_request_failed:${response.status}`);
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
      token?: unknown;
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
      ...(typeof parsed.token === "string" ? { token: parsed.token } : {}),
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

export async function syncCurrentAuthSession(): Promise<StoredAuthSession | null> {
  const currentSession = readStoredAuthSession();
  if (!currentSession?.token) {
    return currentSession;
  }

  try {
    const payload = (await fetchJson(`${resolveAuthApiBaseUrl()}/api/auth/session`, {
      headers: buildAuthHeaders(currentSession.token)
    })) as AuthSessionApiPayload;
    const session = asStoredAuthSession(payload.session, "remote", currentSession);
    return storeAuthSession(session);
  } catch (error) {
    if (error instanceof Error && error.message === "auth_request_failed:401") {
      clearCurrentAuthSession();
      return null;
    }

    return currentSession;
  }
}
