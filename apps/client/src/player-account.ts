import {
  buildAuthHeaders,
  clearCurrentAuthSession,
  readStoredAuthSession,
  storeAuthSession,
  type StoredAuthSession
} from "./auth-session";
import {
  normalizePlayerProgressionSnapshot,
  normalizeAchievementProgress,
  normalizePlayerBattleReplaySummaries,
  normalizeEventLogEntries,
  type EventLogEntry,
  type PlayerBattleReplaySummary,
  type PlayerAchievementProgress,
  type PlayerProgressionSnapshot
} from "../../../packages/shared/src/index";

const PLAYER_ACCOUNT_PREFIX = "project-veil:player-account";
const PLAYER_ACCOUNT_REQUEST_TIMEOUT_MS = 1200;

export interface PlayerAccountProfile {
  playerId: string;
  displayName: string;
  globalResources: {
    gold: number;
    wood: number;
    ore: number;
  };
  achievements: PlayerAchievementProgress[];
  recentEventLog: EventLogEntry[];
  recentBattleReplays: PlayerBattleReplaySummary[];
  loginId?: string;
  credentialBoundAt?: string;
  lastRoomId?: string;
  lastSeenAt?: string;
  source: "remote" | "local";
}

interface PlayerAccountApiPayload {
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
  session?: {
    token?: string;
    playerId?: string;
    displayName?: string;
    authMode?: "guest" | "account";
    loginId?: string;
  };
}

interface PlayerBattleReplayListApiPayload {
  items?: Partial<PlayerBattleReplaySummary>[];
}

interface PlayerProgressionApiPayload extends Partial<PlayerProgressionSnapshot> {}

function normalizePlayerDisplayName(playerId: string, displayName?: string | null): string {
  const normalizedPlayerId = playerId.trim() || "player";
  const normalizedDisplayName = displayName?.trim();
  return normalizedDisplayName && normalizedDisplayName.length > 0 ? normalizedDisplayName : normalizedPlayerId;
}

function normalizeLoginId(loginId?: string | null): string | undefined {
  const normalized = loginId?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function normalizeGlobalResources(
  resources?: NonNullable<PlayerAccountApiPayload["account"]>["globalResources"] | null
): PlayerAccountProfile["globalResources"] {
  return {
    gold: Math.max(0, Math.floor(resources?.gold ?? 0)),
    wood: Math.max(0, Math.floor(resources?.wood ?? 0)),
    ore: Math.max(0, Math.floor(resources?.ore ?? 0))
  };
}

function getPlayerAccountStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolvePlayerAccountApiBaseUrl(): string {
  const httpProtocol = window.location.protocol === "https:" ? "https" : "http";
  return `${httpProtocol}://${window.location.hostname || "127.0.0.1"}:2567`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PLAYER_ACCOUNT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`player_account_request_failed:${response.status}`);
    }

    return (await response.json()) as unknown;
  } finally {
    window.clearTimeout(timeout);
  }
}

function asStoredAuthSession(
  payload: PlayerAccountApiPayload["session"],
  previousSession: StoredAuthSession
): StoredAuthSession {
  const loginId = normalizeLoginId(payload?.loginId ?? previousSession.loginId);

  return {
    playerId: payload?.playerId?.trim() || previousSession.playerId,
    displayName: payload?.displayName?.trim() || previousSession.displayName,
    authMode: payload?.authMode === "account" || loginId ? "account" : previousSession.authMode,
    ...(loginId ? { loginId } : {}),
    ...(payload?.token ? { token: payload.token } : previousSession.token ? { token: previousSession.token } : {}),
    source: previousSession.source
  };
}

