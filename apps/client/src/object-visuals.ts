import objectVisuals from "../../../configs/object-visuals.json";
import type { PlayerTileView } from "../../../packages/shared/src/index";
import { buildingAsset, markerAsset, resourceAsset } from "./assets";

type FactionKey = "crown" | "wild";
type RarityKey = "common" | "elite";
type InteractionKey = "move" | "pickup" | "battle";

function toFactionKey(value: string | undefined): FactionKey | null {
  return value === "crown" || value === "wild" ? value : null;
}

function toRarityKey(value: string): RarityKey {
  return value === "elite" ? "elite" : "common";
}

function toInteractionKey(value: string): InteractionKey {
  if (value === "battle" || value === "pickup") {
    return value;
  }

  return "move";
}

export interface TileCardDescriptor {
  title: string;
  subtitle: string;
  value: string;
  icon: string | null;
  faction: FactionKey | null;
  rarity: RarityKey;
  interactionType: InteractionKey;
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

function formatResourceKindLabel(kind: "gold" | "wood" | "ore"): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
}

export function describeTileObject(tile: PlayerTileView | null): TileCardDescriptor | null {
  if (!tile || tile.fog === "hidden") {
    return null;
  }

  if (tile.building?.kind === "recruitment_post") {
    const config = objectVisuals.buildings.recruitment_post;
    const costParts = [
      tile.building.cost.gold > 0 ? `金币 ${tile.building.cost.gold}` : "",
      tile.building.cost.wood > 0 ? `木材 ${tile.building.cost.wood}` : "",
      tile.building.cost.ore > 0 ? `矿石 ${tile.building.cost.ore}` : ""
    ].filter(Boolean);
    return {
      title: tile.building.label || config.title,
      subtitle: `${config.subtitle}${tile.building.availableCount > 0 ? ` 当前可招募 ${tile.building.availableCount}。` : " 今日库存已售罄。"}`,
      value: costParts.length > 0 ? `招募 ${tile.building.availableCount}/${tile.building.recruitCount} · ${costParts.join(" / ")}` : `招募 ${tile.building.availableCount}/${tile.building.recruitCount}`,
      icon: buildingAsset(tile.building.kind),
      faction: toFactionKey(config.faction),
      rarity: toRarityKey(config.rarity),
      interactionType: toInteractionKey(config.interactionType)
    };
  }

  if (tile.building?.kind === "attribute_shrine") {
    const config = objectVisuals.buildings.attribute_shrine;
    const visited = typeof tile.building.lastUsedDay === "number";
    return {
      title: tile.building.label || config.title,
      subtitle: `${config.subtitle}${visited ? " 本局已完成访问。" : " 当前仍可访问。"}`,
      value: `${formatHeroStatBonus(tile.building.bonus) || "永久属性加成"}${visited ? " · 已留下访问记录" : ""}`,
      icon: buildingAsset(tile.building.kind),
      faction: toFactionKey(config.faction),
      rarity: toRarityKey(config.rarity),
      interactionType: toInteractionKey(config.interactionType)
    };
  }

  if (tile.building?.kind === "resource_mine") {
    const config = objectVisuals.buildings.resource_mine;
    const ownerLabel =
      typeof tile.building.lastHarvestDay === "number"
        ? `最近一次领取于第 ${tile.building.lastHarvestDay} 天`
        : "当前无人占领";
    return {
      title: tile.building.label || config.title,
      subtitle: `${config.subtitle}${ownerLabel}。`,
      value: `${formatResourceKindLabel(tile.building.resourceKind)} +${tile.building.income}/天`,
      icon: buildingAsset(tile.building.kind) ?? resourceAsset(tile.building.resourceKind),
      faction: toFactionKey(config.faction),
      rarity: toRarityKey(config.rarity),
      interactionType: toInteractionKey(config.interactionType)
    };
  }

  if (tile.occupant?.kind === "hero") {
    return {
      title: objectVisuals.hero.title,
      subtitle: objectVisuals.hero.subtitle,
      value: `坐标 ${tile.position.x},${tile.position.y}`,
      icon: markerAsset("hero"),
      faction: toFactionKey(objectVisuals.hero.faction),
      rarity: toRarityKey(objectVisuals.hero.rarity),
      interactionType: toInteractionKey(objectVisuals.hero.interactionType)
    };
  }

  if (tile.occupant?.kind === "neutral") {
    return {
      title: objectVisuals.neutral.title,
      subtitle: objectVisuals.neutral.subtitle,
      value: `驻守点 ${tile.position.x},${tile.position.y}`,
      icon: markerAsset("neutral"),
      faction: toFactionKey(objectVisuals.neutral.faction),
      rarity: toRarityKey(objectVisuals.neutral.rarity),
      interactionType: toInteractionKey(objectVisuals.neutral.interactionType)
    };
  }

  if (tile.resource) {
    const config = objectVisuals.resources[tile.resource.kind];
    return {
      title: config.title,
      subtitle: config.subtitle,
      value: `${tile.resource.kind} +${tile.resource.amount}`,
      icon: resourceAsset(tile.resource.kind),
      faction: null,
      rarity: toRarityKey(config.rarity),
      interactionType: toInteractionKey(config.interactionType)
    };
  }

  return {
    title: objectVisuals.empty.title,
    subtitle: objectVisuals.empty.subtitle,
    value: `地形 ${tile.terrain}`,
    icon: null,
    faction: null,
    rarity: toRarityKey(objectVisuals.empty.rarity),
    interactionType: toInteractionKey(objectVisuals.empty.interactionType)
  };
}
