import { getBattlePassConfig, type BattlePassRewardConfig, type BattlePassTierConfig } from "./project-shared/world-config.ts";

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
