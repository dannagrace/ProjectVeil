import {
  createDefaultEquipmentStatBonuses,
  type EquipmentCatalogConfig,
  type EquipmentDefinition,
  type EquipmentRarity,
  type EquipmentStatBonuses,
  type EquipmentType,
  type HeroState,
  type ValidationResult
} from "./models";

const DEFAULT_EQUIPMENT_CATALOG: EquipmentCatalogConfig = {
  entries: [
    {
      id: "militia_pike",
      name: "民兵长枪",
      type: "weapon",
      rarity: "common",
      description: "朴素但趁手的制式长枪。",
      bonuses: {
        attackPercent: 6
      }
    },
    {
      id: "oak_longbow",
      name: "橡木长弓",
      type: "weapon",
      rarity: "common",
      description: "拉满弓弦时能更稳定地压制敌阵。",
      bonuses: {
        attackPercent: 4,
        knowledge: 1
      }
    },
    {
      id: "vanguard_blade",
      name: "先锋战刃",
      type: "weapon",
      rarity: "rare",
      description: "鼓励先手突击的军团佩剑。",
      bonuses: {
        attackPercent: 10
      },
      specialEffect: {
        id: "initiative_edge",
        name: "抢攻",
        description: "在开战后的第一轮拥有更强的压制力。"
      }
    },
    {
      id: "stormbreaker_halberd",
      name: "裂风戟",
      type: "weapon",
      rarity: "rare",
      description: "厚重戟锋在接战瞬间能撕开阵型。",
      bonuses: {
        attackPercent: 12,
        defensePercent: 4
      }
    },
    {
      id: "sunforged_spear",
      name: "曜铸长矛",
      type: "weapon",
      rarity: "epic",
      description: "由锻火祝福的长矛，专为决斗领袖准备。",
      bonuses: {
        attackPercent: 16,
        power: 1
      },
      specialEffect: {
        id: "momentum",
        name: "破阵",
        description: "持续进攻时会不断扩大优势。"
      }
    },
    {
      id: "astral_scepter",
      name: "星辉权杖",
      type: "weapon",
      rarity: "epic",
      description: "让施法者在战场上拥有更高的掌控力。",
      bonuses: {
        attackPercent: 8,
        power: 2,
        knowledge: 1
      },
      specialEffect: {
        id: "channeling",
        name: "引导",
        description: "为后续技能结算预留更高的法术上限。"
      }
    },
    {
      id: "padded_gambeson",
      name: "厚绗布甲",
      type: "armor",
      rarity: "common",
      description: "最基础的防护甲衣。",
      bonuses: {
        defensePercent: 6,
        maxHp: 2
      }
    },
    {
      id: "tower_shield_mail",
      name: "塔盾链甲",
      type: "armor",
      rarity: "common",
      description: "链环与肩甲兼顾机动和招架。",
      bonuses: {
        defensePercent: 8
      }
    },
    {
      id: "ranger_scale",
      name: "游侠鳞铠",
      type: "armor",
      rarity: "rare",
      description: "轻量鳞片能在守势中保留反击空间。",
      bonuses: {
        attackPercent: 4,
        defensePercent: 10,
        maxHp: 3
      }
    },
    {
      id: "bastion_plate",
      name: "壁垒板甲",
      type: "armor",
      rarity: "rare",
      description: "给前线英雄准备的正面抗压装备。",
      bonuses: {
        defensePercent: 12,
        maxHp: 4
      },
      specialEffect: {
        id: "brace",
        name: "固守",
        description: "面对高强度交锋时更容易稳住阵线。"
      }
    },
    {
      id: "warden_aegis",
      name: "守誓圣铠",
      type: "armor",
      rarity: "epic",
      description: "铭刻誓约的圣铠，在鏖战中更显价值。",
      bonuses: {
        defensePercent: 16,
        maxHp: 6
      },
      specialEffect: {
        id: "ward",
        name: "护佑",
        description: "为整支部队提供更稳定的防线。"
      }
    },
    {
      id: "warpath_harness",
      name: "征途战铠",
      type: "armor",
      rarity: "epic",
      description: "兼顾推进与硬度的高阶胸甲。",
      bonuses: {
        attackPercent: 6,
        defensePercent: 14,
        maxHp: 5
      }
    },
    {
      id: "scout_compass",
      name: "斥候罗盘",
      type: "accessory",
      rarity: "common",
      description: "帮助英雄更快判断战场破绽。",
      bonuses: {
        attackPercent: 3,
        knowledge: 1
      }
    },
    {
      id: "scribe_charm",
      name: "书记官符坠",
      type: "accessory",
      rarity: "common",
      description: "记录战报与法令的随身信物。",
      bonuses: {
        defensePercent: 3,
        knowledge: 1
      }
    },
    {
      id: "captains_insignia",
      name: "队长徽记",
      type: "accessory",
      rarity: "rare",
      description: "用来稳定士气和前线节奏的军官佩章。",
      bonuses: {
        attackPercent: 5,
        defensePercent: 5
      }
    },
    {
      id: "ember_talisman",
      name: "余烬护符",
      type: "accessory",
      rarity: "rare",
      description: "保持法术专注并兼顾一定防护。",
      bonuses: {
        power: 1,
        defensePercent: 6
      }
    },
    {
      id: "sun_medallion",
      name: "曜日勋章",
      type: "accessory",
      rarity: "epic",
      description: "象征高阶指挥权的战场勋章。",
      bonuses: {
        attackPercent: 8,
        defensePercent: 8,
        power: 1
      },
      specialEffect: {
        id: "momentum",
        name: "破阵",
        description: "持续进攻时会不断扩大优势。"
      }
    },
    {
      id: "oracle_lens",
      name: "谕示透镜",
      type: "accessory",
      rarity: "epic",
      description: "让施法者保持更高的战场感知。",
      bonuses: {
        knowledge: 2,
        power: 1,
        defensePercent: 4
      },
      specialEffect: {
        id: "channeling",
        name: "引导",
        description: "为后续技能结算预留更高的法术上限。"
      }
    }
  ]
};

