// @ts-nocheck

import {
  applySettingsUpdate,
  buildCocosAccountLifecyclePanelView,
  buildCocosAccountRegistrationPanelView,
  clearStoredCocosAuthSession,
  confirmCocosAccountRegistration,
  confirmCocosPasswordRecovery,
  createCocosWechatPaymentOrder,
  createFallbackCocosPlayerAccountProfile,
  deleteCurrentCocosPlayerAccount,
  describeAccountAuthFailure,
  loginCocosWechatAuthSession,
  loginWithCocosProvider,
  logoutCurrentCocosAuthSession,
  readPreferredCocosDisplayName,
  rememberPreferredCocosDisplayName,
  requestCocosAccountRegistration,
  requestCocosPasswordRecovery,
  requestCocosWechatSubscribeConsent,
  saveCocosLobbyPreferences,
  syncCurrentCocosAuthSession,
  validateAccountLifecycleConfirm,
  validateAccountLifecycleRequest,
  validateAccountPassword,
  validatePrivacyConsentAccepted,
  verifyCocosWechatPayment,
  type CocosAccountLifecycleDraft,
  type CocosAccountLifecycleKind,
  type CocosAccountLifecyclePanelView,
  type CocosAccountRegistrationPanelView,
  type CocosLoginProviderDescriptor,
  type CocosSettingsPanelUpdate
} from "./deps.ts";
import { resolveVeilRootRuntime } from "./runtime.ts";

class VeilRootAccountSettingsMethods {
  [key: string]: any;
  async loginLobbyAccount(): Promise<void> {
    if (this.lobbyEntering) {
      return;
    }
     const primaryProvider = this.primaryLoginProvider();
    if (!primaryProvider.available) {
      this.lobbyStatus = primaryProvider.message;
      this.renderView();
      return;
    }
     if (primaryProvider.id === "wechat-mini-game") {
      await this.loginLobbyWechatMiniGame();
      return;
    }
     const promptRef = globalThis.prompt;
    if (typeof promptRef !== "function") {
      this.lobbyStatus = "当前运行环境不支持弹出式输入，请先在浏览器调试壳完成账号登录，或复用已缓存会话。";
      this.renderView();
      return;
    }
     const nextLoginId = promptRef("输入登录 ID", this.loginId || "")?.trim();
    if (nextLoginId === undefined) {
      return;
    }
    const loginIdError = validateAccountLifecycleRequest("registration", nextLoginId);
    if (loginIdError) {
      this.lobbyStatus = loginIdError.message;
      this.renderView();
      return;
    }
     const password = promptRef("输入账号口令", "");
    if (password == null) {
      return;
    }
    const passwordError = validateAccountPassword(password, "password", "账号口令");
    if (passwordError) {
      this.lobbyStatus = passwordError.message;
      this.renderView();
      return;
    }
     if (!this.ensurePrivacyConsentAccepted()) {
      return;
    }
    await this.submitLobbyAccountLoginCredentials(nextLoginId, password);
  }

  async submitLobbyAccountLoginCredentials(loginIdDraft: string, passwordDraft: string): Promise<void> {
    const loginId = loginIdDraft.trim().toLowerCase();
    const loginIdError = validateAccountLifecycleRequest("registration", loginId);
    if (loginIdError) {
      this.lobbyStatus = loginIdError.message;
      this.renderView();
      return;
    }
    const password = passwordDraft.trim();
    const passwordError = validateAccountPassword(password, "password", "账号口令");
    if (passwordError) {
      this.lobbyStatus = passwordError.message;
      this.renderView();
      return;
    }
    if (!this.ensurePrivacyConsentAccepted()) {
      return;
    }

    const storage = this.readWebStorage();
    this.lobbyEntering = true;
    this.lobbyStatus = `正在使用账号 ${loginId} 登录并进入房间 ${this.roomId}...`;
    this.renderView();
    try {
      const authSession = await loginWithCocosProvider(
        this.remoteUrl,
        {
          provider: "account-password",
          loginId,
          password
        },
        {
          storage,
          privacyConsentAccepted: this.privacyConsentAccepted
        }
      );
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "account-password";
      this.loginId = authSession.loginId ?? loginId;
      this.sessionSource = authSession.source;
      this.syncWechatShareBridge();
      this.lobbyStatus = `账号 ${this.loginId} 登录成功，正在同步全局仓库并进入房间 ${this.roomId}...`;
      saveCocosLobbyPreferences(authSession.playerId, this.roomId, undefined, storage);
      this.renderView();
      await this.refreshLobbyAccountProfile();
      this.lobbyEntering = false;
      await this.enterLobbyRoom(this.roomId);
    } catch (error) {
      this.lobbyEntering = false;
      this.lobbyStatus = this.describeCocosAccountFlowError(error, "account_login_failed");
      this.renderView();
    }
  }

