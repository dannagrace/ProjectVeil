import assert from "node:assert/strict";
import test from "node:test";
import { Sprite, UIOpacity, UITransform } from "cc";
import { VeilFogOverlay } from "../assets/scripts/VeilFogOverlay.ts";
import { loadPlaceholderSpriteAssets } from "../assets/scripts/cocos-placeholder-sprites.ts";
import { FOG_TILE_STATES, resolveFogTileFrameKey, type FogTileStyle } from "../assets/scripts/cocos-map-visuals.ts";
import { createComponentHarness } from "./helpers/cocos-panel-harness.ts";
import { useCcSpriteResourceDoubles } from "./helpers/cc-sprite-resources.ts";

async function createFrameLookup() {
  const assets = await loadPlaceholderSpriteAssets("map");
  const lookup = new Map<string, ReturnType<typeof assets.fogMasks.hidden.at>>();
  for (const fogState of FOG_TILE_STATES) {
    const frames = assets.fogMasks[fogState];
    for (let featherMask = 0; featherMask < frames.length; featherMask += 1) {
      lookup.set(resolveFogTileFrameKey(fogState, featherMask), frames[featherMask] ?? null);
    }
  }
  return lookup;
}

function createStyle(fogState: "hidden" | "explored", featherMask: number): FogTileStyle {
  return {
    frameKey: resolveFogTileFrameKey(fogState, featherMask),
    fogState,
    featherMask
  };
}

test("VeilFogOverlay renders every fog-state and feather-mask frame", async (t) => {
  useCcSpriteResourceDoubles(t);
  const { component, node } = createComponentHarness(VeilFogOverlay, { name: "FogOverlayRoot", width: 0, height: 0 });
  const frameLookup = await createFrameLookup();

  component.configure(84, frameLookup);

  const transform = node.getComponent(UITransform);
  assert.equal(transform?.width, 84);
  assert.equal(transform?.height, 84);

  const sprite = node.getComponent(Sprite);
  const opacity = node.getComponent(UIOpacity);

  for (const fogState of FOG_TILE_STATES) {
    for (let featherMask = 0; featherMask < 16; featherMask += 1) {
      const style = createStyle(fogState, featherMask);
      component.render(style, true);

      assert.equal(node.active, true);
      assert.equal(opacity?.opacity, 255);
      assert.equal(sprite?.spriteFrame?.name, style.frameKey);
    }
  }
});

test("VeilFogOverlay hides the overlay when disabled, empty, or missing a frame", () => {
  const { component, node } = createComponentHarness(VeilFogOverlay, { name: "FogOverlayRoot", width: 0, height: 0 });
  component.configure(84, new Map());

  component.render(null, true);
  assert.equal(node.active, false);

  component.render(createStyle("explored", 5), false);
  assert.equal(node.active, false);

  component.render(createStyle("hidden", 3), true);
  assert.equal(node.active, false);
});
