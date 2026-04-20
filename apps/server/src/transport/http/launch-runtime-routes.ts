import type { IncomingMessage, ServerResponse } from "node:http";
import {
  loadLaunchRuntimeState,
  resolveActiveLaunchAnnouncements,
  resolveLaunchMaintenanceAccess
} from "@server/domain/ops/launch-runtime-state";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function toErrorPayload(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "error" : "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

export function registerLaunchRuntimeRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  }
): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/announcements/current", async (_request, response) => {
    try {
      const state = await loadLaunchRuntimeState();
      sendJson(response, 200, {
        items: resolveActiveLaunchAnnouncements(state),
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/maintenance-mode", async (_request, response) => {
    try {
      const state = await loadLaunchRuntimeState();
      const maintenance = resolveLaunchMaintenanceAccess(state);
      sendJson(response, 200, {
        active: maintenance.active,
        title: maintenance.title,
        message: maintenance.message,
        ...(maintenance.nextOpenAt ? { nextOpenAt: maintenance.nextOpenAt } : {})
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
