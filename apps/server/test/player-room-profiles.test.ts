import assert from "node:assert/strict";
import test from "node:test";
import { createRoom } from "../src/index";
import {
  applyPlayerAccountsToWorldState,
  applyPlayerHeroArchivesToWorldState,
  applyPlayerProfilesToWorldState,
  createPlayerAccountsFromWorldState,
  createPlayerHeroArchivesFromWorldState,
  createPlayerRoomProfiles
} from "../src/persistence";

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
  assert.equal(playerOneHero?.progression.skillPoints, 0);
  assert.equal(playerOneHero?.progression.battlesWon, 0);
});

test("createPlayerAccountsFromWorldState extracts one global resource ledger per player", () => {
  const room = createRoom("room-player-accounts", 1001);
  const snapshot = room.serializePersistenceSnapshot();
  snapshot.state.resources["player-1"] = {
    gold: 320,
    wood: 4,
    ore: 1
  };

  const accounts = createPlayerAccountsFromWorldState(snapshot.state);

  assert.deepEqual(
    accounts.map((account) => account.playerId).sort(),
    ["player-1", "player-2"]
  );
  assert.equal(accounts.find((account) => account.playerId === "player-1")?.displayName, "player-1");
  assert.deepEqual(accounts.find((account) => account.playerId === "player-1")?.globalResources, {
    gold: 320,
    wood: 4,
    ore: 1
  });
});

test("applyPlayerAccountsToWorldState overlays global resources without replacing room heroes", () => {
  const room = createRoom("room-player-account-merge", 1001);
  const snapshot = room.serializePersistenceSnapshot();
  const merged = applyPlayerAccountsToWorldState(snapshot.state, [
    {
      playerId: "player-1",
      achievements: [],
      globalResources: {
        gold: 900,
        wood: 6,
        ore: 2
      },
      recentEventLog: []
    }
  ]);

  assert.equal(merged.resources["player-1"]?.gold, 900);
  assert.equal(merged.resources["player-1"]?.wood, 6);
  assert.equal(merged.resources["player-1"]?.ore, 2);
  assert.equal(merged.resources["player-2"]?.gold, 0);
  assert.deepEqual(merged.heroes, snapshot.state.heroes);
});

test("createPlayerHeroArchivesFromWorldState extracts one persistent hero record per hero", () => {
  const room = createRoom("room-player-hero-archives", 1001);
  const snapshot = room.serializePersistenceSnapshot();
  snapshot.state.heroes[0] = {
    ...snapshot.state.heroes[0]!,
    stats: {
      ...snapshot.state.heroes[0]!.stats,
      attack: 5
    },
    loadout: {
      learnedSkills: [{ skillId: "armor_spell", rank: 2 }],
      equipment: {
        weaponId: "bronze_halberd",
        armorId: "march_guard",
        accessoryId: "trail_compass",
        trinketIds: ["wind_charm"]
      }
    },
    progression: {
      ...snapshot.state.heroes[0]!.progression,
      skillPoints: 2
    },
    learnedSkills: [{ skillId: "war_banner", rank: 1 }],
    armyCount: 16
  };

  const archives = createPlayerHeroArchivesFromWorldState(snapshot.state);

  assert.equal(archives.length, snapshot.state.heroes.length);
  assert.equal(archives.find((archive) => archive.heroId === "hero-1")?.hero.stats.attack, 5);
  assert.deepEqual(archives.find((archive) => archive.heroId === "hero-1")?.hero.loadout.learnedSkills, [
    { skillId: "armor_spell", rank: 2 }
  ]);
  assert.equal(archives.find((archive) => archive.heroId === "hero-1")?.hero.loadout.equipment.weaponId, "bronze_halberd");
  assert.equal(archives.find((archive) => archive.heroId === "hero-1")?.hero.progression.skillPoints, 2);
  assert.deepEqual(archives.find((archive) => archive.heroId === "hero-1")?.hero.learnedSkills, [{ skillId: "war_banner", rank: 1 }]);
  assert.equal(archives.find((archive) => archive.heroId === "hero-1")?.hero.armyCount, 16);
});

