import { applyBattleAction } from "./battle.ts";
import type { BattleAction, BattleState } from "./models.ts";

export type BattleReplayResult = "attacker_victory" | "defender_victory";
export type BattleReplaySource = "player" | "automated";
export type BattleReplayCamp = "attacker" | "defender";

export interface BattleReplayStep {
  index: number;
  source: BattleReplaySource;
  action: BattleAction;
}

export interface PlayerBattleReplaySummary {
  id: string;
  roomId: string;
  playerId: string;
  battleId: string;
  battleKind: "neutral" | "hero";
  playerCamp: BattleReplayCamp;
  heroId: string;
  opponentHeroId?: string;
  neutralArmyId?: string;
  startedAt: string;
  completedAt: string;
  initialState: BattleState;
  steps: BattleReplayStep[];
  result: BattleReplayResult;
}

export interface PlayerBattleReplayQuery {
  limit?: number | undefined;
  roomId?: string | undefined;
  battleId?: string | undefined;
  battleKind?: PlayerBattleReplaySummary["battleKind"] | undefined;
  playerCamp?: PlayerBattleReplaySummary["playerCamp"] | undefined;
  heroId?: string | undefined;
  opponentHeroId?: string | undefined;
  neutralArmyId?: string | undefined;
  result?: PlayerBattleReplaySummary["result"] | undefined;
}

export type BattleReplayPlaybackStatus = "paused" | "playing" | "completed";
export type BattleReplayPlaybackAction = "play" | "pause" | "step" | "tick" | "reset";

export interface BattleReplayPlaybackState {
  replay: PlayerBattleReplaySummary;
  status: BattleReplayPlaybackStatus;
  currentStepIndex: number;
  totalSteps: number;
  currentState: BattleState;
  currentStep: BattleReplayStep | null;
  nextStep: BattleReplayStep | null;
}

export interface BattleReplayPlaybackCommand {
  currentStepIndex?: number | undefined;
  status?: Exclude<BattleReplayPlaybackStatus, "completed"> | undefined;
  action?: BattleReplayPlaybackAction | undefined;
  repeat?: number | undefined;
}

