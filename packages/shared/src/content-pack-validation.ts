import { getEquipmentDefinition, HERO_EQUIPMENT_INVENTORY_CAPACITY } from "./equipment.ts";
import {
  getDefaultHeroSkillTreeConfig
} from "./world-config.ts";
import {
  levelForExperience,
  BattleBalanceConfig,
  BattleSkillCatalogConfig,
  EquipmentType,
  HeroConfig,
  HeroLearnedSkillState,
  MapObjectsConfig,
  UnitCatalogConfig,
  WorldGenerationConfig
} from "./models.ts";
import type { RuntimeConfigBundle } from "./world-config.ts";

export type ContentPackDocumentId = "world" | "mapObjects" | "units" | "battleSkills" | "battleBalance";

export interface ContentPackValidationIssue {
  documentId: ContentPackDocumentId;
  path: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  suggestion: string;
}

export interface ContentPackValidationReport {
  schemaVersion: 1;
  valid: boolean;
  summary: string;
  issueCount: number;
  checkedDocuments: ContentPackDocumentId[];
  issues: ContentPackValidationIssue[];
}

function pushIssue(
  issues: ContentPackValidationIssue[],
  issue: Omit<ContentPackValidationIssue, "severity"> & { severity?: "error" | "warning" }
): void {
  issues.push({
    severity: issue.severity ?? "error",
    ...issue
  });
}

function positionKey(position: { x: number; y: number }): string {
  return `${position.x},${position.y}`;
}

function buildBlockedTerrainLookup(world: WorldGenerationConfig): Map<string, string> {
  return new Map(
    (world.terrainOverrides ?? [])
      .filter((override) => override.terrain === "water")
      .map((override) => [positionKey(override.position), override.terrain] as const)
  );
}

function validateWorldReferences(
  world: WorldGenerationConfig,
  units: UnitCatalogConfig,
  issues: ContentPackValidationIssue[]
): void {
  const unitIds = new Set(units.templates.map((template) => template.id));
  const heroIds = new Set<string>();
  const occupiedPositions = new Map<string, string>();

  world.heroes.forEach((hero, index) => {
    if (heroIds.has(hero.id)) {
      pushIssue(issues, {
        documentId: "world",
        path: `heroes[${index}].id`,
        code: "duplicate_hero_id",
        message: `Hero id ${hero.id} is duplicated inside the content pack.`,
        suggestion: "Assign a unique hero id before exporting the pack."
      });
    }
    heroIds.add(hero.id);

    if (!unitIds.has(hero.armyTemplateId)) {
      pushIssue(issues, {
        documentId: "world",
        path: `heroes[${index}].armyTemplateId`,
        code: "unknown_hero_army_template",
        message: `Hero ${hero.id} references missing unit template ${hero.armyTemplateId}.`,
        suggestion: "Point the hero at a template from units.json or add the missing template."
      });
    }

    const key = positionKey(hero.position);
    const existing = occupiedPositions.get(key);
    if (existing) {
      pushIssue(issues, {
        documentId: "world",
        path: `heroes[${index}].position`,
        code: "overlapping_hero_position",
        message: `Hero ${hero.id} overlaps ${existing} at ${key}.`,
        suggestion: "Move the hero to a unique map position."
      });
      return;
    }

    occupiedPositions.set(key, `hero ${hero.id}`);
  });
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && value > 0;
}

function heroPath(heroIndex: number, suffix: string): string {
  return `heroes[${heroIndex}]${suffix}`;
}

function buildHeroSkillIndex(): Map<string, { requiredLevel: number; maxRank: number; prerequisites: string[] }> {
  const config = getDefaultHeroSkillTreeConfig();
  return new Map(
    config.skills.map((skill) => [
      skill.id,
      {
        requiredLevel: skill.requiredLevel,
        maxRank: skill.maxRank,
        prerequisites: [...(skill.prerequisites ?? [])]
      }
    ] as const)
  );
}

