import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { evaluateMinorProtectionState, readMinorProtectionConfig } from "@server/domain/ops/minor-protection";
import { registerMinorProtectionRoutes } from "@server/transport/http/minor-protection-routes";
import type { RoomSnapshotStore } from "@server/persistence";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

function createRequest(options: {
  method?: string;
  headers?: Record<string, string | undefined>;
  url?: string;
} = {}): IncomingMessage {
  async function* iterateBody() {}

  const request = iterateBody() as IncomingMessage;
  Object.assign(request, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    url: options.url ?? "/"
  });
  return request;
}

function createResponse(): ServerResponse & {
  body: string;
  headers: Record<string, string>;
} {
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

test("evaluateMinorProtectionState flags night lockout", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: "",
    VEIL_MINOR_PROTECTION_TIME_ZONE: "Asia/Shanghai"
  });

  const evaluation = evaluateMinorProtectionState(
    {
      isMinor: true,
      dailyPlayMinutes: 10,
      lastPlayDate: "2026-04-03"
    },
    new Date("2026-04-03T14:30:00.000Z"),
    config
  );

  assert.equal(evaluation.restrictedHours, true);
  assert.equal(evaluation.wouldBlock, true);
  assert.equal(evaluation.reason, "minor_restricted_hours");
});

test("evaluateMinorProtectionState flags daily limit reached", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: "",
    VEIL_MINOR_PROTECTION_TIME_ZONE: "Asia/Shanghai"
  });

  const evaluation = evaluateMinorProtectionState(
    {
      isMinor: true,
      dailyPlayMinutes: 90,
      lastPlayDate: "2026-04-03"
    },
    new Date("2026-04-03T01:00:00.000Z"),
    config
  );

  assert.equal(evaluation.dailyLimitReached, true);
  assert.equal(evaluation.wouldBlock, true);
  assert.equal(evaluation.reason, "minor_daily_limit_reached");
});

test("evaluateMinorProtectionState applies holiday override", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: "2026-04-06",
    VEIL_MINOR_PROTECTION_TIME_ZONE: "Asia/Shanghai"
  });

  const evaluation = evaluateMinorProtectionState(
    {
      isMinor: true,
      dailyPlayMinutes: 100,
      lastPlayDate: "2026-04-06"
    },
    new Date("2026-04-06T01:00:00.000Z"),
    config
  );

  assert.equal(evaluation.localDate, "2026-04-06");
  assert.equal(evaluation.dailyLimitMinutes, 180);
  assert.equal(evaluation.dailyLimitReached, false);
  assert.equal(evaluation.wouldBlock, false);
  assert.equal(evaluation.reason, null);
});

test("GET /api/admin/minor-protection requires the admin token", async (t) => {
  const originalAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = "preview-token";
  t.after(() => {
    if (originalAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
      return;
    }
    process.env.VEIL_ADMIN_TOKEN = originalAdminToken;
  });

  const { app, gets } = createTestApp();
  registerMinorProtectionRoutes(app, null);
  const handler = gets.get("/api/admin/minor-protection");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      url: "/api/admin/minor-protection?playerId=minor-player"
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), {
    error: {
      code: "unauthorized",
      message: "Invalid admin token"
    }
  });
});

test("GET /api/admin/minor-protection returns 400 when playerId is missing", async (t) => {
  const originalAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = "preview-token";
  t.after(() => {
    if (originalAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
      return;
    }
    process.env.VEIL_ADMIN_TOKEN = originalAdminToken;
  });

  const { app, gets } = createTestApp();
  registerMinorProtectionRoutes(app, null);
  const handler = gets.get("/api/admin/minor-protection");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-token": "preview-token"
      },
      url: "/api/admin/minor-protection"
    }),
    response
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), {
    error: {
      code: "invalid_request",
      message: '"playerId" is required'
    }
  });
});

