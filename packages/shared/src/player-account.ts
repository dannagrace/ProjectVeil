import {
  buildPlayerBattleReportCenter,
  normalizePlayerBattleReportCenter,
  type PlayerBattleReportCenter
} from "./battle-report.ts";
import {
  normalizeEventLogEntries,
  normalizeAchievementProgress,
  type EventLogEntry,
  type PlayerAchievementProgress
} from "./event-log.ts";
import { normalizeDailyQuestBoard, type DailyQuestBoard } from "./daily-quests.ts";
import { normalizePlayerBattleReplaySummaries, type PlayerBattleReplaySummary } from "./battle-replay.ts";
import {
  getRankDivisionForRating,
  getUtcWeekStart
} from "./competitive-season.ts";
import { normalizeExperimentAssignments, type ExperimentAssignment } from "./feature-flags.ts";
import {
  normalizeEloRating,
  type DemotionShieldState,
  type PromotionSeriesState,
  type RankDivisionId
} from "./matchmaking.ts";
import type {
  CampaignProgressState,
  CosmeticId,
  CosmeticInventory,
  DailyDungeonState,
  EquipmentId,
  EquippedCosmetics,
  NotificationPreferences,
  SeasonalEventState,
  RankedWeeklyProgress,
  ResourceLedger,
  SeasonArchiveEntry,
  ShopRotation
} from "./models.ts";
import { normalizeCosmeticInventory, normalizeEquippedCosmetics } from "./cosmetics.ts";
import { normalizeTutorialStep } from "./tutorial.ts";

export type PlayerBanStatus = "none" | "temporary" | "permanent";

export interface PlayerMailboxGrant {
  gems?: number;
  resources?: Partial<ResourceLedger>;
  equipmentIds?: EquipmentId[];
  cosmeticIds?: CosmeticId[];
  seasonBadges?: string[];
  seasonPassPremium?: boolean;
}

export interface PlayerMailboxMessage {
  id: string;
  kind: "system" | "compensation" | "announcement";
  title: string;
  body: string;
  sentAt: string;
  expiresAt?: string;
  readAt?: string;
  claimedAt?: string;
  grant?: PlayerMailboxGrant;
}

export interface PlayerMailboxSummary {
  totalCount: number;
  unreadCount: number;
  claimableCount: number;
  expiredCount: number;
}

export interface LeaderboardOpponentStat {
  opponentPlayerId: string;
  matchCount: number;
  eloGain: number;
  eloLoss: number;
  lastPlayedAt: string;
}

export interface LeaderboardAbuseState {
  currentDay?: string;
  dailyEloGain?: number;
  dailyEloLoss?: number;
  opponentStats?: LeaderboardOpponentStat[];
  status?: "clear" | "watch" | "flagged";
  lastAlertAt?: string;
  lastAlertReasons?: string[];
}

export interface LeaderboardModerationState {
  frozenAt?: string;
  frozenByPlayerId?: string;
  freezeReason?: string;
  hiddenAt?: string;
  hiddenByPlayerId?: string;
  hiddenReason?: string;
}

export interface PlayerAccountReadModel {
  playerId: string;
  displayName: string;
  avatarUrl?: string;
  eloRating?: number;
  rankDivision?: RankDivisionId;
  peakRankDivision?: RankDivisionId;
  promotionSeries?: PromotionSeriesState;
  demotionShield?: DemotionShieldState;
  seasonHistory?: SeasonArchiveEntry[];
  rankedWeeklyProgress?: RankedWeeklyProgress;
  gems?: number;
  loginStreak?: number;
  seasonXp?: number;
  seasonPassTier?: number;
  seasonPassPremium?: boolean;
  cosmeticInventory?: CosmeticInventory;
  equippedCosmetics?: EquippedCosmetics;
  currentShopRotation?: ShopRotation;
  seasonPassClaimedTiers?: number[];
  seasonBadges?: string[];
  globalResources: ResourceLedger;
  achievements: PlayerAchievementProgress[];
  recentEventLog: EventLogEntry[];
  recentBattleReplays?: PlayerBattleReplaySummary[];
  battleReportCenter?: PlayerBattleReportCenter;
  dailyQuestBoard?: DailyQuestBoard;
  campaignProgress?: CampaignProgressState;
  dailyDungeonState?: DailyDungeonState;
  seasonalEventStates?: SeasonalEventState[];
  mailbox?: PlayerMailboxMessage[];
  mailboxSummary?: PlayerMailboxSummary;
  tutorialStep?: number | null;
  loginId?: string;
  credentialBoundAt?: string;
  privacyConsentAt?: string;
  phoneNumber?: string;
  phoneNumberBoundAt?: string;
  notificationPreferences?: NotificationPreferences;
  ageVerified?: boolean;
  isMinor?: boolean;
  dailyPlayMinutes?: number;
  lastPlayDate?: string;
  banStatus?: PlayerBanStatus;
  banExpiry?: string;
  banReason?: string;
  leaderboardAbuseState?: LeaderboardAbuseState;
  leaderboardModerationState?: LeaderboardModerationState;
  lastRoomId?: string;
  lastSeenAt?: string;
  experiments?: ExperimentAssignment[];
}

