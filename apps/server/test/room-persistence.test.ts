import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayerBattleReplaySummariesForPlayer,
  buildPlayerBattleReplaySummary,
  type CompletedBattleReplayCapture
} from "../src/battle-replays";
import { createRoom } from "../src/index";

test("room persistence snapshot restores an active neutral battle", () => {
  const room = createRoom("room-persist-neutral", 1001);
  room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 5, y: 4 }
  });

  const snapshot = room.serializePersistenceSnapshot();
  const restored = createRoom("room-persist-neutral", 1001, snapshot);

  assert.deepEqual(restored.serializePersistenceSnapshot(), snapshot);
  assert.equal(restored.getBattleForPlayer("player-1")?.id, "battle-neutral-1");
  assert.equal(restored.getSnapshot("player-1").state.ownHeroes[0]?.position.x, 5);
  assert.equal(restored.getSnapshot("player-1").state.ownHeroes[0]?.position.y, 3);
});

test("room persistence snapshot restores a resolved PvP world without active battles", () => {
  const room = createRoom("room-persist-pvp", 1001);
  room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 3, y: 4 }
  });
  room.dispatch("player-2", {
    type: "hero.move",
    heroId: "hero-2",
    destination: { x: 3, y: 4 }
  });

  let steps = 0;
  while (steps < 12) {
    const battle = room.getBattleForPlayer("player-1") ?? room.getBattleForPlayer("player-2");
    if (!battle) {
      break;
    }

    const activeUnitId = battle.activeUnitId;
    const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
    const attackerHero = battle.worldHeroId
      ? room.getInternalState().heroes.find((hero) => hero.id === battle.worldHeroId)
      : undefined;
    const defenderHero = battle.defenderHeroId
      ? room.getInternalState().heroes.find((hero) => hero.id === battle.defenderHeroId)
      : undefined;
    const playerId = activeUnit?.camp === "attacker" ? attackerHero?.playerId : defenderHero?.playerId;
    const target = activeUnit
      ? Object.values(battle.units).find((unit) => unit.camp !== activeUnit.camp && unit.count > 0)
      : undefined;

    assert.ok(activeUnitId);
    assert.ok(playerId);
    assert.ok(target);

    room.dispatchBattle(playerId, {
      type: "battle.attack",
      attackerId: activeUnitId,
      defenderId: target.id
    });
    steps += 1;
  }

  assert.ok(steps > 0);
  assert.ok(steps < 12);
  assert.equal(room.getBattleForPlayer("player-1"), null);
  assert.equal(room.getBattleForPlayer("player-2"), null);
  const replays = room.consumeCompletedBattleReplays();
  assert.equal(replays.length, 1);
  assert.match(replays[0]?.battleId ?? "", /^battle-hero-[12]-vs-hero-[12]$/);
  assert.equal(replays[0]?.initialState.id, replays[0]?.battleId);
  assert.equal(replays[0]?.steps.length, steps);
  assert.ok(
    replays[0]?.result === "attacker_victory" || replays[0]?.result === "defender_victory"
  );

  const snapshot = room.serializePersistenceSnapshot();
  const restored = createRoom("room-persist-pvp", 1001, snapshot);

  assert.equal(restored.getBattleForPlayer("player-1"), null);
  assert.equal(restored.getBattleForPlayer("player-2"), null);
  assert.deepEqual(restored.getSnapshot("player-1").state.ownHeroes[0], room.getSnapshot("player-1").state.ownHeroes[0]);
  assert.deepEqual(restored.getSnapshot("player-2").state.ownHeroes[0], room.getSnapshot("player-2").state.ownHeroes[0]);
});

