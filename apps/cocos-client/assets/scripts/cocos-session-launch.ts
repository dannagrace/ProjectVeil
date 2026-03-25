export interface CocosStoredAuthSession {
  playerId: string;
  displayName: string;
  token?: string;
  source: "remote" | "local";
}

export interface CocosLaunchIdentity {
  roomId: string;
  playerId: string;
  displayName: string;
  authToken: string | null;
  sessionSource: "remote" | "local" | "manual" | "none";
  usedStoredSession: boolean;
  shouldOpenLobby: boolean;
}

const AUTH_SESSION_STORAGE_KEY = "project-veil:auth-session";

export function getCocosAuthSessionStorageKey(): string {
  return AUTH_SESSION_STORAGE_KEY;
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
      token?: unknown;
      source?: unknown;
    };
    if (typeof parsed.playerId !== "string" || typeof parsed.displayName !== "string") {
      return null;
    }

    return {
      playerId: parsed.playerId,
      displayName: parsed.displayName,
      ...(typeof parsed.token === "string" ? { token: parsed.token } : {}),
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

function normalizeValue(value?: string | null): string {
  return value?.trim() ?? "";
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
  const playerId = queryPlayerId || normalizeValue(storedSession?.playerId) || normalizeValue(input.defaultPlayerId) || "player-1";
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
    authToken: canReuseStoredSession ? storedSession?.token ?? null : null,
    sessionSource: canReuseStoredSession ? storedSession?.source ?? "none" : queryPlayerId ? "manual" : "none",
    usedStoredSession: canReuseStoredSession,
    shouldOpenLobby: queryRoomId.length === 0
  };
}
