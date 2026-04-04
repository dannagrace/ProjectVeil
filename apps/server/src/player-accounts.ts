import type { IncomingMessage, ServerResponse } from "node:http";
import {
  appendEventLogEntries,
  applyBattleReplayPlaybackCommand,
  buildPlayerBattleReportCenter,
  buildPlayerProgressionSnapshot,
  canSkipTutorial,
  DEFAULT_TUTORIAL_STEP,
  findPlayerBattleReplaySummary,
  getAchievementDefinitions,
  isTutorialComplete,
  normalizeAchievementProgressQuery,
  normalizeEventLogQuery,
  queryPlayerBattleReplaySummaries,
  queryAchievementProgress,
  queryEventLogEntries,
  type PlayerBattleReplaySummary,
  type SeasonalEventState,
  type TutorialProgressAction
} from "../../../packages/shared/src/index";
import {
  createDailyQuestClaimEventLogEntry,
  loadDailyQuestBoard
} from "./daily-quests";
import { resolveBattlePassConfig } from "./battle-pass";
import { emitAnalyticsEvent } from "./analytics";
import {
  cachePlayerAccountAuthState,
  hashAccountPassword,
  issueNextAuthSession,
  revokeGuestAuthSession,
  readGuestAuthTokenFromRequest,
  validateAuthSessionFromRequest,
  verifyAccountPassword
} from "./auth";
import { recordAuthInvalidCredentials, removeAuthAccountSession, removeAuthAccountSessionsForPlayer } from "./observability";
import type {
  PlayerAccountProfilePatch,
  PlayerAccountSnapshot,
  PlayerEventHistoryQuery,
  RoomSnapshotStore
} from "./persistence";
import { getDailyRewardDateKey, getPreviousDailyRewardDateKey, resolveDailyRewardForStreak } from "./daily-rewards";
import {
  applySeasonalEventProgress,
  findSeasonalEventState,
  getActiveSeasonalEvents,
  resolveSeasonalEvents
} from "./event-engine";
import { resolveFeatureEntitlementsForPlayer, resolveFeatureFlagsForPlayer } from "./feature-flags";
import {
  buildCampaignMissionStates,
  buildDailyDungeonSummary,
  claimDailyDungeonRunReward,
  completeCampaignMission,
  resolveCampaignConfig,
  resolveDailyDungeonConfig,
  startDailyDungeonRun
} from "./pve-content";
import { decryptWechatPhoneNumber, validateWechatSignature } from "./wechat-session-key";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "Player account route not found"
    }
  });
}

function toErrorPayload(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "error" : "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "payload_too_large";
  }
}

interface WechatSignatureEnvelope {
  rawData?: string | null;
  signature?: string | null;
}

function readExpectedWechatAppId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const appId = env.WECHAT_APP_ID?.trim();
  return appId ? appId : undefined;
}

function logWechatValidationFailure(playerId: string, operation: string, reason: string): void {
  console.warn(`[WeChatValidation] player=${playerId} operation=${operation} reason=${reason}`);
}

function sendWechatValidationForbidden(response: ServerResponse, message = "WeChat signature validation failed"): void {
  sendJson(response, 403, {
    error: {
      code: "wechat_signature_invalid",
      message
    }
  });
}

function emitExperimentExposureForSurface(
  playerId: string,
  roomId: string,
  surface: string,
  experiments: Array<{
    experimentKey: string;
    experimentName: string;
    variant: string;
    bucket: number;
    owner: string;
    assigned: boolean;
  }>
): void {
  for (const experiment of experiments) {
    if (!experiment.assigned) {
      continue;
    }

    emitAnalyticsEvent("experiment_exposure", {
      playerId,
      roomId,
      payload: {
        experimentKey: experiment.experimentKey,
        experimentName: experiment.experimentName,
        variant: experiment.variant,
        bucket: experiment.bucket,
        surface,
        owner: experiment.owner
      }
    });
  }
}

function validateWechatSignatureEnvelope(
  response: ServerResponse,
  playerId: string,
  operation: string,
  signature?: WechatSignatureEnvelope | null
): boolean {
  if (!signature || typeof signature !== "object") {
    logWechatValidationFailure(playerId, operation, "missing_signature");
    sendWechatValidationForbidden(response);
    return false;
  }

  if (typeof signature.rawData !== "string" || typeof signature.signature !== "string") {
    logWechatValidationFailure(playerId, operation, "invalid_signature_payload");
    sendWechatValidationForbidden(response);
    return false;
  }

  if (!validateWechatSignature({ playerId, rawData: signature.rawData, signature: signature.signature })) {
    logWechatValidationFailure(playerId, operation, "signature_mismatch_or_missing_session_key");
    sendWechatValidationForbidden(response);
    return false;
  }

  return true;
}

const MAX_JSON_BODY_BYTES = 64 * 1024;

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    request.resume();
    throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseLimit(request: IncomingMessage): number | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get("limit");
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOffset(request: IncomingMessage): number | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get("offset");
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePlayerIdFilter(request: IncomingMessage): string | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get("playerId")?.trim();
  return value ? value : undefined;
}

