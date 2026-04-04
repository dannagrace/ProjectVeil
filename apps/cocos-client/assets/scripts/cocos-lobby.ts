import {
  clearStoredCocosAuthSession,
  readStoredCocosAuthSession,
  type CocosAuthProvider,
  type CocosStoredAuthSession,
  writeStoredCocosAuthSession
} from "./cocos-session-launch.ts";
import {
  appendEventLogEntries,
  normalizePlayerBattleReportCenter,
  normalizePlayerBattleReplaySummaries,
  normalizePlayerAccountReadModel,
  normalizeEventLogEntries,
  normalizePlayerProgressionSnapshot,
  queryAchievementProgress,
  type AchievementProgressQuery,
  type EventLogEntry,
  type EventLogQuery,
  type PlayerAccountReadModel,
  type PlayerBattleReportCenter,
  type PlayerBattleReportSummary,
  type PlayerProgressionSnapshot,
  type PlayerBattleReplayQuery,
  type PlayerBattleReplaySummary,
  type PlayerAchievementProgress
} from "./project-shared/index.ts";

const LOBBY_PREFERENCES_STORAGE_KEY = "project-veil:lobby-preferences";
const PLAYER_ACCOUNT_PREFIX = "project-veil:player-account";
const DEFAULT_LOBBY_ROOM_ID = "room-alpha";
const COCOS_REQUEST_TIMEOUT_MS = 1200;
const DEFAULT_HISTORY_PAGE_SIZE = 3;

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
  recentBattleReplays: PlayerBattleReplaySummary[];
  source: "remote" | "local";
}

