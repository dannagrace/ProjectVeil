import type {
  FogState,
  HeroState,
  MapBuildingState,
  NeutralArmyState,
  OccupantState,
  PlayerBuildingView,
  PlayerTileView,
  PlayerWorldView,
  TileState,
  WorldEvent,
  WorldMapState,
  WorldState
} from "../models.ts";
import {
  distance,
  tileIndex,
  tileKey
} from "./map-geometry.ts";
import {
  getFogAt
} from "./pathfinding.ts";
import {
  cloneHeroStatBonus,
  cloneResourceLedger,
  getPlayerResources
} from "./world-builders.ts";

export function clonePlayerBuildingView(building: MapBuildingState): PlayerBuildingView {
  if (building.kind === "recruitment_post") {
    return {
      id: building.id,
      kind: building.kind,
      label: building.label,
      unitTemplateId: building.unitTemplateId,
      recruitCount: building.recruitCount,
      tier: building.tier,
      ...(building.maxTier !== undefined ? { maxTier: building.maxTier } : {}),
      availableCount: building.availableCount,
      cost: cloneResourceLedger(building.cost),
      ...(typeof building.lastUsedDay === "number" ? { lastUsedDay: building.lastUsedDay } : {}),
      ...(building.ownerPlayerId ? { ownerPlayerId: building.ownerPlayerId } : {})
    };
  }

  if (building.kind === "attribute_shrine") {
    return {
      id: building.id,
      kind: building.kind,
      label: building.label,
      bonus: cloneHeroStatBonus(building.bonus),
      tier: building.tier,
      ...(building.maxTier !== undefined ? { maxTier: building.maxTier } : {}),
      ...(typeof building.lastUsedDay === "number" ? { lastUsedDay: building.lastUsedDay } : {}),
      ...(building.ownerPlayerId ? { ownerPlayerId: building.ownerPlayerId } : {})
    };
  }

  if (building.kind === "watchtower") {
    return {
      id: building.id,
      kind: building.kind,
      label: building.label,
      visionBonus: building.visionBonus,
      tier: building.tier,
      ...(building.maxTier !== undefined ? { maxTier: building.maxTier } : {}),
      ...(typeof building.lastUsedDay === "number" ? { lastUsedDay: building.lastUsedDay } : {}),
      ...(building.ownerPlayerId ? { ownerPlayerId: building.ownerPlayerId } : {})
    };
  }

  return {
    id: building.id,
    kind: building.kind,
    label: building.label,
    resourceKind: building.resourceKind,
    income: building.income,
    tier: building.tier,
    ...(building.maxTier !== undefined ? { maxTier: building.maxTier } : {}),
    ...(typeof building.lastHarvestDay === "number" ? { lastHarvestDay: building.lastHarvestDay } : {}),
    ...(building.ownerPlayerId ? { ownerPlayerId: building.ownerPlayerId } : {})
  };
}
export function updateVisibilityByPlayer(map: WorldMapState, heroes: HeroState[], state: WorldState): Record<string, FogState[]> {
  const nextVisibility = { ...state.visibilityByPlayer };
  const heroGroups = new Map<string, HeroState[]>();

  for (const hero of heroes) {
    const group = heroGroups.get(hero.playerId) ?? [];
    group.push(hero);
    heroGroups.set(hero.playerId, group);
  }

  for (const [playerId, ownedHeroes] of heroGroups) {
    const previous = nextVisibility[playerId] ?? new Array<FogState>(map.tiles.length).fill("hidden");
    nextVisibility[playerId] = map.tiles.map((tile, index) => {
      const visible = ownedHeroes.some((hero) => distance(hero.position, tile.position) <= hero.vision);
      if (visible) {
        return "visible";
      }

      return getFogAt(previous, index) === "visible" ? "explored" : getFogAt(previous, index);
    });
  }

  return nextVisibility;
}
export function syncWorldTiles(
  map: WorldMapState,
  heroes: HeroState[],
  neutralArmies: Record<string, NeutralArmyState>,
  buildings: Record<string, MapBuildingState>
): WorldMapState {
  const heroByKey = new Map<string, OccupantState>(
    heroes.map((hero) => [tileKey(hero.position), { kind: "hero", refId: hero.id }])
  );
  const neutralByKey = new Map<string, OccupantState>(
    Object.values(neutralArmies).map((army) => [tileKey(army.position), { kind: "neutral", refId: army.id }])
  );
  const buildingByKey = new Map<string, MapBuildingState>(
    Object.values(buildings).map((building) => [tileKey(building.position), building])
  );

  return {
    ...map,
    tiles: map.tiles.map((tile) => {
      const heroOccupant = heroByKey.get(tileKey(tile.position));
      if (heroOccupant) {
        return {
          ...tile,
          occupant: heroOccupant,
          building: buildingByKey.get(tileKey(tile.position))
        };
      }

      const neutralOccupant = neutralByKey.get(tileKey(tile.position));
      if (neutralOccupant) {
        return {
          ...tile,
          occupant: neutralOccupant,
          building: buildingByKey.get(tileKey(tile.position))
        };
      }

      return {
        ...tile,
        occupant: undefined,
        building: buildingByKey.get(tileKey(tile.position))
      };
    })
  };
}
export function createPlayerWorldView(state: WorldState, playerId: string): PlayerWorldView {
  const visibility = state.visibilityByPlayer[playerId] ?? new Array<FogState>(state.map.tiles.length).fill("hidden");
  const tiles: PlayerTileView[] = state.map.tiles.map((tile, index) => {
    const fog = getFogAt(visibility, index);
    if (fog === "hidden") {
      return {
        position: tile.position,
        fog,
        terrain: "unknown",
        walkable: false,
        resource: undefined,
        occupant: undefined,
        building: undefined
      };
    }

    if (fog === "explored") {
      return {
        position: tile.position,
        fog,
        terrain: tile.terrain,
        walkable: tile.walkable,
        resource: undefined,
        occupant: undefined,
        building: tile.building ? clonePlayerBuildingView(tile.building) : undefined
      };
    }

    return {
      position: tile.position,
      fog,
      terrain: tile.terrain,
      walkable: tile.walkable,
      resource: tile.resource,
      occupant: tile.occupant,
      building: tile.building ? clonePlayerBuildingView(tile.building) : undefined
    };
  });

  return {
    meta: state.meta,
    ...(state.turnDeadlineAt ? { turnDeadlineAt: state.turnDeadlineAt } : {}),
    map: {
      width: state.map.width,
      height: state.map.height,
      tiles
    },
    ownHeroes: state.heroes.filter((hero) => hero.playerId === playerId),
    visibleHeroes: state.heroes
      .filter((hero) => hero.playerId !== playerId)
      .filter((hero) => getFogAt(visibility, tileIndex(state.map, hero.position)) === "visible")
      .map((hero) => ({
        id: hero.id,
        playerId: hero.playerId,
        name: hero.name,
        level: hero.progression.level,
        position: hero.position
      })),
    resources: getPlayerResources(state.resources, playerId),
    playerId
  };
}

