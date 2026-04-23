import { CloseCode, ErrorCode } from "@colyseus/shared-types";
import { Room, ServerError, type AuthContext, type Client as ColyseusClient } from "colyseus";
import type { ActionValidationFailure, PlayerBattleReplaySummary } from "@veil/shared/battle";
import { normalizeCosmeticInventory, resolveCosmeticCatalog } from "@veil/shared/economy";
import type { BattleAction, FriendLeaderboardEntry, GroupChallenge, MovementPlan, PlayerWorldView, WorldAction, WorldEvent } from "@veil/shared/models";
import { classifyReconnectFailure, DEFAULT_MIN_SUPPORTED_CLIENT_VERSION, type FeatureFlags, isClientVersionSupported, normalizeClientVersion } from "@veil/shared/platform";
import { DEFAULT_TUTORIAL_STEP } from "@veil/shared/progression";
import type { ClientMessage, ServerMessage, SessionStatePayload, SessionStateReason } from "@veil/shared/protocol";
import { normalizeEloRating } from "@veil/shared/social";
import { createInitialWorldState, createPlayerWorldView, encodePlayerWorldView, filterWorldEventsForPlayer, getBattleBalanceConfig, listReachableTilesInPlayerView, planPlayerViewMovement, validateWorldAction } from "@veil/shared/world";
import { emitAnalyticsEvent } from "@server/domain/ops/analytics";
import { resolveMinimumSupportedClientVersion } from "@server/domain/battle/feature-flags";
import {
  buildAuthoritativeRoomErrorContext,
  createRoom,
  type AuthoritativeWorldRoom,
  type RoomPersistenceSnapshot
} from "@server/index";
import {
  appendCompletedBattleReplaysToAccount,
  buildPlayerBattleReplaySummariesForPlayer,
  type CompletedBattleReplayCapture
} from "@server/domain/battle/battle-replays";
import { didPlayerWinBattle, resolveBattlePassConfig } from "@server/domain/economy/battle-pass";
import {
  applyPlayerAccountsToWorldState,
  applyPlayerHeroArchivesToWorldState,
  equipOwnedCosmetic,
  type RoomSnapshotStore,
  type PlayerAccountSnapshot,
  type BattleSnapshotRecord
} from "@server/persistence";
import { isPlayerBanActive } from "@server/domain/player-ban";
import {
  configureConfigRuntimeStatusProvider,
  flushPendingConfigUpdate,
  registerConfigUpdateListener
} from "@server/config-center";
import { applyPlayerEventLogAndAchievements } from "@server/domain/account/player-achievements";
import { validateGuestAuthToken, type GuestAuthSession } from "@server/domain/account/auth";
import { buildMinorProtectionBlockDetails, deriveMinorProtectionState, readMinorProtectionConfig } from "@server/domain/ops/minor-protection";
import { acknowledgeCampaignDialogueLine, resolveCampaignConfig } from "@server/domain/battle/pve-content";
import {
  recordBattleActionMessage,
  recordAntiCheatAlert,
  recordLeaderboardAbuseAlert,
  recordBattleLifecycleResolved,
  recordRuntimeErrorEvent,
  recordConnectMessage,
  recordRoomCreated,
  recordRoomDisposed,
  recordReconnectWindowOpened,
  recordReconnectWindowResolved,
  recordRuntimeRoom,
  recordSocialFriendLeaderboardRequest,
  recordSocialShareActivityRequest,
  recordWebSocketActionKick,
  recordWebSocketActionRateLimited,
  recordWorldActionMessage,
  removeRuntimeRoom
} from "@server/domain/ops/observability";
import { sendMobilePushNotification } from "@server/adapters/mobile-push";
import { sendWechatSubscribeMessage, type WechatSubscribeTemplateKey } from "@server/adapters/wechat-subscribe";
import { resolveFeatureFlagsForPlayer } from "@server/domain/battle/feature-flags";
import { captureServerError } from "@server/domain/ops/error-monitoring";
import { settleLeaderboardMatch } from "@server/domain/social/leaderboard-anti-abuse";
import { normalizeTutorialProgressAction, toTutorialAnalyticsPayload } from "@server/domain/account/tutorial-progress";
import { buildFriendLeaderboard, createGroupChallenge, encodeGroupChallengeToken } from "@server/adapters/wechat-social";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";

import {
  activeRoomInstances,
  advanceLobbyRoomOwnerToken,
  clamp,
  cloneResourceLedger,
  compareDefaultPlayerSlotIds,
  configuredRoomSnapshotStore,
  DEFAULT_GROUP_CHALLENGE_SECRET,
  EMPTY_ROOM_TTL_MS,
  ensureZombieRoomCleanupLoop,
  formatBackgroundTaskDetail,
  hasBattleSnapshotStore,
  hasPlayerReportStore,
  isDefaultPlayerSlotId,
  lobbyRoomOwnerTokens,
  lobbyRoomSummaries,
  MAP_SYNC_CHUNK_SIZE,
  MAP_SYNC_CHUNK_PADDING,
  MINOR_PROTECTION_TICK_MS,
  readMinimumSupportedClientVersion,
  readSuspiciousActionAlertConfig,
  readWebSocketActionRateLimitConfig,
  rebindWorldStatePlayerId,
  RECONNECTION_WINDOW_SECONDS,
  reportBackgroundTaskFailure,
  reportPersistenceSaveFailure,
  resolveFocusedMapBounds,
  roomRuntimeDependencies,
  sendMessage,
  TURN_REMINDER_DISCONNECT_THRESHOLD_MS,
  TURN_TIMER_TICK_MS,
  type IdempotentActionReplayEntry,
  type IdempotentActionReply,
  type JoinOptions,
  type LobbyRoomSummary,
  type PendingIdempotentActionReplayEntry,
  type RoomRuntimeDependencies,
  type RoomTimerHandle,
  type SuspiciousActionAlertConfig,
  type SuspiciousActionTracker,
  type VeilRoomMetadata,
  type VeilRoomOptions,
  type WebSocketActionRateLimitConfig
} from "@server/transport/colyseus-room";

// Re-export public API so existing imports from "@server/transport/colyseus-room/VeilColyseusRoom" continue to work.
export type { JoinOptions, LobbyRoomSummary, VeilRoomMetadata, VeilRoomOptions } from "@server/transport/colyseus-room";
export {
  configureRoomSnapshotStore,
  configureRoomRuntimeDependencies,
  resetRoomRuntimeDependencies,
  listLobbyRooms,
  resetLobbyRoomRegistry,
  getActiveRoomInstances,
  runZombieRoomCleanup
} from "@server/transport/colyseus-room";

type RemoteJoinIdentity = {
  playerId: string;
  authSession: GuestAuthSession | null;
};

export class VeilColyseusRoom extends Room<VeilRoomOptions> {
  maxClients = 8;
  patchRate = null;

  public worldRoom!: AuthoritativeWorldRoom;
  private readonly wsActionRateLimitConfig = readWebSocketActionRateLimitConfig();
  private readonly suspiciousActionAlertConfig = readSuspiciousActionAlertConfig();
  private readonly minorProtectionConfig = readMinorProtectionConfig();
  private readonly lobbyRoomOwnerToken = advanceLobbyRoomOwnerToken();
  private readonly playerIdBySessionId = new Map<string, string>();
  private readonly authSessionByPlayerId = new Map<string, GuestAuthSession>();
  private readonly analyticsSessionStartedAtBySessionId = new Map<string, number>();
  private readonly analyticsSessionDisconnectReasonBySessionId = new Map<string, string>();
  private readonly disconnectedAtByPlayerId = new Map<string, string>();
  private readonly reconnectedAtByPlayerId = new Map<string, string>();
  private readonly wsActionTimestampsByPlayerId = new Map<string, number[]>();
  private readonly suspiciousActionTrackerBySessionId = new Map<string, SuspiciousActionTracker>();
  private readonly completedActionRepliesBySessionId = new Map<string, Map<string, IdempotentActionReplayEntry>>();
  private readonly pendingActionRepliesBySessionId = new Map<string, Map<string, PendingIdempotentActionReplayEntry>>();
  private unsubscribeConfigUpdate: (() => void) | null = null;
  private turnTimerHandle: RoomTimerHandle | null = null;
  private turnOwnerPlayerId: string | null = null;
  private turnTimerTickInFlight = false;
  private roomRetired = false;
  private emptyRoomSinceAtMs: number | null = null;

  async onAuth(
    client: ColyseusClient,
    options: JoinOptions & { authToken?: string },
    _context: AuthContext
  ): Promise<RemoteJoinIdentity> {
    const authToken = options.authToken?.trim();
    if (!authToken) {
      return {
        playerId: client.sessionId,
        authSession: null
      };
    }

    const authValidation = await validateGuestAuthToken(authToken, configuredRoomSnapshotStore);
    if (!authValidation.session) {
      throw new ServerError(ErrorCode.AUTH_FAILED, authValidation.errorCode ?? "unauthorized");
    }

    return {
      playerId: authValidation.session.playerId,
      authSession: authValidation.session
    };
  }

  async onCreate(options: JoinOptions): Promise<void> {
    const logicalRoomId = options.logicalRoomId ?? "room-alpha";
    this.metadata = { logicalRoomId };
    lobbyRoomOwnerTokens.set(logicalRoomId, this.lobbyRoomOwnerToken);
    activeRoomInstances.set(logicalRoomId, this);
    this.emptyRoomSinceAtMs = roomRuntimeDependencies.now();
    ensureZombieRoomCleanupLoop();
    this.setState({});
    const persistedSnapshot = configuredRoomSnapshotStore
      ? await configuredRoomSnapshotStore.load(logicalRoomId)
      : null;

    if (persistedSnapshot) {
      this.worldRoom = createRoom(logicalRoomId, options.seed, persistedSnapshot);
    } else {
      let initialState = createInitialWorldState(options.seed, logicalRoomId);
      if (configuredRoomSnapshotStore) {
        const playerIds = Array.from(
          new Set([...initialState.heroes.map((hero) => hero.playerId), ...Object.keys(initialState.resources)])
        );
        const [accounts, heroArchives] = await Promise.all([
          configuredRoomSnapshotStore.loadPlayerAccounts(playerIds),
          configuredRoomSnapshotStore.loadPlayerHeroArchives(playerIds)
        ]);
        initialState = applyPlayerAccountsToWorldState(initialState, accounts);
        initialState = applyPlayerHeroArchivesToWorldState(initialState, heroArchives);
      }

      this.worldRoom = createRoom(logicalRoomId, options.seed, {
        state: initialState,
        battles: []
      });
    }

    await this.persistRoomState();
    this.publishLobbyRoomSummary();
    recordRoomCreated(logicalRoomId);
    this.ensureTurnTimerLoop();

    this.unsubscribeConfigUpdate = registerConfigUpdateListener((bundle) => {
      for (const client of this.clients) {
        sendMessage(client, "config.update", {
          requestId: "push",
          delivery: "push",
          payload: { bundle }
        });
      }
    });
    this.clock.setInterval(() => {
      void this.tickMinorPlaytime();
    }, MINOR_PROTECTION_TICK_MS);

    this.onMessage("connect", async (client, message: Extract<ClientMessage, { type: "connect" }>) => {
      recordConnectMessage();
      if (!isClientVersionSupported(message.clientVersion, readMinimumSupportedClientVersion(message.clientChannel))) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "upgrade_required" });
        return;
      }

      const authValidation = message.authToken
        ? await validateGuestAuthToken(message.authToken, configuredRoomSnapshotStore)
        : { session: null };
      const authSession = authValidation.session;
      if (message.authToken && !authSession) {
        this.rejectExpiredSession(client, message.requestId, authValidation.errorCode ?? "unauthorized");
        sendMessage(client, "error", { requestId: message.requestId, reason: "unauthorized" });
        return;
      }

      const playerId = authSession?.playerId ?? this.resolveConnectPlayerId(client, message.playerId);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