interface AuthSessionApiPayload {
  session?: {
    token?: string;
    refreshToken?: string;
    playerId?: string;
    displayName?: string;
    authMode?: "guest" | "account";
    provider?: CocosAuthProvider;
    loginId?: string;
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

interface PlayerAccountApiPayload extends AuthSessionApiPayload {
  account?: {
    playerId?: string;
    displayName?: string;
    avatarUrl?: string;
    eloRating?: number;
    gems?: number;
    loginStreak?: number;
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

interface DailyClaimApiPayload {
  claimed?: boolean;
  reason?: string;
  streak?: number;
  reward?: {
    gems?: number;
    gold?: number;
  };
}

interface LobbyRoomsApiPayload {
  items?: CocosLobbyRoomSummary[];
}

interface PlayerBattleReplayListApiPayload {
  items?: Partial<PlayerBattleReplaySummary>[];
}

interface PlayerBattleReportCenterApiPayload {
  latestReportId?: string | null;
  items?: Partial<PlayerBattleReportSummary>[];
}

interface PlayerBattleReplayHistoryApiPayload extends PlayerBattleReplayListApiPayload {
  offset?: number;
  limit?: number;
  hasMore?: boolean;
}

interface PlayerEventLogListApiPayload {
  items?: Partial<EventLogEntry>[];
}

interface PlayerEventHistoryApiPayload extends PlayerEventLogListApiPayload {
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
}

interface PlayerAchievementListApiPayload {
  items?: Partial<PlayerAchievementProgress>[];
}

export interface CocosAccountRegistrationRequestResult {
  status: string;
  expiresAt?: string;
  registrationToken?: string;
}

export interface CocosPasswordRecoveryRequestResult {
  status: string;
  expiresAt?: string;
  recoveryToken?: string;
}

export interface CocosBattleReplayHistoryPage {
  items: PlayerBattleReplaySummary[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface CocosEventHistoryPage {
  items: EventLogEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

type PlayerProgressionApiPayload = Partial<PlayerProgressionSnapshot>;
type FetchLike = typeof fetch;
type CocosAuthStorage = Pick<Storage, "removeItem"> | Pick<Storage, "setItem" | "removeItem">;
type WechatMiniGameLoginLike = (options: {
  timeout?: number;
  success?: (result: { code?: string }) => void;
  fail?: (error: { errMsg?: string }) => void;
}) => void;
type WechatMiniGameUserProfileLike = (options: {
  desc: string;
  lang?: string;
  success?: (result: { userInfo?: { nickName?: string; avatarUrl?: string } }) => void;
  fail?: (error: { errMsg?: string }) => void;
}) => void;

function isStorageLike(value: unknown): value is Storage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Storage).getItem === "function" &&
    typeof (value as Storage).setItem === "function" &&
    typeof (value as Storage).removeItem === "function"
  );
}

function getCocosStorage(): Storage | null {
  try {
    const sysStorage = (globalThis as { sys?: { localStorage?: unknown } }).sys?.localStorage;
    if (isStorageLike(sysStorage)) {
      return sysStorage;
    }
  } catch {
    // Ignore and keep falling back to browser storage.
  }

  try {
    const localStorageRef = globalThis.localStorage;
    return isStorageLike(localStorageRef) ? localStorageRef : null;
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

function normalizeAuthProvider(value: unknown, authMode: "guest" | "account", loginId?: string): CocosAuthProvider {
  if (value === "guest" || value === "account-password" || value === "wechat-mini-game") {
    return value;
  }
  if (authMode === "account" || loginId) {
    return "account-password";
  }
  return "guest";
}

function toEventLogQueryString(query?: EventLogQuery): string {
  if (!query) {
    return "";
  }

  const searchParams = new URLSearchParams();
  if (query.limit != null) {
    searchParams.set("limit", String(query.limit));
  }
  if (query.offset != null) {
    searchParams.set("offset", String(query.offset));
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
  if (query.offset != null) {
    searchParams.set("offset", String(query.offset));
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
    Partial<Pick<CocosStoredAuthSession, "loginId" | "token" | "refreshToken" | "expiresAt" | "refreshExpiresAt" | "provider">>
): CocosStoredAuthSession {
  const playerId = normalizePlayerId(payload?.playerId) || fallback.playerId;
  const loginId = normalizeLoginId(payload?.loginId ?? fallback.loginId);
  const authMode = payload?.authMode === "account" || loginId ? "account" : fallback.authMode;
  const provider = normalizeAuthProvider(payload?.provider ?? fallback.provider, authMode, loginId);

  return {
    playerId,
    displayName: normalizeDisplayName(playerId, payload?.displayName ?? fallback.displayName),
    authMode,
    provider,
    ...(loginId ? { loginId } : {}),
    ...(payload?.token ? { token: payload.token } : fallback.token ? { token: fallback.token } : {}),
    ...(payload?.refreshToken ? { refreshToken: payload.refreshToken } : fallback.refreshToken ? { refreshToken: fallback.refreshToken } : {}),
    ...(payload?.expiresAt ? { expiresAt: payload.expiresAt } : fallback.expiresAt ? { expiresAt: fallback.expiresAt } : {}),
    ...(payload?.refreshExpiresAt
      ? { refreshExpiresAt: payload.refreshExpiresAt }
      : fallback.refreshExpiresAt
        ? { refreshExpiresAt: fallback.refreshExpiresAt }
        : {}),
    source: "remote"
  };
}

function asCocosPlayerAccountProfile(
  playerId: string,
  roomId: string,
  source: CocosPlayerAccountProfile["source"],
  account?: PlayerAccountApiPayload["account"],
  fallbackDisplayName?: string | null,
  battleReportCenter?: PlayerBattleReportCenter
): CocosPlayerAccountProfile {
  const accountProfile = normalizePlayerAccountReadModel({
    playerId,
    displayName: normalizeDisplayName(playerId, account?.displayName ?? fallbackDisplayName),
    gems: account?.gems,
    loginStreak: account?.loginStreak,
    globalResources: account?.globalResources,
    eloRating: account?.eloRating,
    achievements: account?.achievements,
    recentEventLog: account?.recentEventLog,
    recentBattleReplays: account?.recentBattleReplays,
    ...(battleReportCenter ? { battleReportCenter } : {}),
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

function createCocosDailyRewardEventLogEntry(
  playerId: string,
  roomId: string,
  streak: number,
  reward: { gems: number; gold: number },
  timestamp = new Date().toISOString()
): EventLogEntry {
  const rewardSummary = [
    reward.gems > 0 ? `宝石 x${reward.gems}` : null,
    reward.gold > 0 ? `金币 x${reward.gold}` : null
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("、");

  return {
    id: `${playerId}:${timestamp}:daily-login:${streak}:client`,
    timestamp,
    roomId,
    playerId,
    category: "account",
    description: `每日签到奖励：连签第 ${streak} 天，获得 ${rewardSummary || "奖励已发放"}。`,
    rewards: [
      ...(reward.gems > 0 ? [{ type: "resource" as const, label: "gems", amount: reward.gems }] : []),
      ...(reward.gold > 0 ? [{ type: "resource" as const, label: "gold", amount: reward.gold }] : [])
    ]
  };
}

async function claimCocosDailyLoginReward(
  remoteUrl: string,
  authSession: CocosStoredAuthSession,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "setItem" | "removeItem"> | null;
  }
): Promise<DailyClaimApiPayload | null> {
  try {
    return (await fetchCocosAuthJson(
      remoteUrl,
      `${resolveCocosApiBaseUrl(remoteUrl)}/api/player/daily-claim`,
      {
        method: "POST"
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options?.storage !== undefined ? { storage: options.storage } : {})
      }
    )) as DailyClaimApiPayload;
  } catch {
    return null;
  }
}

function applyDailyClaimToProfile(
  profile: CocosPlayerAccountProfile,
  claim: DailyClaimApiPayload | null
): CocosPlayerAccountProfile {
  if (!claim?.claimed || !claim.reward) {
    return profile;
  }

  const reward = {
    gems: Math.max(0, Math.floor(claim.reward.gems ?? 0)),
    gold: Math.max(0, Math.floor(claim.reward.gold ?? 0))
  };
  const streak = Math.max(1, Math.floor(claim.streak ?? 1));
  const eventEntry = createCocosDailyRewardEventLogEntry(
    profile.playerId,
    profile.lastRoomId ?? "daily-login",
    streak,
    reward,
    profile.recentEventLog[0]?.timestamp ?? new Date().toISOString()
  );

  return {
    ...profile,
    gems: (profile.gems ?? 0) + reward.gems,
    loginStreak: streak,
    globalResources: {
      ...profile.globalResources,
      gold: profile.globalResources.gold + reward.gold
    },
    recentEventLog: appendEventLogEntries(profile.recentEventLog, [eventEntry])
  };
}

export async function loadCocosBattleReplaySummaries(
  remoteUrl: string,
  playerId: string,
  query?: PlayerBattleReplayQuery,
  options?: {
    fetchImpl?: FetchLike;
    authSession?: CocosStoredAuthSession | null;
    storage?: Pick<Storage, "removeItem"> | null;
    throwOnError?: boolean;
  }
): Promise<PlayerBattleReplaySummary[]> {
  const authSession = options?.authSession ?? null;
  const queryString = toBattleReplayQueryString(query);
  const endpoint = authSession?.token
    ? `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/battle-replays${queryString}`
    : `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/${encodeURIComponent(playerId)}/battle-replays${queryString}`;

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      endpoint,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options ? { storage: options.storage ?? null } : {})
      }
    )) as PlayerBattleReplayListApiPayload;
    return normalizePlayerBattleReplaySummaries(payload.items);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && options?.storage) {
      clearStoredCocosAuthSession(options.storage);
    }
    if (options?.throwOnError) {
      throw error;
    }
    return normalizePlayerBattleReplaySummaries();
  }
}

async function loadCocosBattleReportCenter(
  remoteUrl: string,
  playerId: string,
  query?: PlayerBattleReplayQuery,
  options?: {
    fetchImpl?: FetchLike;
    authSession?: CocosStoredAuthSession | null;
    storage?: Pick<Storage, "removeItem"> | null;
    throwOnError?: boolean;
  }
): Promise<PlayerBattleReportCenter> {
  const authSession = options?.authSession ?? null;
  const queryString = toBattleReplayQueryString(query);
  const endpoint = authSession?.token
    ? `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/battle-reports${queryString}`
    : `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/${encodeURIComponent(playerId)}/battle-reports${queryString}`;

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      endpoint,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options ? { storage: options.storage ?? null } : {})
      }
    )) as PlayerBattleReportCenterApiPayload;
    return normalizePlayerBattleReportCenter(payload as Partial<PlayerBattleReportCenter>, query ? { query } : undefined);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && options?.storage) {
      clearStoredCocosAuthSession(options.storage);
    }
    if (options?.throwOnError) {
      throw error;
    }
    return normalizePlayerBattleReportCenter(undefined, query ? { query } : undefined);
  }
}

