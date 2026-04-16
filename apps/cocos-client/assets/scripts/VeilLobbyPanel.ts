import { _decorator, Color, Component, Graphics, Label, Node, Sprite, SpriteFrame, UITransform } from "cc";
import { buildCocosLeaderboardPanelView } from "./cocos-leaderboard-panel.ts";
import type { LobbySkillPanelView } from "./cocos-lobby-skill-panel.ts";
import {
  type CocosAccountReviewItem,
  type CocosAccountReviewPage,
  type CocosAccountReviewSection,
  type CocosAccountReviewSectionStatus
} from "./cocos-account-review.ts";
import type {
  CocosCampaignSummary,
  CocosLobbyRoomSummary,
  CocosPlayerAccountProfile,
  CocosSeasonalEvent
} from "./cocos-lobby.ts";
import { buildLobbyPveFrontdoorView } from "./cocos-lobby-panel-model.ts";
import { getPixelSpriteAssets } from "./cocos-pixel-sprites.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import { buildCocosBattleReplayTimelineView } from "./cocos-battle-replay-timeline.ts";
import { buildCocosDailyQuestPanelView } from "./cocos-daily-quest-panel.ts";
import { buildCocosShopPanelView, type CocosShopPanelView } from "./cocos-shop-panel.ts";
import {
  buildCocosBattleReplayCenterView,
  type CocosBattleReplayCenterControlAction
} from "./cocos-battle-replay-center.ts";
import {
  lobbyBuildingShowcaseEntries,
  formatLobbyShowcasePhaseLabel,
  lobbyTerrainShowcaseEntries,
  nextLobbyShowcaseUnitPage,
  resolveLobbyShowcaseEntries,
  nextLobbyShowcasePhase,
  resolveLobbyBuildingFrame,
  resolveLobbyTerrainFrame,
  resolveLobbyShowcaseFrame,
  type LobbyBuildingShowcaseEntry,
  type LobbyShowcaseEntry,
  type LobbyTerrainShowcaseEntry,
  type LobbyShowcasePhase
} from "./cocos-showcase-gallery.ts";
import type { CocosPresentationReadiness } from "./cocos-presentation-readiness.ts";
import { HUD_ACCENT } from "./VeilHudPanel.ts";
import type { HeroView } from "./VeilCocosSession.ts";
import {
  resolveCocosBattlePassClaimableRewardSummary,
  type CocosDailyDungeonSummary,
  type CocosSeasonProgress
} from "./cocos-progression-panel.ts";
import type {
  CocosAccountLifecycleFieldView,
  CocosAccountLifecyclePanelView,
  CocosAccountReadinessStatus
} from "./cocos-account-lifecycle.ts";
import type { CocosAccountRegistrationPanelView } from "./cocos-account-registration.ts";
import {
  createBattleReplayPlaybackState,
  findPlayerBattleReplaySummary,
  pauseBattleReplayPlayback,
  playBattleReplayPlayback,
  resetBattleReplayPlayback,
  seekBattleReplayPlaybackToTurn,
  setBattleReplayPlaybackSpeed,
  stepBackBattleReplayPlayback,
  stepBattleReplayPlayback,
  tickBattleReplayPlayback,
  type BattleReplayPlaybackState,
  type PlayerBattleReplaySummary
} from "./project-shared/battle-replay.ts";
import type { MatchmakingStatusView } from "./cocos-matchmaking-status.ts";

const { ccclass } = _decorator;
const H_ALIGN_LEFT = 0;
const H_ALIGN_CENTER = 1;
const V_ALIGN_TOP = 0;
const V_ALIGN_MIDDLE = 1;
const OVERFLOW_RESIZE_HEIGHT = 3;
const PANEL_BG = new Color(13, 20, 30, 226);
const PANEL_BORDER = new Color(238, 244, 252, 62);
const PANEL_INNER = new Color(30, 42, 60, 144);
const TITLE_FILL = new Color(44, 62, 88, 188);
const FIELD_FILL = new Color(36, 49, 68, 176);
const STATUS_FILL = new Color(59, 64, 78, 182);
const ROOM_FILL = new Color(39, 53, 74, 176);
const MUTED_FILL = new Color(31, 42, 57, 164);
const ACTION_REFRESH = new Color(64, 92, 128, 234);
const ACTION_ENTER = new Color(84, 122, 94, 234);
const ACTION_ACCOUNT = new Color(88, 118, 164, 234);
const ACTION_CONFIG = new Color(94, 112, 86, 234);
const ACTION_LOGOUT = new Color(126, 92, 74, 234);
const ACTION_ACCOUNT_REVIEW = new Color(154, 122, 68, 234);
const ACTION_ACCOUNT_REVIEW_ACTIVE = new Color(104, 132, 84, 234);
const SHOWCASE_FILL = new Color(46, 56, 76, 182);
const SHOWCASE_CARD_HEIGHT = 220;
const REVIEW_TIMELINE_FILL = new Color(48, 62, 88, 192);
const REVIEW_TIMELINE_STROKE = new Color(178, 204, 236, 94);
const REVIEW_TIMELINE_ACCENT = new Color(136, 184, 236, 210);
const REVIEW_HIGHLIGHT_FILL = new Color(58, 74, 108, 206);
const REVIEW_HIGHLIGHT_STROKE = new Color(234, 246, 255, 120);
const REVIEW_HIGHLIGHT_ACCENT = new Color(146, 198, 246, 214);
const REPLAY_CONTROL_FILL = new Color(64, 92, 128, 220);
const REPLAY_CONTROL_ACTIVE_FILL = new Color(84, 122, 94, 220);
const REPLAY_PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;

function resolveReplayPlaybackIntervalMs(speed: number): number {
  switch (speed) {
    case 0.5:
      return 1400;
    case 2:
      return 350;
    case 4:
      return 175;
    default:
      return 700;
  }
}

function formatAccountReadinessStatus(status: CocosAccountReadinessStatus): string {
  if (status === "ready") {
    return "READY";
  }
  if (status === "blocked") {
    return "BLOCKED";
  }
  return "MISSING";
}

function isRegistrationFlowView(
  flow: CocosAccountLifecyclePanelView | CocosAccountRegistrationPanelView
): flow is CocosAccountRegistrationPanelView {
  return Array.isArray((flow as CocosAccountRegistrationPanelView).identities);
}

function countClaimableDailyDungeonRewards(summary: CocosDailyDungeonSummary | null | undefined): number {
  return (summary?.runs ?? []).filter((run) => !run.rewardClaimedAt).length;
}

function formatLobbyDailyRewardLabel(state: VeilLobbyRenderState): string {
  const pendingRewards = state.account.dailyQuestBoard?.pendingRewards ?? { gems: 0, gold: 0 };
  const rewardParts = [
    pendingRewards.gems > 0 ? `宝石 x${pendingRewards.gems}` : null,
    pendingRewards.gold > 0 ? `金币 x${pendingRewards.gold}` : null
  ].filter((entry): entry is string => Boolean(entry));
  if (rewardParts.length === 0) {
    return state.account.dailyQuestBoard?.enabled ? "任务板暂无待领取奖励" : "任务板将在完成引导后开放";
  }
  return `任务板待领取 ${rewardParts.join(" · ")}`;
}

function formatLobbyDailyDungeonRewardLabel(state: VeilLobbyRenderState): string {
  if (!state.dailyDungeon) {
    return "每日地城待同步";
  }

  const claimableCount = countClaimableDailyDungeonRewards(state.dailyDungeon);
  if (claimableCount > 0) {
    return `${state.dailyDungeon.dungeon.name} · ${claimableCount} 项待领取`;
  }

  return `${state.dailyDungeon.dungeon.name} · 剩余 ${state.dailyDungeon.attemptsRemaining} 次挑战`;
}

function formatLobbySeasonalRewardLabel(state: VeilLobbyRenderState): string {
  const battlePassReward = resolveCocosBattlePassClaimableRewardSummary(state.seasonProgress ?? null);
  const activeSeasonalEvent = state.activeSeasonalEvent ?? null;
  const claimableEventRewards = activeSeasonalEvent
    ? activeSeasonalEvent.rewards.filter((reward) => activeSeasonalEvent.player.claimableRewardIds.includes(reward.id))
    : [];
  if (battlePassReward) {
    return `战令 ${battlePassReward.tierLabel} · ${battlePassReward.rewardLabel}`;
  }
  if (claimableEventRewards.length > 0 && activeSeasonalEvent) {
    return `${activeSeasonalEvent.name} · 可领取 ${claimableEventRewards.map((reward) => reward.name).join(" / ")}`;
  }
  if (activeSeasonalEvent) {
    const nextReward = activeSeasonalEvent.rewards.find(
      (reward) => !activeSeasonalEvent.player.claimedRewardIds.includes(reward.id)
    );
    if (nextReward) {
      return `${activeSeasonalEvent.name} · 当前积分 ${activeSeasonalEvent.player.points} · 下一奖励 ${nextReward.name}`;
    }
    return `${activeSeasonalEvent.name} · 当前积分 ${activeSeasonalEvent.player.points} · 奖励已领完`;
  }
  if (state.seasonProgress?.battlePassEnabled) {
    return `战令等级 T${state.seasonProgress.seasonPassTier} · 已同步奖励轨道`;
  }
  return "赛季奖励待同步";
}

function formatImmediateClaimSummary(state: VeilLobbyRenderState): string {
  const dailyQuestClaims = Math.max(0, state.account.dailyQuestBoard?.availableClaims ?? 0);
  const dailyDungeonClaims = countClaimableDailyDungeonRewards(state.dailyDungeon);
  const battlePassClaims = resolveCocosBattlePassClaimableRewardSummary(state.seasonProgress ?? null) ? 1 : 0;
  const seasonalEventClaims = state.activeSeasonalEvent?.player.claimableRewardIds.length ?? 0;
  const immediateClaims = dailyQuestClaims + dailyDungeonClaims + battlePassClaims + seasonalEventClaims;
  if (immediateClaims === 0) {
    return "立刻可领 0 项 · 继续主线、地城和赛季任务会更快滚起奖励节奏";
  }

  return `立刻可领 ${immediateClaims} 项 · 任务 ${dailyQuestClaims} / 地城 ${dailyDungeonClaims} / 战令 ${battlePassClaims} / 活动 ${seasonalEventClaims}`;
}

export interface VeilLobbyRenderState {
  playerId: string;
  displayName: string;
  roomId: string;
  authMode: "guest" | "account";
  loginId: string;
  privacyConsentAccepted: boolean;
  loginHint: string;
  loginActionLabel: string;
  shareHint: string;
  vaultSummary: string;
  account: CocosPlayerAccountProfile;
  campaign: CocosCampaignSummary | null;
  campaignStatus: string;
  dailyDungeon: CocosDailyDungeonSummary | null;
  dailyDungeonStatus: string;
  accountReview: CocosAccountReviewPage;
  battleReplayItems: PlayerBattleReplaySummary[];
  battleReplaySectionStatus: CocosAccountReviewSectionStatus;
  battleReplaySectionError: string | null;
  selectedBattleReplayId: string | null;
  leaderboardEntries?: Array<{
    playerId: string;
    rank: number;
    displayName: string;
    eloRating: number;
    tier: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  }>;
  leaderboardStatus?: "idle" | "loading" | "ready" | "error";
  leaderboardError?: string | null;
  sessionSource: "remote" | "local" | "manual" | "none";
  loading: boolean;
  entering: boolean;
  status: string;
  matchmaking?: MatchmakingStatusView;
  matchmakingSearching?: boolean;
  matchmakingBusy?: boolean;
  rooms: CocosLobbyRoomSummary[];
  accountFlow: CocosAccountLifecyclePanelView | CocosAccountRegistrationPanelView | null;
  presentationReadiness: CocosPresentationReadiness;
  activeHero: HeroView | null;
  lobbySkillPanel: LobbySkillPanelView | null;
  battleActive: boolean;
  skillPanelBusy?: boolean;
  shop: CocosShopPanelView;
  shopStatus: string;
  shopLoading?: boolean;
  seasonProgress?: CocosSeasonProgress | null;
  activeSeasonalEvent?: CocosSeasonalEvent | null;
  dailyQuestClaimingId?: string | null;
  mailboxClaimingMessageId?: string | null;
  mailboxClaimAllBusy?: boolean;
}

