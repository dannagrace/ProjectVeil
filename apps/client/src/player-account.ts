import {
  buildAuthHeaders,
  clearCurrentAuthSession,
  readStoredAuthSession,
  storeAuthSession,
  type StoredAuthSession
} from "./auth-session";
import {
  restoreBattleReplayPlaybackState,
  type BattleReplayPlaybackCommand,
  type BattleReplayPlaybackState,
  type AchievementProgressQuery,
  type PlayerBattleReplayQuery,
  findPlayerBattleReplaySummary,
  normalizePlayerProgressionSnapshot,
  normalizePlayerAccountReadModel,
  queryPlayerBattleReplaySummaries,
  queryAchievementProgress,
  normalizeEventLogEntries,
  type EventLogQuery,
  type EventLogEntry,
  type PlayerAccountReadModel,
  type PlayerBattleReplaySummary,
  type PlayerAchievementProgress,
  type PlayerProgressionSnapshot
} from "../../../packages/shared/src/index";

const PLAYER_ACCOUNT_PREFIX = "project-veil:player-account";
const PLAYER_ACCOUNT_REQUEST_TIMEOUT_MS = 1200;

export interface PlayerAccountProfile extends PlayerAccountReadModel {
  recentBattleReplays: PlayerBattleReplaySummary[];
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

interface PlayerBattleReplayDetailApiPayload {
  replay?: Partial<PlayerBattleReplaySummary>;
}

interface PlayerBattleReplayPlaybackApiPayload {
  playback?: {
    replay?: Partial<PlayerBattleReplaySummary>;
    status?: BattleReplayPlaybackState["status"];
    currentStepIndex?: number;
  };
}

interface PlayerEventLogListApiPayload {
  items?: Partial<EventLogEntry>[];
}

interface PlayerAchievementListApiPayload {
  items?: Partial<PlayerAchievementProgress>[];
}

interface PlayerProgressionApiPayload extends Partial<PlayerProgressionSnapshot> {}

function hasMeaningfulProgressionSnapshot(snapshot: PlayerProgressionSnapshot): boolean {
  return (
    snapshot.summary.unlockedAchievements > 0 ||
    snapshot.summary.inProgressAchievements > 0 ||
    snapshot.summary.recentEventCount > 0 ||
    snapshot.achievements.some(
      (achievement) =>
        achievement.current > 0 || achievement.unlocked || Boolean(achievement.progressUpdatedAt) || Boolean(achievement.unlockedAt)
    ) ||
    snapshot.recentEventLog.length > 0
  );
}

function normalizePlayerDisplayName(playerId: string, displayName?: string | null): string {
  const normalizedPlayerId = playerId.trim() || "player";
  const normalizedDisplayName = displayName?.trim();
  return normalizedDisplayName && normalizedDisplayName.length > 0 ? normalizedDisplayName : normalizedPlayerId;
}

function normalizeLoginId(loginId?: string | null): string | undefined {
  const normalized = loginId?.trim().toLowerCase();
  return normalized ? normalized : undefined;
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

function toEventLogQueryString(query?: EventLogQuery): string {
  if (!query) {
    return "";
  }

  const searchParams = new URLSearchParams();
  if (query.limit != null) {
    searchParams.set("limit", String(query.limit));
  }
  if (query.category) {
    searchParams.set("category", query.category);
  }
  if (query.heroId) {
    searchParams.set("heroId", query.heroId);
  }
  if (query.achievementId) {
    searchParams.set("achievementId", query.achievementId);
  }
  if (query.worldEventType) {
    searchParams.set("worldEventType", query.worldEventType);
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
}

function toBattleReplayQueryString(query?: PlayerBattleReplayQuery): string {
  if (!query) {
    return "";
  }

  const searchParams = new URLSearchParams();
  if (query.limit != null) {
    searchParams.set("limit", String(query.limit));
  }
  if (query.roomId) {
    searchParams.set("roomId", query.roomId);
  }
  if (query.battleId) {
    searchParams.set("battleId", query.battleId);
  }
  if (query.battleKind) {
    searchParams.set("battleKind", query.battleKind);
  }
  if (query.playerCamp) {
    searchParams.set("playerCamp", query.playerCamp);
  }
  if (query.heroId) {
    searchParams.set("heroId", query.heroId);
  }
  if (query.opponentHeroId) {
    searchParams.set("opponentHeroId", query.opponentHeroId);
  }
  if (query.neutralArmyId) {
    searchParams.set("neutralArmyId", query.neutralArmyId);
  }
  if (query.result) {
    searchParams.set("result", query.result);
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
}

function toBattleReplayPlaybackQueryString(command?: BattleReplayPlaybackCommand): string {
  if (!command) {
    return "";
  }

  const searchParams = new URLSearchParams();
  if (command.currentStepIndex != null) {
    searchParams.set("currentStepIndex", String(command.currentStepIndex));
  }
  if (command.status) {
    searchParams.set("status", command.status);
  }
  if (command.action) {
    searchParams.set("action", command.action);
  }
  if (command.repeat != null) {
    searchParams.set("repeat", String(command.repeat));
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
}

function toAchievementQueryString(query?: AchievementProgressQuery): string {
  if (!query) {
    return "";
  }

  const searchParams = new URLSearchParams();
  if (query.limit != null) {
    searchParams.set("limit", String(query.limit));
  }
  if (query.achievementId) {
    searchParams.set("achievementId", query.achievementId);
  }
  if (query.metric) {
    searchParams.set("metric", query.metric);
  }
  if (query.unlocked != null) {
    searchParams.set("unlocked", String(query.unlocked));
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
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
  const accountProfile = normalizePlayerAccountReadModel({
    playerId,
    displayName: normalizePlayerDisplayName(playerId, account?.displayName ?? fallbackDisplayName),
    globalResources: account?.globalResources,
    achievements: account?.achievements,
    recentEventLog: account?.recentEventLog,
    recentBattleReplays: account?.recentBattleReplays,
    loginId: normalizeLoginId(account?.loginId),
    credentialBoundAt: account?.credentialBoundAt,
    lastRoomId: account?.lastRoomId ?? roomId,
    lastSeenAt: account?.lastSeenAt
  });

  return {
    ...accountProfile,
    recentBattleReplays: accountProfile.recentBattleReplays ?? [],
    source
  };
}

async function loadPlayerBattleReplaySummariesWithSession(
  playerId: string,
  authSession: StoredAuthSession | null,
  query?: PlayerBattleReplayQuery
): Promise<PlayerBattleReplaySummary[]> {
  const queryString = toBattleReplayQueryString(query);
  const endpoint = authSession?.token
    ? `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/me/battle-replays${queryString}`
    : `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/${encodeURIComponent(playerId)}/battle-replays${queryString}`;

  try {
    const payload = (await fetchJson(endpoint, {
      ...(authSession?.token ? { headers: buildAuthHeaders(authSession.token) } : {})
    })) as PlayerBattleReplayListApiPayload;
    return queryPlayerBattleReplaySummaries(payload.items, query);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "player_account_request_failed:401") {
      clearCurrentAuthSession();
    }
    return queryPlayerBattleReplaySummaries(undefined, query);
  }
}

function normalizePlayerBattleReplayPlayback(
  replayId: string,
  payload?: PlayerBattleReplayPlaybackApiPayload["playback"]
): BattleReplayPlaybackState | null {
  const replay = findPlayerBattleReplaySummary(payload?.replay ? [payload.replay] : undefined, replayId);
  if (!replay) {
    return null;
  }

  return restoreBattleReplayPlaybackState(
    replay,
    payload?.currentStepIndex,
    payload?.status === "playing" ? "playing" : "paused"
  );
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
  const accountProfile = normalizePlayerAccountReadModel({
    playerId,
    displayName: normalizePlayerDisplayName(playerId, displayName),
    lastRoomId: roomId
  });

  return {
    ...accountProfile,
    recentBattleReplays: accountProfile.recentBattleReplays ?? [],
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
    const recentBattleReplays = await loadPlayerBattleReplaySummariesWithSession(resolvedPlayerId, authSession ?? null);
    const profile = {
      ...asPlayerAccountProfile(resolvedPlayerId, roomId, "remote", payload.account, storedDisplayName),
      recentBattleReplays
    };

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

export async function loadPlayerBattleReplaySummaries(
  playerId: string,
  query?: PlayerBattleReplayQuery
): Promise<PlayerBattleReplaySummary[]> {
  const authSession = readStoredAuthSession();
  return loadPlayerBattleReplaySummariesWithSession(playerId, authSession ?? null, query);
}

export async function loadPlayerBattleReplayDetail(
  playerId: string,
  replayId: string
): Promise<PlayerBattleReplaySummary | null> {
  const authSession = readStoredAuthSession();
  const endpoint = authSession?.token
    ? `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/me/battle-replays/${encodeURIComponent(replayId)}`
    : `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/${encodeURIComponent(playerId)}/battle-replays/${encodeURIComponent(replayId)}`;

  try {
    const payload = (await fetchJson(endpoint, {
      ...(authSession?.token ? { headers: buildAuthHeaders(authSession.token) } : {})
    })) as PlayerBattleReplayDetailApiPayload;
    return findPlayerBattleReplaySummary(payload.replay ? [payload.replay] : undefined, replayId);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "player_account_request_failed:401") {
      clearCurrentAuthSession();
    }
    return null;
  }
}

export async function loadPlayerBattleReplayPlayback(
  playerId: string,
  replayId: string,
  command?: BattleReplayPlaybackCommand
): Promise<BattleReplayPlaybackState | null> {
  const authSession = readStoredAuthSession();
  const queryString = toBattleReplayPlaybackQueryString(command);
  const endpoint = authSession?.token
    ? `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/me/battle-replays/${encodeURIComponent(replayId)}/playback${queryString}`
    : `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/${encodeURIComponent(playerId)}/battle-replays/${encodeURIComponent(replayId)}/playback${queryString}`;

  try {
    const payload = (await fetchJson(endpoint, {
      ...(authSession?.token ? { headers: buildAuthHeaders(authSession.token) } : {})
    })) as PlayerBattleReplayPlaybackApiPayload;
    return normalizePlayerBattleReplayPlayback(replayId, payload.playback);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "player_account_request_failed:401") {
      clearCurrentAuthSession();
    }
    return null;
  }
}

export async function loadPlayerEventLog(playerId: string, query?: EventLogQuery): Promise<EventLogEntry[]> {
  const authSession = readStoredAuthSession();
  const queryString = toEventLogQueryString(query);
  const endpoint = authSession?.token
    ? `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/me/event-log${queryString}`
    : `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/${encodeURIComponent(playerId)}/event-log${queryString}`;

  try {
    const payload = (await fetchJson(endpoint, {
      ...(authSession?.token ? { headers: buildAuthHeaders(authSession.token) } : {})
    })) as PlayerEventLogListApiPayload;
    return normalizeEventLogEntries(payload.items);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "player_account_request_failed:401") {
      clearCurrentAuthSession();
    }
    return normalizeEventLogEntries();
  }
}

export async function loadPlayerAchievementProgress(
  playerId: string,
  query?: AchievementProgressQuery
): Promise<PlayerAchievementProgress[]> {
  const authSession = readStoredAuthSession();
  const queryString = toAchievementQueryString(query);
  const endpoint = authSession?.token
    ? `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/me/achievements${queryString}`
    : `${resolvePlayerAccountApiBaseUrl()}/api/player-accounts/${encodeURIComponent(playerId)}/achievements${queryString}`;

  try {
    const payload = (await fetchJson(endpoint, {
      ...(authSession?.token ? { headers: buildAuthHeaders(authSession.token) } : {})
    })) as PlayerAchievementListApiPayload;
    return queryAchievementProgress(payload.items, query);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message === "player_account_request_failed:401") {
      clearCurrentAuthSession();
    }
    return queryAchievementProgress(undefined, query);
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

export function applyPlayerProgressionSnapshot(
  account: PlayerAccountProfile,
  snapshot: PlayerProgressionSnapshot
): PlayerAccountProfile {
  if (!hasMeaningfulProgressionSnapshot(snapshot)) {
    return account;
  }

  return {
    ...account,
    achievements: snapshot.achievements,
    recentEventLog: snapshot.recentEventLog
  };
}

export async function loadPlayerAccountProfileWithProgression(
  playerId: string,
  roomId: string,
  eventLimit?: number
): Promise<PlayerAccountProfile> {
  const account = await loadPlayerAccountProfile(playerId, roomId);
  const snapshot = await loadPlayerProgressionSnapshot(playerId, eventLimit);
  return applyPlayerProgressionSnapshot(account, snapshot);
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
