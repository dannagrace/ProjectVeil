import type { CocosBattleFeedbackTone } from "./project-shared/index.ts";
import type { BattleAction, BattleState, SessionUpdate, TerrainType, Vec2 } from "./VeilCocosSession.ts";
import type { CocosBattleFeedbackView } from "./cocos-battle-feedback.ts";
import type { CocosBattlePresentationState } from "./cocos-battle-presentation-controller.ts";
import {
  buildBossPhaseDescriptor,
  buildBossPhaseTracker,
  type CocosBossPhaseTrackerView,
  type CocosBossPhaseTransitionEvent
} from "./cocos-boss-phase-ui.ts";

export type BattleCamp = "attacker" | "defender";

export interface BattlePanelInput {
  update: SessionUpdate | null;
  timelineEntries: string[];
  controlledCamp: BattleCamp | null;
  selectedTargetId: string | null;
  actionPending: boolean;
  feedback: CocosBattleFeedbackView | null;
  presentationState: CocosBattlePresentationState | null;
  recovery?: BattlePanelRecoveryView | null;
}

export interface BattlePanelRecoveryView {
  title: string;
  detail: string;
  badge: string;
  tone: CocosBattleFeedbackTone;
  summaryLines: string[];
}

export interface BattlePanelUnitView {
  id: string;
  label: string;
  title: string;
  meta: string;
  badge: string;
  selected: boolean;
  selectable: boolean;
}

export interface BattlePanelActionView {
  key: string;
  label: string;
  subtitle: string;
  enabled: boolean;
  action: BattleAction | null;
}

export interface BattlePanelOrderItem {
  id: string;
  title: string;
  meta: string;
  badge: string;
  active: boolean;
}

export interface BattlePanelFriendlyItem {
  id: string;
  title: string;
  meta: string;
  badge: string;
}

export interface BattlePanelStageView {
  terrain: TerrainType;
  title: string;
  subtitle: string;
  badge: string;
}

export interface BattlePanelPhaseBannerView {
  key: string;
  title: string;
  detail: string;
  badge: string;
}

export interface BattlePanelViewModel {
  title: string;
  stage: BattlePanelStageView | null;
  phaseBanner: BattlePanelPhaseBannerView | null;
  bossPhaseTracker: CocosBossPhaseTrackerView | null;
  feedback: CocosBattleFeedbackView | null;
  summaryLines: string[];
  orderLines: string[];
  friendlyLines: string[];
  orderItems: BattlePanelOrderItem[];
  friendlyItems: BattlePanelFriendlyItem[];
  enemyTargets: BattlePanelUnitView[];
  actions: BattlePanelActionView[];
  idle: boolean;
}

export interface BattlePanelSections {
  stage: BattlePanelStageView | null;
  phaseBanner: BattlePanelPhaseBannerView | null;
  bossPhaseTracker: CocosBossPhaseTrackerView | null;
  orderItems: BattlePanelOrderItem[];
  friendlyItems: BattlePanelFriendlyItem[];
  enemyTargets: BattlePanelUnitView[];
  actions: BattlePanelActionView[];
  idle: boolean;
}