function asPlayerAccountProfile(
  playerId: string,
  roomId: string,
  source: PlayerAccountProfile["source"],
  account?: PlayerAccountApiPayload["account"],
  fallbackDisplayName?: string | null
): PlayerAccountProfile {
  const loginId = normalizeLoginId(account?.loginId);
  return {
    playerId,
    displayName: normalizePlayerDisplayName(playerId, account?.displayName ?? fallbackDisplayName),
    globalResources: normalizeGlobalResources(account?.globalResources),
    achievements: normalizeAchievementProgress(account?.achievements),
    recentEventLog: normalizeEventLogEntries(account?.recentEventLog),
    recentBattleReplays: normalizePlayerBattleReplaySummaries(account?.recentBattleReplays),
    ...(loginId ? { loginId } : {}),
    ...(account?.credentialBoundAt ? { credentialBoundAt: account.credentialBoundAt } : {}),
    ...(account?.lastRoomId ? { lastRoomId: account.lastRoomId } : roomId ? { lastRoomId: roomId } : {}),
    ...(account?.lastSeenAt ? { lastSeenAt: account.lastSeenAt } : {}),
    source
  };
}

export function getPlayerAccountStorageKey(playerId: string): string {
  return `${PLAYER_ACCOUNT_PREFIX}:${playerId}`;
}

export function readStoredPlayerDisplayName(
  storage: Pick<Storage, "getItem">,
  playerId: string
): string | null {
  const value = storage.getItem(getPlayerAccountStorageKey(playerId))?.trim();
  return value && value.length > 0 ? value : null;
}

export function writeStoredPlayerDisplayName(
  storage: Pick<Storage, "setItem">,
  playerId: string,
  displayName: string
): void {
  storage.setItem(getPlayerAccountStorageKey(playerId), normalizePlayerDisplayName(playerId, displayName));
}

export function createFallbackPlayerAccountProfile(
  playerId: string,
  roomId: string,
  displayName?: string | null
): PlayerAccountProfile {
  return {
    playerId,
    displayName: normalizePlayerDisplayName(playerId, displayName),
    globalResources: normalizeGlobalResources(),
    achievements: normalizeAchievementProgress(),
    recentEventLog: normalizeEventLogEntries(),
    recentBattleReplays: normalizePlayerBattleReplaySummaries(),
    ...(roomId ? { lastRoomId: roomId } : {}),
    source: "local"
  };
}

export function readPreferredPlayerDisplayName(playerId: string): string {
  const storage = getPlayerAccountStorage();
  return normalizePlayerDisplayName(playerId, storage ? readStoredPlayerDisplayName(storage, playerId) : null);
}

export function rememberPreferredPlayerDisplayName(playerId: string, displayName: string): string {
  const normalizedDisplayName = normalizePlayerDisplayName(playerId, displayName);
  const storage = getPlayerAccountStorage();
  if (storage) {
    writeStoredPlayerDisplayName(storage, playerId, normalizedDisplayName);
  }

  return normalizedDisplayName;
}

export async function loadPlayerAccountProfile(playerId: string, roomId: string): Promise<PlayerAccountProfile> {
  const storage = getPlayerAccountStorage();
  const storedDisplayName = storage ? readStoredPlayerDisplayName(storage, playerId) : null;
  const authSession = readStoredAuthSession();
  const accountEndpoint = authSession?.token
    ? `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/me`
    : `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/${encodeURIComponent(playerId)}`;

  try {
    const payload = (await fetchJson(accountEndpoint, {
      ...(authSession?.token ? { headers: buildAuthHeaders(authSession.token) } : {})
    })) as PlayerAccountApiPayload;
    const resolvedPlayerId = payload.account?.playerId?.trim() || authSession?.playerId || playerId;
    const profile = asPlayerAccountProfile(resolvedPlayerId, roomId, "remote", payload.account, storedDisplayName);

    if (storage) {
      writeStoredPlayerDisplayName(storage, profile.playerId, profile.displayName);
    }

    if (authSession?.token && payload.session) {
      storeAuthSession(asStoredAuthSession(payload.session, authSession));
    }

    return profile;
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "player_account_request_failed:401") {
      clearCurrentAuthSession();
    }
    return createFallbackPlayerAccountProfile(playerId, roomId, storedDisplayName);
  }
}

