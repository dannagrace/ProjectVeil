import type { CocosMatchmakingStatusResponse } from "./cocos-matchmaking.ts";

export interface MatchmakingStatusView {
  statusLabel: string;
  queuePositionLabel: string;
  waitEstimateLabel: string;
  matchedLabel: string;
  canCancel: boolean;
  isMatched: boolean;
}

export function buildMatchmakingStatusView(status: CocosMatchmakingStatusResponse): MatchmakingStatusView {
  if (status.status === "queued") {
    return {
      statusLabel: "正在匹配…",
      queuePositionLabel: `位置 #${Math.max(1, Math.floor(status.position))}`,
      waitEstimateLabel: `预计 ${Math.max(0, Math.floor(status.estimatedWaitSeconds))}s`,
      matchedLabel: "",
      canCancel: true,
      isMatched: false
    };
  }

  if (status.status === "matched") {
    return {
      statusLabel: "匹配成功",
      queuePositionLabel: "位置 -",
      waitEstimateLabel: "预计 0s",
      matchedLabel: `房间 ${status.roomId} · 玩家 ${status.playerIds.join(" vs ")}`,
      canCancel: false,
      isMatched: true
    };
  }

  return {
    statusLabel: "未在匹配",
    queuePositionLabel: "位置 -",
    waitEstimateLabel: "预计 --",
    matchedLabel: "",
    canCancel: false,
    isMatched: false
  };
}
