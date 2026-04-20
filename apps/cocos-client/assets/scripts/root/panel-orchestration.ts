import type { SessionUpdate } from "../VeilCocosSession.ts";
import { buildCocosAccountReviewPage } from "../cocos-account-review.ts";
import { resolveCampaignPanelMission } from "../cocos-campaign-panel.ts";
import { buildCocosEventLeaderboardPanelView } from "../cocos-event-leaderboard-panel.ts";
import type {
  CocosCampaignMissionCompleteResult,
  CocosCampaignMissionStartResult
} from "../cocos-lobby.ts";
import {
  buildCocosBattlePassPanelView,
  buildCocosDailyDungeonPanelView
} from "../cocos-progression-panel.ts";
import {
  ACCOUNT_REVIEW_PANEL_NODE_NAME,
  CAMPAIGN_PANEL_NODE_NAME,
  EQUIPMENT_PANEL_NODE_NAME
} from "./constants";
import { resolveVeilRootRuntime } from "./runtime";

type VeilRootPanelState = any;

function buildRemoteAccountSessionForRoot(state: VeilRootPanelState) {
  if (!state.authToken || state.authMode !== "account") {
    return null;
  }

  return {
    token: state.authToken,
    playerId: state.playerId,
    displayName: state.displayName || state.playerId,
    authMode: state.authMode,
    provider: state.authProvider,
    ...(state.loginId ? { loginId: state.loginId } : {}),
    source: "remote" as const
  };
}

function closeGameplayProgressionPanelsForRoot(state: VeilRootPanelState): void {
  state.gameplayAccountReviewPanelOpen = false;
  state.gameplayBattlePassPanelOpen = false;
  state.gameplayDailyDungeonPanelOpen = false;
  state.gameplaySeasonalEventPanelOpen = false;
}

export function renderGameplayEquipmentPanelForRoot(state: VeilRootPanelState): void {
  const panelNode = state.node.getChildByName(EQUIPMENT_PANEL_NODE_NAME);
  if (!panelNode) {
    return;
  }

  if (!state.gameplayEquipmentPanelOpen) {
    panelNode.active = false;
    return;
  }

  panelNode.active = true;
  state.gameplayEquipmentPanel?.render({
    hero: state.activeHero(),
    recentEventLog: state.lobbyAccountProfile.recentEventLog,
    recentSessionEvents: (state.lastUpdate?.events ?? []).filter(
      (
        event: NonNullable<SessionUpdate["events"]>[number]
      ): event is Extract<NonNullable<SessionUpdate["events"]>[number], { type: "hero.equipmentFound" }> =>
        event.type === "hero.equipmentFound"
    )
  });
}

export function renderGameplayCampaignPanelForRoot(state: VeilRootPanelState): void {
  const panelNode = state.node.getChildByName(CAMPAIGN_PANEL_NODE_NAME);
  if (!panelNode) {
    return;
  }

  if (!state.gameplayCampaignPanelOpen) {
    panelNode.active = false;
    return;
  }

  panelNode.active = true;
  state.gameplayCampaignPanel?.render({
    campaign: state.gameplayCampaign,
    selectedMissionId: state.gameplayCampaignSelectedMissionId,
    activeMissionId: state.gameplayCampaignActiveMissionId,
    dialogue: state.gameplayCampaignDialogue,
    statusMessage: state.gameplayCampaignStatus,
    loading: state.gameplayCampaignLoading,
    pendingAction: state.gameplayCampaignPendingAction
  });
}

