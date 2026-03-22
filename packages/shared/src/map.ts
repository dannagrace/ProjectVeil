import type {
  BattleOutcome,
  FogState,
  HeroState,
  HeroConfig,
  MovementPlan,
  NeutralArmyState,
  OccupantState,
  PlayerTileView,
  PlayerWorldPrediction,
  PlayerWorldView,
  ResourceLedger,
  ResourceKind,
  TileState,
  Vec2,
  ValidationResult,
  WorldAction,
  WorldActionOutcome,
  WorldEvent,
  WorldMapState,
  WorldResourceLedger,
  WorldState
} from "./models";
import {
  normalizeHeroState,
  totalExperienceRequiredForLevel
} from "./models";
import { getDefaultMapObjectsConfig, getDefaultWorldConfig } from "./world-config";

function makeRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function samePosition(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function inBounds(map: WorldMapState, position: Vec2): boolean {
  return position.x >= 0 && position.y >= 0 && position.x < map.width && position.y < map.height;
}

function tileKey(position: Vec2): string {
  return `${position.x},${position.y}`;
}

function tileIndex(map: WorldMapState, position: Vec2): number {
  return position.y * map.width + position.x;
}

function createTerrainTile(position: Vec2, roll: number): TileState {
  const terrain = roll < 0.55 ? "grass" : roll < 0.75 ? "dirt" : roll < 0.92 ? "sand" : "water";
  return {
    position,
    terrain,
    walkable: terrain !== "water",
    resource: undefined,
    occupant: undefined
  };
}

function createResourceNode(
  roll: number,
  chances: { goldChance: number; woodChance: number; oreChance: number }
): { kind: ResourceKind; amount: number } | undefined {
  const goldThreshold = chances.goldChance;
  const woodThreshold = goldThreshold + chances.woodChance;
  const oreThreshold = woodThreshold + chances.oreChance;

  if (roll > oreThreshold) {
    return undefined;
  }

  if (roll < goldThreshold) {
    return { kind: "gold", amount: 500 };
  }

  if (roll < woodThreshold) {
    return { kind: "wood", amount: 5 };
  }

  return { kind: "ore", amount: 5 };
}

function createEmptyResourceLedger(): ResourceLedger {
  return {
    gold: 0,
    wood: 0,
    ore: 0
  };
}

function createWorldResourceLedger(heroes: HeroState[]): WorldResourceLedger {
  return Object.fromEntries(
    Array.from(new Set(heroes.map((hero) => hero.playerId))).map((playerId) => [playerId, createEmptyResourceLedger()])
  );
}

function normalizeHeroes<T extends HeroConfig | HeroState>(heroes: T[]): HeroState[] {
  return heroes.map((hero) => normalizeHeroState(hero));
}

function neutralBattleExperience(army: NeutralArmyState): number {
  return army.stacks.reduce((total, stack) => total + stack.count * 15, 0);
}

function heroBattleExperience(hero: HeroState): number {
  return Math.max(100, hero.armyCount * 12 + hero.progression.level * 20);
}

function applyHeroExperience(
  hero: HeroState,
  experienceGained: number,
  battleKind: "neutral" | "hero"
): {
  hero: HeroState;
  experienceGained: number;
  levelsGained: number;
} {
  const safeExperience = Math.max(0, Math.floor(experienceGained));
  if (safeExperience === 0) {
    return {
      hero,
      experienceGained: 0,
      levelsGained: 0
    };
  }

  const totalExperience = hero.progression.experience + safeExperience;
  let nextLevel = hero.progression.level;
  while (totalExperience >= totalExperienceRequiredForLevel(nextLevel + 1)) {
    nextLevel += 1;
  }

  const levelsGained = nextLevel - hero.progression.level;

  return {
    hero: {
      ...hero,
      stats: {
        ...hero.stats,
        attack: hero.stats.attack + levelsGained,
        defense: hero.stats.defense + levelsGained,
        maxHp: hero.stats.maxHp + levelsGained * 2
      },
      progression: {
        ...hero.progression,
        level: nextLevel,
        experience: totalExperience,
        battlesWon: hero.progression.battlesWon + 1,
        neutralBattlesWon: hero.progression.neutralBattlesWon + (battleKind === "neutral" ? 1 : 0),
        pvpBattlesWon: hero.progression.pvpBattlesWon + (battleKind === "hero" ? 1 : 0)
      }
    },
    experienceGained: safeExperience,
    levelsGained
  };
}

function getPlayerResources(resources: WorldResourceLedger, playerId: string): ResourceLedger {
  return {
    ...createEmptyResourceLedger(),
    ...(resources[playerId] ?? {})
  };
}

function grantResource(
  resources: WorldResourceLedger,
  playerId: string,
  resource: { kind: ResourceKind; amount: number }
): WorldResourceLedger {
  const next = getPlayerResources(resources, playerId);
  return {
    ...resources,
    [playerId]: {
      ...next,
      [resource.kind]: (next[resource.kind] ?? 0) + resource.amount
    }
  };
}

function findTile(map: WorldMapState, position: Vec2): TileState | undefined {
  if (!inBounds(map, position)) {
    return undefined;
  }

  return map.tiles[tileIndex(map, position)];
}

function findPlayerTile(view: PlayerWorldView, position: Vec2): PlayerTileView | undefined {
  if (position.x < 0 || position.y < 0 || position.x >= view.map.width || position.y >= view.map.height) {
    return undefined;
  }

  return view.map.tiles[position.y * view.map.width + position.x];
}

function getFogAt(visibility: FogState[] | undefined, index: number): FogState {
  return visibility?.[index] ?? "hidden";
}

function getPlayerNeighbors(view: PlayerWorldView, position: Vec2): Vec2[] {
  const candidates = [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 }
  ];

  return candidates.filter((item) => item.x >= 0 && item.y >= 0 && item.x < view.map.width && item.y < view.map.height);
}

