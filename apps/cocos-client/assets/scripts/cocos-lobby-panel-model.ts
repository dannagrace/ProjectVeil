import type {
  CocosCampaignSummary,
  CocosLaunchAnnouncement,
  CocosLobbyRoomSummary,
  CocosMaintenanceModeSnapshot,
  CocosPlayerAccountProfile
} from "./cocos-lobby.ts";
import { buildCocosLeaderboardPanelView } from "./cocos-leaderboard-panel.ts";
import type { MatchmakingStatusView } from "./cocos-matchmaking-status.ts";
import type { CocosDailyDungeonSummary } from "./cocos-progression-panel.ts";
import type { VeilLobbyRenderState } from "./VeilLobbyPanel.ts";
import {
  getLobbyShowcaseUnitPageCount,
  lobbyBuildingShowcaseEntries,
  lobbyHeroShowcaseEntries,
  lobbyShowcaseUnitEntries,
  lobbyTerrainShowcaseEntries
} from "./cocos-showcase-gallery.ts";

const DEFAULT_LOBBY_ROOM_ID = "room-alpha";

export interface LobbyRoomCardView {
  roomId: string;
  title: string;
  meta: string;
}

export interface LobbyGuestEntryView {
  displayName: string;
  roomId: string;
}

export interface LobbyAccountIdentityView {
  showLoginId: boolean;
  loginIdValue: string;
  credentialBound: boolean;
}

export interface LobbyShowcaseInventorySummary {
  heroes: number;
  terrain: number;
  buildings: number;
  units: number;
  rotatingUnitPages: number;
}

export interface LobbyPveFrontdoorView {
  title: string;
  campaignSummary: string;
  dailyDungeonSummary: string;
  focusSummary: string;
  campaignActionLabel: string;
  dailyDungeonActionLabel: string;
  campaignActionEnabled: boolean;
  dailyDungeonActionEnabled: boolean;
}

export type LobbyPvpFrontdoorActionKind =
  | "login-account"
  | "enter-matchmaking"
  | "cancel-matchmaking"
  | "none";

export interface LobbyPvpFrontdoorView {
  title: string;
  ladderSummary: string;
  queueSummary: string;
  socialSummary: string;
  focusSummary: string;
  primaryActionLabel: string;
  primaryActionEnabled: boolean;
  primaryActionKind: LobbyPvpFrontdoorActionKind;
}

export interface LobbyAnnouncementBannerView {
  title: string;
  detailLines: string[];
  tone: "info" | "warning" | "critical";
}

export function buildLobbyRoomCards(rooms: CocosLobbyRoomSummary[]): LobbyRoomCardView[] {
  return rooms.slice(0, 4).map((room) => ({
    roomId: room.roomId,
    title: room.roomId,
    meta:
      `Day ${room.day} · Seed ${room.seed} · ${room.statusLabel}` +
      ` · 玩家 ${room.connectedPlayers}` +
      (room.disconnectedPlayers > 0 ? `（掉线 ${room.disconnectedPlayers}）` : "") +
      ` · 英雄 ${room.heroCount} · 战斗 ${room.activeBattles}`
  }));
}

function rankAnnouncementTone(tone: "info" | "warning" | "critical"): number {
  return tone === "critical" ? 3 : tone === "warning" ? 2 : 1;
}

export function buildLobbyAnnouncementBannerView(
  state: Pick<VeilLobbyRenderState, "announcements" | "maintenanceMode">
): LobbyAnnouncementBannerView | null {
  if (state.maintenanceMode?.active) {
    return {
      title: state.maintenanceMode.title,
      detailLines: [
        state.maintenanceMode.message,
        ...(state.maintenanceMode.nextOpenAt ? [`预计恢复：${state.maintenanceMode.nextOpenAt}`] : [])
      ],
      tone: "critical"
    };
  }

  if ((state.announcements ?? []).length === 0) {
    return null;
  }

  const announcements: CocosLaunchAnnouncement[] = [...state.announcements];
  const tone = announcements.reduce<"info" | "warning" | "critical">(
    (current, announcement) =>
      rankAnnouncementTone(announcement.tone) > rankAnnouncementTone(current) ? announcement.tone : current,
    "info"
  );

  return {
    title: announcements.length === 1 ? announcements[0]?.title ?? "全服公告" : `全服公告 · ${announcements.length} 条`,
    detailLines: announcements.slice(0, 2).map((announcement) => `${announcement.title}：${announcement.message}`),
    tone
  };
}

export function buildLobbyGuestEntryView(
  state: Pick<VeilLobbyRenderState, "playerId" | "displayName" | "roomId" | "account">
): LobbyGuestEntryView {
  return {
    displayName: state.displayName.trim() || state.account.displayName || state.playerId,
    roomId: state.roomId.trim() || state.account.lastRoomId || DEFAULT_LOBBY_ROOM_ID
  };
}

