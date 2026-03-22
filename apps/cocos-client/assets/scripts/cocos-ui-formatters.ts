import type { SessionUpdate, WorldEvent } from "./VeilCocosSession.ts";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatWorldEvent(event: WorldEvent): string | null {
  if (event.type === "battle.started") {
    if (event.encounterKind === "hero") {
      return `遭遇敌方英雄 ${typeof event.defenderHeroId === "string" ? event.defenderHeroId : "unknown"}。`;
    }

    return `遭遇中立守军 ${typeof event.neutralArmyId === "string" ? event.neutralArmyId : "unknown"}。`;
  }

  if (event.type === "battle.resolved") {
    return `战斗结束：${event.result === "attacker_victory" ? "进攻方获胜" : "防守方获胜"}。`;
  }

  if (event.type === "hero.collected" && isObjectRecord(event.resource)) {
    const kind = typeof event.resource.kind === "string" ? event.resource.kind : "resource";
    const amount = typeof event.resource.amount === "number" ? event.resource.amount : 0;
    const kindLabel = kind === "gold" ? "金币" : kind === "wood" ? "木材" : kind === "ore" ? "矿石" : kind;
    return `采集 ${kindLabel} +${amount}。`;
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