function isBlockedForPlayerView(view: PlayerWorldView, heroId: string, position: Vec2, destination: Vec2): boolean {
  const tile = findPlayerTile(view, position);
  if (!tile || tile.fog === "hidden" || !tile.walkable) {
    return true;
  }

  const occupant = tile.occupant;
  if ((occupant?.kind === "neutral" || occupant?.kind === "building") && !samePosition(position, destination)) {
    return true;
  }

  const occupiedByOtherOwnedHero = view.ownHeroes.some(
    (hero) => hero.id !== heroId && samePosition(hero.position, position) && !samePosition(position, destination)
  );
  if (occupiedByOtherOwnedHero) {
    return true;
  }

  return view.visibleHeroes.some(
    (hero) => hero.id !== heroId && samePosition(hero.position, position) && !samePosition(position, destination)
  );
}

function updateVisibilityByPlayer(map: WorldMapState, heroes: HeroState[], state: WorldState): Record<string, FogState[]> {
  const nextVisibility = { ...state.visibilityByPlayer };
  const heroGroups = new Map<string, HeroState[]>();

  for (const hero of heroes) {
    const group = heroGroups.get(hero.playerId) ?? [];
    group.push(hero);
    heroGroups.set(hero.playerId, group);
  }

  for (const [playerId, ownedHeroes] of heroGroups) {
    const previous = nextVisibility[playerId] ?? new Array<FogState>(map.tiles.length).fill("hidden");
    nextVisibility[playerId] = map.tiles.map((tile, index) => {
      const visible = ownedHeroes.some((hero) => distance(hero.position, tile.position) <= hero.vision);
      if (visible) {
        return "visible";
      }

      return getFogAt(previous, index) === "visible" ? "explored" : getFogAt(previous, index);
    });
  }

  return nextVisibility;
}

function syncOccupants(map: WorldMapState, heroes: HeroState[], neutralArmies: Record<string, NeutralArmyState>): WorldMapState {
  const heroByKey = new Map<string, OccupantState>(
    heroes.map((hero) => [tileKey(hero.position), { kind: "hero", refId: hero.id }])
  );
  const neutralByKey = new Map<string, OccupantState>(
    Object.values(neutralArmies).map((army) => [tileKey(army.position), { kind: "neutral", refId: army.id }])
  );

  return {
    ...map,
    tiles: map.tiles.map((tile) => {
      const heroOccupant = heroByKey.get(tileKey(tile.position));
      if (heroOccupant) {
        return { ...tile, occupant: heroOccupant };
      }

      const neutralOccupant = neutralByKey.get(tileKey(tile.position));
      if (neutralOccupant) {
        return { ...tile, occupant: neutralOccupant };
      }

      return tile.occupant
        ? {
            ...tile,
            occupant: undefined
          }
        : tile;
    })
  };
}

