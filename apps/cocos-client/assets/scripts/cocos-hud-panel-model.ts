import { Color } from "cc";
import {
  createHeroAttributeBreakdown,
  createHeroProgressMeterView,
  getLatestUnlockedAchievement,
  type EquipmentType
} from "./project-shared/index.ts";
import type { PlayerReportReason, SessionUpdate } from "./VeilCocosSession.ts";
import type { CocosPlayerAccountProfile } from "./cocos-lobby.ts";
import type { PixelSpriteLoadStatus } from "./cocos-pixel-sprites.ts";
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
import type { CocosWorldFocusView } from "./cocos-world-focus.ts";
import {
  buildCocosHudSkillPanelView,
  toHudHeroSkillState,
  type CocosHudSkillPanelAction
} from "./cocos-hud-skill-panel.ts";

export const HUD_ACCENT = new Color(214, 184, 124, 255);

export interface VeilHudSessionIndicator {
  kind: "reconnecting" | "replaying_cached_snapshot" | "awaiting_authoritative_resync" | "degraded_offline_fallback";
  label: string;
  detail: string;
}

interface HudInteractionActionState {
  id: string;
  label: string;
}

interface HudRecentLootEvent {
  type: "hero.equipmentFound";
  heroId: string;
  equipmentName: string;
  rarity: "common" | "rare" | "epic";
  overflowed?: boolean;
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
  worldFocus: CocosWorldFocusView | null;
}

