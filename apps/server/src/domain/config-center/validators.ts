import type { BattleBalanceConfig, BattleSkillCatalogConfig, MapObjectsConfig, UnitCatalogConfig, WorldGenerationConfig } from "@veil/shared/models";
import { type ContentPackValidationReport, getBattleBalanceConfig, getDefaultBattleBalanceConfig, getDefaultBattleSkillCatalog, getDefaultMapObjectsConfig, getDefaultUnitCatalog, getDefaultWorldConfig, type RuntimeConfigBundle, validateContentPackConsistency } from "@veil/shared/world";
import {
  parseLeaderboardTierThresholdsConfigDocument,
  validateLeaderboardTierThresholdsConfigDocument,
  type LeaderboardTierThresholdsConfigDocument
} from "@server/domain/social/leaderboard-tier-thresholds";
import type {
  ConfigCenterStore,
  ConfigDocumentId,
  ParsedConfigDocument,
  RuntimeConfigDocumentId,
  ValidationIssue,
  ValidationReport
} from "@server/domain/config-center/types";
import { RUNTIME_CONFIG_DOCUMENT_IDS } from "@server/domain/config-center/constants";
import {
  buildSummary,
  detectSyntaxLine,
  formatTimestamp,
  isRuntimeConfigDocumentId,
  normalizeJsonContent,
  positionKey,
  pushIssue
} from "@server/domain/config-center/helpers";
import { CONFIG_DOCUMENT_SCHEMAS, buildSchemaSummary, validateSchemaNode } from "@server/domain/config-center/schemas";
import { parseConfigDocument } from "@server/domain/config-center/preview";

export async function loadValidationDependencies(
  store: Pick<ConfigCenterStore, "loadDocument">,
  id: ConfigDocumentId,
  overrides: Partial<Record<ConfigDocumentId, string>> = {}
): Promise<{
  world: WorldGenerationConfig;
  mapObjects: MapObjectsConfig;
  units: UnitCatalogConfig;
  battleSkills: BattleSkillCatalogConfig;
  battleBalance: BattleBalanceConfig;
}> {
  const loadContent = async (docId: ConfigDocumentId): Promise<string | null> => {
    if (docId === id) {
      return null;
    }

    if (overrides[docId]) {
      return overrides[docId] ?? null;
    }

    const document = await store.loadDocument(docId);
    return document.content;
  };

  const [worldContent, mapObjectsContent, unitsContent, battleSkillsContent, battleBalanceContent] = await Promise.all([
    id === "world" ? Promise.resolve(null) : loadContent("world"),
    id === "mapObjects" ? Promise.resolve(null) : loadContent("mapObjects"),
    id === "units" ? Promise.resolve(null) : loadContent("units"),
    id === "battleSkills" ? Promise.resolve(null) : loadContent("battleSkills"),
    id === "battleBalance" ? Promise.resolve(null) : loadContent("battleBalance")
  ]);

  return {
    world:
      id === "world"
        ? getDefaultWorldConfig()
        : (parseConfigDocument(
            "world",
            worldContent ?? overrides.world ?? normalizeJsonContent(getDefaultWorldConfig())
          ) as WorldGenerationConfig),
    mapObjects:
      id === "mapObjects"
        ? getDefaultMapObjectsConfig()
        : (parseConfigDocument(
            "mapObjects",
            mapObjectsContent ?? overrides.mapObjects ?? normalizeJsonContent(getDefaultMapObjectsConfig())
          ) as MapObjectsConfig),
    units:
      id === "units"
        ? getDefaultUnitCatalog()
        : (parseConfigDocument("units", unitsContent ?? overrides.units ?? normalizeJsonContent(getDefaultUnitCatalog())) as UnitCatalogConfig),
    battleSkills:
      id === "battleSkills"
        ? getDefaultBattleSkillCatalog()
        : (parseConfigDocument(
            "battleSkills",
            battleSkillsContent ?? overrides.battleSkills ?? normalizeJsonContent(getDefaultBattleSkillCatalog())
          ) as BattleSkillCatalogConfig),
    battleBalance:
      id === "battleBalance"
        ? getDefaultBattleBalanceConfig()
        : (parseConfigDocument(
            "battleBalance",
            battleBalanceContent ?? overrides.battleBalance ?? normalizeJsonContent(getDefaultBattleBalanceConfig())
          ) as BattleBalanceConfig)
  };
}