export function renderGameplayAccountReviewPanelForRoot(state: VeilRootPanelState): void {
  const panelNode = state.node.getChildByName(ACCOUNT_REVIEW_PANEL_NODE_NAME);
  if (!panelNode) {
    return;
  }

  if (
    !state.gameplayAccountReviewPanelOpen
    && !state.gameplayBattlePassPanelOpen
    && !state.gameplayDailyDungeonPanelOpen
    && !state.gameplaySeasonalEventPanelOpen
  ) {
    panelNode.active = false;
    return;
  }

  panelNode.active = true;
  if (state.gameplayDailyDungeonPanelOpen) {
    state.gameplayAccountReviewPanel?.render({
      dailyDungeon: buildCocosDailyDungeonPanelView({
        dailyDungeon: state.dailyDungeonSummary,
        activeEvent: null,
        seasonProgress: state.seasonProgress,
        currentPlayerId: state.playerId,
        pendingFloor: state.pendingDailyDungeonFloor,
        pendingClaimRunId: state.pendingDailyDungeonClaimRunId,
        statusLabel: state.dailyDungeonStatus
      })
    });
    return;
  }

  if (state.gameplayBattlePassPanelOpen) {
    state.gameplayAccountReviewPanel?.render({
      battlePass: buildCocosBattlePassPanelView({
        progress: state.seasonProgress,
        pendingClaimTier: state.pendingSeasonClaimTier,
        pendingPremiumPurchase: state.seasonPremiumPurchaseInFlight,
        statusLabel: state.seasonProgressStatus
      })
    });
    return;
  }

  if (state.gameplaySeasonalEventPanelOpen) {
    state.gameplayAccountReviewPanel?.render({
      eventLeaderboard: buildCocosEventLeaderboardPanelView({
        event: state.activeSeasonalEvent,
        playerId: state.playerId,
        statusLabel: state.seasonalEventStatus
      })
    });
    return;
  }

  state.gameplayAccountReviewPanel?.render({
    page: buildCocosAccountReviewPage(state.lobbyAccountReviewState)
  });
}

export async function toggleGameplayAccountReviewPanelForRoot(
  state: VeilRootPanelState,
  forceOpen?: boolean
): Promise<void> {
  const nextOpen = forceOpen ?? !state.gameplayAccountReviewPanelOpen;
  state.gameplayBattlePassPanelOpen = false;
  state.gameplayDailyDungeonPanelOpen = false;
  state.gameplaySeasonalEventPanelOpen = false;
  state.gameplayCampaignPanelOpen = false;
  state.gameplayAccountReviewPanelOpen = nextOpen;
  if (!nextOpen) {
    state.renderView();
    return;
  }

  state.renderView();
  await state.refreshActiveAccountReviewSection();
}

export function snapshotSeasonProgressFromProfileForRoot(state: VeilRootPanelState) {
  return {
    battlePassEnabled: state.lastUpdate?.featureFlags?.battle_pass_enabled === true,
    seasonXp: Math.max(0, Math.floor(state.lobbyAccountProfile.seasonXp ?? 0)),
    seasonPassTier: Math.max(1, Math.floor(state.lobbyAccountProfile.seasonPassTier ?? 1)),
    seasonPassPremium: state.lobbyAccountProfile.seasonPassPremium === true,
    seasonPassClaimedTiers: state.lobbyAccountProfile.seasonPassClaimedTiers ?? []
  };
}

export async function toggleGameplayBattlePassPanelForRoot(
  state: VeilRootPanelState,
  forceOpen?: boolean
): Promise<void> {
  if (state.lastUpdate?.featureFlags?.battle_pass_enabled !== true) {
    state.gameplayBattlePassPanelOpen = false;
    state.seasonProgressStatus = "battle_pass_enabled = false";
    state.renderView();
    return;
  }

  const nextOpen = forceOpen ?? !state.gameplayBattlePassPanelOpen;
  state.gameplayAccountReviewPanelOpen = false;
  state.gameplayDailyDungeonPanelOpen = false;
  state.gameplaySeasonalEventPanelOpen = false;
  state.gameplayCampaignPanelOpen = false;
  state.gameplayBattlePassPanelOpen = nextOpen;
  if (!nextOpen) {
    state.renderView();
    return;
  }

  state.announceGameplayPanelSwitch("成长目标", "正在同步赛季通行证、长期成长与下一解锁目标。");
  state.seasonProgress = snapshotSeasonProgressFromProfileForRoot(state);
  state.renderView();
  await state.refreshSeasonProgress();
}

export async function toggleGameplayDailyDungeonPanelForRoot(
  state: VeilRootPanelState,
  forceOpen?: boolean
): Promise<void> {
  const nextOpen = forceOpen ?? !state.gameplayDailyDungeonPanelOpen;
  state.gameplayAccountReviewPanelOpen = false;
  state.gameplayBattlePassPanelOpen = false;
  state.gameplaySeasonalEventPanelOpen = false;
  state.gameplayCampaignPanelOpen = false;
  state.gameplayDailyDungeonPanelOpen = nextOpen;
  if (!nextOpen) {
    state.renderView();
    return;
  }

  state.announceGameplayPanelSwitch("今日地城", "正在同步今日轮换、剩余次数与可领取奖励。");
  state.renderView();
  await state.refreshDailyDungeonPanel();
}