  parseCocosRequestFailure(error: unknown): { status: number; code: string } | null {
    if (!(error instanceof Error)) {
      return null;
    }
     const matched = /^cocos_request_failed:(\d+):(.+)$/.exec(error.message);
    if (!matched) {
      return null;
    }
     return {
      status: Number(matched[1]),
      code: matched[2] ?? "unknown"
    };
  }

  describeCocosAccountFlowError(
    error: unknown,
    fallback: string,
    options: {
      invalidTokenCode?: string;
    } = {}
  ): string {
    const failure = this.parseCocosRequestFailure(error);
    if (!failure) {
      return error instanceof Error ? error.message : fallback;
    }
     const message = describeAccountAuthFailure(failure, options);
    if (message) {
      return message;
    }
     return error instanceof Error ? error.message : fallback;
  }

  ensurePrivacyConsentAccepted(): boolean {
    const privacyConsentError = validatePrivacyConsentAccepted(this.privacyConsentAccepted);
    if (!privacyConsentError) {
      return true;
    }
     this.lobbyStatus = privacyConsentError.message;
    this.renderView();
    return false;
  }

  async registerLobbyAccount(): Promise<void> {
    this.openLobbyAccountFlow("registration");
  }

  async recoverLobbyAccountPassword(): Promise<void> {
    this.openLobbyAccountFlow("recovery");
  }

  async loginLobbyWechatMiniGame(): Promise<void> {
    if (!this.ensurePrivacyConsentAccepted()) {
      return;
    }
     const storage = this.readWebStorage();
    this.lobbyEntering = true;
    this.lobbyStatus = "正在调用 wx.login() 并交换小游戏会话...";
    this.renderView();
     try {
      const authSession = await loginCocosWechatAuthSession(this.remoteUrl, this.playerId, this.displayName || this.playerId, {
        storage,
        wx: (globalThis as { wx?: { login?: ((options: unknown) => void) | undefined } }).wx ?? null,
        exchangePath: this.loginRuntimeConfig.wechatMiniGame.exchangePath,
        ...(this.loginRuntimeConfig.wechatMiniGame.mockCode ? { mockCode: this.loginRuntimeConfig.wechatMiniGame.mockCode } : {}),
        ...(this.authToken ? { authToken: this.authToken } : {}),
        ...(this.privacyConsentAccepted ? { privacyConsentAccepted: true } : {}),
        ...(this.activeAccountFlow === "registration" && this.wechatMinorProtectionSelection !== "unknown"
          ? { minorProtection: { isAdult: this.wechatMinorProtectionSelection === "adult" } }
          : {})
      });
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "wechat-mini-game";
      this.loginId = authSession.loginId ?? "";
      this.sessionSource = authSession.source;
      if (this.activeAccountFlow === "registration") {
        this.activeAccountFlow = null;
        this.wechatMinorProtectionSelection = "unknown";
      }
      this.syncWechatShareBridge();
      this.lobbyStatus = "微信小游戏登录已连通，正在同步会话并进入房间...";
      saveCocosLobbyPreferences(authSession.playerId, this.roomId, undefined, storage);
      this.renderView();
      await this.refreshLobbyAccountProfile();
      this.lobbyEntering = false;
      await this.enterLobbyRoom(this.roomId);
    } catch (error) {
      this.lobbyEntering = false;
      this.lobbyStatus =
        error instanceof Error && error.message === "wechat_login_unavailable"
          ? "当前小游戏壳未暴露 wx.login()，且也未配置 mock code。"
          : error instanceof Error && error.message === "cocos_request_failed:501"
            ? "服务端已预留小游戏登录交换接口，但当前未启用。"
            : error instanceof Error && error.message === "cocos_request_failed:401"
              ? "小游戏登录 code 校验失败，请刷新后重试。"
              : error instanceof Error
                ? error.message
                : "wechat_login_failed";
      this.renderView();
    }
  }

  primaryLoginProvider(): CocosLoginProviderDescriptor {
    return (
      this.loginProviders.find((provider) => provider.id === "wechat-mini-game" && provider.available) ??
      this.loginProviders.find((provider) => provider.id === "account-password") ?? {
        id: "account-password",
        label: this.authMode === "account" ? "账号进入" : "账号登录并进入",
        available: true,
        message: ""
      }
    );
  }

