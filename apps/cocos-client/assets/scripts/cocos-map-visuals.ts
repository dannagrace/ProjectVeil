import type { PlayerTileView, SessionUpdate, Vec2 } from "./VeilCocosSession.ts";
import { resolveMapBoardFeedbackLabel } from "./cocos-map-board-model.ts";

const NORTH_BIT = 1;
const EAST_BIT = 2;
const SOUTH_BIT = 4;
const WEST_BIT = 8;

export interface FogEdgeConfig {
  hiddenFogEdgeBaseGid: number;
  exploredFogEdgeBaseGid: number;
}

export interface FogPulseConfig {
  hiddenFogPulseGid: number;
  exploredFogPulseGid: number;
  hiddenFogEdgePulseOffset: number;
  exploredFogEdgePulseOffset: number;
}

export interface TileFeedbackEntry {
  position: Vec2;
  text: string;
  durationSeconds: number;
}

export interface FogOverlayStyle {
  text: string;
  opacity: number;
  edgeOpacity: number;
  labelOpacity: number;
  tone: "hidden" | "explored";
  featherMask: number;
}

export interface ObjectPulseEntry {
  position: Vec2;
  scale: number;
  durationSeconds: number;
}

function findBuildingPosition(update: SessionUpdate, buildingId: string): Vec2 | null {
  const tile = update.world.map.tiles.find((item) => item.building?.id === buildingId);
  return tile?.position ?? null;
}

export function createTileLookup(tiles: PlayerTileView[]): Map<string, PlayerTileView> {
  const lookup = new Map<string, PlayerTileView>();
  for (const tile of tiles) {
    lookup.set(tileKey(tile.position), tile);
  }
  return lookup;
}

export function resolveFogPulseGid(baseGid: number, pulseGid: number, phase: number): number {
  if (pulseGid <= 0) {
    return baseGid;
  }

  return phase % 2 === 1 ? pulseGid : baseGid;
}

export function resolveFogEdgePulseGid(baseGid: number, pulseOffset: number, phase: number): number {
  if (baseGid <= 0 || pulseOffset <= 0) {
    return baseGid;
  }

  return phase % 2 === 1 ? baseGid + pulseOffset : baseGid;
}

export function fogEdgeGidForTile(
  tile: PlayerTileView,
  tileLookup: Map<string, PlayerTileView>,
  config: FogEdgeConfig
): number {
  if (tile.fog === "hidden" && config.hiddenFogEdgeBaseGid > 0) {
    const mask = fogMaskAgainst(tile.position, tileLookup, ["explored", "visible"]);
    return mask > 0 ? config.hiddenFogEdgeBaseGid + mask - 1 : 0;
  }

  if (tile.fog === "explored" && config.exploredFogEdgeBaseGid > 0) {
    const mask = fogMaskAgainst(tile.position, tileLookup, ["visible"]);
    return mask > 0 ? config.exploredFogEdgeBaseGid + mask - 1 : 0;
  }

  return 0;
}

export function fogEdgeMarkerForTile(
  tile: PlayerTileView,
  tileLookup: Map<string, PlayerTileView>,
  phase = 0
): string {
  if (tile.fog === "hidden") {
    if (fogMaskAgainst(tile.position, tileLookup, ["explored", "visible"]) <= 0) {
      return " ";
    }

    return phase % 2 === 1 ? "^" : "~";
  }

  if (tile.fog === "explored") {
    if (fogMaskAgainst(tile.position, tileLookup, ["visible"]) <= 0) {
      return ".";
    }

    return phase % 2 === 1 ? ";" : ":";
  }

  return " ";
}

