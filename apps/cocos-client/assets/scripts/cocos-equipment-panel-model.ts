import type { EventLogEntry } from "./project-shared/index.ts";
import type { HeroView } from "./VeilCocosSession.ts";
import {
  buildEquipmentInspectItems,
  buildInventorySummaryView,
  buildHeroEquipmentActionRows,
  formatEquipmentInspectLines,
  formatEquipmentSlotLabel,
  formatLootSpotlightLines,
  formatEquipmentOverviewLines,
  formatEquipmentStatSummary,
  formatRecentLootLines,
  type CocosEquipmentInventoryFilter,
  type CocosEquipmentInventorySort,
  type CocosEquipmentActionRow,
  type CocosEquipmentInspectItem
} from "./cocos-hero-equipment.ts";

export interface EquipmentPanelRecentLootEvent {
  type: "hero.equipmentFound";
  heroId: string;
  equipmentName: string;
  rarity: "common" | "rare" | "epic";
  overflowed?: boolean;
}

export interface VeilEquipmentPanelRenderState {
  hero: HeroView | null;
  recentEventLog: EventLogEntry[];
  recentSessionEvents?: EquipmentPanelRecentLootEvent[];
}

export interface EquipmentPanelActionDescriptor {
  kind: "inspect" | "equip" | "unequip";
  key: string;
  label: string;
  slot?: "weapon" | "armor" | "accessory";
  itemId?: string;
}

export interface EquipmentPanelViewModel {
  hero: HeroView | null;
  inspectItems: CocosEquipmentInspectItem[];
  selectedInspectItem: CocosEquipmentInspectItem | null;
  equipmentRows: CocosEquipmentActionRow[];
  inventoryFilterLabel: string;
  inventorySortLabel: string;
  inventoryLines: string[];
  loadoutLines: string[];
  inspectLines: string[];
  spotlightLines: string[];
  lootLines: string[];
  bonusSummary: ReturnType<typeof formatEquipmentStatSummary>;
  actionDescriptors: EquipmentPanelActionDescriptor[];
}

export function buildEquipmentPanelInspectButtonName(item: CocosEquipmentInspectItem): string {
  return `EquipmentPanelInspect-${item.source}-${item.slot}-${item.itemId}`;
}

export function resolveEquipmentPanelInspectItem(
  items: CocosEquipmentInspectItem[],
  inspectedItemId: string | null,
  inspectedItemSource: CocosEquipmentInspectItem["source"] | null
): CocosEquipmentInspectItem | null {
  if (!inspectedItemId || !inspectedItemSource) {
    return items[0] ?? null;
  }

  return items.find((item) => item.itemId === inspectedItemId && item.source === inspectedItemSource) ?? items[0] ?? null;
}

export function describeEquipmentInventoryFilter(filter: CocosEquipmentInventoryFilter): string {
  return filter === "all" ? "全部" : formatEquipmentSlotLabel(filter);
}

export function describeEquipmentInventorySort(sort: CocosEquipmentInventorySort): string {
  return sort === "slot" ? "槽位" : sort === "rarity" ? "稀有度" : "名称";
}

export function buildEquipmentPanelViewModel(
  state: VeilEquipmentPanelRenderState,
  options: {
    inspectedItemId: string | null;
    inspectedItemSource: CocosEquipmentInspectItem["source"] | null;
    inventoryFilter: CocosEquipmentInventoryFilter;
    inventorySort: CocosEquipmentInventorySort;
  }
): EquipmentPanelViewModel {
  const hero = state.hero;
  const equipmentRows = buildHeroEquipmentActionRows(hero);
  const inspectItems = buildEquipmentInspectItems(hero);
  const selectedInspectItem = resolveEquipmentPanelInspectItem(
    inspectItems,
    options.inspectedItemId,
    options.inspectedItemSource
  );
  const inventoryView = buildInventorySummaryView(hero, {
    filter: options.inventoryFilter,
    sort: options.inventorySort
  });
  const actionDescriptors: EquipmentPanelActionDescriptor[] = inspectItems.map((item) => ({
    kind: "inspect",
    key: buildEquipmentPanelInspectButtonName(item),
    label: `查看 ${item.slotLabel} ${item.name}${item.source === "inventory" && item.count > 1 ? ` x${item.count}` : ""}`,
    itemId: item.itemId
  }));

  for (const row of equipmentRows) {
    for (const item of row.inventory) {
      actionDescriptors.push({
        kind: "equip",
        key: `EquipmentPanelAction-${row.slot}-${item.itemId}`,
        label: `${row.label} 装备 ${item.name}${item.count > 1 ? ` x${item.count}` : ""}`,
        slot: row.slot,
        itemId: item.itemId
      });
    }

    if (row.itemId) {
      actionDescriptors.push({
        kind: "unequip",
        key: `EquipmentPanelAction-${row.slot}-unequip`,
        label: `${row.label} 卸下 ${row.itemName}`,
        slot: row.slot
      });
    }
  }

  return {
    hero,
    inspectItems,
    selectedInspectItem,
    equipmentRows,
    inventoryFilterLabel: describeEquipmentInventoryFilter(options.inventoryFilter),
    inventorySortLabel: describeEquipmentInventorySort(options.inventorySort),
    inventoryLines: inventoryView.lines,
    loadoutLines: formatEquipmentOverviewLines(hero),
    inspectLines: formatEquipmentInspectLines(selectedInspectItem),
    spotlightLines: formatLootSpotlightLines(
      state.recentSessionEvents ?? [],
      hero?.id,
      hero?.name
    ),
    lootLines: formatRecentLootLines(
      state.recentEventLog,
      hero?.id,
      3,
      state.recentSessionEvents ?? [],
      hero?.name
    ),
    bonusSummary: formatEquipmentStatSummary(hero),
    actionDescriptors
  };
}