const DEFAULT_EQUIPMENT_BY_ID = new Map(
  DEFAULT_EQUIPMENT_CATALOG.entries.map((entry) => [entry.id, entry] as const)
);
const DEFAULT_EQUIPMENT_BY_RARITY: Record<EquipmentRarity, EquipmentDefinition[]> = {
  common: DEFAULT_EQUIPMENT_CATALOG.entries.filter((entry) => entry.rarity === "common"),
  rare: DEFAULT_EQUIPMENT_CATALOG.entries.filter((entry) => entry.rarity === "rare"),
  epic: DEFAULT_EQUIPMENT_CATALOG.entries.filter((entry) => entry.rarity === "epic")
};
const EQUIPMENT_DROP_CHANCE = 0.15;

export interface HeroEquipmentBonusSummary extends EquipmentStatBonuses {
  attack: number;
  defense: number;
  resolvedItemIds: string[];
  specialEffects: NonNullable<EquipmentDefinition["specialEffect"]>[];
}

export interface HeroEquipmentSlotView {
  slot: EquipmentType;
  label: string;
  itemId: string | null;
  item: EquipmentDefinition | null;
  itemName: string;
  rarityLabel: string | null;
  description: string | null;
  bonusSummary: string;
  specialEffectSummary: string | null;
}

export interface HeroEquipmentLoadoutView {
  slots: HeroEquipmentSlotView[];
  summary: HeroEquipmentBonusSummary;
}

export interface RolledEquipmentDrop {
  itemId: string;
  item: EquipmentDefinition;
}

const EQUIPMENT_SLOT_META: Array<{
  slot: EquipmentType;
  label: string;
  key: "weaponId" | "armorId" | "accessoryId";
}> = [
  { slot: "weapon", label: "武器", key: "weaponId" },
  { slot: "armor", label: "护甲", key: "armorId" },
  { slot: "accessory", label: "饰品", key: "accessoryId" }
];

