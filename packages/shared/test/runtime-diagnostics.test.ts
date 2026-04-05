import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeDiagnosticsErrorEvent,
  buildRuntimeDiagnosticsTriageView,
  buildRuntimeDiagnosticsSummaryLines,
  getRuntimeDiagnosticsLastSyncAgeMs,
  renderRuntimeDiagnosticsSnapshotText,
  type RuntimeDiagnosticsSnapshot
} from "../src/index";

function createRuntimeDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  return {
    schemaVersion: 1,
    exportedAt: "2026-03-29T07:10:00.000Z",
    source: {
      surface: "h5-debug-shell",
      devOnly: true,
      mode: "world"
    },
    room: {
      roomId: "room-alpha",
      playerId: "player-1",
      day: 3,
      connectionStatus: "connected",
      lastUpdateSource: "push",
      lastUpdateReason: "battle.resolved",
      lastUpdateAt: "2026-03-29T07:09:00.000Z"
    },
    world: {
      map: {
        width: 4,
        height: 3,
        visibleTileCount: 7,
        reachableTileCount: 4
      },
      resources: {
        gold: 150,
        wood: 10,
        ore: 4
      },
      selectedTile: { x: 0, y: 0 },
      hoveredTile: { x: 1, y: 0 },
      keyboardCursor: { x: 1, y: 0 },
      hero: {
        id: "hero-1",
        name: "凯琳",
        position: { x: 0, y: 0 },
        move: { total: 6, remaining: 4 },
        stats: {
          attack: 2,
          defense: 1,
          power: 1,
          knowledge: 0,
          hp: 30,
          maxHp: 30
        },
        armyTemplateId: "hero_guard_basic",
        armyCount: 14,
        progression: {
          level: 2,
          experience: 120,
          skillPoints: 1,
          battlesWon: 2,
          neutralBattlesWon: 2,
          pvpBattlesWon: 0
        }
      },
      visibleHeroes: [{ id: "hero-2", playerId: "player-2", position: { x: 1, y: 0 } }]
    },
    battle: null,
    account: {
      playerId: "player-1",
      displayName: "暮火侦骑",
      source: "remote",
      loginId: "player-1@example.com",
      recentEventCount: 3,
      recentReplayCount: 1,
      accountReadiness: {
        status: "ready",
        summary: "正式账号会话已绑定",
        detail: "当前主客户端已具备正式账号登录态，可用于 RC 登录链路验收。",
        source: "session"
      }
    },
    overview: null,
    diagnostics: {
      eventTypes: ["battle.started", "battle.resolved"],
      timelineTail: [
        {
          id: "timeline-1",
          tone: "battle",
          source: "push",
          text: "Room room-alpha finished battle battle-1"
        }
      ],
      logTail: ["Room room-alpha connected", "Battle resolved"],
      recoverySummary: "连接已恢复，当前地图与战斗状态来自最新权威快照。",
      predictionStatus: "server-authoritative",
      primaryClientTelemetry: [
        {
          at: "2026-03-29T07:09:05.000Z",
          category: "combat",
          checkpoint: "encounter.resolved",
          status: "success",
          detail: "Battle battle-1 resolved as attacker_victory.",
          roomId: "room-alpha",
          playerId: "player-1",
          heroId: "hero-1",
          battleId: "battle-1",
          result: "attacker_victory"
        }
      ],
      errorEvents: [
        buildRuntimeDiagnosticsErrorEvent({
          id: "client-room-sync-1",
          recordedAt: "2026-03-29T07:09:08.000Z",
          source: "client",
          surface: "h5",
          candidateRevision: "abc1234",
          featureArea: "room_sync",
          ownerArea: "multiplayer",
          severity: "error",
          errorCode: "reconnect_failed",
          message: "Reconnect window expired while replay sync was still pending.",
          context: {
            roomId: "room-alpha",
            playerId: "player-1",
            requestId: "sync-1",
            route: null,
            action: "room.reconnect",
            statusCode: null,
            crash: false,
            detail: "local fallback engaged"
          }
        })
      ],
      errorSummary: {
        totalEvents: 1,
        uniqueFingerprints: 1,
        fatalCount: 0,
        crashCount: 0,
        latestRecordedAt: "2026-03-29T07:09:08.000Z",
        byFeatureArea: [{ featureArea: "room_sync", count: 1 }],
        topFingerprints: [
          {
            fingerprint: "client|h5|room_sync|reconnect_failed|no-route|room.reconnect|na",
            errorCode: "reconnect_failed",
            featureArea: "room_sync",
            ownerArea: "multiplayer",
            source: "client",
            surface: "h5",
            severity: "error",
            candidateRevision: "abc1234",
            firstSeenAt: "2026-03-29T07:09:08.000Z",
            lastSeenAt: "2026-03-29T07:09:08.000Z",
            count: 1,
            crashCount: 0,
            latestMessage: "Reconnect window expired while replay sync was still pending.",
            sampleContext: {
              roomId: "room-alpha",
              playerId: "player-1",
              requestId: "sync-1",
              route: null,
              action: "room.reconnect",
              statusCode: null,
              crash: false,
              detail: "local fallback engaged"
            }
          }
        ]
      },
      pendingUiTasks: 2,
      replay: {
        replayId: "room-alpha:battle-1:player-1",
        loading: false,
        status: "paused",
        currentStepIndex: 1,
        totalSteps: 3
      }
    }
  };
}

