// @ts-nocheck

import {
  applySettingsUpdate,
  bindCocosRuntimeMemoryWarning,
  buildCocosWechatSharePayload,
  clearStoredCocosAuthSession,
  createPrimaryClientTelemetryEvent,
  evaluateClientPerfTelemetry,
  formatCocosRuntimeMemoryStatus,
  getPlaceholderSpriteAssetUsageSummary,
  readCocosRuntimeLaunchSearch,
  readCocosRuntimeMemorySnapshot,
  readClientPerfRuntimeMetadata,
  readPersistedCocosSettings,
  recordClientPerfFrame,
  requestCocosWechatSubscribeConsent,
  resolveCocosPrivacyPolicyUrl,
  resolveCocosLoginProviders,
  resolveCocosLoginRuntimeConfig,
  resolveCocosRuntimeCapabilities,
  detectCocosRuntimePlatform,
  shareBattleResultForRuntime,
  shouldOfferBattleResultShare,
  syncCocosWechatFriendCloudStorage,
  syncCocosWechatShareBridge,
  triggerCocosRuntimeGc,
  writePersistedCocosSettings,
  sys,
  type AssetLoadFailureEvent,
  type ClientAnalyticsContext,
  type ClientPerfRuntimeMetadata,
  type PrimaryClientTelemetryEvent,
  type RuntimeDiagnosticsConnectionStatus,
  type TutorialCampaignGuidance,
  type TutorialOverlayView,
  type TutorialProgressAction,
  type WechatSharePayload
} from "./deps.ts";
import { resolveVeilRootRuntime } from "./runtime.ts";
import {
  bindGlobalErrorBoundaryForRoot,
  buildTutorialOverlayViewForRoot,
  bumpLobbyAccountEpochForRoot,
  bumpSessionEpochForRoot,
  completeTutorialAndFocusCampaignForRoot,
  createClientAnalyticsContextForRoot,
  createSessionOptionsForRoot,
  createTelemetryContextForRoot,
  describeSessionErrorForRoot,
  disposeCurrentSessionForRoot,
  emitPrimaryClientTelemetryForRoot,
  ensureAnalyticsSessionIdForRoot,
  handleAssetLoadFailureForRoot,
  handleForcedUpgradeForRoot,
  hydrateLaunchIdentityForRoot,
  isActiveLobbyAccountEpochForRoot,
  isActiveSessionEpochForRoot,
  maybeEmitExperimentExposureAnalyticsForRoot,
  maybeEmitQuestCompleteAnalyticsForRoot,
  maybeEmitShopOpenAnalyticsForRoot,
  maybeReportSessionRuntimeErrorForRoot,
  reportClientRuntimeErrorForRoot,
  resetSessionViewportForRoot,
  resolveTutorialCampaignGuidanceForRoot,
  resolveTutorialGuidanceMissionForRoot,
  skipTutorialFlowForRoot,
  submitTutorialProgressForRoot,
  advanceTutorialFlowForRoot,
  handleTutorialPrimaryActionForRoot,
  trackAssetLoadFailureAnalyticsForRoot,
  trackClientAnalyticsEventForRoot,
  trackPurchaseInitiatedForRoot
} from "./index.ts";

class VeilRootRuntimeIntegrationMethods {
  [key: string]: any;
  pushLog(line: string): void {
    this.logLines.unshift(line);
    this.logLines = this.logLines.slice(0, 8);
  }

  emitPrimaryClientTelemetry(event: PrimaryClientTelemetryEvent | PrimaryClientTelemetryEvent[] | null): void {
    emitPrimaryClientTelemetryForRoot(this as unknown as Record<string, any>, event);
  }

  ensureAnalyticsSessionId(): string {
    return ensureAnalyticsSessionIdForRoot(this as unknown as Record<string, any>);
  }

  createClientAnalyticsContext(roomId = this.roomId): ClientAnalyticsContext {
    return createClientAnalyticsContextForRoot(this as unknown as Record<string, any>, roomId);
  }

