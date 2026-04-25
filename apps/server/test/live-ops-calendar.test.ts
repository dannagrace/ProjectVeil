import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDefaultLaunchRuntimeState,
  loadLaunchRuntimeState
} from "@server/domain/ops/launch-runtime-state";
import {
  createLiveOpsCalendarScheduler,
  loadLiveOpsCalendarState,
  registerLiveOpsCalendarRoutes,
  runLiveOpsCalendarTick,
  saveLiveOpsCalendarState,
  type LiveOpsCalendarEntry
} from "@server/domain/social/live-ops-calendar";
import {
  resetSeasonalEventRuntimeState,
  resolveSeasonalEvents,
  resolveSeasonalEventStatus
} from "@server/domain/battle/event-engine";

type RouteHandler = (request: any, response: ServerResponse) => void | Promise<void>;

function createTestApp() {
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();
  const deletes = new Map<string, RouteHandler>();

  return {
    app: {
      get(path: string, handler: RouteHandler) {
        gets.set(path, handler);
      },
      post(path: string, handler: RouteHandler) {
        posts.set(path, handler);
      },
      delete(path: string, handler: RouteHandler) {
        deletes.set(path, handler);
      }
    },
    gets,
    posts,
    deletes
  };
}

function createRequest(options: {
  method?: string;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string>;
  body?: string;
} = {}): IncomingMessage & { params: Record<string, string> } {
  async function* iterateBody() {
    if (options.body !== undefined) {
      yield Buffer.from(options.body, "utf8");
    }
  }

  const request = iterateBody() as IncomingMessage & { params: Record<string, string> };
  Object.assign(request, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    params: options.params ?? {}
  });
  return request;
}

function createResponse(): ServerResponse & { body: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  let body = "";

  return {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    end(chunk?: string | Buffer) {
      body = chunk === undefined ? "" : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      return this;
    },
    get body() {
      return body;
    },
    headers
  } as ServerResponse & { body: string; headers: Record<string, string> };
}

async function withTempCalendarPaths(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "veil-live-ops-calendar-"));
  const liveOpsCalendarPath = join(dir, "live-ops-calendar.json");
  const announcementsPath = join(dir, "announcements.json");
  const originalCalendarPath = process.env.VEIL_LIVE_OPS_CALENDAR_CONFIG;
  const originalAnnouncementsPath = process.env.VEIL_ANNOUNCEMENTS_CONFIG;
  process.env.VEIL_LIVE_OPS_CALENDAR_CONFIG = liveOpsCalendarPath;
  process.env.VEIL_ANNOUNCEMENTS_CONFIG = announcementsPath;
  t.after(() => {
    if (originalCalendarPath === undefined) {
      delete process.env.VEIL_LIVE_OPS_CALENDAR_CONFIG;
    } else {
      process.env.VEIL_LIVE_OPS_CALENDAR_CONFIG = originalCalendarPath;
    }
    if (originalAnnouncementsPath === undefined) {
      delete process.env.VEIL_ANNOUNCEMENTS_CONFIG;
    } else {
      process.env.VEIL_ANNOUNCEMENTS_CONFIG = originalAnnouncementsPath;
    }
  });
  await writeFile(
    announcementsPath,
    `${JSON.stringify(createDefaultLaunchRuntimeState(new Date("2026-04-17T00:00:00.000Z")), null, 2)}\n`,
    "utf8"
  );
  return { liveOpsCalendarPath, announcementsPath };
}

function withAdminSecret(t: TestContext, secret = "test-admin-secret"): string {
  const originalAdminSecret = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = secret;
  t.after(() => {
    if (originalAdminSecret === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = originalAdminSecret;
    }
  });
  return secret;
}

