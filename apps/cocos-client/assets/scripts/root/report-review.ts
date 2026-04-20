// @ts-nocheck

import {
  formatSessionSettlementReason,
  isSessionSettlementReason,
  transitionCocosAccountReviewState,
  type PlayerReportReason
} from "./deps.ts";

class VeilRootReportReviewMethods {
  [key: string]: any;
  resolveReportTarget(): { playerId: string; name: string } | null {
    const target = this.lastUpdate?.world.visibleHeroes.find((hero) => hero.playerId !== this.playerId) ?? null;
    return target ? { playerId: target.playerId, name: `${target.name} · ${target.playerId}` } : null;
  }

  resolveSurrenderTarget(): { playerId: string; name: string } | null {
    const target = this.lastUpdate?.world.visibleHeroes.find((hero) => hero.playerId !== this.playerId) ?? null;
    return target ? { playerId: target.playerId, name: `${target.name} · ${target.playerId}` } : null;
  }

  isSurrenderAvailable(): boolean {
    return Boolean(this.activeHero() && this.resolveSurrenderTarget() && !this.lastUpdate?.battle);
  }

  toggleReportDialog(): void {
    if (this.reportSubmitting) {
      return;
    }

    const target = this.resolveReportTarget();
    if (!target) {
      this.reportDialogOpen = false;
      this.reportStatusMessage = "当前没有可举报的对手。";
      this.predictionStatus = this.reportStatusMessage;
      this.renderView();
      return;
    }

    this.reportDialogOpen = !this.reportDialogOpen;
    this.reportStatusMessage = this.reportDialogOpen ? `目标 ${target.name} · ${target.playerId}` : null;
    this.renderView();
  }

  closeReportDialog(): void {
    if (this.reportSubmitting) {
      return;
    }

    this.reportDialogOpen = false;
    this.reportStatusMessage = null;
    this.renderView();
  }

  toggleSurrenderDialog(): void {
    if (this.surrenderSubmitting) {
      return;
    }

    if (!this.isSurrenderAvailable()) {
      this.surrenderDialogOpen = false;
      this.surrenderStatusMessage = "当前不满足认输条件。";
      this.predictionStatus = this.surrenderStatusMessage;
      this.renderView();
      return;
    }

    const target = this.resolveSurrenderTarget();
    this.surrenderDialogOpen = !this.surrenderDialogOpen;
    this.surrenderStatusMessage = this.surrenderDialogOpen ? `认输后将判负给 ${target?.name ?? "当前对手"}。` : null;
    this.renderView();
  }

  closeSurrenderDialog(): void {
    if (this.surrenderSubmitting) {
      return;
    }

    this.surrenderDialogOpen = false;
    this.surrenderStatusMessage = null;
    this.renderView();
  }

  async submitPlayerReport(reason: PlayerReportReason): Promise<void> {
    const target = this.resolveReportTarget();
    if (!this.session || !target) {
      this.reportDialogOpen = false;
      this.reportStatusMessage = "当前没有可举报的对手。";
      this.renderView();
      return;
    }

    this.reportSubmitting = true;
    this.reportStatusMessage = `正在举报 ${target.name}...`;
    this.renderView();

    try {
      await this.session.reportPlayer(target.playerId, reason);
      this.reportDialogOpen = false;
      this.reportStatusMessage = `已提交举报：${target.name}`;
      this.predictionStatus = "举报已提交，等待管理员审核。";
      this.pushLog(`已举报 ${target.name}：${reason}`);
    } catch (error) {
      this.reportStatusMessage = error instanceof Error
        ? error.message === "duplicate_player_report"
          ? "同一场对局中已举报过该玩家。"
          : error.message === "report_target_unavailable"
            ? "目标玩家已不在当前对局中。"
            : error.message === "reporting_unavailable"
              ? "当前服务器未启用举报存储。"
              : error.message === "report_submit_failed"
                ? "举报提交失败。"
            : "举报提交失败。"
        : "举报提交失败。";
      this.predictionStatus = this.reportStatusMessage;
    } finally {
      this.reportSubmitting = false;
      this.renderView();
    }
  }

  async confirmSurrender(): Promise<void> {
    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    const target = this.resolveSurrenderTarget();
    if (!hero || !target || this.lastUpdate?.battle) {
      this.surrenderDialogOpen = false;
      this.surrenderStatusMessage = "当前不满足认输条件。";
      this.predictionStatus = this.surrenderStatusMessage;
      this.renderView();
      return;
    }

    this.surrenderSubmitting = true;
    this.surrenderStatusMessage = `正在向 ${target.name} 提交认输...`;
    this.renderView();

    try {
      const update = await this.session.surrender(hero.id);
      await this.applySessionUpdate(update);
      if (update.reason && isSessionSettlementReason(update.reason)) {
        const message = formatSessionSettlementReason(update.reason, false);
        this.predictionStatus = message;
        this.pushLog(message);
      }
      this.surrenderDialogOpen = false;
      this.surrenderStatusMessage = "认输已提交。";
    } catch (error) {
      const failureMessage = this.describeSessionError(error, "认输失败。");
      if (error instanceof Error && error.message === "upgrade_required") {
        await this.handleForcedUpgrade(failureMessage);
        return;
      }
      this.surrenderStatusMessage = failureMessage;
      this.predictionStatus = failureMessage;
      this.pushLog(failureMessage);
    } finally {
      this.surrenderSubmitting = false;
      this.renderView();
    }
  }

  async openGameplayBattleReportCenter(): Promise<void> {
    this.announceGameplayPanelSwitch("战报回看", "正在打开最近一战与完整战报页，方便决定下一局路线。");
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "section.selected",
      section: "battle-replays"
    });
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "battle-replay.selected",
      replayId: this.lobbyAccountProfile.battleReportCenter?.latestReportId ?? this.lobbyAccountReviewState.selectedBattleReplayId
    });
    await this.toggleGameplayAccountReviewPanel(true);
  }

  announceGameplayPanelSwitch(title: string, detail: string): void {
    this.predictionStatus = `已切到${title}：${detail}`;
    this.pushLog(`已切到${title}：${detail}`);
  }
}

export const veilRootReportReviewMethods = VeilRootReportReviewMethods.prototype;
