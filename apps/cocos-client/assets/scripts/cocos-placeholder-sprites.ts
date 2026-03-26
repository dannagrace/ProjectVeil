import { ImageAsset, SpriteFrame, resources } from "cc";

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

let cachedAssets: PlaceholderSpriteAssets | null = null;
let inflightLoad: Promise<PlaceholderSpriteAssets> | null = null;

export function getPlaceholderSpriteAssets(): PlaceholderSpriteAssets | null {
  return cachedAssets;
}

export function loadPlaceholderSpriteAssets(): Promise<PlaceholderSpriteAssets> {
  if (cachedAssets) {
    return Promise.resolve(cachedAssets);
  }

  if (inflightLoad) {
    return inflightLoad;
  }

  inflightLoad = Promise.all([
    loadTileSeries("grass", 3),
    loadTileSeries("dirt", 3),
    loadTileSeries("sand", 2),
    loadTileSeries("water", 2),
    loadTileSeries("unknown", 1),
    loadTileSeries("hidden", 3),
    loadSpriteFrame("placeholder/icons/wood"),
    loadSpriteFrame("placeholder/icons/gold"),
    loadSpriteFrame("placeholder/icons/ore"),
    loadSpriteFrame("placeholder/icons/neutral"),
    loadSpriteFrame("placeholder/icons/hero"),
    loadSpriteFrame("placeholder/icons/recruitment"),
    loadSpriteFrame("placeholder/icons/shrine"),
    loadSpriteFrame("placeholder/icons/mine"),
    loadSpriteFrame("placeholder/icons/hud"),
    loadSpriteFrame("placeholder/icons/battle"),
    loadSpriteFrame("placeholder/icons/timeline")
  ]).then(
    ([grass, dirt, sand, water, unknown, hidden, wood, gold, ore, neutral, hero, recruitment, shrine, mine, hud, battle, timeline]) => {
    const resolved: PlaceholderSpriteAssets = {
      tiles: {
        grass,
        dirt,
        sand,
        water,
        unknown,
        hidden
      },
      icons: {
        wood,
        gold,
        ore,
        neutral,
        hero,
        recruitment,
        shrine,
        mine,
        hud,
        battle,
        timeline
      }
    };
    cachedAssets = resolved;
    inflightLoad = null;
    return resolved;
    }
  );

  return inflightLoad;
}

function loadTileSeries(prefix: string, count: number): Promise<Array<SpriteFrame | null>> {
  return Promise.all(Array.from({ length: count }, (_, index) => loadSpriteFrame(`placeholder/tiles/${prefix}-${index + 1}`)));
}

function loadSpriteFrame(path: string): Promise<SpriteFrame | null> {
  return new Promise((resolve) => {
    resources.load(path, ImageAsset, (err, asset) => {
      if (err) {
        resolve(null);
        return;
      }

      resolve(SpriteFrame.createWithImage(asset));
    });
  });
}