test("applyPlayerHeroArchivesToWorldState restores long-term hero growth but resets room-local position and readiness", () => {
  const room = createRoom("room-player-hero-archive-merge", 1001);
  const snapshot = room.serializePersistenceSnapshot();
  const originalHero = snapshot.state.heroes.find((hero) => hero.id === "hero-1");

  if (!originalHero) {
    throw new Error("Expected hero-1 in room snapshot");
  }

  const merged = applyPlayerHeroArchivesToWorldState(snapshot.state, [
    {
      playerId: "player-1",
      heroId: "hero-1",
      hero: {
        ...originalHero,
        position: { x: 4, y: 4 },
        move: {
          total: 8,
          remaining: 1
        },
        stats: {
          ...originalHero.stats,
          attack: 6,
          hp: 9,
          maxHp: 42
        },
        progression: {
          ...originalHero.progression,
          level: 4,
          experience: 420,
          skillPoints: 3,
          battlesWon: 5,
          neutralBattlesWon: 4,
          pvpBattlesWon: 1
        },
        loadout: {
          learnedSkills: [
            { skillId: "armor_spell", rank: 1 },
            { skillId: "power_shot", rank: 2 }
          ],
          equipment: {
            weaponId: "griffin_lance",
            armorId: "warden_plate",
            accessoryId: "sun_medallion",
            trinketIds: ["warding_seal", "iron_branch"]
          }
        },
        armyCount: 18,
        learnedSkills: [{ skillId: "war_banner", rank: 2 }]
      }
    }
  ]);

  const hydratedHero = merged.heroes.find((hero) => hero.id === "hero-1");

  assert.deepEqual(hydratedHero?.position, originalHero.position);
  assert.deepEqual(hydratedHero?.move, { total: 8, remaining: 8 });
  assert.equal(hydratedHero?.stats.attack, 6);
  assert.equal(hydratedHero?.stats.hp, 42);
  assert.equal(hydratedHero?.stats.maxHp, 42);
  assert.equal(hydratedHero?.progression.level, 4);
  assert.equal(hydratedHero?.progression.experience, 420);
  assert.deepEqual(hydratedHero?.loadout.learnedSkills, [
    { skillId: "armor_spell", rank: 1 },
    { skillId: "power_shot", rank: 2 }
  ]);
  assert.deepEqual(hydratedHero?.loadout.equipment, {
    weaponId: "griffin_lance",
    armorId: "warden_plate",
    accessoryId: "sun_medallion",
    trinketIds: ["warding_seal", "iron_branch"]
  });
  assert.equal(hydratedHero?.progression.skillPoints, 3);
  assert.deepEqual(hydratedHero?.learnedSkills, [{ skillId: "war_banner", rank: 2 }]);
  assert.equal(hydratedHero?.armyCount, 18);
});

test("applyPlayerHeroArchivesToWorldState backfills default long-term build fields for legacy hero rows", () => {
  const room = createRoom("room-player-hero-archive-legacy", 1001);
  const snapshot = room.serializePersistenceSnapshot();
  const originalHero = snapshot.state.heroes.find((hero) => hero.id === "hero-1");

  if (!originalHero) {
    throw new Error("Expected hero-1 in room snapshot");
  }

  const legacyHero = { ...originalHero } as Record<string, unknown>;
  delete legacyHero.loadout;

  const merged = applyPlayerHeroArchivesToWorldState(snapshot.state, [
    {
      playerId: "player-1",
      heroId: "hero-1",
      hero: legacyHero as unknown as typeof originalHero
    }
  ]);

  const hydratedHero = merged.heroes.find((hero) => hero.id === "hero-1");
  assert.deepEqual(hydratedHero?.loadout.learnedSkills, []);
  assert.deepEqual(hydratedHero?.loadout.equipment, {
    trinketIds: []
  });
});