export function buildLobbyAccountIdentityView(
  state: Pick<VeilLobbyRenderState, "authMode" | "loginId" | "account">
): LobbyAccountIdentityView {
  const loginIdValue = state.loginId.trim() || state.account.loginId || "";
  const credentialBound = Boolean(state.account.credentialBoundAt);
  return {
    showLoginId: state.authMode === "account" && credentialBound,
    loginIdValue,
    credentialBound
  };
}

export function summarizeLobbyShowcaseInventory(): LobbyShowcaseInventorySummary {
  return {
    heroes: lobbyHeroShowcaseEntries.length,
    terrain: lobbyTerrainShowcaseEntries.length,
    buildings: lobbyBuildingShowcaseEntries.length,
    units: lobbyShowcaseUnitEntries.length,
    rotatingUnitPages: getLobbyShowcaseUnitPageCount()
  };
}

function resolveNextCampaignMission(campaign: CocosCampaignSummary | null) {
  const missions = campaign?.missions ?? [];
  return (
    missions.find((mission) => mission.id === campaign?.nextMissionId)
    ?? missions.find((mission) => mission.status === "available")
    ?? missions[0]
    ?? null
  );
}

function parseCampaignChapterOrder(chapterId: string | null | undefined): number | null {
  const matched = /chapter-?(\d+)/i.exec(chapterId?.trim() ?? "");
  if (!matched) {
    return null;
  }

  const value = Number(matched[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatCampaignChapterLabel(chapterId: string | null | undefined): string {
  const order = parseCampaignChapterOrder(chapterId);
  return order ? `第 ${order} 章` : (chapterId?.trim() || "未知章节");
}

function formatUnlockRequirementSummary(mission: CocosCampaignSummary["missions"][number] | null): string | null {
  const unmet = mission?.unlockRequirements?.filter((entry) => entry.satisfied !== true) ?? [];
  if (unmet.length === 0) {
    return null;
  }

  return unmet.map((entry) => entry.description).join(" / ");
}

function countUnclaimedDailyDungeonRuns(dailyDungeon: CocosDailyDungeonSummary | null): number {
  return dailyDungeon?.runs.filter((run) => !run.rewardClaimedAt).length ?? 0;
}

function formatIdleMatchmakingSummary(status: MatchmakingStatusView | null | undefined): string {
  if (!status) {
    return "暂未开始排位 · 现在发起一局就能刷新今天的对抗节奏。";
  }
  return `暂未开始排位 · ${status.matchedLabel || "现在发起一局就能刷新今天的对抗节奏。"}`;
}

export function buildLobbyPveFrontdoorView(
  state: Pick<
    VeilLobbyRenderState,
    "authMode" | "entering" | "campaign" | "campaignStatus" | "dailyDungeon" | "dailyDungeonStatus"
  >
): LobbyPveFrontdoorView {
  if (state.authMode !== "account") {
    return {
      title: "今日 PVE 路线",
      campaignSummary: "主线章节需要正式账号会话，登录后才会同步首章与后续进度。",
      dailyDungeonSummary: "每日地城与首领奖励会跟账号档一起保存，不会只停留在游客局里。",
      focusSummary: "下一步：先完成账号登录，再进入主线与今日 PVE。",
      campaignActionLabel: "主线需账号",
      dailyDungeonActionLabel: "地城需账号",
      campaignActionEnabled: false,
      dailyDungeonActionEnabled: false
    };
  }

  const nextMission = resolveNextCampaignMission(state.campaign ?? null);
  const currentChapterMissions =
    nextMission && state.campaign ? state.campaign.missions.filter((mission) => mission.chapterId === nextMission.chapterId) : [];
  const completedInCurrentChapter = currentChapterMissions.filter((mission) => mission.status === "completed").length;
  const lockedFollowupMission =
    state.campaign?.missions.find(
      (mission) =>
        mission.status === "locked"
        && parseCampaignChapterOrder(mission.chapterId) != null
        && (parseCampaignChapterOrder(mission.chapterId) ?? 0) >= (parseCampaignChapterOrder(nextMission?.chapterId) ?? 0)
    ) ?? null;
  const nextChapterMission =
    state.campaign?.missions.find(
      (mission) =>
        mission !== nextMission
        && (parseCampaignChapterOrder(mission.chapterId) ?? 0) > (parseCampaignChapterOrder(nextMission?.chapterId) ?? 0)
    ) ?? null;
  const unclaimedDailyDungeonRuns = countUnclaimedDailyDungeonRuns(state.dailyDungeon ?? null);
  const campaignSummary = nextMission
    ? `${formatCampaignChapterLabel(nextMission.chapterId)} · 已完成 ${completedInCurrentChapter}/${Math.max(1, currentChapterMissions.length)} · 下一任务 ${nextMission.name} · 推荐等级 ${nextMission.recommendedHeroLevel}${nextChapterMission ? ` · 下章预告 ${formatCampaignChapterLabel(nextChapterMission.chapterId)}` : ""}`
    : state.campaign
      ? `主线已推进 ${state.campaign.completedCount}/${state.campaign.totalMissions}，当前章节暂时没有新的可用任务。`
      : `主线待同步 · ${state.campaignStatus || "正在读取章节进度..."}`;
  const dailyDungeonSummary = state.dailyDungeon
    ? unclaimedDailyDungeonRuns > 0
      ? `每日地城 ${state.dailyDungeon.dungeon.name} · ${unclaimedDailyDungeonRuns} 份奖励待领取`
      : `每日地城 ${state.dailyDungeon.dungeon.name} · 剩余 ${state.dailyDungeon.attemptsRemaining}/${state.dailyDungeon.dungeon.attemptLimit} 次`
    : `每日地城待同步 · ${state.dailyDungeonStatus || "正在读取今日配置..."}`;
  const focusSummary = unclaimedDailyDungeonRuns > 0
    ? `今日焦点：先领取地城奖励，再推进 ${nextMission?.name ?? "当前主线"}。`
    : lockedFollowupMission
      ? `章节路线：完成 ${nextMission?.name ?? "当前任务"} 后可解锁 ${lockedFollowupMission.name}${formatUnlockRequirementSummary(lockedFollowupMission) ? ` · ${formatUnlockRequirementSummary(lockedFollowupMission)}` : ""}。`
    : nextChapterMission
      ? `章节预告：${formatCampaignChapterLabel(nextMission?.chapterId)} 之后会进入 ${formatCampaignChapterLabel(nextChapterMission.chapterId)} · ${nextChapterMission.name}。`
    : nextMission && state.dailyDungeon
      ? `今日焦点：推进 ${nextMission.name}，顺手清掉 ${state.dailyDungeon.dungeon.name}。`
      : nextMission
        ? `今日焦点：继续主线 ${nextMission.name}。`
        : state.dailyDungeon
          ? `今日焦点：先刷今日地城 ${state.dailyDungeon.dungeon.name}。`
          : "今日焦点：等待 PVE 进度同步。";

  return {
    title: "今日 PVE 路线",
    campaignSummary,
    dailyDungeonSummary,
    focusSummary,
    campaignActionLabel: nextMission ? `继续主线 · ${nextMission.name}` : "打开主线",
    dailyDungeonActionLabel:
      unclaimedDailyDungeonRuns > 0
        ? `领取地城奖励 · ${unclaimedDailyDungeonRuns} 项`
        : state.dailyDungeon
          ? "查看每日地城"
          : "同步每日地城",
    campaignActionEnabled: !state.entering,
    dailyDungeonActionEnabled: !state.entering
  };
}

export function buildLobbyPvpFrontdoorView(
  state: Pick<
    VeilLobbyRenderState,
    | "authMode"
    | "entering"
    | "playerId"
    | "shareHint"
    | "leaderboardEntries"
    | "leaderboardStatus"
    | "leaderboardError"
    | "matchmaking"
    | "matchmakingSearching"
    | "matchmakingBusy"
  >
): LobbyPvpFrontdoorView {
  if (state.authMode !== "account") {
    return {
      title: "今日 PVP 追逐",
      ladderSummary: "PVP 排位与同房间对抗需要正式账号会话，登录后才会同步天梯名次与对局战报。",
      queueSummary: "游客模式不会保留排位房间与名次变化。",
      socialSummary: state.shareHint.trim() || "共享存档未启用",
      focusSummary: "下一步：先登录账号，再去打一局排位并开始冲榜。",
      primaryActionLabel: "登录账号后排位",
      primaryActionEnabled: !state.entering,
      primaryActionKind: "login-account"
    };
  }

  const leaderboardEntries = state.leaderboardEntries ?? [];
  const leaderboardView = buildCocosLeaderboardPanelView({
    entries: leaderboardEntries,
    myPlayerId: state.playerId
  });
  const leaderRow = leaderboardView.rows[0] ?? null;
  const myRankRow = leaderboardView.myRankRow;
  const leaderboardStatus = state.leaderboardStatus ?? "idle";
  const matchmaking = state.matchmaking ?? null;
  const matchmakingSearching = state.matchmakingSearching ?? false;
  const matchmakingBusy = state.matchmakingBusy ?? false;

  const ladderSummary =
    leaderboardStatus === "loading"
      ? "天梯同步中 · 正在读取前列排名与当前账号的冲榜位置。"
      : leaderboardStatus === "error"
        ? `天梯读取失败 · ${state.leaderboardError?.trim() || "稍后重试即可恢复当前榜单。"}`
        : myRankRow
          ? `当前天梯 ${myRankRow.rankLabel} · ${myRankRow.tierLabel} · ${myRankRow.ratingLabel}`
          : leaderRow
            ? `当前未进榜 · 领跑者 ${leaderRow.displayName} ${leaderRow.rankLabel} · ${leaderRow.tierLabel}`
            : "当前还没有已结算的排位数据，先打一局把今天的对抗节奏滚起来。";

  const queueSummary = matchmaking?.isMatched
    ? `房间已锁定 · ${matchmaking.matchedLabel || "匹配成功后会直接拉起这一局对抗。"}`
    : matchmakingSearching
      ? `正在排队 · ${matchmaking?.queuePositionLabel || "等待分配对手"} · ${matchmaking?.waitEstimateLabel || "预计很快开赛"}`
      : formatIdleMatchmakingSummary(matchmaking);

  const socialSummary = state.shareHint.trim()
    ? `共享战果：${state.shareHint.trim()}`
    : "共享战果：当前还没有额外的社交同步提示。";

  const focusSummary = matchmaking?.isMatched
    ? "今日焦点：房间已经锁定，现在进入就会直接结算这一局的名次变化。"
    : matchmakingSearching
      ? "今日焦点：保持当前阵容，匹配成功后就能直接开战。"
      : myRankRow && leaderRow && myRankRow.playerId !== leaderRow.playerId
        ? `今日焦点：再赢一局，继续逼近 ${leaderRow.displayName} 的榜首节奏。`
        : myRankRow
          ? "今日焦点：你已经站在榜首附近，再打一局把领先优势拉开。"
          : "今日焦点：先打一局进入榜单，再决定今天要追谁。";

  const primaryActionKind = matchmaking?.isMatched
    ? "none"
    : matchmakingSearching
      ? "cancel-matchmaking"
      : "enter-matchmaking";

  return {
    title: "今日 PVP 追逐",
    ladderSummary,
    queueSummary,
    socialSummary,
    focusSummary,
    primaryActionLabel:
      primaryActionKind === "cancel-matchmaking"
        ? (matchmakingBusy ? "匹配处理中..." : "取消当前匹配")
        : primaryActionKind === "enter-matchmaking"
          ? (matchmakingBusy ? "匹配处理中..." : "开始 PVP 匹配")
          : "房间锁定中",
    primaryActionEnabled: !state.entering && !matchmakingBusy && primaryActionKind !== "none",
    primaryActionKind
  };
}

export function createLobbyPanelTestAccount(
  overrides: Partial<CocosPlayerAccountProfile> = {}
): CocosPlayerAccountProfile {
  return {
    playerId: overrides.playerId ?? "guest-1001",
    displayName: overrides.displayName ?? "雾行者",
    eloRating: overrides.eloRating ?? 1000,
    globalResources: overrides.globalResources ?? { gold: 0, wood: 0, ore: 0 },
    achievements: overrides.achievements ?? [],
    recentEventLog: overrides.recentEventLog ?? [],
    recentBattleReplays: overrides.recentBattleReplays ?? [],
    source: overrides.source ?? "local",
    ...(overrides.dailyQuestBoard ? { dailyQuestBoard: overrides.dailyQuestBoard } : {}),
    ...(overrides.battleReportCenter ? { battleReportCenter: overrides.battleReportCenter } : {}),
    ...(overrides.avatarUrl ? { avatarUrl: overrides.avatarUrl } : {}),
    ...(overrides.mailbox ? { mailbox: overrides.mailbox } : {}),
    ...(overrides.mailboxSummary ? { mailboxSummary: overrides.mailboxSummary } : {}),
    ...(overrides.tutorialStep !== undefined ? { tutorialStep: overrides.tutorialStep } : {}),
    ...(overrides.seasonXp !== undefined ? { seasonXp: overrides.seasonXp } : {}),
    ...(overrides.seasonPassTier !== undefined ? { seasonPassTier: overrides.seasonPassTier } : {}),
    ...(overrides.seasonPassPremium !== undefined ? { seasonPassPremium: overrides.seasonPassPremium } : {}),
    ...(overrides.seasonPassClaimedTiers ? { seasonPassClaimedTiers: overrides.seasonPassClaimedTiers } : {}),
    ...(overrides.loginId ? { loginId: overrides.loginId } : {}),
    ...(overrides.credentialBoundAt ? { credentialBoundAt: overrides.credentialBoundAt } : {}),
    ...(overrides.lastRoomId ? { lastRoomId: overrides.lastRoomId } : {}),
    ...(overrides.lastSeenAt ? { lastSeenAt: overrides.lastSeenAt } : {})
  };
}
