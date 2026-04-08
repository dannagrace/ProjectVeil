import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE2_FRONTIER_EXPANDED_MAP_VARIANT_ID,
  getRuntimeConfigBundleForRoom,
  resolveMapVariantIdForRoom
} from "../assets/scripts/project-shared/index.ts";

test("cocos world config resolves the phase2 frontier-expanded map variant", () => {
  const roomId = "preview-frontier-expanded[map:phase2_frontier_expanded]";

  assert.equal(resolveMapVariantIdForRoom(roomId, 1001), PHASE2_FRONTIER_EXPANDED_MAP_VARIANT_ID);

  const bundle = getRuntimeConfigBundleForRoom(roomId, 1001);
  assert.equal(bundle.mapVariantId, PHASE2_FRONTIER_EXPANDED_MAP_VARIANT_ID);
  assert.equal(bundle.world.width, 32);
  assert.equal(bundle.world.height, 32);
  assert.equal(bundle.mapObjects.buildings.some((building) => building.id === "watchtower-frontier-expanded-1"), true);
  assert.equal(bundle.mapObjects.neutralArmies.some((army) => army.id === "neutral-river-watch"), true);
});