export function buildValidationReportFromError(id: ConfigDocumentId, error: Error, content: string): ValidationReport {
  const schema = buildSchemaSummary(id);
  const line = detectSyntaxLine(error.message, content);
  return {
    valid: false,
    summary: "发现 1 个配置问题",
    issues: [
      {
        path: "$",
        severity: "error",
        message: error.message,
        suggestion: "修复后再保存，必要时参考右侧摘要与历史快照。",
        ...(line != null ? { line } : {})
      }
    ],
    schema,
    contentPack: {
      schemaVersion: 1,
      valid: false,
      summary: "Content-pack consistency was not evaluated because the current document could not be parsed.",
      issueCount: 0,
      checkedDocuments: [...RUNTIME_CONFIG_DOCUMENT_IDS],
      issues: []
    }
  };
}

export function summarizeIssues(issues: ValidationIssue[], contentPack: ContentPackValidationReport): string {
  if (issues.length === 0 && contentPack.issueCount === 0) {
    return "Schema 与内容包一致性校验通过，可以保存并立即生效。";
  }

  const parts: string[] = [];
  if (issues.length > 0) {
    parts.push(`${issues.length} 个当前文档问题`);
  }
  if (contentPack.issueCount > 0) {
    parts.push(`${contentPack.issueCount} 个内容包一致性问题`);
  }
  return `发现 ${parts.join("，")}，需要先修复再保存。`;
}

export function validateWorldConfigDetailed(config: WorldGenerationConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(config.width) || config.width <= 0) {
    pushIssue(issues, {
      path: "width",
      message: "地图宽度必须是正整数。",
      suggestion: "将 width 调整为大于 0 的整数。"
    });
  }
  if (!Number.isInteger(config.height) || config.height <= 0) {
    pushIssue(issues, {
      path: "height",
      message: "地图高度必须是正整数。",
      suggestion: "将 height 调整为大于 0 的整数。"
    });
  }
  if (!Array.isArray(config.heroes) || config.heroes.length === 0) {
    pushIssue(issues, {
      path: "heroes",
      message: "至少需要一个英雄出生点。",
      suggestion: "补充至少一个 hero 配置。"
    });
    return issues;
  }

  config.heroes.forEach((hero, index) => {
    if (hero.position.x < 0 || hero.position.x >= config.width) {
      pushIssue(issues, {
        path: `heroes[${index}].position.x`,
        message: `英雄 ${hero.id} 的 X 坐标越界。`,
        suggestion: `将 X 调整到 0-${Math.max(0, config.width - 1)} 之间。`
      });
    }
    if (hero.position.y < 0 || hero.position.y >= config.height) {
      pushIssue(issues, {
        path: `heroes[${index}].position.y`,
        message: `英雄 ${hero.id} 的 Y 坐标越界。`,
        suggestion: `将 Y 调整到 0-${Math.max(0, config.height - 1)} 之间。`
      });
    }
    if ((hero.progression?.level ?? 1) < 1) {
      pushIssue(issues, {
        path: `heroes[${index}].progression.level`,
        message: `英雄 ${hero.id} 等级不能小于 1。`,
        suggestion: "将 level 调整为 1 或更高。"
      });
    }
    if ((hero.progression?.experience ?? 0) < 0) {
      pushIssue(issues, {
        path: `heroes[${index}].progression.experience`,
        message: `英雄 ${hero.id} 经验值不能为负数。`,
        suggestion: "将 experience 调整为 0 或更高。"
      });
    }
  });

  return issues;
}