function reconstructPath(cameFrom: Map<string, Vec2>, current: Vec2): Vec2[] {
  const path: Vec2[] = [current];
  let cursor = current;
  while (cameFrom.has(tileKey(cursor))) {
    cursor = cameFrom.get(tileKey(cursor))!;
    path.unshift(cursor);
  }
  return path;
}

function getNeighbors(map: WorldMapState, position: Vec2): Vec2[] {
  const candidates = [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 }
  ];

  return candidates.filter((item) => inBounds(map, item));
}

function isBlockedForHero(state: WorldState, heroId: string, position: Vec2, destination: Vec2): boolean {
  const tile = findTile(state.map, position);
  if (!tile || !tile.walkable) {
    return true;
  }

  const occupant = tile.occupant;
  if (occupant?.kind === "neutral" && !samePosition(position, destination)) {
    return true;
  }

  return state.heroes.some((hero) => hero.id !== heroId && samePosition(hero.position, position) && !samePosition(position, destination));
}

function getMovementPlan(state: WorldState, heroId: string, destination: Vec2): MovementPlan | undefined {
  const hero = state.heroes.find((item) => item.id === heroId);
  if (!hero) {
    return undefined;
  }

  if (samePosition(hero.position, destination)) {
      return {
        heroId,
        destination,
        path: [hero.position],
        travelPath: [hero.position],
        moveCost: 0,
        endsInEncounter: false,
        encounterKind: "none"
      };
  }

  const openSet: Vec2[] = [hero.position];
  const cameFrom = new Map<string, Vec2>();
  const gScore = new Map<string, number>([[tileKey(hero.position), 0]]);
  const fScore = new Map<string, number>([[tileKey(hero.position), distance(hero.position, destination)]]);

  while (openSet.length > 0) {
    openSet.sort((a, b) => (fScore.get(tileKey(a)) ?? Number.POSITIVE_INFINITY) - (fScore.get(tileKey(b)) ?? Number.POSITIVE_INFINITY));
    const current = openSet.shift()!;
    if (samePosition(current, destination)) {
      const path = reconstructPath(cameFrom, current);
      const destinationTile = findTile(state.map, destination);
      const encounterKind =
        destinationTile?.occupant?.kind === "neutral"
          ? "neutral"
          : destinationTile?.occupant?.kind === "hero"
            ? "hero"
            : "none";
      const endsInEncounter = encounterKind !== "none";
      const travelPath = endsInEncounter ? path.slice(0, -1) : path;
      const moveCost = Math.max(0, travelPath.length - 1);
      return {
        heroId,
        destination,
        path,
        travelPath,
        moveCost,
        endsInEncounter,
        encounterKind,
        ...(destinationTile?.occupant?.refId ? { encounterRefId: destinationTile.occupant.refId } : {})
      };
    }

    for (const neighbor of getNeighbors(state.map, current)) {
      if (isBlockedForHero(state, heroId, neighbor, destination)) {
        continue;
      }

      const tentative = (gScore.get(tileKey(current)) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentative >= (gScore.get(tileKey(neighbor)) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(tileKey(neighbor), current);
      gScore.set(tileKey(neighbor), tentative);
      fScore.set(tileKey(neighbor), tentative + distance(neighbor, destination));
      if (!openSet.some((item) => samePosition(item, neighbor))) {
        openSet.push(neighbor);
      }
    }
  }

  return undefined;
}

function buildNextWorldState(base: WorldState, heroes: HeroState[], neutralArmies: Record<string, NeutralArmyState>): WorldState {
  const nextMap = syncOccupants(base.map, heroes, neutralArmies);
  return {
    ...base,
    heroes,
    neutralArmies,
    map: nextMap,
    visibilityByPlayer: updateVisibilityByPlayer(nextMap, heroes, base)
  };
}

export function findPath(state: WorldState, heroId: string, destination: Vec2): Vec2[] | undefined {
  return getMovementPlan(state, heroId, destination)?.path;
}

export function planHeroMovement(state: WorldState, heroId: string, destination: Vec2): MovementPlan | undefined {
  return getMovementPlan(state, heroId, destination);
}

export function planPlayerViewMovement(
  view: PlayerWorldView,
  heroId: string,
  destination: Vec2
): MovementPlan | undefined {
  const hero = view.ownHeroes.find((item) => item.id === heroId);
  if (!hero) {
    return undefined;
  }

  if (samePosition(hero.position, destination)) {
    return {
      heroId,
      destination,
      path: [hero.position],
      travelPath: [hero.position],
      moveCost: 0,
      endsInEncounter: false,
      encounterKind: "none"
    };
  }

  const destinationTile = findPlayerTile(view, destination);
  if (!destinationTile || destinationTile.fog === "hidden" || !destinationTile.walkable) {
    return undefined;
  }

  const openSet: Vec2[] = [hero.position];
  const cameFrom = new Map<string, Vec2>();
  const gScore = new Map<string, number>([[tileKey(hero.position), 0]]);
  const fScore = new Map<string, number>([[tileKey(hero.position), distance(hero.position, destination)]]);

  while (openSet.length > 0) {
    openSet.sort((a, b) => (fScore.get(tileKey(a)) ?? Number.POSITIVE_INFINITY) - (fScore.get(tileKey(b)) ?? Number.POSITIVE_INFINITY));
    const current = openSet.shift()!;
    if (samePosition(current, destination)) {
      const path = reconstructPath(cameFrom, current);
      const encounterKind =
        destinationTile.occupant?.kind === "neutral"
          ? "neutral"
          : destinationTile.occupant?.kind === "hero"
            ? "hero"
            : "none";
      const endsInEncounter = encounterKind !== "none";
      const travelPath = endsInEncounter ? path.slice(0, -1) : path;
      const moveCost = Math.max(0, travelPath.length - 1);
      return {
        heroId,
        destination,
        path,
        travelPath,
        moveCost,
        endsInEncounter,
        encounterKind,
        ...(destinationTile.occupant?.refId ? { encounterRefId: destinationTile.occupant.refId } : {})
      };
    }

    for (const neighbor of getPlayerNeighbors(view, current)) {
      if (isBlockedForPlayerView(view, heroId, neighbor, destination)) {
        continue;
      }

      const tentative = (gScore.get(tileKey(current)) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentative >= (gScore.get(tileKey(neighbor)) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(tileKey(neighbor), current);
      gScore.set(tileKey(neighbor), tentative);
      fScore.set(tileKey(neighbor), tentative + distance(neighbor, destination));
      if (!openSet.some((item) => samePosition(item, neighbor))) {
        openSet.push(neighbor);
      }
    }
  }

  return undefined;
}

export function createInitialWorldState(seed = 1001, roomId = "room-alpha"): WorldState {
  const rng = makeRng(seed);
  const config = getDefaultWorldConfig();
  const mapObjects = getDefaultMapObjectsConfig();
  const width = config.width;
  const height = config.height;
  const heroes: HeroState[] = normalizeHeroes(config.heroes);

  const tiles: TileState[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = createTerrainTile({ x, y }, rng());
      const guaranteedResource = mapObjects.guaranteedResources.find((item) => samePosition(item.position, { x, y }));
      if (guaranteedResource) {
        tile.resource = guaranteedResource.resource;
      } else if (tile.walkable && !heroes.some((hero) => hero.position.x === x && hero.position.y === y)) {
        tile.resource = createResourceNode(rng(), config.resourceSpawn);
      }
      tiles.push(tile);
    }
  }

  const neutralArmies: Record<string, NeutralArmyState> = Object.fromEntries(
    mapObjects.neutralArmies.map((army) => [army.id, { ...army, stacks: army.stacks.map((stack) => ({ ...stack })) }])
  );

  const initialMap = syncOccupants({ width, height, tiles }, heroes, neutralArmies);
  const initialState: WorldState = {
    meta: {
      roomId,
      seed,
      day: 1
    },
    map: initialMap,
    heroes,
    neutralArmies,
    resources: createWorldResourceLedger(heroes),
    visibilityByPlayer: {}
  };

  return {
    ...initialState,
    visibilityByPlayer: updateVisibilityByPlayer(initialState.map, initialState.heroes, initialState)
  };
}

export function listReachableTiles(state: WorldState, heroId: string): Vec2[] {
  const hero = state.heroes.find((item) => item.id === heroId);
  if (!hero) {
    return [];
  }

  return state.map.tiles
    .filter((tile) => {
      const plan = planHeroMovement(state, heroId, tile.position);
      return Boolean(plan && plan.moveCost <= hero.move.remaining);
    })
    .map((tile) => tile.position);
}

export function listReachableTilesInPlayerView(view: PlayerWorldView, heroId: string): Vec2[] {
  const hero = view.ownHeroes.find((item) => item.id === heroId);
  if (!hero) {
    return [];
  }

  return view.map.tiles
    .filter((tile) => {
      const plan = planPlayerViewMovement(view, heroId, tile.position);
      return Boolean(plan && plan.moveCost <= hero.move.remaining);
    })
    .map((tile) => tile.position);
}

export function predictPlayerWorldAction(view: PlayerWorldView, action: WorldAction): PlayerWorldPrediction {
  if (action.type === "turn.endDay") {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "prediction_not_supported"
    };
  }

  const hero = view.ownHeroes.find((item) => item.id === action.heroId);
  if (!hero) {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "hero_not_found"
    };
  }

  if (action.type === "hero.move") {
    const destinationTile = findPlayerTile(view, action.destination);
    if (!destinationTile) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "destination_not_found"
      };
    }

    if (!destinationTile.walkable || destinationTile.fog === "hidden") {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "destination_blocked"
      };
    }

    const occupiedByOtherHero = view.ownHeroes.find(
      (item) => item.id !== hero.id && samePosition(item.position, action.destination)
    );
    if (occupiedByOtherHero && occupiedByOtherHero.playerId === view.playerId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "destination_occupied"
      };
    }

    const plan = planPlayerViewMovement(view, hero.id, action.destination);
    if (!plan) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "path_not_found"
      };
    }

    if (plan.moveCost > hero.move.remaining) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "not_enough_move_points"
      };
    }

    const nextPosition = plan.travelPath[plan.travelPath.length - 1] ?? hero.position;
    const nextHeroes = view.ownHeroes.map((item) =>
      item.id === hero.id
        ? {
            ...item,
            position: nextPosition,
            move: {
              ...item.move,
              remaining: clamp(item.move.remaining - plan.moveCost, 0, item.move.total)
            }
          }
        : item
    );

    const nextTiles: PlayerTileView[] = view.map.tiles.map((tile) => {
      if (samePosition(tile.position, hero.position) && tile.occupant?.kind === "hero" && tile.occupant.refId === hero.id) {
        return {
          ...tile,
          occupant: undefined
        };
      }

      if (
        samePosition(tile.position, nextPosition) &&
        !plan.endsInEncounter &&
        tile.fog === "visible"
      ) {
        return {
          ...tile,
          occupant: {
            kind: "hero",
            refId: hero.id
          }
        };
      }

      return tile;
    });

    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: nextHeroes,
      map: {
        ...view.map,
        tiles: nextTiles
      }
    };

    return {
      world: predictedWorld,
      movementPlan: plan,
      reachableTiles: plan.endsInEncounter ? [] : listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  const tile = findPlayerTile(view, action.position);
  if (!tile) {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "resource_tile_not_found"
    };
  }

  if (!samePosition(hero.position, action.position)) {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "hero_not_on_tile"
    };
  }

  if (!tile.resource) {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "resource_missing"
    };
  }

  const nextTiles = view.map.tiles.map((item) =>
    samePosition(item.position, action.position)
      ? {
          ...item,
          resource: undefined
        }
      : item
  );

  const predictedWorld: PlayerWorldView = {
    ...view,
    map: {
      ...view.map,
      tiles: nextTiles
    },
    resources: {
      ...view.resources,
      [tile.resource.kind]: view.resources[tile.resource.kind] + tile.resource.amount
    }
  };

  return {
    world: predictedWorld,
    movementPlan: null,
    reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
  };
}

