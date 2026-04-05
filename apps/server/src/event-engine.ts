import type { IncomingMessage, ServerResponse } from "node:http";
import defendTheBridgeDocument from "../../../configs/event-defend-the-bridge.json";
import seasonalEventsDocument from "../../../configs/seasonal-events.json";
import type {
  EventLeaderboardEntry,
  SeasonalEventDefinition,
  SeasonalEventLeaderboardRewardTier,
  SeasonalEventObjective,
  SeasonalEventReward,
  SeasonalEventState
} from "../../../packages/shared/src/index";
import { validateAuthSessionFromRequest } from "./auth";
import type { PlayerAccountSnapshot, RoomSnapshotStore } from "./persistence";

interface SeasonalEventSummaryDocument {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  durationDays?: number | null;
  bannerText?: string | null;
  leaderboard?: {
    size?: number | null;
  } | null;
}

interface SeasonalEventsDocument {
  events?: SeasonalEventSummaryDocument[] | null;
}

interface SeasonalEventDefinitionDocument {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  durationDays?: number | null;
  bannerText?: string | null;
  objectives?: Partial<SeasonalEventObjective>[] | null;
  rewards?: Partial<SeasonalEventReward>[] | null;
  leaderboard?: {
    size?: number | null;
    rewardTiers?: Partial<SeasonalEventLeaderboardRewardTier>[] | null;
  } | null;
}

export interface RegisterEventRoutesOptions {
  now?: () => Date;
  eventIndexDocument?: SeasonalEventsDocument;
  eventDocuments?: Record<string, SeasonalEventDefinitionDocument>;
}

export interface SeasonalEventActionInput {
  actionId: string;
  actionType: SeasonalEventObjective["actionType"];
  dungeonId?: string;
  occurredAt?: string;
}

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

function sendUnauthorized(
  response: ServerResponse,
  errorCode: "unauthorized" | "token_expired" | "token_kind_invalid" | "session_revoked" = "unauthorized"
): void {
  sendJson(response, 401, {
    error: {
      code: errorCode,
      message:
        errorCode === "token_expired"
          ? "Auth token has expired"
          : errorCode === "session_revoked"
            ? "Auth session has been revoked"
            : "Guest auth session is missing or invalid"
    }
  });
}

function sendAccountBanned(response: ServerResponse, ban?: { banReason?: string; banExpiry?: string } | null): void {
  sendJson(response, 403, {
    error: {
      code: "account_banned",
      message: "Account is banned",
      reason: ban?.banReason ?? "No reason provided",
      ...(ban?.banExpiry ? { expiry: ban.banExpiry } : {})
    }
  });
}

async function requireAuthSession(request: IncomingMessage, response: ServerResponse, store: RoomSnapshotStore | null) {
  const result = await validateAuthSessionFromRequest(request, store);
  if (!result.session) {
    if (result.errorCode === "account_banned") {
      sendAccountBanned(response, result.ban);
      return null;
    }
    sendUnauthorized(response, result.errorCode ?? "unauthorized");
    return null;
  }

  return result.session;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeTimestamp(value: string | null | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }

  return parsed.toISOString();
}

function normalizeNonNegativeInteger(value: number | null | undefined, field: string, minimum = 0): number {
  const normalized = Math.floor(value ?? Number.NaN);
  if (!Number.isFinite(normalized) || normalized < minimum) {
    throw new Error(`${field} must be an integer >= ${minimum}`);
  }
  return normalized;
}

function normalizeEventReward(rawReward: Partial<SeasonalEventReward> | null | undefined, field: string): SeasonalEventReward {
  const candidate = rawReward ?? {};
  const id = candidate.id?.trim();
  const name = candidate.name?.trim();
  if (!id || !name) {
    throw new Error(`${field} must define id and name`);
  }

  return {
    id,
    name,
    pointsRequired: normalizeNonNegativeInteger(candidate.pointsRequired, `${field}.pointsRequired`, 1),
    kind: candidate.kind ?? "gems",
    ...(candidate.gems != null ? { gems: normalizeNonNegativeInteger(candidate.gems, `${field}.gems`) } : {}),
    ...(candidate.resources
      ? {
          resources: {
            ...(candidate.resources.gold != null
              ? { gold: normalizeNonNegativeInteger(candidate.resources.gold, `${field}.resources.gold`) }
              : {}),
            ...(candidate.resources.wood != null
              ? { wood: normalizeNonNegativeInteger(candidate.resources.wood, `${field}.resources.wood`) }
              : {}),
            ...(candidate.resources.ore != null
              ? { ore: normalizeNonNegativeInteger(candidate.resources.ore, `${field}.resources.ore`) }
              : {})
          }
        }
      : {}),
    ...(candidate.badge?.trim() ? { badge: candidate.badge.trim() } : {}),
    ...(candidate.cosmeticId?.trim() ? { cosmeticId: candidate.cosmeticId.trim() } : {})
  };
}