export interface VeilLobbyPanelOptions {
  onEditPlayerId?: () => void;
  onEditDisplayName?: () => void;
  onEditRoomId?: () => void;
  onEditLoginId?: () => void;
  onTogglePrivacyConsent?: () => void;
  onRefresh?: () => void;
  onEnterRoom?: () => void;
  onEnterMatchmaking?: () => void;
  onCancelMatchmaking?: () => void;
  onLoginAccount?: () => void;
  onRegisterAccount?: () => void;
  onRecoverAccount?: () => void;
  onEditAccountFlowField?: (field: CocosAccountLifecycleFieldView["key"]) => void;
  onRequestAccountFlow?: () => void;
  onConfirmAccountFlow?: () => void;
  onToggleAccountMinorProtection?: () => void;
  onBindWechatAccount?: () => void;
  onCancelAccountFlow?: () => void;
  onOpenCampaign?: () => void;
  onOpenDailyDungeon?: () => void;
  onOpenBattlePass?: () => void;
  onOpenConfigCenter?: () => void;
  onLogout?: () => void;
  onJoinRoom?: (roomId: string) => void;
  onToggleAccountReview?: (open: boolean) => void;
  onSelectAccountReviewSection?: (section: CocosAccountReviewSection) => void;
  onSelectAccountReviewPage?: (section: "battle-replays" | "event-history", page: number) => void;
  onRetryAccountReviewSection?: (section: CocosAccountReviewSection) => void;
  onSelectBattleReplayReview?: (replayId: string) => void;
  onOpenLobbySkillPanel?: () => void;
  onCloseLobbySkillPanel?: () => void;
  onLearnLobbySkill?: (skillId: string) => void;
  onPurchaseShopProduct?: (productId: string) => void;
  onClaimDailyQuest?: (questId: string) => void;
  onClaimMailboxMessage?: (messageId: string) => void;
  onClaimAllMailbox?: () => void;
}

interface PanelCardTone {
  fill: Color;
  stroke: Color;
  accent: Color;
}

@ccclass("ProjectVeilLobbyPanel")
export class VeilLobbyPanel extends Component {
  private currentState: VeilLobbyRenderState | null = null;
  private showAccountReview = false;
  private showcasePhase: LobbyShowcasePhase = "idle";
  private showcaseUnitPage = 0;
  private showcaseTickerStarted = false;
  private onEditPlayerId: (() => void) | undefined;
  private onEditDisplayName: (() => void) | undefined;
  private onEditRoomId: (() => void) | undefined;
  private onEditLoginId: (() => void) | undefined;
  private onTogglePrivacyConsent: (() => void) | undefined;
  private onRefresh: (() => void) | undefined;
  private onEnterRoom: (() => void) | undefined;
  private onEnterMatchmaking: (() => void) | undefined;
  private onCancelMatchmaking: (() => void) | undefined;
  private onLoginAccount: (() => void) | undefined;
  private onRegisterAccount: (() => void) | undefined;
  private onRecoverAccount: (() => void) | undefined;
  private onEditAccountFlowField: ((field: CocosAccountLifecycleFieldView["key"]) => void) | undefined;
  private onRequestAccountFlow: (() => void) | undefined;
  private onConfirmAccountFlow: (() => void) | undefined;
  private onToggleAccountMinorProtection: (() => void) | undefined;
  private onBindWechatAccount: (() => void) | undefined;
  private onCancelAccountFlow: (() => void) | undefined;
  private onOpenCampaign: (() => void) | undefined;
  private onOpenDailyDungeon: (() => void) | undefined;
  private onOpenBattlePass: (() => void) | undefined;
  private onOpenConfigCenter: (() => void) | undefined;
  private onLogout: (() => void) | undefined;
  private onJoinRoom: ((roomId: string) => void) | undefined;
  private onToggleAccountReview: ((open: boolean) => void) | undefined;
  private onSelectAccountReviewSection: ((section: CocosAccountReviewSection) => void) | undefined;
  private onSelectAccountReviewPage: ((section: "battle-replays" | "event-history", page: number) => void) | undefined;
  private onRetryAccountReviewSection: ((section: CocosAccountReviewSection) => void) | undefined;
  private onSelectBattleReplayReview: ((replayId: string) => void) | undefined;
  private onOpenLobbySkillPanel: (() => void) | undefined;
  private onCloseLobbySkillPanel: (() => void) | undefined;
  private onLearnLobbySkill: ((skillId: string) => void) | undefined;
  private onPurchaseShopProduct: ((productId: string) => void) | undefined;
  private onClaimDailyQuest: ((questId: string) => void) | undefined;
  private onClaimMailboxMessage: ((messageId: string) => void) | undefined;
  private onClaimAllMailbox: (() => void) | undefined;
  private replayPlayback: BattleReplayPlaybackState | null = null;
  private replayPlaybackReplayId: string | null = null;
  private replayPlaybackStatus = "选择一场最近战斗，即可查看逐步回放。";
  private replayPlaybackTimer: ReturnType<typeof setInterval> | null = null;
  private showSkillPanel = false;
  private showDailyQuestPanel = false;
  private rewardSpotlightAutoOpenedForPlayerId: string | null = null;

  onDestroy(): void {
    this.stopReplayPlaybackLoop();
    this.unscheduleAllCallbacks();
  }

  configure(options: VeilLobbyPanelOptions): void {
    this.onEditPlayerId = options.onEditPlayerId;
    this.onEditDisplayName = options.onEditDisplayName;
    this.onEditRoomId = options.onEditRoomId;
    this.onEditLoginId = options.onEditLoginId;
    this.onTogglePrivacyConsent = options.onTogglePrivacyConsent;
    this.onRefresh = options.onRefresh;
    this.onEnterRoom = options.onEnterRoom;
    this.onEnterMatchmaking = options.onEnterMatchmaking;
    this.onCancelMatchmaking = options.onCancelMatchmaking;
    this.onLoginAccount = options.onLoginAccount;
    this.onRegisterAccount = options.onRegisterAccount;
    this.onRecoverAccount = options.onRecoverAccount;
    this.onEditAccountFlowField = options.onEditAccountFlowField;
    this.onRequestAccountFlow = options.onRequestAccountFlow;
    this.onConfirmAccountFlow = options.onConfirmAccountFlow;
    this.onToggleAccountMinorProtection = options.onToggleAccountMinorProtection;
    this.onBindWechatAccount = options.onBindWechatAccount;
    this.onCancelAccountFlow = options.onCancelAccountFlow;
    this.onOpenCampaign = options.onOpenCampaign;
    this.onOpenDailyDungeon = options.onOpenDailyDungeon;
    this.onOpenBattlePass = options.onOpenBattlePass;
    this.onOpenConfigCenter = options.onOpenConfigCenter;
    this.onLogout = options.onLogout;
    this.onJoinRoom = options.onJoinRoom;
    this.onToggleAccountReview = options.onToggleAccountReview;
    this.onSelectAccountReviewSection = options.onSelectAccountReviewSection;
    this.onSelectAccountReviewPage = options.onSelectAccountReviewPage;
    this.onRetryAccountReviewSection = options.onRetryAccountReviewSection;
    this.onSelectBattleReplayReview = options.onSelectBattleReplayReview;
    this.onOpenLobbySkillPanel = options.onOpenLobbySkillPanel;
    this.onCloseLobbySkillPanel = options.onCloseLobbySkillPanel;
    this.onLearnLobbySkill = options.onLearnLobbySkill;
    this.onPurchaseShopProduct = options.onPurchaseShopProduct;
    this.onClaimDailyQuest = options.onClaimDailyQuest;
    this.onClaimMailboxMessage = options.onClaimMailboxMessage;
    this.onClaimAllMailbox = options.onClaimAllMailbox;
  }

