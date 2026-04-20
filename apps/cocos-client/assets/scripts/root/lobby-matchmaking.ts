// @ts-nocheck

import {
  buildMatchmakingStatusView,
  clearStoredCocosAuthSession,
  createFallbackCocosPlayerAccountProfile,
  createCocosGuestPlayerId,
  readPreferredCocosDisplayName,
  readStoredCocosAuthSession,
  requestCocosWechatSubscribeConsent,
  saveCocosLobbyPreferences,
  rememberPreferredCocosDisplayName,
  startCocosMatchmakingStatusPolling,
  type MatchmakingStatusResponse
} from "./deps.ts";
import { resolveVeilRootRuntime } from "./runtime.ts";

class VeilRootLobbyMatchmakingMethods {
  [key: string]: any;
  async startNewRun(): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    const previousSession = this.session;
    const previousSessionEpoch = this.sessionEpoch;
    const previousRoomId = this.roomId;
    const previousSeed = this.seed;
    const nextRoomId = `run-${Date.now().toString(36).slice(-6)}`;
    const nextSeed = this.seed + 1;
    let freshSession: VeilCocosSession | null = null;
    const nextSessionEpoch = this.bumpSessionEpoch();

    this.pendingPrediction = null;
    this.selectedBattleTargetId = null;
    this.moveInFlight = false;
    this.battleActionInFlight = false;
    this.predictionStatus = "正在开启新一局...";
    this.inputDebug = "input waiting";
    this.timelineEntries = [];
    this.primaryClientTelemetry = [];
    this.logLines = [`正在创建新房间 ${nextRoomId} ...`];
    this.renderView();

