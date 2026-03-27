import {
  createHeroEquipmentLoadoutView,
  formatEquipmentBonusSummary,
  formatEquipmentRarityLabel,
  getEquipmentDefinition,
  type EquipmentType,
  type HeroState
} from "../../../../packages/shared/src/index.ts";
import type { HeroView } from "./VeilCocosSession.ts";

export interface CocosEquipmentInventoryItem {
  itemId: string;
  name: string;
  rarityLabel: string;
  bonusSummary: string;
  description: string;
  count: number;
}

export interface CocosEquipmentActionRow {
  slot: EquipmentType;
  label: string;
  itemId?: string;
  itemName: string;
  rarityLabel: string;
  bonusSummary: string;
  inventory: CocosEquipmentInventoryItem[];
}

function toHeroState(hero: HeroView): HeroState {
  return {
    id: hero.id,
    playerId: hero.playerId,
    name: hero.name,
    position: { ...hero.position },
    vision: hero.vision,
    move: { ...hero.move },
    stats: { ...hero.stats },
    progression: { ...hero.progression },
    loadout: {
      learnedSkills: hero.loadout.learnedSkills.map((skill) => ({ ...skill })),
      equipment: {
        ...hero.loadout.equipment,
        trinketIds: [...hero.loadout.equipment.trinketIds]
      },
      inventory: [...hero.loadout.inventory]
    },
    armyTemplateId: hero.armyTemplateId,
    armyCount: hero.armyCount,
    learnedSkills: hero.learnedSkills.map((skill) => ({ ...skill }))
  };
}

export function formatEquipmentActionReason(reason: string): string {
  if (reason === "equipment_not_in_inventory") {
    return "背包里没有这件装备";
  }

  if (reason === "equipment_slot_mismatch") {
    return "装备类型和槽位不匹配";
  }

  if (reason === "equipment_definition_missing") {
    return "装备目录缺失，无法装备";
  }

  if (reason === "equipment_slot_empty") {
    return "当前槽位没有可卸下的装备";
  }

  if (reason === "equipment_already_equipped") {
    return "该装备已经穿戴中";
  }

  return reason;
}

export function formatEquipmentSlotLabel(slot: EquipmentType): string {
  return slot === "weapon" ? "武器" : slot === "armor" ? "护甲" : "饰品";
}

export function inventoryItemsForSlot(hero: HeroView, slot: EquipmentType): CocosEquipmentInventoryItem[] {
  const counts = new Map<string, number>();

  for (const itemId of hero.loadout.inventory) {
    const definition = getEquipmentDefinition(itemId);
    if (!definition || definition.type !== slot) {
      continue;
    }

    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([itemId, count]) => {
      const definition = getEquipmentDefinition(itemId);
      if (!definition) {
        return null;
      }

      return {
        itemId,
        name: definition.name,
        rarityLabel: formatEquipmentRarityLabel(definition.rarity),
        bonusSummary: formatEquipmentBonusSummary(definition.bonuses),
        description: definition.description,
        count
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

export function buildHeroEquipmentActionRows(hero: HeroView | null): CocosEquipmentActionRow[] {
  if (!hero) {
    return [];
  }

  const loadout = createHeroEquipmentLoadoutView(toHeroState(hero));
  return loadout.slots.map((slot) => ({
    slot: slot.slot,
    label: slot.label,
    ...(slot.itemId ? { itemId: slot.itemId } : {}),
    itemName: slot.itemName,
    rarityLabel: slot.rarityLabel ?? "",
    bonusSummary: slot.bonusSummary,
    inventory: inventoryItemsForSlot(hero, slot.slot)
  }));
}
