import { _decorator, Color, Component, Graphics, Label, Node, Sprite, UIOpacity, UITransform } from "cc";
import {
  createHeroAttributeBreakdown,
  createHeroProgressMeterView,
  type EquipmentType,
  getLatestUnlockedAchievement
} from "./project-shared/index.ts";
import type { PlayerReportReason, SessionUpdate } from "./VeilCocosSession.ts";
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
export const HUD_ACCENT = new Color(214, 184, 124, 255);
const HUD_ACCENT_SOFT = new Color(244, 225, 179, 96);
const HUD_TIMER_WARNING = new Color(228, 78, 78, 255);
const HUD_TIMER_WARNING_SOFT = new Color(255, 198, 198, 255);
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
const TURN_TIMER_NODE_NAME = "HudTurnTimer";
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
const REPORT_DIALOG_NODE_NAME = "HudReportDialog";
const SURRENDER_DIALOG_NODE_NAME = "HudSurrenderDialog";

interface HudActionButtonState {
  name: string;
  label: string;
  callback: (() => void) | null;
  visible?: boolean;
}

interface HudInteractionActionState {
  id: string;
  label: string;
}

interface HudEquipmentButtonState {
  name: string;
  label: string;
  tone: "equip" | "unequip";
  callback: (() => void) | null;
}

interface HudRecentLootEvent {
  type: "hero.equipmentFound";
  heroId: string;
  equipmentName: string;
  rarity: "common" | "rare" | "epic";
  overflowed?: boolean;
}

export type VeilHudSessionIndicatorKind =
  | "reconnecting"
  | "replaying_cached_snapshot"
  | "awaiting_authoritative_resync"
  | "degraded_offline_fallback";

export interface VeilHudSessionIndicator {
  kind: VeilHudSessionIndicatorKind;
  label: string;
  detail: string;
}

type HudResolvedAction =
  | {
      debugLabel: string;
      callback: (() => void) | null;
    }
  | null;

function formatHeroLearnedSkills(hero: NonNullable<VeilHudRenderState["update"]>["world"]["ownHeroes"][number] | null): string {
  const learnedSkills = hero?.learnedSkills ?? [];
  if (!hero || learnedSkills.length === 0) {
    return "未学习长期技能";
  }

  return learnedSkills.map((skill) => `${skill.skillId} R${skill.rank}`).join(" / ");
}

function formatHeroEquipmentLines(
  hero: NonNullable<VeilHudRenderState["update"]>["world"]["ownHeroes"][number] | null,
  recentEventLog: VeilHudRenderState["account"]["recentEventLog"],
  recentSessionEvents: HudRecentLootEvent[] = []
): string[] {
  if (!hero) {
    return ["装备 等待房间状态...", ""];
  }

  const equipmentLines = formatEquipmentOverviewLines(hero);
  const inventoryLines = formatInventorySummaryLines(hero);
  const lootLines = formatRecentLootLines(recentEventLog, hero.id, 2, recentSessionEvents, hero.name);

  return [
    ...equipmentLines,
    ...inventoryLines,
    ...lootLines
  ];
}

function toHudRecentLootEvents(
  events: NonNullable<VeilHudRenderState["update"]>["events"]
): HudRecentLootEvent[] {
  const recentLoot: HudRecentLootEvent[] = [];
  for (const event of events) {
    if (event.type !== "hero.equipmentFound") {
      continue;
    }

    recentLoot.push({
      type: event.type,
      heroId: event.heroId,
      equipmentName: event.equipmentName,
      rarity: event.rarity,
      ...(event.overflowed ? { overflowed: true } : {})
    });
  }

  return recentLoot;
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
  sessionIndicators: VeilHudSessionIndicator[];
  inputDebug: string;
  runtimeHealth: string;
  triageSummaryLines: string[];
  levelUpNotice: {
    title: string;
    detail: string;
  } | null;
  achievementNotice: {
    title: string;
    detail: string;
  } | null;
  reporting: {
    open: boolean;
    available: boolean;
    targetLabel: string | null;
    status: string | null;
    submitting: boolean;
  };
  surrendering: {
    open: boolean;
    available: boolean;
    targetLabel: string | null;
    status: string | null;
    submitting: boolean;
  };
  sharing: {
    available: boolean;
  };
  battlePassEnabled: boolean;
  seasonalEventAvailable: boolean;
  interaction: {
    title: string;
    detail: string;
    actions: HudInteractionActionState[];
  } | null;
  presentation: {
    audio: CocosAudioRuntimeState;
    pixelAssets: PixelSpriteLoadStatus;
    readiness: CocosPresentationReadiness;
  };
}