function normalizeLeaderboardRewardTier(
  rawTier: Partial<SeasonalEventLeaderboardRewardTier> | null | undefined,
  field: string
): SeasonalEventLeaderboardRewardTier {
  const candidate = rawTier ?? {};
  const title = candidate.title?.trim();
  if (!title) {
    throw new Error(`${field}.title is required`);
  }

  return {
    rankStart: normalizeNonNegativeInteger(candidate.rankStart, `${field}.rankStart`, 1),
    rankEnd: normalizeNonNegativeInteger(candidate.rankEnd, `${field}.rankEnd`, 1),
    title,
    ...(candidate.badge?.trim() ? { badge: candidate.badge.trim() } : {}),
    ...(candidate.cosmeticId?.trim() ? { cosmeticId: candidate.cosmeticId.trim() } : {})
  };
}

function normalizeObjective(
  rawObjective: Partial<SeasonalEventObjective> | null | undefined,
  field: string
): SeasonalEventObjective {
  const candidate = rawObjective ?? {};
  const id = candidate.id?.trim();
  const description = candidate.description?.trim();
  if (!id || !description) {
    throw new Error(`${field} must define id and description`);
  }

  return {
    id,
    description,
    actionType: candidate.actionType ?? "daily_dungeon_reward_claimed",
    points: normalizeNonNegativeInteger(candidate.points, `${field}.points`, 1),
    ...(candidate.dungeonId?.trim() ? { dungeonId: candidate.dungeonId.trim() } : {})
  };
}

const DEFAULT_EVENT_DOCUMENTS: Record<string, SeasonalEventDefinitionDocument> = {
  "defend-the-bridge": defendTheBridgeDocument as SeasonalEventDefinitionDocument
};

export function resolveSeasonalEvents(
  eventIndexDocument: SeasonalEventsDocument = seasonalEventsDocument as SeasonalEventsDocument,
  eventDocuments: Record<string, SeasonalEventDefinitionDocument> = DEFAULT_EVENT_DOCUMENTS
): SeasonalEventDefinition[] {
  const summaries = eventIndexDocument.events ?? [];
  if (summaries.length === 0) {
    return [];
  }

  return summaries.map((summary, index) => {
    const id = summary.id?.trim();
    if (!id) {
      throw new Error(`seasonal event summary[${index}] id is required`);
    }

    const detail = eventDocuments[id];
    if (!detail) {
      throw new Error(`seasonal event ${id} is missing a detail document`);
    }

    const rewardTiers = (detail.leaderboard?.rewardTiers ?? []).map((tier, tierIndex) =>
      normalizeLeaderboardRewardTier(tier, `seasonal event ${id} leaderboard.rewardTiers[${tierIndex}]`)
    );

    return {
      id,
      name: detail.name?.trim() || summary.name?.trim() || id,
      description: detail.description?.trim() || summary.description?.trim() || "",
      startsAt: normalizeTimestamp(detail.startsAt ?? summary.startsAt, `seasonal event ${id}.startsAt`),
      endsAt: normalizeTimestamp(detail.endsAt ?? summary.endsAt, `seasonal event ${id}.endsAt`),
      durationDays: normalizeNonNegativeInteger(
        detail.durationDays ?? summary.durationDays,
        `seasonal event ${id}.durationDays`,
        1
      ),
      bannerText: detail.bannerText?.trim() || summary.bannerText?.trim() || "",
      objectives: (detail.objectives ?? []).map((objective, objectiveIndex) =>
        normalizeObjective(objective, `seasonal event ${id} objective[${objectiveIndex}]`)
      ),
      rewards: (detail.rewards ?? []).map((reward, rewardIndex) =>
        normalizeEventReward(reward, `seasonal event ${id} reward[${rewardIndex}]`)
      ),
      leaderboard: {
        size: normalizeNonNegativeInteger(
          detail.leaderboard?.size ?? summary.leaderboard?.size,
          `seasonal event ${id}.leaderboard.size`,
          1
        ),
        rewardTiers
      }
    };
  });
}

