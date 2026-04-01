import defaultBattleSkillsConfig from "../../../../../configs/battle-skills.json";
import defaultBattleBalanceConfig from "../../../../../configs/battle-balance.json";
import defaultHeroSkillTreesConfig from "../../../../../configs/hero-skill-trees-full.json";
import contestedBasinMapObjectsConfig from "../../../../../configs/phase2-map-objects-contested-basin.json";
import frontierBasinMapObjectsConfig from "../../../../../configs/phase1-map-objects-frontier-basin.json";
import ridgewayCrossingMapObjectsConfig from "../../../../../configs/phase1-map-objects-ridgeway-crossing.json";
import defaultMapObjectsConfig from "../../../../../configs/phase1-map-objects.json";
import defaultUnitsConfig from "../../../../../configs/units.json";
import contestedBasinWorldConfig from "../../../../../configs/phase2-contested-basin.json";
import frontierBasinWorldConfig from "../../../../../configs/phase1-world-frontier-basin.json";
import ridgewayCrossingWorldConfig from "../../../../../configs/phase1-world-ridgeway-crossing.json";
import defaultWorldConfig from "../../../../../configs/phase1-world.json";
import type {
  BattleSkillCatalogConfig,
  BattleBalanceConfig,
  BattleSkillKind,
  BattleSkillTarget,
  HeroSkillTreeConfig,
  MapObjectsConfig,
  NeutralBehaviorMode,
  ResourceLedger,
  ResourceNode,
  TerrainType,
  UnitCatalogConfig,
  WorldGenerationConfig
} from "./models.ts";

let runtimeWorldConfig: WorldGenerationConfig = structuredClone(defaultWorldConfig as WorldGenerationConfig);
let runtimeMapObjectsConfig: MapObjectsConfig = structuredClone(defaultMapObjectsConfig as MapObjectsConfig);
let runtimeUnitCatalog: UnitCatalogConfig = structuredClone(defaultUnitsConfig as UnitCatalogConfig);
let runtimeBattleSkillCatalog: BattleSkillCatalogConfig = structuredClone(defaultBattleSkillsConfig as BattleSkillCatalogConfig);
let runtimeBattleBalanceConfig: BattleBalanceConfig = structuredClone(defaultBattleBalanceConfig as BattleBalanceConfig);
let runtimeHeroSkillTree: HeroSkillTreeConfig = structuredClone(defaultHeroSkillTreesConfig as HeroSkillTreeConfig);

export const DEFAULT_MAP_VARIANT_ID = "phase1";
export const FRONTIER_BASIN_MAP_VARIANT_ID = "frontier_basin";
export const RIDGEWAY_CROSSING_MAP_VARIANT_ID = "ridgeway_crossing";
export const CONTESTED_BASIN_MAP_VARIANT_ID = "contested_basin";

export interface RuntimeConfigBundle {
  world: WorldGenerationConfig;
  mapObjects: MapObjectsConfig;
  units: UnitCatalogConfig;
  battleSkills: BattleSkillCatalogConfig;
  battleBalance?: BattleBalanceConfig;
}

export interface RoomRuntimeConfigBundle extends RuntimeConfigBundle {
  mapVariantId: string;
}

function cloneWorldConfig(config: WorldGenerationConfig): WorldGenerationConfig {
  return structuredClone(config);
}

function cloneMapObjectsConfig(config: MapObjectsConfig): MapObjectsConfig {
  return structuredClone(config);
}

function cloneUnitCatalog(config: UnitCatalogConfig): UnitCatalogConfig {
  return structuredClone(config);
}

function cloneBattleSkillCatalog(config: BattleSkillCatalogConfig): BattleSkillCatalogConfig {
  return structuredClone(config);
}

function cloneBattleBalanceConfig(config: BattleBalanceConfig): BattleBalanceConfig {
  return structuredClone(config);
}

function cloneHeroSkillTreeConfig(config: HeroSkillTreeConfig): HeroSkillTreeConfig {
  return structuredClone(config);
}

function isResourceNode(value: unknown): value is ResourceNode | undefined {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  const node = value as Record<string, unknown>;
  return (
    (node.kind === "gold" || node.kind === "wood" || node.kind === "ore") &&
    typeof node.amount === "number"
  );
}

function isResourceLedger(value: unknown): value is ResourceLedger {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const ledger = value as Record<string, unknown>;
  return (
    typeof ledger.gold === "number" &&
    typeof ledger.wood === "number" &&
    typeof ledger.ore === "number"
  );
}