      const effectiveAuthSession = authSession ?? this.authSessionByPlayerId.get(playerId) ?? null;
      this.playerIdBySessionId.set(client.sessionId, playerId);
      this.updatePlayerAuthSession(playerId, effectiveAuthSession);
      this.disconnectedAtByPlayerId.delete(playerId);
      this.refreshEmptyRoomTracking();
      let ensuredAccount: PlayerAccountSnapshot | null = null;
      if (configuredRoomSnapshotStore) {
        try {
          ensuredAccount = await configuredRoomSnapshotStore.ensurePlayerAccount({
            playerId,
            ...((effectiveAuthSession?.displayName ?? message.displayName?.trim())
              ? { displayName: effectiveAuthSession?.displayName ?? message.displayName?.trim() ?? playerId }
              : {}),
            lastRoomId: logicalRoomId
          });
        } catch (error) {
          console.error("[VeilRoom] Failed to ensure player account during connect", {
            roomId: logicalRoomId,
            playerId,
            error
          });
          ensuredAccount = null;
        }
      }
      if (isPlayerBanActive(ensuredAccount)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "account_banned" });
        client.leave(CloseCode.WITH_ERROR, "account_banned");
        return;
      }
      if (await this.enforceMinorProtectionForClient(client, playerId, ensuredAccount, message.requestId)) {
        return;
      }
      if (
        !this.worldRoom.getInternalState().heroes.some((hero) => hero.playerId === playerId) &&
        !this.findAvailablePlayerWorldSlotId()
      ) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "room_full" });
        client.leave(CloseCode.WITH_ERROR, "room_full");
        return;
      }
      await this.ensurePlayerWorldSlot(playerId, ensuredAccount);
      await this.reconcileInterruptedBattles(playerId);
      if (this.shouldRunTurnTimer()) {
        this.ensureTurnTimerState();
        await this.persistRoomState();
      }
      this.publishLobbyRoomSummary();

      sendMessage(client, "session.state", {
        requestId: message.requestId,
        delivery: "reply",
        payload: this.buildStatePayload(playerId)
      });
      emitAnalyticsEvent("session_start", {
        playerId,
        roomId: logicalRoomId,
        payload: {
          roomId: logicalRoomId,
          authMode: effectiveAuthSession?.authMode ?? "guest",
          platform: "colyseus"
        }
      });
      this.analyticsSessionStartedAtBySessionId.set(client.sessionId, roomRuntimeDependencies.now());
      this.analyticsSessionDisconnectReasonBySessionId.delete(client.sessionId);
    });

    this.onMessage("TOKEN_REFRESH", async (client, message: Extract<ClientMessage, { type: "TOKEN_REFRESH" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

      const authValidation = await validateGuestAuthToken(message.authToken, configuredRoomSnapshotStore);
      const authSession = authValidation.session;
      if (!authSession || authSession.playerId !== playerId) {
        this.rejectExpiredSession(client, message.requestId, authValidation.errorCode ?? "unauthorized");
        sendMessage(client, "error", { requestId: message.requestId, reason: "unauthorized" });
        return;
      }

      this.updatePlayerAuthSession(playerId, authSession);
      sendMessage(client, "session.state", {
        requestId: message.requestId,
        delivery: "reply",
        payload: this.buildStatePayload(playerId)
      });
    });

    this.onMessage("world.preview", (client, message: Extract<ClientMessage, { type: "world.preview" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      const snapshot = createPlayerWorldView(this.worldRoom.getInternalState(), playerId);

      sendMessage(client, "world.preview", {
        requestId: message.requestId,
        movementPlan: planPlayerViewMovement(snapshot, message.heroId, message.destination) ?? null
      });
    });

    this.onMessage("world.reachable", (client, message: Extract<ClientMessage, { type: "world.reachable" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      const snapshot = createPlayerWorldView(this.worldRoom.getInternalState(), playerId);

      sendMessage(client, "world.reachable", {
        requestId: message.requestId,
        reachableTiles: listReachableTilesInPlayerView(snapshot, message.heroId)
      });
    });

    this.onMessage("world.action", async (client, message: Extract<ClientMessage, { type: "world.action" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

      if (!this.consumePlayerActionRateLimit(playerId)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "rate_limit_exceeded" });
        recordWebSocketActionRateLimited();
        recordWebSocketActionKick();
        client.leave(CloseCode.WITH_ERROR, "rate_limit_exceeded");
        return;
      }

      recordWorldActionMessage();
      if (message.action.type === "world.surrender") {
        const resolved = await this.handleSurrenderAction(client, playerId, message);
        if (!resolved) {
          sendMessage(client, "error", { requestId: message.requestId, reason: "surrender_failed" });
        }
        return;
      }
      await this.replyToIdempotentAction(client, "world.action", message.requestId, message.action, async (reply) => {
        const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
        const previousTurnOwnerPlayerId = this.turnOwnerPlayerId;
        const result = this.worldRoom.dispatch(playerId, message.action);
        if (!result.ok) {
          this.recordSuspiciousAction(client, playerId, result.rejection);
          reply({
            type: "session.state",
            requestId: message.requestId,
            delivery: "reply",
            payload: this.buildStatePayload(playerId, {
              events: [],
              movementPlan: null,
              ...(result.reason ? { reason: result.reason } : {}),
              ...(result.rejection ? { rejection: result.rejection } : {})
            })
          });
          return;
        }

        this.afterSuccessfulWorldAction(playerId, message.action);
        try {
          await this.persistRoomState();
        } catch (error) {
          reportPersistenceSaveFailure(this.worldRoom, playerId, message.requestId, message.action.type, error);
          this.restoreWorldRoom(previousSnapshot);
          this.ensureTurnTimerState();
          this.publishLobbyRoomSummary();
          reply({
            type: "error",
            requestId: message.requestId,
            reason: "persistence_save_failed"
          });
          return;
        }
        const completedReplays = this.worldRoom.consumeCompletedBattleReplays();
        await this.persistBattleSnapshots(result.events ?? [], completedReplays);
        await this.persistPlayerAccountProgress(result.events ?? [], completedReplays);
        this.emitAnalyticsForWorldEvents(playerId, result.events ?? []);

        this.publishLobbyRoomSummary();
        reply({
          type: "session.state",
          requestId: message.requestId,
          delivery: "reply",
          payload: this.buildStatePayload(playerId, {
            events: result.events ?? [],
            movementPlan: result.movementPlan ?? null,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.rejection ? { rejection: result.rejection } : {})
          })
        });
        this.broadcastState(client, {
          events: result.events ?? [],
          movementPlan: result.movementPlan ?? null
        });
        await this.maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId);
      });
    });

    this.onMessage("battle.action", async (client, message: Extract<ClientMessage, { type: "battle.action" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

      if (!this.consumePlayerActionRateLimit(playerId)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "rate_limit_exceeded" });
        recordWebSocketActionRateLimited();
        recordWebSocketActionKick();
        client.leave(CloseCode.WITH_ERROR, "rate_limit_exceeded");
        return;
      }

      recordBattleActionMessage();
      await this.replyToIdempotentAction(client, "battle.action", message.requestId, message.action, async (reply) => {
        const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
        const previousTurnOwnerPlayerId = this.turnOwnerPlayerId;
        const result = this.worldRoom.dispatchBattle(playerId, message.action);
        if (!result.ok) {
          this.recordSuspiciousAction(client, playerId, result.rejection);
          reply({
            type: "session.state",
            requestId: message.requestId,
            delivery: "reply",
            payload: this.buildStatePayload(playerId, {
              events: [],
              movementPlan: null,
              ...(result.reason ? { reason: result.reason } : {}),
              ...(result.rejection ? { rejection: result.rejection } : {})
            })
          });
          return;
        }

        this.afterSuccessfulBattleAction(playerId);
        try {
          await this.persistRoomState();
        } catch (error) {
          reportPersistenceSaveFailure(this.worldRoom, playerId, message.requestId, message.action.type, error);
          this.restoreWorldRoom(previousSnapshot);
          this.ensureTurnTimerState();
          this.publishLobbyRoomSummary();
          reply({
            type: "error",
            requestId: message.requestId,
            reason: "persistence_save_failed"
          });
          return;
        }
        const completedReplays = this.worldRoom.consumeCompletedBattleReplays();
        await this.persistBattleSnapshots(result.events ?? [], completedReplays);
        await this.persistPlayerAccountProgress(result.events ?? [], completedReplays);
        this.emitAnalyticsForWorldEvents(playerId, result.events ?? []);

        this.publishLobbyRoomSummary();
        reply({
          type: "session.state",
          requestId: message.requestId,
          delivery: "reply",
          payload: this.buildStatePayload(playerId, {
            events: result.events ?? [],
            movementPlan: null,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.rejection ? { rejection: result.rejection } : {})
          })
        });
        this.broadcastState(client, {
          events: result.events ?? [],
          movementPlan: null
        });
        await this.maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId);
      });
    });

    this.onMessage("report.player", async (client, message: Extract<ClientMessage, { type: "report.player" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      if (!hasPlayerReportStore(configuredRoomSnapshotStore)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "reporting_unavailable" });
        return;
      }

      const targetPlayerId = this.resolveReportTargetPlayerId(playerId, message.targetPlayerId);
      if (!targetPlayerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "report_target_unavailable" });
        return;
      }

      try {
        const report = await configuredRoomSnapshotStore.createPlayerReport({
          reporterId: playerId,
          targetId: targetPlayerId,
          reason: message.reason,
          ...(message.description?.trim() ? { description: message.description.trim() } : {}),
          roomId: logicalRoomId
        });
        sendMessage(client, "report.player", {
          requestId: message.requestId,
          reportId: report.reportId,
          targetPlayerId: report.targetId,
          reason: report.reason,
          status: report.status,
          createdAt: report.createdAt
        });
        sendMessage(client, "session.state", {
          requestId: message.requestId,
          delivery: "reply",
          payload: this.buildStatePayload(playerId, {
            movementPlan: null,
            reason: "report_submitted"
          })
        });
      } catch (error) {
        const reason =
          error instanceof Error && error.message === "duplicate_player_report"
            ? "duplicate_player_report"
            : "report_submit_failed";
        sendMessage(client, "error", { requestId: message.requestId, reason });
      }
    });

    this.onMessage("tutorial.progress", async (client, message: Extract<ClientMessage, { type: "tutorial.progress" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      if (!configuredRoomSnapshotStore) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "tutorial_persistence_unavailable" });
        return;
      }

      try {
        const account =
          (await configuredRoomSnapshotStore.loadPlayerAccount(playerId)) ??
          (await configuredRoomSnapshotStore.ensurePlayerAccount({
            playerId,
            displayName: playerId,
            lastRoomId: logicalRoomId
          }));
        const action = normalizeTutorialProgressAction(
          message.action,
          account.tutorialStep ?? DEFAULT_TUTORIAL_STEP
        );
        await configuredRoomSnapshotStore.savePlayerAccountProgress(playerId, {
          tutorialStep: action.step
        });
        emitAnalyticsEvent("tutorial_step", {
          playerId,
          roomId: logicalRoomId,
          payload: toTutorialAnalyticsPayload(action)
        });
        sendMessage(client, "session.state", {
          requestId: message.requestId,
          delivery: "reply",
          payload: this.buildStatePayload(playerId, {
            events: [],
            movementPlan: null
          })
        });
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message === "tutorial_skip_locked"
              ? "tutorial_skip_locked"
              : error.message === "tutorial_progress_invalid_step"
                ? "tutorial_progress_invalid_step"
                : error.message === "tutorial_progress_out_of_order"
                  ? "tutorial_progress_out_of_order"
                  : "tutorial_progress_failed"
            : "tutorial_progress_failed";
        sendMessage(client, "error", { requestId: message.requestId, reason });
      }
    });

    this.onMessage("campaign.dialogue.ack", async (client, message: Extract<ClientMessage, { type: "campaign.dialogue.ack" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      if (!configuredRoomSnapshotStore) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "campaign_persistence_unavailable" });
        return;
      }

      try {
        const account =
          (await configuredRoomSnapshotStore.loadPlayerAccount(playerId)) ??
          (await configuredRoomSnapshotStore.ensurePlayerAccount({
            playerId,
            displayName: playerId,
            lastRoomId: logicalRoomId
          }));
        const campaignProgress = acknowledgeCampaignDialogueLine(
          resolveCampaignConfig(),
          account.campaignProgress,
          message.action
        );
        await configuredRoomSnapshotStore.savePlayerAccountProgress(playerId, {
          campaignProgress
        });
        sendMessage(client, "session.state", {
          requestId: message.requestId,
          delivery: "reply",
          payload: this.buildStatePayload(playerId, {
            events: [],
            movementPlan: null
          })
        });
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message === "campaign_mission_not_found"
              ? "campaign_mission_not_found"
              : error.message === "campaign_dialogue_line_not_found"
                ? "campaign_dialogue_line_not_found"
                : "campaign_dialogue_ack_failed"
            : "campaign_dialogue_ack_failed";
        sendMessage(client, "error", { requestId: message.requestId, reason });
      }
    });

    this.onMessage(
      "FRIEND_LEADERBOARD_REQUEST",
      async (client, message: Extract<ClientMessage, { type: "FRIEND_LEADERBOARD_REQUEST" }>) => {
        const playerId = this.getPlayerId(client);
        if (!playerId) {
          sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
          return;
        }
        if (!configuredRoomSnapshotStore) {
          sendMessage(client, "error", { requestId: message.requestId, reason: "social_persistence_unavailable" });
          return;
        }

        recordSocialFriendLeaderboardRequest();

        try {
          const authSession = this.authSessionByPlayerId.get(playerId);
          await configuredRoomSnapshotStore.ensurePlayerAccount({
            playerId,
            displayName: authSession?.displayName ?? playerId,
            lastRoomId: logicalRoomId
          });
          const friendIds = Array.from(new Set((message.friendIds ?? []).map((entry) => entry.trim()).filter(Boolean)));
          const accounts = await configuredRoomSnapshotStore.loadPlayerAccounts([playerId, ...friendIds]);
          const items = buildFriendLeaderboard(playerId, accounts);
          this.logSocialMessage("friend_leaderboard_ready", {
            playerId,
            requestId: message.requestId,
            friendCount: friendIds.length,
            itemCount: items.length
          });
          sendMessage(client, "FRIEND_LEADERBOARD_REQUEST", {
            requestId: message.requestId,
            items,
            friendCount: friendIds.length
          });
        } catch (error) {
          this.reportSocialHandlerFailure("friend_leaderboard_failed", playerId, message.requestId, error, {
            action: "FRIEND_LEADERBOARD_REQUEST"
          });
          sendMessage(client, "error", { requestId: message.requestId, reason: "friend_leaderboard_failed" });
        }
      }
    );

    this.onMessage("SHARE_ACTIVITY", async (client, message: Extract<ClientMessage, { type: "SHARE_ACTIVITY" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      if (!configuredRoomSnapshotStore) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "social_persistence_unavailable" });
        return;
      }

      recordSocialShareActivityRequest();

      try {
        const authSession = this.authSessionByPlayerId.get(playerId);
        const account =
          (await configuredRoomSnapshotStore.loadPlayerAccount(playerId)) ??
          (await configuredRoomSnapshotStore.ensurePlayerAccount({
            playerId,
            displayName: authSession?.displayName ?? playerId,
            lastRoomId: logicalRoomId
          }));
        const roomId = message.roomId?.trim() || logicalRoomId;
        const reply = this.buildShareActivityReply({
          playerId,
          roomId,
          accountDisplayName: account.displayName,
          message
        });
        this.logSocialMessage("share_activity_ready", {
          playerId,
          requestId: message.requestId,
          activity: message.activity,
          roomId,
          hasChallengeToken: Boolean(reply.challengeToken)
        });
        sendMessage(client, "SHARE_ACTIVITY", {
          requestId: message.requestId,
          ...reply
        });
      } catch (error) {
        this.reportSocialHandlerFailure("share_activity_failed", playerId, message.requestId, error, {
          action: "SHARE_ACTIVITY",
          activity: message.activity
        });
        sendMessage(client, "error", { requestId: message.requestId, reason: "share_activity_failed" });
      }
    });

    this.onMessage("USE_EMOTE", async (client, message: Extract<ClientMessage, { type: "USE_EMOTE" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      if (!configuredRoomSnapshotStore?.loadPlayerAccount) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "cosmetics_unavailable" });
        return;
      }

      const account = await configuredRoomSnapshotStore.loadPlayerAccount(playerId);
      if (!account) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "player_account_not_found" });
        return;
      }

      const emoteId = message.emoteId.trim();
      const definition = resolveCosmeticCatalog().find((entry) => entry.id === emoteId && entry.category === "battle_emote");
      if (!definition) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "cosmetic_not_found" });
        return;
      }
      if (!(account.cosmeticInventory?.ownedIds ?? []).includes(emoteId)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "cosmetic_not_owned" });
        return;
      }

      sendMessage(client, "COSMETIC_APPLIED", {
        requestId: message.requestId,
        delivery: "reply",
        playerId,
        cosmeticId: emoteId,
        action: "emote",
        ...(account.equippedCosmetics ? { equippedCosmetics: account.equippedCosmetics } : {})
      });
      this.broadcastCosmeticApplied(client, {
        playerId,
        cosmeticId: emoteId,
        action: "emote",
        ...(account.equippedCosmetics ? { equippedCosmetics: account.equippedCosmetics } : {})
      });
    });

    this.onMessage("BUY_COSMETIC", async (client, message: Extract<ClientMessage, { type: "BUY_COSMETIC" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      if (!configuredRoomSnapshotStore?.purchaseShopProduct) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "cosmetics_unavailable" });
        return;
      }

      const cosmeticId = message.cosmeticId.trim();
      const definition = resolveCosmeticCatalog().find((entry) => entry.id === cosmeticId);
      if (!definition) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "cosmetic_not_found" });
        return;
      }

      try {
        await configuredRoomSnapshotStore.purchaseShopProduct(playerId, {
          purchaseId: `ws:${this.metadata.logicalRoomId}:${message.requestId}`,
          productId: `cosmetic:${cosmeticId}`,
          productName: definition.name,
          quantity: 1,
          unitPrice: definition.price,
          grant: {
            cosmeticIds: [cosmeticId]
          }
        });

        sendMessage(client, "COSMETIC_APPLIED", {
          requestId: message.requestId,
          delivery: "reply",
          playerId,
          cosmeticId,
          action: "purchased"
        });
        this.broadcastCosmeticApplied(client, {
          playerId,
          cosmeticId,
          action: "purchased"
        });
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message === "insufficient gems"
              ? "insufficient_gems"
              : "cosmetics_unavailable"
            : "cosmetics_unavailable";
        sendMessage(client, "error", { requestId: message.requestId, reason });
      }
    });

    this.onMessage("EQUIP_COSMETIC", async (client, message: Extract<ClientMessage, { type: "EQUIP_COSMETIC" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      if (!configuredRoomSnapshotStore?.loadPlayerAccount || !configuredRoomSnapshotStore.savePlayerAccountProgress) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "cosmetics_unavailable" });
        return;
      }

      try {
        const account = await configuredRoomSnapshotStore.loadPlayerAccount(playerId);
        if (!account) {
          sendMessage(client, "error", { requestId: message.requestId, reason: "player_account_not_found" });
          return;
        }

        const cosmeticId = message.cosmeticId.trim();
        const equippedCosmetics = equipOwnedCosmetic(account, cosmeticId);
        const nextAccount = await configuredRoomSnapshotStore.savePlayerAccountProgress(playerId, {
          cosmeticInventory: normalizeCosmeticInventory(account.cosmeticInventory),
          equippedCosmetics
        });

        sendMessage(client, "COSMETIC_APPLIED", {
          requestId: message.requestId,
          delivery: "reply",
          playerId,
          cosmeticId,
          action: "equipped",
          ...(nextAccount.equippedCosmetics ? { equippedCosmetics: nextAccount.equippedCosmetics } : {})
        });
        this.broadcastCosmeticApplied(client, {
          playerId,
          cosmeticId,
          action: "equipped",
          ...(nextAccount.equippedCosmetics ? { equippedCosmetics: nextAccount.equippedCosmetics } : {})
        });
      } catch (error) {
        const reason =
          error instanceof Error && (error.message === "cosmetic_not_found" || error.message === "cosmetic_not_owned")
            ? error.message
            : "cosmetics_unavailable";
        sendMessage(client, "error", { requestId: message.requestId, reason });
      }
    });
  }

  onJoin(client: ColyseusClient, options?: JoinOptions, auth?: RemoteJoinIdentity): void {
    const playerId = auth?.playerId ?? options?.playerId ?? client.sessionId;
    this.playerIdBySessionId.set(client.sessionId, playerId);
    this.updatePlayerAuthSession(playerId, auth?.authSession ?? null);
    this.refreshEmptyRoomTracking();
    this.publishLobbyRoomSummary();
  }

  disconnectPlayer(playerId: string, reason = "account_banned"): number {
    let disconnected = 0;
    this.clearPlayerAuthSession(playerId);
    for (const client of this.clients) {
      if (this.playerIdBySessionId.get(client.sessionId) !== playerId) {
        continue;
      }

      this.analyticsSessionDisconnectReasonBySessionId.set(client.sessionId, reason);
      sendMessage(client, "error", { requestId: "push", reason });
      client.leave(CloseCode.WITH_ERROR, reason);
      disconnected += 1;
    }
    return disconnected;
  }

  async onDrop(client: ColyseusClient): Promise<void> {
    const playerId = this.playerIdBySessionId.get(client.sessionId);
    if (!playerId) {
      return;
    }

    this.playerIdBySessionId.delete(client.sessionId);
    this.disconnectedAtByPlayerId.set(playerId, new Date(roomRuntimeDependencies.now()).toISOString());
    this.refreshEmptyRoomTracking();
    this.ensureTurnTimerState();
    this.publishLobbyRoomSummary();
    let reconnectWindowOpen = false;

    try {
      recordReconnectWindowOpened();
      reconnectWindowOpen = true;
      const reconnectedClient = await this.allowReconnection(client, RECONNECTION_WINDOW_SECONDS);
      const authValidation = await this.validateReconnectSession(playerId);
      if (authValidation.errorCode) {
        if (reconnectWindowOpen) {
          recordReconnectWindowResolved("failure", {
            roomId: this.metadata.logicalRoomId,
            playerId,
            reason: "auth_invalid"
          });
          reconnectWindowOpen = false;
        }
        this.rejectExpiredSession(reconnectedClient, "push", authValidation.errorCode ?? "unauthorized");
        this.clearPlayerAuthSession(playerId);
        this.publishLobbyRoomSummary();
        return;
      }
      if (configuredRoomSnapshotStore?.loadPlayerBan) {
        const ban = await configuredRoomSnapshotStore.loadPlayerBan(playerId);
        if (isPlayerBanActive(ban)) {
          if (reconnectWindowOpen) {
            recordReconnectWindowResolved("failure", {
              roomId: this.metadata.logicalRoomId,
              playerId,
              reason: "auth_invalid"
            });
            reconnectWindowOpen = false;
          }
          reconnectedClient.leave(CloseCode.WITH_ERROR, "account_banned");
          this.publishLobbyRoomSummary();
          return;
        }
      }
      if (await this.enforceMinorProtectionForClient(reconnectedClient, playerId, null, "push")) {
        if (reconnectWindowOpen) {
          recordReconnectWindowResolved("failure", {
            roomId: this.metadata.logicalRoomId,
            playerId,
            reason: "auth_invalid"
          });
          reconnectWindowOpen = false;
        }
        this.publishLobbyRoomSummary();
        return;
      }
      if (authValidation.session) {
        this.updatePlayerAuthSession(playerId, authValidation.session);
      }
      this.playerIdBySessionId.set(reconnectedClient.sessionId, playerId);
      const previousSessionStartedAtMs = this.analyticsSessionStartedAtBySessionId.get(client.sessionId);
      if (previousSessionStartedAtMs != null) {
        this.analyticsSessionStartedAtBySessionId.set(reconnectedClient.sessionId, previousSessionStartedAtMs);
      }
      this.analyticsSessionStartedAtBySessionId.delete(client.sessionId);
      this.analyticsSessionDisconnectReasonBySessionId.delete(client.sessionId);
      this.disconnectedAtByPlayerId.delete(playerId);
      this.reconnectedAtByPlayerId.set(playerId, new Date().toISOString());
      this.ensureTurnTimerState();
      this.publishLobbyRoomSummary();
      sendMessage(reconnectedClient, "session.state", {
        requestId: "push",
        delivery: "push",
        payload: this.buildStatePayload(playerId)
      });
      if (reconnectWindowOpen) {
        recordReconnectWindowResolved("success", {
          roomId: this.metadata.logicalRoomId,
          playerId
        });
        reconnectWindowOpen = false;
      }
    } catch (error) {
      this.emitSessionEndForConnection(
        client.sessionId,
        playerId,
        classifyReconnectFailure({
          error,
          fallbackReason: "reconnect_window_expired"
        })
      );
      if (reconnectWindowOpen) {
        recordReconnectWindowResolved("failure", {
          roomId: this.metadata.logicalRoomId,
          playerId,
          reason: classifyReconnectFailure({
            error,
            fallbackReason: "reconnect_window_expired"
          })
        });
      }
      this.playerIdBySessionId.delete(client.sessionId);
      this.clearPlayerAuthSession(playerId);
      this.refreshEmptyRoomTracking();
      this.ensureTurnTimerState();
      this.publishLobbyRoomSummary();
    }
  }

  onLeave(client: ColyseusClient): void {
    const playerId = this.playerIdBySessionId.get(client.sessionId);
    this.playerIdBySessionId.delete(client.sessionId);
    this.suspiciousActionTrackerBySessionId.delete(client.sessionId);
    this.completedActionRepliesBySessionId.delete(client.sessionId);
    this.pendingActionRepliesBySessionId.delete(client.sessionId);
    if (playerId) {
      this.emitSessionEndForConnection(
        client.sessionId,
        playerId,
        this.analyticsSessionDisconnectReasonBySessionId.get(client.sessionId) ?? "transport_closed"
      );
    }
    if (playerId && !this.getConnectedPlayerIds().includes(playerId) && !this.disconnectedAtByPlayerId.has(playerId)) {
      this.clearPlayerAuthSession(playerId);
    }
    if (playerId && !this.getConnectedPlayerIds().includes(playerId)) {
      this.disconnectedAtByPlayerId.set(playerId, new Date(roomRuntimeDependencies.now()).toISOString());
    }
    this.refreshEmptyRoomTracking();
    this.ensureTurnTimerState();
    this.publishLobbyRoomSummary();
  }

  onDispose(): void {
    for (const [sessionId, playerId] of this.playerIdBySessionId.entries()) {
      this.emitSessionEndForConnection(sessionId, playerId, "room_disposed");
    }
    this.authSessionByPlayerId.clear();
    this.unsubscribeConfigUpdate?.();
    this.unsubscribeConfigUpdate = null;
    this.wsActionTimestampsByPlayerId.clear();
    this.suspiciousActionTrackerBySessionId.clear();
    if (this.turnTimerHandle) {
      roomRuntimeDependencies.clearInterval(this.turnTimerHandle);
      this.turnTimerHandle = null;
    }

    this.retireRoom("dispose");
  }

  private emitSessionEndForConnection(sessionId: string, playerId: string, disconnectReason: string): void {
    const startedAtMs = this.analyticsSessionStartedAtBySessionId.get(sessionId);
    this.analyticsSessionStartedAtBySessionId.delete(sessionId);
    this.analyticsSessionDisconnectReasonBySessionId.delete(sessionId);
    if (startedAtMs == null) {
      return;
    }

    emitAnalyticsEvent("session_end", {
      playerId,
      roomId: this.metadata.logicalRoomId,
      sessionId,
      payload: {
        roomId: this.metadata.logicalRoomId,
        disconnectReason,
        sessionDurationMs: Math.max(0, roomRuntimeDependencies.now() - startedAtMs)
      }
    });
  }

  private restoreWorldRoom(snapshot: RoomPersistenceSnapshot): void {
    this.worldRoom = createRoom(this.metadata.logicalRoomId, snapshot.state.meta.seed, snapshot);
  }

  private consumePlayerActionRateLimit(playerId: string): boolean {
    const now = Date.now();
    const windowStart = now - this.wsActionRateLimitConfig.windowMs;
    const timestamps = (this.wsActionTimestampsByPlayerId.get(playerId) ?? []).filter((timestamp) => timestamp > windowStart);
    if (timestamps.length >= this.wsActionRateLimitConfig.max) {
      this.wsActionTimestampsByPlayerId.set(playerId, timestamps);
      return false;
    }

    timestamps.push(now);
    this.wsActionTimestampsByPlayerId.set(playerId, timestamps);
    return true;
  }

  private recordSuspiciousAction(
    client: ColyseusClient,
    playerId: string,
    rejection?: ActionValidationFailure
  ): void {
    if (!rejection) {
      return;
    }

    const now = roomRuntimeDependencies.now();
    const windowStart = now - this.suspiciousActionAlertConfig.windowMs;
    const tracker = this.suspiciousActionTrackerBySessionId.get(client.sessionId) ?? {
      timestamps: [],
      lastAlertAt: null
    };
    const timestamps = tracker.timestamps.filter((timestamp) => timestamp > windowStart);
    timestamps.push(now);
    tracker.timestamps = timestamps;

    if (
      timestamps.length >= this.suspiciousActionAlertConfig.threshold &&
      (tracker.lastAlertAt == null || now - tracker.lastAlertAt >= this.suspiciousActionAlertConfig.windowMs)
    ) {
      tracker.lastAlertAt = now;
      recordAntiCheatAlert({
        roomId: this.metadata.logicalRoomId,
        playerId,
        sessionId: client.sessionId,
        scope: rejection.scope,
        actionType: rejection.actionType,
        reason: rejection.reason,
        rejectionCount: timestamps.length,
        windowMs: this.suspiciousActionAlertConfig.windowMs,
        recordedAt: new Date(now).toISOString()
      });
    }

    this.suspiciousActionTrackerBySessionId.set(client.sessionId, tracker);
  }

  private sendCachedReply(client: ColyseusClient, reply: IdempotentActionReply): void {
    if (reply.type === "session.state") {
      sendMessage(client, "session.state", {
        requestId: reply.requestId,
        delivery: reply.delivery,
        payload: structuredClone(reply.payload)
      });
      return;
    }

    sendMessage(client, "error", {
      requestId: reply.requestId,
      reason: reply.reason
    });
  }

  private getCompletedActionReplies(sessionId: string): Map<string, IdempotentActionReplayEntry> {
    const existing = this.completedActionRepliesBySessionId.get(sessionId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, IdempotentActionReplayEntry>();
    this.completedActionRepliesBySessionId.set(sessionId, created);
    return created;
  }

  private getPendingActionReplies(sessionId: string): Map<string, PendingIdempotentActionReplayEntry> {
    const existing = this.pendingActionRepliesBySessionId.get(sessionId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, PendingIdempotentActionReplayEntry>();
    this.pendingActionRepliesBySessionId.set(sessionId, created);
    return created;
  }

  private cacheCompletedActionReply(sessionId: string, key: string, fingerprint: string, reply: IdempotentActionReply): void {
    const completed = this.getCompletedActionReplies(sessionId);
    completed.delete(key);
    completed.set(key, {
      fingerprint,
      reply: structuredClone(reply)
    });
    while (completed.size > 32) {
      const oldestKey = completed.keys().next().value;
      if (!oldestKey) {
        break;
      }
      completed.delete(oldestKey);
    }
  }

  private async replyToIdempotentAction(
    client: ColyseusClient,
    messageType: "world.action" | "battle.action",
    requestId: string,
    action: WorldAction | BattleAction,
    execute: (reply: (message: IdempotentActionReply) => void) => Promise<void>
  ): Promise<void> {
    const key = `${messageType}:${requestId}`;
    const fingerprint = JSON.stringify(action);
    const completed = this.getCompletedActionReplies(client.sessionId);
    const completedEntry = completed.get(key);
    if (completedEntry) {
      if (completedEntry.fingerprint === fingerprint) {
        this.sendCachedReply(client, completedEntry.reply);
        return;
      }

      sendMessage(client, "error", {
        requestId,
        reason: "request_id_reused_with_different_payload"
      });
      return;
    }

    const pending = this.getPendingActionReplies(client.sessionId);
    const pendingEntry = pending.get(key);
    if (pendingEntry) {
      if (pendingEntry.fingerprint !== fingerprint) {
        sendMessage(client, "error", {
          requestId,
          reason: "request_id_reused_with_different_payload"
        });
        return;
      }

      this.sendCachedReply(client, await pendingEntry.promise);
      return;
    }

    let resolvePending!: (reply: IdempotentActionReply) => void;
    let rejectPending!: (reason?: unknown) => void;
    const pendingReply = new Promise<IdempotentActionReply>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    pending.set(key, { fingerprint, promise: pendingReply });

    let replySent = false;
    const reply = (message: IdempotentActionReply) => {
      if (replySent) {
        throw new Error(`duplicate_idempotent_reply:${key}`);
      }

      replySent = true;
      const cachedReply = structuredClone(message);
      this.cacheCompletedActionReply(client.sessionId, key, fingerprint, cachedReply);
      resolvePending(cachedReply);
      this.sendCachedReply(client, cachedReply);
    };

    try {
      await execute(reply);
      if (!replySent) {
        throw new Error(`missing_idempotent_reply:${key}`);
      }
    } catch (error) {
      if (!replySent) {
        rejectPending(error);
      }
      throw error;
    } finally {
      pending.delete(key);
      if (pending.size === 0) {
        this.pendingActionRepliesBySessionId.delete(client.sessionId);
      }
    }
  }

  private getConnectedPlayerIds(): string[] {
    return Array.from(new Set(this.playerIdBySessionId.values()));
  }

  private getTurnTimerSettings(): { turnTimerMs: number; afkStrikesBeforeForfeit: number } {
    const config = getBattleBalanceConfig();
    return {
      turnTimerMs: config.turnTimerSeconds * 1_000,
      afkStrikesBeforeForfeit: config.afkStrikesBeforeForfeit
    };
  }

  private shouldRunTurnTimer(): boolean {
    return roomRuntimeDependencies.isMySqlSnapshotStore(configuredRoomSnapshotStore);
  }

  private ensureTurnTimerLoop(): void {
    if (!this.shouldRunTurnTimer() || this.turnTimerHandle) {
      return;
    }

    this.turnTimerHandle = roomRuntimeDependencies.setInterval(() => {
      void this.tickTurnTimer().catch((error) => {
        const context = this.resolveTurnContext();
        reportBackgroundTaskFailure({
          taskType: "turn_timer",
          errorCode: "turn_timer_tick_failed",
          message: "Background turn timer tick failed.",
          logMessage: "[VeilRoom] Turn timer tick failed",
          error,
          roomId: this.metadata.logicalRoomId,
          playerId: context?.playerId ?? this.turnOwnerPlayerId ?? null,
          roomDay: this.worldRoom.getInternalState().meta.day,
          detail: formatBackgroundTaskDetail("turn_timer", error, {
            mode: context?.mode ?? null,
            turnOwnerPlayerId: context?.playerId ?? this.turnOwnerPlayerId ?? null
          })
        });
      });
    }, TURN_TIMER_TICK_MS);
    this.turnTimerHandle.unref?.();
  }

  private listMatchPlayerIds(): string[] {
    return Array.from(new Set(this.worldRoom.getInternalState().heroes.map((hero) => hero.playerId))).sort();
  }

  private findNextMatchPlayerId(playerId: string): string | null {
    const playerIds = this.listMatchPlayerIds();
    if (playerIds.length === 0) {
      return null;
    }

    const currentIndex = playerIds.indexOf(playerId);
    if (currentIndex < 0) {
      return playerIds[0] ?? null;
    }

    return playerIds[(currentIndex + 1) % playerIds.length] ?? null;
  }

  private resolvePvPBattleTurnOwnerPlayerId(): string | null {
    const battle = this.worldRoom.getActiveBattles().find((candidate) => candidate.defenderHeroId);
    if (!battle?.activeUnitId) {
      return null;
    }

    const activeUnit = battle.units[battle.activeUnitId];
    if (!activeUnit) {
      return null;
    }

    const internalState = this.worldRoom.getInternalState();
    if (activeUnit.camp === "attacker") {
      return battle.worldHeroId
        ? internalState.heroes.find((hero) => hero.id === battle.worldHeroId)?.playerId ?? null
        : null;
    }

    return battle.defenderHeroId
      ? internalState.heroes.find((hero) => hero.id === battle.defenderHeroId)?.playerId ?? null
      : null;
  }

  private resolveTurnContext(): { mode: "world" | "battle"; playerId: string } | null {
    const battleOwnerPlayerId = this.resolvePvPBattleTurnOwnerPlayerId();
    if (battleOwnerPlayerId) {
      this.turnOwnerPlayerId = battleOwnerPlayerId;
      return {
        mode: "battle",
        playerId: battleOwnerPlayerId
      };
    }

    const playerIds = this.listMatchPlayerIds();
    if (playerIds.length !== 2) {
      return null;
    }

    const ownerPlayerId =
      this.turnOwnerPlayerId && playerIds.includes(this.turnOwnerPlayerId) ? this.turnOwnerPlayerId : playerIds[0] ?? null;
    if (!ownerPlayerId) {
      return null;
    }

    this.turnOwnerPlayerId = ownerPlayerId;
    return {
      mode: "world",
      playerId: ownerPlayerId
    };
  }

  private setTurnDeadlineFor(playerId: string | null): void {
    const state = this.worldRoom.getInternalState();
    if (!playerId) {
      this.turnOwnerPlayerId = null;
      delete state.turnDeadlineAt;
      return;
    }

    this.turnOwnerPlayerId = playerId;
    state.turnDeadlineAt = new Date(roomRuntimeDependencies.now() + this.getTurnTimerSettings().turnTimerMs).toISOString();
  }

  private getAfkStrikeCount(playerId: string): number {
    const current = this.worldRoom.getInternalState().afkStrikes?.[playerId];
    return typeof current === "number" && Number.isFinite(current) ? current : 0;
  }

  private setAfkStrikeCount(playerId: string, nextValue: number): void {
    const state = this.worldRoom.getInternalState();
    const next = { ...(state.afkStrikes ?? {}) };
    if (nextValue > 0) {
      next[playerId] = nextValue;
    } else {
      delete next[playerId];
    }

    if (Object.keys(next).length > 0) {
      state.afkStrikes = next;
    } else {
      delete state.afkStrikes;
    }
  }

  private ensureTurnTimerState(): void {
    if (!this.shouldRunTurnTimer()) {
      this.setTurnDeadlineFor(null);
      return;
    }

    const context = this.resolveTurnContext();
    if (!context) {
      this.setTurnDeadlineFor(null);
      return;
    }

    const deadlineAt = this.worldRoom.getInternalState().turnDeadlineAt;
    if (!deadlineAt || Number.isNaN(Date.parse(deadlineAt))) {
      this.setTurnDeadlineFor(context.playerId);
    } else {
      this.turnOwnerPlayerId = context.playerId;
    }

    this.pushTurnTimerUpdate();
  }

  private pushTurnTimerUpdate(): void {
    const context = this.resolveTurnContext();
    const deadlineAt = this.worldRoom.getInternalState().turnDeadlineAt;
    if (!context || !deadlineAt) {
      return;
    }

    const remainingMs = Math.max(0, Date.parse(deadlineAt) - roomRuntimeDependencies.now());
    for (const client of this.clients) {
      sendMessage(client, "turn.timer", {
        requestId: "push",
        delivery: "push",
        remainingMs,
        turnOwnerPlayerId: context.playerId
      });
    }
  }

  private afterSuccessfulWorldAction(playerId: string, action: WorldAction): void {
    if (!this.shouldRunTurnTimer()) {
      return;
    }

    this.setAfkStrikeCount(playerId, 0);
    const nextOwnerPlayerId = action.type === "turn.endDay" ? this.findNextMatchPlayerId(playerId) ?? playerId : playerId;
    this.setTurnDeadlineFor(nextOwnerPlayerId);
  }

  private afterSuccessfulBattleAction(playerId: string): void {
    if (!this.shouldRunTurnTimer()) {
      return;
    }

    this.setAfkStrikeCount(playerId, 0);
    this.setTurnDeadlineFor(this.resolvePvPBattleTurnOwnerPlayerId() ?? playerId);
  }

  private async tickTurnTimer(): Promise<void> {
    if (!this.shouldRunTurnTimer() || this.turnTimerTickInFlight) {
      return;
    }

    const deadlineAt = this.worldRoom.getInternalState().turnDeadlineAt;
    if (!deadlineAt) {
      this.ensureTurnTimerState();
      return;
    }

    const context = this.resolveTurnContext();
    if (!context) {
      this.setTurnDeadlineFor(null);
      return;
    }

    const remainingMs = Date.parse(deadlineAt) - roomRuntimeDependencies.now();
    if (remainingMs > 0) {
      this.pushTurnTimerUpdate();
      return;
    }

    this.turnTimerTickInFlight = true;
    try {
      await this.handleTurnTimeout(context);
    } finally {
      this.turnTimerTickInFlight = false;
    }
  }

  private async handleTurnTimeout(context: { mode: "world" | "battle"; playerId: string }): Promise<void> {
    const nextStrikeCount = this.getAfkStrikeCount(context.playerId) + 1;
    this.setAfkStrikeCount(context.playerId, nextStrikeCount);

    if (nextStrikeCount >= this.getTurnTimerSettings().afkStrikesBeforeForfeit) {
      await this.applyAfkForfeit(context.playerId);
      return;
    }

    if (context.mode === "battle") {
      await this.applyAutoBattlePass(context.playerId);
      return;
    }

    await this.applyAutoEndDay(context.playerId);
  }

  private async applyAutoEndDay(playerId: string): Promise<void> {
    const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
    const previousTurnOwnerPlayerId = this.turnOwnerPlayerId;
    const result = this.worldRoom.dispatch(playerId, { type: "turn.endDay" });
    if (!result.ok) {
      this.ensureTurnTimerState();
      return;
    }

    this.setTurnDeadlineFor(this.findNextMatchPlayerId(playerId) ?? playerId);
    try {
      await this.persistRoomState();
    } catch {
      this.restoreWorldRoom(previousSnapshot);
      this.ensureTurnTimerState();
      this.publishLobbyRoomSummary();
      return;
    }

    const completedReplays = this.worldRoom.consumeCompletedBattleReplays();
    await this.persistBattleSnapshots(result.events ?? [], completedReplays);
    await this.persistPlayerAccountProgress(result.events ?? [], completedReplays);
    this.publishLobbyRoomSummary();
    this.pushSessionStateToAll({
      events: result.events ?? [],
      movementPlan: result.movementPlan ?? null
    });
    this.pushTurnTimerUpdate();
    await this.maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId);
  }

  private async applyAutoBattlePass(playerId: string): Promise<void> {
    const battle = this.worldRoom.getBattleForPlayer(playerId);
    const activeUnitId = battle?.activeUnitId ?? null;
    if (!battle || !activeUnitId) {
      this.ensureTurnTimerState();
      return;
    }

    const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
    const previousTurnOwnerPlayerId = this.turnOwnerPlayerId;
    const result = this.worldRoom.dispatchBattle(playerId, {
      type: "battle.pass",
      unitId: activeUnitId
    });
    if (!result.ok) {
      this.ensureTurnTimerState();
      return;
    }

    this.setTurnDeadlineFor(this.resolvePvPBattleTurnOwnerPlayerId() ?? playerId);
    try {
      await this.persistRoomState();
    } catch {
      this.restoreWorldRoom(previousSnapshot);
      this.ensureTurnTimerState();
      this.publishLobbyRoomSummary();
      return;
    }

    const completedReplays = this.worldRoom.consumeCompletedBattleReplays();
    await this.persistBattleSnapshots(result.events ?? [], completedReplays);
    await this.persistPlayerAccountProgress(result.events ?? [], completedReplays);
    this.publishLobbyRoomSummary();
    this.pushSessionStateToAll({
      events: result.events ?? [],
      movementPlan: null
    });
    this.pushTurnTimerUpdate();
    await this.maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId);
  }

  private async applyAfkForfeit(loserPlayerId: string): Promise<void> {
    const winnerPlayerId = this.listMatchPlayerIds().find((candidatePlayerId) => candidatePlayerId !== loserPlayerId);
    if (!winnerPlayerId) {
      this.ensureTurnTimerState();
      return;
    }

    if (!(await this.applySurrenderEloResult(winnerPlayerId, loserPlayerId))) {
      this.ensureTurnTimerState();
      return;
    }

    await this.broadcastSettlementAndCloseRoom(null, "afk_forfeit", "push");
  }

  private async syncMinorProtectionAccount(
    playerId: string,
    account: PlayerAccountSnapshot
  ): Promise<PlayerAccountSnapshot> {
    const store = configuredRoomSnapshotStore;
    if (!store) {
      return account;
    }

    const state = deriveMinorProtectionState(account, new Date(), this.minorProtectionConfig);
    if (
      account.lastPlayDate === state.localDate &&
      (account.dailyPlayMinutes ?? 0) === state.normalizedDailyPlayMinutes
    ) {
      return account;
    }

    return store.savePlayerAccountProgress(playerId, {
      dailyPlayMinutes: state.normalizedDailyPlayMinutes,
      lastPlayDate: state.localDate,
      lastRoomId: this.metadata.logicalRoomId
    });
  }

  private async enforceMinorProtectionForClient(
    client: ColyseusClient,
    playerId: string,
    ensuredAccount: PlayerAccountSnapshot | null,
    requestId: string
  ): Promise<boolean> {
    const store = configuredRoomSnapshotStore;
    let account = ensuredAccount;
    if (!account && store) {
      try {
        account = await store.ensurePlayerAccount({
          playerId,
          lastRoomId: this.metadata.logicalRoomId
        });
      } catch {
        account = null;
      }
    }

    if (!account || account.isMinor !== true) {
      return false;
    }

    const syncedAccount = await this.syncMinorProtectionAccount(playerId, account);
    const details = buildMinorProtectionBlockDetails(syncedAccount, new Date(), this.minorProtectionConfig);
    if (details.restrictedHours) {
      sendMessage(client, "error", {
        requestId,
        reason: "minor_restricted_hours",
        minorProtection: details
      });
      client.leave(CloseCode.WITH_ERROR, "minor_restricted_hours");
      return true;
    }

    if (details.dailyLimitReached) {
      sendMessage(client, "error", {
        requestId,
        reason: "minor_daily_limit_reached",
        minorProtection: details
      });
      client.leave(CloseCode.WITH_ERROR, "minor_daily_limit_reached");
      return true;
    }

    return false;
  }

  private async tickMinorPlaytime(): Promise<void> {
    const store = configuredRoomSnapshotStore;
    if (!store) {
      return;
    }

    const playerIds = this.getConnectedPlayerIds();
    if (playerIds.length === 0) {
      return;
    }

    try {
      const loadedAccounts = await store.loadPlayerAccounts(playerIds);
      const accountsByPlayerId = new Map(loadedAccounts.map((account) => [account.playerId, account] as const));

      await Promise.all(
        playerIds.map(async (playerId) => {
          const account =
            accountsByPlayerId.get(playerId) ??
            (await store.ensurePlayerAccount({
              playerId,
              lastRoomId: this.metadata.logicalRoomId
            }));
          if (account.isMinor !== true) {
            return;
          }

          const state = deriveMinorProtectionState(account, new Date(), this.minorProtectionConfig);
          if (state.restrictedHours) {
            await store.savePlayerAccountProgress(playerId, {
              dailyPlayMinutes: state.normalizedDailyPlayMinutes,
              lastPlayDate: state.localDate,
              lastRoomId: this.metadata.logicalRoomId
            });
            this.disconnectPlayer(playerId, "minor_restricted_hours");
            return;
          }
          const nextMinutes = state.normalizedDailyPlayMinutes + 1;
          await store.savePlayerAccountProgress(playerId, {
            dailyPlayMinutes: nextMinutes,
            lastPlayDate: state.localDate,
            lastRoomId: this.metadata.logicalRoomId
          });
          if (nextMinutes >= state.dailyLimitMinutes) {
            this.disconnectPlayer(playerId, "minor_daily_limit_reached");
          }
        })
      );
    } catch (error) {
      reportBackgroundTaskFailure({
        taskType: "minor_playtime",
        errorCode: "minor_playtime_tick_failed",
        message: "Background minor-playtime tick failed.",
        logMessage: "[VeilRoom] Failed to update minor playtime",
        error,
        roomId: this.metadata.logicalRoomId,
        roomDay: this.worldRoom.getInternalState().meta.day,
        detail: formatBackgroundTaskDetail("minor_playtime", error, {
          connectedPlayers: playerIds.length,
          playerIds: playerIds.join(",") || null
        })
      });
    }
  }

  private async persistRoomState(): Promise<void> {
    if (!configuredRoomSnapshotStore) {
      return;
    }

    await configuredRoomSnapshotStore.save(this.metadata.logicalRoomId, this.worldRoom.serializePersistenceSnapshot());
  }

  private async persistBattleSnapshots(
    events: WorldEvent[],
    completedReplays: CompletedBattleReplayCapture[]
  ): Promise<void> {
    const store = configuredRoomSnapshotStore;
    if (!hasBattleSnapshotStore(store) || (events.length === 0 && completedReplays.length === 0)) {
      return;
    }

    const replayByBattleId = new Map(completedReplays.map((replay) => [replay.battleId, replay] as const));
    const activeBattlesById = new Map(this.worldRoom.getActiveBattles().map((battle) => [battle.id, battle] as const));
    const internalState = this.worldRoom.getInternalState();

    try {
      for (const event of events) {
        if (event.type === "battle.started") {
          const battle = activeBattlesById.get(event.battleId);
          if (!battle) {
            continue;
          }

          const neutralArmyReward =
            event.encounterKind === "neutral" && event.neutralArmyId
              ? internalState.neutralArmies[event.neutralArmyId]?.reward
              : null;
          await store.saveBattleSnapshotStart({
            roomId: this.metadata.logicalRoomId,
            battleId: event.battleId,
            heroId: event.heroId,
            attackerPlayerId: event.attackerPlayerId,
            ...(event.defenderPlayerId ? { defenderPlayerId: event.defenderPlayerId } : {}),
            ...(event.defenderHeroId ? { defenderHeroId: event.defenderHeroId } : {}),
            ...(event.neutralArmyId ? { neutralArmyId: event.neutralArmyId } : {}),
            encounterKind: event.encounterKind,
            ...(event.initiator ? { initiator: event.initiator } : {}),
            path: event.path,
            moveCost: event.moveCost,
            playerIds: [event.attackerPlayerId, ...(event.defenderPlayerId ? [event.defenderPlayerId] : [])],
            initialState: battle,
            ...(neutralArmyReward
              ? {
                  estimatedCompensationGrant: {
                    resources: {
                      gold: neutralArmyReward.kind === "gold" ? neutralArmyReward.amount : 0,
                      wood: neutralArmyReward.kind === "wood" ? neutralArmyReward.amount : 0,
                      ore: neutralArmyReward.kind === "ore" ? neutralArmyReward.amount : 0
                    }
                  }
                }
              : {}),
            startedAt: new Date(roomRuntimeDependencies.now()).toISOString()
          });
          continue;
        }

        if (event.type !== "battle.resolved") {
          continue;
        }

        const replay = replayByBattleId.get(event.battleId);
        await store.saveBattleSnapshotResolution({
          roomId: this.metadata.logicalRoomId,
          battleId: event.battleId,
          result: event.result,
          resolutionReason: "battle_resolved",
          resolvedAt: replay?.completedAt ?? new Date(roomRuntimeDependencies.now()).toISOString()
        });
      }
    } catch (error) {
      console.error("[VeilRoom] Failed to persist battle snapshot state", {
        roomId: this.metadata.logicalRoomId,
        error
      });
    }
  }

  private async persistPlayerAccountProgress(
    events: WorldEvent[],
    completedReplays: CompletedBattleReplayCapture[]
  ): Promise<void> {
    const store = configuredRoomSnapshotStore;
    if (!store || (events.length === 0 && completedReplays.length === 0)) {
      return;
    }

    const internalState = this.worldRoom.getInternalState();
    const playerIds = Array.from(new Set(internalState.heroes.map((hero) => hero.playerId)));
    const accounts = await store.loadPlayerAccounts(playerIds);
    const battlePassConfig = resolveBattlePassConfig();

    // Compute ELO updates for PVP (hero vs hero) battles with anti-abuse caps.
    const accountStateByPlayerId = new Map(accounts.map((account) => [account.playerId, account] as const));
    const eloUpdates = new Map<string, { eloRating: number; leaderboardAbuseState?: PlayerAccountSnapshot["leaderboardAbuseState"] }>();
    for (const replay of completedReplays) {
      if (!replay.defenderPlayerId) continue;
      const attackerPlayerId = replay.attackerPlayerId;
      const defenderPlayerId = replay.defenderPlayerId;
      const attackerAccount = accountStateByPlayerId.get(attackerPlayerId);
      const defenderAccount = accountStateByPlayerId.get(defenderPlayerId);
      const attackerWon = replay.result === "attacker_victory";
      const winnerPlayerId = attackerWon ? attackerPlayerId : defenderPlayerId;
      const loserPlayerId = attackerWon ? defenderPlayerId : attackerPlayerId;
      const winnerAccount = attackerWon ? attackerAccount : defenderAccount;
      const loserAccount = attackerWon ? defenderAccount : attackerAccount;
      const settlement = settleLeaderboardMatch({
        winner: {
          playerId: winnerPlayerId,
          eloRating: normalizeEloRating(winnerAccount?.eloRating),
          leaderboardAbuseState: winnerAccount?.leaderboardAbuseState,
          leaderboardModerationState: winnerAccount?.leaderboardModerationState
        },
        loser: {
          playerId: loserPlayerId,
          eloRating: normalizeEloRating(loserAccount?.eloRating),
          leaderboardAbuseState: loserAccount?.leaderboardAbuseState,
          leaderboardModerationState: loserAccount?.leaderboardModerationState
        }
      });
      for (const alert of settlement.alerts) {
        recordLeaderboardAbuseAlert(alert);
      }

      const nextWinnerAccount = {
        ...(winnerAccount ?? { playerId: winnerPlayerId }),
        eloRating: settlement.winnerRating,
        leaderboardAbuseState: settlement.winnerAbuseState
      } as PlayerAccountSnapshot;
      const nextLoserAccount = {
        ...(loserAccount ?? { playerId: loserPlayerId }),
        eloRating: settlement.loserRating,
        leaderboardAbuseState: settlement.loserAbuseState
      } as PlayerAccountSnapshot;
      accountStateByPlayerId.set(winnerPlayerId, nextWinnerAccount);
      accountStateByPlayerId.set(loserPlayerId, nextLoserAccount);
      eloUpdates.set(winnerPlayerId, {
        eloRating: settlement.winnerRating,
        leaderboardAbuseState: settlement.winnerAbuseState
      });
      eloUpdates.set(loserPlayerId, {
        eloRating: settlement.loserRating,
        leaderboardAbuseState: settlement.loserAbuseState
      });
    }

    try {
      await Promise.all(
        playerIds.map(async (playerId) => {
          const playerEvents = filterWorldEventsForPlayer(internalState, playerId, events);
          const playerReplays = completedReplays.flatMap((replay) => this.buildPlayerBattleReplaysForAccount(replay, playerId));
          if (playerEvents.length === 0 && playerReplays.length === 0 && !eloUpdates.has(playerId)) {
            return;
          }

          const existingAccount =
            accounts.find((account) => account.playerId === playerId) ??
            (await store.ensurePlayerAccount({
              playerId,
              lastRoomId: this.metadata.logicalRoomId
            }));
          const nextAccount = appendCompletedBattleReplaysToAccount(
            applyPlayerEventLogAndAchievements(existingAccount, internalState, playerEvents),
            playerReplays
          );
          const eloUpdate = eloUpdates.get(playerId);
          const seasonXpDelta = completedReplays
            .filter((replay) => replay.attackerPlayerId === playerId || replay.defenderPlayerId === playerId)
            .reduce(
              (total, replay) =>
                total +
                (didPlayerWinBattle(replay, playerId)
                  ? battlePassConfig.seasonXpPerWin
                  : battlePassConfig.seasonXpPerLoss),
              0
            );
          await store.savePlayerAccountProgress(playerId, {
            achievements: nextAccount.achievements,
            recentEventLog: nextAccount.recentEventLog,
            ...(playerReplays.length > 0 ? { recentBattleReplays: nextAccount.recentBattleReplays } : {}),
            ...(eloUpdate ? { eloRating: eloUpdate.eloRating, leaderboardAbuseState: eloUpdate.leaderboardAbuseState } : {}),
            ...(seasonXpDelta > 0 ? { seasonXpDelta } : {}),
            lastRoomId: this.metadata.logicalRoomId
          });
        })
      );
    } catch (error) {
      console.error("[VeilRoom] Failed to persist player account progress", {
        roomId: this.metadata.logicalRoomId,
        error
      });
    }
  }

  private async reconcileInterruptedBattles(playerId: string): Promise<void> {
    const store = configuredRoomSnapshotStore;
    if (!hasBattleSnapshotStore(store)) {
      return;
    }

    try {
      const activeSnapshots = await store.listBattleSnapshotsForPlayer(playerId, {
        statuses: ["active"],
        limit: 20
      });
      for (const snapshot of activeSnapshots) {
        if (this.currentRoomIncludesBattle(snapshot, playerId)) {
          continue;
        }
        if (activeRoomInstances.has(snapshot.roomId)) {
          continue;
        }

        const compensation = this.buildInterruptedBattleCompensation(snapshot);
        await store.settleInterruptedBattleSnapshot({
          roomId: snapshot.roomId,
          battleId: snapshot.battleId,
          status: snapshot.estimatedCompensationGrant ? "compensated" : "aborted",
          resolutionReason: "room_missing_after_disconnect",
          ...(compensation ? { compensation } : {}),
          resolvedAt: new Date(roomRuntimeDependencies.now()).toISOString()
        });
      }
    } catch (error) {
      console.error("[VeilRoom] Failed to reconcile interrupted battles", {
        roomId: this.metadata.logicalRoomId,
        playerId,
        error
      });
    }
  }

  private currentRoomIncludesBattle(snapshot: BattleSnapshotRecord, playerId: string): boolean {
    const activeBattle = this.worldRoom.getBattleForPlayer(playerId);
    if (activeBattle?.id === snapshot.battleId) {
      return true;
    }

    return this.worldRoom.getActiveBattles().some((battle) => battle.id === snapshot.battleId);
  }

  private buildInterruptedBattleCompensation(snapshot: BattleSnapshotRecord) {
    const grant = snapshot.estimatedCompensationGrant;
    const messageId = `${snapshot.battleId}:disconnect-recovery`;
    if (grant) {
      return {
        mailboxMessageId: messageId,
        playerIds: [snapshot.attackerPlayerId],
        kind: "compensation" as const,
        title: "战斗中断补偿",
        body: `房间 ${snapshot.roomId} 的战斗 ${snapshot.battleId} 在断线后未能恢复，系统已按开战快照补发可估算奖励。`,
        grant
      };
    }

    return {
      mailboxMessageId: messageId,
      playerIds: snapshot.playerIds,
      kind: "system" as const,
      title: "战斗中断通知",
      body: `房间 ${snapshot.roomId} 的战斗 ${snapshot.battleId} 在断线后未能恢复，系统已保留记录供客服追溯。`
    };
  }

  private buildPlayerBattleReplaysForAccount(
    replay: CompletedBattleReplayCapture,
    playerId: string
  ): PlayerBattleReplaySummary[] {
    return buildPlayerBattleReplaySummariesForPlayer(replay, playerId);
  }

  private async handleSurrenderAction(
    sourceClient: ColyseusClient,
    playerId: string,
    message: Extract<ClientMessage, { type: "world.action" }>
  ): Promise<boolean> {
    const action = message.action;
    if (action.type !== "world.surrender") {
      return false;
    }

    const internalState = this.worldRoom.getInternalState();
    if (this.worldRoom.getBattleForPlayer(playerId)) {
      sendMessage(sourceClient, "error", { requestId: message.requestId, reason: "hero_in_battle" });
      return true;
    }

    const validation = validateWorldAction(internalState, action, playerId);
    if (!validation.valid) {
      sendMessage(sourceClient, "error", {
        requestId: message.requestId,
        reason: validation.reason ?? "surrender_failed"
      });
      return true;
    }

    const surrenderingHero = internalState.heroes.find((hero) => hero.id === action.heroId);
    if (!surrenderingHero || surrenderingHero.playerId !== playerId) {
      sendMessage(sourceClient, "error", { requestId: message.requestId, reason: "hero_not_owned_by_player" });
      return true;
    }

    const opponentPlayerIds = Array.from(
      new Set(internalState.heroes.map((hero) => hero.playerId).filter((candidatePlayerId) => candidatePlayerId !== playerId))
    );
    if (opponentPlayerIds.length !== 1) {
      sendMessage(sourceClient, "error", { requestId: message.requestId, reason: "surrender_opponent_not_found" });
      return true;
    }

    const winnerPlayerId = opponentPlayerIds[0]!;
    if (!(await this.applySurrenderEloResult(winnerPlayerId, playerId))) {
      return false;
    }

    await this.broadcastSettlementAndCloseRoom(sourceClient, "surrender", message.requestId);
    return true;
  }

  private async applySurrenderEloResult(winnerPlayerId: string, loserPlayerId: string): Promise<boolean> {
    const store = configuredRoomSnapshotStore;
    if (!store) {
      return true;
    }

    try {
      const accounts = await store.loadPlayerAccounts([winnerPlayerId, loserPlayerId]);
      const winnerAccount = accounts.find((account) => account.playerId === winnerPlayerId);
      const loserAccount = accounts.find((account) => account.playerId === loserPlayerId);
      const settlement = settleLeaderboardMatch({
        winner: {
          playerId: winnerPlayerId,
          eloRating: normalizeEloRating(winnerAccount?.eloRating),
          leaderboardAbuseState: winnerAccount?.leaderboardAbuseState,
          leaderboardModerationState: winnerAccount?.leaderboardModerationState
        },
        loser: {
          playerId: loserPlayerId,
          eloRating: normalizeEloRating(loserAccount?.eloRating),
          leaderboardAbuseState: loserAccount?.leaderboardAbuseState,
          leaderboardModerationState: loserAccount?.leaderboardModerationState
        }
      });
      for (const alert of settlement.alerts) {
        recordLeaderboardAbuseAlert(alert);
      }

      await Promise.all([
        store.savePlayerAccountProgress(winnerPlayerId, {
          eloRating: settlement.winnerRating,
          leaderboardAbuseState: settlement.winnerAbuseState,
          lastRoomId: this.metadata.logicalRoomId
        }),
        store.savePlayerAccountProgress(loserPlayerId, {
          eloRating: settlement.loserRating,
          leaderboardAbuseState: settlement.loserAbuseState,
          lastRoomId: this.metadata.logicalRoomId
        })
      ]);
      return true;
    } catch (error) {
      console.error("[VeilRoom] Failed to persist surrender ELO result", {
        roomId: this.metadata.logicalRoomId,
        winnerPlayerId,
        loserPlayerId,
        error
      });
      return false;
    }
  }

  private async broadcastSettlementAndCloseRoom(
    sourceClient: ColyseusClient | null,
    reason: SessionStateReason,
    requestId: string
  ): Promise<void> {
    for (const client of [...this.clients]) {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        continue;
      }

      sendMessage(client, "session.state", {
        requestId: client === sourceClient ? requestId : "push",
        delivery: client === sourceClient ? "reply" : "push",
        payload: this.buildStatePayload(playerId, {
          movementPlan: null,
          reason
        })
      });
    }

    if (configuredRoomSnapshotStore) {
      try {
        await configuredRoomSnapshotStore.delete(this.metadata.logicalRoomId);
      } catch (error) {
        console.error("[VeilRoom] Failed to delete surrendered room snapshot", {
          roomId: this.metadata.logicalRoomId,
          error
        });
      }
    }

    for (const client of [...this.clients]) {
      this.playerIdBySessionId.delete(client.sessionId);
      try {
        void client.leave();
      } catch {
        // Ignore disconnect errors while retiring the room after settlement.
      }
    }
    this.clients.splice(0, this.clients.length);
    this.retireRoom(reason);
  }

  private retireRoom(reason: string): void {
    if (this.roomRetired) {
      return;
    }

    this.roomRetired = true;
    try {
      for (const battle of this.worldRoom.getActiveBattles()) {
        recordBattleLifecycleResolved({
          roomId: this.metadata.logicalRoomId,
          battleId: battle.id,
          outcome: "aborted",
          reason
        });
      }

      recordRoomDisposed(this.metadata.logicalRoomId, reason);
    } catch (error) {
      console.error("[VeilRoom] Failed to retire room cleanly", {
        roomId: this.metadata.logicalRoomId,
        reason,
        error
      });
      recordRuntimeErrorEvent({
        id: `room-retire-${this.metadata.logicalRoomId}-${Date.now()}`,
        recordedAt: new Date().toISOString(),
        source: "server",
        surface: "server",
        candidateRevision: "workspace",
        featureArea: "runtime",
        ownerArea: "multiplayer",
        severity: "error",
        errorCode: "room_retire_failed",
        message: "Room retirement cleanup raised an exception.",
        context: {
          roomId: this.metadata.logicalRoomId,
          playerId: null,
          requestId: null,
          route: null,
          action: null,
          statusCode: null,
          crash: false,
          detail: `reason=${reason} error=${error instanceof Error ? error.message : String(error)}`
        }
      });
    } finally {
      this.releaseRoomRegistries();
    }
  }

  private resolveReportTargetPlayerId(playerId: string, requestedTargetPlayerId: string): string | null {
    const targetPlayerId = requestedTargetPlayerId.trim();
    if (!targetPlayerId || targetPlayerId === playerId) {
      return null;
    }

    if (this.getConnectedPlayerIds().includes(targetPlayerId)) {
      return targetPlayerId;
    }

    const battle = this.worldRoom.getBattleForPlayer(playerId);
    if (!battle?.worldHeroId || !battle.defenderHeroId) {
      return null;
    }

    const internalState = this.worldRoom.getInternalState();
    const attackerHero = internalState.heroes.find((hero) => hero.id === battle.worldHeroId);
    const defenderHero = internalState.heroes.find((hero) => hero.id === battle.defenderHeroId);
    const participantPlayerIds = new Set(
      [attackerHero?.playerId, defenderHero?.playerId].filter((value): value is string => Boolean(value))
    );

    return participantPlayerIds.has(targetPlayerId) ? targetPlayerId : null;
  }

  private publishLobbyRoomSummary(): void {
    if (lobbyRoomOwnerTokens.get(this.metadata.logicalRoomId) !== this.lobbyRoomOwnerToken) {
      return;
    }

    const internalState = this.worldRoom.getInternalState();
    const connectedPlayerIds = new Set(this.getConnectedPlayerIds());
    const disconnectedPlayers = Array.from(this.disconnectedAtByPlayerId.keys()).filter(
      (playerId) => !connectedPlayerIds.has(playerId)
    ).length;
    const activeBattles = this.worldRoom.getActiveBattles().length;
    const summary = {
      roomId: this.metadata.logicalRoomId,
      seed: internalState.meta.seed,
      day: internalState.meta.day,
      connectedPlayers: this.playerIdBySessionId.size,
      disconnectedPlayers,
      heroCount: internalState.heroes.length,
      activeBattles,
      statusLabel:
        activeBattles > 0
          ? disconnectedPlayers > 0
            ? "恢复中"
            : "PVP 进行中"
          : disconnectedPlayers > 0
            ? "等待重连"
            : "探索中",
      updatedAt: new Date().toISOString()
    };
    lobbyRoomSummaries.set(this.metadata.logicalRoomId, summary);
    recordRuntimeRoom(summary);
    flushPendingConfigUpdate();
  }

  private refreshEmptyRoomTracking(now = roomRuntimeDependencies.now()): void {
    this.emptyRoomSinceAtMs = this.getConnectedPlayerIds().length === 0 ? this.emptyRoomSinceAtMs ?? now : null;
  }

  private isExpiredEmptyRoom(now: number): boolean {
    return this.getConnectedPlayerIds().length === 0 && this.emptyRoomSinceAtMs != null && now - this.emptyRoomSinceAtMs >= EMPTY_ROOM_TTL_MS;
  }

  runExpiredEmptyRoomCleanup(now: number): Promise<void> {
    return this.disposeIfExpiredEmptyRoom(now);
  }

  private async disposeIfExpiredEmptyRoom(now: number): Promise<void> {
    if (this.roomRetired || activeRoomInstances.get(this.metadata.logicalRoomId) !== this || !this.isExpiredEmptyRoom(now)) {
      return;
    }

    try {
      await this.disconnect();
    } catch (error) {
      console.error("[VeilRoom] Failed to dispose stale empty room", {
        roomId: this.metadata.logicalRoomId,
        emptyRoomForMs: now - (this.emptyRoomSinceAtMs ?? now),
        error
      });
      recordRuntimeErrorEvent({
        id: `room-cleanup-${this.metadata.logicalRoomId}-${Date.now()}`,
        recordedAt: new Date().toISOString(),
        source: "server",
        surface: "server",
        candidateRevision: "workspace",
        featureArea: "runtime",
        ownerArea: "multiplayer",
        severity: "error",
        errorCode: "zombie_room_cleanup_failed",
        message: "Background zombie-room cleanup failed to disconnect an empty room.",
        context: {
          roomId: this.metadata.logicalRoomId,
          playerId: null,
          requestId: null,
          route: null,
          action: null,
          statusCode: null,
          crash: false,
          detail: `empty_room_for_ms=${now - (this.emptyRoomSinceAtMs ?? now)} error=${error instanceof Error ? error.message : String(error)}`
        }
      });
      this.retireRoom("zombie_room_cleanup");
    }
  }

  private releaseRoomRegistries(): void {
    if (activeRoomInstances.get(this.metadata.logicalRoomId) === this) {
      activeRoomInstances.delete(this.metadata.logicalRoomId);
    }

    if (lobbyRoomOwnerTokens.get(this.metadata.logicalRoomId) === this.lobbyRoomOwnerToken) {
      lobbyRoomOwnerTokens.delete(this.metadata.logicalRoomId);
      lobbyRoomSummaries.delete(this.metadata.logicalRoomId);
      removeRuntimeRoom(this.metadata.logicalRoomId);
    }

    flushPendingConfigUpdate();
  }

  private hasPlayerBeenDisconnectedLongEnough(playerId: string): boolean {
    if (this.getConnectedPlayerIds().includes(playerId)) {
      return false;
    }

    const disconnectedAt = this.disconnectedAtByPlayerId.get(playerId);
    if (!disconnectedAt) {
      return false;
    }

    const disconnectedAtMs = Date.parse(disconnectedAt);
    if (!Number.isFinite(disconnectedAtMs)) {
      return false;
    }

    return roomRuntimeDependencies.now() - disconnectedAtMs > TURN_REMINDER_DISCONNECT_THRESHOLD_MS;
  }

  private async maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId: string | null): Promise<void> {
    const nextTurnOwnerPlayerId = this.turnOwnerPlayerId;
    if (!configuredRoomSnapshotStore || !nextTurnOwnerPlayerId || nextTurnOwnerPlayerId === previousTurnOwnerPlayerId) {
      return;
    }

    if (!this.hasPlayerBeenDisconnectedLongEnough(nextTurnOwnerPlayerId)) {
      return;
    }

    try {
      await roomRuntimeDependencies.sendWechatSubscribeMessage(
        nextTurnOwnerPlayerId,
        "turn_reminder",
        {
          roomId: this.metadata.logicalRoomId,
          turnNumber: this.worldRoom.getInternalState().meta.day
        },
        {
          store: configuredRoomSnapshotStore
        }
      );
      await roomRuntimeDependencies.sendMobilePushNotification(
        nextTurnOwnerPlayerId,
        "turn_reminder",
        {
          roomId: this.metadata.logicalRoomId,
          turnNumber: this.worldRoom.getInternalState().meta.day
        },
        {
          store: configuredRoomSnapshotStore
        }
      );
    } catch (error) {
      console.error("[VeilRoom] Failed to send turn reminder notification", {
        roomId: this.metadata.logicalRoomId,
        playerId: nextTurnOwnerPlayerId,
        turnNumber: this.worldRoom.getInternalState().meta.day,
        error
      });
    }
  }

  private getPlayerId(client: ColyseusClient, fallback?: string): string | undefined {
    const playerId = this.playerIdBySessionId.get(client.sessionId) ?? fallback;
    if (playerId && !this.playerIdBySessionId.has(client.sessionId)) {
      this.playerIdBySessionId.set(client.sessionId, playerId);
    }

    return playerId;
  }

  private resolveConnectPlayerId(client: ColyseusClient, requestedPlayerId?: string): string | undefined {
    const normalizedRequestedPlayerId = requestedPlayerId?.trim();
    const currentPlayerId = this.playerIdBySessionId.get(client.sessionId);
    if (currentPlayerId === client.sessionId && normalizedRequestedPlayerId) {
      this.playerIdBySessionId.set(client.sessionId, normalizedRequestedPlayerId);
      return normalizedRequestedPlayerId;
    }

    return this.getPlayerId(client, normalizedRequestedPlayerId);
  }

  private readGroupChallengeSecret(): string {
    return readRuntimeSecret("VEIL_WECHAT_GROUP_CHALLENGE_SECRET") || DEFAULT_GROUP_CHALLENGE_SECRET;
  }

  private buildShareActivityReply(input: {
    playerId: string;
    roomId: string;
    accountDisplayName?: string | null;
    message: Extract<ClientMessage, { type: "SHARE_ACTIVITY" }>;
  }): Omit<Extract<ServerMessage, { type: "SHARE_ACTIVITY" }>, "type" | "requestId"> {
    if (input.message.activity === "group_challenge") {
      const challenge =
        input.message.challengeToken?.trim()
          ? null
          : createGroupChallenge({
              creatorPlayerId: input.playerId,
              creatorDisplayName: input.accountDisplayName ?? input.playerId,
              roomId: input.roomId,
              challengeType: "victory"
            });
      const challengeToken =
        input.message.challengeToken?.trim()
        || (challenge ? encodeGroupChallengeToken(challenge, this.readGroupChallengeSecret()) : undefined);
      const shareUrl = this.buildSocialShareUrl({
        roomId: input.roomId,
        inviterId: input.playerId,
        shareScene: "lobby",
        ...(challengeToken ? { challengeToken } : {})
      });

      return {
        activity: input.message.activity,
        roomId: input.roomId,
        shareUrl,
        shareMessage: `${input.accountDisplayName?.trim() || input.playerId} 发起了组队挑战。`,
        ...(challenge ? { challenge } : {}),
        ...(challengeToken ? { challengeToken } : {})
      };
    }

    return {
      activity: input.message.activity,
      roomId: input.roomId,
      shareUrl: this.buildSocialShareUrl({
        roomId: input.roomId,
        referrer: input.playerId,
        shareScene: "battle"
      }),
      shareMessage: `${input.accountDisplayName?.trim() || input.playerId} 分享了一场胜利战报。`
    };
  }

  private buildSocialShareUrl(query: Record<string, string>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const normalized = value.trim();
      if (normalized) {
        searchParams.set(key, normalized);
      }
    }

    const serialized = searchParams.toString();
    return serialized ? `?${serialized}` : "?";
  }

  private logSocialMessage(
    event: "friend_leaderboard_ready" | "share_activity_ready",
    detail: Record<string, string | number | boolean | null>
  ): void {
    console.info("[VeilRoom] Social handler processed", {
      roomId: this.metadata.logicalRoomId,
      event,
      ...detail
    });
  }

  private reportSocialHandlerFailure(
    errorCode: "friend_leaderboard_failed" | "share_activity_failed",
    playerId: string,
    requestId: string,
    error: unknown,
    extras: Record<string, string | number | boolean | null> = {}
  ): void {
    const detail = Object.entries(extras)
      .filter(([, value]) => value != null)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");

    console.error("[VeilRoom] Social handler failed", {
      roomId: this.metadata.logicalRoomId,
      playerId,
      requestId,
      errorCode,
      extras,
      error
    });

    recordRuntimeErrorEvent({
      id: `${this.metadata.logicalRoomId}:${playerId}:${requestId}:${errorCode}`,
      recordedAt: new Date().toISOString(),
      source: "server",
      surface: "colyseus-room",
      candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "workspace",
      featureArea: "runtime",
      ownerArea: "multiplayer",
      severity: "error",
      errorCode,
      message: "Social websocket handler failed.",
      tags: ["social", errorCode],
      context: {
        roomId: this.metadata.logicalRoomId,
        playerId,
        requestId,
        route: null,
        action: errorCode,
        statusCode: null,
        crash: false,
        detail: detail || (error instanceof Error ? error.message : String(error))
      }
    });
  }

  private updatePlayerAuthSession(playerId: string, authSession: GuestAuthSession | null): void {
    if (authSession) {
      this.authSessionByPlayerId.set(playerId, authSession);
      return;
    }

    this.authSessionByPlayerId.delete(playerId);
  }

  private clearPlayerAuthSession(playerId: string): void {
    this.authSessionByPlayerId.delete(playerId);
  }

  private async validateReconnectSession(playerId: string): Promise<{ session: GuestAuthSession | null; errorCode?: string }> {
    const authSession = this.authSessionByPlayerId.get(playerId);
    if (!authSession?.token) {
      return { session: null };
    }

    return await validateGuestAuthToken(authSession.token, configuredRoomSnapshotStore);
  }

  private rejectExpiredSession(client: ColyseusClient, requestId: string, reason: string): void {
    if (reason !== "token_expired") {
      return;
    }

    sendMessage(client, "SESSION_EXPIRED", {
      requestId,
      delivery: "push",
      reason
    });
    client.leave(CloseCode.WITH_ERROR, "session_expired");
  }

  private pushSessionStateToAll(extras?: {
    events?: WorldEvent[];
    movementPlan?: MovementPlan | null;
    reason?: string;
    rejection?: ActionValidationFailure;
  }): void {
    for (const client of this.clients) {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        continue;
      }

      const snapshot = this.worldRoom.getSnapshot(playerId).state;
      const mapBounds = resolveFocusedMapBounds(snapshot);

      sendMessage(client, "session.state", {
        requestId: "push",
        delivery: "push",
        payload: this.buildStatePayload(playerId, extras, {
          mapBounds,
          snapshot
        })
      });
    }
  }

  private async ensurePlayerWorldSlot(
    playerId: string,
    ensuredAccount: PlayerAccountSnapshot | null
  ): Promise<void> {
    const internalState = this.worldRoom.getInternalState();
    if (internalState.heroes.some((hero) => hero.playerId === playerId)) {
      return;
    }

    const availableSlotId = this.findAvailablePlayerWorldSlotId();
    if (!availableSlotId) {
      return;
    }

    const snapshot = this.worldRoom.serializePersistenceSnapshot();
    let nextState = rebindWorldStatePlayerId(snapshot.state, availableSlotId, playerId);
    if (configuredRoomSnapshotStore) {
      const heroArchives = await configuredRoomSnapshotStore.loadPlayerHeroArchives([playerId]);
      nextState = applyPlayerHeroArchivesToWorldState(nextState, heroArchives);
    }

    this.restoreWorldRoom({
      ...snapshot,
      state: nextState
    });
    await this.persistRoomState();
    if (ensuredAccount && configuredRoomSnapshotStore) {
      await configuredRoomSnapshotStore.savePlayerAccountProgress(playerId, {
        globalResources: ensuredAccount.globalResources,
        lastRoomId: this.metadata.logicalRoomId
      });
    }
  }

  private findAvailablePlayerWorldSlotId(): string | null {
    const internalState = this.worldRoom.getInternalState();
    const connectedPlayerIds = new Set(this.playerIdBySessionId.values());
    return (
      Array.from(new Set([...internalState.heroes.map((hero) => hero.playerId), ...Object.keys(internalState.resources)]))
        .filter((candidatePlayerId) => {
          if (!isDefaultPlayerSlotId(candidatePlayerId)) {
            return false;
          }

          return !connectedPlayerIds.has(candidatePlayerId);
        })
        .sort(compareDefaultPlayerSlotIds)[0] ?? null
    );
  }

  private buildStatePayload(
    playerId: string,
    extras?: {
      events?: WorldEvent[];
      movementPlan?: MovementPlan | null;
      reason?: string;
      rejection?: ActionValidationFailure;
    },
    options?: {
      mapBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;
      snapshot?: PlayerWorldView;
    }
  ): SessionStatePayload {
    const snapshot = options?.snapshot ?? this.worldRoom.getSnapshot(playerId).state;
    const world = encodePlayerWorldView(snapshot, {
      ...(options?.mapBounds ? { bounds: options.mapBounds } : {}),
      binary: true
    });
    const battle = this.worldRoom.getBattleForPlayer(playerId);
    const heroId = world.ownHeroes[0]?.id;
    const events = extras?.events ? filterWorldEventsForPlayer(this.worldRoom.getInternalState(), playerId, extras.events) : [];

    return {
      world,
      battle,
      events,
      movementPlan: extras?.movementPlan ?? null,
      reachableTiles: heroId && !battle ? listReachableTilesInPlayerView(snapshot, heroId) : [],
      featureFlags: this.resolvePlayerFeatureFlags(playerId),
      ...(extras?.reason ? { reason: extras.reason } : {}),
      ...(extras?.rejection ? { rejection: extras.rejection } : {})
    };
  }

  private resolvePlayerFeatureFlags(playerId: string): FeatureFlags {
    return resolveFeatureFlagsForPlayer(playerId);
  }

  private emitAnalyticsForWorldEvents(playerId: string, events: WorldEvent[]): void {
    for (const event of events) {
      if (event.type === "battle.started") {
        emitAnalyticsEvent("battle_start", {
          playerId,
          roomId: this.metadata.logicalRoomId,
          payload: {
            roomId: this.metadata.logicalRoomId,
            battleId: event.battleId,
            encounterKind: event.encounterKind,
            heroId: event.heroId
          }
        });
      }

      if (event.type === "battle.resolved") {
        emitAnalyticsEvent("battle_end", {
          playerId,
          roomId: this.metadata.logicalRoomId,
          payload: {
            roomId: this.metadata.logicalRoomId,
            battleId: event.battleId,
            result: event.result,
            heroId: event.heroId,
            battleKind: "battleKind" in event && typeof event.battleKind === "string" ? event.battleKind : "unknown"
          }
        });
      }
    }
  }

  private broadcastState(
    source: ColyseusClient | null,
    extras?: {
      events?: WorldEvent[];
      movementPlan?: MovementPlan | null;
      reason?: string;
      rejection?: ActionValidationFailure;
    }
  ): void {
    for (const client of this.clients) {
      if (client === source) {
        continue;
      }

      const playerId = this.getPlayerId(client);
      if (!playerId) {
        continue;
      }

      const snapshot = this.worldRoom.getSnapshot(playerId).state;
      const mapBounds = resolveFocusedMapBounds(snapshot);
      sendMessage(client, "session.state", {
        requestId: "push",
        delivery: "push",
        payload: this.buildStatePayload(
          playerId,
          {
            movementPlan: null,
            ...(extras?.events ? { events: extras.events } : {}),
            ...(extras?.reason ? { reason: extras.reason } : {})
          },
          {
            mapBounds,
            snapshot
          }
        )
      });
    }
  }

  private broadcastCosmeticApplied(
    source: ColyseusClient | null,
    message: Omit<Extract<ServerMessage, { type: "COSMETIC_APPLIED" }>, "type" | "requestId" | "delivery">
  ): void {
    for (const client of this.clients) {
      if (client === source) {
        continue;
      }

      sendMessage(client, "COSMETIC_APPLIED", {
        requestId: "push",
        delivery: "push",
        ...message
      });
    }
  }
}