  describeLobbyLoginHint(): string {
    const primaryProvider = this.primaryLoginProvider();
    if (primaryProvider.id === "wechat-mini-game") {
      return this.authProvider === "wechat-mini-game" ? "当前已使用小游戏登录脚手架会话" : primaryProvider.message;
    }
     return this.authMode === "account" ? "当前已处于正式账号模式" : "H5 绑定后的登录 ID 可以在这里直接进入";
  }

  async returnToLobby(): Promise<void> {
    if (this.showLobby) {
      return;
    }
     const storage = this.readWebStorage();
    saveCocosLobbyPreferences(this.playerId, this.roomId, undefined, storage);
    this.displayName = rememberPreferredCocosDisplayName(this.playerId, this.displayName || this.playerId, storage);
    this.stopMatchmakingPolling();
    this.updateMatchmakingStatus({ status: "idle" });
    await this.disposeCurrentSession();
    this.resetSessionViewport("已返回 Cocos Lobby。");
    this.gameplayAccountReviewPanelOpen = false;
    this.gameplayBattlePassPanelOpen = false;
    this.gameplayDailyDungeonPanelOpen = false;
    this.gameplaySeasonalEventPanelOpen = false;
    this.gameplayEquipmentPanelOpen = false;
    this.gameplayCampaignPanelOpen = false;
    this.gameplayCampaign = null;
    this.gameplayCampaignSelectedMissionId = null;
    this.gameplayCampaignActiveMissionId = null;
    this.gameplayCampaignDialogue = null;
    this.gameplayCampaignPendingAction = null;
    this.gameplayCampaignStatus = "战役面板待同步。";
    this.seasonProgress = null;
    this.showLobby = true;
    this.syncWechatShareBridge();
    this.lobbyStatus = "已返回大厅，可继续选房或创建新实例。";
    this.syncBrowserRoomQuery(null);
    this.renderView();
    await this.syncLobbyBootstrap();
  }

  toggleSettingsPanel(open = !this.settingsView.open): void {
    this.settingsView = applySettingsUpdate(this.settingsView, {
      open,
      deleteAccountPending: false,
      withdrawConsentPending: false,
      statusMessage: open ? null : this.settingsView.statusMessage
    });
    this.renderView();
  }

  updateSettings(update: CocosSettingsPanelUpdate): void {
    const resetPending = update.bgmVolume !== undefined || update.sfxVolume !== undefined || update.frameRateCap !== undefined;
    this.settingsView = applySettingsUpdate(this.settingsView, {
      ...update,
      ...(resetPending ? { deleteAccountPending: false, withdrawConsentPending: false } : {})
    });
    this.persistSettings();
    this.applyRuntimeSettings();
    this.renderView();
  }

  openSettingsPrivacyPolicy(): void {
    const wxRuntime = (globalThis as {
      wx?: {
        openPrivacyContract?: (options?: { success?: () => void; fail?: (error?: unknown) => void }) => void;
      } | null;
    }).wx;
    if (wxRuntime?.openPrivacyContract) {
      wxRuntime.openPrivacyContract({
        success: () => {
          this.updateSettings({ statusMessage: "已打开微信隐私说明。" });
        },
        fail: () => {
          this.updateSettings({ statusMessage: `隐私说明入口 ${this.settingsView.privacyPolicyUrl}` });
        }
      });
      return;
    }
     const open = (globalThis as { open?: (url: string, target?: string) => void }).open;
    if (typeof open === "function") {
      open(this.settingsView.privacyPolicyUrl, "_blank");
      this.updateSettings({ statusMessage: `已打开隐私说明 ${this.settingsView.privacyPolicyUrl}` });
      return;
    }
     this.updateSettings({ statusMessage: `隐私说明 ${this.settingsView.privacyPolicyUrl}` });
  }

  async handleSettingsLogout(): Promise<void> {
    this.updateSettings({ statusMessage: "正在退出当前会话..." });
    await this.logoutAuthSession();
    this.settingsView = applySettingsUpdate(this.settingsView, {
      open: false,
      deleteAccountPending: false,
      withdrawConsentPending: false,
      statusMessage: "已退出当前会话。"
    });
    this.renderView();
  }

