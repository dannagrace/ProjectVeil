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

export function buildRuntimeDiagnosticsSummaryLines(snapshot: RuntimeDiagnosticsSnapshot): string[] {
  const lines = [
    `Mode ${snapshot.source.mode} (${snapshot.source.surface})`,
    `Room ${snapshot.room.roomId} / Player ${snapshot.room.playerId} / Sync ${snapshot.room.connectionStatus}`
  ];

  if (snapshot.room.day != null) {
    lines.push(`Day ${snapshot.room.day}`);
  }

  if (snapshot.room.lastUpdateSource || snapshot.room.lastUpdateReason || snapshot.room.lastUpdateAt) {
    const updateParts = [
      snapshot.room.lastUpdateSource ? `source=${snapshot.room.lastUpdateSource}` : null,
      snapshot.room.lastUpdateReason ? `reason=${snapshot.room.lastUpdateReason}` : null,
      snapshot.room.lastUpdateAt ? `at=${snapshot.room.lastUpdateAt}` : null
    ].filter((value): value is string => value != null);

    lines.push(`Last update ${updateParts.join(" / ")}`);
  }

  if (snapshot.world) {
    lines.push(
      `World ${snapshot.world.map.width}x${snapshot.world.map.height} / visible ${snapshot.world.map.visibleTileCount} / reachable ${snapshot.world.map.reachableTileCount}`
    );
    lines.push(
      `Resources gold=${snapshot.world.resources.gold} wood=${snapshot.world.resources.wood} ore=${snapshot.world.resources.ore}`
    );

    if (snapshot.world.hero) {
      lines.push(
        `Hero ${snapshot.world.hero.name} @ ${snapshot.world.hero.position.x},${snapshot.world.hero.position.y} / MOV ${snapshot.world.hero.move.remaining}/${snapshot.world.hero.move.total} / HP ${snapshot.world.hero.stats.hp}/${snapshot.world.hero.stats.maxHp}`
      );
    }
  }

  if (snapshot.battle) {
    lines.push(
      `Battle ${snapshot.battle.id} / round ${snapshot.battle.round} / units ${snapshot.battle.unitCount} / environment ${snapshot.battle.environmentCount}`
    );
  }

  lines.push(
    `Account ${snapshot.account.displayName} (${snapshot.account.source}) / events ${snapshot.account.recentEventCount} / replays ${snapshot.account.recentReplayCount}`
  );

  if (snapshot.diagnostics.eventTypes.length > 0) {
    lines.push(`Events ${snapshot.diagnostics.eventTypes.join(", ")}`);
  }

  if (snapshot.diagnostics.predictionStatus) {
    lines.push(`Prediction ${snapshot.diagnostics.predictionStatus}`);
  }

  lines.push(`Pending UI tasks ${snapshot.diagnostics.pendingUiTasks}`);

  if (snapshot.diagnostics.replay) {
    lines.push(
      `Replay ${snapshot.diagnostics.replay.replayId} / ${snapshot.diagnostics.replay.status} / step ${snapshot.diagnostics.replay.currentStepIndex}/${snapshot.diagnostics.replay.totalSteps}`
    );
  }

  for (const entry of snapshot.diagnostics.timelineTail.slice(0, 3)) {
    lines.push(`Timeline [${entry.source}/${entry.tone}] ${entry.text}`);
  }

  for (const line of snapshot.diagnostics.logTail.slice(0, 3)) {
    lines.push(`Log ${line}`);
  }

  return lines;
}

export function renderRuntimeDiagnosticsSnapshotText(snapshot: RuntimeDiagnosticsSnapshot): string {
  return buildRuntimeDiagnosticsSummaryLines(snapshot).join("\n");
}

export function serializeRuntimeDiagnosticsSnapshot(snapshot: RuntimeDiagnosticsSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
