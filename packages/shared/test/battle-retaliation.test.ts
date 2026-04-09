import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBattleAction,
  createDemoBattleState,
  getDefaultBattleSkillCatalog,
  getDefaultUnitCatalog,
  restoreBattleReplayPlaybackState,
  validateUnitCatalog,
  type PlayerBattleReplaySummary
} from "../src/index.ts";

test("melee retaliation triggers once, resets next round, and replays deterministically", () => {
  const initial = createDemoBattleState();

  const firstStrike = applyBattleAction(initial, {
    type: "battle.attack",
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  });

  assert.equal(firstStrike.units["pikeman-a"]?.hasRetaliated, true);
  assert.match(firstStrike.log.join("\n"), /枪兵 反击 恶狼/);

  const replay: PlayerBattleReplaySummary = {
    id: "replay-retaliation-shared",
    roomId: "room-retaliation",
    playerId: "player-1",
    battleId: firstStrike.id,
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    neutralArmyId: "neutral-1",
    startedAt: "2026-04-09T00:00:00.000Z",
    completedAt: "2026-04-09T00:01:00.000Z",
    initialState: initial,
    steps: [
      {
        index: 1,
        source: "player",
        action: {
          type: "battle.attack",
          attackerId: "wolf-d",
          defenderId: "pikeman-a"
        }
      }
    ],
    result: "defender_victory"
  };

  const playback = restoreBattleReplayPlaybackState(replay, 1, "paused");
  assert.deepEqual(playback.currentState.units, firstStrike.units);
  assert.deepEqual(playback.currentState.rng, firstStrike.rng);
  assert.deepEqual(playback.currentState.log, firstStrike.log);

  const secondStrikeSource = createDemoBattleState();
  secondStrikeSource.activeUnitId = "pikeman-a";
  secondStrikeSource.turnOrder = ["pikeman-a", "wolf-d"];
  secondStrikeSource.units["wolf-d"] = {
    ...secondStrikeSource.units["wolf-d"]!,
    hasRetaliated: true
  };

  const secondStrike = applyBattleAction(secondStrikeSource, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.equal(secondStrike.units["wolf-d"]?.hasRetaliated, true);
  assert.ok(!secondStrike.log.some((entry) => entry.includes("恶狼 反击")));

  const roundResetSource = createDemoBattleState();
  roundResetSource.activeUnitId = "pikeman-a";
  roundResetSource.turnOrder = ["pikeman-a"];
  roundResetSource.units["pikeman-a"] = {
    ...roundResetSource.units["pikeman-a"]!,
    hasRetaliated: true,
    defending: true
  };
  roundResetSource.units["wolf-d"] = {
    ...roundResetSource.units["wolf-d"]!,
    hasRetaliated: true,
    defending: true
  };

  const roundReset = applyBattleAction(roundResetSource, {
    type: "battle.defend",
    unitId: "pikeman-a"
  });

  assert.equal(roundReset.round, 2);
  assert.equal(roundReset.units["pikeman-a"]?.hasRetaliated, false);
  assert.equal(roundReset.units["wolf-d"]?.hasRetaliated, false);
});

test("ranged attacks and lethal strikes skip retaliation", () => {
  const rangedAttacker = createDemoBattleState();
  rangedAttacker.units["wolf-d"] = {
    ...rangedAttacker.units["wolf-d"]!,
    attackRange: 2
  };

  const rangedResult = applyBattleAction(rangedAttacker, {
    type: "battle.attack",
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  });

  assert.equal(rangedResult.units["pikeman-a"]?.hasRetaliated, false);
  assert.equal(rangedResult.rng.cursor, 1);
  assert.ok(!rangedResult.log.some((entry) => entry.includes("反击")));

  const rangedDefender = createDemoBattleState();
  rangedDefender.activeUnitId = "pikeman-a";
  rangedDefender.turnOrder = ["pikeman-a", "wolf-d"];
  rangedDefender.units["wolf-d"] = {
    ...rangedDefender.units["wolf-d"]!,
    attackRange: 2
  };

  const defenderResult = applyBattleAction(rangedDefender, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.equal(defenderResult.units["wolf-d"]?.hasRetaliated, false);
  assert.equal(defenderResult.rng.cursor, 1);
  assert.ok(!defenderResult.log.some((entry) => entry.includes("反击")));

  const lethalStrike = createDemoBattleState();
  lethalStrike.activeUnitId = "pikeman-a";
  lethalStrike.turnOrder = ["pikeman-a", "wolf-d"];
  lethalStrike.units["wolf-d"] = {
    ...lethalStrike.units["wolf-d"]!,
    count: 1,
    currentHp: 1,
    statusEffects: []
  };

  const lethalResult = applyBattleAction(lethalStrike, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.equal(lethalResult.units["wolf-d"]?.count, 0);
  assert.equal(lethalResult.units["wolf-d"]?.hasRetaliated, false);
  assert.ok(!lethalResult.log.some((entry) => entry.includes("反击")));
});

test("unit catalog rejects invalid attack ranges", () => {
  const invalidCatalog = structuredClone(getDefaultUnitCatalog());
  invalidCatalog.templates[0] = {
    ...invalidCatalog.templates[0]!,
    attackRange: 0
  };

  assert.throws(
    () => validateUnitCatalog(invalidCatalog, getDefaultBattleSkillCatalog()),
    /Invalid attackRange/
  );
});
