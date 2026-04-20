import assert from "node:assert/strict";
import test from "node:test";
import { createDemoBattleState } from "@veil/shared/battle";
import { createRoom } from "../src/index";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "../src/observability";

function resolveBattle(room: ReturnType<typeof createRoom>, playerId: string): void {
  let steps = 0;
  while (steps < 20) {
    const battle = room.getBattleForPlayer(playerId);
    if (!battle) {
      return;
    }

    const activeUnitId = battle.activeUnitId;
    const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
    const target = activeUnit
      ? Object.values(battle.units).find((unit) => unit.camp !== activeUnit.camp && unit.count > 0)
      : undefined;

    assert.ok(activeUnitId);
    assert.ok(target);

    room.dispatchBattle(playerId, {
      type: "battle.attack",
      attackerId: activeUnitId,
      defenderId: target.id
    });
    steps += 1;
  }

  assert.fail(`expected battle for ${playerId} to resolve within 20 actions`);
}

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
      attackerPlayerId: "player-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      battleId: "battle-neutral-1",
      path: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 4, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 2 },
        { x: 5, y: 3 }
      ],
      moveCost: 6
    }
  ]);
  assert.ok(result.battle);
  assert.equal(result.battle?.units[result.battle.activeUnitId ?? ""]?.camp, "attacker");
  assert.deepEqual(result.battle?.log.slice(-4), [
    "恶狼 施放 裂伤嚎叫，对 凯琳卫队 造成 15 伤害",
    "恶狼 的裂伤嚎叫让 凯琳卫队 陷入削弱",
    "恶狼 的毒牙让 凯琳卫队 陷入中毒",
    "凯琳卫队 受到中毒影响，损失 2 生命"
  ]);
  assert.deepEqual(
    result.battle?.units["hero-1-stack"]?.statusEffects?.map((status) => status.id).sort(),
    ["poisoned", "weakened"]
  );
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
  assert.deepEqual(battleResult.battle?.log.slice(-8), [
    "恶狼 踩中隐藏陷阱 缠足泥沼，陷阱位置暴露",
    "恶狼 因 缠足泥沼 陷入减速",
    "缠足泥沼 已失效，但该位置对双方保持可见",
    "恶狼 对 凯琳卫队 造成 25 伤害",
    "恶狼 的毒牙让 凯琳卫队 陷入中毒",
    "凯琳卫队 反击 恶狼，造成 21 伤害",
    "凯琳卫队 的削弱结束",
    "凯琳卫队 受到中毒影响，损失 2 生命"
  ]);
  assert.deepEqual(battleResult.battle?.environment, [
    {
      id: "hazard-trap-0",
      kind: "trap",
      lane: 0,
      effect: "slow",
      name: "缠足泥沼",
      description: "踩中后会被拖慢，下一轮行动明显延后。",
      damage: 0,
      charges: 0,
      revealed: true,
      triggered: true,
      grantedStatusId: "slowed",
      triggeredByCamp: "both"
    }
  ]);
});