function validateHeroProgression(
  hero: HeroConfig,
  heroIndex: number,
  issues: ContentPackValidationIssue[],
  heroSkillIndex: Map<string, { requiredLevel: number; maxRank: number; prerequisites: string[] }>
): void {
  const progression = hero.progression;
  if (!progression) {
    return;
  }

  const level = progression.level ?? 1;
  const experience = progression.experience ?? 0;
  const skillPoints = progression.skillPoints ?? 0;
  const battlesWon = progression.battlesWon ?? 0;
  const neutralBattlesWon = progression.neutralBattlesWon ?? 0;
  const pvpBattlesWon = progression.pvpBattlesWon ?? 0;

  const integerChecks = [
    { key: "level", value: level },
    { key: "experience", value: experience },
    { key: "skillPoints", value: skillPoints },
    { key: "battlesWon", value: battlesWon },
    { key: "neutralBattlesWon", value: neutralBattlesWon },
    { key: "pvpBattlesWon", value: pvpBattlesWon }
  ];

  for (const check of integerChecks) {
    if (!isNonNegativeInteger(check.value)) {
      pushIssue(issues, {
        documentId: "world",
        path: heroPath(heroIndex, `.progression.${check.key}`),
        code: "invalid_hero_progression_value",
        message: `Hero ${hero.id} progression.${check.key} must be a non-negative integer.`,
        suggestion: "Use whole numbers for authored progression fields so archive hydration stays deterministic."
      });
    }
  }

  if (isNonNegativeInteger(level) && isNonNegativeInteger(experience)) {
    const minimumLevel = levelForExperience(experience);
    if (level < minimumLevel) {
      pushIssue(issues, {
        documentId: "world",
        path: heroPath(heroIndex, ".progression.level"),
        code: "hero_progression_level_experience_mismatch",
        message: `Hero ${hero.id} level ${level} is below the minimum level ${minimumLevel} for ${experience} experience.`,
        suggestion: `Increase the hero level to at least ${minimumLevel} or lower the authored experience total.`
      });
    }
  }

  if (
    isNonNegativeInteger(battlesWon) &&
    isNonNegativeInteger(neutralBattlesWon) &&
    isNonNegativeInteger(pvpBattlesWon) &&
    neutralBattlesWon + pvpBattlesWon > battlesWon
  ) {
    pushIssue(issues, {
      documentId: "world",
      path: heroPath(heroIndex, ".progression"),
      code: "hero_battle_counters_mismatch",
      message: `Hero ${hero.id} has ${neutralBattlesWon} neutral wins and ${pvpBattlesWon} PvP wins but only ${battlesWon} total battles won.`,
      suggestion: "Keep battlesWon greater than or equal to the sum of neutralBattlesWon and pvpBattlesWon."
    });
  }

  const learnedSkills = hero.learnedSkills ?? [];
  let spentSkillPoints = 0;
  const learnedSkillRanks = new Map<string, number>();

  for (const [skillIndex, learnedSkill] of learnedSkills.entries()) {
    if (!validateLearnedHeroSkill(hero, heroIndex, skillIndex, learnedSkill, heroSkillIndex, issues)) {
      continue;
    }

    spentSkillPoints += learnedSkill.rank;
    learnedSkillRanks.set(learnedSkill.skillId, learnedSkill.rank);
  }

  if (isNonNegativeInteger(level) && isNonNegativeInteger(skillPoints)) {
    const earnedSkillPoints = Math.max(0, level - 1);
    if (spentSkillPoints + skillPoints > earnedSkillPoints) {
      pushIssue(issues, {
        documentId: "world",
        path: heroPath(heroIndex, ".progression.skillPoints"),
        code: "hero_skill_points_exceed_progression",
        message: `Hero ${hero.id} spends ${spentSkillPoints} skill point(s) in learnedSkills and still has ${skillPoints} available, exceeding the ${earnedSkillPoints} point(s) granted by level ${level}.`,
        suggestion: "Lower learned skill ranks, reduce remaining skillPoints, or raise the hero level so authored progression matches the archive state."
      });
    }
  }

  for (const [skillIndex, learnedSkill] of learnedSkills.entries()) {
    const skill = heroSkillIndex.get(learnedSkill.skillId);
    if (!skill) {
      continue;
    }

    const missingPrerequisite = skill.prerequisites.find((prerequisite) => (learnedSkillRanks.get(prerequisite) ?? 0) <= 0);
    if (missingPrerequisite) {
      pushIssue(issues, {
        documentId: "world",
        path: heroPath(heroIndex, `.learnedSkills[${skillIndex}].skillId`),
        code: "hero_skill_prerequisite_missing",
        message: `Hero ${hero.id} learns ${learnedSkill.skillId} without prerequisite ${missingPrerequisite}.`,
        suggestion: "Add the prerequisite skill to learnedSkills or remove the dependent skill from the authored hero archive."
      });
    }
  }
}

