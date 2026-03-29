import {
  buildAchievementUiItems,
  formatAchievementLabel,
  type AchievementId,
  type EventLogEntry,
  type PlayerAchievementProgress
} from "./project-shared/index.ts";

export interface CocosAchievementPanelItem {
  id: AchievementId;
  title: string;
  description: string;
  progressLabel: string;
  footnote: string;
  statusLabel: string;
  isUnlocked: boolean;
}

export interface CocosAchievementUnlockNotice {
  eventId: string;
  title: string;
  detail: string;
}

const ACHIEVEMENT_UNLOCK_PREFIX = "解锁成就：";
const GAMEPLAY_ACCOUNT_REFRESH_EVENT_TYPES = new Set([
  "battle.started",
  "battle.resolved",
  "hero.equipmentFound",
  "hero.skillLearned",
  "hero.equipmentChanged",
  "hero.moved"
]);

export function buildCocosAchievementPanelItems(progress: PlayerAchievementProgress[]): CocosAchievementPanelItem[] {
  return buildAchievementUiItems(progress).map((achievement) => ({
    id: achievement.id,
    title: achievement.title,
    description: achievement.description,
    progressLabel: achievement.progressLabel,
    footnote: achievement.footnote,
    statusLabel: achievement.statusLabel,
    isUnlocked: achievement.isUnlocked
  }));
}

export function isAchievementUnlockedEventLogEntry(entry: EventLogEntry): boolean {
  return (
    entry.category === "achievement" &&
    (entry.description.startsWith(ACHIEVEMENT_UNLOCK_PREFIX) || entry.rewards.some((reward) => reward.type === "badge"))
  );
}

export function buildCocosAchievementUnlockNotice(
  recentEventLog: EventLogEntry[],
  seenEntryIds: ReadonlySet<string>
): CocosAchievementUnlockNotice | null {
  const nextEntry = recentEventLog.find(
    (entry) => isAchievementUnlockedEventLogEntry(entry) && !seenEntryIds.has(entry.id)
  );
  if (!nextEntry) {
    return null;
  }

  const detail = nextEntry.rewards.find((reward) => reward.type === "badge")?.label
    ?? nextEntry.description.slice(ACHIEVEMENT_UNLOCK_PREFIX.length).trim()
    ?? formatAchievementLabel(nextEntry.achievementId)
    ?? "未知成就";
  return {
    eventId: nextEntry.id,
    title: "成就解锁",
    detail
  };
}

export function collectAchievementUnlockEventIds(recentEventLog: EventLogEntry[]): string[] {
  return recentEventLog.filter(isAchievementUnlockedEventLogEntry).map((entry) => entry.id);
}

export function shouldRefreshGameplayAccountProfileForEvents(eventTypes: string[]): boolean {
  return eventTypes.some((eventType) => GAMEPLAY_ACCOUNT_REFRESH_EVENT_TYPES.has(eventType));
}