export function buildBattlePanelViewModel(state: BattlePanelInput): BattlePanelViewModel {
  const battle = state.update?.battle;
  if (!battle) {
    const presentationSummary = state.recovery
      ? state.recovery.summaryLines
      : state.presentationState
        ? [
            state.presentationState.label,
            ...buildBattleResultContextLines(state.presentationState),
            ...state.presentationState.summaryLines
          ]
        : ["当前没有战斗。"];
    return {
      title: state.recovery ? "结算恢复" : state.presentationState?.phase === "resolution" ? "战斗结算" : "战斗面板",
      stage: null,
      phaseBanner: null,
      bossPhaseTracker: null,
      feedback: state.recovery
        ? {
            title: state.recovery.title,
            detail: state.recovery.detail,
            badge: state.recovery.badge,
            tone: state.recovery.tone
          }
        : state.feedback,
      summaryLines: presentationSummary,
      orderLines: [],
      friendlyLines: [],
      orderItems: [],
      friendlyItems: [],
      enemyTargets: [],
      actions: [],
      idle: true
    };
  }

  const activeUnit = battle.activeUnitId ? battle.units[battle.activeUnitId] ?? null : null;
  const controlLabel = state.controlledCamp ? (state.controlledCamp === "attacker" ? "我方先攻" : "我方守备") : "旁观视角";
  const turnLabel = state.actionPending
    ? "正在结算行动..."
    : activeUnit && state.controlledCamp
      ? activeUnit.camp === state.controlledCamp
        ? "轮到我方"
        : "轮到对方"
      : activeUnit
        ? `${activeUnit.camp === "attacker" ? "进攻方" : "防守方"}行动`
        : "等待中";
  const friendlyCamp = state.controlledCamp;
  const enemyCamp = opposingCamp(friendlyCamp);
  const friendlyUnits = friendlyCamp ? collectUnitsForCamp(battle, friendlyCamp).map(formatFriendlyUnitLine) : ["旁观视角"];
  const enemyUnits = enemyCamp ? collectUnitsForCamp(battle, enemyCamp) : [];
  const selectedTargetId =
    state.selectedTargetId && enemyUnits.some((unit) => unit.id === state.selectedTargetId)
      ? state.selectedTargetId
      : enemyUnits[0]?.id ?? null;
  const enemyTargets = enemyUnits.map((unit) => ({
    id: unit.id,
    selected: unit.id === selectedTargetId,
    selectable: true,
    label: `${unit.id === selectedTargetId ? ">" : " "} ${formatEnemyUnitLine(unit)}`,
    title: `${unit.stackName} x${unit.count}`,
    meta: buildTargetMeta(unit),
    badge: unit.id === selectedTargetId ? "已选中" : "可攻击"
  }));
  const canAct = Boolean(activeUnit && friendlyCamp && activeUnit.camp === friendlyCamp && !state.actionPending);
  const attackTarget = enemyUnits.find((unit) => unit.id === selectedTargetId) ?? enemyUnits[0] ?? null;
  const actions = buildActions(canAct, activeUnit, attackTarget);
  const orderLines = battle.turnOrder.map((unitId, index) => {
    const unit = battle.units[unitId];
    if (!unit || unit.count <= 0) {
      return `${index + 1}. ${unitId}`;
    }

    const activeMarker = unit.id === battle.activeUnitId ? ">" : `${index + 1}.`;
    return `${activeMarker} ${unit.stackName} x${unit.count}${formatInlineTags(unit)}`;
  });
  const orderItems = battle.turnOrder
    .map((unitId, index) => {
      const unit = battle.units[unitId];
      if (!unit || unit.count <= 0) {
        return null;
      }

      const active = unit.id === battle.activeUnitId;
      const inlineTags = formatInlineTags(unit).trim();
      return {
        id: unit.id,
        title: `${unit.stackName} x${unit.count}`,
        meta: `${unit.camp === "attacker" ? "进攻方" : "防守方"} · ${inlineTags || "准备中"}`,
        badge: active ? "行动中" : `${index + 1}`,
        active
      };
    })
    .filter((item): item is BattlePanelOrderItem => Boolean(item));
  const friendlyItems = friendlyCamp
    ? collectUnitsForCamp(battle, friendlyCamp).map((unit) => ({
        id: unit.id,
        title: `${unit.stackName} x${unit.count}`,
        meta: buildFriendlyMeta(unit),
        badge: unit.defending ? "防御" : unit.hasRetaliated ? "已反击" : "待命"
      }))
    : [];
  const skillSummaryLines = activeUnit ? buildSkillSummaryLines(activeUnit) : [];
  const statusSummary = activeUnit ? buildStatusSummary(activeUnit) : "无异常";
  const stage = buildBattleStageView(state.update, battle);
  const phaseBanner = buildPhaseBannerView(state.presentationState?.phaseTransitionEvent ?? null);
  const bossPhaseTracker = buildBossPhaseTracker(battle);
  const bossPhaseDescriptor = buildBossPhaseDescriptor(battle);
  const presentationLines = buildBattlePresentationContextLines(state.update, battle, state.presentationState, canAct, state.actionPending);

  return {
    title: resolveBattlePanelTitle(state.presentationState),
    stage,
    phaseBanner,
    bossPhaseTracker,
    feedback: state.feedback,
    summaryLines: [
      `${battle.id} · 第 ${battle.round} 回合`,
      ...presentationLines,
      ...(bossPhaseDescriptor
        ? [
            `首领阶段：${bossPhaseDescriptor.phaseLabel} · 阈值 ${bossPhaseDescriptor.thresholdPercent}% HP`,
            `阶段提示：${bossPhaseDescriptor.detail}`
          ]
        : []),
      ...(state.presentationState?.summaryLines ?? []),
      `阵营：${controlLabel}`,
      `阶段：${turnLabel}`,
      `行动单位：${activeUnit ? formatActiveUnitLine(activeUnit) : "等待中"}`,
      ...skillSummaryLines,
      `状态：${statusSummary}`,
      ...buildEnvironmentSummaryLines(battle)
    ],
    orderLines: ["行动顺序", ...(orderLines.length > 0 ? orderLines : ["等待中"])],
    friendlyLines: ["我方单位", ...friendlyUnits],
    orderItems,
    friendlyItems,
    enemyTargets,
    actions,
    idle: false
  };
}