export async function openLobbyPvePanelForRoot(
  state: VeilRootPanelState,
  target: "campaign" | "daily-dungeon" | "battle-pass"
): Promise<void> {
  if (state.authMode !== "account" || !state.authToken) {
    state.lobbyStatus = target === "campaign"
      ? "主线章节需要正式账号会话。"
      : target === "daily-dungeon"
        ? "每日地城需要正式账号会话。"
        : "赛季通行证需要正式账号会话。";
    state.renderView();
    return;
  }

  if (state.showLobby) {
    await state.enterLobbyRoom();
    if (state.showLobby) {
      return;
    }
  }

  if (target === "campaign") {
    await state.toggleGameplayCampaignPanel(true);
    return;
  }

  if (target === "battle-pass") {
    await state.toggleGameplayBattlePassPanel(true);
    return;
  }

  await state.toggleGameplayDailyDungeonPanel(true);
}

export async function refreshDailyDungeonPanelForRoot(
  state: VeilRootPanelState,
  successStatus?: string
): Promise<void> {
  const storage = state.readWebStorage();
  const authSession = state.currentLobbyAuthSession();
  if (!authSession?.token) {
    state.dailyDungeonSummary = null;
    state.dailyDungeonStatus = "每日地城需要有效账号会话。";
    state.renderView();
    return;
  }

  state.dailyDungeonStatus = "正在同步每日地城...";
  state.dailyDungeonLoading = true;
  state.renderView();
  let dailyDungeon = null;
  try {
    dailyDungeon = await resolveVeilRootRuntime().loadDailyDungeon(state.remoteUrl, {
      storage,
      authSession,
      throwOnError: true
    });
  } catch (error) {
    state.dailyDungeonSummary = null;
    state.dailyDungeonStatus = error instanceof Error ? error.message : "daily_dungeon_unavailable";
    state.renderView();
    return;
  } finally {
    state.dailyDungeonLoading = false;
  }

  state.dailyDungeonSummary = dailyDungeon;
  if (successStatus?.trim()) {
    state.dailyDungeonStatus = successStatus.trim();
  } else if (!dailyDungeon) {
    state.dailyDungeonStatus = "当前无法读取每日地城配置。";
  } else {
    state.dailyDungeonStatus = `剩余 ${dailyDungeon.attemptsRemaining} 次挑战。`;
  }
  state.renderView();
}

export async function toggleGameplaySeasonalEventPanelForRoot(
  state: VeilRootPanelState,
  forceOpen?: boolean
): Promise<void> {
  const nextOpen = forceOpen ?? !state.gameplaySeasonalEventPanelOpen;
  state.gameplayAccountReviewPanelOpen = false;
  state.gameplayBattlePassPanelOpen = false;
  state.gameplayDailyDungeonPanelOpen = false;
  state.gameplayCampaignPanelOpen = false;
  state.gameplaySeasonalEventPanelOpen = nextOpen;
  if (!nextOpen) {
    state.renderView();
    return;
  }

  state.renderView();
  await state.refreshActiveSeasonalEvent();
}

export async function refreshSeasonProgressForRoot(state: VeilRootPanelState): Promise<void> {
  const storage = state.readWebStorage();
  const authSession = state.currentLobbyAuthSession();
  if (!authSession?.token) {
    state.seasonProgressStatus = "赛季进度需要有效账号会话。";
    state.renderView();
    return;
  }

  state.seasonProgressStatus = "正在同步赛季进度...";
  state.renderView();
  try {
    state.seasonProgress = await resolveVeilRootRuntime().loadSeasonProgress(state.remoteUrl, {
      storage,
      authSession,
      throwOnError: true
    });
    state.seasonProgressStatus = state.seasonProgress.seasonPassPremium
      ? "高级通行证已激活，可领取高级轨道奖励。"
      : "点击金色按钮可购买高级通行证。";
  } catch (error) {
    state.seasonProgressStatus = error instanceof Error ? error.message : "season_progress_unavailable";
  }
  state.renderView();
}