export function validateWorldAction(state: WorldState, action: WorldAction): ValidationResult {
  if (action.type === "turn.endDay") {
    return { valid: true };
  }

  const hero = state.heroes.find((item) => item.id === action.heroId);
  if (!hero) {
    return { valid: false, reason: "hero_not_found" };
  }

  if (action.type === "hero.move") {
    const tile = findTile(state.map, action.destination);
    if (!tile) {
      return { valid: false, reason: "destination_not_found" };
    }

    if (!tile.walkable) {
      return { valid: false, reason: "destination_blocked" };
    }

    const occupiedByOtherHero = state.heroes.find(
      (item) => item.id !== hero.id && samePosition(item.position, action.destination)
    );
    if (occupiedByOtherHero && occupiedByOtherHero.playerId === hero.playerId) {
      return { valid: false, reason: "destination_occupied" };
    }

    const plan = planHeroMovement(state, hero.id, action.destination);
    if (!plan) {
      return { valid: false, reason: "path_not_found" };
    }

    if (plan.moveCost > hero.move.remaining) {
      return { valid: false, reason: "not_enough_move_points" };
    }

    return { valid: true };
  }

  const tile = findTile(state.map, action.position);
  if (!tile) {
    return { valid: false, reason: "resource_tile_not_found" };
  }

  if (!samePosition(hero.position, action.position)) {
    return { valid: false, reason: "hero_not_on_tile" };
  }

  if (!tile.resource) {
    return { valid: false, reason: "resource_missing" };
  }

  return { valid: true };
}

