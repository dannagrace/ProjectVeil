import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import * as XLSX from "xlsx";
import frontierBasinMapObjectsConfig from "../../../configs/phase1-map-objects-frontier-basin.json";
import frontierBasinWorldConfig from "../../../configs/phase1-world-frontier-basin.json";
import stonewatchForkMapObjectsConfig from "../../../configs/phase1-map-objects-stonewatch-fork.json";
import stonewatchForkWorldConfig from "../../../configs/phase1-world-stonewatch-fork.json";
import ridgewayCrossingMapObjectsConfig from "../../../configs/phase1-map-objects-ridgeway-crossing.json";
import ridgewayCrossingWorldConfig from "../../../configs/phase1-world-ridgeway-crossing.json";
import contestedBasinMapObjectsConfig from "../../../configs/phase2-map-objects-contested-basin.json";
import contestedBasinWorldConfig from "../../../configs/phase2-contested-basin.json";
import {
  getBattleBalanceConfig,
  createWorldStateFromConfigs,
  validateContentPackConsistency,
  getDefaultBattleBalanceConfig,
  getDefaultBattleSkillCatalog,
  getDefaultMapObjectsConfig,
  getDefaultUnitCatalog,
  getDefaultWorldConfig,
  replaceRuntimeConfigs,
  validateBattleBalanceConfig,
  validateBattleSkillCatalog,
  validateMapObjectsConfig,
  validateUnitCatalog,
  validateWorldConfig,
  type ContentPackValidationReport,
  type BattleBalanceConfig,
  type BattleSkillCatalogConfig,
  type MapObjectsConfig,
  type ResourceKind,
  type RuntimeConfigBundle,
  type TerrainType,
  type UnitCatalogConfig,
  type WorldGenerationConfig
} from "../../../packages/shared/src/index";
import {
  MYSQL_CONFIG_DOCUMENT_TABLE,
  MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX,
  type MySqlPersistenceConfig,
  readMySqlPersistenceConfig
} from "./persistence";

export type ConfigDocumentId = "world" | "mapObjects" | "units" | "battleSkills" | "battleBalance";

interface ConfigDefinition {
  id: ConfigDocumentId;
  fileName: string;
  title: string;
  description: string;
}

type ParsedConfigDocument =
  | WorldGenerationConfig
  | MapObjectsConfig
  | UnitCatalogConfig
  | BattleSkillCatalogConfig
  | BattleBalanceConfig;

interface ErrorPayload {
  code: string;
  message: string;
}

interface MySqlConfigDocumentRow extends RowDataPacket {
  document_id: string;
  content_json: string;
  version: number;
  exported_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ConfigDocumentSummary {
  id: ConfigDocumentId;
  title: string;
  description: string;
  fileName: string;
  updatedAt: string;
  summary: string;
  storage: "filesystem" | "mysql";
  version?: number;
  exportedAt?: string | null;
}

export interface ConfigDocument extends ConfigDocumentSummary {
  content: string;
}

export interface ValidationIssue {
  documentId?: ConfigDocumentId;
  path: string;
  severity: "error" | "warning";
  message: string;
  suggestion: string;
  line?: number;
}

export interface ValidationReport {
  valid: boolean;
  summary: string;
  issues: ValidationIssue[];
  schema: ConfigSchemaSummary;
  contentPack: ContentPackValidationReport;
}

export interface ConfigSchemaSummary {
  id: string;
  title: string;
  version: string;
  description: string;
  required: string[];
}

export interface ConfigSnapshotSummary {
  id: string;
  label: string;
  createdAt: string;
  version: number;
}

export type ConfigDiffChangeKind = "value" | "field_added" | "field_removed" | "type_changed" | "enum_changed";

export interface ConfigDiffEntry {
  path: string;
  change: "added" | "removed" | "updated";
  previousValue: string;
  nextValue: string;
  kind: ConfigDiffChangeKind;
  required: boolean;
  fieldType: string;
  description: string;
  blastRadius: string[];
}

export interface ConfigDiff {
  entries: ConfigDiffEntry[];
}

export type ConfigImpactRiskLevel = "low" | "medium" | "high";

export interface ConfigImpactSummary {
  documentId: ConfigDocumentId;
  title: string;
  summary: string;
  riskLevel: ConfigImpactRiskLevel;
  changedFields: string[];
  impactedModules: string[];
  riskHints: string[];
  suggestedValidationActions: string[];
}

export interface ConfigPresetSummary {
  id: string;
  name: string;
  kind: "builtin" | "custom";
  updatedAt: string;
  description: string;
}

export interface ConfigPublishHistoryEntry {
  id: string;
  documentId: ConfigDocumentId;
  author: string;
  summary: string;
  publishedAt: string;
  fromVersion: number;
  toVersion: number;
  changeCount: number;
  structuralChangeCount: number;
}

export type ConfigPublishResultStatus = "applied" | "failed";
export type ConfigPublishChangeRuntimeStatus = "applied" | "failed" | "pending";

export interface ConfigPublishAuditChange {
  documentId: ConfigDocumentId;
  title: string;
  fromVersion: number;
  toVersion: number;
  changeCount: number;
  structuralChangeCount: number;
  snapshotId: string | null;
  runtimeStatus: ConfigPublishChangeRuntimeStatus;
  runtimeMessage: string;
  diffSummary: ConfigDiffEntry[];
  impactSummary: ConfigImpactSummary | null;
}

export interface ConfigPublishAuditEvent {
  id: string;
  author: string;
  summary: string;
  publishedAt: string;
  resultStatus: ConfigPublishResultStatus;
  resultMessage: string;
  changes: ConfigPublishAuditChange[];
}

export interface ConfigPublishChangeSummary {
  documentId: ConfigDocumentId;
  title: string;
  fromVersion: number;
  toVersion: number;
  changeCount: number;
  structuralChangeCount: number;
}

export interface ConfigPublishEventSummary {
  id: string;
  author: string;
  summary: string;
  publishedAt: string;
  changes: ConfigPublishChangeSummary[];
}

export interface ConfigStageDocumentInput {
  id: ConfigDocumentId;
  content: string;
}

export interface ConfigStageDocumentSummary {
  id: ConfigDocumentId;
  title: string;
  fileName: string;
  content: string;
  updatedAt: string;
  validation: ValidationReport;
}

export interface ConfigStageState {
  id: string;
  createdAt: string;
  updatedAt: string;
  documents: ConfigStageDocumentSummary[];
  valid: boolean;
}

export interface WorldConfigPreviewTile {
  position: {
    x: number;
    y: number;
  };
  terrain: TerrainType;
  walkable: boolean;
  resource?:
    | {
        kind: ResourceKind;
        amount: number;
        source: "random" | "guaranteed";
      }
    | undefined;
  occupant?:
    | {
        kind: "hero" | "neutral";
        refId: string;
        label: string;
        playerId?: string;
      }
    | undefined;
  building?:
    | {
        kind: "recruitment_post";
        refId: string;
        label: string;
        unitTemplateId: string;
        availableCount: number;
      }
    | {
        kind: "attribute_shrine";
        refId: string;
        label: string;
        bonus: {
          attack: number;
          defense: number;
          power: number;
          knowledge: number;
        };
        lastUsedDay?: number;
      }
    | {
        kind: "resource_mine";
        refId: string;
        label: string;
        resourceKind: ResourceKind;
        income: number;
        lastHarvestDay?: number;
      }
    | {
        kind: "watchtower";
        refId: string;
        label: string;
        visionBonus: number;
        lastUsedDay?: number;
      }
    | undefined;
}

export interface WorldConfigPreview {
  seed: number;
  roomId: string;
  width: number;
  height: number;
  counts: {
    walkable: number;
    blocked: number;
    terrain: Record<TerrainType, number>;
    resourceTiles: Record<ResourceKind, number>;
    resourceAmounts: Record<ResourceKind, number>;
    guaranteedResources: number;
    randomResources: number;
    heroes: number;
    neutralArmies: number;
    buildings: number;
  };
  tiles: WorldConfigPreviewTile[];
}

export interface ConfigCenterStore {
  initializeRuntimeConfigs(): Promise<void>;
  listDocuments(): Promise<ConfigDocumentSummary[]>;
  loadDocument(id: ConfigDocumentId): Promise<ConfigDocument>;
  saveDocument(id: ConfigDocumentId, content: string): Promise<ConfigDocument>;
  validateDocument(id: ConfigDocumentId, content: string): Promise<ValidationReport>;
  listSnapshots(id: ConfigDocumentId): Promise<ConfigSnapshotSummary[]>;
  createSnapshot(id: ConfigDocumentId, content: string, label?: string): Promise<ConfigSnapshotSummary>;
  rollbackToSnapshot(id: ConfigDocumentId, snapshotId: string): Promise<ConfigDocument>;
  diffWithSnapshot(id: ConfigDocumentId, snapshotId: string): Promise<ConfigDiff>;
  listPublishHistory(id: ConfigDocumentId): Promise<ConfigPublishHistoryEntry[]>;
  listPublishAuditHistory(): Promise<ConfigPublishAuditEvent[]>;
  listPresets(id: ConfigDocumentId): Promise<ConfigPresetSummary[]>;
  savePreset(id: ConfigDocumentId, name: string, content: string): Promise<ConfigPresetSummary>;
  applyPreset(id: ConfigDocumentId, presetId: string): Promise<ConfigDocument>;
  exportDocument(id: ConfigDocumentId, format: "xlsx" | "jsonc" | "csv"): Promise<{
    fileName: string;
    contentType: string;
    body: Buffer;
    exportedAt: string;
  }>;
  importDocumentFromWorkbook(id: ConfigDocumentId, workbook: Buffer): Promise<ConfigDocument>;
  getStagedDraft(): Promise<ConfigStageState | null>;
  saveStagedDraft(documents: ConfigStageDocumentInput[]): Promise<ConfigStageState | null>;
  publishStagedDraft(metadata: { author: string; summary: string }): Promise<{
    stage: ConfigStageState | null;
    publish: ConfigPublishEventSummary;
  }>;
  close(): Promise<void>;
  readonly mode: "filesystem" | "mysql";
}

const CONFIG_DEFINITIONS: ConfigDefinition[] = [
  {
    id: "world",
    fileName: "phase1-world.json",
    title: "世界配置",
    description: "地图尺寸、初始英雄、资源生成概率。"
  },
  {
    id: "mapObjects",
    fileName: "phase1-map-objects.json",
    title: "地图物件",
    description: "中立怪、保底资源点与地图交互物件。"
  },
  {
    id: "units",
    fileName: "units.json",
    title: "兵种配置",
    description: "兵种模板、阵营、品质和战斗数值。"
  },
  {
    id: "battleSkills",
    fileName: "battle-skills.json",
    title: "技能配置",
    description: "战斗技能、持续状态与效果公式。"
  },
  {
    id: "battleBalance",
    fileName: "battle-balance.json",
    title: "战斗平衡",
    description: "伤害公式、战场环境和 PVP ELO 参数。"
  }
];

interface ConfigSnapshotRecord {
  id: string;
  label: string;
  createdAt: string;
  version: number;
  content: string;
}

interface ConfigPresetRecord {
  id: string;
  name: string;
  updatedAt: string;
  description: string;
  content: string;
}

interface ConfigStageDocumentRecord {
  id: ConfigDocumentId;
  content: string;
  validation: ValidationReport;
  updatedAt: string;
}

interface ConfigStageRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  documents: ConfigStageDocumentRecord[];
}

interface ConfigCenterLibraryState {
  filesystemVersions: Partial<Record<ConfigDocumentId, number>>;
  filesystemExports: Partial<Record<ConfigDocumentId, string>>;
  snapshots: Partial<Record<ConfigDocumentId, ConfigSnapshotRecord[]>>;
  presets: Partial<Record<ConfigDocumentId, ConfigPresetRecord[]>>;
  stagedDraft: ConfigStageRecord | null;
  publishHistory: Partial<Record<ConfigDocumentId, ConfigPublishHistoryEntry[]>>;
  publishAuditHistory: ConfigPublishAuditEvent[];
}

interface FlattenedConfigEntry {
  path: string;
  type: string;
  displayValue: string;
  jsonValue: string;
  description?: string;
}

interface JsonSchemaNode {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: string[];
  minimum?: number;
  minItems?: number;
}

