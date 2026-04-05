import type { CampaignMissionState, CampaignReward, DialogueLine } from "./project-shared/index.ts";
import type { CocosCampaignSummary } from "./cocos-lobby.ts";

export interface CocosCampaignDialogueState {
  missionId: string;
  sequence: "intro" | "outro";
  lineIndex: number;
}

export interface CocosCampaignPanelInput {
  campaign: CocosCampaignSummary | null;
  selectedMissionId: string | null;
  activeMissionId: string | null;
  dialogue: CocosCampaignDialogueState | null;
  statusMessage: string;
  loading: boolean;
  pendingAction: "start" | "complete" | null;
}

export interface CocosCampaignPanelActionView {
  id: "close" | "refresh" | "prev" | "next" | "focus-next" | "start" | "advance-dialogue" | "complete";
  label: string;
  enabled: boolean;
}

export interface CocosCampaignPanelView {
  title: string;
  subtitle: string;
  progressLines: string[];
  missionLines: string[];
  objectiveLines: string[];
  rewardLines: string[];
  dialogueLines: string[];
  statusLines: string[];
  actions: CocosCampaignPanelActionView[];
}

function formatMissionStatus(status: CampaignMissionState["status"]): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "available":
      return "可进行";
    default:
      return "未解锁";
  }
}

function formatDialogueSequenceLabel(sequence: CocosCampaignDialogueState["sequence"]): string {
  return sequence === "outro" ? "结算对话" : "开场对话";
}

function formatRewardLines(reward: CampaignReward): string[] {
  const lines = [
    reward.gems ? `宝石 +${Math.max(0, Math.floor(reward.gems))}` : "",
    reward.resources?.gold ? `金币 +${Math.max(0, Math.floor(reward.resources.gold))}` : "",
    reward.resources?.wood ? `木材 +${Math.max(0, Math.floor(reward.resources.wood))}` : "",
    reward.resources?.ore ? `矿石 +${Math.max(0, Math.floor(reward.resources.ore))}` : "",
    reward.cosmeticId ? `外观 ${reward.cosmeticId}` : ""
  ].filter(Boolean);
  return lines.length > 0 ? lines : ["暂无额外奖励"];
}

function resolveDialogueLines(
  mission: CampaignMissionState | null,
  dialogue: CocosCampaignDialogueState | null
): DialogueLine[] {
  if (!mission || !dialogue || dialogue.missionId !== mission.id) {
    return [];
  }

  return dialogue.sequence === "outro" ? mission.outroDialogue ?? [] : mission.introDialogue ?? [];
}

export function resolveCampaignPanelMission(
  campaign: CocosCampaignSummary | null,
  selectedMissionId: string | null,
  activeMissionId: string | null
): CampaignMissionState | null {
  const missions = campaign?.missions ?? [];
  if (missions.length === 0) {
    return null;
  }

  return (
    missions.find((mission) => mission.id === selectedMissionId)
    ?? missions.find((mission) => mission.id === activeMissionId)
    ?? missions.find((mission) => mission.id === campaign?.nextMissionId)
    ?? missions[0]
    ?? null
  );
}

