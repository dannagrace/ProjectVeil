import { _decorator, Color, Component, Graphics, Label, Node, Sprite, UIOpacity, UITransform } from "cc";
import {
  createHeroAttributeBreakdown,
  createHeroProgressMeterView,
  type EquipmentType,
  getLatestUnlockedAchievement
} from "./project-shared/index.ts";
import type { SessionUpdate } from "./VeilCocosSession.ts";
import type { CocosPlayerAccountProfile } from "./cocos-lobby.ts";
import { getPixelSpriteAssets, loadPixelSpriteAssets, type PixelSpriteLoadStatus } from "./cocos-pixel-sprites.ts";
import {
  getPlaceholderSpriteAssets,
  loadPlaceholderSpriteAssets,
  releasePlaceholderSpriteAssets,
  retainPlaceholderSpriteAssets
} from "./cocos-placeholder-sprites.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import {
  buildHeroEquipmentActionRows,
  formatEquipmentOverviewLines,
  formatInventorySummaryLines,
  formatRecentLootLines
} from "./cocos-hero-equipment.ts";
import { summarizeLatestBattleReplay } from "./cocos-battle-report.ts";
import type { CocosAudioRuntimeState } from "./cocos-audio-runtime.ts";
import {
  formatPresentationReadinessSummary,
  type CocosPresentationReadiness
} from "./cocos-presentation-readiness.ts";
import {
  buildCocosHudSkillPanelView,
  toHudHeroSkillState,
  type CocosHudSkillPanelAction
} from "./cocos-hud-skill-panel.ts";

const { ccclass } = _decorator;
const H_ALIGN_LEFT = 0;
const H_ALIGN_CENTER = 1;
const V_ALIGN_TOP = 0;
const V_ALIGN_MIDDLE = 1;
const OVERFLOW_RESIZE_HEIGHT = 3;
const HUD_BG = new Color(17, 24, 36, 198);
const HUD_INNER = new Color(39, 53, 74, 88);
const HUD_BORDER = new Color(238, 244, 252, 78);
const HUD_ACCENT = new Color(214, 184, 124, 255);
const HUD_ACCENT_SOFT = new Color(244, 225, 179, 96);
const HUD_CARD_RESOURCE = new Color(84, 118, 160, 176);
const HUD_CARD_HERO = new Color(132, 112, 176, 172);
const HUD_CARD_STATUS = new Color(204, 170, 106, 182);
const TITLE_NODE_NAME = "HudTitle";
const RESOURCE_NODE_NAME = "HudResources";
const HERO_NODE_NAME = "HudHero";
const EQUIPMENT_NODE_NAME = "HudEquipment";
const SKILLS_NODE_NAME = "HudSkills";
const STATUS_NODE_NAME = "HudStatus";
const DEBUG_NODE_NAME = "HudDebug";
const HEADER_ICON_NODE_NAME = "HudHeaderIcon";
const WATERMARK_NODE_NAME = "HudWatermark";
const ACTIONS_NODE_NAME = "HudActions";
const CARD_PREFIX = "HudCard";
const CHIP_PREFIX = "HudChip";
const BADGE_PREFIX = "HudBadge";
const HERO_METER_PREFIX = "HudHeroMeter";
const HERO_PROGRESS_PREFIX = "HudHeroProgress";
const SKILL_BUTTON_PREFIX = "HudSkillButton";
const EQUIPMENT_BUTTON_PREFIX = "HudEquipButton";
const ACHIEVEMENT_NOTICE_NODE_NAME = "HudAchievementNotice";

interface HudActionButtonState {
  name: string;
  label: string;
  callback: (() => void) | null;
}

interface HudEquipmentButtonState {
  name: string;
  label: string;
  tone: "equip" | "unequip";
  callback: (() => void) | null;
}

function formatHeroLearnedSkills(hero: NonNullable<VeilHudRenderState["update"]>["world"]["ownHeroes"][number] | null): string {
  const learnedSkills = hero?.learnedSkills ?? [];
  if (!hero || learnedSkills.length === 0) {
    return "未学习长期技能";
  }

  return learnedSkills.map((skill) => `${skill.skillId} R${skill.rank}`).join(" / ");
}

function formatHeroEquipmentLines(
  hero: NonNullable<VeilHudRenderState["update"]>["world"]["ownHeroes"][number] | null,
  recentEventLog: VeilHudRenderState["account"]["recentEventLog"]
): string[] {
  if (!hero) {
    return ["装备 等待房间状态...", ""];
  }

  const equipmentLines = formatEquipmentOverviewLines(hero);
  const inventoryLines = formatInventorySummaryLines(hero);
  const lootLines = formatRecentLootLines(recentEventLog, hero.id);

  return [
    ...equipmentLines,
    ...inventoryLines,
    ...lootLines
  ];
}

export interface VeilHudRenderState {
  roomId: string;
  playerId: string;
  displayName: string;
  account: CocosPlayerAccountProfile;
  authMode: "guest" | "account";
  loginId: string;
  sessionSource: "remote" | "local" | "manual" | "none";
  remoteUrl: string;
  update: SessionUpdate | null;
  moveInFlight: boolean;
  predictionStatus: string;
  inputDebug: string;
  runtimeHealth: string;
  levelUpNotice: {
    title: string;
    detail: string;
  } | null;
  achievementNotice: {
    title: string;
    detail: string;
  } | null;
  presentation: {
    audio: CocosAudioRuntimeState;
    pixelAssets: PixelSpriteLoadStatus;
    readiness: CocosPresentationReadiness;
  };
}

export interface VeilHudPanelOptions {
  onNewRun?: () => void;
  onRefresh?: () => void;
  onLearnSkill?: (skillId: string) => void;
  onEquipItem?: (slot: EquipmentType, equipmentId: string) => void;
  onUnequipItem?: (slot: EquipmentType) => void;
  onEndDay?: () => void;
  onReturnLobby?: () => void;
}

function formatAchievementSummary(account: CocosPlayerAccountProfile): string {
  const unlocked = account.achievements.filter((achievement) => achievement.unlocked).length;
  const latestUnlocked = getLatestUnlockedAchievement(account.achievements);
  return latestUnlocked
    ? `成就 ${unlocked}/${account.achievements.length} · 最新 ${latestUnlocked.title}`
    : `成就 ${unlocked}/${account.achievements.length} · 尚未解锁`;
}

function formatRecentEventLog(account: CocosPlayerAccountProfile): string {
  const latest = account.recentEventLog[0];
  return latest ? `日志 ${latest.description}` : "日志 尚未记录关键事件";
}

