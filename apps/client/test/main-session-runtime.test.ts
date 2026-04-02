import assert from "node:assert/strict";
import test from "node:test";
import type { SessionUpdate } from "../src/local-session";
import { createMainSessionRuntime } from "../src/main-session-runtime";

function createSessionUpdate(reason = "push-sync", day = 2): SessionUpdate {
  return {
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day
      },
      map: {
        width: 1,
        height: 1,
        tiles: []
      },
      ownHeroes: [],
      visibleHeroes: [],
      resources: {
        gold: 50,
        wood: 3,
        ore: 1
      },
      playerId: "player-auth"
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: [{ x: 0, y: 0 }],
    reason
  };
}

test("createMainSessionRuntime forwards push updates and keeps the newest sync log entries bounded", () => {
  const events: string[] = [];
  const state = {
    accountDraftName: "访客骑士",
    lobby: {
      authSession: {
        token: "signed.token",
        playerId: "player-auth",
        displayName: "访客骑士",
        authMode: "account" as const,
        loginId: "veil-ranger",
        source: "remote" as const
      }
    },
    diagnostics: {
      connectionStatus: "connected" as const,
      recoverySummary: null
    },
    log: Array.from({ length: 12 }, (_, index) => `old-${index + 1}`)
  };

  const runtime = createMainSessionRuntime({
    state,
    applyUpdate: (update, source) => {
      events.push(`applyUpdate:${source}:${update.reason}`);
    },
    render: () => {
      events.push("render");
    }
  });

  assert.equal(runtime.getDisplayName(), "访客骑士");
  assert.equal(runtime.getAuthToken(), "signed.token");
  runtime.onPushUpdate(createSessionUpdate());

  assert.deepEqual(events, ["applyUpdate:push:push-sync"]);
  assert.deepEqual(state.log, [
    "收到房间同步推送",
    "old-1",
    "old-2",
    "old-3",
    "old-4",
    "old-5",
    "old-6",
    "old-7",
    "old-8",
    "old-9",
    "old-10",
    "old-11"
  ]);
});

test("createMainSessionRuntime maps reconnect transitions to stable diagnostics and fallback logs", () => {
  const renders: string[] = [];
  const state = {
    accountDraftName: "访客骑士",
    lobby: {
      authSession: null
    },
    diagnostics: {
      connectionStatus: "connecting" as const,
      recoverySummary: null as string | null
    },
    log: ["old-line"]
  };

  const runtime = createMainSessionRuntime({
    state,
    applyUpdate: () => {
      throw new Error("push updates are not part of this assertion");
    },
    render: () => {
      renders.push(state.diagnostics.connectionStatus);
    }
  });

  runtime.onConnectionEvent("reconnecting");
  assert.equal(state.diagnostics.connectionStatus, "reconnecting");
  assert.equal(state.diagnostics.recoverySummary, "连接暂时中断，正在尝试重新加入房间。");
  assert.deepEqual(state.log.slice(0, 2), ["连接中断，正在尝试重连...", "old-line"]);

  runtime.onConnectionEvent("reconnected");
  assert.equal(state.diagnostics.connectionStatus, "connected");
  assert.equal(state.diagnostics.recoverySummary, "连接已恢复，正在用最新房间状态校正地图与战斗结果。");
  assert.deepEqual(state.log.slice(0, 2), ["连接已恢复", "连接中断，正在尝试重连..."]);

  runtime.onConnectionEvent("reconnect_failed");
  assert.equal(state.diagnostics.connectionStatus, "reconnect_failed");
  assert.equal(state.diagnostics.recoverySummary, "旧连接未恢复，正在改用持久化快照补救当前房间状态。");
  assert.deepEqual(state.log.slice(0, 2), ["旧连接恢复失败，正在尝试从持久化快照恢复房间...", "连接已恢复"]);
  assert.deepEqual(renders, ["reconnecting", "connected", "reconnect_failed"]);
  assert.equal(runtime.getAuthToken(), null);
});

test("createMainSessionRuntime specializes reconnect copy for active pvp encounters", () => {
  const state = {
    accountDraftName: "访客骑士",
    battle: {
      defenderHeroId: "hero-2"
    },
    lastBattleSettlement: null,
    lobby: {
      authSession: null
    },
    diagnostics: {
      connectionStatus: "connecting" as const,
      recoverySummary: null as string | null
    },
    log: []
  };

  const runtime = createMainSessionRuntime({
    state,
    applyUpdate: () => {
      throw new Error("push updates are not part of this assertion");
    },
    render: () => undefined
  });

  runtime.onConnectionEvent("reconnecting");
  assert.equal(state.diagnostics.recoverySummary, "PVP 遭遇已中断，正在尝试重新加入当前对抗房间。");
  assert.equal(state.log[0], "PVP 遭遇连接中断，正在尝试重连...");

  runtime.onConnectionEvent("reconnected");
  assert.equal(state.diagnostics.recoverySummary, "PVP 遭遇连接已恢复，正在用最新房间状态校正当前回合与战斗结果。");
  assert.equal(state.log[0], "PVP 遭遇连接已恢复");

  runtime.onConnectionEvent("reconnect_failed");
  assert.equal(state.diagnostics.recoverySummary, "PVP 遭遇恢复失败，正在改用持久化快照补救当前房间状态。");
  assert.equal(state.log[0], "PVP 遭遇旧连接恢复失败，正在尝试从持久化快照恢复房间...");
});
