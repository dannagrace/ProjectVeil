import assert from "node:assert/strict";
import test from "node:test";
import { createRoom } from "../src/index";

test("battle start auto-resolves defender opener before state is returned to the player", () => {
  const room = createRoom("room-auto-open", 1001);

  const result = room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 5, y: 4 }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.events, [
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      battleId: "battle-neutral-1",
      path: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 2 },
        { x: 5, y: 3 }
      ],
      moveCost: 6
    }
  ]);
  assert.ok(result.battle);
  assert.equal(result.battle?.units[result.battle.activeUnitId ?? ""]?.camp, "attacker");
  assert.deepEqual(result.battle?.log.slice(-2), [
    "恶狼 对 凯琳卫队 造成 24 伤害",
    "凯琳卫队 反击 恶狼，造成 30 伤害"
  ]);
  assert.deepEqual(result.snapshot.state.ownHeroes[0]?.position, { x: 5, y: 3 });
});

test("player battle actions are followed by automated defender turns until control returns", () => {
  const room = createRoom("room-auto-loop", 1001);
  const moveResult = room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 5, y: 4 }
  });

  assert.ok(moveResult.battle);
  assert.equal(moveResult.battle?.activeUnitId, "hero-1-stack");

  const battleResult = room.dispatchBattle("player-1", {
    type: "battle.defend",
    unitId: "hero-1-stack"
  });

  assert.equal(battleResult.ok, true);
  assert.ok(battleResult.battle);
  assert.equal(battleResult.battle?.round, 2);
  assert.equal(battleResult.battle?.units[battleResult.battle?.activeUnitId ?? ""]?.camp, "attacker");
  assert.deepEqual(battleResult.battle?.log.slice(-3), [
    "hero-1-stack 进入防御",
    "恶狼 对 凯琳卫队 造成 16 伤害",
    "凯琳卫队 反击 恶狼，造成 27 伤害"
  ]);
});

test("server rejects battle actions sent for non-player-controlled defender units", () => {
  const room = createRoom("room-control-check", 1001);
  room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 5, y: 4 }
  });

  const result = room.dispatchBattle("player-1", {
    type: "battle.attack",
    attackerId: "neutral-1-stack-1",
    defenderId: "hero-1-stack"
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unit_not_player_controlled");
  assert.ok(result.battle);
});

test("room supports concurrent neutral battles and returns player-specific battle snapshots", () => {
  const room = createRoom("room-concurrent-battles", 1001);
  const state = room.getInternalState();
  const playerTwoHero = state.heroes.find((hero) => hero.id === "hero-2");

  assert.ok(playerTwoHero);
  const secondNeutralTile = state.map.tiles.find(
    (tile) =>
      Math.abs(tile.position.x - playerTwoHero.position.x) + Math.abs(tile.position.y - playerTwoHero.position.y) === 1 &&
      tile.walkable &&
      !tile.occupant
  );

  assert.ok(secondNeutralTile);
  state.neutralArmies["neutral-2"] = {
    id: "neutral-2",
    position: secondNeutralTile.position,
    reward: { kind: "wood", amount: 5 },
    stacks: [{ templateId: "wolf_pack", count: 6 }]
  };
  secondNeutralTile.occupant = { kind: "neutral", refId: "neutral-2" };

  const playerOneResult = room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 5, y: 4 }
  });
  const playerTwoResult = room.dispatch("player-2", {
    type: "hero.move",
    heroId: "hero-2",
    destination: secondNeutralTile.position
  });

  assert.equal(playerOneResult.battle?.id, "battle-neutral-1");
  assert.equal(playerTwoResult.battle?.id, "battle-neutral-2");
  assert.equal(room.getActiveBattles().length, 2);
  assert.equal(room.getBattleForPlayer("player-1")?.id, "battle-neutral-1");
  assert.equal(room.getBattleForPlayer("player-2")?.id, "battle-neutral-2");
  assert.equal(playerTwoResult.battle?.worldHeroId, "hero-2");
  assert.equal(playerTwoResult.battle?.units[playerTwoResult.battle.activeUnitId ?? ""]?.camp, "attacker");
});

test("room filters event timelines per player without hiding PvP battle results from defenders", () => {
  const room = createRoom("room-event-filter", 1001);
  const events = [
    {
      type: "hero.moved" as const,
      heroId: "hero-1",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    },
    {
      type: "battle.started" as const,
      heroId: "hero-1",
      defenderHeroId: "hero-2",
      encounterKind: "hero" as const,
      battleId: "battle-hero-1-vs-hero-2",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    },
    {
      type: "battle.resolved" as const,
      heroId: "hero-1",
      defenderHeroId: "hero-2",
      battleId: "battle-hero-1-vs-hero-2",
      result: "attacker_victory" as const
    },
    {
      type: "turn.advanced" as const,
      day: 2
    }
  ];

  assert.deepEqual(room.filterEventsForPlayer("player-1", events), events);
  assert.deepEqual(room.filterEventsForPlayer("player-2", events), [events[1], events[2], events[3]]);
});