function formatAudioCueLabel(cue: CocosAudioRuntimeState["lastCue"]): string {
  switch (cue) {
    case "attack":
      return "普攻";
    case "skill":
      return "技能";
    case "hit":
      return "受击";
    case "level_up":
      return "升级";
    default:
      return "无";
  }
}

function formatAudioSceneLabel(scene: CocosAudioRuntimeState["currentScene"]): string {
  return scene === "battle" ? "战斗" : scene === "explore" ? "探索" : "静音";
}

function formatAudioPlaybackModeLabel(mode: CocosAudioRuntimeState["musicMode"]): string {
  switch (mode) {
    case "asset":
      return "资源";
    case "synth":
      return "合成";
    case "pending":
      return "待载";
    default:
      return "空闲";
  }
}

function formatPresentationAudioSummary(audio: CocosAudioRuntimeState): string {
  const supportLabel = audio.supported
    ? audio.unlocked
      ? audio.assetBacked
        ? "已解锁资源音频"
        : "已解锁音频运行时"
      : "待首次点击启音"
    : "回退静音/无 AudioContext";
  const cueSuffix = audio.lastCue ? ` · 最近 ${formatAudioCueLabel(audio.lastCue)} ${audio.cueCount}` : "";
  return `音频 ${supportLabel} · 场景 ${formatAudioSceneLabel(audio.currentScene)} · BGM ${formatAudioPlaybackModeLabel(audio.musicMode)}${cueSuffix}`;
}

function formatPresentationLoadSummary(pixelAssets: PixelSpriteLoadStatus): string {
  const groupLabel = pixelAssets.pendingGroups.length > 0
    ? `等待 ${pixelAssets.pendingGroups.join("/")}`
    : pixelAssets.loadedGroups.length > 0
      ? `已就绪 ${pixelAssets.loadedGroups.join("/")}`
      : "待触发";
  const durationLabel = pixelAssets.loadDurationMs !== null
    ? `${pixelAssets.loadDurationMs}ms`
    : pixelAssets.phase === "loading"
      ? "加载中"
      : "待触发";
  const budgetLabel = pixelAssets.exceededHardLimit
    ? "超出硬上限"
    : pixelAssets.exceededTarget
      ? "超出目标"
      : pixelAssets.phase === "ready"
        ? "命中预算"
        : "待采样";
  return `像素资源 ${durationLabel} · ${groupLabel} · ${pixelAssets.loadedResourceCount}/${pixelAssets.totalResourceCount} · 预算 ${pixelAssets.targetMs}/${pixelAssets.hardLimitMs}ms · ${budgetLabel}`;
}

@ccclass("ProjectVeilHudPanel")
export class VeilHudPanel extends Component {
  private titleLabel: Label | null = null;
  private resourceLabel: Label | null = null;
  private heroLabel: Label | null = null;
  private equipmentLabel: Label | null = null;
  private skillLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private debugLabel: Label | null = null;
  private headerIconSprite: Sprite | null = null;
  private headerIconOpacity: UIOpacity | null = null;
  private currentState: VeilHudRenderState | null = null;
  private requestedIcons = false;
  private onNewRun: (() => void) | undefined;
  private onRefresh: (() => void) | undefined;
  private onLearnSkill: ((skillId: string) => void) | undefined;
  private onEquipItem: ((slot: EquipmentType, equipmentId: string) => void) | undefined;
  private onUnequipItem: ((slot: EquipmentType) => void) | undefined;
  private onEndDay: (() => void) | undefined;
  private onReturnLobby: (() => void) | undefined;
  private placeholderAssetsRetained = false;

  configure(options: VeilHudPanelOptions): void {
    this.onNewRun = options.onNewRun;
    this.onRefresh = options.onRefresh;
    this.onLearnSkill = options.onLearnSkill;
    this.onEquipItem = options.onEquipItem;
    this.onUnequipItem = options.onUnequipItem;
    this.onEndDay = options.onEndDay;
    this.onReturnLobby = options.onReturnLobby;
    this.retainPlaceholderAssets();
    this.ensureActionButtons();
    this.syncActionButtons();
  }

  onDestroy(): void {
    if (this.placeholderAssetsRetained) {
      releasePlaceholderSpriteAssets("hud");
      this.placeholderAssetsRetained = false;
    }
  }

