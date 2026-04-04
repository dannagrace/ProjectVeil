import { createConfigCenterController, MAX_STAGE_DOCUMENTS } from "./config-center-controller";

type ConfigDocumentId = "world" | "mapObjects" | "units" | "battleSkills" | "battleBalance";
type TerrainType = "grass" | "dirt" | "sand" | "water";
type ResourceKind = "gold" | "wood" | "ore";
type BattleSkillKind = "active" | "passive";
type BattleSkillTarget = "enemy" | "self";

interface BattleSkillEffectConfig {
  damageMultiplier?: number;
  allowRetaliation?: boolean;
  grantedStatusId?: string;
  onHitStatusId?: string;
}

interface BattleSkillConfig {
  id: string;
  name: string;
  description: string;
  kind: BattleSkillKind;
  target: BattleSkillTarget;
  cooldown: number;
  effects?: BattleSkillEffectConfig;
}

interface BattleStatusEffectConfig {
  id: string;
  name: string;
  description: string;
  duration: number;
  attackModifier: number;
  defenseModifier: number;
  damagePerTurn: number;
}

interface BattleSkillCatalogConfig {
  skills: BattleSkillConfig[];
  statuses: BattleStatusEffectConfig[];
}

interface BattleBalanceConfig {
  damage: {
    defendingDefenseBonus: number;
    offenseAdvantageStep: number;
    minimumOffenseMultiplier: number;
    varianceBase: number;
    varianceRange: number;
  };
  environment: {
    blockerSpawnThreshold: number;
    blockerDurability: number;
    trapSpawnThreshold: number;
    trapDamage: number;
    trapCharges: number;
    trapGrantedStatusId?: string;
  };
  turnTimerSeconds: number;
  afkStrikesBeforeForfeit: number;
  pvp: {
    eloK: number;
  };
}

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

