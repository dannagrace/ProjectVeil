import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";
import { createVeilRootHarness, resetVeilRootRuntime } from "./helpers/veil-root-harness.ts";

afterEach(() => {
  resetVeilRootRuntime();
});

test("VeilRoot builds an interaction HUD for owned resource mines without throwing", () => {
  const root = createVeilRootHarness();
  const update = createSessionUpdate();
  update.world.ownHeroes[0]!.position = { x: 1, y: 1 };
  update.world.map.tiles = [
    {
      position: { x: 1, y: 1 },
      fog: "visible",
      terrain: "grass",
      walkable: true,
      resource: undefined,
      occupant: {
        kind: "hero",
        refId: "hero-1"
      },
      building: undefined
    },
    {
      position: { x: 2, y: 1 },
      fog: "visible",
      terrain: "grass",
      walkable: true,
      resource: undefined,
      occupant: undefined,
      building: {
        id: "mine-wood-1",
        kind: "resource_mine",
        label: "前线伐木场",
        tier: 1,
        maxTier: 2,
        ownerPlayerId: update.world.playerId,
        resourceKind: "wood",
        income: 3
      }
    }
  ];
  root.lastUpdate = update;
  root.selectedInteractionBuildingId = "mine-wood-1";

  const view = root.buildHudInteractionState();

  assert.deepEqual(view, {
    title: "前线伐木场",
    detail: "等级 1/2 · 升级花费 金币 500 / 木材 0 / 矿石 10",
    actions: [{ id: "upgrade", label: "升级建筑 · 1→2" }]
  });
});
