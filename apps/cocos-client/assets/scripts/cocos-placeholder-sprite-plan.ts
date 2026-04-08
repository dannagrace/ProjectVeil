export type PlaceholderSpriteScope = "map" | "hud" | "battle" | "timeline";

export const PLACEHOLDER_TILE_PATHS = {
  grass: ["placeholder/tiles/grass-1", "placeholder/tiles/grass-2", "placeholder/tiles/grass-3"],
  dirt: ["placeholder/tiles/dirt-1", "placeholder/tiles/dirt-2", "placeholder/tiles/dirt-3"],
  sand: ["placeholder/tiles/sand-1", "placeholder/tiles/sand-2"],
  water: ["placeholder/tiles/water-1", "placeholder/tiles/water-2"],
  swamp: ["placeholder/tiles/dirt-1", "placeholder/tiles/dirt-2", "placeholder/tiles/dirt-3"],
  unknown: ["placeholder/tiles/unknown-1"],
  hidden: ["placeholder/tiles/hidden-1", "placeholder/tiles/hidden-2", "placeholder/tiles/hidden-3"]
} as const;

export const PLACEHOLDER_FOG_MASK_PATHS = {
  hidden: Array.from({ length: 16 }, (_unused, featherMask) => `placeholder/fog/hidden-${featherMask}`),
  explored: Array.from({ length: 16 }, (_unused, featherMask) => `placeholder/fog/explored-${featherMask}`)
} as const;

export const PLACEHOLDER_ICON_PATHS = {
  wood: "placeholder/icons/wood",
  gold: "placeholder/icons/gold",
  ore: "placeholder/icons/ore",
  neutral: "placeholder/icons/neutral",
  hero: "placeholder/icons/hero",
  recruitment: "placeholder/icons/recruitment",
  shrine: "placeholder/icons/shrine",
  mine: "placeholder/icons/mine",
  hud: "placeholder/icons/hud",
  battle: "placeholder/icons/battle",
  timeline: "placeholder/icons/timeline"
} as const;

export const PLACEHOLDER_SCOPE_PATHS = {
  map: [
    ...PLACEHOLDER_TILE_PATHS.grass,
    ...PLACEHOLDER_TILE_PATHS.dirt,
    ...PLACEHOLDER_TILE_PATHS.sand,
    ...PLACEHOLDER_TILE_PATHS.water,
    ...PLACEHOLDER_TILE_PATHS.swamp,
    ...PLACEHOLDER_TILE_PATHS.unknown,
    ...PLACEHOLDER_TILE_PATHS.hidden,
    ...PLACEHOLDER_FOG_MASK_PATHS.hidden,
    ...PLACEHOLDER_FOG_MASK_PATHS.explored,
    PLACEHOLDER_ICON_PATHS.wood,
    PLACEHOLDER_ICON_PATHS.gold,
    PLACEHOLDER_ICON_PATHS.ore,
    PLACEHOLDER_ICON_PATHS.neutral,
    PLACEHOLDER_ICON_PATHS.hero,
    PLACEHOLDER_ICON_PATHS.recruitment,
    PLACEHOLDER_ICON_PATHS.shrine,
    PLACEHOLDER_ICON_PATHS.mine
  ],
  hud: [PLACEHOLDER_ICON_PATHS.hud, PLACEHOLDER_ICON_PATHS.hero],
  battle: [PLACEHOLDER_ICON_PATHS.battle],
  timeline: [PLACEHOLDER_ICON_PATHS.timeline]
} as const satisfies Record<PlaceholderSpriteScope, readonly string[]>;

export const ALL_PLACEHOLDER_SCOPES = Object.keys(PLACEHOLDER_SCOPE_PATHS) as PlaceholderSpriteScope[];

export function normalizePlaceholderScopes(
  scopes: PlaceholderSpriteScope | PlaceholderSpriteScope[] | readonly PlaceholderSpriteScope[] | undefined
): PlaceholderSpriteScope[] {
  let requested: readonly PlaceholderSpriteScope[];
  if (scopes == null) {
    requested = ALL_PLACEHOLDER_SCOPES;
  } else if (typeof scopes === "string") {
    requested = [scopes];
  } else {
    requested = scopes;
  }
  const seen = new Set<PlaceholderSpriteScope>();
  const normalized: PlaceholderSpriteScope[] = [];
  for (const scope of requested) {
    if (!ALL_PLACEHOLDER_SCOPES.includes(scope) || seen.has(scope)) {
      continue;
    }
    seen.add(scope);
    normalized.push(scope);
  }
  return normalized;
}

export function resolvePlaceholderSpritePathsForScopes(
  scopes?: PlaceholderSpriteScope | PlaceholderSpriteScope[] | readonly PlaceholderSpriteScope[]
): string[] {
  const normalizedScopes = normalizePlaceholderScopes(scopes);
  const orderedPaths: string[] = [];
  const seen = new Set<string>();
  for (const scope of normalizedScopes) {
    for (const path of PLACEHOLDER_SCOPE_PATHS[scope]) {
      if (seen.has(path)) {
        continue;
      }
      seen.add(path);
      orderedPaths.push(path);
    }
  }
  return orderedPaths;
}
