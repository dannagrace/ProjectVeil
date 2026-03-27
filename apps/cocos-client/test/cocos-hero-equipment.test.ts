import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHeroEquipmentActionRows,
  formatEquipmentActionReason,
  inventoryItemsForSlot
} from "../assets/scripts/cocos-hero-equipment";
import type { HeroView } from "../assets/scripts/VeilCocosSession";

function createHero(overrides?: Partial<HeroView>): HeroView {
  return {
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 },
    vision: 2,
    move: {
      total: 6,
      remaining: 6
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
      level: 1,
      experience: 0,
      skillPoints: 0,
      battlesWon: 0,
      neutralBattlesWon: 0,
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
    learnedSkills: [],
    ...overrides
  };
}

test("inventoryItemsForSlot groups duplicate equipment by slot", () => {
  const weaponItems = inventoryItemsForSlot(
    createHero({
      loadout: {
        learnedSkills: [],
        equipment: {
          trinketIds: []
        },
        inventory: ["militia_pike", "militia_pike", "oak_longbow", "padded_gambeson"]
      }
    }),
    "weapon"
  );

  assert.deepEqual(
    weaponItems.map((item) => ({
      itemId: item.itemId,
      count: item.count
    })),
    [
      { itemId: "militia_pike", count: 2 },
      { itemId: "oak_longbow", count: 1 }
    ]
  );
});

test("buildHeroEquipmentActionRows exposes equipped items and remaining inventory choices", () => {
  const rows = buildHeroEquipmentActionRows(
    createHero({
      loadout: {
        learnedSkills: [],
        equipment: {
          weaponId: "vanguard_blade",
          trinketIds: []
        },
        inventory: ["militia_pike", "padded_gambeson", "scout_compass"]
      }
    })
  );

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => ({
      slot: row.slot,
      itemId: row.itemId,
      inventory: row.inventory.map((item) => item.itemId)
    })),
    [
      {
        slot: "weapon",
        itemId: "vanguard_blade",
        inventory: ["militia_pike"]
      },
      {
        slot: "armor",
        itemId: undefined,
        inventory: ["padded_gambeson"]
      },
      {
        slot: "accessory",
        itemId: undefined,
        inventory: ["scout_compass"]
      }
    ]
  );
});

test("formatEquipmentActionReason keeps user-facing copy stable", () => {
  assert.equal(formatEquipmentActionReason("equipment_slot_empty"), "当前槽位没有可卸下的装备");
  assert.equal(formatEquipmentActionReason("equipment_not_in_inventory"), "背包里没有这件装备");
  assert.equal(formatEquipmentActionReason("unknown_reason"), "unknown_reason");
});
