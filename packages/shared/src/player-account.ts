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
import { normalizeEloRating } from "./matchmaking.ts";
import type { CampaignProgressState, DailyDungeonState, ResourceLedger } from "./models.ts";
import { normalizeTutorialStep } from "./tutorial.ts";

export type PlayerBanStatus = "none" | "temporary" | "permanent";

export interface PlayerAccountReadModel {
  playerId: string;
  displayName: string;
  avatarUrl?: string;
  eloRating?: number;
  gems?: number;
  loginStreak?: number;
  seasonXp?: number;
  seasonPassTier?: number;
  seasonPassPremium?: boolean;
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
  tutorialStep?: number | null;
  loginId?: string;
  credentialBoundAt?: string;
  privacyConsentAt?: string;
  phoneNumber?: string;
  phoneNumberBoundAt?: string;
  ageVerified?: boolean;
  isMinor?: boolean;
  dailyPlayMinutes?: number;
  lastPlayDate?: string;
  banStatus?: PlayerBanStatus;
  banExpiry?: string;
  banReason?: string;
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
  seasonXp?: number | undefined;
  seasonPassTier?: number | undefined;
  seasonPassPremium?: boolean | undefined;
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
  tutorialStep?: number | null | undefined;
  loginId?: string | undefined;
  credentialBoundAt?: string | undefined;
  privacyConsentAt?: string | undefined;
  phoneNumber?: string | undefined;
  phoneNumberBoundAt?: string | undefined;
  ageVerified?: boolean | undefined;
  isMinor?: boolean | undefined;
  dailyPlayMinutes?: number | undefined;
  lastPlayDate?: string | undefined;
  banStatus?: PlayerBanStatus | undefined;
  banExpiry?: string | undefined;
  banReason?: string | undefined;
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
  const phoneNumber = account?.phoneNumber?.trim();
  const phoneNumberBoundAt = account?.phoneNumberBoundAt?.trim();
  const ageVerified = account?.ageVerified === true;
  const isMinor = account?.isMinor === true;
  const dailyPlayMinutes = Math.max(0, Math.floor(account?.dailyPlayMinutes ?? 0));
  const loginStreak = Math.max(0, Math.floor(account?.loginStreak ?? 0));
  const seasonXp = Math.max(0, Math.floor(account?.seasonXp ?? 0));
  const seasonPassTier = Math.max(1, Math.floor(account?.seasonPassTier ?? 1));
  const seasonPassPremium = account?.seasonPassPremium === true;
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
  const lastRoomId = account?.lastRoomId?.trim();
  const lastSeenAt = account?.lastSeenAt?.trim();
  const recentEventLog = normalizeEventLogEntries(account?.recentEventLog);
  const recentBattleReplays = normalizePlayerBattleReplaySummaries(account?.recentBattleReplays);
  const dailyQuestBoard = normalizeDailyQuestBoard(account?.dailyQuestBoard);
  const campaignProgress = normalizeCampaignProgressState(account?.campaignProgress);
  const dailyDungeonState = normalizeDailyDungeonState(account?.dailyDungeonState);
  const tutorialStep = normalizeTutorialStep(account?.tutorialStep);

  return {
    playerId,
    displayName: displayName || playerId || "player",
    ...(avatarUrl ? { avatarUrl } : {}),
    eloRating: normalizeEloRating(account?.eloRating),
    gems: Math.max(0, Math.floor(account?.gems ?? 0)),
    ...(loginStreak > 0 ? { loginStreak } : {}),
    ...(seasonXp > 0 ? { seasonXp } : {}),
    ...(seasonPassTier > 1 ? { seasonPassTier } : {}),
    ...(seasonPassPremium ? { seasonPassPremium } : {}),
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
    ...(account?.tutorialStep !== undefined ? { tutorialStep } : {}),
    ...(loginId ? { loginId } : {}),
    ...(credentialBoundAt ? { credentialBoundAt } : {}),
    ...(privacyConsentAt ? { privacyConsentAt } : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(phoneNumberBoundAt ? { phoneNumberBoundAt } : {}),
    ...(ageVerified ? { ageVerified } : {}),
    ...(isMinor ? { isMinor } : {}),
    ...(dailyPlayMinutes > 0 ? { dailyPlayMinutes } : {}),
    ...(lastPlayDate ? { lastPlayDate } : {}),
    ...(banStatus !== "none" ? { banStatus } : {}),
    ...(banExpiry ? { banExpiry } : {}),
    ...(banReason ? { banReason } : {}),
    ...(lastRoomId ? { lastRoomId } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {})
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