function isHeroStatBonusRecord(value: unknown): value is Record<"attack" | "defense" | "power" | "knowledge", number> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const bonus = value as Record<string, unknown>;
  return (
    typeof bonus.attack === "number" &&
    typeof bonus.defense === "number" &&
    typeof bonus.power === "number" &&
    typeof bonus.knowledge === "number"
  );
}

function isBattleSkillKind(value: unknown): value is BattleSkillKind {
  return value === "active" || value === "passive";
}

function isBattleSkillTarget(value: unknown): value is BattleSkillTarget {
  return value === "enemy" || value === "self";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isResourceKind(value: unknown): value is "gold" | "wood" | "ore" {
  return value === "gold" || value === "wood" || value === "ore";
}

function isTerrainType(value: unknown): value is TerrainType {
  return value === "grass" || value === "dirt" || value === "sand" || value === "water";
}

function isNeutralBehaviorMode(value: unknown): value is NeutralBehaviorMode {
  return value === "guard" || value === "patrol";
}

function isBattleSkillDelivery(value: unknown): value is "contact" | "ranged" {
  return value === "contact" || value === "ranged";
}

function isBattleStatusEffectId(value: unknown): value is string {
  return isNonEmptyString(value);
}

export function validateBattleBalanceConfig(
  config: BattleBalanceConfig,
  battleSkillCatalog: BattleSkillCatalogConfig = runtimeBattleSkillCatalog
): void {
  if (typeof config !== "object" || config === null) {
    throw new Error("Battle balance config must be an object");
  }

  if (typeof config.damage !== "object" || config.damage === null) {
    throw new Error("Battle balance config must define damage");
  }
  if (typeof config.environment !== "object" || config.environment === null) {
    throw new Error("Battle balance config must define environment");
  }

  if (!isFiniteNumber(config.damage.defendingDefenseBonus)) {
    throw new Error("Battle balance damage.defendingDefenseBonus must be a finite number");
  }
  if (!isFiniteNumber(config.damage.offenseAdvantageStep)) {
    throw new Error("Battle balance damage.offenseAdvantageStep must be a finite number");
  }
  if (!isFiniteNumber(config.damage.minimumOffenseMultiplier) || config.damage.minimumOffenseMultiplier <= 0) {
    throw new Error("Battle balance damage.minimumOffenseMultiplier must be > 0");
  }
  if (!isFiniteNumber(config.damage.varianceBase) || config.damage.varianceBase <= 0) {
    throw new Error("Battle balance damage.varianceBase must be > 0");
  }
  if (!isFiniteNumber(config.damage.varianceRange) || config.damage.varianceRange < 0) {
    throw new Error("Battle balance damage.varianceRange must be >= 0");
  }

  if (
    !isFiniteNumber(config.environment.blockerSpawnThreshold) ||
    config.environment.blockerSpawnThreshold < 0 ||
    config.environment.blockerSpawnThreshold > 1
  ) {
    throw new Error("Battle balance environment.blockerSpawnThreshold must be within [0, 1]");
  }
  if (!Number.isInteger(config.environment.blockerDurability) || config.environment.blockerDurability <= 0) {
    throw new Error("Battle balance environment.blockerDurability must be a positive integer");
  }
  if (
    !isFiniteNumber(config.environment.trapSpawnThreshold) ||
    config.environment.trapSpawnThreshold < 0 ||
    config.environment.trapSpawnThreshold > 1
  ) {
    throw new Error("Battle balance environment.trapSpawnThreshold must be within [0, 1]");
  }
  if (!Number.isInteger(config.environment.trapDamage) || config.environment.trapDamage < 0) {
    throw new Error("Battle balance environment.trapDamage must be a non-negative integer");
  }
  if (!Number.isInteger(config.environment.trapCharges) || config.environment.trapCharges <= 0) {
    throw new Error("Battle balance environment.trapCharges must be a positive integer");
  }
  if (
    config.environment.trapGrantedStatusId !== undefined &&
    !isBattleStatusEffectId(config.environment.trapGrantedStatusId)
  ) {
    throw new Error("Battle balance environment.trapGrantedStatusId must be a non-empty string when provided");
  }
}

export function validateBattleSkillCatalog(config: BattleSkillCatalogConfig): void {
  if (!Array.isArray(config.skills) || !Array.isArray(config.statuses)) {
    throw new Error("Battle skill catalog must contain skills and statuses arrays");
  }

  const statusIds = new Set<string>();
  for (const status of config.statuses) {
    if (!isNonEmptyString(status.id)) {
      throw new Error("Battle status id must be a non-empty string");
    }
    if (statusIds.has(status.id)) {
      throw new Error(`Duplicate battle status id: ${status.id}`);
    }
    if (!isNonEmptyString(status.name)) {
      throw new Error(`Battle status ${status.id} must define a name`);
    }
    if (!isNonEmptyString(status.description)) {
      throw new Error(`Battle status ${status.id} must define a description`);
    }
    if (!Number.isInteger(status.duration) || status.duration <= 0) {
      throw new Error(`Battle status ${status.id} must define a positive integer duration`);
    }
    if (!isFiniteNumber(status.attackModifier)) {
      throw new Error(`Battle status ${status.id} attackModifier must be a finite number`);
    }
    if (!isFiniteNumber(status.defenseModifier)) {
      throw new Error(`Battle status ${status.id} defenseModifier must be a finite number`);
    }
    if (!Number.isInteger(status.damagePerTurn) || status.damagePerTurn < 0) {
      throw new Error(`Battle status ${status.id} damagePerTurn must be a non-negative integer`);
    }
    if (status.initiativeModifier !== undefined && !isFiniteNumber(status.initiativeModifier)) {
      throw new Error(`Battle status ${status.id} initiativeModifier must be a finite number`);
    }
    if (status.blocksActiveSkills !== undefined && typeof status.blocksActiveSkills !== "boolean") {
      throw new Error(`Battle status ${status.id} blocksActiveSkills must be boolean`);
    }

    statusIds.add(status.id);
  }

  if (config.skills.length === 0) {
    throw new Error("Battle skill catalog must contain at least one skill");
  }

  const skillIds = new Set<string>();
  for (const skill of config.skills) {
    if (!isNonEmptyString(skill.id)) {
      throw new Error("Battle skill id must be a non-empty string");
    }
    if (skillIds.has(skill.id)) {
      throw new Error(`Duplicate battle skill id: ${skill.id}`);
    }
    if (!isNonEmptyString(skill.name)) {
      throw new Error(`Battle skill ${skill.id} must define a name`);
    }
    if (!isNonEmptyString(skill.description)) {
      throw new Error(`Battle skill ${skill.id} must define a description`);
    }
    if (!isBattleSkillKind(skill.kind)) {
      throw new Error(`Battle skill ${skill.id} has invalid kind: ${String(skill.kind)}`);
    }
    if (!isBattleSkillTarget(skill.target)) {
      throw new Error(`Battle skill ${skill.id} has invalid target: ${String(skill.target)}`);
    }
    if (skill.delivery !== undefined && !isBattleSkillDelivery(skill.delivery)) {
      throw new Error(`Battle skill ${skill.id} has invalid delivery: ${String(skill.delivery)}`);
    }
    if (!Number.isInteger(skill.cooldown) || skill.cooldown < 0) {
      throw new Error(`Battle skill ${skill.id} cooldown must be a non-negative integer`);
    }
    if (skill.kind === "passive" && skill.cooldown !== 0) {
      throw new Error(`Passive battle skill ${skill.id} must have cooldown 0`);
    }

    const effects = skill.effects ?? {};
    if (effects.damageMultiplier !== undefined && (!isFiniteNumber(effects.damageMultiplier) || effects.damageMultiplier <= 0)) {
      throw new Error(`Battle skill ${skill.id} damageMultiplier must be a positive number`);
    }
    if (effects.allowRetaliation !== undefined && typeof effects.allowRetaliation !== "boolean") {
      throw new Error(`Battle skill ${skill.id} allowRetaliation must be boolean`);
    }
    if (effects.grantedStatusId !== undefined && !statusIds.has(effects.grantedStatusId)) {
      throw new Error(`Battle skill ${skill.id} references unknown granted status: ${effects.grantedStatusId}`);
    }
    if (effects.onHitStatusId !== undefined && !statusIds.has(effects.onHitStatusId)) {
      throw new Error(`Battle skill ${skill.id} references unknown on-hit status: ${effects.onHitStatusId}`);
    }

    skillIds.add(skill.id);
  }
}

export function validateHeroSkillTreeConfig(
  config: HeroSkillTreeConfig,
  battleSkillCatalog: BattleSkillCatalogConfig = runtimeBattleSkillCatalog
): void {
  if (!Array.isArray(config.branches) || !Array.isArray(config.skills)) {
    throw new Error("Hero skill tree config must contain branches and skills arrays");
  }

  const branchIds = new Set<string>();
  for (const branch of config.branches) {
    if (!isNonEmptyString(branch.id)) {
      throw new Error("Hero skill branch id must be a non-empty string");
    }
    if (branchIds.has(branch.id)) {
      throw new Error(`Duplicate hero skill branch id: ${branch.id}`);
    }
    if (!isNonEmptyString(branch.name)) {
      throw new Error(`Hero skill branch ${branch.id} must define a name`);
    }
    if (!isNonEmptyString(branch.description)) {
      throw new Error(`Hero skill branch ${branch.id} must define a description`);
    }
    branchIds.add(branch.id);
  }

  const battleSkillIds = new Set(battleSkillCatalog.skills.map((skill) => skill.id));
  const skillIds = new Set<string>();
  for (const skill of config.skills) {
    if (!isNonEmptyString(skill.id)) {
      throw new Error("Hero skill id must be a non-empty string");
    }
    if (skillIds.has(skill.id)) {
      throw new Error(`Duplicate hero skill id: ${skill.id}`);
    }
    if (!branchIds.has(skill.branchId)) {
      throw new Error(`Hero skill ${skill.id} references unknown branch: ${skill.branchId}`);
    }
    if (!isNonEmptyString(skill.name)) {
      throw new Error(`Hero skill ${skill.id} must define a name`);
    }
    if (!isNonEmptyString(skill.description)) {
      throw new Error(`Hero skill ${skill.id} must define a description`);
    }
    if (!Number.isInteger(skill.requiredLevel) || skill.requiredLevel < 1) {
      throw new Error(`Hero skill ${skill.id} requiredLevel must be a positive integer`);
    }
    if (!Number.isInteger(skill.maxRank) || skill.maxRank < 1) {
      throw new Error(`Hero skill ${skill.id} maxRank must be a positive integer`);
    }
    if (!Array.isArray(skill.ranks) || skill.ranks.length !== skill.maxRank) {
      throw new Error(`Hero skill ${skill.id} must define exactly ${skill.maxRank} rank entries`);
    }

    const rankIds = new Set<number>();
    for (const rank of skill.ranks) {
      if (!Number.isInteger(rank.rank) || rank.rank < 1 || rank.rank > skill.maxRank) {
        throw new Error(`Hero skill ${skill.id} has invalid rank entry: ${String(rank.rank)}`);
      }
      if (rankIds.has(rank.rank)) {
        throw new Error(`Hero skill ${skill.id} has duplicate rank entry: ${rank.rank}`);
      }
      if (!isNonEmptyString(rank.description)) {
        throw new Error(`Hero skill ${skill.id} rank ${rank.rank} must define a description`);
      }

      for (const battleSkillId of rank.battleSkillIds ?? []) {
        if (!battleSkillIds.has(battleSkillId)) {
          throw new Error(`Hero skill ${skill.id} rank ${rank.rank} references unknown battle skill: ${battleSkillId}`);
        }
      }

      rankIds.add(rank.rank);
    }

    skillIds.add(skill.id);
  }

  for (const skill of config.skills) {
    for (const prerequisite of skill.prerequisites ?? []) {
      if (!skillIds.has(prerequisite)) {
        throw new Error(`Hero skill ${skill.id} references unknown prerequisite: ${prerequisite}`);
      }
      if (prerequisite === skill.id) {
        throw new Error(`Hero skill ${skill.id} cannot depend on itself`);
      }
    }
  }
}

export function validateWorldConfig(config: WorldGenerationConfig): void {
  if (config.width <= 0 || config.height <= 0) {
    throw new Error("World config width/height must be positive");
  }

  if (config.heroes.length === 0) {
    throw new Error("World config must define at least one hero");
  }

  for (const hero of config.heroes) {
    if (hero.position.x < 0 || hero.position.y < 0) {
      throw new Error(`Hero ${hero.id} position must be inside the map`);
    }

    if (hero.position.x >= config.width || hero.position.y >= config.height) {
      throw new Error(`Hero ${hero.id} position exceeds map bounds`);
    }

    if (hero.progression) {
      if ((hero.progression.level ?? 1) < 1) {
        throw new Error(`Hero ${hero.id} level must be at least 1`);
      }

      if ((hero.progression.experience ?? 0) < 0) {
        throw new Error(`Hero ${hero.id} experience cannot be negative`);
      }
    }
  }

  const occupiedTerrainOverrides = new Set<string>();
  for (const override of config.terrainOverrides ?? []) {
    if (!isTerrainType(override.terrain)) {
      throw new Error(`World config terrain override has invalid terrain: ${String(override.terrain)}`);
    }
    if (
      override.position.x < 0 ||
      override.position.y < 0 ||
      override.position.x >= config.width ||
      override.position.y >= config.height
    ) {
      throw new Error("World config terrain override exceeds map bounds");
    }

    const key = `${override.position.x},${override.position.y}`;
    if (occupiedTerrainOverrides.has(key)) {
      throw new Error(`Duplicate terrain override at ${key}`);
    }
    occupiedTerrainOverrides.add(key);
  }
}

export function validateMapObjectsConfig(
  config: MapObjectsConfig,
  world: WorldGenerationConfig,
  units: UnitCatalogConfig = runtimeUnitCatalog
): void {
  if (!Array.isArray(config.buildings)) {
    throw new Error("Map objects config must contain a buildings array");
  }

  const occupiedPositions = new Set<string>();
  const buildingIds = new Set<string>();
  const unitTemplateIds = new Set(units.templates.map((template) => template.id));

  for (const army of config.neutralArmies) {
    if (army.position.x < 0 || army.position.y < 0 || army.position.x >= world.width || army.position.y >= world.height) {
      throw new Error(`Neutral army ${army.id} exceeds map bounds`);
    }

    if (!isResourceNode(army.reward)) {
      throw new Error(`Neutral army ${army.id} reward is invalid`);
    }

    if (army.behavior) {
      if (army.behavior.mode !== undefined && !isNeutralBehaviorMode(army.behavior.mode)) {
        throw new Error(`Neutral army ${army.id} behavior mode must be guard/patrol`);
      }

      if (
        army.behavior.aggroRange !== undefined &&
        (!Number.isInteger(army.behavior.aggroRange) || army.behavior.aggroRange < 0)
      ) {
        throw new Error(`Neutral army ${army.id} aggroRange must be a non-negative integer`);
      }

      if (
        army.behavior.detectionRadius !== undefined &&
        (!Number.isInteger(army.behavior.detectionRadius) || army.behavior.detectionRadius < 0)
      ) {
        throw new Error(`Neutral army ${army.id} detectionRadius must be a non-negative integer`);
      }

      if (
        army.behavior.chaseDistance !== undefined &&
        (!Number.isInteger(army.behavior.chaseDistance) || army.behavior.chaseDistance < 0)
      ) {
        throw new Error(`Neutral army ${army.id} chaseDistance must be a non-negative integer`);
      }

      const configuredDetection =
        army.behavior.detectionRadius ?? army.behavior.aggroRange ?? undefined;
      if (
        army.behavior.chaseDistance !== undefined &&
        configuredDetection !== undefined &&
        army.behavior.chaseDistance < configuredDetection
      ) {
        throw new Error(`Neutral army ${army.id} chaseDistance must be >= detectionRadius`);
      }

      if (
        army.behavior.patrolRadius !== undefined &&
        (!Number.isInteger(army.behavior.patrolRadius) || army.behavior.patrolRadius < 0)
      ) {
        throw new Error(`Neutral army ${army.id} patrolRadius must be a non-negative integer`);
      }

      if (
        army.behavior.speed !== undefined &&
        (!Number.isInteger(army.behavior.speed) || army.behavior.speed <= 0)
      ) {
        throw new Error(`Neutral army ${army.id} speed must be a positive integer`);
      }

      if (army.behavior.patrolPath !== undefined) {
        if (!Array.isArray(army.behavior.patrolPath)) {
          throw new Error(`Neutral army ${army.id} patrolPath must be an array`);
        }

        for (const waypoint of army.behavior.patrolPath) {
          if (
            waypoint.x < 0 ||
            waypoint.y < 0 ||
            waypoint.x >= world.width ||
            waypoint.y >= world.height
          ) {
            throw new Error(`Neutral army ${army.id} patrolPath exceeds map bounds`);
          }
        }
      }

      if (
        army.behavior.mode === "patrol" &&
        (army.behavior.patrolPath?.length ?? 0) === 0 &&
        (army.behavior.patrolRadius ?? 0) <= 0
      ) {
        throw new Error(
          `Neutral army ${army.id} patrol mode requires patrolPath waypoints or a patrolRadius`
        );
      }
    }

    occupiedPositions.add(`${army.position.x},${army.position.y}`);
  }

  for (const resource of config.guaranteedResources) {
    if (
      resource.position.x < 0 ||
      resource.position.y < 0 ||
      resource.position.x >= world.width ||
      resource.position.y >= world.height
    ) {
      throw new Error("Guaranteed resource exceeds map bounds");
    }

    occupiedPositions.add(`${resource.position.x},${resource.position.y}`);
  }

  for (const hero of world.heroes) {
    occupiedPositions.add(`${hero.position.x},${hero.position.y}`);
  }

  for (const building of config.buildings) {
    if (!isNonEmptyString(building.id)) {
      throw new Error("Map building id must be a non-empty string");
    }
    if (buildingIds.has(building.id)) {
      throw new Error(`Duplicate map building id: ${building.id}`);
    }
    if (!isNonEmptyString(building.label)) {
      throw new Error(`Map building ${building.id} must define a label`);
    }
    if (building.position.x < 0 || building.position.y < 0 || building.position.x >= world.width || building.position.y >= world.height) {
      throw new Error(`Map building ${building.id} exceeds map bounds`);
    }
    if (occupiedPositions.has(`${building.position.x},${building.position.y}`)) {
      throw new Error(`Map building ${building.id} overlaps another configured object`);
    }

    if (building.kind === "recruitment_post") {
      if (!unitTemplateIds.has(building.unitTemplateId)) {
        throw new Error(`Map building ${building.id} references unknown unit template: ${building.unitTemplateId}`);
      }
      if (!Number.isInteger(building.recruitCount) || building.recruitCount <= 0) {
        throw new Error(`Map building ${building.id} recruitCount must be a positive integer`);
      }
      if (!isResourceLedger(building.cost)) {
        throw new Error(`Map building ${building.id} cost must define gold/wood/ore numbers`);
      }
      if (
        !Number.isInteger(building.cost.gold) ||
        !Number.isInteger(building.cost.wood) ||
        !Number.isInteger(building.cost.ore) ||
        building.cost.gold < 0 ||
        building.cost.wood < 0 ||
        building.cost.ore < 0
      ) {
        throw new Error(`Map building ${building.id} cost must use non-negative integers`);
      }
    } else if (building.kind === "attribute_shrine") {
      if (!isHeroStatBonusRecord(building.bonus)) {
        throw new Error(`Map building ${building.id} bonus must define attack/defense/power/knowledge numbers`);
      }

      const values = [building.bonus.attack, building.bonus.defense, building.bonus.power, building.bonus.knowledge];
      if (values.some((value) => !Number.isInteger(value) || value < 0)) {
        throw new Error(`Map building ${building.id} bonus must use non-negative integers`);
      }
      if (values.every((value) => value === 0)) {
        throw new Error(`Map building ${building.id} bonus must increase at least one hero stat`);
      }
    } else if (building.kind === "resource_mine") {
      if (!isResourceKind(building.resourceKind)) {
        throw new Error(`Map building ${building.id} resourceKind must be gold/wood/ore`);
      }
      if (!Number.isInteger(building.income) || building.income <= 0) {
        throw new Error(`Map building ${building.id} income must be a positive integer`);
      }
    } else if (building.kind === "watchtower") {
      if (!Number.isInteger(building.visionBonus) || building.visionBonus <= 0) {
        throw new Error(`Map building ${building.id} visionBonus must be a positive integer`);
      }
    } else {
      throw new Error(`Map building has invalid kind: ${String((building as { kind?: unknown }).kind)}`);
    }

    buildingIds.add(building.id);
    occupiedPositions.add(`${building.position.x},${building.position.y}`);
  }
}

export function validateUnitCatalog(
  config: UnitCatalogConfig,
  battleSkillCatalog: BattleSkillCatalogConfig = runtimeBattleSkillCatalog
): void {
  if (config.templates.length === 0) {
    throw new Error("Unit catalog must contain at least one template");
  }

  const availableSkillIds = new Set(battleSkillCatalog.skills.map((skill) => skill.id));
  const ids = new Set<string>();
  for (const template of config.templates) {
    if (template.faction !== "crown" && template.faction !== "wild") {
      throw new Error(`Invalid faction for unit template: ${template.id}`);
    }

    if (template.rarity !== "common" && template.rarity !== "elite") {
      throw new Error(`Invalid rarity for unit template: ${template.id}`);
    }

    if (ids.has(template.id)) {
      throw new Error(`Duplicate unit template id: ${template.id}`);
    }
    ids.add(template.id);

    for (const skillId of template.battleSkills ?? []) {
      if (!availableSkillIds.has(skillId)) {
        throw new Error(`Invalid battle skill for unit template ${template.id}: ${String(skillId)}`);
      }
    }
  }
}

export function getDefaultWorldConfig(): WorldGenerationConfig {
  const config = cloneWorldConfig(runtimeWorldConfig);
  validateWorldConfig(config);
  return config;
}

export function getDefaultMapObjectsConfig(): MapObjectsConfig {
  const world = getDefaultWorldConfig();
  const config = cloneMapObjectsConfig(runtimeMapObjectsConfig);
  validateMapObjectsConfig(config, world, runtimeUnitCatalog);
  return config;
}

export function getDefaultUnitCatalog(): UnitCatalogConfig {
  const config = cloneUnitCatalog(runtimeUnitCatalog);
  validateUnitCatalog(config);
  return config;
}

export function getDefaultBattleSkillCatalog(): BattleSkillCatalogConfig {
  const config = cloneBattleSkillCatalog(runtimeBattleSkillCatalog);
  validateBattleSkillCatalog(config);
  return config;
}

export function getBattleBalanceConfig(): BattleBalanceConfig {
  const config = cloneBattleBalanceConfig(runtimeBattleBalanceConfig);
  validateBattleBalanceConfig(config, runtimeBattleSkillCatalog);
  return config;
}

export function getDefaultHeroSkillTreeConfig(): HeroSkillTreeConfig {
  const config = cloneHeroSkillTreeConfig(runtimeHeroSkillTree);
  validateHeroSkillTreeConfig(config);
  return config;
}

function hashVariantSeed(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  }
  return hash >>> 0;
}

