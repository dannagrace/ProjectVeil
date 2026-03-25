import {
  clearStoredCocosAuthSession,
  type CocosStoredAuthSession,
  writeStoredCocosAuthSession
} from "./cocos-session-launch.ts";

const LOBBY_PREFERENCES_STORAGE_KEY = "project-veil:lobby-preferences";
const PLAYER_ACCOUNT_PREFIX = "project-veil:player-account";
const DEFAULT_LOBBY_ROOM_ID = "room-alpha";
const COCOS_REQUEST_TIMEOUT_MS = 1200;

export interface CocosLobbyPreferences {
  playerId: string;
  roomId: string;
}

export interface CocosLobbyRoomSummary {
  roomId: string;
  seed: number;
  day: number;
  connectedPlayers: number;
  heroCount: number;
  activeBattles: number;
  updatedAt: string;
}

interface AuthSessionApiPayload {
  session?: {
    token?: string;
    playerId?: string;
    displayName?: string;
  };
}

interface LobbyRoomsApiPayload {
  items?: CocosLobbyRoomSummary[];
}

type FetchLike = typeof fetch;

function getCocosStorage(): Storage | null {
  try {
    const sysStorage = (globalThis as { sys?: { localStorage?: Storage } }).sys?.localStorage;
    if (sysStorage) {
      return sysStorage;
    }
  } catch {
    // Ignore and keep falling back to browser storage.
  }

  try {
    const localStorageRef = globalThis.localStorage;
    return localStorageRef ?? null;
  } catch {
    return null;
  }
}

function normalizePlayerId(value?: string | null): string {
  return value?.trim() ?? "";
}

function normalizeRoomId(value?: string | null): string {
  return value?.trim() ?? "";
}

function normalizeDisplayName(playerId: string, displayName?: string | null): string {
  const normalizedPlayerId = normalizePlayerId(playerId) || createCocosGuestPlayerId();
  const normalizedDisplayName = displayName?.trim();
  return normalizedDisplayName && normalizedDisplayName.length > 0 ? normalizedDisplayName : normalizedPlayerId;
}

function readStoredLobbyPreferencesUnsafe(storage: Pick<Storage, "getItem">): Partial<CocosLobbyPreferences> | null {
  const raw = storage.getItem(LOBBY_PREFERENCES_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { playerId?: unknown; roomId?: unknown };
    return {
      ...(typeof parsed.playerId === "string" ? { playerId: parsed.playerId } : {}),
      ...(typeof parsed.roomId === "string" ? { roomId: parsed.roomId } : {})
    };
  } catch {
    return null;
  }
}

function asStoredAuthSession(
  payload: AuthSessionApiPayload["session"],
  fallbackPlayerId: string,
  fallbackDisplayName: string
): CocosStoredAuthSession {
  const playerId = normalizePlayerId(payload?.playerId) || fallbackPlayerId;
  return {
    playerId,
    displayName: normalizeDisplayName(playerId, payload?.displayName ?? fallbackDisplayName),
    ...(payload?.token ? { token: payload.token } : {}),
    source: "remote"
  };
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  fetchImpl: FetchLike = fetch
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), COCOS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`cocos_request_failed:${response.status}`);
    }

    return (await response.json()) as unknown;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function getCocosLobbyPreferencesStorageKey(): string {
  return LOBBY_PREFERENCES_STORAGE_KEY;
}

export function getCocosPlayerAccountStorageKey(playerId: string): string {
  return `${PLAYER_ACCOUNT_PREFIX}:${playerId}`;
}

