import {
  clearStoredCocosAuthSession,
  readStoredCocosAuthSession,
  type CocosStoredAuthSession,
  writeStoredCocosAuthSession
} from "./cocos-session-launch.ts";
import {
  normalizePlayerAccountReadModel,
  type EventLogEntry,
  type PlayerAccountReadModel,
  type PlayerBattleReplaySummary,
  type PlayerAchievementProgress
} from "../../../../packages/shared/src/index.ts";

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

export interface CocosPlayerAccountProfile extends PlayerAccountReadModel {
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

interface PlayerAccountApiPayload extends AuthSessionApiPayload {
  account?: {
    playerId?: string;
    displayName?: string;
    globalResources?: {
      gold?: number;
      wood?: number;
      ore?: number;
    };
    achievements?: Partial<PlayerAchievementProgress>[];
    recentEventLog?: Partial<EventLogEntry>[];
    recentBattleReplays?: Partial<PlayerBattleReplaySummary>[];
    loginId?: string;
    credentialBoundAt?: string;
    lastRoomId?: string;
    lastSeenAt?: string;
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

function normalizeLoginId(value?: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
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
  fallback: Pick<CocosStoredAuthSession, "playerId" | "displayName" | "authMode"> &
    Partial<Pick<CocosStoredAuthSession, "loginId" | "token">>
): CocosStoredAuthSession {
  const playerId = normalizePlayerId(payload?.playerId) || fallback.playerId;
  const loginId = normalizeLoginId(payload?.loginId ?? fallback.loginId);
  const authMode = payload?.authMode === "account" || loginId ? "account" : fallback.authMode;

  return {
    playerId,
    displayName: normalizeDisplayName(playerId, payload?.displayName ?? fallback.displayName),
    authMode,
    ...(loginId ? { loginId } : {}),
    ...(payload?.token ? { token: payload.token } : fallback.token ? { token: fallback.token } : {}),
    source: "remote"
  };
}

function asCocosPlayerAccountProfile(
  playerId: string,
  roomId: string,
  source: CocosPlayerAccountProfile["source"],
  account?: PlayerAccountApiPayload["account"],
  fallbackDisplayName?: string | null
): CocosPlayerAccountProfile {
  return {
    ...normalizePlayerAccountReadModel({
      playerId,
      displayName: normalizeDisplayName(playerId, account?.displayName ?? fallbackDisplayName),
      globalResources: account?.globalResources,
      achievements: account?.achievements,
      recentEventLog: account?.recentEventLog,
      recentBattleReplays: account?.recentBattleReplays,
      loginId: normalizeLoginId(account?.loginId),
      credentialBoundAt: account?.credentialBoundAt,
      lastRoomId: account?.lastRoomId ?? roomId,
      lastSeenAt: account?.lastSeenAt
    }),
    source
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

export function createFallbackCocosPlayerAccountProfile(
  playerId: string,
  roomId: string,
  displayName?: string | null
): CocosPlayerAccountProfile {
  return {
    ...normalizePlayerAccountReadModel({
      playerId,
      displayName: normalizeDisplayName(playerId, displayName),
      lastRoomId: roomId
    }),
    source: "local"
  };
}

export function buildCocosAuthHeaders(token?: string | null): HeadersInit {
  return token?.trim()
    ? {
        Authorization: `Bearer ${token.trim()}`
      }
    : {};
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

export function resolveCocosConfigCenterUrl(
  remoteUrl: string,
  locationLike:
    | Pick<Location, "protocol" | "hostname" | "port" | "origin" | "pathname">
    | null
    | undefined = globalThis.location
): string {
  if (locationLike?.pathname?.includes("config-center.html")) {
    return new URL("/config-center.html", locationLike.origin).toString();
  }

  if (locationLike?.port === "4173" && locationLike.origin) {
    return new URL("/config-center.html", locationLike.origin).toString();
  }

  try {
    const apiBaseUrl = new URL(resolveCocosApiBaseUrl(remoteUrl, locationLike));
    apiBaseUrl.port = "4173";
    apiBaseUrl.pathname = "/config-center.html";
    apiBaseUrl.search = "";
    apiBaseUrl.hash = "";
    return apiBaseUrl.toString();
  } catch {
    const protocol = locationLike?.protocol === "https:" ? "https" : "http";
    const hostname = locationLike?.hostname || "127.0.0.1";
    return `${protocol}://${hostname}:4173/config-center.html`;
  }
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

    const session = asStoredAuthSession(payload.session, {
      playerId: normalizedPlayerId,
      displayName: normalizedDisplayName,
      authMode: "guest"
    });
    if (storage) {
      writeStoredCocosAuthSession(storage, session);
    }
    return session;
  } catch {
    const session: CocosStoredAuthSession = {
      playerId: normalizedPlayerId,
      displayName: normalizedDisplayName,
      authMode: "guest",
      source: "local"
    };
    if (storage) {
      writeStoredCocosAuthSession(storage, session);
    }
    return session;
  }
}

export async function loginCocosPasswordAuthSession(
  remoteUrl: string,
  loginId: string,
  password: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "setItem"> | null;
  }
): Promise<CocosStoredAuthSession> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  const payload = (await fetchJson(
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/account-login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: normalizedLoginId,
        password
      })
    },
    options?.fetchImpl
  )) as AuthSessionApiPayload;

