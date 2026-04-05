import { sys } from "cc";
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
  type PlayerAchievementProgress,
  type TutorialProgressAction
} from "./project-shared/index.ts";
import type {
  CampaignMissionState,
  CampaignReward,
  CampaignUnlockRequirement,
  DailyDungeonDefinition,
  DailyDungeonRunRecord
} from "../../../../packages/shared/src/index.ts";
import type {
  CocosDailyDungeonSummary,
  CocosSeasonProgress
} from "./cocos-progression-panel.ts";
import { detectCocosRuntimePlatform } from "./cocos-runtime-platform.ts";

const LOBBY_PREFERENCES_STORAGE_KEY = "project-veil:lobby-preferences";
const PLAYER_ACCOUNT_PREFIX = "project-veil:player-account";
const WECHAT_SUBSCRIBE_CONSENT_STORAGE_KEY = "project-veil:wechat-subscribe-consent";
const DEFAULT_LOBBY_ROOM_ID = "room-alpha";
const COCOS_REQUEST_TIMEOUT_MS = 1200;
const DEFAULT_HISTORY_PAGE_SIZE = 3;
let wechatSubscribeConsentRequestedThisSession = false;

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

export interface CocosCampaignSummary {
  missions: CampaignMissionState[];
  completedCount: number;
  totalMissions: number;
  nextMissionId: string | null;
  completionPercent: number;
}

export interface CocosCampaignMissionStartResult {
  started: boolean;
  mission: CampaignMissionState;
}

export interface CocosCampaignMissionCompleteResult {
  completed: boolean;
  mission: CampaignMissionState;
  reward: CampaignReward;
  campaign: CocosCampaignSummary;
}

export interface CocosCampaignMissionLockedError extends Error {
  unlockRequirements?: CampaignUnlockRequirement[];
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
    tutorialStep?: number | null;
    dailyQuestBoard?: PlayerAccountReadModel["dailyQuestBoard"];
    mailbox?: PlayerAccountReadModel["mailbox"];
    mailboxSummary?: PlayerAccountReadModel["mailboxSummary"];
    loginId?: string;
    credentialBoundAt?: string;
    lastRoomId?: string;
    lastSeenAt?: string;
  };
}

