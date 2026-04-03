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
import { normalizePlayerBattleReplaySummaries, type PlayerBattleReplaySummary } from "./battle-replay.ts";
import { normalizeEloRating } from "./matchmaking.ts";
import type { ResourceLedger } from "./models.ts";

export type PlayerBanStatus = "none" | "temporary" | "permanent";

export interface PlayerAccountReadModel {
  playerId: string;
  displayName: string;
  avatarUrl?: string;
  eloRating?: number;
  globalResources: ResourceLedger;
  achievements: PlayerAchievementProgress[];
  recentEventLog: EventLogEntry[];
  recentBattleReplays?: PlayerBattleReplaySummary[];
  battleReportCenter?: PlayerBattleReportCenter;
  loginId?: string;
  credentialBoundAt?: string;
  privacyConsentAt?: string;
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
  globalResources?: Partial<ResourceLedger> | null | undefined;
  achievements?: Partial<PlayerAchievementProgress>[] | null | undefined;
  recentEventLog?: Partial<EventLogEntry>[] | null | undefined;
  recentBattleReplays?: Partial<PlayerBattleReplaySummary>[] | null | undefined;
  battleReportCenter?: Partial<PlayerBattleReportCenter> | null | undefined;
  loginId?: string | undefined;
  credentialBoundAt?: string | undefined;
  privacyConsentAt?: string | undefined;
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
  const ageVerified = account?.ageVerified === true;
  const isMinor = account?.isMinor === true;
  const dailyPlayMinutes = Math.max(0, Math.floor(account?.dailyPlayMinutes ?? 0));
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

  return {
    playerId,
    displayName: displayName || playerId || "player",
    ...(avatarUrl ? { avatarUrl } : {}),
    eloRating: normalizeEloRating(account?.eloRating),
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
    ...(loginId ? { loginId } : {}),
    ...(credentialBoundAt ? { credentialBoundAt } : {}),
    ...(privacyConsentAt ? { privacyConsentAt } : {}),
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