export function filterWorldEventsForPlayer(
  state: WorldState,
  playerId: string,
  events: WorldEvent[]
): WorldEvent[] {
  const ownsHero = (heroId: string | undefined): boolean =>
    Boolean(heroId && state.heroes.some((hero) => hero.id === heroId && hero.playerId === playerId));

  return events.filter((event) => {
    switch (event.type) {
      case "turn.advanced":
        return true;
      case "hero.moved":
      case "hero.collected":
      case "hero.recruited":
      case "hero.visited":
      case "hero.claimedMine":
      case "hero.upgradedBuilding":
      case "hero.progressed":
      case "hero.skillLearned":
      case "hero.equipmentChanged":
      case "hero.equipmentFound":
        return ownsHero(event.heroId);
      case "neutral.moved": {
        const visibility = state.visibilityByPlayer[playerId];
        if (ownsHero(event.targetHeroId)) {
          return true;
        }
        if (!visibility) {
          return false;
        }

        return (
          getFogAt(visibility, tileIndex(state.map, event.from)) === "visible" ||
          getFogAt(visibility, tileIndex(state.map, event.to)) === "visible"
        );
      }
      case "resource.produced":
        return event.playerId === playerId;
      case "battle.started":
      case "battle.resolved":
        if (event.attackerPlayerId === playerId || event.defenderPlayerId === playerId) {
          return true;
        }
        return ownsHero(event.heroId) || ownsHero(event.defenderHeroId);
      default:
        return false;
    }
  });
}

