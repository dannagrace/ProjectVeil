import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeDiagnosticsSummaryLines,
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
      recentReplayCount: 1
    },
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
      predictionStatus: "server-authoritative",
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
  assert.match(rendered, /Replay room-alpha:battle-1:player-1 \/ paused \/ step 1\/3/);
  assert.match(rendered, /Timeline \[push\/battle\] Room room-alpha finished battle battle-1/);
});
