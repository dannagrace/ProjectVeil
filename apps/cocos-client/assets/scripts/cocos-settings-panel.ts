import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from "cc";
import { assignUiLayer } from "./cocos-ui-layer.ts";

const { ccclass } = _decorator;

const H_ALIGN_LEFT = 0;
const H_ALIGN_CENTER = 1;
const V_ALIGN_TOP = 0;
const V_ALIGN_MIDDLE = 1;
const OVERFLOW_RESIZE_HEIGHT = 3;
const SETTINGS_STORAGE_KEY = "veil_settings";
const SETTINGS_PANEL_BG = new Color(18, 25, 38, 244);
const SETTINGS_PANEL_BORDER = new Color(235, 241, 248, 96);
const SETTINGS_ACCENT = new Color(214, 184, 124, 255);
const SETTINGS_CARD_BG = new Color(34, 46, 66, 224);
const SETTINGS_CARD_BORDER = new Color(232, 240, 248, 52);
const SETTINGS_TRACK_BG = new Color(58, 72, 94, 220);
const SETTINGS_TEXT = new Color(244, 247, 252, 255);
const SETTINGS_MUTED_TEXT = new Color(213, 222, 236, 220);
const SETTINGS_DANGER = new Color(144, 78, 70, 236);
const SETTINGS_CONFIRM = new Color(108, 84, 52, 236);
const SETTINGS_BUTTON = new Color(72, 95, 124, 236);

export interface CocosStoredSettings {
  bgmVolume: number;
  sfxVolume: number;
  frameRateCap: 30 | 60;
}

export interface CocosSettingsPanelView extends CocosStoredSettings {
  open: boolean;
  displayName: string;
  loginId: string;
  authMode: "guest" | "account";
  privacyConsentAccepted: boolean;
  statusMessage: string | null;
  deleteAccountPending: boolean;
  withdrawConsentPending: boolean;
  privacyPolicyUrl: string;
}

export interface CocosSettingsPanelUpdate {
  open?: boolean;
  bgmVolume?: number;
  sfxVolume?: number;
  frameRateCap?: 30 | 60 | number;
  displayName?: string;
  loginId?: string;
  authMode?: "guest" | "account";
  privacyConsentAccepted?: boolean;
  statusMessage?: string | null;
  deleteAccountPending?: boolean;
  withdrawConsentPending?: boolean;
  privacyPolicyUrl?: string;
}