  trackClientAnalyticsEvent<Name extends
    | "session_start"
    | "battle_start"
    | "battle_end"
    | "mission_started"
    | "quest_complete"
    | "tutorial_step"
    | "experiment_exposure"
    | "shop_open"
    | "purchase_initiated"
    | "purchase_attempt"
    | "asset_load_failed"
    | "client_perf_degraded"
    | "client_runtime_error"
  >(
    name: Name,
    payload: Record<string, unknown>,
    roomId = this.roomId
  ): void {
    trackClientAnalyticsEventForRoot(this as unknown as Record<string, any>, name, payload, roomId);
  }

  trackAssetLoadFailureAnalytics(event: AssetLoadFailureEvent): void {
    trackAssetLoadFailureAnalyticsForRoot(this as unknown as Record<string, any>, event);
  }

  handleAssetLoadFailure(event: AssetLoadFailureEvent): void {
    handleAssetLoadFailureForRoot(this as unknown as Record<string, any>, event);
  }

  reportClientRuntimeError(input: {
    errorCode: StructuredErrorCode | "session_disconnect" | "client_error_boundary_triggered";
    severity: "error" | "fatal";
    stage: string;
    recoverable: boolean;
    message: string;
    detail?: string;
    roomId?: string | null;
  }): void {
    reportClientRuntimeErrorForRoot(this as unknown as Record<string, any>, input);
  }

  maybeReportSessionRuntimeError(error: unknown, stage: string): void {
    maybeReportSessionRuntimeErrorForRoot(this as unknown as Record<string, any>, error, stage);
  }

  bindGlobalErrorBoundary(): (() => void) | null {
    return bindGlobalErrorBoundaryForRoot(this as unknown as Record<string, any>);
  }

  createTelemetryContext(heroId?: string | null): { roomId: string; playerId: string; heroId?: string } {
    return createTelemetryContextForRoot(this as unknown as Record<string, any>, heroId);
  }

  maybeEmitShopOpenAnalytics(): void {
    maybeEmitShopOpenAnalyticsForRoot(this as unknown as Record<string, any>);
  }

  maybeEmitExperimentExposureAnalytics(profile: CocosPlayerAccountProfile): void {
    maybeEmitExperimentExposureAnalyticsForRoot(this as unknown as Record<string, any>, profile);
  }

  maybeEmitQuestCompleteAnalytics(previousProfile: CocosPlayerAccountProfile, profile: CocosPlayerAccountProfile): void {
    maybeEmitQuestCompleteAnalyticsForRoot(this as unknown as Record<string, any>, previousProfile, profile);
  }

  trackPurchaseInitiated(product: ShopProduct, surface: "lobby" | "battle_pass"): void {
    trackPurchaseInitiatedForRoot(this as unknown as Record<string, any>, product, surface);
  }

  async disposeCurrentSession(): Promise<void> {
    await disposeCurrentSessionForRoot(this as unknown as Record<string, any>);
  }

  resetSessionViewport(logLine: string): void {
    resetSessionViewportForRoot(this as unknown as Record<string, any>, logLine);
  }

  async handleForcedUpgrade(failureMessage: string): Promise<void> {
    await handleForcedUpgradeForRoot(this as unknown as Record<string, any>, failureMessage);
  }

  describeSessionError(error: unknown, fallback: string): string {
    return describeSessionErrorForRoot(error, fallback);
  }

  bumpSessionEpoch(): number {
    return bumpSessionEpochForRoot(this as unknown as Record<string, any>);
  }

  bumpLobbyAccountEpoch(): number {
    return bumpLobbyAccountEpochForRoot(this as unknown as Record<string, any>);
  }

  isActiveSessionEpoch(epoch: number): boolean {
    return isActiveSessionEpochForRoot(this as unknown as Record<string, any>, epoch);
  }

  isActiveLobbyAccountEpoch(epoch: number): boolean {
    return isActiveLobbyAccountEpochForRoot(this as unknown as Record<string, any>, epoch);
  }

  createSessionOptions(epoch: number): VeilCocosSessionOptions {
    return createSessionOptionsForRoot(this as unknown as Record<string, any>, epoch);
  }

