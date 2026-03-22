export type UnitAnimationState = "idle" | "move" | "attack" | "hit" | "victory" | "defeat";

export interface UnitAnimationNameMap {
  idle: string;
  move: string;
  attack: string;
  hit: string;
  victory: string;
  defeat: string;
}

export interface UnitAnimationTimingMap {
  attack: number;
  hit: number;
  victory: number;
  defeat: number;
}

export function createUnitAnimationNameMap(overrides?: Partial<UnitAnimationNameMap>): UnitAnimationNameMap {
  return {
    idle: overrides?.idle ?? "",
    move: overrides?.move ?? "",
    attack: overrides?.attack ?? "",
    hit: overrides?.hit ?? "",
    victory: overrides?.victory ?? "",
    defeat: overrides?.defeat ?? ""
  };
}

export function resolveUnitAnimationName(
  state: UnitAnimationState,
  explicitNames: UnitAnimationNameMap,
  prefix = ""
): string {
  const explicitName = explicitNames[state].trim();
  if (explicitName) {
    return explicitName;
  }

  const trimmedPrefix = prefix.trim();
  return trimmedPrefix ? `${trimmedPrefix}${state}` : state;
}

export function shouldLoopUnitAnimation(state: UnitAnimationState): boolean {
  return state === "idle" || state === "move";
}

export function resolveUnitAnimationReturnDelay(
  state: UnitAnimationState,
  timings: UnitAnimationTimingMap
): number | null {
  if (shouldLoopUnitAnimation(state)) {
    return null;
  }

  switch (state) {
    case "attack":
      return timings.attack;
    case "hit":
      return timings.hit;
    case "victory":
      return timings.victory;
    case "defeat":
      return timings.defeat;
    default:
      return null;
  }
}