  render(state: VeilLobbyRenderState): void {
    this.currentState = state;
    this.maybeAutoOpenFirstSessionRewardPanel(state);
    this.syncReplayPlaybackState(state);
    this.ensureShowcaseTicker();
    const matchmaking = state.matchmaking ?? {
      statusLabel: "未在匹配",
      queuePositionLabel: "位置 -",
      waitEstimateLabel: "预计 --",
      matchedLabel: "",
      canCancel: false,
      isMatched: false
    };
    const matchmakingSearching = state.matchmakingSearching ?? false;
    const matchmakingBusy = state.matchmakingBusy ?? false;
    const skillPanelBusy = state.skillPanelBusy ?? false;
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const width = transform.width || 760;
    const height = transform.height || 620;
    const contentWidth = width - 40;
    const leftWidth = Math.max(248, Math.floor(contentWidth * 0.45));
    const rightWidth = contentWidth - leftWidth - 18;
    const leftX = -contentWidth / 2 + leftWidth / 2;
    const rightX = contentWidth / 2 - rightWidth / 2;
    let leftCursorY = height / 2 - 66;
    let rightCursorY = height / 2 - 66;

    this.syncChrome(width, height);

    leftCursorY = this.renderCard(
      "LobbyIntro",
      leftX,
      leftCursorY,
      leftWidth,
      112,
      [
        "Project Veil",
        "Cocos Lobby / 登录入口",
        "这里负责进入真实房间。字段卡片可点击修改，右侧活跃房间卡片可直接加入。"
      ],
      {
        fill: TITLE_FILL,
        stroke: new Color(244, 233, 205, 82),
        accent: new Color(218, 187, 122, 214)
      },
      null,
      18,
      22
    );

    leftCursorY = this.renderCard(
      "LobbyPlayerField",
      leftX,
      leftCursorY,
      leftWidth,
      58,
      ["玩家 ID", state.playerId || "点击填写", "点击修改游客账号 ID"],
      {
        fill: FIELD_FILL,
        stroke: new Color(224, 235, 246, 52),
        accent: new Color(110, 152, 214, 210)
      },
      state.entering ? null : this.onEditPlayerId ?? null
    );

    leftCursorY = this.renderCard(
      "LobbyDisplayNameField",
      leftX,
      leftCursorY,
      leftWidth,
      58,
      ["昵称", state.displayName || state.playerId || "点击填写", "点击修改当前展示昵称"],
      {
        fill: FIELD_FILL,
        stroke: new Color(224, 235, 246, 52),
        accent: new Color(144, 122, 212, 200)
      },
      state.entering ? null : this.onEditDisplayName ?? null
    );

    leftCursorY = this.renderCard(
      "LobbyRoomField",
      leftX,
      leftCursorY,
      leftWidth,
      58,
      ["房间 ID", state.roomId || "点击填写", "点击修改要进入的实例 ID"],
      {
        fill: FIELD_FILL,
        stroke: new Color(224, 235, 246, 52),
        accent: new Color(108, 168, 132, 204)
      },
      state.entering ? null : this.onEditRoomId ?? null
    );

    leftCursorY = this.renderCard(
      "LobbyLoginField",
      leftX,
      leftCursorY,
      leftWidth,
      58,
      [
        "登录 ID",
        state.loginId || "点击填写",
        state.loginHint || (state.authMode === "account" ? "当前已处于正式账号模式" : "H5 绑定后的登录 ID 可以在这里直接进入")
      ],
      {
        fill: FIELD_FILL,
        stroke: new Color(224, 235, 246, 52),
        accent: new Color(216, 182, 118, 196)
      },
      state.entering ? null : this.onEditLoginId ?? null
    );

    leftCursorY = this.renderCard(
      "LobbyPrivacyConsent",
      leftX,
      leftCursorY,
      leftWidth,
      58,
      [
        "隐私同意",
        state.privacyConsentAccepted ? "已同意" : "未同意",
        "首次登录、注册或绑定前需要先确认。点击可切换状态。"
      ],
      {
        fill: FIELD_FILL,
        stroke: new Color(224, 235, 246, 52),
        accent: new Color(112, 194, 164, 196)
      },
      state.entering ? null : this.onTogglePrivacyConsent ?? null
    );

    const sessionLabel =
      state.sessionSource === "remote"
        ? state.authMode === "account"
          ? `已缓存云端账号会话${state.loginId ? ` · ${state.loginId}` : ""}`
          : "已缓存云端游客会话"
        : state.sessionSource === "local"
          ? "已缓存本地游客会话"
          : state.sessionSource === "manual"
            ? "当前为手动身份草稿"
            : "当前尚未缓存会话";
    leftCursorY = this.renderCard(
      "LobbyStatus",
      leftX,
      leftCursorY,
      leftWidth,
      110,
      [
        "当前状态",
        state.authMode === "account" ? "正式账号模式" : "游客模式",
        sessionLabel,
        state.vaultSummary,
        state.shareHint,
        state.status || "等待操作..."
      ],
      {
        fill: STATUS_FILL,
        stroke: new Color(233, 206, 144, 64),
        accent: new Color(222, 189, 119, 198)
      },
      null,
      13,
      16
    );

    leftCursorY = this.renderCard(
      "LobbyMatchmakingStatus",
      leftX,
      leftCursorY,
      leftWidth,
      96,
      [
        "PVP 匹配",
        matchmaking.statusLabel,
        matchmaking.queuePositionLabel,
        matchmaking.waitEstimateLabel,
        matchmaking.matchedLabel || "等待进入队列"
      ],
      {
        fill: new Color(46, 56, 88, 186),
        stroke: new Color(214, 226, 244, 70),
        accent: new Color(122, 172, 228, 202)
      },
      null,
      13,
      16
    );

    this.renderActionButton(
      "LobbyRefresh",
      leftX,
      leftCursorY - 18,
      leftWidth,
      28,
      state.loading ? "刷新中..." : "刷新房间",
      {
        fill: ACTION_REFRESH,
        stroke: new Color(233, 242, 250, 130),
        accent: new Color(218, 230, 242, 120)
      },
      state.loading || state.entering ? null : this.onRefresh ?? null
    );
    this.renderActionButton(
      "LobbyEnter",
      leftX,
      leftCursorY - 52,
      leftWidth,
      28,
      state.entering ? "进入中..." : "游客进入",
      {
        fill: ACTION_ENTER,
        stroke: new Color(228, 244, 229, 124),
        accent: new Color(226, 244, 230, 116)
      },
      state.entering || matchmakingSearching ? null : this.onEnterRoom ?? null
    );
    this.renderActionButton(
      "LobbyMatchmakingEnter",
      leftX,
      leftCursorY - 86,
      leftWidth,
      28,
      matchmakingBusy ? "匹配处理中..." : matchmakingSearching ? "匹配中..." : "PVP 匹配",
      {
        fill: ACTION_ACCOUNT_REVIEW_ACTIVE,
        stroke: new Color(228, 244, 229, 124),
        accent: new Color(226, 244, 230, 116)
      },
      state.entering || matchmakingSearching ? null : this.onEnterMatchmaking ?? null
    );
    this.renderActionButton(
      "LobbyMatchmakingCancel",
      leftX,
      leftCursorY - 120,
      leftWidth,
      28,
      matchmakingBusy ? "处理中..." : "取消匹配",
      {
        fill: ACTION_LOGOUT,
        stroke: new Color(247, 232, 226, 118),
        accent: new Color(250, 234, 228, 110)
      },
      matchmaking.canCancel && !matchmakingBusy ? this.onCancelMatchmaking ?? null : null
    );
    this.renderActionButton(
      "LobbyAccountEnter",
      leftX,
      leftCursorY - 154,
      leftWidth,
      28,
      state.entering ? "登录中..." : state.loginActionLabel || (state.authMode === "account" ? "账号进入" : "账号登录并进入"),
      {
        fill: ACTION_ACCOUNT,
        stroke: new Color(228, 236, 248, 120),
        accent: new Color(220, 230, 244, 112)
      },
      state.entering || matchmakingSearching ? null : this.onLoginAccount ?? null
    );
    this.renderActionButton(
      "LobbyRegisterAccount",
      leftX,
      leftCursorY - 188,
      leftWidth,
      28,
      "正式注册",
      {
        fill: ACTION_ACCOUNT,
        stroke: new Color(228, 236, 248, 120),
        accent: new Color(220, 230, 244, 112)
      },
      state.entering || matchmakingSearching ? null : this.onRegisterAccount ?? null
    );
    this.renderActionButton(
      "LobbyRecoverAccount",
      leftX,
      leftCursorY - 222,
      leftWidth,
      28,
      "密码找回",
      {
        fill: ACTION_ACCOUNT,
        stroke: new Color(228, 236, 248, 120),
        accent: new Color(220, 230, 244, 112)
      },
      state.entering || matchmakingSearching ? null : this.onRecoverAccount ?? null
    );
    this.renderActionButton(
      "LobbyCampaign",
      leftX,
      leftCursorY - 256,
      leftWidth,
      28,
      "战役任务",
      {
        fill: ACTION_ACCOUNT_REVIEW_ACTIVE,
        stroke: new Color(228, 244, 229, 124),
        accent: new Color(226, 244, 230, 116)
      },
      state.entering || matchmakingSearching ? null : this.onOpenCampaign ?? null
    );
    this.renderActionButton(
      "LobbyConfigCenter",
      leftX,
      leftCursorY - 290,
      leftWidth,
      28,
      "打开配置台",
      {
        fill: ACTION_CONFIG,
        stroke: new Color(234, 240, 228, 116),
        accent: new Color(226, 236, 220, 108)
      },
      state.entering || matchmakingSearching ? null : this.onOpenConfigCenter ?? null
    );
    this.renderActionButton(
      "LobbyLogout",
      leftX,
      leftCursorY - 324,
      leftWidth,
      28,
      state.authMode === "account" ? "退出账号会话" : "退出游客会话",
      {
        fill: ACTION_LOGOUT,
        stroke: new Color(247, 232, 226, 118),
        accent: new Color(250, 234, 228, 110)
      },
      state.entering || state.sessionSource === "none" || matchmakingSearching ? null : this.onLogout ?? null
    );
    this.renderActionButton(
      "LobbyAccountReview",
      leftX,
      leftCursorY - 358,
      leftWidth,
      28,
      this.showAccountReview ? "收起资料回顾" : "资料回顾 · 战报 / 事件 / 成就",
      {
        fill: ACTION_ACCOUNT_REVIEW,
        stroke: new Color(247, 236, 214, 118),
        accent: new Color(252, 232, 194, 110)
      },
      () => {
        this.showAccountReview = !this.showAccountReview;
        this.onToggleAccountReview?.(this.showAccountReview);
        if (this.currentState) {
          this.render(this.currentState);
        }
      }
    );

    if (this.showAccountReview) {
      this.showSkillPanel = false;
      this.showDailyQuestPanel = false;
      this.hideAccountFlowPanel();
      this.hideHeroSection();
      this.hideSkillPanelModal();
      this.hideDailyQuestPanelModal();
      const review = state.accountReview;
      const hasBattleReplays = state.battleReplayItems.length > 0;
      const unlockedCount = state.account.achievements.filter((achievement) => achievement.unlocked).length;
      rightCursorY = this.renderCard(
        "LobbyAccountReviewHeader",
        rightX,
        rightCursorY,
        rightWidth,
        96,
        [
          "账号资料回顾",
          `战报 ${state.account.recentBattleReplays.length} · 事件 ${state.account.recentEventLog.length} · 成就 ${unlockedCount}/${state.account.achievements.length}`,
          review.subtitle,
          `当前页 ${review.pageLabel}`
        ],
        {
          fill: TITLE_FILL,
          stroke: new Color(236, 228, 198, 62),
          accent: new Color(214, 175, 112, 194)
        },
        null,
        15,
        18
      );

      const tabWidth = Math.floor((rightWidth - 18) / 4);
      const tabStartX = rightX - rightWidth / 2 + tabWidth / 2;
      review.tabs.forEach((tab, index) => {
        const isActive = tab.section === review.section;
        this.renderActionButton(
          `LobbyAccountReviewTab-${tab.section}`,
          tabStartX + index * (tabWidth + 6),
          rightCursorY - 16,
          tabWidth,
          28,
          `${tab.label} ${tab.count}`,
          isActive
            ? {
                fill: ACTION_ACCOUNT_REVIEW_ACTIVE,
                stroke: new Color(228, 244, 229, 124),
                accent: new Color(226, 244, 230, 116)
              }
            : {
                fill: ACTION_ACCOUNT_REVIEW,
                stroke: new Color(247, 236, 214, 118),
                accent: new Color(252, 232, 194, 110)
              },
          () => {
            this.onSelectAccountReviewSection?.(tab.section);
            if (this.currentState) {
              this.render(this.currentState);
            }
          }
        );
      });
      this.renderActionButton(
        "LobbyAccountReviewPrev",
        rightX - rightWidth / 4 - 3,
        rightCursorY - 50,
        Math.floor((rightWidth - 6) / 2),
        26,
        "上一页",
        {
          fill: ACTION_REFRESH,
          stroke: new Color(233, 242, 250, 130),
          accent: new Color(218, 230, 242, 120)
        },
        review.hasPreviousPage
          ? () => {
              if (review.section === "battle-replays" || review.section === "event-history") {
                this.onSelectAccountReviewPage?.(review.section, review.page - 1);
              }
            }
          : null
      );
      this.renderActionButton(
        "LobbyAccountReviewNext",
        rightX + rightWidth / 4 + 3,
        rightCursorY - 50,
        Math.floor((rightWidth - 6) / 2),
        26,
        "下一页",
        {
          fill: ACTION_REFRESH,
          stroke: new Color(233, 242, 250, 130),
          accent: new Color(218, 230, 242, 120)
        },
        review.hasNextPage
          ? () => {
              if (review.section === "battle-replays" || review.section === "event-history") {
                this.onSelectAccountReviewPage?.(review.section, review.page + 1);
              }
            }
          : null
      );

      this.renderActionButton(
        "LobbyAccountReviewRetry",
        rightX,
        rightCursorY - 84,
        rightWidth,
        24,
        "重新同步当前面板",
        {
          fill: ACTION_REFRESH,
          stroke: new Color(233, 242, 250, 130),
          accent: new Color(218, 230, 242, 120)
        },
        review.showRetry ? () => this.onRetryAccountReviewSection?.(review.section) : null
      );

      let reviewCardsTop = rightCursorY - 108;
      if (review.section === "battle-replays" && hasBattleReplays && state.selectedBattleReplayId) {
        reviewCardsTop = this.renderBattleReplayCenter(rightX, reviewCardsTop, rightWidth, state);
        reviewCardsTop = this.renderBattleReplayTimelineDetail(rightX, reviewCardsTop, rightWidth, state.account);
        this.renderAccountReviewCards(rightX, reviewCardsTop, rightWidth, review.items, {
          highlightReplayId: state.selectedBattleReplayId,
          banner: review.banner,
          onSelectReplay: (replayId) => {
            this.selectBattleReplay(replayId);
          }
        });
      } else {
        if (review.section === "battle-replays") {
          reviewCardsTop = this.renderBattleReplayCenter(rightX, reviewCardsTop, rightWidth, state);
        } else {
          this.hideBattleReplayTimelineCard();
        }
        this.renderAccountReviewCards(rightX, reviewCardsTop, rightWidth, review.items, {
          banner: review.banner
        });
      }
      this.hideLobbyRooms();
      this.hideLeaderboardCards();
    } else if (state.accountFlow) {
      this.showSkillPanel = false;
      this.showDailyQuestPanel = false;
      this.hideAccountReviewCards();
      this.hideBattleReplayTimelineCard();
      this.hideLobbyRooms();
      this.hideLeaderboardCards();
      this.hideHeroSection();
      this.hideSkillPanelModal();
      this.hideDailyQuestPanelModal();
      this.renderAccountFlowPanel(rightX, rightCursorY, rightWidth, state.accountFlow, state.entering);
    } else {
      this.hideAccountFlowPanel();
      this.hideAccountReviewCards();
      this.hideBattleReplayTimelineCard();
      rightCursorY = this.renderHeroSection(rightX, rightCursorY, rightWidth, state, skillPanelBusy);
      rightCursorY = this.renderPveFrontdoorSection(rightX, rightCursorY, rightWidth, state);
      rightCursorY = this.renderDailyQuestSection(rightX, rightCursorY, rightWidth, state);
      rightCursorY = this.renderMailboxSection(rightX, rightCursorY, rightWidth, state);
      rightCursorY = this.renderLeaderboardSection(rightX, rightCursorY, rightWidth, state);
      rightCursorY = this.renderShopSection(rightX, rightCursorY, rightWidth, state);
      rightCursorY = this.renderCard(
        "LobbyRoomsHeader",
        rightX,
        rightCursorY,
        rightWidth,
        82,
        [
          "活跃房间",
          `${state.rooms.length} 个实例`,
          "点击右侧卡片即可直接加入；如果列表为空，也可以在左侧输入新的房间 ID。"
        ],
        {
          fill: TITLE_FILL,
          stroke: new Color(228, 237, 248, 52),
          accent: new Color(122, 168, 214, 194)
        },
        null,
        15,
        18
      );

      const visibleRooms = state.rooms.slice(0, 4);
      let showcaseTopY = rightCursorY;
      if (visibleRooms.length === 0) {
        this.renderCard(
          "LobbyRoomsEmpty",
          rightX,
          rightCursorY,
          rightWidth,
          84,
          [
            "当前没有活跃房间",
            "输入新的房间 ID 后点击“进入房间”即可创建一局。",
            "Lobby API 暂不可达时也可以继续本地进入。"
          ],
          {
            fill: MUTED_FILL,
            stroke: new Color(214, 224, 238, 42),
            accent: new Color(128, 146, 170, 156)
          },
          null,
          14,
          18
        );
        this.hideExtraRoomCards(0);
        showcaseTopY = rightCursorY - 96;
      } else {
        visibleRooms.forEach((room, index) => {
          const updatedAt = room.updatedAt.includes("T") ? room.updatedAt.slice(11, 16) : room.updatedAt;
          this.renderCard(
            `LobbyRoom-${index}`,
            rightX,
            rightCursorY - index * 92,
            rightWidth,
            82,
            [
              room.roomId,
              `Day ${room.day} · Seed ${room.seed} · ${room.statusLabel}`,
              `玩家 ${room.connectedPlayers}${room.disconnectedPlayers > 0 ? ` · 掉线 ${room.disconnectedPlayers}` : ""} · 英雄 ${room.heroCount} · 战斗 ${room.activeBattles}`,
              `最近刷新 ${updatedAt}`
            ],
            {
              fill: ROOM_FILL,
              stroke: new Color(220, 232, 244, 52),
              accent: new Color(132, 186, 142, 186)
            },
            state.entering ? null : () => {
              this.onJoinRoom?.(room.roomId);
            },
            14,
            18
          );
        });

        this.hideExtraRoomCards(visibleRooms.length);
        showcaseTopY = rightCursorY - visibleRooms.length * 92;
      }

      this.renderPixelShowcase(rightX, showcaseTopY, rightWidth);
    }

    if (this.showSkillPanel && state.lobbySkillPanel && state.activeHero) {
      this.renderSkillPanelModal(width, height, state, skillPanelBusy);
    } else {
      this.hideSkillPanelModal();
    }

    if (this.showDailyQuestPanel) {
      this.renderDailyQuestPanelModal(width, height, state);
    } else {
      this.hideDailyQuestPanelModal();
    }
  }