test("server rejects battle actions sent for non-player-controlled defender units", () => {
  resetRuntimeObservability();
  const room = createRoom("room-control-check", 1001);
  const battle = createDemoBattleState();
  battle.id = "battle-control-check";
  battle.worldHeroId = "hero-1";
  battle.activeUnitId = "pikeman-a";
  battle.turnOrder = ["pikeman-a", "wolf-d"];
  (room as ReturnType<typeof createRoom> & { setBattle(battleState: typeof battle): void }).setBattle(battle);

  const result = room.dispatchBattle("player-1", {
    type: "battle.attack",
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unit_not_player_controlled");
  assert.ok(result.battle);
  assert.match(
    buildPrometheusMetricsDocument(),
    /^veil_action_validation_failures_total\{reason="unit_not_player_controlled",scope="battle"\} 1$/m
  );
});

test("server rejects terrain-locked battle skills before mutating authoritative battle state", () => {
  resetRuntimeObservability();
  const room = createRoom("room-terrain-locked-skill", 1001);
  const battle = createDemoBattleState();
  battle.id = "battle-terrain-locked-skill";
  battle.worldHeroId = "hero-1";
  battle.activeUnitId = "pikeman-a";
  battle.turnOrder = ["pikeman-a", "wolf-d"];
  battle.battlefieldTerrain = "grass";
  battle.log = [];
  const playerUnit = battle.units["pikeman-a"];
  const opposingUnit = battle.units["wolf-d"];

  assert.ok(battle);
  assert.ok(playerUnit);
  assert.ok(opposingUnit);

  battle.units[playerUnit.id] = {
    ...playerUnit,
    skills: [
      ...(playerUnit.skills ?? []),
      {
        id: "bog_ambush",
        name: "泥沼伏袭",
        description: "只有在水泽地形中才能发动，伤害显著提升。",
        kind: "active",
        target: "enemy",
        cooldown: 3,
        remainingCooldown: 0
      }
    ]
  };
  (room as ReturnType<typeof createRoom> & { setBattle(battleState: typeof battle): void }).setBattle(battle);

  const result = room.dispatchBattle("player-1", {
    type: "battle.skill",
    unitId: playerUnit.id,
    skillId: "bog_ambush",
    targetId: opposingUnit.id
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "skill_requires_water_terrain");
  assert.ok(result.battle);
  assert.equal(result.battle?.log.includes("Action rejected: skill_requires_water_terrain"), false);
  assert.equal(result.battle?.units[opposingUnit.id]?.count, opposingUnit.count);
  assert.match(
    buildPrometheusMetricsDocument(),
    /^veil_action_validation_failures_total\{reason="skill_requires_water_terrain",scope="battle"\} 1$/m
  );
});

test("completed battles contribute to Prometheus battle duration observations", () => {
  resetRuntimeObservability();
  const room = createRoom("room-battle-duration", 1001);

  room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 5, y: 4 }
  });

  resolveBattle(room, "player-1");

  const metrics = buildPrometheusMetricsDocument();
  assert.match(metrics, /^veil_battle_duration_seconds_count 1$/m);
  assert.match(metrics, /^veil_battle_duration_seconds_bucket\{le="1"\} 1$/m);
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
  assert.notEqual(playerOneResult.battle?.rng.seed, playerTwoResult.battle?.rng.seed);
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
      attackerPlayerId: "player-1",
      defenderHeroId: "hero-2",
      defenderPlayerId: "player-2",
      encounterKind: "hero" as const,
      battleId: "battle-hero-1-vs-hero-2",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    },
    {
      type: "battle.resolved" as const,
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      defenderHeroId: "hero-2",
      defenderPlayerId: "player-2",
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

test("room equips hero items from carried inventory and emits the equipment change event", () => {
  const room = createRoom("room-equip", 1001);
  const state = room.getInternalState();
  const hero = state.heroes.find((entry) => entry.id === "hero-1");

  if (!hero) {
    throw new Error("Expected hero-1 to exist");
  }

  hero.loadout.inventory = ["vanguard_blade", "padded_gambeson", "scout_compass"];

  const result = room.dispatch("player-1", {
    type: "hero.equip",
    heroId: "hero-1",
    slot: "weapon",
    equipmentId: "vanguard_blade"
  });

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.state.ownHeroes[0]?.loadout.equipment.weaponId, "vanguard_blade");
  assert.deepEqual(result.snapshot.state.ownHeroes[0]?.loadout.inventory, ["padded_gambeson", "scout_compass"]);
  assert.deepEqual(result.events, [
    {
      type: "hero.equipmentChanged",
      heroId: "hero-1",
      slot: "weapon",
      equippedItemId: "vanguard_blade"
    }
  ]);
});

test("room rejects unequip when the backpack is already full", () => {
  const room = createRoom("room-unequip-full", 1001);
  const state = room.getInternalState();
  const hero = state.heroes.find((entry) => entry.id === "hero-1");

  if (!hero) {
    throw new Error("Expected hero-1 to exist");
  }

  hero.loadout.equipment.weaponId = "vanguard_blade";
  hero.loadout.inventory = [
    "militia_pike",
    "oak_longbow",
    "padded_gambeson",
    "tower_shield_mail",
    "scout_compass",
    "sun_medallion"
  ];

  const result = room.dispatch("player-1", {
    type: "hero.unequip",
    heroId: "hero-1",
    slot: "weapon"
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "equipment_inventory_full");
  assert.equal(result.snapshot.state.ownHeroes[0]?.loadout.equipment.weaponId, "vanguard_blade");
});

test("room allows recruiting from a recruitment post when the hero stands on it", () => {
  const room = createRoom("room-recruit", 1001);
  const state = room.getInternalState();
  state.resources["player-1"] = {
    gold: 300,
    wood: 0,
    ore: 0
  };

  const moveResult = room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 1, y: 3 }
  });

  assert.equal(moveResult.ok, true);
  assert.deepEqual(moveResult.snapshot.state.ownHeroes[0]?.position, { x: 1, y: 3 });

  const recruitResult = room.dispatch("player-1", {
    type: "hero.recruit",
    heroId: "hero-1",
    buildingId: "recruit-post-1"
  });

  assert.equal(recruitResult.ok, true);
  assert.deepEqual(recruitResult.events, [
    {
      type: "hero.recruited",
      heroId: "hero-1",
      buildingId: "recruit-post-1",
      buildingKind: "recruitment_post",
      unitTemplateId: "hero_guard_basic",
      count: 4,
      cost: {
        gold: 240,
        wood: 0,
        ore: 0
      }
    }
  ]);
  assert.equal(recruitResult.snapshot.state.ownHeroes[0]?.armyCount, 16);
  assert.equal(recruitResult.snapshot.state.resources.gold, 60);
  assert.equal(
    recruitResult.snapshot.state.map.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 3)?.building?.availableCount,
    0
  );
});

