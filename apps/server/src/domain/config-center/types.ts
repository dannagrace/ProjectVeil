import type { RowDataPacket } from "mysql2/promise";
import type { BattleBalanceConfig, BattleSkillCatalogConfig, MapObjectsConfig, ResourceKind, TerrainType, UnitCatalogConfig, WorldGenerationConfig } from "@veil/shared/models";
import type { ContentPackValidationReport, RuntimeConfigBundle } from "@veil/shared/world";
import type { LeaderboardTierThresholdsConfigDocument } from "../../leaderboard-tier-thresholds";

export type ConfigDocumentId =
  | "world"
  | "mapObjects"
  | "units"
  | "battleSkills"
  | "battleBalance"
  | "leaderboardTierThresholds";

export type RuntimeConfigDocumentId = "world" | "mapObjects" | "units" | "battleSkills" | "battleBalance";

export interface ConfigDefinition {
  id: ConfigDocumentId;
  fileName: string;
  title: string;
  description: string;
}

export type ParsedConfigDocument =
  | WorldGenerationConfig
  | MapObjectsConfig
  | UnitCatalogConfig
  | BattleSkillCatalogConfig
  | BattleBalanceConfig
  | LeaderboardTierThresholdsConfigDocument;

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface MySqlConfigDocumentRow extends RowDataPacket {
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

export interface ConfigDiffPreviewAddedEntry {
  key: string;
  after: string;
  kind: ConfigDiffChangeKind;
  required: boolean;
  fieldType: string;
  description: string;
  blastRadius: string[];
}

export interface ConfigDiffPreviewModifiedEntry {
  key: string;
  before: string;
  after: string;
  kind: ConfigDiffChangeKind;
  required: boolean;
  fieldType: string;
  description: string;
  blastRadius: string[];
}

export interface ConfigDiffPreviewRemovedEntry {
  key: string;
  before: string;
  kind: ConfigDiffChangeKind;
  required: boolean;
  fieldType: string;
  description: string;
  blastRadius: string[];
}

export interface ConfigDiffPreview {
  documentId: ConfigDocumentId;
  hash: string;
  stageHash: string;
  changeCount: number;
  structuralChangeCount: number;
  added: ConfigDiffPreviewAddedEntry[];
  modified: ConfigDiffPreviewModifiedEntry[];
  removed: ConfigDiffPreviewRemovedEntry[];
  impactSummary: ConfigImpactSummary | null;
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
  candidate: string | null;
  revision: string | null;
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
  candidate: string | null;
  revision: string | null;
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
  previewHash: string | null;
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
  previewStagedDiff(id: ConfigDocumentId): Promise<ConfigDiffPreview>;
  publishStagedDraft(metadata: {
    author: string;
    summary: string;
    candidate?: string | null;
    revision?: string | null;
    confirmedDiffHash?: string | null;
  }): Promise<{
    stage: ConfigStageState | null;
    publish: ConfigPublishEventSummary;
  }>;
  close(): Promise<void>;
  readonly mode: "filesystem" | "mysql";
}
