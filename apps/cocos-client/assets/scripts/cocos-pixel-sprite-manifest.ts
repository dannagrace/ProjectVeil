import assetConfigJson from "../../../../configs/assets.json";
import { parseAssetConfig } from "./project-shared/assets-config.ts";
import { cocosPresentationConfig } from "./cocos-presentation-config.ts";

const assetConfig = parseAssetConfig(assetConfigJson);
const PIXEL_PREFIX = "/assets/pixel/";
const PIXEL_PRELOAD_GROUPS = ["boot", "battle"] as const;

export interface PixelTileSpriteManifest {
  grass: string[];
  dirt: string[];
  sand: string[];
  water: string[];
  unknown: string[];
  hidden: string[];
}

export interface PixelIconSpriteManifest {
  wood: string;
  gold: string;
  ore: string;
  neutral: string;
  hero: string;
  recruitment: string;
  shrine: string;
  mine: string;
  tower: string;
  hud: string;
  battle: string;
  timeline: string;
}

export interface PixelSpriteManifest {
  tiles: PixelTileSpriteManifest;
  icons: PixelIconSpriteManifest;
  heroes: Record<string, string>;
  units: Record<string, { idle: string; selected: string; hit: string; frame: string }>;
  showcaseUnits: Record<string, { idle: string; selected: string; hit: string; frame: string }>;
  showcaseTerrain: Record<string, string>;
  showcaseBuildings: Record<string, string>;
  badges: {
    factions: Record<string, string>;
    rarities: Record<string, string>;
    interactions: Record<string, string>;
  };
}

export type PixelSpritePreloadGroup = (typeof PIXEL_PRELOAD_GROUPS)[number];

export function toCocosResourcePath(assetPath: string): string | null {
  if (!assetPath.startsWith(PIXEL_PREFIX) || !assetPath.endsWith(".png")) {
    return null;
  }

  return assetPath.slice(PIXEL_PREFIX.length - "pixel/".length, -".png".length);
}

function requireResourcePath(assetPath: string, label: string): string {
  const resourcePath = toCocosResourcePath(assetPath);
  if (!resourcePath) {
    throw new Error(`Asset path ${label} must resolve to a pixel PNG resource: ${assetPath}`);
  }

  return resourcePath;
}

function requireResourceSeries(assetPaths: string[], label: string): string[] {
  return assetPaths.map((assetPath, index) => requireResourcePath(assetPath, `${label}[${index}]`));
}