  private renderPveFrontdoorSection(centerX: number, topY: number, width: number, state: VeilLobbyRenderState): number {
    const view = buildLobbyPveFrontdoorView(state);
    const claimableDailyDungeonRewards = state.dailyDungeon?.runs.filter((run) => !run.rewardClaimedAt).length ?? 0;
    const nextY = this.renderCard(
      "LobbyPveFrontdoor",
      centerX,
      topY,
      width,
      98,
      [view.title, view.campaignSummary, view.dailyDungeonSummary, view.focusSummary],
      {
        fill: new Color(58, 72, 88, 194),
        stroke: new Color(232, 238, 248, 68),
        accent: claimableDailyDungeonRewards > 0 ? new Color(238, 184, 94, 220) : new Color(132, 186, 142, 204)
      },
      null,
      13,
      17
    );

    const halfWidth = Math.floor((width - 6) / 2);
    this.renderActionButton(
      "LobbyPveCampaignAction",
      centerX - width / 4 - 3,
      nextY - 16,
      halfWidth,
      28,
      view.campaignActionLabel,
      {
        fill: ACTION_ACCOUNT_REVIEW_ACTIVE,
        stroke: new Color(228, 244, 229, 124),
        accent: new Color(226, 244, 230, 116)
      },
      view.campaignActionEnabled ? this.onOpenCampaign ?? null : null
    );
    this.renderActionButton(
      "LobbyPveDailyDungeonAction",
      centerX + width / 4 + 3,
      nextY - 16,
      halfWidth,
      28,
      view.dailyDungeonActionLabel,
      {
        fill: claimableDailyDungeonRewards > 0 ? ACTION_ACCOUNT_REVIEW : ACTION_ACCOUNT,
        stroke: new Color(228, 236, 248, 120),
        accent: new Color(220, 230, 244, 112)
      },
      view.dailyDungeonActionEnabled ? this.onOpenDailyDungeon ?? null : null
    );

    return nextY - 50;
  }

  private renderDailyQuestSection(centerX: number, topY: number, width: number, state: VeilLobbyRenderState): number {
    const board = state.account.dailyQuestBoard;
    const battlePassReward = resolveCocosBattlePassClaimableRewardSummary(state.seasonProgress ?? null);
    const dailyQuestClaims = Math.max(0, board?.availableClaims ?? 0);
    const dailyDungeonClaims = countClaimableDailyDungeonRewards(state.dailyDungeon);
    const activeSeasonalEventClaims = state.activeSeasonalEvent?.player.claimableRewardIds.length ?? 0;
    const primaryActionHandler = state.entering
      ? null
      : dailyQuestClaims > 0
        ? () => {
            this.showSkillPanel = false;
            this.showDailyQuestPanel = true;
            if (this.currentState) {
              this.render(this.currentState);
            }
          }
        : dailyDungeonClaims > 0 || (state.dailyDungeon?.attemptsRemaining ?? 0) > 0 || activeSeasonalEventClaims > 0
          ? this.onOpenDailyDungeon ?? null
          : battlePassReward
            ? this.onOpenBattlePass ?? null
            : () => {
                this.showSkillPanel = false;
                this.showDailyQuestPanel = true;
                if (this.currentState) {
                  this.render(this.currentState);
                }
              };
    const actionLabel = dailyQuestClaims > 0
      ? `打开任务板 · ${dailyQuestClaims} 项可领取`
      : dailyDungeonClaims > 0
        ? `查看地城奖励 · ${dailyDungeonClaims} 项待领取`
        : activeSeasonalEventClaims > 0
          ? "查看活动进度 · 当前有可领奖励"
          : battlePassReward
            ? "查看赛季通行证 · 当前有可领奖励"
            : (state.dailyDungeon?.attemptsRemaining ?? 0) > 0
              ? `查看每日地城 · 剩余 ${state.dailyDungeon?.attemptsRemaining ?? 0} 次挑战`
              : "打开任务板";
    const actionTone = dailyQuestClaims > 0
      ? {
          fill: ACTION_ACCOUNT_REVIEW_ACTIVE,
          stroke: new Color(228, 236, 248, 120),
          accent: new Color(220, 230, 244, 112)
        }
      : battlePassReward
        ? {
            fill: ACTION_ACCOUNT_REVIEW,
            stroke: new Color(228, 236, 248, 120),
            accent: new Color(220, 230, 244, 112)
          }
        : {
            fill: ACTION_ACCOUNT,
            stroke: new Color(228, 236, 248, 120),
            accent: new Color(220, 230, 244, 112)
          };
    const nextY = this.renderCard(
      "LobbyDailyQuestSummary",
      centerX,
      topY,
      width,
      104,
      [
        "今日奖励节奏",
        formatImmediateClaimSummary(state),
        `${formatLobbyDailyRewardLabel(state)} · ${formatLobbyDailyDungeonRewardLabel(state)}`,
        formatLobbySeasonalRewardLabel(state)
      ],
      {
        fill: new Color(54, 72, 96, 190),
        stroke: new Color(230, 238, 252, 68),
        accent: dailyQuestClaims + dailyDungeonClaims + activeSeasonalEventClaims + (battlePassReward ? 1 : 0) > 0
          ? new Color(238, 184, 94, 220)
          : new Color(124, 176, 226, 204)
      },
      null,
      13,
      17
    );

    this.renderActionButton(
      "LobbyDailyQuestOpen",
      centerX,
      nextY - 16,
      width,
      28,
      actionLabel,
      actionTone,
      primaryActionHandler
    );

    return nextY - 50;
  }

  private maybeAutoOpenFirstSessionRewardPanel(state: VeilLobbyRenderState): void {
    if (this.showDailyQuestPanel || this.showSkillPanel || this.showAccountReview || state.entering) {
      return;
    }

    if (this.rewardSpotlightAutoOpenedForPlayerId === state.playerId) {
      return;
    }

    const board = state.account.dailyQuestBoard;
    if (state.account.tutorialStep == null && board?.enabled === true && (board.availableClaims ?? 0) > 0) {
      this.showDailyQuestPanel = true;
      this.rewardSpotlightAutoOpenedForPlayerId = state.playerId;
    }
  }

  private renderShopSection(centerX: number, topY: number, width: number, state: VeilLobbyRenderState): number {
    const shop = state.shop ?? buildCocosShopPanelView({
      products: [],
      gemBalance: state.account.gems ?? 0,
      pendingProductId: null
    });
    let cursorY = this.renderCard(
      "LobbyShopHeader",
      centerX,
      topY,
      width,
      84,
      [
        "商店",
        shop.gemBalanceLabel,
        state.shopLoading ? "正在同步商品..." : state.shopStatus || "可购买资源包、装备与宝石。"
      ],
      {
        fill: new Color(46, 64, 82, 188),
        stroke: new Color(220, 232, 244, 56),
        accent: new Color(104, 182, 210, 206)
      },
      null,
      14,
      18
    );

    if (shop.emptyLabel) {
      this.hideExtraCards("LobbyShop-", 0);
      return this.renderCard(
        "LobbyShopEmpty",
        centerX,
        cursorY,
        width,
        74,
        ["商店暂空", shop.emptyLabel, "刷新大厅可重新拉取商品目录。"],
        {
          fill: MUTED_FILL,
          stroke: new Color(214, 224, 238, 42),
          accent: new Color(128, 146, 170, 156)
        },
        null,
        13,
        18
      );
    }

    const emptyNode = this.node.getChildByName("LobbyShopEmpty");
    if (emptyNode) {
      emptyNode.active = false;
    }

    shop.rows.slice(0, 4).forEach((row, index) => {
      cursorY = this.renderCard(
        `LobbyShop-${index}`,
        centerX,
        cursorY,
        width,
        72,
        [row.name, row.grantLabel, `${row.priceLabel} · ${row.affordabilityLabel}`],
        {
          fill: row.enabled ? new Color(42, 70, 76, 188) : MUTED_FILL,
          stroke: new Color(214, 226, 244, 52),
          accent: row.usesWechatPayment ? new Color(114, 194, 168, 196) : new Color(218, 187, 122, 194)
        },
        row.enabled && !state.entering ? () => {
          this.onPurchaseShopProduct?.(row.productId);
        } : null,
        13,
        18
      );
    });

    this.hideExtraCards("LobbyShop-", Math.min(4, shop.rows.length));
    return cursorY;
  }

  private renderMailboxSection(centerX: number, topY: number, width: number, state: VeilLobbyRenderState): number {
    const mailbox = state.account.mailbox ?? [];
    const summary = state.account.mailboxSummary ?? { totalCount: mailbox.length, unreadCount: 0, claimableCount: 0, expiredCount: 0 };
    const activeMessages = mailbox.filter((message) => !message.claimedAt).slice(0, 2);
    const lines = [
      `系统邮箱 · 未读 ${summary.unreadCount}`,
      `可领取 ${summary.claimableCount} · 已过期 ${summary.expiredCount}`,
      ...(activeMessages.length > 0
        ? activeMessages.flatMap((message, index) => [
            `${index + 1}. ${message.title}`,
            message.body,
            `${message.grant?.gems ? `宝石 x${message.grant.gems}` : ""}${message.grant?.resources?.gold ? `${message.grant?.gems ? " · " : ""}金币 x${message.grant.resources.gold}` : ""}${message.expiresAt ? ` · ${message.expiresAt.slice(0, 10)} 到期` : ""}` ||
              "无附件"
          ])
        : ["当前没有待处理系统邮件。"])
    ];
    const cardHeight = 100 + activeMessages.length * 74;
    const nextY = this.renderCard(
      "LobbyMailbox",
      centerX,
      topY,
      width,
      cardHeight,
      lines,
      {
        fill: new Color(52, 68, 96, 188),
        stroke: new Color(231, 240, 252, 76),
        accent: summary.unreadCount > 0 ? new Color(238, 184, 94, 220) : new Color(124, 176, 226, 204)
      },
      null,
      13,
      16
    );

    this.renderActionButton(
      "LobbyMailboxClaimAll",
      centerX,
      nextY - 18,
      width,
      28,
      state.mailboxClaimAllBusy ? "领取中..." : summary.claimableCount > 0 ? "领取全部附件" : "邮箱已同步",
      {
        fill: summary.claimableCount > 0 ? ACTION_ACCOUNT_REVIEW_ACTIVE : MUTED_FILL,
        stroke: new Color(234, 240, 228, 110),
        accent: new Color(226, 236, 220, 102)
      },
      summary.claimableCount > 0 && !state.mailboxClaimAllBusy ? this.onClaimAllMailbox ?? null : null
    );

    activeMessages.forEach((message, index) => {
      const claimable = !message.claimedAt && Boolean(message.grant);
      this.renderActionButton(
        `LobbyMailboxClaim-${index}`,
        centerX,
        nextY - 52 - index * 34,
        width,
        28,
        state.mailboxClaimingMessageId === message.id ? "领取中..." : claimable ? `领取: ${message.title}` : `${message.title} · 无附件`,
        {
          fill: claimable ? ACTION_ACCOUNT : MUTED_FILL,
          stroke: new Color(228, 236, 248, 108),
          accent: new Color(220, 230, 244, 96)
        },
        claimable && state.mailboxClaimingMessageId !== message.id ? () => this.onClaimMailboxMessage?.(message.id) : null
      );
    });

    return nextY - 60 - activeMessages.length * 34;
  }