const CONFIG_CENTER_LIBRARY_FILE = ".config-center-library.json";
const MAX_STAGE_DOCUMENTS = 5;
const MAX_PUBLISH_HISTORY_ENTRIES = 20;
const BUILTIN_DIFFICULTY_PRESET_IDS = ["easy", "normal", "hard"] as const;
const BUILTIN_WORLD_LAYOUT_PRESETS = [
  "layout_phase1",
  "layout_frontier_basin",
  "layout_stonewatch_fork",
  "layout_ridgeway_crossing",
  "layout_contested_basin"
] as const;
const BUILTIN_MAP_OBJECT_LAYOUT_PRESETS = [
  "layout_phase1",
  "layout_frontier_basin",
  "layout_stonewatch_fork",
  "layout_ridgeway_crossing",
  "layout_contested_basin"
] as const;
const CONFIG_SCHEMA_VERSION = "2026-03-26";
const BASE_VALUE_IMPACT = ["配置台编辑器"];
const BASE_SCHEMA_IMPACT = ["配置台编辑器", "Schema 校验器"];
const CONFIG_RUNTIME_IMPACT: Record<ConfigDocumentId, string[]> = {
  world: ["世界预览", "地图生成器", "房间校验器"],
  mapObjects: ["地图对象编辑器", "世界预览"],
  units: ["战斗模拟器", "招募面板"],
  battleSkills: ["技能编辑器", "战斗模拟器"],
  battleBalance: ["战斗平衡计算", "PVP 匹配"]
};
const CONFIG_IMPACT_RULES: Record<
  ConfigDocumentId,
  {
    defaultRisk: ConfigImpactRiskLevel;
    impactedModules: string[];
    suggestedValidationActions: string[];
  }
> = {
  world: {
    defaultRisk: "high",
    impactedModules: ["地图生成", "英雄出生点", "资源分布"],
    suggestedValidationActions: ["config-center 地图预览", "房间建图 smoke"]
  },
  mapObjects: {
    defaultRisk: "medium",
    impactedModules: ["地图 POI", "招募库存", "资源矿收益"],
    suggestedValidationActions: ["config-center 地图预览", "建筑/守军布局检查"]
  },
  units: {
    defaultRisk: "medium",
    impactedModules: ["单位数值", "招募库存", "战斗节奏"],
    suggestedValidationActions: ["content-pack 一致性校验", "战斗公式回归"]
  },
  battleSkills: {
    defaultRisk: "high",
    impactedModules: ["战斗技能", "状态效果", "伤害结算"],
    suggestedValidationActions: ["content-pack 一致性校验", "技能链路回归"]
  },
  battleBalance: {
    defaultRisk: "high",
    impactedModules: ["战斗公式", "环境机关", "PVP ELO"],
    suggestedValidationActions: ["战斗公式回归", "PVP 结算检查"]
  }
};

const CONFIG_DOCUMENT_SCHEMAS: Record<ConfigDocumentId, JsonSchemaNode> = {
  world: {
    type: "object",
    title: "World Config",
    description: "世界生成配置，包含地图尺寸、英雄出生点和随机资源概率。",
    required: ["width", "height", "heroes", "resourceSpawn"],
    properties: {
      width: { type: "integer", minimum: 1, description: "地图宽度，单位为格子。" },
      height: { type: "integer", minimum: 1, description: "地图高度，单位为格子。" },
      heroes: {
        type: "array",
        minItems: 1,
        description: "初始英雄列表。",
        items: {
          type: "object",
          required: ["id", "playerId", "name", "position", "vision", "move", "stats", "progression", "armyTemplateId", "armyCount"],
          properties: {
            id: { type: "string", description: "英雄唯一 id。" },
            playerId: { type: "string", description: "所属玩家 id。" },
            name: { type: "string", description: "英雄显示名。" },
            position: {
              type: "object",
              required: ["x", "y"],
              properties: {
                x: { type: "integer", minimum: 0, description: "英雄初始 X 坐标。" },
                y: { type: "integer", minimum: 0, description: "英雄初始 Y 坐标。" }
              }
            },
            vision: { type: "integer", minimum: 0, description: "初始视野范围。" },
            move: {
              type: "object",
              required: ["total", "remaining"],
              properties: {
                total: { type: "integer", minimum: 1, description: "每日总移动力。" },
                remaining: { type: "integer", minimum: 0, description: "当前剩余移动力。" }
              }
            },
            stats: {
              type: "object",
              required: ["attack", "defense", "power", "knowledge", "hp", "maxHp"],
              properties: {
                attack: { type: "integer", minimum: 0, description: "攻击属性。" },
                defense: { type: "integer", minimum: 0, description: "防御属性。" },
                power: { type: "integer", minimum: 0, description: "力量属性。" },
                knowledge: { type: "integer", minimum: 0, description: "知识属性。" },
                hp: { type: "integer", minimum: 1, description: "当前生命值。" },
                maxHp: { type: "integer", minimum: 1, description: "最大生命值。" }
              }
            },
            progression: {
              type: "object",
              required: ["level", "experience", "battlesWon", "neutralBattlesWon", "pvpBattlesWon"],
              properties: {
                level: { type: "integer", minimum: 1, description: "英雄等级。" },
                experience: { type: "integer", minimum: 0, description: "累计经验值。" },
                battlesWon: { type: "integer", minimum: 0, description: "总胜场。" },
                neutralBattlesWon: { type: "integer", minimum: 0, description: "PVE 胜场。" },
                pvpBattlesWon: { type: "integer", minimum: 0, description: "PVP 胜场。" }
              }
            },
            armyTemplateId: { type: "string", description: "初始携带兵种模板 id。" },
            armyCount: { type: "integer", minimum: 1, description: "初始部队数量。" }
          }
        }
      },
      resourceSpawn: {
        type: "object",
        description: "随机资源生成概率。",
        required: ["goldChance", "woodChance", "oreChance"],
        properties: {
          goldChance: { type: "number", minimum: 0, description: "金币资源点生成概率。" },
          woodChance: { type: "number", minimum: 0, description: "木材资源点生成概率。" },
          oreChance: { type: "number", minimum: 0, description: "矿石资源点生成概率。" }
        }
      }
    }
  },
  mapObjects: {
    type: "object",
    title: "Map Objects Config",
    description: "地图物件配置，包含中立怪、保底资源和建筑。",
    required: ["neutralArmies", "guaranteedResources", "buildings"],
    properties: {
      neutralArmies: {
        type: "array",
        description: "中立军队布置。",
        items: {
          type: "object",
          required: ["id", "position", "stacks"],
          properties: {
            id: { type: "string", description: "中立军队 id。" },
            position: {
              type: "object",
              required: ["x", "y"],
              properties: {
                x: { type: "integer", minimum: 0, description: "X 坐标。" },
                y: { type: "integer", minimum: 0, description: "Y 坐标。" }
              }
            },
            stacks: {
              type: "array",
              minItems: 1,
              description: "守军兵堆。",
              items: {
                type: "object",
                required: ["templateId", "count"],
                properties: {
                  templateId: { type: "string", description: "兵种模板 id。" },
                  count: { type: "integer", minimum: 1, description: "该兵堆数量。" }
                }
              }
            }
          }
        }
      },
      guaranteedResources: {
        type: "array",
        description: "保底资源点。",
        items: {
          type: "object",
          required: ["position", "resource"],
          properties: {
            position: {
              type: "object",
              required: ["x", "y"],
              properties: {
                x: { type: "integer", minimum: 0, description: "X 坐标。" },
                y: { type: "integer", minimum: 0, description: "Y 坐标。" }
              }
            },
            resource: {
              type: "object",
              required: ["kind", "amount"],
              properties: {
                kind: { type: "string", enum: ["gold", "wood", "ore"], description: "资源类型。" },
                amount: { type: "integer", minimum: 1, description: "资源数量。" }
              }
            }
          }
        }
      },
      buildings: {
        type: "array",
        description: "地图建筑配置。",
        items: {
          type: "object",
          required: ["id", "kind", "position", "label"],
          properties: {
            id: { type: "string", description: "建筑 id。" },
            kind: { type: "string", enum: ["recruitment_post", "attribute_shrine", "resource_mine", "watchtower"], description: "建筑种类。" },
            label: { type: "string", description: "建筑显示名。" },
            position: {
              type: "object",
              required: ["x", "y"],
              properties: {
                x: { type: "integer", minimum: 0, description: "X 坐标。" },
                y: { type: "integer", minimum: 0, description: "Y 坐标。" }
              }
            },
            unitTemplateId: { type: "string", description: "招募建筑使用的兵种模板 id。" },
            recruitCount: { type: "integer", minimum: 1, description: "招募建筑每次提供的兵力数量。" },
            cost: { type: "object", description: "招募建筑的资源消耗。" },
            bonus: { type: "object", description: "属性神殿提供的永久属性加成。" },
            resourceKind: { type: "string", enum: ["gold", "wood", "ore"], description: "资源矿场的产出类型。" },
            income: { type: "integer", minimum: 1, description: "资源矿场的每日产出。" },
            visionBonus: { type: "integer", minimum: 1, description: "瞭望塔提供的永久视野加成。" }
          }
        }
      }
    }
  },
  units: {
    type: "object",
    title: "Units Config",
    description: "兵种模板配置，用于世界生成、招募和战斗数值。",
    required: ["templates"],
    properties: {
      templates: {
        type: "array",
        minItems: 1,
        description: "兵种模板列表。",
        items: {
          type: "object",
          required: ["id", "stackName", "faction", "rarity", "initiative", "attack", "defense", "minDamage", "maxDamage", "maxHp"],
          properties: {
            id: { type: "string", description: "兵种模板 id。" },
            stackName: { type: "string", description: "堆叠显示名。" },
            faction: { type: "string", description: "阵营。" },
            rarity: { type: "string", description: "品质。" },
            initiative: { type: "integer", minimum: 1, description: "先攻值。" },
            attack: { type: "integer", minimum: 1, description: "攻击值。" },
            defense: { type: "integer", minimum: 1, description: "防御值。" },
            minDamage: { type: "integer", minimum: 1, description: "最小伤害。" },
            maxDamage: { type: "integer", minimum: 1, description: "最大伤害。" },
            maxHp: { type: "integer", minimum: 1, description: "最大生命值。" },
            battleSkills: {
              type: "array",
              description: "技能 id 列表。",
              items: { type: "string", description: "技能 id。" }
            }
          }
        }
      }
    }
  },
  battleSkills: {
    type: "object",
    title: "Battle Skills Config",
    description: "战斗技能和持续状态配置。",
    required: ["skills", "statuses"],
    properties: {
      skills: {
        type: "array",
        description: "技能列表。",
        items: {
          type: "object",
          required: ["id", "name", "description", "kind", "target", "cooldown"],
          properties: {
            id: { type: "string", description: "技能 id。" },
            name: { type: "string", description: "技能名称。" },
            description: { type: "string", description: "技能描述。" },
            kind: { type: "string", enum: ["active", "passive"], description: "技能种类。" },
            target: { type: "string", enum: ["enemy", "self"], description: "技能目标。" },
            cooldown: { type: "integer", minimum: 0, description: "冷却回合。" },
            effects: {
              type: "object",
              description: "技能效果集合。",
              properties: {
                damageMultiplier: { type: "number", minimum: 0, description: "伤害倍率。" },
                allowRetaliation: { type: "boolean", description: "是否允许反击。" },
                grantedStatusId: { type: "string", description: "施加给自身的状态 id。" },
                onHitStatusId: { type: "string", description: "命中附加的状态 id。" }
              }
            }
          }
        }
      },
      statuses: {
        type: "array",
        description: "状态列表。",
        items: {
          type: "object",
          required: ["id", "name", "description", "duration", "attackModifier", "defenseModifier", "damagePerTurn"],
          properties: {
            id: { type: "string", description: "状态 id。" },
            name: { type: "string", description: "状态名称。" },
            description: { type: "string", description: "状态描述。" },
            duration: { type: "integer", minimum: 1, description: "持续回合。" },
            attackModifier: { type: "integer", description: "攻击修正。" },
            defenseModifier: { type: "integer", description: "防御修正。" },
            damagePerTurn: { type: "integer", minimum: 0, description: "每回合伤害。" }
          }
        }
      }
    }
  },
  battleBalance: {
    type: "object",
    title: "Battle Balance Config",
    description: "战斗公式、环境生成阈值和 PVP 参数。",
    required: ["damage", "environment", "pvp"],
    properties: {
      damage: {
        type: "object",
        description: "伤害公式参数。",
        required: [
          "defendingDefenseBonus",
          "offenseAdvantageStep",
          "minimumOffenseMultiplier",
          "varianceBase",
          "varianceRange"
        ],
        properties: {
          defendingDefenseBonus: { type: "number", description: "防守指令提供的额外防御值。" },
          offenseAdvantageStep: { type: "number", description: "攻防差每点带来的伤害修正步进。" },
          minimumOffenseMultiplier: { type: "number", minimum: 0.01, description: "伤害倍率下限。" },
          varianceBase: { type: "number", minimum: 0.01, description: "伤害波动基础值。" },
          varianceRange: { type: "number", minimum: 0, description: "伤害波动区间。" }
        }
      },
      environment: {
        type: "object",
        description: "遭遇战环境生成参数。",
        required: [
          "blockerSpawnThreshold",
          "blockerDurability",
          "trapSpawnThreshold",
          "trapDamage",
          "trapCharges"
        ],
        properties: {
          blockerSpawnThreshold: { type: "number", minimum: 0, description: "路障生成阈值，范围 0-1。" },
          blockerDurability: { type: "integer", minimum: 1, description: "路障耐久。" },
          trapSpawnThreshold: { type: "number", minimum: 0, description: "陷阱生成阈值，范围 0-1。" },
          trapDamage: { type: "integer", minimum: 0, description: "伤害型陷阱的基础伤害。" },
          trapCharges: { type: "integer", minimum: 1, description: "陷阱可触发次数。" },
          trapGrantedStatusId: { type: "string", description: "伤害型陷阱附加的状态 id，可选。" }
        }
      },
      pvp: {
        type: "object",
        description: "PVP 匹配与结算参数。",
        required: ["eloK"],
        properties: {
          eloK: { type: "integer", minimum: 1, description: "ELO K 因子。" }
        }
      }
    }
  }
};