export async function refreshActiveSeasonalEventForRoot(state: VeilRootPanelState): Promise<void> {
  if (!state.remoteUrl?.trim()) {
    state.activeSeasonalEvent = null;
    state.seasonalEventStatus = "赛季活动服务地址未配置。";
    state.renderView();
    return;
  }

  const storage = state.readWebStorage();
  const authSession = state.currentLobbyAuthSession();
  if (!authSession?.token) {
    state.activeSeasonalEvent = null;
    state.seasonalEventStatus = "赛季活动需要有效账号会话。";
    state.renderView();
    return;
  }

  state.seasonalEventStatus = "正在同步赛季活动...";
  state.renderView();
  try {
    const [event] = await resolveVeilRootRuntime().loadActiveSeasonalEvents(state.remoteUrl, {
      storage,
      authSession,
      throwOnError: true
    });
    state.activeSeasonalEvent = event ?? null;
    state.seasonalEventStatus = event
      ? `已同步 ${event.name} · 当前积分 ${event.player.points}`
      : "当前没有进行中的赛季活动。";
  } catch (error) {
    state.seasonalEventStatus = error instanceof Error ? error.message : "seasonal_event_unavailable";
  }
  state.renderView();
}

export async function claimGameplaySeasonTierForRoot(state: VeilRootPanelState, tier: number): Promise<void> {
  const storage = state.readWebStorage();
  const authSession = state.currentLobbyAuthSession();
  if (!authSession?.token || state.pendingSeasonClaimTier != null) {
    return;
  }

  state.pendingSeasonClaimTier = Math.max(1, Math.floor(tier));
  state.seasonProgressStatus = `正在领取 T${state.pendingSeasonClaimTier} 奖励...`;
  state.renderView();
  try {
    await resolveVeilRootRuntime().claimSeasonTier(state.remoteUrl, state.pendingSeasonClaimTier, {
      storage,
      authSession
    });
    await state.refreshLobbyAccountProfile();
    await state.refreshSeasonProgress();
    state.seasonProgressStatus = `T${state.pendingSeasonClaimTier} 奖励已领取。`;
  } catch (error) {
    state.seasonProgressStatus = error instanceof Error ? error.message : "season_claim_failed";
  } finally {
    state.pendingSeasonClaimTier = null;
    state.renderView();
  }
}

export async function purchaseGameplaySeasonPremiumForRoot(state: VeilRootPanelState): Promise<void> {
  if (state.seasonPremiumPurchaseInFlight) {
    return;
  }

  const premiumProduct =
    state.lobbyShopProducts.find((entry: { type: string; enabled: boolean }) => entry.type === "season_pass_premium" && entry.enabled)
    ?? state.lobbyShopProducts.find((entry: { productId: string }) => entry.productId === "season-pass-premium");
  if (!premiumProduct) {
    state.seasonProgressStatus = "未找到高级通行证商品配置。";
    state.renderView();
    return;
  }

  state.seasonPremiumPurchaseInFlight = true;
  state.pendingShopProductId = premiumProduct.productId;
  state.seasonProgressStatus = `正在购买 ${premiumProduct.name}...`;
  state.renderView();
  try {
    state.trackPurchaseInitiated(premiumProduct, "battle_pass");
    await resolveVeilRootRuntime().purchaseShopProduct(state.remoteUrl, premiumProduct.productId, {
      getAuthToken: () => state.authToken
    });
    await state.refreshLobbyAccountProfile();
    await state.refreshSeasonProgress();
    state.seasonProgressStatus = "高级通行证已解锁。";
  } catch (error) {
    state.seasonProgressStatus = state.describeShopError(error);
  } finally {
    state.seasonPremiumPurchaseInFlight = false;
    state.pendingShopProductId = null;
    state.renderView();
  }
}

export async function attemptGameplayDailyDungeonFloorForRoot(state: VeilRootPanelState, floor: number): Promise<void> {
  const storage = state.readWebStorage();
  const authSession = state.currentLobbyAuthSession();
  if (!authSession?.token || state.pendingDailyDungeonFloor != null || state.pendingDailyDungeonClaimRunId != null) {
    return;
  }

  state.pendingDailyDungeonFloor = Math.max(1, Math.floor(floor));
  state.dailyDungeonStatus = `正在记录第 ${state.pendingDailyDungeonFloor} 层挑战...`;
  state.renderView();
  try {
    await resolveVeilRootRuntime().attemptDailyDungeonFloor(state.remoteUrl, state.pendingDailyDungeonFloor, {
      storage,
      authSession
    });
    await state.refreshLobbyAccountProfile();
    await state.refreshDailyDungeonPanel(`第 ${state.pendingDailyDungeonFloor} 层挑战已记录，可领取对应奖励。`);
  } catch (error) {
    state.dailyDungeonStatus = error instanceof Error ? error.message : "daily_dungeon_attempt_failed";
  } finally {
    state.pendingDailyDungeonFloor = null;
    state.renderView();
  }
}

