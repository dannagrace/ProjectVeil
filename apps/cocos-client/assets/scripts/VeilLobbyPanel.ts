import { _decorator, Color, Component, Graphics, Label, Node, Sprite, SpriteFrame, UITransform } from "cc";
import {
  type CocosAccountReviewItem,
  type CocosAccountReviewPage,
  type CocosAccountReviewSection
} from "./cocos-account-review.ts";
import type { CocosLobbyRoomSummary, CocosPlayerAccountProfile } from "./cocos-lobby.ts";
import { getPixelSpriteAssets } from "./cocos-pixel-sprites.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import { buildCocosBattleReplayTimelineView } from "./cocos-battle-replay-timeline.ts";
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
import type { CocosAccountLifecycleFieldView, CocosAccountLifecyclePanelView } from "./cocos-account-lifecycle.ts";
import { findPlayerBattleReplaySummary } from "./project-shared/battle-replay.ts";

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

export interface VeilLobbyRenderState {
  playerId: string;
  displayName: string;
  roomId: string;
  authMode: "guest" | "account";
  loginId: string;
  loginHint: string;
  loginActionLabel: string;
  shareHint: string;
  vaultSummary: string;
  account: CocosPlayerAccountProfile;
  accountReview: CocosAccountReviewPage;
  selectedBattleReplayId: string | null;
  sessionSource: "remote" | "local" | "manual" | "none";
  loading: boolean;
  entering: boolean;
  status: string;
  rooms: CocosLobbyRoomSummary[];
  accountFlow: CocosAccountLifecyclePanelView | null;
  presentationReadiness: CocosPresentationReadiness;
}

export interface VeilLobbyPanelOptions {
  onEditPlayerId?: () => void;
  onEditDisplayName?: () => void;
  onEditRoomId?: () => void;
  onEditLoginId?: () => void;
  onRefresh?: () => void;
  onEnterRoom?: () => void;
  onLoginAccount?: () => void;
  onRegisterAccount?: () => void;
  onRecoverAccount?: () => void;
  onEditAccountFlowField?: (field: CocosAccountLifecycleFieldView["key"]) => void;
  onRequestAccountFlow?: () => void;
  onConfirmAccountFlow?: () => void;
  onCancelAccountFlow?: () => void;
  onOpenConfigCenter?: () => void;
  onLogout?: () => void;
  onJoinRoom?: (roomId: string) => void;
  onToggleAccountReview?: (open: boolean) => void;
  onSelectAccountReviewSection?: (section: CocosAccountReviewSection) => void;
  onSelectAccountReviewPage?: (section: "battle-replays" | "event-history", page: number) => void;
  onRetryAccountReviewSection?: (section: CocosAccountReviewSection) => void;
  onSelectBattleReplayReview?: (replayId: string) => void;
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
  private onRefresh: (() => void) | undefined;
  private onEnterRoom: (() => void) | undefined;
  private onLoginAccount: (() => void) | undefined;
  private onRegisterAccount: (() => void) | undefined;
  private onRecoverAccount: (() => void) | undefined;
  private onEditAccountFlowField: ((field: CocosAccountLifecycleFieldView["key"]) => void) | undefined;
  private onRequestAccountFlow: (() => void) | undefined;
  private onConfirmAccountFlow: (() => void) | undefined;
  private onCancelAccountFlow: (() => void) | undefined;
  private onOpenConfigCenter: (() => void) | undefined;
  private onLogout: (() => void) | undefined;
  private onJoinRoom: ((roomId: string) => void) | undefined;
  private onToggleAccountReview: ((open: boolean) => void) | undefined;
  private onSelectAccountReviewSection: ((section: CocosAccountReviewSection) => void) | undefined;
  private onSelectAccountReviewPage: ((section: "battle-replays" | "event-history", page: number) => void) | undefined;
  private onRetryAccountReviewSection: ((section: CocosAccountReviewSection) => void) | undefined;
  private onSelectBattleReplayReview: ((replayId: string) => void) | undefined;

  onDestroy(): void {
    this.unscheduleAllCallbacks();
  }

  configure(options: VeilLobbyPanelOptions): void {
    this.onEditPlayerId = options.onEditPlayerId;
    this.onEditDisplayName = options.onEditDisplayName;
    this.onEditRoomId = options.onEditRoomId;
    this.onEditLoginId = options.onEditLoginId;
    this.onRefresh = options.onRefresh;
    this.onEnterRoom = options.onEnterRoom;
    this.onLoginAccount = options.onLoginAccount;
    this.onRegisterAccount = options.onRegisterAccount;
    this.onRecoverAccount = options.onRecoverAccount;
    this.onEditAccountFlowField = options.onEditAccountFlowField;
    this.onRequestAccountFlow = options.onRequestAccountFlow;
    this.onConfirmAccountFlow = options.onConfirmAccountFlow;
    this.onCancelAccountFlow = options.onCancelAccountFlow;
    this.onOpenConfigCenter = options.onOpenConfigCenter;
    this.onLogout = options.onLogout;
    this.onJoinRoom = options.onJoinRoom;
    this.onToggleAccountReview = options.onToggleAccountReview;
    this.onSelectAccountReviewSection = options.onSelectAccountReviewSection;
    this.onSelectAccountReviewPage = options.onSelectAccountReviewPage;
    this.onRetryAccountReviewSection = options.onRetryAccountReviewSection;
    this.onSelectBattleReplayReview = options.onSelectBattleReplayReview;
  }

