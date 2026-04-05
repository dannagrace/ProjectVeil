import {
  buildPlayerBattleReportCenter,
  buildPlayerProgressionSnapshot,
  formatAchievementLabel,
  formatWorldEventTypeLabel,
  getLatestProgressedAchievement,
  getLatestUnlockedAchievement,
  type EventLogEntry,
  type PlayerBattleReportCenter,
  type PlayerBattleReportSummary,
  type PlayerAchievementProgress,
  type PlayerBattleReplaySummary,
  type PlayerProgressionSnapshot
} from "./project-shared/index.ts";
import { buildCocosAchievementPanelItems } from "./cocos-achievements.ts";
import type { CocosPlayerAccountProfile } from "./cocos-lobby.ts";

export type CocosAccountReviewSection = "progression" | "battle-replays" | "event-history" | "achievements";
export type CocosAccountReviewSectionStatus = "idle" | "loading" | "ready" | "error";

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

export interface CocosAccountReviewStateBanner {
  title: string;
  detail: string;
  tone: "neutral" | "negative";
}

export interface CocosAccountReviewPage {
  section: CocosAccountReviewSection;
  title: string;
  subtitle: string;
  items: CocosAccountReviewItem[];
  page: number;
  pageLabel: string;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  tabs: CocosAccountReviewTab[];
  banner: CocosAccountReviewStateBanner | null;
  showRetry: boolean;
}

interface CocosAccountReviewCollectionState<T> {
  status: CocosAccountReviewSectionStatus;
  items: T[];
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
  errorMessage: string | null;
}

interface CocosAccountProgressionReviewState {
  status: CocosAccountReviewSectionStatus;
  snapshot: PlayerProgressionSnapshot;
  errorMessage: string | null;
}

export interface CocosAccountReviewState {
  activeSection: CocosAccountReviewSection;
  selectedBattleReplayId: string | null;
  battleReports: PlayerBattleReportCenter;
  progression: CocosAccountProgressionReviewState;
  achievements: CocosAccountReviewCollectionState<PlayerAchievementProgress>;
  eventHistory: CocosAccountReviewCollectionState<EventLogEntry>;
  battleReplays: CocosAccountReviewCollectionState<PlayerBattleReplaySummary>;
}

export type CocosAccountReviewAction =
  | { type: "account.synced"; account: CocosPlayerAccountProfile }
  | { type: "section.selected"; section: CocosAccountReviewSection }
  | { type: "battle-replay.selected"; replayId: string | null }
  | { type: "section.loading"; section: CocosAccountReviewSection }
  | { type: "progression.loaded"; snapshot: PlayerProgressionSnapshot }
  | { type: "achievements.loaded"; items: PlayerAchievementProgress[] }
  | { type: "event-history.loaded"; items: EventLogEntry[]; page: number; pageSize: number; total: number; hasMore: boolean }
  | {
      type: "battle-replays.loaded";
      items: PlayerBattleReplaySummary[];
      page: number;
      pageSize: number;
      hasMore: boolean;
    }
  | { type: "section.failed"; section: CocosAccountReviewSection; message: string };

const SECTION_ORDER: CocosAccountReviewSection[] = ["progression", "battle-replays", "event-history", "achievements"];
const DEFAULT_PAGE_SIZE = 3;

function createEmptyCollectionState<T>(pageSize = DEFAULT_PAGE_SIZE): CocosAccountReviewCollectionState<T> {
  return {
    status: "idle",
    items: [],
    page: 0,
    pageSize,
    total: 0,
    hasMore: false,
    errorMessage: null
  };
}

function deriveProgressionSnapshot(account: Pick<CocosPlayerAccountProfile, "achievements" | "recentEventLog">): PlayerProgressionSnapshot {
  return buildPlayerProgressionSnapshot(account.achievements, account.recentEventLog, account.recentEventLog.length || 12);
}

function seedCollectionState<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE): CocosAccountReviewCollectionState<T> {
  return {
    status: "ready",
    items: items.slice(0, pageSize),
    page: 0,
    pageSize,
    total: items.length,
    hasMore: items.length > pageSize,
    errorMessage: null
  };
}

