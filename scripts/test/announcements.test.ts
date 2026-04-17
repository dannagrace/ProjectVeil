import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultLaunchRuntimeState,
  normalizeLaunchRuntimeState,
  resolveActiveLaunchAnnouncements,
  resolveLaunchMaintenanceAccess
} from "../../apps/server/src/launch-runtime-state.ts";

test("resolveActiveLaunchAnnouncements returns only entries active for the current time window", () => {
  const state = normalizeLaunchRuntimeState({
    announcements: [
      {
        id: "notice-active",
        title: "停服预告",
        message: "10 分钟后停服。",
        tone: "warning",
        startsAt: "2026-04-17T08:00:00.000Z",
        endsAt: "2026-04-17T10:00:00.000Z"
      },
      {
        id: "notice-expired",
        title: "旧公告",
        message: "已失效。",
        tone: "info",
        startsAt: "2026-04-17T05:00:00.000Z",
        endsAt: "2026-04-17T06:00:00.000Z"
      }
    ]
  });

  assert.deepEqual(
    resolveActiveLaunchAnnouncements(state, "2026-04-17T09:00:00.000Z").map((entry) => entry.id),
    ["notice-active"]
  );
});

test("resolveLaunchMaintenanceAccess blocks non-whitelisted identities and lets whitelisted players through", () => {
  const state = normalizeLaunchRuntimeState({
    maintenanceMode: {
      enabled: true,
      title: "维护中",
      message: "正在热更新资源。",
      nextOpenAt: "2026-04-17T12:00:00.000Z",
      whitelistPlayerIds: ["player-whitelist"],
      whitelistLoginIds: ["qa-admin"]
    }
  });

  assert.deepEqual(resolveLaunchMaintenanceAccess(state, {
    playerId: "player-1",
    loginId: "guest-1",
    now: "2026-04-17T09:00:00.000Z"
  }), {
    active: true,
    blocked: true,
    title: "维护中",
    message: "正在热更新资源。",
    nextOpenAt: "2026-04-17T12:00:00.000Z"
  });

  assert.equal(
    resolveLaunchMaintenanceAccess(state, {
      playerId: "player-whitelist",
      now: "2026-04-17T09:00:00.000Z"
    }).blocked,
    false
  );
  assert.equal(
    resolveLaunchMaintenanceAccess(state, {
      loginId: "qa-admin",
      now: "2026-04-17T09:00:00.000Z"
    }).blocked,
    false
  );
});

test("createDefaultLaunchRuntimeState starts with maintenance disabled", () => {
  const state = createDefaultLaunchRuntimeState(new Date("2026-04-17T08:00:00.000Z"));
  assert.equal(state.announcements.length, 0);
  assert.equal(state.maintenanceMode.enabled, false);
});