function resolveBattlePanelTitle(presentationState: CocosBattlePresentationState | null): string {
  switch (presentationState?.phase) {
    case "enter":
      return "战斗展开";
    case "command":
      return "战斗指令";
    case "impact":
      return "战斗反馈";
    case "resolution":
      return "战斗结算";
    default:
      return "战斗面板";
  }
}

export function buildBattlePanelSections(state: BattlePanelInput): BattlePanelSections {
  const model = buildBattlePanelViewModel(state);
  return {
    stage: model.stage,
    phaseBanner: model.phaseBanner,
    bossPhaseTracker: model.bossPhaseTracker,
    orderItems: model.orderItems,
    friendlyItems: model.friendlyItems,
    enemyTargets: model.enemyTargets,
    actions: model.actions,
    idle: model.idle
  };
}

function buildPhaseBannerView(event: CocosBossPhaseTransitionEvent | null): BattlePanelPhaseBannerView | null {
  if (!event) {
    return null;
  }

  return {
    key: event.key,
    title: event.bannerTitle,
    detail: event.bannerDetail,
    badge: `P${event.nextPhaseIndex + 1}`
  };
}

function buildBattleStageView(update: SessionUpdate | null, battle: BattleState): BattlePanelStageView {
  const encounterPosition = resolveEncounterPosition(update, battle);
  const terrain = resolveEncounterTerrain(update, encounterPosition);
  const title = `${formatBattleTerrainLabel(terrain)} · ${formatEncounterLabel(battle)}`;
  const subtitleParts = [
    encounterPosition ? `坐标 (${encounterPosition.x},${encounterPosition.y})` : null,
    formatHazardSummary(battle)
  ].filter((part): part is string => Boolean(part));

  return {
    terrain,
    title,
    subtitle: subtitleParts.join(" · "),
    badge: battle.defenderHeroId ? "PVP" : battle.neutralArmyId ? "PVE" : "BATTLE"
  };
}

function buildBattlePresentationContextLines(
  update: SessionUpdate | null,
  battle: BattleState,
  presentationState: CocosBattlePresentationState | null,
  canAct: boolean,
  actionPending: boolean
): string[] {
  const roomId = update?.world.meta.roomId ?? "unknown-room";
  return [
    `流程：${formatBattleJourneyLine(presentationState)}`,
    `会话：${roomId}/${battle.id} · ${formatEncounterLabel(battle)}`,
    `表现：${presentationState?.badge ?? "LIVE"} · ${presentationState?.label ?? "战斗进行中"}`,
    `下一步：${resolveBattleNextStepLine(presentationState, canAct, actionPending)}`
  ];
}

function buildBattleResultContextLines(presentationState: CocosBattlePresentationState): string[] {
  const battleId = presentationState.battleId ? `会话：${presentationState.battleId} · ${presentationState.badge}` : null;
  return [
    `流程：${formatBattleJourneyLine(presentationState)}`,
    battleId,
    `下一步：${resolveBattleResultNextStepLine(presentationState)}`
  ].filter((line): line is string => Boolean(line));
}