function parseRequestedMapVariantId(roomId: string): string | undefined {
  const match = roomId.match(/\[map:([a-z0-9_-]+)\]/i);
  return match?.[1]?.toLowerCase();
}

function getAvailableMapVariantIds(): string[] {
  return [
    DEFAULT_MAP_VARIANT_ID,
    FRONTIER_BASIN_MAP_VARIANT_ID,
    RIDGEWAY_CROSSING_MAP_VARIANT_ID,
    CONTESTED_BASIN_MAP_VARIANT_ID
  ];
}

export function resolveMapVariantIdForRoom(roomId: string, seed = 1001): string {
  const requested = parseRequestedMapVariantId(roomId);
  if (!requested) {
    return DEFAULT_MAP_VARIANT_ID;
  }
  if (requested === "random") {
    const variants = getAvailableMapVariantIds();
    return variants[hashVariantSeed(roomId, seed) % variants.length] ?? DEFAULT_MAP_VARIANT_ID;
  }
  if (
    requested === DEFAULT_MAP_VARIANT_ID ||
    requested === FRONTIER_BASIN_MAP_VARIANT_ID ||
    requested === RIDGEWAY_CROSSING_MAP_VARIANT_ID ||
    requested === CONTESTED_BASIN_MAP_VARIANT_ID
  ) {
    return requested;
  }
  return DEFAULT_MAP_VARIANT_ID;
}

