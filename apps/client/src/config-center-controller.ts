type ConfigDocumentId = "world" | "mapObjects" | "units" | "battleSkills" | "battleBalance";

interface ConfigDocumentSummary {
  id: ConfigDocumentId;
  title: string;
  description: string;
  fileName: string;
  updatedAt: string;
  summary: string;
  storage?: "filesystem" | "mysql";
  version?: number;
  exportedAt?: string | null;
}

interface ConfigDocument extends ConfigDocumentSummary {
  content: string;
}

interface ValidationIssue {
  documentId?: ConfigDocumentId;
  path: string;
  severity: "error" | "warning";
  message: string;
  suggestion: string;
  line?: number;
}

interface ConfigSchemaSummary {
  id: string;
  title: string;
  version: string;
  description: string;
  required: string[];
}

interface ValidationReport {
  valid: boolean;
  summary: string;
  issues: ValidationIssue[];
  schema: ConfigSchemaSummary;
  contentPack: {
    schemaVersion: 1;
    valid: boolean;
    summary: string;
    issueCount: number;
    checkedDocuments: ConfigDocumentId[];
    issues: ValidationIssue[];
  };
}

interface ConfigSnapshotSummary {
  id: string;
  label: string;
  createdAt: string;
  version: number;
}

type ConfigDiffChangeKind = "value" | "field_added" | "field_removed" | "type_changed" | "enum_changed";

