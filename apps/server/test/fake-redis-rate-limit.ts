export function createFakeRedisRateLimitClient(now: () => number = Date.now): {
  eval(script: string, numKeys: number, key: string, max: string, windowMs: string): Promise<[number, number]>;
} {
  const counters = new Map<string, { value: number; expiresAt: number }>();

  return {
    async eval(_script: string, _numKeys: number, key: string, max: string, windowMs: string): Promise<[number, number]> {
      const currentTime = now();
      const configuredWindowMs = Number(windowMs);
      const existing = counters.get(key);
      if (!existing || existing.expiresAt <= currentTime) {
        counters.set(key, {
          value: 1,
          expiresAt: currentTime + configuredWindowMs
        });
        return [1, configuredWindowMs];
      }

      existing.value += 1;
      counters.set(key, existing);
      const ttlMs = Math.max(1, existing.expiresAt - currentTime);
      return existing.value > Number(max) ? [0, ttlMs] : [1, ttlMs];
    }
  };
}