export async function loadCocosBattleReplayHistoryPage(
  remoteUrl: string,
  playerId: string,
  query: PlayerBattleReplayQuery,
  options?: {
    fetchImpl?: FetchLike;
    authSession?: CocosStoredAuthSession | null;
    storage?: Pick<Storage, "removeItem"> | null;
    throwOnError?: boolean;
  }
): Promise<CocosBattleReplayHistoryPage> {
  const safeLimit = Math.max(1, Math.floor(query.limit ?? DEFAULT_HISTORY_PAGE_SIZE));
  const safeOffset = Math.max(0, Math.floor(query.offset ?? 0));
  const items = await loadCocosBattleReplaySummaries(
    remoteUrl,
    playerId,
    {
      ...query,
      limit: safeLimit + 1,
      offset: safeOffset
    },
    options
  );

  return {
    items: items.slice(0, safeLimit),
    offset: safeOffset,
    limit: safeLimit,
    hasMore: items.length > safeLimit
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
      let errorCode = "unknown";
      try {
        const payload = (await response.json()) as { error?: { code?: string } };
        errorCode = payload.error?.code?.trim() || errorCode;
      } catch {
        errorCode = "unknown";
      }
      throw new Error(`cocos_request_failed:${response.status}:${errorCode}`);
    }

    return (await response.json()) as unknown;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function isCocosError(error: unknown, status: number, code?: string): boolean {
  return error instanceof Error && error.message === `cocos_request_failed:${status}:${code ?? "unknown"}`;
}

async function refreshCocosAuthSession(
  remoteUrl: string,
  currentSession: CocosStoredAuthSession,
  options?: {
    fetchImpl?: FetchLike;
    storage?: CocosAuthStorage | null;
  }
): Promise<CocosStoredAuthSession | null> {
  if (!currentSession.refreshToken) {
    options?.storage && clearStoredCocosAuthSession(options.storage);
    return null;
  }

  try {
    const payload = (await fetchJson(
      `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/refresh`,
      {
        method: "POST",
        headers: buildCocosAuthHeaders(currentSession.refreshToken)
      },
      options?.fetchImpl
    )) as AuthSessionApiPayload;
    const nextSession = asStoredAuthSession(payload.session, currentSession);
    if (options?.storage && "setItem" in options.storage) {
      writeStoredCocosAuthSession(options.storage, nextSession);
    }
    return nextSession;
  } catch {
    options?.storage && clearStoredCocosAuthSession(options.storage);
    return null;
  }
}

async function fetchCocosAuthJson(
  remoteUrl: string,
  url: string,
  init: RequestInit | undefined,
  authSession: CocosStoredAuthSession | null,
  options?: {
    fetchImpl?: FetchLike;
    storage?: CocosAuthStorage | null;
  }
): Promise<unknown> {
  const requestInit = {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...buildCocosAuthHeaders(authSession?.token)
    }
  } satisfies RequestInit;

  try {
    return await fetchJson(url, requestInit, options?.fetchImpl);
  } catch (error) {
    if (isCocosError(error, 401, "token_expired") && authSession?.refreshToken) {
      const refreshedSession = await refreshCocosAuthSession(remoteUrl, authSession, options);
      if (refreshedSession?.token) {
        return fetchJson(
          url,
          {
            ...init,
            headers: {
              ...(init?.headers ?? {}),
              ...buildCocosAuthHeaders(refreshedSession.token)
            }
          },
          options?.fetchImpl
        );
      }
    }

    if (error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && options?.storage) {
      clearStoredCocosAuthSession(options.storage);
    }
    throw error;
  }
}

