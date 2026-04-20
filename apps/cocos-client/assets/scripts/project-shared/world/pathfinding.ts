import type {
  FogState,
  HeroState,
  MovementPlan,
  NeutralArmyState,
  PlayerTileView,
  PlayerWorldView,
  TileState,
  Vec2,
  WorldState
} from "../models.ts";
import { getDefaultUnitCatalog } from "../world-config.ts";
import {
  clonePosition,
  distance,
  findTile,
  getNeighbors,
  isTraversableTile,
  samePosition,
  terrainMoveCost,
  tileKey
} from "./map-geometry.ts";

function findHero(state: WorldState, heroId: string): HeroState | undefined {
  return state.heroes.find((hero) => hero.id === heroId);
}

export function templateHasBattleSkill(templateId: string, skillId: string): boolean {
  const template = getDefaultUnitCatalog().templates.find((item) => item.id === templateId);
  return template?.battleSkills?.includes(skillId) ?? false;
}

export function heroCanFlyOverWater(hero: Pick<HeroState, "armyTemplateId">): boolean {
  return templateHasBattleSkill(hero.armyTemplateId, "skybound");
}

export function neutralArmyCanFlyOverWater(neutralArmy: NeutralArmyState): boolean {
  return neutralArmy.stacks.some((stack) => templateHasBattleSkill(stack.templateId, "skybound"));
}
export function findPlayerTile(view: PlayerWorldView, position: Vec2): PlayerTileView | undefined {
  if (position.x < 0 || position.y < 0 || position.x >= view.map.width || position.y >= view.map.height) {
    return undefined;
  }

  return view.map.tiles[position.y * view.map.width + position.x];
}

export function getFogAt(visibility: FogState[] | undefined, index: number): FogState {
  return visibility?.[index] ?? "hidden";
}