export function createCocosGuestPlayerId(randomValue = Math.random()): string {
  return `guest-${Math.floor(Math.max(0, Math.min(0.999999, randomValue)) * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
}

export function createCocosLobbyPreferences(
  overrides: Partial<CocosLobbyPreferences> = {},
  randomValue?: number,
  storage: Pick<Storage, "getItem"> | null | undefined = getCocosStorage()
): CocosLobbyPreferences {
  const stored = storage ? readStoredLobbyPreferencesUnsafe(storage) : null;
  const playerId =
    normalizePlayerId(overrides.playerId) || normalizePlayerId(stored?.playerId) || createCocosGuestPlayerId(randomValue);
  const roomId = normalizeRoomId(overrides.roomId) || normalizeRoomId(stored?.roomId) || DEFAULT_LOBBY_ROOM_ID;
  return { playerId, roomId };
}

export function saveCocosLobbyPreferences(
  playerId: string,
  roomId: string,
  randomValue?: number,
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined = getCocosStorage()
): CocosLobbyPreferences {
  const nextPreferences = createCocosLobbyPreferences({ playerId, roomId }, randomValue, storage);
  storage?.setItem(LOBBY_PREFERENCES_STORAGE_KEY, JSON.stringify(nextPreferences));
  return nextPreferences;
}

export function readPreferredCocosDisplayName(
  playerId: string,
  storage: Pick<Storage, "getItem"> | null | undefined = getCocosStorage()
): string {
  const value = storage?.getItem(getCocosPlayerAccountStorageKey(playerId))?.trim() ?? "";
  return normalizeDisplayName(playerId, value);
}

export function rememberPreferredCocosDisplayName(
  playerId: string,
  displayName: string,
  storage: Pick<Storage, "setItem"> | null | undefined = getCocosStorage()
): string {
  const normalizedDisplayName = normalizeDisplayName(playerId, displayName);
  storage?.setItem(getCocosPlayerAccountStorageKey(playerId), normalizedDisplayName);
  return normalizedDisplayName;
}

export function clearCurrentCocosAuthSession(
  storage: Pick<Storage, "removeItem"> | null | undefined = getCocosStorage()
): void {
  if (!storage) {
    return;
  }

  clearStoredCocosAuthSession(storage);
}

export function resolveCocosApiBaseUrl(
  remoteUrl: string,
  locationLike: Pick<Location, "protocol" | "hostname"> | null | undefined = globalThis.location
): string {
  const normalizedRemoteUrl = remoteUrl.trim();
  if (normalizedRemoteUrl.length > 0) {
    try {
      const parsed = new URL(normalizedRemoteUrl);
      if (parsed.protocol === "ws:") {
        parsed.protocol = "http:";
      } else if (parsed.protocol === "wss:") {
        parsed.protocol = "https:";
      }
      parsed.pathname = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      // Ignore and fall back to browser location below.
    }
  }

  const protocol = locationLike?.protocol === "https:" ? "https" : "http";
  const hostname = locationLike?.hostname || "127.0.0.1";
  return `${protocol}://${hostname}:2567`;
}

export async function loadCocosLobbyRooms(
  remoteUrl: string,
  limit = 6,
  options?: {
    fetchImpl?: FetchLike;
  }
): Promise<CocosLobbyRoomSummary[]> {
  const payload = (await fetchJson(
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/lobby/rooms?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    options?.fetchImpl
  )) as LobbyRoomsApiPayload;
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function loginCocosGuestAuthSession(
  remoteUrl: string,
  playerId: string,
  displayName: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "setItem"> | null;
  }
): Promise<CocosStoredAuthSession> {
  const normalizedPlayerId = normalizePlayerId(playerId) || createCocosGuestPlayerId();
  const normalizedDisplayName = normalizeDisplayName(normalizedPlayerId, displayName);
  const storage = options?.storage ?? getCocosStorage();

  try {
    const payload = (await fetchJson(
      `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/guest-login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          playerId: normalizedPlayerId,
          displayName: normalizedDisplayName
        })
      },
      options?.fetchImpl
    )) as AuthSessionApiPayload;

    const session = asStoredAuthSession(payload.session, normalizedPlayerId, normalizedDisplayName);
    if (storage) {
      writeStoredCocosAuthSession(storage, session);
    }
    return session;
  } catch {
    const session: CocosStoredAuthSession = {
      playerId: normalizedPlayerId,
      displayName: normalizedDisplayName,
      source: "local"
    };
    if (storage) {
      writeStoredCocosAuthSession(storage, session);
    }
    return session;
  }
}