function formatBattleJourneyLine(presentationState: CocosBattlePresentationState | null): string {
  const activePhase = resolveBattleJourneyPhaseLabel(presentationState);
  return `进场确认 -> 指令下达 -> 受击反馈 -> 战果结算 · 当前 ${activePhase}`;
}

function resolveBattleJourneyPhaseLabel(presentationState: CocosBattlePresentationState | null): string {
  switch (presentationState?.phase) {
    case "enter":
      return "进场确认";
    case "command":
      return "指令下达";
    case "impact":
      return "受击反馈";
    case "resolution":
      return "战果结算";
    default:
      return "现场回合";
  }
}

function resolveBattleNextStepLine(
  presentationState: CocosBattlePresentationState | null,
  canAct: boolean,
  actionPending: boolean
): string {
  if (actionPending) {
    return "等待权威结算当前指令";
  }

  switch (presentationState?.phase) {
    case "enter":
      return "确认遭遇信息后选择目标并下达首个指令";
    case "command":
      return "等待本次指令返回伤害、状态或技能结果";
    case "impact":
      return canAct ? "确认受击结果后继续选择目标或技能" : "等待下一行动方接管回合";
    case "resolution":
      return resolveBattleResultNextStepLine(presentationState);
    default:
      return canAct ? "选择目标并下达指令" : "等待对方行动或权威同步";
  }
}

function resolveBattleResultNextStepLine(presentationState: CocosBattlePresentationState): string {
  if (presentationState.result === "victory") {
    return "返回世界地图并继续推进当前回合";
  }
  if (presentationState.result === "defeat") {
    return "等待世界地图回写后调整部队与下一行动";
  }
  return "等待世界地图确认奖励、占位与最终结算";
}

function resolveEncounterPosition(update: SessionUpdate | null, battle: BattleState): Vec2 | null {
  if (battle.encounterPosition) {
    return battle.encounterPosition;
  }

  const heroPosition = update?.world.ownHeroes.find((hero) => hero.id === battle.worldHeroId)?.position;
  return heroPosition ?? null;
}

function resolveEncounterTerrain(update: SessionUpdate | null, position: Vec2 | null): TerrainType {
  if (!update || !position) {
    return "unknown";
  }

  const tile = update.world.map.tiles.find(
    (entry) => entry.position.x === position.x && entry.position.y === position.y
  );
  return tile?.terrain ?? "unknown";
}

function formatBattleTerrainLabel(terrain: TerrainType): string {
  switch (terrain) {
    case "grass":
      return "草野战场";
    case "dirt":
      return "荒地战场";
    case "sand":
      return "沙原战场";
    case "water":
      return "水域战场";
    default:
      return "未知战场";
  }
}

function formatEncounterLabel(battle: BattleState): string {
  if (battle.defenderHeroId) {
    return "英雄对决";
  }
  if (battle.neutralArmyId) {
    return "中立遭遇";
  }
  return "战场交锋";
}

function formatHazardSummary(battle: BattleState): string {
  const visibleHazards = (battle.environment ?? []).filter((hazard) => hazard.kind === "blocker" || hazard.revealed);
  if (visibleHazards.length === 0) {
    return "无额外障碍";
  }

  const blockers = visibleHazards.filter((hazard) => hazard.kind === "blocker").length;
  const traps = visibleHazards.filter((hazard) => hazard.kind === "trap").length;
  const parts: string[] = [];
  if (blockers > 0) {
    parts.push(`${blockers} 阻挡`);
  }
  if (traps > 0) {
    parts.push(`${traps} 陷阱`);
  }
  return parts.join(" / ");
}

function collectUnitsForCamp(battle: BattleState, camp: BattleCamp) {
  const aliveUnits = Object.values(battle.units).filter((unit) => unit.camp === camp && unit.count > 0);
  const queueIndex = new Map(battle.turnOrder.map((unitId, index) => [unitId, index]));
  return aliveUnits.sort((left, right) => {
    if (left.id === battle.activeUnitId) {
      return -1;
    }

    if (right.id === battle.activeUnitId) {
      return 1;
    }

    const leftIndex = queueIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = queueIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return right.initiative - left.initiative;
  });
}