export async function claimGameplayDailyDungeonRunForRoot(state: VeilRootPanelState, runId: string): Promise<void> {
  const storage = state.readWebStorage();
  const authSession = state.currentLobbyAuthSession();
  const normalizedRunId = runId.trim();
  if (
    !authSession?.token
    || !normalizedRunId
    || state.pendingDailyDungeonFloor != null
    || state.pendingDailyDungeonClaimRunId != null
  ) {
    return;
  }

  state.pendingDailyDungeonClaimRunId = normalizedRunId;
  state.dailyDungeonStatus = "正在领取每日地城奖励...";
  state.renderView();
  try {
    await resolveVeilRootRuntime().claimDailyDungeonRunReward(state.remoteUrl, normalizedRunId, {
      storage,
      authSession
    });
    await state.refreshLobbyAccountProfile();
    await state.refreshDailyDungeonPanel("每日地城奖励已领取，活动积分已刷新。");
  } catch (error) {
    state.dailyDungeonStatus = error instanceof Error ? error.message : "daily_dungeon_claim_failed";
  } finally {
    state.pendingDailyDungeonClaimRunId = null;
    state.renderView();
  }
}

export function toggleGameplayEquipmentPanelForRoot(state: VeilRootPanelState, forceOpen?: boolean): void {
  state.gameplayEquipmentPanelOpen = forceOpen ?? !state.gameplayEquipmentPanelOpen;
  if (state.gameplayEquipmentPanelOpen) {
    state.gameplayCampaignPanelOpen = false;
    state.announceGameplayPanelSwitch("装备背包", "可以整理战利品、查看穿戴收益并准备下一次推进。");
  }
  state.renderView();
}

export async function toggleGameplayCampaignPanelForRoot(
  state: VeilRootPanelState,
  forceOpen?: boolean
): Promise<void> {
  const nextOpen = forceOpen ?? !state.gameplayCampaignPanelOpen;
  state.gameplayCampaignPanelOpen = nextOpen;
  if (!nextOpen) {
    state.gameplayCampaignDialogue = null;
    state.gameplayCampaignPendingAction = null;
    state.renderView();
    return;
  }

  closeGameplayProgressionPanelsForRoot(state);
  state.gameplayEquipmentPanelOpen = false;
  state.announceGameplayPanelSwitch("主线任务", "正在同步当前章节、下一任务和路线建议。");
  state.renderView();
  await state.refreshGameplayCampaign();
}

export function resolveSelectedGameplayCampaignMissionForRoot(state: VeilRootPanelState) {
  return resolveCampaignPanelMission(
    state.gameplayCampaign,
    state.gameplayCampaignSelectedMissionId,
    state.gameplayCampaignActiveMissionId
  );
}

export function syncGameplayCampaignSelectionForRoot(
  state: VeilRootPanelState,
  preferredMissionId?: string | null
): void {
  const missions = state.gameplayCampaign?.missions ?? [];
  const preferredId = preferredMissionId?.trim() || null;
  const campaignNextMissionId = state.gameplayCampaign?.nextMissionId ?? null;
  const nextMissionId =
    (preferredId && missions.find((mission: { id: string }) => mission.id === preferredId)?.id)
    ?? (state.gameplayCampaignActiveMissionId
      && missions.find((mission: { id: string }) => mission.id === state.gameplayCampaignActiveMissionId)?.id)
    ?? (campaignNextMissionId && missions.find((mission: { id: string }) => mission.id === campaignNextMissionId)?.id)
    ?? missions[0]?.id
    ?? null;
  state.gameplayCampaignSelectedMissionId = nextMissionId;
}

