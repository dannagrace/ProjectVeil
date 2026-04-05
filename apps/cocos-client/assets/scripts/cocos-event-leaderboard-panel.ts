import type { CocosSeasonalEvent } from "./cocos-lobby.ts";

export interface CocosEventLeaderboardRowView {
  rank: number;
  rankLabel: string;
  displayName: string;
  scoreLabel: string;
  rewardPreviewLabel: string;
  isCurrentPlayer: boolean;
  summary: string;
}

export interface CocosEventRewardTierView {
  title: string;
  rankLabel: string;
  rewardLabel: string;
  stateLabel: string;
  unlocked: boolean;
}

export interface CocosEventLeaderboardPanelView {
  visible: boolean;
  title: string;
  subtitle: string;
  countdownLabel: string;
  playerScoreLabel: string;
  playerRankLabel: string;
  leaderboardTitle: string;
  statusLabel: string;
  topRows: CocosEventLeaderboardRowView[];
  rewardTiers: CocosEventRewardTierView[];
}

export interface BuildCocosEventLeaderboardPanelInput {
  event: CocosSeasonalEvent | null;
  playerId: string;
  statusLabel: string;
  now?: Date;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) {
    return `${days} 天 ${String(hours).padStart(2, "0")} 时`;
  }
  return `${String(hours).padStart(2, "0")} 时 ${String(minutes).padStart(2, "0")} 分`;
}

function formatRewardLabel(tier: CocosSeasonalEvent["leaderboard"]["rewardTiers"][number]): string {
  const parts = [tier.badge?.trim() ? `徽记 ${tier.badge.trim()}` : null, tier.cosmeticId?.trim() ? `外观 ${tier.cosmeticId.trim()}` : null]
    .filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join(" / ") : "奖励待同步";
}

export function buildCocosEventLeaderboardPanelView(
  input: BuildCocosEventLeaderboardPanelInput
): CocosEventLeaderboardPanelView {
  const event = input.event;
  if (!event) {
    return {
      visible: false,
      title: "赛季活动",
      subtitle: "当前没有进行中的赛季活动。",
      countdownLabel: "未检测到活动",
      playerScoreLabel: "个人积分 0",
      playerRankLabel: "当前排名 未上榜",
      leaderboardTitle: "排行榜",
      statusLabel: input.statusLabel,
      topRows: [],
      rewardTiers: []
    };
  }

  const nowMs = input.now?.getTime() ?? Date.now();
  const myRow = event.leaderboard.entries.find((entry) => entry.playerId === input.playerId) ?? null;
  const remainingMs = Math.max(0, new Date(event.endsAt).getTime() - nowMs);
  const topRows = event.leaderboard.entries.slice(0, 10).map<CocosEventLeaderboardRowView>((entry) => ({
    rank: entry.rank,
    rankLabel: `#${entry.rank}`,
    displayName: entry.displayName,
    scoreLabel: `${entry.points} 分`,
    rewardPreviewLabel: entry.rewardPreview?.trim() || "无额外头衔",
    isCurrentPlayer: entry.playerId === input.playerId,
    summary: `#${entry.rank} ${entry.displayName} · ${entry.points} 分${entry.rewardPreview ? ` · ${entry.rewardPreview}` : ""}`
  }));

  return {
    visible: true,
    title: event.name,
    subtitle: event.bannerText || event.description || "赛季活动排行榜",
    countdownLabel: remainingMs > 0 ? `剩余 ${formatDuration(remainingMs)}` : "活动已结束，奖励将通过邮箱发放",
    playerScoreLabel: `个人积分 ${event.player.points}`,
    playerRankLabel: myRow ? `当前排名 #${myRow.rank}` : "当前排名 未上榜",
    leaderboardTitle: `前 ${Math.min(10, Math.max(1, event.leaderboard.entries.length || 10))} 名排行榜`,
    statusLabel: input.statusLabel,
    topRows,
    rewardTiers: event.leaderboard.rewardTiers.map((tier) => {
      const unlocked = Boolean(myRow && tier.rankStart <= myRow.rank && myRow.rank <= tier.rankEnd);
      return {
        title: tier.title,
        rankLabel: tier.rankStart === tier.rankEnd ? `排名 #${tier.rankStart}` : `排名 #${tier.rankStart}-#${tier.rankEnd}`,
        rewardLabel: formatRewardLabel(tier),
        stateLabel: unlocked ? "已解锁" : myRow ? "未达成" : "未上榜",
        unlocked
      };
    })
  };
}
