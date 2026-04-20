import { type ActionValidationFailure, applyBattleAction, createActionValidationFailure, createHeroBattleState, createNeutralBattleState, getBattleOutcome, pickAutomatedBattleAction, precheckBattleAction } from "@veil/shared/battle";
import { type BattleAction, type BattleOutcome, type BattleState, type MovementPlan, normalizeHeroState, type PlayerWorldView, type WorldAction, type WorldEvent, type WorldState } from "@veil/shared/models";
import { applyBattleOutcomeToWorld, createInitialWorldState, createPlayerWorldView, filterWorldEventsForPlayer, precheckWorldAction, resolveWorldAction } from "@veil/shared/world";
import {
  appendBattleReplayStep,
  createBattleReplayCapture,
  finalizeBattleReplayCapture,
  type CompletedBattleReplayCapture,
  type OngoingBattleReplayCapture
} from "@server/domain/battle/battle-replays";

export interface RoomSnapshot {
  roomId: string;
  playerId: string;
  state: PlayerWorldView;
}

export interface DispatchResult {
  ok: boolean;
  reason?: string;
  rejection?: ActionValidationFailure;
  snapshot: RoomSnapshot;
  events?: WorldEvent[];
  movementPlan?: MovementPlan;
  battle?: BattleState;
}

export interface BattleDispatchResult {
  ok: boolean;
  reason?: string;
  rejection?: ActionValidationFailure;
  battle?: BattleState;
  snapshot: RoomSnapshot;
  events?: WorldEvent[];
}

export interface RoomPersistenceSnapshot {
  state: WorldState;
  battles: BattleState[];
}

export interface AuthoritativeRoomErrorContext {
  roomId: string;
  playerId: string | null;
  battleId: string | null;
  heroId: string | null;
  day: number;
}

interface AuthoritativeRoomTelemetry {
  recordBattleDuration(durationSeconds: number): void;
  recordBattleResolved(input: {
    roomId: string;
    battleId: string;
    outcome: "completed" | "aborted";
    reason?: string;
  }): void;
  recordActionValidationFailure(scope: "world" | "battle", reason: string): void;
}

const defaultAuthoritativeRoomTelemetry: AuthoritativeRoomTelemetry = {
  recordBattleDuration: () => {},
  recordBattleResolved: () => {},
  recordActionValidationFailure: () => {}
};

let authoritativeRoomTelemetry: AuthoritativeRoomTelemetry = defaultAuthoritativeRoomTelemetry;

export function configureAuthoritativeRoomTelemetry(overrides: Partial<AuthoritativeRoomTelemetry>): void {
  authoritativeRoomTelemetry = {
    ...defaultAuthoritativeRoomTelemetry,
    ...overrides
  };
}

function hashBattleSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class AuthoritativeWorldRoom {
  private state: WorldState;
  private readonly battles = new Map<string, BattleState>();
  private readonly battleStartedAtByBattleId = new Map<string, number>();
  private readonly battleIdByHeroId = new Map<string, string>();
  private readonly battleReplayByBattleId = new Map<string, OngoingBattleReplayCapture>();
  private readonly completedBattleReplays: CompletedBattleReplayCapture[] = [];

  constructor(roomId: string, seed = 1001, snapshot?: RoomPersistenceSnapshot) {
    if (snapshot) {
      this.state = {
        ...snapshot.state,
        buildings: snapshot.state.buildings ?? {},
        map: {
          ...snapshot.state.map,
          tiles: snapshot.state.map.tiles.map((tile) => ({
            ...tile,
            building: tile.building
          }))
        },
        heroes: snapshot.state.heroes.map((hero) => normalizeHeroState(hero)),
        meta: {
          ...snapshot.state.meta,
          roomId
        }
      };

      for (const battle of snapshot.battles) {
        this.setBattle(battle);
      }
      return;
    }

    this.state = createInitialWorldState(seed, roomId);
  }

  getInternalState(): WorldState {
    return this.state;
  }

  getActiveBattles(): BattleState[] {
    return Array.from(this.battles.values());
  }

  consumeCompletedBattleReplays(): CompletedBattleReplayCapture[] {
    const completed = this.completedBattleReplays.map((replay) => structuredClone(replay));
    this.completedBattleReplays.length = 0;
    return completed;
  }

  private getBattleById(battleId: string): BattleState | undefined {
    return this.battles.get(battleId);
  }

  private getBattleIdForHero(heroId: string): string | undefined {
    return this.battleIdByHeroId.get(heroId);
  }

  getBattleForPlayer(playerId: string): BattleState | null {
    const ownedHeroes = this.state.heroes.filter((hero) => hero.playerId === playerId);
    for (const hero of ownedHeroes) {
      const battleId = this.getBattleIdForHero(hero.id);
      if (!battleId) {
        continue;
      }

      const battle = this.getBattleById(battleId);
      if (battle) {
        return battle;
      }
    }

    return null;
  }

  private getControllingCamp(playerId: string, battle: BattleState): "attacker" | "defender" | null {
    const attackerHero =
      battle.worldHeroId ? this.state.heroes.find((hero) => hero.id === battle.worldHeroId) : undefined;
    if (attackerHero?.playerId === playerId) {
      return "attacker";
    }

    const defenderHero =
      battle.defenderHeroId ? this.state.heroes.find((hero) => hero.id === battle.defenderHeroId) : undefined;
    if (defenderHero?.playerId === playerId) {
      return "defender";
    }

    return null;
  }

  private setBattle(battle: BattleState): void {
    this.battles.set(battle.id, battle);
    if (!this.battleStartedAtByBattleId.has(battle.id)) {
      this.battleStartedAtByBattleId.set(battle.id, Date.now());
    }
    if (battle.worldHeroId) {
      this.battleIdByHeroId.set(battle.worldHeroId, battle.id);
    }
    if (battle.defenderHeroId) {
      this.battleIdByHeroId.set(battle.defenderHeroId, battle.id);
    }
  }

  private clearBattle(battle: BattleState): void {
    this.battles.delete(battle.id);
    this.battleStartedAtByBattleId.delete(battle.id);
    if (battle.worldHeroId) {
      this.battleIdByHeroId.delete(battle.worldHeroId);
    }
    if (battle.defenderHeroId) {
      this.battleIdByHeroId.delete(battle.defenderHeroId);
    }
  }

  private trackStartedBattle(battle: BattleState): void {
    this.setBattle(battle);
    if (!this.battleReplayByBattleId.has(battle.id)) {
      const attackerHero =
        battle.worldHeroId ? this.state.heroes.find((hero) => hero.id === battle.worldHeroId) : undefined;
      if (!attackerHero) {
        return;
      }

      const defenderHero =
        battle.defenderHeroId ? this.state.heroes.find((hero) => hero.id === battle.defenderHeroId) : undefined;
      this.battleReplayByBattleId.set(
        battle.id,
        createBattleReplayCapture(
          this.state.meta.roomId,
          battle,
          {
            attackerPlayerId: attackerHero.playerId,
            ...(defenderHero?.playerId ? { defenderPlayerId: defenderHero.playerId } : {})
          }
        )
      );
    }
  }

  private trackBattleAction(
    battleId: string,
    action: BattleAction,
    source: "player" | "automated",
    rejection?: ActionValidationFailure
  ): void {
    const existing = this.battleReplayByBattleId.get(battleId);
    if (!existing) {
      return;
    }

    this.battleReplayByBattleId.set(battleId, appendBattleReplayStep(existing, action, source, rejection));
  }

  private finalizeBattleReplay(battle: BattleState, outcome: BattleOutcome): void {
    const existing = this.battleReplayByBattleId.get(battle.id);
    if (!existing) {
      return;
    }

    this.battleReplayByBattleId.delete(battle.id);
    const completed = finalizeBattleReplayCapture(existing, battle, outcome);
    if (completed) {
      this.completedBattleReplays.push(completed);
    }
  }

  private recordCompletedBattleDuration(battleId: string): void {
    const startedAt = this.battleStartedAtByBattleId.get(battleId);
    if (startedAt == null) {
      return;
    }

    authoritativeRoomTelemetry.recordBattleDuration((Date.now() - startedAt) / 1_000);
  }

  getSnapshot(playerId: string): RoomSnapshot {
    return {
      roomId: this.state.meta.roomId,
      playerId,
      state: createPlayerWorldView(this.state, playerId)
    };
  }

  filterEventsForPlayer(playerId: string, events: WorldEvent[]): WorldEvent[] {
    return filterWorldEventsForPlayer(this.state, playerId, events);
  }

  serializePersistenceSnapshot(): RoomPersistenceSnapshot {
    return {
      state: this.state,
      battles: this.getActiveBattles()
    };
  }

  private createBattleSeed(battleId: string): number {
    return hashBattleSeed(`${this.state.meta.seed}:${this.state.meta.day}:${battleId}`);
  }

  private resolveAutomatedBattleTurns(battleId: string): WorldEvent[] {
    const events: WorldEvent[] = [];

    while (true) {
      const battle = this.getBattleById(battleId);
      if (!battle) {
        break;
      }

      const outcome = getBattleOutcome(battle);
      if (outcome.status !== "in_progress") {
        this.finalizeBattleReplay(battle, outcome);
        this.recordCompletedBattleDuration(battle.id);
        authoritativeRoomTelemetry.recordBattleResolved({
          roomId: this.state.meta.roomId,
          battleId: battle.id,
          outcome: "completed",
          reason: outcome.status
        });
        if (battle.worldHeroId) {
          const worldOutcome = applyBattleOutcomeToWorld(
            this.state,
            battle.id,
            battle.worldHeroId,
            outcome
          );
          this.state = worldOutcome.state;
          this.clearBattle(battle);
          events.push(...worldOutcome.events);
        }
        break;
      }

      const activeUnitId = battle.activeUnitId;
      const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
      if (!activeUnit || activeUnit.count <= 0 || activeUnit.camp !== "defender" || battle.defenderHeroId) {
        break;
      }

      const automatedAction = pickAutomatedBattleAction(battle);
      if (!automatedAction) {
        break;
      }

      this.trackBattleAction(battle.id, automatedAction, "automated");
      this.setBattle(applyBattleAction(battle, automatedAction));
    }

    return events;
  }

  dispatch(playerId: string, action: WorldAction): DispatchResult {
    if ("heroId" in action) {
      const hero = this.state.heroes.find((item) => item.id === action.heroId);
      if (!hero || hero.playerId !== playerId) {
        const rejection = createActionValidationFailure("world", action, {
          valid: false,
          reason: "hero_not_owned_by_player"
        })!;
        authoritativeRoomTelemetry.recordActionValidationFailure("world", rejection.reason);
        return {
          ok: false,
          reason: rejection.reason,
          rejection,
          snapshot: this.getSnapshot(playerId)
        };
      }

      if (this.getBattleIdForHero(hero.id)) {
        const rejection = createActionValidationFailure("world", action, {
          valid: false,
          reason: "hero_in_battle"
        })!;
        authoritativeRoomTelemetry.recordActionValidationFailure("world", rejection.reason);
        return {
          ok: false,
          reason: rejection.reason,
          rejection,
          snapshot: this.getSnapshot(playerId),
          ...(this.getBattleForPlayer(playerId) ? { battle: this.getBattleForPlayer(playerId)! } : {})
        };
      }
    }

    const precheck = precheckWorldAction(this.state, action, playerId);
    if (!precheck.validation.valid) {
      authoritativeRoomTelemetry.recordActionValidationFailure(
        "world",
        precheck.rejection?.reason ?? "world_action_invalid"
      );
      return {
        ok: false,
        ...(precheck.rejection ? { reason: precheck.rejection.reason, rejection: precheck.rejection } : {}),
        snapshot: this.getSnapshot(playerId)
      };
    }

    const outcome = resolveWorldAction(precheck.state, action);
    this.state = outcome.state;

    const startedBattleIds: string[] = [];
    for (const battleEvent of outcome.events.filter((event) => event.type === "battle.started")) {
      const hero = this.state.heroes.find((item) => item.id === battleEvent.heroId);
      if (!hero) {
        continue;
      }

      if (battleEvent.encounterKind === "neutral" && battleEvent.neutralArmyId) {
        const neutralArmy = this.state.neutralArmies[battleEvent.neutralArmyId];
        if (!neutralArmy) {
          continue;
        }

        const battle = createNeutralBattleState(
          hero,
          neutralArmy,
          this.createBattleSeed(battleEvent.battleId),
          this.state
        );
        this.trackStartedBattle(battle);
        startedBattleIds.push(battle.id);
        continue;
      }

      if (battleEvent.encounterKind === "hero" && battleEvent.defenderHeroId) {
        const defenderHero = this.state.heroes.find((item) => item.id === battleEvent.defenderHeroId);
        if (!defenderHero) {
          continue;
        }

        const battle = createHeroBattleState(
          hero,
          defenderHero,
          this.createBattleSeed(battleEvent.battleId),
          this.state
        );
        this.trackStartedBattle(battle);
        startedBattleIds.push(battle.id);
      }
    }

    const automatedEvents = startedBattleIds.flatMap((battleId) => this.resolveAutomatedBattleTurns(battleId));
    const events = outcome.events.concat(automatedEvents);
    const playerBattle = this.getBattleForPlayer(playerId);

    return {
      ok: true,
      snapshot: this.getSnapshot(playerId),
      ...(events.length > 0 ? { events } : {}),
      ...(outcome.movementPlan ? { movementPlan: outcome.movementPlan } : {}),
      ...(playerBattle ? { battle: playerBattle } : {})
    };
  }

  dispatchBattle(playerId: string, action: BattleAction): BattleDispatchResult {
    const activeBattle = this.getBattleForPlayer(playerId);
    if (!activeBattle) {
      const rejection = createActionValidationFailure("battle", action, {
        valid: false,
        reason: "battle_not_active"
      })!;
      authoritativeRoomTelemetry.recordActionValidationFailure("battle", rejection.reason);
      return {
        ok: false,
        reason: rejection.reason,
        rejection,
        snapshot: this.getSnapshot(playerId)
      };
    }

    const controllingCamp = this.getControllingCamp(playerId, activeBattle);
    if (!controllingCamp) {
      const rejection = createActionValidationFailure("battle", action, {
        valid: false,
        reason: "battle_not_owned_by_player"
      })!;
      authoritativeRoomTelemetry.recordActionValidationFailure("battle", rejection.reason);
      this.trackBattleAction(activeBattle.id, action, "player", rejection);
      return {
        ok: false,
        reason: rejection.reason,
        rejection,
        snapshot: this.getSnapshot(playerId)
      };
    }

    const actingUnitId = action.type === "battle.attack" ? action.attackerId : action.unitId;
    const actingUnit = activeBattle.units[actingUnitId];
    if (!actingUnit || actingUnit.camp !== controllingCamp) {
      const rejection = createActionValidationFailure("battle", action, {
        valid: false,
        reason: "unit_not_player_controlled"
      })!;
      authoritativeRoomTelemetry.recordActionValidationFailure("battle", rejection.reason);
      this.trackBattleAction(activeBattle.id, action, "player", rejection);
      return {
        ok: false,
        reason: rejection.reason,
        rejection,
        battle: activeBattle,
        snapshot: this.getSnapshot(playerId)
      };
    }

    const precheck = precheckBattleAction(activeBattle, action);
    if (!precheck.validation.valid) {
      authoritativeRoomTelemetry.recordActionValidationFailure(
        "battle",
        precheck.rejection?.reason ?? "battle_action_invalid"
      );
      if (precheck.rejection) {
        this.trackBattleAction(activeBattle.id, action, "player", precheck.rejection);
      }
      return {
        ok: false,
        ...(precheck.rejection ? { reason: precheck.rejection.reason, rejection: precheck.rejection } : {}),
        battle: activeBattle,
        snapshot: this.getSnapshot(playerId)
      };
    }

    this.trackBattleAction(activeBattle.id, action, "player");
    const nextBattle = applyBattleAction(precheck.state, action);
    this.setBattle(nextBattle);
    const automatedEvents = this.resolveAutomatedBattleTurns(nextBattle.id);
    const playerBattle = this.getBattleForPlayer(playerId);
    if (!playerBattle) {
      return {
        ok: true,
        snapshot: this.getSnapshot(playerId),
        ...(automatedEvents.length > 0 ? { events: automatedEvents } : {})
      };
    }

    return {
      ok: true,
      battle: playerBattle,
      snapshot: this.getSnapshot(playerId)
    };
  }
}

export function buildAuthoritativeRoomErrorContext(
  room: AuthoritativeWorldRoom,
  playerId?: string | null
): AuthoritativeRoomErrorContext {
  const internalState = room.getInternalState();
  const activeBattle = playerId ? room.getBattleForPlayer(playerId) : null;
  const activeHero = playerId ? internalState.heroes.find((hero) => hero.playerId === playerId) ?? null : null;

  return {
    roomId: internalState.meta.roomId,
    playerId: playerId ?? null,
    battleId: activeBattle?.id ?? null,
    heroId: activeHero?.id ?? null,
    day: internalState.meta.day
  };
}

export function createRoom(roomId: string, seed?: number, snapshot?: RoomPersistenceSnapshot): AuthoritativeWorldRoom {
  return new AuthoritativeWorldRoom(roomId, seed, snapshot);
}