test("GET /api/admin/minor-protection honors at and dailyPlayMinutes overrides", async (t) => {
  const originalAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = "preview-token";
  t.after(() => {
    if (originalAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
      return;
    }
    process.env.VEIL_ADMIN_TOKEN = originalAdminToken;
  });

  const store = {
    async loadPlayerAccount(playerId: string) {
      return {
        playerId,
        isMinor: true,
        dailyPlayMinutes: 10,
        lastPlayDate: "2026-04-02"
      };
    }
  } as Pick<RoomSnapshotStore, "loadPlayerAccount"> as RoomSnapshotStore;

  const { app, gets } = createTestApp();
  registerMinorProtectionRoutes(app, store);
  const handler = gets.get("/api/admin/minor-protection");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-token": "preview-token"
      },
      url: "/api/admin/minor-protection?playerId=minor-player&at=2026-04-03T14:30:00.000Z&dailyPlayMinutes=90"
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    enforced: true,
    localDate: "2026-04-03",
    normalizedDailyPlayMinutes: 90,
    dailyLimitMinutes: 90,
    restrictedHours: true,
    dailyLimitReached: true,
    wouldBlock: true,
    reason: "minor_restricted_hours",
    currentServerTime: "2026-04-03T14:30:00.000Z",
    currentLocalTime: "22:30",
    timeZone: "Asia/Shanghai",
    restrictedWindow: {
      startHour: 22,
      endHour: 8
    },
    remainingDailyMinutes: 0,
    nextAllowedAt: "2026-04-04T00:00:00.000Z",
    nextAllowedLocalTime: "08:00",
    nextAllowedCountdownSeconds: 34200
  });
});

test("GET /api/admin/minor-protection returns pass-through and allowed states", async (t) => {
  const originalAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = "preview-token";
  t.after(() => {
    if (originalAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
      return;
    }
    process.env.VEIL_ADMIN_TOKEN = originalAdminToken;
  });

  const store = {
    async loadPlayerAccount(playerId: string) {
      if (playerId === "adult-player") {
        return {
          playerId,
          isMinor: false,
          dailyPlayMinutes: 500,
          lastPlayDate: "2026-04-03"
        };
      }

      return {
        playerId,
        isMinor: true,
        dailyPlayMinutes: 45,
        lastPlayDate: "2026-04-03"
      };
    }
  } as Pick<RoomSnapshotStore, "loadPlayerAccount"> as RoomSnapshotStore;

  const { app, gets } = createTestApp();
  registerMinorProtectionRoutes(app, store);
  const handler = gets.get("/api/admin/minor-protection");
  assert.ok(handler);

  const adultResponse = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-token": "preview-token"
      },
      url: "/api/admin/minor-protection?playerId=adult-player&at=2026-04-03T14:30:00.000Z"
    }),
    adultResponse
  );

  assert.equal(adultResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(adultResponse.body), {
    enforced: false,
    localDate: "2026-04-03",
    normalizedDailyPlayMinutes: 500,
    dailyLimitMinutes: 90,
    restrictedHours: true,
    dailyLimitReached: true,
    wouldBlock: false,
    reason: null,
    currentServerTime: "2026-04-03T14:30:00.000Z",
    currentLocalTime: "22:30",
    timeZone: "Asia/Shanghai",
    restrictedWindow: {
      startHour: 22,
      endHour: 8
    },
    remainingDailyMinutes: 0,
    nextAllowedAt: "2026-04-03T14:30:00.000Z",
    nextAllowedLocalTime: "22:30",
    nextAllowedCountdownSeconds: 0
  });

  const allowedResponse = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-token": "preview-token"
      },
      url: "/api/admin/minor-protection?playerId=minor-player&at=2026-04-03T01:00:00.000Z"
    }),
    allowedResponse
  );

  assert.equal(allowedResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(allowedResponse.body), {
    enforced: true,
    localDate: "2026-04-03",
    normalizedDailyPlayMinutes: 45,
    dailyLimitMinutes: 90,
    restrictedHours: false,
    dailyLimitReached: false,
    wouldBlock: false,
    reason: null,
    currentServerTime: "2026-04-03T01:00:00.000Z",
    currentLocalTime: "09:00",
    timeZone: "Asia/Shanghai",
    restrictedWindow: {
      startHour: 22,
      endHour: 8
    },
    remainingDailyMinutes: 45,
    nextAllowedAt: "2026-04-03T01:00:00.000Z",
    nextAllowedLocalTime: "09:00",
    nextAllowedCountdownSeconds: 0
  });
});

test("GET /api/admin/minor-protection/preview remains as a compatibility alias", async (t) => {
  const originalAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = "preview-token";
  t.after(() => {
    if (originalAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
      return;
    }
    process.env.VEIL_ADMIN_TOKEN = originalAdminToken;
  });

  const { app, gets } = createTestApp();
  registerMinorProtectionRoutes(app, null);
  const handler = gets.get("/api/admin/minor-protection/preview");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-token": "preview-token"
      },
      url: "/api/admin/minor-protection/preview?playerId=minor-player"
    }),
    response
  );

  assert.equal(response.statusCode, 200);
});