function parseOptionalQueryParam(request: IncomingMessage, key: string): string | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function parseBooleanQueryParam(request: IncomingMessage, key: string): boolean | undefined {
  const value = parseOptionalQueryParam(request, key)?.toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function parseNumberQueryParam(request: IncomingMessage, key: string): number | undefined {
  const value = parseOptionalQueryParam(request, key);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTimestampQueryParam(request: IncomingMessage, key: string): string | undefined {
  const value = parseOptionalQueryParam(request, key);
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toReplayResponseFromRequest(
  account: PlayerAccountSnapshot,
  request: IncomingMessage
): { items: PlayerAccountSnapshot["recentBattleReplays"] } {
  const limit = parseLimit(request);
  const offset = parseOffset(request);
  const roomId = parseOptionalQueryParam(request, "roomId");
  const battleId = parseOptionalQueryParam(request, "battleId");
  const battleKind = parseOptionalQueryParam(request, "battleKind") as
    | PlayerBattleReplaySummary["battleKind"]
    | undefined;
  const playerCamp = parseOptionalQueryParam(request, "playerCamp") as
    | PlayerBattleReplaySummary["playerCamp"]
    | undefined;
  const heroId = parseOptionalQueryParam(request, "heroId");
  const opponentHeroId = parseOptionalQueryParam(request, "opponentHeroId");
  const neutralArmyId = parseOptionalQueryParam(request, "neutralArmyId");
  const result = parseOptionalQueryParam(request, "result") as
    | PlayerBattleReplaySummary["result"]
    | undefined;

  return {
    items: queryPlayerBattleReplaySummaries(account.recentBattleReplays, {
      ...(limit != null ? { limit } : {}),
      ...(offset != null ? { offset } : {}),
      ...(roomId ? { roomId } : {}),
      ...(battleId ? { battleId } : {}),
      ...(battleKind ? { battleKind } : {}),
      ...(playerCamp ? { playerCamp } : {}),
      ...(heroId ? { heroId } : {}),
      ...(opponentHeroId ? { opponentHeroId } : {}),
      ...(neutralArmyId ? { neutralArmyId } : {}),
      ...(result ? { result } : {})
    })
  };
}

function toBattleReportResponseFromRequest(account: PlayerAccountSnapshot, request: IncomingMessage) {
  const limit = parseLimit(request);
  const offset = parseOffset(request);
  const roomId = parseOptionalQueryParam(request, "roomId");
  const battleId = parseOptionalQueryParam(request, "battleId");
  const battleKind = parseOptionalQueryParam(request, "battleKind") as
    | PlayerBattleReplaySummary["battleKind"]
    | undefined;
  const playerCamp = parseOptionalQueryParam(request, "playerCamp") as
    | PlayerBattleReplaySummary["playerCamp"]
    | undefined;
  const heroId = parseOptionalQueryParam(request, "heroId");
  const opponentHeroId = parseOptionalQueryParam(request, "opponentHeroId");
  const neutralArmyId = parseOptionalQueryParam(request, "neutralArmyId");
  const result = parseOptionalQueryParam(request, "result") as
    | PlayerBattleReplaySummary["result"]
    | undefined;

  return buildPlayerBattleReportCenter(
    queryPlayerBattleReplaySummaries(account.recentBattleReplays, {
      ...(limit != null ? { limit } : {}),
      ...(offset != null ? { offset } : {}),
      ...(roomId ? { roomId } : {}),
      ...(battleId ? { battleId } : {}),
      ...(battleKind ? { battleKind } : {}),
      ...(playerCamp ? { playerCamp } : {}),
      ...(heroId ? { heroId } : {}),
      ...(opponentHeroId ? { opponentHeroId } : {}),
      ...(neutralArmyId ? { neutralArmyId } : {}),
      ...(result ? { result } : {})
    }),
    account.recentEventLog
  );
}

function withBattleReportCenter(account: PlayerAccountSnapshot): PlayerAccountSnapshot {
  return {
    ...account,
    battleReportCenter: buildPlayerBattleReportCenter(account.recentBattleReplays, account.recentEventLog)
  };
}

async function withDailyQuestBoard(
  account: PlayerAccountSnapshot,
  store: RoomSnapshotStore | null,
  enabled = false
): Promise<PlayerAccountSnapshot> {
  if (!store) {
    return account;
  }

  return {
    ...account,
    dailyQuestBoard: await loadDailyQuestBoard(
      store,
      account,
      new Date(),
      enabled && isTutorialComplete(account.tutorialStep)
    )
  };
}

function normalizeTutorialProgressAction(input: unknown, currentStep?: number | null): TutorialProgressAction {
  const raw = input as Partial<TutorialProgressAction> | null | undefined;
  const reason =
    raw?.reason === "skip" || raw?.reason === "complete" || raw?.reason === "advance" ? raw.reason : "advance";
  const step = raw?.step == null ? null : Math.floor(raw.step);

  if (step !== null && (!Number.isFinite(step) || step <= 0)) {
    throw new Error("tutorial_progress_invalid_step");
  }
  if (reason === "skip" && !canSkipTutorial(currentStep)) {
    throw new Error("tutorial_skip_locked");
  }
  if (reason === "advance" && step === null) {
    throw new Error("tutorial_progress_invalid_step");
  }

  return {
    step,
    reason
  };
}

function toReplayDetailResponse(
  account: PlayerAccountSnapshot,
  replayId?: string | null
): { replay: NonNullable<PlayerAccountSnapshot["recentBattleReplays"]>[number] } | null {
  const replay = findPlayerBattleReplaySummary(account.recentBattleReplays, replayId);
  return replay ? { replay } : null;
}

function toReplayPlaybackResponse(
  account: PlayerAccountSnapshot,
  request: IncomingMessage,
  replayId?: string | null
) {
  const replay = findPlayerBattleReplaySummary(account.recentBattleReplays, replayId);
  if (!replay) {
    return null;
  }

  const currentStepIndex = parseNumberQueryParam(request, "currentStepIndex");
  const status = parseOptionalQueryParam(request, "status") as "paused" | "playing" | undefined;
  const action = parseOptionalQueryParam(request, "action") as "play" | "pause" | "step" | "tick" | "reset" | undefined;
  const repeat = parseNumberQueryParam(request, "repeat");

  return {
    playback: applyBattleReplayPlaybackCommand(replay, {
      ...(currentStepIndex != null ? { currentStepIndex } : {}),
      ...(status ? { status } : {}),
      ...(action ? { action } : {}),
      ...(repeat != null ? { repeat } : {})
    })
  };
}

function toEventLogResponse(
  account: PlayerAccountSnapshot,
  request: IncomingMessage
): { items: PlayerAccountSnapshot["recentEventLog"] } {
  const query = normalizeEventLogQuery({
    limit: parseLimit(request) ?? undefined,
    category: parseOptionalQueryParam(request, "category") as
      | PlayerAccountSnapshot["recentEventLog"][number]["category"]
      | undefined,
    heroId: parseOptionalQueryParam(request, "heroId") ?? undefined,
    achievementId: parseOptionalQueryParam(request, "achievementId") as
      | PlayerAccountSnapshot["recentEventLog"][number]["achievementId"]
      | undefined,
    worldEventType: parseOptionalQueryParam(request, "worldEventType") as
      | PlayerAccountSnapshot["recentEventLog"][number]["worldEventType"]
      | undefined
  });

  return {
    items: queryEventLogEntries(account.recentEventLog, query)
  };
}

function toEventHistoryQuery(request: IncomingMessage): PlayerEventHistoryQuery {
  return normalizeEventLogQuery({
    limit: parseLimit(request) ?? undefined,
    offset: parseOffset(request) ?? undefined,
    category: parseOptionalQueryParam(request, "category") as PlayerAccountSnapshot["recentEventLog"][number]["category"] | undefined,
    heroId: parseOptionalQueryParam(request, "heroId") ?? undefined,
    achievementId: parseOptionalQueryParam(request, "achievementId") as
      | PlayerAccountSnapshot["recentEventLog"][number]["achievementId"]
      | undefined,
    worldEventType: parseOptionalQueryParam(request, "worldEventType") as
      | PlayerAccountSnapshot["recentEventLog"][number]["worldEventType"]
      | undefined,
    since: parseTimestampQueryParam(request, "since") ?? undefined,
    until: parseTimestampQueryParam(request, "until") ?? undefined
  });
}

function toAchievementResponse(account: PlayerAccountSnapshot, request: IncomingMessage): { items: PlayerAccountSnapshot["achievements"] } {
  const query = normalizeAchievementProgressQuery({
    limit: parseLimit(request) ?? undefined,
    achievementId: parseOptionalQueryParam(request, "achievementId") as
      | PlayerAccountSnapshot["achievements"][number]["id"]
      | undefined,
    metric: parseOptionalQueryParam(request, "metric") as
      | PlayerAccountSnapshot["achievements"][number]["metric"]
      | undefined,
    unlocked: parseBooleanQueryParam(request, "unlocked") ?? undefined
  });

  return {
    items: queryAchievementProgress(account.achievements, query)
  };
}

function toProgressionResponse(
  account: PlayerAccountSnapshot,
  limit?: number
): ReturnType<typeof buildPlayerProgressionSnapshot> {
  return buildPlayerProgressionSnapshot(account.achievements, account.recentEventLog, limit);
}

function toCampaignResponse(account: PlayerAccountSnapshot) {
  const missionStates = buildCampaignMissionStates(resolveCampaignConfig(), account.campaignProgress);
  const completedCount = missionStates.filter((mission) => mission.status === "completed").length;

  return {
    missions: missionStates,
    completedCount,
    totalMissions: missionStates.length,
    nextMissionId: missionStates.find((mission) => mission.status === "available")?.id ?? null,
    completionPercent: missionStates.length === 0 ? 0 : Math.round((completedCount / missionStates.length) * 100)
  };
}

function resolvePrimaryDailyDungeon() {
  const [dungeon] = resolveDailyDungeonConfig();
  if (!dungeon) {
    throw new Error("daily_dungeon_not_configured");
  }
  return dungeon;
}

function toDailyDungeonResponse(account: PlayerAccountSnapshot, now = new Date()) {
  return buildDailyDungeonSummary(resolvePrimaryDailyDungeon(), account.dailyDungeonState, now);
}

function toRewardMutation(account: PlayerAccountSnapshot, reward?: { gems?: number; resources?: Partial<PlayerAccountSnapshot["globalResources"]> }) {
  const gems = Math.max(0, Math.floor(reward?.gems ?? 0));
  const gold = Math.max(0, Math.floor(reward?.resources?.gold ?? 0));
  const wood = Math.max(0, Math.floor(reward?.resources?.wood ?? 0));
  const ore = Math.max(0, Math.floor(reward?.resources?.ore ?? 0));

  return {
    gems: (account.gems ?? 0) + gems,
    globalResources: {
      gold: (account.globalResources.gold ?? 0) + gold,
      wood: (account.globalResources.wood ?? 0) + wood,
      ore: (account.globalResources.ore ?? 0) + ore
    }
  };
}

function upsertSeasonalEventState(
  seasonalEventStates: SeasonalEventState[] | undefined,
  nextState: SeasonalEventState
): SeasonalEventState[] {
  return [...(seasonalEventStates ?? []).filter((state) => state.eventId !== nextState.eventId), nextState].sort((left, right) =>
    left.eventId.localeCompare(right.eventId)
  );
}

function applyActiveSeasonalEventProgress(
  account: PlayerAccountSnapshot,
  action: Parameters<typeof applySeasonalEventProgress>[2],
  now = new Date()
): {
  seasonalEventStates: SeasonalEventState[] | undefined;
  eventProgress: Array<{ eventId: string; delta: number; points: number; objectiveId: string }>;
} {
  const activeEvents = getActiveSeasonalEvents(resolveSeasonalEvents(), now);
  let seasonalEventStates = account.seasonalEventStates;
  const eventProgress: Array<{ eventId: string; delta: number; points: number; objectiveId: string }> = [];

  for (const event of activeEvents) {
    const progress = applySeasonalEventProgress(event, findSeasonalEventState(seasonalEventStates, event.id), action, now);
    if (!progress) {
      continue;
    }

    seasonalEventStates = upsertSeasonalEventState(seasonalEventStates, progress.state);
    eventProgress.push({
      eventId: event.id,
      delta: progress.delta,
      points: progress.state.points,
      objectiveId: progress.objective.id
    });
  }

  return { seasonalEventStates, eventProgress };
}

function normalizePlayerId(playerId?: string | null): string {
  const normalized = playerId?.trim();
  return normalized && normalized.length > 0 ? normalized : "player";
}

function normalizeDisplayName(playerId: string, displayName?: string | null): string {
  const normalized = displayName?.trim();
  return normalized && normalized.length > 0 ? normalized : playerId;
}

function normalizeLoginId(loginId?: string | null): string | undefined {
  const normalized = loginId?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isEphemeralGuestPlayerId(playerId: string): boolean {
  return playerId.startsWith("guest-");
}

function createLocalModeAccount(input: {
  playerId?: string | null | undefined;
  displayName?: string | null | undefined;
  avatarUrl?: string | null | undefined;
  lastRoomId?: string | null | undefined;
  loginId?: string | null | undefined;
  credentialBoundAt?: string | null | undefined;
}): PlayerAccountSnapshot {
  const playerId = normalizePlayerId(input.playerId);
  const displayName = normalizeDisplayName(playerId, input.displayName);
  const avatarUrl = input.avatarUrl?.trim();
  const lastRoomId = input.lastRoomId?.trim();
  const loginId = normalizeLoginId(input.loginId);
  const credentialBoundAt = input.credentialBoundAt?.trim();

  return {
    playerId,
    displayName,
    gems: 0,
    globalResources: {
      gold: 0,
      wood: 0,
      ore: 0
    },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [],
    tutorialStep: null,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(lastRoomId ? { lastRoomId } : {}),
    ...(loginId ? { loginId } : {}),
    ...(credentialBoundAt ? { credentialBoundAt } : {})
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

function sendForbidden(response: ServerResponse): void {
  sendJson(response, 403, {
    error: {
      code: "forbidden",
      message: "Authenticated players may only modify their own profile"
    }
  });
}

function createDailyRewardEventLogEntry(
  playerId: string,
  streak: number,
  reward: { gems: number; gold: number },
  timestamp = new Date().toISOString()
) {
  const rewardSummary = [
    reward.gems > 0 ? `宝石 x${reward.gems}` : null,
    reward.gold > 0 ? `金币 x${reward.gold}` : null
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("、");

  return {
    id: `${playerId}:${timestamp}:daily-login:${streak}`,
    timestamp,
    roomId: "daily-login",
    playerId,
    category: "account" as const,
    description: `每日签到奖励：连签第 ${streak} 天，获得 ${rewardSummary || "奖励已发放"}。`,
    rewards: [
      ...(reward.gems > 0 ? [{ type: "resource" as const, label: "gems", amount: reward.gems }] : []),
      ...(reward.gold > 0 ? [{ type: "resource" as const, label: "gold", amount: reward.gold }] : [])
    ]
  };
}

async function requireAuthSession(
  request: IncomingMessage,
  response: ServerResponse,
  store: RoomSnapshotStore | null
) {
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

async function requireAuthorizedPlayerScope(
  request: IncomingMessage,
  response: ServerResponse,
  store: RoomSnapshotStore | null,
  playerId?: string | null
) {
  const normalizedPlayerId = playerId?.trim();
  if (!normalizedPlayerId) {
    sendNotFound(response);
    return null;
  }

  const authSession = await requireAuthSession(request, response, store);
  if (!authSession) {
    return null;
  }

  if (authSession.playerId !== normalizedPlayerId) {
    sendForbidden(response);
    return null;
  }

  return authSession;
}

function toPublicPlayerAccount(
  account: PlayerAccountSnapshot
): Omit<
  PlayerAccountSnapshot,
  | "loginId"
  | "credentialBoundAt"
  | "privacyConsentAt"
  | "phoneNumber"
  | "phoneNumberBoundAt"
  | "wechatMiniGameOpenId"
  | "wechatMiniGameUnionId"
  | "banStatus"
  | "banExpiry"
  | "banReason"
> {
  const {
    loginId: _loginId,
    credentialBoundAt: _credentialBoundAt,
    phoneNumber: _phoneNumber,
    phoneNumberBoundAt: _phoneNumberBoundAt,
    wechatMiniGameOpenId: _wechatMiniGameOpenId,
    wechatMiniGameUnionId: _wechatMiniGameUnionId,
    banStatus: _banStatus,
    banExpiry: _banExpiry,
    banReason: _banReason,
    ...publicAccount
  } = account;
  return publicAccount;
}

export function registerPlayerAccountRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
    delete: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
    put: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null
): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/player-accounts", async (request, response) => {
    if (!store) {
      sendJson(response, 200, {
        items: []
      });
      return;
    }

    try {
      const limit = parseLimit(request);
      const playerId = parsePlayerIdFilter(request);
      sendJson(response, 200, {
        items: (await store.listPlayerAccounts({
          ...(limit != null ? { limit } : {}),
          ...(playerId ? { playerId } : {})
        })).map((account) => toPublicPlayerAccount(account))
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/achievement-definitions", (_request, response) => {
    sendJson(response, 200, {
      items: getAchievementDefinitions()
    });
  });

  app.get("/api/player-accounts/me", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      const entitlements = resolveFeatureEntitlementsForPlayer(authSession.playerId);
      const account = createLocalModeAccount({
        playerId: authSession.playerId,
        displayName: authSession.displayName,
        ...(authSession.loginId ? { loginId: authSession.loginId } : {})
      });
      emitExperimentExposureForSurface(account.playerId, account.lastRoomId ?? "account-profile", "player_account_profile", entitlements.experiments);
      sendJson(response, 200, {
        account: {
          ...withBattleReportCenter(account),
          experiments: entitlements.experiments
        },
        session: issueNextAuthSession(account, authSession)
      });
      return;
    }

    try {
      const entitlements = resolveFeatureEntitlementsForPlayer(authSession.playerId);
      const featureFlags = entitlements.featureFlags;
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      emitExperimentExposureForSurface(
        account.playerId,
        account.lastRoomId ?? "account-profile",
        "player_account_profile",
        entitlements.experiments
      );
      sendJson(response, 200, {
        account: {
          ...(await withDailyQuestBoard(withBattleReportCenter(account), store, featureFlags.quest_system_enabled)),
          experiments: entitlements.experiments
        },
        session: issueNextAuthSession(account, authSession)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player/daily-claim", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        claimed: false,
        reason: "persistence_unavailable"
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const today = getDailyRewardDateKey();
      if (account.lastPlayDate === today) {
        sendJson(response, 200, {
          claimed: false,
          reason: "already_claimed_today"
        });
        return;
      }

      const streak = account.lastPlayDate === getPreviousDailyRewardDateKey(today) ? Math.max(0, account.loginStreak ?? 0) + 1 : 1;
      const reward = resolveDailyRewardForStreak(streak);
      const eventEntry = createDailyRewardEventLogEntry(account.playerId, streak, reward);

      await store.savePlayerAccountProgress(account.playerId, {
        gems: (account.gems ?? 0) + reward.gems,
        seasonXpDelta: resolveBattlePassConfig().seasonXpDailyLoginBonus,
        globalResources: {
          ...account.globalResources,
          gold: (account.globalResources.gold ?? 0) + reward.gold
        },
        recentEventLog: appendEventLogEntries(account.recentEventLog, [eventEntry]),
        lastPlayDate: today,
        dailyPlayMinutes: 0,
        loginStreak: streak
      });

      sendJson(response, 200, {
        claimed: true,
        streak,
        reward
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player/battle-pass/claim", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store?.claimBattlePassTier) {
      sendJson(response, 503, {
        error: {
          code: "battle_pass_persistence_unavailable",
          message: "Battle pass claims require configured room persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { tier?: number | null };
      const tier = Math.floor(body.tier ?? Number.NaN);
      if (!Number.isFinite(tier) || tier <= 0) {
        sendJson(response, 400, {
          error: {
            code: "invalid_battle_pass_tier",
            message: "tier must be a positive integer"
          }
        });
        return;
      }

      const result = await store.claimBattlePassTier(authSession.playerId, tier);
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          error: {
            code: "invalid_json",
            message: "Request body must be valid JSON"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "battle_pass_tier_not_found") {
        sendJson(response, 404, {
          error: {
            code: "battle_pass_tier_not_found",
            message: "Battle pass tier was not found"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "battle_pass_tier_locked") {
        sendJson(response, 409, {
          error: {
            code: "battle_pass_tier_locked",
            message: "Battle pass tier is not unlocked yet"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "battle_pass_tier_already_claimed") {
        sendJson(response, 409, {
          error: {
            code: "battle_pass_tier_already_claimed",
            message: "Battle pass tier has already been claimed"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "equipment_inventory_full") {
        sendJson(response, 409, {
          error: {
            code: "equipment_inventory_full",
            message: error.message
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player-accounts/me/daily-quests/:questId/claim", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        claimed: false,
        reason: "persistence_unavailable"
      });
      return;
    }

    const featureFlags = resolveFeatureFlagsForPlayer(authSession.playerId);
    if (!featureFlags.quest_system_enabled) {
      sendJson(response, 200, {
        claimed: false,
        reason: "daily_quests_disabled"
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const board = await loadDailyQuestBoard(
        store,
        account,
        new Date(),
        {
          enabled: featureFlags.quest_system_enabled && isTutorialComplete(account.tutorialStep),
          featureFlags
        }
      );
      if (!board.enabled) {
        sendJson(response, 409, {
          claimed: false,
          reason: "tutorial_incomplete",
          dailyQuestBoard: board
        });
        return;
      }
      const quest = board.quests.find((item) => item.id === request.params.questId);

      if (!quest) {
        sendJson(response, 404, {
          error: {
            code: "daily_quest_not_found",
            message: "Daily quest was not found"
          }
        });
        return;
      }

      if (!quest.completed) {
        sendJson(response, 200, {
          claimed: false,
          reason: "quest_incomplete",
          dailyQuestBoard: board
        });
        return;
      }

      if (quest.claimed) {
        sendJson(response, 200, {
          claimed: false,
          reason: "already_claimed",
          dailyQuestBoard: board
        });
        return;
      }

      const timestamp = new Date().toISOString();
      const claimEntry = createDailyQuestClaimEventLogEntry(
        account.playerId,
        account.lastRoomId ?? "daily-quests",
        quest,
        timestamp
      );
      const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
        gems: (account.gems ?? 0) + quest.reward.gems,
        globalResources: {
          ...account.globalResources,
          gold: (account.globalResources.gold ?? 0) + quest.reward.gold
        },
        recentEventLog: appendEventLogEntries(account.recentEventLog, [claimEntry])
      });
      emitAnalyticsEvent("quest_complete", {
        playerId: account.playerId,
        roomId: account.lastRoomId ?? "daily-quests",
        payload: {
          roomId: account.lastRoomId ?? "daily-quests",
          questId: quest.id,
          reward: quest.reward
        }
      });

      sendJson(response, 200, {
        claimed: true,
        questId: quest.id,
        reward: quest.reward,
        dailyQuestBoard: await loadDailyQuestBoard(
          store,
          nextAccount,
          new Date(),
          {
            enabled: featureFlags.quest_system_enabled && isTutorialComplete(nextAccount.tutorialStep),
            featureFlags
          }
        )
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/daily-quests", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        dailyQuestBoard: {
          enabled: false,
          availableClaims: 0,
          pendingRewards: { gems: 0, gold: 0 },
          quests: []
        }
      });
      return;
    }

    try {
      const featureFlags = resolveFeatureFlagsForPlayer(authSession.playerId);
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, {
        dailyQuestBoard: await loadDailyQuestBoard(
          store,
          account,
          new Date(),
          featureFlags.quest_system_enabled && isTutorialComplete(account.tutorialStep)
        )
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player-accounts/me/tutorial-progress", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        account: withBattleReportCenter(
          createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            ...(authSession.loginId ? { loginId: authSession.loginId } : {})
          })
        )
      });
      return;
    }

    try {
      const featureFlags = resolveFeatureFlagsForPlayer(authSession.playerId);
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const action = normalizeTutorialProgressAction(
        await readJsonBody(request),
        account.tutorialStep ?? DEFAULT_TUTORIAL_STEP
      );
      const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
        tutorialStep: action.step
      });

      emitAnalyticsEvent("tutorial_step", {
        playerId: account.playerId,
        roomId: account.lastRoomId ?? "lobby",
        payload: {
          stepId:
            action.step == null
              ? action.reason === "skip"
                ? "tutorial_skipped"
                : "tutorial_completed"
              : `step_${action.step}`,
          status: action.reason === "skip" ? "skipped" : action.step == null ? "completed" : "active"
        }
      });

      sendJson(response, 200, {
        action,
        account: await withDailyQuestBoard(withBattleReportCenter(nextAccount), store, featureFlags.quest_system_enabled)
      });
    } catch (error) {
      if (error instanceof Error && error.message === "tutorial_skip_locked") {
        sendJson(response, 409, {
          error: {
            code: "tutorial_skip_locked",
            message: "Tutorial skip unlocks after the initial onboarding step"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "tutorial_progress_invalid_step") {
        sendJson(response, 400, {
          error: {
            code: "tutorial_progress_invalid_step",
            message: "Tutorial progress payload is invalid"
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/campaign", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const account = store
        ? ((await store.loadPlayerAccount(authSession.playerId)) ??
          (await store.ensurePlayerAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName
          })))
        : createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            ...(authSession.loginId ? { loginId: authSession.loginId } : {})
          });

      sendJson(response, 200, {
        campaign: toCampaignResponse(account)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player-accounts/me/campaign/:missionId/complete", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const missionId = request.params.missionId?.trim();
    if (!missionId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 503, {
        error: {
          code: "campaign_persistence_unavailable",
          message: "Campaign progression requires configured room persistence storage"
        }
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const result = completeCampaignMission(resolveCampaignConfig(), account.campaignProgress, missionId);
      const rewardMutation = toRewardMutation(account, result.reward);
      const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
        campaignProgress: result.campaignProgress,
        gems: rewardMutation.gems,
        globalResources: rewardMutation.globalResources
      });

      sendJson(response, 200, {
        completed: true,
        mission: result.mission,
        reward: result.reward,
        campaign: toCampaignResponse(nextAccount)
      });
    } catch (error) {
      if (error instanceof Error && error.message === "campaign_mission_not_found") {
        sendJson(response, 404, {
          error: {
            code: "campaign_mission_not_found",
            message: "Campaign mission was not found"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "campaign_mission_locked") {
        sendJson(response, 409, {
          error: {
            code: "campaign_mission_locked",
            message: "Campaign mission is not unlocked yet"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "campaign_mission_already_completed") {
        sendJson(response, 409, {
          error: {
            code: "campaign_mission_already_completed",
            message: "Campaign mission has already been completed"
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/daily-dungeon", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const account = store
        ? ((await store.loadPlayerAccount(authSession.playerId)) ??
          (await store.ensurePlayerAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName
          })))
        : createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            ...(authSession.loginId ? { loginId: authSession.loginId } : {})
          });
      sendJson(response, 200, {
        dailyDungeon: toDailyDungeonResponse(account)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player-accounts/me/daily-dungeon/attempt", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 503, {
        error: {
          code: "daily_dungeon_persistence_unavailable",
          message: "Daily dungeon progression requires configured room persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { floor?: number | null };
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const dungeon = resolvePrimaryDailyDungeon();
      const result = startDailyDungeonRun(dungeon, account.dailyDungeonState, body.floor ?? undefined);
      const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
        dailyDungeonState: result.dailyDungeonState
      });

      sendJson(response, 200, {
        started: true,
        run: result.run,
        floor: result.floor,
        dailyDungeon: toDailyDungeonResponse(nextAccount)
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          error: {
            code: "invalid_json",
            message: "Request body must be valid JSON"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "daily_dungeon_floor_not_found") {
        sendJson(response, 404, {
          error: {
            code: "daily_dungeon_floor_not_found",
            message: "Daily dungeon floor was not found"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "daily_dungeon_attempt_limit_reached") {
        sendJson(response, 409, {
          error: {
            code: "daily_dungeon_attempt_limit_reached",
            message: "Daily dungeon attempt limit has been reached for today"
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player-accounts/me/daily-dungeon/runs/:runId/claim", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const runId = request.params.runId?.trim();
    if (!runId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 503, {
        error: {
          code: "daily_dungeon_persistence_unavailable",
          message: "Daily dungeon progression requires configured room persistence storage"
        }
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const dungeon = resolvePrimaryDailyDungeon();
      const result = claimDailyDungeonRunReward(dungeon, account.dailyDungeonState, runId);
      const rewardMutation = toRewardMutation(account, result.floor.reward);
      const eventMutation = applyActiveSeasonalEventProgress(
        account,
        {
          actionId: result.run.runId,
          actionType: "daily_dungeon_reward_claimed",
          dungeonId: result.run.dungeonId,
          ...(result.run.rewardClaimedAt ? { occurredAt: result.run.rewardClaimedAt } : {})
        },
        new Date(result.run.rewardClaimedAt ?? new Date().toISOString())
      );
      const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
        dailyDungeonState: result.dailyDungeonState,
        gems: rewardMutation.gems,
        globalResources: rewardMutation.globalResources,
        ...(eventMutation.seasonalEventStates ? { seasonalEventStates: eventMutation.seasonalEventStates } : {})
      });

      sendJson(response, 200, {
        claimed: true,
        run: result.run,
        reward: result.floor.reward,
        dailyDungeon: toDailyDungeonResponse(nextAccount),
        ...(eventMutation.eventProgress.length > 0 ? { eventProgress: eventMutation.eventProgress } : {})
      });
    } catch (error) {
      if (error instanceof Error && error.message === "daily_dungeon_run_not_found") {
        sendJson(response, 404, {
          error: {
            code: "daily_dungeon_run_not_found",
            message: "Daily dungeon run was not found"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "daily_dungeon_reward_already_claimed") {
        sendJson(response, 409, {
          error: {
            code: "daily_dungeon_reward_already_claimed",
            message: "Daily dungeon reward has already been claimed"
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player/referral", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store?.claimPlayerReferral) {
      sendJson(response, 200, {
        claimed: false,
        reason: "persistence_unavailable"
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        referrerId?: string;
      };
      const referrerId = body.referrerId?.trim() ?? "";
      if (!referrerId) {
        sendJson(response, 400, {
          error: {
            code: "invalid_referrer_id",
            message: "referrerId must not be empty"
          }
        });
        return;
      }

      const result = await store.claimPlayerReferral(referrerId, authSession.playerId, 20);
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof Error && error.message === "duplicate_referral") {
        sendJson(response, 409, {
          error: {
            code: "referral_already_claimed",
            message: "Referral rewards were already claimed for this pair"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "self_referral_forbidden") {
        sendJson(response, 400, {
          error: {
            code: "self_referral_forbidden",
            message: "referrerId must be different from the current player"
          }
        });
        return;
      }
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, {
          error: {
            code: error.name,
            message: error.message
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/sessions", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (authSession.authMode !== "account" || !authSession.loginId) {
      sendJson(response, 403, {
        error: {
          code: "account_auth_required",
          message: "Device sessions are only available for formal account logins"
        }
      });
      return;
    }

    if (!store) {
      sendJson(response, 200, { items: [] });
      return;
    }

    try {
      const items = await store.listPlayerAccountAuthSessions(authSession.playerId);
      sendJson(response, 200, {
        items: items.map((session) => ({
          sessionId: session.sessionId,
          provider: session.provider,
          deviceLabel: session.deviceLabel,
          lastUsedAt: session.lastUsedAt,
          createdAt: session.createdAt,
          refreshExpiresAt: session.refreshTokenExpiresAt,
          current: authSession.sessionId === session.sessionId
        }))
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/players/me/delete", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      if (authSession.sessionId) {
        revokeGuestAuthSession(authSession.sessionId);
      }
      sendJson(response, 200, { ok: true, deleted: null });
      return;
    }

    try {
      const deleted = await store.deletePlayerAccount(authSession.playerId, {
        deletedAt: new Date().toISOString()
      });
      if (!deleted) {
        sendJson(response, 404, {
          error: {
            code: "player_not_found",
            message: `Player account not found: ${authSession.playerId}`
          }
        });
        return;
      }

      if (authSession.authMode === "account") {
        removeAuthAccountSessionsForPlayer(authSession.playerId);
      } else if (authSession.sessionId) {
        revokeGuestAuthSession(authSession.sessionId);
      }

      sendJson(response, 200, {
        ok: true,
        deleted: {
          playerId: deleted.playerId,
          displayName: deleted.displayName,
          deletedAt: deleted.updatedAt ?? new Date().toISOString()
        }
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.delete("/api/player-accounts/me/sessions/:sessionId", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const sessionId = request.params.sessionId?.trim();
    if (!sessionId) {
      sendNotFound(response);
      return;
    }

    if (authSession.authMode !== "account" || !authSession.loginId) {
      sendJson(response, 403, {
        error: {
          code: "account_auth_required",
          message: "Device sessions are only available for formal account logins"
        }
      });
      return;
    }

    if (authSession.sessionId === sessionId) {
      sendJson(response, 400, {
        error: {
          code: "current_session_revoke_forbidden",
          message: "Use logout to revoke the current device session"
        }
      });
      return;
    }

    if (!store) {
      sendJson(response, 404, {
        error: {
          code: "session_not_found",
          message: `Auth session not found: ${sessionId}`
        }
      });
      return;
    }

    try {
      const revoked = await store.revokePlayerAccountAuthSession(authSession.playerId, sessionId);
      if (!revoked) {
        sendJson(response, 404, {
          error: {
            code: "session_not_found",
            message: `Auth session not found: ${sessionId}`
          }
        });
        return;
      }

      removeAuthAccountSession(sessionId);
      const items = await store.listPlayerAccountAuthSessions(authSession.playerId);
      sendJson(response, 200, {
        ok: true,
        items: items.map((session) => ({
          sessionId: session.sessionId,
          provider: session.provider,
          deviceLabel: session.deviceLabel,
          lastUsedAt: session.lastUsedAt,
          createdAt: session.createdAt,
          refreshExpiresAt: session.refreshTokenExpiresAt,
          current: authSession.sessionId === session.sessionId
        }))
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/battle-replays", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        items: []
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, toReplayResponseFromRequest(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/battle-reports", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        latestReportId: null,
        items: []
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, toBattleReportResponseFromRequest(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/battle-replays/:replayId", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const replayId = request.params.replayId?.trim();
    if (!replayId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 404, {
        error: {
          code: "player_battle_replay_not_found",
          message: `Player battle replay not found: ${replayId}`
        }
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const detail = toReplayDetailResponse(account, replayId);
      if (!detail) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      sendJson(response, 200, detail);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/battle-replays/:replayId/playback", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const replayId = request.params.replayId?.trim();
    if (!replayId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 404, {
        error: {
          code: "player_battle_replay_not_found",
          message: `Player battle replay not found: ${replayId}`
        }
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const playback = toReplayPlaybackResponse(account, request, replayId);
      if (!playback) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      sendJson(response, 200, playback);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/event-log", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toEventLogResponse(
          createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            loginId: authSession.loginId
          }),
          request
        )
      );
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, toEventLogResponse(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/event-history", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const query = toEventHistoryQuery(request);
    if (!store) {
      const account = createLocalModeAccount({
        playerId: authSession.playerId,
        displayName: authSession.displayName,
        loginId: authSession.loginId
      });
      const total = queryEventLogEntries(account.recentEventLog, {
        ...query,
        limit: undefined,
        offset: undefined
      }).length;
      const items = queryEventLogEntries(account.recentEventLog, query);
      sendJson(response, 200, {
        items,
        total,
        offset: Math.max(0, Math.floor(query.offset ?? 0)),
        limit: query.limit ?? items.length,
        hasMore: (query.offset ?? 0) + items.length < total
      });
      return;
    }

    try {
      const history = await store.loadPlayerEventHistory(authSession.playerId, query);
      sendJson(response, 200, {
        ...history,
        offset: Math.max(0, Math.floor(query.offset ?? 0)),
        limit: query.limit ?? history.items.length,
        hasMore: (query.offset ?? 0) + history.items.length < history.total
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/achievements", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toAchievementResponse(
          createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            loginId: authSession.loginId
          }),
          request
        )
      );
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, toAchievementResponse(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/progression", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toProgressionResponse(
          createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            ...(authSession.loginId ? { loginId: authSession.loginId } : {})
          }),
          parseLimit(request)
        )
      );
      return;
    }

    try {
      const featureFlags = resolveFeatureFlagsForPlayer(authSession.playerId);
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      sendJson(response, 200, {
        ...toProgressionResponse(account, parseLimit(request)),
        dailyQuestBoard: await loadDailyQuestBoard(
          store,
          account,
          new Date(),
          featureFlags.quest_system_enabled && isTutorialComplete(account.tutorialStep)
        ),
        campaign: toCampaignResponse(account),
        dailyDungeon: toDailyDungeonResponse(account)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        account: toPublicPlayerAccount(
          withBattleReportCenter(
            createLocalModeAccount({
              playerId
            })
          )
        )
      });
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        if (isEphemeralGuestPlayerId(playerId)) {
          sendJson(response, 200, {
            account: toPublicPlayerAccount(
              withBattleReportCenter(
                createLocalModeAccount({
                  playerId
                })
              )
            )
          });
          return;
        }
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, { account: toPublicPlayerAccount(withBattleReportCenter(account)) });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/battle-replays", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        items: []
      });
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        if (isEphemeralGuestPlayerId(playerId)) {
          sendJson(response, 200, {
            items: []
          });
          return;
        }
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, toReplayResponseFromRequest(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/battle-reports", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        latestReportId: null,
        items: []
      });
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        if (isEphemeralGuestPlayerId(playerId)) {
          sendJson(response, 200, {
            latestReportId: null,
            items: []
          });
          return;
        }
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, toBattleReportResponseFromRequest(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/battle-replays/:replayId", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    const replayId = request.params.replayId?.trim();
    if (!playerId || !replayId) {
      sendNotFound(response);
      return;
    }

    const authSession = await requireAuthorizedPlayerScope(request, response, store, playerId);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 404, {
        error: {
          code: "player_battle_replay_not_found",
          message: `Player battle replay not found: ${replayId}`
        }
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      if (!account) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      const detail = toReplayDetailResponse(account, replayId);
      if (!detail) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      sendJson(response, 200, detail);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/battle-replays/:replayId/playback", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    const replayId = request.params.replayId?.trim();
    if (!playerId || !replayId) {
      sendNotFound(response);
      return;
    }

    const authSession = await requireAuthorizedPlayerScope(request, response, store, playerId);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 404, {
        error: {
          code: "player_battle_replay_not_found",
          message: `Player battle replay not found: ${replayId}`
        }
      });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      if (!account) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      const playback = toReplayPlaybackResponse(account, request, replayId);
      if (!playback) {
        sendJson(response, 404, {
          error: {
            code: "player_battle_replay_not_found",
            message: `Player battle replay not found: ${replayId}`
          }
        });
        return;
      }

      sendJson(response, 200, playback);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/event-log", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    const authSession = await requireAuthorizedPlayerScope(request, response, store, playerId);
    if (!authSession) {
      return;
    }

    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toEventLogResponse(
          createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            ...(authSession.loginId ? { loginId: authSession.loginId } : {})
          }),
          request
        )
      );
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));

      sendJson(response, 200, toEventLogResponse(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/event-history", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    const authSession = await requireAuthorizedPlayerScope(request, response, store, playerId);
    if (!authSession) {
      return;
    }

    if (!playerId) {
      sendNotFound(response);
      return;
    }

    const query = toEventHistoryQuery(request);
    if (!store) {
      const items = queryEventLogEntries([], query);
      sendJson(response, 200, {
        items,
        total: 0,
        offset: Math.max(0, Math.floor(query.offset ?? 0)),
        limit: query.limit ?? items.length,
        hasMore: false
      });
      return;
    }

    try {
      const history = await store.loadPlayerEventHistory(authSession.playerId, query);
      sendJson(response, 200, {
        ...history,
        offset: Math.max(0, Math.floor(query.offset ?? 0)),
        limit: query.limit ?? history.items.length,
        hasMore: (query.offset ?? 0) + history.items.length < history.total
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/achievements", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toAchievementResponse(
          createLocalModeAccount({
            playerId
          }),
          request
        )
      );
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        if (isEphemeralGuestPlayerId(playerId)) {
          sendJson(
            response,
            200,
            toAchievementResponse(
              createLocalModeAccount({
                playerId
              }),
              request
            )
          );
          return;
        }
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, toAchievementResponse(account, request));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/:playerId/progression", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    if (!store) {
      sendJson(
        response,
        200,
        toProgressionResponse(
          createLocalModeAccount({
            playerId
          }),
          parseLimit(request)
        )
      );
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        if (isEphemeralGuestPlayerId(playerId)) {
          sendJson(
            response,
            200,
            toProgressionResponse(
              createLocalModeAccount({
                playerId
              }),
              parseLimit(request)
            )
          );
          return;
        }
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${playerId}`
          }
        });
        return;
      }

      sendJson(response, 200, toProgressionResponse(account, parseLimit(request)));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player-accounts/me/phone", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        encryptedData?: string | null;
        iv?: string | null;
      };
      if (typeof body.encryptedData !== "string" || typeof body.iv !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string fields: encryptedData, iv"
          }
        });
        return;
      }

      const decrypted = decryptWechatPhoneNumber({
        playerId: authSession.playerId,
        encryptedData: body.encryptedData,
        iv: body.iv,
        ...(readExpectedWechatAppId() ? { expectedAppId: readExpectedWechatAppId() } : {})
      });
      const phoneNumber = decrypted?.payload.phoneNumber?.trim() || decrypted?.payload.purePhoneNumber?.trim();
      if (!decrypted || !phoneNumber) {
        logWechatValidationFailure(authSession.playerId, "bind-phone", "decrypt_failed_or_missing_phone_number");
        sendWechatValidationForbidden(response);
        return;
      }

      const phoneNumberBoundAt = new Date().toISOString();
      if (!store) {
        const account = createLocalModeAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName,
          ...(authSession.loginId ? { loginId: authSession.loginId } : {})
        });
        sendJson(response, 200, {
          account: withBattleReportCenter({
            ...account,
            phoneNumber,
            phoneNumberBoundAt
          }),
          phone: {
            phoneNumber,
            ...(decrypted.payload.countryCode?.trim() ? { countryCode: decrypted.payload.countryCode.trim() } : {}),
            boundAt: phoneNumberBoundAt
          },
          session: issueNextAuthSession(account, authSession)
        });
        return;
      }

      const account = await store.savePlayerAccountProfile(authSession.playerId, {
        phoneNumber,
        phoneNumberBoundAt
      });
      sendJson(response, 200, {
        account: withBattleReportCenter(account),
        phone: {
          phoneNumber,
          ...(decrypted.payload.countryCode?.trim() ? { countryCode: decrypted.payload.countryCode.trim() } : {}),
          boundAt: phoneNumberBoundAt
        },
        session: issueNextAuthSession(account, authSession)
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/player-accounts/me", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        displayName?: string | null;
        avatarUrl?: string | null;
        lastRoomId?: string | null;
        currentPassword?: string | null;
        newPassword?: string | null;
        wechatSignature?: WechatSignatureEnvelope | null;
      };

      if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: displayName"
          }
        });
        return;
      }

      if (body.lastRoomId !== undefined && body.lastRoomId !== null && typeof body.lastRoomId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: lastRoomId"
          }
        });
        return;
      }

      if (body.avatarUrl !== undefined && body.avatarUrl !== null && typeof body.avatarUrl !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: avatarUrl"
          }
        });
        return;
      }

      if (body.currentPassword !== undefined && body.currentPassword !== null && typeof body.currentPassword !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: currentPassword"
          }
        });
        return;
      }

      if (body.newPassword !== undefined && body.newPassword !== null && typeof body.newPassword !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: newPassword"
          }
        });
        return;
      }

      const patch: PlayerAccountProfilePatch = {
        ...(body.displayName !== undefined ? { displayName: body.displayName ?? "" } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        ...(body.lastRoomId !== undefined ? { lastRoomId: body.lastRoomId } : {})
      };
      const wantsPasswordChange = body.currentPassword !== undefined || body.newPassword !== undefined;
      const wantsSensitiveWechatValidation =
        authSession.provider === "wechat-mini-game" &&
        (body.displayName !== undefined || body.avatarUrl !== undefined || wantsPasswordChange);

      if (wantsSensitiveWechatValidation && !validateWechatSignatureEnvelope(response, authSession.playerId, "update-profile", body.wechatSignature)) {
        return;
      }

      if (!store) {
        if (wantsPasswordChange) {
          sendJson(response, 501, {
            error: {
              code: "password_change_not_supported",
              message: "Password changes require configured room persistence storage"
            }
          });
          return;
        }
        const account = createLocalModeAccount({
          playerId: authSession.playerId,
          displayName: patch.displayName ?? authSession.displayName,
          ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
          ...(patch.lastRoomId !== undefined ? { lastRoomId: patch.lastRoomId } : {}),
          ...(authSession.loginId ? { loginId: authSession.loginId } : {})
        });
        sendJson(response, 200, {
          account: withBattleReportCenter(account),
          session: issueNextAuthSession(account, authSession)
        });
        return;
      }

      let account =
        Object.keys(patch).length === 0
          ? await store.ensurePlayerAccount({
              playerId: authSession.playerId,
              displayName: authSession.displayName
            })
          : await store.savePlayerAccountProfile(authSession.playerId, patch);

      if (wantsPasswordChange) {
        if (authSession.authMode !== "account") {
          sendJson(response, 403, {
            error: {
              code: "password_change_requires_account_auth",
              message: "Password changes require an authenticated account session"
            }
          });
          return;
        }

        const currentPassword = body.currentPassword?.trim();
        const newPassword = body.newPassword?.trim();
        if (!currentPassword || !newPassword) {
          sendJson(response, 400, {
            error: {
              code: "invalid_payload",
              message: "Password changes require both currentPassword and newPassword"
            }
          });
          return;
        }

        const authAccount = await store.loadPlayerAccountAuthByPlayerId(authSession.playerId);
        if (!authAccount || !verifyAccountPassword(currentPassword, authAccount.passwordHash)) {
          recordAuthInvalidCredentials();
          sendJson(response, 401, {
            error: {
              code: "invalid_credentials",
              message: "Current password is incorrect"
            }
          });
          return;
        }

        const credentialBoundAt = new Date().toISOString();
        const revokedAuth = await store.revokePlayerAccountAuthSessions(authSession.playerId, {
          passwordHash: hashAccountPassword(newPassword),
          credentialBoundAt
        });
        if (revokedAuth) {
          cachePlayerAccountAuthState({
            playerId: revokedAuth.playerId,
            accountSessionVersion: revokedAuth.accountSessionVersion
          });
        }
        removeAuthAccountSessionsForPlayer(authSession.playerId);
        account =
          (await store.loadPlayerAccount(authSession.playerId)) ??
          ({
            ...account,
            credentialBoundAt
          } as typeof account);

        sendJson(response, 200, {
          account: withBattleReportCenter(account)
        });
        return;
      }

      sendJson(response, 200, {
        account: withBattleReportCenter(account),
        session: issueNextAuthSession(account, authSession)
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/player-accounts/:playerId", async (request, response) => {
    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    const authResult = await validateAuthSessionFromRequest(request, store);
    const authSession = authResult.session;
    if (!authSession && readGuestAuthTokenFromRequest(request)) {
      if (authResult.errorCode === "account_banned") {
        sendAccountBanned(response, authResult.ban);
        return;
      }
      sendUnauthorized(response, authResult.errorCode ?? "unauthorized");
      return;
    }
    if (authSession && authSession.playerId !== playerId) {
      sendForbidden(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        displayName?: string | null;
        avatarUrl?: string | null;
        lastRoomId?: string | null;
        wechatSignature?: WechatSignatureEnvelope | null;
      };

      if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: displayName"
          }
        });
        return;
      }

      if (body.lastRoomId !== undefined && body.lastRoomId !== null && typeof body.lastRoomId !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: lastRoomId"
          }
        });
        return;
      }

      if (body.avatarUrl !== undefined && body.avatarUrl !== null && typeof body.avatarUrl !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected optional string field: avatarUrl"
          }
        });
        return;
      }

      const patch: PlayerAccountProfilePatch = {
        ...(body.displayName !== undefined ? { displayName: body.displayName ?? "" } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        ...(body.lastRoomId !== undefined ? { lastRoomId: body.lastRoomId } : {})
      };

      if (!store) {
        const account = createLocalModeAccount({
          playerId,
          displayName: patch.displayName ?? authSession?.displayName ?? playerId,
          ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
          ...(patch.lastRoomId !== undefined ? { lastRoomId: patch.lastRoomId } : {}),
          ...(authSession?.playerId === playerId && authSession.loginId ? { loginId: authSession.loginId } : {})
        });
        sendJson(response, 200, {
          account: withBattleReportCenter(account),
          ...(authSession?.playerId === playerId ? { session: issueNextAuthSession(account, authSession) } : {})
        });
        return;
      }

      if (!authSession) {
        if (authResult.errorCode === "account_banned") {
          sendAccountBanned(response, authResult.ban);
          return;
        }
        sendUnauthorized(response, authResult.errorCode ?? "unauthorized");
        return;
      }

      if (
        authSession.provider === "wechat-mini-game" &&
        (body.displayName !== undefined || body.avatarUrl !== undefined) &&
        !validateWechatSignatureEnvelope(response, authSession.playerId, "update-profile", body.wechatSignature)
      ) {
        return;
      }

      const account =
        Object.keys(patch).length === 0
          ? await store.ensurePlayerAccount({
              playerId: authSession.playerId,
              displayName: authSession.displayName
            })
          : await store.savePlayerAccountProfile(playerId, patch);

      sendJson(response, 200, {
        account: withBattleReportCenter(account),
        session: issueNextAuthSession(account, authSession)
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });
}
