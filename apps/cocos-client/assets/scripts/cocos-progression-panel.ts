import { getBattlePassConfig, type BattlePassRewardConfig, type BattlePassTierConfig } from "./project-shared/world-config.ts";
import type {
  DailyDungeonDefinition,
  DailyDungeonReward,
  DailyDungeonRunRecord,
  EventLeaderboardEntry,
  SeasonalEventReward
} from "../../../../packages/shared/src/index.ts";

export interface CocosSeasonProgress {
  battlePassEnabled: boolean;
  seasonXp: number;
  seasonPassTier: number;
  seasonPassPremium: boolean;
  seasonPassClaimedTiers: number[];
}

export interface CocosBattlePassTrackView {
  label: string;
  detail: string;
  claimLabel: string;
  claimable: boolean;
  claimed: boolean;
}

export interface CocosBattlePassTierView {
  tier: number;
  tierLabel: string;
  xpLabel: string;
  freeTrack: CocosBattlePassTrackView;
  premiumTrack: CocosBattlePassTrackView;
}

export interface CocosBattlePassPanelView {
  visible: boolean;
  title: string;
  subtitle: string;
  progressLabel: string;
  progressRatio: number;
  nextRewardLabel: string;
  premiumStatusLabel: string;
  premiumActionLabel: string;
  premiumPurchaseEnabled: boolean;
  statusLabel: string;
  tiers: CocosBattlePassTierView[];
}

export interface BuildCocosBattlePassPanelInput {
  progress: CocosSeasonProgress | null;
  pendingClaimTier: number | null;
  pendingPremiumPurchase: boolean;
  statusLabel: string;
}

export interface CocosDailyDungeonSummary {
  dungeon: DailyDungeonDefinition;
  dateKey: string;
  attemptsUsed: number;
  attemptsRemaining: number;
  runs: DailyDungeonRunRecord[];
}

export interface CocosDailyDungeonEventPlayerState {
  points: number;
  claimedRewardIds: string[];
  claimableRewardIds: string[];
}

export interface CocosDailyDungeonEventLeaderboardState {
  entries: EventLeaderboardEntry[];
  topThree: EventLeaderboardEntry[];
}

export interface CocosDailyDungeonEventObjective {
  id: string;
  actionType: string;
  dungeonId?: string;
}

export interface CocosDailyDungeonEvent {
  id: string;
  name: string;
  description: string;
  bannerText: string;
  remainingMs: number;
  rewards: SeasonalEventReward[];
  objectives: CocosDailyDungeonEventObjective[];
  player: CocosDailyDungeonEventPlayerState;
  leaderboard: CocosDailyDungeonEventLeaderboardState;
}

export interface CocosDailyDungeonFloorView {
  floor: number;
  title: string;
  detail: string;
  actionLabel: string;
  actionEnabled: boolean;
  actionKind: "attempt" | "claim" | "none";
  runId: string | null;
}

export interface CocosDailyDungeonLeaderboardRowView {
  rank: number;
  rankLabel: string;
  displayName: string;
  pointsLabel: string;
  rewardPreviewLabel: string;
  summary: string;
  isCurrentPlayer: boolean;
}

export interface CocosDailyDungeonPanelView {
  visible: boolean;
  title: string;
  subtitle: string;
  attemptSummaryLabel: string;
  statusLabel: string;
  floors: CocosDailyDungeonFloorView[];
  eventTitle: string;
  eventSummaryLabel: string;
  leaderboardRows: CocosDailyDungeonLeaderboardRowView[];
  myRankSummary: string;
}

export interface BuildCocosDailyDungeonPanelInput {
  dailyDungeon: CocosDailyDungeonSummary | null;
  activeEvent: CocosDailyDungeonEvent | null;
  currentPlayerId: string;
  pendingFloor: number | null;
  pendingClaimRunId: string | null;
  statusLabel: string;
}

function formatRewardLabel(reward: BattlePassRewardConfig): string {
  if ((reward.gems ?? 0) > 0) {
    return `宝石 x${Math.floor(reward.gems ?? 0)}`;
  }
  if ((reward.gold ?? 0) > 0 || (reward.wood ?? 0) > 0 || (reward.ore ?? 0) > 0) {
    const parts = [
      (reward.gold ?? 0) > 0 ? `金币 +${Math.floor(reward.gold ?? 0)}` : null,
      (reward.wood ?? 0) > 0 ? `木材 +${Math.floor(reward.wood ?? 0)}` : null,
      (reward.ore ?? 0) > 0 ? `矿石 +${Math.floor(reward.ore ?? 0)}` : null
    ].filter(Boolean);
    return parts.join(" / ");
  }
  if (reward.equipmentId?.trim()) {
    return `装备 ${reward.equipmentId.trim()}`;
  }
  return "奖励待同步";
}

