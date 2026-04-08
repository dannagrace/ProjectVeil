import type { DailyQuestBoard, DailyQuestProgress } from "./project-shared/daily-quests.ts";

export interface CocosDailyQuestActionView {
  questId: string;
  label: string;
  enabled: boolean;
}

export interface CocosDailyQuestLineView {
  questId: string;
  title: string;
  detail: string;
  progressLabel: string;
  rewardLabel: string;
  stateLabel: string;
  action: CocosDailyQuestActionView | null;
}

export interface CocosDailyQuestPanelView {
  title: string;
  subtitle: string;
  claimableCountLabel: string;
  pendingRewardsLabel: string;
  resetLabel: string;
  emptyLabel: string | null;
  quests: CocosDailyQuestLineView[];
}

export interface BuildCocosDailyQuestPanelInput {
  board?: DailyQuestBoard | null;
  pendingQuestId: string | null;
}

function formatRewardLabel(quest: DailyQuestProgress): string {
  const parts = [
    quest.reward.gems > 0 ? `宝石 x${quest.reward.gems}` : null,
    quest.reward.gold > 0 ? `金币 x${quest.reward.gold}` : null
  ].filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join(" · ") : "奖励待同步";
}

function formatPendingRewardsLabel(board: DailyQuestBoard | null | undefined): string {
  const pendingGems = Math.max(0, Math.floor(board?.pendingRewards.gems ?? 0));
  const pendingGold = Math.max(0, Math.floor(board?.pendingRewards.gold ?? 0));
  if (pendingGems === 0 && pendingGold === 0) {
    return "待领取奖励 0";
  }

  const parts = [
    pendingGems > 0 ? `宝石 x${pendingGems}` : null,
    pendingGold > 0 ? `金币 x${pendingGold}` : null
  ].filter((entry): entry is string => Boolean(entry));
  return `待领取奖励 ${parts.join(" · ")}`;
}

function buildQuestLineView(quest: DailyQuestProgress, pendingQuestId: string | null): CocosDailyQuestLineView {
  const progressLabel = `${Math.max(0, Math.floor(quest.current))}/${Math.max(1, Math.floor(quest.target))}`;
  const rewardLabel = formatRewardLabel(quest);
  if (pendingQuestId === quest.id) {
    return {
      questId: quest.id,
      title: quest.title,
      detail: quest.description,
      progressLabel,
      rewardLabel,
      stateLabel: "领取中...",
      action: {
        questId: quest.id,
        label: "领取中...",
        enabled: false
      }
    };
  }

  if (quest.claimed) {
    return {
      questId: quest.id,
      title: quest.title,
      detail: quest.description,
      progressLabel,
      rewardLabel,
      stateLabel: "已领取",
      action: null
    };
  }

  if (quest.completed) {
    return {
      questId: quest.id,
      title: quest.title,
      detail: quest.description,
      progressLabel,
      rewardLabel,
      stateLabel: "可领取",
      action: {
        questId: quest.id,
        label: "领取奖励",
        enabled: true
      }
    };
  }

  return {
    questId: quest.id,
    title: quest.title,
    detail: quest.description,
    progressLabel,
    rewardLabel,
    stateLabel: "进行中",
    action: null
  };
}

export function buildCocosDailyQuestPanelView(input: BuildCocosDailyQuestPanelInput): CocosDailyQuestPanelView {
  const board = input.board?.enabled === true ? input.board : null;
  const quests = (board?.quests ?? []).map((quest) => buildQuestLineView(quest, input.pendingQuestId));
  return {
    title: "每日任务板",
    subtitle: board?.cycleKey ? `轮换 ${board.cycleKey}` : "完成今日目标并领取奖励",
    claimableCountLabel: `可领取 ${Math.max(0, Math.floor(board?.availableClaims ?? 0))}`,
    pendingRewardsLabel: formatPendingRewardsLabel(board),
    resetLabel: board?.resetAt ? `重置 ${board.resetAt.slice(11, 16)} UTC` : "重置时间待同步",
    emptyLabel: quests.length === 0 ? "今日任务暂未开放或尚未下发。" : null,
    quests
  };
}
