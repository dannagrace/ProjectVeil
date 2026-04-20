import { normalizeTutorialStep } from "@veil/shared/progression";
import type { TutorialProgressAction } from "@veil/shared/protocol";
import type { CocosCampaignSummary, CocosPlayerAccountProfile } from "../cocos-lobby.ts";
import type { TutorialOverlayView } from "../VeilTutorialOverlay.ts";
import { resolveCampaignPanelMission } from "../cocos-campaign-panel.ts";
import { resolveVeilRootRuntime } from "./runtime";
import type { TutorialCampaignGuidance } from "./types";

type VeilRootTutorialState = any;

export function buildTutorialOverlayViewForRoot(
  state: VeilRootTutorialState
): TutorialOverlayView | null {
  const tutorialStep = normalizeTutorialStep(state.lobbyAccountProfile.tutorialStep);
  if (tutorialStep === null || state.sessionSource !== "remote") {
    return null;
  }

  const campaignGuidance = resolveTutorialCampaignGuidanceForRoot(state);
  const mission = campaignGuidance.mission;
  const inLobby = state.showLobby;
  const stepLabel = `引导 ${tutorialStep}/3`;
  const busy = state.tutorialProgressInFlight;
  if (tutorialStep === 1) {
    return {
      badge: "初次登录",
      stepLabel,
      title: "欢迎来到 Project Veil",
      body: "先用一分钟熟悉核心节奏，再进入正式对局。",
      detailLines: [
        "世界地图是你的主舞台，侦察、招募、战斗都会在这里展开。",
        "完成引导后才会解锁每日任务，避免新号同时接收过多系统信息。",
        "前 5 场 PVP 会启用新手保护，优先避开高强度对局。"
      ],
      primaryLabel: busy ? "同步中..." : "开始引导",
      busy
    };
  }

  if (tutorialStep === 2) {
    return {
      badge: inLobby ? "出征准备" : "地图导览",
      stepLabel,
      title: inLobby ? "先进入你的第一张地图" : "留意地图、HUD 与首章目标",
      body: inLobby
        ? mission
          ? `选择一个房间进入世界，下一步我们会把你正式交给首章任务 ${mission.name}。`
          : "选择一个房间进入世界，前几步只需要专注于移动、招募和第一场战斗。"
        : mission
          ? `左侧地图、右侧 HUD 和底部时间线会一起指向首章任务 ${mission.name}，下一步就开始真正的主线推进。`
          : "左侧地图、右侧 HUD 和底部时间线会给出下一步决策线索，这就是新手阶段最重要的三个面板。",
      detailLines: inLobby
        ? [
            "房间进入后会直接落在世界地图。",
            "优先观察可移动格子、附近资源点和可交互建筑。",
            ...(mission ? [`首章目标会聚焦到 ${mission.name}。`] : []),
            "如果你已经熟悉流程，现在可以直接跳过剩余引导。"
          ]
        : [
            "先用安全操作熟悉移动反馈，再尝试资源采集或建筑互动。",
            ...(campaignGuidance.objectivePreview.length > 0
              ? [`首章任务：${campaignGuidance.objectivePreview.join(" / ")}`]
              : []),
            "PVP 新手保护仍然生效，先把开局节奏跑顺。",
            "如果你是回流玩家，可以直接跳过剩余引导。"
          ],
      primaryLabel: busy ? "同步中..." : "继续",
      ...(busy ? {} : { secondaryLabel: "跳过引导" }),
      busy
    };
  }

  return {
    badge: mission ? "首章接管" : "最终确认",
    stepLabel,
    title: mission ? `把下一步交给 ${mission.name}` : "完成引导后解锁每日任务",
    body: mission
      ? inLobby
        ? `完成引导后会直接进入房间，并把主提示切到首章任务 ${mission.name}。`
        : `完成引导后会直接聚焦到首章任务 ${mission.name}，接下来就按主线面板推进第一场战斗与结算。`
      : "最后一步会关闭引导遮罩，并按正常账户节奏开放每日任务板。",
    detailLines: mission
      ? [
          `${campaignGuidance.phaseLabel}：${mission.description}`,
          ...(campaignGuidance.objectivePreview.length > 0
            ? [`优先目标：${campaignGuidance.objectivePreview.join(" / ")}`]
            : []),
          "引导结束后每日任务与活动奖励会恢复正常曝光。"
        ]
      : [
          "每日任务会在账号快照里持续可见，不会因重连丢失。",
          "如果你愿意，也可以现在跳过并直接开始正常游玩。",
          "完成后重新进入大厅或刷新资料都会保持已完成状态。"
        ],
    primaryLabel:
      busy
        ? "同步中..."
        : mission
          ? "进入首章主线"
          : "完成引导",
    ...(busy ? {} : { secondaryLabel: "跳过引导" }),
    busy
  };
}

export function resolveTutorialCampaignGuidanceForRoot(
  state: VeilRootTutorialState
): TutorialCampaignGuidance {
  const mission = resolveTutorialGuidanceMissionForRoot(state);
  if (!mission) {
    return {
      mission: null,
      objectivePreview: [],
      phaseLabel: "主线待同步"
    };
  }

  const objectivePreview = mission.objectives
    .slice(0, 2)
    .map((objective) => objective.description.trim())
    .filter((description) => description.length > 0);
  const phaseLabel =
    state.gameplayCampaignActiveMissionId === mission.id
      ? "当前进行中"
      : state.gameplayCampaign?.nextMissionId === mission.id
        ? "下一主线"
        : mission.status === "completed"
          ? "已完成主线"
          : "首章目标";
  return {
    mission,
    objectivePreview,
    phaseLabel
  };
}