async function requestWechatMiniGameCode(input: {
  wx?: { login?: WechatMiniGameLoginLike | undefined } | null;
  timeoutMs?: number;
  mockCode?: string;
}): Promise<{ code: string; source: "wx.login" | "mock-config" }> {
  if (typeof input.wx?.login === "function") {
    const timeoutMs = Math.max(100, input.timeoutMs ?? 4_000);
    return new Promise((resolve, reject) => {
      input.wx?.login?.({
        timeout: timeoutMs,
        success: (result) => {
          const code = result.code?.trim();
          if (!code) {
            reject(new Error("wechat_login_missing_code"));
            return;
          }
          resolve({ code, source: "wx.login" });
        },
        fail: (error) => {
          reject(new Error(error.errMsg?.trim() || "wechat_login_failed"));
        }
      });
    });
  }

  const mockCode = input.mockCode?.trim();
  if (mockCode) {
    return {
      code: mockCode,
      source: "mock-config"
    };
  }

  throw new Error("wechat_login_unavailable");
}

async function requestWechatMiniGameUserProfile(input: {
  wx?: { getUserProfile?: WechatMiniGameUserProfileLike | undefined } | null;
  fallbackDisplayName: string;
}): Promise<{ displayName: string; avatarUrl?: string }> {
  if (typeof input.wx?.getUserProfile !== "function") {
    return {
      displayName: input.fallbackDisplayName
    };
  }

  try {
    return await new Promise((resolve, reject) => {
      input.wx?.getUserProfile?.({
        desc: "用于同步 Project Veil 小游戏头像与昵称",
        lang: "zh_CN",
        success: (result) => {
          resolve({
            displayName: result.userInfo?.nickName?.trim() || input.fallbackDisplayName,
            ...(result.userInfo?.avatarUrl?.trim() ? { avatarUrl: result.userInfo.avatarUrl.trim() } : {})
          });
        },
        fail: (error) => {
          reject(new Error(error.errMsg?.trim() || "wechat_profile_failed"));
        }
      });
    });
  } catch {
    return {
      displayName: input.fallbackDisplayName
    };
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
  const accountProfile = normalizePlayerAccountReadModel({
    playerId,
    displayName: normalizeDisplayName(playerId, displayName),
    lastRoomId: roomId
  });

  return {
    ...accountProfile,
    recentBattleReplays: accountProfile.recentBattleReplays ?? [],
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

export async function logoutCurrentCocosAuthSession(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
  }
): Promise<void> {
  const storage = options?.storage ?? getCocosStorage();
  const currentSession = readStoredCocosAuthSession(storage);
  if (currentSession?.token) {
    try {
      await fetchJson(
        `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/logout`,
        {
          method: "POST",
          headers: buildCocosAuthHeaders(currentSession.token)
        },
        options?.fetchImpl
      );
    } catch {
      // Local cleanup still proceeds.
    }
  }

  if (storage) {
    clearStoredCocosAuthSession(storage);
  }
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
    privacyConsentAccepted?: boolean;
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
          displayName: normalizedDisplayName,
          ...(options?.privacyConsentAccepted ? { privacyConsentAccepted: true } : {})
        })
      },
      options?.fetchImpl
    )) as AuthSessionApiPayload;

    const session = asStoredAuthSession(payload.session, {
      playerId: normalizedPlayerId,
      displayName: normalizedDisplayName,
      authMode: "guest",
      provider: "guest"
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
      provider: "guest",
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
    privacyConsentAccepted?: boolean;
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
        password,
        ...(options?.privacyConsentAccepted ? { privacyConsentAccepted: true } : {})
      })
    },
    options?.fetchImpl
  )) as AuthSessionApiPayload;

  const session = asStoredAuthSession(payload.session, {
    playerId: normalizedLoginId,
    displayName: normalizedLoginId,
    authMode: "account",
    provider: "account-password",
    loginId: normalizedLoginId
  });
  const storage = options?.storage ?? getCocosStorage();
  if (storage) {
    writeStoredCocosAuthSession(storage, session);
  }
  return session;
}