interface PlayerMailboxApiPayload {
  items?: PlayerAccountReadModel["mailbox"];
  summary?: PlayerAccountReadModel["mailboxSummary"];
  claimed?: boolean;
  claimedMessageIds?: string[];
  reason?: string;
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

interface PlayerReferralApiPayload {
  claimed: boolean;
  rewardGems: number;
  referrerId: string;
  newPlayerId: string;
}

interface LobbyRoomsApiPayload {
  items?: CocosLobbyRoomSummary[];
}

interface CampaignApiPayload {
  campaign?: Partial<CocosCampaignSummary>;
}

interface CampaignMissionStartApiPayload {
  started?: boolean;
  mission?: Partial<CampaignMissionState>;
}

interface CampaignMissionCompleteApiPayload {
  completed?: boolean;
  mission?: Partial<CampaignMissionState>;
  reward?: Partial<CampaignReward>;
  campaign?: Partial<CocosCampaignSummary>;
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

interface PlayerSeasonProgressApiPayload {
  battlePassEnabled?: boolean;
  seasonXp?: number;
  seasonPassTier?: number;
  seasonPassPremium?: boolean;
  seasonPassClaimedTiers?: number[];
}

interface DailyDungeonApiPayload {
  dailyDungeon?: {
    dungeon?: Partial<DailyDungeonDefinition> & {
      floors?: Array<{
        floor?: number;
        recommendedHeroLevel?: number;
        enemyArmyTemplateId?: string;
        enemyArmyCount?: number;
        enemyStatMultiplier?: number;
        reward?: {
          gems?: number;
          resources?: {
            gold?: number;
            wood?: number;
            ore?: number;
          };
        };
      }> | null;
    };
    dateKey?: string;
    attemptsUsed?: number;
    attemptsRemaining?: number;
    runs?: Partial<DailyDungeonRunRecord>[] | null;
  };
}

interface SeasonalEventLeaderboardEntryApiPayload {
  rank?: number;
  playerId?: string;
  displayName?: string;
  points?: number;
  lastUpdatedAt?: string;
  rewardPreview?: string;
}

interface SeasonalEventRewardTierApiPayload {
  rankStart?: number;
  rankEnd?: number;
  title?: string;
  badge?: string;
  cosmeticId?: string;
}

interface SeasonalEventRewardApiPayload {
  id?: string;
  name?: string;
  pointsRequired?: number;
  kind?: "gems" | "resources" | "badge" | "cosmetic";
  gems?: number;
  resources?: Partial<PlayerAccountReadModel["globalResources"]>;
  badge?: string;
  cosmeticId?: string;
}

interface SeasonalEventPlayerApiPayload {
  points?: number;
  claimedRewardIds?: string[];
  claimableRewardIds?: string[];
}

interface SeasonalEventApiPayload {
  id?: string;
  name?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  durationDays?: number;
  bannerText?: string;
  remainingMs?: number;
  rewards?: SeasonalEventRewardApiPayload[];
  player?: SeasonalEventPlayerApiPayload;
  leaderboard?: {
    size?: number;
    rewardTiers?: SeasonalEventRewardTierApiPayload[];
    entries?: SeasonalEventLeaderboardEntryApiPayload[];
    topThree?: SeasonalEventLeaderboardEntryApiPayload[];
  };
}

interface SeasonalEventsApiPayload {
  events?: SeasonalEventApiPayload[];
}

interface SeasonalEventProgressApiPayload {
  applied?: boolean;
  event?: SeasonalEventApiPayload | null;
  eventProgress?: {
    eventId?: string;
    delta?: number;
    points?: number;
    objectiveId?: string;
  } | null;
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

export interface CocosSeasonalEventLeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string;
  points: number;
  lastUpdatedAt: string;
  rewardPreview?: string;
}

export interface CocosSeasonalEventRewardTier {
  rankStart: number;
  rankEnd: number;
  title: string;
  badge?: string;
  cosmeticId?: string;
}

export interface CocosSeasonalEventReward {
  id: string;
  name: string;
  pointsRequired: number;
  kind: "gems" | "resources" | "badge" | "cosmetic";
  gems?: number;
  resources?: PlayerAccountReadModel["globalResources"];
  badge?: string;
  cosmeticId?: string;
}

export interface CocosSeasonalEventPlayerProgress {
  points: number;
  claimedRewardIds: string[];
  claimableRewardIds: string[];
}

export interface CocosSeasonalEvent {
  id: string;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  durationDays: number;
  bannerText: string;
  remainingMs: number;
  rewards: CocosSeasonalEventReward[];
  player: CocosSeasonalEventPlayerProgress;
  leaderboard: {
    size: number;
    rewardTiers: CocosSeasonalEventRewardTier[];
    entries: CocosSeasonalEventLeaderboardEntry[];
    topThree: CocosSeasonalEventLeaderboardEntry[];
  };
}

export interface CocosSeasonalEventProgressResult {
  applied: boolean;
  event: CocosSeasonalEvent | null;
  eventProgress: {
    eventId: string;
    delta: number;
    points: number;
    objectiveId: string;
  } | null;
}

function normalizeSeasonProgress(payload?: PlayerSeasonProgressApiPayload | null): CocosSeasonProgress {
  const seasonPassClaimedTiers = Array.from(
    new Set(
      (payload?.seasonPassClaimedTiers ?? [])
        .map((tier) => Math.floor(tier))
        .filter((tier) => Number.isFinite(tier) && tier > 0)
    )
  ).sort((left, right) => left - right);

  return {
    battlePassEnabled: payload?.battlePassEnabled === true,
    seasonXp: Math.max(0, Math.floor(payload?.seasonXp ?? 0)),
    seasonPassTier: Math.max(1, Math.floor(payload?.seasonPassTier ?? 1)),
    seasonPassPremium: payload?.seasonPassPremium === true,
    seasonPassClaimedTiers
  };
}

function normalizeDailyDungeonRuns(runs?: Partial<DailyDungeonRunRecord>[] | null): DailyDungeonRunRecord[] {
  return (runs ?? [])
    .filter((run): run is Partial<DailyDungeonRunRecord> => Boolean(run?.runId && run?.dungeonId && run?.startedAt))
    .map((run) => ({
      runId: String(run.runId).trim(),
      dungeonId: String(run.dungeonId).trim(),
      floor: Math.max(1, Math.floor(run.floor ?? 1)),
      startedAt: String(run.startedAt).trim(),
      ...(run.rewardClaimedAt?.trim() ? { rewardClaimedAt: run.rewardClaimedAt.trim() } : {})
    }))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.floor - left.floor);
}

function normalizeDailyDungeonSummary(
  payload?: DailyDungeonApiPayload["dailyDungeon"] | null
): CocosDailyDungeonSummary | null {
  const dungeonId = payload?.dungeon?.id?.trim();
  const dungeonName = payload?.dungeon?.name?.trim();
  const dungeonDescription = payload?.dungeon?.description?.trim();
  const rawFloors = payload?.dungeon?.floors ?? [];
  if (!dungeonId || !dungeonName || !dungeonDescription || rawFloors.length === 0) {
    return null;
  }

  const floors = rawFloors
    .filter((floor) => floor && floor.floor != null)
    .map((floor) => ({
      floor: Math.max(1, Math.floor(floor.floor ?? 1)),
      recommendedHeroLevel: Math.max(1, Math.floor(floor.recommendedHeroLevel ?? 1)),
      enemyArmyTemplateId: floor.enemyArmyTemplateId?.trim() || "unknown_army",
      enemyArmyCount: Math.max(1, Math.floor(floor.enemyArmyCount ?? 1)),
      enemyStatMultiplier: Math.max(0.1, Number(floor.enemyStatMultiplier ?? 1)),
      reward: {
        ...(Math.max(0, Math.floor(floor.reward?.gems ?? 0)) > 0 ? { gems: Math.max(0, Math.floor(floor.reward?.gems ?? 0)) } : {}),
        resources: {
          gold: Math.max(0, Math.floor(floor.reward?.resources?.gold ?? 0)),
          wood: Math.max(0, Math.floor(floor.reward?.resources?.wood ?? 0)),
          ore: Math.max(0, Math.floor(floor.reward?.resources?.ore ?? 0))
        }
      }
    }))
    .sort((left, right) => left.floor - right.floor);
  if (floors.length === 0) {
    return null;
  }

  return {
    dungeon: {
      id: dungeonId,
      name: dungeonName,
      description: dungeonDescription,
      attemptLimit: Math.max(1, Math.floor(payload?.dungeon?.attemptLimit ?? floors.length)),
      floors
    },
    dateKey: payload?.dateKey?.trim() || new Date().toISOString().slice(0, 10),
    attemptsUsed: Math.max(0, Math.floor(payload?.attemptsUsed ?? 0)),
    attemptsRemaining: Math.max(0, Math.floor(payload?.attemptsRemaining ?? 0)),
    runs: normalizeDailyDungeonRuns(payload?.runs)
  };
}

function normalizeEventTimestamp(value?: string | null): string {
  const normalized = value?.trim();
  if (!normalized) {
    return new Date(0).toISOString();
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function normalizeSeasonalEventLeaderboardEntry(
  payload?: SeasonalEventLeaderboardEntryApiPayload | null
): CocosSeasonalEventLeaderboardEntry | null {
  const playerId = payload?.playerId?.trim();
  if (!playerId) {
    return null;
  }

  const rank = Math.max(1, Math.floor(payload?.rank ?? 1));
  return {
    rank,
    playerId,
    displayName: normalizeDisplayName(playerId, payload?.displayName),
    points: Math.max(0, Math.floor(payload?.points ?? 0)),
    lastUpdatedAt: normalizeEventTimestamp(payload?.lastUpdatedAt),
    ...(payload?.rewardPreview?.trim() ? { rewardPreview: payload.rewardPreview.trim() } : {})
  };
}

function normalizeSeasonalEventRewardTier(payload?: SeasonalEventRewardTierApiPayload | null): CocosSeasonalEventRewardTier | null {
  const title = payload?.title?.trim();
  if (!title) {
    return null;
  }

  return {
    rankStart: Math.max(1, Math.floor(payload?.rankStart ?? 1)),
    rankEnd: Math.max(1, Math.floor(payload?.rankEnd ?? payload?.rankStart ?? 1)),
    title,
    ...(payload?.badge?.trim() ? { badge: payload.badge.trim() } : {}),
    ...(payload?.cosmeticId?.trim() ? { cosmeticId: payload.cosmeticId.trim() } : {})
  };
}

function normalizeSeasonalEventReward(payload?: SeasonalEventRewardApiPayload | null): CocosSeasonalEventReward | null {
  const id = payload?.id?.trim();
  const name = payload?.name?.trim();
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    pointsRequired: Math.max(0, Math.floor(payload?.pointsRequired ?? 0)),
    kind: payload?.kind ?? "gems",
    ...(Math.max(0, Math.floor(payload?.gems ?? 0)) > 0 ? { gems: Math.max(0, Math.floor(payload?.gems ?? 0)) } : {}),
    ...((payload?.resources?.gold ?? 0) > 0 || (payload?.resources?.wood ?? 0) > 0 || (payload?.resources?.ore ?? 0) > 0
      ? {
          resources: {
            gold: Math.max(0, Math.floor(payload?.resources?.gold ?? 0)),
            wood: Math.max(0, Math.floor(payload?.resources?.wood ?? 0)),
            ore: Math.max(0, Math.floor(payload?.resources?.ore ?? 0))
          }
        }
      : {}),
    ...(payload?.badge?.trim() ? { badge: payload.badge.trim() } : {}),
    ...(payload?.cosmeticId?.trim() ? { cosmeticId: payload.cosmeticId.trim() } : {})
  };
}

function normalizeSeasonalEvent(payload?: SeasonalEventApiPayload | null): CocosSeasonalEvent | null {
  const id = payload?.id?.trim();
  if (!id) {
    return null;
  }

  const entries = (payload?.leaderboard?.entries ?? [])
    .map((entry) => normalizeSeasonalEventLeaderboardEntry(entry))
    .filter((entry): entry is CocosSeasonalEventLeaderboardEntry => Boolean(entry))
    .sort((left, right) => left.rank - right.rank || left.playerId.localeCompare(right.playerId));
  const topThree = (payload?.leaderboard?.topThree ?? [])
    .map((entry) => normalizeSeasonalEventLeaderboardEntry(entry))
    .filter((entry): entry is CocosSeasonalEventLeaderboardEntry => Boolean(entry))
    .sort((left, right) => left.rank - right.rank || left.playerId.localeCompare(right.playerId));

  return {
    id,
    name: payload?.name?.trim() || id,
    description: payload?.description?.trim() || "",
    startsAt: normalizeEventTimestamp(payload?.startsAt),
    endsAt: normalizeEventTimestamp(payload?.endsAt),
    durationDays: Math.max(1, Math.floor(payload?.durationDays ?? 1)),
    bannerText: payload?.bannerText?.trim() || "",
    remainingMs: Math.max(0, Math.floor(payload?.remainingMs ?? 0)),
    rewards: (payload?.rewards ?? [])
      .map((reward) => normalizeSeasonalEventReward(reward))
      .filter((reward): reward is CocosSeasonalEventReward => Boolean(reward))
      .sort((left, right) => left.pointsRequired - right.pointsRequired || left.id.localeCompare(right.id)),
    player: {
      points: Math.max(0, Math.floor(payload?.player?.points ?? 0)),
      claimedRewardIds: Array.from(new Set((payload?.player?.claimedRewardIds ?? []).map((entry) => entry?.trim()).filter(Boolean))),
      claimableRewardIds: Array.from(
        new Set((payload?.player?.claimableRewardIds ?? []).map((entry) => entry?.trim()).filter(Boolean))
      )
    },
    leaderboard: {
      size: Math.max(1, Math.floor(payload?.leaderboard?.size ?? Math.max(entries.length, 10))),
      rewardTiers: (payload?.leaderboard?.rewardTiers ?? [])
        .map((tier) => normalizeSeasonalEventRewardTier(tier))
        .filter((tier): tier is CocosSeasonalEventRewardTier => Boolean(tier))
        .sort((left, right) => left.rankStart - right.rankStart || left.rankEnd - right.rankEnd),
      entries,
      topThree
    }
  };
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
type WechatMiniGameSubscribeMessageLike = (options: {
  tmplIds: string[];
  success?: (result: Record<string, unknown>) => void;
  fail?: (error: { errMsg?: string }) => void;
}) => void;

interface CocosWechatSubscribeEnvironmentLike {
  process?: {
    env?: Record<string, string | undefined>;
  };
  wx?: {
    getLaunchOptionsSync?: (() => { query?: Record<string, unknown> | null } | null | undefined) | undefined;
    requestSubscribeMessage?: WechatMiniGameSubscribeMessageLike | undefined;
  } | null;
}

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
    tutorialStep: account?.tutorialStep,
    dailyQuestBoard: account?.dailyQuestBoard,
    mailbox: account?.mailbox,
    mailboxSummary: account?.mailboxSummary,
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

function normalizeCampaignMissionState(rawMission?: Partial<CampaignMissionState>): CampaignMissionState | null {
  const id = rawMission?.id?.trim();
  const chapterId = rawMission?.chapterId?.trim();
  const mapId = rawMission?.mapId?.trim();
  const name = rawMission?.name?.trim();
  const description = rawMission?.description?.trim();
  const enemyArmyTemplateId = rawMission?.enemyArmyTemplateId?.trim();
  if (!id || !chapterId || !mapId || !name || !description || !enemyArmyTemplateId) {
    return null;
  }

  return {
    ...rawMission,
    id,
    missionId: rawMission?.missionId?.trim() || id,
    chapterId,
    mapId,
    name,
    description,
    enemyArmyTemplateId,
    order: Math.max(1, Math.floor(rawMission?.order ?? 1)),
    recommendedHeroLevel: Math.max(1, Math.floor(rawMission?.recommendedHeroLevel ?? 1)),
    enemyArmyCount: Math.max(1, Math.floor(rawMission?.enemyArmyCount ?? 1)),
    enemyStatMultiplier: Number.isFinite(rawMission?.enemyStatMultiplier) ? Math.max(0.1, Number(rawMission?.enemyStatMultiplier)) : 1,
    attempts: Math.max(0, Math.floor(rawMission?.attempts ?? 0)),
    objectives: Array.isArray(rawMission?.objectives) ? rawMission.objectives : [],
    reward: rawMission?.reward ?? {},
    status:
      rawMission?.status === "completed" || rawMission?.status === "locked" || rawMission?.status === "available"
        ? rawMission.status
        : "locked",
    ...(rawMission?.bossEncounterName?.trim() ? { bossEncounterName: rawMission.bossEncounterName.trim() } : {}),
    ...(rawMission?.unlockMissionId?.trim() ? { unlockMissionId: rawMission.unlockMissionId.trim() } : {}),
    ...(Array.isArray(rawMission?.introDialogue) ? { introDialogue: rawMission.introDialogue } : {}),
    ...(Array.isArray(rawMission?.midDialogue) ? { midDialogue: rawMission.midDialogue } : {}),
    ...(Array.isArray(rawMission?.outroDialogue) ? { outroDialogue: rawMission.outroDialogue } : {}),
    ...(Array.isArray(rawMission?.unlockRequirements) ? { unlockRequirements: rawMission.unlockRequirements } : {}),
    ...(rawMission?.completedAt ? { completedAt: rawMission.completedAt } : {})
  };
}

function normalizeCocosCampaignSummary(rawCampaign?: Partial<CocosCampaignSummary>): CocosCampaignSummary {
  const missions = Array.isArray(rawCampaign?.missions)
    ? rawCampaign.missions
        .map((mission) => normalizeCampaignMissionState(mission))
        .filter((mission): mission is CampaignMissionState => Boolean(mission))
        .sort((left, right) => {
          if (left.chapterId !== right.chapterId) {
            return left.chapterId.localeCompare(right.chapterId);
          }
          if (left.order !== right.order) {
            return left.order - right.order;
          }
          return left.id.localeCompare(right.id);
        })
    : [];
  const completedCount = Math.max(
    0,
    Math.floor(rawCampaign?.completedCount ?? missions.filter((mission) => mission.status === "completed").length)
  );

  return {
    missions,
    completedCount,
    totalMissions: Math.max(missions.length, Math.floor(rawCampaign?.totalMissions ?? missions.length)),
    nextMissionId: rawCampaign?.nextMissionId?.trim() || missions.find((mission) => mission.status === "available")?.id || null,
    completionPercent:
      rawCampaign?.completionPercent != null
        ? Math.max(0, Math.min(100, Math.floor(rawCampaign.completionPercent)))
        : missions.length === 0
          ? 0
          : Math.round((completedCount / missions.length) * 100)
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

export async function postCocosPlayerReferral(
  remoteUrl: string,
  input: { referrerId: string },
  options: {
    authSession: CocosStoredAuthSession;
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "removeItem"> | null;
  }
): Promise<PlayerReferralApiPayload> {
  return (await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/player/referral`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        referrerId: input.referrerId
      })
    },
    options.authSession,
    {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.storage !== undefined ? { storage: options.storage } : {})
    }
  )) as PlayerReferralApiPayload;
}

export async function claimCocosMailboxMessage(
  remoteUrl: string,
  messageId: string,
  options: {
    authSession: CocosStoredAuthSession;
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "removeItem"> | null;
  }
): Promise<PlayerMailboxApiPayload> {
  return (await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/mailbox/${encodeURIComponent(messageId)}/claim`,
    {
      method: "POST"
    },
    options.authSession,
    {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.storage !== undefined ? { storage: options.storage } : {})
    }
  )) as PlayerMailboxApiPayload;
}

export async function claimAllCocosMailboxMessages(
  remoteUrl: string,
  options: {
    authSession: CocosStoredAuthSession;
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "removeItem"> | null;
  }
): Promise<PlayerMailboxApiPayload> {
  return (await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/mailbox/claim-all`,
    {
      method: "POST"
    },
    options.authSession,
    {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.storage !== undefined ? { storage: options.storage } : {})
    }
  )) as PlayerMailboxApiPayload;
}

export async function updateCocosTutorialProgress(
  remoteUrl: string,
  roomId: string,
  action: TutorialProgressAction,
  options: {
    authSession: CocosStoredAuthSession;
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "removeItem"> | null;
  }
): Promise<CocosPlayerAccountProfile> {
  const payload = (await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/tutorial-progress`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(action)
    },
    options.authSession,
    {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.storage !== undefined ? { storage: options.storage } : {})
    }
  )) as PlayerAccountApiPayload;