function getSessionIndicatorBadge(indicators: VeilHudSessionIndicator[]): string | null {
  const [highestPriority] = indicators;
  if (!highestPriority) {
    return null;
  }

  switch (highestPriority.kind) {
    case "reconnecting":
      return "重连中";
    case "replaying_cached_snapshot":
      return "缓存回放";
    case "awaiting_authoritative_resync":
      return "待权威同步";
    case "degraded_offline_fallback":
      return "降级";
    default:
      return null;
  }
}

export interface VeilHudPanelOptions {
  onNewRun?: () => void;
  onRefresh?: () => void;
  onToggleSettings?: () => void;
  onToggleCampaign?: () => void;
  onToggleInventory?: () => void;
  onToggleAchievements?: () => void;
  onToggleProgression?: () => void;
  onToggleSeasonalEvent?: () => void;
  onToggleReport?: () => void;
  onToggleSurrender?: () => void;
  onShareBattleResult?: () => void;
  onSubmitReport?: (reason: PlayerReportReason) => void;
  onCancelReport?: () => void;
  onConfirmSurrender?: () => void;
  onCancelSurrender?: () => void;
  onLearnSkill?: (skillId: string) => void;
  onEquipItem?: (slot: EquipmentType, equipmentId: string) => void;
  onUnequipItem?: (slot: EquipmentType) => void;
  onEndDay?: () => void;
  onReturnLobby?: () => void;
  onInteractionAction?: (actionId: string) => void;
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
  private turnTimerLabel: Label | null = null;
  private headerIconSprite: Sprite | null = null;
  private headerIconOpacity: UIOpacity | null = null;
  private currentState: VeilHudRenderState | null = null;
  private requestedIcons = false;
  private onNewRun: (() => void) | undefined;
  private onRefresh: (() => void) | undefined;
  private onToggleSettings: (() => void) | undefined;
  private onToggleCampaign: (() => void) | undefined;
  private onToggleInventory: (() => void) | undefined;
  private onToggleAchievements: (() => void) | undefined;
  private onToggleProgression: (() => void) | undefined;
  private onToggleSeasonalEvent: (() => void) | undefined;
  private onToggleReport: (() => void) | undefined;
  private onToggleSurrender: (() => void) | undefined;
  private onShareBattleResult: (() => void) | undefined;
  private onSubmitReport: ((reason: PlayerReportReason) => void) | undefined;
  private onCancelReport: (() => void) | undefined;
  private onConfirmSurrender: (() => void) | undefined;
  private onCancelSurrender: (() => void) | undefined;
  private onLearnSkill: ((skillId: string) => void) | undefined;
  private onEquipItem: ((slot: EquipmentType, equipmentId: string) => void) | undefined;
  private onUnequipItem: ((slot: EquipmentType) => void) | undefined;
  private onEndDay: (() => void) | undefined;
  private onReturnLobby: (() => void) | undefined;
  private onInteractionAction: ((actionId: string) => void) | undefined;
  private placeholderAssetsRetained = false;