function formatDailyDungeonRewardLabel(reward: DailyDungeonReward): string {
  const parts = [
    (reward.gems ?? 0) > 0 ? `宝石 x${Math.floor(reward.gems ?? 0)}` : null,
    (reward.resources?.gold ?? 0) > 0 ? `金币 +${Math.floor(reward.resources?.gold ?? 0)}` : null,
    (reward.resources?.wood ?? 0) > 0 ? `木材 +${Math.floor(reward.resources?.wood ?? 0)}` : null,
    (reward.resources?.ore ?? 0) > 0 ? `矿石 +${Math.floor(reward.resources?.ore ?? 0)}` : null
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "奖励待同步";
}

function formatSeasonalEventRewardLabel(reward: SeasonalEventReward): string {
  if ((reward.gems ?? 0) > 0) {
    return `${reward.name} · 宝石 x${Math.floor(reward.gems ?? 0)}`;
  }

  const resourceParts = [
    (reward.resources?.gold ?? 0) > 0 ? `金币 +${Math.floor(reward.resources?.gold ?? 0)}` : null,
    (reward.resources?.wood ?? 0) > 0 ? `木材 +${Math.floor(reward.resources?.wood ?? 0)}` : null,
    (reward.resources?.ore ?? 0) > 0 ? `矿石 +${Math.floor(reward.resources?.ore ?? 0)}` : null
  ].filter(Boolean);
  if (resourceParts.length > 0) {
    return `${reward.name} · ${resourceParts.join(" / ")}`;
  }
  if (reward.badge?.trim()) {
    return `${reward.name} · 徽记 ${reward.badge.trim()}`;
  }
  if (reward.cosmeticId?.trim()) {
    return `${reward.name} · 外观 ${reward.cosmeticId.trim()}`;
  }
  return reward.name;
}

function formatDurationLabel(remainingMs: number): string {
  const totalHours = Math.max(0, Math.floor(remainingMs / (60 * 60 * 1000)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  return `${hours} 小时`;
}

function resolveLatestRunByFloor(runs: DailyDungeonRunRecord[]): Map<number, DailyDungeonRunRecord> {
  const byFloor = new Map<number, DailyDungeonRunRecord>();
  for (const run of [...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt))) {
    if (!byFloor.has(run.floor)) {
      byFloor.set(run.floor, run);
    }
  }
  return byFloor;
}

function resolveRewardProgressLabel(event: CocosDailyDungeonEvent): string {
  const claimableRewards = event.rewards.filter((reward) => event.player.claimableRewardIds.includes(reward.id));
  if (claimableRewards.length > 0) {
    return `可领取 ${claimableRewards.map((reward) => reward.name).join(" / ")}`;
  }

  const nextReward = event.rewards.find((reward) => !event.player.claimedRewardIds.includes(reward.id));
  if (!nextReward) {
    return "活动奖励已全部达成";
  }

  return `下一奖励 ${formatSeasonalEventRewardLabel(nextReward)}`;
}

function buildLeaderboardRows(
  event: CocosDailyDungeonEvent,
  currentPlayerId: string
): { rows: CocosDailyDungeonLeaderboardRowView[]; myRankSummary: string } {
  const rows = event.leaderboard.entries.slice(0, 3).map<CocosDailyDungeonLeaderboardRowView>((entry) => {
    const isCurrentPlayer = entry.playerId === currentPlayerId;
    const displayName = entry.displayName.trim() || entry.playerId;
    return {
      rank: entry.rank,
      rankLabel: `#${entry.rank}`,
      displayName,
      pointsLabel: `${Math.max(0, Math.floor(entry.points))} 分`,
      rewardPreviewLabel: entry.rewardPreview?.trim() || "无额外头衔",
      summary: `#${entry.rank} ${displayName} · ${Math.max(0, Math.floor(entry.points))} 分 · ${entry.rewardPreview?.trim() || "无额外头衔"}`,
      isCurrentPlayer
    };
  });

  const myEntry = event.leaderboard.entries.find((entry) => entry.playerId === currentPlayerId) ?? null;
  return {
    rows,
    myRankSummary: myEntry
      ? `我的排名 #${myEntry.rank} · ${Math.max(0, Math.floor(myEntry.points))} 分`
      : `我的积分 ${Math.max(0, Math.floor(event.player.points))} · 当前未上榜`
  };
}

function formatTrackClaimLabel(
  tier: BattlePassTierConfig,
  progress: CocosSeasonProgress,
  pendingClaimTier: number | null,
  premiumTrack: boolean
): string {
  const claimed = progress.seasonPassClaimedTiers.includes(tier.tier);
  if (pendingClaimTier === tier.tier) {
    return "领取中...";
  }
  if (claimed) {
    return "已领取";
  }
  if (tier.tier > progress.seasonPassTier) {
    return "未解锁";
  }
  if (premiumTrack && !progress.seasonPassPremium) {
    return "需高级通行证";
  }
  return "点击领取";
}

function isTrackClaimable(tier: BattlePassTierConfig, progress: CocosSeasonProgress, premiumTrack: boolean): boolean {
  if (progress.seasonPassClaimedTiers.includes(tier.tier)) {
    return false;
  }
  if (tier.tier > progress.seasonPassTier) {
    return false;
  }
  if (premiumTrack && !progress.seasonPassPremium) {
    return false;
  }
  return true;
}

function resolveVisibleTiers(config: ReturnType<typeof getBattlePassConfig>, progress: CocosSeasonProgress): BattlePassTierConfig[] {
  const startTier = Math.max(1, Math.min(progress.seasonPassTier, Math.max(1, config.tiers.length - 3)));
  return config.tiers.filter((tier) => tier.tier >= startTier).slice(0, 4);
}

function resolveProgressRatio(config: ReturnType<typeof getBattlePassConfig>, progress: CocosSeasonProgress): { label: string; ratio: number } {
  const currentTier = config.tiers.find((tier) => tier.tier === progress.seasonPassTier) ?? config.tiers[0];
  const nextTier = config.tiers.find((tier) => tier.tier === progress.seasonPassTier + 1) ?? null;
  const currentXp = Math.max(0, progress.seasonXp);
  if (!currentTier || !nextTier) {
    return {
      label: `通行证等级 ${progress.seasonPassTier} · 已达成赛季上限`,
      ratio: 1
    };
  }

  const floorXp = Math.max(0, currentTier.xpRequired);
  const ceilingXp = Math.max(floorXp + 1, nextTier.xpRequired);
  const gainedWithinTier = Math.max(0, currentXp - floorXp);
  const totalWithinTier = Math.max(1, ceilingXp - floorXp);
  return {
    label: `等级 ${progress.seasonPassTier} · 赛季经验 ${currentXp}/${ceilingXp}`,
    ratio: Math.max(0, Math.min(1, gainedWithinTier / totalWithinTier))
  };
}

function resolveNextRewardLabel(config: ReturnType<typeof getBattlePassConfig>, progress: CocosSeasonProgress): string {
  const nextTier =
    config.tiers.find((tier) => !progress.seasonPassClaimedTiers.includes(tier.tier) && tier.tier >= progress.seasonPassTier)
    ?? config.tiers.find((tier) => tier.tier > progress.seasonPassTier)
    ?? config.tiers[config.tiers.length - 1];
  if (!nextTier) {
    return "当前赛季奖励已全部同步。";
  }

  return `下一奖励 T${nextTier.tier} · 免费 ${formatRewardLabel(nextTier.freeReward)} · 高级 ${formatRewardLabel(nextTier.premiumReward)}`;
}

export function buildCocosBattlePassPanelView(input: BuildCocosBattlePassPanelInput): CocosBattlePassPanelView {
  const progress = input.progress;
  if (!progress || !progress.battlePassEnabled) {
    return {
      visible: false,
      title: "赛季通行证",
      subtitle: "当前账号未开放此功能。",
      progressLabel: "未开放",
      progressRatio: 0,
      nextRewardLabel: "功能关闭时不展示面板。",
      premiumStatusLabel: "battle_pass_enabled = false",
      premiumActionLabel: "未开放",
      premiumPurchaseEnabled: false,
      statusLabel: input.statusLabel,
      tiers: []
    };
  }

  const config = getBattlePassConfig();
  const progressMeter = resolveProgressRatio(config, progress);
  return {
    visible: true,
    title: "赛季通行证",
    subtitle: `当前等级 T${progress.seasonPassTier} · ${progress.seasonPassPremium ? "高级通行证已激活" : "免费通行证"}`,
    progressLabel: progressMeter.label,
    progressRatio: progressMeter.ratio,
    nextRewardLabel: resolveNextRewardLabel(config, progress),
    premiumStatusLabel: progress.seasonPassPremium ? "高级通行证已解锁全部高级轨道。" : "解锁高级轨道可领取金色奖励。", 
    premiumActionLabel: input.pendingPremiumPurchase
      ? "购买中..."
      : progress.seasonPassPremium
        ? "已解锁"
        : "解锁高级通行证",
    premiumPurchaseEnabled: !input.pendingPremiumPurchase && !progress.seasonPassPremium,
    statusLabel: input.statusLabel,
    tiers: resolveVisibleTiers(config, progress).map((tier) => ({
      tier: tier.tier,
      tierLabel: `T${tier.tier}`,
      xpLabel: `${tier.xpRequired} XP`,
      freeTrack: {
        label: "免费奖励",
        detail: formatRewardLabel(tier.freeReward),
        claimLabel: formatTrackClaimLabel(tier, progress, input.pendingClaimTier, false),
        claimable: input.pendingClaimTier == null && isTrackClaimable(tier, progress, false),
        claimed: progress.seasonPassClaimedTiers.includes(tier.tier)
      },
      premiumTrack: {
        label: "高级奖励",
        detail: formatRewardLabel(tier.premiumReward),
        claimLabel: formatTrackClaimLabel(tier, progress, input.pendingClaimTier, true),
        claimable: input.pendingClaimTier == null && isTrackClaimable(tier, progress, true),
        claimed: progress.seasonPassClaimedTiers.includes(tier.tier)
      }
    }))
  };
}

export function buildCocosDailyDungeonPanelView(input: BuildCocosDailyDungeonPanelInput): CocosDailyDungeonPanelView {
  if (!input.dailyDungeon) {
    return {
      visible: true,
      title: "每日地城",
      subtitle: "需要先同步账号会话后才能查看当日地城。",
      attemptSummaryLabel: "暂无地城数据",
      statusLabel: input.statusLabel,
      floors: [],
      eventTitle: "赛季活动",
      eventSummaryLabel: "暂无可展示的联动排行榜。",
      leaderboardRows: [],
      myRankSummary: "当前未同步排行榜"
    };
  }

  const dailyDungeon = input.dailyDungeon;
  const latestRunByFloor = resolveLatestRunByFloor(dailyDungeon.runs);
  const floors = dailyDungeon.dungeon.floors.map<CocosDailyDungeonFloorView>((floor) => {
    const latestRun = latestRunByFloor.get(floor.floor) ?? null;
    const hasUnclaimedRun = Boolean(latestRun && !latestRun.rewardClaimedAt);
    const claimedRuns = dailyDungeon.runs.filter((run) => run.floor === floor.floor && Boolean(run.rewardClaimedAt)).length;

    if (hasUnclaimedRun && latestRun) {
      return {
        floor: floor.floor,
        title: `第 ${floor.floor} 层 · 推荐等级 ${floor.recommendedHeroLevel}`,
        detail: `${formatDailyDungeonRewardLabel(floor.reward)} · 已出战，等待领取`,
        actionLabel: input.pendingClaimRunId === latestRun.runId ? "领取中..." : "领取奖励",
        actionEnabled: input.pendingClaimRunId == null && input.pendingFloor == null,
        actionKind: "claim",
        runId: latestRun.runId
      };
    }

    return {
      floor: floor.floor,
      title: `第 ${floor.floor} 层 · 推荐等级 ${floor.recommendedHeroLevel}`,
      detail: `${formatDailyDungeonRewardLabel(floor.reward)} · 今日已领取 ${claimedRuns} 次`,
      actionLabel:
        input.pendingFloor === floor.floor
          ? "挑战中..."
          : dailyDungeon.attemptsRemaining <= 0
            ? "次数已用尽"
            : claimedRuns > 0
              ? "再次挑战"
              : "开始挑战",
      actionEnabled: input.pendingClaimRunId == null && input.pendingFloor == null && dailyDungeon.attemptsRemaining > 0,
      actionKind: dailyDungeon.attemptsRemaining > 0 ? "attempt" : "none",
      runId: null
    };
  });

  if (!input.activeEvent) {
    return {
      visible: true,
      title: "每日地城",
      subtitle: `${dailyDungeon.dungeon.name} · ${dailyDungeon.dungeon.description}`,
      attemptSummaryLabel: `今日 ${dailyDungeon.dateKey} · 已用 ${dailyDungeon.attemptsUsed}/${dailyDungeon.dungeon.attemptLimit} 次`,
      statusLabel: input.statusLabel,
      floors,
      eventTitle: "赛季活动",
      eventSummaryLabel: "当前没有与每日地城联动的活动排行榜。",
      leaderboardRows: [],
      myRankSummary: "排行榜未开放"
    };
  }

  const leaderboard = buildLeaderboardRows(input.activeEvent, input.currentPlayerId);
  return {
    visible: true,
    title: "每日地城",
    subtitle: `${dailyDungeon.dungeon.name} · ${dailyDungeon.dungeon.description}`,
    attemptSummaryLabel: `今日 ${dailyDungeon.dateKey} · 已用 ${dailyDungeon.attemptsUsed}/${dailyDungeon.dungeon.attemptLimit} 次 · 剩余 ${dailyDungeon.attemptsRemaining} 次`,
    statusLabel: input.statusLabel,
    floors,
    eventTitle: `${input.activeEvent.name} · 剩余 ${formatDurationLabel(input.activeEvent.remainingMs)}`,
    eventSummaryLabel: `${input.activeEvent.bannerText} · ${resolveRewardProgressLabel(input.activeEvent)}`,
    leaderboardRows: leaderboard.rows,
    myRankSummary: leaderboard.myRankSummary
  };
}
