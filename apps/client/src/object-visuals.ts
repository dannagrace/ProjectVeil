import objectVisuals from "../../../configs/object-visuals.json";
import type { PlayerTileView } from "../../../packages/shared/src/index";
import { markerAsset, resourceAsset } from "./assets";

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

export function describeTileObject(tile: PlayerTileView | null): TileCardDescriptor | null {
  if (!tile || tile.fog === "hidden") {
    return null;
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
