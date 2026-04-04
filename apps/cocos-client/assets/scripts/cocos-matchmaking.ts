import { readStoredCocosAuthSession, type CocosStoredAuthSession } from "./cocos-session-launch.ts";
import { resolveCocosApiBaseUrl, buildCocosAuthHeaders } from "./cocos-lobby.ts";

type FetchLike = typeof fetch;

export type CocosMatchmakingIdleStatus = { status: "idle" };
export type CocosMatchmakingQueuedStatus = { status: "queued"; position: number; estimatedWaitSeconds: number };
export type CocosMatchmakingMatchedStatus = {
  status: "matched";
  roomId: string;
  playerIds: [string, string];
  seedOverride: number;
};

export type CocosMatchmakingStatus =
  | CocosMatchmakingIdleStatus
  | CocosMatchmakingQueuedStatus
  | CocosMatchmakingMatchedStatus;
export type CocosMatchmakingStatusResponse = CocosMatchmakingStatus;

export interface CocosMatchmakingPollController {
  stop(): void;
}

async function fetchJson(url: string, init?: RequestInit, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    let errorCode = "unknown";
    try {
      const payload = (await response.json()) as { error?: { code?: string } };
      errorCode = payload.error?.code?.trim() || errorCode;
    } catch {
      errorCode = "unknown";
    }
    throw new Error(`cocos_request_failed:${response.status}:${errorCode}`);
  }
  return (await response.json()) as unknown;
}

function authSessionFromOptions(
  storage: Pick<Storage, "getItem"> | null | undefined,
  explicit: CocosStoredAuthSession | null | undefined
): CocosStoredAuthSession | null {
  return explicit ?? readStoredCocosAuthSession(storage ?? null);
}

export async function readCocosMatchmakingStatus(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<CocosMatchmakingStatus> {
  const storage = options?.storage ?? null;
  const authSession = authSessionFromOptions(storage, options?.authSession ?? null);
  const endpoint = resolveCocosApiBaseUrl(remoteUrl) + "/api/matchmaking/status";
  const payload = (await fetchJson(
    endpoint,
    { headers: buildCocosAuthHeaders(authSession?.token) },
    options?.fetchImpl
  )) as CocosMatchmakingStatus;
  return payload;
}

export async function enqueueCocosMatchmaking(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<CocosMatchmakingStatus> {
  const storage = options?.storage ?? null;
  const authSession = authSessionFromOptions(storage, options?.authSession ?? null);
  const endpoint = resolveCocosApiBaseUrl(remoteUrl) + "/api/matchmaking/enqueue";
  const payload = (await fetchJson(
    endpoint,
    { method: "POST", headers: { "Content-Type": "application/json", ...buildCocosAuthHeaders(authSession?.token) } },
    options?.fetchImpl
  )) as CocosMatchmakingStatus;
  return payload;
}

export async function cancelCocosMatchmaking(
  remoteUrl: string,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem"> | null;
    authSession?: CocosStoredAuthSession | null;
  }
): Promise<"dequeued" | "idle"> {
  const storage = options?.storage ?? null;
  const authSession = authSessionFromOptions(storage, options?.authSession ?? null);
  const endpoint = resolveCocosApiBaseUrl(remoteUrl) + "/api/matchmaking/cancel";
  const payload = (await fetchJson(
    endpoint,
    { method: "DELETE", headers: buildCocosAuthHeaders(authSession?.token) },
    options?.fetchImpl
  )) as { status?: string };
  return payload.status === "dequeued" ? "dequeued" : "idle";
}

export function startCocosMatchmakingStatusPolling(
  remoteUrl: string,
  onUpdate: (status: CocosMatchmakingStatus) => void,
  options?: {
    fetchImpl?: FetchLike;
    storage?: Pick<Storage, "getItem"> | null;
    authSession?: CocosStoredAuthSession | null;
    pollIntervalMs?: number;
    stopOnMatched?: boolean;
    stopOnIdle?: boolean;
  }
): CocosMatchmakingPollController {
  const pollIntervalMs = Math.max(250, Math.floor(options?.pollIntervalMs ?? 1500));
  const stopOnMatched = options?.stopOnMatched ?? true;
  const stopOnIdle = options?.stopOnIdle ?? false;
  let stopped = false;
  let terminal = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const status = await readCocosMatchmakingStatus(remoteUrl, {
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        storage: options?.storage ?? null,
        authSession: options?.authSession ?? null
      });
      onUpdate(status);
      if ((stopOnMatched && status.status === "matched") || (stopOnIdle && status.status === "idle")) {
        terminal = true;
        return;
      }
    } catch {
      // ignore and retry
    } finally {
      if (!stopped && !terminal) {
        timer = setTimeout(tick, pollIntervalMs);
      }
    }
  }

  void tick();

  return {
    stop(): void {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  };
}
