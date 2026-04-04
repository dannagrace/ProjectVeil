import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShareCardPayload,
  readLaunchReferrerId,
  shouldOfferBattleResultShare
} from "../assets/scripts/cocos-share-card.ts";
import type { PlayerBattleReplaySummary } from "../assets/scripts/project-shared/battle-replay.ts";

function createReplay(overrides: Partial<PlayerBattleReplaySummary> = {}): PlayerBattleReplaySummary {
  return {
    id: "replay-1",
    roomId: "ranked-room",
    playerId: "player-7",
    battleId: "battle-1",
    battleKind: "hero",
    playerCamp: "attacker",
    heroId: "hero-1",
    opponentHeroId: "hero-2",
    startedAt: "2026-04-04T10:00:00.000Z",
    completedAt: "2026-04-04T10:03:00.000Z",
    initialState: {
      battleId: "battle-1",
      attackerHeroId: "hero-1",
      defenderHeroId: "hero-2",
      battlefield: [],
      turn: "attacker",
      round: 1,
      activeUnitId: "unit-1",
      queue: [],
      attacker: [],
      defender: []
    },
    steps: [],
    result: "attacker_victory",
    ...overrides
  };
}

test("buildShareCardPayload generates the battle result title and referral path", () => {
  const payload = buildShareCardPayload(createReplay(), "雾林司灯");

  assert.equal(payload.title, "雾林司灯 赢得了天梯对战！");
  assert.equal(payload.path, "?roomId=ranked-room&referrer=player-7");
  assert.match(payload.imageUrl, /^data:image\/svg\+xml/);
  assert.match(decodeURIComponent(payload.imageUrl), /Project Veil Victory/);
});

test("shouldOfferBattleResultShare only enables attacker PVP victories", () => {
  assert.equal(shouldOfferBattleResultShare(createReplay()), true);
  assert.equal(shouldOfferBattleResultShare(createReplay({ battleKind: "neutral" })), false);
  assert.equal(shouldOfferBattleResultShare(createReplay({ playerCamp: "defender" })), false);
  assert.equal(shouldOfferBattleResultShare(createReplay({ result: "defender_victory" })), false);
});

test("readLaunchReferrerId reads the referral query parameter", () => {
  assert.equal(readLaunchReferrerId("?roomId=ranked-room&referrer=player-9"), "player-9");
  assert.equal(readLaunchReferrerId("?roomId=ranked-room"), null);
});
