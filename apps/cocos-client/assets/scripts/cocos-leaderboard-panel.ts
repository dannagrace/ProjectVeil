import type { LeaderboardEntry } from "./VeilCocosSession.ts";

export interface LeaderboardRowView {
  playerId: string;
  rank: number;
  rankLabel: string;
  displayName: string;
  ratingLabel: string;
  tierLabel: string;
  summary: string;
  isCurrentPlayer: boolean;
}

export interface CocosLeaderboardPanelView {
  rows: LeaderboardRowView[];
  myRankRow: LeaderboardRowView | null;
  tierBadge: string;
}

export interface CocosLeaderboardPanelInput {
  entries: LeaderboardEntry[];
  myPlayerId: string;
}

function formatTierLabel(tier: LeaderboardEntry["tier"]): string {
  switch (tier) {
    case "bronze":
      return "青铜";
    case "silver":
      return "白银";
    case "gold":
      return "黄金";
    case "platinum":
      return "铂金";
    case "diamond":
      return "钻石";
    default:
      return "未定级";
  }
}

function formatTierBadge(row: LeaderboardRowView | null, fallbackTier?: LeaderboardEntry["tier"]): string {
  if (row) {
    return row.tierLabel.toUpperCase();
  }

  return fallbackTier ? formatTierLabel(fallbackTier).toUpperCase() : "UNRANKED";
}

function formatDivisionLabel(entry: LeaderboardEntry): string {
  return entry.division?.trim() ? entry.division.trim().replace(/_/g, " ").toUpperCase() : formatTierLabel(entry.tier);
}

function formatPromotionSummary(entry: LeaderboardEntry): string {
  if (entry.promotionSeries) {
    return `晋级赛 ${entry.promotionSeries.wins}/${entry.promotionSeries.winsRequired} 胜 · ${entry.promotionSeries.losses}/${entry.promotionSeries.lossesAllowed} 负`;
  }
  if (entry.demotionShield && entry.demotionShield.remainingMatches > 0) {
    return `降级保护 ${entry.demotionShield.remainingMatches} 场`;
  }
  return "";
}

export function buildCocosLeaderboardPanelView(input: CocosLeaderboardPanelInput): CocosLeaderboardPanelView {
  const rows = input.entries.map<LeaderboardRowView>((entry) => {
    const tierLabel = formatDivisionLabel(entry);
    const promotionSummary = formatPromotionSummary(entry);
    const isCurrentPlayer = entry.playerId === input.myPlayerId;
    return {
      playerId: entry.playerId,
      rank: entry.rank,
      rankLabel: `#${entry.rank}`,
      displayName: entry.displayName.trim() || entry.playerId,
      ratingLabel: `ELO ${entry.eloRating}`,
      tierLabel,
      summary: `#${entry.rank} ${entry.displayName.trim() || entry.playerId} · ELO ${entry.eloRating} · ${tierLabel}${promotionSummary ? ` · ${promotionSummary}` : ""}`,
      isCurrentPlayer
    };
  });

  const myRankRow = rows.find((row) => row.isCurrentPlayer) ?? null;
  return {
    rows,
    myRankRow,
    tierBadge: formatTierBadge(myRankRow, input.entries[0]?.tier)
  };
}