function seedBattleReplaySelection(
  previousReplayId: string | null,
  items: readonly PlayerBattleReplaySummary[],
  battleReports: PlayerBattleReportCenter
): string | null {
  if (
    previousReplayId &&
    (items.some((replay) => replay.id === previousReplayId) ||
      battleReports.items.some((report) => report.id === previousReplayId))
  ) {
    return previousReplayId;
  }

  return battleReports.latestReportId ?? items[0]?.id ?? null;
}

function resolveBattleReportCenter(account: CocosPlayerAccountProfile): PlayerBattleReportCenter {
  return account.battleReportCenter && account.battleReportCenter.items.length > 0
    ? account.battleReportCenter
    : buildPlayerBattleReportCenter(account.recentBattleReplays, account.recentEventLog);
}

export function createCocosAccountReviewState(account: CocosPlayerAccountProfile): CocosAccountReviewState {
  const battleReports = resolveBattleReportCenter(account);
  return {
    activeSection: "progression",
    selectedBattleReplayId: battleReports.latestReportId ?? account.recentBattleReplays[0]?.id ?? null,
    battleReports,
    progression: {
      status: "ready",
      snapshot: deriveProgressionSnapshot(account),
      errorMessage: null
    },
    achievements: seedCollectionState(account.achievements),
    eventHistory: seedCollectionState(account.recentEventLog),
    battleReplays: seedCollectionState(account.recentBattleReplays)
  };
}

export function transitionCocosAccountReviewState(
  state: CocosAccountReviewState,
  action: CocosAccountReviewAction
): CocosAccountReviewState {
  switch (action.type) {
    case "account.synced":
      {
        const battleReports = resolveBattleReportCenter(action.account);
      return {
        ...createCocosAccountReviewState(action.account),
        activeSection: state.activeSection,
        battleReports,
        selectedBattleReplayId: seedBattleReplaySelection(
          state.selectedBattleReplayId,
          action.account.recentBattleReplays,
          battleReports
        )
      };
      }
    case "section.selected":
      return {
        ...state,
        activeSection: action.section
      };
    case "battle-replay.selected":
      return {
        ...state,
        selectedBattleReplayId: action.replayId
      };
    case "section.loading":
      if (action.section === "progression") {
        return {
          ...state,
          progression: {
            ...state.progression,
            status: "loading",
            errorMessage: null
          }
        };
      }

      if (action.section === "achievements") {
        return {
          ...state,
          achievements: {
            ...state.achievements,
            status: "loading",
            errorMessage: null
          }
        };
      }

      if (action.section === "event-history") {
        return {
          ...state,
          eventHistory: {
            ...state.eventHistory,
            status: "loading",
            errorMessage: null
          }
        };
      }

      return {
        ...state,
        battleReplays: {
          ...state.battleReplays,
          status: "loading",
          errorMessage: null
        }
      };
    case "progression.loaded":
      return {
        ...state,
        progression: {
          status: "ready",
          snapshot: action.snapshot,
          errorMessage: null
        }
      };
    case "achievements.loaded":
      return {
        ...state,
        achievements: {
          status: "ready",
          items: action.items,
          page: 0,
          pageSize: state.achievements.pageSize,
          total: action.items.length,
          hasMore: false,
          errorMessage: null
        }
      };
    case "event-history.loaded":
      return {
        ...state,
        eventHistory: {
          status: "ready",
          items: action.items,
          page: action.page,
          pageSize: action.pageSize,
          total: action.total,
          hasMore: action.hasMore,
          errorMessage: null
        }
      };
    case "battle-replays.loaded":
      return {
        ...state,
        selectedBattleReplayId:
          action.items[0]?.id ?? seedBattleReplaySelection(state.selectedBattleReplayId, action.items, state.battleReports),
        battleReplays: {
          status: "ready",
          items: action.items,
          page: action.page,
          pageSize: action.pageSize,
          total: action.hasMore ? null : action.page * action.pageSize + action.items.length,
          hasMore: action.hasMore,
          errorMessage: null
        }
      };
    case "section.failed":
      if (action.section === "progression") {
        return {
          ...state,
          progression: {
            ...state.progression,
            status: "error",
            errorMessage: action.message
          }
        };
      }

      if (action.section === "achievements") {
        return {
          ...state,
          achievements: {
            ...state.achievements,
            status: "error",
            errorMessage: action.message
          }
        };
      }

      if (action.section === "event-history") {
        return {
          ...state,
          eventHistory: {
            ...state.eventHistory,
            status: "error",
            errorMessage: action.message
          }
        };
      }

      return {
        ...state,
        battleReplays: {
          ...state.battleReplays,
          status: "error",
          errorMessage: action.message
        }
      };
  }
}

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

