export type RuntimeDiagnosticsMode = "lobby" | "world" | "battle";

export type RuntimeDiagnosticsConnectionStatus = "connecting" | "connected" | "reconnecting" | "reconnect_failed";

export interface RuntimeDiagnosticsSnapshotSource {
  surface: string;
  devOnly: boolean;
  mode: RuntimeDiagnosticsMode;
}

export interface RuntimeDiagnosticsRoomSnapshot {
  roomId: string;
  playerId: string;
  day: number | null;
  connectionStatus: RuntimeDiagnosticsConnectionStatus;
  lastUpdateSource: string | null;
  lastUpdateReason: string | null;
  lastUpdateAt: string | null;
}

export interface RuntimeDiagnosticsWorldHeroSnapshot {
  id: string;
  name: string;
  position: { x: number; y: number };
  move: { total: number; remaining: number };
  stats: {
    attack: number;
    defense: number;
    power: number;
    knowledge: number;
    hp: number;
    maxHp: number;
  };
  armyTemplateId: string;
  armyCount: number;
  progression: {
    level: number;
    experience: number;
    skillPoints: number;
    battlesWon: number;
    neutralBattlesWon: number;
    pvpBattlesWon: number;
  };
}

export interface RuntimeDiagnosticsWorldSnapshot {
  map: {
    width: number;
    height: number;
    visibleTileCount: number;
    reachableTileCount: number;
  };
  resources: {
    gold: number;
    wood: number;
    ore: number;
  };
  selectedTile: { x: number; y: number } | null;
  hoveredTile: { x: number; y: number } | null;
  keyboardCursor: { x: number; y: number } | null;
  hero: RuntimeDiagnosticsWorldHeroSnapshot | null;
  visibleHeroes: Array<{
    id: string;
    playerId: string;
    position: { x: number; y: number };
  }>;
}

export interface RuntimeDiagnosticsBattleSnapshot {
  id: string;
  round: number;
  activeUnitId: string | null;
  selectedTargetId: string | null;
  unitCount: number;
  environmentCount: number;
  logTail: string[];
}

export interface RuntimeDiagnosticsAccountSnapshot {
  playerId: string;
  displayName: string;
  source: "remote" | "local";
  loginId: string | null;
  recentEventCount: number;
  recentReplayCount: number;
}

export interface RuntimeDiagnosticsReplaySnapshot {
  replayId: string;
  loading: boolean;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
}

export interface RuntimeDiagnosticsSnapshot {
  schemaVersion: number;
  exportedAt: string;
  source: RuntimeDiagnosticsSnapshotSource;
  room: RuntimeDiagnosticsRoomSnapshot;
  world: RuntimeDiagnosticsWorldSnapshot | null;
  battle: RuntimeDiagnosticsBattleSnapshot | null;
  account: RuntimeDiagnosticsAccountSnapshot;
  diagnostics: {
    eventTypes: string[];
    timelineTail: Array<{
      id: string;
      tone: string;
      source: string;
      text: string;
    }>;
    logTail: string[];
    predictionStatus: string | null;
    pendingUiTasks: number;
    replay: RuntimeDiagnosticsReplaySnapshot | null;
  };
}

export function serializeRuntimeDiagnosticsSnapshot(snapshot: RuntimeDiagnosticsSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
