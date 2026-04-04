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
import type { CosmeticInventory, EquippedCosmetics, ResourceLedger, ShopRotation } from "./models.ts";
import { normalizeCosmeticInventory, normalizeEquippedCosmetics } from "./cosmetics.ts";
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
  cosmeticInventory?: CosmeticInventory;
  equippedCosmetics?: EquippedCosmetics;
  currentShopRotation?: ShopRotation;
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
  cosmeticInventory?: Partial<CosmeticInventory> | null | undefined;
  equippedCosmetics?: Partial<EquippedCosmetics> | null | undefined;
  currentShopRotation?: ShopRotation | null | undefined;
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
  const loginStreak = Math.max(0, Math.floor(account?.loginStreak ?? 0));
  const cosmeticInventory = normalizeCosmeticInventory(account?.cosmeticInventory);
  const equippedCosmetics = normalizeEquippedCosmetics(account?.equippedCosmetics);
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
    ...(cosmeticInventory.ownedIds.length > 0 ? { cosmeticInventory } : {}),
    ...(Object.keys(equippedCosmetics).length > 0 ? { equippedCosmetics } : {}),
    ...(account?.currentShopRotation ? { currentShopRotation: account.currentShopRotation } : {}),
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
    ...(lastRoomId ? { lastRoomId } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {})
  };
}
