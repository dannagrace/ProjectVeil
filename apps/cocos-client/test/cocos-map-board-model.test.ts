import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTileViewModel,
  moveMapBoardKeyboardCursor,
  resolveMapBoardFeedbackLabel
} from "../assets/scripts/cocos-map-board-model";
import type { PlayerTileView, SessionUpdate, TerrainType } from "../assets/scripts/VeilCocosSession";

function createTile(
  position: { x: number; y: number },
  options: Partial<PlayerTileView> = {}
): PlayerTileView {
  return {
    position,
    fog: options.fog ?? "visible",
    terrain: options.terrain ?? "grass",
    walkable: options.walkable ?? true,
    resource: options.resource,
    occupant: options.occupant,
    building: options.building
  };
}

function createBaseUpdate(tiles: PlayerTileView[] = [createTile({ x: 0, y: 0 })]): SessionUpdate {
  return {
    world: {
      meta: {
        roomId: "room-654",
        seed: 1654,
        day: 3
      },
      map: {
        width: 3,
        height: 3,
        tiles
      },
      ownHeroes: [
        {
          id: "hero-1",
          playerId: "player-1",
          name: "Katherine",
          position: { x: 1, y: 1 },
          vision: 5,
          move: {
            total: 8,
            remaining: 5
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
            experience: 80,
            skillPoints: 1,
            battlesWon: 1,
            neutralBattlesWon: 1,
            pvpBattlesWon: 0
          },
          loadout: {
            learnedSkills: [],
            equipment: {
              trinketIds: []
            },
            inventory: []
          },
          armyCount: 12,
          armyTemplateId: "hero_guard_basic",
          learnedSkills: []
        }
      ],
      visibleHeroes: [],
      resources: {
        gold: 100,
        wood: 5,
        ore: 3
      },
      playerId: "player-1"
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: []
  };
}

test("buildTileViewModel covers visible, explored, hidden, reachable and hero tile states", () => {
  const visibleTile = createTile(
    { x: 0, y: 0 },
    {
      terrain: "dirt" satisfies TerrainType,
      resource: { kind: "wood", amount: 5 }
    }
  );
  const exploredTile = createTile({ x: 2, y: 0 }, { fog: "explored" });
  const update = createBaseUpdate([visibleTile, exploredTile]);
  update.reachableTiles = [{ x: 0, y: 0 }];

  const visibleView = buildTileViewModel(update, { x: 0, y: 0 });
  assert.equal(visibleView.tile, visibleTile);
  assert.equal(visibleView.fog, "visible");
  assert.equal(visibleView.reachable, true);
  assert.equal(visibleView.heroTile, false);
  assert.equal(visibleView.interactable, true);
  assert.equal(visibleView.objectMarker?.iconKey, "wood");

  const exploredView = buildTileViewModel(update, { x: 2, y: 0 });
  assert.equal(exploredView.fog, "explored");
  assert.equal(exploredView.reachable, false);
  assert.equal(exploredView.heroTile, false);
  assert.equal(exploredView.interactable, true);
  assert.equal(exploredView.objectMarker, null);

  const heroTileView = buildTileViewModel(update, { x: 1, y: 1 }, "hero-1");
  assert.equal(heroTileView.tile, null);
  assert.equal(heroTileView.fog, "hidden");
  assert.equal(heroTileView.reachable, false);
  assert.equal(heroTileView.heroTile, true);
  assert.equal(heroTileView.interactable, false);
  assert.equal(heroTileView.objectMarker, null);
});

test("buildTileViewModel falls back to the first own hero when no hero id is provided", () => {
  const update = createBaseUpdate([createTile({ x: 1, y: 1 })]);

  const view = buildTileViewModel(update, { x: 1, y: 1 });

  assert.equal(view.heroTile, true);
  assert.equal(view.interactable, true);
});

test("moveMapBoardKeyboardCursor moves in every direction and clamps at map edges", () => {
  assert.deepEqual(moveMapBoardKeyboardCursor({ x: 1, y: 1 }, "up", { width: 3, height: 3 }), {
    previous: { x: 1, y: 1 },
    current: { x: 1, y: 0 },
    clearedKey: "1-1",
    highlightedKey: "1-0"
  });
  assert.deepEqual(moveMapBoardKeyboardCursor({ x: 1, y: 1 }, "right", { width: 3, height: 3 }), {
    previous: { x: 1, y: 1 },
    current: { x: 2, y: 1 },
    clearedKey: "1-1",
    highlightedKey: "2-1"
  });
  assert.deepEqual(moveMapBoardKeyboardCursor({ x: 1, y: 1 }, "down", { width: 3, height: 3 }), {
    previous: { x: 1, y: 1 },
    current: { x: 1, y: 2 },
    clearedKey: "1-1",
    highlightedKey: "1-2"
  });
  assert.deepEqual(moveMapBoardKeyboardCursor({ x: 1, y: 1 }, "left", { width: 3, height: 3 }), {
    previous: { x: 1, y: 1 },
    current: { x: 0, y: 1 },
    clearedKey: "1-1",
    highlightedKey: "0-1"
  });

  assert.deepEqual(moveMapBoardKeyboardCursor({ x: 0, y: 0 }, "up", { width: 3, height: 3 }), {
    previous: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    clearedKey: "0-0",
    highlightedKey: "0-0"
  });
  assert.deepEqual(moveMapBoardKeyboardCursor({ x: 2, y: 0 }, "right", { width: 3, height: 3 }), {
    previous: { x: 2, y: 0 },
    current: { x: 2, y: 0 },
    clearedKey: "2-0",
    highlightedKey: "2-0"
  });
  assert.deepEqual(moveMapBoardKeyboardCursor({ x: 1, y: 2 }, "down", { width: 3, height: 3 }), {
    previous: { x: 1, y: 2 },
    current: { x: 1, y: 2 },
    clearedKey: "1-2",
    highlightedKey: "1-2"
  });
  assert.deepEqual(moveMapBoardKeyboardCursor({ x: 0, y: 1 }, "left", { width: 3, height: 3 }), {
    previous: { x: 0, y: 1 },
    current: { x: 0, y: 1 },
    clearedKey: "0-1",
    highlightedKey: "0-1"
  });
});

test("resolveMapBoardFeedbackLabel covers map-board feedback variants", () => {
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
      resource: { kind: "ore", amount: 4 }
    }),
    "+ORE"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "hero.recruited",
      heroId: "hero-1",
      buildingId: "recruit-1",
      buildingKind: "recruitment_post",
      unitTemplateId: "hero_guard_basic",
      count: 6,
      cost: { gold: 150, wood: 0, ore: 0 }
    }),
    "+6"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "hero.visited",
      heroId: "hero-1",
      buildingId: "tower-1",
      buildingKind: "watchtower",
      visionBonus: 2
    }),
    "+VIS 2"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "hero.visited",
      heroId: "hero-1",
      buildingId: "shrine-1",
      buildingKind: "attribute_shrine",
      bonus: { attack: 0, defense: 1, power: 0, knowledge: 0 }
    }),
    "+DEF"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "hero.claimedMine",
      heroId: "hero-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine",
      resourceKind: "gold",
      income: 500,
      ownerPlayerId: "player-1"
    }),
    "+GOLD"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "resource.produced",
      playerId: "player-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine",
      resource: { kind: "wood", amount: 2 }
    }),
    "+WOOD"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      reason: "patrol"
    }),
    "PATROL"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 1, y: 0 },
      to: { x: 2, y: 0 },
      reason: "return"
    }),
    "GUARD"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 2, y: 0 },
      to: { x: 2, y: 1 },
      reason: "chase",
      targetHeroId: "hero-1"
    }),
    "CHASE"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-1",
      battleKind: "neutral",
      experienceGained: 120,
      totalExperience: 240,
      level: 3,
      levelsGained: 1,
      skillPointsAwarded: 1,
      availableSkillPoints: 1
    }),
    "LV 3"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-2",
      battleKind: "hero",
      experienceGained: 60,
      totalExperience: 300,
      level: 3,
      levelsGained: 0,
      skillPointsAwarded: 0,
      availableSkillPoints: 1
    }),
    "XP +60"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      battleId: "battle-3",
      path: [{ x: 2, y: 2 }],
      moveCost: 3
    }),
    "PVE"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "hero",
      defenderHeroId: "hero-2",
      battleId: "battle-4",
      path: [{ x: 2, y: 1 }],
      moveCost: 4
    }),
    "PVP"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel(
      {
        type: "battle.resolved",
        heroId: "hero-1",
        defenderHeroId: "hero-2",
        battleId: "battle-4",
        result: "attacker_victory"
      },
      { heroId: "hero-1" }
    ),
    "VICTORY"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel(
      {
        type: "battle.resolved",
        heroId: "hero-2",
        defenderHeroId: "hero-1",
        battleId: "battle-5",
        result: "attacker_victory"
      },
      { heroId: "hero-1" }
    ),
    "DEFEAT"
  );
  assert.equal(
    resolveMapBoardFeedbackLabel({
      type: "turn.advanced",
      day: 4
    }),
    null
  );
});
