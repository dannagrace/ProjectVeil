export interface AssetLoadFailureEvent {
  assetType: "sprite" | "audio";
  assetPath: string;
  retryCount: number;
  maxRetryCount: number;
  critical: boolean;
  finalFailure: boolean;
  errorMessage: string;
}

interface AssetLoadResilienceRuntimeDependencies {
  setTimeout(handler: () => void, delayMs: number): ReturnType<typeof globalThis.setTimeout>;
  clearTimeout(handle: ReturnType<typeof globalThis.setTimeout>): void;
}

interface RetryAssetLoadOptions<T> {
  assetType: AssetLoadFailureEvent["assetType"];
  assetPath: string;
  critical: boolean;
  load: () => Promise<T>;
  fallback?: (() => Promise<T | null>) | undefined;
}

const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

const defaultRuntimeDependencies: AssetLoadResilienceRuntimeDependencies = {
  setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle)
};

let runtimeDependencies = defaultRuntimeDependencies;
let failureReporter: ((event: AssetLoadFailureEvent) => void) | null = null;
const failureListeners = new Set<(event: AssetLoadFailureEvent) => void>();

export function configureAssetLoadResilienceRuntimeDependencies(
  overrides: Partial<AssetLoadResilienceRuntimeDependencies>
): void {
  runtimeDependencies = {
    ...runtimeDependencies,
    ...overrides
  };
}

export function setAssetLoadFailureReporter(
  reporter: ((event: AssetLoadFailureEvent) => void) | null
): void {
  failureReporter = reporter;
}

export function subscribeAssetLoadFailures(
  listener: (event: AssetLoadFailureEvent) => void
): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

export function resetAssetLoadResilienceRuntimeForTests(): void {
  runtimeDependencies = defaultRuntimeDependencies;
  failureReporter = null;
  failureListeners.clear();
}

export async function retryAssetLoad<T>(options: RetryAssetLoadOptions<T>): Promise<T | null> {
  const maxRetryCount = options.critical ? RETRY_DELAYS_MS.length : 0;

  for (let retryCount = 0; retryCount <= maxRetryCount; retryCount += 1) {
    try {
      return await options.load();
    } catch (error) {
      const event: AssetLoadFailureEvent = {
        assetType: options.assetType,
        assetPath: options.assetPath,
        retryCount,
        maxRetryCount,
        critical: options.critical,
        finalFailure: retryCount >= maxRetryCount,
        errorMessage: error instanceof Error ? error.message : String(error)
      };
      failureReporter?.(event);
      for (const listener of failureListeners) {
        listener(event);
      }

      if (retryCount >= maxRetryCount) {
        return options.fallback ? await options.fallback() : null;
      }

      const retryDelayMs = RETRY_DELAYS_MS[retryCount] ?? 4000;
      await waitFor(retryDelayMs);
    }
  }

  return options.fallback ? await options.fallback() : null;
}

function waitFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    runtimeDependencies.setTimeout(() => {
      resolve();
    }, delayMs);
  });
}