test("runtime diagnostics summary text stays stable for panel and automation consumers", () => {
  const snapshot = createRuntimeDiagnosticsSnapshot();

  const lines = buildRuntimeDiagnosticsSummaryLines(snapshot);
  assert.deepEqual(lines.slice(0, 4), [
    "Mode world (h5-debug-shell)",
    "Room room-alpha / Player player-1 / Sync connected",
    "Day 3",
    "Last update source=push / reason=battle.resolved / at=2026-03-29T07:09:00.000Z"
  ]);

  const rendered = renderRuntimeDiagnosticsSnapshotText(snapshot);
  assert.match(rendered, /World 4x3 \/ visible 7 \/ reachable 4/);
  assert.match(rendered, /Hero 凯琳 @ 0,0 \/ MOV 4\/6 \/ HP 30\/30/);
  assert.match(rendered, /Account 暮火侦骑 \(remote\) \/ events 3 \/ replays 1/);
  assert.match(rendered, /Account readiness ready \/ 正式账号会话已绑定/);
  assert.match(rendered, /Recovery 连接已恢复，当前地图与战斗状态来自最新权威快照。/);
  assert.match(rendered, /Telemetry combat\/encounter\.resolved \(success\) Battle battle-1 resolved as attacker_victory\./);
  assert.match(rendered, /Errors 1 \/ fingerprints 1 \/ fatal 0 \/ crashes 0/);
  assert.match(rendered, /Error room_sync\/reconnect_failed 1x on h5 \(multiplayer\)/);
  assert.match(rendered, /Replay room-alpha:battle-1:player-1 \/ paused \/ step 1\/3/);
  assert.match(rendered, /Timeline \[push\/battle\] Room room-alpha finished battle battle-1/);
});

test("runtime diagnostics summary text supports aggregate server snapshots", () => {
  const lines = buildRuntimeDiagnosticsSummaryLines({
    schemaVersion: 1,
    exportedAt: "2026-03-29T07:15:00.000Z",
    source: {
      surface: "server-observability",
      devOnly: false,
      mode: "server"
    },
    room: null,
    world: null,
    battle: null,
    account: null,
    overview: {
      service: "project-veil-server",
      activeRoomCount: 2,
      connectionCount: 3,
      activeBattleCount: 1,
      heroCount: 4,
      gameplayTraffic: {
        connectMessagesTotal: 5,
        worldActionsTotal: 8,
        battleActionsTotal: 2,
        actionMessagesTotal: 10
      },
      auth: {
        activeGuestSessionCount: 1,
        activeAccountSessionCount: 2,
        pendingRegistrationCount: 0,
        pendingRecoveryCount: 0,
        tokenDeliveryQueueCount: 1,
        tokenDeliveryDeadLetterCount: 0
      },
      roomSummaries: [
        {
          roomId: "room-alpha",
          day: 3,
          connectedPlayers: 2,
          heroCount: 2,
          activeBattles: 1,
          updatedAt: "2026-03-29T07:14:00.000Z"
        }
      ]
    },
    diagnostics: {
      eventTypes: [],
      timelineTail: [],
      logTail: ["project-veil-server rooms=2 connections=3"],
      recoverySummary: null,
      predictionStatus: "server-observability",
      primaryClientTelemetry: [],
      errorEvents: [],
      errorSummary: {
        totalEvents: 0,
        uniqueFingerprints: 0,
        fatalCount: 0,
        crashCount: 0,
        latestRecordedAt: null,
        byFeatureArea: [],
        topFingerprints: []
      },
      pendingUiTasks: 0,
      replay: null
    }
  });

  assert.deepEqual(lines.slice(0, 5), [
    "Mode server (server-observability)",
    "Runtime rooms 2 / connections 3 / battles 1 / heroes 4",
    "Traffic connect=5 / world=8 / battle=2",
    "Auth guest=1 / account=2 / queue=1 / deadLetters=0",
    "Room summary room-alpha / day 3 / players 2 / heroes 2 / battles 1"
  ]);
});

test("runtime diagnostics triage view highlights stale sync and missing hero state", () => {
  const snapshot = createRuntimeDiagnosticsSnapshot();
  snapshot.world!.hero = null;
  snapshot.room!.lastUpdateAt = "2026-03-29T07:08:30.000Z";

  const ageMs = getRuntimeDiagnosticsLastSyncAgeMs(snapshot, "2026-03-29T07:09:10.000Z");
  assert.equal(ageMs, 40_000);

  const triage = buildRuntimeDiagnosticsTriageView(snapshot, "2026-03-29T07:09:10.000Z");
  assert.deepEqual(
    triage.alerts.map((alert) => alert.label),
    ["同步滞后", "可控英雄缺失", "待处理 UI 任务", "恢复链路"]
  );
  assert.equal(triage.sections[0]?.id, "room");
  assert.equal(triage.sections[4]?.id, "sync");
  assert.deepEqual(triage.sections[4]?.items[0], {
    label: "最后同步年龄",
    value: "40s",
    tone: "danger"
  });
  assert.deepEqual(triage.sections[2]?.items[0], {
    label: "主控英雄",
    value: "缺失",
    tone: "warning"
  });
});