export interface PlayerAccountReadModelInput {
  playerId?: string | undefined;
  displayName?: string | undefined;
  avatarUrl?: string | undefined;
  eloRating?: number | undefined;
  rankDivision?: RankDivisionId | undefined;
  peakRankDivision?: RankDivisionId | undefined;
  promotionSeries?: PromotionSeriesState | null | undefined;
  demotionShield?: DemotionShieldState | null | undefined;
  seasonHistory?: SeasonArchiveEntry[] | null | undefined;
  rankedWeeklyProgress?: RankedWeeklyProgress | null | undefined;
  gems?: number | undefined;
  loginStreak?: number | undefined;
  seasonXp?: number | undefined;
  seasonPassTier?: number | undefined;
  seasonPassPremium?: boolean | undefined;
  cosmeticInventory?: Partial<CosmeticInventory> | null | undefined;
  equippedCosmetics?: Partial<EquippedCosmetics> | null | undefined;
  currentShopRotation?: ShopRotation | null | undefined;
  seasonPassClaimedTiers?: number[] | null | undefined;
  seasonBadges?: string[] | null | undefined;
  globalResources?: Partial<ResourceLedger> | null | undefined;
  achievements?: Partial<PlayerAchievementProgress>[] | null | undefined;
  recentEventLog?: Partial<EventLogEntry>[] | null | undefined;
  recentBattleReplays?: Partial<PlayerBattleReplaySummary>[] | null | undefined;
  battleReportCenter?: Partial<PlayerBattleReportCenter> | null | undefined;
  dailyQuestBoard?: Partial<DailyQuestBoard> | null | undefined;
  campaignProgress?: Partial<CampaignProgressState> | null | undefined;
  dailyDungeonState?: Partial<DailyDungeonState> | null | undefined;
  seasonalEventStates?: Partial<SeasonalEventState>[] | null | undefined;
  mailbox?: Partial<PlayerMailboxMessage>[] | null | undefined;
  mailboxSummary?: Partial<PlayerMailboxSummary> | null | undefined;
  tutorialStep?: number | null | undefined;
  loginId?: string | undefined;
  credentialBoundAt?: string | undefined;
  privacyConsentAt?: string | undefined;
  phoneNumber?: string | undefined;
  phoneNumberBoundAt?: string | undefined;
  notificationPreferences?: Partial<NotificationPreferences> | null | undefined;
  ageVerified?: boolean | undefined;
  isMinor?: boolean | undefined;
  dailyPlayMinutes?: number | undefined;
  lastPlayDate?: string | undefined;
  banStatus?: PlayerBanStatus | undefined;
  banExpiry?: string | undefined;
  banReason?: string | undefined;
  leaderboardAbuseState?: LeaderboardAbuseState | null | undefined;
  leaderboardModerationState?: LeaderboardModerationState | null | undefined;
  lastRoomId?: string | undefined;
  lastSeenAt?: string | undefined;
  experiments?: Partial<ExperimentAssignment>[] | null | undefined;
}