function validateLearnedHeroSkill(
  hero: HeroConfig,
  heroIndex: number,
  skillIndex: number,
  learnedSkill: HeroLearnedSkillState,
  heroSkillIndex: Map<string, { requiredLevel: number; maxRank: number; prerequisites: string[] }>,
  issues: ContentPackValidationIssue[]
): learnedSkill is HeroLearnedSkillState & { skillId: string; rank: number } {
  const skillId = learnedSkill?.skillId?.trim();
  if (!skillId) {
    pushIssue(issues, {
      documentId: "world",
      path: heroPath(heroIndex, `.learnedSkills[${skillIndex}].skillId`),
      code: "hero_skill_id_missing",
      message: `Hero ${hero.id} learnedSkills[${skillIndex}] is missing a skill id.`,
      suggestion: "Set the skillId to a valid hero skill or remove the empty entry."
    });
    return false;
  }

  if (!isPositiveInteger(learnedSkill.rank)) {
    pushIssue(issues, {
      documentId: "world",
      path: heroPath(heroIndex, `.learnedSkills[${skillIndex}].rank`),
      code: "hero_skill_rank_invalid",
      message: `Hero ${hero.id} learned skill ${skillId} rank must be a positive integer.`,
      suggestion: "Use a whole-number rank between 1 and the skill's maxRank."
    });
    return false;
  }

  const skill = heroSkillIndex.get(skillId);
  if (!skill) {
    pushIssue(issues, {
      documentId: "world",
      path: heroPath(heroIndex, `.learnedSkills[${skillIndex}].skillId`),
      code: "hero_skill_missing",
      message: `Hero ${hero.id} references unknown hero skill ${skillId}.`,
      suggestion: "Use a skill from hero-skill-trees-full.json or remove the stale learnedSkills entry."
    });
    return false;
  }

  if (learnedSkill.rank > skill.maxRank) {
    pushIssue(issues, {
      documentId: "world",
      path: heroPath(heroIndex, `.learnedSkills[${skillIndex}].rank`),
      code: "hero_skill_rank_exceeds_max",
      message: `Hero ${hero.id} sets ${skillId} to rank ${learnedSkill.rank}, but the skill only supports rank ${skill.maxRank}.`,
      suggestion: "Lower the authored rank so it stays within the skill tree definition."
    });
  }

  if ((hero.progression?.level ?? 1) < skill.requiredLevel) {
    pushIssue(issues, {
      documentId: "world",
      path: heroPath(heroIndex, `.learnedSkills[${skillIndex}]`),
      code: "hero_skill_level_too_low",
      message: `Hero ${hero.id} is level ${hero.progression?.level ?? 1} but ${skillId} requires level ${skill.requiredLevel}.`,
      suggestion: "Raise the hero level or remove the learned skill until the prerequisite level is reached."
    });
  }

  return true;
}