    try {
      freshSession = await resolveVeilRootRuntime().createSession(
        nextRoomId,
        this.playerId,
        nextSeed,
        this.createSessionOptions(nextSessionEpoch)
      );
      if (!this.isActiveSessionEpoch(nextSessionEpoch)) {
        await freshSession.dispose().catch(() => undefined);
        return;
      }

      const freshUpdate = await freshSession.snapshot();
      if (!this.isActiveSessionEpoch(nextSessionEpoch)) {
        await freshSession.dispose().catch(() => undefined);
        return;
      }

      this.session = freshSession;
      this.roomId = nextRoomId;
      this.seed = nextSeed;
      this.syncBrowserRoomQuery(nextRoomId);
      this.pushLog(`已进入新房间 ${nextRoomId}。`);
      await this.applySessionUpdate(freshUpdate);

      if (previousSession) {
        await previousSession.dispose().catch(() => undefined);
      }
      return;
    } catch (error) {
      if (freshSession) {
        await freshSession.dispose().catch(() => undefined);
      }
      this.sessionEpoch = previousSessionEpoch;
      this.session = previousSession;
      this.roomId = previousRoomId;
      this.seed = previousSeed;
      const failureMessage = this.describeSessionError(error, "开启新一局失败。");
      if (error instanceof Error && error.message === "upgrade_required") {
        await this.handleForcedUpgrade(failureMessage);
        return;
      }
      this.pushLog(failureMessage);
      this.predictionStatus = failureMessage;
      this.renderView();
    }
  }

  async refreshLobbyRoomList(): Promise<void> {
    if (this.lobbyLoading || this.lobbyEntering) {
      return;
    }

    this.lobbyLoading = true;
    this.lobbyStatus = "正在刷新可加入房间...";
    this.renderView();

    try {
      const [rooms, announcements, maintenanceMode] = await Promise.all([
        resolveVeilRootRuntime().loadLobbyRooms(this.remoteUrl),
        resolveVeilRootRuntime().loadAnnouncements(this.remoteUrl).catch(() => []),
        resolveVeilRootRuntime().loadMaintenanceMode(this.remoteUrl).catch(() => null)
      ]);
      this.lobbyRooms = rooms;
      this.lobbyAnnouncements = announcements;
      this.lobbyMaintenanceMode = maintenanceMode;
      this.lobbyStatus = maintenanceMode?.active
        ? `${maintenanceMode.title} · ${maintenanceMode.message}`
        : rooms.length > 0
          ? `发现 ${rooms.length} 个活跃房间，可直接加入或继续创建新房间。`
          : "当前没有活跃房间，输入房间 ID 后点击“进入房间”即可创建新实例。";
    } catch {
      this.lobbyRooms = [];
      this.lobbyStatus = "Lobby 服务暂不可达；仍可直接输入房间 ID，进入时会自动尝试远端房间并在失败后回退本地模式。";
    } finally {
      this.lobbyLoading = false;
      this.renderView();
    }
  }

  async enterLobbyRoom(roomIdOverride?: string): Promise<void> {
    if (this.lobbyEntering) {
      return;
    }

    if (this.isMatchmakingActive()) {
      this.lobbyStatus = "正在匹配中，请先取消当前队列。";
      this.renderView();
      return;
    }

    if (!this.ensurePrivacyConsentAccepted()) {
      return;
    }

    const storage = this.readWebStorage();
    const preferences = saveCocosLobbyPreferences(this.playerId, roomIdOverride ?? this.roomId, undefined, storage);
    const displayName = rememberPreferredCocosDisplayName(preferences.playerId, this.displayName || preferences.playerId, storage);
    this.playerId = preferences.playerId;
    this.roomId = preferences.roomId;
    this.displayName = displayName;
    this.lobbyEntering = true;
    this.lobbyStatus =
      this.authMode === "account" && this.authToken
        ? `正在使用账号 ${this.loginId || this.playerId} 进入房间 ${preferences.roomId}...`
        : `正在登录游客账号并进入房间 ${preferences.roomId}...`;
    this.renderView();

    try {
      let authSession: Awaited<ReturnType<typeof loginCocosGuestAuthSession>>;
      if (this.authMode === "account" && this.authToken) {
        const syncedSession = await resolveVeilRootRuntime().syncAuthSession(this.remoteUrl, {
          storage,
          session: readStoredCocosAuthSession(storage)
        });
        if (!syncedSession) {
          throw new Error("cocos_request_failed:401");
        }
        authSession = syncedSession;
      } else {
        authSession = await resolveVeilRootRuntime().loginGuestAuthSession(this.remoteUrl, preferences.playerId, displayName, {
          storage,
          privacyConsentAccepted: this.privacyConsentAccepted
        });
      }
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "guest";
      this.loginId = authSession.loginId ?? "";
      this.sessionSource = authSession.source;
      await this.maybeClaimLaunchReferral(authSession);
      saveCocosLobbyPreferences(authSession.playerId, preferences.roomId, undefined, storage);
      this.resetSessionViewport(`正在进入房间 ${preferences.roomId} ...`);
      this.showLobby = false;
      this.syncBrowserRoomQuery(preferences.roomId);
      this.syncWechatShareBridge();
      this.lobbyStatus =
        authSession.authMode === "account"
          ? `账号 ${authSession.loginId ?? authSession.playerId} 登录成功，正在进入房间 ${preferences.roomId}...`
          : authSession.source === "remote"
            ? `游客登录成功，正在进入房间 ${preferences.roomId}...`
            : `登录服务暂不可达，正在以本地游客档进入房间 ${preferences.roomId}...`;
      this.renderView();
      await this.connect();

      if (this.upgradeRequired) {
        this.renderView();
        return;
      }

      if (!this.session && !this.lastUpdate) {
        this.showLobby = true;
        this.lobbyStatus = "进入房间失败，请稍后重试或刷新房间列表。";
        this.renderView();
        return;
      }

      this.commitAccountProfile(
        createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName),
        false
      );
      this.renderView();
    } catch (error) {
      this.showLobby = true;
      if (error instanceof Error && error.message === "cocos_request_failed:401") {
        const storage = this.readWebStorage();
        if (storage) {
          clearStoredCocosAuthSession(storage);
        }
        this.authToken = null;
        this.authMode = "guest";
        this.authProvider = "guest";
        this.loginId = "";
        this.sessionSource = "none";
      }
      this.lobbyStatus =
        error instanceof Error && error.message === "cocos_request_failed:401"
          ? "账号会话已失效，请重新登录后再进入房间。"
          : this.describeCocosAccountFlowError(error, "enter_room_failed");
      this.renderView();
    } finally {
      this.lobbyEntering = false;
    }
  }

  isMatchmakingActive(): boolean {
    return this.matchmakingStatus.status === "queued" || this.matchmakingJoinInFlight;
  }

  updateMatchmakingStatus(status: MatchmakingStatusResponse, lobbyStatus?: string): void {
    this.matchmakingStatus = status;
    this.matchmakingView = buildMatchmakingStatusView(status);
    if (lobbyStatus) {
      this.lobbyStatus = lobbyStatus;
    }
  }

  stopMatchmakingPolling(): void {
    this.matchmakingPollController?.stop();
    this.matchmakingPollController = null;
    if (this.matchmakingTimeoutHandle) {
      clearTimeout(this.matchmakingTimeoutHandle);
      this.matchmakingTimeoutHandle = null;
    }
  }

  startMatchmakingPolling(): void {
    this.stopMatchmakingPolling();
    this.matchmakingPollController = resolveVeilRootRuntime().startMatchmakingPolling(
      this.remoteUrl,
      (status) => {
        void this.handleMatchmakingStatusUpdate(status);
      },
      {
        pollIntervalMs: 3000,
        stopOnMatched: true,
        authSession: this.authToken
          ? {
              token: this.authToken,
              playerId: this.playerId,
              displayName: this.displayName || this.playerId,
              authMode: this.authMode,
              ...(this.loginId ? { loginId: this.loginId } : {}),
              source: "remote"
            }
          : null
      }
    );
    this.matchmakingTimeoutHandle = setTimeout(() => {
      void this.handleMatchmakingTimeout();
    }, this.matchmakingTimeoutMs);
  }

  async ensureMatchmakingAuthSession(): Promise<void> {
    const storage = this.readWebStorage();
    if (this.authMode === "account" && this.authToken) {
      const syncedSession = await resolveVeilRootRuntime().syncAuthSession(this.remoteUrl, {
        storage,
        session: readStoredCocosAuthSession(storage)
      });
      if (!syncedSession) {
        throw new Error("cocos_request_failed:401");
      }
      this.authToken = syncedSession.token ?? null;
      this.playerId = syncedSession.playerId;
      this.displayName = syncedSession.displayName;
      this.authMode = syncedSession.authMode;
      this.authProvider = syncedSession.provider ?? "account-password";
      this.loginId = syncedSession.loginId ?? "";
      this.sessionSource = syncedSession.source;
      await this.maybeClaimLaunchReferral(syncedSession);
      return;
    }

    const authSession = await resolveVeilRootRuntime().loginGuestAuthSession(
      this.remoteUrl,
      this.playerId,
      this.displayName || this.playerId,
      {
        storage,
        privacyConsentAccepted: this.privacyConsentAccepted
      }
    );
    this.authToken = authSession.token ?? null;
    this.playerId = authSession.playerId;
    this.displayName = authSession.displayName;
    this.authMode = authSession.authMode;
    this.authProvider = authSession.provider ?? "guest";
    this.loginId = authSession.loginId ?? "";
    this.sessionSource = authSession.source;
    await this.maybeClaimLaunchReferral(authSession);
  }

  async enterLobbyMatchmaking(): Promise<void> {
    if (this.lobbyEntering || this.isMatchmakingActive()) {
      return;
    }

    if (!this.ensurePrivacyConsentAccepted()) {
      return;
    }

    this.lobbyEntering = true;
    this.updateMatchmakingStatus({ status: "idle" }, "正在进入 PVP 匹配队列...");
    this.renderView();

    try {
      await this.ensureMatchmakingAuthSession();
      const rating = this.lobbyAccountProfile.eloRating ?? 1000;
      const status = await resolveVeilRootRuntime().enqueueMatchmaking(this.remoteUrl, this.playerId, rating, {
        getDisplayName: () => this.displayName || this.playerId,
        getAuthToken: () => this.authToken
      });
      this.updateMatchmakingStatus(status, this.describeMatchmakingStatus(status));
      void requestCocosWechatSubscribeConsent();
      this.startMatchmakingPolling();
    } catch (error) {
      this.updateMatchmakingStatus({ status: "idle" });
      this.lobbyStatus = this.describeMatchmakingError(error);
    } finally {
      this.lobbyEntering = false;
      this.renderView();
    }
  }

  async cancelLobbyMatchmaking(): Promise<void> {
    if (!this.isMatchmakingActive() || this.lobbyEntering) {
      return;
    }

    this.lobbyEntering = true;
    this.lobbyStatus = "正在取消 PVP 匹配...";
    this.renderView();

    try {
      await resolveVeilRootRuntime().cancelMatchmaking(this.remoteUrl, this.playerId, {
        getDisplayName: () => this.displayName || this.playerId,
        getAuthToken: () => this.authToken
      });
      this.stopMatchmakingPolling();
      this.updateMatchmakingStatus({ status: "idle" }, "已取消当前匹配队列。");
    } catch (error) {
      this.lobbyStatus = this.describeMatchmakingError(error);
    } finally {
      this.lobbyEntering = false;
      this.renderView();
    }
  }

  async handleMatchmakingStatusUpdate(status: MatchmakingStatusResponse): Promise<void> {
    if (status.status === "idle") {
      this.stopMatchmakingPolling();
    }
    this.updateMatchmakingStatus(status, this.describeMatchmakingStatus(status));
    this.renderView();

    if (status.status === "matched" && !this.matchmakingJoinInFlight) {
      await this.enterMatchedRoom(status);
    }
  }

  async handleMatchmakingTimeout(): Promise<void> {
    if (!this.isMatchmakingActive()) {
      return;
    }

    this.stopMatchmakingPolling();
    try {
      await resolveVeilRootRuntime().cancelMatchmaking(this.remoteUrl, this.playerId, {
        getDisplayName: () => this.displayName || this.playerId,
        getAuthToken: () => this.authToken
      });
    } catch {
      // Keep the timeout surfaced locally even if remote dequeue fails.
    }
    this.updateMatchmakingStatus({ status: "idle" }, "匹配超时，请稍后重试。");
    this.renderView();
  }

  async enterMatchedRoom(status: Extract<MatchmakingStatusResponse, { status: "matched" }>): Promise<void> {
    this.matchmakingJoinInFlight = true;
    this.stopMatchmakingPolling();
    this.lobbyStatus = `匹配成功，正在进入房间 ${status.roomId}...`;
    this.renderView();

    try {
      this.roomId = status.roomId;
      this.seed = status.seedOverride;
      this.resetSessionViewport(`正在进入匹配房间 ${status.roomId} ...`);
      this.showLobby = false;
      this.syncBrowserRoomQuery(status.roomId);
      this.syncWechatShareBridge();
      await this.connect();
      if (!this.session && !this.lastUpdate) {
        throw new Error("enter_room_failed");
      }
      this.updateMatchmakingStatus({ status: "idle" }, `已进入匹配房间 ${status.roomId}。`);
    } catch (error) {
      this.showLobby = true;
      this.updateMatchmakingStatus({ status: "idle" }, this.describeMatchmakingError(error));
    } finally {
      this.matchmakingJoinInFlight = false;
      this.renderView();
    }
  }

  describeMatchmakingStatus(status: MatchmakingStatusResponse): string {
    const view = buildMatchmakingStatusView(status);
    if (status.status === "queued") {
      return `${view.statusLabel} ${view.queuePositionLabel}，${view.waitEstimateLabel}`;
    }
    if (status.status === "matched") {
      return view.matchedLabel ? `${view.statusLabel} · ${view.matchedLabel}` : view.statusLabel;
    }
    return view.statusLabel;
  }

  describeMatchmakingError(error: unknown): string {
    if (error instanceof Error && error.message === "cocos_request_failed:401") {
      return "匹配会话已失效，请重新登录后再试。";
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "matchmaking_failed";
  }
}

export const veilRootLobbyMatchmakingMethods = VeilRootLobbyMatchmakingMethods.prototype;