export interface VeilHudPanelOptions {
  onNewRun?: () => void;
  onRefresh?: () => void;
  onToggleSettings?: () => void;
  onToggleCampaign?: () => void;
  onToggleInventory?: () => void;
  onToggleAchievements?: () => void;
  onToggleDailyDungeon?: () => void;
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

export interface HudPanelViewModel {
  hero: NonNullable<VeilHudRenderState["update"]>["world"]["ownHeroes"][number] | null;
  world: NonNullable<VeilHudRenderState["update"]>["world"] | null;
  battle: NonNullable<VeilHudRenderState["update"]>["battle"] | null;
  resources: NonNullable<NonNullable<VeilHudRenderState["update"]>["world"]>["resources"] | null;
  skillPanelView: ReturnType<typeof buildCocosHudSkillPanelView>;
  progressMeter: ReturnType<typeof createHeroProgressMeterView> | null;
  attributeRows: ReturnType<typeof createHeroAttributeBreakdown>;
  attackTotal: number;
  defenseTotal: number;
  powerTotal: number;
  knowledgeTotal: number;
  maxHpTotal: number;
  equipmentLines: string[];
  equipmentRows: ReturnType<typeof buildHeroEquipmentActionRows>;
  equipmentCardHeight: number;
  latestBattleReport: ReturnType<typeof summarizeLatestBattleReplay>;
  sessionStatusBadge: string | null;
  statusBadge: string;
  statusLines: string[];
  titleLines: string[];
  heroLines: string[];
  worldFocusLines: string[];
  interactionLines: string[];
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
  recentEventLog: VeilHudRenderState["account"]["recentEventLog"],
  recentSessionEvents: HudRecentLootEvent[] = []
): string[] {
  if (!hero) {
    return ["装备 等待房间状态...", ""];
  }

  return [
    ...formatEquipmentOverviewLines(hero),
    ...formatInventorySummaryLines(hero),
    ...formatRecentLootLines(recentEventLog, hero.id, 2, recentSessionEvents, hero.name)
  ];
}

function toHudRecentLootEvents(
  events: NonNullable<VeilHudRenderState["update"]>["events"]
): HudRecentLootEvent[] {
  return events
    .filter((event): event is Extract<SessionUpdate["events"][number], { type: "hero.equipmentFound" }> => event.type === "hero.equipmentFound")
    .map((event) => ({
      type: event.type,
      heroId: event.heroId,
      equipmentName: event.equipmentName,
      rarity: event.rarity,
      ...(event.overflowed ? { overflowed: true } : {})
    }));
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

export function buildHudPanelViewModel(
  state: VeilHudRenderState,
  onLearnSkill?: ((skillId: string) => void) | null
): HudPanelViewModel {
  const hero = state.update?.world.ownHeroes[0] ?? null;
  const world = state.update?.world ?? null;
  const resources = world?.resources ?? null;
  const battle = state.update?.battle ?? null;
  const skillPanelView = buildCocosHudSkillPanelView(state.update, onLearnSkill ?? undefined);
  const progressMeter = hero ? createHeroProgressMeterView({ progression: { ...hero.progression } }) : null;
  const attributeRows = hero ? createHeroAttributeBreakdown(toHudHeroSkillState(hero), world ?? undefined) : [];
  const attackTotal = attributeRows.find((row) => row.key === "attack")?.total ?? hero?.stats.attack ?? 0;
  const defenseTotal = attributeRows.find((row) => row.key === "defense")?.total ?? hero?.stats.defense ?? 0;
  const powerTotal = attributeRows.find((row) => row.key === "power")?.total ?? hero?.stats.power ?? 0;
  const knowledgeTotal = attributeRows.find((row) => row.key === "knowledge")?.total ?? hero?.stats.knowledge ?? 0;
  const maxHpTotal = attributeRows.find((row) => row.key === "maxHp")?.total ?? hero?.stats.maxHp ?? 0;
  const equipmentLines = formatHeroEquipmentLines(hero, state.account.recentEventLog, toHudRecentLootEvents(state.update?.events ?? []));
  const equipmentRows = buildHeroEquipmentActionRows(hero);
  const equipmentLineCount = hero ? 1 + equipmentLines.length : 3;
  const equipmentCardHeight = Math.max(
    156,
    50 + equipmentLineCount * 16 + (equipmentRows.length > 0 ? Math.ceil(equipmentRows.length / 2) * 24 : 0)
  );
  const latestBattleReport = summarizeLatestBattleReplay(state.account.recentBattleReplays, state.account.recentEventLog);
  const reachableAhead =
    state.update?.reachableTiles.filter((tile) => !hero || tile.x !== hero.position.x || tile.y !== hero.position.y).length ?? 0;
  const sessionStatusBadge = getSessionIndicatorBadge(state.sessionIndicators);
  const sessionIndicatorLines = state.sessionIndicators.map((indicator) => `会话 ${indicator.label} · ${indicator.detail}`);
  const interactionLines = state.interaction ? [`交互 ${state.interaction.title}`, state.interaction.detail] : [];
  const worldFocusLines = state.worldFocus
    ? [`焦点 ${state.worldFocus.headline}`, state.worldFocus.detail, ...state.worldFocus.summaryLines]
    : [];
  const statusTitle = state.levelUpNotice?.title ?? state.worldFocus?.headline ?? "状态";
  const statusBadge = state.levelUpNotice
    ? "升级!"
    : state.worldFocus?.badge
      ? state.worldFocus.badge
      : sessionStatusBadge
        ? sessionStatusBadge
        : battle
          ? "战斗中"
          : hero && hero.move.remaining <= 0
            ? "体力耗尽"
            : "待命";
  const statusDetail = state.levelUpNotice?.detail
    || state.worldFocus?.detail
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
    ...worldFocusLines,
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
  const titleLines = [
    state.displayName ? `${state.displayName} · ${state.playerId}` : `玩家 ${state.playerId}`,
    `房间 ${state.roomId}`,
    ...(state.worldFocus ? [`当前焦点 · ${state.worldFocus.headline}`] : []),
    world
      ? `第 ${world.meta.day} 天 · 可达 ${reachableAhead}${state.sessionSource === "remote" ? state.authMode === "account" ? ` · 账号 ${state.loginId || state.playerId}` : " · 云端游客" : state.sessionSource === "local" ? " · 本地会话" : ""}`
      : `等待房间状态...${state.sessionSource === "remote" ? state.authMode === "account" ? ` · 账号 ${state.loginId || state.playerId}` : " · 云端游客" : state.sessionSource === "local" ? " · 本地会话" : ""}`
  ];
  const heroLines = hero
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
    : ["英雄", "等待房间状态...", "", "", "", "", "", ""];

  return {
    hero,
    world,
    battle,
    resources,
    skillPanelView,
    progressMeter,
    attributeRows,
    attackTotal,
    defenseTotal,
    powerTotal,
    knowledgeTotal,
    maxHpTotal,
    equipmentLines,
    equipmentRows,
    equipmentCardHeight,
    latestBattleReport,
    sessionStatusBadge,
    statusBadge,
    statusLines,
    titleLines,
    heroLines,
    worldFocusLines,
    interactionLines
  };
}
