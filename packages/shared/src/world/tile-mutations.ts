import type {
  BattleOutcome,
  HeroState,
  MapBuildingState,
  NeutralArmyState,
  PlayerWorldPrediction,
  PlayerWorldView,
  ResourceKind,
  ResourceLedger,
  ValidationResult,
  WorldAction,
  WorldActionOutcome,
  WorldEvent,
  WorldResourceLedger,
  WorldState
} from "../models.ts";
import {
  createActionValidationFailure,
  validateAction,
  type ActionPrecheckResult
} from "../action-precheck.ts";
import { applyHeroSkillSelection, validateHeroSkillSelection } from "../hero-skills.ts";
import {
  applyHeroEquipmentChange,
  rollEquipmentDrop,
  tryAddEquipmentToInventory,
  validateHeroEquipmentChange
} from "../equipment.ts";
import { getRuntimeConfigBundleForRoom } from "../world-config.ts";
import {
  getBuildingUpgradeConfig,
  getDefaultUnitCatalog
} from "../world-config.ts";
import {
  clamp,
  clonePosition,
  distance,
  findTile,
  getNeighbors,
  isTraversableTile,
  samePosition,
  terrainMoveCost,
  tileKey
} from "./map-geometry.ts";
import {
  findPlayerTile,
  getFogAt,
  getMovementPlan,
  getNeutralMovementPath,
  heroCanFlyOverWater,
  isBlockedForHero,
  listReachableTiles,
  listReachableTilesInPlayerView,
  neutralArmyCanFlyOverWater,
  planHeroMovement,
  planPlayerViewMovement,
  popLowestScoreNode,
  reconstructPath,
  templateHasBattleSkill
} from "./pathfinding.ts";
import {
  createPlayerWorldView,
  syncWorldTiles,
  updateVisibilityByPlayer
} from "./fog-of-war.ts";
import {
  applyHeroExperience,
  applyHeroStatBonus,
  applyHeroVisionBonus,
  buildNextWorldState,
  canHeroUpgradeBuilding,
  cloneBuildingState,
  cloneHeroStatBonus,
  cloneResourceLedger,
  createEmptyResourceLedger,
  findHero,
  getBuildingUpgradeStep,
  getBuildingUpgradeTrackId,
  getPlayerResources,
  getRequiredBuildingTierForUnit,
  grantResource,
  hasEnoughResources,
  hashSeed,
  heroBattleExperience,
  isBuildingOnCurrentDayCooldown,
  makeRng,
  maybeAwardBattleEquipmentDrop,
  neutralBattleExperience,
  normalizeNeutralArmyCollection,
  refreshBuildingForNewDay,
  resetNeutralBehaviorState,
  resolveNeutralArmyTurn,
  spendResources
} from "./world-builders.ts";

export type WorldActionPrecheckResult = ActionPrecheckResult<WorldState>;

