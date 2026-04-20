import type { IncomingMessage, ServerResponse } from "node:http";
import type { MapObjectsConfig, WorldGenerationConfig } from "@veil/shared/models";
import type { ConfigCenterStore, ConfigDocumentId, ConfigStageDocumentInput } from "@server/domain/config-center/types";
import { CONFIG_DEFINITIONS } from "@server/domain/config-center/constants";
import {
  configDefinitionFor,
  normalizePreviewSeed,
  readJsonBody,
  sendJson,
  sendNotFound,
  toErrorPayload
} from "@server/domain/config-center/helpers";
import { buildConfigDiffEntries, buildConfigImpactSummary } from "@server/domain/config-center/diff";
import { createWorldConfigPreview, parseConfigDocument } from "@server/domain/config-center/preview";

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

  app.get("/api/config-center/configs/:id/diff-preview", async (request, response) => {
    const configId = request.params.id;
    const definition = configId ? configDefinitionFor(configId) : undefined;
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      sendJson(response, 200, {
        storage: store.mode,
        preview: await store.previewStagedDiff(definition.id)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
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
      const body = (await readJsonBody(request)) as {
        author?: string;
        summary?: string;
        candidate?: string | null;
        revision?: string | null;
        confirmedDiffHash?: string | null;
      };
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
        summary: body.summary.trim(),
        candidate: typeof body.candidate === "string" ? body.candidate : null,
        revision: typeof body.revision === "string" ? body.revision : null,
        confirmedDiffHash: typeof body.confirmedDiffHash === "string" ? body.confirmedDiffHash : null
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
