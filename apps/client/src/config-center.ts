import "./config-center.css";

type ConfigDocumentId = "world" | "mapObjects" | "units";

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
}

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
  draft: ""
};

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
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

function isDirty(): boolean {
  return state.current != null && state.draft !== state.current.content;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json()) as T & ApiErrorPayload;

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Request failed: ${response.status}`);
  }

  return data;
}

async function loadList(): Promise<void> {
  const response = await requestJson<{
    storage: "filesystem" | "mysql";
    items: ConfigDocumentSummary[];
  }>("/api/config-center/configs");
  state.storageMode = response.storage;
  state.items = response.items;
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
  } catch (error) {
    state.statusTone = "error";
    state.statusMessage = error instanceof Error ? error.message : "加载配置失败";
  } finally {
    state.loading = false;
    render();
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
  } catch (error) {
    state.statusTone = "error";
    state.statusMessage = error instanceof Error ? error.message : "保存配置失败";
  } finally {
    state.saving = false;
    render();
  }
}

function restoreCurrentDocument(): void {
  if (!state.current) {
    return;
  }

  state.draft = state.current.content;
  state.statusTone = "neutral";
  state.statusMessage = `${state.current.title} 已恢复到上次加载内容`;
  render();
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
  `;
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
    const status = document.querySelector<HTMLDivElement>("[data-role='status']");
    const preview = document.querySelector<HTMLDivElement>("[data-role='preview-content']");
    if (status) {
      status.className = `config-status${state.statusTone === "error" ? " tone-error" : state.statusTone === "success" ? " tone-success" : ""}`;
      status.textContent = isDirty() ? "检测到未保存修改" : state.statusMessage;
    }
    if (preview) {
      preview.innerHTML = renderPreviewContent();
    }
    const dirtyIndicator = document.querySelector<HTMLElement>("[data-role='dirty-indicator']");
    if (dirtyIndicator) {
      dirtyIndicator.textContent = isDirty() ? "未保存修改" : "内容已同步";
    }
  });
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
