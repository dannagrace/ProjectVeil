import {
  createDefaultEquipmentStatBonuses,
  type EquipmentCatalogConfig,
  type EquipmentId,
  type EquipmentDefinition,
  type EquipmentRarity,
  type EquipmentSpecialEffectConfig,
  type EquipmentStatBonuses,
  type EquipmentType,
  type HeroState,
  type ValidationResult
} from "./models.ts";

export const HERO_EQUIPMENT_INVENTORY_CAPACITY = 6;
const EQUIPMENT_STAT_KEYS = ["attackPercent", "defensePercent", "power", "knowledge", "maxHp"] as const;

export interface EquipmentSetDefinition {
  setId: string;
  name: string;
  requiredCount: 2;
  bonus: Partial<EquipmentStatBonuses>;
}

export const EQUIPMENT_SET_DEFINITIONS: EquipmentSetDefinition[] = [
  {
    setId: "warlord",
    name: "战魁套装",
    requiredCount: 2,
    bonus: { attackPercent: 8, maxHp: 5 }
  },
  {
    setId: "guardian",
    name: "守护套装",
    requiredCount: 2,
    bonus: { defensePercent: 10, maxHp: 6 }
  }
];

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
      id: "emberwood_staff",
      name: "烬木法杖",
      type: "weapon",
      rarity: "common",
      description: "在廉价木杖中嵌入火纹碎片，适合初阶施法者。",
      bonuses: {
        power: 1,
        knowledge: 1
      }
    },
    {
      id: "windrider_javelin",
      name: "逐风标枪",
      type: "weapon",
      rarity: "common",
      description: "轻型投枪便于远距离压制和追击。",
      bonuses: {
        attackPercent: 5
      }
    },
    {
      id: "ironbound_greatblade",
      name: "铁缚巨刃",
      type: "weapon",
      rarity: "common",
      description: "双手重刃以笨重换取稳定的破甲能力。",
      bonuses: {
        attackPercent: 9
      }
    },
    {
      id: "runeshard_staff",
      name: "符晶法杖",
      type: "weapon",
      rarity: "rare",
      description: "杖首的符晶会在法术聚焦时放大破坏力。",
      bonuses: {
        attackPercent: 4,
        power: 2
      }
    },
    {
      id: "siege_maul",
      name: "攻城战锤",
      type: "weapon",
      rarity: "rare",
      description: "以重击撕开防线的冲锋武器。",
      bonuses: {
        attackPercent: 14
      },
      setId: "warhost"
    },
    {
      id: "frostfang_javelin",
      name: "霜牙飞枪",
      type: "weapon",
      rarity: "rare",
      description: "投掷时带着寒雾轨迹，擅长抢先压低敌军气势。",
      bonuses: {
        attackPercent: 7,
        knowledge: 1
      },
      specialEffect: {
        id: "initiative_edge",
        name: "抢攻",
        description: "在开战后的第一轮拥有更强的压制力。"
      }
    },
    {
      id: "titanbreaker_greatsword",
      name: "裂岳巨剑",
      type: "weapon",
      rarity: "epic",
      description: "专为突破重甲阵列打造的双手巨剑。",
      bonuses: {
        attackPercent: 18,
        defensePercent: 2
      },
      setId: "warhost"
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
      id: "leather_brigandine",
      name: "轻革战衣",
      type: "armor",
      rarity: "common",
      description: "轻甲结构在保留机动性的同时提供基础防护。",
      bonuses: {
        attackPercent: 3,
        defensePercent: 6,
        maxHp: 2
      }
    },
    {
      id: "duskweave_robes",
      name: "暮纱法袍",
      type: "armor",
      rarity: "common",
      description: "袍摆的暗纹有助于稳定施法节奏。",
      bonuses: {
        power: 1,
        knowledge: 1,
        maxHp: 2
      }
    },
    {
      id: "skirmisher_cuirass",
      name: "游斗胸甲",
      type: "armor",
      rarity: "common",
      description: "偏向攻守均衡的前哨轻甲。",
      bonuses: {
        attackPercent: 4,
        defensePercent: 5,
        maxHp: 2
      }
    },
    {
      id: "runic_vestments",
      name: "符印法衣",
      type: "armor",
      rarity: "rare",
      description: "由多层符印布面缝制，能承载更多法术波动。",
      bonuses: {
        defensePercent: 4,
        power: 2,
        knowledge: 1
      }
    },
    {
      id: "assault_cuirass",
      name: "突袭胸甲",
      type: "armor",
      rarity: "rare",
      description: "为破阵先锋打造的轻重混编胸甲。",
      bonuses: {
        attackPercent: 6,
        defensePercent: 8,
        maxHp: 3
      },
      setId: "warhost"
    },
    {
      id: "thornhide_cape",
      name: "棘皮披风",
      type: "armor",
      rarity: "rare",
      description: "外层的硬棘纤维能分散近身冲击。",
      bonuses: {
        defensePercent: 9,
        maxHp: 4
      }
    },
    {
      id: "bulwark_plate",
      name: "磐垒重铠",
      type: "armor",
      rarity: "epic",
      description: "重装守军的压阵护甲，越久战越难被击穿。",
      bonuses: {
        defensePercent: 18,
        maxHp: 7
      },
      setId: "bulwark"
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
    },
    {
      id: "trailblazer_lantern",
      name: "拓路灯盏",
      type: "accessory",
      rarity: "common",
      description: "发光符灯能帮助部队更早识别前路威胁。",
      bonuses: {
        attackPercent: 2,
        knowledge: 1
      }
    },
    {
      id: "wayfinder_map",
      name: "行路图卷",
      type: "accessory",
      rarity: "common",
      description: "一卷不断修订的地图草图，适合长期行军。",
      bonuses: {
        defensePercent: 2,
        knowledge: 1
      }
    },
    {
      id: "restorers_kit",
      name: "复原急救包",
      type: "accessory",
      rarity: "common",
      description: "包含绷带与药膏的随身套件，适合持久战。",
      bonuses: {
        defensePercent: 2,
        maxHp: 2
      }
    },
    {
      id: "blood_oath_emblem",
      name: "血誓徽印",
      type: "accessory",
      rarity: "rare",
      description: "战团先锋间流转的誓约信物。",
      bonuses: {
        attackPercent: 6,
        power: 1
      },
      setId: "warhost"
    },
    {
      id: "sentinel_badge",
      name: "守卫徽章",
      type: "accessory",
      rarity: "rare",
      description: "常由城防指挥官佩戴，用以稳住整条阵线。",
      bonuses: {
        defensePercent: 7
      },
      setId: "bulwark"
    },
    {
      id: "cartographer_monocle",
      name: "绘界单片镜",
      type: "accessory",
      rarity: "rare",
      description: "经常被探索队长用于快速判定地形与射界。",
      bonuses: {
        attackPercent: 3,
        knowledge: 2
      }
    },
    {
      id: "phoenix_feather",
      name: "炎凰羽饰",
      type: "accessory",
      rarity: "epic",
      description: "燃尽后仍有余辉的羽饰，能提升战意与专注。",
      bonuses: {
        attackPercent: 4,
        power: 1,
        maxHp: 3
      }
    },
    {
      id: "briar_heart_charm",
      name: "荆心护符",
      type: "accessory",
      rarity: "epic",
      description: "镶着硬棘核心的护符，擅长将冲击返还给来敌。",
      bonuses: {
        defensePercent: 6,
        maxHp: 4
      },
      setId: "bulwark"
    }
  ]
};

