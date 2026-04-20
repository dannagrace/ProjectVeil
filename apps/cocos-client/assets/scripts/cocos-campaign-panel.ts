import type { CampaignMissionState, CampaignReward } from "./project-shared/models.ts";
import type { DialogueLine } from "./project-shared/campaign.ts";
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
  chapterAtlasLines: string[];
  missionLines: string[];
  objectiveLines: string[];
  rewardLines: string[];
  dialogueLines: string[];
  statusLines: string[];
  actions: CocosCampaignPanelActionView[];
}

function parseCampaignChapterOrder(chapterId: string | null | undefined): number | null {
  const matched = /chapter-?(\d+)/i.exec(chapterId?.trim() ?? "");
  if (!matched) {
    return null;
  }

  const value = Number(matched[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatCampaignChapterLabel(chapterId: string | null | undefined): string {
  const order = parseCampaignChapterOrder(chapterId);
  return order ? `第 ${order} 章` : (chapterId?.trim() || "未知章节");
}

function resolveCurrentChapterMissions(
  campaign: CocosCampaignSummary | null,
  mission: CampaignMissionState | null
): CampaignMissionState[] {
  const chapterId = mission?.chapterId ?? null;
  if (!campaign || !chapterId) {
    return [];
  }
  return campaign.missions.filter((entry) => entry.chapterId === chapterId);
}

function resolveNextRouteMission(
  campaign: CocosCampaignSummary | null,
  mission: CampaignMissionState | null
): CampaignMissionState | null {
  if (!campaign || !mission) {
    return null;
  }

  const missions = campaign.missions;
  const nextMission = campaign.nextMissionId
    ? missions.find((entry) => entry.id === campaign.nextMissionId) ?? null
    : null;
  if (nextMission) {
    return nextMission;
  }

  const currentIndex = missions.findIndex((entry) => entry.id === mission.id);
  if (currentIndex >= 0) {
    return missions.slice(currentIndex + 1).find((entry) => entry.status !== "completed") ?? null;
  }

  return missions.find((entry) => entry.status !== "completed") ?? null;
}

function formatUnlockRequirementSummary(mission: CampaignMissionState | null): string | null {
  const unmet = mission?.unlockRequirements?.filter((entry) => entry.satisfied !== true) ?? [];
  if (unmet.length === 0) {
    return null;
  }
  return unmet.map((entry) => entry.description).join(" / ");
}

function formatObjectiveKindLabel(kind: CampaignMissionState["objectives"][number]["kind"]): string {
  switch (kind) {
    case "capture":
      return "夺点";
    case "defeat":
      return "击破";
    case "escort":
      return "护送";
    case "hold":
      return "坚守";
    default:
      return kind;
  }
}

function summarizeChapterObjectiveKinds(missions: CampaignMissionState[]): string {
  const kinds = new Set<string>();
  for (const mission of missions) {
    for (const objective of mission.objectives) {
      kinds.add(formatObjectiveKindLabel(objective.kind));
    }
  }

  return kinds.size > 0 ? [...kinds].slice(0, 3).join(" / ") : "探索推进";
}

function summarizeChapterRewardFocus(missions: CampaignMissionState[]): string {
  let gemCount = 0;
  let goldCount = 0;
  let woodCount = 0;
  let oreCount = 0;
  let cosmeticCount = 0;
  for (const mission of missions) {
    gemCount += mission.reward.gems ?? 0;
    goldCount += mission.reward.resources?.gold ?? 0;
    woodCount += mission.reward.resources?.wood ?? 0;
    oreCount += mission.reward.resources?.ore ?? 0;
    if (mission.reward.cosmeticId) {
      cosmeticCount += 1;
    }
  }

  const focus: string[] = [];
  if (gemCount > 0) {
    focus.push("宝石");
  }
  if (goldCount >= Math.max(woodCount, oreCount) && goldCount > 0) {
    focus.push("金币");
  }
  if (woodCount > goldCount && woodCount >= oreCount) {
    focus.push("木材");
  }
  if (oreCount > goldCount && oreCount > woodCount) {
    focus.push("矿石");
  }
  if (cosmeticCount > 0) {
    focus.push("外观");
  }

  return focus.length > 0 ? focus.join(" / ") : "章节奖励待同步";
}

function resolveNextChapterMission(
  campaign: CocosCampaignSummary | null,
  mission: CampaignMissionState | null
): CampaignMissionState | null {
  if (!campaign || !mission) {
    return null;
  }

  const currentChapterOrder = parseCampaignChapterOrder(mission.chapterId) ?? 0;
  return (
    campaign.missions.find((entry) => (parseCampaignChapterOrder(entry.chapterId) ?? 0) > currentChapterOrder)
    ?? null
  );
}

function buildChapterAtlasLines(
  campaign: CocosCampaignSummary | null,
  mission: CampaignMissionState | null
): string[] {
  if (!campaign || !mission) {
    return ["章节图谱待同步", "加载战役数据后会展示章节差异与路线密度。"];
  }

  const currentChapterMissions = resolveCurrentChapterMissions(campaign, mission);
  const nextChapterMission = resolveNextChapterMission(campaign, mission);
  const nextChapterMissions = nextChapterMission
    ? campaign.missions.filter((entry) => entry.chapterId === nextChapterMission.chapterId)
    : [];
  const recommendedLevels = currentChapterMissions.map((entry) => entry.recommendedHeroLevel);
  const currentMinLevel = recommendedLevels.length > 0 ? Math.min(...recommendedLevels) : mission.recommendedHeroLevel;
  const currentMaxLevel = recommendedLevels.length > 0 ? Math.max(...recommendedLevels) : mission.recommendedHeroLevel;
  const currentBossCount = currentChapterMissions.filter((entry) => Boolean(entry.bossEncounterName)).length;
  const nextUnlockSummary = nextChapterMission ? formatUnlockRequirementSummary(nextChapterMission) : null;

  return [
    `${formatCampaignChapterLabel(mission.chapterId)} · ${currentChapterMissions.length} 个任务 · 推荐等级 ${currentMinLevel}-${currentMaxLevel}`,
    `章节节奏 ${summarizeChapterObjectiveKinds(currentChapterMissions)} · ${currentBossCount > 0 ? `首领战 ${currentBossCount} 场` : "前线遭遇推进"}`,
    `章节收益 ${summarizeChapterRewardFocus(currentChapterMissions)}`,
    nextChapterMission
      ? `下一章节 ${formatCampaignChapterLabel(nextChapterMission.chapterId)} · ${nextChapterMissions.length} 个任务 · 首站 ${nextChapterMission.name}`
      : "下一章节 当前主线已推进到末端章节",
    nextUnlockSummary ? `开启条件 ${nextUnlockSummary}` : "开启条件 当前已满足后续章节门槛"
  ];
}

function buildCampaignRouteLines(
  campaign: CocosCampaignSummary | null,
  mission: CampaignMissionState | null,
  activeMission: CampaignMissionState | null
): string[] {
  if (!campaign || !mission) {
    return ["战役数据未加载", "请稍后重试。"];
  }

  const currentChapterMissions = resolveCurrentChapterMissions(campaign, mission);
  const completedInChapter = currentChapterMissions.filter((entry) => entry.status === "completed").length;
  const nextRouteMission = resolveNextRouteMission(campaign, mission);
  const lockedFollowupMission =
    currentChapterMissions.find((entry) => entry.order > mission.order && entry.status === "locked")
    ?? campaign.missions.find(
      (entry) =>
        entry.status === "locked"
        && parseCampaignChapterOrder(entry.chapterId) != null
        && (parseCampaignChapterOrder(entry.chapterId) ?? 0) >= (parseCampaignChapterOrder(mission.chapterId) ?? 0)
    )
    ?? null;

  return [
    `${formatCampaignChapterLabel(mission.chapterId)} · 已完成 ${completedInChapter}/${Math.max(1, currentChapterMissions.length)}`,
    nextRouteMission
      ? `路线下一步 ${formatCampaignChapterLabel(nextRouteMission.chapterId)} / ${nextRouteMission.name}`
      : "路线下一步 当前战役线已全部完成",
    lockedFollowupMission
      ? `后续解锁 ${lockedFollowupMission.name} · ${formatUnlockRequirementSummary(lockedFollowupMission) ?? "满足前置后开启"}`
      : "后续解锁 当前章节之后暂无额外门槛",
    activeMission ? `进行中 ${activeMission.name}` : "进行中 当前没有已启动任务"
  ];
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
    ? mission
      ? [...buildCampaignRouteLines(input.campaign, mission, activeMission), `聚焦 ${mission.chapterId} / ${mission.name}`]
      : ["战役数据未加载", input.statusMessage || "请稍后重试。"]
    : ["战役数据未加载", input.statusMessage || "请稍后重试。"];
  const chapterAtlasLines = buildChapterAtlasLines(input.campaign, mission);

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
    chapterAtlasLines,
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
