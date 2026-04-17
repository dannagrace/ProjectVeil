import type {
  HeroConfig,
  HeroState,
  HeroStatBonus,
  MapBuildingState,
  MapObjectsConfig,
  NeutralArmyBehaviorState,
  NeutralArmyState,
  NeutralMoveReason,
  ResourceKind,
  ResourceLedger,
  TileState,
  Vec2,
  WorldEvent,
  WorldGenerationConfig,
  WorldMapState,
  WorldResourceLedger,
  WorldState
} from "../models.ts";
import { createDeterministicRandomGenerator } from "../deterministic-rng.ts";
import {
  rollEquipmentDrop,
  tryAddEquipmentToInventory
} from "../equipment.ts";
import {
  normalizeHeroState,
  totalExperienceRequiredForLevel
} from "../models.ts";
import {
  getBuildingUpgradeConfig,
  getDefaultUnitCatalog,
  getRuntimeConfigBundleForRoom,
  validateMapObjectsConfig,
  validateWorldConfig
} from "../world-config.ts";
import {
  clamp,
  clonePosition,
  distance,
  findTile,
  getNeighbors,
  inBounds,
  isTraversableTile,
  samePosition,
  terrainMoveCost,
  tileKey
} from "./map-geometry.ts";
import {
  fallbackNeutralStep,
  getNeutralMovementPath,
  heroCanFlyOverWater,
  isBlockedForNeutral,
  neutralArmyCanFlyOverWater
} from "./pathfinding.ts";
import {
  syncWorldTiles,
  updateVisibilityByPlayer
} from "./fog-of-war.ts";

export function makeRng(seed: number): () => number {
  return createDeterministicRandomGenerator(seed);
}

