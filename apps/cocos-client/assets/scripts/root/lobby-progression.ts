// @ts-nocheck

import {
  claimAllCocosMailboxMessages,
  claimCocosMailboxMessage,
  createCocosWechatPaymentOrder,
  createPrimaryClientTelemetryEvent,
  readCocosWechatFriendCloudEntries,
  readStoredCocosAuthSession,
  requestCocosWechatPayment,
  syncCocosWechatFriendCloudStorage,
  transitionCocosAccountReviewState,
  verifyCocosWechatPayment,
  type CocosSeasonProgress,
  type SessionUpdate
} from "./deps.ts";
import { ACCOUNT_REVIEW_PAGE_SIZE } from "./constants";
import { resolveVeilRootRuntime } from "./runtime.ts";
import {
  advanceGameplayCampaignDialogueForRoot,
  attemptGameplayDailyDungeonFloorForRoot,
  claimGameplayDailyDungeonRunForRoot,
  claimGameplaySeasonTierForRoot,
  completeGameplayCampaignMissionForRoot,
  describeCampaignErrorForRoot,
  openLobbyPvePanelForRoot,
  purchaseGameplaySeasonPremiumForRoot,
  refreshActiveSeasonalEventForRoot,
  refreshDailyDungeonPanelForRoot,
  refreshGameplayCampaignForRoot,
  refreshSeasonProgressForRoot,
  resolveSelectedGameplayCampaignMissionForRoot,
  selectGameplayCampaignMissionForRoot,
  snapshotSeasonProgressFromProfileForRoot,
  startGameplayCampaignDialogueForRoot,
  startGameplayCampaignMissionForRoot,
  syncGameplayCampaignSelectionForRoot,
  toggleGameplayAccountReviewPanelForRoot,
  toggleGameplayBattlePassPanelForRoot,
  toggleGameplayCampaignPanelForRoot,
  toggleGameplayDailyDungeonPanelForRoot,
  toggleGameplayEquipmentPanelForRoot,
  toggleGameplaySeasonalEventPanelForRoot
} from "./index.ts";

class VeilRootLobbyProgressionMethods {
  [key: string]: any;
  async syncLobbyBootstrap(): Promise<void> {
    await this.refreshLobbyRoomList();
    await this.refreshLobbyAccountProfile();
  }

