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
  selected: boolean;
  selectable: boolean;
}

export interface BattlePanelActionView {
  key: "attack" | "wait" | "defend";
  label: string;
  enabled: boolean;
  action: BattleAction | null;
}

export interface BattlePanelViewModel {
  title: string;
  summaryLines: string[];
  orderLines: string[];
  friendlyLines: string[];
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
    label: `${unit.id === selectedTargetId ? ">" : " "} ${formatEnemyUnitLine(unit)}`
  }));
  const canAct = Boolean(activeUnit && friendlyCamp && activeUnit.camp === friendlyCamp && !state.actionPending);
  const attackTarget = enemyUnits.find((unit) => unit.id === selectedTargetId) ?? enemyUnits[0] ?? null;
  const actions = buildActions(canAct, activeUnit?.id ?? null, attackTarget);
  const orderLines = battle.turnOrder.map((unitId, index) => {
    const unit = battle.units[unitId];
    if (!unit || unit.count <= 0) {
      return `${index + 1}. ${unitId}`;
    }

    const activeMarker = unit.id === battle.activeUnitId ? ">" : `${index + 1}.`;
    return `${activeMarker} ${unit.stackName} x${unit.count}${formatInlineTags(unit)}`;
  });

  return {
    title: "战斗面板",
    summaryLines: [
      `${battle.id} · 第 ${battle.round} 回合`,
      `阵营：${controlLabel}`,
      `阶段：${turnLabel}`,
      `行动单位：${activeUnit ? formatActiveUnitLine(activeUnit) : "等待中"}`
    ],
    orderLines: ["行动顺序", ...(orderLines.length > 0 ? orderLines : ["等待中"])],
    friendlyLines: ["我方单位", ...friendlyUnits],
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
  return `${formatUnitMarker(unit)} ${unit.stackName} x${unit.count} 生命 ${unit.currentHp}/${unit.maxHp}`;
}

function formatEnemyUnitLine(unit: BattleState["units"][string]): string {
  return `${unit.stackName} x${unit.count} 生命 ${unit.currentHp}/${unit.maxHp}`;
}

function formatActiveUnitLine(unit: BattleState["units"][string]): string {
  return `${unit.stackName} x${unit.count}${formatInlineTags(unit)}`;
}

function formatUnitMarker(unit: BattleState["units"][string]): string {
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
  if (unit.defending) {
    tags.push("DEF");
  }
  if (unit.hasRetaliated) {
    tags.push("RET");
  }
  return tags.length > 0 ? ` (${tags.join("/")})` : "";
}

function buildActions(
  canAct: boolean,
  activeUnitId: string | null,
  attackTarget: BattleState["units"][string] | null
): BattlePanelActionView[] {
  return [
    {
      key: "attack",
      label: attackTarget ? `攻击 ${attackTarget.stackName}` : "攻击 --",
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
}

function opposingCamp(camp: BattleCamp | null): BattleCamp | null {
  if (!camp) {
    return null;
  }

  return camp === "attacker" ? "defender" : "attacker";
}
