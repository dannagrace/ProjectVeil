import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE2_VERDANT_VALE_MAP_VARIANT_ID,
  getRuntimeConfigBundleForRoom,
  resolveMapVariantIdForRoom
} from "../assets/scripts/project-shared/index.ts";

test("cocos world config resolves the phase2 verdant-vale map variant", () => {
  const roomId = "preview-verdant-vale[map:phase2_verdant_vale]";

  assert.equal(resolveMapVariantIdForRoom(roomId, 1001), PHASE2_VERDANT_VALE_MAP_VARIANT_ID);

  const bundle = getRuntimeConfigBundleForRoom(roomId, 1001);
  assert.equal(bundle.mapVariantId, PHASE2_VERDANT_VALE_MAP_VARIANT_ID);
  assert.equal(bundle.world.width, 12);
  assert.equal(bundle.world.height, 10);
  assert.equal(bundle.mapObjects.buildings.some((building) => building.id === "lumber-camp-vale-1"), true);
  assert.equal(bundle.mapObjects.neutralArmies.some((army) => army.id === "neutral-grove-sentinels"), true);
});

test("cocos world config resolves verdant-vale for a match room ID", () => {
  const roomId = "match-abc[map:phase2_verdant_vale]";
  assert.equal(resolveMapVariantIdForRoom(roomId, 1001), PHASE2_VERDANT_VALE_MAP_VARIANT_ID);
  const bundle = getRuntimeConfigBundleForRoom(roomId, 1001);
  assert.equal(bundle.mapVariantId, PHASE2_VERDANT_VALE_MAP_VARIANT_ID);
});
