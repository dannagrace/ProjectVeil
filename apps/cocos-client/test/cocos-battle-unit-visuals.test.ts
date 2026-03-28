import assert from "node:assert/strict";
import test from "node:test";
import { resolveBattlePanelUnitVisual } from "../assets/scripts/cocos-battle-unit-visuals";

test("battle unit visual descriptor uses template faction, rarity, and selected portrait", () => {
  const visual = resolveBattlePanelUnitVisual("hero_guard_basic", { selected: true });
  assert.deepEqual(visual, {
    templateId: "hero_guard_basic",
    faction: "crown",
    rarity: "common",
    interaction: "battle",
    portraitState: "selected"
  });
});

test("battle unit visual descriptor falls back to hit portrait for damaged wild elites", () => {
  const visual = resolveBattlePanelUnitVisual("wolf_pack", { damaged: true });
  assert.deepEqual(visual, {
    templateId: "wolf_pack",
    faction: "wild",
    rarity: "elite",
    interaction: "battle",
    portraitState: "hit"
  });
});

test("battle unit visual descriptor keeps unknown templates safe", () => {
  const visual = resolveBattlePanelUnitVisual("missing_unit");
  assert.deepEqual(visual, {
    templateId: "missing_unit",
    faction: null,
    rarity: "common",
    interaction: "battle",
    portraitState: "idle"
  });
});
