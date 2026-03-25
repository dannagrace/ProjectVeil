import type { SessionUpdate, WorldEvent } from "./VeilCocosSession.ts";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatHeroStatBonus(bonus: { attack: number; defense: number; power: number; knowledge: number }): string {
  return [
    bonus.attack > 0 ? `攻击 +${bonus.attack}` : "",
    bonus.defense > 0 ? `防御 +${bonus.defense}` : "",
    bonus.power > 0 ? `力量 +${bonus.power}` : "",
    bonus.knowledge > 0 ? `知识 +${bonus.knowledge}` : ""
  ]
    .filter(Boolean)
    .join(" / ");
}

function formatResourceKindLabel(kind: string): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : kind === "ore" ? "矿石" : kind;
}

function formatNeutralMoveReason(reason: string): string {
  return reason === "chase" ? "主动追击" : reason === "return" ? "返回守位" : "沿巡逻路线移动";
}

function formatWorldEvent(event: WorldEvent): string | null {
  if (event.type === "battle.started") {
    if (event.encounterKind === "hero") {
      return `遭遇敌方英雄 ${typeof event.defenderHeroId === "string" ? event.defenderHeroId : "unknown"}。`;
    }

    return event.initiator === "neutral"
      ? `中立守军 ${typeof event.neutralArmyId === "string" ? event.neutralArmyId : "unknown"} 主动发起战斗。`
      : `遭遇中立守军 ${typeof event.neutralArmyId === "string" ? event.neutralArmyId : "unknown"}。`;
  }

  if (event.type === "battle.resolved") {
    return `战斗结束：${event.result === "attacker_victory" ? "进攻方获胜" : "防守方获胜"}。`;
  }

  if (event.type === "hero.collected" && isObjectRecord(event.resource)) {
    const kind = typeof event.resource.kind === "string" ? event.resource.kind : "resource";
    const amount = typeof event.resource.amount === "number" ? event.resource.amount : 0;
    return `采集 ${formatResourceKindLabel(kind)} +${amount}。`;
  }

  if (event.type === "hero.recruited") {
    const count = typeof event.count === "number" ? event.count : 0;
    const unitTemplateId = typeof event.unitTemplateId === "string" ? event.unitTemplateId : "unit";
    return `在招募所补充 ${unitTemplateId} x${count}。`;
  }

  if (event.type === "hero.visited") {
    return `访问属性建筑，获得 ${formatHeroStatBonus(event.bonus)}。`;
  }

  if (event.type === "hero.claimedMine") {
    const resourceKind = typeof event.resourceKind === "string" ? event.resourceKind : "resource";
    const income = typeof event.income === "number" ? event.income : 0;
    return `占领资源矿场，每日产出 ${formatResourceKindLabel(resourceKind)} +${income}。`;
  }

  if (event.type === "resource.produced" && isObjectRecord(event.resource)) {
    const kind = typeof event.resource.kind === "string" ? event.resource.kind : "resource";
    const amount = typeof event.resource.amount === "number" ? event.resource.amount : 0;
    return `资源矿场结算 ${formatResourceKindLabel(kind)} +${amount}。`;
  }

  if (event.type === "neutral.moved") {
    return `中立守军 ${event.neutralArmyId} ${formatNeutralMoveReason(event.reason)}，移动到 (${event.to.x},${event.to.y})。`;
  }

  if (event.type === "hero.progressed") {
    const experienceGained = typeof event.experienceGained === "number" ? event.experienceGained : 0;
    const levelsGained = typeof event.levelsGained === "number" ? event.levelsGained : 0;
    const level = typeof event.level === "number" ? event.level : 0;
    return levelsGained > 0
      ? `英雄获得 ${experienceGained} 经验并升到 ${level} 级。`
      : `英雄获得 ${experienceGained} 经验。`;
  }

  if (event.type === "hero.moved") {
    const moveCost = typeof event.moveCost === "number" ? event.moveCost : 0;
    const destination = event.path[event.path.length - 1];
    return destination
      ? `移动了 ${moveCost} 步，到达 (${destination.x},${destination.y})。`
      : `移动了 ${moveCost} 步。`;
  }

  if (event.type === "turn.advanced") {
    const day = typeof event.day === "number" ? event.day : 0;
    return `进入第 ${day} 天。`;
  }

  return null;
}

export function buildTimelineEntriesFromUpdate(update: SessionUpdate): string[] {
  const entries: string[] = [];

  if (update.reason) {
    entries.push(`系统：操作被拒绝，原因是 ${update.reason}`);
  }

  if (update.movementPlan && update.movementPlan.travelPath.length > 1) {
    entries.push(
      `事件：计划移动 ${update.movementPlan.travelPath.length - 1} 格，前往 (${update.movementPlan.destination.x},${update.movementPlan.destination.y})。`
    );
  }

  for (const event of update.events) {
    const formatted = formatWorldEvent(event);
    if (formatted) {
      entries.push(`事件：${formatted}`);
    }
  }

  return entries;
}

export function formatSystemTimelineEntry(text: string): string {
  return `系统：${text}`;
}

export function pickRecentBattleTimeline(entries: string[], limit = 4): string[] {
  return entries
    .filter((entry) => entry.includes("战斗") || entry.includes("遭遇"))
    .slice(0, limit);
}
