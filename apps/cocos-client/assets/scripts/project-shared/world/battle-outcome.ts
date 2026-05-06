import type {
  BattleOutcome,
  WorldActionOutcome,
  WorldState
} from "../models.ts";
import {
  findTile,
  getNeighbors,
  samePosition,
  tileKey
} from "./map-geometry.ts";
import {
  syncWorldTiles,
  updateVisibilityByPlayer
} from "./fog-of-war.ts";
import {
  applyHeroExperience,
  buildNextWorldState,
  cloneBuildingState,
  findHero,
  grantResource,
  hashSeed,
  heroBattleExperience,
  makeRng,
  maybeAwardBattleEquipmentDrop,
  neutralBattleExperience,
  resolveNeutralArmyTurn
} from "./world-builders.ts";

export function applyBattleOutcomeToWorld(
  state: WorldState,
  battleId: string,
  heroId: string,
  outcome: BattleOutcome
): WorldActionOutcome {
  if (outcome.status === "in_progress") {
    return {
      state,
      events: []
    };
  }

  const attackerHero = state.heroes.find((hero) => hero.id === heroId);
  const pvpMatch = battleId.match(/^battle-(.+)-vs-(.+)$/);
  if (pvpMatch) {
    const attackerId = pvpMatch[1]!;
    const defenderId = pvpMatch[2]!;
    const defenderHero = state.heroes.find((hero) => hero.id === defenderId);
    if (!attackerHero || !defenderHero) {
      return { state, events: [] };
    }

    if (outcome.status === "defender_victory") {
      const awardedDefender = applyHeroExperience(defenderHero, heroBattleExperience(attackerHero), "hero");
      const droppedEquipment = maybeAwardBattleEquipmentDrop(awardedDefender.hero, state, battleId, "hero");
      const heroes = state.heroes.map((hero) =>
        hero.id === attackerId
          ? {
              ...hero,
              stats: { ...hero.stats, hp: Math.max(1, Math.floor(hero.stats.hp * 0.5)) },
              move: { ...hero.move, remaining: 0 }
            }
          : hero.id === defenderId
            ? droppedEquipment?.hero ?? awardedDefender.hero
          : hero
      );
      return {
        state: buildNextWorldState(state, heroes, state.neutralArmies, state.buildings),
        events: [
          {
            type: "battle.resolved",
            heroId,
            attackerPlayerId: attackerHero.playerId,
	            battleId,
	            ...(defenderId ? { defenderHeroId: defenderId, defenderPlayerId: defenderHero.playerId } : {}),
	            result: "defender_victory",
	            battleKind: "hero"
	          },
          {
            type: "hero.progressed",
            heroId: defenderId,
            battleId,
            battleKind: "hero",
            experienceGained: awardedDefender.experienceGained,
            totalExperience: awardedDefender.hero.progression.experience,
            level: awardedDefender.hero.progression.level,
            levelsGained: awardedDefender.levelsGained,
            skillPointsAwarded: awardedDefender.skillPointsAwarded,
            availableSkillPoints: awardedDefender.hero.progression.skillPoints
          },
          ...(droppedEquipment ? [droppedEquipment.event] : [])
        ]
      };
    }

    const occupied = new Set(
      state.heroes
        .filter((hero) => hero.id !== attackerId && hero.id !== defenderId)
        .map((hero) => tileKey(hero.position))
    );
    const retreatCandidates = getNeighbors(state.map, defenderHero.position).concat(defenderHero.position);
    const retreat = retreatCandidates.find((pos) => {
      const tile = findTile(state.map, pos);
      return tile?.walkable && !occupied.has(tileKey(pos)) && !samePosition(pos, defenderHero.position);
    }) ?? defenderHero.position;

    const awardedAttacker = applyHeroExperience(attackerHero, heroBattleExperience(defenderHero), "hero");
    const droppedEquipment = maybeAwardBattleEquipmentDrop(awardedAttacker.hero, state, battleId, "hero");
    const heroes = state.heroes.map((hero) => {
      if (hero.id === attackerId) {
        return {
          ...(droppedEquipment?.hero ?? awardedAttacker.hero),
          position: defenderHero.position
        };
      }

      if (hero.id === defenderId) {
        return {
          ...hero,
          position: retreat,
          stats: { ...hero.stats, hp: Math.max(1, Math.floor(hero.stats.hp * 0.5)) },
          move: { ...hero.move, remaining: 0 }
        };
      }

      return hero;
    });

    return {
      state: buildNextWorldState(state, heroes, state.neutralArmies, state.buildings),
      events: [
          {
            type: "battle.resolved",
            heroId,
            attackerPlayerId: attackerHero.playerId,
	            battleId,
	            ...(defenderId ? { defenderHeroId: defenderId, defenderPlayerId: defenderHero.playerId } : {}),
	            result: "attacker_victory",
	            battleKind: "hero"
	          },
          {
            type: "hero.progressed",
            heroId: attackerId,
            battleId,
            battleKind: "hero",
            experienceGained: awardedAttacker.experienceGained,
            totalExperience: awardedAttacker.hero.progression.experience,
            level: awardedAttacker.hero.progression.level,
            levelsGained: awardedAttacker.levelsGained,
            skillPointsAwarded: awardedAttacker.skillPointsAwarded,
            availableSkillPoints: awardedAttacker.hero.progression.skillPoints
          },
          ...(droppedEquipment ? [droppedEquipment.event] : [])
        ]
      };
  }

  const neutralArmyId = battleId.replace(/^battle-/, "");
  const neutralArmy = state.neutralArmies[neutralArmyId];
  if (!neutralArmy || !attackerHero) {
    return {
      state,
      events: []
    };
  }

  if (outcome.status === "defender_victory") {
    const heroes = state.heroes.map((hero) =>
      hero.id === heroId
        ? {
            ...hero,
            stats: {
              ...hero.stats,
              hp: Math.max(1, Math.floor(hero.stats.hp * 0.5))
            },
            move: {
              ...hero.move,
              remaining: 0
            }
          }
        : hero
    );
    return {
      state: buildNextWorldState(state, heroes, state.neutralArmies, state.buildings),
      events: [
        {
          type: "battle.resolved",
	          heroId,
	          attackerPlayerId: attackerHero.playerId,
	          battleId,
	          result: "defender_victory",
	          battleKind: "neutral"
	        }
      ]
    };
  }

  const awardedAttacker = applyHeroExperience(attackerHero, neutralBattleExperience(neutralArmy), "neutral");
  const droppedEquipment = maybeAwardBattleEquipmentDrop(awardedAttacker.hero, state, battleId, "neutral");
  const nextNeutralArmies = { ...state.neutralArmies };
  delete nextNeutralArmies[neutralArmyId];
  const heroes = state.heroes.map((hero) =>
    hero.id === heroId
      ? {
          ...(droppedEquipment?.hero ?? awardedAttacker.hero),
          position: neutralArmy.position
        }
      : hero
  );
  const nextStateBase: WorldState = {
    ...state,
    resources: neutralArmy.reward
      ? grantResource(state.resources, attackerHero.playerId, neutralArmy.reward)
      : state.resources
  };
  const nextState = buildNextWorldState(nextStateBase, heroes, nextNeutralArmies, state.buildings);

  return {
    state: nextState,
    events: [
      {
        type: "battle.resolved",
	        heroId,
	        attackerPlayerId: attackerHero.playerId,
	        battleId,
	        result: "attacker_victory",
	        battleKind: "neutral"
	      },
      {
        type: "hero.progressed" as const,
        heroId,
        battleId,
        battleKind: "neutral" as const,
        experienceGained: awardedAttacker.experienceGained,
        totalExperience: awardedAttacker.hero.progression.experience,
        level: awardedAttacker.hero.progression.level,
        levelsGained: awardedAttacker.levelsGained,
        skillPointsAwarded: awardedAttacker.skillPointsAwarded,
        availableSkillPoints: awardedAttacker.hero.progression.skillPoints
      },
      ...(neutralArmy.reward
        ? [
            {
              type: "hero.collected" as const,
              heroId,
              resource: neutralArmy.reward
            }
          ]
        : []),
      ...(droppedEquipment ? [droppedEquipment.event] : [])
    ]
  };
}
