import type { IncomingMessage, ServerResponse } from "node:http";
import type { ConfigCenterStore, ConfigDocumentId, ConfigDocumentSummary } from "@server/config-center";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import { timingSafeCompareAdminToken } from "@server/infra/admin-token";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendHtml(response: ServerResponse, html: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "Config document not found"
    }
  });
}

function toErrorPayload(error: unknown): { code: string; message: string } {
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

function normalizeSummaryItem(item: ConfigDocumentSummary) {
  return {
    id: item.id,
    title: item.title,
    updatedAt: item.updatedAt,
    summary: item.summary,
    storage: item.storage,
    version: item.version ?? 1
  };
}

function requireConfigViewerAdminToken(request: IncomingMessage, response: ServerResponse): string | null {
  const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
  if (!adminToken) {
    sendJson(response, 503, {
      error: {
        code: "not_configured",
        message: "Admin token not configured"
      }
    });
    return null;
  }

  const headerValue = request.headers["x-veil-admin-token"];
  const requestToken = Array.isArray(headerValue) ? headerValue[0]?.trim() ?? null : headerValue?.trim() ?? null;
  if (!timingSafeCompareAdminToken(requestToken, adminToken)) {
    sendJson(response, 403, {
      error: {
        code: "forbidden",
        message: "Invalid admin token"
      }
    });
    return null;
  }

  return requestToken;
}

function buildViewerHtml(adminToken?: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Project Veil Config Viewer</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3efe7;
        --panel: rgba(255, 252, 246, 0.94);
        --panel-strong: #fffaf0;
        --border: #d6c8b4;
        --text: #261d15;
        --muted: #6d5b4b;
        --accent: #8f3b2e;
        --accent-soft: #f5ddd4;
        --code: #1f1d1a;
        --shadow: 0 18px 50px rgba(58, 38, 16, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(201, 140, 92, 0.18), transparent 28%),
          radial-gradient(circle at top right, rgba(143, 59, 46, 0.16), transparent 32%),
          linear-gradient(180deg, #efe7da 0%, var(--bg) 100%);
      }

      main {
        width: min(1100px, calc(100vw - 32px));
        margin: 32px auto 48px;
      }

      .hero {
        margin-bottom: 18px;
        padding: 28px;
        border: 1px solid rgba(143, 59, 46, 0.18);
        border-radius: 24px;
        background: linear-gradient(135deg, rgba(255, 249, 240, 0.96), rgba(248, 238, 225, 0.92));
        box-shadow: var(--shadow);
      }

      .eyebrow {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--accent);
      }

      h1 {
        margin: 0 0 10px;
        font-size: clamp(32px, 5vw, 52px);
        line-height: 0.98;
      }

      .hero p,
      .status,
      .meta,
      .doc-summary {
        color: var(--muted);
      }

      .hero p {
        margin: 0;
        max-width: 720px;
        font-size: 17px;
        line-height: 1.5;
      }

      .status {
        min-height: 24px;
        margin: 16px 0 0;
        font-size: 14px;
      }

      .status.error {
        color: #9a1f1f;
      }

      .list {
        display: grid;
        gap: 14px;
      }

      .card {
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--panel);
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .card-head {
        display: flex;
        gap: 16px;
        justify-content: space-between;
        align-items: flex-start;
        padding: 20px 22px;
      }

      .card-title {
        margin: 0 0 6px;
        font-size: 24px;
      }

      .doc-id {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.04em;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 14px;
        margin: 0 0 10px;
        font-size: 14px;
      }

      .doc-summary {
        margin: 0;
        font-size: 15px;
      }

      .expand-button {
        flex: 0 0 auto;
        border: 1px solid rgba(143, 59, 46, 0.28);
        border-radius: 999px;
        background: var(--panel-strong);
        color: var(--accent);
        padding: 10px 16px;
        font: 700 14px/1 system-ui, sans-serif;
        cursor: pointer;
      }

      .expand-button:hover {
        background: #fff;
      }

      .expand-button:disabled {
        opacity: 0.65;
        cursor: wait;
      }

      .details {
        display: none;
        border-top: 1px solid rgba(214, 200, 180, 0.8);
        padding: 0 22px 22px;
      }

      .details[data-open="true"] {
        display: block;
      }

      .details-status {
        margin: 14px 0 12px;
        font-size: 14px;
        color: var(--muted);
      }

      pre {
        margin: 0;
        padding: 16px;
        overflow: auto;
        border-radius: 16px;
        background: var(--code);
        color: #f8f3ea;
        font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      @media (max-width: 720px) {
        main {
          width: min(100vw - 20px, 1100px);
          margin-top: 12px;
        }

        .hero,
        .card-head,
        .details {
          padding-left: 16px;
          padding-right: 16px;
        }

        .card-head {
          flex-direction: column;
        }

        .expand-button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Project Veil</p>
        <h1>Config Viewer</h1>
        <p>Read-only server page for the config-center documents. Each row shows the latest metadata, and expanding a row fetches the full JSON on demand.</p>
        <div id="status" class="status" role="status" aria-live="polite">Loading config documents...</div>
      </section>
      <section id="list" class="list" aria-label="Config documents"></section>
    </main>
    <script>
      const statusNode = document.getElementById("status");
      const listNode = document.getElementById("list");
      const adminToken = ${JSON.stringify(adminToken ?? "")};

      function setStatus(message, isError) {
        statusNode.textContent = message;
        statusNode.className = isError ? "status error" : "status";
      }

      function formatTimestamp(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
      }

      function renderDetails(container, payload) {
        const pre = container.querySelector("pre");
        const status = container.querySelector(".details-status");
        pre.textContent = JSON.stringify(payload.document, null, 2);
        status.textContent = "Fetched " + formatTimestamp(new Date().toISOString());
      }

      async function toggleDetails(item, button, details) {
        const isOpen = details.dataset.open === "true";
        if (isOpen) {
          details.dataset.open = "false";
          button.textContent = "Expand JSON";
          button.setAttribute("aria-expanded", "false");
          return;
        }

        button.disabled = true;
        button.textContent = "Loading...";

        try {
          const response = await fetch("/api/config/" + encodeURIComponent(item.id), {
            headers: adminToken ? { "x-veil-admin-token": adminToken } : {}
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload && payload.error && payload.error.message ? payload.error.message : "Request failed");
          }

          renderDetails(details, payload);
          details.dataset.open = "true";
          button.textContent = "Collapse JSON";
          button.setAttribute("aria-expanded", "true");
        } catch (error) {
          details.dataset.open = "true";
          details.querySelector(".details-status").textContent = error instanceof Error ? error.message : "Failed to load config JSON";
          details.querySelector("pre").textContent = "";
          button.textContent = "Retry JSON";
          button.setAttribute("aria-expanded", "true");
        } finally {
          button.disabled = false;
        }
      }

      function createCard(item) {
        const card = document.createElement("article");
        card.className = "card";

        const head = document.createElement("div");
        head.className = "card-head";

        const body = document.createElement("div");
        const title = document.createElement("h2");
        title.className = "card-title";
        title.textContent = item.title;

        const idPill = document.createElement("div");
        idPill.className = "doc-id";
        idPill.textContent = item.id;

        const meta = document.createElement("p");
        meta.className = "meta";
        meta.textContent =
          "updatedAt: " + formatTimestamp(item.updatedAt) +
          "  |  storage: " + item.storage +
          "  |  version: " + String(item.version);

        const summary = document.createElement("p");
        summary.className = "doc-summary";
        summary.textContent = item.summary;

        body.appendChild(idPill);
        body.appendChild(title);
        body.appendChild(meta);
        body.appendChild(summary);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "expand-button";
        button.textContent = "Expand JSON";
        button.setAttribute("aria-expanded", "false");

        const details = document.createElement("div");
        details.className = "details";
        details.dataset.open = "false";

        const detailsStatus = document.createElement("div");
        detailsStatus.className = "details-status";
        detailsStatus.textContent = "JSON is fetched only when expanded.";

        const pre = document.createElement("pre");
        pre.textContent = "";

        details.appendChild(detailsStatus);
        details.appendChild(pre);

        button.addEventListener("click", function () {
          void toggleDetails(item, button, details);
        });

        head.appendChild(body);
        head.appendChild(button);
        card.appendChild(head);
        card.appendChild(details);
        return card;
      }

      async function load() {
        try {
          const response = await fetch("/api/config", {
            headers: adminToken ? { "x-veil-admin-token": adminToken } : {}
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload && payload.error && payload.error.message ? payload.error.message : "Failed to load config list");
          }

          listNode.innerHTML = "";
          payload.items.forEach(function (item) {
            listNode.appendChild(createCard(item));
          });
          setStatus("Loaded " + payload.items.length + " documents.");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Failed to load config documents.", true);
        }
      }

      void load();
    </script>
  </body>
</html>`;
}

export function registerConfigViewerRoutes(
  app: {
    get: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: ConfigCenterStore
): void {
  app.get("/config-viewer", (request, response) => {
    const adminToken = requireConfigViewerAdminToken(request, response);
    if (!adminToken) {
      return;
    }

    sendHtml(response, buildViewerHtml(adminToken));
  });

  app.get("/api/config", async (request, response) => {
    const adminToken = requireConfigViewerAdminToken(request, response);
    if (!adminToken) {
      return;
    }

    try {
      const items = await store.listDocuments();
      sendJson(response, 200, {
        items: items.map(normalizeSummaryItem)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/config/:id", async (request, response) => {
    const adminToken = requireConfigViewerAdminToken(request, response);
    if (!adminToken) {
      return;
    }

    const configId = request.params.id as ConfigDocumentId | undefined;
    if (!configId) {
      sendNotFound(response);
      return;
    }

    try {
      const document = await store.loadDocument(configId);
      sendJson(response, 200, {
        document: {
          id: document.id,
          title: document.title,
          updatedAt: document.updatedAt,
          summary: document.summary,
          storage: document.storage,
          version: document.version ?? 1,
          content: JSON.parse(document.content)
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unsupported config id:")) {
        sendNotFound(response);
        return;
      }

      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}

export function buildConfigViewerPageForTest(): string {
  return buildViewerHtml();
}
