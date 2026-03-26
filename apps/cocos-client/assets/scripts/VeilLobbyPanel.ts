import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from "cc";
import type { CocosLobbyRoomSummary } from "./cocos-lobby.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";

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

export interface VeilLobbyRenderState {
  playerId: string;
  displayName: string;
  roomId: string;
  authMode: "guest" | "account";
  loginId: string;
  vaultSummary: string;
  sessionSource: "remote" | "local" | "manual" | "none";
  loading: boolean;
  entering: boolean;
  status: string;
  rooms: CocosLobbyRoomSummary[];
}

export interface VeilLobbyPanelOptions {
  onEditPlayerId?: () => void;
  onEditDisplayName?: () => void;
  onEditRoomId?: () => void;
  onEditLoginId?: () => void;
  onRefresh?: () => void;
  onEnterRoom?: () => void;
  onLoginAccount?: () => void;
  onOpenConfigCenter?: () => void;
  onLogout?: () => void;
  onJoinRoom?: (roomId: string) => void;
}

interface PanelCardTone {
  fill: Color;
  stroke: Color;
  accent: Color;
}

@ccclass("ProjectVeilLobbyPanel")
export class VeilLobbyPanel extends Component {
  private onEditPlayerId: (() => void) | undefined;
  private onEditDisplayName: (() => void) | undefined;
  private onEditRoomId: (() => void) | undefined;
  private onEditLoginId: (() => void) | undefined;
  private onRefresh: (() => void) | undefined;
  private onEnterRoom: (() => void) | undefined;
  private onLoginAccount: (() => void) | undefined;
  private onOpenConfigCenter: (() => void) | undefined;
  private onLogout: (() => void) | undefined;
  private onJoinRoom: ((roomId: string) => void) | undefined;

  configure(options: VeilLobbyPanelOptions): void {
    this.onEditPlayerId = options.onEditPlayerId;
    this.onEditDisplayName = options.onEditDisplayName;
    this.onEditRoomId = options.onEditRoomId;
    this.onEditLoginId = options.onEditLoginId;
    this.onRefresh = options.onRefresh;
    this.onEnterRoom = options.onEnterRoom;
    this.onLoginAccount = options.onLoginAccount;
    this.onOpenConfigCenter = options.onOpenConfigCenter;
    this.onLogout = options.onLogout;
    this.onJoinRoom = options.onJoinRoom;
  }

  render(state: VeilLobbyRenderState): void {
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
        state.authMode === "account" ? "当前已处于正式账号模式" : "H5 绑定后的登录 ID 可以在这里直接进入"
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
      state.entering ? "登录中..." : state.authMode === "account" ? "账号进入" : "账号登录并进入",
      {
        fill: ACTION_ACCOUNT,
        stroke: new Color(228, 236, 248, 120),
        accent: new Color(220, 230, 244, 112)
      },
      state.entering ? null : this.onLoginAccount ?? null
    );
    this.renderActionButton(
      "LobbyConfigCenter",
      leftX,
      leftCursorY - 120,
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
      leftCursorY - 154,
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
    if (visibleRooms.length === 0) {
      this.renderCard(
        "LobbyRoomsEmpty",
        rightX,
        rightCursorY,
        rightWidth,
        84,
        ["当前没有活跃房间", "输入新的房间 ID 后点击“进入房间”即可创建一局。", "Lobby API 暂不可达时也可以继续本地进入。"],
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
      return;
    }

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

    const label = buttonNode.getComponent(Label) ?? buttonNode.addComponent(Label);
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
}