export function validateMapObjectsDetailed(
  config: MapObjectsConfig,
  world: WorldGenerationConfig,
  units: UnitCatalogConfig
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const unitTemplateIds = new Set(units.templates.map((template) => template.id));
  const usedPositions = new Set(world.heroes.map((hero) => positionKey(hero.position)));

  config.neutralArmies.forEach((army, index) => {
    if (army.position.x < 0 || army.position.x >= world.width || army.position.y < 0 || army.position.y >= world.height) {
      pushIssue(issues, {
        path: `neutralArmies[${index}].position`,
        message: `中立部队 ${army.id} 超出地图边界。`,
        suggestion: `将坐标调整到 0-${Math.max(0, world.width - 1)} / 0-${Math.max(0, world.height - 1)}。`
      });
    }
    usedPositions.add(positionKey(army.position));
  });

  config.guaranteedResources.forEach((resource, index) => {
    if (
      resource.position.x < 0 ||
      resource.position.x >= world.width ||
      resource.position.y < 0 ||
      resource.position.y >= world.height
    ) {
      pushIssue(issues, {
        path: `guaranteedResources[${index}].position`,
        message: "保底资源点超出地图边界。",
        suggestion: "将资源点放回地图范围内。"
      });
    }
    usedPositions.add(positionKey(resource.position));
  });

  config.buildings.forEach((building, index) => {
    if (!building.id.trim()) {
      pushIssue(issues, {
        path: `buildings[${index}].id`,
        message: "建筑 id 不能为空。",
        suggestion: "为建筑补充唯一 id。"
      });
    }
    if (
      building.position.x < 0 ||
      building.position.x >= world.width ||
      building.position.y < 0 ||
      building.position.y >= world.height
    ) {
      pushIssue(issues, {
        path: `buildings[${index}].position`,
        message: `建筑 ${building.id} 超出地图边界。`,
        suggestion: "调整建筑坐标到地图范围内。"
      });
    }
    const key = positionKey(building.position);
    if (usedPositions.has(key)) {
      pushIssue(issues, {
        path: `buildings[${index}].position`,
        message: `建筑 ${building.id} 与现有对象重叠。`,
        suggestion: "将建筑移动到未被英雄、中立或资源占用的位置。"
      });
    }
    usedPositions.add(key);

    if (building.kind === "recruitment_post" && !unitTemplateIds.has(building.unitTemplateId)) {
      pushIssue(issues, {
        path: `buildings[${index}].unitTemplateId`,
        message: `招募建筑 ${building.id} 引用了不存在的兵种模板。`,
        suggestion: "改为 units.json 中存在的 unitTemplateId。"
      });
    }
  });

  return issues;
}

export function validateUnitCatalogDetailed(
  config: UnitCatalogConfig,
  battleSkills: BattleSkillCatalogConfig
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const availableSkillIds = new Set(battleSkills.skills.map((skill) => skill.id));
  const seenIds = new Set<string>();

  if (!Array.isArray(config.templates) || config.templates.length === 0) {
    pushIssue(issues, {
      path: "templates",
      message: "兵种配置至少需要一个模板。",
      suggestion: "补充至少一个 templates 项。"
    });
    return issues;
  }

  config.templates.forEach((template, index) => {
    if (seenIds.has(template.id)) {
      pushIssue(issues, {
        path: `templates[${index}].id`,
        message: `兵种模板 id 重复: ${template.id}。`,
        suggestion: "为模板改成唯一 id。"
      });
    }
    seenIds.add(template.id);
    for (const skillId of template.battleSkills ?? []) {
      if (!availableSkillIds.has(skillId)) {
        pushIssue(issues, {
          path: `templates[${index}].battleSkills`,
          message: `兵种模板 ${template.id} 引用了不存在的技能 ${skillId}。`,
          suggestion: "移除无效技能，或先在技能配置中创建该技能。"
        });
      }
    }
  });

  return issues;
}

