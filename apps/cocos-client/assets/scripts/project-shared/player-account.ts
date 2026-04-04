import {
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
import type { NotificationPreferences, ResourceLedger } from "./models.ts";
import { normalizeTutorialStep } from "./tutorial.ts";

const DEFAULT_ELO_RATING = 1000;

function normalizeEloRating(value: number | undefined | null): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? DEFAULT_ELO_RATING)) : DEFAULT_ELO_RATING;
}

export interface PlayerAccountReadModel {
  playerId: string;
  displayName: string;
  avatarUrl?: string;
  eloRating?: number;
  gems?: number;
  loginStreak?: number;
  globalResources: ResourceLedger;
  achievements: PlayerAchievementProgress[];
  recentEventLog: EventLogEntry[];
  recentBattleReplays?: PlayerBattleReplaySummary[];
  battleReportCenter?: PlayerBattleReportCenter;
  dailyQuestBoard?: DailyQuestBoard;
  tutorialStep?: number | null;
  loginId?: string;
  credentialBoundAt?: string;
  privacyConsentAt?: string;
  notificationPreferences?: NotificationPreferences;
  lastRoomId?: string;
  lastSeenAt?: string;
}

export interface PlayerAccountReadModelInput {
  playerId?: string | undefined;
  displayName?: string | undefined;
  avatarUrl?: string | undefined;
  eloRating?: number | undefined;
  gems?: number | undefined;
  loginStreak?: number | undefined;
  globalResources?: Partial<ResourceLedger> | null | undefined;
  achievements?: Partial<PlayerAchievementProgress>[] | null | undefined;
  recentEventLog?: Partial<EventLogEntry>[] | null | undefined;
  recentBattleReplays?: Partial<PlayerBattleReplaySummary>[] | null | undefined;
  battleReportCenter?: Partial<PlayerBattleReportCenter> | null | undefined;
  dailyQuestBoard?: Partial<DailyQuestBoard> | null | undefined;
  tutorialStep?: number | null | undefined;
  loginId?: string | undefined;
  credentialBoundAt?: string | undefined;
  privacyConsentAt?: string | undefined;
  notificationPreferences?: Partial<NotificationPreferences> | null | undefined;
  lastRoomId?: string | undefined;
  lastSeenAt?: string | undefined;
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
  const notificationPreferences = normalizeNotificationPreferences(account?.notificationPreferences);
  const loginStreak = Math.max(0, Math.floor(account?.loginStreak ?? 0));
  const lastRoomId = account?.lastRoomId?.trim();
  const lastSeenAt = account?.lastSeenAt?.trim();
  const recentEventLog = normalizeEventLogEntries(account?.recentEventLog);
  const recentBattleReplays = normalizePlayerBattleReplaySummaries(account?.recentBattleReplays);
  const dailyQuestBoard = normalizeDailyQuestBoard(account?.dailyQuestBoard);
  const tutorialStep = normalizeTutorialStep(account?.tutorialStep);

  return {
    playerId,
    displayName: displayName || playerId || "player",
    ...(avatarUrl ? { avatarUrl } : {}),
    eloRating: normalizeEloRating(account?.eloRating),
    gems: Math.max(0, Math.floor(account?.gems ?? 0)),
    ...(loginStreak > 0 ? { loginStreak } : {}),
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
    ...(account?.tutorialStep !== undefined ? { tutorialStep } : {}),
    ...(loginId ? { loginId } : {}),
    ...(credentialBoundAt ? { credentialBoundAt } : {}),
    ...(privacyConsentAt ? { privacyConsentAt } : {}),
    ...(notificationPreferences ? { notificationPreferences } : {}),
    ...(lastRoomId ? { lastRoomId } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {})
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
