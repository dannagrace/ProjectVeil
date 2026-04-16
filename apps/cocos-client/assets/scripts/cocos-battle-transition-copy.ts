import { formatEquipmentRarityLabel } from "./project-shared/equipment.ts";
import type { SessionUpdate, TerrainType, Vec2, WorldEvent } from "./VeilCocosSession.ts";

export interface BattleTransitionCopy {
  badge: string;
  title: string;
  subtitle: string;
  tone: "enter" | "victory" | "defeat";
  terrain: TerrainType | null;
  summaryLines: string[];
  detailChips: BattleTransitionChip[];
}

export interface BattleTransitionChip {
  icon: "gold" | "wood" | "ore" | "hero" | "battle";
  label: string;
}

function formatResourceKindLabel(kind: "gold" | "wood" | "ore"): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
}

export function buildBattleEnterCopy(update: SessionUpdate): BattleTransitionCopy {
  const event = update.events.find((item) => item.type === "battle.started");
  const encounterPosition = resolveEncounterPosition(update);
  const terrain = resolveEncounterTerrain(update, encounterPosition);
  const terrainLabel = formatBattleTerrainLabel(terrain);
  if (!event) {
    return {
      badge: "ENCOUNTER",
      title: "遭遇战",
      subtitle: joinParts([terrainLabel, encounterPosition ? formatEncounterPosition(encounterPosition) : null, "切入战斗场景"]),
      tone: "enter",
      terrain,
      summaryLines: [],
      detailChips: []
    };
  }

  if (event.encounterKind === "hero") {
    return {
      badge: "PVP",
      title: event.defenderHeroId ? `PVP 对手 ${event.defenderHeroId}` : "PVP 英雄遭遇",
      subtitle: joinParts([
        terrainLabel,
        encounterPosition ? formatEncounterPosition(encounterPosition) : null,
        `${update.world.meta.roomId}/${event.battleId}`,
        event.initiator === "neutral" ? "对手抢先切入，多人对抗即将展开" : "我方先手切入，多人对抗即将展开"
      ]),
      tone: "enter",
      terrain,
      summaryLines: [],
      detailChips: [
        {
          icon: "hero",
          label: event.defenderHeroId ? `对手 ${event.defenderHeroId}` : "对手英雄"
        },
        {
          icon: "battle",
          label: `${update.world.meta.roomId}/${event.battleId}`
        }
      ]
    };
  }

  return {
    badge: event.initiator === "neutral" ? "AMBUSH" : "PVE",
    title: event.initiator === "neutral" ? "中立守军主动来袭" : "遭遇中立守军",
    subtitle: joinParts([
      terrainLabel,
      event.neutralArmyId ? `目标 ${event.neutralArmyId}` : null,
      encounterPosition ? formatEncounterPosition(encounterPosition) : null
    ]),
    tone: "enter",
    terrain,
    summaryLines: [],
    detailChips: []
  };
}

export function buildBattleExitCopy(previousBattle: SessionUpdate["battle"], update: SessionUpdate, didWin: boolean): BattleTransitionCopy {
  const terrain = resolveBattleTerrainFromBattle(update, previousBattle);
  const encounterPosition = previousBattle?.encounterPosition ?? null;
  const terrainLabel = terrain ? formatBattleTerrainLabel(terrain) : null;
  const isPvp = Boolean(previousBattle?.defenderHeroId);
  const summaryLines = buildBattleExitSummaryLines(previousBattle, update, didWin);
  const detailChips = buildBattleExitDetailChips(previousBattle, update.events, didWin);

  if (!didWin) {
    return {
      badge: isPvp ? "PVP" : "RETREAT",
      title: isPvp ? "英雄对决失利" : "战斗失利",
      subtitle: joinParts([
        terrainLabel,
        encounterPosition ? formatEncounterPosition(encounterPosition) : null,
        isPvp ? "对手仍保留在房间地图上，等待世界态回写" : "部队需要整顿后再战"
      ]),
      tone: "defeat",
      terrain,
      summaryLines,
      detailChips
    };
  }

  return {
    badge: isPvp ? "PVP" : "VICTORY",
    title: isPvp ? "英雄对决胜利" : "战斗胜利",
    subtitle: joinParts([
      terrainLabel,
      encounterPosition ? formatEncounterPosition(encounterPosition) : null,
      isPvp ? "PVP 结算已回写，房间返回世界地图" : "返回世界地图，继续推进前线"
    ]),
    tone: "victory",
    terrain,
    summaryLines,
    detailChips
  };
}

