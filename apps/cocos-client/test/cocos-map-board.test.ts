import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTileViewModel,
  moveMapBoardKeyboardCursor,
  resolveMapBoardFeedbackLabel
} from "../assets/scripts/cocos-map-board-model";
import type { PlayerTileView, SessionUpdate } from "../assets/scripts/VeilCocosSession";

function createTile(
  position: { x: number; y: number },
  overrides: Partial<PlayerTileView> = {}
): PlayerTileView {
  return {
    position,
    fog: "visible",
    terrain: "grass",
    walkable: true,
    resource: undefined,
    occupant: undefined,
    building: undefined,
    ...overrides
  };
}

function createBaseUpdate(): SessionUpdate {
  return {
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day: 1
      },
      map: {
        width: 3,
        height: 3,
        tiles: [
          createTile({ x: 0, y: 0 }, { fog: "explored" }),
          createTile({ x: 1, y: 1 }, { resource: { kind: "wood", amount: 5 } }),
          createTile({ x: 2, y: 2 })
        ]
      },
      ownHeroes: [
        {
          id: "hero-1",
          playerId: "player-1",
          name: "Katherine",
          position: { x: 1, y: 1 },
          vision: 4,
          move: {
            total: 6,
            remaining: 4
          },
          stats: {
            attack: 2,
            defense: 2,
            power: 1,
            knowledge: 1,
            hp: 30,
            maxHp: 30
          },
          progression: {
            level: 2,
            experience: 40,
            skillPoints: 1,
            battlesWon: 1,
            neutralBattlesWon: 1,
            pvpBattlesWon: 0
          },
          armyCount: 11,
          armyTemplateId: "hero_guard_basic",
          learnedSkills: []
        }
      ],
      visibleHeroes: [],
      resources: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      playerId: "player-1"
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: [{ x: 1, y: 1 }, { x: 2, y: 2 }]
  };
}

test("buildTileViewModel exposes interactable, reachable and fog flags from the world snapshot", () => {
  const update = createBaseUpdate();

  assert.deepEqual(buildTileViewModel(update, { x: 0, y: 0 }), {
    key: "0-0",
    tile: update.world.map.tiles[0],
    fog: "explored",
    reachable: false,
    heroTile: false,
    interactable: true,
    objectMarker: null
  });

  const heroTile = buildTileViewModel(update, { x: 1, y: 1 });
  assert.equal(heroTile.fog, "visible");
  assert.equal(heroTile.reachable, true);
  assert.equal(heroTile.heroTile, true);
  assert.equal(heroTile.objectMarker?.iconKey, "wood");
  assert.equal(heroTile.objectMarker?.fallbackLabel, "木材");
});

test("map board marker resolution preserves resource icon keys and fallback labels", () => {
  const update = createBaseUpdate();
  const view = buildTileViewModel(update, { x: 1, y: 1 });

  assert.equal(view.objectMarker?.descriptor.title, "木材堆");
  assert.equal(view.objectMarker?.iconKey, "wood");
  assert.equal(view.objectMarker?.fallbackLabel, "木材");
  assert.equal(view.objectMarker?.interactionType, "pickup");
});

test("keyboard cursor movement advances the highlight and clears the previous tile key", () => {
  const firstMove = moveMapBoardKeyboardCursor(null, "right", { width: 4, height: 3 });
  assert.deepEqual(firstMove, {
    previous: null,
    current: { x: 1, y: 0 },
    clearedKey: null,
    highlightedKey: "1-0"
  });

  const secondMove = moveMapBoardKeyboardCursor(firstMove.current, "down", { width: 4, height: 3 });
  assert.deepEqual(secondMove, {
    previous: { x: 1, y: 0 },
    current: { x: 1, y: 1 },
    clearedKey: "1-0",
    highlightedKey: "1-1"
  });
});

test("resolveMapBoardFeedbackLabel maps move, resource, battle-start and battle-result events", () => {
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "hero.moved",
      heroId: "hero-1",
      path: [{ x: 1, y: 1 }],
      moveCost: 2
    }),
    "MOVE 2"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "hero.collected",
      heroId: "hero-1",
      resource: { kind: "wood", amount: 5 }
    }),
    "+WOOD"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "battle.started",
      heroId: "hero-1",
      path: [{ x: 2, y: 2 }],
      encounterKind: "neutral"
    }),
    "PVE"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel(
      {
        type: "battle.resolved",
        heroId: "hero-1",
        defenderHeroId: undefined,
        battleId: "battle-1",
        result: "attacker_victory"
      },
      { heroId: "hero-1" }
    ),
    "VICTORY"
  );
});