export async function loadPlayerBattleReplaySummaries(playerId: string): Promise<PlayerBattleReplaySummary[]> {
  const authSession = readStoredAuthSession();
  const endpoint = authSession?.token
    ? `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/me/battle-replays`
    : `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/${encodeURIComponent(playerId)}/battle-replays`;

  try {
    const payload = (await fetchJson(endpoint, {
      ...(authSession?.token ? { headers: buildAuthHeaders(authSession.token) } : {})
    })) as PlayerBattleReplayListApiPayload;
    return normalizePlayerBattleReplaySummaries(payload.items);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "player_account_request_failed:401") {
      clearCurrentAuthSession();
    }
    return normalizePlayerBattleReplaySummaries();
  }
}

export async function loadPlayerProgressionSnapshot(playerId: string, eventLimit?: number): Promise<PlayerProgressionSnapshot> {
  const authSession = readStoredAuthSession();
  const limitQuery = eventLimit != null ? `?limit=${encodeURIComponent(String(eventLimit))}` : "";
  const endpoint = authSession?.token
    ? `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/me/progression${limitQuery}`
    : `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/${encodeURIComponent(playerId)}/progression${limitQuery}`;

  try {
    const payload = (await fetchJson(endpoint, {
      ...(authSession?.token ? { headers: buildAuthHeaders(authSession.token) } : {})
    })) as PlayerProgressionApiPayload;
    return normalizePlayerProgressionSnapshot(payload);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "player_account_request_failed:401") {
      clearCurrentAuthSession();
    }
    return normalizePlayerProgressionSnapshot();
  }
}

export async function savePlayerAccountDisplayName(
  playerId: string,
  roomId: string,
  displayName: string
): Promise<PlayerAccountProfile> {
  const normalizedDisplayName = rememberPreferredPlayerDisplayName(playerId, displayName);
  const authSession = readStoredAuthSession();
  const accountEndpoint = authSession?.token
    ? `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/me`
    : `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/${encodeURIComponent(playerId)}`;

  try {
    const payload = (await fetchJson(accountEndpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(authSession?.token ? buildAuthHeaders(authSession.token) : {})
      },
      body: JSON.stringify({
        displayName: normalizedDisplayName,
        lastRoomId: roomId
      })
    })) as PlayerAccountApiPayload;

    if (authSession?.token && payload.session) {
      storeAuthSession(asStoredAuthSession(payload.session, authSession));
    }

    const resolvedPlayerId = payload.account?.playerId?.trim() || authSession?.playerId || playerId;
    return asPlayerAccountProfile(resolvedPlayerId, roomId, "remote", payload.account, normalizedDisplayName);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "player_account_request_failed:401") {
      clearCurrentAuthSession();
    }
    return createFallbackPlayerAccountProfile(playerId, roomId, normalizedDisplayName);
  }
}

export async function bindPlayerAccountCredentials(
  loginId: string,
  password: string,
  roomId: string
): Promise<PlayerAccountProfile> {
  const authSession = readStoredAuthSession();
  if (!authSession?.token) {
    throw new Error("auth_session_required");
  }

  const payload = (await fetchJson(`${resolvePlayerAccountApiBaseUrl()}/api/auth/account-bind`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(authSession.token)
    },
    body: JSON.stringify({
      loginId: normalizeLoginId(loginId),
      password
    })
  })) as PlayerAccountApiPayload;

  if (payload.session) {
    storeAuthSession(asStoredAuthSession(payload.session, authSession));
  }

  const resolvedPlayerId = payload.account?.playerId?.trim() || authSession.playerId;
  const profile = asPlayerAccountProfile(
    resolvedPlayerId,
    roomId,
    "remote",
    payload.account,
    authSession.displayName
  );
  rememberPreferredPlayerDisplayName(profile.playerId, profile.displayName);
  return profile;
}
