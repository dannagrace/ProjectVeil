import assert from "node:assert/strict";
import test from "node:test";
import { predictPlayerWorldAction } from "../assets/scripts/cocos-prediction.ts";
import {
  createPredictionWorld,
  placeOwnHero,
  updateTile,
  withOccupant
} from "./helpers/cocos-prediction-harness.ts";

test("predictPlayerWorldAction plans a reachable move and updates hero position, occupancy and remaining reachability", () => {
  const world = createPredictionWorld();

  const prediction = predictPlayerWorldAction(world, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  });

  assert.equal(prediction.reason, undefined);
  assert.deepEqual(prediction.movementPlan, {
    heroId: "hero-1",
    destination: { x: 2, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    travelPath: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    moveCost: 2,
    endsInEncounter: false,
    encounterKind: "none"
  });
  assert.deepEqual(prediction.world.ownHeroes[0]?.position, { x: 2, y: 0 });
  assert.equal(prediction.world.ownHeroes[0]?.move.remaining, 4);
  assert.equal(prediction.world.map.tiles[0]?.occupant, undefined);
  assert.deepEqual(prediction.world.map.tiles[2]?.occupant, {
    kind: "hero",
    refId: "hero-1"
  });
  assert.deepEqual(prediction.reachableTiles, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 3, y: 2 }
  ]);
});

test("predictPlayerWorldAction stops short of neutral encounters and leaves no predicted occupant on the contested tile", () => {
  const world = withOccupant(
    createPredictionWorld(),
    { x: 2, y: 0 },
    { kind: "neutral", refId: "neutral-1" }
  );

  const prediction = predictPlayerWorldAction(world, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  });

  assert.equal(prediction.reason, undefined);
  assert.deepEqual(prediction.movementPlan, {
    heroId: "hero-1",
    destination: { x: 2, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    travelPath: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    moveCost: 1,
    endsInEncounter: true,
    encounterKind: "neutral",
    encounterRefId: "neutral-1"
  });
  assert.deepEqual(prediction.world.ownHeroes[0]?.position, { x: 1, y: 0 });
  assert.equal(prediction.world.map.tiles[1]?.occupant, undefined);
  assert.deepEqual(prediction.world.map.tiles[2]?.occupant, {
    kind: "neutral",
    refId: "neutral-1"
  });
  assert.deepEqual(prediction.reachableTiles, []);
});

test("predictPlayerWorldAction rejects destinations blocked by owned heroes or visible enemy heroes when no alternate path exists", () => {
  let world = createPredictionWorld();
  world = placeOwnHero(world, {
    id: "hero-2",
    playerId: world.playerId,
    name: "Second",
    position: { x: 1, y: 0 }
  });
  world = updateTile(world, { x: 0, y: 1 }, { walkable: false });
  world = updateTile(world, { x: 1, y: 1 }, { walkable: false });

  const ownHeroBlocked = predictPlayerWorldAction(world, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  });

  assert.equal(ownHeroBlocked.reason, "path_not_found");
  assert.equal(ownHeroBlocked.movementPlan, null);
  assert.deepEqual(ownHeroBlocked.reachableTiles, []);

  const enemyBlockedWorld = updateTile(
    createPredictionWorld({
      visibleHeroes: [
        {
          id: "enemy-1",
          playerId: "player-2",
          name: "Invader",
          position: { x: 1, y: 0 }
        }
      ]
    }),
    { x: 0, y: 1 },
    { walkable: false }
  );
  const sealedEnemyBlockedWorld = updateTile(enemyBlockedWorld, { x: 1, y: 1 }, { walkable: false });

  const enemyBlocked = predictPlayerWorldAction(sealedEnemyBlockedWorld, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  });

  assert.equal(enemyBlocked.reason, "path_not_found");
  assert.equal(enemyBlocked.movementPlan, null);
  assert.deepEqual(enemyBlocked.reachableTiles, []);
});

test("predictPlayerWorldAction reports move-point exhaustion after planning a valid route", () => {
  const world = createPredictionWorld({ moveRemaining: 1 });

  const prediction = predictPlayerWorldAction(world, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  });

  assert.equal(prediction.reason, "not_enough_move_points");
  assert.equal(prediction.movementPlan, null);
  assert.deepEqual(prediction.reachableTiles, []);
  assert.deepEqual(prediction.world.ownHeroes[0]?.position, { x: 0, y: 0 });
});
