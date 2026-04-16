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
    const queuePosition = Math.max(1, Math.floor(status.position));
    const estimatedWaitSeconds = Math.max(0, Math.floor(status.estimatedWaitSeconds));
    return {
      statusLabel: "排位搜索中",
      queuePositionLabel: queuePosition <= 1 ? "你已站到队列最前" : `前方还有 ${queuePosition - 1} 组对手`,
      waitEstimateLabel: `预计 ${estimatedWaitSeconds}s 开赛`,
      matchedLabel:
        queuePosition <= 3
          ? "保持当前阵容，配到对手后会直接拉起这局对抗。"
          : "排队期间会保留今日冲榜势头，配到人后就能立刻开打。",
      canCancel: true,
      isMatched: false
    };
  }

  if (status.status === "matched") {
    return {
      statusLabel: "对手已锁定",
      queuePositionLabel: "房间已就绪",
      waitEstimateLabel: "现在就能开战",
      matchedLabel: `房间 ${status.roomId} · ${status.playerIds.join(" vs ")} · 地图种子 ${status.seedOverride}`,
      canCancel: false,
      isMatched: true
    };
  }

  return {
    statusLabel: "暂未开始排位",
    queuePositionLabel: "队列状态：空闲",
    waitEstimateLabel: "等待你发起下一局",
    matchedLabel: "打一场 PVP，就能刷新今日排位和社交战报。",
    canCancel: false,
    isMatched: false
  };
}