interface CocosSettingsLocalStorageLike {
  getItem?(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface CocosSettingsWechatRuntimeLike {
  getStorageSync?(key: string): unknown;
  setStorageSync?(key: string, value: string): void;
  removeStorageSync?(key: string): void;
  openPrivacyContract?(
    options?: {
      success?: () => void;
      fail?: (error?: unknown) => void;
    }
  ): void;
}

export interface CocosSettingsPersistenceRuntime {
  localStorage?: CocosSettingsLocalStorageLike | null;
  wx?: CocosSettingsWechatRuntimeLike | null;
}

export interface CocosSettingsPanelOptions {
  onClose?: () => void;
  onUpdate?: (update: CocosSettingsPanelUpdate) => void;
  onLogout?: () => void;
  onDeleteAccount?: () => void;
  onWithdrawConsent?: () => void;
  onOpenPrivacyPolicy?: () => void;
}

export function createDefaultCocosSettingsView(
  update: Partial<CocosSettingsPanelView> = {}
): CocosSettingsPanelView {
  return applySettingsUpdate(
    {
      open: false,
      bgmVolume: 54,
      sfxVolume: 76,
      frameRateCap: 60,
      displayName: "",
      loginId: "",
      authMode: "guest",
      privacyConsentAccepted: false,
      statusMessage: null,
      deleteAccountPending: false,
      withdrawConsentPending: false,
      privacyPolicyUrl: resolveCocosPrivacyPolicyUrl()
    },
    update
  );
}

export function getCocosSettingsStorageKey(): string {
  return SETTINGS_STORAGE_KEY;
}

export function clampSettingsVolume(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeFrameRateCap(value: unknown, fallback: 30 | 60): 30 | 60 {
  return value === 30 ? 30 : value === 60 ? 60 : fallback;
}

export function applySettingsUpdate(
  state: CocosSettingsPanelView,
  update: CocosSettingsPanelUpdate
): CocosSettingsPanelView {
  return {
    ...state,
    ...update,
    bgmVolume: clampSettingsVolume(update.bgmVolume ?? state.bgmVolume, state.bgmVolume),
    sfxVolume: clampSettingsVolume(update.sfxVolume ?? state.sfxVolume, state.sfxVolume),
    frameRateCap: normalizeFrameRateCap(update.frameRateCap ?? state.frameRateCap, state.frameRateCap)
  };
}

export function serializeCocosSettings(settings: CocosStoredSettings): string {
  return JSON.stringify({
    bgmVolume: clampSettingsVolume(settings.bgmVolume, 54),
    sfxVolume: clampSettingsVolume(settings.sfxVolume, 76),
    frameRateCap: normalizeFrameRateCap(settings.frameRateCap, 60)
  });
}

export function deserializeCocosSettings(raw: unknown): CocosStoredSettings {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  const candidate = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return {
    bgmVolume: clampSettingsVolume(
      typeof candidate.bgmVolume === "number" ? candidate.bgmVolume : Number(candidate.bgmVolume),
      54
    ),
    sfxVolume: clampSettingsVolume(
      typeof candidate.sfxVolume === "number" ? candidate.sfxVolume : Number(candidate.sfxVolume),
      76
    ),
    frameRateCap: normalizeFrameRateCap(candidate.frameRateCap, 60)
  };
}

export function readPersistedCocosSettings(
  runtime: CocosSettingsPersistenceRuntime = globalThis as CocosSettingsPersistenceRuntime
): CocosStoredSettings {
  const wxRuntime = runtime.wx ?? null;
  if (wxRuntime?.getStorageSync) {
    return deserializeCocosSettings(wxRuntime.getStorageSync(SETTINGS_STORAGE_KEY));
  }

  const localStorage = runtime.localStorage ?? null;
  return deserializeCocosSettings(localStorage?.getItem?.(SETTINGS_STORAGE_KEY) ?? null);
}

export function writePersistedCocosSettings(
  settings: CocosStoredSettings,
  runtime: CocosSettingsPersistenceRuntime = globalThis as CocosSettingsPersistenceRuntime
): void {
  const serialized = serializeCocosSettings(settings);
  const wxRuntime = runtime.wx ?? null;
  if (wxRuntime?.setStorageSync) {
    wxRuntime.setStorageSync(SETTINGS_STORAGE_KEY, serialized);
    return;
  }

  runtime.localStorage?.setItem?.(SETTINGS_STORAGE_KEY, serialized);
}

export function resolveCocosPrivacyPolicyUrl(
  locationLike: Pick<Location, "href"> | null | undefined = globalThis.location
): string {
  try {
    return new URL("/config-center.html", locationLike?.href ?? "https://project-veil.invalid/").toString();
  } catch {
    return "/config-center.html";
  }
}

function ensureLabel(
  parent: Node,
  name: string,
  width: number,
  height: number,
  fontSize: number,
  lineHeight: number,
  align: number,
  verticalAlign: number,
  color = SETTINGS_TEXT
): Label {
  let node = parent.getChildByName(name);
  if (!node) {
    node = new Node(name);
    node.parent = parent;
  }
  assignUiLayer(node);
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
  transform.setContentSize(width, height);
  const label = node.getComponent(Label) ?? node.addComponent(Label);
  label.fontSize = fontSize;
  label.lineHeight = lineHeight;
  label.horizontalAlign = align;
  label.verticalAlign = verticalAlign;
  label.overflow = OVERFLOW_RESIZE_HEIGHT;
  label.enableWrapText = true;
  label.color = color;
  return label;
}

function pointInNode(localX: number, localY: number, root: Node, node: Node | null): boolean {
  if (!node || !node.active) {
    return false;
  }

  const transform = node.getComponent(UITransform) ?? null;
  if (!transform) {
    return false;
  }

  let centerX = 0;
  let centerY = 0;
  let current: Node | null = node;
  while (current && current !== root) {
    centerX += current.position.x;
    centerY += current.position.y;
    current = current.parent;
  }

  if (current !== root) {
    return false;
  }

  return (
    localX >= centerX - transform.width / 2
    && localX <= centerX + transform.width / 2
    && localY >= centerY - transform.height / 2
    && localY <= centerY + transform.height / 2
  );
}

function renderCard(parent: Node, name: string, centerY: number, width: number, height: number): Node {
  let cardNode = parent.getChildByName(name);
  if (!cardNode) {
    cardNode = new Node(name);
    cardNode.parent = parent;
  }
  assignUiLayer(cardNode);
  const transform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
  transform.setContentSize(width, height);
  cardNode.setPosition(0, centerY, 0.5);
  const graphics = cardNode.getComponent(Graphics) ?? cardNode.addComponent(Graphics);
  graphics.clear();
  graphics.fillColor = SETTINGS_CARD_BG;
  graphics.strokeColor = SETTINGS_CARD_BORDER;
  graphics.lineWidth = 2;
  graphics.roundRect(-width / 2, -height / 2, width, height, 16);
  graphics.fill();
  graphics.stroke();
  graphics.fillColor = new Color(255, 255, 255, 18);
  graphics.roundRect(-width / 2 + 14, height / 2 - 16, width - 28, 4, 2);
  graphics.fill();
  graphics.fillColor = SETTINGS_ACCENT;
  graphics.roundRect(-width / 2 + 16, height / 2 - 14, Math.min(86, width * 0.28), 2, 1);
  graphics.fill();
  return cardNode;
}

function renderActionButton(
  parent: Node,
  name: string,
  labelText: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  fillColor: Color,
  strokeColor: Color
): void {
  let buttonNode = parent.getChildByName(name);
  if (!buttonNode) {
    buttonNode = new Node(name);
    buttonNode.parent = parent;
  }
  assignUiLayer(buttonNode);
  buttonNode.active = true;

  const transform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
  transform.setContentSize(width, height);
  buttonNode.setPosition(centerX, centerY, 1);
  const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
  graphics.clear();
  graphics.fillColor = fillColor;
  graphics.strokeColor = strokeColor;
  graphics.lineWidth = 2;
  graphics.roundRect(-width / 2, -height / 2, width, height, 10);
  graphics.fill();
  graphics.stroke();
  const label = ensureLabel(buttonNode, "Label", width - 16, height - 8, 12, 14, H_ALIGN_CENTER, V_ALIGN_MIDDLE);
  label.node.setPosition(0, 0, 1);
  label.string = labelText;
}

function renderSlider(parent: Node, name: string, labelText: string, value: number, centerY: number, width: number): void {
  const trackNode = renderCard(parent, name, centerY, width, 72);
  const title = ensureLabel(trackNode, "Title", width - 28, 18, 13, 15, H_ALIGN_LEFT, V_ALIGN_MIDDLE);
  title.node.setPosition(0, 18, 1);
  title.string = `${labelText} ${value}`;

  let trackHitbox = trackNode.getChildByName("Track");
  if (!trackHitbox) {
    trackHitbox = new Node("Track");
    trackHitbox.parent = trackNode;
  }
  assignUiLayer(trackHitbox);
  const trackTransform = trackHitbox.getComponent(UITransform) ?? trackHitbox.addComponent(UITransform);
  trackTransform.setContentSize(width - 40, 18);
  trackHitbox.setPosition(0, -10, 1);
  const graphics = trackHitbox.getComponent(Graphics) ?? trackHitbox.addComponent(Graphics);
  const trackWidth = trackTransform.width;
  graphics.clear();
  graphics.fillColor = SETTINGS_TRACK_BG;
  graphics.roundRect(-trackWidth / 2, -9, trackWidth, 18, 9);
  graphics.fill();
  graphics.fillColor = new Color(255, 255, 255, 18);
  graphics.roundRect(-trackWidth / 2 + 2, -7, trackWidth - 4, 5, 2);
  graphics.fill();
  graphics.fillColor = SETTINGS_ACCENT;
  graphics.roundRect(-trackWidth / 2, -9, Math.max(18, Math.round(trackWidth * (value / 100))), 18, 9);
  graphics.fill();

  let thumbNode = trackHitbox.getChildByName("Thumb");
  if (!thumbNode) {
    thumbNode = new Node("Thumb");
    thumbNode.parent = trackHitbox;
  }
  assignUiLayer(thumbNode);
  const thumbTransform = thumbNode.getComponent(UITransform) ?? thumbNode.addComponent(UITransform);
  thumbTransform.setContentSize(18, 18);
  thumbNode.setPosition(-trackWidth / 2 + trackWidth * (value / 100), 0, 1);
  const thumbGraphics = thumbNode.getComponent(Graphics) ?? thumbNode.addComponent(Graphics);
  thumbGraphics.clear();
  thumbGraphics.fillColor = new Color(250, 246, 236, 255);
  thumbGraphics.circle(0, 0, 7);
  thumbGraphics.fill();
}

@ccclass("CocosSettingsPanel")
export class CocosSettingsPanel extends Component {
  private currentState: CocosSettingsPanelView = createDefaultCocosSettingsView();
  private onClose: (() => void) | undefined;
  private onUpdate: ((update: CocosSettingsPanelUpdate) => void) | undefined;
  private onLogout: (() => void) | undefined;
  private onDeleteAccount: (() => void) | undefined;
  private onWithdrawConsent: (() => void) | undefined;
  private onOpenPrivacyPolicy: (() => void) | undefined;

  configure(options: CocosSettingsPanelOptions): void {
    this.onClose = options.onClose;
    this.onUpdate = options.onUpdate;
    this.onLogout = options.onLogout;
    this.onDeleteAccount = options.onDeleteAccount;
    this.onWithdrawConsent = options.onWithdrawConsent;
    this.onOpenPrivacyPolicy = options.onOpenPrivacyPolicy;
  }

  render(state: CocosSettingsPanelView): void {
    this.currentState = state;
    this.node.active = state.open;
    if (!state.open) {
      return;
    }

    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const width = transform.width || 420;
    const height = transform.height || 520;
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = SETTINGS_PANEL_BG;
    graphics.strokeColor = SETTINGS_PANEL_BORDER;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 22);
    graphics.fill();
    graphics.stroke();

    const title = ensureLabel(this.node, "Title", width - 92, 48, 22, 24, H_ALIGN_LEFT, V_ALIGN_MIDDLE);
    title.node.setPosition(-18, height / 2 - 34, 1);
    title.string = "设置";

    const subtitle = ensureLabel(this.node, "Subtitle", width - 92, 24, 11, 13, H_ALIGN_LEFT, V_ALIGN_MIDDLE, SETTINGS_MUTED_TEXT);
    subtitle.node.setPosition(-18, height / 2 - 58, 1);
    subtitle.string = "音频、显示、账号与隐私";

    renderActionButton(
      this.node,
      "SettingsClose",
      "关闭",
      width / 2 - 46,
      height / 2 - 42,
      74,
      30,
      new Color(74, 90, 112, 236),
      new Color(223, 233, 244, 94)
    );

    renderSlider(this.node, "SettingsBgm", "音频 BGM", state.bgmVolume, 150, width - 36);
    renderSlider(this.node, "SettingsSfx", "音频 SFX", state.sfxVolume, 68, width - 36);

    const displayCard = renderCard(this.node, "SettingsDisplay", -20, width - 36, 84);
    const displayLabel = ensureLabel(displayCard, "DisplayTitle", width - 64, 20, 13, 15, H_ALIGN_LEFT, V_ALIGN_MIDDLE);
    displayLabel.node.setPosition(0, 22, 1);
    displayLabel.string = `显示 帧率上限 ${state.frameRateCap} fps`;
    renderActionButton(
      displayCard,
      "SettingsFps30",
      "30 FPS",
      -70,
      -10,
      110,
      30,
      state.frameRateCap === 30 ? SETTINGS_ACCENT : SETTINGS_BUTTON,
      new Color(245, 228, 182, state.frameRateCap === 30 ? 146 : 72)
    );
    renderActionButton(
      displayCard,
      "SettingsFps60",
      "60 FPS",
      70,
      -10,
      110,
      30,
      state.frameRateCap === 60 ? SETTINGS_ACCENT : SETTINGS_BUTTON,
      new Color(245, 228, 182, state.frameRateCap === 60 ? 146 : 72)
    );

    const accountCard = renderCard(this.node, "SettingsAccount", -126, width - 36, 108);
    const accountLabel = ensureLabel(accountCard, "AccountLabel", width - 64, 44, 13, 16, H_ALIGN_LEFT, V_ALIGN_TOP);
    accountLabel.node.setPosition(0, 18, 1);
    accountLabel.string = `账号 ${state.displayName || "未命名玩家"}\n${state.authMode === "account" ? `登录 ${state.loginId || state.displayName}` : "游客会话"}`;
    renderActionButton(accountCard, "SettingsLogout", "退出登录", -76, -22, 118, 30, SETTINGS_BUTTON, new Color(221, 232, 246, 88));
    renderActionButton(
      accountCard,
      "SettingsDelete",
      state.deleteAccountPending ? "确认删除" : "删除账号",
      76,
      -22,
      118,
      30,
      state.deleteAccountPending ? SETTINGS_CONFIRM : SETTINGS_DANGER,
      new Color(246, 224, 208, 104)
    );

    const privacyCard = renderCard(this.node, "SettingsPrivacy", -244, width - 36, 118);
    const privacyLabel = ensureLabel(privacyCard, "PrivacyLabel", width - 64, 42, 13, 16, H_ALIGN_LEFT, V_ALIGN_TOP);
    privacyLabel.node.setPosition(0, 26, 1);
    privacyLabel.string = `隐私 ${state.privacyConsentAccepted ? "已记录同意" : "未记录同意"}\n可重新查看说明或撤回本地同意状态`;
    renderActionButton(privacyCard, "SettingsPrivacyLink", "隐私说明", -76, -20, 118, 30, SETTINGS_BUTTON, new Color(221, 232, 246, 88));
    renderActionButton(
      privacyCard,
      "SettingsWithdraw",
      state.withdrawConsentPending ? "确认撤回" : "撤回同意",
      76,
      -20,
      118,
      30,
      state.withdrawConsentPending ? SETTINGS_CONFIRM : SETTINGS_DANGER,
      new Color(246, 224, 208, 104)
    );

    const status = ensureLabel(this.node, "Status", width - 44, 44, 11, 14, H_ALIGN_LEFT, V_ALIGN_TOP, SETTINGS_MUTED_TEXT);
    status.node.setPosition(0, -height / 2 + 34, 1);
    status.string =
      state.statusMessage
      ?? `存储键 ${SETTINGS_STORAGE_KEY} · 隐私说明 ${state.privacyPolicyUrl}`;
  }

  dispatchPointerUp(localX: number, localY: number): string | null {
    if (!this.currentState.open) {
      return null;
    }

    const closeButton = this.node.getChildByName("SettingsClose");
    if (pointInNode(localX, localY, this.node, closeButton)) {
      this.onClose?.();
      return "settings-close";
    }

    const bgmTrack = this.node.getChildByName("SettingsBgm")?.getChildByName("Track") ?? null;
    if (pointInNode(localX, localY, this.node, bgmTrack)) {
      const transform = bgmTrack?.getComponent(UITransform) ?? null;
      if (transform) {
        const relative = Math.min(1, Math.max(0, (localX - (bgmTrack?.position.x ?? 0) + transform.width / 2) / transform.width));
        this.onUpdate?.({
          bgmVolume: Math.round(relative * 100),
          statusMessage: null
        });
        return "settings-bgm";
      }
    }

    const sfxTrack = this.node.getChildByName("SettingsSfx")?.getChildByName("Track") ?? null;
    if (pointInNode(localX, localY, this.node, sfxTrack)) {
      const transform = sfxTrack?.getComponent(UITransform) ?? null;
      if (transform) {
        const relative = Math.min(1, Math.max(0, (localX - (sfxTrack?.position.x ?? 0) + transform.width / 2) / transform.width));
        this.onUpdate?.({
          sfxVolume: Math.round(relative * 100),
          statusMessage: null
        });
        return "settings-sfx";
      }
    }

    const clickableActions: Array<{ name: string; result: string; callback: (() => void) | undefined }> = [
      { name: "SettingsFps30", result: "settings-fps-30", callback: () => this.onUpdate?.({ frameRateCap: 30, statusMessage: null }) },
      { name: "SettingsFps60", result: "settings-fps-60", callback: () => this.onUpdate?.({ frameRateCap: 60, statusMessage: null }) },
      { name: "SettingsLogout", result: "settings-logout", callback: this.onLogout },
      { name: "SettingsDelete", result: "settings-delete", callback: this.onDeleteAccount },
      { name: "SettingsPrivacyLink", result: "settings-privacy-link", callback: this.onOpenPrivacyPolicy },
      { name: "SettingsWithdraw", result: "settings-withdraw", callback: this.onWithdrawConsent }
    ];

    for (const action of clickableActions) {
      let node: Node | null = this.node.getChildByName(action.name);
      if (!node) {
        for (const child of this.node.children ?? []) {
          node = child.getChildByName(action.name);
          if (node) {
            break;
          }
        }
      }
      if (pointInNode(localX, localY, this.node, node)) {
        action.callback?.();
        return action.result;
      }
    }

    return null;
  }
}
