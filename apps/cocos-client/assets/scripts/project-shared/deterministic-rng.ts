export interface DeterministicRandomStep {
  nextSeed: number;
  value: number;
}

const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_RANGE = 0x100000000;
const DEFAULT_DETERMINISTIC_SEED = 1;

export function normalizeDeterministicSeed(seed: number, fallback = DEFAULT_DETERMINISTIC_SEED): number {
  if (!Number.isFinite(seed)) {
    return fallback >>> 0;
  }

  return Math.floor(seed) >>> 0;
}

function advanceSeed(seed: number): number {
  return (Math.imul(seed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
}

export function nextDeterministicRandom(seed: number): DeterministicRandomStep {
  const nextSeed = advanceSeed(normalizeDeterministicSeed(seed));
  return {
    nextSeed,
    value: nextSeed / UINT32_RANGE
  };
}

export function createDeterministicRandomGenerator(seed: number): () => number {
  let nextSeed = normalizeDeterministicSeed(seed);
  return () => {
    const step = nextDeterministicRandom(nextSeed);
    nextSeed = step.nextSeed;
    return step.value;
  };
}