export function getActiveSeasonalEvents(events: SeasonalEventDefinition[], now = new Date()): SeasonalEventDefinition[] {
  const currentTime = now.getTime();
  return events.filter((event) => {
    const startsAt = new Date(event.startsAt).getTime();
    const endsAt = new Date(event.endsAt).getTime();
    return startsAt <= currentTime && currentTime < endsAt;
  });
}

export function findSeasonalEventState(
  seasonalEventStates: SeasonalEventState[] | null | undefined,
  eventId: string
): SeasonalEventState | undefined {
  return seasonalEventStates?.find((state) => state.eventId === eventId);
}

function upsertSeasonalEventState(
  seasonalEventStates: SeasonalEventState[] | null | undefined,
  nextState: SeasonalEventState
): SeasonalEventState[] {
  const remainingStates = (seasonalEventStates ?? []).filter((state) => state.eventId !== nextState.eventId);
  return [...remainingStates, nextState].sort((left, right) => left.eventId.localeCompare(right.eventId));
}

export function applySeasonalEventProgress(
  event: SeasonalEventDefinition,
  currentState: SeasonalEventState | null | undefined,
  action: SeasonalEventActionInput,
  now = new Date()
): { state: SeasonalEventState; objective: SeasonalEventObjective; delta: number } | null {
  const objective = event.objectives.find(
    (entry) =>
      entry.actionType === action.actionType && (!entry.dungeonId || !action.dungeonId || entry.dungeonId === action.dungeonId)
  );
  if (!objective) {
    return null;
  }

  const actionId = action.actionId.trim();
  if (!actionId) {
    throw new Error("seasonal_event_action_id_required");
  }

  if (currentState?.appliedActionIds.includes(actionId)) {
    return null;
  }

  const appliedActionIds = Array.from(new Set([...(currentState?.appliedActionIds ?? []), actionId])).sort((left, right) =>
    left.localeCompare(right)
  );
  const lastUpdatedAt = action.occurredAt ? normalizeTimestamp(action.occurredAt, "seasonal event action occurredAt") : now.toISOString();

  return {
    objective,
    delta: objective.points,
    state: {
      eventId: event.id,
      points: Math.max(0, (currentState?.points ?? 0) + objective.points),
      claimedRewardIds: [...(currentState?.claimedRewardIds ?? [])],
      appliedActionIds,
      lastUpdatedAt
    }
  };
}

export function claimSeasonalEventReward(
  event: SeasonalEventDefinition,
  currentState: SeasonalEventState | null | undefined,
  rewardId: string,
  now = new Date()
): { state: SeasonalEventState; reward: SeasonalEventReward } {
  const reward = event.rewards.find((entry) => entry.id === rewardId.trim());
  if (!reward) {
    throw new Error("seasonal_event_reward_not_found");
  }

  const state = currentState;
  if (!state) {
    throw new Error("seasonal_event_reward_locked");
  }
  if (state.points < reward.pointsRequired) {
    throw new Error("seasonal_event_reward_locked");
  }
  if (state.claimedRewardIds.includes(reward.id)) {
    throw new Error("seasonal_event_reward_already_claimed");
  }

  return {
    reward,
    state: {
      ...state,
      claimedRewardIds: [...state.claimedRewardIds, reward.id].sort((left, right) => left.localeCompare(right)),
      lastUpdatedAt: now.toISOString()
    }
  };
}

function rewardPreviewForRank(
  leaderboardRewardTiers: SeasonalEventDefinition["leaderboard"]["rewardTiers"],
  rank: number
): string | undefined {
  return leaderboardRewardTiers.find((tier) => tier.rankStart <= rank && rank <= tier.rankEnd)?.title;
}

export function buildEventLeaderboard(
  event: SeasonalEventDefinition,
  accounts: PlayerAccountSnapshot[],
  limit = event.leaderboard.size
): EventLeaderboardEntry[] {
  return accounts
    .map((account) => {
      const state = findSeasonalEventState(account.seasonalEventStates, event.id);
      if (!state || state.points <= 0) {
        return null;
      }

      return {
        playerId: account.playerId,
        displayName: account.displayName,
        points: state.points,
        lastUpdatedAt: state.lastUpdatedAt
      };
    })
    .filter(
      (
        entry
      ): entry is {
        playerId: string;
        displayName: string;
        points: number;
        lastUpdatedAt: string;
      } => Boolean(entry)
    )
    .sort(
      (left, right) =>
        right.points - left.points ||
        left.lastUpdatedAt.localeCompare(right.lastUpdatedAt) ||
        left.playerId.localeCompare(right.playerId)
    )
    .slice(0, Math.max(1, limit))
    .map((entry, index) => {
      const rewardPreview = rewardPreviewForRank(event.leaderboard.rewardTiers, index + 1);
      return {
        rank: index + 1,
        ...entry,
        ...(rewardPreview ? { rewardPreview } : {})
      };
    });
}

