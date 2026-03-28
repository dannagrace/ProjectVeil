import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHeroEquipmentActionRows,
  formatEquipmentActionReason,
  formatInventorySummaryLines,
  formatRecentLootLines,
  inventoryItemsForSlot
} from "../assets/scripts/cocos-hero-equipment";
import type { HeroView } from "../assets/scripts/VeilCocosSession";
import type { EventLogEntry } from "../../../packages/shared/src/index";

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

test("formatInventorySummaryLines exposes the current backpack as grouped readable lines", () => {
  assert.deepEqual(
    formatInventorySummaryLines(
      createHero({
        loadout: {
          learnedSkills: [],
          equipment: {
            trinketIds: []
          },
          inventory: ["militia_pike", "militia_pike", "padded_gambeson", "scout_compass"]
        }
      })
    ),
    [
      "背包 4 件（3 类）",
      "武器 民兵长枪 x2",
      "护甲 厚绗布甲",
      "饰品 斥候罗盘"
    ]
  );
});

test("formatRecentLootLines keeps the latest hero loot entries visible in Cocos HUD", () => {
  const entries: EventLogEntry[] = [
    {
      id: "loot-1",
      timestamp: "2026-03-28T10:00:00.000Z",
      roomId: "room-alpha",
      playerId: "player-1",
      category: "combat",
      description: "凯琳在战斗后获得了普通装备 塔盾链甲。",
      heroId: "hero-1",
      worldEventType: "hero.equipmentFound",
      rewards: []
    },
    {
      id: "loot-2",
      timestamp: "2026-03-28T09:00:00.000Z",
      roomId: "room-alpha",
      playerId: "player-1",
      category: "combat",
      description: "凯琳在战斗后获得了稀有装备 斥候罗盘。",
      heroId: "hero-1",
      worldEventType: "hero.equipmentFound",
      rewards: []
    },
    {
      id: "other-1",
      timestamp: "2026-03-28T08:00:00.000Z",
      roomId: "room-alpha",
      playerId: "player-1",
      category: "movement",
      description: "凯琳采集了木材。",
      heroId: "hero-1",
      worldEventType: "hero.collected",
      rewards: []
    }
  ];

  assert.deepEqual(formatRecentLootLines(entries, "hero-1"), [
    "战利品 最近 2 条",
    "凯琳在战斗后获得了普通装备 塔盾链甲。",
    "凯琳在战斗后获得了稀有装备 斥候罗盘。"
  ]);
  assert.deepEqual(formatRecentLootLines([], "hero-1"), ["战利品 最近暂无装备掉落"]);
});
