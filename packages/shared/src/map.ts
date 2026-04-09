import type {
  BattleOutcome,
  FogState,
  HeroState,
  HeroConfig,
  HeroStatBonus,
  MapBuildingState,
  MapObjectsConfig,
  MovementPlan,
  NeutralArmyBehaviorState,
  NeutralMoveReason,
  NeutralArmyState,
  OccupantState,
  PlayerBuildingView,
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
  WorldGenerationConfig,
  WorldMapState,
  WorldResourceLedger,
  WorldState
} from "./models.ts";
import {
  createActionValidationFailure,
  validateAction,
  type ActionPrecheckResult
} from "./action-precheck.ts";
import { createDeterministicRandomGenerator } from "./deterministic-rng.ts";
import { applyHeroSkillSelection, validateHeroSkillSelection } from "./hero-skills.ts";
import {
  applyHeroEquipmentChange,
  rollEquipmentDrop,
  tryAddEquipmentToInventory,
  validateHeroEquipmentChange
} from "./equipment.ts";
import {
  normalizeHeroState,
  totalExperienceRequiredForLevel
} from "./models.ts";
import { getRuntimeConfigBundleForRoom } from "./world-config.ts";
import {
  getBuildingUpgradeConfig,
  getDefaultUnitCatalog,
  validateMapObjectsConfig,
  validateWorldConfig
} from "./world-config.ts";

export type WorldActionPrecheckResult = ActionPrecheckResult<WorldState>;

export interface EncodedWorldMapOverlay {
  index: number;
  resource?: TileState["resource"];
  occupant?: OccupantState;
  building?: MapBuildingState;
}

const MAP_ENCODING_MAGIC = "PVM1";
const MAP_ENCODING_VERSION = 1;
const MAP_ENCODING_HEADER_BYTES = 13;
const TERRAIN_CODES: Record<TileState["terrain"], number> = {
  grass: 0,
  dirt: 1,
  sand: 2,
  water: 3,
  swamp: 4
};
const TERRAIN_VALUES: TileState["terrain"][] = ["grass", "dirt", "sand", "water", "swamp"];
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function makeRng(seed: number): () => number {
  return createDeterministicRandomGenerator(seed);
}

function hashSeed(base: number, value: string): number {
  let hash = base >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  }
  return hash >>> 0;
}

function samePosition(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function orderTiles(map: WorldMapState): TileState[] {
  const expectedTileCount = map.width * map.height;
  if (map.tiles.length !== expectedTileCount) {
    throw new Error("invalid_world_map_tile_count");
  }

  const orderedTiles = new Array<TileState>(expectedTileCount);
  for (const tile of map.tiles) {
    if (!inBounds(map, tile.position)) {
      throw new Error("invalid_world_map_tile_position");
    }

    const index = tileIndex(map, tile.position);
    if (orderedTiles[index]) {
      throw new Error("duplicate_world_map_tile_position");
    }

    orderedTiles[index] = tile;
  }

  if (orderedTiles.some((tile) => !tile)) {
    throw new Error("incomplete_world_map_tiles");
  }

  return orderedTiles;
}

function parseEncodedWorldMapOverlays(bytes: Uint8Array): EncodedWorldMapOverlay[] {
  if (bytes.length === 0) {
    return [];
  }

  const decoded = JSON.parse(textDecoder.decode(bytes));
  if (!Array.isArray(decoded)) {
    throw new Error("invalid_world_map_overlay_payload");
  }

  return decoded as EncodedWorldMapOverlay[];
}

export function encodeMapToBuffer(map: WorldMapState): Uint8Array {
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width <= 0 || map.height <= 0) {
    throw new Error("invalid_world_map_dimensions");
  }

  if (map.width > 0xffff || map.height > 0xffff) {
    throw new Error("world_map_dimensions_exceed_uint16");
  }

  const orderedTiles = orderTiles(map);
  const tileCount = orderedTiles.length;
  const terrain = new Uint8Array(tileCount);
  const walkable = new Uint8Array(tileCount);
  const overlays: EncodedWorldMapOverlay[] = [];

  for (let index = 0; index < tileCount; index += 1) {
    const tile = orderedTiles[index]!;
    terrain[index] = TERRAIN_CODES[tile.terrain];
    walkable[index] = tile.walkable ? 1 : 0;

    if (tile.resource || tile.occupant || tile.building) {
      overlays.push({
        index,
        ...(tile.resource ? { resource: tile.resource } : {}),
        ...(tile.occupant ? { occupant: tile.occupant } : {}),
        ...(tile.building ? { building: tile.building } : {})
      });
    }
  }

  const overlayBytes = textEncoder.encode(JSON.stringify(overlays));
  const buffer = new Uint8Array(MAP_ENCODING_HEADER_BYTES + terrain.length + walkable.length + overlayBytes.length);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  for (let index = 0; index < MAP_ENCODING_MAGIC.length; index += 1) {
    buffer[index] = MAP_ENCODING_MAGIC.charCodeAt(index);
  }

  view.setUint8(4, MAP_ENCODING_VERSION);
  view.setUint16(5, map.width, true);
  view.setUint16(7, map.height, true);
  view.setUint32(9, overlayBytes.length, true);
  buffer.set(terrain, MAP_ENCODING_HEADER_BYTES);
  buffer.set(walkable, MAP_ENCODING_HEADER_BYTES + terrain.length);
  buffer.set(overlayBytes, MAP_ENCODING_HEADER_BYTES + terrain.length + walkable.length);

  return buffer;
}

