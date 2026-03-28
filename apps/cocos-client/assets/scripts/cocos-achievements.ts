import {
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

function formatAchievementTimestamp(value?: string): string {
  if (!value) {
    return "时间待同步";
  }

  const normalized = value.trim();
  if (!normalized) {
    return "时间待同步";
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return parsed.toISOString().slice(0, 16).replace("T", " ");
}

function compareAchievementDisplayOrder(left: PlayerAchievementProgress, right: PlayerAchievementProgress): number {
  if (left.unlocked !== right.unlocked) {
    return left.unlocked ? -1 : 1;
  }

  const leftStarted = left.current > 0 || Boolean(left.progressUpdatedAt);
  const rightStarted = right.current > 0 || Boolean(right.progressUpdatedAt);
  if (leftStarted !== rightStarted) {
    return leftStarted ? -1 : 1;
  }

  const leftTimestamp = left.unlocked ? left.unlockedAt ?? left.progressUpdatedAt ?? "" : left.progressUpdatedAt ?? "";
  const rightTimestamp = right.unlocked ? right.unlockedAt ?? right.progressUpdatedAt ?? "" : right.progressUpdatedAt ?? "";
  const timestampOrder = rightTimestamp.localeCompare(leftTimestamp);
  if (timestampOrder !== 0) {
    return timestampOrder;
  }

  const progressOrder = right.current - left.current;
  return progressOrder || left.title.localeCompare(right.title, "zh-Hans-CN");
}

function formatAchievementFootnote(achievement: PlayerAchievementProgress): string {
  if (achievement.unlocked) {
    return `解锁于 ${formatAchievementTimestamp(achievement.unlockedAt ?? achievement.progressUpdatedAt)}`;
  }

  const remaining = Math.max(0, achievement.target - achievement.current);
  if (achievement.progressUpdatedAt) {
    return `最近推进 ${formatAchievementTimestamp(achievement.progressUpdatedAt)} · 还差 ${remaining} 点进度`;
  }

  return `还差 ${remaining} 点进度`;
}

export function buildCocosAchievementPanelItems(progress: PlayerAchievementProgress[]): CocosAchievementPanelItem[] {
  return [...progress].sort(compareAchievementDisplayOrder).map((achievement) => ({
    id: achievement.id,
    title: achievement.title,
    description: achievement.description,
    progressLabel: `${achievement.current}/${achievement.target}`,
    footnote: formatAchievementFootnote(achievement),
    statusLabel: achievement.unlocked ? "已解锁" : "未解锁",
    isUnlocked: achievement.unlocked
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