test("player battle replay summaries preserve the global battle result for both camps", () => {
  const replay: CompletedBattleReplayCapture = {
    battleId: "battle-hero-1-vs-hero-2",
    roomId: "room-persist-pvp",
    attackerPlayerId: "player-1",
    defenderPlayerId: "player-2",
    startedAt: "2026-03-27T12:00:00.000Z",
    completedAt: "2026-03-27T12:01:00.000Z",
    initialState: {
      id: "battle-hero-1-vs-hero-2",
      heroTemplateId: "hero_knight",
      attacker: {
        id: "hero-1-stack",
        camp: "attacker",
        templateId: "hero_guard_basic",
        count: 12,
        attack: 4,
        defense: 2,
        hp: 10,
        maxHp: 10,
        morale: 0,
        luck: 0,
        speed: 4,
        retaliationsRemaining: 1,
        hasWaited: false,
        position: { x: 0, y: 0 }
      },
      defender: {
        id: "hero-2-stack",
        camp: "defender",
        templateId: "hero_guard_basic",
        count: 8,
        attack: 3,
        defense: 2,
        hp: 10,
        maxHp: 10,
        morale: 0,
        luck: 0,
        speed: 3,
        retaliationsRemaining: 1,
        hasWaited: false,
        position: { x: 1, y: 0 }
      },
      units: {
        "hero-1-stack": {
          id: "hero-1-stack",
          camp: "attacker",
          templateId: "hero_guard_basic",
          count: 12,
          attack: 4,
          defense: 2,
          hp: 10,
          maxHp: 10,
          morale: 0,
          luck: 0,
          speed: 4,
          retaliationsRemaining: 1,
          hasWaited: false,
          position: { x: 0, y: 0 }
        },
        "hero-2-stack": {
          id: "hero-2-stack",
          camp: "defender",
          templateId: "hero_guard_basic",
          count: 8,
          attack: 3,
          defense: 2,
          hp: 10,
          maxHp: 10,
          morale: 0,
          luck: 0,
          speed: 3,
          retaliationsRemaining: 1,
          hasWaited: false,
          position: { x: 1, y: 0 }
        }
      },
      turnOrder: ["hero-1-stack", "hero-2-stack"],
      activeUnitId: "hero-2-stack",
      round: 1,
      seed: 1001,
      worldHeroId: "hero-1",
      defenderHeroId: "hero-2"
    },
    battleState: {
      id: "battle-hero-1-vs-hero-2",
      heroTemplateId: "hero_knight",
      attacker: {
        id: "hero-1-stack",
        camp: "attacker",
        templateId: "hero_guard_basic",
        count: 7,
        attack: 4,
        defense: 2,
        hp: 10,
        maxHp: 10,
        morale: 0,
        luck: 0,
        speed: 4,
        retaliationsRemaining: 0,
        hasWaited: false,
        position: { x: 0, y: 0 }
      },
      defender: {
        id: "hero-2-stack",
        camp: "defender",
        templateId: "hero_guard_basic",
        count: 0,
        attack: 3,
        defense: 2,
        hp: 0,
        maxHp: 10,
        morale: 0,
        luck: 0,
        speed: 3,
        retaliationsRemaining: 0,
        hasWaited: false,
        position: { x: 1, y: 0 }
      },
      units: {
        "hero-1-stack": {
          id: "hero-1-stack",
          camp: "attacker",
          templateId: "hero_guard_basic",
          count: 7,
          attack: 4,
          defense: 2,
          hp: 10,
          maxHp: 10,
          morale: 0,
          luck: 0,
          speed: 4,
          retaliationsRemaining: 0,
          hasWaited: false,
          position: { x: 0, y: 0 }
        },
        "hero-2-stack": {
          id: "hero-2-stack",
          camp: "defender",
          templateId: "hero_guard_basic",
          count: 0,
          attack: 3,
          defense: 2,
          hp: 0,
          maxHp: 10,
          morale: 0,
          luck: 0,
          speed: 3,
          retaliationsRemaining: 0,
          hasWaited: false,
          position: { x: 1, y: 0 }
        }
      },
      turnOrder: ["hero-1-stack"],
      activeUnitId: "hero-1-stack",
      round: 2,
      seed: 1001,
      worldHeroId: "hero-1",
      defenderHeroId: "hero-2"
    },
    steps: [
      {
        index: 1,
        source: "player",
        action: {
          type: "battle.attack",
          attackerId: "hero-1-stack",
          defenderId: "hero-2-stack"
        }
      }
    ],
    result: "attacker_victory"
  };

  const attackerReplay = buildPlayerBattleReplaySummary(replay, "player-1", "hero-1", "attacker", "hero-2");
  const defenderReplay = buildPlayerBattleReplaySummary(replay, "player-2", "hero-2", "defender", "hero-1");

  assert.equal(attackerReplay.result, "attacker_victory");
  assert.equal(defenderReplay.result, "attacker_victory");
});