  async refreshLobbyAccountProfile(): Promise<void> {
    const storage = this.readWebStorage();
    const requestEpoch = this.bumpLobbyAccountEpoch();
    this.lobbyLeaderboardStatus = "loading";
    this.lobbyLeaderboardError = null;
    this.lobbyShopLoading = true;
    this.lobbyShopStatus = "正在同步商店商品...";
    this.renderView();
    const storedSession = readStoredCocosAuthSession(storage);
    const activeSession = storedSession?.playerId === this.playerId ? storedSession : null;
    const syncedSession = await resolveVeilRootRuntime().syncAuthSession(this.remoteUrl, {
      storage,
      session: activeSession
    });
    if (!this.isActiveLobbyAccountEpoch(requestEpoch)) {
      return;
    }

    if (syncedSession) {
      this.authToken = syncedSession.token ?? null;
      this.authMode = syncedSession.authMode;
      this.authProvider = syncedSession.provider ?? "guest";
      this.loginId = syncedSession.loginId ?? "";
      this.sessionSource = syncedSession.source;
      this.playerId = syncedSession.playerId;
      this.displayName = syncedSession.displayName;
      await this.maybeClaimLaunchReferral(syncedSession);
    } else if (this.sessionSource !== "manual") {
      this.authToken = null;
      this.authMode = "guest";
      this.authProvider = "guest";
      this.loginId = "";
      this.sessionSource = "none";
    }

    const [profile, leaderboardResult, shopProductsResult, activeEventsResult, announcementsResult, maintenanceModeResult] = await Promise.all([
      resolveVeilRootRuntime().loadAccountProfile(this.remoteUrl, this.playerId, this.roomId, {
        storage,
        authSession: syncedSession
      }),
      (this.runtimePlatform === "wechat-game"
        ? (async () => {
            const wxRuntime = (globalThis as { wx?: unknown }).wx ?? null;
            const friendEntries = await readCocosWechatFriendCloudEntries(wxRuntime);
            const friendIds = friendEntries.map((entry) => entry.playerId);
            if (friendIds.length === 0) {
              return { ok: true as const, entries: [] };
            }

            return {
              ok: true as const,
              entries: await resolveVeilRootRuntime().loadFriendLeaderboard(this.remoteUrl, friendIds, {
                getAuthToken: () => this.authToken
              })
            };
          })()
        : resolveVeilRootRuntime().loadLeaderboard(this.remoteUrl, 50).then((entries) => ({ ok: true as const, entries })))
        .catch((error: unknown) => ({ ok: false as const, error })),
      resolveVeilRootRuntime()
        .loadShopProducts(this.remoteUrl)
        .then((products) => ({ ok: true as const, products }))
        .catch((error: unknown) => ({ ok: false as const, error })),
      syncedSession?.token
        ? resolveVeilRootRuntime()
            .loadActiveSeasonalEvents(this.remoteUrl, {
              storage,
              authSession: syncedSession
            })
            .then((events) => ({ ok: true as const, events }))
            .catch((error: unknown) => ({ ok: false as const, error }))
        : Promise.resolve({ ok: true as const, events: [] as CocosSeasonalEvent[] }),
      resolveVeilRootRuntime().loadAnnouncements(this.remoteUrl)
        .then((items) => ({ ok: true as const, items }))
        .catch((error: unknown) => ({ ok: false as const, error })),
      resolveVeilRootRuntime().loadMaintenanceMode(this.remoteUrl)
        .then((snapshot) => ({ ok: true as const, snapshot }))
        .catch((error: unknown) => ({ ok: false as const, error }))
    ]);
    if (!this.isActiveLobbyAccountEpoch(requestEpoch)) {
      return;
    }

    this.commitAccountProfile(profile, false);
    this.lobbyAnnouncements = announcementsResult.ok ? announcementsResult.items : [];
    this.lobbyMaintenanceMode = maintenanceModeResult.ok ? maintenanceModeResult.snapshot : null;
    if (this.runtimePlatform === "wechat-game") {
      const wxRuntime = (globalThis as { wx?: unknown }).wx ?? null;
      void syncCocosWechatFriendCloudStorage(wxRuntime, {
        playerId: profile.playerId,
        eloRating: profile.eloRating ?? 1000
      });
    }
    if (leaderboardResult.ok) {
      this.lobbyLeaderboardEntries = leaderboardResult.entries;
      this.lobbyLeaderboardStatus = "ready";
      this.lobbyLeaderboardError = null;
    } else {
      this.lobbyLeaderboardEntries = [];
      this.lobbyLeaderboardStatus = "error";
      this.lobbyLeaderboardError =
        leaderboardResult.error instanceof Error ? leaderboardResult.error.message : "leaderboard_unavailable";
    }
    if (shopProductsResult.ok) {
      this.lobbyShopProducts = shopProductsResult.products;
      this.lobbyShopStatus =
        shopProductsResult.products.length > 0
          ? "点击商品卡片即可购买；微信商品会在小游戏环境拉起支付。"
          : "当前没有上架商品。";
      this.maybeEmitShopOpenAnalytics();
    } else {
      this.lobbyShopProducts = [];
      this.lobbyShopStatus =
        shopProductsResult.error instanceof Error ? shopProductsResult.error.message : "shop_unavailable";
    }
    if (activeEventsResult.ok) {
      this.activeSeasonalEvent = activeEventsResult.events[0] ?? null;
      this.seasonalEventStatus = this.activeSeasonalEvent
        ? `已同步 ${this.activeSeasonalEvent.name} · 当前积分 ${this.activeSeasonalEvent.player.points}`
        : "当前没有进行中的赛季活动。";
    } else {
      this.activeSeasonalEvent = null;
      this.seasonalEventStatus =
        activeEventsResult.error instanceof Error ? activeEventsResult.error.message : "seasonal_event_unavailable";
    }
    this.lobbyShopLoading = false;
    if (profile.source === "remote") {
      this.displayName = profile.displayName;
      this.loginId = profile.loginId ?? this.loginId;
    }
    this.syncWechatShareBridge();
    this.renderView();
  }

