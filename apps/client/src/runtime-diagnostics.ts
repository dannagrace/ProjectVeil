import type {
  BattleState,
  PlayerWorldView,
  RuntimeDiagnosticsConnectionStatus,
  RuntimeDiagnosticsMode,
  RuntimeDiagnosticsSnapshot
} from "../../../packages/shared/src/index";
import type { PlayerAccountProfile } from "./player-account";

type WorldHero = PlayerWorldView["ownHeroes"][number];

interface TimelineEntrySnapshot {
  id: string;
  tone: string;
  source: string;
  text: string;
}

interface ReplaySnapshotInput {
  replayId: string;
  loading: boolean;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
}

export interface H5RuntimeDiagnosticsSnapshotInput {
  exportedAt?: string;
  devOnly: boolean;
  mode: RuntimeDiagnosticsMode;
  room: {
    roomId: string;
    playerId: string;
    day: number | null;
    connectionStatus: RuntimeDiagnosticsConnectionStatus;
    lastUpdateSource: string | null;
    lastUpdateReason: string | null;
    lastUpdateAt: number | null;
  };
  world: {
    state: PlayerWorldView;
    activeHero: WorldHero | null;
    reachableTiles: Array<{ x: number; y: number }>;
    selectedTile: { x: number; y: number } | null;
    hoveredTile: { x: number; y: number } | null;
    keyboardCursor: { x: number; y: number } | null;
  } | null;
  battle: {
    state: BattleState;
    selectedTargetId: string | null;
  } | null;
  account: PlayerAccountProfile;
  diagnostics: {
    eventTypes: string[];
    timelineTail: TimelineEntrySnapshot[];
    logTail: string[];
    recoverySummary: string | null;
    predictionStatus: string;
    pendingUiTasks: number;
    replay: ReplaySnapshotInput | null;
  };
}

function buildWorldSnapshot(input: NonNullable<H5RuntimeDiagnosticsSnapshotInput["world"]>) {
  return {
    map: {
      width: input.state.map.width,
      height: input.state.map.height,
      visibleTileCount: input.state.map.tiles.filter((tile) => tile.fog !== "hidden").length,
      reachableTileCount: input.reachableTiles.length
    },
    resources: { ...input.state.resources },
    selectedTile: input.selectedTile ? { ...input.selectedTile } : null,
    hoveredTile: input.hoveredTile ? { ...input.hoveredTile } : null,
    keyboardCursor: input.keyboardCursor ? { ...input.keyboardCursor } : null,
    hero:
      input.activeHero == null
        ? null
        : {
            id: input.activeHero.id,
            name: input.activeHero.name,
            position: { x: input.activeHero.position.x, y: input.activeHero.position.y },
            move: { total: input.activeHero.move.total, remaining: input.activeHero.move.remaining },
            stats: { ...input.activeHero.stats },
            armyTemplateId: input.activeHero.armyTemplateId,
            armyCount: input.activeHero.armyCount,
            progression: {
              level: input.activeHero.progression.level,
              experience: input.activeHero.progression.experience,
              skillPoints: input.activeHero.progression.skillPoints,
              battlesWon: input.activeHero.progression.battlesWon,
              neutralBattlesWon: input.activeHero.progression.neutralBattlesWon,
              pvpBattlesWon: input.activeHero.progression.pvpBattlesWon
            }
          },
    visibleHeroes: input.state.visibleHeroes.map((item) => ({
      id: item.id,
      playerId: item.playerId,
      position: { x: item.position.x, y: item.position.y }
    }))
  };
}

function buildBattleSnapshot(input: NonNullable<H5RuntimeDiagnosticsSnapshotInput["battle"]>) {
  return {
    id: input.state.id,
    round: input.state.round,
    activeUnitId: input.state.activeUnitId,
    selectedTargetId: input.selectedTargetId,
    unitCount: Object.keys(input.state.units).length,
    environmentCount: input.state.environment.length,
    logTail: input.state.log.slice(-6)
  };
}

export function buildH5RuntimeDiagnosticsSnapshot(
  input: H5RuntimeDiagnosticsSnapshotInput
): RuntimeDiagnosticsSnapshot {
  return {
    schemaVersion: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    source: {
      surface: "h5-debug-shell",
      devOnly: input.devOnly,
      mode: input.mode
    },
    room: {
      roomId: input.room.roomId,
      playerId: input.room.playerId,
      day: input.room.day,
      connectionStatus: input.room.connectionStatus,
      lastUpdateSource: input.room.lastUpdateSource,
      lastUpdateReason: input.room.lastUpdateReason,
      lastUpdateAt: input.room.lastUpdateAt ? new Date(input.room.lastUpdateAt).toISOString() : null
    },
    world: input.world ? buildWorldSnapshot(input.world) : null,
    battle: input.battle ? buildBattleSnapshot(input.battle) : null,
    account: {
      playerId: input.account.playerId,
      displayName: input.account.displayName,
      source: input.account.source,
      loginId: input.account.loginId ?? null,
      recentEventCount: input.account.recentEventLog.length,
      recentReplayCount: input.account.recentBattleReplays.length
    },
    overview: null,
    diagnostics: {
      eventTypes: [...input.diagnostics.eventTypes],
      timelineTail: input.diagnostics.timelineTail.map((entry) => ({
        id: entry.id,
        tone: entry.tone,
        source: entry.source,
        text: entry.text
      })),
      logTail: [...input.diagnostics.logTail],
      recoverySummary: input.diagnostics.recoverySummary || null,
      predictionStatus: input.diagnostics.predictionStatus || null,
      pendingUiTasks: input.diagnostics.pendingUiTasks,
      replay: input.diagnostics.replay ? { ...input.diagnostics.replay } : null
    }
  };
}
