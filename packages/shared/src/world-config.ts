import defaultBattleSkillsConfig from "../../../configs/battle-skills.json";
import defaultMapObjectsConfig from "../../../configs/phase1-map-objects.json";
import defaultUnitsConfig from "../../../configs/units.json";
import defaultWorldConfig from "../../../configs/phase1-world.json";
import type {
  BattleSkillCatalogConfig,
  BattleSkillKind,
  BattleSkillTarget,
  MapObjectsConfig,
  NeutralBehaviorMode,
  ResourceLedger,
  ResourceNode,
  UnitCatalogConfig,
  WorldGenerationConfig
} from "./models";

let runtimeWorldConfig: WorldGenerationConfig = structuredClone(defaultWorldConfig as WorldGenerationConfig);
let runtimeMapObjectsConfig: MapObjectsConfig = structuredClone(defaultMapObjectsConfig as MapObjectsConfig);
let runtimeUnitCatalog: UnitCatalogConfig = structuredClone(defaultUnitsConfig as UnitCatalogConfig);
let runtimeBattleSkillCatalog: BattleSkillCatalogConfig = structuredClone(defaultBattleSkillsConfig as BattleSkillCatalogConfig);

export interface RuntimeConfigBundle {
  world: WorldGenerationConfig;
  mapObjects: MapObjectsConfig;
  units: UnitCatalogConfig;
  battleSkills: BattleSkillCatalogConfig;
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

function isNeutralBehaviorMode(value: unknown): value is NeutralBehaviorMode {
  return value === "guard" || value === "patrol";
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

      if (army.behavior.mode === "patrol" && (army.behavior.patrolPath?.length ?? 0) === 0) {
        throw new Error(`Neutral army ${army.id} patrol mode requires at least one patrol waypoint`);
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
  runtimeBattleSkillCatalog = nextConfig;
}

export function replaceRuntimeConfigs(configs: RuntimeConfigBundle): void {
  const nextWorld = cloneWorldConfig(configs.world);
  const nextMapObjects = cloneMapObjectsConfig(configs.mapObjects);
  const nextUnits = cloneUnitCatalog(configs.units);
  const nextBattleSkills = cloneBattleSkillCatalog(configs.battleSkills);

  validateWorldConfig(nextWorld);
  validateBattleSkillCatalog(nextBattleSkills);
  validateUnitCatalog(nextUnits, nextBattleSkills);
  validateMapObjectsConfig(nextMapObjects, nextWorld, nextUnits);

  runtimeWorldConfig = nextWorld;
  runtimeMapObjectsConfig = nextMapObjects;
  runtimeUnitCatalog = nextUnits;
  runtimeBattleSkillCatalog = nextBattleSkills;
}

export function resetRuntimeConfigs(): void {
  runtimeWorldConfig = structuredClone(defaultWorldConfig as WorldGenerationConfig);
  runtimeMapObjectsConfig = structuredClone(defaultMapObjectsConfig as MapObjectsConfig);
  runtimeUnitCatalog = structuredClone(defaultUnitsConfig as UnitCatalogConfig);
  runtimeBattleSkillCatalog = structuredClone(defaultBattleSkillsConfig as BattleSkillCatalogConfig);
}