test("room allows visiting an attribute shrine once and persists the stat bonus", () => {
  const room = createRoom("room-shrine", 1001);

  const moveResult = room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 3, y: 2 }
  });

  assert.equal(moveResult.ok, true);
  assert.deepEqual(moveResult.snapshot.state.ownHeroes[0]?.position, { x: 3, y: 2 });

  const visitResult = room.dispatch("player-1", {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "shrine-attack-1"
  });

  assert.equal(visitResult.ok, true);
  assert.deepEqual(visitResult.events, [
    {
      type: "hero.visited",
      heroId: "hero-1",
      buildingId: "shrine-attack-1",
      buildingKind: "attribute_shrine",
      bonus: {
        attack: 2,
        defense: 0,
        power: 0,
        knowledge: 0
      }
    }
  ]);
  assert.equal(visitResult.snapshot.state.ownHeroes[0]?.stats.attack, 4);

  const revisitResult = room.dispatch("player-1", {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "shrine-attack-1"
  });

  assert.equal(revisitResult.ok, false);
  assert.equal(revisitResult.reason, "building_on_cooldown");
});

test("room allows visiting the contested basin watchtower and persists the vision bonus", () => {
  const room = createRoom("room-watchtower[map:contested_basin]", 1001);

  const moveResult = room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 4, y: 5 }
  });

  assert.equal(moveResult.ok, true);
  assert.deepEqual(moveResult.snapshot.state.ownHeroes[0]?.position, { x: 4, y: 5 });

  const nextDayResult = room.dispatch("player-1", {
    type: "turn.endDay"
  });

  assert.equal(nextDayResult.ok, true);

  const finalMoveResult = room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 5, y: 4 }
  });

  assert.equal(finalMoveResult.ok, true);
  assert.deepEqual(finalMoveResult.snapshot.state.ownHeroes[0]?.position, { x: 5, y: 4 });

  const visitResult = room.dispatch("player-1", {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "watchtower-basin-1"
  });

  assert.equal(visitResult.ok, true);
  assert.deepEqual(visitResult.events, [
    {
      type: "hero.visited",
      heroId: "hero-1",
      buildingId: "watchtower-basin-1",
      buildingKind: "watchtower",
      visionBonus: 2
    }
  ]);
  assert.equal(visitResult.snapshot.state.ownHeroes[0]?.vision, 4);

  const revisitResult = room.dispatch("player-1", {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "watchtower-basin-1"
  });

  assert.equal(revisitResult.ok, false);
  assert.equal(revisitResult.reason, "building_on_cooldown");
});