function validateHeroEquipmentLoadout(hero: HeroConfig, heroIndex: number, issues: ContentPackValidationIssue[]): void {
  const loadout = hero.loadout;
  if (!loadout) {
    return;
  }

  const inventory = loadout.inventory ?? [];
  if (inventory.length > HERO_EQUIPMENT_INVENTORY_CAPACITY) {
    pushIssue(issues, {
      documentId: "world",
      path: heroPath(heroIndex, ".loadout.inventory"),
      code: "hero_inventory_capacity_exceeded",
      message: `Hero ${hero.id} starts with ${inventory.length} equipment item(s), exceeding the ${HERO_EQUIPMENT_INVENTORY_CAPACITY}-slot backpack limit.`,
      suggestion: "Trim the authored inventory or equip some items before exporting the content pack."
    });
  }

  inventory.forEach((equipmentId, inventoryIndex) => {
    const definition = typeof equipmentId === "string" ? getEquipmentDefinition(equipmentId) : undefined;
    if (!definition) {
      pushIssue(issues, {
        documentId: "world",
        path: heroPath(heroIndex, `.loadout.inventory[${inventoryIndex}]`),
        code: "hero_inventory_equipment_missing",
        message: `Hero ${hero.id} inventory references unknown equipment id ${String(equipmentId)}.`,
        suggestion: "Use an item from the default equipment catalog or remove the stale inventory entry."
      });
    }
  });

  const slotEntries: Array<{ slot: EquipmentType; key: "weaponId" | "armorId" | "accessoryId" }> = [
    { slot: "weapon", key: "weaponId" },
    { slot: "armor", key: "armorId" },
    { slot: "accessory", key: "accessoryId" }
  ];

  slotEntries.forEach(({ slot, key }) => {
    const equipmentId = loadout.equipment?.[key];
    if (!equipmentId) {
      return;
    }

    const definition = getEquipmentDefinition(equipmentId);
    if (!definition) {
      pushIssue(issues, {
        documentId: "world",
        path: heroPath(heroIndex, `.loadout.equipment.${key}`),
        code: "hero_equipment_missing",
        message: `Hero ${hero.id} equips unknown equipment id ${equipmentId} in ${slot} slot.`,
        suggestion: "Use an item from the default equipment catalog or clear the slot."
      });
      return;
    }

    if (definition.type !== slot) {
      pushIssue(issues, {
        documentId: "world",
        path: heroPath(heroIndex, `.loadout.equipment.${key}`),
        code: "hero_equipment_slot_mismatch",
        message: `Hero ${hero.id} equips ${equipmentId} in the ${slot} slot, but that item is typed as ${definition.type}.`,
        suggestion: `Move ${equipmentId} to the ${definition.type} slot or replace it with a ${slot} item.`
      });
    }
  });

  const trinketIds = loadout.equipment?.trinketIds ?? [];
  if (trinketIds.length > 0) {
    pushIssue(issues, {
      documentId: "world",
      path: heroPath(heroIndex, ".loadout.equipment.trinketIds"),
      code: "hero_equipment_legacy_trinket_ids",
      message: `Hero ${hero.id} still uses legacy loadout.equipment.trinketIds, which no longer maps to active slots or archive inventory rules.`,
      suggestion: "Move one accessory into loadout.equipment.accessoryId and place any extras into loadout.inventory."
    });
  }

  trinketIds.forEach((equipmentId, trinketIndex) => {
    const definition = typeof equipmentId === "string" ? getEquipmentDefinition(equipmentId) : undefined;
    if (!definition) {
      pushIssue(issues, {
        documentId: "world",
        path: heroPath(heroIndex, `.loadout.equipment.trinketIds[${trinketIndex}]`),
        code: "hero_legacy_trinket_missing",
        message: `Hero ${hero.id} legacy trinket entry references unknown equipment id ${String(equipmentId)}.`,
        suggestion: "Remove the stale trinket id or replace it with a valid accessory item."
      });
      return;
    }

    if (definition.type !== "accessory") {
      pushIssue(issues, {
        documentId: "world",
        path: heroPath(heroIndex, `.loadout.equipment.trinketIds[${trinketIndex}]`),
        code: "hero_legacy_trinket_slot_mismatch",
        message: `Hero ${hero.id} legacy trinket entry ${equipmentId} is typed as ${definition.type}, not accessory.`,
        suggestion: "Only accessory items belong in trinketIds during migration; move other item types into their matching slot or inventory."
      });
    }
  });
}

