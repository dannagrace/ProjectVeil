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

  const sequence = ["player-2", "player-1", "player-2", "player-1", "player-2"] as const;
  for (const playerId of sequence) {
    const battle = room.getBattleForPlayer(playerId);
    const activeUnitId = battle?.activeUnitId;
    const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
    const target = battle
      ? Object.values(battle.units).find((unit) => unit.camp !== activeUnit?.camp && unit.count > 0)
      : undefined;

    assert.ok(battle);
    assert.ok(activeUnitId);
    assert.ok(target);

    room.dispatchBattle(playerId, {
      type: "battle.attack",
      attackerId: activeUnitId,
      defenderId: target.id
    });
  }

  const snapshot = room.serializePersistenceSnapshot();
  const restored = createRoom("room-persist-pvp", 1001, snapshot);

  assert.equal(restored.getBattleForPlayer("player-1"), null);
  assert.equal(restored.getBattleForPlayer("player-2"), null);
  assert.deepEqual(restored.getSnapshot("player-1").state.ownHeroes[0], room.getSnapshot("player-1").state.ownHeroes[0]);
  assert.deepEqual(restored.getSnapshot("player-2").state.ownHeroes[0], room.getSnapshot("player-2").state.ownHeroes[0]);
});
