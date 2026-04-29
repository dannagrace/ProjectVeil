import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyEloMatchResult,
  createMatchmakingHeroSnapshot,
  estimateMatchmakingWaitSeconds,
  selectBestMatchPair,
  type HeroState,
  type MatchmakingRequest
} from "../src/index";

function createHero(overrides: Partial<HeroState> & Pick<HeroState, "id" | "playerId" | "name">): HeroState {
  return {
    id: overrides.id,
    playerId: overrides.playerId,
    name: overrides.name,
    position: overrides.position ?? { x: 0, y: 0 },
    vision: overrides.vision ?? 2,
    move: overrides.move ?? { total: 6, remaining: 6 },
    stats: overrides.stats ?? {
      attack: 2,
      defense: 2,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    progression: overrides.progression ?? {
      level: 4,
      experience: 0,
      skillPoints: 0,
      battlesWon: 0,
      neutralBattlesWon: 0,
      pvpBattlesWon: 0
    },
    loadout: overrides.loadout ?? {
      learnedSkills: [],
      equipment: { trinketIds: [] },
      inventory: []
    },
    armyTemplateId: overrides.armyTemplateId ?? "hero_guard_basic",
    armyCount: overrides.armyCount ?? 12,
    learnedSkills: overrides.learnedSkills ?? []
  };
}

function createRequest(
  playerId: string,
  rating: number,
  enqueuedAt: string,
  heroName = playerId
): MatchmakingRequest {
  return {
    playerId,
    heroSnapshot: createMatchmakingHeroSnapshot(
      createHero({
        id: `${playerId}-hero`,
        playerId,
        name: heroName
      })
    ),
    rating,
    enqueuedAt
  };
}

test("matchmaking selects the globally closest rating pair and breaks ties by wait time", () => {
  const requests = [
    createRequest("player-1", 1000, "2026-03-28T08:00:00.000Z"),
    createRequest("player-2", 1010, "2026-03-28T08:10:00.000Z"),
    createRequest("player-3", 1190, "2026-03-28T08:01:00.000Z"),
    createRequest("player-4", 1200, "2026-03-28T08:09:00.000Z")
  ];

  const selection = selectBestMatchPair(requests, new Date("2026-03-28T08:20:00.000Z"));

  assert.ok(selection);
  assert.equal(selection?.ratingGap, 10);
  assert.deepEqual(selection?.players.map((player) => player.playerId), ["player-1", "player-2"]);
});

test("elo result applies symmetric rating changes using configured-style K factor", () => {
  const result = applyEloMatchResult(1000, 1000, 32);

  assert.equal(result.winnerDelta, 16);
  assert.equal(result.loserDelta, -16);
  assert.equal(result.winnerRating, 1016);
  assert.equal(result.loserRating, 984);
  assert.equal(estimateMatchmakingWaitSeconds(3), 30);
});

test("matchmaking rejects large rating gaps once players leave protected onboarding matches", () => {
  const requests = [
    createRequest("player-1", 1000, "2026-03-28T08:00:00.000Z"),
    createRequest("player-2", 1305, "2026-03-28T08:01:00.000Z")
  ];

  assert.equal(selectBestMatchPair(requests, new Date("2026-03-28T08:20:00.000Z")), null);
});

test("matchmaking allows a wider gap during the first protected pvp matches", () => {
  const requests = [
    {
      ...createRequest("player-1", 1000, "2026-03-28T08:00:00.000Z"),
      protectedPvpMatchesRemaining: 5
    },
    createRequest("player-2", 1305, "2026-03-28T08:01:00.000Z")
  ];

  const selection = selectBestMatchPair(requests, new Date("2026-03-28T08:20:00.000Z"));
  assert.ok(selection);
  assert.equal(selection?.ratingGap, 305);
});

test("matchmaking keeps protected onboarding players out of top-tier pairings", () => {
  const requests = [
    {
      ...createRequest("player-1", 1200, "2026-03-28T08:00:00.000Z"),
      protectedPvpMatchesRemaining: 4
    },
    createRequest("player-2", 1520, "2026-03-28T08:01:00.000Z")
  ];

  assert.equal(selectBestMatchPair(requests, new Date("2026-03-28T08:20:00.000Z")), null);
});

test("matchmaking uses a bounded large-queue selector", async () => {
  const source = await readFile(new URL("../src/matchmaking.ts", import.meta.url), "utf8");

  assert.match(source, /LARGE_MATCHMAKING_QUEUE_THRESHOLD/);
  assert.match(source, /selectBestMatchPairFromRatingWindow/);
});