  private hideExtraCards(prefix: string, visibleCount: number): void {
    for (let index = visibleCount; index < 6; index += 1) {
      const node = this.node.getChildByName(`${prefix}${index}`);
      if (node) {
        node.active = false;
      }
    }
  }

  private renderLeaderboardSection(centerX: number, topY: number, width: number, state: VeilLobbyRenderState): number {
    const leaderboardEntries = state.leaderboardEntries ?? [];
    const leaderboardStatus = state.leaderboardStatus ?? "idle";
    const leaderboardError = state.leaderboardError ?? null;
    const leaderboardView = buildCocosLeaderboardPanelView({
      entries: leaderboardEntries,
      myPlayerId: state.playerId
    });
    const statusLines =
      leaderboardStatus === "loading"
        ? ["排行榜", "正在同步最新天梯...", "读取前 50 名与当前账号排位。"]
        : leaderboardStatus === "error"
          ? ["排行榜", "同步失败", leaderboardError?.trim() || "暂时无法读取排行榜，请稍后重试。"]
          : leaderboardView.rows.length === 0
            ? ["排行榜", "暂时没有已结算的排名数据", "完成对局并结算后，这里会显示最新天梯名次。"]
            : ["排行榜", `当前徽记 ${leaderboardView.tierBadge}`, `已同步 ${leaderboardView.rows.length} 名玩家 · 使用 HUD 强调当前账号。`];

    let nextTopY = this.renderCard(
      "LobbyLeaderboardStatus",
      centerX,
      topY,
      width,
      82,
      statusLines,
      {
        fill: TITLE_FILL,
        stroke: new Color(236, 228, 198, 62),
        accent: new Color(HUD_ACCENT.r, HUD_ACCENT.g, HUD_ACCENT.b, 214)
      },
      null,
      14,
      18
    );

    if (leaderboardStatus === "loading" || leaderboardStatus === "error" || leaderboardView.rows.length === 0) {
      const listNode = this.node.getChildByName("LobbyLeaderboardList");
      if (listNode) {
        listNode.active = false;
      }
      const myRankNode = this.node.getChildByName("LobbyLeaderboardMyRank");
      if (myRankNode) {
        myRankNode.active = false;
      }
      return nextTopY;
    }

    const rows = leaderboardView.rows.slice(0, 5).map((row) =>
      `${row.rankLabel} ${row.displayName}${row.isCurrentPlayer ? " · 我" : ""} · ${row.ratingLabel} · ${row.tierLabel}`
    );
    nextTopY = this.renderCard(
      "LobbyLeaderboardList",
      centerX,
      nextTopY,
      width,
      48 + rows.length * 18,
      ["前列排名", ...rows],
      {
        fill: ROOM_FILL,
        stroke: new Color(220, 232, 244, 52),
        accent: new Color(132, 186, 142, 186)
      },
      null,
      13,
      18
    );

    const myRankLines = leaderboardView.myRankRow
      ? [
          "我的排名",
          `${leaderboardView.myRankRow.rankLabel} ${leaderboardView.myRankRow.displayName}`,
          `${leaderboardView.myRankRow.ratingLabel} · ${leaderboardView.myRankRow.tierLabel}`
        ]
      : ["我的排名", "当前未进入前 50", "继续完成排位对局即可冲榜。"];

    return this.renderCard(
      "LobbyLeaderboardMyRank",
      centerX,
      nextTopY,
      width,
      82,
      myRankLines,
      {
        fill: new Color(HUD_ACCENT.r, HUD_ACCENT.g, HUD_ACCENT.b, 72),
        stroke: new Color(HUD_ACCENT.r, HUD_ACCENT.g, HUD_ACCENT.b, 168),
        accent: new Color(HUD_ACCENT.r, HUD_ACCENT.g, HUD_ACCENT.b, 255)
      },
      null,
      14,
      18
    );
  }

  private hideLeaderboardCards(): void {
    for (const name of ["LobbyLeaderboardStatus", "LobbyLeaderboardList", "LobbyLeaderboardMyRank"]) {
      const node = this.node.getChildByName(name);
      if (node) {
        node.active = false;
      }
    }
  }

  private renderHeroSection(
    centerX: number,
    topY: number,
    width: number,
    state: VeilLobbyRenderState,
    skillPanelBusy: boolean
  ): number {
    const hero = state.activeHero;
    if (!hero || !state.lobbySkillPanel) {
      this.hideHeroSection();
      this.showSkillPanel = false;
      return topY;
    }

    const nextTopY = this.renderCard(
      "LobbyHeroSummary",
      centerX,
      topY,
      width,
      84,
      [
        "当前英雄",
        `${hero.name} · Lv ${hero.progression.level} · 兵力 ${hero.armyCount}`,
        `技能点 ${state.lobbySkillPanel.availableSkillPoints} · ${state.battleActive ? "战斗中无法分配" : "房间空闲时可立即分配"}`
      ],
      {
        fill: new Color(52, 66, 94, 190),
        stroke: new Color(222, 232, 246, 64),
        accent: new Color(128, 176, 226, 204)
      },
      null,
      14,
      18
    );

    this.renderActionButton(
      "LobbyHeroSkillButton",
      centerX,
      nextTopY - 16,
      width,
      28,
      skillPanelBusy ? "技能同步中..." : "技能",
      {
        fill: ACTION_ACCOUNT_REVIEW_ACTIVE,
        stroke: new Color(228, 244, 229, 124),
        accent: new Color(226, 244, 230, 116)
      },
      skillPanelBusy || state.entering
        ? null
        : () => {
            this.showSkillPanel = true;
            this.onOpenLobbySkillPanel?.();
            if (this.currentState) {
              this.render(this.currentState);
            }
          }
    );

    return nextTopY - 50;
  }

  private hideHeroSection(): void {
    for (const name of ["LobbyHeroSummary", "LobbyHeroSkillButton", "LobbyDailyQuestSummary", "LobbyDailyQuestOpen"]) {
      const node = this.node.getChildByName(name);
      if (node) {
        node.active = false;
      }
    }
  }

  private ensureShowcaseTicker(): void {
    if (this.showcaseTickerStarted) {
      return;
    }

    this.showcaseTickerStarted = true;
    this.scheduleShowcaseTick();
  }

  private scheduleShowcaseTick(): void {
    this.scheduleOnce(() => {
      const nextPhase = nextLobbyShowcasePhase(this.showcasePhase);
      if (nextPhase === "idle") {
        this.showcaseUnitPage = nextLobbyShowcaseUnitPage(this.showcaseUnitPage);
      }
      this.showcasePhase = nextPhase;
      if (this.currentState) {
        this.render(this.currentState);
      }
      this.scheduleShowcaseTick();
    }, 1.35);
  }