  describeShopError(error: unknown): string {
    if (!(error instanceof Error)) {
      return "商品购买失败，请稍后重试。";
    }

    switch (error.message) {
      case "cocos_request_failed:401:unauthorized":
      case "cocos_request_failed:401:token_expired":
        return "购买需要有效账号会话，请重新登录后再试。";
      case "cocos_request_failed:409:insufficient_gems":
        return "宝石不足，无法完成本次购买。";
      case "cocos_request_failed:409:product_not_available":
        return "该商品当前未上架。";
      case "cocos_request_failed:409:equipment_inventory_full":
        return "背包已满，暂时无法领取该装备。";
      case "cocos_request_failed:409:cosmetic_not_owned":
        return "尚未拥有该外观，无法装备。";
      case "cocos_request_failed:409:cosmetic_not_found":
        return "该外观已下架或不存在。";
      case "cocos_request_failed:400:wechat_open_id_required":
        return "微信支付需要先绑定小游戏身份。";
      case "cocos_request_failed:503:wechat_pay_not_configured":
        return "服务器尚未配置微信支付。";
      default:
        return error.message.startsWith("cocos_request_failed:")
          ? "商品购买失败，请稍后重试。"
          : error.message;
    }
  }

  async claimLobbyMailboxMessage(messageId: string): Promise<void> {
    const storage = this.readWebStorage();
    const authSession = readStoredCocosAuthSession(storage);
    if (!authSession?.token) {
      this.lobbyStatus = "系统邮箱领取需要先登录云端账号或游客会话。";
      this.renderView();
      return;
    }

    this.mailboxClaimingMessageId = messageId;
    this.lobbyStatus = "正在领取邮件附件...";
    this.renderView();
    try {
      const payload = await claimCocosMailboxMessage(this.remoteUrl, messageId, {
        authSession,
        storage
      });
      this.lobbyStatus =
        payload.claimed
          ? "邮件附件已领取，正在同步仓库状态。"
          : payload.reason === "already_claimed"
            ? "该邮件附件已经领取过。"
            : payload.reason === "expired"
              ? "该邮件已经过期。"
              : "该邮件没有可领取附件。";
      await this.refreshLobbyAccountProfile();
    } catch (error) {
      this.lobbyStatus = error instanceof Error ? error.message : "mailbox_claim_failed";
    } finally {
      this.mailboxClaimingMessageId = null;
      this.renderView();
    }
  }

  async claimLobbyDailyQuest(questId: string): Promise<void> {
    const storage = this.readWebStorage();
    const authSession = readStoredCocosAuthSession(storage);
    if (!authSession?.token) {
      this.lobbyStatus = "每日任务领取需要先登录云端账号或游客会话。";
      this.renderView();
      return;
    }

    this.dailyQuestClaimingId = questId;
    this.lobbyStatus = "正在领取每日任务奖励...";
    this.renderView();
    try {
      const payload = await resolveVeilRootRuntime().claimDailyQuest(this.remoteUrl, questId, {
        authSession,
        storage
      });
      this.lobbyStatus =
        payload.claimed
          ? "每日任务奖励已领取，正在同步任务板。"
          : payload.reason === "already_claimed"
            ? "该每日任务奖励已经领取过。"
            : payload.reason === "quest_incomplete"
              ? "任务尚未完成，暂时无法领取奖励。"
              : "每日任务领取失败，请稍后重试。";
      await this.refreshLobbyAccountProfile();
    } catch (error) {
      this.lobbyStatus = error instanceof Error ? error.message : "daily_quest_claim_failed";
    } finally {
      this.dailyQuestClaimingId = null;
      this.renderView();
    }
  }

  async claimAllLobbyMailboxMessages(): Promise<void> {
    const storage = this.readWebStorage();
    const authSession = readStoredCocosAuthSession(storage);
    if (!authSession?.token) {
      this.lobbyStatus = "系统邮箱领取需要先登录云端账号或游客会话。";
      this.renderView();
      return;
    }

    this.mailboxClaimAllInFlight = true;
    this.lobbyStatus = "正在领取全部邮件附件...";
    this.renderView();
    try {
      const payload = await claimAllCocosMailboxMessages(this.remoteUrl, {
        authSession,
        storage
      });
      this.lobbyStatus = payload.claimed ? "邮件附件已全部领取，正在同步仓库状态。" : "当前没有可领取的邮件附件。";
      await this.refreshLobbyAccountProfile();
    } catch (error) {
      this.lobbyStatus = error instanceof Error ? error.message : "mailbox_claim_all_failed";
    } finally {
      this.mailboxClaimAllInFlight = false;
      this.renderView();
    }
  }

