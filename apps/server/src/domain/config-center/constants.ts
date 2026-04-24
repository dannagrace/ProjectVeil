import type {
  ConfigDefinition,
  ConfigDocumentId,
  ConfigDiffChangeKind,
  ConfigImpactRiskLevel,
  ConfigPublishAuditEvent,
  ConfigPublishHistoryEntry,
  ValidationReport
} from "@server/domain/config-center/types";
import type { RuntimeConfigBundle } from "@veil/shared/world";

export const CONFIG_DEFINITIONS: ConfigDefinition[] = [
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
  },
  {
    id: "featureFlags",
    fileName: "feature-flags.json",
    title: "Feature Flags",
    description: "功能开关、灰度策略、客户端最低版本与运行时 kill-switch。"
  },
  {
    id: "leaderboardTierThresholds",
    fileName: "leaderboard-tier-thresholds.json",
    title: "排行榜段位阈值",
    description: "排行榜 tier 展示与运营调参使用的评分阈值。"
  },
  {
    id: "ugcBannedKeywords",
    fileName: "ugc-banned-keywords.json",
    title: "UGC 敏感词",
    description: "UGC 人工复核阈值、白名单词与候选敏感词。"
  }
];

export const RUNTIME_CONFIG_DOCUMENT_IDS = ["world", "mapObjects", "units", "battleSkills", "battleBalance"] as const;

export interface ConfigSnapshotRecord {
  id: string;
  label: string;
  createdAt: string;
  version: number;
  content: string;
}

export interface ConfigPresetRecord {
  id: string;
  name: string;
  updatedAt: string;
  description: string;
  content: string;
}

export interface ConfigStageDocumentRecord {
  id: ConfigDocumentId;
  content: string;
  validation: ValidationReport;
  updatedAt: string;
}

export interface ConfigStageRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  documents: ConfigStageDocumentRecord[];
  previewHash: string | null;
}

export interface ConfigCenterLibraryState {
  filesystemVersions: Partial<Record<ConfigDocumentId, number>>;
  filesystemExports: Partial<Record<ConfigDocumentId, string>>;
  snapshots: Partial<Record<ConfigDocumentId, ConfigSnapshotRecord[]>>;
  presets: Partial<Record<ConfigDocumentId, ConfigPresetRecord[]>>;
  stagedDraft: ConfigStageRecord | null;
  publishHistory: Partial<Record<ConfigDocumentId, ConfigPublishHistoryEntry[]>>;
  publishAuditHistory: ConfigPublishAuditEvent[];
}

export interface FlattenedConfigEntry {
  path: string;
  type: string;
  displayValue: string;
  jsonValue: string;
  description?: string;
}

export interface JsonSchemaNode {
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

export interface ConfigHotReloadRoomState {
  roomId: string;
  activeBattles: number;
}

export interface ConfigHotReloadRuntimeSnapshot {
  rooms: ConfigHotReloadRoomState[];
  activeBattleCount: number;
}

export interface ConfigCenterTimerHandle {
  unref?(): void;
}

export interface ConfigCenterRuntimeDependencies {
  now(): number;
  setTimeout(handler: () => void, delayMs: number): ConfigCenterTimerHandle;
  clearTimeout(handle: ConfigCenterTimerHandle): void;
}

export interface ConfigRuntimeApplyResult {
  status: "applied" | "pending";
  message: string;
}

export interface PendingRuntimeBundleState {
  bundle: RuntimeConfigBundle;
  queuedAt: string;
  previousBundle: RuntimeConfigBundle | null;
  delayedRooms: ConfigHotReloadRoomState[];
}

export interface ConfigRollbackMonitorState {
  previousBundle: RuntimeConfigBundle;
  appliedAtMs: number;
  appliedAt: string;
  windowMs: number;
  handle: ConfigCenterTimerHandle;
}

export const CONFIG_CENTER_LIBRARY_FILE = ".config-center-library.json";
export const MAX_STAGE_DOCUMENTS = 5;
export const MAX_PUBLISH_HISTORY_ENTRIES = 20;
export const DEFAULT_CONFIG_HOT_RELOAD_MONITOR_WINDOW_MS = 120_000;
export const CONFIG_HOT_RELOAD_ERROR_THRESHOLD = 3;
export const BUILTIN_DIFFICULTY_PRESET_IDS = ["easy", "normal", "hard"] as const;
export const BUILTIN_WORLD_LAYOUT_PRESETS = [
  "layout_phase1",
  "layout_frontier_basin",
  "layout_stonewatch_fork",
  "layout_ridgeway_crossing",
  "layout_highland_reach",
  "layout_amber_fields",
  "layout_ironpass_gorge",
  "layout_splitrock_canyon",
  "layout_contested_basin",
  "layout_phase2_frontier_expanded"
] as const;
export const BUILTIN_MAP_OBJECT_LAYOUT_PRESETS = [
  "layout_phase1",
  "layout_frontier_basin",
  "layout_stonewatch_fork",
  "layout_ridgeway_crossing",
  "layout_highland_reach",
  "layout_amber_fields",
  "layout_ironpass_gorge",
  "layout_splitrock_canyon",
  "layout_contested_basin",
  "layout_phase2_frontier_expanded"
] as const;
export const CONFIG_SCHEMA_VERSION = "2026-03-26";
export const BASE_VALUE_IMPACT = ["配置台编辑器"];
export const BASE_SCHEMA_IMPACT = ["配置台编辑器", "Schema 校验器"];
export const CONFIG_RUNTIME_IMPACT: Record<ConfigDocumentId, string[]> = {
  world: ["世界预览", "地图生成器", "房间校验器"],
  mapObjects: ["地图对象编辑器", "世界预览"],
  units: ["战斗模拟器", "招募面板"],
  battleSkills: ["技能编辑器", "战斗模拟器"],
  battleBalance: ["战斗平衡计算", "PVP 匹配"],
  featureFlags: ["功能开关", "灰度发布", "运行时 kill-switch"],
  leaderboardTierThresholds: ["排行榜展示", "赛季运营调参"],
  ugcBannedKeywords: ["UGC 人工复核队列", "客服审核后台"]
};
export const CONFIG_IMPACT_RULES: Record<
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
  },
  featureFlags: {
    defaultRisk: "medium",
    impactedModules: ["功能开关", "灰度发布", "客户端版本门禁", "运行时 kill-switch"],
    suggestedValidationActions: ["runtime feature-flags GET", "runtime kill-switches GET", "目标渠道 smoke"]
  },
  leaderboardTierThresholds: {
    defaultRisk: "medium",
    impactedModules: ["排行榜展示", "赛季 reset 调参", "运营阈值发布"],
    suggestedValidationActions: ["排行榜 API smoke", "赛季阈值回归检查"]
  },
  ugcBannedKeywords: {
    defaultRisk: "medium",
    impactedModules: ["UGC 复核队列", "客服审核后台", "玩家昵称/公会/聊天审核"],
    suggestedValidationActions: ["UGC 审核队列回归", "客服拒绝流程 smoke"]
  }
};