function normalizeTimestamp(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function cloneBattleState(state: BattleState): BattleState {
  return structuredClone(state);
}

function resolvePlaybackStatus(
  requestedStatus: Exclude<BattleReplayPlaybackStatus, "completed">,
  currentStepIndex: number,
  totalSteps: number
): BattleReplayPlaybackStatus {
  return currentStepIndex >= totalSteps ? "completed" : requestedStatus;
}

function buildPlaybackState(
  replay: PlayerBattleReplaySummary,
  currentState: BattleState,
  currentStepIndex: number,
  status: Exclude<BattleReplayPlaybackStatus, "completed">
): BattleReplayPlaybackState {
  const totalSteps = replay.steps.length;
  const boundedStepIndex = Math.max(0, Math.min(totalSteps, Math.floor(currentStepIndex)));
  return {
    replay,
    status: resolvePlaybackStatus(status, boundedStepIndex, totalSteps),
    currentStepIndex: boundedStepIndex,
    totalSteps,
    currentState: cloneBattleState(currentState),
    currentStep: replay.steps[boundedStepIndex - 1] ?? null,
    nextStep: replay.steps[boundedStepIndex] ?? null
  };
}

export function createBattleReplayPlaybackState(replay: PlayerBattleReplaySummary): BattleReplayPlaybackState {
  return buildPlaybackState(replay, replay.initialState, 0, "paused");
}

export function restoreBattleReplayPlaybackState(
  replay: PlayerBattleReplaySummary,
  currentStepIndex = 0,
  status: Exclude<BattleReplayPlaybackStatus, "completed"> = "paused"
): BattleReplayPlaybackState {
  const safeStepIndex = Math.max(0, Math.min(replay.steps.length, Math.floor(currentStepIndex)));
  let currentState = cloneBattleState(replay.initialState);

  for (let index = 0; index < safeStepIndex; index += 1) {
    const step = replay.steps[index];
    if (!step) {
      break;
    }

    currentState = applyBattleAction(currentState, step.action);
  }

  return buildPlaybackState(replay, currentState, safeStepIndex, status);
}

export function playBattleReplayPlayback(playback: BattleReplayPlaybackState): BattleReplayPlaybackState {
  if (playback.currentStepIndex >= playback.totalSteps) {
    return {
      ...playback,
      status: "completed"
    };
  }

  return {
    ...playback,
    status: "playing"
  };
}

export function pauseBattleReplayPlayback(playback: BattleReplayPlaybackState): BattleReplayPlaybackState {
  if (playback.status === "completed") {
    return playback;
  }

  return {
    ...playback,
    status: "paused"
  };
}

export function resetBattleReplayPlayback(playback: BattleReplayPlaybackState): BattleReplayPlaybackState {
  return buildPlaybackState(playback.replay, playback.replay.initialState, 0, "paused");
}

export function stepBattleReplayPlayback(playback: BattleReplayPlaybackState): BattleReplayPlaybackState {
  const nextStep = playback.nextStep;
  if (!nextStep) {
    return {
      ...playback,
      status: "completed"
    };
  }

  const nextState = applyBattleAction(playback.currentState, nextStep.action);
  const nextStepIndex = playback.currentStepIndex + 1;
  const nextStatus = playback.status === "playing" ? "playing" : "paused";
  return buildPlaybackState(playback.replay, nextState, nextStepIndex, nextStatus);
}

export function tickBattleReplayPlayback(playback: BattleReplayPlaybackState): BattleReplayPlaybackState {
  if (playback.status !== "playing") {
    return playback;
  }

  return stepBattleReplayPlayback(playback);
}

export function applyBattleReplayPlaybackCommand(
  replay: PlayerBattleReplaySummary,
  command: BattleReplayPlaybackCommand = {}
): BattleReplayPlaybackState {
  const repeat = Math.max(1, Math.floor(command.repeat ?? 1));
  let playback = restoreBattleReplayPlaybackState(replay, command.currentStepIndex, command.status ?? "paused");

  switch (command.action) {
    case "play":
      return playBattleReplayPlayback(playback);
    case "pause":
      return pauseBattleReplayPlayback(playback);
    case "reset":
      return resetBattleReplayPlayback(playback);
    case "step":
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        playback = stepBattleReplayPlayback(playback);
      }
      return playback;
    case "tick":
      playback = playBattleReplayPlayback(playback);
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        playback = tickBattleReplayPlayback(playback);
      }
      return playback;
    default:
      return playback;
  }
}

function normalizeBattleReplayStep(step: Partial<BattleReplayStep> | null | undefined, fallbackIndex: number): BattleReplayStep | null {
  const action = step?.action;
  const type = action?.type;
  if (
    type !== "battle.attack" &&
    type !== "battle.wait" &&
    type !== "battle.defend" &&
    type !== "battle.skill"
  ) {
    return null;
  }

  return {
    index: Math.max(0, Math.floor(step?.index ?? fallbackIndex)),
    source: step?.source === "automated" ? "automated" : "player",
    action: structuredClone(action as BattleAction)
  };
}