function formatProgressionHeadline(snapshot: PlayerProgressionSnapshot): string {
  const summary = snapshot.summary;
  const latestUnlocked = getLatestUnlockedAchievement(snapshot.achievements);
  const latestProgressed = getLatestProgressedAchievement(snapshot.achievements);
  if (latestUnlocked && latestProgressed && latestUnlocked.id !== latestProgressed.id) {
    return `成就 ${summary.unlockedAchievements}/${summary.totalAchievements} 已解锁 · 最新 ${latestUnlocked.title} · 最近推进 ${latestProgressed.title} ${latestProgressed.current}/${latestProgressed.target}`;
  }

  if (latestUnlocked) {
    return `成就 ${summary.unlockedAchievements}/${summary.totalAchievements} 已解锁 · 最新 ${latestUnlocked.title}`;
  }

  if (latestProgressed) {
    return `成就 ${summary.unlockedAchievements}/${summary.totalAchievements} 已解锁 · 最近推进 ${latestProgressed.title} ${latestProgressed.current}/${latestProgressed.target}`;
  }

  return `成就 ${summary.unlockedAchievements}/${summary.totalAchievements} 已解锁`;
}

function buildProgressionItems(snapshot: PlayerProgressionSnapshot): CocosAccountReviewItem[] {
  const summary = snapshot.summary;
  const latestUnlocked = getLatestUnlockedAchievement(snapshot.achievements);
  const latestProgressed = getLatestProgressedAchievement(snapshot.achievements);

  const items: CocosAccountReviewItem[] = [
    {
      title: "成长概览",
      detail: formatProgressionHeadline(snapshot),
      footnote: summary.latestEventAt
        ? `最近事件 ${formatReviewTimestamp(summary.latestEventAt)} · 共 ${summary.recentEventCount} 条`
        : `最近事件 ${summary.recentEventCount} 条`,
      emphasis: summary.unlockedAchievements > 0 || summary.inProgressAchievements > 0 ? "positive" : "neutral"
    }
  ];

  if (latestUnlocked) {
    items.push({
      title: `最新解锁 · ${latestUnlocked.title}`,
      detail: latestUnlocked.description,
      footnote: `解锁于 ${formatReviewTimestamp(latestUnlocked.unlockedAt ?? latestUnlocked.progressUpdatedAt)}`,
      emphasis: "positive"
    });
  }

  if (latestProgressed && (!latestUnlocked || latestProgressed.id !== latestUnlocked.id)) {
    items.push({
      title: `最近推进 · ${latestProgressed.title}`,
      detail: `${latestProgressed.current}/${latestProgressed.target} · ${latestProgressed.description}`,
      footnote: latestProgressed.progressUpdatedAt
        ? `更新于 ${formatReviewTimestamp(latestProgressed.progressUpdatedAt)}`
        : "进度待同步",
      emphasis: "neutral"
    });
  }

  if (snapshot.recentEventLog[0]) {
    items.push({
      title: "最近事件",
      detail: snapshot.recentEventLog[0].description,
      footnote: formatReviewTimestamp(snapshot.recentEventLog[0].timestamp),
      emphasis: snapshot.recentEventLog[0].category === "achievement" ? "positive" : "neutral"
    });
  }

  return items;
}

