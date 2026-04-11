import { normalizeClientVersion } from "../../../../packages/shared/src/index.ts";

export const DEFAULT_COCOS_CLIENT_VERSION = "1.0.3";

interface CocosClientVersionEnvironmentLike {
  __PROJECT_VEIL_RUNTIME_CONFIG__?: {
    clientVersion?: unknown;
  };
  process?: {
    env?: Record<string, string | undefined>;
  };
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" ? normalizeClientVersion(value) : null;
}

export function resolveCocosClientVersion(
  environment: CocosClientVersionEnvironmentLike = globalThis as CocosClientVersionEnvironmentLike
): string {
  return (
    normalizeString(environment.__PROJECT_VEIL_RUNTIME_CONFIG__?.clientVersion) ??
    normalizeString(environment.process?.env?.VEIL_COCOS_CLIENT_VERSION) ??
    DEFAULT_COCOS_CLIENT_VERSION
  );
}
