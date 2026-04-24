import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "mysql2/promise";
import type { BattleBalanceConfig, BattleSkillCatalogConfig, MapObjectsConfig, UnitCatalogConfig, WorldGenerationConfig } from "@veil/shared/models";
import type { FeatureFlagConfigDocument } from "@veil/shared/platform";
import { replaceRuntimeConfigs, type RuntimeConfigBundle } from "@veil/shared/world";
import { applyFeatureFlagRuntimeConfig } from "@server/domain/battle/feature-flags";
import { parseLeaderboardTierThresholdsConfigDocument, type LeaderboardTierThresholdsConfigDocument } from "@server/domain/social/leaderboard-tier-thresholds";
import {
  MYSQL_CONFIG_DOCUMENT_TABLE,
  MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX,
  type MySqlPersistenceConfig,
  readMySqlPersistenceConfig
} from "@server/persistence";
import { createTrackedMySqlPool } from "@server/infra/mysql-pool";
import type {
  ConfigCenterStore,
  ConfigDocument,
  ConfigDocumentId,
  ConfigDocumentSummary,
  ConfigDiff,
  ConfigDiffPreview,
  ConfigPresetSummary,
  ConfigPublishAuditChange,
  ConfigPublishAuditEvent,
  ConfigPublishChangeRuntimeStatus,
  ConfigPublishChangeSummary,
  ConfigPublishEventSummary,
  ConfigPublishHistoryEntry,
  ConfigPublishResultStatus,
  ConfigSnapshotSummary,
  ConfigStageDocumentInput,
  ConfigStageState,
  LiveOpsRuntimeDocument,
  LiveOpsRuntimeDocumentId,
  MySqlConfigDocumentRow,
  ParsedConfigDocument,
  RuntimeConfigDocumentId,
  ValidationReport
} from "@server/domain/config-center/types";
import {
  CONFIG_CENTER_LIBRARY_FILE,
  CONFIG_DEFINITIONS,
  MAX_PUBLISH_HISTORY_ENTRIES,
  MAX_STAGE_DOCUMENTS,
  RUNTIME_CONFIG_DOCUMENT_IDS,
  type ConfigCenterLibraryState,
  type ConfigPresetRecord,
  type ConfigSnapshotRecord,
  type ConfigStageDocumentRecord,
  type ConfigStageRecord
} from "@server/domain/config-center/constants";
import {
  buildAutomaticSnapshotLabel,
  configDefinitionFor,
  createConfigHash,
  createEmptyLibraryState,
  createId,
  formatTimestamp,
  normalizeJsonContent
} from "@server/domain/config-center/helpers";
import {
  buildConfigDiffEntries,
  buildConfigImpactSummary,
  createConfigDiffPreview
} from "@server/domain/config-center/diff";
import { CONFIG_DOCUMENT_SCHEMAS, buildSchemaSummary } from "@server/domain/config-center/schemas";
import {
  buildCommentedJson,
  buildCsvForDocument,
  buildWorkbookForDocument,
  parseWorkbookToContent
} from "@server/domain/config-center/workbook";
import {
  getBuiltinPresetSummaries,
  resolveBuiltinPresetContent
} from "@server/domain/config-center/presets";
import {
  buildRuntimeBundleWithParsedDocument,
  contentForDocumentId,
  parseConfigDocument
} from "@server/domain/config-center/preview";
import {
  applyRuntimeBundle,
  assertRuntimeBundleHotReloadCompatible,
  buildRuntimeConfigBundle,
  clearConfigRollbackMonitor,
  currentConfigRuntimeApplyResult,
  initializeAppliedRuntimeBundle,
  notifyConfigUpdateListeners,
  serializeBundleDocument,
  synchronizePendingRuntimeBundle
} from "@server/domain/config-center/runtime";
import type { ConfigDefinition } from "@server/domain/config-center/types";
import { buildSummary, isRuntimeConfigDocumentId } from "@server/domain/config-center/helpers";
import { validateDocumentDetailed } from "@server/domain/config-center/validators";

const LIVE_OPS_RUNTIME_DOCUMENTS: Record<LiveOpsRuntimeDocumentId, { fileName: string }> = {
  liveOpsCalendar: { fileName: "live-ops-calendar.json" },
  launchRuntimeState: { fileName: "announcements.json" }
};

export abstract class BaseConfigCenterStore implements ConfigCenterStore {
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

