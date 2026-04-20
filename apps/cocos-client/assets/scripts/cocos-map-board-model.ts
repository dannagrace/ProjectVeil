import type { PlayerTileView, SessionUpdate, Vec2 } from "./VeilCocosSession.ts";
import { resolveCocosTileMarkerVisual, type CocosTileMarkerVisual } from "./cocos-object-visuals.ts";

export type { CocosTileMarkerVisual } from "./cocos-object-visuals.ts";

export interface MapBoardTileViewModel {
  key: string;
  tile: PlayerTileView | null;
  fog: PlayerTileView["fog"] | "hidden";
  reachable: boolean;
  heroTile: boolean;
  interactable: boolean;
  objectMarker: CocosTileMarkerVisual | null;
}

export interface MapBoardKeyboardCursorMove {
  previous: Vec2 | null;
  current: Vec2;
  clearedKey: string | null;
  highlightedKey: string;
}

export type MapBoardKeyboardDirection = "up" | "right" | "down" | "left";

export function mapBoardTileKey(position: Vec2): string {
  return `${position.x}-${position.y}`;
}

export function buildTileViewModel(
  update: SessionUpdate,
  position: Vec2,
  heroId?: string
): MapBoardTileViewModel {
  const tile = update.world.map.tiles.find((entry) => entry.position.x === position.x && entry.position.y === position.y) ?? null;
  const activeHero = update.world.ownHeroes.find((hero) => hero.id === heroId) ?? update.world.ownHeroes[0] ?? null;
  const reachable = (update.reachableTiles ?? []).some((entry) => entry.x === position.x && entry.y === position.y);
  const heroTile = Boolean(activeHero && activeHero.position.x === position.x && activeHero.position.y === position.y);

  return {
    key: mapBoardTileKey(position),
    tile,
    fog: tile?.fog ?? "hidden",
    reachable,
    heroTile,
    interactable: tile !== null,
    objectMarker: tile ? resolveMapBoardObjectMarker(tile) : null
  };
}

export function resolveMapBoardObjectMarker(tile: PlayerTileView | null): CocosTileMarkerVisual | null {
  return resolveCocosTileMarkerVisual(tile);
}

export function moveMapBoardKeyboardCursor(
  previous: Vec2 | null,
  direction: MapBoardKeyboardDirection,
  bounds: { width: number; height: number }
): MapBoardKeyboardCursorMove {
  const current = previous ? { ...previous } : { x: 0, y: 0 };
  if (direction === "up") {
    current.y = Math.max(0, current.y - 1);
  } else if (direction === "right") {
    current.x = Math.min(bounds.width - 1, current.x + 1);
  } else if (direction === "down") {
    current.y = Math.min(bounds.height - 1, current.y + 1);
  } else {
    current.x = Math.max(0, current.x - 1);
  }

  return {
    previous,
    current,
    clearedKey: previous ? mapBoardTileKey(previous) : null,
    highlightedKey: mapBoardTileKey(current)
  };
}

export function resolveMapBoardFeedbackLabel(
  event: SessionUpdate["events"][number],
  options: {
    heroId?: string;
  } = {}
): string | null {
  if (event.type === "hero.moved") {
    return `MOVE ${event.moveCost}`;
  }

  if (event.type === "hero.collected") {
    return `+${event.resource.kind.toUpperCase()}`;
  }

  if (event.type === "hero.recruited") {
    return `+${event.count}`;
  }

  if (event.type === "hero.visited") {
    if (event.buildingKind === "watchtower") {
      return `+VIS ${event.visionBonus}`;
    }

    return event.bonus.attack > 0
      ? "+ATK"
      : event.bonus.defense > 0
        ? "+DEF"
        : event.bonus.power > 0
          ? "+POW"
          : event.bonus.knowledge > 0
            ? "+KNW"
            : "+STAT";
  }

  if (event.type === "hero.claimedMine") {
    return `+${event.resourceKind.toUpperCase()}`;
  }

  if (event.type === "resource.produced") {
    return `+${event.resource.kind.toUpperCase()}`;
  }

  if (event.type === "neutral.moved") {
    return event.reason === "chase" ? "CHASE" : event.reason === "return" ? "GUARD" : "PATROL";
  }

  if (event.type === "hero.progressed") {
    return event.levelsGained > 0 ? `LV ${event.level}` : `XP +${event.experienceGained}`;
  }

  if (event.type === "battle.started") {
    return event.encounterKind === "hero" ? "PVP" : "PVE";
  }

  if (event.type === "battle.resolved" && options.heroId) {
    return didHeroWin(event, options.heroId) ? "VICTORY" : "DEFEAT";
  }

  return null;
}

function didHeroWin(event: Extract<SessionUpdate["events"][number], { type: "battle.resolved" }>, heroId: string): boolean {
  if (event.result === "attacker_victory") {
    return event.heroId === heroId;
  }
  return event.defenderHeroId === heroId;
}