  hydrateRuntimePlatform(): void {
    this.runtimePlatform = detectCocosRuntimePlatform(globalThis as {
      location?: Location;
      history?: History;
      wx?: {
        getLaunchOptionsSync?: () => { query?: Record<string, unknown> | null } | null | undefined;
        login?: ((options: unknown) => void) | undefined;
      };
    });
    this.runtimeCapabilities = resolveCocosRuntimeCapabilities(this.runtimePlatform);
    this.loginRuntimeConfig = resolveCocosLoginRuntimeConfig(globalThis as never);
    this.loginProviders = resolveCocosLoginProviders({
      platform: this.runtimePlatform,
      capabilities: this.runtimeCapabilities,
      config: this.loginRuntimeConfig,
      wx: (globalThis as { wx?: { login?: ((options: unknown) => void) | undefined } }).wx ?? null
    });
     if (this.runtimePlatform === "wechat-game") {
      this.pushLog("已识别微信小游戏运行时，启动参数将改读 wx.getLaunchOptionsSync().query。");
      const wechatProvider = this.loginProviders.find((provider) => provider.id === "wechat-mini-game");
      if (wechatProvider) {
        this.pushLog(`小游戏登录状态：${wechatProvider.message}`);
      }
    }
  }

  hydrateClientPerfRuntimeMetadata(): void {
    this.clientPerfRuntimeMetadata = readClientPerfRuntimeMetadata(globalThis as {
      wx?: {
        getSystemInfoSync?: (() => { model?: unknown; version?: unknown } | null | undefined) | undefined;
      } | null;
    });
  }

  bindRuntimeMemoryWarnings(): void {
    this.stopRuntimeMemoryWarnings?.();
    this.stopRuntimeMemoryWarnings = bindCocosRuntimeMemoryWarning((event) => {
      const gcTriggered = triggerCocosRuntimeGc();
      this.runtimeMemoryNotice =
        event.level != null
          ? `收到内存告警 L${event.level}${gcTriggered ? "，已请求 GC" : ""}`
          : `收到内存告警${gcTriggered ? "，已请求 GC" : ""}`;
      this.pushLog(this.runtimeMemoryNotice);
      this.renderView();
    });
  }

  describeRuntimeMemoryHealth(): string {
    const snapshot = readCocosRuntimeMemorySnapshot();
    const summary = formatCocosRuntimeMemoryStatus(snapshot, getPlaceholderSpriteAssetUsageSummary());
    return this.runtimeMemoryNotice ? `${summary} · ${this.runtimeMemoryNotice}` : summary;
  }

  trackClientPerfTelemetry(deltaTime: number): void {
    const nowMs = Date.now();
    recordClientPerfFrame(this.clientPerfTelemetry, deltaTime, nowMs);
     const memorySnapshot = readCocosRuntimeMemorySnapshot();
    const memoryUsageRatio =
      memorySnapshot.heapUsedBytes != null && memorySnapshot.heapLimitBytes != null && memorySnapshot.heapLimitBytes > 0
        ? memorySnapshot.heapUsedBytes / memorySnapshot.heapLimitBytes
        : memorySnapshot.heapUsedBytes != null && memorySnapshot.heapTotalBytes != null && memorySnapshot.heapTotalBytes > 0
          ? memorySnapshot.heapUsedBytes / memorySnapshot.heapTotalBytes
          : null;
     const payload = evaluateClientPerfTelemetry(this.clientPerfTelemetry, {
      nowMs,
      memoryUsageRatio,
      metadata: this.clientPerfRuntimeMetadata
    });
    if (!payload) {
      return;
    }
     this.trackClientAnalyticsEvent("client_perf_degraded", payload);
  }

  hydrateLaunchIdentity(): void {
    hydrateLaunchIdentityForRoot(this as unknown as Record<string, any>);
  }

  latestShareableBattleReplay() {
    const replay = this.lobbyAccountProfile?.recentBattleReplays?.[0] ?? null;
    if (!shouldOfferBattleResultShare(replay)) {
      return null;
    }
    if (!this.lastBattleSettlementSnapshot || this.lastBattleSettlementSnapshot.tone !== "victory") {
      return null;
    }
    return replay;
  }