export async function requestCocosAccountRegistration(
  remoteUrl: string,
  loginId: string,
  displayName?: string,
  options?: {
    fetchImpl?: FetchLike;
  }
): Promise<CocosAccountRegistrationRequestResult> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  const payload = (await fetchJson(
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/account-registration/request`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: normalizedLoginId,
        ...(displayName?.trim() ? { displayName: displayName.trim() } : {})
      })
    },
    options?.fetchImpl
  )) as AccountAuthApiPayload;

  return {
    status: payload.status ?? "registration_requested",
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    ...(payload.registrationToken ? { registrationToken: payload.registrationToken } : {})
  };
}

export async function confirmCocosAccountRegistration(
  remoteUrl: string,
  loginId: string,
  registrationToken: string,
  password: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "setItem"> | null;
    privacyConsentAccepted?: boolean;
  }
): Promise<CocosStoredAuthSession> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  const payload = (await fetchJson(
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/account-registration/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: normalizedLoginId,
        registrationToken,
        password,
        ...(options?.privacyConsentAccepted ? { privacyConsentAccepted: true } : {})
      })
    },
    options?.fetchImpl
  )) as AccountAuthApiPayload;

  const session = asStoredAuthSession(payload.session, {
    playerId: normalizePlayerId(payload.account?.playerId) || normalizedLoginId,
    displayName: payload.account?.displayName?.trim() || normalizedLoginId,
    authMode: "account",
    provider: "account-password",
    loginId: normalizeLoginId(payload.account?.loginId) ?? normalizedLoginId
  });
  const storage = options?.storage ?? getCocosStorage();
  if (storage) {
    writeStoredCocosAuthSession(storage, session);
  }
  return session;
}

export async function requestCocosPasswordRecovery(
  remoteUrl: string,
  loginId: string,
  options?: {
    fetchImpl?: FetchLike;
  }
): Promise<CocosPasswordRecoveryRequestResult> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  const payload = (await fetchJson(
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/password-recovery/request`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: normalizedLoginId
      })
    },
    options?.fetchImpl
  )) as AccountAuthApiPayload;

  return {
    status: payload.status ?? "recovery_requested",
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    ...(payload.recoveryToken ? { recoveryToken: payload.recoveryToken } : {})
  };
}

