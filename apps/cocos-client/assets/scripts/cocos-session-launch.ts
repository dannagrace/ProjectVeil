export type CocosAuthProvider = "guest" | "account-password" | "wechat-mini-game";

export interface CocosStoredAuthSession {
  playerId: string;
  displayName: string;
  authMode: "guest" | "account";
  provider?: CocosAuthProvider;
  loginId?: string;
  token?: string;
  refreshToken?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  source: "remote" | "local";
}

export interface CocosLaunchIdentity {
  roomId: string;
  playerId: string;
  displayName: string;
  authMode: "guest" | "account";
  authProvider: CocosAuthProvider;
  loginId?: string;
  authToken: string | null;
  sessionSource: "remote" | "local" | "manual" | "none";
  usedStoredSession: boolean;
  shouldOpenLobby: boolean;
}

const AUTH_SESSION_STORAGE_KEY = "project-veil:auth-session";

export function getCocosAuthSessionStorageKey(): string {
  return AUTH_SESSION_STORAGE_KEY;
}

function normalizeValue(value?: string | null): string {
  return value?.trim() ?? "";
}

function normalizeLoginId(value?: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function normalizeAuthProvider(value: unknown, authMode: "guest" | "account", loginId?: string): CocosAuthProvider {
  if (value === "guest" || value === "account-password" || value === "wechat-mini-game") {
    return value;
  }
  if (authMode === "account" || loginId) {
    return "account-password";
  }
  return "guest";
}

export function readStoredCocosAuthSession(
  storage: Pick<Storage, "getItem"> | null | undefined
): CocosStoredAuthSession | null {
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      playerId?: unknown;
      displayName?: unknown;
      authMode?: unknown;
      provider?: unknown;
      loginId?: unknown;
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
    const authMode = parsed.authMode === "account" || loginId ? "account" : "guest";
    return {
      playerId: parsed.playerId,
      displayName: parsed.displayName,
      authMode,
      provider: normalizeAuthProvider(parsed.provider, authMode, loginId),
      ...(loginId ? { loginId } : {}),
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

export function writeStoredCocosAuthSession(
  storage: Pick<Storage, "setItem">,
  session: CocosStoredAuthSession
): void {
  storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredCocosAuthSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export function resolveCocosLaunchIdentity(input: {
  defaultRoomId: string;
  defaultPlayerId: string;
  defaultDisplayName?: string;
  search?: string;
  storedSession?: CocosStoredAuthSession | null;
}): CocosLaunchIdentity {
  const search = input.search?.trim() ?? "";
  const params = new URLSearchParams(search.startsWith("?") ? search : search ? `?${search}` : "");
  const queryRoomId = normalizeValue(params.get("roomId"));
  const queryPlayerId = normalizeValue(params.get("playerId"));
  const queryDisplayName = normalizeValue(params.get("displayName"));
  const storedSession = input.storedSession ?? null;
  const roomId = queryRoomId || normalizeValue(input.defaultRoomId) || "test-room";
  const playerId =
    queryPlayerId || normalizeValue(storedSession?.playerId) || normalizeValue(input.defaultPlayerId) || "player-1";
  const canReuseStoredSession = Boolean(storedSession && storedSession.playerId === playerId && !queryPlayerId);
  const displayName =
    queryDisplayName ||
    (storedSession && storedSession.playerId === playerId ? normalizeValue(storedSession.displayName) : "") ||
    normalizeValue(input.defaultDisplayName) ||
    playerId;

  return {
    roomId,
    playerId,
    displayName,
    authMode: canReuseStoredSession ? storedSession?.authMode ?? "guest" : "guest",
    authProvider: canReuseStoredSession ? storedSession?.provider ?? "guest" : "guest",
    ...(canReuseStoredSession && storedSession?.loginId ? { loginId: storedSession.loginId } : {}),
    authToken: canReuseStoredSession ? storedSession?.token ?? null : null,
    sessionSource: canReuseStoredSession ? storedSession?.source ?? "none" : queryPlayerId ? "manual" : "none",
    usedStoredSession: canReuseStoredSession,
    shouldOpenLobby: queryRoomId.length === 0
  };
}
