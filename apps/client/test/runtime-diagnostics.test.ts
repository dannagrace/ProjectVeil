import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerBattleReplaySummary } from "@veil/shared/battle";
import { buildRuntimeDiagnosticsErrorEvent, renderRuntimeDiagnosticsSnapshotText, serializeRuntimeDiagnosticsSnapshot } from "@veil/shared/platform";
import { buildH5RuntimeDiagnosticsSnapshot } from "../src/runtime-diagnostics";
import type { PlayerAccountProfile } from "../src/player-account";

function createReplaySummary(): PlayerBattleReplaySummary {
  return {
    id: "room-alpha:battle-1:player-1",
    roomId: "room-alpha",
    playerId: "player-1",
    battleId: "battle-1",
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    neutralArmyId: "neutral-1",
    startedAt: "2026-03-29T06:05:00.000Z",
    completedAt: "2026-03-29T06:08:00.000Z",
    initialState: {
      id: "battle-1",
      round: 1,
      lanes: 1,
      activeUnitId: null,
      turnOrder: [],
      units: {},
      environment: [],
      log: [],
      rng: { seed: 1, cursor: 0 }
    },
    steps: [],
    result: "attacker_victory"
  };
}

function createAccountProfile(): PlayerAccountProfile {
  return {
    playerId: "player-1",
    displayName: "暮火侦骑",
    globalResources: {
      gold: 12,
      wood: 4,
      ore: 2
    },
    achievements: [],
    recentEventLog: [
      {
        id: "event-1",
        timestamp: "2026-03-29T06:07:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "combat",
        description: "暮火侦骑 与中立守军交战。"
      }
    ],
    recentBattleReplays: [createReplaySummary()],
    source: "remote",
    loginId: "player-1@example.com",
    lastRoomId: "room-alpha"
  };
}

