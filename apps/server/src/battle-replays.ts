import {
  appendPlayerBattleReplaySummaries,
  type BattleAction,
  type BattleOutcome,
  type BattleReplayCamp,
  type BattleReplayResult,
  type BattleReplayStep,
  type BattleState,
  type PlayerBattleReplaySummary
} from "../../../packages/shared/src/index";
import type { PlayerAccountSnapshot } from "./persistence";

const RECENT_BATTLE_REPLAY_LIMIT = 5;

export interface OngoingBattleReplayCapture {
  battleId: string;
  roomId: string;
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
  startedAt = new Date().toISOString()
): OngoingBattleReplayCapture {
  return {
    battleId: battle.id,
    roomId,
    startedAt,
    initialState: cloneBattleState(battle),
    steps: []
  };
}

export function appendBattleReplayStep(
  replay: OngoingBattleReplayCapture,
  action: BattleAction,
  source: BattleReplayStep["source"]
): OngoingBattleReplayCapture {
  return {
    ...replay,
    steps: replay.steps.concat({
      index: replay.steps.length + 1,
      source,
      action: structuredClone(action)
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
): PlayerBattleReplaySummary {
  return {
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
  };
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