function numericBonus(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function resolveEquipmentDefinition(id: string | undefined): EquipmentDefinition | undefined {
  return id ? DEFAULT_EQUIPMENT_BY_ID.get(id) : undefined;
}

function percentageDelta(base: number, percent: number): number {
  if (percent === 0) {
    return 0;
  }

  return Math.round(Math.max(0, base) * (percent / 100));
}

export function formatEquipmentRarityLabel(rarity: EquipmentRarity): string {
  return rarity === "common" ? "普通" : rarity === "rare" ? "稀有" : "史诗";
}

function slotKeyForEquipmentType(type: EquipmentType): "weaponId" | "armorId" | "accessoryId" {
  return type === "weapon" ? "weaponId" : type === "armor" ? "armorId" : "accessoryId";
}

function withoutFirstInventoryMatch(inventory: string[], equipmentId: string): string[] {
  const index = inventory.indexOf(equipmentId);
  if (index < 0) {
    return inventory;
  }

  return inventory.filter((_, entryIndex) => entryIndex !== index);
}

export function formatEquipmentBonusSummary(
  bonuses: Partial<EquipmentStatBonuses>
): string {
  const parts = [
    numericBonus(bonuses.attackPercent) !== 0 ? `攻击 +${numericBonus(bonuses.attackPercent)}%` : "",
    numericBonus(bonuses.defensePercent) !== 0 ? `防御 +${numericBonus(bonuses.defensePercent)}%` : "",
    numericBonus(bonuses.power) !== 0 ? `力量 +${numericBonus(bonuses.power)}` : "",
    numericBonus(bonuses.knowledge) !== 0 ? `知识 +${numericBonus(bonuses.knowledge)}` : "",
    numericBonus(bonuses.maxHp) !== 0 ? `生命上限 +${numericBonus(bonuses.maxHp)}` : ""
  ].filter(Boolean);

  return parts.join(" / ") || "无属性加成";
}

export function getDefaultEquipmentCatalog(): EquipmentCatalogConfig {
  return {
    entries: DEFAULT_EQUIPMENT_CATALOG.entries.map((entry) => ({
      ...entry,
      bonuses: { ...entry.bonuses },
      ...(entry.specialEffect ? { specialEffect: { ...entry.specialEffect } } : {})
    }))
  };
}

export function getEquipmentDefinition(equipmentId: string): EquipmentDefinition | undefined {
  return resolveEquipmentDefinition(equipmentId.trim());
}

export function rollEquipmentDrop(
  dropRoll: number,
  rarityRoll: number,
  selectionRoll: number
): RolledEquipmentDrop | null {
  if (dropRoll >= EQUIPMENT_DROP_CHANCE) {
    return null;
  }

  const rarity: EquipmentRarity =
    rarityRoll < 0.65 ? "common" : rarityRoll < 0.93 ? "rare" : "epic";
  const pool = DEFAULT_EQUIPMENT_BY_RARITY[rarity];
  if (pool.length === 0) {
    return null;
  }

  const index = Math.min(pool.length - 1, Math.floor(selectionRoll * pool.length));
  const item = pool[index]!;
  return {
    itemId: item.id,
    item
  };
}

export function validateHeroEquipmentChange(
  hero: Pick<HeroState, "loadout">,
  slot: EquipmentType,
  equipmentId?: string
): ValidationResult {
  const key = slotKeyForEquipmentType(slot);
  const currentItemId = hero.loadout.equipment[key];
  const normalizedEquipmentId = equipmentId?.trim();

  if (!normalizedEquipmentId) {
    return currentItemId ? { valid: true } : { valid: false, reason: "equipment_slot_empty" };
  }

  const definition = resolveEquipmentDefinition(normalizedEquipmentId);
  if (!definition) {
    return { valid: false, reason: "equipment_definition_missing" };
  }

  if (definition.type !== slot) {
    return { valid: false, reason: "equipment_slot_mismatch" };
  }

  if (currentItemId === normalizedEquipmentId) {
    return { valid: false, reason: "equipment_already_equipped" };
  }

  if (!hero.loadout.inventory.includes(normalizedEquipmentId)) {
    return { valid: false, reason: "equipment_not_in_inventory" };
  }

  return { valid: true };
}

export function applyHeroEquipmentChange(
  hero: HeroState,
  slot: EquipmentType,
  equipmentId?: string
): {
  hero: HeroState;
  equippedItemId?: string;
  unequippedItemId?: string;
} {
  const key = slotKeyForEquipmentType(slot);
  const normalizedEquipmentId = equipmentId?.trim();
  const currentItemId = hero.loadout.equipment[key];
  let nextInventory = [...hero.loadout.inventory];

  if (normalizedEquipmentId) {
    nextInventory = withoutFirstInventoryMatch(nextInventory, normalizedEquipmentId);
  }

  if (currentItemId) {
    nextInventory.push(currentItemId);
  }

  return {
    hero: {
      ...hero,
      loadout: {
        ...hero.loadout,
        equipment: {
          ...hero.loadout.equipment,
          ...(normalizedEquipmentId ? { [key]: normalizedEquipmentId } : {}),
          ...(!normalizedEquipmentId ? { [key]: undefined } : {})
        },
        inventory: nextInventory
      }
    },
    ...(normalizedEquipmentId ? { equippedItemId: normalizedEquipmentId } : {}),
    ...(currentItemId ? { unequippedItemId: currentItemId } : {})
  };
}

export function createHeroEquipmentBonusSummary(
  hero: Pick<HeroState, "stats" | "loadout">
): HeroEquipmentBonusSummary {
  const bonuses = createDefaultEquipmentStatBonuses();
  const resolvedItems = [
    resolveEquipmentDefinition(hero.loadout.equipment.weaponId),
    resolveEquipmentDefinition(hero.loadout.equipment.armorId),
    resolveEquipmentDefinition(hero.loadout.equipment.accessoryId)
  ].filter((entry): entry is EquipmentDefinition => Boolean(entry));

  for (const item of resolvedItems) {
    bonuses.attackPercent += numericBonus(item.bonuses.attackPercent);
    bonuses.defensePercent += numericBonus(item.bonuses.defensePercent);
    bonuses.power += numericBonus(item.bonuses.power);
    bonuses.knowledge += numericBonus(item.bonuses.knowledge);
    bonuses.maxHp += numericBonus(item.bonuses.maxHp);
  }

  return {
    attack: percentageDelta(hero.stats.attack, bonuses.attackPercent),
    defense: percentageDelta(hero.stats.defense, bonuses.defensePercent),
    attackPercent: bonuses.attackPercent,
    defensePercent: bonuses.defensePercent,
    power: bonuses.power,
    knowledge: bonuses.knowledge,
    maxHp: bonuses.maxHp,
    resolvedItemIds: resolvedItems.map((item) => item.id),
    specialEffects: resolvedItems
      .flatMap((item) => (item.specialEffect ? [item.specialEffect] : []))
      .filter((effect, index, effects) => effects.findIndex((item) => item.id === effect.id) === index)
  };
}

export function createHeroEquipmentLoadoutView(
  hero: Pick<HeroState, "stats" | "loadout">
): HeroEquipmentLoadoutView {
  return {
    slots: EQUIPMENT_SLOT_META.map(({ slot, label, key }) => {
      const itemId = hero.loadout.equipment[key];
      const item = resolveEquipmentDefinition(itemId);
      if (!itemId) {
        return {
          slot,
          label,
          itemId: null,
          item: null,
          itemName: "未装备",
          rarityLabel: null,
          description: null,
          bonusSummary: "等待拾取或替换",
          specialEffectSummary: null
        };
      }

      if (!item) {
        return {
          slot,
          label,
          itemId,
          item: null,
          itemName: `未知装备 (${itemId})`,
          rarityLabel: null,
          description: null,
          bonusSummary: "装备目录缺失",
          specialEffectSummary: null
        };
      }

      return {
        slot,
        label,
        itemId: item.id,
        item,
        itemName: item.name,
        rarityLabel: formatEquipmentRarityLabel(item.rarity),
        description: item.description,
        bonusSummary: formatEquipmentBonusSummary(item.bonuses),
        specialEffectSummary: item.specialEffect ? `${item.specialEffect.name}: ${item.specialEffect.description}` : null
      };
    }),
    summary: createHeroEquipmentBonusSummary(hero)
  };
}
