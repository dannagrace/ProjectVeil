import {
  applyHeroEquipmentChange,
  getBuildingUpgradeConfig,
  getDefaultUnitCatalog,
  type EquipmentType,
  type HeroState,
  validateHeroEquipmentChange
} from "./project-shared/index.ts";
import type {
  AttributeShrineBuildingView,
  HeroView,
  MovementPlan,
  PlayerTileView,
  PlayerWorldView,
  RecruitmentBuildingView,
  ResourceMineBuildingView,
  WatchtowerBuildingView,
  Vec2
} from "./VeilCocosSession.ts";

export type CocosWorldAction =
  | {
      type: "hero.move";
      heroId: string;
      destination: Vec2;
    }
  | {
      type: "hero.collect";
      heroId: string;
      position: Vec2;
    }
  | {
      type: "hero.recruit";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.visit";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.claimMine";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.upgradeBuilding";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.equip";
      heroId: string;
      slot: EquipmentType;
      equipmentId: string;
    }
  | {
      type: "hero.unequip";
      heroId: string;
      slot: EquipmentType;
    }
  | {
      type: "turn.endDay";
    };

export interface CocosPlayerWorldPrediction {
  world: PlayerWorldView;
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
  reason?: string;
}

export function predictPlayerWorldAction(view: PlayerWorldView, action: CocosWorldAction): CocosPlayerWorldPrediction {
  if (action.type === "turn.endDay") {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "prediction_not_supported"
    };
  }

  const hero = view.ownHeroes.find((item) => item.id === action.heroId);
  if (!hero) {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "hero_not_found"
    };
  }

  if (action.type === "hero.equip" || action.type === "hero.unequip") {
    const validation = validateHeroEquipmentChange(
      { loadout: hero.loadout },
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    if (!validation.valid) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: listReachableTilesInPlayerView(view, hero.id),
        reason: validation.reason ?? "invalid_equipment_change"
      };
    }

    const equipmentChange = applyHeroEquipmentChange(
      toHeroState(hero),
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    const nextHeroes = view.ownHeroes.map((item) =>
      item.id === hero.id
        ? {
            ...item,
            loadout: equipmentChange.hero.loadout
          }
        : item
    );

    return {
      world: {
        ...view,
        ownHeroes: nextHeroes
      },
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(view, hero.id)
    };
  }

  if (action.type === "hero.move") {
    const destinationTile = findPlayerTile(view, action.destination);
    if (!destinationTile) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "destination_not_found"
      };
    }

    if (!destinationTile.walkable || destinationTile.fog === "hidden") {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "destination_blocked"
      };
    }

    const occupiedByOtherHero = view.ownHeroes.find(
      (item) => item.id !== hero.id && samePosition(item.position, action.destination)
    );
    if (occupiedByOtherHero && occupiedByOtherHero.playerId === view.playerId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "destination_occupied"
      };
    }

    const plan = planPlayerViewMovement(view, hero.id, action.destination);
    if (!plan) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "path_not_found"
      };
    }

    if (plan.moveCost > hero.move.remaining) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "not_enough_move_points"
      };
    }

    const nextPosition = plan.travelPath[plan.travelPath.length - 1] ?? hero.position;
    const nextHeroes = view.ownHeroes.map((item) =>
      item.id === hero.id
        ? {
            ...item,
            position: nextPosition,
            move: {
              ...item.move,
              remaining: clamp(item.move.remaining - plan.moveCost, 0, item.move.total)
            }
          }
        : item
    );

    const nextTiles: PlayerTileView[] = view.map.tiles.map((tile) => {
      if (samePosition(tile.position, hero.position) && tile.occupant?.kind === "hero" && tile.occupant.refId === hero.id) {
        return {
          ...tile,
          occupant: undefined
        };
      }

      if (samePosition(tile.position, nextPosition) && !plan.endsInEncounter && tile.fog === "visible") {
        return {
          ...tile,
          occupant: {
            kind: "hero",
            refId: hero.id
          }
        };
      }

      return tile;
    });

    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: nextHeroes,
      map: {
        ...view.map,
        tiles: nextTiles
      }
    };

    return {
      world: predictedWorld,
      movementPlan: plan,
      reachableTiles: plan.endsInEncounter ? [] : listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type === "hero.recruit") {
    const tile = findPlayerTile(view, hero.position);
    const building = tile?.building;
    if (!building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (building.id !== action.buildingId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_on_building"
      };
    }

    if (!isRecruitmentBuilding(building)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_recruitable"
      };
    }

    if (building.availableCount <= 0) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_depleted"
      };
    }

    if (building.tier < getRequiredBuildingTierForUnit(building.unitTemplateId)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_tier_too_low"
      };
    }

    if (!hasEnoughResources(view.resources, building.cost)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "not_enough_resources"
      };
    }

    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: view.ownHeroes.map((item) =>
        item.id === hero.id
          ? {
              ...item,
              armyCount: item.armyCount + building.availableCount
            }
          : item
      ),
      map: {
        ...view.map,
        tiles: view.map.tiles.map((item) => {
          const currentBuilding = item.building;
          if (!samePosition(item.position, hero.position) || !isRecruitmentBuilding(currentBuilding)) {
            return item;
          }

          return {
            ...item,
            building: {
              ...currentBuilding,
              cost: { ...currentBuilding.cost },
              availableCount: 0
            }
          };
        })
      },
      resources: {
        gold: Math.max(0, view.resources.gold - building.cost.gold),
        wood: Math.max(0, view.resources.wood - building.cost.wood),
        ore: Math.max(0, view.resources.ore - building.cost.ore)
      }
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type === "hero.visit") {
    const tile = findPlayerTile(view, hero.position);
    const building = tile?.building;
    if (!building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (building.id !== action.buildingId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_on_building"
      };
    }

    if (!isAttributeShrineBuilding(building) && !isWatchtowerBuilding(building)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_visitable"
      };
    }

    if (typeof building.lastUsedDay === "number" && building.lastUsedDay >= view.meta.day) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_on_cooldown"
      };
    }

    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: view.ownHeroes.map((item) => {
        if (item.id !== hero.id) {
          return item;
        }

        if (isAttributeShrineBuilding(building)) {
          return {
            ...item,
            stats: {
              ...item.stats,
              attack: item.stats.attack + building.bonus.attack,
              defense: item.stats.defense + building.bonus.defense,
              power: item.stats.power + building.bonus.power,
              knowledge: item.stats.knowledge + building.bonus.knowledge
            }
          };
        }

        return {
          ...item,
          vision: item.vision + building.visionBonus
        };
      }),
      map: {
        ...view.map,
        tiles: view.map.tiles.map((item) => {
          const currentBuilding = item.building;
          if (
            !samePosition(item.position, hero.position) ||
            (!isAttributeShrineBuilding(currentBuilding) && !isWatchtowerBuilding(currentBuilding))
          ) {
            return item;
          }

          return {
            ...item,
            building: {
              ...currentBuilding,
              lastUsedDay: view.meta.day
            }
          };
        })
      }
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type === "hero.claimMine") {
    const tile = findPlayerTile(view, hero.position);
    const building = tile?.building;
    if (!building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (building.id !== action.buildingId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_on_building"
      };
    }

    if (!isResourceMineBuilding(building)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_claimable"
      };
    }

    if (typeof building.lastHarvestDay === "number" && building.lastHarvestDay >= view.meta.day) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_on_cooldown"
      };
    }

    const predictedWorld: PlayerWorldView = {
      ...view,
      resources: {
        ...view.resources,
        [building.resourceKind]: view.resources[building.resourceKind] + building.income
      },
      map: {
        ...view.map,
        tiles: view.map.tiles.map((item) => {
          const currentBuilding = item.building;
          if (!samePosition(item.position, hero.position) || !isResourceMineBuilding(currentBuilding)) {
            return item;
          }

          return {
            ...item,
            building: {
              ...currentBuilding,
              lastHarvestDay: view.meta.day,
              ownerPlayerId: view.playerId
            }
          };
        })
      }
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type === "hero.upgradeBuilding") {
    const tile = view.map.tiles.find((item) => item.building?.id === action.buildingId);
    const building = tile?.building;
    if (!tile || !building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (distance(hero.position, tile.position) > 1) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_adjacent_to_building"
      };
    }

    const trackId = getBuildingUpgradeTrackId(building);
    if (!trackId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_upgradeable"
      };
    }

    if (!building.ownerPlayerId || building.ownerPlayerId !== view.playerId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_owned_by_player"
      };
    }

    const maxTier = building.maxTier ?? (trackId === "castle" ? 3 : 2);
    if (building.tier >= maxTier) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_max_tier_reached"
      };
    }

    if (!isRecruitmentBuilding(building) && !isResourceMineBuilding(building)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_upgradeable"
      };
    }

    const upgradeStep = getBuildingUpgradeStep(building);
    if (!upgradeStep) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_upgrade_unavailable"
      };
    }

    if (!hasEnoughResources(view.resources, upgradeStep.cost)) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "not_enough_resources"
      };
    }

    const predictedWorld: PlayerWorldView = {
      ...view,
      resources: {
        gold: Math.max(0, view.resources.gold - upgradeStep.cost.gold),
        wood: Math.max(0, view.resources.wood - upgradeStep.cost.wood),
        ore: Math.max(0, view.resources.ore - upgradeStep.cost.ore)
      },
      map: {
        ...view.map,
        tiles: view.map.tiles.map((item) =>
          item.building?.id === action.buildingId
            ? {
                ...item,
                building: isResourceMineBuilding(item.building) && upgradeStep.effect === "income_bonus_1"
                  ? {
                      ...item.building,
                      tier: upgradeStep.toTier,
                      income: item.building.income + 1,
                      ownerPlayerId: view.playerId
                    }
                  : {
                      ...item.building!,
                      tier: upgradeStep.toTier,
                      ownerPlayerId: view.playerId
                    }
              }
            : item
        )
      }
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  const tile = findPlayerTile(view, action.position);
  if (!tile) {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "resource_tile_not_found"
    };
  }

  if (!samePosition(hero.position, action.position)) {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "hero_not_on_tile"
    };
  }

  const resource = tile.resource;
  if (!resource) {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: [],
      reason: "resource_missing"
    };
  }

  const nextTiles = view.map.tiles.map((item) =>
    samePosition(item.position, action.position)
      ? {
          ...item,
          resource: undefined
        }
      : item
  );

  const predictedWorld: PlayerWorldView = {
    ...view,
    map: {
      ...view.map,
      tiles: nextTiles
    },
    resources: {
      ...view.resources,
      [resource.kind]: view.resources[resource.kind] + resource.amount
    }
  };

  return {
    world: predictedWorld,
    movementPlan: null,
    reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
  };
}

