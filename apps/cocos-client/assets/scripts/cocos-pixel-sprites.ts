import { ImageAsset, SpriteFrame, resources } from "cc";
import { cocosPresentationConfig } from "./cocos-presentation-config.ts";
import {
  pixelSpriteManifest,
  pixelSpriteResourcePaths,
  resolvePixelSpritePreloadPaths,
  type PixelSpritePreloadGroup
} from "./cocos-pixel-sprite-manifest.ts";

export interface PixelTileSprites {
  grass: Array<SpriteFrame | null>;
  dirt: Array<SpriteFrame | null>;
  sand: Array<SpriteFrame | null>;
  water: Array<SpriteFrame | null>;
  unknown: Array<SpriteFrame | null>;
  hidden: Array<SpriteFrame | null>;
}

export interface PixelIconSprites {
  wood: SpriteFrame | null;
  gold: SpriteFrame | null;
  ore: SpriteFrame | null;
  neutral: SpriteFrame | null;
  hero: SpriteFrame | null;
  recruitment: SpriteFrame | null;
  shrine: SpriteFrame | null;
  mine: SpriteFrame | null;
  hud: SpriteFrame | null;
  battle: SpriteFrame | null;
  timeline: SpriteFrame | null;
}

export interface PixelUnitSpriteSet {
  idle: SpriteFrame | null;
  selected: SpriteFrame | null;
  hit: SpriteFrame | null;
  frame: SpriteFrame | null;
}

export interface PixelBadgeSprites {
  factions: Record<string, SpriteFrame | null>;
  rarities: Record<string, SpriteFrame | null>;
  interactions: Record<string, SpriteFrame | null>;
}

export interface PixelSpriteAssets {
  tiles: PixelTileSprites;
  icons: PixelIconSprites;
  heroes: Record<string, SpriteFrame | null>;
  units: Record<string, PixelUnitSpriteSet>;
  showcaseUnits: Record<string, PixelUnitSpriteSet>;
  showcaseTerrain: Record<string, SpriteFrame | null>;
  showcaseBuildings: Record<string, SpriteFrame | null>;
  badges: PixelBadgeSprites;
}

export type PixelSpriteLoadPhase = "idle" | "loading" | "ready";

export interface PixelSpriteLoadStatus {
  phase: PixelSpriteLoadPhase;
  startedAtMs: number | null;
  completedAtMs: number | null;
  loadDurationMs: number | null;
  targetMs: number;
  hardLimitMs: number;
  exceededTarget: boolean;
  exceededHardLimit: boolean;
  requestedGroups: PixelSpritePreloadGroup[];
  loadedGroups: PixelSpritePreloadGroup[];
  pendingGroups: PixelSpritePreloadGroup[];
  loadedResourceCount: number;
  totalResourceCount: number;
}

const loadedFrames = new Map<string, SpriteFrame | null>();
const inflightFrameLoads = new Map<string, Promise<SpriteFrame | null>>();
const inflightGroupLoads = new Map<PixelSpritePreloadGroup, Promise<PixelSpriteAssets>>();
const requestedGroups = new Set<PixelSpritePreloadGroup>();
const loadedGroups = new Set<PixelSpritePreloadGroup>();
const pendingGroups = new Set<PixelSpritePreloadGroup>();

let loadStatus: PixelSpriteLoadStatus = {
  phase: "idle",
  startedAtMs: null,
  completedAtMs: null,
  loadDurationMs: null,
  targetMs: cocosPresentationConfig.loadingBudget.targetMs,
  hardLimitMs: cocosPresentationConfig.loadingBudget.hardLimitMs,
  exceededTarget: false,
  exceededHardLimit: false,
  requestedGroups: [],
  loadedGroups: [],
  pendingGroups: [],
  loadedResourceCount: 0,
  totalResourceCount: pixelSpriteResourcePaths.length
};

export function getPixelSpriteAssets(): PixelSpriteAssets | null {
  if (loadedFrames.size === 0) {
    return null;
  }

  return buildPixelSpriteAssetsSnapshot();
}

export function getPixelSpriteLoadStatus(): PixelSpriteLoadStatus {
  return { ...loadStatus };
}

export function loadPixelSpriteAssets(group: PixelSpritePreloadGroup | "all" = "boot"): Promise<PixelSpriteAssets> {
  const groups = group === "all" ? (["boot", "battle"] as PixelSpritePreloadGroup[]) : [group];
  return Promise.all(groups.map((groupName) => loadPixelSpriteGroup(groupName))).then(() => buildPixelSpriteAssetsSnapshot());
}

function loadPixelSpriteGroup(group: PixelSpritePreloadGroup): Promise<PixelSpriteAssets> {
  if (loadedGroups.has(group)) {
    return Promise.resolve(buildPixelSpriteAssetsSnapshot());
  }

  const inflight = inflightGroupLoads.get(group);
  if (inflight) {
    return inflight;
  }

  beginLoadCycle(group);
  const resourcePaths = resolvePixelSpritePreloadPaths(group);
  const promise = Promise.all(resourcePaths.map((path) => loadSpriteFrame(path))).then(() => {
    loadedGroups.add(group);
    pendingGroups.delete(group);
    inflightGroupLoads.delete(group);
    finalizeLoadCycle();
    return buildPixelSpriteAssetsSnapshot();
  });
  inflightGroupLoads.set(group, promise);
  return promise;
}

function beginLoadCycle(group: PixelSpritePreloadGroup): void {
  requestedGroups.add(group);
  pendingGroups.add(group);
  if (pendingGroups.size === 1) {
    loadStatus = {
      ...loadStatus,
      phase: "loading",
      startedAtMs: Date.now(),
      completedAtMs: null,
      loadDurationMs: null,
      exceededTarget: false,
      exceededHardLimit: false
    };
  }
  syncLoadStatusCollections();
}