  render(state: VeilHudRenderState): void {
    this.currentState = state;
    this.cleanupLegacyNodes();
    this.syncChrome();
    this.syncHeaderIcon();
    this.syncActionButtons();
    this.ensureSectionLabels();
    const hero = state.update?.world.ownHeroes[0] ?? null;
    const world = state.update?.world;
    const resources = world?.resources;
    const battle = state.update?.battle;
    const skillPanelView = buildCocosHudSkillPanelView(state.update, this.onLearnSkill);
    const progressMeter = hero ? createHeroProgressMeterView({ progression: { ...hero.progression } }) : null;
    const attributeRows = hero ? createHeroAttributeBreakdown(toHudHeroSkillState(hero), world ?? undefined) : [];
    const equipmentLines = formatHeroEquipmentLines(hero, state.account.recentEventLog);
    const equipmentRows = buildHeroEquipmentActionRows(hero);
    const equipmentButtons = this.buildEquipmentButtonStates(equipmentRows);
    const equipmentLineCount = (hero ? 1 + equipmentLines.length : 3);
    const equipmentCardHeight = Math.max(
      156,
      50 + equipmentLineCount * 16 + (equipmentButtons.length > 0 ? Math.ceil(equipmentButtons.length / 2) * 24 : 0)
    );
    const latestBattleReport = summarizeLatestBattleReplay(state.account.recentBattleReplays);
    const reachableAhead =
      state.update?.reachableTiles.filter((tile) => !hero || tile.x !== hero.position.x || tile.y !== hero.position.y).length ?? 0;
    const statusTitle = state.levelUpNotice?.title ?? "状态";
    const statusBadge = state.levelUpNotice
      ? "升级!"
      : battle
      ? "战斗中"
      : hero && hero.move.remaining <= 0
        ? "体力耗尽"
        : "待命";
    const statusDetail = state.levelUpNotice?.detail
      || state.predictionStatus
      || (state.moveInFlight
        ? "正在结算移动..."
        : hero && hero.move.remaining <= 0
          ? "今天已经没有移动点了。"
          : "点击地块移动，点击脚下资源即可采集。");
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const cardWidth = Math.max(168, transform.width - 28);
    const leftX = -transform.width / 2 + 14 + cardWidth / 2;
    let cursorY = transform.height / 2 - 134;

    cursorY = this.renderCardBlock(
      this.titleLabel,
      `${CARD_PREFIX}-title`,
      [
        state.displayName ? `${state.displayName} · ${state.playerId}` : `玩家 ${state.playerId}`,
        `房间 ${state.roomId}`,
        world
          ? `第 ${world.meta.day} 天 · 可达 ${reachableAhead}${state.sessionSource === "remote" ? state.authMode === "account" ? ` · 账号 ${state.loginId || state.playerId}` : " · 云端游客" : state.sessionSource === "local" ? " · 本地会话" : ""}`
          : `等待房间状态...${state.sessionSource === "remote" ? state.authMode === "account" ? ` · 账号 ${state.loginId || state.playerId}` : " · 云端游客" : state.sessionSource === "local" ? " · 本地会话" : ""}`
      ],
      cursorY,
      16,
      20,
      cardWidth,
      leftX,
      4,
      76
    );

    cursorY = this.renderCardBlock(
      this.resourceLabel,
      `${CARD_PREFIX}-resources`,
      ["资源", "", "", ""],
      cursorY,
      14,
      18,
      cardWidth,
      leftX,
      4,
      88
    );

    cursorY = this.renderCardBlock(
      this.heroLabel,
      `${CARD_PREFIX}-hero`,
      hero
        ? [
            `英雄  ${hero.name}`,
            `坐标 (${hero.position.x},${hero.position.y})`,
            `等级 ${hero.progression.level}  经验 ${progressMeter?.currentLevelExperience ?? 0}/${progressMeter?.nextLevelExperience ?? 100}  技能点 ${hero.progression.skillPoints ?? 0}`,
            `攻 ${hero.stats.attack}  防 ${hero.stats.defense}  力 ${hero.stats.power}  知 ${hero.stats.knowledge}`,
            attributeRows[0] ? `攻防公式 ${attributeRows[0].formula} / ${attributeRows[1]?.formula ?? ""}` : "",
            attributeRows[2] ? `法术公式 ${attributeRows[2].formula} / ${attributeRows[3]?.formula ?? ""}` : "",
            attributeRows[4] ? attributeRows[4].formula : "",
            `兵种 ${hero.armyTemplateId}`,
            `技能 ${formatHeroLearnedSkills(hero)}`
          ]
        : ["英雄", "等待房间状态...", "", "", "", "", "", ""],
      cursorY,
      14,
      18,
      cardWidth,
      leftX,
      10,
      194
    );

    cursorY = this.renderCardBlock(
      this.equipmentLabel,
      `${CARD_PREFIX}-equipment`,
      hero
        ? ["装备配置", ...equipmentLines]
        : ["装备配置", "等待房间状态...", ""],
      cursorY,
      12,
      16,
      cardWidth,
      leftX,
      6,
      equipmentCardHeight
    );

    cursorY = this.renderCardBlock(
      this.skillLabel,
      `${CARD_PREFIX}-skills`,
      skillPanelView.lines,
      cursorY,
      12,
      16,
      cardWidth,
      leftX,
      6,
      skillPanelView.actions.length > 0 ? Math.max(96, 52 + skillPanelView.actions.length * 30) : 76
    );

    cursorY = this.renderCardBlock(
      this.statusLabel,
      `${CARD_PREFIX}-status`,
      [
        statusTitle,
        statusDetail,
        state.runtimeHealth,
        formatAchievementSummary(state.account),
        formatRecentEventLog(state.account),
        latestBattleReport.title,
        latestBattleReport.detail,
        formatPresentationAudioSummary(state.presentation.audio),
        formatPresentationLoadSummary(state.presentation.pixelAssets),
        `表现 ${formatPresentationReadinessSummary(state.presentation.readiness)}`
      ],
      cursorY,
      12,
      16,
      cardWidth,
      leftX,
      4,
      174
    );

    if (resources) {
      this.renderResourceChips(`${CARD_PREFIX}-resources`, resources.gold, resources.wood, resources.ore);
    } else {
      this.hideCardDecorations(`${CARD_PREFIX}-resources`, CHIP_PREFIX);
    }

    if (hero) {
      this.renderHeroBadge(`${CARD_PREFIX}-hero`, `Lv ${hero.progression.level}`, hero.armyTemplateId);
      if (progressMeter) {
      this.renderHeroProgressBar(
        `${CARD_PREFIX}-hero`,
        progressMeter.progressRatio,
          `XP ${progressMeter.currentLevelExperience}/${progressMeter.nextLevelExperience}`,
          Boolean(state.levelUpNotice)
        );
      }
      this.renderHeroMeters(`${CARD_PREFIX}-hero`, hero.move.remaining, hero.move.total, hero.stats.hp, hero.stats.maxHp, hero.armyCount);
      this.tightenHeroLabelLayout(leftX, cardWidth);
      this.renderEquipmentActionButtons(`${CARD_PREFIX}-equipment`, equipmentButtons);
      this.renderLearnableSkillButtons(`${CARD_PREFIX}-skills`, skillPanelView.actions);
    } else {
      this.hideCardDecorations(`${CARD_PREFIX}-hero`, BADGE_PREFIX);
      this.hideCardDecorations(`${CARD_PREFIX}-hero`, HERO_PROGRESS_PREFIX);
      this.hideCardDecorations(`${CARD_PREFIX}-hero`, `${CHIP_PREFIX}-${HERO_METER_PREFIX}`);
      this.hideCardDecorations(`${CARD_PREFIX}-equipment`, EQUIPMENT_BUTTON_PREFIX);
      this.hideCardDecorations(`${CARD_PREFIX}-skills`, SKILL_BUTTON_PREFIX);
    }

    if (hero && skillPanelView.actions.length === 0) {
      this.hideCardDecorations(`${CARD_PREFIX}-skills`, SKILL_BUTTON_PREFIX);
    }

    this.renderStatusBadge(`${CARD_PREFIX}-status`, statusBadge);
    this.renderAchievementNotice(state.achievementNotice);

    const showDebug = false;
    if (showDebug) {
      this.renderCardBlock(
        this.debugLabel,
        `${CARD_PREFIX}-debug`,
        [state.inputDebug],
        -transform.height / 2 + 96,
        14,
        18,
        cardWidth,
        leftX,
        0
      );
    }
    if (this.debugLabel) {
      this.debugLabel.node.active = showDebug;
    }
    const debugCard = this.node.getChildByName(`${CARD_PREFIX}-debug`);
    if (debugCard) {
      debugCard.active = showDebug;
    }
  }