function createEmptyLibraryState(): ConfigCenterLibraryState {
  return {
    filesystemVersions: {},
    filesystemExports: {},
    snapshots: {},
    presets: {},
    stagedDraft: null,
    publishHistory: {},
    publishAuditHistory: []
  };
}

function buildAutomaticSnapshotLabel(title: string, version: number): string {
  return `${title} 自动保存 v${version}`;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function detectSyntaxLine(errorMessage: string, content: string): number | undefined {
  const match = errorMessage.match(/position\s+(\d+)/i);
  const position = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(position)) {
    return undefined;
  }

  return content.slice(0, position).split("\n").length;
}

function pushIssue(
  issues: ValidationIssue[],
  issue: Omit<ValidationIssue, "severity"> & { severity?: "error" | "warning" }
): void {
  issues.push({
    severity: issue.severity ?? "error",
    ...issue
  });
}

function parseJsonPath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const normalized = path.replace(/\[(\d+)\]/g, ".$1");
  for (const part of normalized.split(".")) {
    if (!part) {
      continue;
    }

    const maybeIndex = Number(part);
    segments.push(Number.isInteger(maybeIndex) && `${maybeIndex}` === part ? maybeIndex : part);
  }

  return segments;
}

function setValueAtPath(target: unknown, path: string, value: unknown): unknown {
  const segments = parseJsonPath(path);
  if (segments.length === 0) {
    return value;
  }

  let cursor = target as Record<string, unknown> | unknown[];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment == null) {
      throw new Error(`Invalid import path: ${path}`);
    }
    const isLast = index === segments.length - 1;
    const nextSegment = segments[index + 1];

    if (typeof segment === "number") {
      if (!Array.isArray(cursor)) {
        throw new Error(`Expected array while importing path ${path}`);
      }

      if (isLast) {
        cursor[segment] = value;
        continue;
      }

      if (cursor[segment] == null) {
        cursor[segment] = typeof nextSegment === "number" ? [] : {};
      }

      cursor = cursor[segment] as Record<string, unknown> | unknown[];
      continue;
    }

    if (Array.isArray(cursor)) {
      throw new Error(`Unexpected object segment while importing path ${path}`);
    }

    if (isLast) {
      cursor[segment] = value;
      continue;
    }

    if (cursor[segment] == null) {
      cursor[segment] = typeof nextSegment === "number" ? [] : {};
    }

    cursor = cursor[segment] as Record<string, unknown> | unknown[];
  }

  return target;
}

function flattenConfigValue(value: unknown, path = ""): FlattenedConfigEntry[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [
        {
          path,
          type: "array",
          displayValue: "[]",
          jsonValue: "[]"
        }
      ];
    }

    return value.flatMap((item, index) => flattenConfigValue(item, `${path}[${index}]`));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [
        {
          path,
          type: "object",
          displayValue: "{}",
          jsonValue: "{}"
        }
      ];
    }

    return entries.flatMap(([key, nested]) => flattenConfigValue(nested, path ? `${path}.${key}` : key));
  }

  return [
    {
      path,
      type: value === null ? "null" : typeof value,
      displayValue: value == null ? "null" : typeof value === "string" ? value : JSON.stringify(value),
      jsonValue: JSON.stringify(value)
    }
  ];
}

function isSchemaPathRequired(schema: JsonSchemaNode, path: string): boolean {
  if (!path) {
    return false;
  }

  const segments = parseJsonPath(path);
  let current: JsonSchemaNode | undefined = schema;
  let required = false;

  for (const segment of segments) {
    if (!current) {
      return false;
    }

    if (typeof segment === "number") {
      current = current.items;
      required = false;
      continue;
    }

    required = Boolean(current.required?.includes(segment));
    current = current.properties?.[segment];
  }

  return required;
}

function classifyDiffKind(
  previousEntry: FlattenedConfigEntry | undefined,
  nextEntry: FlattenedConfigEntry | undefined,
  schemaNode: JsonSchemaNode | undefined
): ConfigDiffChangeKind {
  if (!previousEntry && nextEntry) {
    return "field_added";
  }
  if (previousEntry && !nextEntry) {
    return "field_removed";
  }
  if (previousEntry && nextEntry && previousEntry.type !== nextEntry.type) {
    return "type_changed";
  }
  if (
    schemaNode?.enum &&
    previousEntry &&
    nextEntry &&
    previousEntry.jsonValue !== nextEntry.jsonValue
  ) {
    return "enum_changed";
  }
  return "value";
}

function buildBlastRadius(id: ConfigDocumentId, kind: ConfigDiffChangeKind): string[] {
  const base = kind === "value" ? BASE_VALUE_IMPACT : BASE_SCHEMA_IMPACT;
  const scoped = kind === "value" ? [] : CONFIG_RUNTIME_IMPACT[id] ?? [];
  return Array.from(new Set([...base, ...scoped]));
}

function uniqueStrings(items: Iterable<string>): string[] {
  return Array.from(
    new Set(
      [...items]
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
}

function buildConfigImpactSummary(
  id: ConfigDocumentId,
  title: string,
  diffEntries: ConfigDiffEntry[]
): ConfigImpactSummary | null {
  if (diffEntries.length === 0) {
    return null;
  }

  const rule = CONFIG_IMPACT_RULES[id];
  const changedFields = uniqueStrings(diffEntries.map((entry) => entry.path)).slice(0, 4);
  const impactedModules = uniqueStrings([
    ...rule.impactedModules,
    ...diffEntries.flatMap((entry) => entry.blastRadius),
    ...(CONFIG_RUNTIME_IMPACT[id] ?? [])
  ]);
  const structuralCount = diffEntries.filter((entry) => entry.kind !== "value").length;
  let riskLevel = rule.defaultRisk;

  if (id === "mapObjects") {
    const highSignal = changedFields.some((entry) =>
      /(buildings|neutralArmies|guaranteedResources|reward|recruitCount|income|unitTemplateId)/.test(entry)
    );
    if (highSignal || structuralCount > 0 || diffEntries.length >= 8) {
      riskLevel = "high";
    }
  } else if (id === "units") {
    const highSignal = changedFields.some((entry) =>
      /(attack|defense|minDamage|maxDamage|maxHp|initiative|skills|templateId)/.test(entry)
    );
    if (highSignal || structuralCount > 0 || diffEntries.length >= 10) {
      riskLevel = "high";
    }
  }

  const riskHints = uniqueStrings([
    structuralCount > 0 ? `包含 ${structuralCount} 项结构变更，需留意 Schema/运行时兼容性。` : "",
    riskLevel === "high" ? "命中高敏感配置域，建议在发布前补一次联动回归。" : "",
    changedFields.some((entry) => /(width|height|heroes|resourceSpawn)/.test(entry))
      ? "世界生成参数已变更，地图尺寸、出生点或资源刷率可能一起波动。"
      : "",
    changedFields.some((entry) => /(neutralArmies|buildings|guaranteedResources)/.test(entry))
      ? "地图对象已调整，守军、建筑或资源点分布可能改变探索与招募节奏。"
      : "",
    changedFields.some((entry) => /(attack|defense|minDamage|maxDamage|maxHp|initiative)/.test(entry))
      ? "单位面板已调整，战斗节奏和招募价值可能出现连锁变化。"
      : "",
    changedFields.some((entry) => /(cooldown|damageMultiplier|grantedStatusId|onHitStatusId|statuses)/.test(entry))
      ? "技能或状态参数已调整，技能链和状态覆盖率需要重点复核。"
      : "",
    changedFields.some((entry) => /(damage|environment|eloK|trap|blocker)/.test(entry))
      ? "战斗公式或环境机关已调整，伤害结算与 PVP 评分可能漂移。"
      : ""
  ]);

  return {
    documentId: id,
    title,
    summary:
      structuralCount > 0
        ? `${diffEntries.length} 项字段变更，其中 ${structuralCount} 项为结构风险。`
        : `${diffEntries.length} 项字段变更，主要关注 ${changedFields.join(", ")}。`,
    riskLevel,
    changedFields,
    impactedModules,
    riskHints,
    suggestedValidationActions: [...rule.suggestedValidationActions]
  };
}

function buildConfigDiffEntries(
  id: ConfigDocumentId,
  previousContent: string,
  nextContent: string
): ConfigDiffEntry[] {
  const previousMap = new Map(
    flattenConfigValue(JSON.parse(previousContent))
      .filter((entry) => entry.path)
      .map((entry) => [entry.path, entry])
  );
  const nextMap = new Map(
    flattenConfigValue(JSON.parse(nextContent))
      .filter((entry) => entry.path)
      .map((entry) => [entry.path, entry])
  );
  const schema = CONFIG_DOCUMENT_SCHEMAS[id];
  const allPaths = new Set([...previousMap.keys(), ...nextMap.keys()]);

  return [...allPaths]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((path) => {
      const previousEntry = previousMap.get(path);
      const nextEntry = nextMap.get(path);

      if (previousEntry?.jsonValue === nextEntry?.jsonValue) {
        return [];
      }

      const node = schemaNodeForPath(schema, path);
      const description = node
        ? describeSchemaPath(schema, path)
        : "自定义字段，Schema 未定义。";
      const fieldType = node
        ? typeLabelForSchema(node)
        : nextEntry?.type ?? previousEntry?.type ?? "unknown";
      const kind = classifyDiffKind(previousEntry, nextEntry, node);

      return [
        {
          path,
          change: previousEntry == null ? "added" : nextEntry == null ? "removed" : "updated",
          previousValue: previousEntry?.jsonValue ?? "",
          nextValue: nextEntry?.jsonValue ?? "",
          kind,
          required: isSchemaPathRequired(schema, path),
          fieldType,
          description,
          blastRadius: buildBlastRadius(id, kind)
        }
      ];
    });
}

function typeLabelForSchema(node: JsonSchemaNode): string {
  if (node.enum) {
    return `enum(${node.enum.join(", ")})`;
  }

  return node.type ?? "unknown";
}

function describeSchemaRequirement(node: JsonSchemaNode): string {
  const parts = [typeLabelForSchema(node)];
  if (node.minimum != null) {
    parts.push(`>= ${node.minimum}`);
  }
  if (node.minItems != null) {
    parts.push(`items >= ${node.minItems}`);
  }
  return parts.join(" · ");
}

function buildSchemaSummary(id: ConfigDocumentId): ConfigSchemaSummary {
  const schema = CONFIG_DOCUMENT_SCHEMAS[id];
  return {
    id: `project-veil.config-center.${id}`,
    title: schema.title ?? id,
    version: CONFIG_SCHEMA_VERSION,
    description: schema.description ?? `${id} config schema`,
    required: schema.required ?? []
  };
}

function schemaNodeForPath(schema: JsonSchemaNode, path: string): JsonSchemaNode | undefined {
  if (!path) {
    return schema;
  }

  let current: JsonSchemaNode | undefined = schema;
  for (const segment of parseJsonPath(path)) {
    if (!current) {
      return undefined;
    }

    if (typeof segment === "number") {
      current = current.items;
      continue;
    }

    current = current.properties?.[segment];
  }

  return current;
}

function describeSchemaPath(schema: JsonSchemaNode, path: string): string {
  const node = schemaNodeForPath(schema, path);
  if (!node) {
    return "";
  }

  const parts = [node.description ?? ""];
  const requirement = describeSchemaRequirement(node);
  if (requirement && requirement !== "unknown") {
    parts.push(requirement);
  }

  return parts.filter(Boolean).join(" | ");
}

function flattenConfigValueWithSchema(value: unknown, schema: JsonSchemaNode, path = ""): FlattenedConfigEntry[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [
        {
          path,
          type: "array",
          displayValue: "[]",
          jsonValue: "[]",
          description: describeSchemaPath(schema, path)
        }
      ];
    }

    return value.flatMap((item, index) => flattenConfigValueWithSchema(item, schema, `${path}[${index}]`));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [
        {
          path,
          type: "object",
          displayValue: "{}",
          jsonValue: "{}",
          description: describeSchemaPath(schema, path)
        }
      ];
    }

    return entries.flatMap(([key, nested]) => flattenConfigValueWithSchema(nested, schema, path ? `${path}.${key}` : key));
  }

  return [
    {
      path,
      type: value === null ? "null" : typeof value,
      displayValue: value == null ? "null" : typeof value === "string" ? value : JSON.stringify(value),
      jsonValue: JSON.stringify(value),
      description: describeSchemaPath(schema, path)
    }
  ];
}

