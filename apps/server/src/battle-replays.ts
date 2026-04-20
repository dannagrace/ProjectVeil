import { type ActionValidationFailure, appendPlayerBattleReplaySummaries, type BattleReplayCamp, type BattleReplayResult, type BattleReplayStep, type PlayerBattleReplaySummary } from "@veil/shared/battle";
import type { BattleAction, BattleOutcome, BattleState } from "@veil/shared/models";
import type { PlayerAccountSnapshot } from "./persistence";
import {
  applyBattleReplayRetentionToSummary,
  readBattleReplayRetentionPolicy
} from "./battle-replay-retention";

const RECENT_BATTLE_REPLAY_LIMIT = 5;

export interface OngoingBattleReplayCapture {
  battleId: string;
  roomId: string;
  attackerPlayerId: string;
  defenderPlayerId?: string;
  startedAt: string;
  initialState: BattleState;
  steps: BattleReplayStep[];
}

export interface CompletedBattleReplayCapture extends OngoingBattleReplayCapture {
  completedAt: string;
  battleState: BattleState;
  result: BattleReplayResult;
}

function cloneBattleState(state: BattleState): BattleState {
  return structuredClone(state);
}

function battleKindOf(battle: BattleState): "neutral" | "hero" {
  return battle.neutralArmyId ? "neutral" : "hero";
}

export function createBattleReplayCapture(
  roomId: string,
  battle: BattleState,
  participants: { attackerPlayerId: string; defenderPlayerId?: string },
  startedAt = new Date().toISOString()
): OngoingBattleReplayCapture {
  return {
    battleId: battle.id,
    roomId,
    attackerPlayerId: participants.attackerPlayerId,
    ...(participants.defenderPlayerId ? { defenderPlayerId: participants.defenderPlayerId } : {}),
    startedAt,
    initialState: cloneBattleState(battle),
    steps: []
  };
}

export function appendBattleReplayStep(
  replay: OngoingBattleReplayCapture,
  action: BattleAction,
  source: BattleReplayStep["source"],
  rejection?: ActionValidationFailure
): OngoingBattleReplayCapture {
  return {
    ...replay,
    steps: replay.steps.concat({
      index: replay.steps.length + 1,
      source,
      action: structuredClone(action),
      ...(rejection ? { rejection: structuredClone(rejection) } : {})
    })
  };
}

export function finalizeBattleReplayCapture(
  replay: OngoingBattleReplayCapture,
  battleState: BattleState,
  outcome: BattleOutcome,
  completedAt = new Date().toISOString()
): CompletedBattleReplayCapture | null {
  if (outcome.status !== "attacker_victory" && outcome.status !== "defender_victory") {
    return null;
  }

  return {
    ...replay,
    completedAt,
    battleState: cloneBattleState(battleState),
    result: outcome.status
  };
}

function buildPlayerReplayId(replay: CompletedBattleReplayCapture, playerId: string): string {
  return `${replay.roomId}:${replay.battleId}:${playerId}`;
}

export function buildPlayerBattleReplaySummary(
  replay: CompletedBattleReplayCapture,
  playerId: string,
  heroId: string,
  playerCamp: BattleReplayCamp,
  opponentHeroId?: string
): PlayerBattleReplaySummary | null {
  return applyBattleReplayRetentionToSummary(
    {
      id: buildPlayerReplayId(replay, playerId),
      roomId: replay.roomId,
      playerId,
      battleId: replay.battleId,
      battleKind: battleKindOf(replay.battleState),
      playerCamp,
      heroId,
      ...(opponentHeroId ? { opponentHeroId } : {}),
      ...(replay.battleState.neutralArmyId ? { neutralArmyId: replay.battleState.neutralArmyId } : {}),
      startedAt: replay.startedAt,
      completedAt: replay.completedAt,
      initialState: replay.initialState,
      steps: replay.steps,
      result: replay.result
    },
    readBattleReplayRetentionPolicy()
  );
}

export function buildPlayerBattleReplaySummariesForPlayer(
  replay: CompletedBattleReplayCapture,
  playerId: string
): PlayerBattleReplaySummary[] {
  if (replay.attackerPlayerId === playerId && replay.battleState.worldHeroId) {
    const summary = buildPlayerBattleReplaySummary(
      replay,
      playerId,
      replay.battleState.worldHeroId,
      "attacker",
      replay.battleState.defenderHeroId
    );
    return summary ? [summary] : [];
  }

  if (replay.defenderPlayerId === playerId && replay.battleState.defenderHeroId) {
    const summary = buildPlayerBattleReplaySummary(
      replay,
      playerId,
      replay.battleState.defenderHeroId,
      "defender",
      replay.battleState.worldHeroId
    );
    return summary ? [summary] : [];
  }

  return [];
}

export function appendCompletedBattleReplaysToAccount(
  account: PlayerAccountSnapshot,
  replays: PlayerBattleReplaySummary[]
): PlayerAccountSnapshot {
  if (replays.length === 0) {
    return account;
  }

  return {
    ...account,
    recentBattleReplays: appendPlayerBattleReplaySummaries(
      account.recentBattleReplays,
      replays,
      RECENT_BATTLE_REPLAY_LIMIT
    )
  };
}