function resolveEncounterPosition(update: SessionUpdate): Vec2 | null {
  const battle = update.battle;
  if (!battle) {
    return null;
  }
  if (battle.encounterPosition) {
    return battle.encounterPosition;
  }

  return update.world.ownHeroes.find((hero) => hero.id === battle.worldHeroId)?.position ?? null;
}

function resolveEncounterTerrain(update: SessionUpdate, position: Vec2 | null): TerrainType {
  if (!position) {
    return "unknown";
  }

  const tile = update.world.map.tiles.find((entry) => entry.position.x === position.x && entry.position.y === position.y);
  return tile?.terrain ?? "unknown";
}

function resolveBattleTerrainFromBattle(update: SessionUpdate, battle: SessionUpdate["battle"]): TerrainType | null {
  if (!battle) {
    return null;
  }
  return resolveEncounterTerrain(update, battle.encounterPosition ?? null);
}

function buildBattleExitSummaryLines(
  previousBattle: SessionUpdate["battle"],
  update: SessionUpdate,
  didWin: boolean
): string[] {
  const isPvp = Boolean(previousBattle?.defenderHeroId);
  const rewardSummary = buildBattleExitRewardSummary(update.events);
  return [
    isPvp ? `结果：${didWin ? "PVP 胜利" : "PVP 失利"}` : `结果：${didWin ? "胜利" : "失利"}`,
    rewardSummary ? `奖励：${rewardSummary}` : "奖励：暂无额外掉落",
    buildBattleExitNextStepLine(previousBattle, didWin)
  ];
}

function buildBattleExitDetailChips(
  previousBattle: SessionUpdate["battle"],
  events: WorldEvent[],
  didWin: boolean
): BattleTransitionChip[] {
  const rewardSummary = collectBattleExitRewardSummary(events);
  const isPvp = Boolean(previousBattle?.defenderHeroId);
  const chips: BattleTransitionChip[] = [
    {
      icon: "battle",
      label: isPvp ? (didWin ? "PVP 胜利" : "PVP 失利") : didWin ? "胜利" : "失利"
    }
  ];

  if (rewardSummary.label) {
    chips.push({
      icon: rewardSummary.icon,
      label: rewardSummary.label
    });
  }

  chips.push({
    icon: "battle",
    label: buildBattleExitNextStepChipLabel(previousBattle, didWin)
  });

  return chips.slice(0, 3);
}