interface ConfigDiffEntry {
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

interface ConfigDiff {
  entries: ConfigDiffEntry[];
}

interface ConfigPresetSummary {
  id: string;
  name: string;
  kind: "builtin" | "custom";
  updatedAt: string;
  description: string;
}

interface ConfigPublishHistoryEntry {
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

type ConfigPublishResultStatus = "applied" | "failed";
type ConfigPublishChangeRuntimeStatus = "applied" | "failed" | "pending";

interface ConfigPublishAuditChange {
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
}

interface ConfigPublishAuditEvent {
  id: string;
  author: string;
  summary: string;
  publishedAt: string;
  resultStatus: ConfigPublishResultStatus;
  resultMessage: string;
  changes: ConfigPublishAuditChange[];
}

interface ConfigStageDocumentSummary {
  id: ConfigDocumentId;
  title: string;
  fileName: string;
  content: string;
  updatedAt: string;
  validation: ValidationReport;
}

interface ConfigStageState {
  id: string;
  createdAt: string;
  updatedAt: string;
  documents: ConfigStageDocumentSummary[];
  valid: boolean;
}

type TerrainType = "grass" | "dirt" | "sand" | "water";
type ResourceKind = "gold" | "wood" | "ore";

interface WorldConfigPreviewTile {
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

interface WorldConfigPreview {
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

interface ApiErrorPayload {
  error?: {
    message?: string;
  };
}

interface DownloadPayload {
  blob: Blob;
  fileName: string | null;
  exportedAt: string | null;
}

interface AppState {
  items: ConfigDocumentSummary[];
  current: ConfigDocument | null;
  selectedId: ConfigDocumentId | null;
  storageMode: "filesystem" | "mysql" | null;
  loading: boolean;
  saving: boolean;
  statusTone: "neutral" | "success" | "error";
  statusMessage: string;
  draft: string;
  previewSeed: number;
  worldPreview: WorldConfigPreview | null;
  previewLoading: boolean;
  previewError: string;
  validation: ValidationReport | null;
  validationLoading: boolean;
  snapshots: ConfigSnapshotSummary[];
  selectedSnapshotId: string | null;
  snapshotDiff: ConfigDiff | null;
  historyLoading: boolean;
  presets: ConfigPresetSummary[];
  presetsLoading: boolean;
  publishHistory: ConfigPublishHistoryEntry[];
  publishAuditHistory: ConfigPublishAuditEvent[];
  publishAuditFilterId: ConfigDocumentId | "all";
  publishAuditFilterStatus: ConfigPublishResultStatus | "all";
  publishStage: ConfigStageState | null;
  publishStageLoading: boolean;
}

interface ConfigCenterControllerOptions {
  fetch?: typeof fetch;
  onStateChange?: () => void;
  prompt?: (message?: string, defaultValue?: string) => string | null;
  confirm?: (message: string) => boolean;
  download?: (payload: DownloadPayload & { fallbackFileName: string }) => void;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  now?: () => string;
}

export interface DraftParseState {
  valid: boolean;
  detail: string;
  rootKeys: number;
}

const WORLD_PREVIEW_DEBOUNCE_MS = 260;
export const MAX_STAGE_DOCUMENTS = 5;
const DIFF_KIND_LABELS: Record<ConfigDiffChangeKind, string> = {
  value: "字段值变更",
  field_added: "新增字段",
  field_removed: "删除字段",
  type_changed: "字段类型变更",
  enum_changed: "枚举约束变更"
};

function labelForDiffKind(kind: ConfigDiffChangeKind): string {
  return DIFF_KIND_LABELS[kind] ?? "字段值变更";
}

function structuralDiffEntries(diff: ConfigDiff | null): ConfigDiffEntry[] {
  return diff?.entries.filter((entry) => entry.kind !== "value") ?? [];
}

function buildDiffConfirmationMessage(snapshotId: string, diff: ConfigDiff | null): string {
  if (!diff) {
    return `确认将当前配置回滚到快照 ${snapshotId} 并立即刷新运行时配置？`;
  }
  if (diff.entries.length === 0) {
    return `快照 ${snapshotId} 与当前版本没有差异。仍要继续回滚并刷新运行时配置？`;
  }

  const structural = structuralDiffEntries(diff);
  const total = diff.entries.length;
  const focus = structural.length > 0 ? structural : diff.entries;
  const lines = focus.slice(0, 3).map((entry) => {
    const impact = entry.blastRadius.length ? `影响：${entry.blastRadius.join(" / ")}` : "";
    return `• ${entry.path}（${labelForDiffKind(entry.kind)}）${impact ? ` ${impact}` : ""}`;
  });
  const overflow =
    focus.length > 3 || (structural.length === 0 && diff.entries.length > 3) ? "• ..." : "";
  const headline =
    structural.length > 0
      ? `警告：将应用 ${total} 项变更，其中 ${structural.length} 项为结构风险。`
      : `将应用 ${total} 项字段变更。`;
  return [headline, ...lines, overflow, "确认继续并立即刷新运行时配置？"].filter(Boolean).join("\n");
}

const EMPTY_SCHEMA_SUMMARY: ConfigSchemaSummary = {
  id: "project-veil.config-center.unknown",
  title: "Unknown Schema",
  version: "0",
  description: "Schema 信息暂不可用。",
  required: []
};

const EMPTY_CONTENT_PACK_REPORT: ValidationReport["contentPack"] = {
  schemaVersion: 1,
  valid: true,
  summary: "Content-pack consistency information is not available yet.",
  issueCount: 0,
  checkedDocuments: ["world", "mapObjects", "units", "battleSkills", "battleBalance"],
  issues: []
};

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function createConfigCenterController(options: ConfigCenterControllerOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const notify = options.onStateChange ?? (() => {});
  const promptImpl = options.prompt ?? (() => null);
  const confirmImpl =
    options.confirm ??
    (typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm.bind(window) : () => true);
  const downloadImpl = options.download ?? (() => {});
  const setTimer = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const now = options.now ?? (() => new Date().toISOString());

  const state: AppState = {
    items: [],
    current: null,
    selectedId: null,
    storageMode: null,
    loading: true,
    saving: false,
    statusTone: "neutral",
    statusMessage: "正在加载配置中心...",
    draft: "",
    previewSeed: 1001,
    worldPreview: null,
    previewLoading: false,
    previewError: "",
    validation: null,
    validationLoading: false,
    snapshots: [],
    selectedSnapshotId: null,
    snapshotDiff: null,
    historyLoading: false,
    presets: [],
    presetsLoading: false,
    publishHistory: [],
    publishAuditHistory: [],
    publishAuditFilterId: "all",
    publishAuditFilterStatus: "all",
    publishStage: null,
    publishStageLoading: false
  };

  let previewRequestVersion = 0;
  let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let validationRequestVersion = 0;
  let validationDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function isWorldDocumentSelected(): boolean {
    return state.current?.id === "world";
  }

  function getDraftParseState(): DraftParseState {
    try {
      const parsed = JSON.parse(state.draft || "{}") as Record<string, unknown>;
      return {
        valid: true,
        detail: "JSON 语法有效",
        rootKeys: Object.keys(parsed).length
      };
    } catch (error) {
      return {
        valid: false,
        detail: error instanceof Error ? error.message : "JSON 语法无效",
        rootKeys: 0
      };
    }
  }

  function normalizePreviewSeed(value: number, fallback = state.previewSeed): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(0, Math.floor(value));
  }