  configure(options: VeilHudPanelOptions): void {
    this.onNewRun = options.onNewRun;
    this.onRefresh = options.onRefresh;
    this.onToggleSettings = options.onToggleSettings;
    this.onToggleCampaign = options.onToggleCampaign;
    this.onToggleInventory = options.onToggleInventory;
    this.onToggleAchievements = options.onToggleAchievements;
    this.onToggleProgression = options.onToggleProgression;
    this.onToggleSeasonalEvent = options.onToggleSeasonalEvent;
    this.onToggleReport = options.onToggleReport;
    this.onToggleSurrender = options.onToggleSurrender;
    this.onShareBattleResult = options.onShareBattleResult;
    this.onSubmitReport = options.onSubmitReport;
    this.onCancelReport = options.onCancelReport;
    this.onConfirmSurrender = options.onConfirmSurrender;
    this.onCancelSurrender = options.onCancelSurrender;
    this.onLearnSkill = options.onLearnSkill;
    this.onEquipItem = options.onEquipItem;
    this.onUnequipItem = options.onUnequipItem;
    this.onEndDay = options.onEndDay;
    this.onReturnLobby = options.onReturnLobby;
    this.onInteractionAction = options.onInteractionAction;
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
    this.turnTimerLabel = this.ensureTurnTimerLabel();
    const hero = state.update?.world.ownHeroes[0] ?? null;
    const world = state.update?.world;
    const resources = world?.resources;
    const battle = state.update?.battle;
    const skillPanelView = buildCocosHudSkillPanelView(state.update, this.onLearnSkill);
    const progressMeter = hero ? createHeroProgressMeterView({ progression: { ...hero.progression } }) : null;
    const attributeRows = hero ? createHeroAttributeBreakdown(toHudHeroSkillState(hero), world ?? undefined) : [];
    const attackTotal = attributeRows.find((row) => row.key === "attack")?.total ?? hero?.stats.attack ?? 0;
    const defenseTotal = attributeRows.find((row) => row.key === "defense")?.total ?? hero?.stats.defense ?? 0;
    const powerTotal = attributeRows.find((row) => row.key === "power")?.total ?? hero?.stats.power ?? 0;
    const knowledgeTotal = attributeRows.find((row) => row.key === "knowledge")?.total ?? hero?.stats.knowledge ?? 0;
    const maxHpTotal = attributeRows.find((row) => row.key === "maxHp")?.total ?? hero?.stats.maxHp ?? 0;
    const equipmentLines = formatHeroEquipmentLines(hero, state.account.recentEventLog, toHudRecentLootEvents(state.update?.events ?? []));
    const equipmentRows = buildHeroEquipmentActionRows(hero);
    const equipmentButtons = this.buildEquipmentButtonStates(equipmentRows);
    const equipmentLineCount = (hero ? 1 + equipmentLines.length : 3);
    const equipmentCardHeight = Math.max(
      156,
      50 + equipmentLineCount * 16 + (equipmentButtons.length > 0 ? Math.ceil(equipmentButtons.length / 2) * 24 : 0)
    );
    const latestBattleReport = summarizeLatestBattleReplay(state.account.recentBattleReplays, state.account.recentEventLog);
    const reachableAhead =
      state.update?.reachableTiles.filter((tile) => !hero || tile.x !== hero.position.x || tile.y !== hero.position.y).length ?? 0;
    const sessionStatusBadge = getSessionIndicatorBadge(state.sessionIndicators);
    const sessionIndicatorLines = state.sessionIndicators.map((indicator) => `会话 ${indicator.label} · ${indicator.detail}`);
    const interactionLines = state.interaction ? [`交互 ${state.interaction.title}`, state.interaction.detail] : [];
    const statusTitle = state.levelUpNotice?.title ?? "状态";
    const statusBadge = state.levelUpNotice
      ? "升级!"
      : sessionStatusBadge
        ? sessionStatusBadge
      : battle
        ? "战斗中"
        : hero && hero.move.remaining <= 0
          ? "体力耗尽"
          : "待命";
    const statusDetail = state.levelUpNotice?.detail
      || state.sessionIndicators[0]?.detail
      || state.predictionStatus
      || (state.moveInFlight
        ? "正在结算移动..."
        : hero && hero.move.remaining <= 0
          ? "今天已经没有移动点了。"
          : "点击地块移动，点击脚下资源即可采集。");
    const statusLines = [
      statusTitle,
      statusDetail,
      ...sessionIndicatorLines,
      state.runtimeHealth,
      ...interactionLines,
      ...state.triageSummaryLines,
      formatAchievementSummary(state.account),
      formatRecentEventLog(state.account),
      latestBattleReport.title,
      latestBattleReport.detail,
      formatPresentationAudioSummary(state.presentation.audio),
      formatPresentationLoadSummary(state.presentation.pixelAssets),
      `表现 ${formatPresentationReadinessSummary(state.presentation.readiness)}`
    ];
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
            `攻 ${attackTotal}  防 ${defenseTotal}  力 ${powerTotal}  知 ${knowledgeTotal}`,
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
      statusLines,
      cursorY,
      12,
      16,
      cardWidth,
      leftX,
      4,
      Math.max(174, 52 + statusLines.length * 16)
    );