function formatFriendlyUnitLine(unit: BattleState["units"][string]): string {
  return `${formatUnitMarker(unit)} ${unit.stackName} x${unit.count} 生命 ${unit.currentHp}/${unit.maxHp} · ${unit.lane + 1}线`;
}

function formatEnemyUnitLine(unit: BattleState["units"][string]): string {
  return `${unit.stackName} x${unit.count} 生命 ${unit.currentHp}/${unit.maxHp} · ${unit.lane + 1}线`;
}

function formatActiveUnitLine(unit: BattleState["units"][string]): string {
  return `${unit.stackName} x${unit.count}${formatInlineTags(unit)}`;
}

function formatUnitMarker(unit: BattleState["units"][string]): string {
  if ((unit.statusEffects ?? []).some((status) => status.id === "poisoned")) {
    return "[PSN]";
  }

  if (unit.defending) {
    return "[DEF]";
  }

  if (unit.hasRetaliated) {
    return "[RET]";
  }

  return "[RDY]";
}

function formatInlineTags(unit: BattleState["units"][string]): string {
  const tags: string[] = [];
  for (const status of unit.statusEffects ?? []) {
    tags.push(`${status.name}${status.durationRemaining}`);
  }
  if (unit.defending) {
    tags.push("DEF");
  }
  if (unit.hasRetaliated) {
    tags.push("RET");
  }
  return tags.length > 0 ? ` (${tags.join("/")})` : "";
}

function compactBattleText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatSkillToken(skill: NonNullable<BattleState["units"][string]["skills"]>[number]): string {
  const targetToken = skill.target === "enemy" ? "敌" : "自";
  const cooldownToken = skill.kind === "passive" ? "常驻" : skill.remainingCooldown > 0 ? `CD${skill.remainingCooldown}` : "就绪";
  return `${skill.name}[${targetToken}/${cooldownToken}]`;
}

function buildSkillSummaryLines(unit: BattleState["units"][string]): string[] {
  const skills = unit.skills ?? [];
  if (skills.length === 0) {
    return ["技能：普通攻击"];
  }

  const lines: string[] = [];
  for (let index = 0; index < skills.length; index += 2) {
    const chunk = skills.slice(index, index + 2).map(formatSkillToken);
    lines.push(`技能${Math.floor(index / 2) + 1}：${chunk.join(" / ")}`);
  }
  return lines;
}

function buildStatusSummary(unit: BattleState["units"][string]): string {
  const parts = (unit.statusEffects ?? []).map((status) => `${status.name}${status.durationRemaining}`);
  if (unit.defending) {
    parts.push("防御");
  }
  if (unit.hasRetaliated) {
    parts.push("已反击");
  }
  return parts.length > 0 ? parts.join(" / ") : "无异常";
}

function hasSkillLock(unit: BattleState["units"][string]): boolean {
  return (unit.statusEffects ?? []).some((status) => status.blocksActiveSkills);
}

function buildTargetMeta(unit: BattleState["units"][string]): string {
  const parts = [`${unit.lane + 1}线`, `生命 ${unit.currentHp}/${unit.maxHp}`];
  if (unit.defending) {
    parts.push("防御中");
  }
  if (unit.hasRetaliated) {
    parts.push("已反击");
  }
  if ((unit.statusEffects ?? []).length > 0) {
    parts.push((unit.statusEffects ?? []).map((status) => `${status.name}${status.durationRemaining}`).join("/"));
  }
  return parts.join(" · ");
}

function buildFriendlyMeta(unit: BattleState["units"][string]): string {
  const parts = [`${unit.lane + 1}线`, `生命 ${unit.currentHp}/${unit.maxHp}`];
  if ((unit.skills ?? []).length > 0) {
    parts.push(`技能 ${(unit.skills ?? []).length}`);
  }
  const statusSummary = buildStatusSummary(unit);
  if (statusSummary !== "无异常") {
    parts.push(statusSummary);
  }
  return parts.join(" · ");
}