export function getPlayerNeighbors(view: PlayerWorldView, position: Vec2): Vec2[] {
  const candidates = [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 }
  ];

  return candidates.filter((item) => item.x >= 0 && item.y >= 0 && item.x < view.map.width && item.y < view.map.height);
}
export function isBlockedForPlayerView(
  view: PlayerWorldView,
  heroId: string,
  position: Vec2,
  destination: Vec2,
  hero?: Pick<HeroState, "id" | "armyTemplateId" | "position">,
  canFly?: boolean
): boolean {
  const tile = findPlayerTile(view, position);
  const effectiveHero = hero ?? view.ownHeroes.find((item) => item.id === heroId);
  const effectiveCanFly = canFly ?? (effectiveHero ? heroCanFlyOverWater(effectiveHero) : false);
  if (!tile || !effectiveHero || tile.fog === "hidden" || !isTraversableTile(tile, effectiveCanFly)) {
    return true;
  }

  const occupant = tile.occupant;
  if (occupant?.kind === "neutral" && !samePosition(position, destination)) {
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
export function reconstructPath(cameFrom: Map<string, Vec2>, current: Vec2): Vec2[] {
  const path: Vec2[] = [current];
  let cursor = current;
  while (cameFrom.has(tileKey(cursor))) {
    cursor = cameFrom.get(tileKey(cursor))!;
    path.unshift(cursor);
  }
  return path;
}
export function popLowestScoreNode(openSet: Vec2[], fScore: Map<string, number>): Vec2 | undefined {
  if (openSet.length === 0) {
    return undefined;
  }

  let bestIndex = 0;
  let bestScore = fScore.get(tileKey(openSet[0]!)) ?? Number.POSITIVE_INFINITY;
  for (let index = 1; index < openSet.length; index += 1) {
    const candidate = openSet[index]!;
    const candidateScore = fScore.get(tileKey(candidate)) ?? Number.POSITIVE_INFINITY;
    if (candidateScore < bestScore) {
      bestIndex = index;
      bestScore = candidateScore;
    }
  }

  return openSet.splice(bestIndex, 1)[0];
}
export function isBlockedForHero(
  state: WorldState,
  heroId: string,
  position: Vec2,
  destination: Vec2,
  hero?: HeroState,
  canFly?: boolean
): boolean {
  const tile = findTile(state.map, position);
  const effectiveHero = hero ?? findHero(state, heroId);
  const effectiveCanFly = canFly ?? (effectiveHero ? heroCanFlyOverWater(effectiveHero) : false);
  if (!tile || !effectiveHero || !isTraversableTile(tile, effectiveCanFly)) {
    return true;
  }

  const occupant = tile.occupant;
  if (occupant?.kind === "neutral" && !samePosition(position, destination)) {
    return true;
  }

  return state.heroes.some((hero) => hero.id !== heroId && samePosition(hero.position, position) && !samePosition(position, destination));
}
export function isBlockedForNeutral(
  state: WorldState,
  neutralArmyId: string,
  position: Vec2,
  destination: Vec2,
  targetHeroId?: string
): boolean {
  const tile = findTile(state.map, position);
  const neutralArmy = state.neutralArmies[neutralArmyId];
  if (!tile || !neutralArmy || !isTraversableTile(tile, neutralArmyCanFlyOverWater(neutralArmy)) || tile.building) {
    return true;
  }

  const occupant = tile.occupant;
  if (occupant?.kind === "neutral" && occupant.refId !== neutralArmyId) {
    return true;
  }

  if (occupant?.kind === "hero" && (!samePosition(position, destination) || occupant.refId !== targetHeroId)) {
    return true;
  }

  return false;
}
export function fallbackNeutralStep(
  state: WorldState,
  neutralArmyId: string,
  from: Vec2,
  destination: Vec2,
  targetHeroId?: string
): Vec2 | undefined {
  const availableExitCount = (position: Vec2): number =>
    getNeighbors(state.map, position).filter((neighbor) => {
      if (samePosition(neighbor, from)) {
        return true;
      }

      return !isBlockedForNeutral(state, neutralArmyId, neighbor, destination, targetHeroId);
    }).length;

  const candidates = getNeighbors(state.map, from)
    .filter((neighbor) => !isBlockedForNeutral(state, neutralArmyId, neighbor, destination, targetHeroId))
    .sort((left, right) => {
      const delta = distance(left, destination) - distance(right, destination);
      if (delta !== 0) {
        return delta;
      }

      const exitDelta = availableExitCount(right) - availableExitCount(left);
      return exitDelta !== 0 ? exitDelta : tileKey(left).localeCompare(tileKey(right));
    });
  return candidates[0];
}
export function getNeutralMovementPath(
  state: WorldState,
  neutralArmyId: string,
  destination: Vec2,
  targetHeroId?: string,
  startPosition?: Vec2
): Vec2[] | undefined {
  const neutralArmy = state.neutralArmies[neutralArmyId];
  if (!neutralArmy) {
    return undefined;
  }

  const start = startPosition ?? neutralArmy.position;

  if (samePosition(start, destination)) {
    return [clonePosition(start)];
  }

  const openSet: Vec2[] = [start];
  const openSetKeys = new Set<string>([tileKey(start)]);
  const cameFrom = new Map<string, Vec2>();
  const gScore = new Map<string, number>([[tileKey(start), 0]]);
  const fScore = new Map<string, number>([[tileKey(start), distance(start, destination)]]);

  while (openSet.length > 0) {
    const current = popLowestScoreNode(openSet, fScore)!;
    openSetKeys.delete(tileKey(current));
    if (samePosition(current, destination)) {
      return reconstructPath(cameFrom, current);
    }

    for (const neighbor of getNeighbors(state.map, current)) {
      if (isBlockedForNeutral(state, neutralArmyId, neighbor, destination, targetHeroId)) {
        continue;
      }

      const tentative = (gScore.get(tileKey(current)) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentative >= (gScore.get(tileKey(neighbor)) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      const neighborKey = tileKey(neighbor);
      cameFrom.set(neighborKey, current);
      gScore.set(neighborKey, tentative);
      fScore.set(neighborKey, tentative + distance(neighbor, destination));
      if (!openSetKeys.has(neighborKey)) {
        openSet.push(neighbor);
        openSetKeys.add(neighborKey);
      }
    }
  }

  return undefined;
}
export function getMovementPlan(state: WorldState, heroId: string, destination: Vec2): MovementPlan | undefined {
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

  const canFly = heroCanFlyOverWater(hero);
  const openSet: Vec2[] = [hero.position];
  const openSetKeys = new Set<string>([tileKey(hero.position)]);
  const cameFrom = new Map<string, Vec2>();
  const gScore = new Map<string, number>([[tileKey(hero.position), 0]]);
  const fScore = new Map<string, number>([[tileKey(hero.position), distance(hero.position, destination)]]);

  while (openSet.length > 0) {
    const current = popLowestScoreNode(openSet, fScore)!;
    openSetKeys.delete(tileKey(current));
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
      const moveCost = travelPath.slice(1).reduce((total, step) => {
        const tile = findTile(state.map, step);
        return total + (tile ? terrainMoveCost(tile.terrain) : 1);
      }, 0);
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
      const tile = findTile(state.map, neighbor);
      if (!tile || !isTraversableTile(tile, canFly)) {
        continue;
      }
      if (isBlockedForHero(state, heroId, neighbor, destination, hero, canFly)) {
        continue;
      }

      const tentative =
        (gScore.get(tileKey(current)) ?? Number.POSITIVE_INFINITY) + terrainMoveCost(tile.terrain);
      if (tentative >= (gScore.get(tileKey(neighbor)) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      const neighborKey = tileKey(neighbor);
      cameFrom.set(neighborKey, current);
      gScore.set(neighborKey, tentative);
      fScore.set(neighborKey, tentative + distance(neighbor, destination));
      if (!openSetKeys.has(neighborKey)) {
        openSet.push(neighbor);
        openSetKeys.add(neighborKey);
      }
    }
  }

  return undefined;
}

export function getMovementDistance(plan: Pick<MovementPlan, "path">): number {
  return Math.max(0, plan.path.length - 1);
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
  if (!destinationTile || destinationTile.fog === "hidden" || !isTraversableTile(destinationTile, heroCanFlyOverWater(hero))) {
    return undefined;
  }

  const canFly = heroCanFlyOverWater(hero);
  const openSet: Vec2[] = [hero.position];
  const openSetKeys = new Set<string>([tileKey(hero.position)]);
  const cameFrom = new Map<string, Vec2>();
  const gScore = new Map<string, number>([[tileKey(hero.position), 0]]);
  const fScore = new Map<string, number>([[tileKey(hero.position), distance(hero.position, destination)]]);

  while (openSet.length > 0) {
    const current = popLowestScoreNode(openSet, fScore)!;
    openSetKeys.delete(tileKey(current));
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
      const moveCost = travelPath.slice(1).reduce((total, step) => {
        const tile = findPlayerTile(view, step);
        return total + (tile ? terrainMoveCost(tile.terrain) : 1);
      }, 0);
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
      const tile = findPlayerTile(view, neighbor);
      if (!tile || tile.fog === "hidden" || !isTraversableTile(tile, canFly)) {
        continue;
      }
      if (isBlockedForPlayerView(view, heroId, neighbor, destination, hero, canFly)) {
        continue;
      }

      const tentative =
        (gScore.get(tileKey(current)) ?? Number.POSITIVE_INFINITY) + terrainMoveCost(tile.terrain);
      if (tentative >= (gScore.get(tileKey(neighbor)) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      const neighborKey = tileKey(neighbor);
      cameFrom.set(neighborKey, current);
      gScore.set(neighborKey, tentative);
      fScore.set(neighborKey, tentative + distance(neighbor, destination));
      if (!openSetKeys.has(neighborKey)) {
        openSet.push(neighbor);
        openSetKeys.add(neighborKey);
      }
    }
  }

  return undefined;
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