export function buildFogOverlayStyle(
  tile: PlayerTileView,
  tileLookup: Map<string, PlayerTileView>,
  phase = 0
): FogOverlayStyle | null {
  if (tile.fog === "hidden") {
    const featherMask = fogMaskAgainst(tile.position, tileLookup, ["explored", "visible"]);
    const frontier = featherMask > 0;
    return {
      text: "",
      opacity: frontier ? (phase % 2 === 1 ? 176 : 192) : phase % 2 === 1 ? 204 : 220,
      edgeOpacity: frontier ? (phase % 2 === 1 ? 62 : 78) : phase % 2 === 1 ? 184 : 198,
      labelOpacity: 0,
      tone: "hidden",
      featherMask
    };
  }

  if (tile.fog === "explored") {
    const featherMask = fogMaskAgainst(tile.position, tileLookup, ["visible"]);
    const frontier = featherMask > 0;
    return {
      text: "",
      opacity: frontier ? (phase % 2 === 1 ? 78 : 92) : phase % 2 === 1 ? 92 : 108,
      edgeOpacity: frontier ? (phase % 2 === 1 ? 24 : 34) : phase % 2 === 1 ? 72 : 82,
      labelOpacity: 0,
      tone: "explored",
      featherMask
    };
  }

  return null;
}

export function buildMapFeedbackEntriesFromUpdate(update: SessionUpdate, heroId?: string): TileFeedbackEntry[] {
  const ownHero = update.world.ownHeroes.find((hero) => hero.id === heroId) ?? update.world.ownHeroes[0] ?? null;
  const heroPosition = ownHero?.position ?? null;
  const entries: TileFeedbackEntry[] = [];

  for (const event of update.events) {
    if (event.type === "hero.moved" && event.path.length > 0) {
      entries.push({
        position: event.path[event.path.length - 1]!,
        text: resolveMapBoardFeedbackLabel(event) ?? `MOVE ${event.moveCost}`,
        durationSeconds: 0.7
      });
      continue;
    }

    if (event.type === "hero.collected" && heroPosition) {
      entries.push({
        position: heroPosition,
        text: resolveMapBoardFeedbackLabel(event) ?? `+${event.resource.kind.toUpperCase()}`,
        durationSeconds: 0.85
      });
      continue;
    }

    if (event.type === "hero.recruited" && heroPosition) {
      entries.push({
        position: heroPosition,
        text: resolveMapBoardFeedbackLabel(event) ?? `+${event.count}`,
        durationSeconds: 0.9
      });
      continue;
    }

    if (event.type === "hero.visited" && heroPosition) {
      const firstBonus =
        event.buildingKind === "watchtower"
          ? "VIS"
          : event.bonus.attack > 0
            ? "ATK"
            : event.bonus.defense > 0
              ? "DEF"
              : event.bonus.power > 0
                ? "POW"
                : event.bonus.knowledge > 0
                  ? "KNW"
                  : "STAT";
      entries.push({
        position: heroPosition,
        text: resolveMapBoardFeedbackLabel(event) ?? `+${firstBonus}`,
        durationSeconds: 0.92
      });
      continue;
    }

    if (event.type === "hero.claimedMine") {
      const buildingPosition = findBuildingPosition(update, event.buildingId) ?? heroPosition;
      if (buildingPosition) {
        entries.push({
          position: buildingPosition,
          text: resolveMapBoardFeedbackLabel(event) ?? `+${event.resourceKind.toUpperCase()}`,
          durationSeconds: 0.94
        });
      }
      continue;
    }

    if (event.type === "resource.produced") {
      const buildingPosition = findBuildingPosition(update, event.buildingId) ?? heroPosition;
      if (buildingPosition) {
        entries.push({
          position: buildingPosition,
          text: resolveMapBoardFeedbackLabel(event) ?? `+${event.resource.kind.toUpperCase()}`,
          durationSeconds: 0.9
        });
      }
      continue;
    }

    if (event.type === "neutral.moved") {
      entries.push({
        position: event.to,
        text: resolveMapBoardFeedbackLabel(event) ?? (event.reason === "chase" ? "CHASE" : event.reason === "return" ? "GUARD" : "PATROL"),
        durationSeconds: 0.88
      });
      continue;
    }

    if (event.type === "hero.progressed" && heroPosition) {
      entries.push({
        position: heroPosition,
        text: resolveMapBoardFeedbackLabel(event) ?? (event.levelsGained > 0 ? `LV ${event.level}` : `XP +${event.experienceGained}`),
        durationSeconds: 1
      });
      continue;
    }

    if (event.type === "battle.started") {
      const position = event.path[event.path.length - 1] ?? heroPosition;
      if (position) {
        entries.push({
          position,
          text: resolveMapBoardFeedbackLabel(event) ?? (event.encounterKind === "hero" ? "PVP" : "PVE"),
          durationSeconds: 0.95
        });
      }
      continue;
    }

    if (event.type === "battle.resolved" && heroPosition && heroId) {
      entries.push({
        position: heroPosition,
        text: resolveMapBoardFeedbackLabel(event, { heroId }) ?? (didHeroWin(event, heroId) ? "VICTORY" : "DEFEAT"),
        durationSeconds: 1.1
      });
    }
  }

  return entries;
}