  async handleSettingsDeleteAccount(): Promise<void> {
    if (!this.settingsView.deleteAccountPending) {
      this.updateSettings({
        deleteAccountPending: true,
        withdrawConsentPending: false,
        statusMessage: "再次点击“删除账号”确认删除当前账号。"
      });
      return;
    }
     this.updateSettings({
      statusMessage: "正在删除当前账号并撤销会话...",
      deleteAccountPending: false
    });
     await this.deleteCurrentPlayerAccount();
  }

  async handleSettingsWithdrawConsent(): Promise<void> {
    if (!this.settingsView.withdrawConsentPending) {
      this.updateSettings({
        withdrawConsentPending: true,
        deleteAccountPending: false,
        statusMessage: "再次点击“撤回同意”以清除本地同意状态并退出当前会话。"
      });
      return;
    }
     this.privacyConsentAccepted = false;
    this.updateSettings({
      withdrawConsentPending: false,
      statusMessage: "已撤回本地隐私同意，正在退出当前会话..."
    });
    await this.logoutAuthSession();
    this.settingsView = applySettingsUpdate(this.settingsView, {
      open: false,
      statusMessage: "已撤回本地隐私同意；下次进入前请重新确认隐私说明。"
    });
    this.renderView();
  }

  buildSupportTicketDraft(category: "bug" | "payment" | "account"): string {
    const headline =
      category === "bug"
        ? "Cocos 客户端 BUG 反馈"
        : category === "payment"
          ? "支付与商品问题反馈"
          : "账号与客服问题反馈";
    const lines = [
      headline,
      `玩家：${this.displayName || this.playerId}`,
      `玩家 ID：${this.playerId}`,
      `登录方式：${this.authMode === "account" ? this.loginId || "account" : this.authMode}`,
      `房间：${this.roomId}`,
      `客户端：Cocos`,
      "问题描述："
    ];
    return lines.join("\n");
  }

  async handleSettingsSupportTicket(category: "bug" | "payment" | "account"): Promise<void> {
    const authSession = this.currentLobbyAuthSession();
    if (!authSession?.token) {
      this.updateSettings({ statusMessage: "客服工单需要先登录云端账号或游客会话。" });
      return;
    }
     this.supportTicketSubmittingCategory = category;
    this.updateSettings({
      supportSubmittingCategory: category,
      statusMessage: "正在提交客服工单..."
    });
     try {
      const result = await resolveVeilRootRuntime().submitSupportTicket(
        this.remoteUrl,
        {
          category,
          message: this.buildSupportTicketDraft(category),
          priority: category === "payment" ? "high" : "normal"
        },
        {
          authSession,
          storage: this.readWebStorage()
        }
      );
      const successMessage = `客服工单已提交：${result.ticket.ticketId}`;
      this.lobbyStatus = successMessage;
      this.updateSettings({ statusMessage: successMessage });
    } catch (error) {
      this.updateSettings({
        statusMessage: error instanceof Error ? error.message : "客服工单提交失败。"
      });
    } finally {
      this.supportTicketSubmittingCategory = null;
      this.settingsView = applySettingsUpdate(this.settingsView, {
        supportSubmittingCategory: null
      });
      this.renderView();
    }
  }

