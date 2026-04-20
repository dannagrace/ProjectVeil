import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerLaunchRuntimeRoutes } from "@server/transport/http/launch-runtime-routes";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

function createTestApp() {
  const gets = new Map<string, RouteHandler>();

  return {
    app: {
      use(_handler: unknown) {},
      get(path: string, handler: RouteHandler) {
        gets.set(path, handler);
      }
    },
    gets
  };
}

function createRequest(url: string): IncomingMessage {
  async function* iterateBody() {
    return;
  }

  const request = iterateBody() as IncomingMessage;
  Object.assign(request, {
    method: "GET",
    headers: {},
    url
  });
  return request;
}

function createResponse(): ServerResponse & { body: string } {
  let body = "";
  return {
    statusCode: 200,
    setHeader() {
      return this;
    },
    end(chunk?: string | Buffer) {
      body = chunk === undefined ? "" : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      return this;
    },
    get body() {
      return body;
    }
  } as ServerResponse & { body: string };
}

async function withAnnouncementConfig(payload: unknown): Promise<() => void> {
  const dir = await mkdtemp(join(tmpdir(), "veil-launch-runtime-"));
  const filePath = join(dir, "announcements.json");
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const originalPath = process.env.VEIL_ANNOUNCEMENTS_CONFIG;
  process.env.VEIL_ANNOUNCEMENTS_CONFIG = filePath;
  return () => {
    if (originalPath === undefined) {
      delete process.env.VEIL_ANNOUNCEMENTS_CONFIG;
    } else {
      process.env.VEIL_ANNOUNCEMENTS_CONFIG = originalPath;
    }
  };
}

test("launch runtime routes expose active announcements and maintenance mode", async (t) => {
  const restore = await withAnnouncementConfig({
    announcements: [
      {
        id: "notice-1",
        title: "停服预告",
        message: "10 分钟后进入维护。",
        tone: "warning",
        startsAt: "2020-04-17T08:00:00.000Z",
        endsAt: "2099-04-17T11:00:00.000Z"
      }
    ],
    maintenanceMode: {
      enabled: true,
      title: "停服维护中",
      message: "预计 10:00 恢复。",
      nextOpenAt: "2026-04-17T10:00:00.000Z",
      whitelistPlayerIds: [],
      whitelistLoginIds: []
    }
  });
  t.after(restore);

  const { app, gets } = createTestApp();
  registerLaunchRuntimeRoutes(app as never);

  const announcementResponse = createResponse();
  await gets.get("/api/announcements/current")?.(createRequest("/api/announcements/current"), announcementResponse);
  assert.equal(announcementResponse.statusCode, 200);
  const announcementPayload = JSON.parse(announcementResponse.body) as { items: Array<{ id: string }> };
  assert.deepEqual(announcementPayload.items.map((entry) => entry.id), ["notice-1"]);

  const maintenanceResponse = createResponse();
  await gets.get("/api/runtime/maintenance-mode")?.(createRequest("/api/runtime/maintenance-mode"), maintenanceResponse);
  assert.equal(maintenanceResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(maintenanceResponse.body), {
    active: true,
    title: "停服维护中",
    message: "预计 10:00 恢复。",
    nextOpenAt: "2026-04-17T10:00:00.000Z"
  });
});