function validateMapObjectReferences(
  world: WorldGenerationConfig,
  mapObjects: MapObjectsConfig,
  units: UnitCatalogConfig,
  issues: ContentPackValidationIssue[]
): void {
  const unitIds = new Set(units.templates.map((template) => template.id));
  const occupiedPositions = new Map<string, string>(
    world.heroes.map((hero) => [positionKey(hero.position), `hero ${hero.id}`] as const)
  );
  const neutralIds = new Set<string>();
  const blockedTerrain = buildBlockedTerrainLookup(world);

  world.heroes.forEach((hero, index) => {
    const terrain = blockedTerrain.get(positionKey(hero.position));
    if (terrain) {
      pushIssue(issues, {
        documentId: "world",
        path: `heroes[${index}].position`,
        code: "hero_on_blocked_terrain",
        message: `Hero ${hero.id} is placed on ${terrain} terrain.`,
        suggestion: "Move the hero or adjust the terrain override so the start tile remains walkable."
      });
    }
  });

  mapObjects.neutralArmies.forEach((army, armyIndex) => {
    if (neutralIds.has(army.id)) {
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `neutralArmies[${armyIndex}].id`,
        code: "duplicate_neutral_id",
        message: `Neutral army id ${army.id} is duplicated inside the content pack.`,
        suggestion: "Assign a unique neutral army id before exporting the pack."
      });
    }
    neutralIds.add(army.id);

    army.stacks.forEach((stack, stackIndex) => {
      if (!unitIds.has(stack.templateId)) {
        pushIssue(issues, {
          documentId: "mapObjects",
          path: `neutralArmies[${armyIndex}].stacks[${stackIndex}].templateId`,
          code: "unknown_neutral_unit_template",
          message: `Neutral army ${army.id} references missing unit template ${stack.templateId}.`,
          suggestion: "Use a template from units.json or add the missing template."
        });
      }
    });

    if (army.reward) {
      if (!isPositiveInteger(army.reward.amount)) {
        pushIssue(issues, {
          documentId: "mapObjects",
          path: `neutralArmies[${armyIndex}].reward.amount`,
          code: "neutral_reward_amount_invalid",
          message: `Neutral army ${army.id} reward amount must be a positive integer, received ${String(army.reward.amount)}.`,
          suggestion: "Author reward.amount as a whole number greater than zero so persistence and event logs stay consistent."
        });
      }
    }

    const terrain = blockedTerrain.get(positionKey(army.position));
    if (terrain) {
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `neutralArmies[${armyIndex}].position`,
        code: "neutral_on_blocked_terrain",
        message: `Neutral army ${army.id} is placed on ${terrain} terrain.`,
        suggestion: "Move the neutral army or adjust the terrain override so the encounter tile remains walkable."
      });
    }

    army.behavior?.patrolPath?.forEach((waypoint, waypointIndex) => {
      const patrolTerrain = blockedTerrain.get(positionKey(waypoint));
      if (!patrolTerrain) {
        return;
      }
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `neutralArmies[${armyIndex}].behavior.patrolPath[${waypointIndex}]`,
        code: "patrol_waypoint_on_blocked_terrain",
        message: `Neutral army ${army.id} patrol waypoint ${waypointIndex + 1} is placed on ${patrolTerrain} terrain.`,
        suggestion: "Move the patrol waypoint or adjust the terrain override so the patrol path stays walkable."
      });
    });

    const key = positionKey(army.position);
    const existing = occupiedPositions.get(key);
    if (existing) {
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `neutralArmies[${armyIndex}].position`,
        code: "overlapping_map_object_position",
        message: `Neutral army ${army.id} overlaps ${existing} at ${key}.`,
        suggestion: "Move the neutral army to an unused tile."
      });
    } else {
      occupiedPositions.set(key, `neutral army ${army.id}`);
    }
  });

  mapObjects.guaranteedResources.forEach((resource, index) => {
    if (!isPositiveInteger(resource.resource.amount)) {
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `guaranteedResources[${index}].resource.amount`,
        code: "guaranteed_resource_amount_invalid",
        message: `Guaranteed resource ${resource.resource.kind} amount must be a positive integer, received ${String(resource.resource.amount)}.`,
        suggestion: "Author guaranteed resource amounts as whole numbers greater than zero."
      });
    }

    const terrain = blockedTerrain.get(positionKey(resource.position));
    if (terrain) {
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `guaranteedResources[${index}].position`,
        code: "resource_on_blocked_terrain",
        message: `Guaranteed resource ${resource.resource.kind} is placed on ${terrain} terrain.`,
        suggestion: "Move the resource node or adjust the terrain override so the pickup tile remains walkable."
      });
    }

    const key = positionKey(resource.position);
    const existing = occupiedPositions.get(key);
    if (existing) {
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `guaranteedResources[${index}].position`,
        code: "overlapping_map_object_position",
        message: `Guaranteed resource overlaps ${existing} at ${key}.`,
        suggestion: "Move the resource node to an unused tile."
      });
    } else {
      occupiedPositions.set(key, `guaranteed resource ${resource.resource.kind}`);
    }
  });

  mapObjects.buildings.forEach((building, index) => {
    if (building.kind === "recruitment_post" && !unitIds.has(building.unitTemplateId)) {
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `buildings[${index}].unitTemplateId`,
        code: "unknown_recruitment_unit_template",
        message: `Building ${building.id} references missing unit template ${building.unitTemplateId}.`,
        suggestion: "Use a template from units.json or add the missing template."
      });
    }

    const terrain = blockedTerrain.get(positionKey(building.position));
    if (terrain) {
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `buildings[${index}].position`,
        code: "building_on_blocked_terrain",
        message: `Building ${building.id} is placed on ${terrain} terrain.`,
        suggestion: "Move the building or adjust the terrain override so the interaction tile remains walkable."
      });
    }

    const key = positionKey(building.position);
    const existing = occupiedPositions.get(key);
    if (existing) {
      pushIssue(issues, {
        documentId: "mapObjects",
        path: `buildings[${index}].position`,
        code: "overlapping_map_object_position",
        message: `Building ${building.id} overlaps ${existing} at ${key}.`,
        suggestion: "Move the building to an unused tile."
      });
    } else {
      occupiedPositions.set(key, `building ${building.id}`);
    }
  });
}

