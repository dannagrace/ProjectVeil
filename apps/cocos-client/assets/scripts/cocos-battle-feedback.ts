import type { CocosBattleFeedbackTone } from "./project-shared/index.ts";
import type { BattleAction, BattleState, SessionUpdate } from "./VeilCocosSession.ts";

export interface CocosBattleFeedbackView {
  title: string;
  detail: string;
  badge: string;
  tone: CocosBattleFeedbackTone;
}

export interface BattleProgressAnalysis {
  latestLog: string;
  defeatedUnits: string[];
  damagedUnits: string[];
  skillTriggered: boolean;
}

interface BattleSettlementSummary {
  detail: string;
  lines: string[];
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

export function buildBattleTransitionFeedback(
  update: SessionUpdate,
  heroId: string | null,
  previousBattle: BattleState | null = null
): CocosBattleFeedbackView | null {
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
  const settlement = buildBattleSettlementSummary(previousBattle, update, heroId);

  return {
    title: didWin ? "战斗胜利" : "战斗失利",
    detail: settlement.detail,
    badge: didWin ? "WIN" : "LOSE",
    tone: didWin ? "victory" : "defeat"
  };
}

export function buildBattleProgressFeedback(
  previousBattle: BattleState | null,
  nextBattle: BattleState | null
): CocosBattleFeedbackView | null {
  const analysis = analyzeBattleProgress(previousBattle, nextBattle);
  if (!analysis) {
    return null;
  }

  if (analysis.defeatedUnits.length > 0) {
    const primaryTarget = analysis.defeatedUnits[0];
    return {
      title: `${primaryTarget} 已被击倒`,
      detail: analysis.latestLog || "单位已离场，战线出现缺口",
      badge: "K.O.",
      tone: "hit"
    };
  }

  if (analysis.skillTriggered) {
    return {
      title: "主动技能已触发",
      detail: analysis.latestLog || "技能进入结算阶段",
      badge: "SKILL",
      tone: "skill"
    };
  }

  if (analysis.damagedUnits.length > 0) {
    return {
      title: `${analysis.damagedUnits[0]} 受到打击`,
      detail: analysis.latestLog || "伤害已结算",
      badge: "HIT",
      tone: "hit"
    };
  }

  return analysis.latestLog
    ? {
        title: "战斗状态更新",
        detail: analysis.latestLog,
        badge: "LOG",
        tone: "neutral"
      }
    : null;
}

export function analyzeBattleProgress(
  previousBattle: BattleState | null,
  nextBattle: BattleState | null
): BattleProgressAnalysis | null {
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

  return {
    latestLog,
    defeatedUnits,
    damagedUnits,
    skillTriggered: latestLog.includes("施放")
  };
}

export function buildBattleSettlementLines(
  previousBattle: BattleState | null,
  update: SessionUpdate,
  heroId: string | null
): string[] {
  return buildBattleSettlementSummary(previousBattle, update, heroId).lines;
}

function buildBattleSettlementSummary(
  previousBattle: BattleState | null,
  update: SessionUpdate,
  heroId: string | null
): BattleSettlementSummary {
  const rewards = collectSettlementRewardParts(update);
  const fieldStatus = describeSettlementFieldState(previousBattle, heroId);
  const lines = [fieldStatus, ...rewards];
  const detailParts = [
    fieldStatus,
    rewards.length > 0 ? rewards.join(" / ") : null,
    "准备返回世界地图"
  ].filter((part): part is string => Boolean(part));

  return {
    detail: detailParts.join(" · "),
    lines
  };
}

function collectSettlementRewardParts(update: SessionUpdate): string[] {
  const parts: string[] = [];
  const resources = {
    gold: 0,
    wood: 0,
    ore: 0
  };
  let experienceGained = 0;
  let skillPointsAwarded = 0;
  let featuredEquipmentName = "";

  for (const event of update.events) {
    if (event.type === "hero.collected") {
      resources[event.resource.kind] += Math.max(0, event.resource.amount);
      continue;
    }

    if (event.type === "hero.progressed") {
      experienceGained += Math.max(0, event.experienceGained);
      skillPointsAwarded += Math.max(0, event.skillPointsAwarded);
      continue;
    }

    if (event.type === "hero.equipmentFound") {
      featuredEquipmentName = event.equipmentName;
      continue;
    }
  }

  const resolved = update.events.find((event) => event.type === "battle.resolved");
  const resolvedRecord = isRecord(resolved) ? (resolved as unknown as Record<string, unknown>) : null;
  const resolvedResources = resolvedRecord?.["resourcesGained"];
  if (isRecord(resolvedResources)) {
    resources.gold += readPositiveNumber(resolvedResources["gold"]);
    resources.wood += readPositiveNumber(resolvedResources["wood"]);
    resources.ore += readPositiveNumber(resolvedResources["ore"]);
  }
  experienceGained += readPositiveNumber(resolvedRecord?.["experienceGained"]);
  skillPointsAwarded += readPositiveNumber(resolvedRecord?.["skillPointsAwarded"]);

  if (resources.gold > 0 || resources.wood > 0 || resources.ore > 0) {
    const resourceParts = (["gold", "wood", "ore"] as const)
      .filter((kind) => resources[kind] > 0)
      .map((kind) => `${formatResourceLabel(kind)} +${resources[kind]}`);
    parts.push(`战利品：${resourceParts.join(" / ")}`);
  }

  if (experienceGained > 0 || skillPointsAwarded > 0) {
    const progressionParts = [];
    if (experienceGained > 0) {
      progressionParts.push(`XP +${experienceGained}`);
    }
    if (skillPointsAwarded > 0) {
      progressionParts.push(`技能点 +${skillPointsAwarded}`);
    }
    parts.push(`成长：${progressionParts.join(" / ")}`);
  }

  if (featuredEquipmentName) {
    parts.push(`掉落：${featuredEquipmentName}`);
  }

  return parts;
}

function describeSettlementFieldState(previousBattle: BattleState | null, heroId: string | null): string {
  if (!previousBattle) {
    return "战线已完成收口";
  }

  const heroCamp = resolveHeroCamp(previousBattle, heroId);
  if (!heroCamp) {
    return "战线已完成收口";
  }

  const friendlyAlive = countAliveUnits(previousBattle, heroCamp);
  const enemyAlive = countAliveUnits(previousBattle, heroCamp === "attacker" ? "defender" : "attacker");
  return `战线：我方剩余 ${friendlyAlive} 队 / 对方剩余 ${enemyAlive} 队`;
}

function resolveHeroCamp(previousBattle: BattleState, heroId: string | null): "attacker" | "defender" | null {
  if (!heroId) {
    return "attacker";
  }
  if (previousBattle.worldHeroId === heroId) {
    return "attacker";
  }
  if (previousBattle.defenderHeroId === heroId) {
    return "defender";
  }
  return null;
}

function countAliveUnits(previousBattle: BattleState, camp: "attacker" | "defender"): number {
  return Object.values(previousBattle.units).filter((unit) => unit.camp === camp && unit.count > 0).length;
}

function formatResourceLabel(kind: "gold" | "wood" | "ore"): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
}

function readPositiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