  canShareLatestBattleResult(): boolean {
    return Boolean(this.latestShareableBattleReplay());
  }

  async handleBattleResultShare(): Promise<void> {
    const replay = this.latestShareableBattleReplay();
    if (!replay) {
      this.predictionStatus = "当前没有可分享的 PVP 胜利战报。";
      this.renderView();
      return;
    }
     const wxRuntime = (globalThis as {
      wx?: {
        shareAppMessage?: (sharePayload: WechatSharePayload) => void;
      } | null;
    }).wx;
    const shareResult = await shareBattleResultForRuntime(replay, this.displayName || this.playerId, {
      runtimePlatform: this.runtimePlatform,
      ...(wxRuntime !== undefined ? { wechatRuntime: wxRuntime } : {})
    });
    this.predictionStatus = shareResult.message;
    this.renderView();
  }

  async maybeClaimLaunchReferral(authSession: {
    playerId: string;
    displayName: string;
    authMode: "guest" | "account";
    provider?: string;
    loginId?: string;
    token?: string;
    source: "remote" | "local";
  }): Promise<void> {
    const referrerId = this.launchReferrerId?.trim() ?? "";
    if (!referrerId || authSession.source !== "remote" || !authSession.token) {
      return;
    }
     const claimKey = `${referrerId}:${authSession.playerId}`;
    if (this.lastReferralClaimKey === claimKey) {
      return;
    }
     try {
      const result = await resolveVeilRootRuntime().postPlayerReferral(
        this.remoteUrl,
        { referrerId },
        {
          storage: this.readWebStorage(),
          authSession: {
            token: authSession.token,
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            authMode: authSession.authMode,
            ...(authSession.provider ? { provider: authSession.provider as never } : {}),
            ...(authSession.loginId ? { loginId: authSession.loginId } : {}),
            source: "remote"
          }
        }
      );
      this.lastReferralClaimKey = claimKey;
      if (result.claimed) {
        this.pushLog(`已完成推荐奖励绑定：邀请人 ${referrerId} 与新玩家 ${authSession.playerId} 各获得 20 宝石。`);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "cocos_request_failed:409:referral_already_claimed") {
        this.lastReferralClaimKey = claimKey;
        return;
      }
      throw error;
    }
  }

  readLaunchSearch(): string {
    return readCocosRuntimeLaunchSearch(globalThis as {
      location?: Pick<Location, "search"> | null;
      wx?: { getLaunchOptionsSync?: () => { query?: Record<string, unknown> | null } | null | undefined };
    });
  }

  describeLobbyShareHint(): string {
    return `分享：${this.wechatShareStatus}`;
  }

  hydrateSettings(): void {
    const wxRuntime = (globalThis as { wx?: unknown }).wx as { getStorageSync?: (key: string) => unknown } | null | undefined;
    const persisted = readPersistedCocosSettings({
      localStorage: this.readWebStorage(),
      ...(wxRuntime ? { wx: wxRuntime } : {})
    });
    this.settingsView = applySettingsUpdate(this.settingsView, {
      ...persisted,
      privacyPolicyUrl: resolveCocosPrivacyPolicyUrl(globalThis.location)
    });
    this.applyRuntimeSettings();
  }

  applyRuntimeSettings(): void {
    this.audioRuntime.setBgmVolume(this.settingsView.bgmVolume);
    this.audioRuntime.setSfxVolume(this.settingsView.sfxVolume);
    const gameRuntime = (globalThis as {
      game?: {
        frameRate?: number;
        setFrameRate?: (value: number) => void;
      };
    }).game;
    if (typeof gameRuntime?.setFrameRate === "function") {
      gameRuntime.setFrameRate(this.settingsView.frameRateCap);
    } else {
      const fallbackRuntime = (gameRuntime ?? (globalThis as { frameRate?: number })) as { frameRate?: number };
      fallbackRuntime.frameRate = this.settingsView.frameRateCap;
    }
  }

