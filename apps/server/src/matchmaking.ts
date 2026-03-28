import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMatchmakingHeroSnapshot,
  estimateMatchmakingWaitSeconds,
  normalizeEloRating,
  normalizeMatchmakingRequest,
  selectBestMatchPair,
  type HeroState,
  type MatchResult,
  type MatchmakingRequest
} from "../../../packages/shared/src/index";
import { validateAuthSessionFromRequest } from "./auth";
import type { RoomSnapshotStore } from "./persistence";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function toErrorPayload(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "error" : "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

async function requireAuthSession(
  request: IncomingMessage,
  response: ServerResponse,
  store: RoomSnapshotStore | null
): Promise<{ playerId: string; displayName: string } | null> {
  const result = await validateAuthSessionFromRequest(request, store);
  if (result.session) {
    return result.session;
  }

  sendJson(response, 401, {
    error: {
      code: result.errorCode ?? "unauthorized",
      message: "Authentication required"
    }
  });
  return null;
}

function resolveHeroFromRoomSnapshot(playerId: string, heroCandidates: HeroState[]): HeroState | null {
  const primaryHero = heroCandidates.find((hero) => hero.playerId === playerId);
  return primaryHero ?? null;
}

async function resolveMatchmakingHero(
  store: RoomSnapshotStore,
  playerId: string,
  preferredRoomId?: string
): Promise<HeroState | null> {
  const roomId = preferredRoomId?.trim();
  if (roomId) {
    const roomSnapshot = await store.load(roomId);
    const hero = roomSnapshot ? resolveHeroFromRoomSnapshot(playerId, roomSnapshot.state.heroes) : null;
    if (hero) {
      return hero;
    }
  }

  const archives = await store.loadPlayerHeroArchives([playerId]);
  const archivedHero = archives.find((archive) => archive.playerId === playerId)?.hero ?? null;
  return archivedHero;
}

interface MatchmakingStatusQueued {
  status: "queued";
  position: number;
  estimatedWaitSeconds: number;
}

interface MatchmakingStatusMatched {
  status: "matched";
  roomId: string;
  playerIds: [string, string];
  seedOverride: number;
}

interface MatchmakingStatusIdle {
  status: "idle";
}

type MatchmakingStatusResponse = MatchmakingStatusQueued | MatchmakingStatusMatched | MatchmakingStatusIdle;

export class MatchmakingService {
  private readonly queueByPlayerId = new Map<string, MatchmakingRequest>();
  private readonly resultsByPlayerId = new Map<string, MatchResult>();
  private nextMatchSequence = 1;

  enqueue(request: MatchmakingRequest, now = new Date()): MatchmakingStatusQueued {
    const normalized = normalizeMatchmakingRequest(request);
    this.resultsByPlayerId.delete(normalized.playerId);

    this.queueByPlayerId.set(normalized.playerId, normalized);
    const status = this.getQueuedStatus(normalized.playerId);
    this.matchQueuedPlayers(now);
    if (!status) {
      throw new Error(`Failed to enqueue player for matchmaking: ${normalized.playerId}`);
    }
    return status;
  }

  dequeue(playerId: string): boolean {
    const normalizedPlayerId = playerId.trim();
    this.resultsByPlayerId.delete(normalizedPlayerId);
    return this.queueByPlayerId.delete(normalizedPlayerId);
  }

  getStatus(playerId: string): MatchmakingStatusResponse {
    const normalizedPlayerId = playerId.trim();
    const result = this.resultsByPlayerId.get(normalizedPlayerId);
    if (result) {
      return {
        status: "matched",
        roomId: result.roomId,
        playerIds: result.playerIds,
        seedOverride: result.seedOverride
      };
    }

    return this.getQueuedStatus(normalizedPlayerId) ?? { status: "idle" };
  }

  private getQueuedStatus(playerId: string): MatchmakingStatusQueued | null {
    const normalizedPlayerId = playerId.trim();
    const queue = Array.from(this.queueByPlayerId.values()).sort(
      (left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.playerId.localeCompare(right.playerId)
    );
    const position = queue.findIndex((entry) => entry.playerId === normalizedPlayerId);
    if (position < 0) {
      return null;
    }

    return {
      status: "queued",
      position: position + 1,
      estimatedWaitSeconds: estimateMatchmakingWaitSeconds(position + 1)
    };
  }

  private createMatchResult(players: [MatchmakingRequest, MatchmakingRequest], now: Date): MatchResult {
    const orderedPlayerIds = [players[0].playerId, players[1].playerId].sort() as [string, string];
    const sequence = this.nextMatchSequence;
    this.nextMatchSequence += 1;

    return {
      roomId: `pvp-match-${now.getTime()}-${sequence}`,
      playerIds: orderedPlayerIds,
      seedOverride: ((now.getTime() + sequence) >>> 0) || sequence
    };
  }

  private matchQueuedPlayers(now: Date): void {
    while (this.queueByPlayerId.size >= 2) {
      const queue = Array.from(this.queueByPlayerId.values());
      const selection = selectBestMatchPair(queue, now);
      if (!selection) {
        return;
      }

      const [left, right] = selection.players;
      this.queueByPlayerId.delete(left.playerId);
      this.queueByPlayerId.delete(right.playerId);

      const result = this.createMatchResult([left, right], now);
      this.resultsByPlayerId.set(left.playerId, result);
      this.resultsByPlayerId.set(right.playerId, result);
    }
  }
}

let configuredMatchmakingService = new MatchmakingService();

export function resetMatchmakingService(): void {
  configuredMatchmakingService = new MatchmakingService();
}

export function registerMatchmakingRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    delete: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  options: {
    store: RoomSnapshotStore | null;
    service?: MatchmakingService;
  }
): void {
  const service = options.service ?? configuredMatchmakingService;

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.post("/api/matchmaking/enqueue", async (request, response) => {
    const authSession = await requireAuthSession(request, response, options.store);
    if (!authSession) {
      return;
    }

    if (!options.store) {
      sendJson(response, 503, {
        error: {
          code: "matchmaking_store_unavailable",
          message: "Matchmaking persistence is unavailable"
        }
      });
      return;
    }

    try {
      const account =
        (await options.store.loadPlayerAccount(authSession.playerId)) ??
        (await options.store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const hero = await resolveMatchmakingHero(options.store, authSession.playerId, account.lastRoomId);
      if (!hero) {
        sendJson(response, 409, {
          error: {
            code: "matchmaking_hero_not_found",
            message: "Player hero snapshot is required before entering matchmaking"
          }
        });
        return;
      }

      const queued = service.enqueue({
        playerId: authSession.playerId,
        heroSnapshot: createMatchmakingHeroSnapshot(hero),
        rating: normalizeEloRating(account.eloRating),
        enqueuedAt: new Date().toISOString()
      });
      sendJson(response, 200, queued);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.delete("/api/matchmaking/dequeue", async (request, response) => {
    const authSession = await requireAuthSession(request, response, options.store);
    if (!authSession) {
      return;
    }

    try {
      sendJson(response, 200, {
        status: service.dequeue(authSession.playerId) ? "dequeued" : "idle"
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/matchmaking/status", async (request, response) => {
    const authSession = await requireAuthSession(request, response, options.store);
    if (!authSession) {
      return;
    }

    try {
      sendJson(response, 200, service.getStatus(authSession.playerId));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