export function validateWorldAction(
  state: WorldState,
  action: WorldAction,
  requestingPlayerId?: string
): ValidationResult {
  if (action.type === "turn.endDay") {
    return { valid: true };
  }

  const hero = state.heroes.find((item) => item.id === action.heroId);
  if (!hero) {
    return { valid: false, reason: "hero_not_found" };
  }

  if (requestingPlayerId && hero.playerId !== requestingPlayerId) {
    return { valid: false, reason: "hero_not_owned_by_player" };
  }

  if (action.type === "world.surrender") {
    return { valid: true };
  }

  if (action.type === "hero.move") {
    if (requestingPlayerId) {
      const view = createPlayerWorldView(state, requestingPlayerId);
      const destinationTile = findPlayerTile(view, action.destination);
      if (!destinationTile) {
        return { valid: false, reason: "destination_not_found" };
      }

      if (!isTraversableTile(destinationTile, heroCanFlyOverWater(hero)) || destinationTile.fog === "hidden") {
        return { valid: false, reason: "destination_blocked" };
      }

      const occupiedByOtherHero = view.ownHeroes.find(
        (item) => item.id !== hero.id && samePosition(item.position, action.destination)
      );
      if (occupiedByOtherHero && occupiedByOtherHero.playerId === hero.playerId) {
        return { valid: false, reason: "destination_occupied" };
      }

      const plan = planPlayerViewMovement(view, hero.id, action.destination);
      if (!plan) {
        return { valid: false, reason: "path_not_found" };
      }

      if (plan.moveCost > hero.move.remaining) {
        return { valid: false, reason: "not_enough_move_points" };
      }

      return { valid: true };
    }

    const tile = findTile(state.map, action.destination);
    if (!tile) {
      return { valid: false, reason: "destination_not_found" };
    }

    if (!isTraversableTile(tile, heroCanFlyOverWater(hero))) {
      return { valid: false, reason: "destination_blocked" };
    }

    const occupiedByOtherHero = state.heroes.find(
      (item) => item.id !== hero.id && samePosition(item.position, action.destination)
    );
    if (occupiedByOtherHero && occupiedByOtherHero.playerId === hero.playerId) {
      return { valid: false, reason: "destination_occupied" };
    }

    const plan = planHeroMovement(state, hero.id, action.destination);
    if (!plan) {
      return { valid: false, reason: "path_not_found" };
    }

    if (plan.moveCost > hero.move.remaining) {
      return { valid: false, reason: "not_enough_move_points" };
    }

    return { valid: true };
  }

  if (action.type === "hero.learnSkill") {
    return validateHeroSkillSelection(hero, action.skillId);
  }

  if (action.type === "hero.equip" || action.type === "hero.unequip") {
    return validateHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
  }

  if (action.type === "hero.recruit") {
    const building = state.buildings[action.buildingId];
    if (!building) {
      return { valid: false, reason: "building_not_found" };
    }

    if (!samePosition(hero.position, building.position)) {
      return { valid: false, reason: "hero_not_on_building" };
    }

    if (building.kind !== "recruitment_post") {
      return { valid: false, reason: "building_not_recruitable" };
    }

    if (building.availableCount <= 0) {
      return { valid: false, reason: "building_depleted" };
    }

    if (building.tier < getRequiredBuildingTierForUnit(building.unitTemplateId)) {
      return { valid: false, reason: "building_tier_too_low" };
    }

    const resources = getPlayerResources(state.resources, hero.playerId);
    if (!hasEnoughResources(resources, building.cost)) {
      return { valid: false, reason: "not_enough_resources" };
    }

    return { valid: true };
  }

  if (action.type === "hero.visit") {
    const building = state.buildings[action.buildingId];
    if (!building) {
      return { valid: false, reason: "building_not_found" };
    }

    if (!samePosition(hero.position, building.position)) {
      return { valid: false, reason: "hero_not_on_building" };
    }

    if (building.kind !== "attribute_shrine" && building.kind !== "watchtower") {
      return { valid: false, reason: "building_not_visitable" };
    }

    if (isBuildingOnCurrentDayCooldown(state.meta.day, building.lastUsedDay)) {
      return { valid: false, reason: "building_on_cooldown" };
    }

    return { valid: true };
  }

  if (action.type === "hero.claimMine") {
    const building = state.buildings[action.buildingId];
    if (!building) {
      return { valid: false, reason: "building_not_found" };
    }

    if (!samePosition(hero.position, building.position)) {
      return { valid: false, reason: "hero_not_on_building" };
    }

    if (building.kind !== "resource_mine") {
      return { valid: false, reason: "building_not_claimable" };
    }

    if (isBuildingOnCurrentDayCooldown(state.meta.day, building.lastHarvestDay)) {
      return { valid: false, reason: "building_on_cooldown" };
    }

    return { valid: true };
  }

  if (action.type === "hero.upgradeBuilding") {
    const building = state.buildings[action.buildingId];
    if (!building) {
      return { valid: false, reason: "building_not_found" };
    }

    if (!canHeroUpgradeBuilding(hero, building)) {
      return { valid: false, reason: "hero_not_adjacent_to_building" };
    }

    const trackId = getBuildingUpgradeTrackId(building);
    if (!trackId) {
      return { valid: false, reason: "building_not_upgradeable" };
    }

    if (!building.ownerPlayerId || building.ownerPlayerId !== hero.playerId) {
      return { valid: false, reason: "building_not_owned_by_player" };
    }

    const maxTier = building.maxTier ?? (trackId === "castle" ? 3 : 2);
    if (building.tier >= maxTier) {
      return { valid: false, reason: "building_max_tier_reached" };
    }

    const upgradeStep = getBuildingUpgradeStep(building);
    if (!upgradeStep) {
      return { valid: false, reason: "building_upgrade_unavailable" };
    }

    const resources = getPlayerResources(state.resources, hero.playerId);
    if (!hasEnoughResources(resources, upgradeStep.cost)) {
      return { valid: false, reason: "not_enough_resources" };
    }

    return { valid: true };
  }

  const tile = findTile(state.map, action.position);
  if (!tile) {
    return { valid: false, reason: "resource_tile_not_found" };
  }

  if (!samePosition(hero.position, action.position)) {
    return { valid: false, reason: "hero_not_on_tile" };
  }

  if (!tile.resource) {
    return { valid: false, reason: "resource_missing" };
  }

  return { valid: true };
}