  persistSettings(): void {
    const wxRuntime = (globalThis as { wx?: unknown }).wx as { setStorageSync?: (key: string, value: string) => void } | null | undefined;
    writePersistedCocosSettings(
      {
        bgmVolume: this.settingsView.bgmVolume,
        sfxVolume: this.settingsView.sfxVolume,
        frameRateCap: this.settingsView.frameRateCap
      },
      {
        localStorage: this.readWebStorage(),
        ...(wxRuntime ? { wx: wxRuntime } : {})
      }
    );
  }

  buildTutorialOverlayView(): TutorialOverlayView | null {
    return buildTutorialOverlayViewForRoot(this as unknown as Record<string, any>);
  }

  resolveTutorialCampaignGuidance(): TutorialCampaignGuidance {
    return resolveTutorialCampaignGuidanceForRoot(this as unknown as Record<string, any>);
  }

  resolveTutorialGuidanceMission(): NonNullable<CocosCampaignSummary["missions"]>[number] | null {
    return resolveTutorialGuidanceMissionForRoot(this as unknown as Record<string, any>);
  }

  async submitTutorialProgress(action: TutorialProgressAction): Promise<void> {
    await submitTutorialProgressForRoot(this as unknown as Record<string, any>, action);
  }

  async advanceTutorialFlow(): Promise<void> {
    await advanceTutorialFlowForRoot(this as unknown as Record<string, any>);
  }

  async handleTutorialPrimaryAction(): Promise<void> {
    await handleTutorialPrimaryActionForRoot(this as unknown as Record<string, any>);
  }

  async completeTutorialAndFocusCampaign(): Promise<void> {
    await completeTutorialAndFocusCampaignForRoot(this as unknown as Record<string, any>);
  }

  async skipTutorialFlow(): Promise<void> {
    await skipTutorialFlowForRoot(this as unknown as Record<string, any>);
  }

  syncWechatShareBridge(immediate = false) {
    const payload = buildCocosWechatSharePayload({
      roomId: this.roomId,
      inviterPlayerId: this.playerId,
      displayName: this.displayName || this.playerId,
      scene: this.showLobby ? "lobby" : this.lastUpdate?.battle ? "battle" : "world",
      day: this.lastUpdate?.world.meta.day ?? null,
      battleLabel: this.lastUpdate?.battle ? "当前战斗" : null
    });
     if (this.runtimePlatform !== "wechat-game") {
      this.wechatShareAvailable = false;
      this.wechatShareStatus = "分享功能仅在微信小游戏可用。";
      return {
        available: false,
        menuEnabled: false,
        handlerRegistered: false,
        canShareDirectly: false,
        immediateShared: false,
        payload,
        message: this.wechatShareStatus
      };
    }
     const result = syncCocosWechatShareBridge(
      (globalThis as { wx?: CocosWechatShareRuntimeLike | null }).wx ?? null,
      payload,
      immediate ? { immediate: true } : undefined
    );
    this.wechatShareAvailable = result.available;
    this.wechatShareStatus = result.message;
    return result;
  }

  readWebStorage(): Storage | null {
    const webStorage = (sys as unknown as { localStorage?: Storage }).localStorage;
    return webStorage ?? null;
  }

  syncBrowserRoomQuery(roomId: string | null): void {
    if (!this.runtimeCapabilities.supportsBrowserHistory) {
      return;
    }
     const historyRef = globalThis.history;
    const locationRef = globalThis.location;
    if (!historyRef?.replaceState || !locationRef?.href) {
      return;
    }
     const nextUrl = new URL(locationRef.href);
    if (roomId?.trim()) {
      nextUrl.searchParams.set("roomId", roomId.trim());
      nextUrl.searchParams.delete("playerId");
      nextUrl.searchParams.delete("displayName");
    } else {
      nextUrl.search = "";
    }
     historyRef.replaceState(null, "", nextUrl.toString());
  }
}

export const veilRootRuntimeIntegrationMethods = VeilRootRuntimeIntegrationMethods.prototype;
