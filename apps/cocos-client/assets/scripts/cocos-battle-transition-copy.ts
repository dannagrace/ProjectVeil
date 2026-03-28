import { formatEquipmentRarityLabel } from "./project-shared/equipment.ts";
import type { SessionUpdate, TerrainType, Vec2, WorldEvent } from "./VeilCocosSession.ts";

export interface BattleTransitionCopy {
  badge: string;
  title: string;
  subtitle: string;
  tone: "enter" | "victory" | "defeat";
  terrain: TerrainType | null;
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
      detailChips: []
    };
  }

  if (event.encounterKind === "hero") {
    return {
      badge: "PVP",
      title: event.defenderHeroId ? `敌方英雄 ${event.defenderHeroId}` : "敌方英雄遭遇",
      subtitle: joinParts([
        terrainLabel,
        encounterPosition ? formatEncounterPosition(encounterPosition) : null,
        event.initiator === "neutral" ? "对手抢先切入，准备迎战" : "双方部队展开接战"
      ]),
      tone: "enter",
      terrain,
      detailChips: []
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
    detailChips: []
  };
}

export function buildBattleExitCopy(previousBattle: SessionUpdate["battle"], update: SessionUpdate, didWin: boolean): BattleTransitionCopy {
  const terrain = resolveBattleTerrainFromBattle(update, previousBattle);
  const encounterPosition = previousBattle?.encounterPosition ?? null;
  const terrainLabel = terrain ? formatBattleTerrainLabel(terrain) : null;
  const detailChips = buildBattleExitDetailChips(update.events);

  if (!didWin) {
    return {
      badge: "RETREAT",
      title: "战斗失利",
      subtitle: joinParts([terrainLabel, encounterPosition ? formatEncounterPosition(encounterPosition) : null, "部队需要整顿后再战"]),
      tone: "defeat",
      terrain,
      detailChips: detailChips.slice(0, 3)
    };
  }

  return {
    badge: "VICTORY",
    title: "战斗胜利",
    subtitle: joinParts([terrainLabel, encounterPosition ? formatEncounterPosition(encounterPosition) : null, "返回世界地图，继续推进前线"]),
    tone: "victory",
    terrain,
    detailChips: detailChips.slice(0, 3)
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

function buildBattleExitDetailChips(events: WorldEvent[]): BattleTransitionChip[] {
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

  const resourceChips = (["gold", "wood", "ore"] as const)
    .filter((kind) => resourceTotals[kind] > 0)
    .map((kind) => ({
      icon: kind,
      label: `${formatResourceKindLabel(kind)} +${resourceTotals[kind]}`
    }));
  const equipmentChip = featuredEquipment
    ? {
        icon: "battle" as const,
        label: `${formatEquipmentRarityLabel(featuredEquipment.rarity)} ${trimChipLabel(featuredEquipment.equipmentName, 10)}`
      }
    : null;
  const progressionChip = progressionSummary
    ? {
        icon: "hero" as const,
        label:
          progressionSummary.levelsGained > 0
            ? `Lv ${progressionSummary.level}`
            : `XP +${progressionSummary.experienceGained}`
      }
    : null;

  const naturalOrder: BattleTransitionChip[] = [...resourceChips];
  if (equipmentChip) {
    naturalOrder.push(equipmentChip);
  }
  if (progressionChip) {
    naturalOrder.push(progressionChip);
  }
  if (naturalOrder.length <= 3) {
    return naturalOrder;
  }

  const prioritized: BattleTransitionChip[] = [];
  if (equipmentChip) {
    prioritized.push(equipmentChip);
  }
  if (progressionChip) {
    prioritized.push(progressionChip);
  }
  for (const chip of resourceChips) {
    if (prioritized.length >= 3) {
      break;
    }
    prioritized.push(chip);
  }
  return prioritized.slice(0, 3);
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
