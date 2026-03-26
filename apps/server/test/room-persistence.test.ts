import assert from "node:assert/strict";
import test from "node:test";
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
  assert.equal(restored.getSnapshot("player-1").state.ownHeroes[0]?.position.x, 4);
  assert.equal(restored.getSnapshot("player-1").state.ownHeroes[0]?.position.y, 4);
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

  const snapshot = room.serializePersistenceSnapshot();
  const restored = createRoom("room-persist-pvp", 1001, snapshot);

  assert.equal(restored.getBattleForPlayer("player-1"), null);
  assert.equal(restored.getBattleForPlayer("player-2"), null);
  assert.deepEqual(restored.getSnapshot("player-1").state.ownHeroes[0], room.getSnapshot("player-1").state.ownHeroes[0]);
  assert.deepEqual(restored.getSnapshot("player-2").state.ownHeroes[0], room.getSnapshot("player-2").state.ownHeroes[0]);
});