export interface EquipmentSetBonusConfig {
  setId: string;
  name: string;
  piecesRequired: number;
  description: string;
  bonuses: Partial<EquipmentStatBonuses>;
  specialEffect?: EquipmentSpecialEffectConfig;
}

export const SET_BONUSES: EquipmentSetBonusConfig[] = [
  {
    setId: "warhost",
    name: "战团突袭套",
    piecesRequired: 2,
    description: "2 件：攻击 +8% / 力量 +1，并获得击杀回血。",
    bonuses: {
      attackPercent: 8,
      power: 1
    },
    specialEffect: {
      id: "lifesteal",
      name: "嗜血",
      description: "击杀敌方单位后恢复自身生命。"
    }
  },
  {
    setId: "bulwark",
    name: "磐垒守御套",
    piecesRequired: 2,
    description: "2 件：防御 +10% / 生命上限 +4，并获得反伤。",
    bonuses: {
      defensePercent: 10,
      maxHp: 4
    },
    specialEffect: {
      id: "thorns",
      name: "反刺",
      description: "受到近战攻击时，对攻击者造成反伤。"
    }
  }
];

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
  activeSetBonuses: EquipmentSetBonusConfig[];
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
  setBonuses: HeroEquipmentSetProgressView[];
  summary: HeroEquipmentBonusSummary;
}