  async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(input, init);
    const data = (await response.json()) as T & ApiErrorPayload;

    if (!response.ok) {
      throw new Error(data.error?.message ?? `Request failed: ${response.status}`);
    }

    return data;
  }

  function parseDownloadFileName(headerValue: string | null): string | null {
    if (!headerValue) {
      return null;
    }

    const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }

    const quotedMatch = headerValue.match(/filename=\"([^\"]+)\"/i);
    if (quotedMatch?.[1]) {
      return quotedMatch[1];
    }

    const plainMatch = headerValue.match(/filename=([^;]+)/i);
    return plainMatch?.[1]?.trim() ?? null;
  }

  async function requestDownload(input: RequestInfo, init?: RequestInit): Promise<DownloadPayload> {
    const response = await fetchImpl(input, init);
    if (!response.ok) {
      let errorMessage = `Request failed: ${response.status}`;
      try {
        const data = (await response.json()) as ApiErrorPayload;
        errorMessage = data.error?.message ?? errorMessage;
      } catch {
        // ignore
      }
      throw new Error(errorMessage);
    }

    return {
      blob: await response.blob(),
      fileName: parseDownloadFileName(response.headers.get("Content-Disposition")),
      exportedAt: response.headers.get("X-Config-Exported-At")
    };
  }

  function clearWorldPreview(cancelPending = true): void {
    if (cancelPending && previewDebounceTimer != null) {
      clearTimer(previewDebounceTimer);
      previewDebounceTimer = null;
    }

    previewRequestVersion += 1;
    state.worldPreview = null;
    state.previewLoading = false;
    state.previewError = "";
  }

  function setDraft(nextDraft: string): void {
    state.draft = nextDraft;
  }

  async function loadList(): Promise<void> {
    const response = await requestJson<{
      storage: "filesystem" | "mysql";
      items: ConfigDocumentSummary[];
    }>("/api/config-center/configs");
    state.storageMode = response.storage;
    state.items = response.items;
    notify();
  }

  async function loadSnapshots(id: ConfigDocumentId): Promise<void> {
    state.historyLoading = true;
    notify();
    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        snapshots: ConfigSnapshotSummary[];
        publishHistory?: ConfigPublishHistoryEntry[];
      }>(`/api/config-center/configs/${id}/snapshots`);
      state.storageMode = response.storage;
      state.snapshots = response.snapshots;
      state.publishHistory = response.publishHistory ?? [];
      if (!state.snapshots.some((item) => item.id === state.selectedSnapshotId)) {
        state.selectedSnapshotId = state.snapshots[0]?.id ?? null;
        state.snapshotDiff = null;
      }
    } finally {
      state.historyLoading = false;
      notify();
    }

    if (state.selectedSnapshotId) {
      await loadSnapshotDiff();
    }
  }

