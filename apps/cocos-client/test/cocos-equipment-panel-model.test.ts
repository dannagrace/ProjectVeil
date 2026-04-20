import assert from "node:assert/strict";
import test from "node:test";
import { buildEquipmentPanelViewModel } from "../assets/scripts/cocos-equipment-panel-model.ts";
import { createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";

test("buildEquipmentPanelViewModel exposes inventory labels, inspect state, and action descriptors", () => {
  const update = createSessionUpdate();
  const hero = update.world.ownHeroes[0]!;
  hero.name = "凯琳";
  hero.loadout.equipment.weaponId = "militia_pike";
  hero.loadout.equipment.armorId = "padded_gambeson";
  hero.loadout.inventory = ["scout_compass", "scout_compass"];

  const view = buildEquipmentPanelViewModel(
    {
      hero,
      recentEventLog: [],
      recentSessionEvents: [
        {
          type: "hero.equipmentFound",
          heroId: hero.id,
          equipmentName: "守誓圣铠",
          rarity: "epic",
          overflowed: true,
        },
      ],
    },
    {
      inspectedItemId: "scout_compass",
      inspectedItemSource: "inventory",
      inventoryFilter: "weapon",
      inventorySort: "name",
    }
  );

  assert.equal(view.hero?.name, "凯琳");
  assert.equal(view.inventoryFilterLabel, "武器");
  assert.equal(view.inventorySortLabel, "名称");
  assert.equal(view.selectedInspectItem?.itemId, "scout_compass");
  assert.match(view.lootLines.join("\n"), /最近 1 条/);
  assert.ok(view.actionDescriptors.some((descriptor) => descriptor.kind === "inspect"));
  assert.ok(view.actionDescriptors.some((descriptor) => descriptor.kind === "unequip" && descriptor.slot === "weapon"));
});