function formatBattleReplayTitle(replay: PlayerBattleReplaySummary): string {
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

function formatBattleReplayFootnote(replay: PlayerBattleReplaySummary): string {
  const campLabel = replay.playerCamp === "attacker" ? "攻方" : "守方";
  return `${formatReviewTimestamp(replay.completedAt)} · ${campLabel} · 房间 ${replay.roomId}`;
}

function formatBattleReportTitle(report: PlayerBattleReportSummary): string {
  const resultLabel = report.result === "victory" ? "胜利" : "失利";
  const battleKindLabel = report.battleKind === "hero" ? "PVP" : "PVE";
  const encounterLabel = report.battleKind === "hero"
    ? report.opponentHeroId
      ? `对手 ${report.opponentHeroId}`
      : "对手英雄"
    : report.neutralArmyId
      ? `守军 ${report.neutralArmyId}`
      : "中立守军";
  return `${resultLabel} · ${battleKindLabel} · ${encounterLabel}`;
}

function formatBattleReportFootnote(report: PlayerBattleReportSummary): string {
  const campLabel = report.playerCamp === "attacker" ? "攻方" : "守方";
  const evidenceLabel = report.evidence.replay === "available" ? "可回放" : "仅摘要";
  return `${formatReviewTimestamp(report.completedAt)} · ${campLabel} · 房间 ${report.roomId} · ${evidenceLabel}`;
}

function buildBattleReplayItems(
  reports: readonly PlayerBattleReportSummary[],
  replays: readonly PlayerBattleReplaySummary[]
): CocosAccountReviewItem[] {
  if (replays.length > 0) {
    return replays.map((replay) => {
      const report = reports.find((candidate) => candidate.id === replay.id) ?? null;
      return {
        title: report ? formatBattleReportTitle(report) : formatBattleReplayTitle(replay),
        detail: report
          ? `英雄 ${report.heroId} · ${report.actionCount} 步文本回顾`
          : `英雄 ${replay.heroId} · ${replay.steps.length} 步文本回顾`,
        footnote: report ? formatBattleReportFootnote(report) : formatBattleReplayFootnote(replay),
        emphasis: report ? (report.result === "victory" ? "positive" : "neutral") : replay.result === "attacker_victory" ? "positive" : "neutral",
        replayId: replay.id
      };
    });
  }

  return reports.map((report) => ({
    title: formatBattleReportTitle(report),
    detail: `英雄 ${report.heroId} · ${report.turnCount} 回合/${report.actionCount} 步 · 完整回放暂不可用`,
    footnote: formatBattleReportFootnote(report),
    emphasis: report.result === "victory" ? "positive" : "neutral",
    replayId: report.id
  }));
}

function buildEventHistoryItems(items: readonly EventLogEntry[]): CocosAccountReviewItem[] {
  return items.map((entry) => ({
    title: entry.description,
    detail: [
      `分类 ${entry.category}`,
      entry.worldEventType ? `事件 ${formatWorldEventTypeLabel(entry.worldEventType)}` : "",
      entry.achievementId ? `成就 ${formatAchievementLabel(entry.achievementId)}` : ""
    ]
      .filter(Boolean)
      .join(" · "),
    footnote: formatReviewTimestamp(entry.timestamp),
    emphasis: entry.category === "achievement" ? "positive" : "neutral"
  }));
}

function buildAchievementItems(items: readonly PlayerAchievementProgress[]): CocosAccountReviewItem[] {
  const featuredAchievements = items.filter(
    (achievement) => achievement.unlocked || achievement.current > 0 || Boolean(achievement.progressUpdatedAt)
  );
  const source = featuredAchievements.length > 0 ? featuredAchievements : items;

  return buildCocosAchievementPanelItems([...source]).map((item) => ({
    title: `${item.title} · ${item.statusLabel}`,
    detail: `${item.progressLabel} · ${item.description}`,
    footnote: item.footnote,
    emphasis: item.isUnlocked ? "positive" : "neutral"
  }));
}

function buildTabs(state: CocosAccountReviewState): CocosAccountReviewTab[] {
  return [
    {
      section: "progression",
      label: "成长",
      count: Math.max(1, buildProgressionItems(state.progression.snapshot).length)
    },
    {
      section: "battle-replays",
      label: "战报",
      count: Math.max(
        state.battleReports.items.length,
        state.battleReplays.total ?? state.battleReplays.items.length
      )
    },
    {
      section: "event-history",
      label: "事件",
      count: state.eventHistory.total ?? state.eventHistory.items.length
    },
    {
      section: "achievements",
      label: "成就",
      count: state.achievements.total ?? state.achievements.items.length
    }
  ];
}

function buildPageLabel(page: number, total: number | null, pageSize: number, hasMore: boolean): string {
  if (total != null) {
    return `${page + 1}/${Math.max(1, Math.ceil(total / Math.max(1, pageSize)))}`;
  }

  return hasMore ? `${page + 1}/更多` : `${page + 1}/${page + 1}`;
}

function buildSectionSubtitle(section: CocosAccountReviewSection, itemCount: number): string {
  switch (section) {
    case "progression":
      return itemCount > 0 ? "成长摘要会优先显示最新解锁、最近推进和最新事件。" : "成长摘要暂未同步。";
    case "battle-replays":
      return itemCount > 0 ? "按页查看最近战报，并可在上方切换文本时间线。" : "最近还没有战报。";
    case "event-history":
      return itemCount > 0 ? "按页查看最近事件历史，适配移动端的短卡片阅读。" : "最近还没有事件历史。";
    case "achievements":
      return itemCount > 0 ? "优先展示已解锁与最近推进的成就。" : "成就目录暂未同步。";
  }
}

function buildBanner(
  status: CocosAccountReviewSectionStatus,
  errorMessage: string | null,
  hasItems: boolean,
  sectionTitle: string
): CocosAccountReviewStateBanner | null {
  if (status === "loading") {
    return {
      title: `正在同步${sectionTitle}`,
      detail: hasItems ? "已先展示本地缓存摘要，稍后会自动更新。" : "请稍候，移动端会在当前面板内完成刷新。",
      tone: "neutral"
    };
  }

  if (status === "error") {
    return {
      title: `${sectionTitle}同步失败`,
      detail: errorMessage ?? "网络暂不可用，请稍后重试。",
      tone: "negative"
    };
  }

  return null;
}

export function buildCocosAccountReviewPage(state: CocosAccountReviewState): CocosAccountReviewPage {
  const tabs = buildTabs(state).sort((left, right) => SECTION_ORDER.indexOf(left.section) - SECTION_ORDER.indexOf(right.section));

  if (state.activeSection === "progression") {
    const items = buildProgressionItems(state.progression.snapshot);
    return {
      section: "progression",
      title: "账号成长",
      subtitle: buildSectionSubtitle("progression", items.length),
      items,
      page: 0,
      pageLabel: "1/1",
      hasPreviousPage: false,
      hasNextPage: false,
      tabs,
      banner: buildBanner(state.progression.status, state.progression.errorMessage, items.length > 0, "成长摘要"),
      showRetry: state.progression.status === "error"
    };
  }

  if (state.activeSection === "battle-replays") {
    const items = buildBattleReplayItems(state.battleReports.items, state.battleReplays.items);
    return {
      section: "battle-replays",
      title: "账号战报",
      subtitle: buildSectionSubtitle("battle-replays", items.length),
      items,
      page: state.battleReplays.page,
      pageLabel: buildPageLabel(
        state.battleReplays.page,
        Math.max(state.battleReports.items.length, state.battleReplays.total ?? 0),
        state.battleReplays.pageSize,
        state.battleReplays.hasMore
      ),
      hasPreviousPage: state.battleReplays.page > 0,
      hasNextPage: state.battleReplays.hasMore,
      tabs,
      banner: buildBanner(state.battleReplays.status, state.battleReplays.errorMessage, items.length > 0, "战报列表"),
      showRetry: state.battleReplays.status === "error"
    };
  }

  if (state.activeSection === "event-history") {
    const items = buildEventHistoryItems(state.eventHistory.items);
    return {
      section: "event-history",
      title: "事件历史",
      subtitle: buildSectionSubtitle("event-history", items.length),
      items,
      page: state.eventHistory.page,
      pageLabel: buildPageLabel(
        state.eventHistory.page,
        state.eventHistory.total,
        state.eventHistory.pageSize,
        state.eventHistory.hasMore
      ),
      hasPreviousPage: state.eventHistory.page > 0,
      hasNextPage: state.eventHistory.hasMore,
      tabs,
      banner: buildBanner(state.eventHistory.status, state.eventHistory.errorMessage, items.length > 0, "事件历史"),
      showRetry: state.eventHistory.status === "error"
    };
  }

  const items = buildAchievementItems(state.achievements.items);
  return {
    section: "achievements",
    title: "成就回顾",
    subtitle: buildSectionSubtitle("achievements", items.length),
    items,
    page: 0,
    pageLabel: "1/1",
    hasPreviousPage: false,
    hasNextPage: false,
    tabs,
    banner: buildBanner(state.achievements.status, state.achievements.errorMessage, items.length > 0, "成就目录"),
    showRetry: state.achievements.status === "error"
  };
}