export function getRuntimeConfigBundleForRoom(roomId: string, seed = 1001): RoomRuntimeConfigBundle {
  const mapVariantId = resolveMapVariantIdForRoom(roomId, seed);
  const units = getDefaultUnitCatalog();
  const battleSkills = getDefaultBattleSkillCatalog();
  const battleBalance = getBattleBalanceConfig();

  const world =
    mapVariantId === FRONTIER_BASIN_MAP_VARIANT_ID
      ? cloneWorldConfig(frontierBasinWorldConfig as WorldGenerationConfig)
      : mapVariantId === RIDGEWAY_CROSSING_MAP_VARIANT_ID
        ? cloneWorldConfig(ridgewayCrossingWorldConfig as WorldGenerationConfig)
      : mapVariantId === CONTESTED_BASIN_MAP_VARIANT_ID
        ? cloneWorldConfig(contestedBasinWorldConfig as WorldGenerationConfig)
        : getDefaultWorldConfig();
  const mapObjects =
    mapVariantId === FRONTIER_BASIN_MAP_VARIANT_ID
      ? cloneMapObjectsConfig(frontierBasinMapObjectsConfig as MapObjectsConfig)
      : mapVariantId === RIDGEWAY_CROSSING_MAP_VARIANT_ID
        ? cloneMapObjectsConfig(ridgewayCrossingMapObjectsConfig as MapObjectsConfig)
      : mapVariantId === CONTESTED_BASIN_MAP_VARIANT_ID
        ? cloneMapObjectsConfig(contestedBasinMapObjectsConfig as MapObjectsConfig)
        : getDefaultMapObjectsConfig();

  validateWorldConfig(world);
  validateMapObjectsConfig(mapObjects, world, units);

  return {
    mapVariantId,
    world,
    mapObjects,
    units,
    battleSkills,
    battleBalance
  };
}

