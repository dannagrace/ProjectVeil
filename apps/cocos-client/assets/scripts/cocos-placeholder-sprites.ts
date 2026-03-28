import { ImageAsset, SpriteFrame, resources } from "cc";
import {
  ALL_PLACEHOLDER_SCOPES,
  normalizePlaceholderScopes,
  PLACEHOLDER_ICON_PATHS,
  PLACEHOLDER_SCOPE_PATHS,
  PLACEHOLDER_TILE_PATHS,
  resolvePlaceholderSpritePathsForScopes,
  type PlaceholderSpriteScope
} from "./cocos-placeholder-sprite-plan.ts";

export interface PlaceholderTileSprites {
  grass: Array<SpriteFrame | null>;
  dirt: Array<SpriteFrame | null>;
  sand: Array<SpriteFrame | null>;
  water: Array<SpriteFrame | null>;
  unknown: Array<SpriteFrame | null>;
  hidden: Array<SpriteFrame | null>;
}

export interface PlaceholderIconSprites {
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

export interface PlaceholderSpriteAssets {
  tiles: PlaceholderTileSprites;
  icons: PlaceholderIconSprites;
}

export interface PlaceholderSpriteUsageSummary {
  retainedScopes: PlaceholderSpriteScope[];
  loadedPaths: string[];
  retainedPaths: string[];
  referenceCounts: Record<PlaceholderSpriteScope, number>;
}

interface PlaceholderResourceLoaderLike {
  load<T>(
    path: string,
    type: new (...args: never[]) => T,
    callback: (err: Error | null, asset: T) => void
  ): void;
  release?: ((path: string, type?: new (...args: never[]) => unknown) => void) | undefined;
}

interface PlaceholderSpriteFrameFactoryLike {
  createWithImage(imageAsset: unknown): SpriteFrame;
}

interface PlaceholderSpriteRuntimeLike {
  loader: PlaceholderResourceLoaderLike;
  spriteFrameFactory: PlaceholderSpriteFrameFactoryLike;
}

let placeholderRuntime: PlaceholderSpriteRuntimeLike = {
  loader: resources as unknown as PlaceholderResourceLoaderLike,
  spriteFrameFactory: SpriteFrame as unknown as PlaceholderSpriteFrameFactoryLike
};

const loadedFramesByPath = new Map<string, SpriteFrame | null>();
const loadedImagesByPath = new Map<string, ImageAsset>();
const inflightLoadsByPath = new Map<string, Promise<SpriteFrame | null>>();
const retainedScopeCounts = new Map<PlaceholderSpriteScope, number>();

function createEmptyPlaceholderSpriteAssets(): PlaceholderSpriteAssets {
  return {
    tiles: {
      grass: PLACEHOLDER_TILE_PATHS.grass.map(() => null),
      dirt: PLACEHOLDER_TILE_PATHS.dirt.map(() => null),
      sand: PLACEHOLDER_TILE_PATHS.sand.map(() => null),
      water: PLACEHOLDER_TILE_PATHS.water.map(() => null),
      unknown: PLACEHOLDER_TILE_PATHS.unknown.map(() => null),
      hidden: PLACEHOLDER_TILE_PATHS.hidden.map(() => null)
    },
    icons: {
      wood: null,
      gold: null,
      ore: null,
      neutral: null,
      hero: null,
      recruitment: null,
      shrine: null,
      mine: null,
      hud: null,
      battle: null,
      timeline: null
    }
  };
}

function buildPlaceholderSpriteAssetsSnapshot(): PlaceholderSpriteAssets {
  const assets = createEmptyPlaceholderSpriteAssets();
  for (const [kind, paths] of Object.entries(PLACEHOLDER_TILE_PATHS) as Array<
    [keyof PlaceholderTileSprites, readonly string[]]
  >) {
    assets.tiles[kind] = paths.map((path) => loadedFramesByPath.get(path) ?? null);
  }
  for (const [kind, path] of Object.entries(PLACEHOLDER_ICON_PATHS) as Array<
    [keyof PlaceholderIconSprites, string]
  >) {
    assets.icons[kind] = loadedFramesByPath.get(path) ?? null;
  }
  return assets;
}

function hasLoadedPlaceholderAssets(assets: PlaceholderSpriteAssets): boolean {
  return (
    Object.values(assets.tiles).some((items) => items.some((frame: SpriteFrame | null) => frame !== null))
    || Object.values(assets.icons).some((frame: SpriteFrame | null) => frame !== null)
  );
}

function retainedPaths(): string[] {
  const retained = new Set<string>();
  for (const scope of ALL_PLACEHOLDER_SCOPES) {
    if ((retainedScopeCounts.get(scope) ?? 0) <= 0) {
      continue;
    }
    for (const path of PLACEHOLDER_SCOPE_PATHS[scope]) {
      retained.add(path);
    }
  }
  return [...retained];
}

function destroySpriteFrame(frame: SpriteFrame | null | undefined): void {
  if (!frame) {
    return;
  }
  const maybeDestroy = frame as unknown as { destroy?: (() => void) | undefined };
  maybeDestroy.destroy?.();
}

function releaseLoadedPath(path: string): void {
  destroySpriteFrame(loadedFramesByPath.get(path) ?? null);
  loadedFramesByPath.delete(path);
  loadedImagesByPath.delete(path);
  placeholderRuntime.loader.release?.(path, ImageAsset);
}

function trimReleasedPlaceholderPaths(): void {
  const activePaths = new Set(retainedPaths());
  for (const path of [...loadedFramesByPath.keys()]) {
    if (!activePaths.has(path)) {
      releaseLoadedPath(path);
    }
  }
}

function loadSpriteFrame(path: string): Promise<SpriteFrame | null> {
  if (loadedFramesByPath.has(path)) {
    return Promise.resolve(loadedFramesByPath.get(path) ?? null);
  }

  const inflight = inflightLoadsByPath.get(path);
  if (inflight) {
    return inflight;
  }

  const nextLoad = new Promise<SpriteFrame | null>((resolve) => {
    placeholderRuntime.loader.load(path, ImageAsset, (err, asset) => {
      inflightLoadsByPath.delete(path);
      if (err) {
        loadedFramesByPath.set(path, null);
        resolve(null);
        return;
      }

      loadedImagesByPath.set(path, asset);
      const frame = placeholderRuntime.spriteFrameFactory.createWithImage(asset);
      loadedFramesByPath.set(path, frame);
      resolve(frame);
    });
  });

  inflightLoadsByPath.set(path, nextLoad);
  return nextLoad;
}

export function getPlaceholderSpriteAssets(): PlaceholderSpriteAssets | null {
  const snapshot = buildPlaceholderSpriteAssetsSnapshot();
  return hasLoadedPlaceholderAssets(snapshot) ? snapshot : null;
}

export async function loadPlaceholderSpriteAssets(
  scopes?: PlaceholderSpriteScope | PlaceholderSpriteScope[] | readonly PlaceholderSpriteScope[]
): Promise<PlaceholderSpriteAssets> {
  const paths = resolvePlaceholderSpritePathsForScopes(scopes);
  await Promise.all(paths.map((path) => loadSpriteFrame(path)));
  const snapshot = buildPlaceholderSpriteAssetsSnapshot();
  return hasLoadedPlaceholderAssets(snapshot) ? snapshot : createEmptyPlaceholderSpriteAssets();
}

export async function retainPlaceholderSpriteAssets(
  scopes: PlaceholderSpriteScope | PlaceholderSpriteScope[] | readonly PlaceholderSpriteScope[]
): Promise<PlaceholderSpriteAssets> {
  const normalizedScopes = normalizePlaceholderScopes(scopes);
  for (const scope of normalizedScopes) {
    retainedScopeCounts.set(scope, (retainedScopeCounts.get(scope) ?? 0) + 1);
  }

  try {
    return await loadPlaceholderSpriteAssets(normalizedScopes);
  } catch (error) {
    for (const scope of normalizedScopes) {
      const nextCount = (retainedScopeCounts.get(scope) ?? 1) - 1;
      if (nextCount <= 0) {
        retainedScopeCounts.delete(scope);
      } else {
        retainedScopeCounts.set(scope, nextCount);
      }
    }
    trimReleasedPlaceholderPaths();
    throw error;
  }
}

export function releasePlaceholderSpriteAssets(
  scopes: PlaceholderSpriteScope | PlaceholderSpriteScope[] | readonly PlaceholderSpriteScope[]
): void {
  const normalizedScopes = normalizePlaceholderScopes(scopes);
  for (const scope of normalizedScopes) {
    const nextCount = (retainedScopeCounts.get(scope) ?? 0) - 1;
    if (nextCount <= 0) {
      retainedScopeCounts.delete(scope);
    } else {
      retainedScopeCounts.set(scope, nextCount);
    }
  }
  trimReleasedPlaceholderPaths();
}

export function getPlaceholderSpriteAssetUsageSummary(): PlaceholderSpriteUsageSummary {
  return {
    retainedScopes: ALL_PLACEHOLDER_SCOPES.filter((scope) => (retainedScopeCounts.get(scope) ?? 0) > 0),
    loadedPaths: [...loadedFramesByPath.keys()],
    retainedPaths: retainedPaths(),
    referenceCounts: {
      map: retainedScopeCounts.get("map") ?? 0,
      hud: retainedScopeCounts.get("hud") ?? 0,
      battle: retainedScopeCounts.get("battle") ?? 0,
      timeline: retainedScopeCounts.get("timeline") ?? 0
    }
  };
}

export function resetPlaceholderSpriteAssetsForTests(): void {
  for (const path of [...loadedFramesByPath.keys()]) {
    releaseLoadedPath(path);
  }
  loadedFramesByPath.clear();
  loadedImagesByPath.clear();
  inflightLoadsByPath.clear();
  retainedScopeCounts.clear();
  placeholderRuntime = {
    loader: resources as unknown as PlaceholderResourceLoaderLike,
    spriteFrameFactory: SpriteFrame as unknown as PlaceholderSpriteFrameFactoryLike
  };
}

export function setPlaceholderSpriteRuntimeForTests(runtime: Partial<PlaceholderSpriteRuntimeLike>): void {
  placeholderRuntime = {
    ...placeholderRuntime,
    ...runtime
  };
}
