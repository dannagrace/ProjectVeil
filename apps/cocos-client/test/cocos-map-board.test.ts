import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTileViewModel,
  moveMapBoardKeyboardCursor,
  resolveMapBoardFeedbackLabel
} from "../assets/scripts/cocos-map-board-model";
import { VeilMapBoard } from "../assets/scripts/VeilMapBoard";
import type { SessionUpdate } from "../assets/scripts/VeilCocosSession";
import {
  createComponentHarness,
  createWorldUpdate
} from "./helpers/cocos-panel-harness.ts";

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
  const { component } = createComponentHarness(VeilMapBoard, { name: "MapBoardRoot", width: 300, height: 300 });

  component.configure({ tileSize: 48 });
  component.render(null);

  const statefulComponent = component as VeilMapBoard & Record<string, unknown>;

  assert.match(String((statefulComponent.emptyStateLabel as { string: string } | null)?.string ?? ""), /等待房间状态/);
  assert.equal((statefulComponent.inputOverlayNode as { active: boolean } | null)?.active, undefined);
  assert.equal((statefulComponent.heroNode as { active: boolean } | null)?.active, false);
  component.onDestroy();
});

test("VeilMapBoard renders live tiles and forwards tile presses without double-selecting the same tap burst", () => {
  const selections: string[] = [];
  const debugMessages: string[] = [];
  const update = createBaseUpdate();
  const { component } = createComponentHarness(VeilMapBoard, { name: "MapBoardRoot", width: 300, height: 300 });

  component.configure({
    tileSize: 48,
    onTileSelected: (tile) => {
      selections.push(`${tile.position.x}-${tile.position.y}`);
    },
    onInputDebug: (message) => {
      debugMessages.push(message);
    }
  });
  component.render(null);
  component.render(update);

  const statefulComponent = component as VeilMapBoard & Record<string, unknown>;
  const tileNodes = statefulComponent.tileNodes as Map<string, unknown>;

  assert.equal((statefulComponent.emptyStateNode as { active: boolean } | null)?.active, false);
  assert.equal((statefulComponent.heroNode as { active: boolean } | null)?.active, true);
  assert.ok(tileNodes.has("2-2"));
  assert.equal((statefulComponent.objectNodes as Map<string, unknown>).size, 0);

  const targetTile = update.world.map.tiles.find((entry) => entry.position.x === 2 && entry.position.y === 2) ?? null;
  assert.ok(targetTile);
  (statefulComponent.selectTile as (tile: typeof targetTile) => void)(targetTile);
  (statefulComponent.selectTile as (tile: typeof targetTile) => void)(targetTile);

  assert.deepEqual(selections, ["2-2"]);
  assert.match(debugMessages.join("\n"), /selected tile \(2,2\)/);
  component.onDestroy();
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

  const { component } = createComponentHarness(VeilMapBoard, { name: "MapBoardRoot", width: 220, height: 120 });
  component.configure({ tileSize: 48 });
  component.render(update);

  const statefulComponent = component as VeilMapBoard & Record<string, unknown>;
  const tileNodes = statefulComponent.tileNodes as Map<string, { fogOverlay: { render: (style: unknown, enabled?: boolean) => void } }>;
  const exploredTile = tileNodes.get("0-0");
  assert.ok(exploredTile, "Expected explored tile view to exist for fog refresh coverage.");

  const capturedStyles: Array<Record<string, number | string | null>> = [];
  const originalRender = exploredTile.fogOverlay.render.bind(exploredTile.fogOverlay);
  exploredTile.fogOverlay.render = (style, enabled) => {
    capturedStyles.push((style ?? null) as Record<string, number | string | null>);
    originalRender(style, enabled);
  };

  component.setFogPulsePhase(1);
  component.render(update);

  assert.equal(capturedStyles.length, 1);
  assert.equal(capturedStyles[0]?.tone, "explored");
  assert.equal(capturedStyles[0]?.featherMask, 2);
  assert.equal(capturedStyles[0]?.opacity, 78);
  assert.equal(capturedStyles[0]?.edgeOpacity, 24);
  component.onDestroy();
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

  const { component } = createComponentHarness(VeilMapBoard, { name: "MapBoardRoot", width: 300, height: 300 });
  component.scheduleOnce = () => undefined;
  component.configure({
    tileSize: 48,
    onTileSelected: (tile) => {
      selections.push(`${tile.position.x}-${tile.position.y}`);
    }
  });
  component.render(update);

  const statefulComponent = component as VeilMapBoard & Record<string, unknown>;
  const objectNode = (statefulComponent.objectNodes as Map<string, { node: { active: boolean }; label: { string: string }; spriteNode: { active: boolean } }>).get("0-1");
  assert.ok(objectNode, "Expected resource overlay node to exist.");
  assert.equal(objectNode.node.active, true);
  assert.ok(
    objectNode.label.string === "木材" || objectNode.spriteNode.active,
    "Expected resource overlay to render either a fallback label or a sprite chip."
  );

  const resourceTile = update.world.map.tiles.find((tile) => tile.position.x === 0 && tile.position.y === 1) ?? null;
  assert.ok(resourceTile);
  (statefulComponent.selectTile as (tile: typeof resourceTile) => void)(resourceTile);
  component.render(update);

  const feedbackNode = (statefulComponent.feedbackNodes as Map<string, { node: { active: boolean }; label: { string: string } }>).get("0-1");
  assert.deepEqual(selections, ["0-1"]);
  assert.ok(feedbackNode, "Expected tap feedback node to exist after selecting an object tile.");
  assert.equal(feedbackNode.node.active, true);
  assert.equal(feedbackNode.label.string, "TAP");
  component.onDestroy();
});