function buildEnvironmentSummaryLines(battle: BattleState): string[] {
  const hazards = battle.environment ?? [];
  const visibleHazards = hazards.filter((hazard) => hazard.kind === "blocker" || hazard.revealed);
  if (visibleHazards.length === 0) {
    return ["环境：当前战场没有额外障碍或陷阱"];
  }

  return visibleHazards.map((hazard, index) =>
    hazard.kind === "blocker"
      ? `环境${index + 1}：${hazard.lane + 1}线 ${hazard.name} ${hazard.durability}/${hazard.maxDurability}`
      : `环境${index + 1}：${hazard.lane + 1}线 ${hazard.name} · ${hazard.grantedStatusId === "slowed" ? "减速" : hazard.grantedStatusId === "silenced" ? "禁魔" : `${hazard.damage}伤`} · ${hazard.charges > 0 ? `${hazard.charges}次` : "已触发"}`
  );
}

function buildActions(
  canAct: boolean,
  activeUnit: BattleState["units"][string] | null,
  attackTarget: BattleState["units"][string] | null
): BattlePanelActionView[] {
  const activeUnitId = activeUnit?.id ?? null;
  const skillLocked = activeUnit ? hasSkillLock(activeUnit) : false;
  const actions: BattlePanelActionView[] = [
    {
      key: "attack",
      label: attackTarget ? `攻击 ${attackTarget.stackName}` : "攻击 --",
      subtitle: attackTarget ? `目标：${attackTarget.stackName} · ${buildTargetMeta(attackTarget)}` : "请选择一个目标",
      enabled: Boolean(canAct && activeUnitId && attackTarget),
      action:
        canAct && activeUnitId && attackTarget
          ? {
              type: "battle.attack",
              attackerId: activeUnitId,
              defenderId: attackTarget.id
            }
          : null
    },
    {
      key: "wait",
      label: "等待",
      subtitle: "延后到本轮稍后行动",
      enabled: Boolean(canAct && activeUnitId),
      action:
        canAct && activeUnitId
          ? {
              type: "battle.wait",
              unitId: activeUnitId
            }
          : null
    },
    {
      key: "defend",
      label: "防御",
      subtitle: "本回合提升防御姿态",
      enabled: Boolean(canAct && activeUnitId),
      action:
        canAct && activeUnitId
          ? {
              type: "battle.defend",
              unitId: activeUnitId
            }
          : null
    }
  ];

  for (const skill of activeUnit?.skills ?? []) {
    if (skill.kind !== "active") {
      continue;
    }

    if (skill.target === "enemy") {
      actions.push({
        key: `skill-${skill.id}`,
        label: skill.remainingCooldown > 0 ? `${skill.name} (${skill.remainingCooldown})` : skill.name,
        subtitle: skillLocked
          ? "已被禁魔，无法施法"
          : attackTarget
            ? `目标：${attackTarget.stackName} · ${compactBattleText(skill.description, 18)}`
            : "请选择一个敌方目标",
        enabled: Boolean(canAct && activeUnitId && attackTarget && skill.remainingCooldown === 0 && !skillLocked),
        action:
          canAct && activeUnitId && attackTarget && skill.remainingCooldown === 0 && !skillLocked
            ? {
                type: "battle.skill",
                unitId: activeUnitId,
                skillId: skill.id,
                targetId: attackTarget.id
              }
            : null
      });
      continue;
    }

    actions.push({
      key: `skill-${skill.id}`,
      label: skill.remainingCooldown > 0 ? `${skill.name} (${skill.remainingCooldown})` : skill.name,
      subtitle: skillLocked ? "已被禁魔，无法施法" : `自身增益 · ${compactBattleText(skill.description, 18)}`,
      enabled: Boolean(canAct && activeUnitId && skill.remainingCooldown === 0 && !skillLocked),
      action:
        canAct && activeUnitId && skill.remainingCooldown === 0 && !skillLocked
          ? {
              type: "battle.skill",
              unitId: activeUnitId,
              skillId: skill.id,
              targetId: activeUnitId
            }
          : null
    });
  }

  return actions;
}

function opposingCamp(camp: BattleCamp | null): BattleCamp | null {
  if (!camp) {
    return null;
  }

  return camp === "attacker" ? "defender" : "attacker";
}
