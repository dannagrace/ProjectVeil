import type {
  BattleBalanceConfig,
  BattleSkillCatalogConfig,
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

  mapObjects.neutralArmies.forEach((army, armyIndex) => {
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

  validateWorldReferences(bundle.world, bundle.units, issues);
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