test("runLiveOpsCalendarTick auto-starts due entries and auto-ends elapsed entries", async (t) => {
  resetSeasonalEventRuntimeState();
  t.after(() => resetSeasonalEventRuntimeState());
  await withTempCalendarPaths(t);

  await saveLiveOpsCalendarState({
    entries: [
      {
        id: "launch-banner",
        title: "Launch Banner",
        startsAt: "2026-04-17T09:00:00.000Z",
        endsAt: "2026-04-17T15:00:00.000Z",
        status: "scheduled",
        action: {
          type: "announcement_upsert",
          announcement: {
            id: "launch-banner",
            title: "Launch Banner",
            message: "Welcome back, Commander.",
            tone: "info",
            startsAt: "2026-04-17T09:00:00.000Z",
            endsAt: "2026-04-17T15:00:00.000Z"
          }
        },
        updatedAt: "2026-04-17T08:59:00.000Z"
      },
      {
        id: "maintenance-window",
        title: "Maintenance",
        startsAt: "2026-04-17T08:00:00.000Z",
        endsAt: "2026-04-17T09:30:00.000Z",
        status: "active",
        action: {
          type: "maintenance_mode",
          maintenanceMode: {
            enabled: true,
            title: "维护中",
            message: "正在发布补丁",
            whitelistPlayerIds: [],
            whitelistLoginIds: []
          }
        },
        updatedAt: "2026-04-17T08:00:00.000Z"
      }
    ],
    updatedAt: "2026-04-17T08:59:00.000Z"
  });
  await writeFile(
    process.env.VEIL_ANNOUNCEMENTS_CONFIG!,
    `${JSON.stringify(
      {
        announcements: [],
        maintenanceMode: {
          enabled: true,
          title: "维护中",
          message: "正在发布补丁",
          whitelistPlayerIds: [],
          whitelistLoginIds: []
        },
        updatedAt: "2026-04-17T08:00:00.000Z"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await runLiveOpsCalendarTick(new Date("2026-04-17T10:00:00.000Z"));
  assert.deepEqual(result.startedIds, ["launch-banner"]);
  assert.deepEqual(result.endedIds, ["maintenance-window"]);

  const calendarState = await loadLiveOpsCalendarState();
  assert.equal(calendarState.entries.find((entry) => entry.id === "launch-banner")?.status, "active");
  assert.equal(calendarState.entries.find((entry) => entry.id === "maintenance-window")?.status, "ended");

  const runtimeState = await loadLaunchRuntimeState();
  assert.equal(runtimeState.announcements[0]?.id, "launch-banner");
  assert.equal(runtimeState.maintenanceMode.enabled, false);
});

test("admin live ops calendar routes upsert, list, start, end, and delete entries", async (t) => {
  await withTempCalendarPaths(t);
  const secret = withAdminSecret(t);
  const refreshCalls: string[] = [];
  const { app, gets, posts, deletes } = createTestApp();
  registerLiveOpsCalendarRoutes(app, {
    scheduler: {
      async refresh() {
        refreshCalls.push("refresh");
      },
      stop() {},
      async tick() {
        throw new Error("tick should not be called in route test");
      }
    },
    now: () => new Date("2026-04-17T10:00:00.000Z")
  });

  const createHandler = posts.get("/api/admin/live-ops-calendar");
  const listHandler = gets.get("/api/admin/live-ops-calendar");
  const startHandler = posts.get("/api/admin/live-ops-calendar/:id/start");
  const endHandler = posts.get("/api/admin/live-ops-calendar/:id/end");
  const deleteHandler = deletes.get("/api/admin/live-ops-calendar/:id");
  assert.ok(createHandler && listHandler && startHandler && endHandler && deleteHandler);

  const entry: LiveOpsCalendarEntry = {
    id: "calendar-entry-1",
    title: "Weekend Sprint",
    description: "运营日历测试条目",
    startsAt: "2026-04-17T10:00:00.000Z",
    endsAt: "2026-04-17T12:00:00.000Z",
    status: "scheduled",
    action: {
      type: "announcement_upsert",
      announcement: {
        id: "weekend-sprint",
        title: "Weekend Sprint",
        message: "活动开始了。",
        tone: "info",
        startsAt: "2026-04-17T10:00:00.000Z",
        endsAt: "2026-04-17T12:00:00.000Z"
      }
    },
    endAction: {
      type: "announcement_remove",
      announcementId: "weekend-sprint"
    },
    updatedAt: "2026-04-17T10:00:00.000Z"
  };

  const createRouteResponse = createResponse();
  await createHandler(
    createRequest({
      method: "POST",
      headers: { "x-veil-admin-secret": secret },
      body: JSON.stringify({ entry })
    }),
    createRouteResponse
  );
  assert.equal(createRouteResponse.statusCode, 200);

  const listResponse = createResponse();
  await listHandler(createRequest({ headers: { "x-veil-admin-secret": secret } }), listResponse);
  const listPayload = JSON.parse(listResponse.body);
  assert.equal(listPayload.entries.length, 1);
  assert.equal(listPayload.entries[0]?.id, "calendar-entry-1");

  const startResponse = createResponse();
  await startHandler(
    createRequest({
      method: "POST",
      headers: { "x-veil-admin-secret": secret },
      params: { id: "calendar-entry-1" }
    }),
    startResponse
  );
  assert.equal(JSON.parse(startResponse.body).entry.status, "active");

  const endResponse = createResponse();
  await endHandler(
    createRequest({
      method: "POST",
      headers: { "x-veil-admin-secret": secret },
      params: { id: "calendar-entry-1" }
    }),
    endResponse
  );
  assert.equal(JSON.parse(endResponse.body).entry.status, "ended");

  const deleteResponse = createResponse();
  await deleteHandler(
    createRequest({
      method: "DELETE",
      headers: { "x-veil-admin-secret": secret },
      params: { id: "calendar-entry-1" }
    }),
    deleteResponse
  );
  assert.equal(deleteResponse.statusCode, 200);
  assert.ok(refreshCalls.length >= 3);
});

test("admin live ops calendar routes reject invalid admin secret", async (t) => {
  const secret = withAdminSecret(t);
  const { app, gets } = createTestApp();
  registerLiveOpsCalendarRoutes(app);

  const listHandler = gets.get("/api/admin/live-ops-calendar");
  assert.ok(listHandler);

  const response = createResponse();
  await listHandler(createRequest({ headers: { "x-veil-admin-secret": `${secret}-wrong` } }), response);

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
});

test("admin live ops calendar auth uses timing-safe secret comparisons", async () => {
  const sourcePath = fileURLToPath(new URL("../src/domain/social/live-ops-calendar.ts", import.meta.url));
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /\btimingSafeCompareAdminToken\b/);
  assert.doesNotMatch(source, /header\s*===\s*readRuntimeSecret\(/);
  assert.doesNotMatch(source, /readHeaderSecret\(request\)\s*===\s*adminSecret/);
  assert.doesNotMatch(source, /header\s*===\s*adminSecret/);
});

test("admin live ops calendar routes use injected shared storage without writing local config files", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "veil-live-ops-shared-storage-"));
  const liveOpsCalendarPath = join(dir, "live-ops-calendar.json");
  const announcementsPath = join(dir, "announcements.json");
  const originalCalendarPath = process.env.VEIL_LIVE_OPS_CALENDAR_CONFIG;
  const originalAnnouncementsPath = process.env.VEIL_ANNOUNCEMENTS_CONFIG;
  process.env.VEIL_LIVE_OPS_CALENDAR_CONFIG = liveOpsCalendarPath;
  process.env.VEIL_ANNOUNCEMENTS_CONFIG = announcementsPath;
  t.after(() => {
    if (originalCalendarPath === undefined) {
      delete process.env.VEIL_LIVE_OPS_CALENDAR_CONFIG;
    } else {
      process.env.VEIL_LIVE_OPS_CALENDAR_CONFIG = originalCalendarPath;
    }
    if (originalAnnouncementsPath === undefined) {
      delete process.env.VEIL_ANNOUNCEMENTS_CONFIG;
    } else {
      process.env.VEIL_ANNOUNCEMENTS_CONFIG = originalAnnouncementsPath;
    }
  });

  const secret = withAdminSecret(t);
  let calendarState = {
    entries: [],
    updatedAt: "2026-04-17T09:00:00.000Z"
  } satisfies Awaited<ReturnType<typeof loadLiveOpsCalendarState>>;
  let launchRuntimeState = createDefaultLaunchRuntimeState(new Date("2026-04-17T09:00:00.000Z"));
  const sharedStorage = {
    calendarSaves: 0,
    launchRuntimeSaves: 0,
    async loadCalendarState() {
      return structuredClone(calendarState);
    },
    async saveCalendarState(nextState: typeof calendarState) {
      this.calendarSaves += 1;
      calendarState = structuredClone(nextState);
      return structuredClone(calendarState);
    },
    async loadLaunchRuntimeState() {
      return structuredClone(launchRuntimeState);
    },
    async saveLaunchRuntimeState(nextState: typeof launchRuntimeState) {
      this.launchRuntimeSaves += 1;
      launchRuntimeState = structuredClone(nextState);
      return structuredClone(launchRuntimeState);
    }
  };
  const { app, posts } = createTestApp();
  registerLiveOpsCalendarRoutes(app, {
    storage: sharedStorage,
    now: () => new Date("2026-04-17T10:00:00.000Z")
  });

  const createHandler = posts.get("/api/admin/live-ops-calendar");
  const startHandler = posts.get("/api/admin/live-ops-calendar/:id/start");
  assert.ok(createHandler && startHandler);

  await createHandler(
    createRequest({
      method: "POST",
      headers: { "x-veil-admin-secret": secret },
      body: JSON.stringify({
        entry: {
          id: "shared-launch-banner",
          title: "Shared Launch Banner",
          startsAt: "2026-04-17T10:00:00.000Z",
          status: "scheduled",
          action: {
            type: "announcement_upsert",
            announcement: {
              id: "shared-launch-banner",
              title: "Shared Launch Banner",
              message: "Shared storage announcement.",
              tone: "info",
              startsAt: "2026-04-17T10:00:00.000Z"
            }
          }
        }
      })
    }),
    createResponse()
  );

  await startHandler(
    createRequest({
      method: "POST",
      headers: { "x-veil-admin-secret": secret },
      params: { id: "shared-launch-banner" }
    }),
    createResponse()
  );

  assert.equal(sharedStorage.calendarSaves, 2);
  assert.equal(sharedStorage.launchRuntimeSaves, 1);
  assert.equal(calendarState.entries[0]?.status, "active");
  assert.equal(launchRuntimeState.announcements[0]?.id, "shared-launch-banner");
  await assert.rejects(access(liveOpsCalendarPath), { code: "ENOENT" });
  await assert.rejects(access(announcementsPath), { code: "ENOENT" });
});

test("seasonal event calendar entry toggles runtime active state on manual start and end", async (t) => {
  resetSeasonalEventRuntimeState();
  t.after(() => resetSeasonalEventRuntimeState());
  await withTempCalendarPaths(t);
  const secret = withAdminSecret(t);
  const { app, posts } = createTestApp();
  registerLiveOpsCalendarRoutes(app, {
    now: () => new Date("2026-04-04T12:00:00.000Z")
  });
  const createHandler = posts.get("/api/admin/live-ops-calendar");
  const startHandler = posts.get("/api/admin/live-ops-calendar/:id/start");
  const endHandler = posts.get("/api/admin/live-ops-calendar/:id/end");
  assert.ok(createHandler && startHandler && endHandler);

  await createHandler(
    createRequest({
      method: "POST",
      headers: { "x-veil-admin-secret": secret },
      body: JSON.stringify({
        entry: {
          id: "bridge-rush",
          title: "Bridge Rush",
          startsAt: "2026-04-04T12:00:00.000Z",
          endsAt: "2026-04-05T12:00:00.000Z",
          status: "scheduled",
          action: {
            type: "seasonal_event_patch",
            eventId: "defend-the-bridge",
            patch: {
              isActive: true
            }
          },
          endAction: {
            type: "seasonal_event_patch",
            eventId: "defend-the-bridge",
            patch: {
              isActive: false,
              endsAt: "2026-04-04T12:00:00.000Z"
            }
          }
        }
      })
    }),
    createResponse()
  );

  await startHandler(
    createRequest({
      method: "POST",
      headers: { "x-veil-admin-secret": secret },
      params: { id: "bridge-rush" }
    }),
    createResponse()
  );
  const activeEvent = resolveSeasonalEvents().find((entry) => entry.id === "defend-the-bridge");
  assert.equal(resolveSeasonalEventStatus(activeEvent!, new Date("2026-04-04T12:00:00.000Z")), "active");

  await endHandler(
    createRequest({
      method: "POST",
      headers: { "x-veil-admin-secret": secret },
      params: { id: "bridge-rush" }
    }),
    createResponse()
  );
  const endedEvent = resolveSeasonalEvents().find((entry) => entry.id === "defend-the-bridge");
  assert.equal(resolveSeasonalEventStatus(endedEvent!, new Date("2026-04-04T12:00:00.000Z")), "ended");
});

test("live ops calendar scheduler arms only when there are pending entries", async (t) => {
  await withTempCalendarPaths(t);
  const scheduledTimers: Array<{ delayMs: number; callback: () => void }> = [];
  const clearedTimers: unknown[] = [];
  const scheduler = createLiveOpsCalendarScheduler({
    intervalMs: 15_000,
    setInterval: ((callback: () => void, delayMs: number) => {
      const timer = { delayMs, callback, unref() {} };
      scheduledTimers.push(timer);
      return timer as unknown as ReturnType<typeof globalThis.setInterval>;
    }) as typeof globalThis.setInterval,
    clearInterval: ((timer: unknown) => {
      clearedTimers.push(timer);
    }) as typeof globalThis.clearInterval
  });

  await scheduler.refresh();
  assert.equal(scheduledTimers.length, 0);

  await saveLiveOpsCalendarState({
    entries: [
      {
        id: "scheduled-only",
        title: "Scheduled Only",
        startsAt: "2026-04-18T10:00:00.000Z",
        status: "scheduled",
        action: {
          type: "announcement_remove",
          announcementId: "scheduled-only"
        },
        updatedAt: "2026-04-17T10:00:00.000Z"
      }
    ],
    updatedAt: "2026-04-17T10:00:00.000Z"
  });
  await scheduler.refresh();
  assert.equal(scheduledTimers.length, 1);

  scheduler.stop();
  assert.equal(clearedTimers.length, 1);
});