  return asCocosPlayerAccountProfile(
    payload.account?.playerId?.trim() || options.authSession.playerId,
    roomId,
    "remote",
    payload.account,
    options.authSession.displayName
  );
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

export function resetCocosWechatSubscribeConsentForTests(): void {
  wechatSubscribeConsentRequestedThisSession = false;
}

export function resolveCocosWechatSubscribeTemplateIds(
  environment: CocosWechatSubscribeEnvironmentLike = globalThis as CocosWechatSubscribeEnvironmentLike
): string[] {
  const env = environment.process?.env ?? {};
  return [
    env.VEIL_WECHAT_MATCH_FOUND_TMPL_ID?.trim() ?? "",
    env.VEIL_WECHAT_TURN_REMINDER_TMPL_ID?.trim() ?? ""
  ].filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

export async function requestCocosWechatSubscribeConsent(
  options?: {
    storage?: Pick<Storage, "setItem"> | null;
    environment?: CocosWechatSubscribeEnvironmentLike;
  }
): Promise<boolean> {
  if (wechatSubscribeConsentRequestedThisSession) {
    return false;
  }

  const environment = options?.environment ?? (globalThis as CocosWechatSubscribeEnvironmentLike);
  const wxRuntime = environment.wx ?? null;
  if (detectCocosRuntimePlatform({ wx: wxRuntime }) !== "wechat-game") {
    return false;
  }

  const platformRuntime = sys as unknown as { platform?: string; Platform?: { WECHAT_GAME?: string } };
  if (platformRuntime.platform !== platformRuntime.Platform?.WECHAT_GAME) {
    return false;
  }

  if (typeof wxRuntime?.requestSubscribeMessage !== "function") {
    return false;
  }

  const templateIds = resolveCocosWechatSubscribeTemplateIds(environment);
  if (templateIds.length === 0) {
    return false;
  }

  wechatSubscribeConsentRequestedThisSession = true;
  const storage = options?.storage ?? getCocosStorage();

  return new Promise((resolve) => {
    try {
      wxRuntime.requestSubscribeMessage?.({
        tmplIds: templateIds,
        success: (result) => {
          storage?.setItem(
            WECHAT_SUBSCRIBE_CONSENT_STORAGE_KEY,
            JSON.stringify({
              requested: true,
              result
            })
          );
          resolve(true);
        },
        fail: (error) => {
          storage?.setItem(
            WECHAT_SUBSCRIBE_CONSENT_STORAGE_KEY,
            JSON.stringify({
              requested: true,
              error: error.errMsg?.trim() || "wechat_subscribe_message_failed"
            })
          );
          resolve(false);
        }
      });
    } catch {
      resolve(false);
    }
  });
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

export async function deleteCurrentCocosPlayerAccount(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
  }
): Promise<{ playerId: string; displayName: string; deletedAt?: string } | null> {
  const storage = options?.storage ?? getCocosStorage();
  const currentSession = readStoredCocosAuthSession(storage);
  if (!currentSession?.token) {
    throw new Error("auth_session_required");
  }

  const payload = (await fetchJson(
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/players/me/delete`,
    {
      method: "POST",
      headers: buildCocosAuthHeaders(currentSession.token)
    },
    options?.fetchImpl
  )) as {
    deleted?: {
      playerId: string;
      displayName: string;
      deletedAt?: string;
    } | null;
  };

  if (storage) {
    clearStoredCocosAuthSession(storage);
  }

  return payload.deleted ?? null;
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

export async function loadCocosCampaignSummary(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
    throwOnError?: boolean;
  }
): Promise<CocosCampaignSummary> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/campaign`,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as CampaignApiPayload;
    return normalizeCocosCampaignSummary(payload.campaign);
  } catch (error) {
    if (options?.throwOnError) {
      throw error;
    }
    return normalizeCocosCampaignSummary();
  }
}

export async function startCocosCampaignMission(
  remoteUrl: string,
  campaignId: string,
  missionId: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<CocosCampaignMissionStartResult> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);
  const payload = (await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/campaigns/${encodeURIComponent(campaignId)}/missions/${encodeURIComponent(missionId)}/start`,
    {
      method: "POST",
      ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
    },
    authSession,
    {
      ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(storage !== undefined ? { storage } : {})
    }
  )) as CampaignMissionStartApiPayload;
  const mission = normalizeCampaignMissionState(payload.mission);
  if (!mission) {
    throw new Error("campaign_mission_start_invalid");
  }
  return {
    started: payload.started !== false,
    mission
  };
}

export async function completeCocosCampaignMission(
  remoteUrl: string,
  missionId: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<CocosCampaignMissionCompleteResult> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);
  const payload = (await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/campaign/${encodeURIComponent(missionId)}/complete`,
    {
      method: "POST",
      ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
    },
    authSession,
    {
      ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(storage !== undefined ? { storage } : {})
    }
  )) as CampaignMissionCompleteApiPayload;
  const mission = normalizeCampaignMissionState(payload.mission);
  if (!mission) {
    throw new Error("campaign_mission_complete_invalid");
  }
  return {
    completed: payload.completed !== false,
    mission,
    reward: payload.reward ?? {},
    campaign: normalizeCocosCampaignSummary(payload.campaign)
  };
}

export async function loadCocosSeasonProgress(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
    throwOnError?: boolean;
  }
): Promise<CocosSeasonProgress> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/season/progress`,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as PlayerSeasonProgressApiPayload;
    return normalizeSeasonProgress(payload);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && storage) {
      clearStoredCocosAuthSession(storage);
    }
    if (options?.throwOnError) {
      throw error;
    }
    return normalizeSeasonProgress();
  }
}

export async function claimCocosSeasonTier(
  remoteUrl: string,
  tier: number,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<void> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);

  await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/season/claim-tier`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authSession?.token ? buildCocosAuthHeaders(authSession.token) : {})
      },
      body: JSON.stringify({
        tier: Math.max(1, Math.floor(tier))
      })
    },
    authSession,
    {
      ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(storage !== undefined ? { storage } : {})
    }
  );
}