function validateSchemaNode(value: unknown, schema: JsonSchemaNode, path: string, issues: ValidationIssue[]): void {
  const location = path || "$";
  const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;

  if (schema.type === "object") {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      pushIssue(issues, {
        path: location,
        message: `字段需要 object，当前为 ${actualType}。`,
        suggestion: `按 ${describeSchemaRequirement(schema)} 修正该字段结构。`
      });
      return;
    }

    const record = value as Record<string, unknown>;
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in record)) {
        const childPath = path ? `${path}.${requiredKey}` : requiredKey;
        const childSchema = schema.properties?.[requiredKey];
        pushIssue(issues, {
          path: childPath,
          message: `缺少必填字段 ${requiredKey}。`,
          suggestion: childSchema?.description ?? "补齐该字段后再保存。"
        });
      }
    }

    for (const [key, childValue] of Object.entries(record)) {
      const childSchema = schema.properties?.[key];
      if (!childSchema) {
        continue;
      }
      validateSchemaNode(childValue, childSchema, path ? `${path}.${key}` : key, issues);
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      pushIssue(issues, {
        path: location,
        message: `字段需要 array，当前为 ${actualType}。`,
        suggestion: `按 ${describeSchemaRequirement(schema)} 修正该字段结构。`
      });
      return;
    }

    if (schema.minItems != null && value.length < schema.minItems) {
      pushIssue(issues, {
        path: location,
        message: `数组至少需要 ${schema.minItems} 项，当前只有 ${value.length} 项。`,
        suggestion: "补齐数组项后再保存。"
      });
    }

    value.forEach((item, index) => {
      if (schema.items) {
        validateSchemaNode(item, schema.items, `${path}[${index}]`, issues);
      }
    });
    return;
  }

  if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      pushIssue(issues, {
        path: location,
        message: `字段需要 integer，当前为 ${actualType}。`,
        suggestion: `按 ${describeSchemaRequirement(schema)} 调整为整数。`
      });
      return;
    }
  } else if (schema.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      pushIssue(issues, {
        path: location,
        message: `字段需要 number，当前为 ${actualType}。`,
        suggestion: `按 ${describeSchemaRequirement(schema)} 调整为数值。`
      });
      return;
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string") {
      pushIssue(issues, {
        path: location,
        message: `字段需要 string，当前为 ${actualType}。`,
        suggestion: "调整为字符串。"
      });
      return;
    }
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      pushIssue(issues, {
        path: location,
        message: `字段需要 boolean，当前为 ${actualType}。`,
        suggestion: "调整为 true 或 false。"
      });
      return;
    }
  }

  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) {
    pushIssue(issues, {
      path: location,
      message: `字段值不能小于 ${schema.minimum}。`,
      suggestion: `将值调到 ${schema.minimum} 或更高。`
    });
  }

  if (schema.enum && typeof value === "string" && !schema.enum.includes(value)) {
    pushIssue(issues, {
      path: location,
      message: `字段值必须是 ${schema.enum.join(" / ")} 之一。`,
      suggestion: "改成允许的枚举值。"
    });
  }
}

function buildTabularRowsForDocument(document: ConfigDocument): Array<Record<string, string>> {
  const schema = CONFIG_DOCUMENT_SCHEMAS[document.id];
  const content = JSON.parse(document.content) as unknown;
  return flattenConfigValueWithSchema(content, schema).map((entry) => {
    const segments = parseJsonPath(entry.path);
    const leaf = segments.length === 0 ? "$" : String(segments.at(-1));
    const parent = segments.length <= 1 ? "$" : segments.slice(0, -1).join(".");
    return {
      Section: parent,
      Field: leaf,
      Path: entry.path || "$",
      Type: entry.type,
      Schema: describeSchemaRequirement(schemaNodeForPath(schema, entry.path) ?? {}),
      Description: entry.description ?? "",
      Value: entry.displayValue,
      JSON: entry.jsonValue
    };
  });
}

function buildWorkbookForDocument(document: ConfigDocument): Buffer {
  const workbook = XLSX.utils.book_new();
  const schema = buildSchemaSummary(document.id);
  const rows = buildTabularRowsForDocument(document);
  const metadataRows = [
    ["Document", document.id],
    ["Title", document.title],
    ["Version", String(document.version ?? 1)],
    ["UpdatedAt", document.updatedAt],
    ["Summary", document.summary],
    ["SchemaId", schema.id],
    ["SchemaVersion", schema.version]
  ];
  const schemaRows = [
    ["SchemaId", schema.id],
    ["Title", schema.title],
    ["Version", schema.version],
    ["Description", schema.description],
    ["RequiredRoots", schema.required.join(", ")]
  ];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metadataRows), "Meta");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(schemaRows), "Schema");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Fields");

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer"
  }) as Buffer;
}

function buildCsvForDocument(document: ConfigDocument): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(buildTabularRowsForDocument(document));
  return Buffer.from(XLSX.utils.sheet_to_csv(worksheet), "utf8");
}

function buildCommentedJson(document: ConfigDocument): Buffer {
  const header = [
    `// Project Veil Config Center export`,
    `// Document: ${document.id} (${document.title})`,
    `// Version: v${document.version ?? 1}`,
    `// Updated: ${document.updatedAt}`,
    `// Summary: ${document.summary}`,
    ""
  ].join("\n");

  return Buffer.from(`${header}${document.content}`, "utf8");
}

function parseWorkbookToContent(workbookBuffer: Buffer): string {
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find((name) => name === "Fields" || name === "Config") ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new Error("Workbook does not contain a Config sheet");
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  let root: unknown = {};
  for (const row of rows) {
    const path = String(row.Path ?? row.path ?? "").trim();
    const normalizedPath = path === "$" ? "" : path;
    const rawJson = String(row.JSON ?? row.json ?? "").trim();
    if (!normalizedPath && rawJson) {
      root = JSON.parse(rawJson);
      continue;
    }

    if (!normalizedPath) {
      continue;
    }

    const parsedValue = rawJson ? JSON.parse(rawJson) : row.Value;
    if (root == null || typeof root !== "object") {
      root = {};
    }
    setValueAtPath(root, normalizedPath, parsedValue);
  }

  return `${JSON.stringify(root, null, 2)}\n`;
}

function buildBuiltinPresetSummary(id: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]): ConfigPresetSummary {
  const title = id === "easy" ? "Easy" : id === "normal" ? "Normal" : "Hard";
  const description =
    id === "easy"
      ? "下调敌对压力并提高资源/生存冗余。"
      : id === "normal"
        ? "恢复默认强度，用于基线平衡。"
        : "提高数值压力，便于验证高难玩法。";

  return {
    id,
    name: title,
    kind: "builtin",
    updatedAt: new Date(0).toISOString(),
    description
  };
}

function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof Error) {
    return {
      code: "request_failed",
      message: error.message
    };
  }

  return {
    code: "request_failed",
    message: "Unknown error"
  };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "Config document not found"
    }
  });
}

function configDefinitionFor(id: string): ConfigDefinition | undefined {
  return CONFIG_DEFINITIONS.find((item) => item.id === id);
}

function buildSummary(id: ConfigDocumentId, parsed: unknown): string {
  if (id === "world") {
    const config = parsed as WorldGenerationConfig;
    return `${config.width}x${config.height} · ${config.heroes.length} hero(es)`;
  }

  if (id === "mapObjects") {
    const config = parsed as MapObjectsConfig;
    return `${config.neutralArmies.length} neutral army(ies) · ${config.guaranteedResources.length} guaranteed resource(s) · ${config.buildings.length} building(s)`;
  }

  if (id === "units") {
    const config = parsed as UnitCatalogConfig;
    return `${config.templates.length} unit template(s)`;
  }

  if (id === "battleSkills") {
    const config = parsed as BattleSkillCatalogConfig;
    return `${config.skills.length} skill(s) · ${config.statuses.length} status(es)`;
  }

  const config = parsed as BattleBalanceConfig;
  return `damage/env/pvp · K=${config.pvp.eloK} · trap=${config.environment.trapDamage}`;
}

function normalizeJsonContent(
  parsed: ParsedConfigDocument
): string {
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function applyWorldPreset(config: WorldGenerationConfig, presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]): WorldGenerationConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const heroStatScale = presetId === "easy" ? 1.15 : 0.9;
  const armyScale = presetId === "easy" ? 1.25 : 0.85;
  const resourceScale = presetId === "easy" ? 1.2 : 0.85;
  const moveDelta = presetId === "easy" ? 1 : -1;

  return {
    ...structuredClone(config),
    heroes: config.heroes.map((hero) => ({
      ...hero,
      armyCount: Math.max(1, Math.round(hero.armyCount * armyScale)),
      move: {
        total: Math.max(1, hero.move.total + moveDelta),
        remaining: Math.max(0, Math.min(hero.move.total + moveDelta, hero.move.remaining + moveDelta))
      },
      stats: {
        ...hero.stats,
        attack: Math.max(1, Math.round(hero.stats.attack * heroStatScale)),
        defense: Math.max(1, Math.round(hero.stats.defense * heroStatScale)),
        power: Math.max(0, Math.round(hero.stats.power * heroStatScale)),
        knowledge: Math.max(0, Math.round(hero.stats.knowledge * heroStatScale)),
        hp: Math.max(1, Math.round(hero.stats.hp * heroStatScale)),
        maxHp: Math.max(1, Math.round(hero.stats.maxHp * heroStatScale))
      }
    })),
    resourceSpawn: {
      goldChance: Math.min(1, Math.max(0, config.resourceSpawn.goldChance * resourceScale)),
      woodChance: Math.min(1, Math.max(0, config.resourceSpawn.woodChance * resourceScale)),
      oreChance: Math.min(1, Math.max(0, config.resourceSpawn.oreChance * resourceScale))
    }
  };
}

function applyMapObjectsPreset(config: MapObjectsConfig, presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]): MapObjectsConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const enemyScale = presetId === "easy" ? 0.8 : 1.2;
  const rewardScale = presetId === "easy" ? 1.25 : 0.85;

  return {
    ...structuredClone(config),
    neutralArmies: config.neutralArmies.map((army) => ({
      ...army,
      reward: army.reward ? { ...army.reward, amount: Math.max(1, Math.round(army.reward.amount * rewardScale)) } : army.reward,
      stacks: army.stacks.map((stack) => ({
        ...stack,
        count: Math.max(1, Math.round(stack.count * enemyScale))
      }))
    })),
    guaranteedResources: config.guaranteedResources.map((resource) => ({
      ...resource,
      resource: {
        ...resource.resource,
        amount: Math.max(1, Math.round(resource.resource.amount * rewardScale))
      }
    })),
    buildings: config.buildings.map((building) => {
      if (building.kind === "recruitment_post") {
        return {
          ...building,
          recruitCount: Math.max(1, Math.round(building.recruitCount * rewardScale))
        };
      }

      if (building.kind === "attribute_shrine") {
        return {
          ...building,
          bonus: {
            attack: Math.max(0, Math.round(building.bonus.attack * rewardScale)),
            defense: Math.max(0, Math.round(building.bonus.defense * rewardScale)),
            power: Math.max(0, Math.round(building.bonus.power * rewardScale)),
            knowledge: Math.max(0, Math.round(building.bonus.knowledge * rewardScale))
          }
        };
      }

      if (building.kind === "watchtower") {
        return {
          ...building,
          visionBonus: Math.max(1, Math.round(building.visionBonus * rewardScale))
        };
      }

      return {
        ...building,
        income: Math.max(1, Math.round(building.income * rewardScale))
      };
    })
  };
}