export function setWorldConfig(config: WorldGenerationConfig): void {
  const nextConfig = cloneWorldConfig(config);
  validateWorldConfig(nextConfig);
  validateMapObjectsConfig(runtimeMapObjectsConfig, nextConfig, runtimeUnitCatalog);
  runtimeWorldConfig = nextConfig;
}

export function setMapObjectsConfig(config: MapObjectsConfig): void {
  const nextConfig = cloneMapObjectsConfig(config);
  validateMapObjectsConfig(nextConfig, runtimeWorldConfig, runtimeUnitCatalog);
  runtimeMapObjectsConfig = nextConfig;
}

export function setUnitCatalog(config: UnitCatalogConfig): void {
  const nextConfig = cloneUnitCatalog(config);
  validateUnitCatalog(nextConfig);
  validateMapObjectsConfig(runtimeMapObjectsConfig, runtimeWorldConfig, nextConfig);
  runtimeUnitCatalog = nextConfig;
}

export function setBattleSkillCatalog(config: BattleSkillCatalogConfig): void {
  const nextConfig = cloneBattleSkillCatalog(config);
  validateBattleSkillCatalog(nextConfig);
  validateUnitCatalog(runtimeUnitCatalog, nextConfig);
  validateHeroSkillTreeConfig(runtimeHeroSkillTree, nextConfig);
  validateBattleBalanceConfig(runtimeBattleBalanceConfig, nextConfig);
  runtimeBattleSkillCatalog = nextConfig;
}

