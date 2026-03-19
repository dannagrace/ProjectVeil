import {
  applyBattleAction,
  applyBattleOutcomeToWorld,
  createHeroBattleState,
  createNeutralBattleState,
  createPlayerWorldView,
  createInitialWorldState,
  getBattleOutcome,
  resolveWorldAction,
  validateWorldAction,
  validateBattleAction,
  type BattleState,
  type MovementPlan,
  type PlayerWorldView,
  type BattleAction,
  type WorldAction,
  type WorldEvent,
  type WorldState
} from "../../../packages/shared/src/index";

export interface RoomSnapshot {
  roomId: string;
  playerId: string;
  state: PlayerWorldView;
}

export interface DispatchResult {
  ok: boolean;
  reason?: string;
  snapshot: RoomSnapshot;
  events?: WorldEvent[];
  movementPlan?: MovementPlan;
  battle?: BattleState;
}

export interface BattleDispatchResult {
  ok: boolean;
  reason?: string;
  battle?: BattleState;
  snapshot: RoomSnapshot;
  events?: WorldEvent[];
}

export class AuthoritativeWorldRoom {
  private state: WorldState;
  private activeBattle: BattleState | null = null;

  constructor(roomId: string, seed = 1001) {
    this.state = createInitialWorldState(seed, roomId);
  }

  getInternalState(): WorldState {
    return this.state;
  }

  getActiveBattle(): BattleState | null {
    return this.activeBattle;
  }

  getSnapshot(playerId: string): RoomSnapshot {
    return {
      roomId: this.state.meta.roomId,
      playerId,
      state: createPlayerWorldView(this.state, playerId)
    };
  }

  dispatch(playerId: string, action: WorldAction): DispatchResult {
    if ("heroId" in action) {
      const hero = this.state.heroes.find((item) => item.id === action.heroId);
      if (!hero || hero.playerId !== playerId) {
        return {
          ok: false,
          reason: "hero_not_owned_by_player",
          snapshot: this.getSnapshot(playerId)
        };
      }
    }

    const validation = validateWorldAction(this.state, action);
    if (!validation.valid) {
      return {
        ok: false,
        ...(validation.reason ? { reason: validation.reason } : {}),
        snapshot: this.getSnapshot(playerId)
      };
    }

    const outcome = resolveWorldAction(this.state, action);
    this.state = outcome.state;

    const battleEvent = outcome.events.find((event) => event.type === "battle.started");
    if (battleEvent?.type === "battle.started") {
      const hero = this.state.heroes.find((item) => item.id === battleEvent.heroId);
      if (hero && battleEvent.encounterKind === "neutral" && battleEvent.neutralArmyId) {
        const neutralArmy = this.state.neutralArmies[battleEvent.neutralArmyId];
        if (neutralArmy) {
          this.activeBattle = createNeutralBattleState(hero, neutralArmy, this.state.meta.seed + this.state.meta.day);
        }
      }

      if (hero && battleEvent.encounterKind === "hero" && battleEvent.defenderHeroId) {
        const defenderHero = this.state.heroes.find((item) => item.id === battleEvent.defenderHeroId);
        if (defenderHero) {
          this.activeBattle = createHeroBattleState(hero, defenderHero, this.state.meta.seed + this.state.meta.day);
        }
      }
    } else {
      this.activeBattle = null;
    }

    return {
      ok: true,
      snapshot: this.getSnapshot(playerId),
      ...(outcome.events.length > 0 ? { events: outcome.events } : {}),
      ...(outcome.movementPlan ? { movementPlan: outcome.movementPlan } : {}),
      ...(this.activeBattle ? { battle: this.activeBattle } : {})
    };
  }

  dispatchBattle(playerId: string, action: BattleAction): BattleDispatchResult {
    if (!this.activeBattle) {
      return {
        ok: false,
        reason: "battle_not_active",
        snapshot: this.getSnapshot(playerId)
      };
    }

    const worldHeroId = this.activeBattle.worldHeroId;
    const hero = worldHeroId ? this.state.heroes.find((item) => item.id === worldHeroId) : undefined;
    if (!hero || hero.playerId !== playerId) {
      return {
        ok: false,
        reason: "battle_not_owned_by_player",
        snapshot: this.getSnapshot(playerId)
      };
    }

    const validation = validateBattleAction(this.activeBattle, action);
    if (!validation.valid) {
      return {
        ok: false,
        ...(validation.reason ? { reason: validation.reason } : {}),
        battle: this.activeBattle,
        snapshot: this.getSnapshot(playerId)
      };
    }

    this.activeBattle = applyBattleAction(this.activeBattle, action);
    const outcome = getBattleOutcome(this.activeBattle);
    if (outcome.status !== "in_progress" && this.activeBattle.worldHeroId) {
      const worldOutcome = applyBattleOutcomeToWorld(
        this.state,
        this.activeBattle.id,
        this.activeBattle.worldHeroId,
        outcome
      );
      this.state = worldOutcome.state;
      this.activeBattle = null;
      return {
        ok: true,
        snapshot: this.getSnapshot(playerId),
        ...(worldOutcome.events.length > 0 ? { events: worldOutcome.events } : {})
      };
    }

    return {
      ok: true,
      battle: this.activeBattle,
      snapshot: this.getSnapshot(playerId)
    };
  }
}

export function createRoom(roomId: string, seed?: number): AuthoritativeWorldRoom {
  return new AuthoritativeWorldRoom(roomId, seed);
}