    if (resources) {
      this.renderResourceChips(`${CARD_PREFIX}-resources`, resources.gold, resources.wood, resources.ore, state.account.gems ?? 0);
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
      this.renderHeroMeters(`${CARD_PREFIX}-hero`, hero.move.remaining, hero.move.total, hero.stats.hp, maxHpTotal, hero.armyCount);
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
    this.renderReportDialog(state.reporting);
    this.renderSurrenderDialog(state.surrendering);

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
    this.refreshTurnTimerLabel();
  }

  update(): void {
    this.refreshTurnTimerLabel();
  }

  dispatchPointerUp(localX: number, localY: number): string | null {
    const action = this.resolvePointerAction(localX, localY);
    if (!action) {
      return null;
    }

    action.callback?.();
    return action.debugLabel;
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

  private resolvePointerAction(localX: number, localY: number): HudResolvedAction {
    const chromeActions: Array<{ nodeName: string; debugLabel: string; callback: (() => void) | null }> = [
      { nodeName: "HudNewRun", debugLabel: "new-run", callback: this.onNewRun ?? null },
      { nodeName: "HudRefresh", debugLabel: "refresh", callback: this.onRefresh ?? null },
      { nodeName: "HudSettings", debugLabel: "settings", callback: this.onToggleSettings ?? null },
      { nodeName: "HudCampaign", debugLabel: "campaign", callback: this.onToggleCampaign ?? null },
      { nodeName: "HudInventory", debugLabel: "inventory", callback: this.onToggleInventory ?? null },
      { nodeName: "HudAchievements", debugLabel: "achievements", callback: this.onToggleAchievements ?? null },
      { nodeName: "HudBattlePass", debugLabel: "battle-pass", callback: this.onToggleProgression ?? null },
      { nodeName: "HudSeasonalEvent", debugLabel: "seasonal-event", callback: this.onToggleSeasonalEvent ?? null },
      { nodeName: "HudReportPlayer", debugLabel: "report-player", callback: this.onToggleReport ?? null },
      { nodeName: "HudSurrender", debugLabel: "surrender", callback: this.onToggleSurrender ?? null },
      { nodeName: "HudShareBattleResult", debugLabel: "share-battle-result", callback: this.onShareBattleResult ?? null },
      { nodeName: "HudEndDay", debugLabel: "end-day", callback: this.onEndDay ?? null },
      { nodeName: "HudReturnLobby", debugLabel: "return-lobby", callback: this.onReturnLobby ?? null }
    ];
    const interactionActions = (this.currentState?.interaction?.actions ?? []).map((action) => ({
      nodeName: `HudInteraction-${action.id}`,
      debugLabel: `interaction:${action.id}`,
      callback: this.onInteractionAction ? () => this.onInteractionAction?.(action.id) : null
    }));

    const reportDialogActions: Array<{ nodeName: string; debugLabel: string; callback: (() => void) | null }> = [
      { nodeName: "HudReportReason-cheating", debugLabel: "report-reason:cheating", callback: this.onSubmitReport ? () => this.onSubmitReport?.("cheating") : null },
      { nodeName: "HudReportReason-harassment", debugLabel: "report-reason:harassment", callback: this.onSubmitReport ? () => this.onSubmitReport?.("harassment") : null },
      { nodeName: "HudReportReason-afk", debugLabel: "report-reason:afk", callback: this.onSubmitReport ? () => this.onSubmitReport?.("afk") : null },
      { nodeName: "HudReportCancel", debugLabel: "report-cancel", callback: this.onCancelReport ?? null }
    ];
    const reportDialogNode = this.node.getChildByName(REPORT_DIALOG_NODE_NAME);
    for (const action of reportDialogActions) {
      const node = reportDialogNode?.getChildByName(action.nodeName) ?? null;
      if (this.pointInNode(localX, localY, node)) {
        return {
          debugLabel: action.debugLabel,
          callback: action.callback
        };
      }
    }

    const surrenderDialogActions: Array<{ nodeName: string; debugLabel: string; callback: (() => void) | null }> = [
      { nodeName: "HudSurrenderConfirm", debugLabel: "surrender-confirm", callback: this.onConfirmSurrender ?? null },
      { nodeName: "HudSurrenderCancel", debugLabel: "surrender-cancel", callback: this.onCancelSurrender ?? null }
    ];
    const surrenderDialogNode = this.node.getChildByName(SURRENDER_DIALOG_NODE_NAME);
    for (const action of surrenderDialogActions) {
      const node = surrenderDialogNode?.getChildByName(action.nodeName) ?? null;
      if (this.pointInNode(localX, localY, node)) {
        return {
          debugLabel: action.debugLabel,
          callback: action.callback
        };
      }
    }

    const actionsNode = this.node.getChildByName(ACTIONS_NODE_NAME);
    for (const action of [...interactionActions, ...chromeActions]) {
      const node = actionsNode?.getChildByName(action.nodeName) ?? null;
      if (this.pointInNode(localX, localY, node)) {
        return {
          debugLabel: action.debugLabel,
          callback: action.callback
        };
      }
    }

    const skillCard = this.node.getChildByName(`${CARD_PREFIX}-skills`);
    const skillActions = buildCocosHudSkillPanelView(this.currentState?.update ?? null, this.onLearnSkill).actions;
    for (const skill of skillActions) {
      const node = skillCard?.getChildByName(`${SKILL_BUTTON_PREFIX}-${skill.skillId}`) ?? null;
      if (this.pointInNode(localX, localY, node)) {
        return {
          debugLabel: `learn-skill:${skill.skillId}`,
          callback: skill.onSelect ?? null
        };
      }
    }

    const hero = this.currentState?.update?.world.ownHeroes[0] ?? null;
    const equipmentCard = this.node.getChildByName(`${CARD_PREFIX}-equipment`);
    const equipmentButtons = this.buildEquipmentButtonStates(buildHeroEquipmentActionRows(hero));
    for (const button of equipmentButtons) {
      const node = equipmentCard?.getChildByName(button.name) ?? null;
      if (this.pointInNode(localX, localY, node)) {
        return {
          debugLabel: button.name,
          callback: button.callback
        };
      }
    }

    return null;
  }

  private pointInNode(localX: number, localY: number, node: Node | null): boolean {
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
    while (current && current !== this.node) {
      centerX += current.position.x;
      centerY += current.position.y;
      current = current.parent;
    }

    if (current !== this.node) {
      return false;
    }

    return this.pointInRect(localX, localY, centerX, centerY, transform.width, transform.height);
  }

  private pointInRect(x: number, y: number, centerX: number, centerY: number, width: number, height: number): boolean {
    return x >= centerX - width / 2 && x <= centerX + width / 2 && y >= centerY - height / 2 && y <= centerY + height / 2;
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

  private ensureTurnTimerLabel(): Label {
    const existingNode = this.node.getChildByName(TURN_TIMER_NODE_NAME);
    const node = existingNode ?? new Node(TURN_TIMER_NODE_NAME);
    if (!existingNode) {
      node.parent = this.node;
    }
    assignUiLayer(node);

    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(132, 28);
    const label = node.getComponent(Label) ?? node.addComponent(Label);
    label.fontSize = 16;
    label.lineHeight = 20;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.string = "";
    return label;
  }

  private refreshTurnTimerLabel(): void {
    const label = this.turnTimerLabel ?? this.ensureTurnTimerLabel();
    const deadlineAt = this.currentState?.update?.world.turnDeadlineAt ?? null;
    if (!deadlineAt) {
      label.node.active = false;
      return;
    }

    const deadlineMs = Date.parse(deadlineAt);
    if (Number.isNaN(deadlineMs)) {
      label.node.active = false;
      return;
    }

    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const remainingMs = Math.max(0, deadlineMs - Date.now());
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const inWarningWindow = remainingMs <= 10_000;
    label.node.active = true;
    label.node.setPosition(transform.width / 2 - 82, transform.height / 2 - 62, 3);
    label.string = `倒计时 ${minutes}:${seconds.toString().padStart(2, "0")}`;
    label.color = inWarningWindow && Math.floor(Date.now() / 250) % 2 === 0 ? HUD_TIMER_WARNING : inWarningWindow ? HUD_TIMER_WARNING_SOFT : HUD_ACCENT;
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

  private renderResourceChips(cardName: string, gold: number, wood: number, ore: number, gems: number): void {
    const cardNode = this.node.getChildByName(cardName);
    if (!cardNode) {
      return;
    }

    const frameSet = getPixelSpriteAssets()?.icons;
    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    const gap = 6;
    const chipWidth = Math.max(46, Math.floor((cardTransform.width - 28 - gap * 3) / 4));
    const chipHeight = 30;
    const totalWidth = chipWidth * 4 + gap * 3;
    const startX = -totalWidth / 2 + chipWidth / 2;
    const y = -10;

    this.renderMetricChip(cardNode, "gold", startX, y, chipWidth, chipHeight, frameSet?.gold ?? null, "金币", `${gold}`, new Color(183, 142, 72, 236));
    this.renderMetricChip(cardNode, "wood", startX + chipWidth + gap, y, chipWidth, chipHeight, frameSet?.wood ?? null, "木材", `${wood}`, new Color(90, 128, 92, 236));
    this.renderMetricChip(cardNode, "ore", startX + (chipWidth + gap) * 2, y, chipWidth, chipHeight, frameSet?.ore ?? null, "矿石", `${ore}`, new Color(96, 118, 144, 236));
    this.renderMetricChip(cardNode, "gems", startX + (chipWidth + gap) * 3, y, chipWidth, chipHeight, null, "宝石", `${Math.max(0, Math.floor(gems))}`, new Color(126, 178, 222, 236));
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
      REPORT_DIALOG_NODE_NAME,
      SURRENDER_DIALOG_NODE_NAME,
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
    this.ensureActionButton(actionsNode, "HudSettings", "设置");
    this.ensureActionButton(actionsNode, "HudCampaign", "战役任务");
    this.ensureActionButton(actionsNode, "HudInventory", "装备背包");
    this.ensureActionButton(actionsNode, "HudAchievements", "战报中心");
    this.ensureActionButton(actionsNode, "HudBattlePass", "赛季通行证");
    this.ensureActionButton(actionsNode, "HudSeasonalEvent", "赛季活动");
    this.ensureActionButton(actionsNode, "HudReportPlayer", "举报玩家");
    this.ensureActionButton(actionsNode, "HudSurrender", "认输");
    this.ensureActionButton(actionsNode, "HudShareBattleResult", "分享战绩");
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

    const interactionButtons: HudActionButtonState[] = (this.currentState?.interaction?.actions ?? []).map((action) => ({
      name: `HudInteraction-${action.id}`,
      label: action.label,
      callback: this.onInteractionAction ? () => this.onInteractionAction?.(action.id) : null
    }));
    const buttons: HudActionButtonState[] = [
      ...interactionButtons,
      { name: "HudNewRun", label: "新开一局", callback: this.onNewRun ?? null },
      { name: "HudRefresh", label: "刷新状态", callback: this.onRefresh ?? null },
      { name: "HudSettings", label: "设置", callback: this.onToggleSettings ?? null },
      { name: "HudCampaign", label: "战役任务", callback: this.onToggleCampaign ?? null },
      { name: "HudInventory", label: "装备背包", callback: this.onToggleInventory ?? null },
      { name: "HudAchievements", label: "战报中心", callback: this.onToggleAchievements ?? null },
      {
        name: "HudBattlePass",
        label: "赛季通行证",
        callback: this.onToggleProgression ?? null,
        visible: this.currentState?.battlePassEnabled ?? false
      },
      {
        name: "HudSeasonalEvent",
        label: "赛季活动",
        callback: this.onToggleSeasonalEvent ?? null,
        visible: this.currentState?.seasonalEventAvailable ?? false
      },
      { name: "HudReportPlayer", label: "举报玩家", callback: this.onToggleReport ?? null },
      {
        name: "HudSurrender",
        label: "认输",
        callback: this.onToggleSurrender ?? null,
        visible: this.currentState?.surrendering?.available ?? false
      },
      {
        name: "HudShareBattleResult",
        label: "分享战绩",
        callback: this.onShareBattleResult ?? null,
        visible: this.currentState?.sharing?.available ?? false
      },
      { name: "HudEndDay", label: "推进一天", callback: this.onEndDay ?? null },
      { name: "HudReturnLobby", label: "返回大厅", callback: this.onReturnLobby ?? null }
    ];
    const visibleButtons = buttons.filter((button) => button.visible !== false);
    const actionsTransform = actionsNode.getComponent(UITransform) ?? actionsNode.addComponent(UITransform);
    actionsTransform.setContentSize(Math.max(164, transform.width - 28), Math.max(246, 66 + visibleButtons.length * 30));
    actionsNode.setPosition(0, transform.height / 2 - 118, 1);

    visibleButtons.forEach((button, index) => {
      this.ensureActionButton(actionsNode, button.name, button.label);
      const node = actionsNode.getChildByName(button.name)!;
      node.active = true;

      const buttonTransform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
      const buttonWidth = Math.floor(actionsTransform.width - 8);
      const buttonHeight = 28;
      buttonTransform.setContentSize(buttonWidth, buttonHeight);
      const buttonY = 60 - index * 30;
      node.setPosition(0, buttonY, 0);

      const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
      graphics.clear();
      const isInteractionButton = button.name.startsWith("HudInteraction-");
      graphics.fillColor = isInteractionButton
        ? new Color(93, 116, 68, 236)
        : index === 0
          ? new Color(78, 102, 140, 236)
          : index === 1
            ? new Color(51, 70, 99, 228)
            : index === 2
              ? new Color(76, 98, 72, 232)
              : index === 3
                ? new Color(73, 88, 62, 230)
                : index === 4
                  ? new Color(92, 86, 54, 232)
                  : new Color(121, 84, 70, 234);
      graphics.strokeColor = isInteractionButton
        ? new Color(232, 244, 214, 132)
        : index === 0
          ? new Color(245, 248, 252, 158)
          : index === 1
            ? new Color(218, 229, 242, 112)
            : index === 2
              ? new Color(224, 240, 214, 108)
              : index === 3
                ? new Color(224, 240, 199, 108)
                : index === 4
                  ? new Color(242, 224, 171, 120)
                  : new Color(244, 225, 213, 116);
      graphics.lineWidth = 2;
      graphics.roundRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 10);
      graphics.fill();
      graphics.stroke();
      graphics.fillColor = new Color(
        255,
        255,
        255,
        isInteractionButton ? 20 : index === 0 ? 22 : index === 1 ? 14 : index === 2 ? 16 : index === 3 ? 16 : index === 4 ? 18 : 16
      );
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

    for (const button of buttons.filter((candidate) => candidate.visible === false)) {
      const hiddenNode = actionsNode.getChildByName(button.name);
      if (hiddenNode) {
        hiddenNode.active = false;
      }
    }

    for (const node of actionsNode.children) {
      if (node.name.startsWith("HudInteraction-") && !visibleButtons.some((button) => button.name === node.name)) {
        node.active = false;
      }
    }
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

  private renderReportDialog(state: VeilHudRenderState["reporting"]): void {
    let dialogNode = this.node.getChildByName(REPORT_DIALOG_NODE_NAME);
    if (!state.open) {
      if (dialogNode) {
        dialogNode.active = false;
      }
      return;
    }

    if (!dialogNode) {
      dialogNode = new Node(REPORT_DIALOG_NODE_NAME);
      dialogNode.parent = this.node;
    }
    assignUiLayer(dialogNode);
    dialogNode.active = true;

    const rootTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const dialogTransform = dialogNode.getComponent(UITransform) ?? dialogNode.addComponent(UITransform);
    const width = Math.max(176, rootTransform.width - 38);
    const height = 188;
    dialogTransform.setContentSize(width, height);
    dialogNode.setPosition(0, 8, 6);

    const graphics = dialogNode.getComponent(Graphics) ?? dialogNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(26, 34, 48, 238);
    graphics.strokeColor = new Color(248, 229, 197, 148);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.fill();
    graphics.stroke();

    const titleNode = dialogNode.getChildByName("Label") ?? new Node("Label");
    titleNode.parent = dialogNode;
    assignUiLayer(titleNode);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(width - 24, 62);
    titleNode.setPosition(0, 50, 1);
    const title = titleNode.getComponent(Label) ?? titleNode.addComponent(Label);
    title.string = `举报玩家\n${state.targetLabel ?? "当前没有可举报目标"}${state.status ? `\n${state.status}` : state.submitting ? "\n正在提交举报..." : ""}`;
    title.fontSize = 13;
    title.lineHeight = 16;
    title.horizontalAlign = H_ALIGN_CENTER;
    title.verticalAlign = V_ALIGN_MIDDLE;
    title.overflow = OVERFLOW_RESIZE_HEIGHT;
    title.enableWrapText = true;
    title.color = new Color(248, 244, 233, 255);

    const buttons: Array<{ name: string; label: string; enabled: boolean }> = [
      { name: "HudReportReason-cheating", label: "作弊", enabled: state.available && !state.submitting },
      { name: "HudReportReason-harassment", label: "骚扰", enabled: state.available && !state.submitting },
      { name: "HudReportReason-afk", label: "挂机", enabled: state.available && !state.submitting },
      { name: "HudReportCancel", label: "取消", enabled: !state.submitting }
    ];

    buttons.forEach((button, index) => {
      this.renderDialogButton(dialogNode!, button.name, button.label, 14 - index * 30, button.enabled);
    });
  }

  private renderSurrenderDialog(state: VeilHudRenderState["surrendering"]): void {
    let dialogNode = this.node.getChildByName(SURRENDER_DIALOG_NODE_NAME);
    if (!state.open) {
      if (dialogNode) {
        dialogNode.active = false;
      }
      return;
    }

    if (!dialogNode) {
      dialogNode = new Node(SURRENDER_DIALOG_NODE_NAME);
      dialogNode.parent = this.node;
    }
    assignUiLayer(dialogNode);
    dialogNode.active = true;

    const rootTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const dialogTransform = dialogNode.getComponent(UITransform) ?? dialogNode.addComponent(UITransform);
    const width = Math.max(176, rootTransform.width - 38);
    const height = 156;
    dialogTransform.setContentSize(width, height);
    dialogNode.setPosition(0, 8, 6);

    const graphics = dialogNode.getComponent(Graphics) ?? dialogNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(34, 30, 30, 238);
    graphics.strokeColor = new Color(244, 203, 173, 148);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.fill();
    graphics.stroke();

    const titleNode = dialogNode.getChildByName("Label") ?? new Node("Label");
    titleNode.parent = dialogNode;
    assignUiLayer(titleNode);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(width - 24, 70);
    titleNode.setPosition(0, 34, 1);
    const title = titleNode.getComponent(Label) ?? titleNode.addComponent(Label);
    title.string = `确认认输\n${state.targetLabel ?? "当前没有可结算的对手"}${state.status ? `\n${state.status}` : ""}`;
    title.fontSize = 13;
    title.lineHeight = 16;
    title.horizontalAlign = H_ALIGN_CENTER;
    title.verticalAlign = V_ALIGN_MIDDLE;
    title.overflow = OVERFLOW_RESIZE_HEIGHT;
    title.enableWrapText = true;
    title.color = new Color(248, 244, 233, 255);

    this.renderDialogButton(dialogNode, "HudSurrenderConfirm", "确认认输", -18, state.available && !state.submitting);
    this.renderDialogButton(dialogNode, "HudSurrenderCancel", "取消", -48, !state.submitting);
  }

  private renderDialogButton(parent: Node, name: string, labelText: string, y: number, enabled: boolean): void {
    const buttonNode = parent.getChildByName(name) ?? new Node(name);
    buttonNode.parent = parent;
    assignUiLayer(buttonNode);
    const transform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
    transform.setContentSize(136, 24);
    buttonNode.setPosition(0, y, 1);

    const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = enabled ? new Color(91, 70, 54, 236) : new Color(70, 74, 82, 168);
    graphics.strokeColor = enabled ? new Color(248, 224, 180, 124) : new Color(214, 220, 228, 76);
    graphics.lineWidth = 2;
    graphics.roundRect(-68, -12, 136, 24, 8);
    graphics.fill();
    graphics.stroke();

    const labelNode = buttonNode.getChildByName("Label") ?? new Node("Label");
    labelNode.parent = buttonNode;
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(120, 18);
    labelNode.setPosition(0, 0, 0.1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 12;
    label.lineHeight = 14;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = enabled ? new Color(248, 244, 233, 255) : new Color(199, 204, 212, 255);
  }
}