  async purchaseLobbyShopProduct(productId: string): Promise<void> {
    if (this.pendingShopProductId || this.lobbyEntering) {
      return;
    }

    const product = this.lobbyShopProducts.find((entry) => entry.productId === productId);
    if (!product) {
      this.lobbyShopStatus = "未找到要购买的商品。";
      this.renderView();
      return;
    }
    if (!this.authToken) {
      this.lobbyShopStatus = "购买需要有效会话，请先重新进入大厅。";
      this.renderView();
      return;
    }

    this.pendingShopProductId = productId;
    const cosmeticId = product.grant.cosmeticIds?.[0];
    const alreadyOwned = cosmeticId ? (this.lobbyAccountProfile.cosmeticInventory?.ownedIds ?? []).includes(cosmeticId) : false;
    this.lobbyShopStatus =
      product.type === "cosmetic" && alreadyOwned
        ? `正在装备 ${product.name}...`
        : product.wechatPriceFen
          ? `正在创建微信订单 ${product.name}...`
          : `正在购买 ${product.name}...`;
    this.renderView();

    try {
      this.trackPurchaseInitiated(product, "lobby");
      if (product.type === "cosmetic" && alreadyOwned && cosmeticId) {
        await resolveVeilRootRuntime().equipShopCosmetic(this.remoteUrl, cosmeticId, {
          getAuthToken: () => this.authToken
        });
        this.lobbyShopStatus = `${product.name} 已装备。`;
        await this.refreshLobbyAccountProfile();
      } else if (product.wechatPriceFen) {
        const order = await createCocosWechatPaymentOrder(this.remoteUrl, productId, {
          authToken: this.authToken
        });
        const paymentResult = await requestCocosWechatPayment(
          (globalThis as { wx?: CocosWechatPaymentRuntimeLike | null }).wx,
          order
        );
        const verification = await verifyCocosWechatPayment(this.remoteUrl, order.orderId, {
          authToken: this.authToken
        });
        this.lobbyShopStatus =
          verification.seasonPassPremium
            ? `${product.name} 购买成功，赛季高级通行证已解锁。`
            : `${product.name} 购买成功，当前宝石 ${verification.gemsBalance}。`;
        if (paymentResult.available) {
          await this.refreshLobbyAccountProfile();
        }
      } else {
        const result = await resolveVeilRootRuntime().purchaseShopProduct(this.remoteUrl, productId, {
          getAuthToken: () => this.authToken
        });
        this.lobbyShopStatus = `${product.name} 购买成功，当前宝石 ${result.gemsBalance}。`;
        await this.refreshLobbyAccountProfile();
      }
    } catch (error) {
      this.lobbyShopStatus = this.describeShopError(error);
    } finally {
      this.pendingShopProductId = null;
      this.renderView();
    }
  }

  async refreshActiveAccountReviewSection(section = this.lobbyAccountReviewState.activeSection): Promise<void> {
    if (section === "progression") {
      await this.refreshProgressionReview();
      return;
    }

    if (section === "achievements") {
      await this.refreshAchievementReview();
      return;
    }

    if (section === "event-history") {
      await this.refreshAccountReviewPage("event-history", this.lobbyAccountReviewState.eventHistory.page);
      return;
    }

    await this.refreshAccountReviewPage("battle-replays", this.lobbyAccountReviewState.battleReplays.page);
  }