export function selectGameplayCampaignMissionForRoot(
  state: VeilRootPanelState,
  direction: "previous" | "next" | "next-available"
): void {
  const missions = state.gameplayCampaign?.missions ?? [];
  if (missions.length === 0) {
    return;
  }

  if (direction === "next-available") {
    const nextAvailableMissionId = state.gameplayCampaign?.nextMissionId;
    if (nextAvailableMissionId) {
      state.gameplayCampaignSelectedMissionId = nextAvailableMissionId;
      state.gameplayCampaignDialogue = null;
      state.renderView();
    }
    return;
  }

  const selectedMission = resolveSelectedGameplayCampaignMissionForRoot(state);
  const currentIndex = selectedMission ? missions.findIndex((mission: { id: string }) => mission.id === selectedMission.id) : 0;
  if (currentIndex < 0) {
    return;
  }

  const nextIndex = direction === "previous"
    ? Math.max(0, currentIndex - 1)
    : Math.min(missions.length - 1, currentIndex + 1);
  state.gameplayCampaignSelectedMissionId = missions[nextIndex]?.id ?? state.gameplayCampaignSelectedMissionId;
  state.gameplayCampaignDialogue = null;
  state.renderView();
}

export async function refreshGameplayCampaignForRoot(
  state: VeilRootPanelState,
  preferredMissionId?: string | null
): Promise<void> {
  const authSession = buildRemoteAccountSessionForRoot(state);
  if (!authSession) {
    state.gameplayCampaign = null;
    state.gameplayCampaignSelectedMissionId = null;
    state.gameplayCampaignActiveMissionId = null;
    state.gameplayCampaignDialogue = null;
    state.gameplayCampaignStatus = "战役模式需要正式账号会话。";
    state.renderView();
    return;
  }

  state.gameplayCampaignLoading = true;
  state.gameplayCampaignStatus = "正在同步战役任务...";
  state.renderView();
  try {
    state.gameplayCampaign = await resolveVeilRootRuntime().loadCampaignSummary(state.remoteUrl, {
      authSession
    });
    if (state.gameplayCampaignActiveMissionId) {
      const activeMission =
        state.gameplayCampaign.missions.find((mission: { id: string }) => mission.id === state.gameplayCampaignActiveMissionId) ?? null;
      if (!activeMission || activeMission.status === "completed") {
        state.gameplayCampaignActiveMissionId = null;
        state.gameplayCampaignDialogue = null;
      }
    }
    syncGameplayCampaignSelectionForRoot(state, preferredMissionId);
    state.gameplayCampaignStatus = state.gameplayCampaign.nextMissionId
      ? `下一可用任务 ${state.gameplayCampaign.nextMissionId}`
      : "当前战役线已全部完成。";
  } catch (error) {
    state.gameplayCampaignStatus = describeCampaignErrorForRoot(error);
  } finally {
    state.gameplayCampaignLoading = false;
    state.renderView();
  }
}

export function startGameplayCampaignDialogueForRoot(
  state: VeilRootPanelState,
  missionId: string,
  sequence: "intro" | "outro"
): void {
  state.gameplayCampaignDialogue = {
    missionId,
    sequence,
    lineIndex: 0
  };
}

export function advanceGameplayCampaignDialogueForRoot(state: VeilRootPanelState): void {
  const dialogue = state.gameplayCampaignDialogue;
  if (!dialogue) {
    return;
  }

  const mission = state.gameplayCampaign?.missions.find((entry: { id: string }) => entry.id === dialogue.missionId) ?? null;
  const lines = dialogue.sequence === "outro" ? mission?.outroDialogue ?? [] : mission?.introDialogue ?? [];
  const currentLine = lines[Math.min(Math.max(0, dialogue.lineIndex), lines.length - 1)] ?? null;
  if (currentLine && state.session) {
    void state.session.acknowledgeCampaignDialogue(dialogue.missionId, dialogue.sequence, currentLine.id).catch(() => undefined);
  }
  if (lines.length === 0 || dialogue.lineIndex >= lines.length - 1) {
    state.gameplayCampaignDialogue = null;
    if (dialogue.sequence === "outro") {
      state.gameplayCampaignActiveMissionId = null;
      syncGameplayCampaignSelectionForRoot(state, state.gameplayCampaign?.nextMissionId);
      state.gameplayCampaignStatus = mission ? `${mission.name} 已完成并结算。` : "任务已完成。";
    } else {
      state.gameplayCampaignPanelOpen = false;
      state.gameplayCampaignStatus = mission ? `${mission.name} 已进入执行阶段。` : "任务已开始。";
    }
    state.renderView();
    return;
  }

  state.gameplayCampaignDialogue = {
    ...dialogue,
    lineIndex: dialogue.lineIndex + 1
  };
  state.renderView();
}