  private syncChrome(width: number, height: number): void {
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = PANEL_BG;
    graphics.strokeColor = PANEL_BORDER;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 26);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = PANEL_INNER;
    graphics.roundRect(-width / 2 + 14, height / 2 - 24, width - 28, 10, 6);
    graphics.fill();
  }

  private renderSkillPanelModal(
    width: number,
    height: number,
    state: VeilLobbyRenderState,
    skillPanelBusy: boolean
  ): void {
    const view = state.lobbySkillPanel;
    if (!view) {
      this.hideSkillPanelModal();
      return;
    }

    const modalWidth = Math.min(620, width - 48);
    const modalCenterX = 0;
    let topY = height / 2 - 54;

    this.renderBackdrop("LobbySkillPanelBackdrop", width, height, () => {
      this.showSkillPanel = false;
      this.onCloseLobbySkillPanel?.();
      if (this.currentState) {
        this.render(this.currentState);
      }
    });
    topY = this.renderCard(
      "LobbySkillPanelHeader",
      modalCenterX,
      topY,
      modalWidth,
      96,
      [
        `技能规划 · ${view.heroName}`,
        `等级 ${view.level} · 可用技能点 ${view.availableSkillPoints}`,
        state.battleActive ? "战斗中无法分配" : "房间空闲时可直接分配技能点并即时写回房间状态。"
      ],
      {
        fill: TITLE_FILL,
        stroke: new Color(236, 228, 198, 72),
        accent: new Color(214, 175, 112, 194)
      },
      null,
      13,
      17
    );

    view.branches.forEach((branch, index) => {
      const lines = [
        branch.name,
        ...branch.skills.map((skill) => `${skill.name} ${skill.currentRank}/${skill.maxRank} · ${skill.summary}`)
      ];
      topY = this.renderCard(
        `LobbySkillPanelBranch-${index}`,
        modalCenterX,
        topY,
        modalWidth,
        40 + lines.length * 16,
        lines,
        {
          fill: ROOM_FILL,
          stroke: new Color(220, 232, 244, 52),
          accent: new Color(132, 186, 142, 186)
        },
        null,
        12,
        16
      );
    });
    this.hideExtraSkillBranchCards(view.branches.length);

    const buttonWidth = Math.floor((modalWidth - 10) / 2);
    const buttonStartX = modalCenterX - modalWidth / 2 + buttonWidth / 2;
    const actionCenterY = topY - 16;
    view.actions.forEach((action, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      this.renderActionButton(
        `LobbySkillPanelAction-${index}`,
        buttonStartX + col * (buttonWidth + 10),
        actionCenterY - row * 34,
        buttonWidth,
        28,
        `${action.label} · ${action.cost} 点`,
        {
          fill: ACTION_ENTER,
          stroke: new Color(228, 244, 229, 124),
          accent: new Color(226, 244, 230, 116)
        },
        state.battleActive || !action.canLearn || skillPanelBusy
          ? null
          : () => {
              this.onLearnLobbySkill?.(action.skillId);
            }
      );
    });
    this.hideExtraSkillActionButtons(view.actions.length);

    const actionRows = Math.ceil(view.actions.length / 2);
    const closeCenterY = actionCenterY - actionRows * 34;
    this.renderActionButton(
      "LobbySkillPanelClose",
      modalCenterX,
      closeCenterY,
      modalWidth,
      28,
      "收起技能面板",
      {
        fill: ACTION_LOGOUT,
        stroke: new Color(247, 232, 226, 118),
        accent: new Color(250, 234, 228, 110)
      },
      () => {
        this.showSkillPanel = false;
        this.onCloseLobbySkillPanel?.();
        if (this.currentState) {
          this.render(this.currentState);
        }
      }
    );
  }

  private renderDailyQuestPanelModal(width: number, height: number, state: VeilLobbyRenderState): void {
    const modalWidth = Math.min(620, width - 48);
    const modalCenterX = 0;
    let topY = height / 2 - 54;
    const view = buildCocosDailyQuestPanelView({
      board: state.account.dailyQuestBoard ?? null,
      pendingQuestId: state.dailyQuestClaimingId ?? null
    });

    this.renderBackdrop("LobbyDailyQuestBackdrop", width, height, () => {
      this.showDailyQuestPanel = false;
      if (this.currentState) {
        this.render(this.currentState);
      }
    });
    topY = this.renderCard(
      "LobbyDailyQuestHeader",
      modalCenterX,
      topY,
      modalWidth,
      96,
      [view.title, `${view.subtitle} · ${view.claimableCountLabel}`, `${view.pendingRewardsLabel} · ${view.resetLabel}`],
      {
        fill: TITLE_FILL,
        stroke: new Color(236, 228, 198, 72),
        accent: new Color(214, 175, 112, 194)
      },
      null,
      13,
      17
    );

    if (view.emptyLabel) {
      topY = this.renderCard(
        "LobbyDailyQuestEmpty",
        modalCenterX,
        topY,
        modalWidth,
        86,
        ["今日任务", view.emptyLabel, "刷新账号资料后将同步最新任务板。"],
        {
          fill: MUTED_FILL,
          stroke: new Color(214, 224, 238, 42),
          accent: new Color(128, 146, 170, 156)
        },
        null,
        13,
        17
      );
      this.hideExtraCards("LobbyDailyQuestQuest-", 0);
      this.hideExtraCards("LobbyDailyQuestClaim-", 0);
    } else {
      const emptyNode = this.node.getChildByName("LobbyDailyQuestEmpty");
      if (emptyNode) {
        emptyNode.active = false;
      }

      view.quests.slice(0, 4).forEach((quest, index) => {
        topY = this.renderCard(
          `LobbyDailyQuestQuest-${index}`,
          modalCenterX,
          topY,
          modalWidth,
          94,
          [
            `${quest.title} · ${quest.stateLabel}`,
            `${quest.detail} · 进度 ${quest.progressLabel}`,
            quest.rewardLabel
          ],
          {
            fill: quest.action?.enabled ? new Color(52, 76, 84, 190) : ROOM_FILL,
            stroke: new Color(220, 232, 244, 52),
            accent:
              quest.stateLabel === "可领取"
                ? new Color(238, 184, 94, 220)
                : quest.stateLabel === "已领取"
                  ? new Color(132, 186, 142, 186)
                  : new Color(132, 168, 214, 186)
          },
          null,
          13,
          17
        );
        this.renderActionButton(
          `LobbyDailyQuestClaim-${index}`,
          modalCenterX,
          topY + 18,
          modalWidth,
          28,
          quest.action?.label ?? `${quest.stateLabel} · ${quest.progressLabel}`,
          {
            fill: quest.action?.enabled ? ACTION_ACCOUNT_REVIEW_ACTIVE : MUTED_FILL,
            stroke: new Color(228, 244, 229, 124),
            accent: new Color(226, 244, 230, 116)
          },
          quest.action?.enabled ? () => this.onClaimDailyQuest?.(quest.questId) : null
        );
        topY -= 28;
      });
      this.hideExtraCards("LobbyDailyQuestQuest-", Math.min(4, view.quests.length));
      this.hideExtraCards("LobbyDailyQuestClaim-", Math.min(4, view.quests.length));
    }

    this.renderActionButton(
      "LobbyDailyQuestClose",
      modalCenterX,
      topY - 8,
      modalWidth,
      28,
      "收起任务板",
      {
        fill: ACTION_LOGOUT,
        stroke: new Color(247, 232, 226, 118),
        accent: new Color(250, 234, 228, 110)
      },
      () => {
        this.showDailyQuestPanel = false;
        if (this.currentState) {
          this.render(this.currentState);
        }
      }
    );
  }

  private renderBackdrop(name: string, width: number, height: number, onPress: (() => void) | null): void {
    let backdrop = this.node.getChildByName(name);
    if (!backdrop) {
      backdrop = new Node(name);
      backdrop.parent = this.node;
    }
    assignUiLayer(backdrop);
    backdrop.active = true;
    const transform = backdrop.getComponent(UITransform) ?? backdrop.addComponent(UITransform);
    transform.setContentSize(width, height);
    backdrop.setPosition(0, 0, 2);
    const graphics = backdrop.getComponent(Graphics) ?? backdrop.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(4, 7, 12, 184);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
    this.bindPress(backdrop, onPress);
  }

  private hideExtraSkillBranchCards(visibleCount: number): void {
    for (let index = visibleCount; index < 8; index += 1) {
      const node = this.node.getChildByName(`LobbySkillPanelBranch-${index}`);
      if (node) {
        node.active = false;
      }
    }
  }

  private hideExtraSkillActionButtons(visibleCount: number): void {
    for (let index = visibleCount; index < 16; index += 1) {
      const node = this.node.getChildByName(`LobbySkillPanelAction-${index}`);
      if (node) {
        node.active = false;
      }
    }
  }

  private hideSkillPanelModal(): void {
    for (const name of ["LobbySkillPanelBackdrop", "LobbySkillPanelHeader", "LobbySkillPanelClose"]) {
      const node = this.node.getChildByName(name);
      if (node) {
        node.active = false;
      }
    }
    this.hideExtraSkillBranchCards(0);
    this.hideExtraSkillActionButtons(0);
  }

  private hideDailyQuestPanelModal(): void {
    for (const name of ["LobbyDailyQuestBackdrop", "LobbyDailyQuestHeader", "LobbyDailyQuestEmpty", "LobbyDailyQuestClose"]) {
      const node = this.node.getChildByName(name);
      if (node) {
        node.active = false;
      }
    }
    this.hideExtraCards("LobbyDailyQuestQuest-", 0);
    this.hideExtraCards("LobbyDailyQuestClaim-", 0);
  }

  private renderCard(
    name: string,
    centerX: number,
    topY: number,
    width: number,
    height: number,
    lines: string[],
    tone: PanelCardTone,
    onPress: (() => void) | null,
    fontSize = 14,
    lineHeight = 18
  ): number {
    let cardNode = this.node.getChildByName(name);
    if (!cardNode) {
      cardNode = new Node(name);
      cardNode.parent = this.node;
    }
    assignUiLayer(cardNode);
    cardNode.active = true;

    const centerY = topY - height / 2;
    const transform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    cardNode.setPosition(centerX, centerY, 1);

    const graphics = cardNode.getComponent(Graphics) ?? cardNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = tone.fill;
    graphics.strokeColor = tone.stroke;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 16);
    graphics.roundRect(-width / 2 + 12, height / 2 - 18, width - 24, 6, 4);
    graphics.fill();
    graphics.fillColor = tone.accent;
    graphics.roundRect(-width / 2 + 14, height / 2 - 16, Math.min(86, width * 0.34), 3, 2);
    graphics.fill();

    let labelNode = cardNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = cardNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 26, height - 18);
    labelNode.setPosition(0, 0, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = lines.join("\n");
    label.fontSize = fontSize;
    label.lineHeight = lineHeight;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_TOP;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.color = new Color(243, 247, 252, 255);

    this.bindPress(cardNode, onPress);
    return topY - height - 12;
  }

  private renderActionButton(
    name: string,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    labelText: string,
    tone: PanelCardTone,
    onPress: (() => void) | null
  ): void {
    let buttonNode = this.node.getChildByName(name);
    if (!buttonNode) {
      buttonNode = new Node(name);
      buttonNode.parent = this.node;
    }
    assignUiLayer(buttonNode);
    buttonNode.active = true;

    const transform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    buttonNode.setPosition(centerX, centerY, 1);
    const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = onPress ? tone.fill : new Color(tone.fill.r, tone.fill.g, tone.fill.b, 92);
    graphics.strokeColor = onPress ? tone.stroke : new Color(tone.stroke.r, tone.stroke.g, tone.stroke.b, 62);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 10);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = onPress ? tone.accent : new Color(tone.accent.r, tone.accent.g, tone.accent.b, 56);
    graphics.roundRect(-width / 2 + 12, height / 2 - 9, width - 24, 3, 2);
    graphics.fill();

    let labelNode = buttonNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = buttonNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 16, height - 8);
    labelNode.setPosition(0, 0, 0.1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 13;
    label.lineHeight = 15;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = new Color(243, 247, 252, onPress ? 255 : 140);

    this.bindPress(buttonNode, onPress);
  }

  private bindPress(node: Node, onPress: (() => void) | null): void {
    node.off(Node.EventType.TOUCH_END);
    node.off(Node.EventType.MOUSE_UP);
    if (!onPress) {
      return;
    }

    node.on(Node.EventType.TOUCH_END, () => {
      onPress();
    });
    node.on(Node.EventType.MOUSE_UP, () => {
      onPress();
    });
  }

  private hideExtraRoomCards(visibleCount: number): void {
    for (let index = visibleCount; index < 4; index += 1) {
      const node = this.node.getChildByName(`LobbyRoom-${index}`);
      if (node) {
        node.active = false;
      }
    }

    const emptyNode = this.node.getChildByName("LobbyRoomsEmpty");
    if (emptyNode) {
      emptyNode.active = visibleCount === 0;
    }
  }

  private hideLobbyRooms(): void {
    const roomsHeader = this.node.getChildByName("LobbyRoomsHeader");
    if (roomsHeader) {
      roomsHeader.active = false;
    }
    for (let index = 0; index < 4; index += 1) {
      const roomNode = this.node.getChildByName(`LobbyRoom-${index}`);
      if (roomNode) {
        roomNode.active = false;
      }
    }
    const emptyNode = this.node.getChildByName("LobbyRoomsEmpty");
    if (emptyNode) {
      emptyNode.active = false;
    }
    const showcase = this.node.getChildByName("LobbyShowcase");
    if (showcase) {
      showcase.active = false;
    }
  }

  private selectBattleReplay(replayId: string): void {
    if (this.currentState?.selectedBattleReplayId === replayId) {
      return;
    }

    this.onSelectBattleReplayReview?.(replayId);
  }

  private renderBattleReplayTimelineDetail(
    centerX: number,
    topY: number,
    width: number,
    account: CocosPlayerAccountProfile
  ): number {
    const replay = findPlayerBattleReplaySummary(account.recentBattleReplays, this.currentState?.selectedBattleReplayId);
    const view = buildCocosBattleReplayTimelineView(replay);
    const playback = replay && this.replayPlayback?.replay.id === replay.id ? this.replayPlayback : null;
    const currentStepIndex = playback?.currentStepIndex ?? 0;
    const timelineWindowStart =
      view.entries.length <= 4 ? 0 : Math.max(0, Math.min(view.entries.length - 4, Math.max(0, currentStepIndex - 1)));
    const timelineLines =
      view.entries.length > 0
        ? view.entries.slice(timelineWindowStart, timelineWindowStart + 4).map((entry) => {
            const marker =
              playback && entry.index <= currentStepIndex
                ? "已执行"
                : playback && entry.index === currentStepIndex + 1
                  ? "当前"
                  : "待播放";
            return `${marker} · ${entry.stepLabel} ${entry.actorLabel} · ${entry.actionLabel} · ${entry.outcomeLabel} · ${entry.roundLabel} · ${entry.sourceLabel}`;
          })
        : [view.emptyMessage ?? "暂无可展示的战报时间线。"];
    const playbackSummary = playback
      ? `播放游标 ${playback.currentStepIndex}/${playback.totalSteps} · 当前 ${playback.currentStep?.index ?? 0} · 下一步 ${playback.nextStep?.index ?? "无"} · 倍率 ${playback.speed}x`
      : "播放游标待同步";
    const lines = [view.title, `${view.subtitle} · ${view.badge}`, view.summary, playbackSummary, ...timelineLines];
    const height = Math.max(132, 52 + lines.length * 18);

    return this.renderCard(
      "LobbyBattleReplayTimeline",
      centerX,
      topY,
      width,
      height,
      lines,
      {
        fill: REVIEW_TIMELINE_FILL,
        stroke: REVIEW_TIMELINE_STROKE,
        accent: REVIEW_TIMELINE_ACCENT
      },
      null,
      13,
      18
    );
  }

  private renderBattleReplayCenter(centerX: number, topY: number, width: number, state: VeilLobbyRenderState): number {
    const view = buildCocosBattleReplayCenterView({
      replays: state.battleReplayItems,
      battleReports: state.account.battleReportCenter,
      selectedReplayId: state.selectedBattleReplayId,
      playback: this.replayPlayback,
      status: state.battleReplaySectionStatus,
      errorMessage: state.battleReplaySectionError || this.replayPlaybackStatus
    });
    const lines = [view.title, `${view.subtitle} · ${view.badge}`, ...view.detailLines];
    const height = Math.max(148, 52 + lines.length * 18);
    const nextTopY = this.renderCard(
      "LobbyBattleReplayCenter",
      centerX,
      topY,
      width,
      height,
      lines,
      {
        fill: REVIEW_TIMELINE_FILL,
        stroke: REVIEW_TIMELINE_STROKE,
        accent: REVIEW_TIMELINE_ACCENT
      },
      null,
      13,
      18
    );

    const controlsPerRow = 5;
    const controlWidth = Math.floor((width - 24) / controlsPerRow);
    const startX = centerX - width / 2 + controlWidth / 2;
    view.controls.forEach((control, index) => {
      const row = Math.floor(index / controlsPerRow);
      const column = index % controlsPerRow;
      this.renderActionButton(
        `LobbyReplayControl-${control.action}`,
        startX + column * (controlWidth + 6),
        nextTopY - 14 - row * 34,
        controlWidth,
        26,
        control.label,
        {
          fill: control.action === "play" ? REPLAY_CONTROL_ACTIVE_FILL : REPLAY_CONTROL_FILL,
          stroke: new Color(233, 242, 250, 130),
          accent: new Color(218, 230, 242, 120)
        },
        control.enabled ? () => this.applyReplayControl(control.action) : null
      );
    });

    return nextTopY - Math.ceil(view.controls.length / controlsPerRow) * 34;
  }

  private hideBattleReplayTimelineCard(): void {
    const centerNode = this.node.getChildByName("LobbyBattleReplayCenter");
    if (centerNode) {
      centerNode.active = false;
    }
    const node = this.node.getChildByName("LobbyBattleReplayTimeline");
    if (node) {
      node.active = false;
    }
    ([
      "play",
      "pause",
      "step-back",
      "step-forward",
      "turn-back",
      "turn-forward",
      "speed-down",
      "speed-up",
      "reset"
    ] as CocosBattleReplayCenterControlAction[]).forEach((action) => {
      const control = this.node.getChildByName(`LobbyReplayControl-${action}`);
      if (control) {
        control.active = false;
      }
    });
  }

  private syncReplayPlaybackState(state: VeilLobbyRenderState): void {
    const replay = this.resolveSelectedReplay(state);
    if (!replay) {
      this.stopReplayPlaybackLoop();
      this.replayPlayback = null;
      this.replayPlaybackReplayId = null;
      this.replayPlaybackStatus =
        state.battleReplaySectionStatus === "loading"
          ? "正在同步最近战斗..."
          : state.battleReplaySectionStatus === "error"
            ? (state.battleReplaySectionError?.trim() || "回放同步失败。")
            : state.account.battleReportCenter?.items.some((report) => report.id === state.selectedBattleReplayId)
              ? "当前仅同步到战报摘要，完整回放暂不可用。"
              : "选择一场最近战斗，即可查看逐步回放。";
      return;
    }

    if (this.replayPlaybackReplayId === replay.id && this.replayPlayback?.replay.id === replay.id) {
      return;
    }

    this.stopReplayPlaybackLoop();
    this.replayPlayback = createBattleReplayPlaybackState(replay);
    this.replayPlaybackReplayId = replay.id;
    this.replayPlaybackStatus = "已加载完整回放，可逐步回看。";
  }

  private resolveSelectedReplay(state: VeilLobbyRenderState): PlayerBattleReplaySummary | null {
    return (
      findPlayerBattleReplaySummary(state.battleReplayItems, state.selectedBattleReplayId)
      ?? findPlayerBattleReplaySummary(state.account.recentBattleReplays, state.selectedBattleReplayId)
    );
  }

  private applyReplayControl(action: CocosBattleReplayCenterControlAction): void {
    if (!this.replayPlayback) {
      return;
    }

    if (action !== "play") {
      this.stopReplayPlaybackLoop();
    }

    switch (action) {
      case "play":
        this.replayPlayback = playBattleReplayPlayback(this.replayPlayback);
        this.replayPlaybackStatus = "正在自动播放。";
        if (this.replayPlayback.status === "playing") {
          this.startReplayPlaybackLoop();
        }
        break;
      case "pause":
        this.replayPlayback = pauseBattleReplayPlayback(this.replayPlayback);
        this.replayPlaybackStatus = "已暂停回放。";
        break;
      case "step-back":
        this.replayPlayback = stepBackBattleReplayPlayback(this.replayPlayback);
        this.replayPlaybackStatus = "已后退一步。";
        break;
      case "step-forward":
        this.replayPlayback = stepBattleReplayPlayback(this.replayPlayback);
        this.replayPlaybackStatus = this.replayPlayback.status === "completed" ? "已播放至结算。" : "已前进一步。";
        break;
      case "turn-back":
        this.replayPlayback = seekBattleReplayPlaybackToTurn(
          this.replayPlayback,
          Math.max(1, Math.floor(this.replayPlayback.currentState.round || 1) - 1)
        );
        this.replayPlaybackStatus = "已跳回上一回合。";
        break;
      case "turn-forward":
        this.replayPlayback = seekBattleReplayPlaybackToTurn(
          this.replayPlayback,
          Math.max(1, Math.floor(this.replayPlayback.currentState.round || 1) + 1)
        );
        this.replayPlaybackStatus =
          this.replayPlayback.status === "completed" ? "已定位到结算回合。" : "已跳到下一回合。";
        break;
      case "speed-down":
        this.replayPlayback = setBattleReplayPlaybackSpeed(
          this.replayPlayback,
          this.shiftReplayPlaybackSpeed(this.replayPlayback.speed, -1)
        );
        this.replayPlaybackStatus = `回放倍率已调整为 ${this.replayPlayback.speed}x。`;
        if (this.replayPlayback.status === "playing") {
          this.startReplayPlaybackLoop();
        }
        break;
      case "speed-up":
        this.replayPlayback = setBattleReplayPlaybackSpeed(
          this.replayPlayback,
          this.shiftReplayPlaybackSpeed(this.replayPlayback.speed, 1)
        );
        this.replayPlaybackStatus = `回放倍率已调整为 ${this.replayPlayback.speed}x。`;
        if (this.replayPlayback.status === "playing") {
          this.startReplayPlaybackLoop();
        }
        break;
      case "reset":
        this.replayPlayback = resetBattleReplayPlayback(this.replayPlayback);
        this.replayPlaybackStatus = "已回到开场快照。";
        break;
    }

    if (this.currentState) {
      this.render(this.currentState);
    }
  }

  private startReplayPlaybackLoop(): void {
    if (this.replayPlaybackTimer) {
      clearInterval(this.replayPlaybackTimer);
      this.replayPlaybackTimer = null;
    }

    if (!this.replayPlayback) {
      return;
    }

    this.replayPlaybackTimer = setInterval(() => {
      if (!this.replayPlayback) {
        this.stopReplayPlaybackLoop();
        return;
      }

      this.replayPlayback = tickBattleReplayPlayback(this.replayPlayback);
      if (this.replayPlayback.status !== "playing") {
        this.replayPlaybackStatus = this.replayPlayback.status === "completed" ? "已播放至结算。" : "已暂停回放。";
        this.stopReplayPlaybackLoop();
      }

      if (this.currentState) {
        this.render(this.currentState);
      }
    }, resolveReplayPlaybackIntervalMs(this.replayPlayback.speed));
  }

  private stopReplayPlaybackLoop(): void {
    if (!this.replayPlaybackTimer) {
      return;
    }

    clearInterval(this.replayPlaybackTimer);
    this.replayPlaybackTimer = null;
  }

  private shiftReplayPlaybackSpeed(currentSpeed: number, direction: -1 | 1): number {
    const currentIndex = REPLAY_PLAYBACK_SPEEDS.findIndex((speed) => speed === currentSpeed);
    const safeIndex = currentIndex >= 0 ? currentIndex : 1;
    const nextIndex = Math.max(0, Math.min(REPLAY_PLAYBACK_SPEEDS.length - 1, safeIndex + direction));
    return REPLAY_PLAYBACK_SPEEDS[nextIndex] ?? 1;
  }

  private renderAccountReviewCards(
    centerX: number,
    topY: number,
    width: number,
    items: CocosAccountReviewItem[],
    options: {
      highlightReplayId?: string | null;
      onSelectReplay?: (replayId: string) => void;
      banner?: CocosAccountReviewPage["banner"];
    } = {}
  ): void {
    const { highlightReplayId = null, onSelectReplay, banner = null } = options;
    let currentTopY = topY;

    if (banner) {
      currentTopY = this.renderCard(
        "LobbyAccountReviewBanner",
        centerX,
        currentTopY,
        width,
        72,
        [banner.title, banner.detail],
        banner.tone === "negative"
          ? {
              fill: new Color(96, 62, 62, 190),
              stroke: new Color(246, 214, 214, 84),
              accent: new Color(236, 176, 176, 188)
            }
          : {
              fill: MUTED_FILL,
              stroke: new Color(214, 224, 238, 42),
              accent: new Color(128, 146, 170, 156)
            },
        null,
        13,
        17
      );
    } else {
      const bannerNode = this.node.getChildByName("LobbyAccountReviewBanner");
      if (bannerNode) {
        bannerNode.active = false;
      }
    }

    if (items.length === 0) {
      this.renderCard(
        "LobbyAccountReviewEmpty",
        centerX,
        currentTopY,
        width,
        84,
        ["暂无回顾数据", "当前账号快照还没有战报、事件或成就进度。", "刷新 Lobby 或完成一局流程后会再次同步。"],
        {
          fill: MUTED_FILL,
          stroke: new Color(214, 224, 238, 42),
          accent: new Color(128, 146, 170, 156)
        },
        null,
        14,
        18
      );
      this.hideExtraAccountReviewCards(0);
      return;
    }

    const cardHeight = 78;
    items.forEach((item, index) => {
      const isHighlighted = item.replayId && highlightReplayId && item.replayId === highlightReplayId;
      const tone = isHighlighted
        ? {
            fill: REVIEW_HIGHLIGHT_FILL,
            stroke: REVIEW_HIGHLIGHT_STROKE,
            accent: REVIEW_HIGHLIGHT_ACCENT
          }
        : item.emphasis === "positive"
          ? {
              fill: new Color(78, 92, 72, 184),
              stroke: new Color(234, 244, 220, 74),
              accent: new Color(198, 226, 154, 196)
            }
          : {
              fill: new Color(36, 47, 62, 176),
              stroke: new Color(214, 224, 238, 42),
              accent: new Color(110, 152, 214, 164)
            };
      const onPress = item.replayId && onSelectReplay ? () => onSelectReplay(item.replayId!) : null;
      this.renderCard(
        `LobbyAccountReview-${index}`,
        centerX,
        currentTopY - index * (cardHeight + 10),
        width,
        cardHeight,
        [item.title, item.detail, item.footnote],
        tone,
        onPress,
        14,
        18
      );
    });

    const emptyNode = this.node.getChildByName("LobbyAccountReviewEmpty");
    if (emptyNode) {
      emptyNode.active = false;
    }
    this.hideExtraAccountReviewCards(items.length);
  }

  private hideExtraAccountReviewCards(visibleCount: number): void {
    for (let index = visibleCount; index < 3; index += 1) {
      const node = this.node.getChildByName(`LobbyAccountReview-${index}`);
      if (node) {
        node.active = false;
      }
    }
  }

  private hideAccountReviewCards(): void {
    const header = this.node.getChildByName("LobbyAccountReviewHeader");
    if (header) {
      header.active = false;
    }
    (["progression", "battle-replays", "event-history", "achievements"] as CocosAccountReviewSection[]).forEach((section) => {
      const tab = this.node.getChildByName(`LobbyAccountReviewTab-${section}`);
      if (tab) {
        tab.active = false;
      }
    });
    const prevButton = this.node.getChildByName("LobbyAccountReviewPrev");
    if (prevButton) {
      prevButton.active = false;
    }
    const nextButton = this.node.getChildByName("LobbyAccountReviewNext");
    if (nextButton) {
      nextButton.active = false;
    }
    const emptyNode = this.node.getChildByName("LobbyAccountReviewEmpty");
    if (emptyNode) {
      emptyNode.active = false;
    }
    const bannerNode = this.node.getChildByName("LobbyAccountReviewBanner");
    if (bannerNode) {
      bannerNode.active = false;
    }
    const retryButton = this.node.getChildByName("LobbyAccountReviewRetry");
    if (retryButton) {
      retryButton.active = false;
    }
    this.hideExtraAccountReviewCards(0);
  }

  private renderAccountFlowPanel(
    centerX: number,
    topY: number,
    width: number,
    flow: CocosAccountLifecyclePanelView | CocosAccountRegistrationPanelView,
    entering: boolean
  ): void {
    const registrationFlow = isRegistrationFlowView(flow) ? flow : null;
    let cursorY = this.renderCard(
      "LobbyAccountFlowHeader",
      centerX,
      topY,
      width,
      registrationFlow?.status ? 142 : 118,
      [
        flow.title,
        flow.intro,
        `就绪状态 ${formatAccountReadinessStatus(flow.readiness.status)} · ${flow.readiness.summary}`,
        `${flow.readiness.detail} ${flow.deliveryHint}`.trim(),
        ...(registrationFlow?.status ? [registrationFlow.status.message] : [])
      ],
      {
        fill: TITLE_FILL,
        stroke: new Color(236, 228, 198, 62),
        accent: new Color(214, 175, 112, 194)
      },
      null,
      14,
      18
    );

    flow.fields.forEach((field) => {
      cursorY = this.renderCard(
        `LobbyAccountFlowField-${field.key}`,
        centerX,
        cursorY,
        width,
        70,
        [
          field.label,
          `${field.value || field.placeholder} · ${formatAccountReadinessStatus(field.readiness.status)}`,
          `${field.readiness.summary}；${field.hint}`
        ],
        {
          fill: FIELD_FILL,
          stroke: new Color(224, 235, 246, 52),
          accent: new Color(110, 152, 214, 196)
        },
        entering ? null : () => this.onEditAccountFlowField?.(field.key),
        13,
        17
      );
    });

    if (registrationFlow) {
      registrationFlow.identities.forEach((identity, index) => {
        cursorY = this.renderCard(
          `LobbyAccountFlowIdentity-${index}`,
          centerX,
          cursorY,
          width,
          70,
          [identity.label, identity.status.toUpperCase(), identity.detail],
          {
            fill: FIELD_FILL,
            stroke: new Color(224, 235, 246, 52),
            accent:
              identity.status === "bound"
                ? new Color(128, 192, 152, 204)
                : identity.status === "available"
                  ? new Color(118, 164, 224, 204)
                  : new Color(176, 142, 108, 196)
          },
          null,
          13,
          17
        );
      });
      this.hideExtraCards("LobbyAccountFlowIdentity-", registrationFlow.identities.length);

      if (registrationFlow.minorProtection) {
        cursorY = this.renderCard(
          "LobbyAccountFlowMinorProtection",
          centerX,
          cursorY,
          width,
          70,
          [
            registrationFlow.minorProtection.label,
            registrationFlow.minorProtection.value,
            registrationFlow.minorProtection.detail
          ],
          {
            fill: FIELD_FILL,
            stroke: new Color(224, 235, 246, 52),
            accent: new Color(132, 180, 162, 204)
          },
          entering ? null : this.onToggleAccountMinorProtection ?? null,
          13,
          17
        );

        this.renderActionButton(
          "LobbyAccountFlowMinorProtectionToggle",
          centerX,
          cursorY - 16,
          width,
          28,
          registrationFlow.minorProtectionAction?.label ?? "切换年龄声明",
          {
            fill: ACTION_ACCOUNT,
            stroke: new Color(228, 236, 248, 120),
            accent: new Color(220, 230, 244, 112)
          },
          entering ? null : this.onToggleAccountMinorProtection ?? null
        );
        cursorY -= 50;
      }
    } else {
      this.hideExtraCards("LobbyAccountFlowIdentity-", 0);
      const minorProtectionNode = this.node.getChildByName("LobbyAccountFlowMinorProtection");
      if (minorProtectionNode) {
        minorProtectionNode.active = false;
      }
      const minorProtectionToggleNode = this.node.getChildByName("LobbyAccountFlowMinorProtectionToggle");
      if (minorProtectionToggleNode) {
        minorProtectionToggleNode.active = false;
      }
    }

    this.renderActionButton(
      "LobbyAccountFlowRequest",
      centerX,
      cursorY - 16,
      width,
      28,
      entering ? "处理中..." : flow.requestLabel,
      {
        fill: ACTION_ACCOUNT,
        stroke: new Color(228, 236, 248, 120),
        accent: new Color(220, 230, 244, 112)
      },
      entering ? null : this.onRequestAccountFlow ?? null
    );
    this.renderActionButton(
      "LobbyAccountFlowConfirm",
      centerX,
      cursorY - 50,
      width,
      28,
      entering ? "处理中..." : flow.confirmLabel,
      {
        fill: ACTION_ENTER,
        stroke: new Color(228, 244, 229, 124),
        accent: new Color(226, 244, 230, 116)
      },
      entering ? null : this.onConfirmAccountFlow ?? null
    );
    this.renderActionButton(
      "LobbyAccountFlowBindWechat",
      centerX,
      cursorY - 84,
      width,
      28,
      registrationFlow ? registrationFlow.bindWechatAction.label : "当前流程不支持微信绑定",
      {
        fill: ACTION_ACCOUNT_REVIEW_ACTIVE,
        stroke: new Color(228, 244, 229, 124),
        accent: new Color(226, 244, 230, 116)
      },
      registrationFlow && !entering && registrationFlow.bindWechatAction.enabled ? this.onBindWechatAccount ?? null : null
    );
    this.renderActionButton(
      "LobbyAccountFlowCancel",
      centerX,
      cursorY - 118,
      width,
      28,
      "收起流程面板",
      {
        fill: ACTION_LOGOUT,
        stroke: new Color(247, 232, 226, 118),
        accent: new Color(250, 234, 228, 110)
      },
      entering ? null : this.onCancelAccountFlow ?? null
    );
  }

  private hideAccountFlowPanel(): void {
    const names = [
      "LobbyAccountFlowHeader",
      "LobbyAccountFlowRequest",
      "LobbyAccountFlowConfirm",
      "LobbyAccountFlowBindWechat",
      "LobbyAccountFlowCancel",
      "LobbyAccountFlowMinorProtection",
      "LobbyAccountFlowMinorProtectionToggle",
      "LobbyAccountFlowField-loginId",
      "LobbyAccountFlowField-displayName",
      "LobbyAccountFlowField-token",
      "LobbyAccountFlowField-password",
      "LobbyAccountFlowIdentity-0",
      "LobbyAccountFlowIdentity-1"
    ];
    names.forEach((name) => {
      const node = this.node.getChildByName(name);
      if (node) {
        node.active = false;
      }
    });
  }

  private renderPixelShowcase(centerX: number, topY: number, width: number): void {
    const assets = getPixelSpriteAssets();
    const phaseLabel = formatLobbyShowcasePhaseLabel(this.showcasePhase);

    this.renderCard(
      "LobbyShowcase",
      centerX,
      topY,
      width,
      SHOWCASE_CARD_HEIGHT,
      [
        "像素画册",
        `4 英雄 / 6 展示兵种轮播 / 5 地形 / 4 建筑 · ${phaseLabel}`,
        `表现 ${this.currentState?.presentationReadiness.summary ?? "等待表现资源就绪度..."}`,
        this.currentState?.presentationReadiness.nextStep ?? (assets ? "Lobby 已直连 #33 像素资源包，可在进入房间前先看主视觉。" : "正在加载 Boot 包里的像素资源...")
      ],
      {
        fill: SHOWCASE_FILL,
        stroke: new Color(235, 222, 184, 68),
        accent: new Color(214, 175, 112, 194)
      },
      null,
      11,
      14
    );

    const cardNode = this.node.getChildByName("LobbyShowcase");
    if (!cardNode) {
      return;
    }

    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    const rowY = [14, -24];
    const slotWidth = (cardTransform.width - 28) / 4;
    resolveLobbyShowcaseEntries(this.showcaseUnitPage).forEach((entry, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      const centerX = -cardTransform.width / 2 + 14 + slotWidth * col + slotWidth / 2;
      this.renderShowcaseTile(
        cardNode,
        index,
        centerX,
        rowY[row] ?? -42,
        Math.min(62, slotWidth - 4),
        entry.label,
        this.resolveShowcaseFrame(entry),
        this.showcasePhase
      );
    });

    const terrainSlotWidth = (cardTransform.width - 30) / 5;
    lobbyTerrainShowcaseEntries.forEach((entry, index) => {
      const centerX = -cardTransform.width / 2 + 15 + terrainSlotWidth * index + terrainSlotWidth / 2;
      this.renderTerrainTile(
        cardNode,
        index,
        centerX,
        -58,
        Math.min(44, terrainSlotWidth - 4),
        entry.label,
        this.resolveTerrainFrame(entry)
      );
    });

    const buildingSlotWidth = (cardTransform.width - 28) / 4;
    lobbyBuildingShowcaseEntries.forEach((entry, index) => {
      const centerX = -cardTransform.width / 2 + 14 + buildingSlotWidth * index + buildingSlotWidth / 2;
      this.renderBuildingTile(
        cardNode,
        index,
        centerX,
        -92,
        Math.min(52, buildingSlotWidth - 4),
        entry.label,
        this.resolveBuildingFrame(entry)
      );
    });
  }

  private resolveShowcaseFrame(entry: LobbyShowcaseEntry): SpriteFrame | null {
    return resolveLobbyShowcaseFrame(entry, getPixelSpriteAssets(), this.showcasePhase);
  }

  private resolveTerrainFrame(entry: LobbyTerrainShowcaseEntry): SpriteFrame | null {
    return resolveLobbyTerrainFrame(entry, getPixelSpriteAssets());
  }

  private resolveBuildingFrame(entry: LobbyBuildingShowcaseEntry): SpriteFrame | null {
    return resolveLobbyBuildingFrame(entry, getPixelSpriteAssets());
  }

  private renderShowcaseTile(
    cardNode: Node,
    index: number,
    centerX: number,
    centerY: number,
    width: number,
    labelText: string,
    frame: SpriteFrame | null,
    phase: LobbyShowcasePhase
  ): void {
    let tileNode = cardNode.getChildByName(`ShowcaseTile-${index}`);
    if (!tileNode) {
      tileNode = new Node(`ShowcaseTile-${index}`);
      tileNode.parent = cardNode;
    }
    assignUiLayer(tileNode);
    tileNode.active = true;

    const transform = tileNode.getComponent(UITransform) ?? tileNode.addComponent(UITransform);
    transform.setContentSize(width, 34);
    tileNode.setPosition(centerX, centerY, 1);

    const graphics = tileNode.getComponent(Graphics) ?? tileNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = phase === "hit"
      ? new Color(62, 44, 48, 210)
      : phase === "selected"
        ? new Color(38, 48, 64, 214)
        : new Color(28, 38, 53, 208);
    graphics.strokeColor = frame
      ? phase === "hit"
        ? new Color(244, 186, 186, 112)
        : phase === "selected"
          ? new Color(248, 230, 176, 118)
          : new Color(238, 226, 191, 92)
      : new Color(184, 196, 214, 46);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -17, width, 34, 10);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 14);
    graphics.roundRect(-width / 2 + 6, 8, width - 12, 3, 2);
    graphics.fill();

    let iconNode = tileNode.getChildByName("Icon");
    if (!iconNode) {
      iconNode = new Node("Icon");
      iconNode.parent = tileNode;
    }
    assignUiLayer(iconNode);
    const iconTransform = iconNode.getComponent(UITransform) ?? iconNode.addComponent(UITransform);
    iconTransform.setContentSize(16, 16);
    iconNode.setPosition(0, 3, 1);
    const iconSprite = iconNode.getComponent(Sprite) ?? iconNode.addComponent(Sprite);
    iconNode.active = Boolean(frame);
    if (frame) {
      iconSprite.spriteFrame = frame;
    }

    let labelNode = tileNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = tileNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 8, 10);
    labelNode.setPosition(0, -9, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 8;
    label.lineHeight = 10;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = new Color(243, 247, 252, 255);
  }

  private renderTerrainTile(
    cardNode: Node,
    index: number,
    centerX: number,
    centerY: number,
    width: number,
    labelText: string,
    frame: SpriteFrame | null
  ): void {
    let tileNode = cardNode.getChildByName(`ShowcaseTerrain-${index}`);
    if (!tileNode) {
      tileNode = new Node(`ShowcaseTerrain-${index}`);
      tileNode.parent = cardNode;
    }
    assignUiLayer(tileNode);
    tileNode.active = true;

    const transform = tileNode.getComponent(UITransform) ?? tileNode.addComponent(UITransform);
    transform.setContentSize(width, 32);
    tileNode.setPosition(centerX, centerY, 1);

    const graphics = tileNode.getComponent(Graphics) ?? tileNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(24, 32, 46, 204);
    graphics.strokeColor = frame ? new Color(212, 220, 232, 86) : new Color(126, 142, 160, 48);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -16, width, 32, 8);
    graphics.fill();
    graphics.stroke();

    let iconNode = tileNode.getChildByName("Icon");
    if (!iconNode) {
      iconNode = new Node("Icon");
      iconNode.parent = tileNode;
    }
    assignUiLayer(iconNode);
    const iconTransform = iconNode.getComponent(UITransform) ?? iconNode.addComponent(UITransform);
    iconTransform.setContentSize(18, 18);
    iconNode.setPosition(0, 4, 1);
    const iconSprite = iconNode.getComponent(Sprite) ?? iconNode.addComponent(Sprite);
    iconNode.active = Boolean(frame);
    if (frame) {
      iconSprite.spriteFrame = frame;
    }

    let labelNode = tileNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = tileNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 6, 10);
    labelNode.setPosition(0, -10, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 7;
    label.lineHeight = 9;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = new Color(236, 242, 248, 255);
  }

  private renderBuildingTile(
    cardNode: Node,
    index: number,
    centerX: number,
    centerY: number,
    width: number,
    labelText: string,
    frame: SpriteFrame | null
  ): void {
    let tileNode = cardNode.getChildByName(`ShowcaseBuilding-${index}`);
    if (!tileNode) {
      tileNode = new Node(`ShowcaseBuilding-${index}`);
      tileNode.parent = cardNode;
    }
    assignUiLayer(tileNode);
    tileNode.active = true;

    const transform = tileNode.getComponent(UITransform) ?? tileNode.addComponent(UITransform);
    transform.setContentSize(width, 34);
    tileNode.setPosition(centerX, centerY, 1);

    const graphics = tileNode.getComponent(Graphics) ?? tileNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(30, 38, 54, 208);
    graphics.strokeColor = frame ? new Color(228, 210, 170, 92) : new Color(126, 142, 160, 48);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -17, width, 34, 9);
    graphics.fill();
    graphics.stroke();

    let iconNode = tileNode.getChildByName("Icon");
    if (!iconNode) {
      iconNode = new Node("Icon");
      iconNode.parent = tileNode;
    }
    assignUiLayer(iconNode);
    const iconTransform = iconNode.getComponent(UITransform) ?? iconNode.addComponent(UITransform);
    iconTransform.setContentSize(18, 18);
    iconNode.setPosition(0, 4, 1);
    const iconSprite = iconNode.getComponent(Sprite) ?? iconNode.addComponent(Sprite);
    iconNode.active = Boolean(frame);
    if (frame) {
      iconSprite.spriteFrame = frame;
    }

    let labelNode = tileNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = tileNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 6, 10);
    labelNode.setPosition(0, -10, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 8;
    label.lineHeight = 10;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = new Color(240, 236, 228, 255);
  }
}