function toEventResponse(event: SeasonalEventDefinition, account: PlayerAccountSnapshot, leaderboard: EventLeaderboardEntry[], now: Date) {
  const state = findSeasonalEventState(account.seasonalEventStates, event.id);
  return {
    ...event,
    remainingMs: Math.max(0, new Date(event.endsAt).getTime() - now.getTime()),
    player: {
      points: state?.points ?? 0,
      claimedRewardIds: state?.claimedRewardIds ?? [],
      claimableRewardIds: event.rewards
        .filter((reward) => (state?.points ?? 0) >= reward.pointsRequired && !(state?.claimedRewardIds ?? []).includes(reward.id))
        .map((reward) => reward.id)
    },
    leaderboard: {
      entries: leaderboard,
      topThree: leaderboard.slice(0, 3)
    }
  };
}

export function registerEventRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null,
  options: RegisterEventRoutesOptions = {}
): void {
  const nowFactory = options.now ?? (() => new Date());
  const events = resolveSeasonalEvents(options.eventIndexDocument, options.eventDocuments);

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/events/active", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const now = nowFactory();
      const activeEvents = getActiveSeasonalEvents(events, now);
      const account = store
        ? ((await store.loadPlayerAccount(authSession.playerId)) ??
          (await store.ensurePlayerAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName
          })))
        : {
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            globalResources: { gold: 0, wood: 0, ore: 0 },
            achievements: [],
            recentEventLog: [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
          };
      const accounts = store ? await store.listPlayerAccounts() : [];

      sendJson(response, 200, {
        events: activeEvents.map((event) => toEventResponse(event, account, buildEventLeaderboard(event, accounts), now))
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/events/claim", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 503, {
        error: {
          code: "seasonal_event_persistence_unavailable",
          message: "Seasonal event claims require configured room persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { eventId?: string | null; rewardId?: string | null };
      const eventId = body.eventId?.trim();
      const rewardId = body.rewardId?.trim();
      if (!eventId || !rewardId) {
        sendJson(response, 400, {
          error: {
            code: "seasonal_event_claim_invalid",
            message: "eventId and rewardId are required"
          }
        });
        return;
      }

      const now = nowFactory();
      const event = getActiveSeasonalEvents(events, now).find((entry) => entry.id === eventId);
      if (!event) {
        sendJson(response, 404, {
          error: {
            code: "seasonal_event_not_found",
            message: "Seasonal event was not found or is not active"
          }
        });
        return;
      }

      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const claim = claimSeasonalEventReward(event, findSeasonalEventState(account.seasonalEventStates, event.id), rewardId, now);
      const nextResources = {
        gold: Math.max(0, (account.globalResources.gold ?? 0) + (claim.reward.resources?.gold ?? 0)),
        wood: Math.max(0, (account.globalResources.wood ?? 0) + (claim.reward.resources?.wood ?? 0)),
        ore: Math.max(0, (account.globalResources.ore ?? 0) + (claim.reward.resources?.ore ?? 0))
      };
      const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
        gems: Math.max(0, (account.gems ?? 0) + (claim.reward.gems ?? 0)),
        globalResources: nextResources,
        ...(claim.reward.badge
          ? {
              seasonBadges: Array.from(new Set([...(account.seasonBadges ?? []), claim.reward.badge])).sort((left, right) =>
                left.localeCompare(right)
              )
            }
          : {}),
        seasonalEventStates: upsertSeasonalEventState(account.seasonalEventStates, claim.state)
      });

      sendJson(response, 200, {
        claimed: true,
        reward: claim.reward,
        event: toEventResponse(event, nextAccount, buildEventLeaderboard(event, await store.listPlayerAccounts()), now)
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          error: {
            code: "invalid_json",
            message: "Request body must be valid JSON"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "seasonal_event_reward_not_found") {
        sendJson(response, 404, {
          error: {
            code: "seasonal_event_reward_not_found",
            message: "Seasonal event reward was not found"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "seasonal_event_reward_locked") {
        sendJson(response, 409, {
          error: {
            code: "seasonal_event_reward_locked",
            message: "Seasonal event reward is not claimable yet"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "seasonal_event_reward_already_claimed") {
        sendJson(response, 409, {
          error: {
            code: "seasonal_event_reward_already_claimed",
            message: "Seasonal event reward has already been claimed"
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