  async refreshProgressionReview(): Promise<void> {
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "section.loading",
      section: "progression"
    });
    this.renderView();

    try {
      const snapshot = await resolveVeilRootRuntime().loadProgressionSnapshot(this.remoteUrl, this.playerId, 6, {
        storage: this.readWebStorage(),
        authSession: this.currentLobbyAuthSession(),
        throwOnError: true
      });
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "progression.loaded",
        snapshot
      });
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(), {
          category: "progression",
          checkpoint: "review.loaded",
          status: "success",
          detail: `Progression review loaded with ${snapshot.recentEventLog.length} recent events.`,
          itemCount: snapshot.recentEventLog.length
        })
      );
    } catch (error) {
      const message = this.describeAccountReviewLoadError(error);
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "section.failed",
        section: "progression",
        message
      });
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(), {
          category: "progression",
          checkpoint: "review.failed",
          status: "failure",
          detail: message,
          reason: message
        })
      );
    }

    this.renderView();
  }

  async refreshAchievementReview(): Promise<void> {
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "section.loading",
      section: "achievements"
    });
    this.renderView();

    try {
      const items = await resolveVeilRootRuntime().loadAchievementProgress(this.remoteUrl, this.playerId, undefined, {
        storage: this.readWebStorage(),
        authSession: this.currentLobbyAuthSession(),
        throwOnError: true
      });
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "achievements.loaded",
        items
      });
    } catch (error) {
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "section.failed",
        section: "achievements",
        message: this.describeAccountReviewLoadError(error)
      });
    }

    this.renderView();
  }

  async toggleGameplayAccountReviewPanel(forceOpen?: boolean): Promise<void> {
    await toggleGameplayAccountReviewPanelForRoot(this as unknown as Record<string, any>, forceOpen);
  }

  async toggleGameplayBattlePassPanel(forceOpen?: boolean): Promise<void> {
    await toggleGameplayBattlePassPanelForRoot(this as unknown as Record<string, any>, forceOpen);
  }

  async toggleGameplayDailyDungeonPanel(forceOpen?: boolean): Promise<void> {
    await toggleGameplayDailyDungeonPanelForRoot(this as unknown as Record<string, any>, forceOpen);
  }

  async openLobbyPvePanel(target: "campaign" | "daily-dungeon" | "battle-pass"): Promise<void> {
    await openLobbyPvePanelForRoot(this as unknown as Record<string, any>, target);
  }

  async refreshDailyDungeonPanel(successStatus?: string): Promise<void> {
    await refreshDailyDungeonPanelForRoot(this as unknown as Record<string, any>, successStatus);
  }

  async toggleGameplaySeasonalEventPanel(forceOpen?: boolean): Promise<void> {
    await toggleGameplaySeasonalEventPanelForRoot(this as unknown as Record<string, any>, forceOpen);
  }

  snapshotSeasonProgressFromProfile(): CocosSeasonProgress {
    return snapshotSeasonProgressFromProfileForRoot(this as unknown as Record<string, any>);
  }

  async refreshSeasonProgress(): Promise<void> {
    await refreshSeasonProgressForRoot(this as unknown as Record<string, any>);
  }

  async refreshActiveSeasonalEvent(): Promise<void> {
    await refreshActiveSeasonalEventForRoot(this as unknown as Record<string, any>);
  }

  async submitBattleProgressForActiveEvents(update: SessionUpdate): Promise<void> {
    if (this.sessionSource !== "remote" || !this.authToken) {
      return;
    }

    const authSession = this.currentLobbyAuthSession();
    if (!authSession?.token) {
      return;
    }

    const resolvedBattles = update.events.filter(
      (event): event is Extract<SessionUpdate["events"][number], { type: "battle.resolved" }> => event.type === "battle.resolved"
    );
    const ownResolvedBattle = resolvedBattles.find((event) => update.world.ownHeroes.some((hero) => hero.id === event.heroId)) ?? null;
    if (!ownResolvedBattle) {
      return;
    }

    const actionId = `${update.world.playerId}:${ownResolvedBattle.battleId}`;
    if (this.pendingSeasonalEventBattleIds.has(actionId)) {
      return;
    }

    this.pendingSeasonalEventBattleIds.add(actionId);
    try {
      const events =
        this.activeSeasonalEvent ? [this.activeSeasonalEvent] : await resolveVeilRootRuntime().loadActiveSeasonalEvents(this.remoteUrl, {
          storage: this.readWebStorage(),
          authSession,
          throwOnError: false
        });
      if (events.length === 0) {
        if (!this.activeSeasonalEvent) {
          this.seasonalEventStatus = "当前没有进行中的赛季活动。";
          this.renderView();
        }
        return;
      }

      for (const seasonalEvent of events) {
        const result = await resolveVeilRootRuntime().submitSeasonalEventProgress(
          this.remoteUrl,
          seasonalEvent.id,
          {
            actionId,
            actionType: "battle_resolved",
            battleId: ownResolvedBattle.battleId,
            occurredAt: new Date().toISOString()
          },
          {
            storage: this.readWebStorage(),
            authSession
          }
        );
        if (result.event) {
          this.activeSeasonalEvent = result.event;
        }
        if (result.eventProgress) {
          this.seasonalEventStatus = `${seasonalEvent.name} +${result.eventProgress.delta} 分 · 当前 ${result.eventProgress.points} 分`;
        }
      }
      this.renderView();
    } catch (error) {
      this.seasonalEventStatus = error instanceof Error ? error.message : "seasonal_event_progress_failed";
      this.renderView();
    } finally {
      this.pendingSeasonalEventBattleIds.delete(actionId);
    }
  }

  handleSeasonalEventProgressPush(message: {
    payload: {
      eventId: string;
      points: number;
      delta: number;
      objectiveId: string;
    };
  }): void {
    const eventId = message.payload.eventId.trim();
    if (!eventId) {
      return;
    }

    if (this.activeSeasonalEvent?.id === eventId) {
      const previousRank =
        this.activeSeasonalEvent.leaderboard.entries.find((entry) => entry.playerId === this.playerId)?.rank ?? null;
      const currentEntries = this.activeSeasonalEvent.leaderboard.entries.filter((entry) => entry.playerId !== this.playerId);
      currentEntries.push({
        rank: previousRank ?? currentEntries.length + 1,
        playerId: this.playerId,
        displayName: this.displayName || this.playerId,
        points: Math.max(0, Math.floor(message.payload.points)),
        lastUpdatedAt: new Date().toISOString()
      });
      currentEntries.sort(
        (left, right) =>
          right.points - left.points || left.lastUpdatedAt.localeCompare(right.lastUpdatedAt) || left.playerId.localeCompare(right.playerId)
      );

      this.activeSeasonalEvent = {
        ...this.activeSeasonalEvent,
        player: {
          ...this.activeSeasonalEvent.player,
          points: Math.max(0, Math.floor(message.payload.points))
        },
        leaderboard: {
          ...this.activeSeasonalEvent.leaderboard,
          entries: currentEntries.map((entry, index) => ({
            ...entry,
            rank: index + 1
          }))
        }
      };
    }

    this.seasonalEventStatus = `赛季活动推进：${message.payload.objectiveId} +${message.payload.delta} 分`;
    if (this.gameplaySeasonalEventPanelOpen) {
      void this.refreshActiveSeasonalEvent();
    }
    this.renderView();
  }

  async claimGameplaySeasonTier(tier: number): Promise<void> {
    await claimGameplaySeasonTierForRoot(this as unknown as Record<string, any>, tier);
  }

  async purchaseGameplaySeasonPremium(): Promise<void> {
    await purchaseGameplaySeasonPremiumForRoot(this as unknown as Record<string, any>);
  }

  async attemptGameplayDailyDungeonFloor(floor: number): Promise<void> {
    await attemptGameplayDailyDungeonFloorForRoot(this as unknown as Record<string, any>, floor);
  }

  async claimGameplayDailyDungeonRun(runId: string): Promise<void> {
    await claimGameplayDailyDungeonRunForRoot(this as unknown as Record<string, any>, runId);
  }

  toggleGameplayEquipmentPanel(forceOpen?: boolean): void {
    toggleGameplayEquipmentPanelForRoot(this as unknown as Record<string, any>, forceOpen);
  }

  async toggleGameplayCampaignPanel(forceOpen?: boolean): Promise<void> {
    await toggleGameplayCampaignPanelForRoot(this as unknown as Record<string, any>, forceOpen);
  }

  resolveSelectedGameplayCampaignMission() {
    return resolveSelectedGameplayCampaignMissionForRoot(this as unknown as Record<string, any>);
  }

  syncGameplayCampaignSelection(preferredMissionId?: string | null): void {
    syncGameplayCampaignSelectionForRoot(this as unknown as Record<string, any>, preferredMissionId);
  }

  selectGameplayCampaignMission(direction: "previous" | "next" | "next-available"): void {
    selectGameplayCampaignMissionForRoot(this as unknown as Record<string, any>, direction);
  }

  async refreshGameplayCampaign(preferredMissionId?: string | null): Promise<void> {
    await refreshGameplayCampaignForRoot(this as unknown as Record<string, any>, preferredMissionId);
  }

  startGameplayCampaignDialogue(missionId: string, sequence: "intro" | "outro"): void {
    startGameplayCampaignDialogueForRoot(this as unknown as Record<string, any>, missionId, sequence);
  }

  advanceGameplayCampaignDialogue(): void {
    advanceGameplayCampaignDialogueForRoot(this as unknown as Record<string, any>);
  }

  async startGameplayCampaignMission(): Promise<void> {
    await startGameplayCampaignMissionForRoot(this as unknown as Record<string, any>);
  }

  async completeGameplayCampaignMission(): Promise<void> {
    await completeGameplayCampaignMissionForRoot(this as unknown as Record<string, any>);
  }

  describeCampaignError(error: unknown): string {
    return describeCampaignErrorForRoot(error);
  }

  syncGameplayCampaignBattleOutcome(update: SessionUpdate): void {
    if (this.gameplayCampaignPendingAction !== null || this.gameplayCampaignDialogue || !this.gameplayCampaignActiveMissionId) {
      return;
    }

    const resolution = update.events.find(
      (event): event is Extract<SessionUpdate["events"][number], { type: "battle.resolved" }> =>
        event.type === "battle.resolved" && update.world.ownHeroes.some((hero) => hero.id === event.heroId)
    );
    if (!resolution) {
      return;
    }

    const activeMission =
      this.gameplayCampaign?.missions.find((mission) => mission.id === this.gameplayCampaignActiveMissionId) ?? null;
    if (!activeMission) {
      return;
    }

    this.gameplayCampaignPanelOpen = true;
    this.gameplayCampaignSelectedMissionId = activeMission.id;
    const victory = resolution.result === "attacker_victory" || resolution.result === "defender_victory";
    if (!victory) {
      this.gameplayCampaignActiveMissionId = null;
      this.gameplayCampaignStatus = `${activeMission.name} 未完成，可重新发起挑战。`;
      this.renderView();
      return;
    }

    this.gameplayCampaignStatus = `${activeMission.name} 战斗胜利，正在同步战役结算...`;
    this.renderView();
    void this.completeGameplayCampaignMission();
  }

  async refreshAccountReviewPage(
    section: "battle-replays" | "event-history",
    page: number
  ): Promise<void> {
    const safePage = Math.max(0, Math.floor(page));
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "section.loading",
      section
    });
    this.renderView();

    try {
      if (section === "event-history") {
        const history = await resolveVeilRootRuntime().loadEventHistory(
          this.remoteUrl,
          this.playerId,
          {
            limit: ACCOUNT_REVIEW_PAGE_SIZE,
            offset: safePage * ACCOUNT_REVIEW_PAGE_SIZE
          },
          {
            storage: this.readWebStorage(),
            authSession: this.currentLobbyAuthSession(),
            throwOnError: true
          }
        );
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "event-history.loaded",
          items: history.items,
          page: Math.floor(history.offset / Math.max(1, history.limit)),
          pageSize: history.limit,
          total: history.total,
          hasMore: history.hasMore
        });
      } else {
        const history = await resolveVeilRootRuntime().loadBattleReplayHistoryPage(
          this.remoteUrl,
          this.playerId,
          {
            limit: ACCOUNT_REVIEW_PAGE_SIZE,
            offset: safePage * ACCOUNT_REVIEW_PAGE_SIZE
          },
          {
            storage: this.readWebStorage(),
            authSession: this.currentLobbyAuthSession(),
            throwOnError: true
          }
        );
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "battle-replays.loaded",
          items: history.items,
          page: Math.floor(history.offset / Math.max(1, history.limit)),
          pageSize: history.limit,
          hasMore: history.hasMore
        });
      }
    } catch (error) {
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "section.failed",
        section,
        message: this.describeAccountReviewLoadError(error)
      });
    }

    this.renderView();
  }

  currentLobbyAuthSession(): {
    token: string;
    playerId: string;
    displayName: string;
    authMode: "guest" | "account";
    loginId?: string;
    source: "remote";
  } | null {
    if (!this.authToken) {
      return null;
    }

    return {
      token: this.authToken,
      playerId: this.playerId,
      displayName: this.displayName || this.playerId,
      authMode: this.authMode,
      ...(this.loginId ? { loginId: this.loginId } : {}),
      source: "remote"
    };
  }

  describeAccountReviewLoadError(error: unknown): string {
    return error instanceof Error && error.message.trim() ? error.message : "网络暂不可用，请稍后重试。";
  }
}

export const veilRootLobbyProgressionMethods = VeilRootLobbyProgressionMethods.prototype;