test("buildH5RuntimeDiagnosticsSnapshot creates a stable export payload for dev workflows", () => {
  const snapshot = buildH5RuntimeDiagnosticsSnapshot({
    exportedAt: "2026-03-29T06:09:00.000Z",
    candidateRevision: "abc1234",
    devOnly: true,
    mode: "world",
    room: {
      roomId: "room-alpha",
      playerId: "player-1",
      day: 3,
      connectionStatus: "connected",
      lastUpdateSource: "push",
      lastUpdateReason: "battle.resolved",
      lastUpdateAt: Date.parse("2026-03-29T06:08:00.000Z")
    },
    world: {
      state: {
        meta: {
          roomId: "room-alpha",
          seed: 1001,
          day: 3
        },
        map: {
          width: 2,
          height: 2,
          tiles: [
            {
              position: { x: 0, y: 0 },
              terrain: "grass",
              walkable: true,
              fog: "visible"
            },
            {
              position: { x: 1, y: 0 },
              terrain: "grass",
              walkable: true,
              fog: "visible"
            },
            {
              position: { x: 0, y: 1 },
              terrain: "sand",
              walkable: true,
              fog: "visible"
            },
            {
              position: { x: 1, y: 1 },
              terrain: "water",
              walkable: false,
              fog: "hidden"
            }
          ]
        },
        ownHeroes: [
          {
            id: "hero-1",
            playerId: "player-1",
            name: "凯琳",
            position: { x: 0, y: 0 },
            vision: 4,
            move: { total: 6, remaining: 4 },
            stats: {
              attack: 2,
              defense: 1,
              power: 1,
              knowledge: 0,
              hp: 30,
              maxHp: 30
            },
            progression: {
              level: 2,
              experience: 120,
              skillPoints: 1,
              battlesWon: 2,
              neutralBattlesWon: 2,
              pvpBattlesWon: 0
            },
            armyCount: 14,
            armyTemplateId: "hero_guard_basic",
            learnedSkills: []
          }
        ],
        visibleHeroes: [
          {
            id: "hero-2",
            playerId: "player-2",
            name: "敌方先锋",
            position: { x: 1, y: 0 },
            vision: 4,
            move: { total: 6, remaining: 6 },
            stats: {
              attack: 3,
              defense: 2,
              power: 1,
              knowledge: 1,
              hp: 28,
              maxHp: 28
            },
            progression: {
              level: 2,
              experience: 80,
              skillPoints: 0,
              battlesWon: 1,
              neutralBattlesWon: 0,
              pvpBattlesWon: 1
            },
            armyCount: 12,
            armyTemplateId: "hero_guard_basic",
            learnedSkills: []
          }
        ],
        resources: {
          gold: 150,
          wood: 10,
          ore: 4
        },
        playerId: "player-1"
      },
      activeHero: {
        id: "hero-1",
        playerId: "player-1",
        name: "凯琳",
        position: { x: 0, y: 0 },
        vision: 4,
        move: { total: 6, remaining: 4 },
        stats: {
          attack: 2,
          defense: 1,
          power: 1,
          knowledge: 0,
          hp: 30,
          maxHp: 30
        },
        progression: {
          level: 2,
          experience: 120,
          skillPoints: 1,
          battlesWon: 2,
          neutralBattlesWon: 2,
          pvpBattlesWon: 0
        },
        armyCount: 14,
        armyTemplateId: "hero_guard_basic",
        learnedSkills: []
      },
      reachableTiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      selectedTile: { x: 0, y: 0 },
      hoveredTile: { x: 1, y: 0 },
      keyboardCursor: { x: 1, y: 0 }
    },
    battle: null,
    account: createAccountProfile(),
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
      recoverySummary: "权威房间状态已恢复，战后结果与地图状态已经重新对齐。",
      predictionStatus: "",
      pendingUiTasks: 2,
      replay: {
        replayId: "room-alpha:battle-1:player-1",
        loading: false,
        status: "paused",
        currentStepIndex: 0,
        totalSteps: 3
      },
      errorEvents: [
        buildRuntimeDiagnosticsErrorEvent({
          id: "client-auth-1",
          recordedAt: "2026-03-29T06:08:30.000Z",
          source: "client",
          surface: "h5",
          candidateRevision: null,
          featureArea: "login",
          ownerArea: "account",
          severity: "error",
          errorCode: "auth_request_failed",
          message: "Login refresh failed with 401.",
          context: {
            roomId: "room-alpha",
            playerId: "player-1",
            requestId: "request-1",
            route: "/api/auth/refresh",
            action: "session.refresh",
            statusCode: 401,
            crash: false,
            detail: "refresh token expired"
          }
        })
      ]
    }
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.source.surface, "h5-debug-shell");
  assert.equal(snapshot.source.mode, "world");
  assert.equal(snapshot.room.connectionStatus, "connected");
  assert.equal(snapshot.room.lastUpdateAt, "2026-03-29T06:08:00.000Z");
  assert.equal(snapshot.world?.map.visibleTileCount, 3);
  assert.equal(snapshot.world?.map.reachableTileCount, 2);
  assert.equal(snapshot.world?.hero?.id, "hero-1");
  assert.deepEqual(snapshot.world?.resources, { gold: 150, wood: 10, ore: 4 });
  assert.equal(snapshot.account.recentReplayCount, 1);
  assert.equal(snapshot.diagnostics.recoverySummary, "权威房间状态已恢复，战后结果与地图状态已经重新对齐。");
  assert.equal(snapshot.diagnostics.predictionStatus, null);
  assert.equal(snapshot.diagnostics.replay?.totalSteps, 3);
  assert.equal(snapshot.diagnostics.errorEvents[0]?.candidateRevision, "abc1234");
  assert.equal(snapshot.diagnostics.errorSummary.totalEvents, 1);
  assert.equal(snapshot.diagnostics.errorSummary.topFingerprints[0]?.featureArea, "login");

  const serialized = serializeRuntimeDiagnosticsSnapshot(snapshot);
  assert.match(serialized, /"schemaVersion": 1/);
  assert.match(serialized, /"surface": "h5-debug-shell"/);
  assert.match(serialized, /"reachableTileCount": 2/);
  assert.match(serialized, /"recoverySummary": "权威房间状态已恢复，战后结果与地图状态已经重新对齐。"/);
  assert.match(serialized, /"predictionStatus": null/);
  assert.match(serialized, /"errorCode": "auth_request_failed"/);

  const summary = renderRuntimeDiagnosticsSnapshotText(snapshot);
  assert.match(summary, /Errors 1 \/ fingerprints 1 \/ fatal 0 \/ crashes 0/);
  assert.match(summary, /Error login\/auth_request_failed 1x on h5 \(account\)/);
  assert.match(summary, /Room room-alpha \/ Player player-1 \/ Sync connected/);
  assert.match(summary, /Resources gold=150 wood=10 ore=4/);
  assert.match(summary, /Events battle.started, battle.resolved/);
  assert.match(summary, /Recovery 权威房间状态已恢复，战后结果与地图状态已经重新对齐。/);
});