export function decodeBufferToMap(buffer: Uint8Array): WorldMapState {
  if (buffer.byteLength < MAP_ENCODING_HEADER_BYTES) {
    throw new Error("invalid_world_map_buffer");
  }

  for (let index = 0; index < MAP_ENCODING_MAGIC.length; index += 1) {
    if (buffer[index] !== MAP_ENCODING_MAGIC.charCodeAt(index)) {
      throw new Error("invalid_world_map_magic");
    }
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint8(4) !== MAP_ENCODING_VERSION) {
    throw new Error("unsupported_world_map_encoding_version");
  }

  const width = view.getUint16(5, true);
  const height = view.getUint16(7, true);
  const overlayLength = view.getUint32(9, true);
  const tileCount = width * height;
  const expectedLength = MAP_ENCODING_HEADER_BYTES + tileCount * 2 + overlayLength;

  if (buffer.byteLength !== expectedLength) {
    throw new Error("invalid_world_map_buffer_length");
  }

  const terrainStart = MAP_ENCODING_HEADER_BYTES;
  const walkableStart = terrainStart + tileCount;
  const overlayStart = walkableStart + tileCount;
  const terrain = buffer.subarray(terrainStart, walkableStart);
  const walkable = buffer.subarray(walkableStart, overlayStart);
  const overlays = parseEncodedWorldMapOverlays(buffer.subarray(overlayStart, overlayStart + overlayLength));
  const tiles: TileState[] = Array.from({ length: tileCount }, (_, index): TileState => {
    const terrainValue = TERRAIN_VALUES[terrain[index]!];
    if (!terrainValue) {
      throw new Error("invalid_world_map_terrain_code");
    }

    return {
      position: {
        x: index % width,
        y: Math.floor(index / width)
      },
      terrain: terrainValue,
      walkable: walkable[index] === 1,
      resource: undefined,
      occupant: undefined,
      building: undefined
    };
  });

  for (const overlay of overlays) {
    if (!Number.isInteger(overlay.index) || overlay.index < 0 || overlay.index >= tileCount) {
      throw new Error("invalid_world_map_overlay_index");
    }

    tiles[overlay.index] = {
      ...tiles[overlay.index]!,
      resource: overlay.resource,
      occupant: overlay.occupant,
      building: overlay.building
    };
  }

  return {
    width,
    height,
    tiles
  };
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

function templateHasBattleSkill(templateId: string, skillId: string): boolean {
  const template = getDefaultUnitCatalog().templates.find((item) => item.id === templateId);
  return template?.battleSkills?.includes(skillId) ?? false;
}

function heroCanFlyOverWater(hero: Pick<HeroState, "armyTemplateId">): boolean {
  return templateHasBattleSkill(hero.armyTemplateId, "skybound");
}

function neutralArmyCanFlyOverWater(neutralArmy: NeutralArmyState): boolean {
  return neutralArmy.stacks.some((stack) => templateHasBattleSkill(stack.templateId, "skybound"));
}

function isTraversableTile(
  tile: Pick<TileState, "walkable" | "terrain"> | Pick<PlayerTileView, "walkable" | "terrain">,
  canFlyOverWater: boolean
): boolean {
  return tile.walkable || (canFlyOverWater && tile.terrain === "water");
}

function terrainMoveCost(terrain: TileState["terrain"] | PlayerTileView["terrain"]): number {
  return terrain === "swamp" ? 2 : 1;
}

function maybeAwardBattleEquipmentDrop(
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

function createTerrainTile(position: Vec2, roll: number, forcedTerrain?: TileState["terrain"]): TileState {
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

function ensureTileIsWalkable(tile: TileState): TileState {
  if (tile.walkable) {
    return tile;
  }

  return {
    ...tile,
    terrain: "grass",
    walkable: true
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

function cloneResourceLedger(ledger: ResourceLedger): ResourceLedger {
  return {
    gold: ledger.gold,
    wood: ledger.wood,
    ore: ledger.ore
  };
}

function cloneHeroStatBonus(bonus: HeroStatBonus): HeroStatBonus {
  return {
    attack: bonus.attack,
    defense: bonus.defense,
    power: bonus.power,
    knowledge: bonus.knowledge
  };
}

function clonePosition(position: Vec2): Vec2 {
  return {
    x: position.x,
    y: position.y
  };
}

function cloneNeutralBehaviorState(behavior: NeutralArmyBehaviorState | undefined): NeutralArmyBehaviorState {
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

function resetNeutralBehaviorState(behavior: NeutralArmyBehaviorState | undefined): NeutralArmyBehaviorState | undefined {
  if (!behavior) {
    return undefined;
  }

  const clone = cloneNeutralBehaviorState(behavior);
  clone.state = clone.mode === "patrol" && clone.patrolPath.length > 0 ? "patrol" : "return";
  delete clone.targetHeroId;
  return clone;
}

function buildPatrolLoop(origin: Vec2, radius: number, mapWidth: number, mapHeight: number): Vec2[] {
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

function resolvePatrolPath(
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

function normalizeNeutralArmyState(army: NeutralArmyState): NeutralArmyState {
  return {
    ...army,
    position: clonePosition(army.position),
    reward: army.reward ? { ...army.reward } : undefined,
    stacks: army.stacks.map((stack) => ({ ...stack })),
    origin: clonePosition(army.origin ?? army.position),
    behavior: cloneNeutralBehaviorState(army.behavior)
  };
}

function normalizeNeutralArmyCollection(
  neutralArmies: Record<string, NeutralArmyState>
): Record<string, NeutralArmyState> {
  return Object.fromEntries(
    Object.entries(neutralArmies).map(([neutralArmyId, army]) => [neutralArmyId, normalizeNeutralArmyState(army)])
  );
}

function createNeutralArmyState(
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

function createBuildingState(config: MapObjectsConfig["buildings"][number], heroes: HeroState[]): MapBuildingState {
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

function hasEnoughResources(resources: ResourceLedger, cost: ResourceLedger): boolean {
  return (resources.gold ?? 0) >= cost.gold && (resources.wood ?? 0) >= cost.wood && (resources.ore ?? 0) >= cost.ore;
}

function spendResources(resources: WorldResourceLedger, playerId: string, cost: ResourceLedger): WorldResourceLedger {
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

function getBuildingUpgradeTrackId(building: Pick<MapBuildingState, "kind">): "castle" | "mine" | null {
  if (building.kind === "recruitment_post") {
    return "castle";
  }
  if (building.kind === "resource_mine") {
    return "mine";
  }
  return null;
}

function getBuildingUpgradeStep(building: Pick<MapBuildingState, "kind" | "tier">) {
  const trackId = getBuildingUpgradeTrackId(building);
  if (!trackId) {
    return null;
  }

  return getBuildingUpgradeConfig()[trackId].find((step) => step.fromTier === building.tier) ?? null;
}

function getRequiredBuildingTierForUnit(unitTemplateId: string): number {
  const unitTemplate = getDefaultUnitCatalog().templates.find((item) => item.id === unitTemplateId);
  if (!unitTemplate) {
    return 1;
  }

  return unitTemplate.rarity === "legendary" ? 3 : unitTemplate.rarity === "elite" ? 2 : 1;
}

function canHeroUpgradeBuilding(hero: Pick<HeroState, "position">, building: Pick<MapBuildingState, "position">): boolean {
  return distance(hero.position, building.position) <= 1;
}

function inferInitialBuildingOwnerPlayerId(
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

function clonePlayerBuildingView(building: MapBuildingState): PlayerBuildingView {
  if (building.kind === "recruitment_post") {
    return {
      id: building.id,
      kind: building.kind,
      label: building.label,
      unitTemplateId: building.unitTemplateId,
      recruitCount: building.recruitCount,
      tier: building.tier,
      ...(building.maxTier !== undefined ? { maxTier: building.maxTier } : {}),
      availableCount: building.availableCount,
      cost: cloneResourceLedger(building.cost),
      ...(typeof building.lastUsedDay === "number" ? { lastUsedDay: building.lastUsedDay } : {}),
      ...(building.ownerPlayerId ? { ownerPlayerId: building.ownerPlayerId } : {})
    };
  }

  if (building.kind === "attribute_shrine") {
    return {
      id: building.id,
      kind: building.kind,
      label: building.label,
      bonus: cloneHeroStatBonus(building.bonus),
      tier: building.tier,
      ...(building.maxTier !== undefined ? { maxTier: building.maxTier } : {}),
      ...(typeof building.lastUsedDay === "number" ? { lastUsedDay: building.lastUsedDay } : {}),
      ...(building.ownerPlayerId ? { ownerPlayerId: building.ownerPlayerId } : {})
    };
  }

  if (building.kind === "watchtower") {
    return {
      id: building.id,
      kind: building.kind,
      label: building.label,
      visionBonus: building.visionBonus,
      tier: building.tier,
      ...(building.maxTier !== undefined ? { maxTier: building.maxTier } : {}),
      ...(typeof building.lastUsedDay === "number" ? { lastUsedDay: building.lastUsedDay } : {}),
      ...(building.ownerPlayerId ? { ownerPlayerId: building.ownerPlayerId } : {})
    };
  }

  return {
    id: building.id,
    kind: building.kind,
    label: building.label,
    resourceKind: building.resourceKind,
    income: building.income,
    tier: building.tier,
    ...(building.maxTier !== undefined ? { maxTier: building.maxTier } : {}),
    ...(typeof building.lastHarvestDay === "number" ? { lastHarvestDay: building.lastHarvestDay } : {}),
    ...(building.ownerPlayerId ? { ownerPlayerId: building.ownerPlayerId } : {})
  };
}

function cloneBuildingState(building: MapBuildingState): MapBuildingState {
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

function refreshBuildingForNewDay(building: MapBuildingState): MapBuildingState {
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

function isBuildingOnCurrentDayCooldown(day: number, lastUsedDay: number | undefined): boolean {
  return typeof lastUsedDay === "number" && lastUsedDay >= day;
}

function applyHeroStatBonus(hero: HeroState, bonus: HeroStatBonus): HeroState {
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

function applyHeroVisionBonus(hero: HeroState, visionBonus: number): HeroState {
  return {
    ...hero,
    vision: hero.vision + visionBonus
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

function isBlockedForPlayerView(
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

function syncWorldTiles(
  map: WorldMapState,
  heroes: HeroState[],
  neutralArmies: Record<string, NeutralArmyState>,
  buildings: Record<string, MapBuildingState>
): WorldMapState {
  const heroByKey = new Map<string, OccupantState>(
    heroes.map((hero) => [tileKey(hero.position), { kind: "hero", refId: hero.id }])
  );
  const neutralByKey = new Map<string, OccupantState>(
    Object.values(neutralArmies).map((army) => [tileKey(army.position), { kind: "neutral", refId: army.id }])
  );
  const buildingByKey = new Map<string, MapBuildingState>(
    Object.values(buildings).map((building) => [tileKey(building.position), building])
  );

  return {
    ...map,
    tiles: map.tiles.map((tile) => {
      const heroOccupant = heroByKey.get(tileKey(tile.position));
      if (heroOccupant) {
        return {
          ...tile,
          occupant: heroOccupant,
          building: buildingByKey.get(tileKey(tile.position))
        };
      }

      const neutralOccupant = neutralByKey.get(tileKey(tile.position));
      if (neutralOccupant) {
        return {
          ...tile,
          occupant: neutralOccupant,
          building: buildingByKey.get(tileKey(tile.position))
        };
      }

      return {
        ...tile,
        occupant: undefined,
        building: buildingByKey.get(tileKey(tile.position))
      };
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

function popLowestScoreNode(openSet: Vec2[], fScore: Map<string, number>): Vec2 | undefined {
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

function getNeighbors(map: WorldMapState, position: Vec2): Vec2[] {
  const candidates = [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 }
  ];

  return candidates.filter((item) => inBounds(map, item));
}

function isBlockedForHero(
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

function isBlockedForNeutral(
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

function fallbackNeutralStep(
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

function getNeutralMovementPath(
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

function getMovementDistance(plan: Pick<MovementPlan, "path">): number {
  return Math.max(0, plan.path.length - 1);
}

function buildNextWorldState(
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

function findHero(state: WorldState, heroId: string): HeroState | undefined {
  return state.heroes.find((hero) => hero.id === heroId);
}

function findNeutralChaseTarget(
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

function moveNeutralArmy(
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

function advancePatrol(
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

function resolveNeutralArmyTurn(
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

  if (action.type === "hero.learnSkill") {
    const validation = validateHeroSkillSelection(hero, action.skillId);
    if (!validation.valid) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        ...(validation.reason ? { reason: validation.reason } : {})
      };
    }

    const learned = applyHeroSkillSelection(hero, action.skillId);
    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: view.ownHeroes.map((item) => (item.id === hero.id ? learned.hero : item))
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type === "hero.equip" || action.type === "hero.unequip") {
    const validation = validateHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    if (!validation.valid) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        ...(validation.reason ? { reason: validation.reason } : {})
      };
    }

    const changed = applyHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: view.ownHeroes.map((item) => (item.id === hero.id ? changed.hero : item))
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
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

    if (!isTraversableTile(destinationTile, heroCanFlyOverWater(hero)) || destinationTile.fog === "hidden") {
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

  if (action.type === "hero.recruit") {
    const tile = findPlayerTile(view, hero.position);
    if (!tile?.building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (tile.building.id !== action.buildingId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_on_building"
      };
    }

    if (tile.building.kind !== "recruitment_post") {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_recruitable"
      };
    }
    const building = tile.building;

    if (building.availableCount <= 0) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_depleted"
      };
    }

    if (building.tier < getRequiredBuildingTierForUnit(building.unitTemplateId)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_tier_too_low"
      };
    }

    if (!hasEnoughResources(view.resources, building.cost)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "not_enough_resources"
      };
    }

    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: view.ownHeroes.map((item) =>
        item.id === hero.id
          ? {
              ...item,
              armyCount: item.armyCount + building.availableCount
            }
          : item
      ),
      map: {
        ...view.map,
        tiles: view.map.tiles.map((item) =>
          samePosition(item.position, hero.position) && item.building?.kind === "recruitment_post"
            ? {
                ...item,
                building: {
                  ...item.building,
                  cost: cloneResourceLedger(item.building.cost),
                  availableCount: 0,
                  lastUsedDay: view.meta.day
                }
              }
            : item
        )
      },
      resources: {
        gold: Math.max(0, view.resources.gold - building.cost.gold),
        wood: Math.max(0, view.resources.wood - building.cost.wood),
        ore: Math.max(0, view.resources.ore - building.cost.ore)
      }
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type === "hero.visit") {
    const tile = findPlayerTile(view, hero.position);
    if (!tile?.building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (tile.building.id !== action.buildingId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_on_building"
      };
    }

    if (tile.building.kind !== "attribute_shrine" && tile.building.kind !== "watchtower") {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_visitable"
      };
    }
    const building = tile.building;

    if (isBuildingOnCurrentDayCooldown(view.meta.day, building.lastUsedDay)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_on_cooldown"
      };
    }

    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: view.ownHeroes.map((item) => {
        if (item.id !== hero.id) {
          return item;
        }

        return building.kind === "attribute_shrine"
          ? applyHeroStatBonus(item, building.bonus)
          : applyHeroVisionBonus(item, building.visionBonus);
      }),
      map: {
        ...view.map,
        tiles: view.map.tiles.map((item) =>
          samePosition(item.position, hero.position) &&
          (item.building?.kind === "attribute_shrine" || item.building?.kind === "watchtower")
            ? {
                ...item,
                building: {
                  ...item.building,
                  lastUsedDay: view.meta.day
                }
              }
            : item
        )
      }
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type === "hero.claimMine") {
    const tile = findPlayerTile(view, hero.position);
    if (!tile?.building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (tile.building.id !== action.buildingId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_on_building"
      };
    }

    if (tile.building.kind !== "resource_mine") {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_claimable"
      };
    }
    const building = tile.building;

    if (isBuildingOnCurrentDayCooldown(view.meta.day, building.lastHarvestDay)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_on_cooldown"
      };
    }

    const predictedWorld: PlayerWorldView = {
      ...view,
      resources: {
        ...view.resources,
        [building.resourceKind]: view.resources[building.resourceKind] + building.income
      },
      map: {
        ...view.map,
        tiles: view.map.tiles.map((item) =>
          samePosition(item.position, hero.position) && item.building?.kind === "resource_mine"
            ? {
                ...item,
                building: {
                  ...item.building,
                  lastHarvestDay: view.meta.day,
                  ownerPlayerId: view.playerId
                }
              }
            : item
        )
      }
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type === "hero.upgradeBuilding") {
    const tile = view.map.tiles.find((item) => item.building?.id === action.buildingId);
    const building = tile?.building;
    if (!tile || !building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (distance(hero.position, tile.position) > 1) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_adjacent_to_building"
      };
    }

    const trackId = getBuildingUpgradeTrackId(building);
    if (!trackId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_upgradeable"
      };
    }

    if (!building.ownerPlayerId || building.ownerPlayerId !== view.playerId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_owned_by_player"
      };
    }

    const maxTier = building.maxTier ?? (trackId === "castle" ? 3 : 2);
    if (building.tier >= maxTier) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_max_tier_reached"
      };
    }

    const upgradeStep = getBuildingUpgradeStep(building);
    if (!upgradeStep) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_upgrade_unavailable"
      };
    }

    if (!hasEnoughResources(view.resources, upgradeStep.cost)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "not_enough_resources"
      };
    }

    const predictedWorld: PlayerWorldView = {
      ...view,
      resources: {
        gold: Math.max(0, view.resources.gold - upgradeStep.cost.gold),
        wood: Math.max(0, view.resources.wood - upgradeStep.cost.wood),
        ore: Math.max(0, view.resources.ore - upgradeStep.cost.ore)
      },
      map: {
        ...view.map,
        tiles: view.map.tiles.map((item) =>
          item.building?.id === action.buildingId
            ? {
                ...item,
                building: item.building.kind === "resource_mine" && upgradeStep.effect === "income_bonus_1"
                  ? {
                      ...item.building,
                      tier: upgradeStep.toTier,
                      income: item.building.income + 1,
                      ownerPlayerId: view.playerId
                    }
                  : {
                      ...item.building,
                      tier: upgradeStep.toTier,
                      ownerPlayerId: view.playerId
                    }
              }
            : item
        )
      }
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type !== "hero.collect") {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(view, hero.id),
      reason: "prediction_not_supported"
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

export function validateWorldAction(
  state: WorldState,
  action: WorldAction,
  requestingPlayerId?: string
): ValidationResult {
  if (action.type === "turn.endDay") {
    return { valid: true };
  }

  const hero = state.heroes.find((item) => item.id === action.heroId);
  if (!hero) {
    return { valid: false, reason: "hero_not_found" };
  }

  if (requestingPlayerId && hero.playerId !== requestingPlayerId) {
    return { valid: false, reason: "hero_not_owned_by_player" };
  }

  if (action.type === "world.surrender") {
    return { valid: true };
  }

  if (action.type === "hero.move") {
    if (requestingPlayerId) {
      const view = createPlayerWorldView(state, requestingPlayerId);
      const destinationTile = findPlayerTile(view, action.destination);
      if (!destinationTile) {
        return { valid: false, reason: "destination_not_found" };
      }

      if (!isTraversableTile(destinationTile, heroCanFlyOverWater(hero)) || destinationTile.fog === "hidden") {
        return { valid: false, reason: "destination_blocked" };
      }

      const occupiedByOtherHero = view.ownHeroes.find(
        (item) => item.id !== hero.id && samePosition(item.position, action.destination)
      );
      if (occupiedByOtherHero && occupiedByOtherHero.playerId === hero.playerId) {
        return { valid: false, reason: "destination_occupied" };
      }

      const plan = planPlayerViewMovement(view, hero.id, action.destination);
      if (!plan) {
        return { valid: false, reason: "path_not_found" };
      }

      if (plan.moveCost > hero.move.remaining) {
        return { valid: false, reason: "not_enough_move_points" };
      }

      return { valid: true };
    }

    const tile = findTile(state.map, action.destination);
    if (!tile) {
      return { valid: false, reason: "destination_not_found" };
    }

    if (!isTraversableTile(tile, heroCanFlyOverWater(hero))) {
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

  if (action.type === "hero.learnSkill") {
    return validateHeroSkillSelection(hero, action.skillId);
  }

  if (action.type === "hero.equip" || action.type === "hero.unequip") {
    return validateHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
  }

  if (action.type === "hero.recruit") {
    const building = state.buildings[action.buildingId];
    if (!building) {
      return { valid: false, reason: "building_not_found" };
    }

    if (!samePosition(hero.position, building.position)) {
      return { valid: false, reason: "hero_not_on_building" };
    }

    if (building.kind !== "recruitment_post") {
      return { valid: false, reason: "building_not_recruitable" };
    }

    if (building.availableCount <= 0) {
      return { valid: false, reason: "building_depleted" };
    }

    if (building.tier < getRequiredBuildingTierForUnit(building.unitTemplateId)) {
      return { valid: false, reason: "building_tier_too_low" };
    }

    const resources = getPlayerResources(state.resources, hero.playerId);
    if (!hasEnoughResources(resources, building.cost)) {
      return { valid: false, reason: "not_enough_resources" };
    }

    return { valid: true };
  }

  if (action.type === "hero.visit") {
    const building = state.buildings[action.buildingId];
    if (!building) {
      return { valid: false, reason: "building_not_found" };
    }

    if (!samePosition(hero.position, building.position)) {
      return { valid: false, reason: "hero_not_on_building" };
    }

    if (building.kind !== "attribute_shrine" && building.kind !== "watchtower") {
      return { valid: false, reason: "building_not_visitable" };
    }

    if (isBuildingOnCurrentDayCooldown(state.meta.day, building.lastUsedDay)) {
      return { valid: false, reason: "building_on_cooldown" };
    }

    return { valid: true };
  }

  if (action.type === "hero.claimMine") {
    const building = state.buildings[action.buildingId];
    if (!building) {
      return { valid: false, reason: "building_not_found" };
    }

    if (!samePosition(hero.position, building.position)) {
      return { valid: false, reason: "hero_not_on_building" };
    }

    if (building.kind !== "resource_mine") {
      return { valid: false, reason: "building_not_claimable" };
    }

    if (isBuildingOnCurrentDayCooldown(state.meta.day, building.lastHarvestDay)) {
      return { valid: false, reason: "building_on_cooldown" };
    }

    return { valid: true };
  }

  if (action.type === "hero.upgradeBuilding") {
    const building = state.buildings[action.buildingId];
    if (!building) {
      return { valid: false, reason: "building_not_found" };
    }

    if (!canHeroUpgradeBuilding(hero, building)) {
      return { valid: false, reason: "hero_not_adjacent_to_building" };
    }

    const trackId = getBuildingUpgradeTrackId(building);
    if (!trackId) {
      return { valid: false, reason: "building_not_upgradeable" };
    }

    if (!building.ownerPlayerId || building.ownerPlayerId !== hero.playerId) {
      return { valid: false, reason: "building_not_owned_by_player" };
    }

    const maxTier = building.maxTier ?? (trackId === "castle" ? 3 : 2);
    if (building.tier >= maxTier) {
      return { valid: false, reason: "building_max_tier_reached" };
    }

    const upgradeStep = getBuildingUpgradeStep(building);
    if (!upgradeStep) {
      return { valid: false, reason: "building_upgrade_unavailable" };
    }

    const resources = getPlayerResources(state.resources, hero.playerId);
    if (!hasEnoughResources(resources, upgradeStep.cost)) {
      return { valid: false, reason: "not_enough_resources" };
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

export function precheckWorldAction(
  state: WorldState,
  action: WorldAction,
  requestingPlayerId?: string
): WorldActionPrecheckResult {
  const result = validateAction(state, action, (inputState, nextAction) =>
    validateWorldAction(inputState, nextAction, requestingPlayerId)
  );
  const rejection = createActionValidationFailure("world", action, result.validation);
  return {
    ...result,
    ...(rejection ? { rejection } : {})
  };
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
        occupant: undefined,
        building: undefined
      };
    }

    if (fog === "explored") {
      return {
        position: tile.position,
        fog,
        terrain: tile.terrain,
        walkable: tile.walkable,
        resource: undefined,
        occupant: undefined,
        building: tile.building ? clonePlayerBuildingView(tile.building) : undefined
      };
    }

    return {
      position: tile.position,
      fog,
      terrain: tile.terrain,
      walkable: tile.walkable,
      resource: tile.resource,
      occupant: tile.occupant,
      building: tile.building ? clonePlayerBuildingView(tile.building) : undefined
    };
  });

  return {
    meta: state.meta,
    ...(state.turnDeadlineAt ? { turnDeadlineAt: state.turnDeadlineAt } : {}),
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
        level: hero.progression.level,
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
    const buildings = Object.fromEntries(
      Object.entries(state.buildings).map(([buildingId, building]) => [
        buildingId,
        refreshBuildingForNewDay(building)
      ])
    );
    let neutralArmies = normalizeNeutralArmyCollection(state.neutralArmies);
    neutralArmies = Object.fromEntries(
      Object.entries(neutralArmies).map(([neutralArmyId, army]) => {
        const nextBehavior = resetNeutralBehaviorState(army.behavior);
        return [
          neutralArmyId,
          {
            ...army,
            ...(nextBehavior ? { behavior: nextBehavior } : {})
          }
        ];
      })
    );
    let workingState = buildNextWorldState(
      {
        ...state,
        meta: {
          ...state.meta,
          day: state.meta.day + 1
        },
        resources: state.resources
      },
      heroes,
      neutralArmies,
      buildings
    );
    const lockedHeroIds = new Set<string>();
    const neutralEvents: WorldEvent[] = [];
    for (const neutralArmyId of Object.keys(neutralArmies).sort()) {
      const neutralArmy = neutralArmies[neutralArmyId];
      if (!neutralArmy) {
        continue;
      }

      const resolution = resolveNeutralArmyTurn(workingState, neutralArmy, lockedHeroIds);
      if (resolution.lockedHeroId) {
        lockedHeroIds.add(resolution.lockedHeroId);
      }
      if (resolution.army) {
        neutralArmies = {
          ...neutralArmies,
          [neutralArmyId]: resolution.army
        };
        workingState = buildNextWorldState(workingState, heroes, neutralArmies, buildings);
      }
      neutralEvents.push(...resolution.events);
    }
    const nextState = buildNextWorldState(
      {
        ...state,
        meta: {
          ...state.meta,
          day: state.meta.day + 1
        },
        ...(state.turnDeadlineAt ? { turnDeadlineAt: state.turnDeadlineAt } : {}),
        ...(state.afkStrikes ? { afkStrikes: state.afkStrikes } : {}),
        resources: state.resources
      },
      heroes,
      neutralArmies,
      buildings
    );
    return {
      state: nextState,
      events: [{ type: "turn.advanced", day: nextState.meta.day }, ...neutralEvents]
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
    const nextState = buildNextWorldState(state, heroes, state.neutralArmies, state.buildings);

    if (plan.endsInEncounter) {
      const encounterRefId = plan.encounterRefId;
      const encounterHero =
        plan.encounterKind === "hero" && encounterRefId
          ? state.heroes.find((item) => item.id === encounterRefId)
          : undefined;
      return {
        state: nextState,
        movementPlan: plan,
        events: encounterRefId
          ? [
              {
                type: "battle.started",
                heroId: action.heroId,
                attackerPlayerId: hero.playerId,
                encounterKind: plan.encounterKind === "hero" ? "hero" : "neutral",
                ...(plan.encounterKind === "hero"
                  ? {
                      defenderHeroId: encounterRefId,
                      ...(encounterHero?.playerId ? { defenderPlayerId: encounterHero.playerId } : {}),
                      battleId: `battle-${action.heroId}-vs-${encounterRefId}`
                    }
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

  if (action.type === "hero.learnSkill") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    if (!hero) {
      return { state, events: [] };
    }

    const validation = validateHeroSkillSelection(hero, action.skillId);
    if (!validation.valid) {
      return { state, events: [] };
    }

    const learned = applyHeroSkillSelection(hero, action.skillId);
    const nextState = buildNextWorldState(
      state,
      state.heroes.map((item) => (item.id === hero.id ? learned.hero : item)),
      state.neutralArmies,
      state.buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.skillLearned",
          heroId: hero.id,
          skillId: learned.skill.id,
          branchId: learned.branch.id,
          skillName: learned.skill.name,
          branchName: learned.branch.name,
          newRank: learned.newRank,
          spentPoint: 1,
          remainingSkillPoints: learned.hero.progression.skillPoints,
          newlyGrantedBattleSkillIds: learned.newlyGrantedBattleSkillIds
        }
      ]
    };
  }

  if (action.type === "hero.equip" || action.type === "hero.unequip") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    if (!hero) {
      return { state, events: [] };
    }

    const validation = validateHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    if (!validation.valid) {
      return { state, events: [] };
    }

    const changed = applyHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    const nextState = buildNextWorldState(
      state,
      state.heroes.map((item) => (item.id === hero.id ? changed.hero : item)),
      state.neutralArmies,
      state.buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.equipmentChanged",
          heroId: hero.id,
          slot: action.slot,
          ...(changed.equippedItemId ? { equippedItemId: changed.equippedItemId } : {}),
          ...(changed.unequippedItemId ? { unequippedItemId: changed.unequippedItemId } : {})
        }
      ]
    };
  }

  if (action.type === "hero.recruit") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    const building = state.buildings[action.buildingId];
    if (!hero || !building || building.kind !== "recruitment_post") {
      return { state, events: [] };
    }

    const recruitedCount = building.availableCount;
    const heroes = state.heroes.map((item) =>
      item.id === hero.id
        ? {
            ...item,
            armyCount: item.armyCount + recruitedCount
          }
        : item
    );
    const buildings = {
      ...state.buildings,
      [building.id]: {
        ...building,
        position: { ...building.position },
        cost: cloneResourceLedger(building.cost),
        availableCount: 0,
        lastUsedDay: state.meta.day
      }
    };
    const nextState = buildNextWorldState(
      {
        ...state,
        resources: spendResources(state.resources, hero.playerId, building.cost)
      },
      heroes,
      state.neutralArmies,
      buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.recruited",
          heroId: hero.id,
          buildingId: building.id,
          buildingKind: building.kind,
          unitTemplateId: building.unitTemplateId,
          count: recruitedCount,
          cost: cloneResourceLedger(building.cost)
        }
      ]
    };
  }

  if (action.type === "hero.visit") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    const building = state.buildings[action.buildingId];
    if (!hero || !building || (building.kind !== "attribute_shrine" && building.kind !== "watchtower")) {
      return { state, events: [] };
    }

    const heroes = state.heroes.map((item) =>
      item.id === hero.id
        ? building.kind === "attribute_shrine"
          ? applyHeroStatBonus(item, building.bonus)
          : applyHeroVisionBonus(item, building.visionBonus)
        : item
    );
    const buildings = {
      ...state.buildings,
      [building.id]: {
        ...building,
        position: { ...building.position },
        ...(building.kind === "attribute_shrine" ? { bonus: cloneHeroStatBonus(building.bonus) } : {}),
        lastUsedDay: state.meta.day
      }
    };
    const nextState = buildNextWorldState(state, heroes, state.neutralArmies, buildings);

    return {
      state: nextState,
      events: [
        building.kind === "attribute_shrine"
          ? {
              type: "hero.visited",
              heroId: hero.id,
              buildingId: building.id,
              buildingKind: building.kind,
              bonus: cloneHeroStatBonus(building.bonus)
            }
          : {
              type: "hero.visited",
              heroId: hero.id,
              buildingId: building.id,
              buildingKind: building.kind,
              visionBonus: building.visionBonus
            }
      ]
    };
  }

  if (action.type === "hero.claimMine") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    const building = state.buildings[action.buildingId];
    if (!hero || !building || building.kind !== "resource_mine") {
      return { state, events: [] };
    }

    const buildings = {
      ...state.buildings,
      [building.id]: {
        ...building,
        position: { ...building.position },
        resourceKind: building.resourceKind,
        income: building.income,
        lastHarvestDay: state.meta.day,
        ownerPlayerId: hero.playerId
      }
    };
    const harvestedResource = {
      kind: building.resourceKind,
      amount: building.income
    } as const;
    const nextState = buildNextWorldState(
      {
        ...state,
        resources: grantResource(state.resources, hero.playerId, harvestedResource)
      },
      state.heroes,
      state.neutralArmies,
      buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.claimedMine",
          heroId: hero.id,
          buildingId: building.id,
          buildingKind: building.kind,
          resourceKind: building.resourceKind,
          income: building.income,
          ownerPlayerId: hero.playerId
        }
      ]
    };
  }

  if (action.type === "hero.upgradeBuilding") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    const building = state.buildings[action.buildingId];
    const upgradeStep = building ? getBuildingUpgradeStep(building) : null;
    if (!hero || !building || !upgradeStep || (building.kind !== "recruitment_post" && building.kind !== "resource_mine")) {
      return { state, events: [] };
    }

    const nextBuilding =
      building.kind === "resource_mine" && upgradeStep.effect === "income_bonus_1"
        ? {
            ...building,
            position: { ...building.position },
            tier: upgradeStep.toTier,
            income: building.income + 1,
            ownerPlayerId: hero.playerId
          }
        : building.kind === "recruitment_post"
          ? {
              ...building,
              position: { ...building.position },
              cost: cloneResourceLedger(building.cost),
              tier: upgradeStep.toTier,
              ownerPlayerId: hero.playerId
            }
          : {
              ...building,
              position: { ...building.position },
              tier: upgradeStep.toTier,
              ownerPlayerId: hero.playerId
            };
    const buildings = {
      ...state.buildings,
      [building.id]: nextBuilding
    };
    const nextState = buildNextWorldState(
      {
        ...state,
        resources: spendResources(state.resources, hero.playerId, upgradeStep.cost)
      },
      state.heroes,
      state.neutralArmies,
      buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.upgradedBuilding",
          heroId: hero.id,
          buildingId: building.id,
          buildingKind: building.kind,
          fromTier: upgradeStep.fromTier,
          toTier: upgradeStep.toTier,
          cost: cloneResourceLedger(upgradeStep.cost),
          effect: upgradeStep.effect
        }
      ]
    };
  }

  if (action.type !== "hero.collect") {
    return { state, events: [] };
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
  const { state: nextState, validation } = precheckWorldAction(state, action);
  if (!validation.valid) {
    return nextState;
  }

  return resolveWorldAction(nextState, action).state;
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
      case "hero.recruited":
      case "hero.visited":
      case "hero.claimedMine":
      case "hero.upgradedBuilding":
      case "hero.progressed":
      case "hero.skillLearned":
      case "hero.equipmentChanged":
      case "hero.equipmentFound":
        return ownsHero(event.heroId);
      case "neutral.moved": {
        const visibility = state.visibilityByPlayer[playerId];
        if (ownsHero(event.targetHeroId)) {
          return true;
        }
        if (!visibility) {
          return false;
        }

        return (
          getFogAt(visibility, tileIndex(state.map, event.from)) === "visible" ||
          getFogAt(visibility, tileIndex(state.map, event.to)) === "visible"
        );
      }
      case "resource.produced":
        return event.playerId === playerId;
      case "battle.started":
      case "battle.resolved":
        if (event.attackerPlayerId === playerId || event.defenderPlayerId === playerId) {
          return true;
        }
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
      const droppedEquipment = maybeAwardBattleEquipmentDrop(awardedDefender.hero, state, battleId, "hero");
      const heroes = state.heroes.map((hero) =>
        hero.id === attackerId
          ? {
              ...hero,
              stats: { ...hero.stats, hp: Math.max(1, Math.floor(hero.stats.hp * 0.5)) },
              move: { ...hero.move, remaining: 0 }
            }
          : hero.id === defenderId
            ? droppedEquipment?.hero ?? awardedDefender.hero
          : hero
      );
      return {
        state: buildNextWorldState(state, heroes, state.neutralArmies, state.buildings),
        events: [
          {
            type: "battle.resolved",
            heroId,
            attackerPlayerId: attackerHero.playerId,
            battleId,
            ...(defenderId ? { defenderHeroId: defenderId, defenderPlayerId: defenderHero.playerId } : {}),
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
            levelsGained: awardedDefender.levelsGained,
            skillPointsAwarded: awardedDefender.skillPointsAwarded,
            availableSkillPoints: awardedDefender.hero.progression.skillPoints
          },
          ...(droppedEquipment ? [droppedEquipment.event] : [])
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
    const droppedEquipment = maybeAwardBattleEquipmentDrop(awardedAttacker.hero, state, battleId, "hero");
    const heroes = state.heroes.map((hero) => {
      if (hero.id === attackerId) {
        return {
          ...(droppedEquipment?.hero ?? awardedAttacker.hero),
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
      state: buildNextWorldState(state, heroes, state.neutralArmies, state.buildings),
      events: [
          {
            type: "battle.resolved",
            heroId,
            attackerPlayerId: attackerHero.playerId,
            battleId,
            ...(defenderId ? { defenderHeroId: defenderId, defenderPlayerId: defenderHero.playerId } : {}),
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
            levelsGained: awardedAttacker.levelsGained,
            skillPointsAwarded: awardedAttacker.skillPointsAwarded,
            availableSkillPoints: awardedAttacker.hero.progression.skillPoints
          },
          ...(droppedEquipment ? [droppedEquipment.event] : [])
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
      state: buildNextWorldState(state, heroes, state.neutralArmies, state.buildings),
      events: [
        {
          type: "battle.resolved",
          heroId,
          attackerPlayerId: attackerHero.playerId,
          battleId,
          result: "defender_victory"
        }
      ]
    };
  }

  const awardedAttacker = applyHeroExperience(attackerHero, neutralBattleExperience(neutralArmy), "neutral");
  const droppedEquipment = maybeAwardBattleEquipmentDrop(awardedAttacker.hero, state, battleId, "neutral");
  const nextNeutralArmies = { ...state.neutralArmies };
  delete nextNeutralArmies[neutralArmyId];
  const heroes = state.heroes.map((hero) =>
    hero.id === heroId
      ? {
          ...(droppedEquipment?.hero ?? awardedAttacker.hero),
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
  const nextState = buildNextWorldState(nextStateBase, heroes, nextNeutralArmies, state.buildings);

  return {
    state: nextState,
    events: [
      {
        type: "battle.resolved",
        heroId,
        attackerPlayerId: attackerHero.playerId,
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
        levelsGained: awardedAttacker.levelsGained,
        skillPointsAwarded: awardedAttacker.skillPointsAwarded,
        availableSkillPoints: awardedAttacker.hero.progression.skillPoints
      },
      ...(neutralArmy.reward
        ? [
            {
              type: "hero.collected" as const,
              heroId,
              resource: neutralArmy.reward
            }
          ]
        : []),
      ...(droppedEquipment ? [droppedEquipment.event] : [])
    ]
  };
}