export function validateBattleSkillsDetailed(config: BattleSkillCatalogConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const statusIds = new Set<string>();
  const skillIds = new Set<string>();

  if (!Array.isArray(config.skills) || !Array.isArray(config.statuses)) {
    pushIssue(issues, {
      path: "$",
      message: "技能配置必须同时包含 skills 与 statuses 数组。",
      suggestion: "补齐这两个顶层数组。"
    });
    return issues;
  }

  config.statuses.forEach((status, index) => {
    if (statusIds.has(status.id)) {
      pushIssue(issues, {
        path: `statuses[${index}].id`,
        message: `状态 id 重复: ${status.id}。`,
        suggestion: "为状态改成唯一 id。"
      });
    }
    statusIds.add(status.id);
  });

  config.skills.forEach((skill, index) => {
    if (skillIds.has(skill.id)) {
      pushIssue(issues, {
        path: `skills[${index}].id`,
        message: `技能 id 重复: ${skill.id}。`,
        suggestion: "为技能改成唯一 id。"
      });
    }
    skillIds.add(skill.id);
    if (skill.kind === "passive" && skill.cooldown !== 0) {
      pushIssue(issues, {
        path: `skills[${index}].cooldown`,
        message: `被动技能 ${skill.id} 的冷却必须为 0。`,
        suggestion: "将 cooldown 设为 0。"
      });
    }
    if (skill.effects?.grantedStatusId && !statusIds.has(skill.effects.grantedStatusId)) {
      pushIssue(issues, {
        path: `skills[${index}].effects.grantedStatusId`,
        message: `技能 ${skill.id} 引用了不存在的自身状态。`,
        suggestion: "改为 statuses 中存在的状态 id。"
      });
    }
    if (skill.effects?.onHitStatusId && !statusIds.has(skill.effects.onHitStatusId)) {
      pushIssue(issues, {
        path: `skills[${index}].effects.onHitStatusId`,
        message: `技能 ${skill.id} 引用了不存在的命中状态。`,
        suggestion: "改为 statuses 中存在的状态 id。"
      });
    }
  });

  return issues;
}

export function validateBattleBalanceDetailed(
  config: BattleBalanceConfig,
  battleSkills: BattleSkillCatalogConfig
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const statusIds = new Set(battleSkills.statuses.map((status) => status.id));

  if (config.damage.minimumOffenseMultiplier > 1) {
    pushIssue(issues, {
      path: "damage.minimumOffenseMultiplier",
      message: "最低伤害倍率通常不应高于 1。",
      suggestion: "将 minimumOffenseMultiplier 调整到 0-1 区间内。"
    });
  }

  if (config.damage.varianceBase + config.damage.varianceRange <= 0) {
    pushIssue(issues, {
      path: "damage.varianceRange",
      message: "伤害波动上界必须大于 0。",
      suggestion: "提高 varianceBase 或 varianceRange，避免最终伤害倍率恒为非正数。"
    });
  }

  if (config.environment.blockerSpawnThreshold > 1) {
    pushIssue(issues, {
      path: "environment.blockerSpawnThreshold",
      message: "路障生成阈值必须在 0-1 之间。",
      suggestion: "将 blockerSpawnThreshold 调整到 0-1。"
    });
  }

  if (config.environment.trapSpawnThreshold > 1) {
    pushIssue(issues, {
      path: "environment.trapSpawnThreshold",
      message: "陷阱生成阈值必须在 0-1 之间。",
      suggestion: "将 trapSpawnThreshold 调整到 0-1。"
    });
  }

  if (
    config.environment.trapGrantedStatusId &&
    !statusIds.has(config.environment.trapGrantedStatusId)
  ) {
    pushIssue(issues, {
      path: "environment.trapGrantedStatusId",
      message: `陷阱附加状态 ${config.environment.trapGrantedStatusId} 不存在于 battle-skills.json。`,
      suggestion: "改为 statuses 中已有的状态 id，或先在技能配置里创建该状态。"
    });
  }

  return issues;
}

