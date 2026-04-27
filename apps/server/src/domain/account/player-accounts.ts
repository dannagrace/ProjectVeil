import type { IncomingMessage, ServerResponse } from "node:http";
import { applyBattleReplayPlaybackCommand, type BattleReplayPlaybackCommand, type BattleReplayResult, buildPlayerBattleReportCenter, findPlayerBattleReplaySummary, type PlayerBattleReplaySummary, queryPlayerBattleReplaySummaries } from "@veil/shared/battle";
import { normalizeCosmeticInventory } from "@veil/shared/economy";
import { appendEventLogEntries, buildPlayerProgressionSnapshot, getAchievementDefinitions, normalizeAchievementProgressQuery, normalizeEventLogQuery, queryAchievementProgress, queryEventLogEntries } from "@veil/shared/event-log";
import type { BattleState, DailyDungeonRunRecord, SeasonalEventState } from "@veil/shared/models";
import { DEFAULT_TUTORIAL_STEP, getRankDivisionForRating, isTutorialComplete, summarizePlayerMailbox } from "@veil/shared/progression";
import {
  createDailyQuestClaimEventLogEntry,
  loadDailyQuestBoard
} from "@server/domain/economy/daily-quests";
import { issueDailyLoginReward } from "@server/domain/economy/daily-login-rewards";
import { resolveBattlePassConfig } from "@server/domain/economy/battle-pass";
import { emitAnalyticsEvent } from "@server/domain/ops/analytics";
import { timingSafeCompareAdminToken } from "@server/infra/admin-token";
import {
  cachePlayerAccountAuthState,
  hashAccountPassword,
  issueNextAuthSession,
  revokeGuestAuthSession,
  readGuestAuthTokenFromRequest,
  validateAuthSessionFromRequest,
  verifyAccountPassword
} from "@server/domain/account/auth";
import { recordAuthInvalidCredentials, removeAuthAccountSession, removeAuthAccountSessionsForPlayer } from "@server/domain/ops/observability";
import type {
  PlayerAccountProfilePatch,
  PlayerAccountProgressPatch,
  PlayerAccountSnapshot,
  PlayerEventHistoryQuery,
  RoomSnapshotStore,
  SupportTicketCategory,
  SupportTicketPriority
} from "@server/persistence";
import {
  consumeActionSubmissionRateLimit,
  applySeasonalEventProgress,
  buildEventLeaderboard,
  findSeasonalEventState,
  getActiveSeasonalEvents,
  isActionSubmissionRateLimitEnabled,
  resolveSeasonalEvents
} from "@server/domain/battle/event-engine";
import { resolveFeatureEntitlementsForPlayer, resolveFeatureFlagsForPlayer } from "@server/domain/battle/feature-flags";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import { assertDisplayNameAvailableOrThrow } from "@server/domain/account/display-name-rules";
import {
  buildCampaignMissionStates,
  type CampaignAccessContext,
  buildDailyDungeonSummary,
  claimDailyDungeonRunReward,
  completeCampaignMission,
  resolveCampaignConfig,
  resolveActiveDailyDungeon,
  startDailyDungeonRun
} from "@server/domain/battle/pve-content";
import { decryptWechatPhoneNumber, validateWechatSignature } from "@server/adapters/wechat-session-key";
import {
  buildFriendLeaderboard,
  createGroupChallenge,
  encodeGroupChallengeToken,
  FriendLeaderboardTooManyIdsError,
  loadAuthorizedFriendLeaderboardAccounts,
  normalizeNotificationPreferences,
  validateGroupChallengeToken
} from "@server/adapters/wechat-social";
import { removeMobilePushToken, upsertMobilePushToken } from "@server/domain/account/mobile-push-tokens";
import { normalizePlayerMailboxMessage } from "@server/domain/account/player-mailbox";
import { acknowledgeReengagementMailboxOpen, recordReengagementReturn } from "@server/domain/ops/reengagement";
import { normalizeTutorialProgressAction, toTutorialAnalyticsPayload } from "@server/domain/account/tutorial-progress";

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

