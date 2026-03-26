import type { BattleAction, BattleState, SessionUpdate } from "./VeilCocosSession.ts";

export type BattleCamp = "attacker" | "defender";

export interface BattlePanelInput {
  update: SessionUpdate | null;
  timelineEntries: string[];
  controlledCamp: BattleCamp | null;
  selectedTargetId: string | null;
  actionPending: boolean;
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

export interface BattlePanelViewModel {
  title: string;
  summaryLines: string[];
  orderLines: string[];
  friendlyLines: string[];
  orderItems: BattlePanelOrderItem[];
  friendlyItems: BattlePanelFriendlyItem[];
  enemyTargets: BattlePanelUnitView[];
  actions: BattlePanelActionView[];
  idle: boolean;
}

export function buildBattlePanelViewModel(state: BattlePanelInput): BattlePanelViewModel {
  const battle = state.update?.battle;
  if (!battle) {
    return {
      title: "战斗面板",
      summaryLines: ["当前没有战斗。"],
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

  return {
    title: "战斗面板",
    summaryLines: [
      `${battle.id} · 第 ${battle.round} 回合`,
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