export function createPlayerWorldView(state: WorldState, playerId: string): PlayerWorldView {
  const visibility = state.visibilityByPlayer[playerId] ?? new Array<FogState>(state.map.tiles.length).fill("hidden");
  const tiles: PlayerTileView[] = state.map.tiles.map((tile, index) => {
    const fog = getFogAt(visibility, index);
    if (fog === "hidden") {
      return {
        position: tile.position,
        fog,
        terrain: "unknown",
        walkable: false,
        resource: undefined,
        occupant: undefined
      };
    }

    if (fog === "explored") {
      return {
        position: tile.position,
        fog,
        terrain: tile.terrain,
        walkable: tile.walkable,
        resource: undefined,
        occupant: undefined
      };
    }

    return {
      position: tile.position,
      fog,
      terrain: tile.terrain,
      walkable: tile.walkable,
      resource: tile.resource,
      occupant: tile.occupant
    };
  });

  return {
    meta: state.meta,
    map: {
      width: state.map.width,
      height: state.map.height,
      tiles
    },
    ownHeroes: state.heroes.filter((hero) => hero.playerId === playerId),
    visibleHeroes: state.heroes
      .filter((hero) => hero.playerId !== playerId)
      .filter((hero) => getFogAt(visibility, tileIndex(state.map, hero.position)) === "visible")
      .map((hero) => ({
        id: hero.id,
        playerId: hero.playerId,
        name: hero.name,
        position: hero.position
      })),
    resources: getPlayerResources(state.resources, playerId),
    playerId
  };
}

