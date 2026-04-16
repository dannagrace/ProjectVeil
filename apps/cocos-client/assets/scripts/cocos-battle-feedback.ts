import type { CocosBattleFeedbackTone } from "./project-shared/index.ts";
import type { BattleAction, BattleState, SessionUpdate } from "./VeilCocosSession.ts";
import type { CocosBossPhaseTransitionEvent } from "./cocos-boss-phase-ui.ts";

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
  skillName: string | null;
}

interface BattleSettlementSummary {
  detail: string;
  lines: string[];
}

interface BattleResolvedView {
  result: "attacker_victory" | "defender_victory";
  heroId: string;
  defenderHeroId: string | null;
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
    const isPvp = Boolean(battle.defenderHeroId);
    return {
      title: isPvp ? "PVP 对抗已展开" : "PVE 遭遇已展开",
      detail: isPvp
        ? `对手 ${battle.defenderHeroId ?? "未知"} · 房间 ${update.world.meta.roomId}/${battle.id} 已锁定，胜负会直接回写房间态`
        : battle.log[battle.log.length - 1] ?? "战斗开始",
      badge: "ENGAGE",
      tone: "action"
    };
  }

  const resolved = update.events.find((event) => event.type === "battle.resolved");
  if (!resolved) {
    if (!previousBattle) {
      return null;
    }

    const settlement = buildBattleSettlementSummary(previousBattle, update, heroId);
    return {
      title: previousBattle?.defenderHeroId ? "PVP 结果回写中" : "战果回写中",
      detail: settlement.detail,
      badge: "SETTLE",
      tone: "neutral"
    };
  }

  const didWin =
    heroId
      ? resolved.result === "attacker_victory"
        ? resolved.heroId === heroId
        : resolved.defenderHeroId === heroId
      : resolved.result === "attacker_victory";
  const settlement = buildBattleSettlementSummary(previousBattle, update, heroId);

  return {
    title: previousBattle?.defenderHeroId ? (didWin ? "PVP 胜利" : "PVP 失利") : didWin ? "战斗胜利" : "战斗失利",
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
    const skillPrefix = analysis.skillName ? `${analysis.skillName} 命中，` : "";
    return {
      title: `${skillPrefix}${primaryTarget} 已被击倒`,
      detail: analysis.latestLog || "单位已离场，战线出现缺口",
      badge: "K.O.",
      tone: "hit"
    };
  }

  if (analysis.skillTriggered && analysis.damagedUnits.length > 0) {
    const primaryTarget = analysis.damagedUnits[0];
    return {
      title: `${analysis.skillName ?? "主动技能"} 命中，${primaryTarget} 受到打击`,
      detail: analysis.latestLog || "技能伤害已结算",
      badge: "SKILL",
      tone: "skill"
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
    const skillPrefix = analysis.skillName ? `${analysis.skillName} 命中，` : "";
    return {
      title: `${skillPrefix}${analysis.damagedUnits[0]} 受到打击`,
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

export function buildBossPhaseTransitionFeedback(event: CocosBossPhaseTransitionEvent): CocosBattleFeedbackView {
  return {
    title: `${event.bossName} 进入 ${event.nextPhaseLabel}`,
    detail: event.bannerDetail,
    badge: `P${event.nextPhaseIndex + 1}`,
    tone: "skill"
  };
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
    skillTriggered: latestLog.includes("施放"),
    skillName: inferTriggeredSkillName(nextBattle, latestLog)
  };
}

function inferTriggeredSkillName(nextBattle: BattleState, latestLog: string): string | null {
  if (!latestLog.includes("施放")) {
    return null;
  }

  for (const unit of Object.values(nextBattle.units)) {
    for (const skill of unit.skills ?? []) {
      if (skill.name && latestLog.includes(skill.name)) {
        return skill.name;
      }
    }
  }

  const matched = latestLog.match(/施放\s+(.+?)(?:，|。|,|$)/);
  return matched?.[1]?.trim() || null;
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
  const resolved = readBattleResolvedView(update);
  const rewards = collectSettlementRewardParts(update);
  const didWin = didHeroWinResolution(resolved, heroId);
  const resultStatus = describeSettlementResultState(previousBattle, didWin);
  const fieldStatus = describeSettlementFieldState(previousBattle, heroId, resolved);
  const encounterStatus = describeSettlementEncounterState(previousBattle, heroId, resolved);
  const handoffLabel = buildSettlementHandoffLabel(previousBattle, resolved, didWin);
  const lines = [resultStatus, fieldStatus, ...rewards, handoffLabel];
  const detailParts = [
    encounterStatus,
    resultStatus,
    fieldStatus,
    rewards.length > 0 ? rewards.join(" / ") : null,
    handoffLabel
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

function describeSettlementFieldState(
  previousBattle: BattleState | null,
  heroId: string | null,
  resolved: BattleResolvedView | null
): string {
  if (!previousBattle) {
    return "战线已完成收口";
  }

  const heroCamp = resolveHeroCamp(previousBattle, heroId);
  if (!heroCamp) {
    return "战线已完成收口";
  }

  const opposing = heroCamp === "attacker" ? "defender" : "attacker";
  let friendlyAlive = countAliveUnits(previousBattle, heroCamp);
  let enemyAlive = countAliveUnits(previousBattle, opposing);
  const didWin = didHeroWinResolution(resolved, heroId);
  if (didWin === true) {
    friendlyAlive = Math.max(1, friendlyAlive);
    enemyAlive = 0;
  } else if (didWin === false) {
    friendlyAlive = 0;
    enemyAlive = Math.max(1, enemyAlive);
  }
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

function describeSettlementEncounterState(
  previousBattle: BattleState | null,
  heroId: string | null,
  resolved: BattleResolvedView | null
): string {
  if (!previousBattle) {
    return "遭遇已关闭";
  }

  if (!previousBattle.defenderHeroId) {
    return "PVE 遭遇已关闭";
  }

  const didWin = didHeroWinResolution(resolved, heroId);
  if (didWin === true) {
    return `PVP 结算：对手 ${previousBattle.defenderHeroId} 已退出当前遭遇，房间会保留这场对抗结果`;
  }
  if (didWin === false) {
    return `PVP 结算：对手 ${previousBattle.defenderHeroId} 仍保留在当前房间，可回图后继续对抗`;
  }

  const heroCamp = resolveHeroCamp(previousBattle, heroId);
  const didHoldField =
    heroCamp === "attacker"
      ? countAliveUnits(previousBattle, "attacker") >= countAliveUnits(previousBattle, "defender")
      : heroCamp === "defender"
        ? countAliveUnits(previousBattle, "defender") >= countAliveUnits(previousBattle, "attacker")
        : true;
  return didHoldField
    ? `PVP 结算：对手 ${previousBattle.defenderHeroId} 已退出当前遭遇，房间会保留这场对抗结果`
    : `PVP 结算：对手 ${previousBattle.defenderHeroId} 仍保留在当前房间，可回图后继续对抗`;
}

function buildSettlementHandoffLabel(
  previousBattle: BattleState | null,
  resolved: BattleResolvedView | null,
  didWin: boolean | null
): string {
  if (previousBattle?.defenderHeroId) {
    const opponentLabel = previousBattle.defenderHeroId;
    if (didWin === true) {
      return resolved
        ? `下一步：返回世界地图，趁 ${opponentLabel} 还在同房间继续施压`
        : `下一步：等待房间回写胜负、名次与 ${opponentLabel} 的位置`;
    }
    if (didWin === false) {
      return resolved
        ? `下一步：回到世界地图补兵换技，再向 ${opponentLabel} 发起复仇`
        : `下一步：等待房间回写胜负、名次与 ${opponentLabel} 的位置`;
    }
    return `下一步：等待房间回写胜负、名次与 ${opponentLabel} 的位置`;
  }

  if (didWin === true) {
    return resolved ? "下一步：返回世界地图继续推进当前回合" : "下一步：等待世界地图确认奖励、占位与结算结果";
  }

  if (didWin === false) {
    return resolved ? "下一步：整顿部队后再尝试推进" : "下一步：等待世界地图确认奖励、占位与结算结果";
  }

  return resolved ? "下一步：返回世界地图确认奖励、占位与结算结果" : "下一步：等待世界地图确认奖励、占位与结算结果";
}

function describeSettlementResultState(previousBattle: BattleState | null, didWin: boolean | null): string {
  if (!previousBattle) {
    return "结果：未知";
  }

  if (didWin === true) {
    return previousBattle.defenderHeroId ? "结果：PVP 胜利" : "结果：胜利";
  }

  if (didWin === false) {
    return previousBattle.defenderHeroId ? "结果：PVP 失利" : "结果：失利";
  }

  return previousBattle.defenderHeroId ? "结果：PVP 结算回写中" : "结果：战果回写中";
}

function didHeroWinResolution(resolved: BattleResolvedView | null, heroId: string | null): boolean | null {
  if (!resolved) {
    return null;
  }

  if (!heroId) {
    return resolved.result === "attacker_victory";
  }

  if (resolved.result === "attacker_victory") {
    return resolved.heroId === heroId;
  }

  return resolved.defenderHeroId === heroId;
}

function readBattleResolvedView(update: SessionUpdate): BattleResolvedView | null {
  const resolved = update.events.find((event) => event.type === "battle.resolved");
  if (!resolved) {
    return null;
  }

  return {
    result: resolved.result,
    heroId: resolved.heroId,
    defenderHeroId: resolved.defenderHeroId ?? null
  };
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
