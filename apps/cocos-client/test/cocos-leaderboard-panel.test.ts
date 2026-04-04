import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosLeaderboardPanelView } from "../assets/scripts/cocos-leaderboard-panel.ts";

test("buildCocosLeaderboardPanelView marks the current player and exposes a tier badge", () => {
  const view = buildCocosLeaderboardPanelView({
    myPlayerId: "player-2",
    entries: [
      { playerId: "player-1", rank: 1, displayName: "Alpha", eloRating: 1680, tier: "platinum" },
      { playerId: "player-2", rank: 2, displayName: "Bravo", eloRating: 1510, tier: "platinum" }
    ]
  });

  assert.equal(view.rows.length, 2);
  assert.equal(view.myRankRow?.playerId, "player-2");
  assert.equal(view.myRankRow?.isCurrentPlayer, true);
  assert.equal(view.tierBadge, "铂金");
  assert.match(view.rows[1]?.summary ?? "", /Bravo/);
});

test("buildCocosLeaderboardPanelView falls back to the leading tier badge when the player is not ranked", () => {
  const view = buildCocosLeaderboardPanelView({
    myPlayerId: "player-9",
    entries: [{ playerId: "player-1", rank: 1, displayName: "Alpha", eloRating: 1888, tier: "diamond" }]
  });

  assert.equal(view.myRankRow, null);
  assert.equal(view.tierBadge, "钻石");
});

test("buildCocosLeaderboardPanelView returns an unranked badge for an empty ladder", () => {
  const view = buildCocosLeaderboardPanelView({
    myPlayerId: "player-1",
    entries: []
  });

  assert.deepEqual(view.rows, []);
  assert.equal(view.myRankRow, null);
  assert.equal(view.tierBadge, "UNRANKED");
});