function normalizeLeaderboardOpponentStats(
  opponentStats?: LeaderboardOpponentStat[] | null
): LeaderboardOpponentStat[] | undefined {
  if (!Array.isArray(opponentStats)) {
    return undefined;
  }

  const normalized = opponentStats
    .map((entry) => {
      const opponentPlayerId = entry?.opponentPlayerId?.trim();
      const lastPlayedAt = entry?.lastPlayedAt?.trim();
      if (!opponentPlayerId || !lastPlayedAt) {
        return null;
      }

      return {
        opponentPlayerId,
        matchCount: Math.max(0, Math.floor(entry.matchCount ?? 0)),
        eloGain: Math.max(0, Math.floor(entry.eloGain ?? 0)),
        eloLoss: Math.max(0, Math.floor(entry.eloLoss ?? 0)),
        lastPlayedAt
      };
    })
    .filter((entry): entry is LeaderboardOpponentStat => Boolean(entry))
    .sort((left, right) => right.lastPlayedAt.localeCompare(left.lastPlayedAt))
    .slice(0, 12);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeLeaderboardAbuseState(
  state?: LeaderboardAbuseState | null
): LeaderboardAbuseState | undefined {
  if (!state || typeof state !== "object") {
    return undefined;
  }

  const currentDay = /^\d{4}-\d{2}-\d{2}$/.test(state.currentDay?.trim() ?? "") ? state.currentDay?.trim() : undefined;
  const opponentStats = normalizeLeaderboardOpponentStats(state.opponentStats);
  const lastAlertAt = state.lastAlertAt?.trim();
  const lastAlertReasons = Array.from(
    new Set(
      (state.lastAlertReasons ?? [])
        .map((reason) => reason?.trim())
        .filter((reason): reason is string => Boolean(reason))
    )
  ).slice(0, 8);
  const status = state.status === "watch" || state.status === "flagged" ? state.status : "clear";

  if (!currentDay && !opponentStats && !lastAlertAt && lastAlertReasons.length === 0 && status === "clear") {
    return undefined;
  }

  return {
    ...(currentDay ? { currentDay } : {}),
    ...(currentDay ? { dailyEloGain: Math.max(0, Math.floor(state.dailyEloGain ?? 0)) } : {}),
    ...(currentDay ? { dailyEloLoss: Math.max(0, Math.floor(state.dailyEloLoss ?? 0)) } : {}),
    ...(opponentStats ? { opponentStats } : {}),
    ...(status !== "clear" ? { status } : {}),
    ...(lastAlertAt ? { lastAlertAt } : {}),
    ...(lastAlertReasons.length > 0 ? { lastAlertReasons } : {})
  };
}

function normalizeLeaderboardModerationState(
  state?: LeaderboardModerationState | null
): LeaderboardModerationState | undefined {
  if (!state || typeof state !== "object") {
    return undefined;
  }

  const frozenAt = state.frozenAt?.trim();
  const frozenByPlayerId = state.frozenByPlayerId?.trim();
  const freezeReason = state.freezeReason?.trim();
  const hiddenAt = state.hiddenAt?.trim();
  const hiddenByPlayerId = state.hiddenByPlayerId?.trim();
  const hiddenReason = state.hiddenReason?.trim();

  if (!frozenAt && !hiddenAt) {
    return undefined;
  }

  return {
    ...(frozenAt ? { frozenAt } : {}),
    ...(frozenByPlayerId ? { frozenByPlayerId } : {}),
    ...(freezeReason ? { freezeReason } : {}),
    ...(hiddenAt ? { hiddenAt } : {}),
    ...(hiddenByPlayerId ? { hiddenByPlayerId } : {}),
    ...(hiddenReason ? { hiddenReason } : {})
  };
}

export function normalizePlayerAccountReadModel(
  account?: PlayerAccountReadModelInput | null
): PlayerAccountReadModel {
  const playerId = account?.playerId?.trim() ?? "";
  const displayName = account?.displayName?.trim() ?? "";
  const avatarUrl = account?.avatarUrl?.trim();
  const loginId = account?.loginId?.trim().toLowerCase();
  const credentialBoundAt = account?.credentialBoundAt?.trim();
  const privacyConsentAt = account?.privacyConsentAt?.trim();
  const phoneNumber = account?.phoneNumber?.trim();
  const phoneNumberBoundAt = account?.phoneNumberBoundAt?.trim();
  const notificationPreferences = normalizeNotificationPreferences(account?.notificationPreferences);
  const ageVerified = account?.ageVerified === true;
  const isMinor = account?.isMinor === true;
  const dailyPlayMinutes = Math.max(0, Math.floor(account?.dailyPlayMinutes ?? 0));
  const loginStreak = Math.max(0, Math.floor(account?.loginStreak ?? 0));
  const seasonXp = Math.max(0, Math.floor(account?.seasonXp ?? 0));
  const seasonPassTier = Math.max(1, Math.floor(account?.seasonPassTier ?? 1));
  const seasonPassPremium = account?.seasonPassPremium === true;
  const cosmeticInventory = normalizeCosmeticInventory(account?.cosmeticInventory);
  const equippedCosmetics = normalizeEquippedCosmetics(account?.equippedCosmetics);
  const seasonPassClaimedTiers = Array.from(
    new Set(
      (account?.seasonPassClaimedTiers ?? [])
        .map((tier) => Math.floor(tier))
        .filter((tier) => Number.isFinite(tier) && tier > 0)
    )
  ).sort((left, right) => left - right);
  const seasonBadges = Array.from(
    new Set(
      (account?.seasonBadges ?? [])
        .map((badge) => badge?.trim())
        .filter((badge): badge is string => Boolean(badge))
    )
  );
  const lastPlayDate = /^\d{4}-\d{2}-\d{2}$/.test(account?.lastPlayDate?.trim() ?? "")
    ? account?.lastPlayDate?.trim()
    : undefined;
  const banStatus = account?.banStatus === "temporary" || account?.banStatus === "permanent" ? account.banStatus : "none";
  const banExpiry = account?.banExpiry?.trim();
  const banReason = account?.banReason?.trim();
  const leaderboardAbuseState = normalizeLeaderboardAbuseState(account?.leaderboardAbuseState);
  const leaderboardModerationState = normalizeLeaderboardModerationState(account?.leaderboardModerationState);
  const lastRoomId = account?.lastRoomId?.trim();
  const lastSeenAt = account?.lastSeenAt?.trim();
  const experiments = normalizeExperimentAssignments(account?.experiments);
  const recentEventLog = normalizeEventLogEntries(account?.recentEventLog);
  const recentBattleReplays = normalizePlayerBattleReplaySummaries(account?.recentBattleReplays);
  const rankDivision = account?.rankDivision ?? getRankDivisionForRating(account?.eloRating);
  const peakRankDivision = account?.peakRankDivision ?? rankDivision;
  const promotionSeries =
    account?.promotionSeries &&
    account.promotionSeries.targetDivision &&
    Number.isFinite(account.promotionSeries.wins) &&
    Number.isFinite(account.promotionSeries.losses)
      ? {
          targetDivision: account.promotionSeries.targetDivision,
          wins: Math.max(0, Math.floor(account.promotionSeries.wins)),
          losses: Math.max(0, Math.floor(account.promotionSeries.losses)),
          winsRequired: Math.max(1, Math.floor(account.promotionSeries.winsRequired ?? 3)),
          lossesAllowed: Math.max(1, Math.floor(account.promotionSeries.lossesAllowed ?? 2))
        }
      : undefined;
  const demotionShield =
    account?.demotionShield && account.demotionShield.remainingMatches > 0 && account.demotionShield.tier
      ? {
          tier: account.demotionShield.tier,
          remainingMatches: Math.max(0, Math.floor(account.demotionShield.remainingMatches))
        }
      : undefined;
  const seasonHistory = (account?.seasonHistory ?? [])
    .filter((entry): entry is SeasonArchiveEntry => Boolean(entry?.seasonId && entry?.peakDivision && entry?.finalDivision))
    .map((entry) => ({
      seasonId: entry.seasonId.trim(),
      ...(Number.isFinite(entry.rankPosition) ? { rankPosition: Math.max(1, Math.floor(entry.rankPosition!)) } : {}),
      ...(Number.isFinite(entry.totalPlayers) ? { totalPlayers: Math.max(1, Math.floor(entry.totalPlayers!)) } : {}),
      ...(Number.isFinite(entry.finalRating) ? { finalRating: Math.max(0, Math.floor(entry.finalRating!)) } : {}),
      ...(Number.isFinite(entry.peakRating) ? { peakRating: Math.max(0, Math.floor(entry.peakRating!)) } : {}),
      peakDivision: entry.peakDivision,
      finalDivision: entry.finalDivision,
      rewardTier: entry.rewardTier,
      ...(typeof entry.rankPercentile === "number" && Number.isFinite(entry.rankPercentile)
        ? { rankPercentile: Math.max(0, Math.min(1, entry.rankPercentile)) }
        : {}),
      rewardClaimed: entry.rewardClaimed === true,
      archivedAt: normalizeTimestamp(entry.archivedAt) ?? new Date(0).toISOString(),
      ...(normalizeTimestamp(entry.rewardsGrantedAt) ? { rewardsGrantedAt: normalizeTimestamp(entry.rewardsGrantedAt)! } : {})
    }))
    .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt) || left.seasonId.localeCompare(right.seasonId));
  let rankedWeeklyProgress: RankedWeeklyProgress | undefined;
  if (account?.rankedWeeklyProgress?.currentWeekStartsAt) {
    rankedWeeklyProgress = {
      currentWeekStartsAt: normalizeTimestamp(account.rankedWeeklyProgress.currentWeekStartsAt) ?? getUtcWeekStart(),
      currentWeekBattles: Math.max(0, Math.floor(account.rankedWeeklyProgress.currentWeekBattles ?? 0)),
      currentWeekWins: Math.max(0, Math.floor(account.rankedWeeklyProgress.currentWeekWins ?? 0))
    };
    const previousWeekStartsAt = normalizeTimestamp(account.rankedWeeklyProgress.previousWeekStartsAt);
    if (previousWeekStartsAt) {
      rankedWeeklyProgress.previousWeekStartsAt = previousWeekStartsAt;
    }
    const previousWeekBattles = Math.max(0, Math.floor(account.rankedWeeklyProgress.previousWeekBattles ?? 0));
    if (previousWeekBattles > 0) {
      rankedWeeklyProgress.previousWeekBattles = previousWeekBattles;
    }
    const previousWeekWins = Math.max(0, Math.floor(account.rankedWeeklyProgress.previousWeekWins ?? 0));
    if (previousWeekWins > 0) {
      rankedWeeklyProgress.previousWeekWins = previousWeekWins;
    }
  }
  const dailyQuestBoard = normalizeDailyQuestBoard(account?.dailyQuestBoard);
  const campaignProgress = normalizeCampaignProgressState(account?.campaignProgress);
  const dailyDungeonState = normalizeDailyDungeonState(account?.dailyDungeonState);
  const seasonalEventStates = normalizeSeasonalEventStates(account?.seasonalEventStates);
  const mailbox = normalizePlayerMailboxMessages(account?.mailbox);
  const mailboxSummary = normalizePlayerMailboxSummary(account?.mailboxSummary, mailbox);
  const tutorialStep = normalizeTutorialStep(account?.tutorialStep);

  return {
    playerId,
    displayName: displayName || playerId || "player",
    ...(avatarUrl ? { avatarUrl } : {}),
    eloRating: normalizeEloRating(account?.eloRating),
    rankDivision,
    peakRankDivision,
    ...(promotionSeries ? { promotionSeries } : {}),
    ...(demotionShield ? { demotionShield } : {}),
    ...(seasonHistory.length > 0 ? { seasonHistory } : {}),
    ...(rankedWeeklyProgress ? { rankedWeeklyProgress } : {}),
    gems: Math.max(0, Math.floor(account?.gems ?? 0)),
    ...(loginStreak > 0 ? { loginStreak } : {}),
    ...(seasonXp > 0 ? { seasonXp } : {}),
    ...(seasonPassTier > 1 ? { seasonPassTier } : {}),
    ...(seasonPassPremium ? { seasonPassPremium } : {}),
    ...(cosmeticInventory.ownedIds.length > 0 ? { cosmeticInventory } : {}),
    ...(Object.keys(equippedCosmetics).length > 0 ? { equippedCosmetics } : {}),
    ...(account?.currentShopRotation ? { currentShopRotation: account.currentShopRotation } : {}),
    ...(seasonPassClaimedTiers.length > 0 ? { seasonPassClaimedTiers } : {}),
    ...(seasonBadges.length > 0 ? { seasonBadges } : {}),
    globalResources: {
      gold: Math.max(0, Math.floor(account?.globalResources?.gold ?? 0)),
      wood: Math.max(0, Math.floor(account?.globalResources?.wood ?? 0)),
      ore: Math.max(0, Math.floor(account?.globalResources?.ore ?? 0))
    },
    achievements: normalizeAchievementProgress(account?.achievements),
    recentEventLog,
    recentBattleReplays,
    battleReportCenter: normalizePlayerBattleReportCenter(account?.battleReportCenter, {
      replays: recentBattleReplays,
      eventLog: recentEventLog
    }),
    ...(dailyQuestBoard ? { dailyQuestBoard } : {}),
    ...(campaignProgress ? { campaignProgress } : {}),
    ...(dailyDungeonState ? { dailyDungeonState } : {}),
    ...(seasonalEventStates ? { seasonalEventStates } : {}),
    ...(mailbox.length > 0 ? { mailbox } : {}),
    ...(mailboxSummary.totalCount > 0 ? { mailboxSummary } : {}),
    ...(account?.tutorialStep !== undefined ? { tutorialStep } : {}),
    ...(loginId ? { loginId } : {}),
    ...(credentialBoundAt ? { credentialBoundAt } : {}),
    ...(privacyConsentAt ? { privacyConsentAt } : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(phoneNumberBoundAt ? { phoneNumberBoundAt } : {}),
    ...(notificationPreferences ? { notificationPreferences } : {}),
    ...(ageVerified ? { ageVerified } : {}),
    ...(isMinor ? { isMinor } : {}),
    ...(dailyPlayMinutes > 0 ? { dailyPlayMinutes } : {}),
    ...(lastPlayDate ? { lastPlayDate } : {}),
    ...(banStatus !== "none" ? { banStatus } : {}),
    ...(banExpiry ? { banExpiry } : {}),
    ...(banReason ? { banReason } : {}),
    ...(leaderboardAbuseState ? { leaderboardAbuseState } : {}),
    ...(leaderboardModerationState ? { leaderboardModerationState } : {}),
    ...(lastRoomId ? { lastRoomId } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(experiments.length > 0 ? { experiments } : {})
  };
}

function normalizeNotificationPreferences(
  preferences?: Partial<NotificationPreferences> | null
): NotificationPreferences | undefined {
  if (!preferences || typeof preferences !== "object") {
    return undefined;
  }

  const updatedAt = preferences.updatedAt?.trim();
  return {
    matchFound: preferences.matchFound !== false,
    turnReminder: preferences.turnReminder !== false,
    groupChallenge: preferences.groupChallenge !== false,
    friendLeaderboard: preferences.friendLeaderboard !== false,
    ...(updatedAt ? { updatedAt } : {})
  };
}

function normalizePlayerMailboxGrant(grant?: Partial<PlayerMailboxGrant> | null): PlayerMailboxGrant | undefined {
  if (!grant) {
    return undefined;
  }

  const equipmentIds = Array.from(
    new Set(
      (grant.equipmentIds ?? [])
        .map((equipmentId) => equipmentId?.trim())
        .filter((equipmentId): equipmentId is EquipmentId => Boolean(equipmentId))
    )
  );
  const cosmeticIds = Array.from(
    new Set(
      (grant.cosmeticIds ?? [])
        .map((cosmeticId) => cosmeticId?.trim())
        .filter((cosmeticId): cosmeticId is CosmeticId => Boolean(cosmeticId))
    )
  );
  const seasonBadges = Array.from(
    new Set(
      (grant.seasonBadges ?? [])
        .map((badge) => badge?.trim())
        .filter((badge): badge is string => Boolean(badge))
    )
  );
  const normalizedResources = {
    gold: Math.max(0, Math.floor(grant.resources?.gold ?? 0)),
    wood: Math.max(0, Math.floor(grant.resources?.wood ?? 0)),
    ore: Math.max(0, Math.floor(grant.resources?.ore ?? 0))
  };
  const normalized: PlayerMailboxGrant = {
    ...(Math.max(0, Math.floor(grant.gems ?? 0)) > 0 ? { gems: Math.max(0, Math.floor(grant.gems ?? 0)) } : {}),
    ...(normalizedResources.gold > 0 || normalizedResources.wood > 0 || normalizedResources.ore > 0
      ? { resources: normalizedResources }
      : {}),
    ...(equipmentIds.length > 0 ? { equipmentIds } : {}),
    ...(cosmeticIds.length > 0 ? { cosmeticIds } : {}),
    ...(seasonBadges.length > 0 ? { seasonBadges } : {}),
    ...(grant.seasonPassPremium === true ? { seasonPassPremium: true } : {})
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizePlayerMailboxMessages(mailbox?: Partial<PlayerMailboxMessage>[] | null): PlayerMailboxMessage[] {
  return (mailbox ?? [])
    .map((entry) => {
      const id = entry?.id?.trim();
      const title = entry?.title?.trim();
      const body = entry?.body?.trim();
      const sentAt = normalizeTimestamp(entry?.sentAt);
      if (!id || !title || !body || !sentAt) {
        return null;
      }

      return {
        id,
        kind: entry.kind === "compensation" || entry.kind === "announcement" ? entry.kind : "system",
        title,
        body,
        sentAt,
        ...(normalizeTimestamp(entry.expiresAt) ? { expiresAt: normalizeTimestamp(entry.expiresAt)! } : {}),
        ...(normalizeTimestamp(entry.readAt) ? { readAt: normalizeTimestamp(entry.readAt)! } : {}),
        ...(normalizeTimestamp(entry.claimedAt) ? { claimedAt: normalizeTimestamp(entry.claimedAt)! } : {}),
        ...(normalizePlayerMailboxGrant(entry.grant) ? { grant: normalizePlayerMailboxGrant(entry.grant)! } : {})
      } satisfies PlayerMailboxMessage;
    })
    .filter((entry): entry is PlayerMailboxMessage => Boolean(entry))
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt) || left.id.localeCompare(right.id));
}

export function isPlayerMailboxMessageExpired(message: Pick<PlayerMailboxMessage, "expiresAt">, now = new Date()): boolean {
  if (!message.expiresAt) {
    return false;
  }

  const expiresAt = new Date(message.expiresAt);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime();
}

export function summarizePlayerMailbox(
  mailbox?: Partial<PlayerMailboxMessage>[] | null,
  now = new Date()
): PlayerMailboxSummary {
  const normalizedMailbox = normalizePlayerMailboxMessages(mailbox);
  let unreadCount = 0;
  let claimableCount = 0;
  let expiredCount = 0;

  for (const entry of normalizedMailbox) {
    const expired = isPlayerMailboxMessageExpired(entry, now);
    if (expired) {
      expiredCount += 1;
    }
    if (!entry.readAt && !entry.claimedAt && !expired) {
      unreadCount += 1;
    }
    if (!entry.claimedAt && !expired && entry.grant) {
      claimableCount += 1;
    }
  }

  return {
    totalCount: normalizedMailbox.length,
    unreadCount,
    claimableCount,
    expiredCount
  };
}

function normalizePlayerMailboxSummary(
  summary?: Partial<PlayerMailboxSummary> | null,
  mailbox?: Partial<PlayerMailboxMessage>[] | null
): PlayerMailboxSummary {
  const fallback = summarizePlayerMailbox(mailbox);
  return {
    totalCount: Math.max(0, Math.floor(summary?.totalCount ?? fallback.totalCount)),
    unreadCount: Math.max(0, Math.floor(summary?.unreadCount ?? fallback.unreadCount)),
    claimableCount: Math.max(0, Math.floor(summary?.claimableCount ?? fallback.claimableCount)),
    expiredCount: Math.max(0, Math.floor(summary?.expiredCount ?? fallback.expiredCount))
  };
}

function normalizeTimestamp(value?: string | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeDateKey(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

function normalizeCampaignProgressState(
  campaignProgress?: Partial<CampaignProgressState> | null
): CampaignProgressState | undefined {
  const missions = Array.from(
    new Map(
      (campaignProgress?.missions ?? [])
        .map((mission) => {
          const missionId = mission.missionId?.trim();
          if (!missionId) {
            return null;
          }

          return [
            missionId,
            {
              missionId,
              attempts: Math.max(0, Math.floor(mission.attempts ?? 0)),
              ...(Array.isArray(mission.acknowledgedDialogueLineIds)
                ? {
                    acknowledgedDialogueLineIds: Array.from(
                      new Set(
                        mission.acknowledgedDialogueLineIds
                          .map((lineId) => lineId?.trim())
                          .filter((lineId): lineId is string => Boolean(lineId))
                      )
                    ).sort((left, right) => left.localeCompare(right))
                  }
                : {}),
              ...(normalizeTimestamp(mission.completedAt) ? { completedAt: normalizeTimestamp(mission.completedAt) } : {})
            }
          ] as const;
        })
        .filter((entry): entry is readonly [string, CampaignProgressState["missions"][number]] => Boolean(entry))
    ).values()
  ).sort((left, right) => left.missionId.localeCompare(right.missionId));

  return missions.length > 0 ? { missions } : undefined;
}

function normalizeDailyDungeonState(
  dailyDungeonState?: Partial<DailyDungeonState> | null
): DailyDungeonState | undefined {
  const dateKey = normalizeDateKey(dailyDungeonState?.dateKey);
  const claimedRunIds = Array.from(
    new Set(
      (dailyDungeonState?.claimedRunIds ?? [])
        .map((runId) => runId?.trim())
        .filter((runId): runId is string => Boolean(runId))
    )
  ).sort((left, right) => left.localeCompare(right));
  const runs = Array.from(
    new Map(
      (dailyDungeonState?.runs ?? [])
        .map((run) => {
          const runId = run.runId?.trim();
          const dungeonId = run.dungeonId?.trim();
          const startedAt = normalizeTimestamp(run.startedAt);
          if (!runId || !dungeonId || !startedAt) {
            return null;
          }

          return [
            runId,
            {
              runId,
              dungeonId,
              floor: Math.max(1, Math.floor(run.floor ?? 1)),
              startedAt,
              ...(normalizeTimestamp(run.rewardClaimedAt)
                ? { rewardClaimedAt: normalizeTimestamp(run.rewardClaimedAt) }
                : {})
            }
          ] as const;
        })
        .filter((entry): entry is readonly [string, DailyDungeonState["runs"][number]] => Boolean(entry))
    ).values()
  ).sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.runId.localeCompare(right.runId));

  const attemptsUsed = Math.max(
    0,
    Math.max(
      Math.floor(dailyDungeonState?.attemptsUsed ?? 0),
      runs.length
    )
  );

  return dateKey
    ? {
        dateKey,
        attemptsUsed,
        claimedRunIds,
        runs
      }
    : undefined;
}

function normalizeSeasonalEventStates(
  seasonalEventStates?: Partial<SeasonalEventState>[] | null
): SeasonalEventState[] | undefined {
  const states = Array.from(
    new Map(
      (seasonalEventStates ?? [])
        .map((state) => {
          const eventId = state.eventId?.trim();
          const lastUpdatedAt = normalizeTimestamp(state.lastUpdatedAt);
          if (!eventId || !lastUpdatedAt) {
            return null;
          }

          return [
            eventId,
            {
              eventId,
              points: Math.max(0, Math.floor(state.points ?? 0)),
              claimedRewardIds: Array.from(
                new Set(
                  (state.claimedRewardIds ?? [])
                    .map((rewardId) => rewardId?.trim())
                    .filter((rewardId): rewardId is string => Boolean(rewardId))
                )
              ).sort((left, right) => left.localeCompare(right)),
              appliedActionIds: Array.from(
                new Set(
                  (state.appliedActionIds ?? [])
                    .map((actionId) => actionId?.trim())
                    .filter((actionId): actionId is string => Boolean(actionId))
                )
              ).sort((left, right) => left.localeCompare(right)),
              lastUpdatedAt
            }
          ] as const;
        })
        .filter((entry): entry is readonly [string, SeasonalEventState] => Boolean(entry))
    ).values()
  ).sort((left, right) => left.eventId.localeCompare(right.eventId));

  return states.length > 0 ? states : undefined;
}
