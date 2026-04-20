// @ts-nocheck

import {
  buildPrimaryClientTelemetryFromUpdate,
  buildTimelineEntriesFromUpdate,
  buildCocosProfileNotice,
  buildHeroProgressNotice,
  buildMapFeedbackEntriesFromUpdate,
  buildObjectPulseEntriesFromUpdate,
  collectProfileNoticeEventIds,
  createPrimaryClientTelemetryEvent,
  describeSessionActionOutcome,
  formatSessionSettlementReason,
  isSessionSettlementReason,
  normalizeTutorialStep,
  predictPlayerWorldAction,
  shouldRefreshGameplayAccountProfileForEvents,
  transitionCocosAccountReviewState,
  type BattleAction,
  type ConnectionEvent,
  type HeroView,
  type SessionUpdate,
  type VeilHudRenderState,
  type CocosWorldAction
} from "./deps.ts";
import { BATTLE_FEEDBACK_DURATION_MS } from "./constants";
import {
  buildBattleSettlementRecoveryStateForRoot,
  buildHudPresentationStateForRoot,
  buildHudSessionIndicatorsForRoot
} from "./render-state-composer.ts";
import { cloneSessionUpdate, collapseAdjacentEntries } from "./session-helpers.ts";
import { resolveVeilRootRuntime } from "./runtime.ts";

class VeilRootBattleSessionUpdateMethods {
  [key: string]: any;
  pushSessionActionOutcome(
    update: SessionUpdate,
    options: {
      successMessage: string;
      rejectedLabel: string;
    }
  ): void {
    const outcome = describeSessionActionOutcome(update, options);
    this.pushLog(outcome.message);
    if (!outcome.accepted) {
      this.predictionStatus = outcome.message;
      this.mapBoard?.playHeroAnimation("hit");
    }
  }

  handleConnectionEvent(event: ConnectionEvent): void {
    this.diagnosticsConnectionStatus =
      event === "reconnecting" ? "reconnecting" : event === "reconnected" ? "connected" : "reconnect_failed";
    if (event === "reconnect_failed") {
      this.reportClientRuntimeError({
        errorCode: "session_disconnect",
        severity: "error",
        stage: "reconnect",
        recoverable: true,
        message: "Client reconnect failed; falling back to room snapshot recovery."
      });
    }
    const activePvpBattle = Boolean(this.lastUpdate?.battle?.defenderHeroId);
    const label =
      event === "reconnecting"
        ? activePvpBattle
          ? "PVP 遭遇连接已中断，正在尝试重连..."
          : "连接已中断，正在尝试重连..."
        : event === "reconnected"
          ? activePvpBattle
            ? "PVP 遭遇连接已恢复。"
            : "连接已恢复。"
          : activePvpBattle
            ? "PVP 遭遇重连失败，正在尝试恢复房间快照..."
            : "重连失败，正在尝试恢复房间快照...";
    if (this.showLobby) {
      this.lobbyStatus = label;
    }
    this.pushLog(label);
    this.renderView();
  }

