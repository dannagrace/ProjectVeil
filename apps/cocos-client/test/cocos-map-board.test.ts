import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTileViewModel,
  moveMapBoardKeyboardCursor,
  resolveMapBoardFeedbackLabel
} from "../assets/scripts/cocos-map-board-model";
import type { SessionUpdate } from "../assets/scripts/VeilCocosSession";
import {
  createWorldUpdate
} from "./helpers/cocos-panel-harness.ts";
import { createMapBoardHarness } from "./helpers/cocos-map-board-harness.ts";

function createBaseUpdate(): SessionUpdate {
  return createWorldUpdate();
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

test("VeilMapBoard renders a waiting empty state when no world snapshot is available", () => {
  const harness = createMapBoardHarness({ width: 300, height: 300, tileSize: 48 });

  harness.render(null);

  assert.match(harness.emptyStateText(), /等待房间状态/);
  assert.equal(harness.inputOverlayActive(), undefined);
  assert.equal(harness.heroActive(), false);
  harness.destroy();
});

test("VeilMapBoard translates overlay pointer input into one tile selection per tap burst", () => {
  const selections: string[] = [];
  const debugMessages: string[] = [];
  const update = createBaseUpdate();
  const harness = createMapBoardHarness({
    width: 300,
    height: 300,
    tileSize: 48,
    onTileSelected: (tile) => {
      selections.push(`${tile.position.x}-${tile.position.y}`);
    },
    onInputDebug: (message) => {
      debugMessages.push(message);
    }
  });

  harness.render(null);
  harness.render(update);

  assert.equal(harness.heroActive(), true);
  assert.equal(harness.hasTile("2-2"), true);

  harness.tapTile(update, { x: 2, y: 2 });
  harness.tapTile(update, { x: 2, y: 2 });

  assert.deepEqual(selections, ["2-2"]);
  assert.match(debugMessages.join("\n"), /tile\(2,2\)/);
  assert.match(debugMessages.join("\n"), /selected tile \(2,2\)/);
  harness.destroy();
});

test("VeilMapBoard refreshes fog overlays when the pulse phase changes", () => {
  const update = createBaseUpdate();
  update.world.map.width = 2;
  update.world.map.height = 1;
  update.world.map.tiles = [
    {
      ...update.world.map.tiles[0]!,
      position: { x: 0, y: 0 },
      fog: "explored",
      resource: undefined,
      occupant: undefined,
      building: undefined
    },
    {
      ...update.world.map.tiles[1]!,
      position: { x: 1, y: 0 },
      fog: "visible",
      resource: undefined,
      occupant: undefined,
      building: undefined
    }
  ];
  update.world.ownHeroes[0]!.position = { x: 1, y: 0 };
  update.reachableTiles = [];

  const harness = createMapBoardHarness({ width: 220, height: 120, tileSize: 48 });
  harness.render(update);

  const capturedStyles = harness.captureFogStyles("0-0");
  assert.equal(capturedStyles.length, 0);

  harness.component.setFogPulsePhase(1);
  harness.render(update);

  assert.equal(capturedStyles.length, 1);
  assert.equal(capturedStyles[0]?.fogState, "explored");
  assert.equal(capturedStyles[0]?.featherMask, 2);
  assert.match(String(capturedStyles[0]?.frameKey ?? ""), /placeholder\/fog\/explored-2/);
  harness.destroy();
});

test("VeilMapBoard renders object overlays and keeps tap feedback visible for an interactable object tile", () => {
  const selections: string[] = [];
  const update = createBaseUpdate();
  update.world.map.tiles = [
    {
      ...update.world.map.tiles[0]!,
      position: { x: 0, y: 0 },
      fog: "visible",
      resource: undefined,
      occupant: undefined,
      building: undefined
    },
    {
      ...update.world.map.tiles[1]!,
      position: { x: 0, y: 1 },
      fog: "visible",
      resource: { kind: "wood", amount: 5 },
      occupant: undefined,
      building: undefined
    },
    {
      ...update.world.map.tiles[2]!,
      position: { x: 2, y: 2 },
      fog: "visible",
      resource: undefined,
      occupant: undefined,
      building: undefined
    }
  ];
  update.world.ownHeroes[0]!.position = { x: 2, y: 2 };
  update.reachableTiles = [{ x: 0, y: 1 }];

  const harness = createMapBoardHarness({
    width: 300,
    height: 300,
    tileSize: 48,
    onTileSelected: (tile) => {
      selections.push(`${tile.position.x}-${tile.position.y}`);
    }
  });
  harness.component.scheduleOnce = () => undefined;
  harness.render(update);

  const objectNode = harness.objectNode("0-1");
  assert.ok(objectNode, "Expected resource overlay node to exist.");
  assert.equal(objectNode.node.active, true);
  assert.ok(
    objectNode.label.string === "木材" || objectNode.spriteNode.active,
    "Expected resource overlay to render either a fallback label or a sprite chip."
  );

  harness.tapTile(update, { x: 0, y: 1 });
  harness.render(update);

  const feedbackNode = harness.feedbackNode("0-1");
  assert.deepEqual(selections, ["0-1"]);
  assert.ok(feedbackNode, "Expected tap feedback node to exist after selecting an object tile.");
  assert.equal(feedbackNode.node.active, true);
  assert.equal(feedbackNode.label.string, "TAP");
  harness.destroy();
});
