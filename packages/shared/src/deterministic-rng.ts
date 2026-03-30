export interface DeterministicRandomStep {
  nextSeed: number;
  value: number;
}

export function nextDeterministicRandom(seed: number): DeterministicRandomStep {
  const nextSeed = (seed * 1664525 + 1013904223) >>> 0;
  return {
    nextSeed,
    value: nextSeed / 0x100000000
  };
}
