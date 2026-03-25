import "./config-center.css";

type ConfigDocumentId = "world" | "mapObjects" | "units" | "battleSkills";
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
        visitedCount: number;
      }
    | {
        kind: "resource_mine";
        refId: string;
        label: string;
        resourceKind: ResourceKind;
        income: number;
        ownerPlayerId?: string;
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
}

const WORLD_PREVIEW_DEBOUNCE_MS = 260;

const RESOURCE_SHORT_LABEL: Record<ResourceKind, string> = {
  gold: "G",
  wood: "W",
  ore: "O"
};

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("Missing #app");
}

const root = appRoot;

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
  previewError: ""
};

let previewRequestVersion = 0;
let previewDebounceTimer: number | null = null;

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

function normalizePreviewSeed(value: number, fallback = state.previewSeed): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

function setDraftContent(nextDraft: string): void {
  state.draft = nextDraft;
  const textarea = document.querySelector<HTMLTextAreaElement>("[data-role='editor']");
  if (textarea && textarea.value !== nextDraft) {
    textarea.value = nextDraft;
  }
  refreshLivePanels();
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

function clearWorldPreview(cancelPending = true): void {
  if (cancelPending && previewDebounceTimer != null) {
    window.clearTimeout(previewDebounceTimer);
    previewDebounceTimer = null;
  }

  previewRequestVersion += 1;
  state.worldPreview = null;
  state.previewLoading = false;
  state.previewError = "";
}

async function loadList(): Promise<void> {
  const response = await requestJson<{
    storage: "filesystem" | "mysql";
    items: ConfigDocumentSummary[];
  }>("/api/config-center/configs");
  state.storageMode = response.storage;
  state.items = response.items;
}

async function loadWorldPreview(): Promise<void> {
  if (!isWorldDocumentSelected()) {
    clearWorldPreview();
    refreshPreviewPane();
    return;
  }

  const parseState = currentParseState();
  if (!parseState.valid) {
    state.previewLoading = false;
    state.worldPreview = null;
    state.previewError = `JSON 语法无效：${parseState.detail}`;
    refreshPreviewPane();
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
      refreshPreviewPane();
    }
  }
}

function scheduleWorldPreview(delayMs = WORLD_PREVIEW_DEBOUNCE_MS): void {
  if (!isWorldDocumentSelected()) {
    clearWorldPreview();
    refreshPreviewPane();
    return;
  }

  if (previewDebounceTimer != null) {
    window.clearTimeout(previewDebounceTimer);
    previewDebounceTimer = null;
  }

  const parseState = currentParseState();
  if (!parseState.valid) {
    state.previewLoading = false;
    state.worldPreview = null;
    state.previewError = `JSON 语法无效：${parseState.detail}`;
    refreshPreviewPane();
    return;
  }

  state.previewLoading = true;
  state.previewError = "";
  refreshPreviewPane();

  previewDebounceTimer = window.setTimeout(() => {
    previewDebounceTimer = null;
    void loadWorldPreview();
  }, delayMs);
}

async function loadDocument(id: ConfigDocumentId): Promise<void> {
  state.loading = true;
  state.statusTone = "neutral";
  state.statusMessage = `正在加载 ${id} 配置...`;
  render();

  try {
    const response = await requestJson<{
      storage: "filesystem" | "mysql";
      document: ConfigDocument;
    }>(`/api/config-center/configs/${id}`);
    state.storageMode = response.storage;
    state.current = response.document;
    state.selectedId = response.document.id;
    state.draft = response.document.content;
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
    render();

    if (isWorldDocumentSelected()) {
      void loadWorldPreview();
    }
  }
}

async function saveCurrentDocument(): Promise<void> {
  if (!state.current || state.saving) {
    return;
  }

  state.saving = true;
  state.statusTone = "neutral";
  state.statusMessage = `正在保存 ${state.current.title}...`;
  render();

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

    if (response.document.id === "world") {
      state.previewLoading = true;
      state.previewError = "";
    }
  } catch (error) {
    state.statusTone = "error";
    state.statusMessage = error instanceof Error ? error.message : "保存配置失败";
  } finally {
    state.saving = false;
    render();

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

  render();

  if (isWorldDocumentSelected()) {
    void loadWorldPreview();
  }
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
      parts.push(`建筑: ${tile.building.label} / ${bonus.join("、") || "属性加成"} / 访问 ${tile.building.visitedCount}`);
    } else {
      parts.push(`建筑: ${tile.building.label} / ${tile.building.resourceKind} +${tile.building.income}/day${tile.building.ownerPlayerId ? ` / ${tile.building.ownerPlayerId}` : ""}`);
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
    ${renderWorldPreviewSection()}
    ${renderBattleSkillEditorSection()}
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

function refreshPreviewPane(): void {
  const preview = document.querySelector<HTMLDivElement>("[data-role='preview-content']");
  if (!preview) {
    return;
  }

  preview.innerHTML = renderPreviewContent();
  bindPreviewControls();
  bindSkillEditorControls();
}

function refreshLivePanels(): void {
  refreshStatusBanner();
  refreshDirtyIndicator();
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

  const textarea = document.querySelector<HTMLTextAreaElement>("[data-role='editor']");
  textarea?.addEventListener("input", () => {
    state.draft = textarea.value;
    refreshLivePanels();

    if (isWorldDocumentSelected()) {
      scheduleWorldPreview();
    }
  });

  bindPreviewControls();
}

function render(): void {
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
              <button class="config-button" data-action="save" ${state.current && !state.loading && !state.saving ? "" : "disabled"}>${state.saving ? "保存中..." : "保存配置"}</button>
            </div>
          </div>
          <div class="${statusClass}" data-role="status">${state.loading ? "正在加载..." : state.statusMessage}</div>
          <div class="config-grid">
            <section class="config-editor">
              <div class="config-editor-head">
                <h3>JSON 编辑器</h3>
                <span class="config-meta" data-role="dirty-indicator">${isDirty() ? "未保存修改" : "内容已同步"}</span>
              </div>
              <textarea class="config-textarea" data-role="editor" spellcheck="false" ${state.current ? "" : "disabled"}>${state.draft}</textarea>
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

async function bootstrap(): Promise<void> {
  render();
  try {
    await loadList();
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

void bootstrap();
