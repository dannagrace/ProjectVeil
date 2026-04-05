import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosEventLeaderboardPanelView } from "../assets/scripts/cocos-event-leaderboard-panel.ts";
import type { CocosSeasonalEvent } from "../assets/scripts/cocos-lobby.ts";

function createEvent(overrides: Partial<CocosSeasonalEvent> = {}): CocosSeasonalEvent {
  return {
    id: "defend-the-bridge",
    name: "Defend the Bridge",
    description: "Bridge defense event",
    startsAt: "2026-04-01T00:00:00.000Z",
    endsAt: "2026-04-08T00:00:00.000Z",
    durationDays: 7,
    bannerText: "Hold the crossing.",
    remainingMs: 86_400_000,
    rewards: [],
    player: {
      points: 160,
      claimedRewardIds: [],
      claimableRewardIds: []
    },
    leaderboard: {
      size: 100,
      rewardTiers: [
        {
          rankStart: 1,
          rankEnd: 1,
          title: "Bridge Champion",
          badge: "bridge_champion_2026",
          cosmeticId: "bridge-champion-border"
        },
        {
          rankStart: 2,
          rankEnd: 3,
          title: "Frontier Defender",
          badge: "frontier_defender_2026"
        }
      ],
      entries: [
        {
          rank: 1,
          playerId: "player-1",
          displayName: "Lyra",
          points: 220,
          lastUpdatedAt: "2026-04-04T09:00:00.000Z",
          rewardPreview: "Bridge Champion"
        },
        {
          rank: 2,
          playerId: "player-2",
          displayName: "Serin",
          points: 160,
          lastUpdatedAt: "2026-04-04T09:10:00.000Z",
          rewardPreview: "Frontier Defender"
        }
      ],
      topThree: []
    },
    ...overrides
  };
}

test("buildCocosEventLeaderboardPanelView formats player standing and reward tier unlock state", () => {
  const view = buildCocosEventLeaderboardPanelView({
    event: createEvent(),
    playerId: "player-2",
    statusLabel: "已同步赛季活动。",
    now: new Date("2026-04-07T00:00:00.000Z")
  });

  assert.equal(view.visible, true);
  assert.match(view.playerScoreLabel, /160/);
  assert.match(view.playerRankLabel, /#2/);
  assert.equal(view.topRows[1]?.isCurrentPlayer, true);
  assert.equal(view.rewardTiers[1]?.unlocked, true);
  assert.equal(view.rewardTiers[0]?.unlocked, false);
});

test("buildCocosEventLeaderboardPanelView hides itself without an active event", () => {
  const view = buildCocosEventLeaderboardPanelView({
    event: null,
    playerId: "player-2",
    statusLabel: "当前没有进行中的赛季活动。"
  });

  assert.equal(view.visible, false);
  assert.equal(view.topRows.length, 0);
  assert.equal(view.rewardTiers.length, 0);
});