export interface HeroEquipmentSetProgressView {
  setId: string;
  name: string;
  piecesRequired: number;
  equippedPieces: number;
  active: boolean;
  description: string;
  bonusSummary: string;
  specialEffectSummary: string | null;
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

function resolveActiveSetBonuses(resolvedItems: EquipmentDefinition[]): EquipmentSetBonusConfig[] {
  const countsBySetId = countEquippedSetPieces(resolvedItems);

  return SET_BONUSES.filter((entry) => (countsBySetId[entry.setId] ?? 0) >= entry.piecesRequired);
}

function countEquippedSetPieces(resolvedItems: EquipmentDefinition[]): Record<string, number> {
  return resolvedItems.reduce<Record<string, number>>((counts, item) => {
    if (!item.setId) {
      return counts;
    }

    counts[item.setId] = (counts[item.setId] ?? 0) + 1;
    return counts;
  }, {});
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

function validateEquipmentBonusRecord(
  bonuses: Partial<EquipmentStatBonuses>,
  context: string
): void {
  for (const [key, value] of Object.entries(bonuses)) {
    if (!EQUIPMENT_STAT_KEYS.includes(key as (typeof EQUIPMENT_STAT_KEYS)[number])) {
      throw new Error(`${context} has unknown equipment stat bonus: ${key}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${context} bonus ${key} must be a finite number`);
    }
  }
}

export function validateEquipmentCatalog(config: EquipmentCatalogConfig): void {
  const ids = new Set<string>();

  for (const entry of config.entries) {
    if (!entry.id.trim()) {
      throw new Error("Equipment entry id must be a non-empty string");
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate equipment entry id: ${entry.id}`);
    }
    if (entry.type !== "weapon" && entry.type !== "armor" && entry.type !== "accessory") {
      throw new Error(`Equipment entry ${entry.id} has invalid type: ${String(entry.type)}`);
    }
    if (entry.rarity !== "common" && entry.rarity !== "rare" && entry.rarity !== "epic") {
      throw new Error(`Equipment entry ${entry.id} has invalid rarity: ${String(entry.rarity)}`);
    }
    validateEquipmentBonusRecord(entry.bonuses, `Equipment entry ${entry.id}`);
    ids.add(entry.id);
  }

  for (const setBonus of EQUIPMENT_SET_DEFINITIONS) {
    validateEquipmentBonusRecord(setBonus.bonus, `Equipment set ${setBonus.setId}`);
  }
}

export function getDefaultEquipmentCatalog(): EquipmentCatalogConfig {
  const config = {
    entries: DEFAULT_EQUIPMENT_CATALOG.entries.map((entry) => ({
      ...entry,
      bonuses: { ...entry.bonuses },
      ...(entry.setId ? { setId: entry.setId } : {}),
      ...(entry.specialEffect ? { specialEffect: { ...entry.specialEffect } } : {})
    }))
  };

  validateEquipmentCatalog(config);
  return config;
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

export function isHeroEquipmentInventoryFull(inventory: EquipmentId[]): boolean {
  return inventory.length >= HERO_EQUIPMENT_INVENTORY_CAPACITY;
}

export function tryAddEquipmentToInventory(
  inventory: EquipmentId[],
  equipmentId: EquipmentId
): { inventory: EquipmentId[]; stored: boolean } {
  if (isHeroEquipmentInventoryFull(inventory)) {
    return {
      inventory: [...inventory],
      stored: false
    };
  }

  return {
    inventory: [...inventory, equipmentId],
    stored: true
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
    if (!currentItemId) {
      return { valid: false, reason: "equipment_slot_empty" };
    }

    if (isHeroEquipmentInventoryFull(hero.loadout.inventory)) {
      return { valid: false, reason: "equipment_inventory_full" };
    }

    return { valid: true };
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
  const activeSetBonuses = resolveActiveSetBonuses(resolvedItems);

  for (const item of resolvedItems) {
    bonuses.attackPercent += numericBonus(item.bonuses.attackPercent);
    bonuses.defensePercent += numericBonus(item.bonuses.defensePercent);
    bonuses.power += numericBonus(item.bonuses.power);
    bonuses.knowledge += numericBonus(item.bonuses.knowledge);
    bonuses.maxHp += numericBonus(item.bonuses.maxHp);
  }

  for (const setBonus of activeSetBonuses) {
    bonuses.attackPercent += numericBonus(setBonus.bonuses.attackPercent);
    bonuses.defensePercent += numericBonus(setBonus.bonuses.defensePercent);
    bonuses.power += numericBonus(setBonus.bonuses.power);
    bonuses.knowledge += numericBonus(setBonus.bonuses.knowledge);
    bonuses.maxHp += numericBonus(setBonus.bonuses.maxHp);
  }

  const specialEffects = resolvedItems
    .flatMap((item) => (item.specialEffect ? [item.specialEffect] : []))
    .concat(activeSetBonuses.flatMap((setBonus) => (setBonus.specialEffect ? [setBonus.specialEffect] : [])))
    .filter((effect, index, effects) => effects.findIndex((item) => item.id === effect.id) === index);

  return {
    attack: percentageDelta(hero.stats.attack, bonuses.attackPercent),
    defense: percentageDelta(hero.stats.defense, bonuses.defensePercent),
    attackPercent: bonuses.attackPercent,
    defensePercent: bonuses.defensePercent,
    power: bonuses.power,
    knowledge: bonuses.knowledge,
    maxHp: bonuses.maxHp,
    resolvedItemIds: resolvedItems.map((item) => item.id),
    activeSetBonuses,
    specialEffects
  };
}

export function createHeroEquipmentLoadoutView(
  hero: Pick<HeroState, "stats" | "loadout">
): HeroEquipmentLoadoutView {
  const resolvedItems = [
    resolveEquipmentDefinition(hero.loadout.equipment.weaponId),
    resolveEquipmentDefinition(hero.loadout.equipment.armorId),
    resolveEquipmentDefinition(hero.loadout.equipment.accessoryId)
  ].filter((entry): entry is EquipmentDefinition => Boolean(entry));
  const countsBySetId = countEquippedSetPieces(resolvedItems);

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
    setBonuses: SET_BONUSES.map((setBonus) => ({
      setId: setBonus.setId,
      name: setBonus.name,
      piecesRequired: setBonus.piecesRequired,
      equippedPieces: countsBySetId[setBonus.setId] ?? 0,
      active: (countsBySetId[setBonus.setId] ?? 0) >= setBonus.piecesRequired,
      description: setBonus.description,
      bonusSummary: formatEquipmentBonusSummary(setBonus.bonuses),
      specialEffectSummary: setBonus.specialEffect
        ? `${setBonus.specialEffect.name}: ${setBonus.specialEffect.description}`
        : null
    })),
    summary: createHeroEquipmentBonusSummary(hero)
  };
}