export async function loadCocosDailyDungeon(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
    throwOnError?: boolean;
  }
): Promise<CocosDailyDungeonSummary | null> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/daily-dungeon`,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as DailyDungeonApiPayload;
    return normalizeDailyDungeonSummary(payload.dailyDungeon);
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && storage) {
      clearStoredCocosAuthSession(storage);
    }
    if (options?.throwOnError) {
      throw error;
    }
    return null;
  }
}

export async function loadCocosActiveSeasonalEvents(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
    throwOnError?: boolean;
  }
): Promise<CocosSeasonalEvent[]> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);

  try {
    const payload = (await fetchCocosAuthJson(
      remoteUrl,
      `${resolveCocosApiBaseUrl(remoteUrl)}/api/events/active`,
      {
        ...(authSession?.token ? { headers: buildCocosAuthHeaders(authSession.token) } : {})
      },
      authSession,
      {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(storage !== undefined ? { storage } : {})
      }
    )) as SeasonalEventsApiPayload;
    return (payload.events ?? [])
      .map((event) => normalizeSeasonalEvent(event))
      .filter((event): event is CocosSeasonalEvent => Boolean(event))
      .sort((left, right) => left.endsAt.localeCompare(right.endsAt) || left.id.localeCompare(right.id));
  } catch (error) {
    if (authSession?.token && error instanceof Error && error.message.startsWith("cocos_request_failed:401:") && storage) {
      clearStoredCocosAuthSession(storage);
    }
    if (options?.throwOnError) {
      throw error;
    }
    return [];
  }
}

export async function attemptCocosDailyDungeonFloor(
  remoteUrl: string,
  floor: number,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<CocosDailyDungeonSummary | null> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);

  const payload = (await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/daily-dungeon/attempt`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authSession?.token ? buildCocosAuthHeaders(authSession.token) : {})
      },
      body: JSON.stringify({
        floor: Math.max(1, Math.floor(floor))
      })
    },
    authSession,
    {
      ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(storage !== undefined ? { storage } : {})
    }
  )) as DailyDungeonApiPayload;

  return normalizeDailyDungeonSummary(payload.dailyDungeon);
}

