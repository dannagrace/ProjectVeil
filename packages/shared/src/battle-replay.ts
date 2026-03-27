import type { BattleAction, BattleState } from "./models";

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

function normalizeTimestamp(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function cloneBattleState(state: BattleState): BattleState {
  return {
    ...state,
    units: Object.fromEntries(Object.entries(state.units).map(([unitId, unit]) => [unitId, { ...unit }])),
    environment: state.environment.map((hazard) => ({ ...hazard })),
    log: [...state.log],
    rng: { ...state.rng },
    ...(state.encounterPosition ? { encounterPosition: { ...state.encounterPosition } } : {})
  };
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