export async function startGameplayCampaignMissionForRoot(state: VeilRootPanelState): Promise<void> {
  const mission = resolveSelectedGameplayCampaignMissionForRoot(state);
  const authSession = buildRemoteAccountSessionForRoot(state);
  if (!mission || !authSession) {
    return;
  }

  state.gameplayCampaignPendingAction = "start";
  state.gameplayCampaignStatus = `正在启动 ${mission.name}...`;
  state.renderView();
  try {
    const result: CocosCampaignMissionStartResult = await resolveVeilRootRuntime().startCampaignMission(
      state.remoteUrl,
      mission.chapterId,
      mission.id,
      { authSession }
    );
    state.gameplayCampaignActiveMissionId = result.mission.id;
    state.gameplayCampaignSelectedMissionId = result.mission.id;
    if ((result.mission.introDialogue?.length ?? 0) > 0) {
      startGameplayCampaignDialogueForRoot(state, result.mission.id, "intro");
    } else {
      state.gameplayCampaignDialogue = null;
      state.gameplayCampaignPanelOpen = false;
    }
    state.trackClientAnalyticsEvent("mission_started", {
      campaignId: result.mission.chapterId,
      missionId: result.mission.id,
      mapId: result.mission.mapId,
      chapterOrder: Number.parseInt(result.mission.chapterId.replace(/^chapter/i, ""), 10) || 1
    });
    await refreshGameplayCampaignForRoot(state, result.mission.id);
    state.gameplayCampaignStatus = (result.mission.introDialogue?.length ?? 0) > 0
      ? `${result.mission.name} 开场对话已载入。`
      : `${result.mission.name} 已开始。`;
  } catch (error) {
    state.gameplayCampaignStatus = describeCampaignErrorForRoot(error);
  } finally {
    state.gameplayCampaignPendingAction = null;
    state.renderView();
  }
}

export async function completeGameplayCampaignMissionForRoot(state: VeilRootPanelState): Promise<void> {
  const mission = resolveSelectedGameplayCampaignMissionForRoot(state);
  const authSession = buildRemoteAccountSessionForRoot(state);
  if (!mission || !authSession || state.gameplayCampaignActiveMissionId !== mission.id) {
    return;
  }

  state.gameplayCampaignPendingAction = "complete";
  state.gameplayCampaignStatus = `正在提交 ${mission.name} 结算...`;
  state.renderView();
  try {
    const result: CocosCampaignMissionCompleteResult = await resolveVeilRootRuntime().completeCampaignMission(
      state.remoteUrl,
      mission.id,
      { authSession }
    );
    state.gameplayCampaign = result.campaign;
    state.gameplayCampaignSelectedMissionId = result.mission.id;
    if ((result.mission.outroDialogue?.length ?? 0) > 0) {
      startGameplayCampaignDialogueForRoot(state, result.mission.id, "outro");
      state.gameplayCampaignStatus = `${result.mission.name} 结算完成，进入收尾对话。`;
    } else {
      state.gameplayCampaignActiveMissionId = null;
      syncGameplayCampaignSelectionForRoot(state, result.campaign.nextMissionId);
      state.gameplayCampaignStatus = `${result.mission.name} 已完成。`;
    }
  } catch (error) {
    state.gameplayCampaignStatus = describeCampaignErrorForRoot(error);
  } finally {
    state.gameplayCampaignPendingAction = null;
    state.renderView();
  }
}

export function describeCampaignErrorForRoot(error: unknown): string {
  if (!(error instanceof Error)) {
    return "战役请求失败。";
  }
  if (error.message.includes("campaign_mission_locked")) {
    return "任务尚未解锁，请先满足章节条件。";
  }
  if (error.message.includes("campaign_mission_already_completed")) {
    return "任务已完成，无需重复结算。";
  }
  if (error.message.includes("campaign_persistence_unavailable")) {
    return "服务端未启用战役持久化。";
  }
  if (error.message.includes("cocos_request_failed:401:")) {
    return "战役会话已过期，请重新登录正式账号。";
  }
  return error.message || "战役请求失败。";
}
