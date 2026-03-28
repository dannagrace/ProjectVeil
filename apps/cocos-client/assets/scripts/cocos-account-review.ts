import type { CocosPlayerAccountProfile } from "./cocos-lobby.ts";
import { buildCocosAchievementPanelItems } from "./cocos-achievements.ts";

export type CocosAccountReviewSection = "battle-replays" | "event-history" | "achievements";

export interface CocosAccountReviewTab {
  section: CocosAccountReviewSection;
  label: string;
  count: number;
}

export interface CocosAccountReviewItem {
  title: string;
  detail: string;
  footnote: string;
  emphasis: "positive" | "neutral";
  replayId?: string;
}

export interface CocosAccountReviewPage {
  section: CocosAccountReviewSection;
  title: string;
  subtitle: string;
  items: CocosAccountReviewItem[];
  page: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  tabs: CocosAccountReviewTab[];
}

const SECTION_ORDER: CocosAccountReviewSection[] = ["battle-replays", "event-history", "achievements"];

function formatReviewTimestamp(value?: string): string {
  if (!value) {
    return "时间待同步";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 16).replace("T", " ");
}

function formatBattleReplayTitle(replay: CocosPlayerAccountProfile["recentBattleReplays"][number]): string {
  const resultLabel = replay.result === "attacker_victory" ? "胜利" : "失利";
  const battleKindLabel = replay.battleKind === "hero" ? "PVP" : "PVE";
  const encounterLabel = replay.battleKind === "hero"
    ? replay.opponentHeroId
      ? `对手 ${replay.opponentHeroId}`
      : "对手英雄"
    : replay.neutralArmyId
      ? `守军 ${replay.neutralArmyId}`
      : "中立守军";
  return `${resultLabel} · ${battleKindLabel} · ${encounterLabel}`;
}

function formatBattleReplayFootnote(replay: CocosPlayerAccountProfile["recentBattleReplays"][number]): string {
  const campLabel = replay.playerCamp === "attacker" ? "攻方" : "守方";
  return `${formatReviewTimestamp(replay.completedAt)} · ${campLabel} · 房间 ${replay.roomId}`;
}

function buildBattleReplayItems(account: CocosPlayerAccountProfile): CocosAccountReviewItem[] {
  return account.recentBattleReplays.map((replay) => ({
    title: formatBattleReplayTitle(replay),
    detail: `英雄 ${replay.heroId} · ${replay.steps.length} 步文本回顾`,
    footnote: formatBattleReplayFootnote(replay),
    emphasis: replay.result === "attacker_victory" ? "positive" : "neutral",
    replayId: replay.id
  }));
}

function buildEventHistoryItems(account: CocosPlayerAccountProfile): CocosAccountReviewItem[] {
  return account.recentEventLog.map((entry) => ({
    title: entry.description,
    detail: `分类 ${entry.category}${entry.worldEventType ? ` · ${entry.worldEventType}` : ""}`,
    footnote: formatReviewTimestamp(entry.timestamp),
    emphasis: entry.category === "achievement" ? "positive" : "neutral"
  }));
}

function buildAchievementItems(account: CocosPlayerAccountProfile): CocosAccountReviewItem[] {
  const featuredAchievements = account.achievements.filter(
    (achievement) => achievement.unlocked || achievement.current > 0 || Boolean(achievement.progressUpdatedAt)
  );
  const source = featuredAchievements.length > 0 ? featuredAchievements : account.achievements;

  return buildCocosAchievementPanelItems(source).map((item) => ({
    title: `${item.title} · ${item.statusLabel}`,
    detail: `${item.progressLabel} · ${item.description}`,
    footnote: item.footnote,
    emphasis: item.isUnlocked ? "positive" : "neutral"
  }));
}

function buildItems(account: CocosPlayerAccountProfile, section: CocosAccountReviewSection): CocosAccountReviewItem[] {
  switch (section) {
    case "battle-replays":
      return buildBattleReplayItems(account);
    case "event-history":
      return buildEventHistoryItems(account);
    case "achievements":
      return buildAchievementItems(account);
  }
}

function buildSubtitle(section: CocosAccountReviewSection, count: number): string {
  switch (section) {
    case "battle-replays":
      return count > 0
        ? `最近 ${count} 条战报摘要，当前先提供文本化复盘入口。`
        : "最近还没有战报；完成战斗后会同步摘要。";
    case "event-history":
      return count > 0
        ? `最近 ${count} 条事件历史，按时间倒序分页查看。`
        : "最近还没有事件历史；进入房间后触发探索或战斗即可积累。";
    case "achievements":
      return count > 0
        ? "优先展示已解锁与最近推进的成就，没有进度时回退全量目录。"
        : "成就目录暂未同步。";
  }
}

function buildTabs(account: CocosPlayerAccountProfile): CocosAccountReviewTab[] {
  return [
    {
      section: "battle-replays",
      label: "战报",
      count: account.recentBattleReplays.length
    },
    {
      section: "event-history",
      label: "事件",
      count: account.recentEventLog.length
    },
    {
      section: "achievements",
      label: "成就",
      count: buildAchievementItems(account).length
    }
  ];
}

export function buildCocosAccountReviewPage(
  account: CocosPlayerAccountProfile,
  section: CocosAccountReviewSection,
  page: number,
  pageSize = 3
): CocosAccountReviewPage {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const items = buildItems(account, section);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.max(0, Math.min(totalPages - 1, Math.floor(page)));
  const start = safePage * safePageSize;

  return {
    section,
    title:
      section === "battle-replays"
        ? "账号战报"
        : section === "event-history"
          ? "事件历史"
          : "成就回顾",
    subtitle: buildSubtitle(section, items.length),
    items: items.slice(start, start + safePageSize),
    page: safePage,
    totalPages,
    hasPreviousPage: safePage > 0,
    hasNextPage: safePage < totalPages - 1,
    tabs: buildTabs(account).sort(
      (left, right) => SECTION_ORDER.indexOf(left.section) - SECTION_ORDER.indexOf(right.section)
    )
  };
}
