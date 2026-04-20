import type {
  PlayerTileView,
  PlayerWorldPrediction,
  PlayerWorldView,
  WorldAction,
  WorldState
} from "../models.ts";
import { applyHeroSkillSelection, validateHeroSkillSelection } from "../hero-skills.ts";
import {
  applyHeroEquipmentChange,
  validateHeroEquipmentChange
} from "../equipment.ts";
import {
  getBuildingUpgradeConfig,
  getDefaultUnitCatalog
} from "../world-config.ts";
import {
  clamp,
  distance,
  isTraversableTile,
  samePosition,
  terrainMoveCost
} from "./map-geometry.ts";
import {
  findPlayerTile,
  heroCanFlyOverWater,
  listReachableTilesInPlayerView,
  planPlayerViewMovement
} from "./pathfinding.ts";
import {
  applyHeroStatBonus,
  applyHeroVisionBonus,
  canHeroUpgradeBuilding,
  cloneBuildingState,
  cloneHeroStatBonus,
  cloneResourceLedger,
  createEmptyResourceLedger,
  getBuildingUpgradeStep,
  getBuildingUpgradeTrackId,
  getPlayerResources,
  getRequiredBuildingTierForUnit,
  grantResource,
  hasEnoughResources,
  isBuildingOnCurrentDayCooldown,
  refreshBuildingForNewDay,
  spendResources
} from "./world-builders.ts";

export function predictPlayerWorldAction(view: PlayerWorldView, action: WorldAction): PlayerWorldPrediction {
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

  if (action.type === "hero.learnSkill") {
    const validation = validateHeroSkillSelection(hero, action.skillId);
    if (!validation.valid) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        ...(validation.reason ? { reason: validation.reason } : {})
      };
    }

    const learned = applyHeroSkillSelection(hero, action.skillId);
    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: view.ownHeroes.map((item) => (item.id === hero.id ? learned.hero : item))
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
    };
  }

  if (action.type === "hero.equip" || action.type === "hero.unequip") {
    const validation = validateHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    if (!validation.valid) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        ...(validation.reason ? { reason: validation.reason } : {})
      };
    }

    const changed = applyHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    const predictedWorld: PlayerWorldView = {
      ...view,
      ownHeroes: view.ownHeroes.map((item) => (item.id === hero.id ? changed.hero : item))
    };

    return {
      world: predictedWorld,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
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

    if (!isTraversableTile(destinationTile, heroCanFlyOverWater(hero)) || destinationTile.fog === "hidden") {
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

      if (
        samePosition(tile.position, nextPosition) &&
        !plan.endsInEncounter &&
        tile.fog === "visible"
      ) {
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
    if (!tile?.building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (tile.building.id !== action.buildingId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_on_building"
      };
    }

    if (tile.building.kind !== "recruitment_post") {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_recruitable"
      };
    }
    const building = tile.building;

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
        tiles: view.map.tiles.map((item) =>
          samePosition(item.position, hero.position) && item.building?.kind === "recruitment_post"
            ? {
                ...item,
                building: {
                  ...item.building,
                  cost: cloneResourceLedger(item.building.cost),
                  availableCount: 0,
                  lastUsedDay: view.meta.day
                }
              }
            : item
        )
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
    if (!tile?.building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (tile.building.id !== action.buildingId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_on_building"
      };
    }

    if (tile.building.kind !== "attribute_shrine" && tile.building.kind !== "watchtower") {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_visitable"
      };
    }
    const building = tile.building;

    if (isBuildingOnCurrentDayCooldown(view.meta.day, building.lastUsedDay)) {
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

        return building.kind === "attribute_shrine"
          ? applyHeroStatBonus(item, building.bonus)
          : applyHeroVisionBonus(item, building.visionBonus);
      }),
      map: {
        ...view.map,
        tiles: view.map.tiles.map((item) =>
          samePosition(item.position, hero.position) &&
          (item.building?.kind === "attribute_shrine" || item.building?.kind === "watchtower")
            ? {
                ...item,
                building: {
                  ...item.building,
                  lastUsedDay: view.meta.day
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

  if (action.type === "hero.claimMine") {
    const tile = findPlayerTile(view, hero.position);
    if (!tile?.building) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_found"
      };
    }

    if (tile.building.id !== action.buildingId) {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "hero_not_on_building"
      };
    }

    if (tile.building.kind !== "resource_mine") {
      return {
        world: view,
        movementPlan: null,
        reachableTiles: [],
        reason: "building_not_claimable"
      };
    }
    const building = tile.building;

    if (isBuildingOnCurrentDayCooldown(view.meta.day, building.lastHarvestDay)) {
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
        tiles: view.map.tiles.map((item) =>
          samePosition(item.position, hero.position) && item.building?.kind === "resource_mine"
            ? {
                ...item,
                building: {
                  ...item.building,
                  lastHarvestDay: view.meta.day,
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
                building: item.building.kind === "resource_mine" && upgradeStep.effect === "income_bonus_1"
                  ? {
                      ...item.building,
                      tier: upgradeStep.toTier,
                      income: item.building.income + 1,
                      ownerPlayerId: view.playerId
                    }
                  : {
                      ...item.building,
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

  if (action.type !== "hero.collect") {
    return {
      world: view,
      movementPlan: null,
      reachableTiles: listReachableTilesInPlayerView(view, hero.id),
      reason: "prediction_not_supported"
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

  if (!tile.resource) {
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
      [tile.resource.kind]: view.resources[tile.resource.kind] + tile.resource.amount
    }
  };

  return {
    world: predictedWorld,
    movementPlan: null,
    reachableTiles: listReachableTilesInPlayerView(predictedWorld, hero.id)
  };
}