function collectBattleExitRewardSummary(events: WorldEvent[]): { label: string; icon: BattleTransitionChip["icon"] } {
  const resourceTotals: Record<"gold" | "wood" | "ore", number> = {
    gold: 0,
    wood: 0,
    ore: 0
  };
  let featuredEquipment: Extract<WorldEvent, { type: "hero.equipmentFound" }> | null = null;
  let progressionSummary: { level: number; levelsGained: number; experienceGained: number } | null = null;

  for (const event of events) {
    if (event.type === "hero.collected") {
      resourceTotals[event.resource.kind] += Math.max(0, event.resource.amount);
      continue;
    }

    if (event.type === "hero.equipmentFound") {
      if (!featuredEquipment || compareEquipmentPriority(event, featuredEquipment) >= 0) {
        featuredEquipment = event;
      }
      continue;
    }

    if (event.type === "hero.progressed") {
      progressionSummary = mergeProgressionSummary(progressionSummary, event);
    }
  }

  const rewardParts: string[] = [];
  const resourceKinds = (["gold", "wood", "ore"] as const).filter((kind) => resourceTotals[kind] > 0);
  rewardParts.push(...resourceKinds.map((kind) => `${formatResourceKindLabel(kind)} +${resourceTotals[kind]}`));
  if (progressionSummary) {
    rewardParts.push(
      progressionSummary.levelsGained > 0
        ? `Lv ${progressionSummary.level}`
        : `XP +${progressionSummary.experienceGained}`
    );
  }
  if (featuredEquipment) {
    rewardParts.push(
      featuredEquipment.overflowed
        ? `未拾取 ${trimChipLabel(featuredEquipment.equipmentName, 8)}`
        : `${formatEquipmentRarityLabel(featuredEquipment.rarity)} ${trimChipLabel(featuredEquipment.equipmentName, 10)}`
    );
  }

  return {
    label: rewardParts.length > 0 ? rewardParts.join(" / ") : "",
    icon: resolveBattleExitRewardIcon(resourceTotals, Boolean(progressionSummary), Boolean(featuredEquipment))
  };
}

function buildBattleExitRewardSummary(events: WorldEvent[]): string {
  return collectBattleExitRewardSummary(events).label;
}

function buildBattleExitNextStepLine(previousBattle: SessionUpdate["battle"], didWin: boolean): string {
  if (previousBattle?.defenderHeroId) {
    return didWin ? "下一步：等待房间回写后返回世界地图" : "下一步：等待房间回写后再调整对抗";
  }

  return didWin ? "下一步：返回世界地图继续推进当前回合" : "下一步：整顿部队后再尝试推进";
}

function buildBattleExitNextStepChipLabel(previousBattle: SessionUpdate["battle"], didWin: boolean): string {
  if (previousBattle?.defenderHeroId) {
    return didWin ? "等待回写后返回世界地图" : "等待回写后再调整对抗";
  }

  return didWin ? "返回世界地图" : "整顿部队后再战";
}

function resolveBattleExitRewardIcon(
  resourceTotals: Record<"gold" | "wood" | "ore", number>,
  hasProgression: boolean,
  hasEquipment: boolean
): BattleTransitionChip["icon"] {
  if (resourceTotals.gold > 0) {
    return "gold";
  }
  if (resourceTotals.wood > 0) {
    return "wood";
  }
  if (resourceTotals.ore > 0) {
    return "ore";
  }
  if (hasProgression) {
    return "hero";
  }
  if (hasEquipment) {
    return "battle";
  }
  return "battle";
}

function mergeProgressionSummary(
  summary: { level: number; levelsGained: number; experienceGained: number } | null,
  event: Extract<WorldEvent, { type: "hero.progressed" }>
): { level: number; levelsGained: number; experienceGained: number } {
  if (!summary) {
    return {
      level: event.level,
      levelsGained: event.levelsGained,
      experienceGained: Math.max(0, event.experienceGained)
    };
  }

  return {
    level: Math.max(summary.level, event.level),
    levelsGained: summary.levelsGained + Math.max(0, event.levelsGained),
    experienceGained: summary.experienceGained + Math.max(0, event.experienceGained)
  };
}

function compareEquipmentPriority(
  next: Extract<WorldEvent, { type: "hero.equipmentFound" }>,
  current: Extract<WorldEvent, { type: "hero.equipmentFound" }>
): number {
  return equipmentPriorityValue(next.rarity) - equipmentPriorityValue(current.rarity);
}

function equipmentPriorityValue(rarity: Extract<WorldEvent, { type: "hero.equipmentFound" }>["rarity"]): number {
  return rarity === "epic" ? 3 : rarity === "rare" ? 2 : 1;
}

function trimChipLabel(label: string, maxLength: number): string {
  const compact = label.trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxLength - 1))}…`;
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

function formatEncounterPosition(position: Vec2): string {
  return `坐标 (${position.x},${position.y})`;
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}