  const session = asStoredAuthSession(payload.session, {
    playerId: normalizedLoginId,
    displayName: normalizedLoginId,
    authMode: "account",
    loginId: normalizedLoginId
  });
  const storage = options?.storage ?? getCocosStorage();
  if (storage) {
    writeStoredCocosAuthSession(storage, session);
  }
  return session;
}

export async function syncCurrentCocosAuthSession(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    session?: CocosStoredAuthSession | null;
  }
): Promise<CocosStoredAuthSession | null> {
  const storage = options?.storage ?? getCocosStorage();
  const currentSession =
    options && "session" in options ? options.session ?? null : readStoredCocosAuthSession(storage);
  if (!currentSession?.token) {
    return currentSession;
  }

  try {
    const payload = (await fetchJson(
      `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/session`,
      {
        headers: buildCocosAuthHeaders(currentSession.token)
      },
      options?.fetchImpl
    )) as AuthSessionApiPayload;
    const nextSession = asStoredAuthSession(payload.session, currentSession);
    if (storage) {
      writeStoredCocosAuthSession(storage, nextSession);
    }
    return nextSession;
  } catch (error) {
    if (error instanceof Error && error.message === "cocos_request_failed:401") {
      if (storage) {
        clearStoredCocosAuthSession(storage);
      }
      return null;
    }

    return currentSession;
  }
}

export async function loadCocosPlayerAccountProfile(
  remoteUrl: string,
  playerId: string,
  roomId: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<CocosPlayerAccountProfile> {
  const storage = options?.storage ?? getCocosStorage();
  const storedDisplayName = readPreferredCocosDisplayName(playerId, storage);
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);
  const accountEndpoint = authSession?.token
    ? `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me`
    : `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/${encodeURIComponent(playerId)}`;

  try {
    const payload = (await fetchJson(
      accountEndpoint,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      options?.fetchImpl
    )) as PlayerAccountApiPayload;
    const resolvedPlayerId = payload.account?.playerId?.trim() || authSession?.playerId || playerId;
    const profile = asCocosPlayerAccountProfile(
      resolvedPlayerId,
      roomId,
      "remote",
      payload.account,
      storedDisplayName
    );

    if (storage?.setItem) {
      storage.setItem(getCocosPlayerAccountStorageKey(profile.playerId), profile.displayName);
    }

    if (authSession?.token && payload.session && storage) {
      writeStoredCocosAuthSession(storage, asStoredAuthSession(payload.session, authSession));
    }

    return profile;
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "cocos_request_failed:401" && storage) {
      clearStoredCocosAuthSession(storage);
    }
    return createFallbackCocosPlayerAccountProfile(playerId, roomId, storedDisplayName);
  }
}
