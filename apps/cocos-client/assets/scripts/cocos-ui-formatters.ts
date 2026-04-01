import { getEquipmentDefinition } from "./project-shared/index.ts";
import { formatEquipmentActionReason } from "./cocos-hero-equipment.ts";
import type { SessionUpdate, Vec2, WorldEvent } from "./VeilCocosSession.ts";

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

function formatEquipmentSlotLabel(slot: string): string {
  return slot === "weapon" ? "武器" : slot === "armor" ? "护甲" : slot === "accessory" ? "饰品" : slot;
}

function formatNeutralMoveReason(reason: string): string {
  return reason === "chase" ? "主动追击" : reason === "return" ? "返回守位" : "沿巡逻路线移动";
}

export function formatSessionActionReason(reason: string): string {
  if (!reason) {
    return "未知原因";
  }

  if (reason.startsWith("equipment_")) {
    return formatEquipmentActionReason(reason);
  }

  switch (reason) {
    case "hero_not_found":
      return "当前英雄不存在";
    case "hero_not_on_building":
      return "英雄没有站在目标建筑上";
    case "hero_not_on_tile":
      return "英雄没有站在目标格子上";
    case "building_not_found":
      return "目标建筑不存在";
    case "building_not_recruitable":
      return "这个建筑当前不能招募";
    case "building_not_visitable":
      return "这个建筑当前不能访问";
    case "building_not_claimable":
      return "这个建筑当前不能占领";
    case "building_depleted":
      return "这个建筑今天已经没有可领取内容了";
    case "building_on_cooldown":
      return "这个建筑今天已经结算过了";
    case "not_enough_resources":
      return "当前资源不足";
    case "resource_tile_not_found":
      return "目标资源地块不存在";
    case "resource_missing":
      return "当前格子没有可采集资源";
    case "destination_not_found":
      return "目标地块不存在";
    case "destination_blocked":
      return "目标地块不可通行";
    case "destination_occupied":
      return "目标地块已被占据";
    case "path_not_found":
      return "当前找不到可行路径";
    case "not_enough_move_points":
      return "移动力不足";
    case "unit_not_active":
    case "attacker_not_active":
      return "当前还没轮到这个单位行动";
    case "unit_not_available":
    case "attacker_not_available":
      return "出手单位不存在或已经离场";
    case "defender_not_available":
      return "目标单位不存在或已经离场";
    case "friendly_fire_blocked":
      return "不能攻击友军";
    case "skill_not_available":
      return "当前单位没有这个技能";
    case "skill_disabled":
      return "这个技能当前不可用";
    case "skill_on_cooldown":
      return "这个技能还在冷却中";
    case "invalid_skill_target":
      return "这个技能不能指定这个目标";
    case "skill_target_missing":
      return "技能目标不存在";
    case "hero_skill_not_found":
      return "目标技能不存在";
    case "hero_skill_branch_not_found":
      return "技能分支配置缺失";
    case "not_enough_skill_points":
      return "技能点不足";
    case "hero_level_too_low":
      return "英雄等级不足";
    case "skill_max_rank_reached":
      return "该技能已经升满";
    case "skill_prerequisite_missing":
      return "缺少前置技能";
    default:
      return reason;
  }
}

export function describeSessionActionOutcome(
  update: Pick<SessionUpdate, "reason">,
  options: {
    successMessage: string;
    rejectedLabel: string;
  }
): { accepted: boolean; message: string } {
  if (!update.reason) {
    return {
      accepted: true,
      message: options.successMessage
    };
  }

  return {
    accepted: false,
    message: `${options.rejectedLabel}被拒绝：${formatSessionActionReason(update.reason)}`
  };
}

export function describeMoveAttemptFeedback(destination: Vec2, reason?: string): { message: string; tileFeedback: string } {
  if (reason === "not_enough_move_points") {
    return {
      message: "移动被拒绝：移动力不足",
      tileFeedback: "不足"
    };
  }

  if (reason === "destination_occupied") {
    return {
      message: `地块 (${destination.x}, ${destination.y}) 已被友军占据。`,
      tileFeedback: "占用"
    };
  }

  return {
    message: `地块 (${destination.x}, ${destination.y}) 当前不可达。`,
    tileFeedback: "不可达"
  };
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
    return event.buildingKind === "watchtower"
      ? `登上瞭望塔，视野提高 ${event.visionBonus}。`
      : `访问属性建筑，获得 ${formatHeroStatBonus(event.bonus)}。`;
  }

  if (event.type === "hero.claimedMine") {
    const resourceKind = typeof event.resourceKind === "string" ? event.resourceKind : "resource";
    const income = typeof event.income === "number" ? event.income : 0;
    return `采集矿场，获得 ${formatResourceKindLabel(resourceKind)} +${income}。`;
  }

  if (event.type === "hero.skillLearned") {
    return event.newRank > 1
      ? `${event.branchName} 分支的 ${event.skillName} 强化到 ${event.newRank} 阶。`
      : `习得 ${event.branchName} 分支技能 ${event.skillName}。`;
  }

  if (event.type === "hero.equipmentChanged") {
    const equippedName = event.equippedItemId
      ? getEquipmentDefinition(event.equippedItemId)?.name ?? event.equippedItemId
      : "";
    const unequippedName = event.unequippedItemId
      ? getEquipmentDefinition(event.unequippedItemId)?.name ?? event.unequippedItemId
      : "";
    const actionText =
      equippedName && unequippedName
        ? `装备 ${equippedName}，卸下 ${unequippedName}`
        : equippedName
          ? `装备 ${equippedName}`
          : unequippedName
            ? `卸下 ${unequippedName}`
            : "调整装备";
    return `${formatEquipmentSlotLabel(event.slot)}槽位已${actionText}。`;
  }

  if (event.type === "hero.equipmentFound") {
    return event.overflowed
      ? `战斗发现 ${event.equipmentName}，但背包已满，未能拾取。`
      : `战斗缴获 ${event.equipmentName}。`;
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
      ? `英雄获得 ${experienceGained} 经验并升到 ${level} 级，同时得到 ${event.skillPointsAwarded} 点技能点。`
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
    entries.push(`系统：操作被拒绝，原因是 ${formatSessionActionReason(update.reason)}`);
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
