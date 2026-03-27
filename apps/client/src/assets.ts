import assetConfigJson from "../../../configs/assets.json";
import unitCatalog from "../../../configs/units.json";
import type { AssetConfig } from "../../../packages/shared/src/assets-config";

const assetConfig: AssetConfig = assetConfigJson;

type TerrainKey = keyof typeof assetConfig.terrain;
type ResourceKey = keyof typeof assetConfig.resources;
type BuildingKey = keyof typeof assetConfig.buildings;
type MarkerKey = keyof typeof assetConfig.markers;
type UnitKey = keyof typeof assetConfig.units;
export type AssetState = "idle" | "selected" | "hit";
type FactionKey = keyof typeof assetConfig.badges.factions;
type RarityKey = keyof typeof assetConfig.badges.rarities;
type InteractionKey = keyof typeof assetConfig.badges.interactions;

const unitTemplateById = new Map(unitCatalog.templates.map((template) => [template.id, template]));

function pickVariant<T>(items: readonly T[], seed: number, fallback: T): T {
  if (items.length === 0) {
    return fallback;
  }

  return items[Math.abs(seed) % items.length] ?? fallback;
}

export function terrainAsset(key: string, x: number, y: number): string {
  const terrain = assetConfig.terrain[key as TerrainKey] ?? assetConfig.terrain.unknown;
  const seed = x * 31 + y * 17;
  return pickVariant(terrain.variants, seed, terrain.default);
}

export function resourceAsset(key: string): string | null {
  return assetConfig.resources[key as ResourceKey] ?? null;
}

export function buildingAsset(key: string): string | null {
  return assetConfig.buildings[key as BuildingKey] ?? null;
}

export function markerAsset(key: "hero" | "neutral", state: AssetState = "idle"): string {
  return assetConfig.markers[key as MarkerKey]?.[state] ?? assetConfig.markers[key as MarkerKey]?.idle;
}

export function unitAsset(key: string, state: AssetState = "idle"): string | null {
  return assetConfig.units[key as UnitKey]?.portrait?.[state] ?? assetConfig.units[key as UnitKey]?.portrait?.idle ?? null;
}

export function unitFrameAsset(key: string): string | null {
  return assetConfig.units[key as UnitKey]?.frame ?? null;
}

export function unitBadgeAssets(key: string): { faction: string | null; rarity: string | null } {
  const template = unitTemplateById.get(key);
  if (!template) {
    return { faction: null, rarity: null };
  }

  return {
    faction: assetConfig.badges.factions[template.faction as FactionKey] ?? null,
    rarity: assetConfig.badges.rarities[template.rarity as RarityKey] ?? null
  };
}

export function objectBadgeAssets(
  metadata: {
    faction?: string | null;
    rarity?: string | null;
    interactionType?: string | null;
  } | null
): { faction: string | null; rarity: string | null; interaction: string | null } {
  if (!metadata) {
    return {
      faction: null,
      rarity: null,
      interaction: null
    };
  }

  return {
    faction: metadata.faction ? assetConfig.badges.factions[metadata.faction as FactionKey] ?? null : null,
    rarity: metadata.rarity ? assetConfig.badges.rarities[metadata.rarity as RarityKey] ?? null : null,
    interaction: metadata.interactionType
      ? assetConfig.badges.interactions[metadata.interactionType as InteractionKey] ?? null
      : null
  };
}