export function resolveTutorialGuidanceMissionForRoot(
  state: VeilRootTutorialState
): NonNullable<CocosCampaignSummary["missions"]>[number] | null {
  const missions = (state.gameplayCampaign?.missions ?? []) as NonNullable<CocosCampaignSummary["missions"]>;
  if (missions.length === 0) {
    return null;
  }

  return (
    resolveCampaignPanelMission(
      state.gameplayCampaign,
      state.gameplayCampaignSelectedMissionId,
      state.gameplayCampaignActiveMissionId
    )
    ?? (state.gameplayCampaign?.nextMissionId
      ? missions.find((entry: NonNullable<CocosCampaignSummary["missions"]>[number]) => entry.id === state.gameplayCampaign?.nextMissionId) ?? null
      : null)
    ?? missions.find((entry: NonNullable<CocosCampaignSummary["missions"]>[number]) => entry.status === "available")
    ?? missions[0]
    ?? null
  );
}

export async function submitTutorialProgressForRoot(
  state: VeilRootTutorialState,
  action: TutorialProgressAction
): Promise<void> {
  if (state.tutorialProgressInFlight || !state.authToken) {
    return;
  }

  state.tutorialProgressInFlight = true;
  state.renderView();
  try {
    const profile = await resolveVeilRootRuntime().updateTutorialProgress(state.remoteUrl, state.roomId, action, {
      authSession: {
        token: state.authToken,
        playerId: state.playerId,
        displayName: state.displayName || state.playerId,
        authMode: state.authMode,
        ...(state.loginId ? { loginId: state.loginId } : {}),
        source: "remote"
      },
      storage: state.readWebStorage()
    });
    state.commitAccountProfile(
      {
        ...profile,
        recentBattleReplays: profile.recentBattleReplays.length > 0
          ? profile.recentBattleReplays
          : state.lobbyAccountProfile.recentBattleReplays
      },
      false
    );
    state.pushLog(
      action.step == null
        ? action.reason === "skip"
          ? "已跳过新手引导。"
          : "新手引导已完成，每日任务已解锁。"
        : `新手引导推进至第 ${action.step} 步。`
    );
    state.trackClientAnalyticsEvent(
      "tutorial_step",
      {
        stepId:
          action.step == null
            ? action.reason === "skip"
              ? "tutorial_skipped"
              : "tutorial_completed"
            : `step_${action.step}`,
        status: action.reason === "skip" ? "skipped" : action.step == null ? "completed" : "active",
        reason: action.reason ?? "advance"
      },
      profile.lastRoomId ?? state.roomId
    );
  } finally {
    state.tutorialProgressInFlight = false;
    state.renderView();
  }
}

export async function advanceTutorialFlowForRoot(
  state: VeilRootTutorialState
): Promise<void> {
  const tutorialStep = normalizeTutorialStep(state.lobbyAccountProfile.tutorialStep);
  if (tutorialStep === null) {
    return;
  }

  const nextStep = tutorialStep >= 3 ? null : tutorialStep + 1;
  await submitTutorialProgressForRoot(state, {
    step: nextStep,
    reason: nextStep == null ? "complete" : "advance"
  });
}

export async function handleTutorialPrimaryActionForRoot(
  state: VeilRootTutorialState
): Promise<void> {
  const tutorialStep = normalizeTutorialStep(state.lobbyAccountProfile.tutorialStep);
  if (tutorialStep === null) {
    return;
  }

  if (tutorialStep < 3) {
    await advanceTutorialFlowForRoot(state);
    return;
  }

  await completeTutorialAndFocusCampaignForRoot(state);
}

export async function completeTutorialAndFocusCampaignForRoot(
  state: VeilRootTutorialState
): Promise<void> {
  const focusMissionId = resolveTutorialGuidanceMissionForRoot(state)?.id ?? null;
  await submitTutorialProgressForRoot(state, {
    step: null,
    reason: "complete"
  });

  if (state.showLobby) {
    await state.enterLobbyRoom();
  }

  if (!state.authToken || state.authMode !== "account") {
    return;
  }

  if (!state.gameplayCampaign && !state.gameplayCampaignLoading) {
    await state.refreshGameplayCampaign(focusMissionId);
  } else if (focusMissionId) {
    state.gameplayCampaignSelectedMissionId = focusMissionId;
  }

  if (state.showLobby) {
    const mission = resolveTutorialGuidanceMissionForRoot(state);
    state.gameplayCampaignStatus = mission
      ? `引导已结束，进入地图后优先推进 ${mission.name}。`
      : "引导已结束，进入地图后优先打开战役主线。";
    state.renderView();
    return;
  }

  await state.toggleGameplayCampaignPanel(true);
  const mission = resolveTutorialGuidanceMissionForRoot(state);
  state.gameplayCampaignStatus = mission
    ? `引导已移交给首章主线：${mission.name}`
    : "引导已结束，战役主线已就绪。";
  state.renderView();
}

export async function skipTutorialFlowForRoot(
  state: VeilRootTutorialState
): Promise<void> {
  const tutorialStep = normalizeTutorialStep(state.lobbyAccountProfile.tutorialStep);
  if (tutorialStep === null || tutorialStep < 2) {
    return;
  }

  await submitTutorialProgressForRoot(state, {
    step: null,
    reason: "skip"
  });
}