export function precheckWorldAction(
  state: WorldState,
  action: WorldAction,
  requestingPlayerId?: string
): WorldActionPrecheckResult {
  const result = validateAction(state, action, (inputState, nextAction) =>
    validateWorldAction(inputState, nextAction, requestingPlayerId)
  );
  const rejection = createActionValidationFailure("world", action, result.validation);
  return {
    ...result,
    ...(rejection ? { rejection } : {})
  };
}

export function resolveWorldAction(state: WorldState, action: WorldAction): WorldActionOutcome {
  if (action.type === "turn.endDay") {
    const heroes = state.heroes.map((hero) => ({
      ...hero,
      move: { ...hero.move, remaining: hero.move.total }
    }));
    const buildings = Object.fromEntries(
      Object.entries(state.buildings).map(([buildingId, building]) => [
        buildingId,
        refreshBuildingForNewDay(building)
      ])
    );
    let neutralArmies = normalizeNeutralArmyCollection(state.neutralArmies);
    neutralArmies = Object.fromEntries(
      Object.entries(neutralArmies).map(([neutralArmyId, army]) => {
        const nextBehavior = resetNeutralBehaviorState(army.behavior);
        return [
          neutralArmyId,
          {
            ...army,
            ...(nextBehavior ? { behavior: nextBehavior } : {})
          }
        ];
      })
    );
    let workingState = buildNextWorldState(
      {
        ...state,
        meta: {
          ...state.meta,
          day: state.meta.day + 1
        },
        resources: state.resources
      },
      heroes,
      neutralArmies,
      buildings
    );
    const lockedHeroIds = new Set<string>();
    const neutralEvents: WorldEvent[] = [];
    for (const neutralArmyId of Object.keys(neutralArmies).sort()) {
      const neutralArmy = neutralArmies[neutralArmyId];
      if (!neutralArmy) {
        continue;
      }

      const resolution = resolveNeutralArmyTurn(workingState, neutralArmy, lockedHeroIds);
      if (resolution.lockedHeroId) {
        lockedHeroIds.add(resolution.lockedHeroId);
      }
      if (resolution.army) {
        neutralArmies = {
          ...neutralArmies,
          [neutralArmyId]: resolution.army
        };
        workingState = buildNextWorldState(workingState, heroes, neutralArmies, buildings);
      }
      neutralEvents.push(...resolution.events);
    }
    const nextState = buildNextWorldState(
      {
        ...state,
        meta: {
          ...state.meta,
          day: state.meta.day + 1
        },
        ...(state.turnDeadlineAt ? { turnDeadlineAt: state.turnDeadlineAt } : {}),
        ...(state.afkStrikes ? { afkStrikes: state.afkStrikes } : {}),
        resources: state.resources
      },
      heroes,
      neutralArmies,
      buildings
    );
    return {
      state: nextState,
      events: [{ type: "turn.advanced", day: nextState.meta.day }, ...neutralEvents]
    };
  }

  if (action.type === "hero.move") {
    const plan = planHeroMovement(state, action.heroId, action.destination);
    const hero = state.heroes.find((item) => item.id === action.heroId);
    if (!plan || !hero) {
      return { state, events: [] };
    }

    const nextPosition = plan.travelPath[plan.travelPath.length - 1] ?? hero.position;
    const heroes = state.heroes.map((item) =>
      item.id === action.heroId
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
    const nextState = buildNextWorldState(state, heroes, state.neutralArmies, state.buildings);

    if (plan.endsInEncounter) {
      const encounterRefId = plan.encounterRefId;
      const encounterHero =
        plan.encounterKind === "hero" && encounterRefId
          ? state.heroes.find((item) => item.id === encounterRefId)
          : undefined;
      return {
        state: nextState,
        movementPlan: plan,
        events: encounterRefId
          ? [
              {
                type: "battle.started",
                heroId: action.heroId,
                attackerPlayerId: hero.playerId,
                encounterKind: plan.encounterKind === "hero" ? "hero" : "neutral",
                ...(plan.encounterKind === "hero"
                  ? {
                      defenderHeroId: encounterRefId,
                      ...(encounterHero?.playerId ? { defenderPlayerId: encounterHero.playerId } : {}),
                      battleId: `battle-${action.heroId}-vs-${encounterRefId}`
                    }
                  : { neutralArmyId: encounterRefId, battleId: `battle-${encounterRefId}` }),
                path: plan.travelPath,
                moveCost: plan.moveCost
              }
            ]
          : []
      };
    }

    return {
      state: nextState,
      movementPlan: plan,
      events: [
        {
          type: "hero.moved",
          heroId: action.heroId,
          path: plan.travelPath,
          moveCost: plan.moveCost
        }
      ]
    };
  }

  if (action.type === "hero.learnSkill") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    if (!hero) {
      return { state, events: [] };
    }

    const validation = validateHeroSkillSelection(hero, action.skillId);
    if (!validation.valid) {
      return { state, events: [] };
    }

    const learned = applyHeroSkillSelection(hero, action.skillId);
    const nextState = buildNextWorldState(
      state,
      state.heroes.map((item) => (item.id === hero.id ? learned.hero : item)),
      state.neutralArmies,
      state.buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.skillLearned",
          heroId: hero.id,
          skillId: learned.skill.id,
          branchId: learned.branch.id,
          skillName: learned.skill.name,
          branchName: learned.branch.name,
          newRank: learned.newRank,
          spentPoint: 1,
          remainingSkillPoints: learned.hero.progression.skillPoints,
          newlyGrantedBattleSkillIds: learned.newlyGrantedBattleSkillIds
        }
      ]
    };
  }

  if (action.type === "hero.equip" || action.type === "hero.unequip") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    if (!hero) {
      return { state, events: [] };
    }

    const validation = validateHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    if (!validation.valid) {
      return { state, events: [] };
    }

    const changed = applyHeroEquipmentChange(
      hero,
      action.slot,
      action.type === "hero.equip" ? action.equipmentId : undefined
    );
    const nextState = buildNextWorldState(
      state,
      state.heroes.map((item) => (item.id === hero.id ? changed.hero : item)),
      state.neutralArmies,
      state.buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.equipmentChanged",
          heroId: hero.id,
          slot: action.slot,
          ...(changed.equippedItemId ? { equippedItemId: changed.equippedItemId } : {}),
          ...(changed.unequippedItemId ? { unequippedItemId: changed.unequippedItemId } : {})
        }
      ]
    };
  }

  if (action.type === "hero.recruit") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    const building = state.buildings[action.buildingId];
    if (!hero || !building || building.kind !== "recruitment_post") {
      return { state, events: [] };
    }

    const recruitedCount = building.availableCount;
    const heroes = state.heroes.map((item) =>
      item.id === hero.id
        ? {
            ...item,
            armyCount: item.armyCount + recruitedCount
          }
        : item
    );
    const buildings = {
      ...state.buildings,
      [building.id]: {
        ...building,
        position: { ...building.position },
        cost: cloneResourceLedger(building.cost),
        availableCount: 0,
        lastUsedDay: state.meta.day
      }
    };
    const nextState = buildNextWorldState(
      {
        ...state,
        resources: spendResources(state.resources, hero.playerId, building.cost)
      },
      heroes,
      state.neutralArmies,
      buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.recruited",
          heroId: hero.id,
          buildingId: building.id,
          buildingKind: building.kind,
          unitTemplateId: building.unitTemplateId,
          count: recruitedCount,
          cost: cloneResourceLedger(building.cost)
        }
      ]
    };
  }

  if (action.type === "hero.visit") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    const building = state.buildings[action.buildingId];
    if (!hero || !building || (building.kind !== "attribute_shrine" && building.kind !== "watchtower")) {
      return { state, events: [] };
    }

    const heroes = state.heroes.map((item) =>
      item.id === hero.id
        ? building.kind === "attribute_shrine"
          ? applyHeroStatBonus(item, building.bonus)
          : applyHeroVisionBonus(item, building.visionBonus)
        : item
    );
    const buildings = {
      ...state.buildings,
      [building.id]: {
        ...building,
        position: { ...building.position },
        ...(building.kind === "attribute_shrine" ? { bonus: cloneHeroStatBonus(building.bonus) } : {}),
        lastUsedDay: state.meta.day
      }
    };
    const nextState = buildNextWorldState(state, heroes, state.neutralArmies, buildings);

    return {
      state: nextState,
      events: [
        building.kind === "attribute_shrine"
          ? {
              type: "hero.visited",
              heroId: hero.id,
              buildingId: building.id,
              buildingKind: building.kind,
              bonus: cloneHeroStatBonus(building.bonus)
            }
          : {
              type: "hero.visited",
              heroId: hero.id,
              buildingId: building.id,
              buildingKind: building.kind,
              visionBonus: building.visionBonus
            }
      ]
    };
  }

  if (action.type === "hero.claimMine") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    const building = state.buildings[action.buildingId];
    if (!hero || !building || building.kind !== "resource_mine") {
      return { state, events: [] };
    }

    const buildings = {
      ...state.buildings,
      [building.id]: {
        ...building,
        position: { ...building.position },
        resourceKind: building.resourceKind,
        income: building.income,
        lastHarvestDay: state.meta.day,
        ownerPlayerId: hero.playerId
      }
    };
    const harvestedResource = {
      kind: building.resourceKind,
      amount: building.income
    } as const;
    const nextState = buildNextWorldState(
      {
        ...state,
        resources: grantResource(state.resources, hero.playerId, harvestedResource)
      },
      state.heroes,
      state.neutralArmies,
      buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.claimedMine",
          heroId: hero.id,
          buildingId: building.id,
          buildingKind: building.kind,
          resourceKind: building.resourceKind,
          income: building.income,
          ownerPlayerId: hero.playerId
        }
      ]
    };
  }

  if (action.type === "hero.upgradeBuilding") {
    const hero = state.heroes.find((item) => item.id === action.heroId);
    const building = state.buildings[action.buildingId];
    const upgradeStep = building ? getBuildingUpgradeStep(building) : null;
    if (!hero || !building || !upgradeStep || (building.kind !== "recruitment_post" && building.kind !== "resource_mine")) {
      return { state, events: [] };
    }

    const nextBuilding =
      building.kind === "resource_mine" && upgradeStep.effect === "income_bonus_1"
        ? {
            ...building,
            position: { ...building.position },
            tier: upgradeStep.toTier,
            income: building.income + 1,
            ownerPlayerId: hero.playerId
          }
        : building.kind === "recruitment_post"
          ? {
              ...building,
              position: { ...building.position },
              cost: cloneResourceLedger(building.cost),
              tier: upgradeStep.toTier,
              ownerPlayerId: hero.playerId
            }
          : {
              ...building,
              position: { ...building.position },
              tier: upgradeStep.toTier,
              ownerPlayerId: hero.playerId
            };
    const buildings = {
      ...state.buildings,
      [building.id]: nextBuilding
    };
    const nextState = buildNextWorldState(
      {
        ...state,
        resources: spendResources(state.resources, hero.playerId, upgradeStep.cost)
      },
      state.heroes,
      state.neutralArmies,
      buildings
    );

    return {
      state: nextState,
      events: [
        {
          type: "hero.upgradedBuilding",
          heroId: hero.id,
          buildingId: building.id,
          buildingKind: building.kind,
          fromTier: upgradeStep.fromTier,
          toTier: upgradeStep.toTier,
          cost: cloneResourceLedger(upgradeStep.cost),
          effect: upgradeStep.effect
        }
      ]
    };
  }

  if (action.type !== "hero.collect") {
    return { state, events: [] };
  }

  const hero = state.heroes.find((item) => item.id === action.heroId);
  const tile = findTile(state.map, action.position);
  if (!hero || !tile?.resource) {
    return { state, events: [] };
  }

  const resource = tile.resource;
  const nextTiles = state.map.tiles.map((item) =>
    samePosition(item.position, action.position)
      ? {
          ...item,
          resource: undefined
        }
      : item
  );
  const nextState = {
    ...state,
    map: { ...state.map, tiles: nextTiles },
    resources: grantResource(state.resources, hero.playerId, resource)
  };

  return {
    state: nextState,
    events: [
      {
        type: "hero.collected",
        heroId: action.heroId,
        resource
      }
    ]
  };
}

export function applyWorldAction(state: WorldState, action: WorldAction): WorldState {
  const { state: nextState, validation } = precheckWorldAction(state, action);
  if (!validation.valid) {
    return nextState;
  }

  return resolveWorldAction(nextState, action).state;
}