export async function claimCocosDailyDungeonRunReward(
  remoteUrl: string,
  runId: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<CocosDailyDungeonSummary | null> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);

  const payload = (await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/player-accounts/me/daily-dungeon/runs/${encodeURIComponent(runId)}/claim`,
    {
      method: "POST",
      headers: {
        ...(authSession?.token ? buildCocosAuthHeaders(authSession.token) : {})
      }
    },
    authSession,
    {
      ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(storage !== undefined ? { storage } : {})
    }
  )) as DailyDungeonApiPayload;

  return normalizeDailyDungeonSummary(payload.dailyDungeon);
}

export async function submitCocosSeasonalEventProgress(
  remoteUrl: string,
  eventId: string,
  action: {
    actionId: string;
    actionType: string;
    battleId?: string;
    dungeonId?: string;
    occurredAt?: string;
  },
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<CocosSeasonalEventProgressResult> {
  const storage = options?.storage ?? getCocosStorage();
  const authSession =
    options && "authSession" in options ? options.authSession ?? null : readStoredCocosAuthSession(storage);

  const payload = (await fetchCocosAuthJson(
    remoteUrl,
    `${resolveCocosApiBaseUrl(remoteUrl)}/api/events/${encodeURIComponent(eventId)}/progress`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authSession?.token ? buildCocosAuthHeaders(authSession.token) : {})
      },
      body: JSON.stringify({
        actionId: action.actionId,
        actionType: action.actionType,
        ...(action.battleId?.trim() ? { battleId: action.battleId.trim() } : {}),
        ...(action.dungeonId?.trim() ? { dungeonId: action.dungeonId.trim() } : {}),
        ...(action.occurredAt?.trim() ? { occurredAt: action.occurredAt.trim() } : {})
      })
    },
    authSession,
    {
      ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(storage !== undefined ? { storage } : {})
    }
  )) as SeasonalEventProgressApiPayload;

  return {
    applied: payload.applied === true,
    event: normalizeSeasonalEvent(payload.event),
    eventProgress: payload.eventProgress?.eventId?.trim()
      ? {
          eventId: payload.eventProgress.eventId.trim(),
          delta: Math.max(0, Math.floor(payload.eventProgress.delta ?? 0)),
          points: Math.max(0, Math.floor(payload.eventProgress.points ?? 0)),
          objectiveId: payload.eventProgress.objectiveId?.trim() || "objective"
        }
      : null
  };
}
