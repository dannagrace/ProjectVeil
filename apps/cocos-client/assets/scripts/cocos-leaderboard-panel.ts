import type { LeaderboardEntry } from "./VeilCocosSession.ts";

export interface LeaderboardRowView {
  playerId: string;
  rank: number;
  rankLabel: string;
  displayName: string;
  ratingLabel: string;
  tierLabel: string;
  summary: string;
  spotlight: string;
  isCurrentPlayer: boolean;
}

export interface CocosLeaderboardPanelView {
  rows: LeaderboardRowView[];
  myRankRow: LeaderboardRowView | null;
  tierBadge: string;
  focusSummary: string;
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

function formatLeaderboardSpotlight(
  entry: LeaderboardEntry,
  previousEntry: LeaderboardEntry | null,
  leadingEntry: LeaderboardEntry | null
): string {
  const promotionSummary = formatPromotionSummary(entry);
  if (promotionSummary) {
    return promotionSummary;
  }

  if (entry.rank <= 1 || !leadingEntry) {
    return "当前领跑";
  }

  if (previousEntry) {
    const gapToPrevious = Math.max(0, previousEntry.eloRating - entry.eloRating);
    if (gapToPrevious > 0) {
      return `距前一名 ${gapToPrevious} ELO`;
    }
  }

  const gapToLeader = Math.max(0, leadingEntry.eloRating - entry.eloRating);
  return gapToLeader > 0 ? `距榜首 ${gapToLeader} ELO` : "继续巩固当前名次";
}

function formatLeaderboardFocusSummary(rows: LeaderboardRowView[], myRankRow: LeaderboardRowView | null): string {
  const leaderRow = rows[0] ?? null;
  if (!leaderRow) {
    return "先完成一场结算对局，再回来判断今天的冲榜目标。";
  }

  if (!myRankRow) {
    return `先打一场排位进入榜单，再去追 ${leaderRow.displayName} 的当前节奏。`;
  }

  if (myRankRow.rank === 1) {
    return `你当前领跑榜单，继续赢一局就能把优势再拉开一点。`;
  }

  return `今天的排位焦点：继续逼近 ${leaderRow.displayName}，把 ${myRankRow.spotlight} 先追回来。`;
}

export function buildCocosLeaderboardPanelView(input: CocosLeaderboardPanelInput): CocosLeaderboardPanelView {
  const leadingEntry = input.entries[0] ?? null;
  const rows = input.entries.map<LeaderboardRowView>((entry, index) => {
    const tierLabel = formatDivisionLabel(entry);
    const isCurrentPlayer = entry.playerId === input.myPlayerId;
    const spotlight = formatLeaderboardSpotlight(entry, input.entries[index - 1] ?? null, leadingEntry);
    return {
      playerId: entry.playerId,
      rank: entry.rank,
      rankLabel: `#${entry.rank}`,
      displayName: entry.displayName.trim() || entry.playerId,
      ratingLabel: `ELO ${entry.eloRating}`,
      tierLabel,
      summary: `#${entry.rank} ${entry.displayName.trim() || entry.playerId} · ELO ${entry.eloRating} · ${tierLabel} · ${spotlight}`,
      spotlight,
      isCurrentPlayer
    };
  });

  const myRankRow = rows.find((row) => row.isCurrentPlayer) ?? null;
  return {
    rows,
    myRankRow,
    tierBadge: formatTierBadge(myRankRow, input.entries[0]?.tier),
    focusSummary: formatLeaderboardFocusSummary(rows, myRankRow)
  };
}