interface ConfigSchemaSummary {
  id: string;
  title: string;
  version: string;
  description: string;
  required: string[];
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

type ConfigImpactRiskLevel = "low" | "medium" | "high";

interface ConfigImpactSummary {
  documentId: ConfigDocumentId;
  title: string;
  summary: string;
  riskLevel: ConfigImpactRiskLevel;
  changedFields: string[];
  impactedModules: string[];
  riskHints: string[];
  suggestedValidationActions: string[];
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
  candidate: string | null;
  revision: string | null;
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
  impactSummary: ConfigImpactSummary | null;
}

interface ConfigPublishAuditEvent {
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
  lastSavedImpactSummary: ConfigImpactSummary | null;
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
  publishAuditFilterCandidate: string;
  publishAuditFilterRevision: string;
  publishStage: ConfigStageState | null;
  publishStageLoading: boolean;
}

const WORLD_PREVIEW_DEBOUNCE_MS = 260;

const RESOURCE_SHORT_LABEL: Record<ResourceKind, string> = {
  gold: "G",
  wood: "W",
  ore: "O"
};

const DIFF_KIND_LABELS: Record<ConfigDiffChangeKind, string> = {
  value: "字段值变更",
  field_added: "新增字段",
  field_removed: "删除字段",
  type_changed: "字段类型变更",
  enum_changed: "枚举约束变更"
};

function diffKindLabel(kind: ConfigDiffChangeKind): string {
  return DIFF_KIND_LABELS[kind] ?? "字段值变更";
}

function isStructuralDiff(entry: ConfigDiffEntry): boolean {
  return entry.kind !== "value";
}

function sortDiffEntries(entries: ConfigDiffEntry[]): ConfigDiffEntry[] {
  return [...entries].sort((left, right) => {
    const riskDelta = Number(isStructuralDiff(right)) - Number(isStructuralDiff(left));
    if (riskDelta !== 0) {
      return riskDelta;
    }
    return left.path.localeCompare(right.path);
  });
}

function countStructuralEntries(diff: ConfigDiff): number {
  return diff.entries.filter(isStructuralDiff).length;
}

function impactRiskLabel(riskLevel: ConfigImpactRiskLevel): string {
  if (riskLevel === "high") {
    return "高风险";
  }
  if (riskLevel === "medium") {
    return "中风险";
  }
  return "低风险";
}

interface ConfigCenterValidationSectionInput {
  currentDocumentId: ConfigDocumentId | null;
  validation: ValidationReport | null;
  validationLoading: boolean;
}

interface ConfigCenterImpactSummarySectionInput {
  currentDocumentId: ConfigDocumentId | null;
  lastSavedImpactSummary: ConfigImpactSummary | null;
}

interface ConfigCenterSnapshotDiffPanelInput {
  selectedSnapshotId: string | null;
  snapshotDiff: ConfigDiff | null;
}

interface ConfigCenterPublishHistorySectionInput {
  publishAuditHistory: ConfigPublishAuditEvent[];
  publishAuditFilterId: ConfigDocumentId | "all";
  publishAuditFilterStatus: ConfigPublishResultStatus | "all";
  publishAuditFilterCandidate: string;
  publishAuditFilterRevision: string;
  historyLoading: boolean;
}

interface ConfigCenterSaveActionState {
  currentDocumentId: ConfigDocumentId | null;
  loading: boolean;
  saving: boolean;
  validationLoading: boolean;
  validation: ValidationReport | null;
}

export function isConfigCenterSaveDisabled({
  currentDocumentId,
  loading,
  saving,
  validationLoading,
  validation
}: ConfigCenterSaveActionState): boolean {
  return !currentDocumentId || loading || saving || validationLoading || !(validation?.valid ?? true);
}

export function renderConfigCenterValidationSection({
  currentDocumentId,
  validation,
  validationLoading
}: ConfigCenterValidationSectionInput): string {
  if (!currentDocumentId) {
    return "";
  }

  const renderSchemaIssues = (issues: ValidationIssue[]) =>
    issues.length > 0
      ? `
        <div class="validation-list">
          ${issues
            .map(
              (issue, index) => `
                <button class="validation-item" data-action="validation-jump" data-index="${index}">
                  <strong>${escapeHtml(issue.path)}</strong>
                  <span>${escapeHtml(issue.message)}</span>
                  <small>${escapeHtml(issue.suggestion)}${issue.line ? ` · 第 ${issue.line} 行` : ""}</small>
                </button>
              `
            )
            .join("")}
        </div>
      `
      : `<p class="config-hint">当前草稿满足 Schema / 运行时校验。</p>`;
  const renderContentPackIssues = (issues: ValidationIssue[]) =>
    issues.length > 0
      ? `
        <div class="validation-list">
          ${issues
            .map(
              (issue) => `
                <div class="validation-item">
                  <strong>${escapeHtml(`${issue.documentId ?? currentDocumentId}:${issue.path}`)}</strong>
                  <span>${escapeHtml(issue.message)}</span>
                  <small>${escapeHtml(issue.suggestion)}</small>
                </div>
              `
            )
            .join("")}
        </div>
      `
      : `<p class="config-hint">当前草稿对应的内容包引用关系保持一致。</p>`;
  const content =
    validationLoading && !validation
      ? `<div class="world-preview-empty">正在进行 Schema 校验...</div>`
      : !validation
        ? `<div class="world-preview-empty">等待校验结果...</div>`
        : `
          <div class="validation-summary ${validation.valid ? "is-valid" : "is-invalid"}">
            <strong>${validation.valid ? "校验通过" : "发现问题"}</strong>
            <span>${escapeHtml(validation.summary)}</span>
          </div>
          <div class="schema-card">
            <strong>${escapeHtml(validation.schema.title)}</strong>
            <span>${escapeHtml(validation.schema.description)}</span>
            <small>${escapeHtml(validation.schema.id)} · v${escapeHtml(validation.schema.version)}</small>
            <small>必填根字段: ${escapeHtml(validation.schema.required.join(", ") || "无")}</small>
          </div>
          <div class="schema-card">
            <strong>内容包一致性</strong>
            <span>${escapeHtml(validation.contentPack.summary)}</span>
            <small>schema v${validation.contentPack.schemaVersion} · ${validation.contentPack.checkedDocuments.length} 个配置面</small>
            <small>${escapeHtml(validation.contentPack.checkedDocuments.join(" / "))}</small>
          </div>
          ${renderSchemaIssues(validation.issues)}
          ${renderContentPackIssues(validation.contentPack.issues)}
        `;

  return `
    <section class="validation-section">
      <div class="config-preview-subhead">
        <h4>配置校验</h4>
        <span class="config-meta">${validation?.valid ? "可提交" : "保存前需修复"}</span>
      </div>
      ${content}
    </section>
  `;
}

export function renderConfigCenterImpactSummarySection({
  currentDocumentId,
  lastSavedImpactSummary
}: ConfigCenterImpactSummarySectionInput): string {
  if (!currentDocumentId || !lastSavedImpactSummary) {
    return "";
  }

  return `
    <section class="history-section">
      <div class="config-preview-subhead">
        <h4>变更影响摘要</h4>
        <span class="config-meta">${impactRiskLabel(lastSavedImpactSummary.riskLevel)}</span>
      </div>
      <p class="config-hint">${escapeHtml(lastSavedImpactSummary.summary)}</p>
      <div class="config-badge-row">
        ${lastSavedImpactSummary.impactedModules.map((label) => `<span class="config-badge">${escapeHtml(label)}</span>`).join("")}
      </div>
      <div class="impact-summary-grid">
        <article class="impact-summary-card">
          <strong>变更字段</strong>
          <span>${escapeHtml(lastSavedImpactSummary.changedFields.join(" / ") || "无")}</span>
        </article>
        <article class="impact-summary-card">
          <strong>潜在风险</strong>
          <span>${escapeHtml(lastSavedImpactSummary.riskHints.join(" / ") || "未检测到额外风险提示")}</span>
        </article>
        <article class="impact-summary-card">
          <strong>建议验证</strong>
          <span>${escapeHtml(lastSavedImpactSummary.suggestedValidationActions.join(" / ") || "无")}</span>
        </article>
      </div>
    </section>
  `;
}

export function renderConfigCenterSnapshotDiffPanel({
  selectedSnapshotId,
  snapshotDiff
}: ConfigCenterSnapshotDiffPanelInput): string {
  if (!selectedSnapshotId || !snapshotDiff) {
    return "";
  }

  const total = snapshotDiff.entries.length;
  const visibleEntries = sortDiffEntries(snapshotDiff.entries).slice(0, 12);
  const structuralCount = countStructuralEntries(snapshotDiff);
  const summary =
    total === 0
      ? "当前版本与该快照没有差异。"
      : structuralCount > 0
          ? `警告：检测到 ${structuralCount}/${total} 条结构变更，优先展示高风险字段（最多 ${visibleEntries.length} 条）。`
          : `当前展示 ${visibleEntries.length} / ${total} 条差异。`;

  if (total === 0) {
    return `
      <div class="config-hint">${summary}</div>
      <div class="world-preview-empty">当前版本与该快照没有差异。</div>
    `;
  }

  return `
    <div class="config-hint">${summary}</div>
    <div class="diff-list">
      ${visibleEntries
        .map(
          (entry) => `
            <article class="diff-item ${isStructuralDiff(entry) ? "is-structural" : ""}">
              <div class="diff-item-body">
                <strong>${escapeHtml(entry.path)}</strong>
                <span>${escapeHtml(entry.description || "该字段在 Schema 中暂无描述。")}</span>
              </div>
              <div class="diff-item-tags">
                <span class="diff-chip ${isStructuralDiff(entry) ? "is-alert" : ""}">${diffKindLabel(entry.kind)}</span>
                <span class="diff-chip is-muted">${escapeHtml(entry.fieldType)}</span>
                ${entry.required ? `<span class="diff-chip is-required">必填</span>` : ""}
              </div>
              <small>${escapeHtml(serializeDisplayValue(entry.previousValue))} → ${escapeHtml(serializeDisplayValue(entry.nextValue))}</small>
              ${
                entry.blastRadius.length
                  ? `<small class="diff-blast">影响：${entry.blastRadius.map((label) => `<span>${escapeHtml(label)}</span>`).join(" / ")}</small>`
                  : ""
              }
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

export function renderConfigCenterPublishHistoryList({
  publishAuditHistory,
  publishAuditFilterId,
  publishAuditFilterStatus,
  publishAuditFilterCandidate,
  publishAuditFilterRevision,
  historyLoading
}: ConfigCenterPublishHistorySectionInput): string {
  const candidateQuery = publishAuditFilterCandidate.trim().toLowerCase();
  const revisionQuery = publishAuditFilterRevision.trim().toLowerCase();
  const entries = publishAuditHistory.filter((entry) => {
    const matchesDocument =
      publishAuditFilterId === "all" ||
      entry.changes.some((change) => change.documentId === publishAuditFilterId);
    const matchesResult =
      publishAuditFilterStatus === "all" || entry.resultStatus === publishAuditFilterStatus;
    const matchesCandidate =
      candidateQuery.length === 0 || (entry.candidate ?? "").toLowerCase().includes(candidateQuery);
    const matchesRevision =
      revisionQuery.length === 0 || (entry.revision ?? "").toLowerCase().includes(revisionQuery);
    return matchesDocument && matchesResult && matchesCandidate && matchesRevision;
  });
  if (historyLoading && entries.length === 0 && publishAuditHistory.length === 0) {
    return `<div class="world-preview-empty">正在加载发布记录...</div>`;
  }

  if (entries.length === 0) {
    return `
      <section class="history-section">
        <div class="config-preview-subhead">
          <h4>发布审计历史</h4>
          <span class="config-meta">0 条匹配记录</span>
        </div>
        <div class="history-filters">
          <label>
            <span>配置类型</span>
            <select data-role="publish-filter-doc">
              <option value="all">全部</option>
              <option value="world" ${publishAuditFilterId === "world" ? "selected" : ""}>世界配置</option>
              <option value="mapObjects" ${publishAuditFilterId === "mapObjects" ? "selected" : ""}>地图物件</option>
              <option value="units" ${publishAuditFilterId === "units" ? "selected" : ""}>兵种配置</option>
              <option value="battleSkills" ${publishAuditFilterId === "battleSkills" ? "selected" : ""}>技能配置</option>
              <option value="battleBalance" ${publishAuditFilterId === "battleBalance" ? "selected" : ""}>战斗平衡</option>
            </select>
          </label>
          <label>
            <span>结果状态</span>
            <select data-role="publish-filter-status">
              <option value="all">全部</option>
              <option value="applied" ${publishAuditFilterStatus === "applied" ? "selected" : ""}>已应用</option>
              <option value="failed" ${publishAuditFilterStatus === "failed" ? "selected" : ""}>失败</option>
            </select>
          </label>
          <label>
            <span>Candidate</span>
            <input data-role="publish-filter-candidate" value="${escapeHtml(publishAuditFilterCandidate)}" placeholder="phase1-rc" />
          </label>
          <label>
            <span>Revision</span>
            <input data-role="publish-filter-revision" value="${escapeHtml(publishAuditFilterRevision)}" placeholder="abc1234" />
          </label>
        </div>
        <div class="world-preview-empty">暂无匹配的发布记录，先使用“发布草稿”功能再回来查看。</div>
      </section>
    `;
  }

  return `
    <section class="history-section publish-history">
      <div class="config-preview-subhead">
        <h4>发布审计历史</h4>
        <span class="config-meta">${entries.length} 条记录</span>
      </div>
      <div class="history-filters">
        <label>
          <span>配置类型</span>
          <select data-role="publish-filter-doc">
            <option value="all">全部</option>
            <option value="world" ${publishAuditFilterId === "world" ? "selected" : ""}>世界配置</option>
            <option value="mapObjects" ${publishAuditFilterId === "mapObjects" ? "selected" : ""}>地图物件</option>
            <option value="units" ${publishAuditFilterId === "units" ? "selected" : ""}>兵种配置</option>
            <option value="battleSkills" ${publishAuditFilterId === "battleSkills" ? "selected" : ""}>技能配置</option>
            <option value="battleBalance" ${publishAuditFilterId === "battleBalance" ? "selected" : ""}>战斗平衡</option>
          </select>
        </label>
        <label>
          <span>结果状态</span>
          <select data-role="publish-filter-status">
            <option value="all">全部</option>
            <option value="applied" ${publishAuditFilterStatus === "applied" ? "selected" : ""}>已应用</option>
            <option value="failed" ${publishAuditFilterStatus === "failed" ? "selected" : ""}>失败</option>
          </select>
        </label>
        <label>
          <span>Candidate</span>
          <input data-role="publish-filter-candidate" value="${escapeHtml(publishAuditFilterCandidate)}" placeholder="phase1-rc" />
        </label>
        <label>
          <span>Revision</span>
          <input data-role="publish-filter-revision" value="${escapeHtml(publishAuditFilterRevision)}" placeholder="abc1234" />
        </label>
      </div>
      <div class="publish-history-list">
        ${entries
          .slice(0, 10)
          .map(
            (entry) => `
              <article class="publish-history-card">
                <div class="publish-history-head">
                  <div>
                    <strong>${escapeHtml(entry.summary)}</strong>
                    <span>${escapeHtml(entry.author)} · ${formatTime(entry.publishedAt)}</span>
                  </div>
                  <span class="publish-result-pill is-${entry.resultStatus}">${entry.resultStatus === "applied" ? "已应用" : "失败"}</span>
                </div>
                <small>${escapeHtml(entry.resultMessage)}</small>
                ${
                  entry.candidate || entry.revision
                    ? `
                        <div class="config-badge-row">
                          ${entry.candidate ? `<span class="config-badge">Candidate · ${escapeHtml(entry.candidate)}</span>` : ""}
                          ${entry.revision ? `<span class="config-badge">Revision · ${escapeHtml(entry.revision)}</span>` : ""}
                        </div>
                      `
                    : ""
                }
                <div class="config-badge-row">
                  ${entry.changes.map((change) => `<span class="config-badge">${escapeHtml(change.title)} · v${change.fromVersion}→v${change.toVersion}</span>`).join("")}
                </div>
                <div class="publish-change-list">
                  ${entry.changes
                    .map(
                      (change) => `
                        <section class="publish-change-card">
                          <div class="publish-change-head">
                            <strong>${escapeHtml(change.title)}</strong>
                            <span>${change.changeCount} 项变更${change.structuralChangeCount ? ` · ${change.structuralChangeCount} 项结构风险` : ""}</span>
                          </div>
                          <small>${escapeHtml(change.runtimeMessage)}</small>
                          ${
                            change.impactSummary
                              ? `
                                <div class="impact-summary-grid is-compact">
                                  <article class="impact-summary-card">
                                    <strong>${impactRiskLabel(change.impactSummary.riskLevel)}</strong>
                                    <span>${escapeHtml(change.impactSummary.summary)}</span>
                                  </article>
                                  <article class="impact-summary-card">
                                    <strong>影响模块</strong>
                                    <span>${escapeHtml(change.impactSummary.impactedModules.join(" / "))}</span>
                                  </article>
                                  <article class="impact-summary-card">
                                    <strong>风险提示</strong>
                                    <span>${escapeHtml(change.impactSummary.riskHints.join(" / ") || "无")}</span>
                                  </article>
                                </div>
                              `
                              : ""
                          }
                          <div class="publish-diff-summary">
                            ${
                              change.diffSummary.length > 0
                                ? change.diffSummary
                                    .map(
                                      (diff) => `
                                        <span class="publish-diff-chip">
                                          ${escapeHtml(diff.path)} · ${escapeHtml(diffKindLabel(diff.kind))}
                                        </span>
                                      `
                                    )
                                    .join("")
                                : `<span class="publish-diff-chip">无字段差异</span>`
                            }
                          </div>
                          <div class="history-actions">
                            <button class="config-button is-secondary config-button-compact" data-action="inspect-publish-change" data-doc-id="${change.documentId}" data-snapshot-id="${change.snapshotId ?? ""}" ${change.snapshotId ? "" : "disabled"}>查看快照</button>
                            <button class="config-button is-secondary config-button-compact" data-action="rollback-publish-change" data-doc-id="${change.documentId}" data-snapshot-id="${change.snapshotId ?? ""}" ${change.snapshotId ? "" : "disabled"}>快速回滚</button>
                          </div>
                        </section>
                      `
                    )
                    .join("")}
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

let root!: HTMLDivElement;
let controller!: ReturnType<typeof createConfigCenterController>;
let state!: ReturnType<typeof createConfigCenterController>["state"];
let getDraftParseState!: ReturnType<typeof createConfigCenterController>["getDraftParseState"];
let normalizePreviewSeed!: ReturnType<typeof createConfigCenterController>["normalizePreviewSeed"];
let loadList!: ReturnType<typeof createConfigCenterController>["loadList"];
let loadSnapshots!: ReturnType<typeof createConfigCenterController>["loadSnapshots"];
let loadPresets!: ReturnType<typeof createConfigCenterController>["loadPresets"];
let loadSnapshotDiff!: ReturnType<typeof createConfigCenterController>["loadSnapshotDiff"];
let loadPublishStage!: ReturnType<typeof createConfigCenterController>["loadPublishStage"];
let loadPublishAuditHistory!: ReturnType<typeof createConfigCenterController>["loadPublishAuditHistory"];
let loadWorldPreview!: ReturnType<typeof createConfigCenterController>["loadWorldPreview"];
let loadValidation!: ReturnType<typeof createConfigCenterController>["loadValidation"];
let scheduleWorldPreview!: ReturnType<typeof createConfigCenterController>["scheduleWorldPreview"];
let loadDocument!: ReturnType<typeof createConfigCenterController>["loadDocument"];
let saveCurrentDocument!: ReturnType<typeof createConfigCenterController>["saveCurrentDocument"];
let restoreCurrentDocument!: ReturnType<typeof createConfigCenterController>["restoreCurrentDocument"];
let createSnapshot!: ReturnType<typeof createConfigCenterController>["createSnapshot"];
let rollbackSnapshot!: ReturnType<typeof createConfigCenterController>["rollbackSnapshot"];
let applyPreset!: ReturnType<typeof createConfigCenterController>["applyPreset"];
let saveCurrentAsPreset!: ReturnType<typeof createConfigCenterController>["saveCurrentAsPreset"];
let exportCurrentDocument!: ReturnType<typeof createConfigCenterController>["exportCurrentDocument"];
let importWorkbook!: ReturnType<typeof createConfigCenterController>["importWorkbook"];
let stageCurrentDraft!: ReturnType<typeof createConfigCenterController>["stageCurrentDraft"];
let removeDocumentFromStage!: ReturnType<typeof createConfigCenterController>["removeDocumentFromStage"];
let clearPublishStage!: ReturnType<typeof createConfigCenterController>["clearPublishStage"];
let publishStageDrafts!: ReturnType<typeof createConfigCenterController>["publishStageDrafts"];
let setPublishAuditFilters!: ReturnType<typeof createConfigCenterController>["setPublishAuditFilters"];
let inspectPublishedSnapshot!: ReturnType<typeof createConfigCenterController>["inspectPublishedSnapshot"];
let rollbackPublishedSnapshot!: ReturnType<typeof createConfigCenterController>["rollbackPublishedSnapshot"];
let runtimeInitialized = false;

function initializeConfigCenterRuntime(): void {
  if (runtimeInitialized) {
    return;
  }

  const appRoot = document.querySelector<HTMLDivElement>("#app");
  if (!appRoot) {
    throw new Error("Missing #app");
  }

  root = appRoot;
  controller = createConfigCenterController({
    onStateChange: () => {
      render();
    },
    prompt: (message, defaultValue) => window.prompt(message, defaultValue),
    confirm: (message) => window.confirm(message),
    download: ({ blob, fileName, fallbackFileName }) => {
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = fileName ?? fallbackFileName;
      anchor.click();
      URL.revokeObjectURL(href);
    }
  });
  ({
    state,
    getDraftParseState,
    normalizePreviewSeed,
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
    rollbackPublishedSnapshot
  } = controller);
  runtimeInitialized = true;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function currentParseState(): { valid: boolean; detail: string; rootKeys: number } {
  return getDraftParseState();
}

function currentBattleSkillCatalogState(): {
  valid: boolean;
  detail: string;
  catalog: BattleSkillCatalogConfig | null;
} {
  if (!isBattleSkillsDocumentSelected()) {
    return {
      valid: false,
      detail: "当前未选择技能配置文档",
      catalog: null
    };
  }

  try {
    const parsed = JSON.parse(state.draft || "{}") as Partial<BattleSkillCatalogConfig>;
    if (!Array.isArray(parsed.skills) || !Array.isArray(parsed.statuses)) {
      return {
        valid: false,
        detail: "技能配置需要同时包含 skills 和 statuses 数组",
        catalog: null
      };
    }

    return {
      valid: true,
      detail: "技能配置结构有效",
      catalog: parsed as BattleSkillCatalogConfig
    };
  } catch (error) {
    return {
      valid: false,
      detail: error instanceof Error ? error.message : "技能配置 JSON 无效",
      catalog: null
    };
  }
}

function isDirty(): boolean {
  return state.current != null && state.draft !== state.current.content;
}

function isWorldDocumentSelected(): boolean {
  return state.current?.id === "world";
}

function isBattleSkillsDocumentSelected(): boolean {
  return state.current?.id === "battleSkills";
}

function isBattleBalanceDocumentSelected(): boolean {
  return state.current?.id === "battleBalance";
}

function setDraftContent(nextDraft: string): void {
  controller.setDraft(nextDraft);
  const textarea = document.querySelector<HTMLTextAreaElement>("[data-role='editor']");
  if (textarea && textarea.value !== nextDraft) {
    textarea.value = nextDraft;
  }
  refreshLivePanels();
  void loadValidation(WORLD_PREVIEW_DEBOUNCE_MS);
  if (isWorldDocumentSelected()) {
    scheduleWorldPreview();
  }
}

function updateBattleSkillCatalogDraft(
  updater: (catalog: BattleSkillCatalogConfig) => BattleSkillCatalogConfig
): void {
  const current = currentBattleSkillCatalogState();
  if (!current.valid || !current.catalog) {
    return;
  }

  const nextCatalog = updater(structuredClone(current.catalog));
  setDraftContent(`${JSON.stringify(nextCatalog, null, 2)}\n`);
}

function currentBattleBalanceState(): {
  valid: boolean;
  detail: string;
  config: BattleBalanceConfig | null;
} {
  if (!isBattleBalanceDocumentSelected()) {
    return {
      valid: false,
      detail: "当前未选择战斗平衡文档",
      config: null
    };
  }

  try {
    const parsed = JSON.parse(state.draft || "{}") as Partial<BattleBalanceConfig>;
    if (
      !parsed.damage ||
      !parsed.environment ||
      !parsed.pvp
    ) {
      return {
        valid: false,
        detail: "战斗平衡配置需要同时包含 damage、environment 和 pvp",
        config: null
      };
    }

    return {
      valid: true,
      detail: "战斗平衡结构有效",
      config: parsed as BattleBalanceConfig
    };
  } catch (error) {
    return {
      valid: false,
      detail: error instanceof Error ? error.message : "战斗平衡 JSON 无效",
      config: null
    };
  }
}

function updateBattleBalanceDraft(
  updater: (config: BattleBalanceConfig) => BattleBalanceConfig
): void {
  const current = currentBattleBalanceState();
  if (!current.valid || !current.config) {
    return;
  }

  const nextConfig = updater(structuredClone(current.config));
  setDraftContent(`${JSON.stringify(nextConfig, null, 2)}\n`);
}

function cleanupSkillEffects(effects: BattleSkillEffectConfig): BattleSkillEffectConfig | undefined {
  const nextEffects = { ...effects };
  if (nextEffects.damageMultiplier == null || Number.isNaN(nextEffects.damageMultiplier)) {
    delete nextEffects.damageMultiplier;
  }
  if (nextEffects.allowRetaliation === true) {
    delete nextEffects.allowRetaliation;
  }
  if (!nextEffects.grantedStatusId) {
    delete nextEffects.grantedStatusId;
  }
  if (!nextEffects.onHitStatusId) {
    delete nextEffects.onHitStatusId;
  }

  return Object.keys(nextEffects).length > 0 ? nextEffects : undefined;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
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

  const quotedMatch = headerValue.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = headerValue.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

async function requestDownload(input: RequestInfo, init?: RequestInit): Promise<DownloadPayload> {
  const response = await fetch(input, init);
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

function serializeDisplayValue(value: string): string {
  return value.length > 48 ? `${value.slice(0, 48)}...` : value || "空";
}

function jumpToValidationIssue(line?: number): void {
  const textarea = document.querySelector<HTMLTextAreaElement>("[data-role='editor']");
  if (!textarea) {
    return;
  }

  if (!line || line <= 1) {
    textarea.focus();
    textarea.setSelectionRange(0, 0);
    return;
  }

  const lines = textarea.value.split("\n");
  const start = lines.slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
  const end = start + (lines[line - 1]?.length ?? 0);
  textarea.focus();
  textarea.setSelectionRange(start, end);
}

function buildWorldPreviewTileTitle(tile: WorldConfigPreviewTile): string {
  const parts = [`(${tile.position.x}, ${tile.position.y})`, `地形: ${tile.terrain}`, tile.walkable ? "可通行" : "阻挡"];

  if (tile.occupant) {
    parts.push(
      tile.occupant.kind === "hero"
        ? `英雄: ${tile.occupant.label}${tile.occupant.playerId ? ` / ${tile.occupant.playerId}` : ""}`
        : `中立: ${tile.occupant.label}`
    );
  }

  if (tile.resource) {
    parts.push(`资源: ${tile.resource.kind} +${tile.resource.amount} (${tile.resource.source === "guaranteed" ? "保底" : "随机"})`);
  }

  if (tile.building) {
    if (tile.building.kind === "recruitment_post") {
      parts.push(`建筑: ${tile.building.label} / 库存 ${tile.building.availableCount} / ${tile.building.unitTemplateId}`);
    } else if (tile.building.kind === "attribute_shrine") {
      const bonus = [
        tile.building.bonus.attack > 0 ? `攻击 +${tile.building.bonus.attack}` : "",
        tile.building.bonus.defense > 0 ? `防御 +${tile.building.bonus.defense}` : "",
        tile.building.bonus.power > 0 ? `力量 +${tile.building.bonus.power}` : "",
        tile.building.bonus.knowledge > 0 ? `知识 +${tile.building.bonus.knowledge}` : ""
      ].filter(Boolean);
      parts.push(`建筑: ${tile.building.label} / ${bonus.join("、") || "属性加成"}${typeof tile.building.lastUsedDay === "number" ? ` / 第 ${tile.building.lastUsedDay} 天已访问` : ""}`);
    } else if (tile.building.kind === "resource_mine") {
      parts.push(`建筑: ${tile.building.label} / ${tile.building.resourceKind} +${tile.building.income}/day${typeof tile.building.lastHarvestDay === "number" ? ` / 第 ${tile.building.lastHarvestDay} 天已采集` : ""}`);
    } else {
      parts.push(`建筑: ${tile.building.label} / 视野 +${tile.building.visionBonus}${typeof tile.building.lastUsedDay === "number" ? ` / 第 ${tile.building.lastUsedDay} 天已登塔` : ""}`);
    }
  }

  return parts.join(" | ");
}

function renderWorldPreviewGrid(preview: WorldConfigPreview): string {
  return `
    <div class="world-preview-grid" style="--world-preview-columns: ${preview.width}">
      ${preview.tiles
        .map((tile) => {
          const resourceLabel = tile.resource ? RESOURCE_SHORT_LABEL[tile.resource.kind] : "";
          const occupantLabel = tile.occupant ? (tile.occupant.kind === "hero" ? "H" : "N") : tile.building ? "B" : "";
          const className = [
            "world-preview-tile",
            `terrain-${tile.terrain}`,
            tile.walkable ? "" : "is-blocked",
            tile.resource ? `resource-${tile.resource.kind}` : "",
            tile.resource?.source === "guaranteed" ? "is-guaranteed" : "",
            tile.occupant ? `occupant-${tile.occupant.kind}` : "",
            tile.building ? "has-building" : ""
          ]
            .filter(Boolean)
            .join(" ");

          return `
            <div class="${className}" title="${escapeHtml(buildWorldPreviewTileTitle(tile))}">
              <span class="world-preview-main">${occupantLabel}</span>
              ${resourceLabel ? `<span class="world-preview-corner">${resourceLabel}</span>` : ""}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderWorldPreviewSection(): string {
  if (!isWorldDocumentSelected()) {
    return "";
  }

  const previewContent = state.previewLoading
    ? `<div class="world-preview-empty">正在根据草稿生成地图样本...</div>`
    : state.previewError
      ? `<div class="world-preview-empty is-error">${escapeHtml(state.previewError)}</div>`
      : state.worldPreview
        ? `
          <div class="world-preview-stats">
            <span class="config-badge">${state.worldPreview.width}x${state.worldPreview.height}</span>
            <span class="config-badge">可走 ${state.worldPreview.counts.walkable}</span>
            <span class="config-badge">阻挡 ${state.worldPreview.counts.blocked}</span>
            <span class="config-badge">英雄 ${state.worldPreview.counts.heroes}</span>
            <span class="config-badge">中立 ${state.worldPreview.counts.neutralArmies}</span>
            <span class="config-badge">建筑 ${state.worldPreview.counts.buildings}</span>
            <span class="config-badge">资源 ${state.worldPreview.counts.guaranteedResources + state.worldPreview.counts.randomResources}</span>
            <span class="config-badge">保底 ${state.worldPreview.counts.guaranteedResources}</span>
            <span class="config-badge">随机 ${state.worldPreview.counts.randomResources}</span>
          </div>
          <div class="world-preview-stats">
            <span class="config-badge">草地 ${state.worldPreview.counts.terrain.grass}</span>
            <span class="config-badge">泥地 ${state.worldPreview.counts.terrain.dirt}</span>
            <span class="config-badge">沙地 ${state.worldPreview.counts.terrain.sand}</span>
            <span class="config-badge">水域 ${state.worldPreview.counts.terrain.water}</span>
          </div>
          <div class="world-preview-stats">
            <span class="config-badge">金币点 ${state.worldPreview.counts.resourceTiles.gold} / 总量 ${state.worldPreview.counts.resourceAmounts.gold}</span>
            <span class="config-badge">木材点 ${state.worldPreview.counts.resourceTiles.wood} / 总量 ${state.worldPreview.counts.resourceAmounts.wood}</span>
            <span class="config-badge">矿石点 ${state.worldPreview.counts.resourceTiles.ore} / 总量 ${state.worldPreview.counts.resourceAmounts.ore}</span>
          </div>
          <div class="world-preview-legend">
            <span><i class="legend-chip terrain-grass"></i>草地</span>
            <span><i class="legend-chip terrain-dirt"></i>泥地</span>
            <span><i class="legend-chip terrain-sand"></i>沙地</span>
            <span><i class="legend-chip terrain-water"></i>水域</span>
            <span><i class="legend-pill hero">H</i>英雄</span>
            <span><i class="legend-pill neutral">N</i>中立</span>
            <span><i class="legend-pill resource">B</i>建筑</span>
            <span><i class="legend-pill resource">G/W/O</i>资源</span>
          </div>
          ${renderWorldPreviewGrid(state.worldPreview)}
        `
        : `<div class="world-preview-empty">这里会显示当前草稿对应的地图分布样本。</div>`;

  return `
    <section class="world-preview-section">
      <div class="config-preview-subhead">
        <h4>地图生成器预览</h4>
        <span class="config-meta">${state.worldPreview ? `seed ${state.worldPreview.seed}` : "seed 1001"}</span>
      </div>
      <div class="world-preview-toolbar">
        <label class="world-preview-seed">
          <span>样本 Seed</span>
          <input type="number" min="0" step="1" value="${state.previewSeed}" data-role="preview-seed" />
        </label>
        <div class="world-preview-actions">
          <button class="config-button is-secondary config-button-compact" data-action="preview-refresh">刷新样本</button>
          <button class="config-button is-secondary config-button-compact" data-action="preview-reroll">切换 Seed</button>
        </div>
      </div>
      <p class="config-hint">保存前会先按当前草稿生成一份只读世界样本。当前预览会复用服务端同一套世界生成逻辑，不会改动运行时配置。</p>
      ${previewContent}
    </section>
  `;
}

function renderStatusOptions(
  catalog: BattleSkillCatalogConfig,
  selectedId: string | undefined,
  placeholder = "无"
): string {
  return [
    `<option value="">${placeholder}</option>`,
    ...catalog.statuses.map(
      (status) => `<option value="${escapeHtml(status.id)}" ${status.id === selectedId ? "selected" : ""}>${escapeHtml(status.name)} (${escapeHtml(status.id)})</option>`
    )
  ].join("");
}

function describeSkillEffects(skill: BattleSkillConfig, catalog: BattleSkillCatalogConfig): string {
  const effects = skill.effects ?? {};
  const parts: string[] = [];
  if (effects.damageMultiplier != null) {
    parts.push(`伤害 x${effects.damageMultiplier}`);
  }
  if (effects.allowRetaliation === false) {
    parts.push("不触发反击");
  }
  if (effects.grantedStatusId) {
    const status = catalog.statuses.find((item) => item.id === effects.grantedStatusId);
    parts.push(`施加自身状态 ${status?.name ?? effects.grantedStatusId}`);
  }
  if (effects.onHitStatusId) {
    const status = catalog.statuses.find((item) => item.id === effects.onHitStatusId);
    parts.push(`命中附加 ${status?.name ?? effects.onHitStatusId}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "暂无额外效果";
}

function renderBattleSkillEditorSection(): string {
  if (!isBattleSkillsDocumentSelected()) {
    return "";
  }

  const parseState = currentBattleSkillCatalogState();
  if (!parseState.valid || !parseState.catalog) {
    return `
      <section class="skill-editor-section">
        <div class="config-preview-subhead">
          <h4>技能编辑器</h4>
          <span class="config-meta">等待合法 JSON</span>
        </div>
        <div class="world-preview-empty is-error">${escapeHtml(parseState.detail)}</div>
      </section>
    `;
  }

  const catalog = parseState.catalog;
  const skillCards = catalog.skills
    .map(
      (skill, index) => `
        <article class="skill-editor-card">
          <div class="skill-editor-card-head">
            <div>
              <strong>${escapeHtml(skill.name)}</strong>
              <span>${escapeHtml(skill.id)}</span>
            </div>
            <span class="config-badge">${skill.kind === "active" ? "主动" : "被动"}</span>
          </div>
          <p class="skill-editor-summary">${escapeHtml(describeSkillEffects(skill, catalog))}</p>
          <div class="skill-editor-fields">
            <label>
              <span>ID</span>
              <input type="text" value="${escapeHtml(skill.id)}" data-role="skill-field" data-index="${index}" data-field="id" />
            </label>
            <label>
              <span>名称</span>
              <input type="text" value="${escapeHtml(skill.name)}" data-role="skill-field" data-index="${index}" data-field="name" />
            </label>
            <label class="is-wide">
              <span>描述</span>
              <input type="text" value="${escapeHtml(skill.description)}" data-role="skill-field" data-index="${index}" data-field="description" />
            </label>
            <label>
              <span>类型</span>
              <select data-role="skill-field" data-index="${index}" data-field="kind">
                <option value="active" ${skill.kind === "active" ? "selected" : ""}>主动</option>
                <option value="passive" ${skill.kind === "passive" ? "selected" : ""}>被动</option>
              </select>
            </label>
            <label>
              <span>目标</span>
              <select data-role="skill-field" data-index="${index}" data-field="target">
                <option value="enemy" ${skill.target === "enemy" ? "selected" : ""}>敌方</option>
                <option value="self" ${skill.target === "self" ? "selected" : ""}>自身</option>
              </select>
            </label>
            <label>
              <span>冷却</span>
              <input type="number" step="1" value="${skill.cooldown}" data-role="skill-field" data-index="${index}" data-field="cooldown" />
            </label>
            <label>
              <span>伤害倍率</span>
              <input type="number" step="0.05" value="${skill.effects?.damageMultiplier ?? ""}" data-role="skill-effect-field" data-index="${index}" data-field="damageMultiplier" />
            </label>
            <label>
              <span>自身状态</span>
              <select data-role="skill-effect-field" data-index="${index}" data-field="grantedStatusId">
                ${renderStatusOptions(catalog, skill.effects?.grantedStatusId)}
              </select>
            </label>
            <label>
              <span>命中状态</span>
              <select data-role="skill-effect-field" data-index="${index}" data-field="onHitStatusId">
                ${renderStatusOptions(catalog, skill.effects?.onHitStatusId)}
              </select>
            </label>
            <label class="is-checkbox">
              <input type="checkbox" ${skill.effects?.allowRetaliation !== false ? "checked" : ""} data-role="skill-effect-bool" data-index="${index}" data-field="allowRetaliation" />
              <span>允许目标反击</span>
            </label>
          </div>
        </article>
      `
    )
    .join("");

  const statusCards = catalog.statuses
    .map(
      (status, index) => `
        <article class="skill-editor-card">
          <div class="skill-editor-card-head">
            <div>
              <strong>${escapeHtml(status.name)}</strong>
              <span>${escapeHtml(status.id)}</span>
            </div>
            <span class="config-badge">持续 ${status.duration}</span>
          </div>
          <div class="skill-editor-fields">
            <label>
              <span>ID</span>
              <input type="text" value="${escapeHtml(status.id)}" data-role="status-field" data-index="${index}" data-field="id" />
            </label>
            <label>
              <span>名称</span>
              <input type="text" value="${escapeHtml(status.name)}" data-role="status-field" data-index="${index}" data-field="name" />
            </label>
            <label class="is-wide">
              <span>描述</span>
              <input type="text" value="${escapeHtml(status.description)}" data-role="status-field" data-index="${index}" data-field="description" />
            </label>
            <label>
              <span>持续回合</span>
              <input type="number" step="1" value="${status.duration}" data-role="status-field" data-index="${index}" data-field="duration" />
            </label>
            <label>
              <span>攻击修正</span>
              <input type="number" step="1" value="${status.attackModifier}" data-role="status-field" data-index="${index}" data-field="attackModifier" />
            </label>
            <label>
              <span>防御修正</span>
              <input type="number" step="1" value="${status.defenseModifier}" data-role="status-field" data-index="${index}" data-field="defenseModifier" />
            </label>
            <label>
              <span>每回合伤害</span>
              <input type="number" step="1" value="${status.damagePerTurn}" data-role="status-field" data-index="${index}" data-field="damagePerTurn" />
            </label>
          </div>
        </article>
      `
    )
    .join("");

  return `
    <section class="skill-editor-section">
      <div class="config-preview-subhead">
        <h4>技能编辑器</h4>
        <span class="config-meta">${catalog.skills.length} 个技能 · ${catalog.statuses.length} 个状态</span>
      </div>
      <p class="config-hint">右侧表单会直接改写当前 JSON 草稿，适合调冷却、倍率、目标、持续状态与效果描述；底部仍保留原始 JSON，可随时手改。</p>
      <div class="skill-editor-group">
        ${skillCards}
      </div>
      <div class="config-preview-subhead">
        <h4>状态编辑器</h4>
        <span class="config-meta">持续效果参数</span>
      </div>
      <div class="skill-editor-group">
        ${statusCards}
      </div>
    </section>
  `;
}

function renderBattleBalanceEditorSection(): string {
  if (!isBattleBalanceDocumentSelected()) {
    return "";
  }

  const parseState = currentBattleBalanceState();
  if (!parseState.valid || !parseState.config) {
    return `
      <section class="skill-editor-section">
        <div class="config-preview-subhead">
          <h4>战斗平衡编辑器</h4>
          <span class="config-meta">等待合法 JSON</span>
        </div>
        <div class="world-preview-empty is-error">${escapeHtml(parseState.detail)}</div>
      </section>
    `;
  }

  const config = parseState.config;
  const summaryBadges = [
    `<span class="config-badge">防守加成 ${config.damage.defendingDefenseBonus}</span>`,
    `<span class="config-badge">攻防步进 ${config.damage.offenseAdvantageStep}</span>`,
    `<span class="config-badge">路障阈值 ${config.environment.blockerSpawnThreshold}</span>`,
    `<span class="config-badge">陷阱阈值 ${config.environment.trapSpawnThreshold}</span>`,
    `<span class="config-badge">ELO K=${config.pvp.eloK}</span>`
  ].join("");

  return `
    <section class="skill-editor-section">
      <div class="config-preview-subhead">
        <h4>战斗平衡编辑器</h4>
        <span class="config-meta">公式 / 环境 / PVP</span>
      </div>
      <p class="config-hint">右侧表单会直接改写当前 JSON 草稿，适合快速调伤害公式、路障/陷阱生成参数和 ELO K；底部原始 JSON 仍可手改。</p>
      <div class="config-badge-row">${summaryBadges}</div>
      <div class="skill-editor-group">
        <article class="skill-editor-card">
          <div class="skill-editor-card-head">
            <div>
              <strong>伤害公式</strong>
              <span>damage</span>
            </div>
            <span class="config-badge">实时生效</span>
          </div>
          <div class="skill-editor-fields">
            <label>
              <span>防守防御加成</span>
              <input type="number" step="1" value="${config.damage.defendingDefenseBonus}" data-role="battle-balance-field" data-section="damage" data-field="defendingDefenseBonus" />
            </label>
            <label>
              <span>攻防差步进</span>
              <input type="number" step="0.01" value="${config.damage.offenseAdvantageStep}" data-role="battle-balance-field" data-section="damage" data-field="offenseAdvantageStep" />
            </label>
            <label>
              <span>最低伤害倍率</span>
              <input type="number" step="0.01" value="${config.damage.minimumOffenseMultiplier}" data-role="battle-balance-field" data-section="damage" data-field="minimumOffenseMultiplier" />
            </label>
            <label>
              <span>伤害波动基线</span>
              <input type="number" step="0.01" value="${config.damage.varianceBase}" data-role="battle-balance-field" data-section="damage" data-field="varianceBase" />
            </label>
            <label>
              <span>伤害波动范围</span>
              <input type="number" step="0.01" value="${config.damage.varianceRange}" data-role="battle-balance-field" data-section="damage" data-field="varianceRange" />
            </label>
          </div>
        </article>
        <article class="skill-editor-card">
          <div class="skill-editor-card-head">
            <div>
              <strong>遭遇战环境</strong>
              <span>environment</span>
            </div>
            <span class="config-badge">路障 / 陷阱</span>
          </div>
          <div class="skill-editor-fields">
            <label>
              <span>路障生成阈值</span>
              <input type="number" min="0" max="1" step="0.01" value="${config.environment.blockerSpawnThreshold}" data-role="battle-balance-field" data-section="environment" data-field="blockerSpawnThreshold" />
            </label>
            <label>
              <span>路障耐久</span>
              <input type="number" min="1" step="1" value="${config.environment.blockerDurability}" data-role="battle-balance-field" data-section="environment" data-field="blockerDurability" />
            </label>
            <label>
              <span>陷阱生成阈值</span>
              <input type="number" min="0" max="1" step="0.01" value="${config.environment.trapSpawnThreshold}" data-role="battle-balance-field" data-section="environment" data-field="trapSpawnThreshold" />
            </label>
            <label>
              <span>陷阱伤害</span>
              <input type="number" min="0" step="1" value="${config.environment.trapDamage}" data-role="battle-balance-field" data-section="environment" data-field="trapDamage" />
            </label>
            <label>
              <span>陷阱次数</span>
              <input type="number" min="1" step="1" value="${config.environment.trapCharges}" data-role="battle-balance-field" data-section="environment" data-field="trapCharges" />
            </label>
            <label class="is-wide">
              <span>伤害型陷阱附加状态</span>
              <input type="text" value="${escapeHtml(config.environment.trapGrantedStatusId ?? "")}" data-role="battle-balance-status" data-field="trapGrantedStatusId" placeholder="例如 weakened；留空则不附带状态" />
            </label>
          </div>
        </article>
        <article class="skill-editor-card">
          <div class="skill-editor-card-head">
            <div>
              <strong>PVP 参数</strong>
              <span>pvp</span>
            </div>
            <span class="config-badge">匹配结算</span>
          </div>
          <div class="skill-editor-fields">
            <label>
              <span>ELO K 因子</span>
              <input type="number" min="1" step="1" value="${config.pvp.eloK}" data-role="battle-balance-field" data-section="pvp" data-field="eloK" />
            </label>
            <label>
              <span>回合计时 秒数</span>
              <input type="number" min="1" step="1" value="${config.turnTimerSeconds}" data-role="battle-balance-field" data-section="root" data-field="turnTimerSeconds" />
            </label>
            <label>
              <span>挂机判负阈值</span>
              <input type="number" min="1" step="1" value="${config.afkStrikesBeforeForfeit}" data-role="battle-balance-field" data-section="root" data-field="afkStrikesBeforeForfeit" />
            </label>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderValidationSection(): string {
  return renderConfigCenterValidationSection({
    currentDocumentId: state.current?.id ?? null,
    validation: state.validation,
    validationLoading: state.validationLoading
  });
}

function renderImpactSummarySection(): string {
  return renderConfigCenterImpactSummarySection({
    currentDocumentId: state.current?.id ?? null,
    lastSavedImpactSummary: state.lastSavedImpactSummary
  });
}

function renderPublishStageSection(): string {
  if (!state.current) {
    return "";
  }

  const stage = state.publishStage;
  const documents = stage?.documents ?? [];
  const stagedCount = documents.length;
  const activeDocumentId = state.current?.id ?? null;
  const isCurrentInStage = documents.some((document) => document.id === activeDocumentId);
  const limitReached = !isCurrentInStage && stagedCount >= MAX_STAGE_DOCUMENTS;
  const stageMeta = stage
    ? `${stagedCount}/${MAX_STAGE_DOCUMENTS} 个草稿 · ${stage.valid ? "全部通过校验" : "存在阻塞"}`
    : `0/${MAX_STAGE_DOCUMENTS} 个草稿`;

  return `
    <section class="history-section">
      <div class="config-preview-subhead">
        <h4>发布草稿队列</h4>
        <span class="config-meta">${stageMeta}</span>
      </div>
      <p class="config-hint">可将多个配置草稿绑定在同一次发布中并统一校验，全部通过后再一键发布。发布记录会同步到版本历史，便于代码审计和追溯。</p>
      <div class="history-actions">
        <button class="config-button is-secondary config-button-compact" data-action="stage-current" ${state.current && !limitReached && !state.publishStageLoading ? "" : "disabled"}>${state.publishStageLoading ? "同步中..." : "将当前草稿加入队列"}</button>
        <button class="config-button is-secondary config-button-compact" data-action="clear-stage" ${stage && stagedCount > 0 && !state.publishStageLoading ? "" : "disabled"}>清空草稿</button>
        <button class="config-button config-button-compact" data-action="publish-stage" ${stage && stage.valid && stagedCount > 0 && !state.publishStageLoading ? "" : "disabled"}>${state.publishStageLoading ? "处理中..." : "发布草稿"}</button>
      </div>
      ${
        state.publishStageLoading && stagedCount === 0
          ? `<div class="world-preview-empty">正在加载发布草稿...</div>`
          : stagedCount === 0
            ? `<div class="world-preview-empty">暂无待发布草稿，可在左侧编辑器完成修改后加入队列。</div>`
            : `
        <div class="stage-list">
          ${documents
            .map(
              (document) => `
                <article class="stage-card ${document.validation.valid ? "" : "is-invalid"}">
                  <div>
                    <strong>${escapeHtml(document.title)}</strong>
                    <span>${document.validation.valid ? "校验通过" : document.validation.summary}</span>
                    <small>最近同步：${formatTime(document.updatedAt)}</small>
                  </div>
                  <button class="config-button is-secondary config-button-compact" data-action="remove-stage-doc" data-doc-id="${document.id}">移除</button>
                </article>
              `
            )
            .join("")}
        </div>`
      }
    </section>
  `;
}

function renderPresetSection(): string {
  if (!state.current) {
    return "";
  }

  return `
    <section class="history-section">
      <div class="config-preview-subhead">
        <h4>配置预设</h4>
        <span class="config-meta">${state.presets.length} 个可用预设</span>
      </div>
      <p class="config-hint">内置 Easy / Normal / Hard 会直接保存并刷新服务端运行时配置；自定义预设会保存当前草稿，方便保留专题调参版本。</p>
      <div class="preset-grid">
        ${state.presetsLoading
          ? `<div class="world-preview-empty">正在加载预设...</div>`
          : state.presets
              .map(
                (preset) => `
                  <article class="preset-card">
                    <div>
                      <strong>${escapeHtml(preset.name)}</strong>
                      <span>${escapeHtml(preset.description)}</span>
                      <small>${preset.kind === "builtin" ? "内置" : `更新于 ${formatTime(preset.updatedAt)}`}</small>
                    </div>
                    <button class="config-button is-secondary config-button-compact" data-action="apply-preset" data-preset-id="${preset.id}">应用</button>
                  </article>
                `
              )
              .join("")}
      </div>
      <div class="history-actions">
        <button class="config-button is-secondary config-button-compact" data-action="save-preset">保存当前为预设</button>
      </div>
    </section>
  `;
}

function renderSnapshotSection(): string {
  if (!state.current) {
    return "";
  }

  return `
    <section class="history-section">
      <div class="config-preview-subhead">
        <h4>版本快照</h4>
        <span class="config-meta">${state.snapshots.length} 个历史版本</span>
      </div>
      <p class="config-hint">快照会记录版本号和时间戳。手动保存快照之外，配置保存、预设应用和 Excel 导入后的有效变更也会自动生成版本节点；选择一个快照后可以查看与当前版本的差异，或一键回滚。</p>
      <div class="history-actions">
        <button class="config-button is-secondary config-button-compact" data-action="create-snapshot">保存快照</button>
      </div>
      <div class="snapshot-list">
        ${state.historyLoading
          ? `<div class="world-preview-empty">正在加载快照...</div>`
          : state.snapshots.length === 0
            ? `<div class="world-preview-empty">暂无快照，可以先保存一个版本节点。</div>`
            : state.snapshots
                .map(
                  (snapshot) => `
                    <article class="snapshot-card ${snapshot.id === state.selectedSnapshotId ? "is-active" : ""}">
                      <button class="snapshot-main" data-action="select-snapshot" data-snapshot-id="${snapshot.id}">
                        <strong>${escapeHtml(snapshot.label)}</strong>
                        <span>v${snapshot.version} · ${formatTime(snapshot.createdAt)}</span>
                      </button>
                      <button class="config-button is-secondary config-button-compact" data-action="rollback-snapshot" data-snapshot-id="${snapshot.id}">回滚</button>
                    </article>
                  `
                )
                .join("")}
      </div>
      ${renderSnapshotDiffPanel()}
      ${renderPublishHistoryList()}
    </section>
  `;
}

function renderSnapshotDiffPanel(): string {
  return renderConfigCenterSnapshotDiffPanel({
    selectedSnapshotId: state.selectedSnapshotId,
    snapshotDiff: state.snapshotDiff
  });
}

function renderPublishHistoryList(): string {
  return renderConfigCenterPublishHistoryList({
    publishAuditHistory: state.publishAuditHistory,
    publishAuditFilterId: state.publishAuditFilterId,
    publishAuditFilterStatus: state.publishAuditFilterStatus,
    publishAuditFilterCandidate: state.publishAuditFilterCandidate,
    publishAuditFilterRevision: state.publishAuditFilterRevision,
    historyLoading: state.historyLoading
  });
}

function renderExportSection(): string {
  if (!state.current) {
    return "";
  }

  return `
    <section class="history-section">
      <div class="config-preview-subhead">
        <h4>导入导出</h4>
        <span class="config-meta">Excel / CSV / JSON 注释版</span>
      </div>
      <p class="config-hint">Excel 会附带 Meta / Schema / Fields 三张工作表；CSV 提供轻量字段清单，适合快速审阅或粘到外部工具。</p>
      <div class="history-actions">
        <button class="config-button is-secondary config-button-compact" data-action="export-xlsx">导出 Excel</button>
        <button class="config-button is-secondary config-button-compact" data-action="export-csv">导出字段 CSV</button>
        <button class="config-button is-secondary config-button-compact" data-action="export-jsonc">导出 JSON 注释版</button>
        <label class="import-button">
          <input type="file" accept=".xlsx" data-role="import-workbook" />
          <span>导入 Excel 覆盖当前配置</span>
        </label>
      </div>
    </section>
  `;
}

function renderPreviewContent(): string {
  if (!state.current) {
    return `
      <dl>
        <div>
          <dt>状态</dt>
          <dd>请选择左侧一个配置文件。</dd>
        </div>
      </dl>
    `;
  }

  const parseState = currentParseState();
  const badges = [
    `<span class="config-badge">${state.current.fileName}</span>`,
    `<span class="config-badge">${state.storageMode === "mysql" ? "MySQL 主存储" : "文件主存储"}</span>`,
    `<span class="config-badge">${parseState.rootKeys} root key(s)</span>`,
    `<span class="config-badge">${isDirty() ? "未保存修改" : "已同步"}</span>`
  ].join("");

  const metadataRows = [
    `
      <div>
        <dt>存储模式</dt>
        <dd>${state.storageMode === "mysql" ? "MySQL + 文件导出" : "文件系统"}</dd>
      </div>
    `,
    state.current.version != null
      ? `
      <div>
        <dt>版本</dt>
        <dd>v${state.current.version}</dd>
      </div>
    `
      : "",
    state.current.exportedAt
      ? `
      <div>
        <dt>导出时间</dt>
        <dd>${formatTime(state.current.exportedAt)}</dd>
      </div>
    `
      : ""
  ].join("");

  return `
    <dl>
      <div>
        <dt>文件</dt>
        <dd>${state.current.fileName}</dd>
      </div>
      <div>
        <dt>说明</dt>
        <dd>${state.current.description}</dd>
      </div>
      <div>
        <dt>摘要</dt>
        <dd>${state.current.summary}</dd>
      </div>
      <div>
        <dt>最后更新时间</dt>
        <dd>${formatTime(state.current.updatedAt)}</dd>
      </div>
      ${metadataRows}
      <div>
        <dt>解析状态</dt>
        <dd>${parseState.valid ? "可提交" : `存在错误: ${parseState.detail}`}</dd>
      </div>
    </dl>
    <div class="config-badge-row">${badges}</div>
    <p class="config-hint">保存后会先写主存储，再导出到 <code>configs/*.json</code>，并同步刷新服务端运行时配置。新建房间、战斗公式和世界生成会直接读取最新版本。</p>
    ${renderValidationSection()}
    ${renderImpactSummarySection()}
    ${renderPublishStageSection()}
    ${renderPresetSection()}
    ${renderSnapshotSection()}
    ${renderExportSection()}
    ${renderWorldPreviewSection()}
    ${renderBattleSkillEditorSection()}
    ${renderBattleBalanceEditorSection()}
  `;
}

function refreshStatusBanner(): void {
  const status = document.querySelector<HTMLDivElement>("[data-role='status']");
  if (!status) {
    return;
  }

  status.className =
    state.statusTone === "error"
      ? "config-status tone-error"
      : state.statusTone === "success"
        ? "config-status tone-success"
        : "config-status";
  status.textContent = state.loading ? "正在加载..." : isDirty() ? "检测到未保存修改" : state.statusMessage;
}

function refreshDirtyIndicator(): void {
  const dirtyIndicator = document.querySelector<HTMLElement>("[data-role='dirty-indicator']");
  if (!dirtyIndicator) {
    return;
  }

  dirtyIndicator.textContent = isDirty() ? "未保存修改" : "内容已同步";
}

function refreshEditorValidationState(): void {
  const textarea = document.querySelector<HTMLTextAreaElement>("[data-role='editor']");
  if (!textarea) {
    return;
  }

  textarea.classList.toggle("is-invalid", Boolean(state.validation && !state.validation.valid));
}

function bindPreviewControls(): void {
  const seedInput = document.querySelector<HTMLInputElement>("[data-role='preview-seed']");
  if (seedInput) {
    seedInput.onchange = () => {
      state.previewSeed = normalizePreviewSeed(Number(seedInput.value));
      seedInput.value = String(state.previewSeed);
      scheduleWorldPreview(0);
    };
  }

  const refreshButton = document.querySelector<HTMLButtonElement>("[data-action='preview-refresh']");
  if (refreshButton) {
    refreshButton.onclick = () => {
      scheduleWorldPreview(0);
    };
  }

  const rerollButton = document.querySelector<HTMLButtonElement>("[data-action='preview-reroll']");
  if (rerollButton) {
    rerollButton.onclick = () => {
      state.previewSeed += 1;
      refreshPreviewPane();
      scheduleWorldPreview(0);
    };
  }

  bindPublishStageControls();
}

function bindSkillEditorControls(): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-role='skill-field']").forEach((field) => {
    field.onchange = () => {
      const index = Number(field.dataset.index);
      const key = field.dataset.field;
      if (!Number.isInteger(index) || !key) {
        return;
      }

      updateBattleSkillCatalogDraft((catalog) => {
        const skill = catalog.skills[index];
        if (!skill) {
          return catalog;
        }

        if (key === "cooldown") {
          skill.cooldown = Math.max(0, Math.floor(Number((field as HTMLInputElement).value) || 0));
        } else if (key === "kind") {
          skill.kind = (field as HTMLSelectElement).value as BattleSkillKind;
        } else if (key === "target") {
          skill.target = (field as HTMLSelectElement).value as BattleSkillTarget;
        } else {
          skill[key as "id" | "name" | "description"] = field.value;
        }

        return catalog;
      });
    };
  });

  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-role='skill-effect-field']").forEach((field) => {
    field.onchange = () => {
      const index = Number(field.dataset.index);
      const key = field.dataset.field;
      if (!Number.isInteger(index) || !key) {
        return;
      }

      updateBattleSkillCatalogDraft((catalog) => {
        const skill = catalog.skills[index];
        if (!skill) {
          return catalog;
        }

        const effects = { ...(skill.effects ?? {}) };
        if (key === "damageMultiplier") {
          const nextValue = (field as HTMLInputElement).value.trim();
          if (nextValue) {
            effects.damageMultiplier = Number(nextValue);
          } else {
            delete effects.damageMultiplier;
          }
        } else if (key === "grantedStatusId" || key === "onHitStatusId") {
          const nextValue = (field as HTMLSelectElement).value;
          if (nextValue) {
            effects[key] = nextValue;
          } else if (key === "grantedStatusId") {
            delete effects.grantedStatusId;
          } else {
            delete effects.onHitStatusId;
          }
        }

        const nextEffects = cleanupSkillEffects(effects);
        if (nextEffects) {
          skill.effects = nextEffects;
        } else {
          delete skill.effects;
        }
        return catalog;
      });
    };
  });

  document.querySelectorAll<HTMLInputElement>("[data-role='skill-effect-bool']").forEach((field) => {
    field.onchange = () => {
      const index = Number(field.dataset.index);
      const key = field.dataset.field;
      if (!Number.isInteger(index) || !key) {
        return;
      }

      updateBattleSkillCatalogDraft((catalog) => {
        const skill = catalog.skills[index];
        if (!skill) {
          return catalog;
        }

        const effects = { ...(skill.effects ?? {}) };
        effects.allowRetaliation = field.checked;
        const nextEffects = cleanupSkillEffects(effects);
        if (nextEffects) {
          skill.effects = nextEffects;
        } else {
          delete skill.effects;
        }
        return catalog;
      });
    };
  });

  document.querySelectorAll<HTMLInputElement>("[data-role='status-field']").forEach((field) => {
    field.onchange = () => {
      const index = Number(field.dataset.index);
      const key = field.dataset.field;
      if (!Number.isInteger(index) || !key) {
        return;
      }

      updateBattleSkillCatalogDraft((catalog) => {
        const status = catalog.statuses[index];
        if (!status) {
          return catalog;
        }

        if (key === "duration" || key === "damagePerTurn") {
          status[key] = Math.max(0, Math.floor(Number(field.value) || 0));
        } else if (key === "attackModifier" || key === "defenseModifier") {
          status[key] = Math.floor(Number(field.value) || 0);
        } else {
          status[key as "id" | "name" | "description"] = field.value;
        }

        return catalog;
      });
    };
  });
}

function bindBattleBalanceEditorControls(): void {
  document.querySelectorAll<HTMLInputElement>("[data-role='battle-balance-field']").forEach((field) => {
    field.onchange = () => {
      const section = field.dataset.section as "damage" | "environment" | "pvp" | "root" | undefined;
      const key = field.dataset.field;
      if (!section || !key) {
        return;
      }

      updateBattleBalanceDraft((config) => {
        const numericValue = Number(field.value);
        const nextValue =
          key === "blockerDurability" ||
          key === "trapDamage" ||
          key === "trapCharges" ||
          key === "eloK" ||
          key === "turnTimerSeconds" ||
          key === "afkStrikesBeforeForfeit"
            ? Math.floor(Number.isFinite(numericValue) ? numericValue : 0)
            : Number.isFinite(numericValue)
              ? numericValue
              : 0;

        if (section === "damage") {
          config.damage[key as keyof BattleBalanceConfig["damage"]] = nextValue;
        } else if (section === "environment") {
          config.environment[key as Exclude<keyof BattleBalanceConfig["environment"], "trapGrantedStatusId">] = nextValue;
        } else if (section === "root") {
          config[key as "turnTimerSeconds" | "afkStrikesBeforeForfeit"] = nextValue;
        } else {
          config.pvp[key as keyof BattleBalanceConfig["pvp"]] = nextValue;
        }

        return config;
      });
    };
  });

  document.querySelectorAll<HTMLInputElement>("[data-role='battle-balance-status']").forEach((field) => {
    field.onchange = () => {
      updateBattleBalanceDraft((config) => {
        const nextValue = field.value.trim();
        if (nextValue) {
          config.environment.trapGrantedStatusId = nextValue;
        } else {
          delete config.environment.trapGrantedStatusId;
        }
        return config;
      });
    };
  });
}

function bindPublishStageControls(): void {
  document.querySelector<HTMLButtonElement>("[data-action='stage-current']")?.addEventListener("click", () => {
    void stageCurrentDraft();
  });

  document.querySelector<HTMLButtonElement>("[data-action='clear-stage']")?.addEventListener("click", () => {
    void clearPublishStage();
  });

  document.querySelector<HTMLButtonElement>("[data-action='publish-stage']")?.addEventListener("click", () => {
    void publishStageDrafts();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='remove-stage-doc']").forEach((button) => {
    button.addEventListener("click", () => {
      const docId = button.dataset.docId as ConfigDocumentId | undefined;
      if (docId) {
        void removeDocumentFromStage(docId);
      }
    });
  });

  const documentFilter = document.querySelector<HTMLSelectElement>("[data-role='publish-filter-doc']");
  documentFilter?.addEventListener("change", () => {
    setPublishAuditFilters({
      documentId: (documentFilter.value || "all") as ConfigDocumentId | "all"
    });
  });

  const statusFilter = document.querySelector<HTMLSelectElement>("[data-role='publish-filter-status']");
  statusFilter?.addEventListener("change", () => {
    setPublishAuditFilters({
      resultStatus: (statusFilter.value || "all") as ConfigPublishResultStatus | "all"
    });
  });

  const candidateFilter = document.querySelector<HTMLInputElement>("[data-role='publish-filter-candidate']");
  candidateFilter?.addEventListener("input", () => {
    setPublishAuditFilters({
      candidate: candidateFilter.value
    });
  });

  const revisionFilter = document.querySelector<HTMLInputElement>("[data-role='publish-filter-revision']");
  revisionFilter?.addEventListener("input", () => {
    setPublishAuditFilters({
      revision: revisionFilter.value
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='inspect-publish-change']").forEach((button) => {
    button.addEventListener("click", () => {
      const docId = button.dataset.docId as ConfigDocumentId | undefined;
      const snapshotId = button.dataset.snapshotId;
      if (docId && snapshotId) {
        void inspectPublishedSnapshot(docId, snapshotId);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='rollback-publish-change']").forEach((button) => {
    button.addEventListener("click", () => {
      const docId = button.dataset.docId as ConfigDocumentId | undefined;
      const snapshotId = button.dataset.snapshotId;
      if (docId && snapshotId) {
        void rollbackPublishedSnapshot(docId, snapshotId);
      }
    });
  });
}

function refreshPreviewPane(): void {
  const preview = document.querySelector<HTMLDivElement>("[data-role='preview-content']");
  if (!preview) {
    return;
  }

  preview.innerHTML = renderPreviewContent();
  bindPreviewControls();
  bindSkillEditorControls();
  bindBattleBalanceEditorControls();
}

function refreshLivePanels(): void {
  refreshStatusBanner();
  refreshDirtyIndicator();
  refreshEditorValidationState();
  refreshPreviewPane();
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-config-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextId = button.dataset.configId as ConfigDocumentId | undefined;
      if (nextId) {
        void loadDocument(nextId);
      }
    });
  });

  const reloadButton = document.querySelector<HTMLButtonElement>("[data-action='reload']");
  reloadButton?.addEventListener("click", () => {
    if (state.current) {
      void loadDocument(state.current.id);
    }
  });

  const saveButton = document.querySelector<HTMLButtonElement>("[data-action='save']");
  saveButton?.addEventListener("click", () => {
    void saveCurrentDocument();
  });

  const restoreButton = document.querySelector<HTMLButtonElement>("[data-action='restore']");
  restoreButton?.addEventListener("click", () => {
    restoreCurrentDocument();
  });

  document.querySelector<HTMLButtonElement>("[data-action='create-snapshot']")?.addEventListener("click", () => {
    void createSnapshot();
  });

  document.querySelector<HTMLButtonElement>("[data-action='save-preset']")?.addEventListener("click", () => {
    void saveCurrentAsPreset();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='apply-preset']").forEach((button) => {
    button.addEventListener("click", () => {
      const presetId = button.dataset.presetId;
      if (presetId) {
        void applyPreset(presetId);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='select-snapshot']").forEach((button) => {
    button.addEventListener("click", () => {
      const snapshotId = button.dataset.snapshotId;
      if (!snapshotId) {
        return;
      }
      state.selectedSnapshotId = snapshotId;
      void loadSnapshotDiff();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='rollback-snapshot']").forEach((button) => {
    button.addEventListener("click", () => {
      const snapshotId = button.dataset.snapshotId;
      if (snapshotId) {
        void rollbackSnapshot(snapshotId);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='validation-jump']").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const issue = state.validation?.issues[index];
      jumpToValidationIssue(issue?.line);
    });
  });

  document.querySelector<HTMLButtonElement>("[data-action='export-xlsx']")?.addEventListener("click", () => {
    void exportCurrentDocument("xlsx");
  });

  document.querySelector<HTMLButtonElement>("[data-action='export-csv']")?.addEventListener("click", () => {
    void exportCurrentDocument("csv");
  });

  document.querySelector<HTMLButtonElement>("[data-action='export-jsonc']")?.addEventListener("click", () => {
    void exportCurrentDocument("jsonc");
  });

  const importInput = document.querySelector<HTMLInputElement>("[data-role='import-workbook']");
  importInput?.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (file) {
      void importWorkbook(file);
      importInput.value = "";
    }
  });

  const textarea = document.querySelector<HTMLTextAreaElement>("[data-role='editor']");
  textarea?.addEventListener("input", () => {
    state.draft = textarea.value;
    refreshLivePanels();

    if (isWorldDocumentSelected()) {
      scheduleWorldPreview();
    }
    void loadValidation(WORLD_PREVIEW_DEBOUNCE_MS);
  });

  bindPreviewControls();
}

function render(): void {
  const saveDisabled = isConfigCenterSaveDisabled({
    currentDocumentId: state.current?.id ?? null,
    loading: state.loading,
    saving: state.saving,
    validationLoading: state.validationLoading,
    validation: state.validation
  });
  const statusClass =
    state.statusTone === "error"
      ? "config-status tone-error"
      : state.statusTone === "success"
        ? "config-status tone-success"
        : "config-status";

  root.innerHTML = `
    <main class="config-shell">
      <section class="config-frame">
        <aside class="config-sidebar">
          <div class="config-eyebrow">Project Veil</div>
          <h1 class="config-title">配置中心</h1>
          <p class="config-lead">前端通过 API 读取和保存配置；若服务端检测到 MySQL 环境变量，就会切换到 MySQL 主存储，并自动导出一份文件到 <code>configs/</code>。</p>
          <div class="config-storage-pill">${state.storageMode === "mysql" ? "当前存储: MySQL + 文件导出" : "当前存储: 文件系统"}</div>
          <div class="config-list">
            ${state.items
              .map(
                (item) => `
                  <button class="config-card${item.id === state.selectedId ? " is-active" : ""}" data-config-id="${item.id}">
                    <strong>${item.title}</strong>
                    <span>${item.summary}</span>
                    <small>${item.fileName}</small>
                  </button>
                `
              )
              .join("")}
          </div>
        </aside>
        <section class="config-main">
          <div class="config-main-head">
            <div>
              <div class="config-eyebrow">Linked Editor</div>
              <h2>${state.current?.title ?? "加载中..."}</h2>
              <p>${state.current?.description ?? "正在读取配置文档。"}</p>
            </div>
            <div class="config-actions">
              <button class="config-button is-secondary" data-action="reload" ${state.current ? "" : "disabled"}>重新加载</button>
              <button class="config-button is-secondary" data-action="restore" ${state.current ? "" : "disabled"}>放弃修改</button>
              <button class="config-button" data-action="save" ${saveDisabled ? "disabled" : ""}>${state.saving ? "保存中..." : "保存配置"}</button>
            </div>
          </div>
          <div class="${statusClass}" data-role="status">${state.loading ? "正在加载..." : state.statusMessage}</div>
          <div class="config-grid">
            <section class="config-editor">
              <div class="config-editor-head">
                <h3>JSON 编辑器</h3>
                <span class="config-meta" data-role="dirty-indicator">${isDirty() ? "未保存修改" : "内容已同步"}</span>
              </div>
              <textarea class="config-textarea${state.validation && !state.validation.valid ? " is-invalid" : ""}" data-role="editor" spellcheck="false" ${state.current ? "" : "disabled"}>${state.draft}</textarea>
            </section>
            <aside class="config-preview">
              <div class="config-preview-head">
                <h3>提交预览</h3>
                <span class="config-meta">${state.current ? formatTime(state.current.updatedAt) : "-"}</span>
              </div>
              <div data-role="preview-content">${renderPreviewContent()}</div>
            </aside>
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

export async function bootstrapConfigCenterApp(): Promise<void> {
  initializeConfigCenterRuntime();
  render();
  try {
    await loadList();
    await loadPublishStage();
    await loadPublishAuditHistory();
    const requestedId = new URLSearchParams(window.location.search).get("config") as ConfigDocumentId | null;
    const initialId = requestedId && state.items.some((item) => item.id === requestedId) ? requestedId : state.items[0]?.id ?? null;

    render();

    if (initialId) {
      await loadDocument(initialId);
      return;
    }

    state.loading = false;
    state.statusMessage = "没有发现可编辑的配置文档";
    render();
  } catch (error) {
    state.loading = false;
    state.statusTone = "error";
    state.statusMessage = error instanceof Error ? error.message : "配置中心初始化失败";
    render();
  }
}
