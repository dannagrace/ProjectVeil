import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeDiagnosticsErrorEvent } from "@veil/shared/platform";
import { buildCocosRuntimeDiagnosticsSnapshot, buildCocosRuntimeTriageSummaryLines } from "../assets/scripts/cocos-runtime-diagnostics.ts";
import { createFallbackCocosPlayerAccountProfile } from "../assets/scripts/cocos-lobby.ts";
import { createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";

test("Cocos runtime diagnostics reuse the shared snapshot shape for HUD triage", () => {
  const account = createFallbackCocosPlayerAccountProfile("player-1", "room-alpha", "暮潮守望");
  const update = createSessionUpdate(5, "room-alpha", "player-1");
  update.world.visibleHeroes = [
    {
      id: "hero-2",
      playerId: "player-2",
      name: "敌方先锋",
      level: 4,
      position: { x: 1, y: 0 }
    }
  ];

  const snapshot = buildCocosRuntimeDiagnosticsSnapshot({
    exportedAt: "2026-03-29T09:00:00.000Z",
    devOnly: true,
    mode: "world",
    roomId: "room-alpha",
    playerId: "player-1",
    authMode: "guest",
    loginId: null,
    connectionStatus: "reconnecting",
    lastUpdateSource: "replay",
    lastUpdateReason: "cached_snapshot",
    lastUpdateAt: Date.parse("2026-03-29T08:59:40.000Z"),
    update,
    account,
    timelineEntries: ["房间 room-alpha 已恢复同步。"],
    logLines: ["连接已中断，正在尝试重连...", "已回放缓存状态，等待房间同步..."],
    predictionStatus: "已回放缓存状态，等待房间同步...",
    recoverySummary: "已回放缓存状态，等待房间同步...",
    primaryClientTelemetry: [
      {
        at: "2026-03-29T08:59:42.000Z",
        category: "combat",
        checkpoint: "encounter.started",
        status: "info",
        detail: "Battle battle-1 started against neutral.",
        roomId: "room-alpha",
        playerId: "player-1",
        heroId: "hero-1",
        battleId: "battle-1",
        battleKind: "neutral"
      }
    ],
    errorEvents: [
      buildRuntimeDiagnosticsErrorEvent({
        id: "cocos-room-sync-1",
        recordedAt: "2026-03-29T08:59:43.000Z",
        source: "client",
        surface: "cocos",
        candidateRevision: "abc1234",
        featureArea: "room_sync",
        ownerArea: "multiplayer",
        severity: "error",
        errorCode: "reconnect_failed",
        message: "Cocos runtime fell back to cached snapshot after reconnect failed.",
        context: {
          roomId: "room-alpha",
          playerId: "player-1",
          requestId: null,
          route: null,
          action: "room.reconnect",
          statusCode: null,
          crash: false,
          detail: "cached snapshot replay"
        }
      })
    ]
  });

  assert.equal(snapshot.source.surface, "cocos-runtime-overlay");
  assert.equal(snapshot.room?.connectionStatus, "reconnecting");
  assert.equal(snapshot.world?.hero?.id, "hero-1");
  assert.equal(snapshot.world?.visibleHeroes[0]?.playerId, "player-2");
  assert.equal(snapshot.diagnostics.recoverySummary, "已回放缓存状态，等待房间同步...");
  assert.equal(snapshot.diagnostics.errorSummary.totalEvents, 1);
  assert.equal(snapshot.account?.accountReadiness?.status, "missing");
  assert.match(snapshot.account?.accountReadiness?.detail ?? "", /缺少正式账号登录态/);

  const lines = buildCocosRuntimeTriageSummaryLines(
    {
      devOnly: true,
      mode: "world",
      roomId: "room-alpha",
      playerId: "player-1",
      authMode: "guest",
      loginId: null,
      connectionStatus: "reconnecting",
      lastUpdateSource: "replay",
      lastUpdateReason: "cached_snapshot",
      lastUpdateAt: Date.parse("2026-03-29T08:59:40.000Z"),
      update,
      account,
      timelineEntries: ["房间 room-alpha 已恢复同步。"],
      logLines: ["连接已中断，正在尝试重连...", "已回放缓存状态，等待房间同步..."],
      predictionStatus: "已回放缓存状态，等待房间同步...",
      recoverySummary: "已回放缓存状态，等待房间同步...",
      primaryClientTelemetry: [],
      errorEvents: []
    },
    "2026-03-29T09:00:20.000Z"
  );

  assert.deepEqual(lines, [
    "同步中断 · 客户端正在尝试重连房间。",
    "同步滞后 · 最后权威更新距今 40s。",
    "最后同步年龄 40s",
    "主控英雄 暮潮守望 @ 0,0"
  ]);
});