export function buildCandidateRuntimeBundle(
  id: RuntimeConfigDocumentId,
  parsed: ParsedConfigDocument,
  dependencies: {
    world: WorldGenerationConfig;
    mapObjects: MapObjectsConfig;
    units: UnitCatalogConfig;
    battleSkills: BattleSkillCatalogConfig;
    battleBalance: BattleBalanceConfig;
  }
): RuntimeConfigBundle {
  return {
    world: id === "world" ? (parsed as WorldGenerationConfig) : dependencies.world,
    mapObjects: id === "mapObjects" ? (parsed as MapObjectsConfig) : dependencies.mapObjects,
    units: id === "units" ? (parsed as UnitCatalogConfig) : dependencies.units,
    battleSkills: id === "battleSkills" ? (parsed as BattleSkillCatalogConfig) : dependencies.battleSkills,
    battleBalance: id === "battleBalance" ? (parsed as BattleBalanceConfig) : dependencies.battleBalance
  };
}

export function mapContentPackIssuesToValidationIssues(report: ContentPackValidationReport): ValidationIssue[] {
  return report.issues.map((issue) => ({
    documentId: issue.documentId,
    path: issue.path,
    severity: issue.severity,
    message: issue.message,
    suggestion: issue.suggestion
  }));
}

export async function validateDocumentDetailed(
  store: Pick<ConfigCenterStore, "loadDocument">,
  id: ConfigDocumentId,
  content: string,
  options: { overrides?: Partial<Record<ConfigDocumentId, string>> } = {}
): Promise<ValidationReport> {
  try {
    const parsed = JSON.parse(content) as ParsedConfigDocument;
    const issues: ValidationIssue[] = [];
  let contentPack: ContentPackValidationReport = {
      schemaVersion: 1,
      valid: true,
      summary: "Content-pack consistency checks are pending.",
      issueCount: 0,
      checkedDocuments: [...RUNTIME_CONFIG_DOCUMENT_IDS],
      issues: []
    };
    validateSchemaNode(parsed, CONFIG_DOCUMENT_SCHEMAS[id], "", issues);
    try {
      const dependencies = await loadValidationDependencies(store, id, options.overrides);
      const semanticIssues =
        id === "world"
          ? validateWorldConfigDetailed(parsed as WorldGenerationConfig)
          : id === "mapObjects"
            ? validateMapObjectsDetailed(
                parsed as MapObjectsConfig,
                dependencies.world,
                dependencies.units
              )
            : id === "units"
              ? validateUnitCatalogDetailed(
                  parsed as UnitCatalogConfig,
                  dependencies.battleSkills
                )
              : id === "battleSkills"
                ? validateBattleSkillsDetailed(parsed as BattleSkillCatalogConfig)
              : id === "battleBalance"
                ? validateBattleBalanceDetailed(
                    parsed as BattleBalanceConfig,
                    dependencies.battleSkills
                  )
                : id === "leaderboardTierThresholds"
                  ? validateLeaderboardTierThresholdsConfigDocument(
                      parsed as LeaderboardTierThresholdsConfigDocument
                    ).map((issue) => ({
                      path: issue.path,
                      severity: "error" as const,
                      message: issue.message,
                      suggestion: "调整排行榜段位阈值为连续且无重叠的区间。"
                    }))
                  : [];
      issues.push(...semanticIssues);
      if (isRuntimeConfigDocumentId(id)) {
        contentPack = validateContentPackConsistency(buildCandidateRuntimeBundle(id, parsed, dependencies));
      } else {
        contentPack = {
          schemaVersion: 1,
          valid: true,
          summary: "Content-pack consistency is not required for non-runtime config changes.",
          issueCount: 0,
          checkedDocuments: [...RUNTIME_CONFIG_DOCUMENT_IDS],
          issues: []
        };
      }
    } catch {
      // Schema issues above already explain malformed structures; skip dependent semantic checks.
    }

    try {
      parseConfigDocument(id, content);
    } catch (error) {
      if (error instanceof Error && !issues.some((issue) => issue.message === error.message)) {
        pushIssue(issues, {
          path: "$",
          message: error.message,
          suggestion: "根据提示修正配置后再保存。"
        });
      }
    }

    return {
      valid: issues.length === 0 && contentPack.valid,
      summary: summarizeIssues(issues, contentPack),
      issues,
      schema: buildSchemaSummary(id),
      contentPack
    };
  } catch (error) {
    return buildValidationReportFromError(id, error as Error, content);
  }
}
