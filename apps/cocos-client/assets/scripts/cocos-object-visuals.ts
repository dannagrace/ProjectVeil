import objectVisuals from "../../../../configs/object-visuals.json";
import type { PlayerTileView } from "./VeilCocosSession.ts";

type FactionKey = "crown" | "wild";
type RarityKey = "common" | "elite";
type InteractionKey = "move" | "pickup" | "battle";

export interface CocosTileVisualDescriptor {
  title: string;
  subtitle: string;
  shortLabel: string;
  tag: string;
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

export function describeCocosTileObject(tile: PlayerTileView | null): CocosTileVisualDescriptor | null {
  if (!tile || tile.fog === "hidden") {
    return null;
  }

  if (tile.building?.kind === "recruitment_post") {
    const config = objectVisuals.buildings.recruitment_post;
    return {
      title: tile.building.label || config.title,
      subtitle: tile.building.availableCount > 0 ? `可招募 ${tile.building.availableCount} 单位。` : "今日库存已售罄。",
      shortLabel: "招募",
      tag: "访问",
      faction: toFactionKey(config.faction),
      rarity: toRarityKey(config.rarity),
      interactionType: toInteractionKey(config.interactionType)
    };
  }

  if (tile.building?.kind === "attribute_shrine") {
    const config = objectVisuals.buildings.attribute_shrine;
    return {
      title: tile.building.label || config.title,
      subtitle: `${formatHeroStatBonus(tile.building.bonus) || config.subtitle}${typeof tile.building.lastUsedDay === "number" ? " · 今日冷却中" : ""}`,
      shortLabel: "神殿",
      tag: "访问",
      faction: toFactionKey(config.faction),
      rarity: toRarityKey(config.rarity),
      interactionType: toInteractionKey(config.interactionType)
    };
  }

  if (tile.building?.kind === "resource_mine") {
    const config = objectVisuals.buildings.resource_mine;
    return {
      title: tile.building.label || config.title,
      subtitle: `${formatResourceKindLabel(tile.building.resourceKind)} +${tile.building.income}${typeof tile.building.lastHarvestDay === "number" ? " · 今日已采集" : " · 可立即采集"}`,
      shortLabel: "矿场",
      tag: "采集",
      faction: toFactionKey(config.faction),
      rarity: toRarityKey(config.rarity),
      interactionType: toInteractionKey(config.interactionType)
    };
  }

  if (tile.occupant?.kind === "hero") {
    return {
      title: objectVisuals.hero.title,
      subtitle: objectVisuals.hero.subtitle,
      shortLabel: "英雄",
      tag: interactionTag(objectVisuals.hero.interactionType),
      faction: toFactionKey(objectVisuals.hero.faction),
      rarity: toRarityKey(objectVisuals.hero.rarity),
      interactionType: toInteractionKey(objectVisuals.hero.interactionType)
    };
  }

  if (tile.occupant?.kind === "neutral") {
    return {
      title: objectVisuals.neutral.title,
      subtitle: objectVisuals.neutral.subtitle,
      shortLabel: "守军",
      tag: interactionTag(objectVisuals.neutral.interactionType),
      faction: toFactionKey(objectVisuals.neutral.faction),
      rarity: toRarityKey(objectVisuals.neutral.rarity),
      interactionType: toInteractionKey(objectVisuals.neutral.interactionType)
    };
  }

  if (tile.occupant?.kind === "building") {
    return {
      title: "建筑",
      subtitle: "后续可接入建筑访问与占领逻辑。",
      shortLabel: "建筑",
      tag: "访问",
      faction: null,
      rarity: "common",
      interactionType: "move"
    };
  }

  if (tile.resource) {
    const config = objectVisuals.resources[tile.resource.kind];
    return {
      title: config.title,
      subtitle: config.subtitle,
      shortLabel: resourceShortLabel(tile.resource.kind),
      tag: interactionTag(config.interactionType),
      faction: null,
      rarity: toRarityKey(config.rarity),
      interactionType: toInteractionKey(config.interactionType)
    };
  }

  return {
    title: objectVisuals.empty.title,
    subtitle: objectVisuals.empty.subtitle,
    shortLabel: tile.terrain === "unknown" ? "未知" : terrainShortLabel(tile.terrain),
    tag: interactionTag(objectVisuals.empty.interactionType),
    faction: null,
    rarity: toRarityKey(objectVisuals.empty.rarity),
    interactionType: toInteractionKey(objectVisuals.empty.interactionType)
  };
}

export function buildCocosTileMarkerText(tile: PlayerTileView | null): string {
  const descriptor = describeCocosTileObject(tile);
  if (!descriptor) {
    return "";
  }

  if (descriptor.interactionType === "move" && !tile?.building && tile?.occupant?.kind !== "building" && !tile?.resource) {
    return "";
  }

  if (tile?.resource?.kind === "wood") {
    return "+W";
  }

  if (tile?.resource?.kind === "gold") {
    return "+$";
  }

  if (tile?.resource?.kind === "ore") {
    return "+O";
  }

  if (tile?.occupant?.kind === "neutral") {
    return "!M";
  }

  if (tile?.occupant?.kind === "hero") {
    return "!H";
  }

  if (tile?.building) {
    if (tile.building.kind === "recruitment_post") {
      return ">R";
    }
    if (tile.building.kind === "attribute_shrine") {
      return ">S";
    }
    if (tile.building.kind === "resource_mine") {
      return ">M";
    }
    return ">B";
  }

  return "";
}

function toFactionKey(value: string | undefined): FactionKey | null {
  return value === "crown" || value === "wild" ? value : null;
}

function toRarityKey(value: string): RarityKey {
  return value === "elite" ? "elite" : "common";
}

function toInteractionKey(value: string): InteractionKey {
  if (value === "pickup" || value === "battle") {
    return value;
  }

  return "move";
}

function interactionTag(value: string): string {
  if (value === "pickup") {
    return "采集";
  }

  if (value === "battle") {
    return "战斗";
  }

  return "移动";
}

function resourceShortLabel(kind: string): string {
  switch (kind) {
    case "gold":
      return "金币";
    case "wood":
      return "木材";
    case "ore":
      return "矿石";
    default:
      return "资源";
  }
}

function terrainShortLabel(kind: string): string {
  switch (kind) {
    case "grass":
      return "草地";
    case "dirt":
      return "土地";
    case "sand":
      return "沙地";
    case "water":
      return "水面";
    default:
      return "地块";
  }
}