function validateUnitSkillReferences(
  units: UnitCatalogConfig,
  battleSkills: BattleSkillCatalogConfig,
  issues: ContentPackValidationIssue[]
): void {
  const skillIds = new Set(battleSkills.skills.map((skill) => skill.id));

  units.templates.forEach((template, templateIndex) => {
    for (const [skillIndex, skillId] of (template.battleSkills ?? []).entries()) {
      if (!skillIds.has(skillId)) {
        pushIssue(issues, {
          documentId: "units",
          path: `templates[${templateIndex}].battleSkills[${skillIndex}]`,
          code: "unknown_unit_battle_skill",
          message: `Unit template ${template.id} references missing battle skill ${skillId}.`,
          suggestion: "Use a skill from battle-skills.json or add the missing skill."
        });
      }
    }
  });
}

function validateBattleBalanceReferences(
  battleBalance: BattleBalanceConfig,
  battleSkills: BattleSkillCatalogConfig,
  issues: ContentPackValidationIssue[]
): void {
  if (!battleBalance.environment.trapGrantedStatusId) {
    return;
  }

  const statusIds = new Set(battleSkills.statuses.map((status) => status.id));
  if (!statusIds.has(battleBalance.environment.trapGrantedStatusId)) {
    pushIssue(issues, {
      documentId: "battleBalance",
      path: "environment.trapGrantedStatusId",
      code: "unknown_trap_status",
      message: `Battle balance references missing status ${battleBalance.environment.trapGrantedStatusId}.`,
      suggestion: "Use a status from battle-skills.json or add the missing status."
    });
  }
}

function buildSummary(issueCount: number): string {
  if (issueCount === 0) {
    return "Content-pack consistency passed across world, map objects, units, battle skills, and battle balance.";
  }

  return `Found ${issueCount} content-pack consistency issue(s) across the active config bundle.`;
}

export function validateContentPackConsistency(bundle: RuntimeConfigBundle): ContentPackValidationReport {
  const issues: ContentPackValidationIssue[] = [];
  const heroSkillIndex = buildHeroSkillIndex();

  validateWorldReferences(bundle.world, bundle.units, issues);
  bundle.world.heroes.forEach((hero, heroIndex) => {
    validateHeroProgression(hero, heroIndex, issues, heroSkillIndex);
    validateHeroEquipmentLoadout(hero, heroIndex, issues);
  });
  validateMapObjectReferences(bundle.world, bundle.mapObjects, bundle.units, issues);
  validateUnitSkillReferences(bundle.units, bundle.battleSkills, issues);
  if (bundle.battleBalance) {
    validateBattleBalanceReferences(bundle.battleBalance, bundle.battleSkills, issues);
  }

  return {
    schemaVersion: 1,
    valid: issues.length === 0,
    summary: buildSummary(issues.length),
    issueCount: issues.length,
    checkedDocuments: ["world", "mapObjects", "units", "battleSkills", "battleBalance"],
    issues
  };
}