function applyUnitPreset(config: UnitCatalogConfig, presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]): UnitCatalogConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const scale = presetId === "easy" ? 0.9 : 1.1;

  return {
    ...structuredClone(config),
    templates: config.templates.map((template) => ({
      ...template,
      initiative: Math.max(1, Math.round(template.initiative * scale)),
      attack: Math.max(1, Math.round(template.attack * scale)),
      defense: Math.max(1, Math.round(template.defense * scale)),
      minDamage: Math.max(1, Math.round(template.minDamage * scale)),
      maxDamage: Math.max(1, Math.round(template.maxDamage * scale)),
      maxHp: Math.max(1, Math.round(template.maxHp * scale))
    }))
  };
}

function applyBattleSkillPreset(
  config: BattleSkillCatalogConfig,
  presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]
): BattleSkillCatalogConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const cooldownDelta = presetId === "easy" ? -1 : 1;
  const effectScale = presetId === "easy" ? 0.9 : 1.1;

  return {
    ...structuredClone(config),
    skills: config.skills.map((skill) => ({
      ...skill,
      cooldown: skill.kind === "passive" ? 0 : Math.max(0, skill.cooldown + cooldownDelta),
      ...(skill.effects == null
        ? {}
        : {
            effects: {
              ...skill.effects,
              ...(skill.effects.damageMultiplier != null
                ? {
                    damageMultiplier: Math.max(0.1, Number((skill.effects.damageMultiplier * effectScale).toFixed(2)))
                  }
                : {})
            }
          })
    })),
    statuses: config.statuses.map((status) => ({
      ...status,
      duration: Math.max(1, status.duration + cooldownDelta),
      attackModifier: Math.round(status.attackModifier * effectScale),
      defenseModifier: Math.round(status.defenseModifier * effectScale),
      damagePerTurn: Math.max(0, Math.round(status.damagePerTurn * effectScale))
    }))
  };
}

function clampThreshold(value: number): number {
  return Number(value.toFixed(2));
}

function applyBattleBalancePreset(
  config: BattleBalanceConfig,
  presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]
): BattleBalanceConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const easier = presetId === "easy";

  return {
    damage: {
      defendingDefenseBonus: config.damage.defendingDefenseBonus + (easier ? -1 : 1),
      offenseAdvantageStep: Number((config.damage.offenseAdvantageStep * (easier ? 0.92 : 1.08)).toFixed(3)),
      minimumOffenseMultiplier: Number(
        Math.max(0.1, config.damage.minimumOffenseMultiplier * (easier ? 1.05 : 0.9)).toFixed(2)
      ),
      varianceBase: Number(config.damage.varianceBase.toFixed(2)),
      varianceRange: Number(Math.max(0, config.damage.varianceRange * (easier ? 0.9 : 1.1)).toFixed(2))
    },
    environment: {
      blockerSpawnThreshold: clampThreshold(
        Math.min(1, Math.max(0, config.environment.blockerSpawnThreshold + (easier ? 0.08 : -0.08)))
      ),
      blockerDurability: Math.max(1, config.environment.blockerDurability + (easier ? -1 : 1)),
      trapSpawnThreshold: clampThreshold(
        Math.min(1, Math.max(0, config.environment.trapSpawnThreshold + (easier ? 0.08 : -0.08)))
      ),
      trapDamage: Math.max(0, config.environment.trapDamage + (easier ? -1 : 1)),
      trapCharges: Math.max(1, config.environment.trapCharges + (easier ? -1 : 1)),
      ...(config.environment.trapGrantedStatusId
        ? { trapGrantedStatusId: config.environment.trapGrantedStatusId }
        : {})
    },
    pvp: {
      eloK: Math.max(1, config.pvp.eloK + (easier ? -4 : 4))
    }
  };
}

function applyBuiltinPresetToContent(
  id: ConfigDocumentId,
  content: string,
  presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]
): string {
  const parsed = parseConfigDocument(id, content);
  const next =
    id === "world"
      ? applyWorldPreset(parsed as WorldGenerationConfig, presetId)
      : id === "mapObjects"
        ? applyMapObjectsPreset(parsed as MapObjectsConfig, presetId)
        : id === "units"
          ? applyUnitPreset(parsed as UnitCatalogConfig, presetId)
          : id === "battleSkills"
            ? applyBattleSkillPreset(parsed as BattleSkillCatalogConfig, presetId)
            : applyBattleBalancePreset(parsed as BattleBalanceConfig, presetId);

  return normalizeJsonContent(next);
}

function buildLayoutPresetSummary(id: typeof BUILTIN_WORLD_LAYOUT_PRESETS[number]): ConfigPresetSummary {
  const name =
    id === "layout_frontier_basin"
      ? "Frontier Basin"
      : id === "layout_stonewatch_fork"
        ? "Stonewatch Fork"
      : id === "layout_ridgeway_crossing"
        ? "Ridgeway Crossing"
      : id === "layout_contested_basin"
        ? "Contested Basin"
        : "Phase 1";
  const description =
    id === "layout_frontier_basin"
      ? "切换为首个峡谷盆地布局，适合验证水域与矿点分布。"
      : id === "layout_stonewatch_fork"
        ? "切换为石望岔路布局，适合验证双招募点、分叉矿线与南北奖励节奏。"
      : id === "layout_ridgeway_crossing"
        ? "切换为第二个 Phase 1 岭桥布局，适合验证中央渡口争夺、双招募点和木矿/矿井分流。"
      : id === "layout_contested_basin"
        ? "切换为争夺盆地布局，包含新巡逻守军与瞭望塔。"
        : "恢复默认 Phase 1 地图布局。";

  return {
    id,
    name,
    kind: "builtin",
    updatedAt: new Date(0).toISOString(),
    description
  };
}

function getBuiltinPresetSummaries(id: ConfigDocumentId): ConfigPresetSummary[] {
  const summaries = BUILTIN_DIFFICULTY_PRESET_IDS.map((presetId) => buildBuiltinPresetSummary(presetId));
  if (id === "world") {
    summaries.push(...BUILTIN_WORLD_LAYOUT_PRESETS.map((presetId) => buildLayoutPresetSummary(presetId)));
  }
  if (id === "mapObjects") {
    summaries.push(...BUILTIN_MAP_OBJECT_LAYOUT_PRESETS.map((presetId) => buildLayoutPresetSummary(presetId)));
  }
  return summaries;
}