  async function loadPresets(id: ConfigDocumentId): Promise<void> {
    state.presetsLoading = true;
    notify();
    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        presets: ConfigPresetSummary[];
      }>(`/api/config-center/configs/${id}/presets`);
      state.storageMode = response.storage;
      state.presets = response.presets;
    } finally {
      state.presetsLoading = false;
      notify();
    }
  }

  async function loadSnapshotDiff(snapshotId = state.selectedSnapshotId): Promise<ConfigDiff | null> {
    if (!state.current || !snapshotId) {
      state.snapshotDiff = null;
      notify();
      return null;
    }

    const response = await requestJson<{
      storage: "filesystem" | "mysql";
      diff: ConfigDiff;
    }>(`/api/config-center/configs/${state.current.id}/diff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        snapshotId
      })
    });
    state.storageMode = response.storage;
    if (snapshotId === state.selectedSnapshotId) {
      state.snapshotDiff = response.diff;
      notify();
    }
    return response.diff;
  }

  async function ensureSnapshotDiff(snapshotId: string): Promise<ConfigDiff | null> {
    if (!state.current) {
      return null;
    }

    if (state.selectedSnapshotId !== snapshotId) {
      state.selectedSnapshotId = snapshotId;
      notify();
    }

    return loadSnapshotDiff(snapshotId);
  }

  async function loadPublishStage(): Promise<void> {
    state.publishStageLoading = true;
    notify();
    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        stage: ConfigStageState | null;
      }>("/api/config-center/publish-stage");
      state.storageMode = response.storage;
      state.publishStage = response.stage ?? null;
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "加载发布草稿失败";
    } finally {
      state.publishStageLoading = false;
      notify();
    }
  }

  async function loadPublishAuditHistory(): Promise<void> {
    state.historyLoading = true;
    notify();
    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        history: ConfigPublishAuditEvent[];
      }>("/api/config-center/publish-history");
      state.storageMode = response.storage;
      state.publishAuditHistory = response.history ?? [];
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "加载发布审计记录失败";
    } finally {
      state.historyLoading = false;
      notify();
    }
  }

  function setPublishAuditFilters(filters: {
    documentId?: ConfigDocumentId | "all";
    resultStatus?: ConfigPublishResultStatus | "all";
  }): void {
    if (filters.documentId) {
      state.publishAuditFilterId = filters.documentId;
    }
    if (filters.resultStatus) {
      state.publishAuditFilterStatus = filters.resultStatus;
    }
    notify();
  }

  async function inspectPublishedSnapshot(documentId: ConfigDocumentId, snapshotId: string): Promise<void> {
    if (!snapshotId) {
      return;
    }

    if (state.current?.id !== documentId) {
      await loadDocument(documentId);
    } else if (state.snapshots.length === 0) {
      await loadSnapshots(documentId);
    }

    state.selectedSnapshotId = snapshotId;
    notify();
    await loadSnapshotDiff(snapshotId);
  }

  async function rollbackPublishedSnapshot(documentId: ConfigDocumentId, snapshotId: string): Promise<void> {
    if (!snapshotId) {
      return;
    }

    if (state.current?.id !== documentId) {
      await loadDocument(documentId);
    }

    await rollbackSnapshot(snapshotId);
  }

  async function persistStageDocuments(
    documents: Array<{ id: ConfigDocumentId; content: string }>,
    successMessage: string
  ): Promise<void> {
    state.publishStageLoading = true;
    state.statusTone = "neutral";
    state.statusMessage = "正在同步发布草稿...";
    notify();

    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        stage: ConfigStageState | null;
      }>("/api/config-center/publish-stage", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ documents })
      });
      state.storageMode = response.storage;
      state.publishStage = response.stage ?? null;
      state.statusTone = "success";
      state.statusMessage = successMessage;
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "更新发布草稿失败";
    } finally {
      state.publishStageLoading = false;
      notify();
    }
  }

  async function stageCurrentDraft(): Promise<void> {
    if (!state.current) {
      return;
    }

    const stagedDocuments = state.publishStage?.documents ?? [];
    const alreadyIncluded = stagedDocuments.some((document) => document.id === state.current?.id);
    if (!alreadyIncluded && stagedDocuments.length >= MAX_STAGE_DOCUMENTS) {
      state.statusTone = "error";
      state.statusMessage = `最多只能准备 ${MAX_STAGE_DOCUMENTS} 个草稿，请先清理后再添加。`;
      notify();
      return;
    }

    const documents = stagedDocuments
      .filter((document) => document.id !== state.current?.id)
      .map((document) => ({
        id: document.id,
        content: document.content
      }));
    documents.push({
      id: state.current.id,
      content: state.draft
    });

    await persistStageDocuments(documents, `${state.current.title} 已加入发布草稿`);
  }

  async function removeDocumentFromStage(documentId: ConfigDocumentId): Promise<void> {
    if (!state.publishStage) {
      return;
    }

    const documents = state.publishStage.documents
      .filter((document) => document.id !== documentId)
      .map((document) => ({
        id: document.id,
        content: document.content
      }));

    await persistStageDocuments(documents, "已移除发布草稿");
  }

  async function clearPublishStage(): Promise<void> {
    if (!state.publishStage || state.publishStage.documents.length === 0) {
      return;
    }
    await persistStageDocuments([], "发布草稿已清空");
  }

  async function publishStageDrafts(): Promise<void> {
    const stage = state.publishStage;
    if (!stage || stage.documents.length === 0) {
      state.statusTone = "error";
      state.statusMessage = "当前没有待发布的草稿。";
      notify();
      return;
    }

    if (!stage.valid) {
      state.statusTone = "error";
      state.statusMessage = "草稿存在校验问题，发布前需要先修复。";
      notify();
      return;
    }

    const author = promptImpl("发布人（用于记录到历史）", "ConfigOps")?.trim();
    if (!author) {
      state.statusTone = "neutral";
      state.statusMessage = "已取消发布（未填写发布人）。";
      notify();
      return;
    }

    const summary = promptImpl("发布说明（记录变更摘要）", "描述本次调参目的")?.trim();
    if (!summary) {
      state.statusTone = "neutral";
      state.statusMessage = "已取消发布（未填写发布说明）。";
      notify();
      return;
    }

    const publishedDocumentIds = stage.documents.map((document) => document.id);
    state.publishStageLoading = true;
    state.statusTone = "neutral";
    state.statusMessage = "正在发布配置...";
    notify();

    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        stage: ConfigStageState | null;
        publish: {
          id: string;
          author: string;
          summary: string;
          publishedAt: string;
          changes: Array<{ documentId: ConfigDocumentId }>;
        };
      }>("/api/config-center/publish-stage/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          author,
          summary
        })
      });
      state.storageMode = response.storage;
      state.publishStage = response.stage ?? null;
      state.statusTone = "success";
      state.statusMessage = `已发布 ${response.publish.changes.length} 个草稿，并刷新运行时配置。`;
      await loadPublishAuditHistory();
      const activeDocumentId = state.current?.id ?? null;
      await loadList();
      if (activeDocumentId && publishedDocumentIds.includes(activeDocumentId)) {
        await loadDocument(activeDocumentId);
      } else if (activeDocumentId) {
        await loadSnapshots(activeDocumentId);
      }
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "发布草稿失败";
    } finally {
      state.publishStageLoading = false;
      notify();
    }
  }

  async function loadWorldPreview(): Promise<void> {
    if (!isWorldDocumentSelected()) {
      clearWorldPreview();
      notify();
      return;
    }

    const parseState = getDraftParseState();
    if (!parseState.valid) {
      state.previewLoading = false;
      state.worldPreview = null;
      state.previewError = `JSON 语法无效：${parseState.detail}`;
      notify();
      return;
    }

    const requestVersion = ++previewRequestVersion;

    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        preview: WorldConfigPreview;
      }>("/api/config-center/configs/world/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          content: state.draft,
          seed: state.previewSeed
        })
      });

      if (requestVersion !== previewRequestVersion || !isWorldDocumentSelected()) {
        return;
      }

      state.storageMode = response.storage;
      state.worldPreview = response.preview;
      state.previewError = "";
    } catch (error) {
      if (requestVersion !== previewRequestVersion) {
        return;
      }

      state.worldPreview = null;
      state.previewError = error instanceof Error ? error.message : "地图预览生成失败";
    } finally {
      if (requestVersion === previewRequestVersion) {
        state.previewLoading = false;
        notify();
      }
    }
  }

  async function loadValidation(delayMs = 0): Promise<void> {
    if (!state.current) {
      state.validation = null;
      notify();
      return;
    }

    if (validationDebounceTimer != null) {
      clearTimer(validationDebounceTimer);
      validationDebounceTimer = null;
    }

    const run = async () => {
      const requestVersion = ++validationRequestVersion;
      state.validationLoading = true;
      notify();

      try {
        const response = await requestJson<{
          storage: "filesystem" | "mysql";
          validation: ValidationReport;
        }>(`/api/config-center/configs/${state.current?.id}/validate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            content: state.draft
          })
        });

        if (requestVersion !== validationRequestVersion) {
          return;
        }

        state.storageMode = response.storage;
        state.validation = response.validation;
      } catch (error) {
        if (requestVersion !== validationRequestVersion) {
          return;
        }

        state.validation = {
          valid: false,
          summary: error instanceof Error ? error.message : "校验失败",
          issues: [
            {
              path: "$",
              severity: "error",
              message: error instanceof Error ? error.message : "校验失败",
              suggestion: "检查 JSON 语法和字段格式后重试。"
            }
          ],
          schema: state.validation?.schema ?? EMPTY_SCHEMA_SUMMARY,
          contentPack: state.validation?.contentPack ?? EMPTY_CONTENT_PACK_REPORT
        };
      } finally {
        if (requestVersion === validationRequestVersion) {
          state.validationLoading = false;
          notify();
        }
      }
    };

    if (delayMs <= 0) {
      await run();
      return;
    }

    validationDebounceTimer = setTimer(() => {
      validationDebounceTimer = null;
      void run();
    }, delayMs);
  }

  function scheduleWorldPreview(delayMs = WORLD_PREVIEW_DEBOUNCE_MS): void {
    if (!isWorldDocumentSelected()) {
      clearWorldPreview();
      notify();
      return;
    }

    if (previewDebounceTimer != null) {
      clearTimer(previewDebounceTimer);
      previewDebounceTimer = null;
    }

    const parseState = getDraftParseState();
    if (!parseState.valid) {
      state.previewLoading = false;
      state.worldPreview = null;
      state.previewError = `JSON 语法无效：${parseState.detail}`;
      notify();
      return;
    }

    state.previewLoading = true;
    state.previewError = "";
    notify();

    previewDebounceTimer = setTimer(() => {
      previewDebounceTimer = null;
      void loadWorldPreview();
    }, delayMs);
  }

  async function loadDocument(id: ConfigDocumentId): Promise<void> {
    state.loading = true;
    state.statusTone = "neutral";
    state.statusMessage = `正在加载 ${id} 配置...`;
    notify();

    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        document: ConfigDocument;
      }>(`/api/config-center/configs/${id}`);
      state.storageMode = response.storage;
      state.current = response.document;
      state.selectedId = response.document.id;
      state.draft = response.document.content;
      state.validation = null;
      state.snapshots = [];
      state.publishHistory = [];
      state.presets = [];
      state.snapshotDiff = null;
      state.selectedSnapshotId = null;
      state.statusMessage = `${response.document.title} 已加载`;

      if (response.document.id === "world") {
        state.worldPreview = null;
        state.previewLoading = true;
        state.previewError = "";
      } else {
        clearWorldPreview();
      }
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "加载配置失败";
    } finally {
      state.loading = false;
      notify();

      if (isWorldDocumentSelected()) {
        void loadWorldPreview();
      }
      void loadValidation();
      void loadSnapshots(id);
      void loadPresets(id);
    }
  }

  async function saveCurrentDocument(): Promise<void> {
    if (!state.current || state.saving) {
      return;
    }

    if (state.validation && !state.validation.valid) {
      state.statusTone = "error";
      state.statusMessage = "当前配置存在校验问题，已阻止保存";
      notify();
      return;
    }

    state.saving = true;
    state.statusTone = "neutral";
    state.statusMessage = `正在保存 ${state.current.title}...`;
    notify();

    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        document: ConfigDocument;
      }>(`/api/config-center/configs/${state.current.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          content: state.draft
        })
      });

      state.storageMode = response.storage;
      state.current = response.document;
      state.draft = response.document.content;
      state.statusTone = "success";
      state.statusMessage = `${response.document.title} 已保存，并同步刷新服务端运行时配置`;
      await loadList();
      await Promise.all([loadSnapshots(response.document.id), loadPresets(response.document.id)]);

      if (response.document.id === "world") {
        state.previewLoading = true;
        state.previewError = "";
      }
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "保存配置失败";
    } finally {
      state.saving = false;
      notify();

      if (isWorldDocumentSelected()) {
        void loadWorldPreview();
      }
    }
  }

  function restoreCurrentDocument(): void {
    if (!state.current) {
      return;
    }

    state.draft = state.current.content;
    state.statusTone = "neutral";
    state.statusMessage = `${state.current.title} 已恢复到上次加载内容`;

    if (isWorldDocumentSelected()) {
      state.previewLoading = true;
      state.previewError = "";
    }

    notify();

    if (isWorldDocumentSelected()) {
      void loadWorldPreview();
    }
    void loadValidation();
  }

  async function createSnapshot(): Promise<void> {
    if (!state.current) {
      return;
    }

    const label = promptImpl("快照名称（可选）", `${state.current.title} v${state.current.version ?? 1}`) ?? "";
    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        snapshot: ConfigSnapshotSummary;
      }>(`/api/config-center/configs/${state.current.id}/snapshots`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          content: state.draft,
          label
        })
      });
      state.storageMode = response.storage;
      state.statusTone = "success";
      state.statusMessage = `已保存快照 ${response.snapshot.label}`;
      await loadSnapshots(state.current.id);
      notify();
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "保存快照失败";
      notify();
    }
  }

  async function rollbackSnapshot(snapshotId: string): Promise<void> {
    if (!state.current) {
      return;
    }

    let diff: ConfigDiff | null = null;
    try {
      diff = await ensureSnapshotDiff(snapshotId);
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "加载快照差异失败";
      notify();
      return;
    }

    const shouldRollback = confirmImpl(buildDiffConfirmationMessage(snapshotId, diff));
    if (!shouldRollback) {
      state.statusTone = "neutral";
      state.statusMessage = "已取消快照回滚";
      notify();
      return;
    }

    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        document: ConfigDocument;
      }>(`/api/config-center/configs/${state.current.id}/rollback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ snapshotId })
      });
      state.storageMode = response.storage;
      state.current = response.document;
      state.draft = response.document.content;
      state.statusTone = "success";
      state.statusMessage = `已回滚到快照 ${snapshotId}`;
      await loadList();
      await Promise.all([loadSnapshots(response.document.id), loadPresets(response.document.id)]);
      notify();
      if (isWorldDocumentSelected()) {
        void loadWorldPreview();
      }
      void loadValidation();
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "回滚快照失败";
      notify();
    }
  }

  async function applyPreset(presetId: string): Promise<void> {
    if (!state.current) {
      return;
    }

    try {
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        document: ConfigDocument;
      }>(`/api/config-center/configs/${state.current.id}/presets/${presetId}/apply`, {
        method: "POST"
      });
      state.storageMode = response.storage;
      state.current = response.document;
      state.draft = response.document.content;
      state.statusTone = "success";
      state.statusMessage = `已应用预设 ${presetId}，运行时配置已刷新`;
      await loadList();
      await Promise.all([loadSnapshots(response.document.id), loadPresets(response.document.id)]);
      notify();
      if (isWorldDocumentSelected()) {
        void loadWorldPreview();
      }
      void loadValidation();
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "应用预设失败";
      notify();
    }
  }

  async function saveCurrentAsPreset(): Promise<void> {
    if (!state.current) {
      return;
    }

    const name = promptImpl("自定义预设名称", `${state.current.title} 自定义预设`);
    if (!name) {
      return;
    }

    try {
      await requestJson<{
        storage: "filesystem" | "mysql";
        preset: ConfigPresetSummary;
      }>(`/api/config-center/configs/${state.current.id}/presets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          content: state.draft
        })
      });
      state.statusTone = "success";
      state.statusMessage = `已保存自定义预设 ${name}`;
      await loadPresets(state.current.id);
      notify();
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "保存预设失败";
      notify();
    }
  }

  async function exportCurrentDocument(format: "xlsx" | "jsonc" | "csv"): Promise<void> {
    if (!state.current) {
      return;
    }

    try {
      const download = await requestDownload(`/api/config-center/configs/${state.current.id}/export?format=${format}`);
      downloadImpl({
        ...download,
        fallbackFileName: `${state.current.id}.${format}`
      });
      if (state.current) {
        state.current.exportedAt = download.exportedAt ?? now();
        const item = state.items.find((entry) => entry.id === state.current?.id);
        if (item) {
          item.exportedAt = state.current.exportedAt;
        }
      }
      state.statusTone = "success";
      state.statusMessage =
        format === "xlsx" ? "已导出 Excel 工作簿" : format === "csv" ? "已导出字段清单 CSV" : "已导出 JSON 注释版";
      notify();
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "导出失败";
      notify();
    }
  }

  async function importWorkbook(file: File): Promise<void> {
    if (!state.current) {
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const response = await requestJson<{
        storage: "filesystem" | "mysql";
        document: ConfigDocument;
      }>(`/api/config-center/configs/${state.current.id}/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workbookBase64: encodeBase64(buffer)
        })
      });
      state.storageMode = response.storage;
      state.current = response.document;
      state.draft = response.document.content;
      state.statusTone = "success";
      state.statusMessage = `已从 ${file.name} 导入并覆盖当前配置`;
      await loadList();
      await Promise.all([loadSnapshots(response.document.id), loadPresets(response.document.id)]);
      notify();
      if (isWorldDocumentSelected()) {
        void loadWorldPreview();
      }
      void loadValidation();
    } catch (error) {
      state.statusTone = "error";
      state.statusMessage = error instanceof Error ? error.message : "Excel 导入失败";
      notify();
    }
  }

  return {
    state,
    getDraftParseState,
    normalizePreviewSeed,
    setDraft,
    clearWorldPreview,
    loadList,
    loadSnapshots,
    loadPresets,
    loadSnapshotDiff,
    loadPublishStage,
    loadPublishAuditHistory,
    loadWorldPreview,
    loadValidation,
    scheduleWorldPreview,
    loadDocument,
    saveCurrentDocument,
    restoreCurrentDocument,
    createSnapshot,
    rollbackSnapshot,
    applyPreset,
    saveCurrentAsPreset,
    exportCurrentDocument,
    importWorkbook,
    stageCurrentDraft,
    removeDocumentFromStage,
    clearPublishStage,
    publishStageDrafts,
    setPublishAuditFilters,
    inspectPublishedSnapshot,
    rollbackPublishedSnapshot,
    parseDownloadFileName
  };
}

export type {
  AppState,
  ConfigDiff,
  ConfigDocument,
  ConfigDocumentId,
  ConfigDocumentSummary,
  ConfigPresetSummary,
  ConfigPublishAuditEvent,
  ConfigPublishAuditChange,
  ConfigPublishHistoryEntry,
  ConfigSchemaSummary,
  ConfigSnapshotSummary,
  ConfigStageState,
  DownloadPayload,
  ValidationIssue,
  ValidationReport,
  WorldConfigPreview,
  WorldConfigPreviewTile
};