  async actInBattle(action: BattleAction): Promise<void> {
    if (!this.session || this.battleActionInFlight) {
      return;
    }
     this.battleActionInFlight = true;
    const actionPresentation = this.battlePresentation.previewAction(action, this.lastUpdate?.battle ?? null);
    const skillName =
      action.type === "battle.skill"
        ? this.lastUpdate?.battle?.units[action.unitId]?.skills?.find((skill) => skill.id === action.skillId)?.name ?? action.skillId
        : null;
    const actionLabel =
      action.type === "battle.attack"
        ? "攻击"
        : action.type === "battle.wait"
          ? "等待"
          : action.type === "battle.defend"
            ? "防御"
            : skillName ?? "技能";
    this.pushLog(`战斗指令：${actionLabel}`);
    this.emitPrimaryClientTelemetry(
      createPrimaryClientTelemetryEvent(this.createTelemetryContext(this.activeHero()?.id ?? null), {
        category: "combat",
        checkpoint: "command.submitted",
        status: "info",
        detail: `Battle command submitted: ${actionLabel}.`,
        ...(this.lastUpdate?.battle?.id ? { battleId: this.lastUpdate.battle.id } : {})
      })
    );
    this.setBattleFeedback(actionPresentation.feedback);
    if (actionPresentation.cue) {
      this.audioRuntime.playCue(actionPresentation.cue);
    }
    this.renderView();
     try {
      if (actionPresentation.animation !== "idle") {
        this.mapBoard?.playHeroAnimation(actionPresentation.animation);
      }
       const update = await this.session.actInBattle(action);
      await this.applySessionUpdate(update);
      if (update.reason) {
        this.pushSessionActionOutcome(update, {
          successMessage: "战斗指令已结算。",
          rejectedLabel: "战斗指令"
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "battle_action_failed";
      const detail = error instanceof Error ? error.message : "战斗操作失败。";
      this.pushLog(detail);
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(this.activeHero()?.id ?? null), {
          category: "combat",
          checkpoint: "command.rejected",
          status: "failure",
          detail,
          reason,
          ...(this.lastUpdate?.battle?.id ? { battleId: this.lastUpdate.battle.id } : {})
        })
      );
      this.mapBoard?.playHeroAnimation("hit");
    } finally {
      this.battleActionInFlight = false;
      this.renderView();
    }
  }

  async applySessionUpdate(update: SessionUpdate): Promise<void> {
    const previousBattle = this.lastUpdate?.battle ?? null;
    const heroId = this.activeHero()?.id ?? null;
    const presentation = this.battlePresentation.applyUpdate(previousBattle, update, heroId);
    this.captureBattleSettlementSnapshot(update, presentation.state);
     this.pendingPrediction = null;
    this.predictionStatus = "";
    this.surrenderDialogOpen = false;
    this.surrenderStatusMessage = null;
    this.diagnosticsConnectionStatus = "connected";
    this.lastRoomUpdateSource = "session";
    this.lastRoomUpdateReason = update.reason ?? "snapshot";
    this.lastRoomUpdateAtMs = Date.now();
    this.lastUpdate = update;
    this.maybeOpenGameplayEquipmentPanelForLoot(update);
    const eventEntries = buildTimelineEntriesFromUpdate(update);
    if (eventEntries.length > 0) {
      this.timelineEntries = collapseAdjacentEntries([...eventEntries, ...this.timelineEntries]).slice(0, 12);
    }
    this.emitPrimaryClientTelemetry(
      buildPrimaryClientTelemetryFromUpdate(update, this.createTelemetryContext(heroId))
    );
    for (const event of update.events) {
      const ownsEventHero =
        "heroId" in event && typeof event.heroId === "string"
          ? update.world.ownHeroes.some((hero) => hero.id === event.heroId)
          : false;
       if (event.type === "battle.started" && ownsEventHero) {
        this.trackClientAnalyticsEvent("battle_start", {
          roomId: update.world.meta.roomId,
          battleId: event.battleId,
          encounterKind: event.encounterKind,
          heroId: event.heroId
        }, update.world.meta.roomId);
      }
       if (event.type === "battle.resolved" && ownsEventHero) {
        this.trackClientAnalyticsEvent("battle_end", {
          roomId: update.world.meta.roomId,
          battleId: event.battleId,
          result: event.result,
          heroId: event.heroId,
          battleKind: "battleKind" in event && (event.battleKind === "neutral" || event.battleKind === "hero")
            ? event.battleKind
            : previousBattle?.defenderHeroId
              ? "hero"
              : "neutral"
        }, update.world.meta.roomId);
      }
    }
    if (update.events.some((event) => event.type === "battle.resolved")) {
      this.syncGameplayCampaignBattleOutcome(update);
      void this.submitBattleProgressForActiveEvents(update);
    }
    if (shouldRefreshGameplayAccountProfileForEvents(update.events.map((event) => event.type))) {
      void this.refreshGameplayAccountProfile();
    }
    this.syncSelectedBattleTarget();
    this.renderView();
    if (presentation.pauseDurationMs) {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, presentation.pauseDurationMs ?? 0);
      });
    }
    this.playMapFeedbackForUpdate(update);
    this.maybeShowHeroProgressNotice(update);
    this.setBattleFeedback(presentation.feedback, presentation.feedbackDurationMs ?? BATTLE_FEEDBACK_DURATION_MS);
    if (presentation.cue) {
      this.audioRuntime.playCue(presentation.cue);
    }
    this.mapBoard?.playHeroAnimation(presentation.animation);
     if (update.reason && isSessionSettlementReason(update.reason)) {
      this.predictionStatus = formatSessionSettlementReason(update.reason, !this.surrenderSubmitting);
    }
     if (presentation.transition?.kind === "enter") {
      await this.battleTransition?.playEnter(presentation.transition.copy);
    } else if (presentation.transition?.kind === "exit") {
      await this.battleTransition?.playExit(presentation.transition.copy);
    }
     this.syncWechatShareBridge();
    this.renderView();
  }

  maybeOpenGameplayEquipmentPanelForLoot(update: SessionUpdate): void {
    if (this.showLobby || update.battle) {
      return;
    }
     const controlledHeroIds = new Set(update.world.ownHeroes.map((hero) => hero.id));
    const hasOwnedLoot = update.events.some(
      (event) => event.type === "hero.equipmentFound" && controlledHeroIds.has(event.heroId)
    );
    if (!hasOwnedLoot) {
      return;
    }
     this.gameplayEquipmentPanelOpen = true;
    this.gameplayCampaignPanelOpen = false;
  }

  async refreshGameplayAccountProfile(): Promise<void> {
    if (this.gameplayAccountRefreshInFlight) {
      return;
    }
     if (this.sessionSource !== "remote") {
      return;
    }
     if (!this.remoteUrl?.trim()) {
      return;
    }
     this.gameplayAccountRefreshInFlight = true;
    try {
      const authSession = this.authToken
        ? {
            token: this.authToken,
            playerId: this.playerId,
            displayName: this.displayName || this.playerId,
            authMode: this.authMode,
            ...(this.loginId ? { loginId: this.loginId } : {}),
            source: "remote" as const
          }
        : null;
      const [profile, activeEvents] = await Promise.all([
        resolveVeilRootRuntime().loadAccountProfile(this.remoteUrl, this.playerId, this.roomId, {
          storage: this.readWebStorage(),
          authSession
        }),
        authSession?.token
          ? resolveVeilRootRuntime().loadActiveSeasonalEvents(this.remoteUrl, {
              storage: this.readWebStorage(),
              authSession
            })
          : Promise.resolve([])
      ]);
      this.commitAccountProfile(profile, true);
      this.activeSeasonalEvent = activeEvents[0] ?? null;
      if (this.activeSeasonalEvent) {
        this.seasonalEventStatus = `已同步 ${this.activeSeasonalEvent.name} · 当前积分 ${this.activeSeasonalEvent.player.points}`;
      }
      this.renderView();
    } finally {
      this.gameplayAccountRefreshInFlight = false;
    }
  }

  maybeShowHeroProgressNotice(update: SessionUpdate): void {
    const heroId = update.world.ownHeroes[0]?.id ?? null;
    const notice = buildHeroProgressNotice(update, heroId);
    if (!notice) {
      return;
    }
     this.levelUpNotice = {
      ...notice,
      expiresAt: Date.now() + 5000
    };
    this.pushLog(`${notice.title}。${notice.detail}`);
    this.mapBoard?.playHeroAnimation("victory");
    this.audioRuntime.playCue("level_up");
  }

  commitAccountProfile(profile: CocosPlayerAccountProfile, allowAchievementNotice: boolean): void {
    const previousProfile = this.lobbyAccountProfile;
    if (profile.playerId !== this.lobbyAccountProfile.playerId) {
      this.seenProfileNoticeEventIds.clear();
    }
     if (allowAchievementNotice) {
      const notice = buildCocosProfileNotice(profile.recentEventLog, this.seenProfileNoticeEventIds);
      if (notice) {
        this.achievementNotice = {
          ...notice,
          expiresAt: Date.now() + 4000
        };
        this.pushLog(`${notice.title}：${notice.detail}`);
      }
    }
     for (const eventId of collectProfileNoticeEventIds(profile.recentEventLog)) {
      this.seenProfileNoticeEventIds.add(eventId);
    }
     this.lobbyAccountProfile = profile;
    this.maybeEmitExperimentExposureAnalytics(profile);
    this.maybeEmitQuestCompleteAnalytics(previousProfile, profile);
    this.seasonProgress = this.snapshotSeasonProgressFromProfile();
    if (
      this.sessionSource === "remote"
      && this.authMode === "account"
      && this.authToken
      && normalizeTutorialStep(profile.tutorialStep) !== null
      && !this.gameplayCampaign
      && !this.gameplayCampaignLoading
    ) {
      void this.refreshGameplayCampaign();
    }
    if (
      this.showLobby
      && this.sessionSource === "remote"
      && this.authMode === "account"
      && this.authToken
      && !this.dailyDungeonSummary
      && !this.dailyDungeonLoading
    ) {
      void this.refreshDailyDungeonPanel();
    }
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "account.synced",
      account: profile
    });
  }

  playMapFeedbackForUpdate(update: SessionUpdate): void {
    const heroId = update.world.ownHeroes[0]?.id;
    if (!heroId) {
      return;
    }
     for (const entry of buildMapFeedbackEntriesFromUpdate(update, heroId)) {
      this.mapBoard?.showTileFeedback(entry.position, entry.text, entry.durationSeconds);
    }
     for (const entry of buildObjectPulseEntriesFromUpdate(update, heroId)) {
      this.mapBoard?.pulseObject(entry.position, entry.scale, entry.durationSeconds);
    }
  }

  applyReplayedSessionUpdate(update: SessionUpdate): void {
    this.pendingPrediction = null;
    this.predictionStatus = "已回放缓存状态，等待房间同步...";
    this.lastRoomUpdateSource = "replay";
    this.lastRoomUpdateReason = "cached_snapshot";
    this.lastRoomUpdateAtMs = Date.now();
    this.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
    this.renderView();
  }

  buildBattleSettlementRecoveryState(): {
    title: string;
    detail: string;
    badge: string;
    tone: CocosBattleFeedbackView["tone"];
    summaryLines: string[];
  } | null {
    return buildBattleSettlementRecoveryStateForRoot(this as unknown as Record<string, any>);
  }

  captureBattleSettlementSnapshot(
    update: SessionUpdate,
    presentationState: CocosBattlePresentationState
  ): void {
    if (update.battle) {
      this.lastBattleSettlementSnapshot = null;
      return;
    }
     if (presentationState.phase === "resolution") {
      this.lastBattleSettlementSnapshot = {
        label: presentationState.label,
        detail: presentationState.detail,
        badge: presentationState.badge,
        tone: presentationState.tone,
        summaryLines: presentationState.summaryLines
      };
    }
  }

  buildHudSessionIndicators(): VeilHudRenderState["sessionIndicators"] {
    return buildHudSessionIndicatorsForRoot(this as unknown as Record<string, any>);
  }

  applyPrediction(action: CocosWorldAction, status: string): void {
    if (!this.lastUpdate) {
      return;
    }
     const prediction = predictPlayerWorldAction(this.lastUpdate.world, action);
    if (prediction.reason) {
      return;
    }
     if (!this.pendingPrediction) {
      this.pendingPrediction = cloneSessionUpdate(this.lastUpdate);
    }
     this.lastUpdate = {
      ...this.lastUpdate,
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles
    };
    this.predictionStatus = status;
  }

  rollbackPrediction(reason?: string): void {
    if (this.pendingPrediction) {
      this.lastUpdate = this.pendingPrediction;
      this.pendingPrediction = null;
    }
     this.predictionStatus = "";
    if (reason) {
      this.pushLog(reason);
      this.mapBoard?.playHeroAnimation("hit");
    }
     this.renderView();
  }

  buildHudPresentationState(): VeilHudRenderState["presentation"] {
    return buildHudPresentationStateForRoot(this as unknown as Record<string, any>);
  }
}

export const veilRootBattleSessionUpdateMethods = VeilRootBattleSessionUpdateMethods.prototype;
