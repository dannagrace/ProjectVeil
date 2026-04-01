import {
  type PrimaryClientTelemetryEvent,
  buildRuntimeDiagnosticsTriageView,
  type RuntimeDiagnosticsConnectionStatus,
  type RuntimeDiagnosticsMode,
  type RuntimeDiagnosticsSnapshot
} from "../../../../packages/shared/src/index.ts";
import type { CocosPlayerAccountProfile } from "./cocos-lobby.ts";
import type { SessionUpdate } from "./VeilCocosSession.ts";

interface CocosTimelineEntrySnapshot {
  id: string;
  tone: string;
  source: string;
  text: string;
}

export interface CocosRuntimeDiagnosticsSnapshotInput {
  exportedAt?: string;
  devOnly: boolean;
  mode: RuntimeDiagnosticsMode;
  roomId: string;
  playerId: string;
  connectionStatus: RuntimeDiagnosticsConnectionStatus;
  lastUpdateSource: string | null;
  lastUpdateReason: string | null;
  lastUpdateAt: number | null;
  update: SessionUpdate | null;
  account: CocosPlayerAccountProfile;
  timelineEntries: string[];
  logLines: string[];
  predictionStatus: string;
  recoverySummary: string | null;
  primaryClientTelemetry: PrimaryClientTelemetryEvent[];
}

function buildTimelineTail(entries: string[]): CocosTimelineEntrySnapshot[] {
  return entries.slice(0, 4).map((entry, index) => ({
    id: `cocos-timeline-${index + 1}`,
    tone: "neutral",
    source: "timeline",
    text: entry
  }));
}

export function buildCocosRuntimeDiagnosticsSnapshot(
  input: CocosRuntimeDiagnosticsSnapshotInput
): RuntimeDiagnosticsSnapshot {
  const update = input.update;
  const hero = update?.world.ownHeroes[0] ?? null;

  return {
    schemaVersion: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    source: {
      surface: "cocos-runtime-overlay",
      devOnly: input.devOnly,
      mode: input.mode
    },
    room: {
      roomId: input.roomId,
      playerId: input.playerId,
      day: update?.world.meta.day ?? null,
      connectionStatus: input.connectionStatus,
      lastUpdateSource: input.lastUpdateSource,
      lastUpdateReason: input.lastUpdateReason,
      lastUpdateAt: input.lastUpdateAt ? new Date(input.lastUpdateAt).toISOString() : null
    },
    world: update
      ? {
          map: {
            width: update.world.map.width,
            height: update.world.map.height,
            visibleTileCount: update.world.map.tiles.filter((tile) => tile.fog !== "hidden").length,
            reachableTileCount: update.reachableTiles.length
          },
          resources: { ...update.world.resources },
          selectedTile: null,
          hoveredTile: null,
          keyboardCursor: null,
          hero: hero
            ? {
                id: hero.id,
                name: hero.name,
                position: { ...hero.position },
                move: { ...hero.move },
                stats: { ...hero.stats },
                armyTemplateId: hero.armyTemplateId,
                armyCount: hero.armyCount,
                progression: { ...hero.progression }
              }
            : null,
          visibleHeroes: update.world.visibleHeroes.map((visibleHero) => ({
            id: visibleHero.id,
            playerId: visibleHero.playerId,
            position: { ...visibleHero.position }
          }))
        }
      : null,
    battle: update?.battle
      ? {
          id: update.battle.id,
          round: update.battle.round,
          activeUnitId: update.battle.activeUnitId,
          selectedTargetId: null,
          unitCount: Object.keys(update.battle.units).length,
          environmentCount: update.battle.environment.length,
          logTail: update.battle.log.slice(-6)
        }
      : null,
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
      eventTypes: [],
      timelineTail: buildTimelineTail(input.timelineEntries),
      logTail: input.logLines.slice(0, 6),
      recoverySummary: input.recoverySummary,
      predictionStatus: input.predictionStatus || null,
      pendingUiTasks: 0,
      replay: null,
      primaryClientTelemetry: input.primaryClientTelemetry.slice(0, 8)
    }
  };
}

export function buildCocosRuntimeTriageSummaryLines(
  input: CocosRuntimeDiagnosticsSnapshotInput,
  now: number | string | Date = Date.now()
): string[] {
  const snapshot = buildCocosRuntimeDiagnosticsSnapshot(input);
  const triage = buildRuntimeDiagnosticsTriageView(snapshot, now);
  const lines = triage.alerts.slice(0, 2).map((alert) => `${alert.label} · ${alert.detail}`);
  const syncSection = triage.sections.find((section) => section.id === "sync");
  const heroSection = triage.sections.find((section) => section.id === "heroes");

  if (syncSection?.items[0]) {
    lines.push(`${syncSection.items[0].label} ${syncSection.items[0].value}`);
  }

  if (heroSection?.items[0]) {
    lines.push(`${heroSection.items[0].label} ${heroSection.items[0].value}`);
  }

  return lines.slice(0, 4);
}