export const pixelSpriteManifest: PixelSpriteManifest = {
  tiles: {
    grass: requireResourceSeries(assetConfig.terrain.grass.variants, "terrain.grass.variants"),
    dirt: requireResourceSeries(assetConfig.terrain.dirt.variants, "terrain.dirt.variants"),
    sand: requireResourceSeries(assetConfig.terrain.sand.variants, "terrain.sand.variants"),
    water: requireResourceSeries(assetConfig.terrain.water.variants, "terrain.water.variants"),
    unknown: requireResourceSeries(assetConfig.terrain.unknown.variants, "terrain.unknown.variants"),
    hidden: ["pixel/terrain/hidden-tile", "pixel/terrain/hidden-tile-alt", "pixel/terrain/hidden-tile-deep"]
  },
  icons: {
    wood: requireResourcePath(assetConfig.resources.wood, "resources.wood"),
    gold: requireResourcePath(assetConfig.resources.gold, "resources.gold"),
    ore: requireResourcePath(assetConfig.resources.ore, "resources.ore"),
    neutral: requireResourcePath(assetConfig.markers.neutral.idle, "markers.neutral.idle"),
    hero: requireResourcePath(assetConfig.markers.hero.idle, "markers.hero.idle"),
    recruitment: requireResourcePath(assetConfig.buildings.recruitment_post, "buildings.recruitment_post"),
    shrine: requireResourcePath(assetConfig.buildings.attribute_shrine, "buildings.attribute_shrine"),
    mine: requireResourcePath(assetConfig.buildings.resource_mine, "buildings.resource_mine"),
    tower: requireResourcePath(assetConfig.buildings.watchtower, "buildings.watchtower"),
    hud: "pixel/ui/hud-icon",
    battle: "pixel/ui/battle-icon",
    timeline: "pixel/ui/timeline-icon"
  },
  heroes: Object.fromEntries(
    Object.entries(assetConfig.heroes).map(([heroId, hero]) => [
      heroId,
      requireResourcePath(hero.portrait, `heroes.${heroId}.portrait`)
    ])
  ),
  units: Object.fromEntries(
    Object.entries(assetConfig.units).map(([unitId, unit]) => [
      unitId,
      {
        idle: requireResourcePath(unit.portrait.idle, `units.${unitId}.portrait.idle`),
        selected: requireResourcePath(unit.portrait.selected, `units.${unitId}.portrait.selected`),
        hit: requireResourcePath(unit.portrait.hit, `units.${unitId}.portrait.hit`),
        frame: requireResourcePath(unit.frame, `units.${unitId}.frame`)
      }
    ])
  ),
  showcaseUnits: Object.fromEntries(
    Object.entries(assetConfig.showcaseUnits).map(([unitId, unit]) => [
      unitId,
      {
        idle: requireResourcePath(unit.portrait.idle, `showcaseUnits.${unitId}.portrait.idle`),
        selected: requireResourcePath(unit.portrait.selected, `showcaseUnits.${unitId}.portrait.selected`),
        hit: requireResourcePath(unit.portrait.hit, `showcaseUnits.${unitId}.portrait.hit`),
        frame: requireResourcePath(unit.frame, `showcaseUnits.${unitId}.frame`)
      }
    ])
  ),
  showcaseTerrain: Object.fromEntries(
    Object.entries(assetConfig.showcaseTerrain).map(([terrainId, assetPath]) => [
      terrainId,
      requireResourcePath(assetPath, `showcaseTerrain.${terrainId}`)
    ])
  ),
  showcaseBuildings: Object.fromEntries(
    Object.entries(assetConfig.showcaseBuildings).map(([buildingId, assetPath]) => [
      buildingId,
      requireResourcePath(assetPath, `showcaseBuildings.${buildingId}`)
    ])
  ),
  badges: {
    factions: Object.fromEntries(
      Object.entries(assetConfig.badges.factions).map(([key, assetPath]) => [
        key,
        requireResourcePath(assetPath, `badges.factions.${key}`)
      ])
    ),
    rarities: Object.fromEntries(
      Object.entries(assetConfig.badges.rarities).map(([key, assetPath]) => [
        key,
        requireResourcePath(assetPath, `badges.rarities.${key}`)
      ])
    ),
    interactions: Object.fromEntries(
      Object.entries(assetConfig.badges.interactions).map(([key, assetPath]) => [
        key,
        requireResourcePath(assetPath, `badges.interactions.${key}`)
      ])
    )
  }
};

function flattenPixelResourcePaths(): string[] {
  return Array.from(
    new Set([
      ...Object.values(pixelSpriteManifest.tiles).flat(),
      ...Object.values(pixelSpriteManifest.icons),
      ...Object.values(pixelSpriteManifest.heroes),
      ...Object.values(pixelSpriteManifest.units).flatMap((unit) => [unit.idle, unit.selected, unit.hit, unit.frame]),
      ...Object.values(pixelSpriteManifest.showcaseUnits).flatMap((unit) => [unit.idle, unit.selected, unit.hit, unit.frame]),
      ...Object.values(pixelSpriteManifest.showcaseTerrain),
      ...Object.values(pixelSpriteManifest.showcaseBuildings),
      ...Object.values(pixelSpriteManifest.badges.factions),
      ...Object.values(pixelSpriteManifest.badges.rarities),
      ...Object.values(pixelSpriteManifest.badges.interactions)
    ])
  );
}

function matchesResourcePattern(resourcePath: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    return resourcePath.startsWith(pattern.slice(0, -1));
  }

  return resourcePath === pattern;
}

export const pixelSpriteResourcePaths = flattenPixelResourcePaths();

export function resolvePixelSpritePreloadPaths(group: PixelSpritePreloadGroup): string[] {
  const patterns = cocosPresentationConfig.loadingBudget.preloadGroups[group];
  return pixelSpriteResourcePaths.filter((resourcePath) =>
    patterns.some((pattern) => matchesResourcePattern(resourcePath, pattern))
  );
}
