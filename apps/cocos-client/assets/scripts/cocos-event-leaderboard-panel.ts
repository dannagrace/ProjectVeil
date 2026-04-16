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

function formatRankWindowLabel(rankStart: number, rankEnd: number): string {
  return rankStart === rankEnd ? `#${rankStart}` : `#${rankStart}-#${rankEnd}`;
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

function resolveRewardTierForRank(
  rewardTiers: CocosSeasonalEvent["leaderboard"]["rewardTiers"],
  rank: number | null
): CocosSeasonalEvent["leaderboard"]["rewardTiers"][number] | null {
  if (!rank) {
    return null;
  }

  return rewardTiers.find((tier) => tier.rankStart <= rank && rank <= tier.rankEnd) ?? null;
}

function resolveNextRewardTier(
  rewardTiers: CocosSeasonalEvent["leaderboard"]["rewardTiers"],
  rank: number | null
): CocosSeasonalEvent["leaderboard"]["rewardTiers"][number] | null {
  if (!rank) {
    return rewardTiers[0] ?? null;
  }

  const betterTiers = rewardTiers
    .filter((tier) => tier.rankEnd < rank)
    .sort((left, right) => right.rankEnd - left.rankEnd);
  return betterTiers[0] ?? null;
}

function resolveRankPressureLabel(
  entries: CocosSeasonalEvent["leaderboard"]["entries"],
  playerId: string
): string {
  const myRow = entries.find((entry) => entry.playerId === playerId) ?? null;
  if (!myRow) {
    const cutoff = entries[entries.length - 1] ?? null;
    if (!cutoff) {
      return "追榜压力 榜单暂未形成，先刷出第一笔活动积分。";
    }
    return `追榜压力 先冲进 ${formatRankWindowLabel(cutoff.rank, cutoff.rank)} · 还差 ${Math.max(0, cutoff.points + 1)} 分`;
  }

  const above = entries.find((entry) => entry.rank === myRow.rank - 1) ?? null;
  if (above) {
    return `追榜压力 距前一名 ${above.displayName.trim() || above.playerId} 还差 ${Math.max(0, above.points - myRow.points + 1)} 分`;
  }

  const below = entries.find((entry) => entry.rank === myRow.rank + 1) ?? null;
  if (below) {
    return `守榜压力 当前领先 #${below.rank} ${Math.max(0, myRow.points - below.points)} 分`;
  }

  return "守榜压力 当前已在榜首，继续完成活动目标就能稳住奖励档。";
}

function resolveRewardChaseLabel(
  event: CocosSeasonalEvent,
  playerId: string
): { playerRankLabel: string; leaderboardTitle: string; statusLabel: string } {
  const myRow = event.leaderboard.entries.find((entry) => entry.playerId === playerId) ?? null;
  const currentTier = resolveRewardTierForRank(event.leaderboard.rewardTiers, myRow?.rank ?? null);
  const nextTier = resolveNextRewardTier(event.leaderboard.rewardTiers, myRow?.rank ?? null);
  const currentTierLabel = currentTier
    ? `当前奖励档 ${currentTier.title}`
    : "当前奖励档 未上榜";
  const nextTierLabel = nextTier
    ? `下一档 ${nextTier.title} · 冲进 ${formatRankWindowLabel(nextTier.rankStart, nextTier.rankEnd)}`
    : currentTier
      ? `当前已在最高奖励档 ${currentTier.title}`
      : "当前奖励档待同步";
  const claimableRewards = event.rewards.filter((reward) => event.player.claimableRewardIds.includes(reward.id));
  const actionLabel =
    claimableRewards.length > 0
      ? `先领 ${claimableRewards.map((reward) => reward.name).join(" / ")}，再把活动积分滚到更高奖励档。`
      : nextTier
        ? `继续刷活动目标，把积分抬到 ${nextTier.title} 档。`
        : "继续守住当前排名，把本期奖励稳稳收下。";

  return {
    playerRankLabel: myRow ? `当前排名 #${myRow.rank} · ${currentTierLabel}` : `当前排名 未上榜 · ${currentTierLabel}`,
    leaderboardTitle: `本期追逐 · ${nextTierLabel}`,
    statusLabel: `${resolveRankPressureLabel(event.leaderboard.entries, playerId)} · ${actionLabel}`
  };
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
  const chase = resolveRewardChaseLabel(event, input.playerId);
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
    subtitle: `${event.bannerText || event.description || "赛季活动排行榜"} · ${resolveRankPressureLabel(event.leaderboard.entries, input.playerId)}`,
    countdownLabel: remainingMs > 0 ? `剩余 ${formatDuration(remainingMs)}` : "活动已结束，奖励将通过邮箱发放",
    playerScoreLabel: `个人积分 ${event.player.points}`,
    playerRankLabel: chase.playerRankLabel,
    leaderboardTitle: chase.leaderboardTitle,
    statusLabel: `${input.statusLabel} · ${chase.statusLabel}`,
    topRows,
    rewardTiers: event.leaderboard.rewardTiers.map((tier) => {
      const unlocked = Boolean(myRow && tier.rankStart <= myRow.rank && myRow.rank <= tier.rankEnd);
      return {
        title: tier.title,
        rankLabel: tier.rankStart === tier.rankEnd ? `排名 #${tier.rankStart}` : `排名 #${tier.rankStart}-#${tier.rankEnd}`,
        rewardLabel: formatRewardLabel(tier),
        stateLabel: unlocked
          ? "已进入该奖励档"
          : myRow
            ? `还需冲进 ${formatRankWindowLabel(tier.rankStart, tier.rankEnd)}`
            : `先冲进 ${formatRankWindowLabel(tier.rankStart, tier.rankEnd)}`,
        unlocked
      };
    })
  };
}
