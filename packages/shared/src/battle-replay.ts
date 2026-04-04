import { applyBattleAction, normalizeBattleState } from "./battle.ts";
import type { BattleAction, BattleState } from "./models.ts";
import { getBattleOutcome } from "./battle.ts";
import type { BattleOutcome, UnitStack } from "./models.ts";

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
  offset?: number | undefined;
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
export type BattleReplayPlaybackAction = "play" | "pause" | "step" | "tick" | "reset" | "step-back";
export type BattleReplayPlaybackSpeed = 0.5 | 1 | 2 | 4;

export interface BattleReplayPlaybackState {
  replay: PlayerBattleReplaySummary;
  status: BattleReplayPlaybackStatus;
  speed: BattleReplayPlaybackSpeed;
  currentStepIndex: number;
  totalSteps: number;
  currentState: BattleState;
  currentStep: BattleReplayStep | null;
  nextStep: BattleReplayStep | null;
}

export interface BattleReplayPlaybackCommand {
  currentStepIndex?: number | undefined;
  targetTurn?: number | undefined;
  status?: Exclude<BattleReplayPlaybackStatus, "completed"> | undefined;
  speed?: number | undefined;
  action?: BattleReplayPlaybackAction | undefined;
  repeat?: number | undefined;
}

export interface BattleReplayTimelineUnitChange {
  unitId: string;
  stackName: string;
  camp: UnitStack["camp"];
  lane: number;
  hpChange: number;
  countChange: number;
  defeated: boolean;
  defendingChanged: boolean;
  statusAdded: string[];
  statusRemoved: string[];
}

export interface BattleReplayTimelineEntry {
  step: BattleReplayStep;
  round: number;
  resultingRound: number;
  state: BattleState;
  outcome: BattleOutcome["status"];
  changes: BattleReplayTimelineUnitChange[];
}