export async function confirmCocosPasswordRecovery(
  remoteUrl: string,
  loginId: string,
  recoveryToken: string,
  newPassword: string,
  options?: {
    fetchImpl?: FetchLike;
  }
): Promise<void> {
  const normalizedLoginId = normalizeLoginId(loginId);
  if (!normalizedLoginId) {
    throw new Error("loginId_required");
  }

  await fetchJson(
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/password-recovery/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: normalizedLoginId,
        recoveryToken,
        newPassword
      })
    },
    options?.fetchImpl
  );
}

export async function loginCocosWechatAuthSession(
  remoteUrl: string,
  playerId: string,
  displayName: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "setItem"> | null;
    wx?: {
      login?: WechatMiniGameLoginLike | undefined;
      getUserProfile?: WechatMiniGameUserProfileLike | undefined;
    } | null;
    timeoutMs?: number;
    exchangePath?: string;
    mockCode?: string;
    authToken?: string | null;
    privacyConsentAccepted?: boolean;
  }
): Promise<CocosStoredAuthSession> {
  const normalizedPlayerId = normalizePlayerId(playerId) || createCocosGuestPlayerId();
  const normalizedDisplayName = normalizeDisplayName(normalizedPlayerId, displayName);
  const storage = options?.storage ?? getCocosStorage();
  const wxEnvironment =
    options?.wx ??
    ((globalThis as {
      wx?: { login?: WechatMiniGameLoginLike | undefined; getUserProfile?: WechatMiniGameUserProfileLike | undefined };
    }).wx ?? null);
  const profile = await requestWechatMiniGameUserProfile({
    wx: wxEnvironment,
    fallbackDisplayName: normalizedDisplayName
  });
  const { code } = await requestWechatMiniGameCode({
    wx: wxEnvironment,
    ...(options?.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.mockCode ? { mockCode: options.mockCode } : {})
  });
  const exchangePath = options?.exchangePath?.trim() || "/api/auth/wechat-login";

  const payload = (await fetchJson(
    `${resolveCocosApiBaseUrl(remoteUrl)}${exchangePath.startsWith("/") ? exchangePath : `/${exchangePath}`}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildCocosAuthHeaders(options?.authToken)
      },
      body: JSON.stringify({
        code,
        playerId: normalizedPlayerId,
        displayName: profile.displayName,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        ...(options?.privacyConsentAccepted ? { privacyConsentAccepted: true } : {})
      })
    },
    options?.fetchImpl
  )) as AuthSessionApiPayload;

  const session = asStoredAuthSession(payload.session, {
    playerId: normalizedPlayerId,
    displayName: profile.displayName,
    authMode: "guest",
    provider: "wechat-mini-game"
  });
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
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      `${resolveCocosApiBaseUrl(remoteUrl)}/api/auth/session`,
      {
        headers: buildCocosAuthHeaders(currentSession.token)
      },
      currentSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as AuthSessionApiPayload;
    const nextSession = asStoredAuthSession(payload.session, currentSession);
    if (storage) {
      writeStoredCocosAuthSession(storage, nextSession);
    }
    return nextSession;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("cocos_request_failed:401:")) {
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
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      accountEndpoint,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as PlayerAccountApiPayload;
    const resolvedPlayerId = payload.account?.playerId?.trim() || authSession?.playerId || playerId;
    const [recentBattleReplays, battleReportCenter] = await Promise.all([
      loadCocosBattleReplaySummaries(remoteUrl, resolvedPlayerId, undefined, {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        authSession: authSession ?? null,
        storage
      }),
      loadCocosBattleReportCenter(remoteUrl, resolvedPlayerId, undefined, {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        authSession: authSession ?? null,
        storage
      })
    ]);
    const profile = asCocosPlayerAccountProfile(
      resolvedPlayerId,
      roomId,
      "remote",
      payload.account,
      storedDisplayName,
      battleReportCenter
    );

    const profileWithDailyClaim =
      authSession?.token && authSession
        ? applyDailyClaimToProfile(
            profile,
            await claimCocosDailyLoginReward(remoteUrl, authSession, {
              ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
              storage
            })
          )
        : profile;

    if (storage?.setItem) {
      storage.setItem(getCocosPlayerAccountStorageKey(profileWithDailyClaim.playerId), profileWithDailyClaim.displayName);
    }

    if (authSession?.token && payload.session && storage) {
      writeStoredCocosAuthSession(storage, asStoredAuthSession(payload.session, authSession));
    }

    return {
      ...profileWithDailyClaim,
      recentBattleReplays
    };
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && storage) {
      clearStoredCocosAuthSession(storage);
    }
    return createFallbackCocosPlayerAccountProfile(playerId, roomId, storedDisplayName);
  }
}

export async function loadCocosPlayerEventLog(
  remoteUrl: string,
  playerId: string,
  query?: EventLogQuery,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<EventLogEntry[]> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);
  const queryString = toEventLogQueryString(query);
  const endpoint = authSession?.token
    ? `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/event-log${queryString}`
    : `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/${encodeURIComponent(playerId)}/event-log${queryString}`;

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      endpoint,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as PlayerEventLogListApiPayload;
    return normalizeEventLogEntries(payload.items);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && storage) {
      clearStoredCocosAuthSession(storage);
    }
    return normalizeEventLogEntries();
  }
}

export async function loadCocosPlayerEventHistory(
  remoteUrl: string,
  playerId: string,
  query?: EventLogQuery,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
    throwOnError?: boolean;
  }
): Promise<CocosEventHistoryPage> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);
  const queryString = toEventLogQueryString(query);
  const endpoint = authSession?.token
    ? `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/event-history${queryString}`
    : `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/${encodeURIComponent(playerId)}/event-history${queryString}`;

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      endpoint,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as PlayerEventHistoryApiPayload;
    const safeLimit = Math.max(1, Math.floor(payload.limit ?? query?.limit ?? DEFAULT_HISTORY_PAGE_SIZE));
    const safeOffset = Math.max(0, Math.floor(payload.offset ?? query?.offset ?? 0));
    const items = normalizeEventLogEntries(payload.items);
    return {
      items,
      total: Math.max(items.length, Math.floor(payload.total ?? items.length)),
      offset: safeOffset,
      limit: safeLimit,
      hasMore: Boolean(payload.hasMore)
    };
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && storage) {
      clearStoredCocosAuthSession(storage);
    }
    if (options?.throwOnError) {
      throw error;
    }
    const safeLimit = Math.max(1, Math.floor(query?.limit ?? DEFAULT_HISTORY_PAGE_SIZE));
    const safeOffset = Math.max(0, Math.floor(query?.offset ?? 0));
    return {
      items: normalizeEventLogEntries(),
      total: 0,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: false
    };
  }
}

export async function loadCocosPlayerAchievementProgress(
  remoteUrl: string,
  playerId: string,
  query?: AchievementProgressQuery,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
    throwOnError?: boolean;
  }
): Promise<PlayerAchievementProgress[]> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);
  const queryString = toAchievementQueryString(query);
  const endpoint = authSession?.token
    ? `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/achievements${queryString}`
    : `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/${encodeURIComponent(playerId)}/achievements${queryString}`;

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      endpoint,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as PlayerAchievementListApiPayload;
    return queryAchievementProgress(payload.items, query);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && storage) {
      clearStoredCocosAuthSession(storage);
    }
    if (options?.throwOnError) {
      throw error;
    }
    return queryAchievementProgress(undefined, query);
  }
}

export async function loadCocosPlayerProgressionSnapshot(
  remoteUrl: string,
  playerId: string,
  eventLimit?: number,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
    throwOnError?: boolean;
  }
): Promise<PlayerProgressionSnapshot> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);
  const limitQuery = eventLimit != null ? `?limit=${encodeURIComponent(String(eventLimit))}` : "";
  const endpoint = authSession?.token
    ? `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/progression${limitQuery}`
    : `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/${encodeURIComponent(playerId)}/progression${limitQuery}`;

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      endpoint,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as PlayerProgressionApiPayload;
    return normalizePlayerProgressionSnapshot(payload);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && storage) {
      clearStoredCocosAuthSession(storage);
    }
    if (options?.throwOnError) {
      throw error;
    }
    return normalizePlayerProgressionSnapshot();
  }
}