test("player battle replay summaries can resolve both camps from persisted participant ids", () => {
  const replay: CompletedBattleReplayCapture = {
    battleId: "battle-hero-1-vs-hero-2",
    roomId: "room-persist-pvp",
    attackerPlayerId: "player-1",
    defenderPlayerId: "player-2",
    startedAt: "2026-03-27T12:00:00.000Z",
    completedAt: "2026-03-27T12:01:00.000Z",
    initialState: {
      id: "battle-hero-1-vs-hero-2",
      heroTemplateId: "hero_knight",
      attacker: {
        id: "hero-1-stack",
        camp: "attacker",
        templateId: "hero_guard_basic",
        count: 12,
        attack: 4,
        defense: 2,
        hp: 10,
        maxHp: 10,
        morale: 0,
        luck: 0,
        speed: 4,
        retaliationsRemaining: 1,
        hasWaited: false,
        position: { x: 0, y: 0 }
      },
      defender: {
        id: "hero-2-stack",
        camp: "defender",
        templateId: "hero_guard_basic",
        count: 8,
        attack: 3,
        defense: 2,
        hp: 10,
        maxHp: 10,
        morale: 0,
        luck: 0,
        speed: 3,
        retaliationsRemaining: 1,
        hasWaited: false,
        position: { x: 1, y: 0 }
      },
      units: {
        "hero-1-stack": {
          id: "hero-1-stack",
          camp: "attacker",
          templateId: "hero_guard_basic",
          count: 12,
          attack: 4,
          defense: 2,
          hp: 10,
          maxHp: 10,
          morale: 0,
          luck: 0,
          speed: 4,
          retaliationsRemaining: 1,
          hasWaited: false,
          position: { x: 0, y: 0 }
        },
        "hero-2-stack": {
          id: "hero-2-stack",
          camp: "defender",
          templateId: "hero_guard_basic",
          count: 8,
          attack: 3,
          defense: 2,
          hp: 10,
          maxHp: 10,
          morale: 0,
          luck: 0,
          speed: 3,
          retaliationsRemaining: 1,
          hasWaited: false,
          position: { x: 1, y: 0 }
        }
      },
      turnOrder: ["hero-1-stack", "hero-2-stack"],
      activeUnitId: "hero-2-stack",
      round: 1,
      seed: 1001,
      worldHeroId: "hero-1",
      defenderHeroId: "hero-2"
    },
    battleState: {
      id: "battle-hero-1-vs-hero-2",
      heroTemplateId: "hero_knight",
      attacker: {
        id: "hero-1-stack",
        camp: "attacker",
        templateId: "hero_guard_basic",
        count: 7,
        attack: 4,
        defense: 2,
        hp: 10,
        maxHp: 10,
        morale: 0,
        luck: 0,
        speed: 4,
        retaliationsRemaining: 0,
        hasWaited: false,
        position: { x: 0, y: 0 }
      },
      defender: {
        id: "hero-2-stack",
        camp: "defender",
        templateId: "hero_guard_basic",
        count: 0,
        attack: 3,
        defense: 2,
        hp: 0,
        maxHp: 10,
        morale: 0,
        luck: 0,
        speed: 3,
        retaliationsRemaining: 0,
        hasWaited: false,
        position: { x: 1, y: 0 }
      },
      units: {
        "hero-1-stack": {
          id: "hero-1-stack",
          camp: "attacker",
          templateId: "hero_guard_basic",
          count: 7,
          attack: 4,
          defense: 2,
          hp: 10,
          maxHp: 10,
          morale: 0,
          luck: 0,
          speed: 4,
          retaliationsRemaining: 0,
          hasWaited: false,
          position: { x: 0, y: 0 }
        },
        "hero-2-stack": {
          id: "hero-2-stack",
          camp: "defender",
          templateId: "hero_guard_basic",
          count: 0,
          attack: 3,
          defense: 2,
          hp: 0,
          maxHp: 10,
          morale: 0,
          luck: 0,
          speed: 3,
          retaliationsRemaining: 0,
          hasWaited: false,
          position: { x: 1, y: 0 }
        }
      },
      turnOrder: ["hero-1-stack"],
      activeUnitId: "hero-1-stack",
      round: 2,
      seed: 1001,
      worldHeroId: "hero-1",
      defenderHeroId: "hero-2"
    },
    steps: [],
    result: "attacker_victory"
  };

  assert.deepEqual(
    buildPlayerBattleReplaySummariesForPlayer(replay, "player-1").map((entry) => entry.playerCamp),
    ["attacker"]
  );
  assert.deepEqual(
    buildPlayerBattleReplaySummariesForPlayer(replay, "player-2").map((entry) => entry.playerCamp),
    ["defender"]
  );
  assert.deepEqual(buildPlayerBattleReplaySummariesForPlayer(replay, "player-3"), []);
});