function normalizeTimestamp(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function cloneBattleState(state: BattleState): BattleState {
  return normalizeBattleState(structuredClone(state));
}

function unitHpPool(unit?: UnitStack | null): number {
  if (!unit || unit.count <= 0 || unit.currentHp <= 0) {
    return 0;
  }

  return (unit.count - 1) * unit.maxHp + unit.currentHp;
}

function compareTimelineUnitChanges(beforeState: BattleState, afterState: BattleState): BattleReplayTimelineUnitChange[] {
  const unitIds = Array.from(new Set([...Object.keys(beforeState.units), ...Object.keys(afterState.units)]));

  return unitIds
    .map((unitId) => {
      const beforeUnit = beforeState.units[unitId];
      const afterUnit = afterState.units[unitId];
      const reference = afterUnit ?? beforeUnit;
      if (!reference) {
        return null;
      }

      const hpChange = unitHpPool(afterUnit) - unitHpPool(beforeUnit);
      const countChange = (afterUnit?.count ?? 0) - (beforeUnit?.count ?? 0);
      const beforeStatuses = new Set((beforeUnit?.statusEffects ?? []).map((status) => status.name));
      const afterStatuses = new Set((afterUnit?.statusEffects ?? []).map((status) => status.name));
      const statusAdded = Array.from(afterStatuses).filter((status) => !beforeStatuses.has(status));
      const statusRemoved = Array.from(beforeStatuses).filter((status) => !afterStatuses.has(status));
      const defendingChanged = (beforeUnit?.defending ?? false) !== (afterUnit?.defending ?? false);

      if (hpChange === 0 && countChange === 0 && statusAdded.length === 0 && statusRemoved.length === 0 && !defendingChanged) {
        return null;
      }

      return {
        unitId,
        stackName: reference.stackName,
        camp: reference.camp,
        lane: reference.lane,
        hpChange,
        countChange,
        defeated: (beforeUnit?.count ?? 0) > 0 && (afterUnit?.count ?? 0) <= 0,
        defendingChanged,
        statusAdded,
        statusRemoved
      };
    })
    .filter((entry): entry is BattleReplayTimelineUnitChange => Boolean(entry))
    .sort(
      (left, right) =>
        Math.abs(right.hpChange) - Math.abs(left.hpChange) ||
        Math.abs(right.countChange) - Math.abs(left.countChange) ||
        left.camp.localeCompare(right.camp) ||
        left.lane - right.lane ||
        left.unitId.localeCompare(right.unitId)
    );
}

function resolvePlaybackStatus(
  requestedStatus: Exclude<BattleReplayPlaybackStatus, "completed">,
  currentStepIndex: number,
  totalSteps: number
): BattleReplayPlaybackStatus {
  return currentStepIndex >= totalSteps ? "completed" : requestedStatus;
}

function normalizePlaybackSpeed(speed?: number | null): BattleReplayPlaybackSpeed {
  if (speed === 0.5 || speed === 1 || speed === 2 || speed === 4) {
    return speed;
  }

  if (speed != null && Number.isFinite(speed)) {
    if (speed <= 0.75) {
      return 0.5;
    }
    if (speed <= 1.5) {
      return 1;
    }
    if (speed <= 3) {
      return 2;
    }
  }

  return 4;
}

function buildPlaybackState(
  replay: PlayerBattleReplaySummary,
  currentState: BattleState,
  currentStepIndex: number,
  status: Exclude<BattleReplayPlaybackStatus, "completed">,
  speed: BattleReplayPlaybackSpeed
): BattleReplayPlaybackState {
  const totalSteps = replay.steps.length;
  const boundedStepIndex = Math.max(0, Math.min(totalSteps, Math.floor(currentStepIndex)));
  return {
    replay,
    status: resolvePlaybackStatus(status, boundedStepIndex, totalSteps),
    speed,
    currentStepIndex: boundedStepIndex,
    totalSteps,
    currentState: cloneBattleState(currentState),
    currentStep: replay.steps[boundedStepIndex - 1] ?? null,
    nextStep: replay.steps[boundedStepIndex] ?? null
  };
}

export function createBattleReplayPlaybackState(replay: PlayerBattleReplaySummary): BattleReplayPlaybackState {
  return buildPlaybackState(replay, replay.initialState, 0, "paused", 1);
}

export function restoreBattleReplayPlaybackState(
  replay: PlayerBattleReplaySummary,
  currentStepIndex = 0,
  status: Exclude<BattleReplayPlaybackStatus, "completed"> = "paused",
  speed: number = 1
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

  return buildPlaybackState(replay, currentState, safeStepIndex, status, normalizePlaybackSpeed(speed));
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
  return buildPlaybackState(playback.replay, playback.replay.initialState, 0, "paused", playback.speed);
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
  return buildPlaybackState(playback.replay, nextState, nextStepIndex, nextStatus, playback.speed);
}

export function stepBackBattleReplayPlayback(playback: BattleReplayPlaybackState): BattleReplayPlaybackState {
  if (playback.currentStepIndex <= 0) {
    return resetBattleReplayPlayback(playback);
  }

  return restoreBattleReplayPlaybackState(playback.replay, playback.currentStepIndex - 1, "paused", playback.speed);
}

export function tickBattleReplayPlayback(playback: BattleReplayPlaybackState): BattleReplayPlaybackState {
  if (playback.status !== "playing") {
    return playback;
  }

  return stepBattleReplayPlayback(playback);
}

export function setBattleReplayPlaybackSpeed(
  playback: BattleReplayPlaybackState,
  speed: number
): BattleReplayPlaybackState {
  return {
    ...playback,
    speed: normalizePlaybackSpeed(speed)
  };
}

export function seekBattleReplayPlayback(
  playback: BattleReplayPlaybackState,
  currentStepIndex: number,
  status: Exclude<BattleReplayPlaybackStatus, "completed"> = "paused"
): BattleReplayPlaybackState {
  return restoreBattleReplayPlaybackState(playback.replay, currentStepIndex, status, playback.speed);
}

export function seekBattleReplayPlaybackToTurn(
  playback: BattleReplayPlaybackState,
  targetTurn: number,
  status: Exclude<BattleReplayPlaybackStatus, "completed"> = "paused"
): BattleReplayPlaybackState {
  const safeTurn = Math.max(1, Math.floor(targetTurn));
  const initialTurn = Math.max(1, Math.floor(playback.replay.initialState.round || 1));
  if (safeTurn <= initialTurn) {
    return seekBattleReplayPlayback(playback, 0, status);
  }

  const timeline = buildBattleReplayTimeline(playback.replay);
  const matchingEntry = timeline.find((entry) => entry.resultingRound >= safeTurn);
  return seekBattleReplayPlayback(playback, matchingEntry?.step.index ?? playback.replay.steps.length, status);
}

export function applyBattleReplayPlaybackCommand(
  replay: PlayerBattleReplaySummary,
  command: BattleReplayPlaybackCommand = {}
): BattleReplayPlaybackState {
  const repeat = Math.max(1, Math.floor(command.repeat ?? 1));
  let playback = restoreBattleReplayPlaybackState(
    replay,
    command.currentStepIndex,
    command.status ?? "paused",
    command.speed ?? 1
  );
  if (command.targetTurn != null) {
    playback = seekBattleReplayPlaybackToTurn(playback, command.targetTurn, command.status ?? "paused");
  }

  switch (command.action) {
    case "play":
      return playBattleReplayPlayback(playback);
    case "pause":
      return pauseBattleReplayPlayback(playback);
    case "reset":
      return resetBattleReplayPlayback(playback);
    case "step-back":
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        playback = stepBackBattleReplayPlayback(playback);
      }
      return playback;
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

export function buildBattleReplayTimeline(replay: PlayerBattleReplaySummary): BattleReplayTimelineEntry[] {
  const timeline: BattleReplayTimelineEntry[] = [];
  let currentState = cloneBattleState(replay.initialState);

  for (const step of replay.steps) {
    const nextState = applyBattleAction(currentState, step.action);
    timeline.push({
      step,
      round: currentState.round,
      resultingRound: nextState.round,
      state: cloneBattleState(nextState),
      outcome: getBattleOutcome(nextState).status,
      changes: compareTimelineUnitChanges(currentState, nextState)
    });
    currentState = nextState;
  }

  return timeline;
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
  const safeOffset = Math.max(0, Math.floor(query.offset ?? 0));
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
    .slice(safeOffset)
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