export function normalizePlayerBattleReplaySummaries(
  replays?: Partial<PlayerBattleReplaySummary>[] | null
): PlayerBattleReplaySummary[] {
  return (replays ?? [])
    .map((replay) => {
      const id = replay?.id?.trim();
      const roomId = replay?.roomId?.trim();
      const playerId = replay?.playerId?.trim();
      const battleId = replay?.battleId?.trim();
      const heroId = replay?.heroId?.trim();
      const startedAt = normalizeTimestamp(replay?.startedAt);
      const completedAt = normalizeTimestamp(replay?.completedAt);
      const initialState = replay?.initialState;
      if (
        !id ||
        !roomId ||
        !playerId ||
        !battleId ||
        !heroId ||
        !startedAt ||
        !completedAt ||
        !initialState ||
        (replay?.battleKind !== "neutral" && replay?.battleKind !== "hero") ||
        (replay?.playerCamp !== "attacker" && replay?.playerCamp !== "defender") ||
        (replay?.result !== "attacker_victory" && replay?.result !== "defender_victory")
      ) {
        return null;
      }

      const steps = (replay.steps ?? [])
        .map((step, index) => normalizeBattleReplayStep(step, index + 1))
        .filter((step): step is BattleReplayStep => Boolean(step))
        .sort((left, right) => left.index - right.index);

      return {
        id,
        roomId,
        playerId,
        battleId,
        battleKind: replay.battleKind,
        playerCamp: replay.playerCamp,
        heroId,
        ...(replay.opponentHeroId?.trim() ? { opponentHeroId: replay.opponentHeroId.trim() } : {}),
        ...(replay.neutralArmyId?.trim() ? { neutralArmyId: replay.neutralArmyId.trim() } : {}),
        startedAt,
        completedAt,
        initialState: cloneBattleState(initialState),
        steps,
        result: replay.result
      };
    })
    .filter((replay): replay is PlayerBattleReplaySummary => Boolean(replay))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || left.id.localeCompare(right.id))
    .filter((replay, index, list) => index === list.findIndex((candidate) => candidate.id === replay.id));
}

export function appendPlayerBattleReplaySummaries(
  existing: Partial<PlayerBattleReplaySummary>[] | null | undefined,
  incoming: Partial<PlayerBattleReplaySummary>[] | null | undefined,
  limit = 5
): PlayerBattleReplaySummary[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const normalizedIncoming = normalizePlayerBattleReplaySummaries(incoming);
  if (normalizedIncoming.length === 0) {
    return normalizePlayerBattleReplaySummaries(existing).slice(0, safeLimit);
  }

  return normalizePlayerBattleReplaySummaries([
    ...normalizedIncoming,
    ...normalizePlayerBattleReplaySummaries(existing)
  ]).slice(0, safeLimit);
}

export function queryPlayerBattleReplaySummaries(
  replays?: Partial<PlayerBattleReplaySummary>[] | null,
  query: PlayerBattleReplayQuery = {}
): PlayerBattleReplaySummary[] {
  const safeLimit = query.limit == null ? undefined : Math.max(1, Math.floor(query.limit));
  const roomId = query.roomId?.trim();
  const battleId = query.battleId?.trim();
  const heroId = query.heroId?.trim();
  const opponentHeroId = query.opponentHeroId?.trim();
  const neutralArmyId = query.neutralArmyId?.trim();

  return normalizePlayerBattleReplaySummaries(replays)
    .filter((replay) => (roomId ? replay.roomId === roomId : true))
    .filter((replay) => (battleId ? replay.battleId === battleId : true))
    .filter((replay) => (query.battleKind ? replay.battleKind === query.battleKind : true))
    .filter((replay) => (query.playerCamp ? replay.playerCamp === query.playerCamp : true))
    .filter((replay) => (heroId ? replay.heroId === heroId : true))
    .filter((replay) => (opponentHeroId ? replay.opponentHeroId === opponentHeroId : true))
    .filter((replay) => (neutralArmyId ? replay.neutralArmyId === neutralArmyId : true))
    .filter((replay) => (query.result ? replay.result === query.result : true))
    .slice(0, safeLimit);
}

export function findPlayerBattleReplaySummary(
  replays?: Partial<PlayerBattleReplaySummary>[] | null,
  replayId?: string | null
): PlayerBattleReplaySummary | null {
  const normalizedReplayId = replayId?.trim();
  if (!normalizedReplayId) {
    return null;
  }

  return normalizePlayerBattleReplaySummaries(replays).find((replay) => replay.id === normalizedReplayId) ?? null;
}