function resolveBuiltinPresetContent(id: ConfigDocumentId, currentContent: string, presetId: string): string | null {
  if (BUILTIN_DIFFICULTY_PRESET_IDS.includes(presetId as typeof BUILTIN_DIFFICULTY_PRESET_IDS[number])) {
    return applyBuiltinPresetToContent(
      id,
      currentContent,
      presetId as typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]
    );
  }

  if (id === "world") {
    if (presetId === "layout_phase1") {
      return normalizeJsonContent(getDefaultWorldConfig());
    }
    if (presetId === "layout_frontier_basin") {
      return normalizeJsonContent(frontierBasinWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_stonewatch_fork") {
      return normalizeJsonContent(stonewatchForkWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_ridgeway_crossing") {
      return normalizeJsonContent(ridgewayCrossingWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_contested_basin") {
      return normalizeJsonContent(contestedBasinWorldConfig as WorldGenerationConfig);
    }
  }

  if (id === "mapObjects") {
    if (presetId === "layout_phase1") {
      return normalizeJsonContent(getDefaultMapObjectsConfig());
    }
    if (presetId === "layout_frontier_basin") {
      return normalizeJsonContent(frontierBasinMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_stonewatch_fork") {
      return normalizeJsonContent(stonewatchForkMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_ridgeway_crossing") {
      return normalizeJsonContent(ridgewayCrossingMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_contested_basin") {
      return normalizeJsonContent(contestedBasinMapObjectsConfig as MapObjectsConfig);
    }
  }

  return null;
}

function positionKey(position: { x: number; y: number }): string {
  return `${position.x},${position.y}`;
}

function createTerrainCountRecord(): Record<TerrainType, number> {
  return {
    grass: 0,
    dirt: 0,
    sand: 0,
    water: 0
  };
}

function createResourceCountRecord(): Record<ResourceKind, number> {
  return {
    gold: 0,
    wood: 0,
    ore: 0
  };
}

function normalizePreviewSeed(seed: unknown, fallback = 1001): number {
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    return fallback;
  }

  return Math.max(0, Math.floor(seed));
}

function parseConfigDocument(
  id: ConfigDocumentId,
  content: string
): ParsedConfigDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Config content is not valid JSON");
  }

  if (id === "world") {
    const nextWorld = parsed as WorldGenerationConfig;
    validateWorldConfig(nextWorld);
    return nextWorld;
  }

  if (id === "mapObjects") {
    return parsed as MapObjectsConfig;
  }

  if (id === "units") {
    const nextCatalog = parsed as UnitCatalogConfig;
    validateUnitCatalog(nextCatalog);
    return nextCatalog;
  }

  if (id === "battleSkills") {
    const nextSkillCatalog = parsed as BattleSkillCatalogConfig;
    validateBattleSkillCatalog(nextSkillCatalog);
    return nextSkillCatalog;
  }

  const nextBattleBalance = parsed as BattleBalanceConfig;
  validateBattleBalanceConfig(nextBattleBalance);
  return nextBattleBalance;
}

function buildRuntimeBundleWithParsedDocument(id: ConfigDocumentId, parsed: ParsedConfigDocument): RuntimeConfigBundle {
  switch (id) {
    case "world":
      return buildRuntimeConfigBundle({ world: parsed as WorldGenerationConfig });
    case "mapObjects":
      return buildRuntimeConfigBundle({ mapObjects: parsed as MapObjectsConfig });
    case "units":
      return buildRuntimeConfigBundle({ units: parsed as UnitCatalogConfig });
    case "battleSkills":
      return buildRuntimeConfigBundle({ battleSkills: parsed as BattleSkillCatalogConfig });
    case "battleBalance":
      return buildRuntimeConfigBundle({ battleBalance: parsed as BattleBalanceConfig });
  }
}

function contentForDocumentId(bundle: RuntimeConfigBundle, id: ConfigDocumentId): ParsedConfigDocument {
  switch (id) {
    case "world":
      return bundle.world;
    case "mapObjects":
      return bundle.mapObjects;
    case "units":
      return bundle.units;
    case "battleSkills":
      return bundle.battleSkills;
    case "battleBalance":
      return bundle.battleBalance ?? getBattleBalanceConfig();
  }
}

export function createWorldConfigPreview(
  worldConfig: WorldGenerationConfig,
  mapObjectsConfig: MapObjectsConfig,
  seed = 1001
): WorldConfigPreview {
  const normalizedSeed = normalizePreviewSeed(seed);
  const previewState = createWorldStateFromConfigs(worldConfig, mapObjectsConfig, normalizedSeed, "config-preview");
  const heroById = new Map(previewState.heroes.map((hero) => [hero.id, hero]));
  const guaranteedResourceKeys = new Set(
    mapObjectsConfig.guaranteedResources.map((resource) => positionKey(resource.position))
  );
  const terrainCounts = createTerrainCountRecord();
  const resourceTileCounts = createResourceCountRecord();
  const resourceAmountTotals = createResourceCountRecord();
  let walkableCount = 0;
  let blockedCount = 0;
  let guaranteedResourceCount = 0;
  let randomResourceCount = 0;

  const tiles: WorldConfigPreviewTile[] = previewState.map.tiles.map((tile) => {
    terrainCounts[tile.terrain] += 1;
    if (tile.walkable) {
      walkableCount += 1;
    } else {
      blockedCount += 1;
    }

    const resourceSource = tile.resource
      ? guaranteedResourceKeys.has(positionKey(tile.position))
        ? "guaranteed"
        : "random"
      : undefined;
    if (tile.resource) {
      resourceTileCounts[tile.resource.kind] += 1;
      resourceAmountTotals[tile.resource.kind] += tile.resource.amount;
      if (resourceSource === "guaranteed") {
        guaranteedResourceCount += 1;
      } else {
        randomResourceCount += 1;
      }
    }

    let occupant: WorldConfigPreviewTile["occupant"];
    if (tile.occupant?.kind === "hero") {
      const hero = heroById.get(tile.occupant.refId);
      occupant = {
        kind: "hero",
        refId: tile.occupant.refId,
        label: hero?.name ?? tile.occupant.refId,
        ...(hero ? { playerId: hero.playerId } : {})
      };
    } else if (tile.occupant?.kind === "neutral") {
      occupant = {
        kind: "neutral",
        refId: tile.occupant.refId,
        label: `中立 ${tile.occupant.refId}`
      };
    }

    const building = !tile.building
      ? undefined
      : tile.building.kind === "recruitment_post"
        ? {
            kind: tile.building.kind,
            refId: tile.building.id,
            label: tile.building.label,
            unitTemplateId: tile.building.unitTemplateId,
            availableCount: tile.building.availableCount
          }
        : tile.building.kind === "attribute_shrine"
          ? {
              kind: tile.building.kind,
              refId: tile.building.id,
              label: tile.building.label,
              bonus: {
                attack: tile.building.bonus.attack,
                defense: tile.building.bonus.defense,
                power: tile.building.bonus.power,
                knowledge: tile.building.bonus.knowledge
              },
              ...(typeof tile.building.lastUsedDay === "number" ? { lastUsedDay: tile.building.lastUsedDay } : {})
            }
          : tile.building.kind === "resource_mine"
            ? {
              kind: tile.building.kind,
              refId: tile.building.id,
              label: tile.building.label,
              resourceKind: tile.building.resourceKind,
              income: tile.building.income,
              ...(typeof tile.building.lastHarvestDay === "number"
                ? { lastHarvestDay: tile.building.lastHarvestDay }
                : {})
            }
            : {
              kind: tile.building.kind,
              refId: tile.building.id,
              label: tile.building.label,
              visionBonus: tile.building.visionBonus,
              ...(typeof tile.building.lastUsedDay === "number" ? { lastUsedDay: tile.building.lastUsedDay } : {})
            };

    return {
      position: tile.position,
      terrain: tile.terrain,
      walkable: tile.walkable,
      ...(tile.resource
        ? {
            resource: {
              ...tile.resource,
              source: resourceSource ?? "random"
            }
          }
        : {}),
      ...(building ? { building } : {}),
      ...(occupant ? { occupant } : {})
    };
  });

  return {
    seed: normalizedSeed,
    roomId: previewState.meta.roomId,
    width: previewState.map.width,
    height: previewState.map.height,
    counts: {
      walkable: walkableCount,
      blocked: blockedCount,
      terrain: terrainCounts,
      resourceTiles: resourceTileCounts,
      resourceAmounts: resourceAmountTotals,
      guaranteedResources: guaranteedResourceCount,
      randomResources: randomResourceCount,
      heroes: previewState.heroes.length,
      neutralArmies: Object.keys(previewState.neutralArmies).length,
      buildings: Object.keys(previewState.buildings).length
    },
    tiles
  };
}

function buildRuntimeConfigBundle(
  documents: Partial<RuntimeConfigBundle>
): RuntimeConfigBundle {
  const world = documents.world ?? getDefaultWorldConfig();
  const mapObjects = documents.mapObjects ?? getDefaultMapObjectsConfig();
  const units = documents.units ?? getDefaultUnitCatalog();
  const battleSkills = documents.battleSkills ?? getDefaultBattleSkillCatalog();
  const battleBalance = documents.battleBalance ?? getBattleBalanceConfig();

  validateWorldConfig(world);
  validateMapObjectsConfig(mapObjects, world, units);
  validateBattleSkillCatalog(battleSkills);
  validateUnitCatalog(units, battleSkills);
  validateBattleBalanceConfig(battleBalance, battleSkills);

  return {
    world,
    mapObjects,
    units,
    battleSkills,
    battleBalance
  };
}

const configUpdateListeners = new Set<(bundle: RuntimeConfigBundle) => void>();

export function registerConfigUpdateListener(
  callback: (bundle: RuntimeConfigBundle) => void
): () => void {
  configUpdateListeners.add(callback);
  return () => {
    configUpdateListeners.delete(callback);
  };
}

function applyRuntimeBundle(bundle: RuntimeConfigBundle): void {
  replaceRuntimeConfigs(bundle);
  for (const listener of configUpdateListeners) {
    try {
      listener(bundle);
    } catch (error) {
      console.error("[config-center] Error notifying config update listener", error);
    }
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function formatTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

async function loadValidationDependencies(
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

function buildValidationReportFromError(id: ConfigDocumentId, error: Error, content: string): ValidationReport {
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
      checkedDocuments: ["world", "mapObjects", "units", "battleSkills", "battleBalance"],
      issues: []
    }
  };
}

function summarizeIssues(issues: ValidationIssue[], contentPack: ContentPackValidationReport): string {
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

function validateWorldConfigDetailed(config: WorldGenerationConfig): ValidationIssue[] {
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

function validateMapObjectsDetailed(
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

function validateUnitCatalogDetailed(
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

function validateBattleSkillsDetailed(config: BattleSkillCatalogConfig): ValidationIssue[] {
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

function validateBattleBalanceDetailed(
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

function buildCandidateRuntimeBundle(
  id: ConfigDocumentId,
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

function mapContentPackIssuesToValidationIssues(report: ContentPackValidationReport): ValidationIssue[] {
  return report.issues.map((issue) => ({
    documentId: issue.documentId,
    path: issue.path,
    severity: issue.severity,
    message: issue.message,
    suggestion: issue.suggestion
  }));
}

async function validateDocumentDetailed(
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
      checkedDocuments: ["world", "mapObjects", "units", "battleSkills", "battleBalance"],
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
              : validateBattleBalanceDetailed(
                  parsed as BattleBalanceConfig,
                  dependencies.battleSkills
                );
      issues.push(...semanticIssues);
      contentPack = validateContentPackConsistency(buildCandidateRuntimeBundle(id, parsed, dependencies));
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

abstract class BaseConfigCenterStore implements ConfigCenterStore {
  abstract readonly mode: "filesystem" | "mysql";

  constructor(protected readonly rootDir = resolve(process.cwd(), "configs")) {}

  async ensureRootDir(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  protected filePathFor(id: ConfigDocumentId): string {
    const definition = configDefinitionFor(id);
    if (!definition) {
      throw new Error(`Unsupported config id: ${id}`);
    }

    return resolve(this.rootDir, definition.fileName);
  }

  protected async exportDocumentToFile(id: ConfigDocumentId, content: string): Promise<void> {
    await this.ensureRootDir();
    await writeFile(this.filePathFor(id), content, "utf8");
  }

  protected libraryFilePath(): string {
    return resolve(this.rootDir, CONFIG_CENTER_LIBRARY_FILE);
  }

  protected async readLibraryState(): Promise<ConfigCenterLibraryState> {
    await this.ensureRootDir();

    try {
      const content = await readFile(this.libraryFilePath(), "utf8");
      const parsed = JSON.parse(content) as Partial<ConfigCenterLibraryState>;
      return {
        filesystemVersions: parsed.filesystemVersions ?? {},
        filesystemExports: parsed.filesystemExports ?? {},
        snapshots: parsed.snapshots ?? {},
        presets: parsed.presets ?? {},
        stagedDraft: parsed.stagedDraft ?? null,
        publishHistory: parsed.publishHistory ?? {},
        publishAuditHistory: parsed.publishAuditHistory ?? []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyLibraryState();
      }
      throw error;
    }
  }

  protected async writeLibraryState(state: ConfigCenterLibraryState): Promise<void> {
    await this.ensureRootDir();
    await writeFile(this.libraryFilePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  protected async getFilesystemVersion(id: ConfigDocumentId): Promise<number | undefined> {
    const state = await this.readLibraryState();
    return state.filesystemVersions[id];
  }

  protected async setFilesystemVersion(id: ConfigDocumentId, version: number): Promise<void> {
    const state = await this.readLibraryState();
    state.filesystemVersions[id] = version;
    await this.writeLibraryState(state);
  }

  protected async getFilesystemExportedAt(id: ConfigDocumentId): Promise<string | null> {
    const state = await this.readLibraryState();
    return state.filesystemExports[id] ?? null;
  }

  protected async setFilesystemExportedAt(id: ConfigDocumentId, exportedAt: string): Promise<void> {
    const state = await this.readLibraryState();
    state.filesystemExports[id] = exportedAt;
    await this.writeLibraryState(state);
  }

  protected buildDocument(
    definition: ConfigDefinition,
    content: string,
    metadata: {
      updatedAt: string;
      version?: number;
      exportedAt?: string | null;
    }
  ): ConfigDocument {
    const parsed = JSON.parse(content) as unknown;

    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      fileName: definition.fileName,
      updatedAt: metadata.updatedAt,
      summary: buildSummary(definition.id, parsed),
      storage: this.mode,
      ...(metadata.version != null ? { version: metadata.version } : {}),
      ...(metadata.exportedAt !== undefined ? { exportedAt: metadata.exportedAt } : {}),
      content
    };
  }

  async initializeRuntimeConfigs(): Promise<void> {
    const documents = await Promise.all(CONFIG_DEFINITIONS.map((definition) => this.loadDocument(definition.id)));
    const bundle = buildRuntimeConfigBundle(
      Object.fromEntries(
        documents.map((document) => [document.id, parseConfigDocument(document.id, document.content)])
      ) as Partial<RuntimeConfigBundle>
    );

    applyRuntimeBundle(bundle);
    await Promise.all([
      this.exportDocumentToFile("world", normalizeJsonContent(bundle.world)),
      this.exportDocumentToFile("mapObjects", normalizeJsonContent(bundle.mapObjects)),
      this.exportDocumentToFile("units", normalizeJsonContent(bundle.units)),
      this.exportDocumentToFile("battleSkills", normalizeJsonContent(bundle.battleSkills)),
      this.exportDocumentToFile("battleBalance", normalizeJsonContent(contentForDocumentId(bundle, "battleBalance")))
    ]);
  }

  async listDocuments(): Promise<ConfigDocumentSummary[]> {
    const items = await Promise.all(CONFIG_DEFINITIONS.map((definition) => this.loadDocument(definition.id)));
    return items.map(({ content: _content, ...summary }) => summary);
  }

  async validateDocument(id: ConfigDocumentId, content: string): Promise<ValidationReport> {
    return validateDocumentDetailed(this, id, content);
  }

  async listSnapshots(id: ConfigDocumentId): Promise<ConfigSnapshotSummary[]> {
    const state = await this.readLibraryState();
    const snapshots = state.snapshots[id] ?? [];
    return snapshots
      .map(({ content: _content, ...summary }) => summary)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createSnapshot(id: ConfigDocumentId, content: string, label?: string): Promise<ConfigSnapshotSummary> {
    const document = await this.loadDocument(id);
    parseConfigDocument(id, content);

    return this.appendSnapshot(id, {
      id: createId("snapshot"),
      label: label?.trim() || `${document.title} v${document.version ?? 1}`,
      createdAt: new Date().toISOString(),
      version: document.version ?? 1,
      content: normalizeJsonContent(parseConfigDocument(id, content))
    });
  }

  protected async appendSnapshot(id: ConfigDocumentId, snapshot: ConfigSnapshotRecord): Promise<ConfigSnapshotSummary> {
    const state = await this.readLibraryState();
    state.snapshots[id] = [snapshot, ...(state.snapshots[id] ?? [])].slice(0, 30);
    await this.writeLibraryState(state);
    const { content: _content, ...summary } = snapshot;
    return summary;
  }

  protected async createAutomaticSnapshot(document: ConfigDocument): Promise<ConfigSnapshotSummary> {
    return this.appendSnapshot(document.id, {
      id: createId("snapshot"),
      label: buildAutomaticSnapshotLabel(document.title, document.version ?? 1),
      createdAt: new Date().toISOString(),
      version: document.version ?? 1,
      content: document.content
    });
  }

  async rollbackToSnapshot(id: ConfigDocumentId, snapshotId: string): Promise<ConfigDocument> {
    const state = await this.readLibraryState();
    const snapshot = (state.snapshots[id] ?? []).find((item) => item.id === snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    return this.saveDocument(id, snapshot.content);
  }

  async diffWithSnapshot(id: ConfigDocumentId, snapshotId: string): Promise<ConfigDiff> {
    const state = await this.readLibraryState();
    const snapshot = (state.snapshots[id] ?? []).find((item) => item.id === snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const current = await this.loadDocument(id);
    return {
      entries: buildConfigDiffEntries(id, snapshot.content, current.content)
    };
  }

  async listPublishHistory(id: ConfigDocumentId): Promise<ConfigPublishHistoryEntry[]> {
    const state = await this.readLibraryState();
    return [...(state.publishHistory[id] ?? [])];
  }

  async listPublishAuditHistory(): Promise<ConfigPublishAuditEvent[]> {
    const state = await this.readLibraryState();
    return [...(state.publishAuditHistory ?? [])].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  }

  async getStagedDraft(): Promise<ConfigStageState | null> {
    const state = await this.readLibraryState();
    return this.mapStageRecordToState(state.stagedDraft);
  }

  async saveStagedDraft(documents: ConfigStageDocumentInput[]): Promise<ConfigStageState | null> {
    const state = await this.readLibraryState();
    if (documents.length === 0) {
      state.stagedDraft = null;
      await this.writeLibraryState(state);
      return null;
    }

    const stageRecord = await this.buildStageRecord(documents, state.stagedDraft);
    state.stagedDraft = stageRecord;
    await this.writeLibraryState(state);
    return this.mapStageRecordToState(stageRecord);
  }

  async publishStagedDraft(metadata: { author: string; summary: string }): Promise<{
    stage: ConfigStageState | null;
    publish: ConfigPublishEventSummary;
  }> {
    const state = await this.readLibraryState();
    const staged = state.stagedDraft;
    if (!staged || staged.documents.length === 0) {
      throw new Error("当前没有待发布的草稿。");
    }

    if (staged.documents.some((entry) => !entry.validation.valid)) {
      throw new Error("存在未通过校验的草稿，发布前请先修复。");
    }

    const publishId = createId("publish");
    const publishedAt = new Date().toISOString();
    const publishChanges: ConfigPublishChangeSummary[] = [];
    const historyEntries: ConfigPublishHistoryEntry[] = [];
    const auditChanges: ConfigPublishAuditChange[] = [];
    const stagedContent = new Map(staged.documents.map((document) => [document.id, document.content] as const));

    for (const stagedDocument of staged.documents) {
      const current = await this.loadDocument(stagedDocument.id);
      const diffEntries = buildConfigDiffEntries(stagedDocument.id, current.content, stagedDocument.content);
      const structuralCount = diffEntries.filter((entry) => entry.kind !== "value").length;
      const definition = configDefinitionFor(stagedDocument.id);
      const fromVersion = current.version ?? 1;
      auditChanges.push({
        documentId: stagedDocument.id,
        title: definition?.title ?? stagedDocument.id,
        fromVersion,
        toVersion: fromVersion,
        changeCount: diffEntries.length,
        structuralChangeCount: structuralCount,
        snapshotId: null,
        runtimeStatus: "pending",
        runtimeMessage: "等待运行时应用",
        diffSummary: diffEntries.slice(0, 4),
        impactSummary: buildConfigImpactSummary(
          stagedDocument.id,
          definition?.title ?? stagedDocument.id,
          diffEntries
        )
      });
    }

    try {
      for (const auditChange of auditChanges) {
        const nextContent = stagedContent.get(auditChange.documentId);
        if (typeof nextContent !== "string") {
          throw new Error(`Missing staged document content: ${auditChange.documentId}`);
        }

        const saved = await this.saveDocument(auditChange.documentId, nextContent);
        const toVersion = saved.version ?? auditChange.fromVersion;
        const snapshot = await this.findSnapshotByVersion(auditChange.documentId, toVersion);

        auditChange.toVersion = toVersion;
        auditChange.snapshotId = snapshot?.id ?? null;
        auditChange.runtimeStatus = "applied";
        auditChange.runtimeMessage = "运行时已刷新";
        publishChanges.push({
          documentId: auditChange.documentId,
          title: auditChange.title,
          fromVersion: auditChange.fromVersion,
          toVersion,
          changeCount: auditChange.changeCount,
          structuralChangeCount: auditChange.structuralChangeCount
        });
        historyEntries.push({
          id: publishId,
          documentId: auditChange.documentId,
          author: metadata.author,
          summary: metadata.summary,
          publishedAt,
          fromVersion: auditChange.fromVersion,
          toVersion,
          changeCount: auditChange.changeCount,
          structuralChangeCount: auditChange.structuralChangeCount
        });
      }

      state.stagedDraft = null;
      state.publishHistory = state.publishHistory ?? {};
      for (const entry of historyEntries) {
        const existing = state.publishHistory[entry.documentId] ?? [];
        state.publishHistory[entry.documentId] = [entry, ...existing].slice(0, MAX_PUBLISH_HISTORY_ENTRIES);
      }
      const appliedAuditEvent: ConfigPublishAuditEvent = {
        id: publishId,
        author: metadata.author,
        summary: metadata.summary,
        publishedAt,
        resultStatus: "applied",
        resultMessage: "运行时配置已刷新",
        changes: auditChanges
      };
      state.publishAuditHistory = [appliedAuditEvent, ...(state.publishAuditHistory ?? [])].slice(
        0,
        MAX_PUBLISH_HISTORY_ENTRIES
      );
      await this.writeLibraryState(state);

      return {
        stage: null,
        publish: {
          id: publishId,
          author: metadata.author,
          summary: metadata.summary,
          publishedAt,
          changes: publishChanges
        }
      };
    } catch (error) {
      const failedMessage = error instanceof Error ? error.message : "发布配置失败";
      const failedChange = auditChanges.find((entry) => entry.runtimeStatus === "pending");
      if (failedChange) {
        failedChange.runtimeStatus = "failed";
        failedChange.runtimeMessage = failedMessage;
      }

      const failedAuditEvent: ConfigPublishAuditEvent = {
        id: publishId,
        author: metadata.author,
        summary: metadata.summary,
        publishedAt,
        resultStatus: "failed",
        resultMessage: failedMessage,
        changes: auditChanges
      };
      state.publishAuditHistory = [failedAuditEvent, ...(state.publishAuditHistory ?? [])].slice(
        0,
        MAX_PUBLISH_HISTORY_ENTRIES
      );
      await this.writeLibraryState(state);
      throw error;
    }
  }

  protected async findSnapshotByVersion(
    id: ConfigDocumentId,
    version: number
  ): Promise<ConfigSnapshotSummary | null> {
    const snapshots = await this.listSnapshots(id);
    return snapshots.find((snapshot) => snapshot.version === version) ?? null;
  }

  protected mapStageRecordToState(stage: ConfigStageRecord | null): ConfigStageState | null {
    if (!stage) {
      return null;
    }

    return {
      id: stage.id,
      createdAt: stage.createdAt,
      updatedAt: stage.updatedAt,
      documents: stage.documents.map((document) => {
        const definition = configDefinitionFor(document.id);
        return {
          id: document.id,
          title: definition?.title ?? document.id,
          fileName: definition?.fileName ?? document.id,
          content: document.content,
          updatedAt: document.updatedAt,
          validation: document.validation
        };
      }),
      valid: stage.documents.every((document) => document.validation.valid)
    };
  }

  private async buildStageRecord(
    documents: ConfigStageDocumentInput[],
    existing: ConfigStageRecord | null
  ): Promise<ConfigStageRecord> {
    if (documents.length > MAX_STAGE_DOCUMENTS) {
      throw new Error(`一次最多只能准备 ${MAX_STAGE_DOCUMENTS} 个草稿。`);
    }

    const seen = new Set<ConfigDocumentId>();
    for (const document of documents) {
      if (!configDefinitionFor(document.id)) {
        throw new Error(`Unsupported config id: ${document.id}`);
      }
      if (seen.has(document.id)) {
        throw new Error("同一配置文档只能加入一次草稿捆绑。");
      }
      seen.add(document.id);
    }

    const normalizedDocuments = documents.map((document) => ({
      id: document.id,
      content: normalizeJsonContent(JSON.parse(document.content) as ParsedConfigDocument)
    }));
    const overrides: Partial<Record<ConfigDocumentId, string>> = {};
    for (const normalized of normalizedDocuments) {
      overrides[normalized.id] = normalized.content;
    }

    const timestamp = new Date().toISOString();
    const stageRecord: ConfigStageRecord = {
      id: existing?.id ?? createId("stage"),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      documents: []
    };

    for (const normalized of normalizedDocuments) {
      stageRecord.documents.push({
        id: normalized.id,
        content: normalized.content,
        validation: await validateDocumentDetailed(this, normalized.id, normalized.content, { overrides }),
        updatedAt: timestamp
      });
    }

    return stageRecord;
  }

  async listPresets(id: ConfigDocumentId): Promise<ConfigPresetSummary[]> {
    const state = await this.readLibraryState();
    const customPresets = (state.presets[id] ?? []).map(({ content: _content, ...summary }) => ({
      ...summary,
      kind: "custom" as const
    }));

    return [...getBuiltinPresetSummaries(id), ...customPresets].sort((left, right) =>
      left.kind === right.kind ? right.updatedAt.localeCompare(left.updatedAt) : left.kind === "builtin" ? -1 : 1
    );
  }

  async savePreset(id: ConfigDocumentId, name: string, content: string): Promise<ConfigPresetSummary> {
    if (!name.trim()) {
      throw new Error("Preset name is required");
    }

    parseConfigDocument(id, content);
    const state = await this.readLibraryState();
    const nextPreset: ConfigPresetRecord = {
      id: createId("preset"),
      name: name.trim(),
      updatedAt: new Date().toISOString(),
      description: `${configDefinitionFor(id)?.title ?? id} 自定义预设`,
      content: normalizeJsonContent(parseConfigDocument(id, content))
    };

    state.presets[id] = [nextPreset, ...(state.presets[id] ?? [])].slice(0, 20);
    await this.writeLibraryState(state);
    return {
      id: nextPreset.id,
      name: nextPreset.name,
      kind: "custom",
      updatedAt: nextPreset.updatedAt,
      description: nextPreset.description
    };
  }

  async applyPreset(id: ConfigDocumentId, presetId: string): Promise<ConfigDocument> {
    const current = await this.loadDocument(id);
    const state = await this.readLibraryState();
    const customPreset = (state.presets[id] ?? []).find((item) => item.id === presetId);
    const presetContent = customPreset
      ? customPreset.content
      : resolveBuiltinPresetContent(id, current.content, presetId);

    if (!presetContent) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    return this.saveDocument(id, presetContent);
  }

  async exportDocument(id: ConfigDocumentId, format: "xlsx" | "jsonc" | "csv"): Promise<{
    fileName: string;
    contentType: string;
    body: Buffer;
    exportedAt: string;
  }> {
    const document = await this.loadDocument(id);
    const exportedAt = await this.markDocumentExported(id);
    return format === "xlsx"
      ? {
          fileName: `${id}-v${document.version ?? 1}.xlsx`,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          body: buildWorkbookForDocument(document),
          exportedAt
        }
      : format === "csv"
        ? {
            fileName: `${id}-v${document.version ?? 1}.csv`,
            contentType: "text/csv; charset=utf-8",
            body: buildCsvForDocument(document),
            exportedAt
          }
        : {
          fileName: `${id}-v${document.version ?? 1}.jsonc`,
          contentType: "application/jsonc; charset=utf-8",
          body: buildCommentedJson(document),
          exportedAt
        };
  }

  async importDocumentFromWorkbook(id: ConfigDocumentId, workbook: Buffer): Promise<ConfigDocument> {
    const content = parseWorkbookToContent(workbook);
    return this.saveDocument(id, content);
  }

  abstract loadDocument(id: ConfigDocumentId): Promise<ConfigDocument>;
  abstract saveDocument(id: ConfigDocumentId, content: string): Promise<ConfigDocument>;
  protected abstract markDocumentExported(id: ConfigDocumentId): Promise<string>;
  abstract close(): Promise<void>;
}

export class FileSystemConfigCenterStore extends BaseConfigCenterStore {
  readonly mode = "filesystem" as const;

  async loadDocument(id: ConfigDocumentId): Promise<ConfigDocument> {
    const definition = configDefinitionFor(id);
    if (!definition) {
      throw new Error(`Unsupported config id: ${id}`);
    }

    const filePath = this.filePathFor(id);
    const [fileContent, fileStats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    const parsed = parseConfigDocument(id, fileContent);

    return this.buildDocument(definition, normalizeJsonContent(parsed), {
      updatedAt: fileStats.mtime.toISOString(),
      version: (await this.getFilesystemVersion(id)) ?? 1,
      exportedAt: await this.getFilesystemExportedAt(id)
    });
  }

  async saveDocument(id: ConfigDocumentId, content: string): Promise<ConfigDocument> {
    const parsed = parseConfigDocument(id, content);
    const bundle = buildRuntimeBundleWithParsedDocument(id, parsed);
    const serialized = normalizeJsonContent(contentForDocumentId(bundle, id));
    const current = await this.loadDocument(id);

    if (current.content === serialized) {
      return current;
    }

    const nextVersion = (current.version ?? 1) + 1;

    await this.exportDocumentToFile(id, serialized);
    await this.setFilesystemVersion(id, nextVersion);
    applyRuntimeBundle(bundle);

    const saved = await this.loadDocument(id);
    await this.createAutomaticSnapshot(saved);
    return saved;
  }

  async close(): Promise<void> {
    return;
  }

  protected async markDocumentExported(id: ConfigDocumentId): Promise<string> {
    const exportedAt = new Date().toISOString();
    await this.setFilesystemExportedAt(id, exportedAt);
    return exportedAt;
  }
}

export class MySqlConfigCenterStore extends BaseConfigCenterStore {
  readonly mode = "mysql" as const;

  private constructor(
    private readonly pool: Pool,
    private readonly database: string,
    rootDir: string
  ) {
    super(rootDir);
  }

  static async create(config: MySqlPersistenceConfig, rootDir = resolve(process.cwd(), "configs")): Promise<MySqlConfigCenterStore> {
    const pool = createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: 4,
      namedPlaceholders: true
    });
    await pool.query("SELECT 1");

    return new MySqlConfigCenterStore(pool, config.database, rootDir);
  }

  async initializeRuntimeConfigs(): Promise<void> {
    await this.bootstrapMissingDocumentsFromFiles();
    await super.initializeRuntimeConfigs();
  }

  async loadDocument(id: ConfigDocumentId): Promise<ConfigDocument> {
    const definition = configDefinitionFor(id);
    if (!definition) {
      throw new Error(`Unsupported config id: ${id}`);
    }

    const row = await this.loadRow(id);
    if (!row) {
      throw new Error(`Missing config document in MySQL: ${id}`);
    }

    const parsed = parseConfigDocument(id, row.content_json);
    return this.buildDocument(definition, normalizeJsonContent(parsed), {
      updatedAt: formatTimestamp(row.updated_at) ?? new Date().toISOString(),
      version: row.version,
      exportedAt: formatTimestamp(row.exported_at)
    });
  }

  async saveDocument(id: ConfigDocumentId, content: string): Promise<ConfigDocument> {
    const parsed = parseConfigDocument(id, content);
    const bundle = buildRuntimeBundleWithParsedDocument(id, parsed);
    const serialized = normalizeJsonContent(contentForDocumentId(bundle, id));
    const current = await this.loadDocument(id);

    if (current.content === serialized) {
      return current;
    }

    await this.pool.query(
      `INSERT INTO \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (document_id, content_json, exported_at)
       VALUES (?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         content_json = VALUES(content_json),
         version = version + 1`,
      [id, serialized]
    );

    await this.exportDocumentToFile(id, serialized);
    applyRuntimeBundle(bundle);

    const saved = await this.loadDocument(id);
    await this.createAutomaticSnapshot(saved);
    return saved;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  protected async markDocumentExported(id: ConfigDocumentId): Promise<string> {
    await this.pool.query(
      `UPDATE \`${MYSQL_CONFIG_DOCUMENT_TABLE}\`
       SET exported_at = CURRENT_TIMESTAMP
       WHERE document_id = ?`,
      [id]
    );
    const row = await this.loadRow(id);
    return formatTimestamp(row?.exported_at) ?? new Date().toISOString();
  }

  describe(): string {
    return `mysql://${this.database}/${MYSQL_CONFIG_DOCUMENT_TABLE}`;
  }

  private async bootstrapMissingDocumentsFromFiles(): Promise<void> {
    for (const definition of CONFIG_DEFINITIONS) {
      const existing = await this.loadRow(definition.id);
      if (existing) {
        continue;
      }

      const fileContent = await readFile(this.filePathFor(definition.id), "utf8");
      const parsed = parseConfigDocument(definition.id, fileContent);
      const serialized = normalizeJsonContent(parsed);

      await this.pool.query(
        `INSERT INTO \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (document_id, content_json, exported_at)
         VALUES (?, ?, NULL)`,
        [definition.id, serialized]
      );
      await this.exportDocumentToFile(definition.id, serialized);
    }
  }

  private async loadRow(id: ConfigDocumentId): Promise<MySqlConfigDocumentRow | null> {
    const [rows] = await this.pool.query<MySqlConfigDocumentRow[]>(
      `SELECT document_id, content_json, version, exported_at, created_at, updated_at
       FROM \`${MYSQL_CONFIG_DOCUMENT_TABLE}\`
       WHERE document_id = ?
       LIMIT 1`,
      [id]
    );

    return rows[0] ?? null;
  }
}

export async function createConfiguredConfigCenterStore(
  env: NodeJS.ProcessEnv = process.env,
  rootDir = resolve(process.cwd(), "configs")
): Promise<ConfigCenterStore> {
  const mysqlConfig = readMySqlPersistenceConfig(env);
  if (!mysqlConfig) {
    return new FileSystemConfigCenterStore(rootDir);
  }

  return MySqlConfigCenterStore.create(mysqlConfig, rootDir);
}

export function registerConfigCenterRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
    put: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: ConfigCenterStore
): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/config-center/configs", async (_request, response) => {
    try {
      sendJson(response, 200, {
        storage: store.mode,
        items: await store.listDocuments()
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/config-center/configs/:id", async (request, response) => {
    const configId = request.params.id;
    if (!configId) {
      sendNotFound(response);
      return;
    }

    const definition = configDefinitionFor(configId);
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      sendJson(response, 200, {
        storage: store.mode,
        document: await store.loadDocument(definition.id)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/config-center/configs/:id/preview", async (request, response) => {
    const configId = request.params.id;
    if (configId !== "world") {
      sendJson(response, 404, {
        error: {
          code: "preview_not_supported",
          message: "Preview is currently available only for world config"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { content?: string; seed?: number };
      if (typeof body.content !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: content"
          }
        });
        return;
      }

      const worldConfig = parseConfigDocument("world", body.content) as WorldGenerationConfig;
      const mapObjectsDocument = await store.loadDocument("mapObjects");
      const mapObjectsConfig = parseConfigDocument("mapObjects", mapObjectsDocument.content) as MapObjectsConfig;
      const preview = createWorldConfigPreview(worldConfig, mapObjectsConfig, normalizePreviewSeed(body.seed));

      sendJson(response, 200, {
        storage: store.mode,
        preview
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/config-center/configs/:id/validate", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { content?: string };
      if (typeof body.content !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: content"
          }
        });
        return;
      }

      sendJson(response, 200, {
        storage: store.mode,
        validation: await store.validateDocument(definition.id, body.content)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/config-center/configs/:id/snapshots", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const [snapshots, publishHistory] = await Promise.all([
        store.listSnapshots(definition.id),
        store.listPublishHistory(definition.id)
      ]);
      sendJson(response, 200, {
        storage: store.mode,
        snapshots,
        publishHistory
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/config-center/publish-stage", async (_request, response) => {
    try {
      sendJson(response, 200, {
        storage: store.mode,
        stage: await store.getStagedDraft()
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/config-center/publish-history", async (_request, response) => {
    try {
      sendJson(response, 200, {
        storage: store.mode,
        history: await store.listPublishAuditHistory()
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/config-center/publish-stage", async (request, response) => {
    try {
      const body = (await readJsonBody(request)) as {
        documents?: Array<{ id?: string; content?: string }>;
      };
      if (!Array.isArray(body.documents)) {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected array field: documents"
          }
        });
        return;
      }

      const documents: ConfigStageDocumentInput[] = body.documents.map((entry) => {
        if (typeof entry.id !== "string" || typeof entry.content !== "string") {
          throw new Error("Expected staged draft entries with string id and content");
        }
        const definition = configDefinitionFor(entry.id);
        if (!definition) {
          throw new Error(`Unsupported config id: ${entry.id}`);
        }
        return {
          id: definition.id,
          content: entry.content
        };
      });

      sendJson(response, 200, {
        storage: store.mode,
        stage: await store.saveStagedDraft(documents)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/config-center/publish-stage/publish", async (request, response) => {
    try {
      const body = (await readJsonBody(request)) as { author?: string; summary?: string };
      if (typeof body.author !== "string" || !body.author.trim() || typeof body.summary !== "string" || !body.summary.trim()) {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected non-empty strings: author, summary"
          }
        });
        return;
      }

      const result = await store.publishStagedDraft({
        author: body.author.trim(),
        summary: body.summary.trim()
      });
      sendJson(response, 200, {
        storage: store.mode,
        stage: result.stage,
        publish: result.publish
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/config-center/configs/:id/snapshots", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { content?: string; label?: string };
      if (typeof body.content !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: content"
          }
        });
        return;
      }

      sendJson(response, 200, {
        storage: store.mode,
        snapshot: await store.createSnapshot(definition.id, body.content, body.label)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/config-center/configs/:id/rollback", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { snapshotId?: string };
      if (typeof body.snapshotId !== "string" || !body.snapshotId.trim()) {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: snapshotId"
          }
        });
        return;
      }

      sendJson(response, 200, {
        storage: store.mode,
        document: await store.rollbackToSnapshot(definition.id, body.snapshotId)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/config-center/configs/:id/diff", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { snapshotId?: string };
      if (typeof body.snapshotId !== "string" || !body.snapshotId.trim()) {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: snapshotId"
          }
        });
        return;
      }

      sendJson(response, 200, {
        storage: store.mode,
        diff: await store.diffWithSnapshot(definition.id, body.snapshotId)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/config-center/configs/:id/presets", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      sendJson(response, 200, {
        storage: store.mode,
        presets: await store.listPresets(definition.id)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/config-center/configs/:id/presets", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { name?: string; content?: string };
      if (typeof body.name !== "string" || typeof body.content !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string fields: name, content"
          }
        });
        return;
      }

      sendJson(response, 200, {
        storage: store.mode,
        preset: await store.savePreset(definition.id, body.name, body.content)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/config-center/configs/:id/presets/:presetId/apply", async (request, response) => {
    const configId = request.params.id;
    const presetId = request.params.presetId;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition || !presetId) {
      sendNotFound(response);
      return;
    }

    try {
      sendJson(response, 200, {
        storage: store.mode,
        document: await store.applyPreset(definition.id, presetId)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/config-center/configs/:id/export", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const requestUrl = new URL(request.url ?? "", "http://localhost");
      const requestedFormat = requestUrl.searchParams.get("format");
      const format = requestedFormat === "jsonc" || requestedFormat === "csv" ? requestedFormat : "xlsx";
      const exported = await store.exportDocument(definition.id, format);
      response.statusCode = 200;
      response.setHeader("Content-Type", exported.contentType);
      response.setHeader("Content-Disposition", `attachment; filename="${exported.fileName}"`);
      response.setHeader("X-Config-Exported-At", exported.exportedAt);
      response.end(exported.body);
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/config-center/configs/:id/import", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { workbookBase64?: string };
      if (typeof body.workbookBase64 !== "string" || !body.workbookBase64.trim()) {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: workbookBase64"
          }
        });
        return;
      }

      sendJson(response, 200, {
        storage: store.mode,
        document: await store.importDocumentFromWorkbook(definition.id, Buffer.from(body.workbookBase64, "base64"))
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/config-center/configs/:id", async (request, response) => {
    const configId = request.params.id;
    if (!configId) {
      sendNotFound(response);
      return;
    }

    const definition = configDefinitionFor(configId);
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { content?: string };
      if (typeof body.content !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: content"
          }
        });
        return;
      }

      const current = await store.loadDocument(definition.id);
      const diffEntries = buildConfigDiffEntries(definition.id, current.content, body.content);

      sendJson(response, 200, {
        storage: store.mode,
        document: await store.saveDocument(definition.id, body.content),
        impactSummary: buildConfigImpactSummary(definition.id, definition.title, diffEntries)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });
}