function readGroupChallengeSecret(env: NodeJS.ProcessEnv = process.env): string {
  return readRuntimeSecret("VEIL_WECHAT_GROUP_CHALLENGE_SECRET", env) || "project-veil-local-group-challenge-secret";
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

function isAdminAuthorized(request: IncomingMessage): boolean {
  const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
  return timingSafeCompareAdminToken(request.headers["x-veil-admin-token"], adminToken);
}

async function validateWechatSignatureEnvelope(
  response: ServerResponse,
  playerId: string,
  operation: string,
  signature?: WechatSignatureEnvelope | null
): Promise<boolean> {
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

  if (!(await validateWechatSignature({ playerId, rawData: signature.rawData, signature: signature.signature }))) {
    logWechatValidationFailure(playerId, operation, "signature_mismatch_or_missing_session_key");
    sendWechatValidationForbidden(response);
    return false;
  }

  return true;
}

const MAX_JSON_BODY_BYTES = 64 * 1024;
const PLAYER_ACCOUNT_LIST_DEFAULT_LIMIT = 20;
const PLAYER_ACCOUNT_LIST_MAX_LIMIT = 50;

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

function parseClampedPlayerAccountListLimit(request: IncomingMessage): number {
  const parsed = parseLimit(request);
  if (parsed == null) {
    return PLAYER_ACCOUNT_LIST_DEFAULT_LIMIT;
  }
  return Math.min(PLAYER_ACCOUNT_LIST_MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function parseNonNegativeOffset(request: IncomingMessage): number | undefined {
  const parsed = parseOffset(request);
  return parsed == null ? undefined : Math.max(0, Math.floor(parsed));
}

function isTestTimeOverrideEnabled(): boolean {
  return (
    process.env.NODE_ENV?.trim().toLowerCase() !== "production" ||
    process.env.VEIL_ENABLE_TEST_TIME_OVERRIDE?.trim() === "1"
  );
}

function readDailyDungeonNowOverride(request: IncomingMessage): Date | null {
  if (!isTestTimeOverrideEnabled()) {
    return null;
  }

  const rawValue = request.headers["x-veil-test-now"];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveDailyDungeonNow(request: IncomingMessage): Date {
  return readDailyDungeonNowOverride(request) ?? new Date();
}

export const __playerAccountRouteInternals = {
  hasVerifiedCampaignMissionCompletion,
  isTestTimeOverrideEnabled,
  readDailyDungeonNowOverride,
  resolveDailyDungeonNow
} as const;

function hasVerifiedCampaignMissionCompletion(account: PlayerAccountSnapshot, mission: { mapId: string }): boolean {
  return (
    account.recentBattleReplays?.some(
      (replay) => replay.roomId === mission.mapId && replay.result === "attacker_victory"
    ) ?? false
  );
}

function areTestEndpointsEnabled(): boolean {
  return process.env.VEIL_ENABLE_TEST_ENDPOINTS === "1";
}

function readRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createTestVerifiedBattleReplay(input: {
  playerId: string;
  roomId: string;
  battleId: string;
  result: BattleReplayResult;
  completedAt: string;
}): PlayerBattleReplaySummary {
  const initialState: BattleState = {
    id: input.battleId,
    round: 1,
    lanes: 1,
    activeUnitId: "unit-1",
    turnOrder: ["unit-1"],
    units: {
      "unit-1": {
        id: "unit-1",
        camp: "attacker",
        templateId: "hero_guard_basic",
        lane: 0,
        stackName: "Test Guard",
        initiative: 4,
        attack: 2,
        defense: 2,
        minDamage: 1,
        maxDamage: 2,
        currentHp: 10,
        count: 1,
        maxHp: 10,
        hasRetaliated: false,
        defending: false
      }
    },
    unitCooldowns: {
      "unit-1": {}
    },
    environment: [],
    log: [],
    rng: { seed: 1, cursor: 0 }
  };

  return {
    id: `test-proof:${input.playerId}:${input.battleId}`,
    roomId: input.roomId,
    playerId: input.playerId,
    battleId: input.battleId,
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    neutralArmyId: "test-neutral-army",
    startedAt: input.completedAt,
    completedAt: input.completedAt,
    initialState,
    steps: [],
    result: input.result
  };
}

function sendActionSubmissionRateLimited(response: ServerResponse, retryAfterSeconds?: number): void {
  if (retryAfterSeconds != null) {
    response.setHeader("Retry-After", String(retryAfterSeconds));
  }
  sendJson(response, 429, {
    error: {
      code: "rate_limited",
      message: "Too many requests, please retry later"
    }
  });
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

function toReplayDetailResponse(
  account: PlayerAccountSnapshot,
  replayLookup?: string | null
): { replay: NonNullable<PlayerAccountSnapshot["recentBattleReplays"]>[number] } | null {
  const replay = findReplaySummaryByLookup(account, replayLookup);
  return replay ? { replay } : null;
}

function findReplaySummaryByLookup(
  account: PlayerAccountSnapshot,
  replayLookup?: string | null
): NonNullable<PlayerAccountSnapshot["recentBattleReplays"]>[number] | null {
  const normalizedReplayLookup = replayLookup?.trim();
  if (!normalizedReplayLookup) {
    return null;
  }

  const replayById = findPlayerBattleReplaySummary(account.recentBattleReplays, normalizedReplayLookup);
  if (replayById) {
    return replayById;
  }

  return (
    queryPlayerBattleReplaySummaries(account.recentBattleReplays, {
      battleId: normalizedReplayLookup,
      limit: 1
    })[0] ?? null
  );
}

function normalizeReplayPlaybackAction(
  action?: string | null
): BattleReplayPlaybackCommand["action"] | undefined {
  const normalizedAction = action?.trim();
  switch (normalizedAction) {
    case "play":
    case "pause":
    case "step":
    case "tick":
    case "reset":
    case "step-back":
      return normalizedAction;
    case "step-forward":
      return "step";
    default:
      return undefined;
  }
}

function readFiniteNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toReplayPlaybackCommandPayload(payload: unknown): BattleReplayPlaybackCommand {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const commandPayload = payload as Record<string, unknown>;
  const status = commandPayload.status === "paused" || commandPayload.status === "playing" ? commandPayload.status : undefined;
  const action = normalizeReplayPlaybackAction(
    typeof commandPayload.command === "string"
      ? commandPayload.command
      : typeof commandPayload.action === "string"
        ? commandPayload.action
        : undefined
  );
  const currentStepIndex = readFiniteNumberValue(commandPayload.currentStepIndex);
  const targetTurn = readFiniteNumberValue(commandPayload.targetTurn);
  const speed = readFiniteNumberValue(commandPayload.speed);
  const repeat = readFiniteNumberValue(commandPayload.repeat);

  return {
    ...(currentStepIndex != null ? { currentStepIndex } : {}),
    ...(targetTurn != null ? { targetTurn } : {}),
    ...(status ? { status } : {}),
    ...(speed != null ? { speed } : {}),
    ...(action ? { action } : {}),
    ...(repeat != null ? { repeat } : {})
  };
}

function toReplayPlaybackResponse(
  account: PlayerAccountSnapshot,
  request: IncomingMessage | null,
  replayLookup?: string | null,
  commandOverrides: BattleReplayPlaybackCommand = {}
) {
  const replay = findReplaySummaryByLookup(account, replayLookup);
  if (!replay) {
    return null;
  }

  const currentStepIndex = request ? parseNumberQueryParam(request, "currentStepIndex") : undefined;
  const status = request ? (parseOptionalQueryParam(request, "status") as "paused" | "playing" | undefined) : undefined;
  const action = request ? normalizeReplayPlaybackAction(parseOptionalQueryParam(request, "action")) : undefined;
  const repeat = request ? parseNumberQueryParam(request, "repeat") : undefined;
  const targetTurn = request ? parseNumberQueryParam(request, "targetTurn") : undefined;
  const speed = request ? parseNumberQueryParam(request, "speed") : undefined;

  return {
    playback: applyBattleReplayPlaybackCommand(replay, {
      ...(currentStepIndex != null ? { currentStepIndex } : {}),
      ...(targetTurn != null ? { targetTurn } : {}),
      ...(status ? { status } : {}),
      ...(speed != null ? { speed } : {}),
      ...(action ? { action } : {}),
      ...(repeat != null ? { repeat } : {}),
      ...commandOverrides
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

function toSeasonProgressResponse(account: PlayerAccountSnapshot, battlePassEnabled: boolean) {
  const battlePassConfig = resolveBattlePassConfig();
  return {
    battlePassEnabled,
    seasonXp: Math.max(0, Math.floor(account.seasonXp ?? 0)),
    seasonPassTier: Math.max(1, Math.floor(account.seasonPassTier ?? 1)),
    seasonPassPremium: account.seasonPassPremium === true,
    seasonPassClaimedTiers: account.seasonPassClaimedTiers ?? [],
    tiers: battlePassConfig.tiers
  };
}

function toCampaignResponse(account: PlayerAccountSnapshot, accessContext?: CampaignAccessContext | null) {
  const missionStates = buildCampaignMissionStates(resolveCampaignConfig(), account.campaignProgress, accessContext);
  const completedCount = missionStates.filter((mission) => mission.status === "completed").length;

  return {
    missions: missionStates,
    completedCount,
    totalMissions: missionStates.length,
    nextMissionId: missionStates.find((mission) => mission.status === "available")?.id ?? null,
    completionPercent: missionStates.length === 0 ? 0 : Math.round((completedCount / missionStates.length) * 100)
  };
}

function resolvePrimaryDailyDungeon(now = new Date()) {
  const dungeon = resolveActiveDailyDungeon(now);
  if (!dungeon) {
    throw new Error("daily_dungeon_not_configured");
  }
  return dungeon;
}

function toDailyDungeonResponse(account: PlayerAccountSnapshot, now = new Date()) {
  return buildDailyDungeonSummary(resolvePrimaryDailyDungeon(now), account.dailyDungeonState, now);
}

function toRewardMutation(
  account: PlayerAccountSnapshot,
  reward?: { gems?: number; resources?: Partial<PlayerAccountSnapshot["globalResources"]>; cosmeticId?: string }
) {
  const gems = Math.max(0, Math.floor(reward?.gems ?? 0));
  const gold = Math.max(0, Math.floor(reward?.resources?.gold ?? 0));
  const wood = Math.max(0, Math.floor(reward?.resources?.wood ?? 0));
  const ore = Math.max(0, Math.floor(reward?.resources?.ore ?? 0));
  const cosmeticId = reward?.cosmeticId?.trim();

  return {
    gems: (account.gems ?? 0) + gems,
    cosmeticInventory: normalizeCosmeticInventory({
      ownedIds: [...(account.cosmeticInventory?.ownedIds ?? []), ...(cosmeticId ? [cosmeticId] : [])]
    }),
    globalResources: {
      gold: (account.globalResources.gold ?? 0) + gold,
      wood: (account.globalResources.wood ?? 0) + wood,
      ore: (account.globalResources.ore ?? 0) + ore
    }
  };
}

async function loadCampaignAccessContext(
  store: RoomSnapshotStore | null,
  account: PlayerAccountSnapshot
): Promise<CampaignAccessContext> {
  const heroArchives = store ? await store.loadPlayerHeroArchives([account.playerId]) : [];
  return {
    highestHeroLevel: Math.max(1, ...heroArchives.map((archive) => Math.max(1, Math.floor(archive.hero.progression.level ?? 1)))),
    rankDivision: account.rankDivision ?? getRankDivisionForRating(account.eloRating ?? 1000)
  };
}

function toMailboxResponse(account: PlayerAccountSnapshot, now = new Date()) {
  const mailbox = account.mailbox ?? [];
  return {
    items: mailbox,
    summary: summarizePlayerMailbox(mailbox, now)
  };
}

async function surfaceEndedSeasonalEventRewards(
  store: RoomSnapshotStore,
  account: PlayerAccountSnapshot,
  now = new Date()
): Promise<PlayerAccountSnapshot> {
  if (!store.deliverPlayerMailbox) {
    return account;
  }

  const endedEvents = resolveSeasonalEvents().filter((event) => new Date(event.endsAt).getTime() <= now.getTime());
  if (endedEvents.length === 0) {
    return account;
  }

  let nextAccount = account;
  const allAccounts = await store.listPlayerAccounts();
  for (const event of endedEvents) {
    const rank = buildEventLeaderboard(event, allAccounts, event.leaderboard.size).find((entry) => entry.playerId === account.playerId)?.rank;
    if (!rank) {
      continue;
    }

    const rewardTier = event.leaderboard.rewardTiers.find((tier) => tier.rankStart <= rank && rank <= tier.rankEnd);
    if (!rewardTier) {
      continue;
    }

    const delivery = await store.deliverPlayerMailbox({
      playerIds: [account.playerId],
      message: normalizePlayerMailboxMessage({
        id: `seasonal-event:${event.id}:leaderboard`,
        kind: "system",
        title: `${event.name} 结算奖励`,
        body: `你在 ${event.name} 中获得 ${rewardTier.title}（排名 #${rank}），奖励已发放到邮箱附件。`,
        sentAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        grant: {
          ...(rewardTier.badge ? { seasonBadges: [rewardTier.badge] } : {}),
          ...(rewardTier.cosmeticId ? { cosmeticIds: [rewardTier.cosmeticId] } : {})
        }
      })
    });
    if (delivery.deliveredPlayerIds.includes(account.playerId)) {
      nextAccount =
        (await store.loadPlayerAccount(account.playerId)) ??
        nextAccount;
    }
  }

  return nextAccount;
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

function toRedactedPlayerAccount(
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
  | "pushTokens"
  | "banStatus"
  | "banExpiry"
  | "banReason"
  | "mailbox"
  | "mailboxSummary"
> {
  const {
    loginId: _loginId,
    credentialBoundAt: _credentialBoundAt,
    privacyConsentAt: _privacyConsentAt,
    phoneNumber: _phoneNumber,
    phoneNumberBoundAt: _phoneNumberBoundAt,
    wechatMiniGameOpenId: _wechatMiniGameOpenId,
    wechatMiniGameUnionId: _wechatMiniGameUnionId,
    pushTokens: _pushTokens,
    banStatus: _banStatus,
    banExpiry: _banExpiry,
    banReason: _banReason,
    mailbox: _mailbox,
    mailboxSummary: _mailboxSummary,
    ...publicAccount
  } = account;
  return publicAccount;
}

type PublicPlayerAccountProfile = Pick<PlayerAccountSnapshot, "playerId" | "displayName"> &
  Partial<
    Pick<
      PlayerAccountSnapshot,
      | "avatarUrl"
      | "eloRating"
      | "rankDivision"
      | "peakRankDivision"
      | "seasonHistory"
      | "seasonBadges"
      | "achievements"
    >
  > & {
    level: number;
  };

function toPublicPlayerAccount(account: PlayerAccountSnapshot): PublicPlayerAccountProfile {
  const unlockedAchievements = account.achievements.filter((achievement) => achievement.unlocked);
  return {
    playerId: account.playerId,
    displayName: account.displayName,
    level: Math.max(1, Math.floor(account.seasonPassTier ?? 1)),
    ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
    ...(account.eloRating != null ? { eloRating: account.eloRating } : {}),
    ...(account.rankDivision ? { rankDivision: account.rankDivision } : {}),
    ...(account.peakRankDivision ? { peakRankDivision: account.peakRankDivision } : {}),
    ...(account.seasonHistory?.length ? { seasonHistory: account.seasonHistory } : {}),
    ...(account.seasonBadges?.length ? { seasonBadges: account.seasonBadges } : {}),
    ...(unlockedAchievements.length ? { achievements: unlockedAchievements } : {})
  };
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
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth, X-Veil-Admin-Token");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  if (areTestEndpointsEnabled()) {
    app.post("/api/test/player-accounts/:playerId/action-proofs", async (request, response) => {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 403, {
          error: {
            code: "forbidden",
            message: "Invalid admin token"
          }
        });
        return;
      }

      if (!store) {
        sendJson(response, 503, {
          error: {
            code: "player_account_persistence_unavailable",
            message: "Player account action proof seeding requires configured room persistence storage"
          }
        });
        return;
      }

      try {
        const playerId = request.params.playerId?.trim();
        if (!playerId) {
          sendNotFound(response);
          return;
        }

        const body = (await readJsonBody(request)) as {
          campaignReplays?: Array<{
            roomId?: unknown;
            battleId?: unknown;
            result?: unknown;
          }>;
          dailyDungeonClaims?: Array<{
            runId?: unknown;
            dungeonId?: unknown;
            floor?: unknown;
          }>;
        };

        const account =
          (await store.loadPlayerAccount(playerId)) ??
          (await store.ensurePlayerAccount({
            playerId,
            displayName: playerId
          }));
        const completedAt = new Date().toISOString();
        const campaignReplays = (Array.isArray(body.campaignReplays) ? body.campaignReplays : [])
          .map((entry, index) => {
            const roomId = readRequiredString(entry.roomId);
            if (!roomId) {
              return null;
            }
            const battleId = readRequiredString(entry.battleId) ?? `${roomId}-test-battle-${index + 1}`;
            const result = entry.result === "defender_victory" ? "defender_victory" : "attacker_victory";
            return createTestVerifiedBattleReplay({
              playerId,
              roomId,
              battleId,
              result,
              completedAt
            });
          })
          .filter((entry): entry is PlayerBattleReplaySummary => Boolean(entry));
        const dailyDungeonClaims: DailyDungeonRunRecord[] = [];
        for (const [index, entry] of (Array.isArray(body.dailyDungeonClaims) ? body.dailyDungeonClaims : []).entries()) {
          const runId = readRequiredString(entry.runId);
          const dungeonId = readRequiredString(entry.dungeonId);
          if (!runId || !dungeonId) {
            continue;
          }
          const floor = Math.max(1, Math.floor(typeof entry.floor === "number" && Number.isFinite(entry.floor) ? entry.floor : index + 1));
          dailyDungeonClaims.push({
            runId,
            dungeonId,
            floor,
            startedAt: completedAt,
            rewardClaimedAt: completedAt
          });
        }

        const existingDailyDungeonState = account.dailyDungeonState ?? {
          dateKey: completedAt.slice(0, 10),
          attemptsUsed: 0,
          claimedRunIds: [],
          runs: []
        };
        const dailyDungeonRunIds = new Set(dailyDungeonClaims.map((entry) => entry.runId));
        const nextDailyDungeonState =
          dailyDungeonClaims.length > 0
            ? {
                ...existingDailyDungeonState,
                attemptsUsed: Math.max(existingDailyDungeonState.attemptsUsed ?? 0, dailyDungeonClaims.length),
                claimedRunIds: Array.from(
                  new Set([...(existingDailyDungeonState.claimedRunIds ?? []), ...dailyDungeonClaims.map((entry) => entry.runId)])
                ).sort((left, right) => left.localeCompare(right)),
                runs: [
                  ...dailyDungeonClaims,
                  ...(existingDailyDungeonState.runs ?? []).filter((entry) => !dailyDungeonRunIds.has(entry.runId))
                ]
              }
            : undefined;

        const progressPatch: PlayerAccountProgressPatch = {};
        if (campaignReplays.length > 0) {
          progressPatch.recentBattleReplays = [...campaignReplays, ...(account.recentBattleReplays ?? [])];
        }
        if (nextDailyDungeonState) {
          progressPatch.dailyDungeonState = nextDailyDungeonState;
        }

        const updatedAccount =
          campaignReplays.length > 0 || nextDailyDungeonState
            ? await store.savePlayerAccountProgress(playerId, progressPatch)
            : account;

        sendJson(response, 200, {
          seeded: {
            campaignReplays: campaignReplays.length,
            dailyDungeonClaims: dailyDungeonClaims.length
          },
          account: toRedactedPlayerAccount(updatedAccount)
        });
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          sendJson(response, 413, {
            error: toErrorPayload(error)
          });
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

        sendJson(response, 500, { error: toErrorPayload(error) });
      }
    });
  }

  app.get("/api/player-accounts", async (request, response) => {
    const adminAuthorized = isAdminAuthorized(request);
    const authSession = adminAuthorized ? null : await requireAuthSession(request, response, store);
    if (!adminAuthorized && !authSession) {
      return;
    }

    const requestedPlayerId = parsePlayerIdFilter(request);
    if (!store) {
      if (adminAuthorized || (requestedPlayerId && requestedPlayerId !== authSession?.playerId)) {
        sendJson(response, 200, { items: [] });
        return;
      }
      const account = createLocalModeAccount({
        playerId: authSession?.playerId,
        displayName: authSession?.displayName,
        ...(authSession?.loginId ? { loginId: authSession.loginId } : {})
      });
      sendJson(response, 200, { items: [withBattleReportCenter(account)] });
      return;
    }

    try {
      if (adminAuthorized) {
        const offset = parseNonNegativeOffset(request);
        sendJson(response, 200, {
          items: await store.listPlayerAccounts({
            limit: parseClampedPlayerAccountListLimit(request),
            ...(offset != null ? { offset } : {}),
            ...(requestedPlayerId ? { playerId: requestedPlayerId } : {})
          })
        });
        return;
      }

      if (requestedPlayerId && requestedPlayerId !== authSession?.playerId) {
        sendJson(response, 200, { items: [] });
        return;
      }

      const account =
        (await store.loadPlayerAccount(authSession!.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession!.playerId,
          displayName: authSession!.displayName
        }));
      sendJson(response, 200, {
        items: [withBattleReportCenter(account)]
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
      const hydratedAccount = await surfaceEndedSeasonalEventRewards(store, account);
      await recordReengagementReturn(store, hydratedAccount);
      emitExperimentExposureForSurface(
        hydratedAccount.playerId,
        hydratedAccount.lastRoomId ?? "account-profile",
        "player_account_profile",
        entitlements.experiments
      );
      sendJson(response, 200, {
        account: {
          ...(await withDailyQuestBoard(withBattleReportCenter(hydratedAccount), store, featureFlags.quest_system_enabled)),
          experiments: entitlements.experiments
        },
        session: issueNextAuthSession(hydratedAccount, authSession)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/social/friend-leaderboard", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 200, {
        items: [],
        friendCount: 0
      });
      return;
    }

    try {
      const friendIds = (parseOptionalQueryParam(request, "friendIds") ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const { accounts, friendCount } = await loadAuthorizedFriendLeaderboardAccounts(store, authSession.playerId, friendIds);
      sendJson(response, 200, {
        items: buildFriendLeaderboard(authSession.playerId, accounts),
        friendCount
      });
    } catch (error) {
      if (error instanceof FriendLeaderboardTooManyIdsError) {
        sendJson(response, 400, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/mailbox", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 200, { items: [], summary: { totalCount: 0, unreadCount: 0, claimableCount: 0, expiredCount: 0 } });
      return;
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const hydratedAccount = await surfaceEndedSeasonalEventRewards(store, account);
      const openedAccount = await acknowledgeReengagementMailboxOpen(store, hydratedAccount);
      sendJson(response, 200, toMailboxResponse(openedAccount));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player-accounts/me/mailbox/:messageId/claim", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const messageId = request.params.messageId?.trim();
    if (!messageId) {
      sendNotFound(response);
      return;
    }

    if (!store?.claimPlayerMailboxMessage) {
      sendJson(response, 503, {
        error: {
          code: "mailbox_persistence_unavailable",
          message: "Mailbox claims require configured room persistence storage"
        }
      });
      return;
    }

    try {
      const result = await store.claimPlayerMailboxMessage(authSession.playerId, messageId, new Date().toISOString());
      if (result.reason === "not_found") {
        sendJson(response, 404, {
          error: {
            code: "mailbox_message_not_found",
            message: "Mailbox message was not found"
          }
        });
        return;
      }

      sendJson(response, 200, {
        claimed: result.claimed,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.message ? { message: result.message } : {}),
        summary: result.summary,
        items: result.mailbox
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/social/group-challenge", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        action?: "create" | "redeem";
        token?: string;
        roomId?: string;
        challengeType?: "elo" | "victory";
        scoreTarget?: number;
      };

      if (body.action === "redeem") {
        const result = validateGroupChallengeToken(body.token?.trim() ?? "", readGroupChallengeSecret());
        if (!result.ok) {
          sendJson(response, result.reason === "expired" ? 410 : 400, {
            error: {
              code: result.reason === "expired" ? "group_challenge_expired" : "group_challenge_invalid",
              message: result.reason === "expired" ? "Group challenge token has expired" : "Group challenge token is invalid"
            }
          });
          return;
        }

        sendJson(response, 200, {
          challenge: result.challenge
        });
        return;
      }

      const challenge = createGroupChallenge({
        creatorPlayerId: authSession.playerId,
        creatorDisplayName: authSession.displayName,
        roomId: body.roomId?.trim() || parseOptionalQueryParam(request, "roomId") || "room-alpha",
        ...(body.challengeType ? { challengeType: body.challengeType } : {}),
        ...(typeof body.scoreTarget === "number" && Number.isFinite(body.scoreTarget)
          ? { scoreTarget: body.scoreTarget }
          : {})
      });
      sendJson(response, 200, {
        challenge,
        token: encodeGroupChallengeToken(challenge, readGroupChallengeSecret())
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player-accounts/me/mailbox/claim-all", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store?.claimAllPlayerMailboxMessages) {
      sendJson(response, 503, {
        error: {
          code: "mailbox_persistence_unavailable",
          message: "Mailbox claims require configured room persistence storage"
        }
      });
      return;
    }

    try {
      const result = await store.claimAllPlayerMailboxMessages(authSession.playerId, new Date().toISOString());
      sendJson(response, 200, {
        claimed: result.claimed,
        claimedMessageIds: result.claimedMessageIds,
        summary: result.summary,
        items: result.mailbox
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/support-tickets", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store?.listSupportTickets) {
      sendJson(response, 503, {
        error: {
          code: "support_ticket_persistence_unavailable",
          message: "Support tickets require configured room persistence storage"
        }
      });
      return;
    }

    try {
      const statusQuery = parseOptionalQueryParam(request, "status");
      const categoryQuery = parseOptionalQueryParam(request, "category");
      const status =
        statusQuery === "open" || statusQuery === "resolved" || statusQuery === "dismissed" ? statusQuery : undefined;
      const category =
        categoryQuery === "bug" || categoryQuery === "payment" || categoryQuery === "account" || categoryQuery === "other"
          ? categoryQuery
          : undefined;
      const items = await store.listSupportTickets({
        playerId: authSession.playerId,
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        limit: parseLimit(request) ?? 20
      });
      sendJson(response, 200, { items });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/player-accounts/me/support-tickets", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store?.createSupportTicket) {
      sendJson(response, 503, {
        error: {
          code: "support_ticket_persistence_unavailable",
          message: "Support tickets require configured room persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        category?: SupportTicketCategory;
        message?: string;
        attachmentsRef?: string;
        priority?: SupportTicketPriority;
      };
      const ticket = await store.createSupportTicket({
        playerId: authSession.playerId,
        category: body.category ?? "other",
        message: body.message ?? "",
        ...(body.attachmentsRef ? { attachmentsRef: body.attachmentsRef } : {}),
        ...(body.priority ? { priority: body.priority } : {})
      });
      sendJson(response, 202, {
        accepted: true,
        ticket
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/admin/player-mailbox/deliver", async (request, response) => {
    const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
    if (!adminToken) {
      sendJson(response, 503, {
        error: {
          code: "not_configured",
          message: "Admin token not configured"
        }
      });
      return;
    }

    if (!isAdminAuthorized(request)) {
      sendJson(response, 403, {
        error: {
          code: "forbidden",
          message: "Invalid admin token"
        }
      });
      return;
    }

    if (!store?.deliverPlayerMailbox) {
      sendJson(response, 503, {
        error: {
          code: "mailbox_persistence_unavailable",
          message: "Mailbox delivery requires configured room persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        playerIds?: string[];
        message?: {
          id?: string;
          kind?: "system" | "compensation" | "announcement";
          title?: string;
          body?: string;
          sentAt?: string;
          expiresAt?: string;
          grant?: PlayerAccountSnapshot["mailbox"] extends Array<infer T> ? T extends { grant?: infer G } ? G : never : never;
        };
      };
      const playerIds = (body.playerIds ?? []).map((playerId) => playerId?.trim()).filter((playerId): playerId is string => Boolean(playerId));
      if (playerIds.length === 0) {
        sendJson(response, 400, {
          error: {
            code: "invalid_player_ids",
            message: "playerIds must not be empty"
          }
        });
        return;
      }

      const message = normalizePlayerMailboxMessage({
        id: body.message?.id ?? "",
        title: body.message?.title ?? "",
        body: body.message?.body ?? "",
        ...(body.message?.kind ? { kind: body.message.kind } : {}),
        ...(body.message?.sentAt ? { sentAt: body.message.sentAt } : {}),
        ...(body.message?.expiresAt ? { expiresAt: body.message.expiresAt } : {}),
        ...(body.message?.grant ? { grant: body.message.grant } : {})
      });
      const result = await store.deliverPlayerMailbox({
        playerIds,
        message
      });
      sendJson(response, 200, {
        delivered: result.deliveredPlayerIds.length,
        skipped: result.skippedPlayerIds.length,
        deliveredPlayerIds: result.deliveredPlayerIds,
        skippedPlayerIds: result.skippedPlayerIds,
        message: result.message
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, {
          error: {
            code: error.name,
            message: error.message
          }
        });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/admin/player-accounts/:playerId/name-history", async (request, response) => {
    if (!isAdminAuthorized(request)) {
      sendJson(response, 403, {
        error: {
          code: "forbidden",
          message: "Invalid admin token"
        }
      });
      return;
    }

    if (!store?.listPlayerNameHistory) {
      sendJson(response, 503, {
        error: {
          code: "name_history_unavailable",
          message: "Player name history requires configured room persistence storage"
        }
      });
      return;
    }

    const playerId = request.params.playerId?.trim();
    if (!playerId) {
      sendNotFound(response);
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      const items = await store.listPlayerNameHistory(playerId, { limit: parseLimit(request) ?? 20 });
      sendJson(response, 200, {
        playerId,
        ...(account ? { account } : {}),
        items
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/admin/player-accounts/name-history", async (request, response) => {
    if (!isAdminAuthorized(request)) {
      sendJson(response, 403, {
        error: {
          code: "forbidden",
          message: "Invalid admin token"
        }
      });
      return;
    }

    if (!store?.findPlayerNameHistoryByDisplayName) {
      sendJson(response, 503, {
        error: {
          code: "name_history_unavailable",
          message: "Player name history requires configured room persistence storage"
        }
      });
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const displayName = url.searchParams.get("displayName")?.trim();
    if (!displayName) {
      sendJson(response, 400, {
        error: {
          code: "invalid_display_name",
          message: "displayName query parameter is required"
        }
      });
      return;
    }

    try {
      const items = await store.findPlayerNameHistoryByDisplayName(displayName, { limit: parseLimit(request) ?? 20 });
      const reservation = await store.findActivePlayerNameReservation?.(displayName);
      sendJson(response, 200, {
        displayName,
        items,
        ...(reservation ? { reservation } : {})
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/account/notification-prefs", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        matchFound?: boolean;
        turnReminder?: boolean;
        groupChallenge?: boolean;
        friendLeaderboard?: boolean;
        reengagement?: boolean;
      };
      const notificationPreferences = normalizeNotificationPreferences(body);

      if (!store) {
        sendJson(response, 200, { notificationPreferences });
        return;
      }

      const account = await store.savePlayerAccountProfile(authSession.playerId, {
        notificationPreferences
      });
      sendJson(response, 200, {
        notificationPreferences: account.notificationPreferences ?? notificationPreferences,
        account: withBattleReportCenter(account)
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/players/me/push-token", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }
    if (!store) {
      sendJson(response, 503, {
        error: {
          code: "persistence_unavailable",
          message: "Push token registration requires configured room persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { platform: string; token: string };
      const existing = await store.loadPlayerAccount(authSession.playerId);
      const pushTokens = upsertMobilePushToken(existing?.pushTokens, body);
      const account = await store.savePlayerAccountProfile(authSession.playerId, { pushTokens });
      sendJson(response, 200, {
        pushTokens: account.pushTokens ?? pushTokens
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.delete("/api/players/me/push-token", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }
    if (!store) {
      sendJson(response, 503, {
        error: {
          code: "persistence_unavailable",
          message: "Push token removal requires configured room persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { platform?: string; token?: string };
      if (!body.platform?.trim() && !body.token?.trim()) {
        sendJson(response, 400, {
          error: {
            code: "invalid_push_token",
            message: "platform or token is required"
          }
        });
        return;
      }

      const existing = await store.loadPlayerAccount(authSession.playerId);
      const pushTokens = removeMobilePushToken(existing?.pushTokens, body) ?? null;
      const account = await store.savePlayerAccountProfile(authSession.playerId, { pushTokens });
      sendJson(response, 200, {
        pushTokens: account.pushTokens ?? []
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
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
      const result = await issueDailyLoginReward(store, account);
      if (!result.claimed) {
        sendJson(response, 200, {
          claimed: false,
          reason: result.reason
        });
        return;
      }

      sendJson(response, 200, {
        claimed: true,
        streak: result.streak,
        reward: result.reward
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

  app.post("/api/player-accounts/me/season/claim-tier", async (request, response) => {
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
      const currentQuestState = await store.loadPlayerQuestState?.(account.playerId);
      const cycleKey = board.cycleKey ?? timestamp.slice(0, 10);
      if (store.savePlayerQuestState && cycleKey) {
        const questIds = board.quests.map((entry) => entry.id);
        const trackedState = currentQuestState ?? {
          playerId: account.playerId,
          currentDateKey: cycleKey,
          activeQuestIds: questIds,
          rotations: [],
          updatedAt: timestamp
        };
        const nextRotations = trackedState.rotations.some((entry) => entry.dateKey === cycleKey)
          ? trackedState.rotations.map((entry) =>
              entry.dateKey === cycleKey
                ? {
                    ...entry,
                    questIds,
                    completedQuestIds: Array.from(new Set([...entry.completedQuestIds, quest.id])).sort((left, right) =>
                      left.localeCompare(right)
                    ),
                    claimedQuestIds: Array.from(new Set([...entry.claimedQuestIds, quest.id])).sort((left, right) =>
                      left.localeCompare(right)
                    )
                  }
                : entry
            )
          : [
              ...trackedState.rotations,
              {
                dateKey: cycleKey,
                questIds,
                completedQuestIds: [quest.id],
                claimedQuestIds: [quest.id]
              }
            ];
        await store.savePlayerQuestState(account.playerId, {
          ...trackedState,
          currentDateKey: cycleKey,
          activeQuestIds: questIds,
          rotations: nextRotations,
          updatedAt: timestamp
        });
      }
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
        payload: toTutorialAnalyticsPayload(action)
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
      if (error instanceof Error && error.message === "tutorial_progress_out_of_order") {
        sendJson(response, 409, {
          error: {
            code: "tutorial_progress_out_of_order",
            message: "Tutorial progress must advance in order"
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
      const accessContext = await loadCampaignAccessContext(store, account);

      sendJson(response, 200, {
        campaign: toCampaignResponse(account, accessContext)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/campaigns/missions/:id", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const missionId = request.params.id?.trim();
    if (!missionId) {
      sendNotFound(response);
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
      const accessContext = await loadCampaignAccessContext(store, account);
      const mission = buildCampaignMissionStates(resolveCampaignConfig(), account.campaignProgress, accessContext).find(
        (entry) => entry.id === missionId
      );

      if (!mission) {
        sendJson(response, 404, {
          error: {
            code: "campaign_mission_not_found",
            message: "Campaign mission was not found"
          }
        });
        return;
      }

      sendJson(response, 200, { mission });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/campaigns/:campaignId/missions/:missionId/start", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const campaignId = request.params.campaignId?.trim();
    const missionId = request.params.missionId?.trim();
    if (!campaignId || !missionId) {
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
      const accessContext = await loadCampaignAccessContext(store, account);
      const mission = buildCampaignMissionStates(resolveCampaignConfig(), account.campaignProgress, accessContext).find(
        (entry) => entry.id === missionId && entry.chapterId === campaignId
      );
      if (!mission) {
        sendJson(response, 404, {
          error: {
            code: "campaign_mission_not_found",
            message: "Campaign mission was not found"
          }
        });
        return;
      }
      if (mission.status === "completed") {
        sendJson(response, 409, {
          error: {
            code: "campaign_mission_already_completed",
            message: "Campaign mission has already been completed"
          }
        });
        return;
      }
      if (mission.status === "locked") {
        sendJson(response, 403, {
          error: {
            code: "campaign_mission_locked",
            message: "Campaign mission is not unlocked yet"
          },
          unlock_requirements: (mission.unlockRequirements ?? []).filter((requirement) => requirement.satisfied !== true)
        });
        return;
      }

      emitAnalyticsEvent("mission_started", {
        playerId: account.playerId,
        roomId: mission.mapId,
        payload: {
          campaignId: mission.chapterId,
          missionId,
          mapId: mission.mapId,
          chapterOrder: Number.parseInt(mission.chapterId.replace(/^chapter/i, ""), 10) || 1
        }
      });

      sendJson(response, 200, {
        started: true,
        mission
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

    if (isActionSubmissionRateLimitEnabled()) {
      const rateLimitResult = await consumeActionSubmissionRateLimit(`campaign-mission-complete:${authSession.playerId}`);
      if (!rateLimitResult.allowed) {
        sendActionSubmissionRateLimited(response, rateLimitResult.retryAfterSeconds);
        return;
      }
    }

    try {
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const missions = resolveCampaignConfig();
      const mission = buildCampaignMissionStates(missions, account.campaignProgress).find((entry) => entry.id === missionId);
      if (!mission) {
        sendJson(response, 404, {
          error: {
            code: "campaign_mission_not_found",
            message: "Campaign mission was not found"
          }
        });
        return;
      }
      if (mission.status === "locked") {
        sendJson(response, 409, {
          error: {
            code: "campaign_mission_locked",
            message: "Campaign mission is not unlocked yet"
          }
        });
        return;
      }
      if (mission.status === "completed") {
        sendJson(response, 409, {
          error: {
            code: "campaign_mission_already_completed",
            message: "Campaign mission has already been completed"
          }
        });
        return;
      }
      if (!hasVerifiedCampaignMissionCompletion(account, mission)) {
        sendJson(response, 403, {
          error: {
            code: "campaign_mission_action_not_verified",
            message: "Campaign mission completion must follow a verified victory replay"
          }
        });
        return;
      }
      const result = completeCampaignMission(missions, account.campaignProgress, missionId);
      const rewardMutation = toRewardMutation(account, result.reward);
      const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
        campaignProgress: result.campaignProgress,
        gems: rewardMutation.gems,
        cosmeticInventory: rewardMutation.cosmeticInventory,
        globalResources: rewardMutation.globalResources
      });
      const accessContext = await loadCampaignAccessContext(store, nextAccount);
      emitAnalyticsEvent("mission_complete", {
        playerId: account.playerId,
        roomId: result.mission.mapId,
        payload: {
          campaignId: result.mission.chapterId,
          missionId: result.mission.id,
          reward: result.reward
        }
      });

      sendJson(response, 200, {
        completed: true,
        mission: result.mission,
        reward: result.reward,
        campaign: toCampaignResponse(nextAccount, accessContext)
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
      const now = resolveDailyDungeonNow(request);
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
        dailyDungeon: toDailyDungeonResponse(account, now)
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("daily_dungeon_not_active_for_")) {
        sendJson(response, 404, {
          error: {
            code: "daily_dungeon_not_active",
            message: "Daily dungeon is not active for the requested date"
          }
        });
        return;
      }
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

    if (isActionSubmissionRateLimitEnabled()) {
      const rateLimitResult = await consumeActionSubmissionRateLimit(`daily-dungeon-attempt:${authSession.playerId}`);
      if (!rateLimitResult.allowed) {
        sendActionSubmissionRateLimited(response, rateLimitResult.retryAfterSeconds);
        return;
      }
    }

    try {
      const now = resolveDailyDungeonNow(request);
      const body = (await readJsonBody(request)) as { floor?: number | null };
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const dungeon = resolvePrimaryDailyDungeon(now);
      const result = startDailyDungeonRun(dungeon, account.dailyDungeonState, body.floor ?? undefined, now);
      const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
        dailyDungeonState: result.dailyDungeonState
      });

      sendJson(response, 200, {
        started: true,
        run: result.run,
        floor: result.floor,
        dailyDungeon: toDailyDungeonResponse(nextAccount, now)
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
      if (error instanceof Error && error.message === "daily_dungeon_already_completed") {
        sendJson(response, 409, {
          error: {
            code: "daily_dungeon_already_completed",
            message: "Daily dungeon has already been completed for the current window"
          }
        });
        return;
      }
      if (error instanceof Error && error.message.startsWith("daily_dungeon_not_active_for_")) {
        sendJson(response, 404, {
          error: {
            code: "daily_dungeon_not_active",
            message: "Daily dungeon is not active for the requested date"
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
      const now = resolveDailyDungeonNow(request);
      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const dungeon = resolvePrimaryDailyDungeon(now);
      const result = claimDailyDungeonRunReward(dungeon, account.dailyDungeonState, runId, now);
      const rewardMutation = toRewardMutation(account, result.floor.reward);
      const eventMutation = applyActiveSeasonalEventProgress(
        account,
        {
          actionId: result.run.runId,
          actionType: "daily_dungeon_reward_claimed",
          dungeonId: result.run.dungeonId,
          ...(result.run.rewardClaimedAt ? { occurredAt: result.run.rewardClaimedAt } : {})
        },
        new Date(result.run.rewardClaimedAt ?? now.toISOString())
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
        dailyDungeon: toDailyDungeonResponse(nextAccount, now),
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
      if (error instanceof Error && error.message.startsWith("daily_dungeon_not_active_for_")) {
        sendJson(response, 404, {
          error: {
            code: "daily_dungeon_not_active",
            message: "Daily dungeon is not active for the requested date"
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
      if (error instanceof Error && error.message === "referral_daily_limit_exceeded") {
        sendJson(response, 429, {
          error: {
            code: "referral_daily_limit_exceeded",
            message: "Daily referral reward limit reached for this referrer"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "referral_lifetime_limit_exceeded") {
        sendJson(response, 429, {
          error: {
            code: "referral_lifetime_limit_exceeded",
            message: "Lifetime referral reward limit reached for this referrer"
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
      sendJson(response, 500, {
        error: {
          code: "gdpr_delete_failed",
          message: error instanceof Error ? error.message : String(error)
        }
      });
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

  app.post("/api/player-accounts/me/battle-replays/:replayId/playback", async (request, response) => {
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
      const playback = toReplayPlaybackResponse(account, null, replayId, toReplayPlaybackCommandPayload(await readJsonBody(request)));
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
      const accessContext = await loadCampaignAccessContext(store, account);
      sendJson(response, 200, {
        ...toProgressionResponse(account, parseLimit(request)),
        dailyQuestBoard: await loadDailyQuestBoard(
          store,
          account,
          new Date(),
          featureFlags.quest_system_enabled && isTutorialComplete(account.tutorialStep)
        ),
        campaign: toCampaignResponse(account, accessContext),
        dailyDungeon: toDailyDungeonResponse(account)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/player-accounts/me/season/progress", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    const featureFlags = resolveFeatureFlagsForPlayer(authSession.playerId);
    if (!store) {
      sendJson(
        response,
        200,
        toSeasonProgressResponse(
          createLocalModeAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            ...(authSession.loginId ? { loginId: authSession.loginId } : {})
          }),
          featureFlags.battle_pass_enabled
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
      sendJson(response, 200, toSeasonProgressResponse(account, featureFlags.battle_pass_enabled));
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

    const adminAuthorized = isAdminAuthorized(request);
    const authSession = adminAuthorized ? null : await requireAuthSession(request, response, store);
    if (!adminAuthorized && !authSession) {
      return;
    }
    const isOwner = authSession?.playerId === playerId;

    if (!store) {
      const account = withBattleReportCenter(
        createLocalModeAccount({
          playerId,
          displayName: isOwner ? authSession?.displayName : playerId,
          ...(isOwner && authSession?.loginId ? { loginId: authSession.loginId } : {})
        })
      );
      sendJson(response, 200, {
        account: adminAuthorized || isOwner ? account : toPublicPlayerAccount(account)
      });
      return;
    }

    try {
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        if (isEphemeralGuestPlayerId(playerId)) {
          const localAccount = withBattleReportCenter(
            createLocalModeAccount({
              playerId,
              displayName: isOwner ? authSession?.displayName : playerId,
              ...(isOwner && authSession?.loginId ? { loginId: authSession.loginId } : {})
            })
          );
          sendJson(response, 200, {
            account: adminAuthorized || isOwner ? localAccount : toPublicPlayerAccount(localAccount)
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

      const accountWithReports = withBattleReportCenter(account);
      sendJson(response, 200, {
        account: adminAuthorized || isOwner ? accountWithReports : toPublicPlayerAccount(accountWithReports)
      });
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
    const authorizedPlayerScope = await requireAuthorizedPlayerScope(request, response, store, playerId);
    if (!authorizedPlayerScope) {
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
    const authorizedPlayerScope = await requireAuthorizedPlayerScope(request, response, store, playerId);
    if (!authorizedPlayerScope) {
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

  app.post("/api/player-accounts/:playerId/battle-replays/:replayId/playback", async (request, response) => {
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

      const playback = toReplayPlaybackResponse(account, null, replayId, toReplayPlaybackCommandPayload(await readJsonBody(request)));
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
    const authSession = await requireAuthorizedPlayerScope(request, response, store, playerId);
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
            ...(authSession.loginId ? { loginId: authSession.loginId } : {})
          }),
          request
        )
      );
      return;
    }

    try {
      const account = await store.loadPlayerAccount(authSession.playerId);
      if (!account) {
        if (isEphemeralGuestPlayerId(authSession.playerId)) {
          sendJson(
            response,
            200,
            toAchievementResponse(
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
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${authSession.playerId}`
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
    const authSession = await requireAuthorizedPlayerScope(request, response, store, playerId);
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
      const account = await store.loadPlayerAccount(authSession.playerId);
      if (!account) {
        if (isEphemeralGuestPlayerId(authSession.playerId)) {
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
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${authSession.playerId}`
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

      const decrypted = await decryptWechatPhoneNumber({
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

      if (
        wantsSensitiveWechatValidation &&
        !(await validateWechatSignatureEnvelope(response, authSession.playerId, "update-profile", body.wechatSignature))
      ) {
        return;
      }

      if (!store) {
        if (patch.displayName !== undefined) {
          await assertDisplayNameAvailableOrThrow(null, patch.displayName, authSession.playerId);
        }
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
        if (patch.displayName !== undefined) {
          await assertDisplayNameAvailableOrThrow(null, patch.displayName, playerId);
        }
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
        !(await validateWechatSignatureEnvelope(response, authSession.playerId, "update-profile", body.wechatSignature))
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