  protected runtimeStateFilePathFor(id: LiveOpsRuntimeDocumentId): string {
    return resolve(this.rootDir, LIVE_OPS_RUNTIME_DOCUMENTS[id].fileName);
  }

  protected normalizeRuntimeStateDocumentContent(content: string): string {
    return `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
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

  protected applyFeatureFlagDocument(document: ConfigDocument): void {
    const parsed = parseConfigDocument("featureFlags", document.content) as FeatureFlagConfigDocument;
    applyFeatureFlagRuntimeConfig(parsed, {
      configuredPath: `config-center:${this.mode}:featureFlags`,
      sourceUpdatedAt: document.updatedAt
    });
  }

  async initializeRuntimeConfigs(): Promise<void> {
    const documents = await Promise.all(RUNTIME_CONFIG_DOCUMENT_IDS.map((id) => this.loadDocument(id)));
    const featureFlagDocument = await this.loadDocument("featureFlags");
    const bundle = buildRuntimeConfigBundle(
      Object.fromEntries(
        documents.map((document) => [document.id, parseConfigDocument(document.id, document.content)])
      ) as Partial<RuntimeConfigBundle>
    );

    clearConfigRollbackMonitor();
    initializeAppliedRuntimeBundle(bundle);
    this.applyFeatureFlagDocument(featureFlagDocument);
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
    return [...(state.publishHistory[id] ?? [])].map((entry) => ({
      ...entry,
      candidate: entry.candidate ?? null,
      revision: entry.revision ?? null
    }));
  }

  async listPublishAuditHistory(): Promise<ConfigPublishAuditEvent[]> {
    const state = await this.readLibraryState();
    return [...(state.publishAuditHistory ?? [])]
      .map((entry) => ({
        ...entry,
        candidate: entry.candidate ?? null,
        revision: entry.revision ?? null
      }))
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  }

  async getStagedDraft(): Promise<ConfigStageState | null> {
    const state = await this.readLibraryState();
    if (!state.stagedDraft) {
      return null;
    }
    const previewHash = await this.computeStagePreviewHash(state.stagedDraft);
    if (state.stagedDraft.previewHash !== previewHash) {
      state.stagedDraft.previewHash = previewHash;
      await this.writeLibraryState(state);
    }
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

  async publishStagedDraft(metadata: {
    author: string;
    summary: string;
    candidate?: string | null;
    revision?: string | null;
    confirmedDiffHash?: string | null;
  }): Promise<{
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

    const previewHash = await this.computeStagePreviewHash(staged);
    if (metadata.confirmedDiffHash?.trim() && metadata.confirmedDiffHash.trim() !== previewHash) {
      throw new Error("发布前差异预览已漂移，请先刷新 diff-preview 再重试。");
    }

    const publishId = createId("publish");
    const publishedAt = new Date().toISOString();
    const candidate = metadata.candidate?.trim() ? metadata.candidate.trim() : null;
    const revision = metadata.revision?.trim() ? metadata.revision.trim() : null;
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
      const existingRollbackSnapshot = (state.snapshots[stagedDocument.id] ?? []).find(
        (snapshot) => snapshot.version === fromVersion
      );
      const rollbackSnapshot =
        existingRollbackSnapshot ??
        (() => {
          const snapshot: ConfigSnapshotRecord = {
            id: createId("snapshot"),
            label: `${definition?.title ?? stagedDocument.id} v${fromVersion}（发布前回滚点）`,
            createdAt: publishedAt,
            version: fromVersion,
            content: current.content
          };
          state.snapshots[stagedDocument.id] = [snapshot, ...(state.snapshots[stagedDocument.id] ?? [])].slice(0, 30);
          return snapshot;
        })();
      auditChanges.push({
        documentId: stagedDocument.id,
        title: definition?.title ?? stagedDocument.id,
        fromVersion,
        toVersion: fromVersion,
        changeCount: diffEntries.length,
        structuralChangeCount: structuralCount,
        snapshotId: rollbackSnapshot.id,
        runtimeStatus: "pending",
        runtimeMessage: "等待运行时应用",
        diffSummary: diffEntries.slice(0, 4),
        impactSummary: buildConfigImpactSummary(
          stagedDocument.id,
          definition?.title ?? stagedDocument.id,
          diffEntries
        )
      });

      if (isRuntimeConfigDocumentId(stagedDocument.id)) {
        assertRuntimeBundleHotReloadCompatible(
          buildRuntimeBundleWithParsedDocument(stagedDocument.id, parseConfigDocument(stagedDocument.id, stagedDocument.content))
        );
      }
    }

    try {
      for (const auditChange of auditChanges) {
        const nextContent = stagedContent.get(auditChange.documentId);
        if (typeof nextContent !== "string") {
          throw new Error(`Missing staged document content: ${auditChange.documentId}`);
        }

        const saved = await this.saveDocument(auditChange.documentId, nextContent);
        const toVersion = saved.version ?? auditChange.fromVersion;

        auditChange.toVersion = toVersion;
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
          candidate,
          revision,
          publishedAt,
          fromVersion: auditChange.fromVersion,
          toVersion,
          changeCount: auditChange.changeCount,
          structuralChangeCount: auditChange.structuralChangeCount
        });
      }

      if (auditChanges.length > 1 && currentConfigRuntimeApplyResult()?.status === "pending") {
        synchronizePendingRuntimeBundle(await this.loadRuntimeBundleFromStore());
      }

      const runtimeApplyResult = currentConfigRuntimeApplyResult();
      const runtimeStatus = runtimeApplyResult?.status === "pending" ? "pending" : "applied";
      const runtimeMessage =
        runtimeApplyResult?.message ?? (runtimeStatus === "pending" ? "等待运行时应用" : "运行时已刷新");
      for (const auditChange of auditChanges) {
        auditChange.runtimeStatus = runtimeStatus;
        auditChange.runtimeMessage = runtimeMessage;
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
        candidate,
        revision,
        publishedAt,
        resultStatus: "applied",
        resultMessage: runtimeMessage,
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
        candidate,
        revision,
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
      valid: stage.documents.every((document) => document.validation.valid),
      previewHash: stage.previewHash
    };
  }

  async previewStagedDiff(id: ConfigDocumentId): Promise<ConfigDiffPreview> {
    const state = await this.readLibraryState();
    const staged = state.stagedDraft;
    if (!staged || staged.documents.length === 0) {
      throw new Error("当前没有待发布的草稿。");
    }

    const stagedDocument = staged.documents.find((document) => document.id === id);
    if (!stagedDocument) {
      throw new Error("当前配置未加入发布草稿。");
    }

    const current = await this.loadDocument(id);
    const diffEntries = buildConfigDiffEntries(id, current.content, stagedDocument.content);
    const grouped = createConfigDiffPreview(diffEntries);
    const definition = configDefinitionFor(id);
    const documentHash = createConfigHash({
      id,
      current: normalizeJsonContent(JSON.parse(current.content) as ParsedConfigDocument),
      staged: stagedDocument.content
    });
    const stageHash = await this.computeStagePreviewHash(staged);

    return {
      documentId: id,
      hash: documentHash,
      stageHash,
      changeCount: grouped.changeCount,
      structuralChangeCount: grouped.structuralChangeCount,
      added: grouped.added,
      modified: grouped.modified,
      removed: grouped.removed,
      impactSummary: buildConfigImpactSummary(id, definition?.title ?? id, diffEntries)
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
      documents: [],
      previewHash: null
    };

    for (const normalized of normalizedDocuments) {
      stageRecord.documents.push({
        id: normalized.id,
        content: normalized.content,
        validation: await validateDocumentDetailed(this, normalized.id, normalized.content, { overrides }),
        updatedAt: timestamp
      });
    }

    stageRecord.previewHash = await this.computeStagePreviewHash(stageRecord);

    return stageRecord;
  }

  private async computeStagePreviewHash(stage: ConfigStageRecord): Promise<string> {
    const hashInput = [];
    for (const document of [...stage.documents].sort((left, right) => left.id.localeCompare(right.id))) {
      const current = await this.loadDocument(document.id);
      hashInput.push({
        id: document.id,
        current: normalizeJsonContent(JSON.parse(current.content) as ParsedConfigDocument),
        staged: document.content
      });
    }
    return createConfigHash(hashInput);
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

  protected async loadRuntimeBundleFromStore(): Promise<RuntimeConfigBundle> {
    const documents = await Promise.all(RUNTIME_CONFIG_DOCUMENT_IDS.map((id) => this.loadDocument(id)));
    return buildRuntimeConfigBundle(
      Object.fromEntries(
        documents.map((document) => [document.id, parseConfigDocument(document.id, document.content)])
      ) as Partial<RuntimeConfigBundle>
    );
  }

  abstract loadDocument(id: ConfigDocumentId): Promise<ConfigDocument>;
  abstract saveDocument(id: ConfigDocumentId, content: string): Promise<ConfigDocument>;
  abstract loadRuntimeStateDocument(id: LiveOpsRuntimeDocumentId): Promise<LiveOpsRuntimeDocument | null>;
  abstract saveRuntimeStateDocument(
    id: LiveOpsRuntimeDocumentId,
    content: string
  ): Promise<LiveOpsRuntimeDocument>;
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
    const bundle = isRuntimeConfigDocumentId(id) ? buildRuntimeBundleWithParsedDocument(id, parsed) : null;
    const serialized = bundle && isRuntimeConfigDocumentId(id) ? serializeBundleDocument(bundle, id) : normalizeJsonContent(parsed);
    const current = await this.loadDocument(id);

    if (current.content === serialized) {
      if (id === "featureFlags") {
        this.applyFeatureFlagDocument(current);
      }
      return current;
    }

    const nextVersion = (current.version ?? 1) + 1;

    await this.exportDocumentToFile(id, serialized);
    await this.setFilesystemVersion(id, nextVersion);
    if (bundle) {
      applyRuntimeBundle(bundle);
    }

    const saved = await this.loadDocument(id);
    if (id === "featureFlags") {
      this.applyFeatureFlagDocument(saved);
    }
    await this.createAutomaticSnapshot(saved);
    return saved;
  }

  async loadRuntimeStateDocument(id: LiveOpsRuntimeDocumentId): Promise<LiveOpsRuntimeDocument | null> {
    const filePath = this.runtimeStateFilePathFor(id);
    try {
      const [content, fileStats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
      return {
        id,
        fileName: LIVE_OPS_RUNTIME_DOCUMENTS[id].fileName,
        updatedAt: fileStats.mtime.toISOString(),
        storage: this.mode,
        version: 1,
        content: this.normalizeRuntimeStateDocumentContent(content)
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async saveRuntimeStateDocument(
    id: LiveOpsRuntimeDocumentId,
    content: string
  ): Promise<LiveOpsRuntimeDocument> {
    const serialized = this.normalizeRuntimeStateDocumentContent(content);
    await this.ensureRootDir();
    await writeFile(this.runtimeStateFilePathFor(id), serialized, "utf8");
    return (await this.loadRuntimeStateDocument(id))!;
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
    const pool = createTrackedMySqlPool("config_center", config);
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
    const bundle = isRuntimeConfigDocumentId(id) ? buildRuntimeBundleWithParsedDocument(id, parsed) : null;
    const serialized = bundle && isRuntimeConfigDocumentId(id) ? serializeBundleDocument(bundle, id) : normalizeJsonContent(parsed);
    const current = await this.loadDocument(id);

    if (current.content === serialized) {
      if (id === "featureFlags") {
        this.applyFeatureFlagDocument(current);
      }
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

    if (id !== "ugcBannedKeywords") {
      await this.exportDocumentToFile(id, serialized);
    }
    if (bundle) {
      applyRuntimeBundle(bundle);
    }

    const saved = await this.loadDocument(id);
    if (id === "featureFlags") {
      this.applyFeatureFlagDocument(saved);
    }
    if (id !== "ugcBannedKeywords") {
      // UGC moderation updates run inside the support-review request path; keep MySQL writes free of root-fs sidecars.
      await this.createAutomaticSnapshot(saved);
    }
    return saved;
  }

  async loadRuntimeStateDocument(id: LiveOpsRuntimeDocumentId): Promise<LiveOpsRuntimeDocument | null> {
    const row = await this.loadRow(id);
    if (!row) {
      return null;
    }
    return {
      id,
      fileName: LIVE_OPS_RUNTIME_DOCUMENTS[id].fileName,
      updatedAt: formatTimestamp(row.updated_at) ?? new Date().toISOString(),
      storage: this.mode,
      version: row.version,
      content: this.normalizeRuntimeStateDocumentContent(row.content_json)
    };
  }

  async saveRuntimeStateDocument(
    id: LiveOpsRuntimeDocumentId,
    content: string
  ): Promise<LiveOpsRuntimeDocument> {
    const serialized = this.normalizeRuntimeStateDocumentContent(content);
    const current = await this.loadRuntimeStateDocument(id);
    if (current?.content === serialized) {
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

    return (await this.loadRuntimeStateDocument(id))!;
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
      if (definition.id !== "ugcBannedKeywords") {
        await this.exportDocumentToFile(definition.id, serialized);
      }
    }
  }

  private async loadRow(id: ConfigDocumentId | LiveOpsRuntimeDocumentId): Promise<MySqlConfigDocumentRow | null> {
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
