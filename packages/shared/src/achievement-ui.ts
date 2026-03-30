import {
  normalizeAchievementProgress,
  type AchievementId,
  type PlayerAchievementProgress
} from "./event-log.ts";

export type AchievementUiCategoryId = "combat" | "exploration" | "progression" | "equipment";

export interface AchievementUiCategory {
  id: AchievementUiCategoryId;
  label: string;
}

export interface AchievementUiItem {
  id: AchievementId;
  title: string;
  description: string;
  category: AchievementUiCategory;
  current: number;
  target: number;
  progressFraction: number;
  progressPercent: number;
  progressLabel: string;
  statusLabel: string;
  footnote: string;
  isUnlocked: boolean;
  unlockedAt?: string;
  progressUpdatedAt?: string;
}

export interface AchievementUiGroup {
  category: AchievementUiCategory;
  items: AchievementUiItem[];
}

const ACHIEVEMENT_UI_CATEGORIES: Record<AchievementUiCategoryId, AchievementUiCategory> = {
  combat: { id: "combat", label: "战斗" },
  exploration: { id: "exploration", label: "探索" },
  progression: { id: "progression", label: "养成" },
  equipment: { id: "equipment", label: "装备" }
};

const ACHIEVEMENT_CATEGORY_BY_ID: Record<AchievementId, AchievementUiCategoryId> = {
  first_battle: "combat",
  enemy_slayer: "combat",
  skill_scholar: "progression",
  world_explorer: "exploration",
  epic_collector: "equipment"
};

const ACHIEVEMENT_CATEGORY_ORDER: AchievementUiCategoryId[] = ["combat", "exploration", "progression", "equipment"];

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

export function resolveAchievementUiCategory(achievementId: AchievementId): AchievementUiCategory {
  return ACHIEVEMENT_UI_CATEGORIES[ACHIEVEMENT_CATEGORY_BY_ID[achievementId]];
}

export function calculateAchievementProgressFraction(achievement: Pick<PlayerAchievementProgress, "current" | "target">): number {
  if (!Number.isFinite(achievement.target) || achievement.target <= 0) {
    return 0;
  }

  const fraction = achievement.current / achievement.target;
  if (!Number.isFinite(fraction)) {
    return 0;
  }

  return Math.min(1, Math.max(0, fraction));
}

export function formatAchievementUiFootnote(achievement: Pick<PlayerAchievementProgress, "unlocked" | "unlockedAt" | "progressUpdatedAt" | "target" | "current">): string {
  if (achievement.unlocked) {
    return `解锁于 ${formatAchievementTimestamp(achievement.unlockedAt ?? achievement.progressUpdatedAt)}`;
  }

  const remaining = Math.max(0, achievement.target - achievement.current);
  if (achievement.progressUpdatedAt) {
    return `最近推进 ${formatAchievementTimestamp(achievement.progressUpdatedAt)} · 还差 ${remaining} 点进度`;
  }

  return `还差 ${remaining} 点进度`;
}

export function buildAchievementUiItems(progress?: Partial<PlayerAchievementProgress>[] | null): AchievementUiItem[] {
  return normalizeAchievementProgress(progress)
    .sort(compareAchievementDisplayOrder)
    .map((achievement) => {
      const progressFraction = calculateAchievementProgressFraction(achievement);
      return {
        id: achievement.id,
        title: achievement.title,
        description: achievement.description,
        category: resolveAchievementUiCategory(achievement.id),
        current: achievement.current,
        target: achievement.target,
        progressFraction,
        progressPercent: Math.round(progressFraction * 100),
        progressLabel: `${achievement.current}/${achievement.target}`,
        statusLabel: achievement.unlocked ? "已解锁" : achievement.current > 0 ? "进行中" : "未开始",
        footnote: formatAchievementUiFootnote(achievement),
        isUnlocked: achievement.unlocked,
        ...(achievement.unlockedAt ? { unlockedAt: achievement.unlockedAt } : {}),
        ...(achievement.progressUpdatedAt ? { progressUpdatedAt: achievement.progressUpdatedAt } : {})
      };
    });
}

export function groupAchievementUiItems(items: AchievementUiItem[]): AchievementUiGroup[] {
  return ACHIEVEMENT_CATEGORY_ORDER.map((categoryId) => ({
    category: ACHIEVEMENT_UI_CATEGORIES[categoryId],
    items: items.filter((item) => item.category.id === categoryId)
  })).filter((group) => group.items.length > 0);
}

