import type { CocosCampaignSummary, CocosLobbyRoomSummary, CocosPlayerAccountProfile } from "./cocos-lobby.ts";
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

function countUnclaimedDailyDungeonRuns(dailyDungeon: CocosDailyDungeonSummary | null): number {
  return dailyDungeon?.runs.filter((run) => !run.rewardClaimedAt).length ?? 0;
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
  const unclaimedDailyDungeonRuns = countUnclaimedDailyDungeonRuns(state.dailyDungeon ?? null);
  const campaignSummary = nextMission
    ? `主线 ${nextMission.chapterId} · ${nextMission.name} · 推荐等级 ${nextMission.recommendedHeroLevel}`
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