test("room allows harvesting a resource mine and restores it on the next day", () => {
  const room = createRoom("room-mine", 1001);

  const moveResult = room.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 3, y: 1 }
  });

  assert.equal(moveResult.ok, true);
  assert.deepEqual(moveResult.snapshot.state.ownHeroes[0]?.position, { x: 3, y: 1 });

  const claimResult = room.dispatch("player-1", {
    type: "hero.claimMine",
    heroId: "hero-1",
    buildingId: "mine-wood-1"
  });

  assert.equal(claimResult.ok, true);
  assert.deepEqual(claimResult.events, [
    {
      type: "hero.claimedMine",
      heroId: "hero-1",
      buildingId: "mine-wood-1",
      buildingKind: "resource_mine",
      resourceKind: "wood",
      income: 5,
      ownerPlayerId: "player-1"
    }
  ]);
  assert.equal(
    claimResult.snapshot.state.map.tiles.find((tile) => tile.position.x === 3 && tile.position.y === 1)?.building?.lastHarvestDay,
    1
  );
  assert.equal(claimResult.snapshot.state.resources.wood, 5);

  const nextDayResult = room.dispatch("player-1", {
    type: "turn.endDay"
  });

  assert.equal(nextDayResult.ok, true);
  assert.deepEqual(nextDayResult.events, [
    {
      type: "turn.advanced",
      day: 2
    },
    {
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 5, y: 4 },
      to: { x: 6, y: 5 },
      reason: "chase",
      targetHeroId: "hero-2"
    }
  ]);
  assert.equal(nextDayResult.snapshot.state.resources.wood, 5);
});

test("room can create a neutral-initiated battle when end day triggers an adjacent chase", () => {
  const room = createRoom("room-neutral-chase", 1001);
  const state = room.getInternalState();
  const previousNeutralTile = state.map.tiles.find((tile) => tile.occupant?.kind === "neutral" && tile.occupant.refId === "neutral-1");
  if (previousNeutralTile) {
    previousNeutralTile.occupant = undefined;
  }

  state.neutralArmies["neutral-1"] = {
    ...state.neutralArmies["neutral-1"],
    position: { x: 2, y: 1 },
    origin: { x: 2, y: 1 },
    behavior: {
      mode: "guard",
      patrolPath: [],
      patrolIndex: 0,
      detectionRadius: 1,
      chaseDistance: 3,
      patrolRadius: 0,
      speed: 1,
      state: "return"
    }
  };
  const nextNeutralTile = state.map.tiles.find((tile) => tile.position.x === 2 && tile.position.y === 1);
  assert.ok(nextNeutralTile);
  nextNeutralTile.walkable = true;
  nextNeutralTile.terrain = "grass";
  nextNeutralTile.occupant = { kind: "neutral", refId: "neutral-1" };

  const result = room.dispatch("player-1", {
    type: "turn.endDay"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.events?.slice(0, 2), [
    {
      type: "turn.advanced",
      day: 2
    },
    {
      type: "battle.started",
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      initiator: "neutral",
      battleId: "battle-neutral-1",
      path: [{ x: 1, y: 1 }],
      moveCost: 0
    }
  ]);
  assert.equal(result.battle?.id, "battle-neutral-1");
  assert.equal(result.battle?.units[result.battle.activeUnitId ?? ""]?.camp, "attacker");
});
