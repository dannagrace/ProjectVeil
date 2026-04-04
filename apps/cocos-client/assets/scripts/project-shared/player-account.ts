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
  mailbox?: PlayerMailboxMessage[];
  mailboxSummary?: PlayerMailboxSummary;
  tutorialStep?: number | null;
  loginId?: string;
  credentialBoundAt?: string;
  privacyConsentAt?: string;
  lastRoomId?: string;
  lastSeenAt?: string;
}

export interface PlayerMailboxGrant {
  gems?: number;
  resources?: Partial<ResourceLedger>;
  equipmentIds?: string[];
  cosmeticIds?: string[];
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
  mailbox?: Partial<PlayerMailboxMessage>[] | null | undefined;
  mailboxSummary?: Partial<PlayerMailboxSummary> | null | undefined;
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
  const mailbox = normalizePlayerMailboxMessages(account?.mailbox);
  const mailboxSummary = normalizePlayerMailboxSummary(account?.mailboxSummary, mailbox);
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
    ...(mailbox.length > 0 ? { mailbox } : {}),
    ...(mailboxSummary.totalCount > 0 ? { mailboxSummary } : {}),
    ...(account?.tutorialStep !== undefined ? { tutorialStep } : {}),
    ...(loginId ? { loginId } : {}),
    ...(credentialBoundAt ? { credentialBoundAt } : {}),
    ...(privacyConsentAt ? { privacyConsentAt } : {}),
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

function normalizePlayerMailboxGrant(grant?: Partial<PlayerMailboxGrant> | null): PlayerMailboxGrant | undefined {
  if (!grant) {
    return undefined;
  }

  const normalized: PlayerMailboxGrant = {
    ...(Math.max(0, Math.floor(grant.gems ?? 0)) > 0 ? { gems: Math.max(0, Math.floor(grant.gems ?? 0)) } : {}),
    ...((grant.resources?.gold ?? 0) > 0 || (grant.resources?.wood ?? 0) > 0 || (grant.resources?.ore ?? 0) > 0
      ? {
          resources: {
            gold: Math.max(0, Math.floor(grant.resources?.gold ?? 0)),
            wood: Math.max(0, Math.floor(grant.resources?.wood ?? 0)),
            ore: Math.max(0, Math.floor(grant.resources?.ore ?? 0))
          }
        }
      : {}),
    ...((grant.equipmentIds?.length ?? 0) > 0
      ? { equipmentIds: Array.from(new Set((grant.equipmentIds ?? []).map((entry) => entry?.trim()).filter(Boolean))) }
      : {}),
    ...((grant.cosmeticIds?.length ?? 0) > 0
      ? { cosmeticIds: Array.from(new Set((grant.cosmeticIds ?? []).map((entry) => entry?.trim()).filter(Boolean))) }
      : {}),
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

      const grant = normalizePlayerMailboxGrant(entry.grant);
      return {
        id,
        kind: entry.kind === "compensation" || entry.kind === "announcement" ? entry.kind : "system",
        title,
        body,
        sentAt,
        ...(normalizeTimestamp(entry.expiresAt) ? { expiresAt: normalizeTimestamp(entry.expiresAt)! } : {}),
        ...(normalizeTimestamp(entry.readAt) ? { readAt: normalizeTimestamp(entry.readAt)! } : {}),
        ...(normalizeTimestamp(entry.claimedAt) ? { claimedAt: normalizeTimestamp(entry.claimedAt)! } : {}),
        ...(grant ? { grant } : {})
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

export function summarizePlayerMailbox(mailbox?: Partial<PlayerMailboxMessage>[] | null, now = new Date()): PlayerMailboxSummary {
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