function toHeroState(hero: HeroView): HeroState {
  return {
    id: hero.id,
    playerId: hero.playerId,
    name: hero.name,
    position: { ...hero.position },
    vision: hero.vision,
    move: { ...hero.move },
    stats: { ...hero.stats },
    progression: { ...hero.progression },
    loadout: {
      learnedSkills: hero.loadout.learnedSkills.map((skill) => ({ ...skill })),
      equipment: {
        ...hero.loadout.equipment,
        trinketIds: [...hero.loadout.equipment.trinketIds]
      },
      inventory: [...hero.loadout.inventory]
    },
    armyTemplateId: hero.armyTemplateId,
    armyCount: hero.armyCount,
    learnedSkills: hero.learnedSkills.map((skill) => ({ ...skill }))
  };
}

function planPlayerViewMovement(view: PlayerWorldView, heroId: string, destination: Vec2): MovementPlan | undefined {
  const hero = view.ownHeroes.find((item) => item.id === heroId);
  if (!hero) {
    return undefined;
  }

  if (samePosition(hero.position, destination)) {
    return {
      heroId,
      destination,
      path: [hero.position],
      travelPath: [hero.position],
      moveCost: 0,
      endsInEncounter: false,
      encounterKind: "none"
    };
  }

  const destinationTile = findPlayerTile(view, destination);
  if (!destinationTile || destinationTile.fog === "hidden" || !destinationTile.walkable) {
    return undefined;
  }

  const openSet: Vec2[] = [hero.position];
  const cameFrom = new Map<string, Vec2>();
  const gScore = new Map<string, number>([[tileKey(hero.position), 0]]);
  const fScore = new Map<string, number>([[tileKey(hero.position), distance(hero.position, destination)]]);

  while (openSet.length > 0) {
    openSet.sort((a, b) => (fScore.get(tileKey(a)) ?? Number.POSITIVE_INFINITY) - (fScore.get(tileKey(b)) ?? Number.POSITIVE_INFINITY));
    const current = openSet.shift()!;
    if (samePosition(current, destination)) {
      const path = reconstructPath(cameFrom, current);
      const encounterKind =
        destinationTile.occupant?.kind === "neutral"
          ? "neutral"
          : destinationTile.occupant?.kind === "hero"
            ? "hero"
            : "none";
      const endsInEncounter = encounterKind !== "none";
      const travelPath = endsInEncounter ? path.slice(0, -1) : path;
      const moveCost = Math.max(0, travelPath.length - 1);
      return {
        heroId,
        destination,
        path,
        travelPath,
        moveCost,
        endsInEncounter,
        encounterKind,
        ...(destinationTile.occupant?.refId ? { encounterRefId: destinationTile.occupant.refId } : {})
      };
    }

    for (const neighbor of getPlayerNeighbors(view, current)) {
      if (isBlockedForPlayerView(view, heroId, neighbor, destination)) {
        continue;
      }

      const tentative = (gScore.get(tileKey(current)) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentative >= (gScore.get(tileKey(neighbor)) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(tileKey(neighbor), current);
      gScore.set(tileKey(neighbor), tentative);
      fScore.set(tileKey(neighbor), tentative + distance(neighbor, destination));
      if (!openSet.some((item) => samePosition(item, neighbor))) {
        openSet.push(neighbor);
      }
    }
  }

  return undefined;
}

function listReachableTilesInPlayerView(view: PlayerWorldView, heroId: string): Vec2[] {
  const hero = view.ownHeroes.find((item) => item.id === heroId);
  if (!hero) {
    return [];
  }

  return view.map.tiles
    .filter((tile) => {
      const plan = planPlayerViewMovement(view, heroId, tile.position);
      return Boolean(plan && plan.moveCost <= hero.move.remaining);
    })
    .map((tile) => tile.position);
}

function samePosition(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function tileKey(position: Vec2): string {
  return `${position.x},${position.y}`;
}

function findPlayerTile(view: PlayerWorldView, position: Vec2): PlayerTileView | undefined {
  if (position.x < 0 || position.y < 0 || position.x >= view.map.width || position.y >= view.map.height) {
    return undefined;
  }

  return view.map.tiles[position.y * view.map.width + position.x];
}

function getPlayerNeighbors(view: PlayerWorldView, position: Vec2): Vec2[] {
  const candidates = [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 }
  ];

  return candidates.filter((item) => item.x >= 0 && item.y >= 0 && item.x < view.map.width && item.y < view.map.height);
}

function isBlockedForPlayerView(view: PlayerWorldView, heroId: string, position: Vec2, destination: Vec2): boolean {
  const tile = findPlayerTile(view, position);
  if (!tile || tile.fog === "hidden" || !tile.walkable) {
    return true;
  }

  const occupant = tile.occupant;
  if (occupant?.kind === "neutral" && !samePosition(position, destination)) {
    return true;
  }

  const occupiedByOtherOwnedHero = view.ownHeroes.some(
    (hero) => hero.id !== heroId && samePosition(hero.position, position) && !samePosition(position, destination)
  );
  if (occupiedByOtherOwnedHero) {
    return true;
  }

  return view.visibleHeroes.some(
    (hero) => hero.id !== heroId && samePosition(hero.position, position) && !samePosition(position, destination)
  );
}

function reconstructPath(cameFrom: Map<string, Vec2>, current: Vec2): Vec2[] {
  const path: Vec2[] = [current];
  let cursor = current;
  while (cameFrom.has(tileKey(cursor))) {
    cursor = cameFrom.get(tileKey(cursor))!;
    path.unshift(cursor);
  }
  return path;
}

function hasEnoughResources(
  resources: PlayerWorldView["resources"],
  cost: { gold: number; wood: number; ore: number }
): boolean {
  return resources.gold >= cost.gold && resources.wood >= cost.wood && resources.ore >= cost.ore;
}

function getRequiredBuildingTierForUnit(unitTemplateId: string): number {
  const template = getDefaultUnitCatalog().templates.find((item) => item.id === unitTemplateId);
  if (!template) {
    return 1;
  }

  return template.rarity === "legendary" ? 3 : template.rarity === "elite" ? 2 : 1;
}

function getBuildingUpgradeTrackId(building: PlayerTileView["building"]): "castle" | "mine" | null {
  if (building?.kind === "recruitment_post") {
    return "castle";
  }
  if (building?.kind === "resource_mine") {
    return "mine";
  }
  return null;
}

function getBuildingUpgradeStep(building: RecruitmentBuildingView | ResourceMineBuildingView) {
  const trackId = getBuildingUpgradeTrackId(building);
  if (!trackId) {
    return null;
  }

  return getBuildingUpgradeConfig()[trackId].find((step) => step.fromTier === building.tier) ?? null;
}

function isRecruitmentBuilding(building: PlayerTileView["building"]): building is RecruitmentBuildingView {
  return building?.kind === "recruitment_post";
}

function isAttributeShrineBuilding(building: PlayerTileView["building"]): building is AttributeShrineBuildingView {
  return building?.kind === "attribute_shrine";
}

function isWatchtowerBuilding(building: PlayerTileView["building"]): building is WatchtowerBuildingView {
  return building?.kind === "watchtower";
}

function isResourceMineBuilding(building: PlayerTileView["building"]): building is ResourceMineBuildingView {
  return building?.kind === "resource_mine";
}
