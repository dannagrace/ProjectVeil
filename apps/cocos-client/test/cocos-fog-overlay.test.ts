import assert from "node:assert/strict";
import test from "node:test";
import { Label, UIOpacity, UITransform } from "cc";
import { VeilFogOverlay } from "../assets/scripts/VeilFogOverlay.ts";
import type { FogOverlayStyle } from "../assets/scripts/cocos-map-visuals.ts";
import { createComponentHarness, findNode, readLabelString } from "./helpers/cocos-panel-harness.ts";

function createStyle(overrides: Partial<FogOverlayStyle> = {}): FogOverlayStyle {
  return {
    text: "FOG",
    opacity: 112,
    edgeOpacity: 54,
    labelOpacity: 210,
    tone: "hidden",
    featherMask: 3,
    ...overrides
  };
}

test("VeilFogOverlay configures tile bounds and renders fog copy with opacity controls", () => {
  const { component, node } = createComponentHarness(VeilFogOverlay, { name: "FogOverlayRoot", width: 0, height: 0 });

  component.configure(72);
  component.render(createStyle(), true);

  const transform = node.getComponent(UITransform);
  assert.equal(transform?.width, 60);
  assert.equal(transform?.height, 60);

  const labelNode = findNode(node, "Label");
  const label = labelNode?.getComponent(Label) ?? null;
  assert.equal(readLabelString(labelNode), "FOG");
  assert.equal(label?.color?.a, 210);

  const opacity = node.getComponent(UIOpacity);
  assert.equal(opacity?.opacity, 255);
  assert.equal(node.active, true);
});

test("VeilFogOverlay hides the overlay when disabled or no style is provided", () => {
  const { component, node } = createComponentHarness(VeilFogOverlay, { name: "FogOverlayRoot", width: 0, height: 0 });

  component.render(null, true);
  assert.equal(node.active, false);

  component.render(createStyle({ text: "VISIBLE", tone: "explored" }), false);
  assert.equal(node.active, false);

  component.render(createStyle({ text: "EDGE" }), true);
  assert.equal(node.active, true);

  component.render(null, true);
  assert.equal(node.active, false);
});