function finalizeLoadCycle(): void {
  if (pendingGroups.size > 0) {
    syncLoadStatusCollections();
    return;
  }

  const completedAtMs = Date.now();
  const loadDurationMs = loadStatus.startedAtMs === null ? null : completedAtMs - loadStatus.startedAtMs;
  loadStatus = {
    ...loadStatus,
    phase: loadedGroups.size > 0 ? "ready" : "idle",
    completedAtMs,
    loadDurationMs,
    exceededTarget: loadDurationMs !== null && loadDurationMs > loadStatus.targetMs,
    exceededHardLimit: loadDurationMs !== null && loadDurationMs > loadStatus.hardLimitMs
  };
  syncLoadStatusCollections();
}

function syncLoadStatusCollections(): void {
  loadStatus = {
    ...loadStatus,
    requestedGroups: Array.from(requestedGroups),
    loadedGroups: Array.from(loadedGroups),
    pendingGroups: Array.from(pendingGroups),
    loadedResourceCount: loadedFrames.size,
    totalResourceCount: pixelSpriteResourcePaths.length
  };
}

function buildPixelSpriteAssetsSnapshot(): PixelSpriteAssets {
  return {
    tiles: {
      grass: readSpriteSeries(pixelSpriteManifest.tiles.grass),
      dirt: readSpriteSeries(pixelSpriteManifest.tiles.dirt),
      sand: readSpriteSeries(pixelSpriteManifest.tiles.sand),
      water: readSpriteSeries(pixelSpriteManifest.tiles.water),
      unknown: readSpriteSeries(pixelSpriteManifest.tiles.unknown),
      hidden: readSpriteSeries(pixelSpriteManifest.tiles.hidden)
    },
    icons: {
      wood: readSpriteFrame(pixelSpriteManifest.icons.wood),
      gold: readSpriteFrame(pixelSpriteManifest.icons.gold),
      ore: readSpriteFrame(pixelSpriteManifest.icons.ore),
      neutral: readSpriteFrame(pixelSpriteManifest.icons.neutral),
      hero: readSpriteFrame(pixelSpriteManifest.icons.hero),
      recruitment: readSpriteFrame(pixelSpriteManifest.icons.recruitment),
      shrine: readSpriteFrame(pixelSpriteManifest.icons.shrine),
      mine: readSpriteFrame(pixelSpriteManifest.icons.mine),
      hud: readSpriteFrame(pixelSpriteManifest.icons.hud),
      battle: readSpriteFrame(pixelSpriteManifest.icons.battle),
      timeline: readSpriteFrame(pixelSpriteManifest.icons.timeline)
    },
    heroes: Object.fromEntries(
      Object.entries(pixelSpriteManifest.heroes).map(([heroId, path]) => [heroId, readSpriteFrame(path)])
    ),
    units: Object.fromEntries(
      Object.entries(pixelSpriteManifest.units).map(([templateId, unit]) => [
        templateId,
        {
          idle: readSpriteFrame(unit.idle),
          selected: readSpriteFrame(unit.selected),
          hit: readSpriteFrame(unit.hit),
          frame: readSpriteFrame(unit.frame)
        }
      ])
    ),
    showcaseUnits: Object.fromEntries(
      Object.entries(pixelSpriteManifest.showcaseUnits).map(([templateId, unit]) => [
        templateId,
        {
          idle: readSpriteFrame(unit.idle),
          selected: readSpriteFrame(unit.selected),
          hit: readSpriteFrame(unit.hit),
          frame: readSpriteFrame(unit.frame)
        }
      ])
    ),
    showcaseTerrain: Object.fromEntries(
      Object.entries(pixelSpriteManifest.showcaseTerrain).map(([terrainId, path]) => [terrainId, readSpriteFrame(path)])
    ),
    showcaseBuildings: Object.fromEntries(
      Object.entries(pixelSpriteManifest.showcaseBuildings).map(([buildingId, path]) => [buildingId, readSpriteFrame(path)])
    ),
    badges: {
      factions: Object.fromEntries(
        Object.entries(pixelSpriteManifest.badges.factions).map(([key, path]) => [key, readSpriteFrame(path)])
      ),
      rarities: Object.fromEntries(
        Object.entries(pixelSpriteManifest.badges.rarities).map(([key, path]) => [key, readSpriteFrame(path)])
      ),
      interactions: Object.fromEntries(
        Object.entries(pixelSpriteManifest.badges.interactions).map(([key, path]) => [key, readSpriteFrame(path)])
      )
    }
  };
}

function readSpriteSeries(paths: string[]): Array<SpriteFrame | null> {
  return paths.map((path) => readSpriteFrame(path));
}

function readSpriteFrame(path: string): SpriteFrame | null {
  return loadedFrames.get(path) ?? null;
}

function loadSpriteFrame(path: string): Promise<SpriteFrame | null> {
  const cached = loadedFrames.get(path);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  const inflight = inflightFrameLoads.get(path);
  if (inflight) {
    return inflight;
  }

  const promise = new Promise<SpriteFrame | null>((resolve) => {
    resources.load(path, ImageAsset, (err, asset) => {
      if (err) {
        loadedFrames.set(path, null);
        inflightFrameLoads.delete(path);
        syncLoadStatusCollections();
        resolve(null);
        return;
      }

      const frame = SpriteFrame.createWithImage(asset);
      loadedFrames.set(path, frame);
      inflightFrameLoads.delete(path);
      syncLoadStatusCollections();
      resolve(frame);
    });
  });

  inflightFrameLoads.set(path, promise);
  return promise;
}