  async logoutAuthSession(): Promise<void> {
    this.stopMatchmakingPolling();
    this.updateMatchmakingStatus({ status: "idle" });
    await resolveVeilRootRuntime().logoutAuthSession(this.remoteUrl, {
      storage: this.readWebStorage()
    });
    this.authToken = null;
    this.authMode = "guest";
    this.authProvider = "guest";
    this.loginId = "";
    this.sessionSource = "none";
    this.displayName = readPreferredCocosDisplayName(this.playerId, this.readWebStorage());
    this.commitAccountProfile(createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName), false);
    this.syncWechatShareBridge();
    this.lobbyStatus = "已退出当前会话，请重新选择游客身份或使用正式账号进入。";
    this.renderView();
  }

  async deleteCurrentPlayerAccount(): Promise<void> {
    this.stopMatchmakingPolling();
    this.updateMatchmakingStatus({ status: "idle" });
    await resolveVeilRootRuntime().deletePlayerAccount(this.remoteUrl, {
      storage: this.readWebStorage()
    });
    this.authToken = null;
    this.authMode = "guest";
    this.authProvider = "guest";
    this.loginId = "";
    this.sessionSource = "none";
    this.privacyConsentAccepted = false;
    this.displayName = readPreferredCocosDisplayName(this.playerId, this.readWebStorage());
    this.commitAccountProfile(createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName), false);
    await this.disposeCurrentSession();
    this.resetSessionViewport("账号已删除。");
    this.showLobby = true;
    this.lobbyStatus = "账号已删除，原会话已撤销。请重新确认隐私说明后再创建新档。";
    this.syncBrowserRoomQuery(null);
    this.settingsView = applySettingsUpdate(this.settingsView, {
      open: false,
      deleteAccountPending: false,
      withdrawConsentPending: false,
      statusMessage: "账号已删除。"
    });
    this.renderView();
    await this.syncLobbyBootstrap();
  }

  buildActiveAccountFlowPanelView(): CocosAccountLifecyclePanelView | CocosAccountRegistrationPanelView | null {
    const draft = this.buildActiveAccountLifecycleDraft();
    if (!draft) {
      return null;
    }
     if (draft.kind === "registration") {
      const registrationDraft: CocosAccountLifecycleDraft & { kind: "registration" } = {
        ...draft,
        kind: "registration"
      };
      const wechatProvider = this.loginProviders.find((provider) => provider.id === "wechat-mini-game");
      const registeredAccount =
        this.authMode === "account" || Boolean(this.lobbyAccountProfile.credentialBoundAt)
          ? {
              ...(this.lobbyAccountProfile.loginId ?? this.loginId
                ? { loginId: this.lobbyAccountProfile.loginId ?? this.loginId }
                : {}),
              ...(this.lobbyAccountProfile.credentialBoundAt
                ? { credentialBoundAt: this.lobbyAccountProfile.credentialBoundAt }
                : {}),
              provider: this.authProvider
            }
          : null;
      return buildCocosAccountRegistrationPanelView({
        draft: registrationDraft,
        privacyConsentAccepted: this.privacyConsentAccepted,
        submitState: this.lobbyEntering
          ? this.activeAccountFlow === "registration" && this.authProvider === "wechat-mini-game"
            ? "binding-wechat"
            : this.registrationToken && this.registrationPassword
              ? "confirming-registration"
              : "requesting-token"
          : this.authMode === "account" && !this.activeAccountFlow
            ? "success"
            : "idle",
        statusMessage: this.lobbyStatus,
        showValidationErrors: false,
        ...(registeredAccount ? { registeredAccount } : {}),
        wechat: {
          supported: this.runtimePlatform === "wechat-game",
          available: wechatProvider?.available === true,
          bound: this.authProvider === "wechat-mini-game",
          minorProtectionSelection: this.wechatMinorProtectionSelection
        }
      });
    }
     return buildCocosAccountLifecyclePanelView(draft);
  }

  buildActiveAccountLifecycleDraft(): CocosAccountLifecycleDraft | null {
    if (!this.activeAccountFlow) {
      return null;
    }
     return this.activeAccountFlow === "registration"
      ? {
          kind: "registration",
          loginId: this.loginId,
          displayName: this.registrationDisplayName || this.displayName || this.loginId,
          token: this.registrationToken,
          password: this.registrationPassword,
          deliveryMode: this.registrationDeliveryMode,
          ...(this.registrationExpiresAt ? { expiresAt: this.registrationExpiresAt } : {})
        }
      : {
          kind: "recovery",
          loginId: this.loginId,
          displayName: "",
          token: this.recoveryToken,
          password: this.recoveryPassword,
          deliveryMode: this.recoveryDeliveryMode,
          ...(this.recoveryExpiresAt ? { expiresAt: this.recoveryExpiresAt } : {})
        };
  }

  openLobbyAccountFlow(kind: CocosAccountLifecycleKind): void {
    this.activeAccountFlow = kind;
    this.loginId = this.loginId.trim().toLowerCase();
    if (kind === "registration" && !this.registrationDisplayName.trim()) {
      this.registrationDisplayName = this.displayName || this.loginId;
      this.wechatMinorProtectionSelection = "unknown";
    }
    this.lobbyStatus =
      kind === "registration"
        ? "已打开正式注册面板。先申请注册令牌，再确认口令并进入房间。"
        : "已打开密码找回面板。先申请找回令牌，再确认新口令并进入房间。";
    this.renderView();
  }

  closeLobbyAccountFlow(): void {
    this.wechatMinorProtectionSelection = "unknown";
    this.activeAccountFlow = null;
    this.lobbyStatus = "已收起账号生命周期面板。";
    this.renderView();
  }

  toggleWechatMinorProtectionSelection(): void {
    if (this.activeAccountFlow !== "registration") {
      return;
    }
     this.wechatMinorProtectionSelection =
      this.wechatMinorProtectionSelection === "unknown"
        ? "adult"
        : this.wechatMinorProtectionSelection === "adult"
          ? "minor"
          : "adult";
    this.lobbyStatus =
      this.wechatMinorProtectionSelection === "adult"
        ? "已声明为成年人，绑定微信时将按成年人策略提交。"
        : "已声明为未成年人，绑定微信时将按未成年人策略提交。";
    this.renderView();
  }

  async bindWechatIdentityFromLobbyAccountFlow(): Promise<void> {
    if (this.activeAccountFlow !== "registration" || this.authMode !== "account") {
      this.lobbyStatus = "需先完成正式注册或登录正式账号，才能绑定微信身份。";
      this.renderView();
      return;
    }
     if (this.wechatMinorProtectionSelection === "unknown") {
      this.lobbyStatus = "绑定微信身份前，请先设置未成年人保护声明。";
      this.renderView();
      return;
    }
     await this.loginLobbyWechatMiniGame();
  }

  togglePrivacyConsent(): void {
    this.privacyConsentAccepted = !this.privacyConsentAccepted;
    this.lobbyStatus = this.privacyConsentAccepted ? "已同意隐私说明。" : "已取消隐私说明勾选。";
    this.renderView();
  }

  applyAccountFlowFieldDraft(field: "loginId" | "displayName" | "token" | "password", value: string): void {
    if (!this.activeAccountFlow) {
      return;
    }

    const nextValue = value.trim();
    if (field === "loginId") {
      this.loginId = nextValue.toLowerCase();
      this.lobbyStatus = this.loginId ? `已更新登录 ID 草稿为 ${this.loginId}。` : "已清空登录 ID 草稿。";
      this.renderView();
      return;
    }
    if (field === "displayName") {
      this.registrationDisplayName = nextValue;
      this.lobbyStatus = this.registrationDisplayName ? "已更新注册昵称草稿。" : "已清空注册昵称草稿。";
      this.renderView();
      return;
    }
    if (field === "token") {
      if (this.activeAccountFlow === "registration") {
        this.registrationToken = nextValue;
      } else {
        this.recoveryToken = nextValue;
      }
      this.lobbyStatus = nextValue ? "已更新令牌草稿。" : "已清空令牌草稿。";
      this.renderView();
      return;
    }

    if (this.activeAccountFlow === "registration") {
      this.registrationPassword = nextValue;
    } else {
      this.recoveryPassword = nextValue;
    }
    this.lobbyStatus = nextValue ? "已更新口令草稿。" : "已清空口令草稿。";
    this.renderView();
  }

  applyLobbyFieldDraft(field: "playerId" | "displayName" | "roomId" | "loginId", value: string): void {
    const storage = this.readWebStorage();
    if (field === "playerId") {
      const previousSuggestedName = readPreferredCocosDisplayName(this.playerId, storage);
      const nextPlayerId = value.trim() || createCocosGuestPlayerId();
      const storedSession = readStoredCocosAuthSession(storage);
      this.playerId = nextPlayerId;
      if (!this.displayName.trim() || this.displayName === previousSuggestedName) {
        this.displayName =
          storedSession?.playerId === nextPlayerId ? storedSession.displayName : readPreferredCocosDisplayName(nextPlayerId, storage);
      }
      this.authToken = storedSession?.playerId === nextPlayerId ? storedSession.token ?? null : null;
      this.authMode = storedSession?.playerId === nextPlayerId ? storedSession.authMode : "guest";
      this.authProvider = storedSession?.playerId === nextPlayerId ? storedSession.provider ?? "guest" : "guest";
      this.loginId = storedSession?.playerId === nextPlayerId ? storedSession.loginId ?? "" : "";
      this.sessionSource = storedSession?.playerId === nextPlayerId ? storedSession.source : "manual";
      this.syncWechatShareBridge();
      this.lobbyStatus = `已切换游客身份草稿为 ${nextPlayerId}。`;
      this.renderView();
      void this.refreshLobbyAccountProfile();
      return;
    }
    if (field === "displayName") {
      this.displayName = rememberPreferredCocosDisplayName(this.playerId, value, storage);
      this.syncWechatShareBridge();
      this.lobbyStatus = "昵称草稿已更新。";
      this.renderView();
      void this.refreshLobbyAccountProfile();
      return;
    }
    if (field === "loginId") {
      this.loginId = value.trim().toLowerCase();
      this.lobbyStatus = this.loginId ? `已更新登录 ID 草稿为 ${this.loginId}。` : "已清空登录 ID 草稿。";
      this.renderView();
      return;
    }

    const nextRoomId = value.trim();
    if (nextRoomId.length === 0) {
      return;
    }
    this.roomId = nextRoomId;
    this.syncWechatShareBridge();
    this.lobbyStatus = `已将目标房间切换为 ${nextRoomId}。`;
    this.renderView();
    void this.refreshLobbyAccountProfile();
  }

  promptForAccountFlowField(field: "loginId" | "displayName" | "token" | "password"): void {
    const promptRef = globalThis.prompt;
    if (typeof promptRef !== "function" || !this.activeAccountFlow) {
      this.lobbyStatus = "当前运行环境不支持弹出式输入，请改用浏览器调试壳填写流程字段。";
      this.renderView();
      return;
    }
    const nextValue = field === "loginId"
      ? promptRef("输入登录 ID", this.loginId)?.trim()
      : field === "displayName"
        ? promptRef("输入注册昵称", this.registrationDisplayName || this.displayName || this.loginId)
        : field === "token"
          ? promptRef(
              this.activeAccountFlow === "registration" ? "输入注册令牌" : "输入找回令牌",
              this.activeAccountFlow === "registration" ? this.registrationToken : this.recoveryToken
            )?.trim()
          : promptRef(
      this.activeAccountFlow === "registration" ? "输入注册口令（至少 6 位）" : "输入新的账号口令（至少 6 位）",
      ""
    );
    if (nextValue == null) {
      return;
    }
    this.applyAccountFlowFieldDraft(field, nextValue);
  }

  async requestActiveAccountFlow(): Promise<void> {
    if (!this.activeAccountFlow || this.lobbyEntering) {
      return;
    }
    const loginId = this.loginId.trim().toLowerCase();
    const validationError = validateAccountLifecycleRequest(this.activeAccountFlow, loginId);
    if (validationError) {
      this.lobbyStatus = validationError.message;
      this.renderView();
      return;
    }
     this.loginId = loginId;
    this.lobbyEntering = true;
    this.lobbyStatus =
      this.activeAccountFlow === "registration"
        ? `正在为 ${loginId} 申请注册令牌...`
        : `正在为 ${loginId} 申请密码找回令牌...`;
    this.renderView();
     try {
      if (this.activeAccountFlow === "registration") {
        const requested = await requestCocosAccountRegistration(
          this.remoteUrl,
          loginId,
          this.registrationDisplayName || this.displayName || loginId
        );
        this.registrationToken = requested.registrationToken ?? this.registrationToken;
        this.registrationExpiresAt = requested.expiresAt ?? "";
        this.registrationDeliveryMode = requested.registrationToken ? "dev-token" : "external";
        this.lobbyStatus = requested.registrationToken
          ? `注册令牌已生成，可直接确认注册。令牌：${requested.registrationToken}${requested.expiresAt ? `；过期时间：${requested.expiresAt}` : ""}`
          : `注册申请已受理，请从外部渠道获取令牌${requested.expiresAt ? `；过期时间：${requested.expiresAt}` : ""}。`;
      } else {
        const requested = await requestCocosPasswordRecovery(this.remoteUrl, loginId);
        this.recoveryToken = requested.recoveryToken ?? this.recoveryToken;
        this.recoveryExpiresAt = requested.expiresAt ?? "";
        this.recoveryDeliveryMode = requested.recoveryToken ? "dev-token" : "external";
        this.lobbyStatus = requested.recoveryToken
          ? `找回令牌已生成，可直接确认重置。令牌：${requested.recoveryToken}${requested.expiresAt ? `；过期时间：${requested.expiresAt}` : ""}`
          : `找回申请已受理，请从外部渠道获取令牌${requested.expiresAt ? `；过期时间：${requested.expiresAt}` : ""}。`;
      }
    } catch (error) {
      this.lobbyStatus =
        this.activeAccountFlow === "registration"
          ? this.describeCocosAccountFlowError(error, "account_registration_request_failed")
          : this.describeCocosAccountFlowError(error, "password_recovery_request_failed");
    } finally {
      this.lobbyEntering = false;
      this.renderView();
    }
  }

  async confirmActiveAccountFlow(): Promise<void> {
    if (!this.activeAccountFlow || this.lobbyEntering) {
      return;
    }
    const loginId = this.loginId.trim().toLowerCase();
    this.loginId = loginId;
    const validationError = validateAccountLifecycleConfirm(this.activeAccountFlow, {
      loginId,
      token: this.activeAccountFlow === "registration" ? this.registrationToken : this.recoveryToken,
      password: this.activeAccountFlow === "registration" ? this.registrationPassword : this.recoveryPassword,
      privacyConsentAccepted: this.privacyConsentAccepted
    });
    if (validationError) {
      this.lobbyStatus = validationError.message;
      this.renderView();
      return;
    }
     if (this.activeAccountFlow === "registration") {
      await this.confirmLobbyAccountRegistration(loginId);
      return;
    }
     await this.confirmLobbyAccountRecovery(loginId);
  }

  async confirmLobbyAccountRegistration(loginId: string): Promise<void> {
    this.lobbyEntering = true;
    this.lobbyStatus = `正在确认正式注册 ${loginId} 并进入房间 ${this.roomId}...`;
    this.renderView();
     try {
      const storage = this.readWebStorage();
      const authSession = await confirmCocosAccountRegistration(
        this.remoteUrl,
        loginId,
        this.registrationToken,
        this.registrationPassword,
        {
          storage,
          privacyConsentAccepted: this.privacyConsentAccepted
        }
      );
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "account-password";
      this.loginId = authSession.loginId ?? loginId;
      this.sessionSource = authSession.source;
      this.registrationToken = "";
      this.registrationPassword = "";
      this.registrationDeliveryMode = "idle";
      this.registrationExpiresAt = "";
      this.activeAccountFlow = null;
      this.syncWechatShareBridge();
      this.lobbyStatus = `正式账号注册成功，正在同步全局仓库并进入房间 ${this.roomId}...`;
      saveCocosLobbyPreferences(authSession.playerId, this.roomId, undefined, storage);
      this.renderView();
      await this.refreshLobbyAccountProfile();
      this.lobbyEntering = false;
      await this.enterLobbyRoom(this.roomId);
    } catch (error) {
      this.lobbyEntering = false;
      this.lobbyStatus = this.describeCocosAccountFlowError(error, "account_registration_failed", {
        invalidTokenCode: "invalid_registration_token"
      });
      this.renderView();
    }
  }

  async confirmLobbyAccountRecovery(loginId: string): Promise<void> {
    this.lobbyEntering = true;
    this.lobbyStatus = `正在重置 ${loginId} 的口令并进入房间 ${this.roomId}...`;
    this.renderView();
     try {
      await confirmCocosPasswordRecovery(this.remoteUrl, loginId, this.recoveryToken, this.recoveryPassword);
      const storage = this.readWebStorage();
      const authSession = await loginWithCocosProvider(
        this.remoteUrl,
        {
          provider: "account-password",
          loginId,
          password: this.recoveryPassword
        },
        {
          storage,
          privacyConsentAccepted: this.privacyConsentAccepted
        }
      );
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "account-password";
      this.loginId = authSession.loginId ?? loginId;
      this.sessionSource = authSession.source;
      this.recoveryToken = "";
      this.recoveryPassword = "";
      this.recoveryDeliveryMode = "idle";
      this.recoveryExpiresAt = "";
      this.activeAccountFlow = null;
      this.syncWechatShareBridge();
      this.lobbyStatus = `口令重置成功，正在同步全局仓库并进入房间 ${this.roomId}...`;
      saveCocosLobbyPreferences(authSession.playerId, this.roomId, undefined, storage);
      this.renderView();
      await this.refreshLobbyAccountProfile();
      this.lobbyEntering = false;
      await this.enterLobbyRoom(this.roomId);
    } catch (error) {
      this.lobbyEntering = false;
      this.lobbyStatus = this.describeCocosAccountFlowError(error, "password_recovery_failed", {
        invalidTokenCode: "invalid_recovery_token"
      });
      this.renderView();
    }
  }

  promptForLobbyField(field: "playerId" | "displayName" | "roomId" | "loginId"): void {
    const promptRef = globalThis.prompt;
    if (typeof promptRef !== "function") {
      this.lobbyStatus = "当前运行环境不支持弹出式输入，请改用 URL 参数、已缓存会话或浏览器调试壳。";
      this.renderView();
      return;
    }
    const nextValue = field === "playerId"
      ? promptRef("输入游客 playerId", this.playerId)?.trim()
      : field === "displayName"
        ? promptRef("输入展示昵称", this.displayName || this.playerId)
        : field === "loginId"
          ? promptRef("输入登录 ID", this.loginId)?.trim()
          : promptRef("输入房间 ID", this.roomId)?.trim();
    if (nextValue == null) {
      return;
    }
    this.applyLobbyFieldDraft(field, nextValue);
  }
}

export const veilRootAccountSettingsMethods = VeilRootAccountSettingsMethods.prototype;
