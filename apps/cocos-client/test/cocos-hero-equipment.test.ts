import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEquipmentInspectItems,
  buildHeroEquipmentActionRows,
  formatEquipmentActionReason,
  formatEquipmentInspectLines,
  formatEquipmentOverviewLines,
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
  assert.equal(formatEquipmentActionReason("equipment_inventory_full"), "背包已满，请先腾出空位");
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
      "背包 4/6 件（3 类）",
      "武器 普通 民兵长枪 x2 · 攻击 +6%",
      "护甲 普通 厚绗布甲 · 防御 +6% / 生命上限 +2",
      "饰品 普通 斥候罗盘 · 攻击 +3% / 知识 +1"
    ]
  );
});

test("formatInventorySummaryLines warns when the backpack has reached capacity", () => {
  assert.deepEqual(
    formatInventorySummaryLines(
      createHero({
        loadout: {
          learnedSkills: [],
          equipment: {
            trinketIds: []
          },
          inventory: [
            "militia_pike",
            "oak_longbow",
            "padded_gambeson",
            "tower_shield_mail",
            "scout_compass",
            "sun_medallion"
          ]
        }
      })
    ),
    [
      "背包 6/6 件（6 类）",
      "背包已满，新的战利品会溢出",
      "武器 普通 民兵长枪 · 攻击 +6%",
      "武器 普通 橡木长弓 · 攻击 +4% / 知识 +1",
      "护甲 普通 厚绗布甲 · 防御 +6% / 生命上限 +2",
      "护甲 普通 塔盾链甲 · 防御 +8%",
      "饰品 普通 斥候罗盘 · 攻击 +3% / 知识 +1",
      "饰品 史诗 曜日勋章 · 攻击 +8% / 防御 +8% / 力量 +1"
    ]
  );
});

test("formatEquipmentOverviewLines exposes slot metadata and resolved equipment stat gains", () => {
  assert.deepEqual(
    formatEquipmentOverviewLines(
      createHero({
        stats: {
          attack: 2,
          defense: 2,
          power: 1,
          knowledge: 1,
          hp: 30,
          maxHp: 30
        },
        loadout: {
          learnedSkills: [],
          equipment: {
            weaponId: "vanguard_blade",
            armorId: "padded_gambeson",
            trinketIds: []
          },
          inventory: ["scout_compass"]
        }
      })
    ),
    [
      "装备 武器 先锋战刃  ·  护甲 厚绗布甲  ·  饰品 未装备",
      "武器 先锋战刃 · 稀有 · 攻击 +10%",
      "护甲 厚绗布甲 · 普通 · 防御 +6% / 生命上限 +2",
      "饰品 未装备 · 等待拾取或替换",
      "装备总加成 生命 +2",
      "特效 抢攻",
      "武器 说明 鼓励先手突击的军团佩剑。",
      "护甲 说明 最基础的防护甲衣。"
    ]
  );
});

test("buildEquipmentInspectItems returns equipped and bag items with shared metadata for item inspection", () => {
  assert.deepEqual(
    buildEquipmentInspectItems(
      createHero({
        loadout: {
          learnedSkills: [],
          equipment: {
            weaponId: "vanguard_blade",
            trinketIds: []
          },
          inventory: ["scout_compass", "scout_compass"]
        }
      })
    ).map((item) => ({
      itemId: item.itemId,
      source: item.source,
      slot: item.slot,
      count: item.count,
      specialEffectSummary: item.specialEffectSummary
    })),
    [
      {
        itemId: "vanguard_blade",
        source: "equipped",
        slot: "weapon",
        count: 1,
        specialEffectSummary: "抢攻: 在开战后的第一轮拥有更强的压制力。"
      },
      {
        itemId: "scout_compass",
        source: "inventory",
        slot: "accessory",
        count: 2,
        specialEffectSummary: undefined
      }
    ]
  );
});

test("formatEquipmentInspectLines provides stable item detail copy for the panel inspect card", () => {
  assert.deepEqual(
    formatEquipmentInspectLines({
      itemId: "vanguard_blade",
      slot: "weapon",
      slotLabel: "武器",
      source: "equipped",
      name: "先锋战刃",
      rarityLabel: "稀有",
      bonusSummary: "攻击 +10%",
      description: "鼓励先手突击的军团佩剑。",
      count: 1,
      specialEffectSummary: "抢攻: 在开战后的第一轮拥有更强的压制力。"
    }),
    [
      "武器 先锋战刃 · 稀有",
      "来源 当前已穿戴",
      "加成 攻击 +10%",
      "特效 抢攻: 在开战后的第一轮拥有更强的压制力。",
      "说明 鼓励先手突击的军团佩剑。"
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
      id: "loot-3",
      timestamp: "2026-03-28T08:30:00.000Z",
      roomId: "room-alpha",
      playerId: "player-1",
      category: "combat",
      description: "凯琳在战斗后发现了史诗装备 守誓圣铠，但背包已满，未能拾取。",
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
    "战利品 最近 3 条",
    "凯琳在战斗后获得了普通装备 塔盾链甲。",
    "凯琳在战斗后获得了稀有装备 斥候罗盘。"
  ]);
  assert.deepEqual(formatRecentLootLines([], "hero-1"), ["战利品 最近暂无装备掉落"]);
});

test("formatRecentLootLines prioritizes authoritative session loot before account refresh catches up", () => {
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
    }
  ];

  assert.deepEqual(
    formatRecentLootLines(
      entries,
      "hero-1",
      2,
      [
        {
          type: "hero.equipmentFound",
          heroId: "hero-1",
          battleId: "battle-1",
          battleKind: "neutral",
          equipmentId: "warden_aegis",
          equipmentName: "守誓圣铠",
          rarity: "epic",
          overflowed: true
        }
      ],
      "凯琳"
    ),
    [
      "战利品 最近 2 条",
      "凯琳 在战斗后发现了史诗装备 守誓圣铠，但背包已满，未能拾取。",
      "凯琳在战斗后获得了普通装备 塔盾链甲。"
    ]
  );
});