export function buildObjectPulseEntriesFromUpdate(update: SessionUpdate, heroId?: string): ObjectPulseEntry[] {
  const ownHero = update.world.ownHeroes.find((hero) => hero.id === heroId) ?? update.world.ownHeroes[0] ?? null;
  const heroPosition = ownHero?.position ?? null;
  const entries: ObjectPulseEntry[] = [];

  for (const event of update.events) {
    if (event.type === "hero.collected" && heroPosition) {
      entries.push({
        position: heroPosition,
        scale: 1.18,
        durationSeconds: 0.24
      });
      continue;
    }

    if (event.type === "hero.recruited" && heroPosition) {
      entries.push({
        position: heroPosition,
        scale: 1.2,
        durationSeconds: 0.26
      });
      continue;
    }

    if (event.type === "hero.visited" && heroPosition) {
      entries.push({
        position: heroPosition,
        scale: 1.22,
        durationSeconds: 0.28
      });
      continue;
    }

    if (event.type === "hero.claimedMine") {
      const buildingPosition = findBuildingPosition(update, event.buildingId) ?? heroPosition;
      if (buildingPosition) {
        entries.push({
          position: buildingPosition,
          scale: 1.22,
          durationSeconds: 0.27
        });
      }
      continue;
    }

    if (event.type === "resource.produced") {
      const buildingPosition = findBuildingPosition(update, event.buildingId) ?? heroPosition;
      if (buildingPosition) {
        entries.push({
          position: buildingPosition,
          scale: 1.16,
          durationSeconds: 0.25
        });
      }
      continue;
    }

    if (event.type === "neutral.moved") {
      entries.push({
        position: event.to,
        scale: event.reason === "chase" ? 1.18 : 1.12,
        durationSeconds: 0.24
      });
      continue;
    }

    if (event.type === "battle.started") {
      const position = event.path[event.path.length - 1] ?? heroPosition;
      if (position) {
        entries.push({
          position,
          scale: event.encounterKind === "hero" ? 1.18 : 1.14,
          durationSeconds: 0.22
        });
      }
    }
  }

  return entries;
}

function didHeroWin(
  event: Extract<SessionUpdate["events"][number], { type: "battle.resolved" }>,
  heroId: string
): boolean {
  if (event.result === "attacker_victory") {
    return event.heroId === heroId;
  }

  return event.defenderHeroId === heroId;
}

function fogMaskAgainst(
  position: Vec2,
  tileLookup: Map<string, PlayerTileView>,
  targetFogStates: Array<PlayerTileView["fog"]>
): number {
  let mask = 0;

  if (matchesFog(position.x, position.y - 1, tileLookup, targetFogStates)) {
    mask |= NORTH_BIT;
  }
  if (matchesFog(position.x + 1, position.y, tileLookup, targetFogStates)) {
    mask |= EAST_BIT;
  }
  if (matchesFog(position.x, position.y + 1, tileLookup, targetFogStates)) {
    mask |= SOUTH_BIT;
  }
  if (matchesFog(position.x - 1, position.y, tileLookup, targetFogStates)) {
    mask |= WEST_BIT;
  }

  return mask;
}

function matchesFog(
  x: number,
  y: number,
  tileLookup: Map<string, PlayerTileView>,
  targetFogStates: Array<PlayerTileView["fog"]>
): boolean {
  const tile = tileLookup.get(tileKey({ x, y }));
  return Boolean(tile && targetFogStates.includes(tile.fog));
}

function tileKey(position: Vec2): string {
  return `${position.x}:${position.y}`;
}
