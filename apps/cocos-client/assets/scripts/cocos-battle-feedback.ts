import type { CocosBattleFeedbackTone } from "./project-shared/index.ts";
import type { BattleAction, BattleState, SessionUpdate } from "./VeilCocosSession.ts";

export interface CocosBattleFeedbackView {
  title: string;
  detail: string;
  badge: string;
  tone: CocosBattleFeedbackTone;
}

export function buildBattleActionFeedback(
  action: BattleAction,
  battle: BattleState | null
): CocosBattleFeedbackView | null {
  if (!battle) {
    return null;
  }

  if (action.type === "battle.attack") {
    const attacker = battle.units[action.attackerId];
    const defender = battle.units[action.defenderId];
    return {
      title: `${attacker?.stackName ?? action.attackerId} 发起攻击`,
      detail: `目标 ${defender?.stackName ?? action.defenderId}，等待伤害结算`,
      badge: "ATTACK",
      tone: "action"
    };
  }

  if (action.type === "battle.skill") {
    const caster = battle.units[action.unitId];
    const skill = caster?.skills?.find((entry) => entry.id === action.skillId);
    const target = action.targetId ? battle.units[action.targetId] : null;
    return {
      title: `${caster?.stackName ?? action.unitId} 施放 ${skill?.name ?? action.skillId}`,
      detail: target ? `目标 ${target.stackName}，等待技能结算` : "技能进入结算阶段",
      badge: "SKILL",
      tone: "skill"
    };
  }

  if (action.type === "battle.defend") {
    const unit = battle.units[action.unitId];
    return {
      title: `${unit?.stackName ?? action.unitId} 进入防御`,
      detail: "本回合防御提高，等待敌方行动",
      badge: "GUARD",
      tone: "neutral"
    };
  }

  const unit = battle.units[action.unitId];
  return {
    title: `${unit?.stackName ?? action.unitId} 选择等待`,
    detail: "当前单位延后到本轮队尾行动",
    badge: "WAIT",
    tone: "neutral"
  };
}

export function buildBattleTransitionFeedback(update: SessionUpdate, heroId: string | null): CocosBattleFeedbackView | null {
  const battle = update.battle;
  const started = update.events.find((event) => event.type === "battle.started");
  if (battle && started) {
    return {
      title: battle.defenderHeroId ? "英雄遭遇已展开" : "中立遭遇已展开",
      detail: battle.log[battle.log.length - 1] ?? "战斗开始",
      badge: "ENGAGE",
      tone: "action"
    };
  }

  const resolved = update.events.find((event) => event.type === "battle.resolved");
  if (!resolved) {
    return null;
  }

  const didWin =
    heroId
      ? resolved.result === "attacker_victory"
        ? resolved.heroId === heroId
        : resolved.defenderHeroId === heroId
      : resolved.result === "attacker_victory";

  return {
    title: didWin ? "战斗胜利" : "战斗失利",
    detail: didWin ? "部队完成收口，准备返回世界地图" : "部队撤离战场，准备返回世界地图",
    badge: didWin ? "WIN" : "LOSE",
    tone: didWin ? "victory" : "defeat"
  };
}

export function buildBattleProgressFeedback(
  previousBattle: BattleState | null,
  nextBattle: BattleState | null
): CocosBattleFeedbackView | null {
  if (!previousBattle || !nextBattle) {
    return null;
  }

  const appendedLogs = nextBattle.log.slice(previousBattle.log.length).filter((entry) => entry.trim().length > 0);
  const latestLog = appendedLogs[appendedLogs.length - 1] ?? nextBattle.log[nextBattle.log.length - 1] ?? "";
  const defeatedUnits: string[] = [];
  const damagedUnits: string[] = [];

  for (const [unitId, nextUnit] of Object.entries(nextBattle.units)) {
    const previousUnit = previousBattle.units[unitId];
    if (!previousUnit) {
      continue;
    }

    if (previousUnit.count > 0 && nextUnit.count <= 0) {
      defeatedUnits.push(nextUnit.stackName);
      continue;
    }

    if (nextUnit.count < previousUnit.count || nextUnit.currentHp < previousUnit.currentHp) {
      damagedUnits.push(nextUnit.stackName);
    }
  }

  if (defeatedUnits.length > 0) {
    return {
      title: `${defeatedUnits.join(" / ")} 溃散`,
      detail: latestLog || "单位已被击倒",
      badge: "K.O.",
      tone: "hit"
    };
  }

  if (latestLog.includes("施放")) {
    return {
      title: "技能已触发",
      detail: latestLog,
      badge: "SKILL",
      tone: "skill"
    };
  }

  if (damagedUnits.length > 0) {
    return {
      title: `${damagedUnits[0]} 受到打击`,
      detail: latestLog || "伤害已结算",
      badge: "HIT",
      tone: "hit"
    };
  }

  if (!latestLog) {
    return null;
  }

  return {
    title: "战斗状态更新",
    detail: latestLog,
    badge: "LOG",
    tone: "neutral"
  };
}