export function resolveWorldAction(state: WorldState, action: WorldAction): WorldActionOutcome {
  if (action.type === "turn.endDay") {
    const heroes = state.heroes.map((hero) => ({
      ...hero,
      move: { ...hero.move, remaining: hero.move.total }
    }));
    const nextState = buildNextWorldState(
      {
        ...state,
        meta: {
          ...state.meta,
          day: state.meta.day + 1
        }
      },
      heroes,
      state.neutralArmies
    );
    return {
      state: nextState,
      events: [{ type: "turn.advanced", day: nextState.meta.day }]
    };
  }

  if (action.type === "hero.move") {
    const plan = planHeroMovement(state, action.heroId, action.destination);
    const hero = state.heroes.find((item) => item.id === action.heroId);
    if (!plan || !hero) {
      return { state, events: [] };
    }

    const nextPosition = plan.travelPath[plan.travelPath.length - 1] ?? hero.position;
    const heroes = state.heroes.map((item) =>
      item.id === action.heroId
        ? {
            ...item,
            position: nextPosition,
            move: {
              ...item.move,
              remaining: clamp(item.move.remaining - plan.moveCost, 0, item.move.total)
            }
          }
        : item
    );
    const nextState = buildNextWorldState(state, heroes, state.neutralArmies);

    if (plan.endsInEncounter) {
      const encounterRefId = plan.encounterRefId;
      return {
        state: nextState,
        movementPlan: plan,
        events: encounterRefId
          ? [
              {
                type: "battle.started",
                heroId: action.heroId,
                encounterKind: plan.encounterKind === "hero" ? "hero" : "neutral",
                ...(plan.encounterKind === "hero"
                  ? { defenderHeroId: encounterRefId, battleId: `battle-${action.heroId}-vs-${encounterRefId}` }
                  : { neutralArmyId: encounterRefId, battleId: `battle-${encounterRefId}` }),
                path: plan.travelPath,
                moveCost: plan.moveCost
              }
            ]
          : []
      };
    }

    return {
      state: nextState,
      movementPlan: plan,
      events: [
        {
          type: "hero.moved",
          heroId: action.heroId,
          path: plan.travelPath,
          moveCost: plan.moveCost
        }
      ]
    };
  }

  const hero = state.heroes.find((item) => item.id === action.heroId);
  const tile = findTile(state.map, action.position);
  if (!hero || !tile?.resource) {
    return { state, events: [] };
  }

  const resource = tile.resource;
  const nextTiles = state.map.tiles.map((item) =>
    samePosition(item.position, action.position)
      ? {
          ...item,
          resource: undefined
        }
      : item
  );
  const nextState = {
    ...state,
    map: { ...state.map, tiles: nextTiles },
    resources: grantResource(state.resources, hero.playerId, resource)
  };

  return {
    state: nextState,
    events: [
      {
        type: "hero.collected",
        heroId: action.heroId,
        resource
      }
    ]
  };
}