export function hashSeed(base: number, value: string): number {
  let hash = base >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  }
  return hash >>> 0;
}
export function maybeAwardBattleEquipmentDrop(
  hero: HeroState,
  state: WorldState,
  battleId: string,
  battleKind: "neutral" | "hero"
): { hero: HeroState; event: Extract<WorldEvent, { type: "hero.equipmentFound" }> } | null {
  const rng = makeRng(hashSeed(hashSeed(state.meta.seed, `${battleId}:${hero.id}:${battleKind}`), `${state.meta.day}`));
  const drop = rollEquipmentDrop(rng(), rng(), rng());
  if (!drop) {
    return null;
  }

  const inventoryUpdate = tryAddEquipmentToInventory(hero.loadout.inventory, drop.itemId);

  return {
    hero: {
      ...hero,
      loadout: {
        ...hero.loadout,
        inventory: inventoryUpdate.inventory
      }
    },
    event: {
      type: "hero.equipmentFound",
      heroId: hero.id,
      battleId,
      battleKind,
      equipmentId: drop.itemId,
      equipmentName: drop.item.name,
      rarity: drop.item.rarity,
      ...(inventoryUpdate.stored ? {} : { overflowed: true })
    }
  };
}
export function createTerrainTile(position: Vec2, roll: number, forcedTerrain?: TileState["terrain"]): TileState {
  const terrain = forcedTerrain ?? (roll < 0.55 ? "grass" : roll < 0.75 ? "dirt" : roll < 0.92 ? "sand" : "water");
  return {
    position,
    terrain,
    walkable: terrain !== "water",
    resource: undefined,
    occupant: undefined,
    building: undefined
  };
}
export function ensureTileIsWalkable(tile: TileState): TileState {
  if (tile.walkable) {
    return tile;
  }

  return {
    ...tile,
    terrain: "grass",
    walkable: true
  };
}
export function createResourceNode(
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
export function createEmptyResourceLedger(): ResourceLedger {
  return {
    gold: 0,
    wood: 0,
    ore: 0
  };
}
export function createWorldResourceLedger(heroes: HeroState[]): WorldResourceLedger {
  return Object.fromEntries(
    Array.from(new Set(heroes.map((hero) => hero.playerId))).map((playerId) => [playerId, createEmptyResourceLedger()])
  );
}
export function cloneResourceLedger(ledger: ResourceLedger): ResourceLedger {
  return {
    gold: ledger.gold,
    wood: ledger.wood,
    ore: ledger.ore
  };
}
export function cloneHeroStatBonus(bonus: HeroStatBonus): HeroStatBonus {
  return {
    attack: bonus.attack,
    defense: bonus.defense,
    power: bonus.power,
    knowledge: bonus.knowledge
  };
}
export function cloneNeutralBehaviorState(behavior: NeutralArmyBehaviorState | undefined): NeutralArmyBehaviorState {
  const patrolPath = behavior?.patrolPath?.map(clonePosition) ?? [];
  const detectionRadius = Math.max(0, Math.floor(behavior?.detectionRadius ?? behavior?.patrolRadius ?? 0));
  const chaseDistance = Math.max(
    detectionRadius + 2,
    Math.floor(behavior?.chaseDistance ?? detectionRadius + 2)
  );
  const patrolRadius = Math.max(0, Math.floor(behavior?.patrolRadius ?? 0));
  const speed = Math.max(1, Math.floor(behavior?.speed ?? 1));
  const nextState =
    behavior?.state ?? (behavior?.mode === "patrol" && patrolPath.length > 0 ? "patrol" : "return");
  return {
    mode: behavior?.mode === "patrol" && patrolPath.length > 0 ? "patrol" : "guard",
    patrolPath,
    patrolIndex: patrolPath.length > 0 ? clamp(Math.floor(behavior?.patrolIndex ?? 0), 0, patrolPath.length - 1) : 0,
    patrolRadius,
    detectionRadius,
    chaseDistance,
    speed,
    state: nextState,
    ...(behavior?.targetHeroId ? { targetHeroId: behavior.targetHeroId } : {})
  };
}
export function resetNeutralBehaviorState(behavior: NeutralArmyBehaviorState | undefined): NeutralArmyBehaviorState | undefined {
  if (!behavior) {
    return undefined;
  }

  const clone = cloneNeutralBehaviorState(behavior);
  clone.state = clone.mode === "patrol" && clone.patrolPath.length > 0 ? "patrol" : "return";
  delete clone.targetHeroId;
  return clone;
}
export function buildPatrolLoop(origin: Vec2, radius: number, mapWidth: number, mapHeight: number): Vec2[] {
  if (radius <= 0) {
    return [];
  }

  const minX = clamp(origin.x - radius, 0, mapWidth - 1);
  const maxX = clamp(origin.x + radius, 0, mapWidth - 1);
  const minY = clamp(origin.y - radius, 0, mapHeight - 1);
  const maxY = clamp(origin.y + radius, 0, mapHeight - 1);
  const seen = new Set<string>();
  const path: Vec2[] = [];
  const record = (point: Vec2): void => {
    if (point.x < 0 || point.y < 0 || point.x >= mapWidth || point.y >= mapHeight) {
      return;
    }
    if (samePosition(point, origin)) {
      return;
    }
    const key = tileKey(point);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    path.push(point);
  };

  for (let x = minX; x <= maxX; x += 1) {
    record({ x, y: minY });
  }
  for (let y = minY + 1; y <= maxY; y += 1) {
    record({ x: maxX, y });
  }
  if (maxY > minY) {
    for (let x = maxX - 1; x >= minX; x -= 1) {
      record({ x, y: maxY });
    }
  }
  if (maxX > minX) {
    for (let y = maxY - 1; y > minY; y -= 1) {
      record({ x: minX, y });
    }
  }

  return path;
}
export function resolvePatrolPath(
  mapWidth: number,
  mapHeight: number,
  origin: Vec2,
  behavior: MapObjectsConfig["neutralArmies"][number]["behavior"] | undefined
): Vec2[] {
  if (!behavior) {
    return [];
  }

  const explicitPath = behavior.patrolPath?.map(clonePosition) ?? [];
  if (explicitPath.length > 0) {
    return explicitPath;
  }

  const radius = Math.max(0, Math.floor(behavior.patrolRadius ?? 0));
  if (radius <= 0) {
    return [];
  }

  return buildPatrolLoop(origin, radius, mapWidth, mapHeight);
}
export function normalizeNeutralArmyState(army: NeutralArmyState): NeutralArmyState {
  return {
    ...army,
    position: clonePosition(army.position),
    reward: army.reward ? { ...army.reward } : undefined,
    stacks: army.stacks.map((stack) => ({ ...stack })),
    origin: clonePosition(army.origin ?? army.position),
    behavior: cloneNeutralBehaviorState(army.behavior)
  };
}
export function normalizeNeutralArmyCollection(
  neutralArmies: Record<string, NeutralArmyState>
): Record<string, NeutralArmyState> {
  return Object.fromEntries(
    Object.entries(neutralArmies).map(([neutralArmyId, army]) => [neutralArmyId, normalizeNeutralArmyState(army)])
  );
}
export function createNeutralArmyState(
  config: MapObjectsConfig["neutralArmies"][number],
  mapWidth: number,
  mapHeight: number
): NeutralArmyState {
  const behaviorConfig = config.behavior;
  const patrolPath = resolvePatrolPath(mapWidth, mapHeight, config.position, behaviorConfig);
  const detectionRadius = Math.max(
    0,
    Math.floor(behaviorConfig?.detectionRadius ?? behaviorConfig?.aggroRange ?? behaviorConfig?.patrolRadius ?? 0)
  );
  const chaseDistance = Math.max(
    detectionRadius + 2,
    Math.floor(behaviorConfig?.chaseDistance ?? detectionRadius + 2)
  );
  const patrolRadius = Math.max(0, Math.floor(behaviorConfig?.patrolRadius ?? 0));
  const speed = Math.max(1, Math.floor(behaviorConfig?.speed ?? 1));
  const mode = behaviorConfig?.mode === "patrol" && patrolPath.length > 0 ? "patrol" : "guard";
  const initialState = mode === "patrol" && patrolPath.length > 0 ? "patrol" : "return";
  return normalizeNeutralArmyState({
    ...config,
    origin: clonePosition(config.position),
    behavior: {
      mode,
      patrolPath,
      patrolIndex: 0,
      patrolRadius,
      detectionRadius,
      chaseDistance,
      speed,
      state: initialState
    }
  });
}
export function createBuildingState(config: MapObjectsConfig["buildings"][number], heroes: HeroState[]): MapBuildingState {
  if (config.kind === "recruitment_post") {
    const ownerPlayerId = inferInitialBuildingOwnerPlayerId(config, heroes);
    return {
      ...config,
      position: { ...config.position },
      cost: cloneResourceLedger(config.cost),
      tier: 1,
      availableCount: config.recruitCount,
      ...(config.maxTier !== undefined ? { maxTier: config.maxTier } : {}),
      ...(ownerPlayerId ? { ownerPlayerId } : {})
    };
  }

  if (config.kind === "attribute_shrine") {
    return {
      ...config,
      position: { ...config.position },
      tier: 1,
      bonus: cloneHeroStatBonus(config.bonus)
    };
  }

  if (config.kind === "watchtower") {
    return {
      ...config,
      position: { ...config.position },
      tier: 1
    };
  }

  return {
    ...config,
    position: { ...config.position },
    tier: 1
  };
}
export function normalizeHeroes<T extends HeroConfig | HeroState>(heroes: T[]): HeroState[] {
  return heroes.map((hero) => normalizeHeroState(hero));
}
export function neutralBattleExperience(army: NeutralArmyState): number {
  return army.stacks.reduce((total, stack) => total + stack.count * 15, 0);
}
export function heroBattleExperience(hero: HeroState): number {
  return Math.max(100, hero.armyCount * 12 + hero.progression.level * 20);
}
export function applyHeroExperience(
  hero: HeroState,
  experienceGained: number,
  battleKind: "neutral" | "hero"
): {
  hero: HeroState;
  experienceGained: number;
  levelsGained: number;
  skillPointsAwarded: number;
} {
  const safeExperience = Math.max(0, Math.floor(experienceGained));
  if (safeExperience === 0) {
    return {
      hero,
      experienceGained: 0,
      levelsGained: 0,
      skillPointsAwarded: 0
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
        skillPoints: hero.progression.skillPoints + levelsGained,
        battlesWon: hero.progression.battlesWon + 1,
        neutralBattlesWon: hero.progression.neutralBattlesWon + (battleKind === "neutral" ? 1 : 0),
        pvpBattlesWon: hero.progression.pvpBattlesWon + (battleKind === "hero" ? 1 : 0)
      }
    },
    experienceGained: safeExperience,
    levelsGained,
    skillPointsAwarded: levelsGained
  };
}
export function getPlayerResources(resources: WorldResourceLedger, playerId: string): ResourceLedger {
  return {
    ...createEmptyResourceLedger(),
    ...(resources[playerId] ?? {})
  };
}
export function grantResource(
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
export function hasEnoughResources(resources: ResourceLedger, cost: ResourceLedger): boolean {
  return (resources.gold ?? 0) >= cost.gold && (resources.wood ?? 0) >= cost.wood && (resources.ore ?? 0) >= cost.ore;
}
export function spendResources(resources: WorldResourceLedger, playerId: string, cost: ResourceLedger): WorldResourceLedger {
  const next = getPlayerResources(resources, playerId);
  return {
    ...resources,
    [playerId]: {
      gold: Math.max(0, (next.gold ?? 0) - cost.gold),
      wood: Math.max(0, (next.wood ?? 0) - cost.wood),
      ore: Math.max(0, (next.ore ?? 0) - cost.ore)
    }
  };
}
export function getBuildingUpgradeTrackId(building: Pick<MapBuildingState, "kind">): "castle" | "mine" | null {
  if (building.kind === "recruitment_post") {
    return "castle";
  }
  if (building.kind === "resource_mine") {
    return "mine";
  }
  return null;
}
export function getBuildingUpgradeStep(building: Pick<MapBuildingState, "kind" | "tier">) {
  const trackId = getBuildingUpgradeTrackId(building);
  if (!trackId) {
    return null;
  }

  return getBuildingUpgradeConfig()[trackId].find((step) => step.fromTier === building.tier) ?? null;
}
export function getRequiredBuildingTierForUnit(unitTemplateId: string): number {
  const unitTemplate = getDefaultUnitCatalog().templates.find((item) => item.id === unitTemplateId);
  if (!unitTemplate) {
    return 1;
  }

  return unitTemplate.rarity === "legendary" ? 3 : unitTemplate.rarity === "elite" ? 2 : 1;
}
export function canHeroUpgradeBuilding(hero: Pick<HeroState, "position">, building: Pick<MapBuildingState, "position">): boolean {
  return distance(hero.position, building.position) <= 1;
}
export function inferInitialBuildingOwnerPlayerId(
  config: MapObjectsConfig["buildings"][number],
  heroes: HeroState[]
): string | undefined {
  if (config.kind !== "recruitment_post" || heroes.length === 0) {
    return undefined;
  }

  const sorted = heroes
    .map((hero) => ({
      playerId: hero.playerId,
      distance: distance(hero.position, config.position)
    }))
    .sort((left, right) => left.distance - right.distance);
  const nearest = sorted[0];
  const secondNearest = sorted[1];
  if (!nearest) {
    return undefined;
  }
  if (secondNearest && secondNearest.distance === nearest.distance && secondNearest.playerId !== nearest.playerId) {
    return undefined;
  }
  return nearest.playerId;
}
export function cloneBuildingState(building: MapBuildingState): MapBuildingState {
  if (building.kind === "recruitment_post") {
    return {
      ...building,
      position: { ...building.position },
      cost: cloneResourceLedger(building.cost)
    };
  }

  if (building.kind === "attribute_shrine") {
    return {
      ...building,
      position: { ...building.position },
      bonus: cloneHeroStatBonus(building.bonus)
    };
  }

  if (building.kind === "watchtower") {
    return {
      ...building,
      position: { ...building.position }
    };
  }

  return {
    ...building,
    position: { ...building.position }
  };
}
export function refreshBuildingForNewDay(building: MapBuildingState): MapBuildingState {
  if (building.kind === "recruitment_post") {
    return {
      ...building,
      position: { ...building.position },
      cost: cloneResourceLedger(building.cost),
      availableCount: building.recruitCount
    };
  }

  return cloneBuildingState(building);
}
export function isBuildingOnCurrentDayCooldown(day: number, lastUsedDay: number | undefined): boolean {
  return typeof lastUsedDay === "number" && lastUsedDay >= day;
}
export function applyHeroStatBonus(hero: HeroState, bonus: HeroStatBonus): HeroState {
  return {
    ...hero,
    stats: {
      ...hero.stats,
      attack: hero.stats.attack + bonus.attack,
      defense: hero.stats.defense + bonus.defense,
      power: hero.stats.power + bonus.power,
      knowledge: hero.stats.knowledge + bonus.knowledge
    }
  };
}
export function applyHeroVisionBonus(hero: HeroState, visionBonus: number): HeroState {
  return {
    ...hero,
    vision: hero.vision + visionBonus
  };
}
export function buildNextWorldState(
  base: WorldState,
  heroes: HeroState[],
  neutralArmies: Record<string, NeutralArmyState>,
  buildings: Record<string, MapBuildingState>
): WorldState {
  const normalizedNeutralArmies = normalizeNeutralArmyCollection(neutralArmies);
  const nextMap = syncWorldTiles(base.map, heroes, normalizedNeutralArmies, buildings);
  return {
    ...base,
    heroes,
    neutralArmies: normalizedNeutralArmies,
    buildings,
    map: nextMap,
    visibilityByPlayer: updateVisibilityByPlayer(nextMap, heroes, base)
  };
}

export function findHero(state: WorldState, heroId: string): HeroState | undefined {
  return state.heroes.find((hero) => hero.id === heroId);
}

export function findNeutralChaseTarget(
  state: WorldState,
  neutralArmy: NeutralArmyState,
  lockedHeroIds: Set<string>,
  detectionRadius: number,
  chaseDistance: number,
  preferredHeroId?: string
): { heroId: string; path: Vec2[] } | null {
  const heroPaths = state.heroes
    .map((hero) => ({
      heroId: hero.id,
      path: getNeutralMovementPath(state, neutralArmy.id, hero.position, hero.id)
    }))
    .filter((item): item is { heroId: string; path: Vec2[] } => Boolean(item.path && item.path.length > 0))
    .map((item) => ({
      ...item,
      distance: item.path.length - 1
    }));

  const preferred = heroPaths.find((item) => item.heroId === preferredHeroId);
  if (preferred && preferred.distance <= chaseDistance) {
    return { heroId: preferred.heroId, path: preferred.path };
  }

  if (detectionRadius <= 0) {
    return null;
  }

  const candidates = heroPaths
    .filter((item) => item.distance <= detectionRadius && !lockedHeroIds.has(item.heroId))
    .sort((left, right) => {
      const pathDelta = left.distance - right.distance;
      return pathDelta !== 0 ? pathDelta : left.heroId.localeCompare(right.heroId);
    });

  return candidates[0] ?? null;
}

export function moveNeutralArmy(
  neutralArmy: NeutralArmyState,
  nextPosition: Vec2,
  reason: NeutralMoveReason,
  behaviorState: NeutralArmyBehaviorState,
  targetHeroId?: string
): { army: NeutralArmyState; event: WorldEvent } {
  const behavior = cloneNeutralBehaviorState(behaviorState);
  return {
    army: {
      ...neutralArmy,
      position: clonePosition(nextPosition),
      origin: clonePosition(neutralArmy.origin ?? neutralArmy.position),
      behavior
    },
    event: {
      type: "neutral.moved",
      neutralArmyId: neutralArmy.id,
      from: clonePosition(neutralArmy.position),
      to: clonePosition(nextPosition),
      reason,
      ...(targetHeroId ? { targetHeroId } : {})
    }
  };
}

export function advancePatrol(
  state: WorldState,
  neutralArmy: NeutralArmyState,
  behavior: NeutralArmyBehaviorState,
  speed: number
): { position: Vec2; moved: boolean } {
  let stepsRemaining = speed;
  let currentPosition = neutralArmy.position;
  let moved = false;
  let patrolIndex = behavior.patrolIndex;

  while (stepsRemaining > 0 && behavior.patrolPath.length > 0) {
    const target = behavior.patrolPath[patrolIndex];
    if (!target) {
      break;
    }
    if (samePosition(currentPosition, target)) {
      patrolIndex = (patrolIndex + 1) % behavior.patrolPath.length;
      continue;
    }

    const path = getNeutralMovementPath(state, neutralArmy.id, target, undefined, currentPosition);
    if (!path || path.length < 2) {
      const fallback = fallbackNeutralStep(state, neutralArmy.id, currentPosition, target);
      if (!fallback) {
        break;
      }
      currentPosition = fallback;
      stepsRemaining -= 1;
      moved = true;
      continue;
    }

    const steps = Math.min(stepsRemaining, path.length - 1);
    const nextPosition = path[steps];
    if (!nextPosition) {
      break;
    }
    currentPosition = nextPosition;
    stepsRemaining -= steps;
    moved = moved || steps > 0;
    if (samePosition(currentPosition, target)) {
      patrolIndex = (patrolIndex + 1) % behavior.patrolPath.length;
    } else {
      break;
    }
  }

  behavior.patrolIndex = behavior.patrolPath.length > 0 ? patrolIndex % behavior.patrolPath.length : 0;
  return { position: currentPosition, moved };
}

export function resolveNeutralArmyTurn(
  state: WorldState,
  neutralArmy: NeutralArmyState,
  lockedHeroIds: Set<string>
): { army?: NeutralArmyState; events: WorldEvent[]; lockedHeroId?: string } {
  const behavior = cloneNeutralBehaviorState(neutralArmy.behavior);
  const detectionRadius = behavior.detectionRadius;
  const chaseDistance = Math.max(behavior.chaseDistance, detectionRadius + 2);
  const speed = Math.max(1, behavior.speed);
  const origin = neutralArmy.origin ?? neutralArmy.position;
  let behaviorChanged = false;

  const chaseTarget = findNeutralChaseTarget(
    state,
    neutralArmy,
    lockedHeroIds,
    detectionRadius,
    chaseDistance,
    behavior.targetHeroId
  );

  if (chaseTarget) {
    behavior.state = "chase";
    behavior.targetHeroId = chaseTarget.heroId;
    behaviorChanged = true;
    const stepsToHero = chaseTarget.path.length - 1;
    if (stepsToHero <= speed) {
      const hero = findHero(state, chaseTarget.heroId);
      return {
        army: {
          ...neutralArmy,
          behavior: cloneNeutralBehaviorState(behavior)
        },
        events: [
          {
            type: "battle.started",
            heroId: chaseTarget.heroId,
            attackerPlayerId: hero?.playerId ?? "",
            encounterKind: "neutral",
            neutralArmyId: neutralArmy.id,
            initiator: "neutral",
            battleId: `battle-${neutralArmy.id}`,
            path: [clonePosition(hero?.position ?? neutralArmy.position)],
            moveCost: 0
          }
        ],
        lockedHeroId: chaseTarget.heroId
      };
    }

    const nextIndex = Math.min(speed, chaseTarget.path.length - 1);
    const nextPosition = chaseTarget.path[nextIndex];
    if (!nextPosition) {
      return {
        army: {
          ...neutralArmy,
          behavior: cloneNeutralBehaviorState(behavior)
        },
        events: []
      };
    }
    const movement = moveNeutralArmy(neutralArmy, nextPosition, "chase", behavior, chaseTarget.heroId);
    return {
      army: movement.army,
      events: [movement.event]
    };
  }

  if (behavior.state === "chase") {
    behavior.state = "return";
    delete behavior.targetHeroId;
    behaviorChanged = true;
  }

  if (behavior.state === "return") {
    if (!samePosition(neutralArmy.position, origin)) {
      const path = getNeutralMovementPath(state, neutralArmy.id, origin);
      let nextPosition: Vec2 | undefined;
      if (path && path.length > 1) {
        const stepIndex = Math.min(speed, path.length - 1);
        nextPosition = path[stepIndex];
      } else {
        nextPosition = fallbackNeutralStep(state, neutralArmy.id, neutralArmy.position, origin);
      }

      if (nextPosition) {
        if (samePosition(nextPosition, origin)) {
          behavior.state = behavior.mode === "patrol" && behavior.patrolPath.length > 0 ? "patrol" : "return";
          behaviorChanged = true;
        }
        const movement = moveNeutralArmy(neutralArmy, nextPosition, "return", behavior);
        return {
          army: movement.army,
          events: [movement.event]
        };
      }
    } else if (behavior.mode === "patrol" && behavior.patrolPath.length > 0) {
      behavior.state = "patrol";
      behaviorChanged = true;
    }
  }

  if (behavior.state === "patrol" && behavior.patrolPath.length > 0) {
    const patrolResult = advancePatrol(state, neutralArmy, behavior, speed);
    if (patrolResult.moved && !samePosition(patrolResult.position, neutralArmy.position)) {
      const movement = moveNeutralArmy(neutralArmy, patrolResult.position, "patrol", behavior);
      return {
        army: movement.army,
        events: [movement.event]
      };
    }
  }

  if (behaviorChanged) {
    return {
      army: {
        ...neutralArmy,
        behavior: cloneNeutralBehaviorState(behavior)
      },
      events: []
    };
  }

  return {
    events: []
  };
}

export function createWorldStateFromConfigs(
  config: WorldGenerationConfig,
  mapObjects: MapObjectsConfig,
  seed = 1001,
  roomId = "room-alpha"
): WorldState {
  validateWorldConfig(config);
  validateMapObjectsConfig(mapObjects, config);

  const rng = makeRng(seed);
  const width = config.width;
  const height = config.height;
  const heroes: HeroState[] = normalizeHeroes(config.heroes);
  const patrolWaypointKeys = mapObjects.neutralArmies.flatMap((army) =>
    resolvePatrolPath(width, height, army.position, army.behavior).map((waypoint) => tileKey(waypoint))
  );
  const forcedWalkableKeys = new Set<string>([
    ...heroes.map((hero) => tileKey(hero.position)),
    ...mapObjects.guaranteedResources.map((resource) => tileKey(resource.position)),
    ...mapObjects.neutralArmies.map((army) => tileKey(army.position)),
    ...patrolWaypointKeys,
    ...mapObjects.buildings.map((building) => tileKey(building.position))
  ]);
  const blockedRandomResourceKeys = new Set<string>([
    ...mapObjects.neutralArmies.map((army) => tileKey(army.position)),
    ...patrolWaypointKeys,
    ...mapObjects.buildings.map((building) => tileKey(building.position))
  ]);
  const terrainOverrides = new Map(
    (config.terrainOverrides ?? []).map((override) => [tileKey(override.position), override.terrain] as const)
  );

  const tiles: TileState[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = { x, y };
      const key = tileKey(position);
      const terrain = terrainOverrides.get(key);
      const tile = forcedWalkableKeys.has(key)
        ? ensureTileIsWalkable(createTerrainTile(position, rng(), terrain))
        : createTerrainTile(position, rng(), terrain);
      const guaranteedResource = mapObjects.guaranteedResources.find((item) => samePosition(item.position, { x, y }));
      if (guaranteedResource) {
        tile.resource = guaranteedResource.resource;
      } else if (
        tile.walkable &&
        !heroes.some((hero) => hero.position.x === x && hero.position.y === y) &&
        !blockedRandomResourceKeys.has(key)
      ) {
        tile.resource = createResourceNode(rng(), config.resourceSpawn);
      }
      tiles.push(tile);
    }
  }

  const neutralArmies: Record<string, NeutralArmyState> = Object.fromEntries(
    mapObjects.neutralArmies.map((army) => [army.id, createNeutralArmyState(army, width, height)])
  );
  const buildings: Record<string, MapBuildingState> = Object.fromEntries(
    mapObjects.buildings.map((building) => [building.id, createBuildingState(building, heroes)])
  );

  const initialMap = syncWorldTiles({ width, height, tiles }, heroes, neutralArmies, buildings);
  const initialState: WorldState = {
    meta: {
      roomId,
      seed,
      day: 1
    },
    map: initialMap,
    heroes,
    neutralArmies,
    buildings,
    resources: createWorldResourceLedger(heroes),
    visibilityByPlayer: {}
  };

  return {
    ...initialState,
    visibilityByPlayer: updateVisibilityByPlayer(initialState.map, initialState.heroes, initialState)
  };
}

export function createInitialWorldState(seed = 1001, roomId = "room-alpha"): WorldState {
  const bundle = getRuntimeConfigBundleForRoom(roomId, seed);
  const state = createWorldStateFromConfigs(bundle.world, bundle.mapObjects, seed, roomId);
  return {
    ...state,
    meta: {
      ...state.meta,
      mapVariantId: bundle.mapVariantId
    }
  };
}