export function setBattleBalanceConfig(config: BattleBalanceConfig): void {
  const nextConfig = cloneBattleBalanceConfig(config);
  validateBattleBalanceConfig(nextConfig, runtimeBattleSkillCatalog);
  runtimeBattleBalanceConfig = nextConfig;
}

export function setHeroSkillTreeConfig(config: HeroSkillTreeConfig): void {
  const nextConfig = cloneHeroSkillTreeConfig(config);
  validateHeroSkillTreeConfig(nextConfig);
  runtimeHeroSkillTree = nextConfig;
}

export function replaceRuntimeConfigs(configs: RuntimeConfigBundle): void {
  const nextWorld = cloneWorldConfig(configs.world);
  const nextMapObjects = cloneMapObjectsConfig(configs.mapObjects);
  const nextUnits = cloneUnitCatalog(configs.units);
  const nextBattleSkills = cloneBattleSkillCatalog(configs.battleSkills);
  const nextBattleBalance = cloneBattleBalanceConfig(configs.battleBalance ?? runtimeBattleBalanceConfig);

  validateWorldConfig(nextWorld);
  validateBattleSkillCatalog(nextBattleSkills);
  validateUnitCatalog(nextUnits, nextBattleSkills);
  validateMapObjectsConfig(nextMapObjects, nextWorld, nextUnits);
  validateBattleBalanceConfig(nextBattleBalance, nextBattleSkills);

  runtimeWorldConfig = nextWorld;
  runtimeMapObjectsConfig = nextMapObjects;
  runtimeUnitCatalog = nextUnits;
  runtimeBattleSkillCatalog = nextBattleSkills;
  runtimeBattleBalanceConfig = nextBattleBalance;
}

export function resetRuntimeConfigs(): void {
  runtimeWorldConfig = structuredClone(defaultWorldConfig as WorldGenerationConfig);
  runtimeMapObjectsConfig = structuredClone(defaultMapObjectsConfig as MapObjectsConfig);
  runtimeUnitCatalog = structuredClone(defaultUnitsConfig as UnitCatalogConfig);
  runtimeBattleSkillCatalog = structuredClone(defaultBattleSkillsConfig as BattleSkillCatalogConfig);
  runtimeBattleBalanceConfig = structuredClone(defaultBattleBalanceConfig as BattleBalanceConfig);
  runtimeHeroSkillTree = structuredClone(defaultHeroSkillTreesConfig as HeroSkillTreeConfig);
}