export function buildCocosCampaignPanelView(input: CocosCampaignPanelInput): CocosCampaignPanelView {
  const mission = resolveCampaignPanelMission(input.campaign, input.selectedMissionId, input.activeMissionId);
  const missions = input.campaign?.missions ?? [];
  const missionIndex = mission ? missions.findIndex((entry) => entry.id === mission.id) : -1;
  const dialogueLines = resolveDialogueLines(mission, input.dialogue);
  const currentDialogueLine =
    input.dialogue && dialogueLines.length > 0
      ? dialogueLines[Math.min(Math.max(0, input.dialogue.lineIndex), dialogueLines.length - 1)] ?? null
      : null;
  const activeMission = input.activeMissionId ? missions.find((entry) => entry.id === input.activeMissionId) ?? null : null;

  const subtitle = input.campaign
    ? `完成 ${input.campaign.completedCount}/${input.campaign.totalMissions} · ${input.campaign.completionPercent}%`
    : input.loading
      ? "正在同步战役面板..."
      : "需要正式账号会话才能读取战役进度。";

  const progressLines = input.campaign
    ? [
        input.campaign.nextMissionId ? `下一任务 ${input.campaign.nextMissionId}` : "下一任务 当前战役线已全部完成",
        activeMission ? `进行中 ${activeMission.name}` : "进行中 当前没有已启动任务",
        mission ? `聚焦 ${mission.chapterId} / ${mission.name}` : "聚焦 等待任务数据"
      ]
    : ["战役数据未加载", input.statusMessage || "请稍后重试。"];

  const missionLines = mission
    ? [
        `${mission.name} · ${formatMissionStatus(mission.status)}`,
        `章节 ${mission.chapterId} · 推荐等级 ${mission.recommendedHeroLevel} · 尝试 ${mission.attempts}`,
        mission.description,
        mission.bossEncounterName ? `首领 ${mission.bossEncounterName}` : `敌军模板 ${mission.enemyArmyTemplateId} x${mission.enemyArmyCount}`,
        mission.status === "locked" && mission.unlockRequirements && mission.unlockRequirements.length > 0
          ? `解锁条件 ${mission.unlockRequirements.filter((entry) => entry.satisfied !== true).map((entry) => entry.description).join(" / ")}`
          : mission.completedAt
            ? `完成于 ${mission.completedAt}`
            : "已满足当前章节条件。"
      ]
    : ["当前没有可展示的任务。"];

  const objectiveLines = mission
    ? mission.objectives.map((objective, index) => {
        const gate = objective.gate === "mid" ? "中段" : objective.gate === "end" ? "结算" : "开场";
        const optionalLabel = objective.optional ? "可选" : "必做";
        return `${index + 1}. [${gate}/${optionalLabel}] ${objective.description}`;
      })
    : ["等待任务目标。"];

  const dialogueCardLines =
    currentDialogueLine
      ? [
          `${formatDialogueSequenceLabel(input.dialogue!.sequence)} ${input.dialogue!.lineIndex + 1}/${dialogueLines.length}`,
          `${currentDialogueLine.speakerName}${currentDialogueLine.mood ? ` · ${currentDialogueLine.mood}` : ""}`,
          currentDialogueLine.text
        ]
      : mission
        ? ["当前没有待播放的任务对话。"]
        : ["等待任务对话。"];

  const statusLines = [
    input.statusMessage || "战役面板已就绪。",
    missionIndex >= 0 ? `任务序号 ${missionIndex + 1}/${missions.length}` : "任务序号 暂无",
    input.pendingAction === "start"
      ? "正在提交任务启动..."
      : input.pendingAction === "complete"
        ? "正在提交任务完成..."
        : input.loading
          ? "同步中..."
          : "等待下一步操作。"
  ];

  const canStart = Boolean(
    mission
      && mission.status === "available"
      && !input.dialogue
      && input.pendingAction === null
      && input.activeMissionId !== mission.id
  );
  const canComplete = Boolean(
    mission
      && mission.status !== "completed"
      && input.activeMissionId === mission.id
      && !input.dialogue
      && input.pendingAction === null
  );
  const hasDialogue = Boolean(currentDialogueLine);

  return {
    title: "战役任务",
    subtitle,
    progressLines,
    missionLines,
    objectiveLines,
    rewardLines: mission ? formatRewardLines(mission.reward) : ["等待任务奖励。"],
    dialogueLines: dialogueCardLines,
    statusLines,
    actions: [
      { id: "close", label: "关闭", enabled: true },
      { id: "refresh", label: input.loading ? "同步中" : "刷新", enabled: !input.loading && input.pendingAction === null },
      {
        id: "prev",
        label: "上一任务",
        enabled: Boolean(!input.dialogue && missionIndex > 0)
      },
      {
        id: "next",
        label: "下一任务",
        enabled: Boolean(!input.dialogue && missionIndex >= 0 && missionIndex < missions.length - 1)
      },
      {
        id: "focus-next",
        label: "聚焦下一可用",
        enabled: Boolean(!input.dialogue && input.campaign?.nextMissionId && input.campaign.nextMissionId !== mission?.id)
      },
      { id: "start", label: "开始任务", enabled: canStart },
      {
        id: "advance-dialogue",
        label: hasDialogue ? "下一句" : "对话结束",
        enabled: Boolean(hasDialogue && input.pendingAction === null)
      },
      { id: "complete", label: "完成任务", enabled: canComplete }
    ]
  };
}
