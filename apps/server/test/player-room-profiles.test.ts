import assert from "node:assert/strict";
import test from "node:test";
import { createRoom } from "../src/index";
import { applyPlayerProfilesToWorldState, createPlayerRoomProfiles } from "../src/persistence";

test("createPlayerRoomProfiles extracts one profile per player in the room", () => {
  const room = createRoom("room-player-profiles", 1001);
  const snapshot = room.serializePersistenceSnapshot();

  const profiles = createPlayerRoomProfiles(snapshot.state);

  assert.equal(profiles.length, 2);
  assert.deepEqual(
    profiles.map((profile) => profile.playerId).sort(),
    ["player-1", "player-2"]
  );
  assert.deepEqual(profiles.find((profile) => profile.playerId === "player-1")?.resources, {
    gold: 0,
    wood: 0,
    ore: 0
  });
  assert.equal(profiles.find((profile) => profile.playerId === "player-1")?.heroes[0]?.progression.level, 1);
});

test("applyPlayerProfilesToWorldState overlays a single player's progress without affecting others", () => {
  const room = createRoom("room-player-profile-merge", 1001);
  const snapshot = room.serializePersistenceSnapshot();
  const profiles = createPlayerRoomProfiles(snapshot.state);
  const playerOneProfile = profiles.find((profile) => profile.playerId === "player-1");

  if (!playerOneProfile || !playerOneProfile.heroes[0]) {
    throw new Error("Expected player-1 profile with at least one hero");
  }

  const firstHero = playerOneProfile.heroes[0];
  playerOneProfile.resources.gold = 700;
  playerOneProfile.resources.wood = 5;
  playerOneProfile.heroes[0] = {
    ...firstHero,
    stats: {
      ...firstHero.stats,
      hp: 12
    },
    progression: {
      ...firstHero.progression,
      level: 3,
      experience: 280
    }
  };

  const merged = applyPlayerProfilesToWorldState(snapshot.state, profiles);
  const playerOneHero = merged.heroes.find((hero) => hero.id === "hero-1");
  const playerTwoHero = merged.heroes.find((hero) => hero.id === "hero-2");

  assert.equal(merged.resources["player-1"]?.gold, 700);
  assert.equal(merged.resources["player-1"]?.wood, 5);
  assert.equal(merged.resources["player-2"]?.gold, 0);
  assert.equal(playerOneHero?.stats.hp, 12);
  assert.equal(playerOneHero?.progression.level, 3);
  assert.equal(playerOneHero?.progression.experience, 280);
  assert.equal(playerTwoHero?.stats.hp, snapshot.state.heroes.find((hero) => hero.id === "hero-2")?.stats.hp);
});

test("applyPlayerProfilesToWorldState backfills default progression for legacy hero rows", () => {
  const room = createRoom("room-player-profile-legacy", 1001);
  const snapshot = room.serializePersistenceSnapshot();
  const profiles = createPlayerRoomProfiles(snapshot.state);
  const playerOneProfile = profiles.find((profile) => profile.playerId === "player-1");

  if (!playerOneProfile || !playerOneProfile.heroes[0]) {
    throw new Error("Expected player-1 legacy profile seed");
  }

  const legacyHero = { ...playerOneProfile.heroes[0] } as Record<string, unknown>;
  delete legacyHero.progression;
  playerOneProfile.heroes[0] = legacyHero as unknown as typeof playerOneProfile.heroes[0];

  const merged = applyPlayerProfilesToWorldState(snapshot.state, profiles);
  const playerOneHero = merged.heroes.find((hero) => hero.id === "hero-1");

  assert.equal(playerOneHero?.progression.level, 1);
  assert.equal(playerOneHero?.progression.experience, 0);
  assert.equal(playerOneHero?.progression.battlesWon, 0);
});