export function applyWorldAction(state: WorldState, action: WorldAction): WorldState {
  return resolveWorldAction(state, action).state;
}

export function filterWorldEventsForPlayer(
  state: WorldState,
  playerId: string,
  events: WorldEvent[]
): WorldEvent[] {
  const ownsHero = (heroId: string | undefined): boolean =>
    Boolean(heroId && state.heroes.some((hero) => hero.id === heroId && hero.playerId === playerId));

  return events.filter((event) => {
    switch (event.type) {
      case "turn.advanced":
        return true;
      case "hero.moved":
      case "hero.collected":
      case "hero.progressed":
        return ownsHero(event.heroId);
      case "battle.started":
      case "battle.resolved":
        return ownsHero(event.heroId) || ownsHero(event.defenderHeroId);
      default:
        return false;
    }
  });
}

export function applyBattleOutcomeToWorld(
  state: WorldState,
  battleId: string,
  heroId: string,
  outcome: BattleOutcome
): WorldActionOutcome {
  if (outcome.status === "in_progress") {
    return {
      state,
      events: []
    };
  }

  const attackerHero = state.heroes.find((hero) => hero.id === heroId);
  const pvpMatch = battleId.match(/^battle-(.+)-vs-(.+)$/);
  if (pvpMatch) {
    const attackerId = pvpMatch[1]!;
    const defenderId = pvpMatch[2]!;
    const defenderHero = state.heroes.find((hero) => hero.id === defenderId);
    if (!attackerHero || !defenderHero) {
      return { state, events: [] };
    }

    if (outcome.status === "defender_victory") {
      const awardedDefender = applyHeroExperience(defenderHero, heroBattleExperience(attackerHero), "hero");
      const heroes = state.heroes.map((hero) =>
        hero.id === attackerId
          ? {
              ...hero,
              stats: { ...hero.stats, hp: Math.max(1, Math.floor(hero.stats.hp * 0.5)) },
              move: { ...hero.move, remaining: 0 }
            }
          : hero.id === defenderId
            ? awardedDefender.hero
          : hero
      );
      return {
        state: buildNextWorldState(state, heroes, state.neutralArmies),
        events: [
          {
            type: "battle.resolved",
            heroId,
            battleId,
            ...(defenderId ? { defenderHeroId: defenderId } : {}),
            result: "defender_victory"
          },
          {
            type: "hero.progressed",
            heroId: defenderId,
            battleId,
            battleKind: "hero",
            experienceGained: awardedDefender.experienceGained,
            totalExperience: awardedDefender.hero.progression.experience,
            level: awardedDefender.hero.progression.level,
            levelsGained: awardedDefender.levelsGained
          }
        ]
      };
    }

    const occupied = new Set(
      state.heroes
        .filter((hero) => hero.id !== attackerId && hero.id !== defenderId)
        .map((hero) => tileKey(hero.position))
    );
    const retreatCandidates = getNeighbors(state.map, defenderHero.position).concat(defenderHero.position);
    const retreat = retreatCandidates.find((pos) => {
      const tile = findTile(state.map, pos);
      return tile?.walkable && !occupied.has(tileKey(pos)) && !samePosition(pos, defenderHero.position);
    }) ?? defenderHero.position;

    const awardedAttacker = applyHeroExperience(attackerHero, heroBattleExperience(defenderHero), "hero");
    const heroes = state.heroes.map((hero) => {
      if (hero.id === attackerId) {
        return {
          ...awardedAttacker.hero,
          position: defenderHero.position
        };
      }

      if (hero.id === defenderId) {
        return {
          ...hero,
          position: retreat,
          stats: { ...hero.stats, hp: Math.max(1, Math.floor(hero.stats.hp * 0.5)) },
          move: { ...hero.move, remaining: 0 }
        };
      }

      return hero;
    });

    return {
      state: buildNextWorldState(state, heroes, state.neutralArmies),
      events: [
          {
            type: "battle.resolved",
            heroId,
            battleId,
            ...(defenderId ? { defenderHeroId: defenderId } : {}),
            result: "attacker_victory"
          },
          {
            type: "hero.progressed",
            heroId: attackerId,
            battleId,
            battleKind: "hero",
            experienceGained: awardedAttacker.experienceGained,
            totalExperience: awardedAttacker.hero.progression.experience,
            level: awardedAttacker.hero.progression.level,
            levelsGained: awardedAttacker.levelsGained
          }
        ]
      };
  }

  const neutralArmyId = battleId.replace(/^battle-/, "");
  const neutralArmy = state.neutralArmies[neutralArmyId];
  if (!neutralArmy || !attackerHero) {
    return {
      state,
      events: []
    };
  }

  if (outcome.status === "defender_victory") {
    const heroes = state.heroes.map((hero) =>
      hero.id === heroId
        ? {
            ...hero,
            stats: {
              ...hero.stats,
              hp: Math.max(1, Math.floor(hero.stats.hp * 0.5))
            },
            move: {
              ...hero.move,
              remaining: 0
            }
          }
        : hero
    );
    return {
      state: buildNextWorldState(state, heroes, state.neutralArmies),
      events: [
        {
          type: "battle.resolved",
          heroId,
          battleId,
          result: "defender_victory"
        }
      ]
    };
  }

  const awardedAttacker = applyHeroExperience(attackerHero, neutralBattleExperience(neutralArmy), "neutral");
  const nextNeutralArmies = { ...state.neutralArmies };
  delete nextNeutralArmies[neutralArmyId];
  const heroes = state.heroes.map((hero) =>
    hero.id === heroId
      ? {
          ...awardedAttacker.hero,
          position: neutralArmy.position
        }
      : hero
  );
  const nextStateBase: WorldState = {
    ...state,
    resources: neutralArmy.reward
      ? grantResource(state.resources, attackerHero.playerId, neutralArmy.reward)
      : state.resources
  };
  const nextState = buildNextWorldState(nextStateBase, heroes, nextNeutralArmies);

  return {
    state: nextState,
    events: [
      {
        type: "battle.resolved",
        heroId,
        battleId,
        result: "attacker_victory"
      },
      {
        type: "hero.progressed" as const,
        heroId,
        battleId,
        battleKind: "neutral" as const,
        experienceGained: awardedAttacker.experienceGained,
        totalExperience: awardedAttacker.hero.progression.experience,
        level: awardedAttacker.hero.progression.level,
        levelsGained: awardedAttacker.levelsGained
      },
      ...(neutralArmy.reward
        ? [
            {
              type: "hero.collected" as const,
              heroId,
              resource: neutralArmy.reward
            }
          ]
        : [])
    ]
  };
}