  private syncChrome(): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    const width = transform.width || 320;
    const height = transform.height || 480;
    graphics.clear();
    graphics.fillColor = HUD_BG;
    graphics.strokeColor = HUD_BORDER;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 22);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = HUD_INNER;
    graphics.roundRect(-width / 2 + 12, height / 2 - 26, width - 24, 12, 8);
    graphics.fill();
    graphics.fillColor = HUD_ACCENT;
    graphics.roundRect(-width / 2 + 18, height / 2 - 24, Math.min(104, width * 0.34), 8, 6);
    graphics.fill();
    graphics.fillColor = HUD_ACCENT_SOFT;
    graphics.roundRect(-width / 2 + 18, height / 2 - 46, Math.min(72, width * 0.22), 6, 4);
    graphics.fill();
  }

  private ensureSectionLabels(): void {
    this.titleLabel = this.ensureLabelNode(TITLE_NODE_NAME, 22, 28, 64);
    this.resourceLabel = this.ensureLabelNode(RESOURCE_NODE_NAME, 18, 24, 72);
    this.heroLabel = this.ensureLabelNode(HERO_NODE_NAME, 18, 24, 110);
    this.equipmentLabel = this.ensureLabelNode(EQUIPMENT_NODE_NAME, 14, 18, 84);
    this.skillLabel = this.ensureLabelNode(SKILLS_NODE_NAME, 16, 22, 92);
    this.statusLabel = this.ensureLabelNode(STATUS_NODE_NAME, 17, 22, 70);
    this.debugLabel = this.ensureLabelNode(DEBUG_NODE_NAME, 14, 18, 50);
  }

  private ensureLabelNode(name: string, fontSize: number, lineHeight: number, height: number): Label {
    const existingNode = this.node.getChildByName(name);
    const node = existingNode ?? new Node(name);
    if (!existingNode) {
      node.parent = this.node;
    }
    assignUiLayer(node);

    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(200, height);
    const label = node.getComponent(Label) ?? node.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = lineHeight;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_TOP;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.string = "";
    return label;
  }

  private renderCardBlock(
    label: Label | null,
    cardName: string,
    lines: string[],
    topY: number,
    fontSize: number,
    lineHeight: number,
    width: number,
    centerX: number,
    bottomGap: number,
    minHeight = 0
  ): number {
    if (!label) {
      return topY;
    }

    const height = Math.max(lineHeight, lines.length * lineHeight, minHeight);
    const labelTransform = label.node.getComponent(UITransform) ?? label.node.addComponent(UITransform);
    labelTransform.setContentSize(width - 28, height);
    label.fontSize = fontSize;
    label.lineHeight = lineHeight;
    label.string = lines.join("\n");
    label.node.setPosition(centerX, topY - height / 2, 1);

    this.renderSectionCard(cardName, centerX, label.node.position.y, width, height + 16);
    return topY - height - 16 - bottomGap;
  }

  private renderSectionCard(name: string, centerX: number, centerY: number, width: number, height: number): void {
    const nodeName = name;
    let cardNode = this.node.getChildByName(nodeName);
    if (!cardNode) {
      cardNode = new Node(nodeName);
      cardNode.parent = this.node;
    }
    assignUiLayer(cardNode);
    const transform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    cardNode.setPosition(centerX, centerY, 0.2);
    const graphics = cardNode.getComponent(Graphics) ?? cardNode.addComponent(Graphics);
    graphics.clear();
    const cardRole = name.replace(`${CARD_PREFIX}-`, "");
    const fillColor =
      cardRole === "title"
        ? new Color(43, 57, 80, 156)
        : cardRole === "resources"
          ? new Color(39, 56, 74, 150)
          : cardRole === "hero"
            ? new Color(43, 51, 72, 152)
            : cardRole === "status"
            ? new Color(52, 58, 77, 156)
              : new Color(33, 46, 66, 138);
    const strokeColor =
      cardRole === "status"
        ? new Color(233, 206, 144, 70)
        : new Color(226, 236, 248, 46);
    const accentColor =
      cardRole === "resources"
        ? HUD_CARD_RESOURCE
        : cardRole === "hero"
          ? HUD_CARD_HERO
          : cardRole === "status"
            ? HUD_CARD_STATUS
            : new Color(HUD_ACCENT.r, HUD_ACCENT.g, HUD_ACCENT.b, 178);
    graphics.fillColor = fillColor;
    graphics.strokeColor = strokeColor;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 16);
    graphics.roundRect(-width / 2 + 12, height / 2 - 18, width - 24, 7, 4);
    graphics.fill();
    graphics.fillColor = accentColor;
    graphics.roundRect(-width / 2 + 14, height / 2 - 16, Math.min(88, width * 0.34), 4, 3);
    graphics.fill();
  }

  private renderAchievementNotice(notice: VeilHudRenderState["achievementNotice"]): void {
    let noticeNode = this.node.getChildByName(ACHIEVEMENT_NOTICE_NODE_NAME);
    if (!notice) {
      if (noticeNode) {
        noticeNode.active = false;
      }
      return;
    }

    if (!noticeNode) {
      noticeNode = new Node(ACHIEVEMENT_NOTICE_NODE_NAME);
      noticeNode.parent = this.node;
    }
    assignUiLayer(noticeNode);
    noticeNode.active = true;

    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const noticeTransform = noticeNode.getComponent(UITransform) ?? noticeNode.addComponent(UITransform);
    const width = Math.max(144, transform.width - 44);
    const height = 52;
    noticeTransform.setContentSize(width, height);
    noticeNode.setPosition(0, transform.height / 2 - 54, 4);

    const graphics = noticeNode.getComponent(Graphics) ?? noticeNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(92, 76, 36, 226);
    graphics.strokeColor = new Color(247, 226, 174, 136);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 14);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 248, 214, 58);
    graphics.roundRect(-width / 2 + 12, height / 2 - 14, width - 24, 4, 2);
    graphics.fill();

    let labelNode = noticeNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = noticeNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 24, height - 12);
    labelNode.setPosition(0, 0, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = `${notice.title}\n${notice.detail}`;
    label.fontSize = 13;
    label.lineHeight = 16;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.color = new Color(255, 247, 228, 255);
  }

  private renderResourceChips(cardName: string, gold: number, wood: number, ore: number): void {
    const cardNode = this.node.getChildByName(cardName);
    if (!cardNode) {
      return;
    }

    const frameSet = getPixelSpriteAssets()?.icons;
    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    const gap = 6;
    const chipWidth = Math.max(46, Math.floor((cardTransform.width - 22 - gap * 2) / 3));
    const chipHeight = 30;
    const totalWidth = chipWidth * 3 + gap * 2;
    const startX = -totalWidth / 2 + chipWidth / 2;
    const y = -10;

    this.renderMetricChip(cardNode, "gold", startX, y, chipWidth, chipHeight, frameSet?.gold ?? null, "金币", `${gold}`, new Color(183, 142, 72, 236));
    this.renderMetricChip(cardNode, "wood", startX + chipWidth + gap, y, chipWidth, chipHeight, frameSet?.wood ?? null, "木材", `${wood}`, new Color(90, 128, 92, 236));
    this.renderMetricChip(cardNode, "ore", startX + (chipWidth + gap) * 2, y, chipWidth, chipHeight, frameSet?.ore ?? null, "矿石", `${ore}`, new Color(96, 118, 144, 236));
  }

  private renderMetricChip(
    parent: Node,
    key: string,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    frame: Sprite | null | unknown,
    titleText: string,
    valueText: string,
    accent: Color
  ): void {
    const chipName = `${CHIP_PREFIX}-${key}`;
    let chipNode = parent.getChildByName(chipName);
    if (!chipNode) {
      chipNode = new Node(chipName);
      chipNode.parent = parent;
    }
    assignUiLayer(chipNode);
    chipNode.active = true;

    const transform = chipNode.getComponent(UITransform) ?? chipNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    chipNode.setPosition(centerX, centerY, 0.5);
    const graphics = chipNode.getComponent(Graphics) ?? chipNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, 68);
    graphics.strokeColor = new Color(accent.r, accent.g, accent.b, 164);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 10);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 18);
    graphics.roundRect(-width / 2 + 8, height / 2 - 13, width - 16, 6, 4);
    graphics.fill();
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, 160);
    graphics.roundRect(-width / 2 + 10, height / 2 - 11, Math.min(34, width * 0.42), 3, 2);
    graphics.fill();

    let iconNode = chipNode.getChildByName("Icon");
    if (!iconNode) {
      iconNode = new Node("Icon");
      iconNode.parent = chipNode;
    }
    assignUiLayer(iconNode);
    const iconTransform = iconNode.getComponent(UITransform) ?? iconNode.addComponent(UITransform);
    iconTransform.setContentSize(14, 14);
    iconNode.setPosition(-width / 2 + 14, 5, 1);
    const iconSprite = iconNode.getComponent(Sprite) ?? iconNode.addComponent(Sprite);
    iconNode.active = Boolean(frame);
    if (frame) {
      iconSprite.spriteFrame = frame as never;
    }

    let titleNode = chipNode.getChildByName("Title");
    if (!titleNode) {
      titleNode = new Node("Title");
      titleNode.parent = chipNode;
    }
    assignUiLayer(titleNode);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(width - 18, 10);
    titleNode.setPosition(frame ? 7 : 0, 7, 1);
    const title = titleNode.getComponent(Label) ?? titleNode.addComponent(Label);
    title.string = titleText;
    title.fontSize = 8;
    title.lineHeight = 10;
    title.horizontalAlign = H_ALIGN_CENTER;
    title.verticalAlign = V_ALIGN_MIDDLE;
    title.enableWrapText = false;
    title.color = new Color(229, 236, 244, 220);

    let valueNode = chipNode.getChildByName("Value");
    if (!valueNode) {
      valueNode = new Node("Value");
      valueNode.parent = chipNode;
    }
    assignUiLayer(valueNode);
    const valueTransform = valueNode.getComponent(UITransform) ?? valueNode.addComponent(UITransform);
    valueTransform.setContentSize(width - 14, 15);
    valueNode.setPosition(frame ? 7 : 0, -7, 1);
    const value = valueNode.getComponent(Label) ?? valueNode.addComponent(Label);
    value.string = valueText;
    value.fontSize = 11;
    value.lineHeight = 12;
    value.horizontalAlign = H_ALIGN_CENTER;
    value.verticalAlign = V_ALIGN_MIDDLE;
    value.enableWrapText = false;
    value.color = new Color(244, 247, 251, 255);
  }

  private renderHeroBadge(cardName: string, badgeText: string, heroTemplateId: string): void {
    const cardNode = this.node.getChildByName(cardName);
    if (!cardNode) {
      return;
    }

    const frame = getPixelSpriteAssets()?.heroes[heroTemplateId] ?? getPixelSpriteAssets()?.icons.hero ?? null;
    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    let badgeNode = cardNode.getChildByName(`${BADGE_PREFIX}-hero`);
    if (!badgeNode) {
      badgeNode = new Node(`${BADGE_PREFIX}-hero`);
      badgeNode.parent = cardNode;
    }
    assignUiLayer(badgeNode);
    badgeNode.active = true;
    const badgeTransform = badgeNode.getComponent(UITransform) ?? badgeNode.addComponent(UITransform);
    badgeTransform.setContentSize(24, 24);
    badgeNode.setPosition(cardTransform.width / 2 - 24, 16, 1);
    const graphics = badgeNode.getComponent(Graphics) ?? badgeNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(40, 51, 73, 232);
    graphics.strokeColor = new Color(225, 205, 146, 120);
    graphics.lineWidth = 2;
    graphics.roundRect(-12, -12, 24, 24, 8);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 18);
    graphics.roundRect(-8, 4, 16, 3, 2);
    graphics.fill();

    let iconNode = badgeNode.getChildByName("Icon");
    if (!iconNode) {
      iconNode = new Node("Icon");
      iconNode.parent = badgeNode;
    }
    assignUiLayer(iconNode);
    const iconTransform = iconNode.getComponent(UITransform) ?? iconNode.addComponent(UITransform);
    iconTransform.setContentSize(10, 10);
    iconNode.setPosition(0, 3, 1);
    const iconSprite = iconNode.getComponent(Sprite) ?? iconNode.addComponent(Sprite);
    iconNode.active = Boolean(frame);
    if (frame) {
      iconSprite.spriteFrame = frame;
    }

    let labelNode = badgeNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = badgeNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(22, 8);
    labelNode.setPosition(0, -6, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = badgeText;
    label.fontSize = 6;
    label.lineHeight = 7;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = new Color(238, 244, 251, 255);
  }

  private renderStatusBadge(cardName: string, badgeText: string): void {
    const cardNode = this.node.getChildByName(cardName);
    if (!cardNode) {
      return;
    }

    let badgeNode = cardNode.getChildByName(`${BADGE_PREFIX}-status`);
    if (!badgeNode) {
      badgeNode = new Node(`${BADGE_PREFIX}-status`);
      badgeNode.parent = cardNode;
    }
    assignUiLayer(badgeNode);
    badgeNode.active = true;
    const badgeTransform = badgeNode.getComponent(UITransform) ?? badgeNode.addComponent(UITransform);
    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    badgeTransform.setContentSize(56, 17);
    badgeNode.setPosition(cardTransform.width / 2 - 36, 12, 1);
    const graphics = badgeNode.getComponent(Graphics) ?? badgeNode.addComponent(Graphics);
    const exhausted = badgeText.includes("耗尽");
    const inBattle = badgeText.includes("战斗");
    const accent = inBattle ? new Color(196, 110, 82, 230) : exhausted ? new Color(177, 138, 80, 230) : new Color(84, 130, 101, 230);
    graphics.clear();
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, 40);
    graphics.strokeColor = new Color(accent.r, accent.g, accent.b, 126);
    graphics.lineWidth = 2;
    graphics.roundRect(-28, -8.5, 56, 17, 8);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 16);
    graphics.roundRect(-22, 2, 44, 3, 2);
    graphics.fill();

    let labelNode = badgeNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = badgeNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(50, 13);
    labelNode.setPosition(0, 0, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = badgeText;
    label.fontSize = 7;
    label.lineHeight = 9;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = new Color(243, 248, 252, 255);
  }

  private renderHeroMeters(
    cardName: string,
    moveRemaining: number,
    moveTotal: number,
    hp: number,
    maxHp: number,
    armyCount: number
  ): void {
    const cardNode = this.node.getChildByName(cardName);
    if (!cardNode) {
      return;
    }

    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    const gap = 6;
    const chipWidth = Math.max(46, Math.floor((cardTransform.width - 22 - gap * 2) / 3));
    const chipHeight = 28;
    const totalWidth = chipWidth * 3 + gap * 2;
    const startX = -totalWidth / 2 + chipWidth / 2;
    const y = -52;

    this.renderMetricChip(cardNode, `${HERO_METER_PREFIX}-move`, startX, y, chipWidth, chipHeight, null, "移动", `${moveRemaining}/${moveTotal}`, new Color(112, 152, 220, 224));
    this.renderMetricChip(cardNode, `${HERO_METER_PREFIX}-hp`, startX + chipWidth + gap, y, chipWidth, chipHeight, null, "生命", `${hp}/${maxHp}`, new Color(122, 180, 124, 224));
    this.renderMetricChip(cardNode, `${HERO_METER_PREFIX}-army`, startX + (chipWidth + gap) * 2, y, chipWidth, chipHeight, null, "兵力", `${armyCount}`, new Color(204, 168, 92, 224));
  }

  private renderHeroProgressBar(cardName: string, ratio: number, labelText: string, highlighted: boolean): void {
    const cardNode = this.node.getChildByName(cardName);
    if (!cardNode) {
      return;
    }

    let barNode = cardNode.getChildByName(HERO_PROGRESS_PREFIX);
    if (!barNode) {
      barNode = new Node(HERO_PROGRESS_PREFIX);
      barNode.parent = cardNode;
    }
    assignUiLayer(barNode);
    barNode.active = true;

    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    const width = Math.max(120, cardTransform.width - 28);
    const height = 18;
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const barTransform = barNode.getComponent(UITransform) ?? barNode.addComponent(UITransform);
    barTransform.setContentSize(width, height);
    barNode.setPosition(0, -22, 1);

    const graphics = barNode.getComponent(Graphics) ?? barNode.addComponent(Graphics);
    const accent = highlighted ? new Color(233, 201, 118, 236) : new Color(108, 166, 122, 228);
    graphics.clear();
    graphics.fillColor = new Color(28, 36, 50, 196);
    graphics.strokeColor = new Color(accent.r, accent.g, accent.b, highlighted ? 180 : 96);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 8);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, highlighted ? 212 : 168);
    graphics.roundRect(-width / 2 + 2, -height / 2 + 2, Math.max(10, (width - 4) * clampedRatio), height - 4, 6);
    graphics.fill();

    let labelNode = barNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = barNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 8, height);
    labelNode.setPosition(0, 0, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 9;
    label.lineHeight = 11;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = new Color(246, 249, 252, 255);
  }

  private renderLearnableSkillButtons(cardName: string, skills: CocosHudSkillPanelAction[]): void {
    const cardNode = this.node.getChildByName(cardName);
    if (!cardNode) {
      return;
    }

    if (skills.length === 0) {
      this.hideCardDecorations(cardName, SKILL_BUTTON_PREFIX);
      return;
    }

    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    const buttonWidth = Math.max(120, cardTransform.width - 24);
    const buttonHeight = 22;
    const gap = 6;
    const totalHeight = skills.length * buttonHeight + (skills.length - 1) * gap;
    const startY = -cardTransform.height / 2 + 18 + totalHeight - buttonHeight / 2;

    skills.forEach((skill, index) => {
      const nodeName = `${SKILL_BUTTON_PREFIX}-${skill.skillId}`;
      let buttonNode = cardNode.getChildByName(nodeName);
      if (!buttonNode) {
        buttonNode = new Node(nodeName);
        buttonNode.parent = cardNode;
      }
      assignUiLayer(buttonNode);
      buttonNode.active = true;

      const buttonTransform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
      buttonTransform.setContentSize(buttonWidth, buttonHeight);
      buttonNode.setPosition(0, startY - index * (buttonHeight + gap), 1);

      const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
      graphics.clear();
      graphics.fillColor = new Color(92, 80, 52, 226);
      graphics.strokeColor = new Color(244, 223, 168, 132);
      graphics.lineWidth = 2;
      graphics.roundRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      graphics.fill();
      graphics.stroke();
      graphics.fillColor = new Color(255, 255, 255, 18);
      graphics.roundRect(-buttonWidth / 2 + 10, buttonHeight / 2 - 8, buttonWidth - 20, 3, 2);
      graphics.fill();

      let labelNode = buttonNode.getChildByName("Label");
      if (!labelNode) {
        labelNode = new Node("Label");
        labelNode.parent = buttonNode;
      }
      assignUiLayer(labelNode);
      const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
      labelTransform.setContentSize(buttonWidth - 16, buttonHeight - 8);
      labelNode.setPosition(0, 0, 0.1);
      const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
      label.string = skill.label;
      label.fontSize = 11;
      label.lineHeight = 13;
      label.horizontalAlign = H_ALIGN_CENTER;
      label.verticalAlign = V_ALIGN_MIDDLE;
      label.enableWrapText = false;
      label.color = new Color(246, 248, 252, 255);

      buttonNode.off(Node.EventType.TOUCH_END);
      buttonNode.off(Node.EventType.MOUSE_UP);
      if (skill.onSelect) {
        buttonNode.on(Node.EventType.TOUCH_END, skill.onSelect);
        buttonNode.on(Node.EventType.MOUSE_UP, skill.onSelect);
      }
    });

    const childNodes = (cardNode as unknown as { children?: Node[] }).children ?? [];
    for (const child of childNodes) {
      if (child.name.startsWith(SKILL_BUTTON_PREFIX) && !skills.some((skill) => child.name === `${SKILL_BUTTON_PREFIX}-${skill.skillId}`)) {
        child.active = false;
      }
    }
  }

  private buildEquipmentButtonStates(rows: ReturnType<typeof buildHeroEquipmentActionRows>): HudEquipmentButtonState[] {
    const buttons: HudEquipmentButtonState[] = [];

    for (const row of rows) {
      for (const item of row.inventory) {
        buttons.push({
          name: `${EQUIPMENT_BUTTON_PREFIX}-${row.slot}-${item.itemId}`,
          label: `${row.label} 装 ${item.name} x${item.count}`,
          tone: "equip",
          callback: this.onEquipItem ? () => this.onEquipItem?.(row.slot, item.itemId) : null
        });
      }

      if (row.itemId) {
        buttons.push({
          name: `${EQUIPMENT_BUTTON_PREFIX}-${row.slot}-unequip`,
          label: `${row.label} 卸 ${row.itemName}`,
          tone: "unequip",
          callback: this.onUnequipItem ? () => this.onUnequipItem?.(row.slot) : null
        });
      }
    }

    return buttons;
  }

  private renderEquipmentActionButtons(cardName: string, buttons: HudEquipmentButtonState[]): void {
    const cardNode = this.node.getChildByName(cardName);
    if (!cardNode) {
      return;
    }

    if (buttons.length === 0) {
      this.hideCardDecorations(cardName, EQUIPMENT_BUTTON_PREFIX);
      return;
    }

    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    const buttonHeight = 20;
    const gap = 4;
    const columns = 2;
    const buttonWidth = Math.max(90, Math.floor((cardTransform.width - 28 - gap) / columns));
    const rowCount = Math.ceil(buttons.length / columns);
    const totalHeight = rowCount * buttonHeight + Math.max(0, rowCount - 1) * gap;
    const startY = -cardTransform.height / 2 + 16 + totalHeight - buttonHeight / 2;
    const leftX = -buttonWidth / 2 - gap / 2;
    const rightX = buttonWidth / 2 + gap / 2;

    buttons.forEach((button, index) => {
      let buttonNode = cardNode.getChildByName(button.name);
      if (!buttonNode) {
        buttonNode = new Node(button.name);
        buttonNode.parent = cardNode;
      }
      assignUiLayer(buttonNode);
      buttonNode.active = true;

      const rowIndex = Math.floor(index / columns);
      const columnIndex = index % columns;
      const buttonTransform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
      buttonTransform.setContentSize(buttonWidth, buttonHeight);
      buttonNode.setPosition(columnIndex === 0 ? leftX : rightX, startY - rowIndex * (buttonHeight + gap), 1);

      const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
      const accent = button.tone === "equip" ? new Color(92, 120, 84, 232) : new Color(132, 92, 76, 232);
      graphics.clear();
      graphics.fillColor = new Color(accent.r, accent.g, accent.b, 88);
      graphics.strokeColor = new Color(accent.r, accent.g, accent.b, 156);
      graphics.lineWidth = 2;
      graphics.roundRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      graphics.fill();
      graphics.stroke();
      graphics.fillColor = new Color(255, 255, 255, 16);
      graphics.roundRect(-buttonWidth / 2 + 8, buttonHeight / 2 - 7, buttonWidth - 16, 3, 2);
      graphics.fill();

      let labelNode = buttonNode.getChildByName("Label");
      if (!labelNode) {
        labelNode = new Node("Label");
        labelNode.parent = buttonNode;
      }
      assignUiLayer(labelNode);
      const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
      labelTransform.setContentSize(buttonWidth - 12, buttonHeight - 6);
      labelNode.setPosition(0, 0, 0.1);
      const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
      label.string = button.label;
      label.fontSize = 9;
      label.lineHeight = 10;
      label.horizontalAlign = H_ALIGN_CENTER;
      label.verticalAlign = V_ALIGN_MIDDLE;
      label.enableWrapText = false;
      label.color = new Color(244, 247, 252, 255);

      buttonNode.off(Node.EventType.TOUCH_END);
      buttonNode.off(Node.EventType.MOUSE_UP);
      if (button.callback) {
        buttonNode.on(Node.EventType.TOUCH_END, () => {
          button.callback?.();
        });
        buttonNode.on(Node.EventType.MOUSE_UP, () => {
          button.callback?.();
        });
      }
    });

    const childNodes = (cardNode as unknown as { children?: Node[] }).children ?? [];
    for (const child of childNodes) {
      if (child.name.startsWith(EQUIPMENT_BUTTON_PREFIX) && !buttons.some((button) => child.name === button.name)) {
        child.active = false;
      }
    }
  }

  private tightenHeroLabelLayout(centerX: number, cardWidth: number): void {
    if (!this.heroLabel) {
      return;
    }

    const transform = this.heroLabel.node.getComponent(UITransform) ?? this.heroLabel.node.addComponent(UITransform);
    transform.setContentSize(cardWidth - 40, transform.height);
    this.heroLabel.node.setPosition(centerX - 8, this.heroLabel.node.position.y + 10, 1);
  }

  private hideCardDecorations(cardName: string, prefix: string): void {
    const cardNode = this.node.getChildByName(cardName);
    if (!cardNode) {
      return;
    }
    const childNodes = (cardNode as unknown as { children?: Node[] }).children ?? [];
    for (const child of childNodes) {
      if (child.name.startsWith(prefix)) {
        child.active = false;
      }
    }
  }

  private syncHeaderIcon(): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    let iconNode = this.node.getChildByName(HEADER_ICON_NODE_NAME);
    if (!iconNode) {
      iconNode = new Node(HEADER_ICON_NODE_NAME);
      iconNode.parent = this.node;
    }
    assignUiLayer(iconNode);

    const iconTransform = iconNode.getComponent(UITransform) ?? iconNode.addComponent(UITransform);
    iconTransform.setContentSize(26, 26);
    iconNode.setPosition(-transform.width / 2 + 46, transform.height / 2 - 74, 1);
    this.headerIconSprite = iconNode.getComponent(Sprite) ?? iconNode.addComponent(Sprite);
    this.headerIconOpacity = iconNode.getComponent(UIOpacity) ?? iconNode.addComponent(UIOpacity);

    const frame = getPixelSpriteAssets()?.icons.hud ?? null;
    if (!frame) {
      iconNode.active = false;
      if (!this.requestedIcons) {
        this.requestedIcons = true;
        void Promise.allSettled([loadPixelSpriteAssets("boot"), loadPlaceholderSpriteAssets("hud")]).then(() => {
          this.requestedIcons = false;
          if (this.currentState) {
            this.render(this.currentState);
          }
        });
      }
      return;
    }

    iconNode.active = true;
    this.headerIconSprite.spriteFrame = frame;
    this.headerIconOpacity.opacity = 255;

    let watermarkNode = this.node.getChildByName(WATERMARK_NODE_NAME);
    if (!watermarkNode) {
      watermarkNode = new Node(WATERMARK_NODE_NAME);
      watermarkNode.parent = this.node;
    }
    assignUiLayer(watermarkNode);
    const watermarkTransform = watermarkNode.getComponent(UITransform) ?? watermarkNode.addComponent(UITransform);
    watermarkTransform.setContentSize(84, 84);
    watermarkNode.setPosition(transform.width / 2 - 72, transform.height / 2 - 118, 0.5);
    const watermarkSprite = watermarkNode.getComponent(Sprite) ?? watermarkNode.addComponent(Sprite);
    const watermarkOpacity = watermarkNode.getComponent(UIOpacity) ?? watermarkNode.addComponent(UIOpacity);
    watermarkNode.active = true;
    watermarkSprite.spriteFrame = frame;
    watermarkOpacity.opacity = 10;
  }

  private retainPlaceholderAssets(): void {
    if (this.placeholderAssetsRetained) {
      return;
    }

    this.placeholderAssetsRetained = true;
    void retainPlaceholderSpriteAssets("hud").catch(() => {
      this.placeholderAssetsRetained = false;
    });
  }

  private cleanupLegacyNodes(): void {
    const allowedNames = new Set<string>([
      TITLE_NODE_NAME,
      RESOURCE_NODE_NAME,
      HERO_NODE_NAME,
      EQUIPMENT_NODE_NAME,
      SKILLS_NODE_NAME,
      STATUS_NODE_NAME,
      DEBUG_NODE_NAME,
      HEADER_ICON_NODE_NAME,
      WATERMARK_NODE_NAME,
      ACTIONS_NODE_NAME,
      `${CARD_PREFIX}-title`,
      `${CARD_PREFIX}-resources`,
      `${CARD_PREFIX}-hero`,
      `${CARD_PREFIX}-equipment`,
      `${CARD_PREFIX}-skills`,
      `${CARD_PREFIX}-status`,
      `${CARD_PREFIX}-debug`
    ]);
    const childNodes = (this.node as unknown as { children?: Node[] }).children ?? [];
    for (const child of childNodes) {
      if (!allowedNames.has(child.name)) {
        child.destroy();
      }
    }
  }

  private ensureActionButtons(): void {
    let actionsNode = this.node.getChildByName(ACTIONS_NODE_NAME);
    if (!actionsNode) {
      actionsNode = new Node(ACTIONS_NODE_NAME);
      actionsNode.parent = this.node;
    }
    assignUiLayer(actionsNode);

    this.ensureActionButton(actionsNode, "HudNewRun", "新开一局");
    this.ensureActionButton(actionsNode, "HudRefresh", "刷新状态");
    this.ensureActionButton(actionsNode, "HudEndDay", "推进一天");
    this.ensureActionButton(actionsNode, "HudReturnLobby", "返回大厅");
  }

  private syncActionButtons(): void {
    this.ensureActionButtons();
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const actionsNode = this.node.getChildByName(ACTIONS_NODE_NAME);
    if (!actionsNode) {
      return;
    }

    const actionsTransform = actionsNode.getComponent(UITransform) ?? actionsNode.addComponent(UITransform);
    actionsTransform.setContentSize(Math.max(164, transform.width - 28), 146);
    actionsNode.setPosition(0, transform.height / 2 - 118, 1);

    const buttons: HudActionButtonState[] = [
      { name: "HudNewRun", label: "新开一局", callback: this.onNewRun ?? null },
      { name: "HudRefresh", label: "刷新状态", callback: this.onRefresh ?? null },
      { name: "HudEndDay", label: "推进一天", callback: this.onEndDay ?? null },
      { name: "HudReturnLobby", label: "返回大厅", callback: this.onReturnLobby ?? null }
    ];

    buttons.forEach((button, index) => {
      const node = actionsNode.getChildByName(button.name);
      if (!node) {
        return;
      }

      const buttonTransform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
      const buttonWidth = Math.floor(actionsTransform.width - 8);
      const buttonHeight = 28;
      buttonTransform.setContentSize(buttonWidth, buttonHeight);
      const buttonY = index === 0 ? 45 : index === 1 ? 15 : index === 2 ? -15 : -45;
      node.setPosition(0, buttonY, 0);

      const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
      graphics.clear();
      graphics.fillColor =
        index === 0
          ? new Color(78, 102, 140, 236)
          : index === 1
            ? new Color(51, 70, 99, 228)
            : index === 2
              ? new Color(92, 86, 54, 232)
              : new Color(121, 84, 70, 234);
      graphics.strokeColor =
        index === 0
          ? new Color(245, 248, 252, 158)
          : index === 1
            ? new Color(218, 229, 242, 112)
            : index === 2
              ? new Color(242, 224, 171, 120)
              : new Color(244, 225, 213, 116);
      graphics.lineWidth = 2;
      graphics.roundRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 10);
      graphics.fill();
      graphics.stroke();
      graphics.fillColor = new Color(255, 255, 255, index === 0 ? 22 : index === 1 ? 14 : index === 2 ? 18 : 16);
      graphics.roundRect(-buttonWidth / 2 + 12, buttonHeight / 2 - 9, buttonWidth - 24, 3, 2);
      graphics.fill();

      let labelNode = node.getChildByName("Label");
      if (!labelNode) {
        labelNode = new Node("Label");
        labelNode.parent = node;
      }
      assignUiLayer(labelNode);
      const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
      labelTransform.setContentSize(buttonWidth - 16, buttonHeight - 8);
      labelNode.setPosition(0, 0, 0.1);
      const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
      label.string = button.label;
      label.fontSize = 13;
      label.lineHeight = 15;
      label.horizontalAlign = H_ALIGN_CENTER;
      label.verticalAlign = V_ALIGN_MIDDLE;
      label.enableWrapText = false;
      label.color = new Color(243, 247, 252, 255);

      node.off(Node.EventType.TOUCH_END);
      node.off(Node.EventType.MOUSE_UP);
      if (button.callback) {
        node.on(Node.EventType.TOUCH_END, () => {
          button.callback?.();
        });
        node.on(Node.EventType.MOUSE_UP, () => {
          button.callback?.();
        });
      }
    });
  }

  private ensureActionButton(parent: Node, name: string, labelText: string): void {
    let buttonNode = parent.getChildByName(name);
    if (!buttonNode) {
      buttonNode = new Node(name);
      buttonNode.parent = parent;
    }
    assignUiLayer(buttonNode);
    let labelNode = buttonNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = buttonNode;
    }
    assignUiLayer(labelNode);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
  }
}