  render(state: VeilLobbyRenderState): void {
    this.currentState = state;
    this.ensureShowcaseTicker();
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
      state.entering ? null : this.onEnterRoom ?? null
    );
    this.renderActionButton(
      "LobbyAccountEnter",
      leftX,
      leftCursorY - 86,
      leftWidth,
      28,
      state.entering ? "登录中..." : state.loginActionLabel || (state.authMode === "account" ? "账号进入" : "账号登录并进入"),
      {
        fill: ACTION_ACCOUNT,
        stroke: new Color(228, 236, 248, 120),
        accent: new Color(220, 230, 244, 112)
      },
      state.entering ? null : this.onLoginAccount ?? null
    );
    this.renderActionButton(
      "LobbyRegisterAccount",
      leftX,
      leftCursorY - 120,
      leftWidth,
      28,
      "正式注册",
      {
        fill: ACTION_ACCOUNT,
        stroke: new Color(228, 236, 248, 120),
        accent: new Color(220, 230, 244, 112)
      },
      state.entering ? null : this.onRegisterAccount ?? null
    );
    this.renderActionButton(
      "LobbyRecoverAccount",
      leftX,
      leftCursorY - 154,
      leftWidth,
      28,
      "密码找回",
      {
        fill: ACTION_ACCOUNT,
        stroke: new Color(228, 236, 248, 120),
        accent: new Color(220, 230, 244, 112)
      },
      state.entering ? null : this.onRecoverAccount ?? null
    );
    this.renderActionButton(
      "LobbyConfigCenter",
      leftX,
      leftCursorY - 188,
      leftWidth,
      28,
      "打开配置台",
      {
        fill: ACTION_CONFIG,
        stroke: new Color(234, 240, 228, 116),
        accent: new Color(226, 236, 220, 108)
      },
      state.entering ? null : this.onOpenConfigCenter ?? null
    );
    this.renderActionButton(
      "LobbyLogout",
      leftX,
      leftCursorY - 222,
      leftWidth,
      28,
      state.authMode === "account" ? "退出账号会话" : "退出游客会话",
      {
        fill: ACTION_LOGOUT,
        stroke: new Color(247, 232, 226, 118),
        accent: new Color(250, 234, 228, 110)
      },
      state.entering || state.sessionSource === "none" ? null : this.onLogout ?? null
    );
    this.renderActionButton(
      "LobbyAccountReview",
      leftX,
      leftCursorY - 256,
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
      this.hideAccountFlowPanel();
      const review = state.accountReview;
      const hasBattleReplays = state.account.recentBattleReplays.length > 0;
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
        reviewCardsTop = this.renderBattleReplayTimelineDetail(rightX, reviewCardsTop, rightWidth, state.account);
        this.renderAccountReviewCards(rightX, reviewCardsTop, rightWidth, review.items, {
          highlightReplayId: state.selectedBattleReplayId,
          banner: review.banner,
          onSelectReplay: (replayId) => {
            this.selectBattleReplay(replayId);
          }
        });
      } else {
        this.hideBattleReplayTimelineCard();
        this.renderAccountReviewCards(rightX, reviewCardsTop, rightWidth, review.items, {
          banner: review.banner
        });
      }
      this.hideLobbyRooms();
    } else if (state.accountFlow) {
      this.hideAccountReviewCards();
      this.hideBattleReplayTimelineCard();
      this.hideLobbyRooms();
      this.renderAccountFlowPanel(rightX, rightCursorY, rightWidth, state.accountFlow, state.entering);
    } else {
      this.hideAccountFlowPanel();
      this.hideAccountReviewCards();
      this.hideBattleReplayTimelineCard();
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
            rightCursorY - index * 78,
            rightWidth,
            68,
            [
              room.roomId,
              `Day ${room.day} · Seed ${room.seed}`,
              `玩家 ${room.connectedPlayers} · 英雄 ${room.heroCount} · 战斗 ${room.activeBattles} · ${updatedAt}`
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
        showcaseTopY = rightCursorY - visibleRooms.length * 78;
      }

      this.renderPixelShowcase(rightX, showcaseTopY, rightWidth);
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
    const timelineLines =
      view.entries.length > 0
        ? view.entries.map(
            (entry) =>
              `${entry.stepLabel} ${entry.actorLabel} · ${entry.actionLabel} · ${entry.outcomeLabel} · ${entry.roundLabel} · ${entry.sourceLabel}`
          )
        : [view.emptyMessage ?? "暂无可展示的战报时间线。"];
    const lines = [view.title, `${view.subtitle} · ${view.badge}`, view.summary, "", ...timelineLines];
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

  private hideBattleReplayTimelineCard(): void {
    const node = this.node.getChildByName("LobbyBattleReplayTimeline");
    if (node) {
      node.active = false;
    }
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
    flow: CocosAccountLifecyclePanelView,
    entering: boolean
  ): void {
    let cursorY = this.renderCard(
      "LobbyAccountFlowHeader",
      centerX,
      topY,
      width,
      96,
      [flow.title, flow.intro, flow.deliveryHint],
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
        62,
        [field.label, field.value || field.placeholder, field.hint],
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
      "LobbyAccountFlowCancel",
      centerX,
      cursorY - 84,
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
      "LobbyAccountFlowCancel",
      "LobbyAccountFlowField-loginId",
      "LobbyAccountFlowField-displayName",
      "LobbyAccountFlowField-token",
      "LobbyAccountFlowField-password"
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
