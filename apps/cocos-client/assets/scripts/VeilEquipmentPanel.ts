import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from "cc";
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
import { assignUiLayer } from "./cocos-ui-layer.ts";

const { ccclass } = _decorator;
const H_ALIGN_LEFT = 0;
const H_ALIGN_CENTER = 1;
const V_ALIGN_TOP = 0;
const V_ALIGN_MIDDLE = 1;
const OVERFLOW_RESIZE_HEIGHT = 3;
const PANEL_BG = new Color(14, 20, 29, 238);
const PANEL_BORDER = new Color(232, 224, 192, 120);
const PANEL_INNER = new Color(255, 248, 214, 16);
const CARD_FILL = new Color(34, 46, 64, 190);
const CARD_HIGHLIGHT_FILL = new Color(52, 70, 98, 214);
const BUTTON_FILL = new Color(70, 92, 120, 228);
const EQUIP_FILL = new Color(84, 116, 86, 232);
const UNEQUIP_FILL = new Color(122, 82, 72, 232);

interface EquipmentPanelButtonTone {
  fill: Color;
  stroke: Color;
}

interface EquipmentPanelButtonState {
  name: string;
  label: string;
  callback: (() => void) | null;
  tone: "default" | "equip" | "unequip" | "inspect";
}

export interface VeilEquipmentPanelRenderState {
  hero: HeroView | null;
  recentEventLog: EventLogEntry[];
  recentSessionEvents?: Array<{
    type: "hero.equipmentFound";
    heroId: string;
    equipmentName: string;
    rarity: "common" | "rare" | "epic";
    overflowed?: boolean;
  }>;
}

export interface VeilEquipmentPanelOptions {
  onClose?: () => void;
  onEquipItem?: (slot: "weapon" | "armor" | "accessory", equipmentId: string) => void;
  onUnequipItem?: (slot: "weapon" | "armor" | "accessory") => void;
}

function buildInspectButtonName(item: CocosEquipmentInspectItem): string {
  return `EquipmentPanelInspect-${item.source}-${item.slot}-${item.itemId}`;
}

function buildActionButtons(
  inspectItems: CocosEquipmentInspectItem[],
  rows: CocosEquipmentActionRow[],
  onInspectItem: (item: CocosEquipmentInspectItem) => void,
  onEquipItem: VeilEquipmentPanelOptions["onEquipItem"],
  onUnequipItem: VeilEquipmentPanelOptions["onUnequipItem"]
): EquipmentPanelButtonState[] {
  const buttons: EquipmentPanelButtonState[] = inspectItems.map((item) => ({
    name: buildInspectButtonName(item),
    label: `查看 ${item.slotLabel} ${item.name}${item.source === "inventory" && item.count > 1 ? ` x${item.count}` : ""}`,
    tone: "inspect",
    callback: () => onInspectItem(item)
  }));

  for (const row of rows) {
    for (const item of row.inventory) {
      buttons.push({
        name: `EquipmentPanelAction-${row.slot}-${item.itemId}`,
        label: `${row.label} 装备 ${item.name}${item.count > 1 ? ` x${item.count}` : ""}`,
        tone: "equip",
        callback: onEquipItem ? () => onEquipItem(row.slot, item.itemId) : null
      });
    }

    if (row.itemId) {
      buttons.push({
        name: `EquipmentPanelAction-${row.slot}-unequip`,
        label: `${row.label} 卸下 ${row.itemName}`,
        tone: "unequip",
        callback: onUnequipItem ? () => onUnequipItem(row.slot) : null
      });
    }
  }

  return buttons;
}

@ccclass("ProjectVeilEquipmentPanel")
export class VeilEquipmentPanel extends Component {
  private onClose: (() => void) | undefined;
  private onEquipItem: VeilEquipmentPanelOptions["onEquipItem"];
  private onUnequipItem: VeilEquipmentPanelOptions["onUnequipItem"];
  private currentState: VeilEquipmentPanelRenderState | null = null;
  private inspectedItemId: string | null = null;
  private inspectedItemSource: CocosEquipmentInspectItem["source"] | null = null;
  private inventoryFilter: CocosEquipmentInventoryFilter = "all";
  private inventorySort: CocosEquipmentInventorySort = "slot";

  configure(options: VeilEquipmentPanelOptions): void {
    this.onClose = options.onClose;
    this.onEquipItem = options.onEquipItem;
    this.onUnequipItem = options.onUnequipItem;
  }

  render(state: VeilEquipmentPanelRenderState): void {
    this.currentState = state;
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const width = transform.width || 420;
    const height = transform.height || 520;
    const contentWidth = width - 30;
    const hero = state.hero;
    const rows = buildHeroEquipmentActionRows(hero);
    const inspectItems = buildEquipmentInspectItems(hero);
    const selectedInspectItem = this.resolveInspectedItem(inspectItems);
    const inventoryView = buildInventorySummaryView(hero, {
      filter: this.inventoryFilter,
      sort: this.inventorySort
    });
    const buttons = buildActionButtons(
      inspectItems,
      rows,
      (item) => this.inspectItem(item),
      this.onEquipItem,
      this.onUnequipItem
    );
    const bonusSummary = formatEquipmentStatSummary(hero);
    const loadoutLines = formatEquipmentOverviewLines(hero);
    const inventoryLines = inventoryView.lines;
    const inspectLines = formatEquipmentInspectLines(selectedInspectItem);
    const spotlightLines = formatLootSpotlightLines(
      state.recentSessionEvents ?? [],
      hero?.id,
      hero?.name
    );
    const lootLines = formatRecentLootLines(
      state.recentEventLog,
      hero?.id,
      3,
      state.recentSessionEvents ?? [],
      hero?.name
    );

    let cursorY = height / 2 - 16;
    this.syncChrome(width, height);

    cursorY = this.renderCard(
      "EquipmentPanelHeader",
      0,
      cursorY,
      contentWidth,
      78,
      [
        hero ? `${hero.name} 的装备背包` : "装备背包",
        hero ? `可查看已穿戴装备、背包物品与最近战利品。` : "等待英雄快照同步。",
        bonusSummary.length > 0
          ? `总加成 ${bonusSummary.map((entry) => `${entry.label} +${entry.value}`).join(" / ")}`
          : "总加成 当前无额外属性"
      ],
      {
        fill: CARD_HIGHLIGHT_FILL,
        stroke: new Color(244, 236, 208, 82)
      },
      null,
      14,
      18
    );

    this.renderButton(
      "EquipmentPanelClose",
      contentWidth / 2 - 42,
      height / 2 - 18,
      72,
      24,
      "关闭",
      {
        fill: new Color(112, 72, 64, 220),
        stroke: new Color(244, 226, 214, 114)
      },
      this.onClose ?? null
    );

    cursorY = this.renderCard(
      "EquipmentPanelControls",
      0,
      cursorY,
      contentWidth,
      60,
      [
        "筛选与排序",
        `筛选 当前 ${this.describeInventoryFilter(this.inventoryFilter)} · 排序 当前 ${this.describeInventorySort(this.inventorySort)}`
      ],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      null,
      12,
      15
    );

    this.renderInventoryControlButtons(contentWidth, cursorY + 4);

    cursorY -= 44;

    if ((state.recentSessionEvents?.length ?? 0) > 0) {
      cursorY = this.renderCard(
        "EquipmentPanelLootSpotlight",
        0,
        cursorY,
        contentWidth,
        76,
        spotlightLines,
        {
          fill: CARD_HIGHLIGHT_FILL,
          stroke: new Color(244, 236, 208, 82)
        },
        null,
        12,
        16
      );
    }

    cursorY = this.renderCard(
      "EquipmentPanelLoadout",
      0,
      cursorY,
      contentWidth,
      Math.max(112, 34 + loadoutLines.length * 16),
      ["穿戴配置", ...loadoutLines],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      null,
      13,
      16
    );

    cursorY = this.renderCard(
      "EquipmentPanelInventory",
      0,
      cursorY,
      contentWidth,
      Math.max(122, 34 + inventoryLines.length * 16),
      ["背包清单", ...inventoryLines],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      null,
      13,
      16
    );

    cursorY = this.renderCard(
      "EquipmentPanelInspect",
      0,
      cursorY,
      contentWidth,
      Math.max(96, 34 + inspectLines.length * 16),
      ["物品详情", ...inspectLines],
      {
        fill: CARD_HIGHLIGHT_FILL,
        stroke: new Color(244, 236, 208, 82)
      },
      null,
      13,
      16
    );

    cursorY = this.renderCard(
      "EquipmentPanelLoot",
      0,
      cursorY,
      contentWidth,
      Math.max(94, 34 + lootLines.length * 16),
      ["最近战利品", ...lootLines],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      null,
      13,
      16
    );

    this.renderActionButtons(contentWidth, cursorY, buttons);
  }

  private inspectItem(item: CocosEquipmentInspectItem): void {
    this.inspectedItemId = item.itemId;
    this.inspectedItemSource = item.source;
    if (this.currentState) {
      this.render(this.currentState);
    }
  }

  private setInventoryFilter(filter: CocosEquipmentInventoryFilter): void {
    this.inventoryFilter = filter;
    if (this.currentState) {
      this.render(this.currentState);
    }
  }

  private setInventorySort(sort: CocosEquipmentInventorySort): void {
    this.inventorySort = sort;
    if (this.currentState) {
      this.render(this.currentState);
    }
  }

  private resolveInspectedItem(items: CocosEquipmentInspectItem[]): CocosEquipmentInspectItem | null {
    const matchedItem = items.find(
      (item) => item.itemId === this.inspectedItemId && item.source === this.inspectedItemSource
    );
    if (matchedItem) {
      return matchedItem;
    }

    const [nextItem] = items;
    this.inspectedItemId = nextItem?.itemId ?? null;
    this.inspectedItemSource = nextItem?.source ?? null;
    return nextItem ?? null;
  }

  private describeInventoryFilter(filter: CocosEquipmentInventoryFilter): string {
    return filter === "all" ? "全部" : formatEquipmentSlotLabel(filter);
  }

  private describeInventorySort(sort: CocosEquipmentInventorySort): string {
    return sort === "slot" ? "槽位" : sort === "rarity" ? "稀有度" : "名称";
  }

  private syncChrome(width: number, height: number): void {
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = PANEL_BG;
    graphics.strokeColor = PANEL_BORDER;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 18);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = PANEL_INNER;
    graphics.roundRect(-width / 2 + 14, height / 2 - 22, width - 28, 6, 3);
    graphics.fill();
  }

  private renderCard(
    name: string,
    centerX: number,
    topY: number,
    width: number,
    minHeight: number,
    lines: string[],
    tone: EquipmentPanelButtonTone,
    onPress: (() => void) | null,
    fontSize: number,
    lineHeight: number
  ): number {
    const height = Math.max(minHeight, 20 + lines.length * lineHeight);
    let cardNode = this.node.getChildByName(name);
    if (!cardNode) {
      cardNode = new Node(name);
      cardNode.parent = this.node;
    }
    assignUiLayer(cardNode);
    cardNode.active = true;

    const transform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    cardNode.setPosition(centerX, topY - height / 2, 0.5);
    const graphics = cardNode.getComponent(Graphics) ?? cardNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = tone.fill;
    graphics.strokeColor = tone.stroke;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 14);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 16);
    graphics.roundRect(-width / 2 + 12, height / 2 - 16, width - 24, 5, 3);
    graphics.fill();

    let labelNode = cardNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = cardNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 24, height - 14);
    labelNode.setPosition(0, 0, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = lines.join("\n");
    label.fontSize = fontSize;
    label.lineHeight = lineHeight;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_TOP;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.color = new Color(244, 247, 252, 255);

    cardNode.off(Node.EventType.TOUCH_END);
    cardNode.off(Node.EventType.MOUSE_UP);
    if (onPress) {
      cardNode.on(Node.EventType.TOUCH_END, onPress);
      cardNode.on(Node.EventType.MOUSE_UP, onPress);
    }

    return topY - height - 10;
  }

  private renderButton(
    name: string,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    labelText: string,
    tone: EquipmentPanelButtonTone,
    onPress: (() => void) | null
  ): void {
    let buttonNode = this.node.getChildByName(name);
    if (!buttonNode) {
      buttonNode = new Node(name);
      buttonNode.parent = this.node;
    }
    assignUiLayer(buttonNode);
    buttonNode.active = true;
    const transform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    buttonNode.setPosition(centerX, centerY, 1);
    const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = tone.fill;
    graphics.strokeColor = tone.stroke;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 10);
    graphics.fill();
    graphics.stroke();

    let labelNode = buttonNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = buttonNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 12, height - 6);
    labelNode.setPosition(0, 0, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 11;
    label.lineHeight = 13;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = new Color(244, 247, 252, 255);

    buttonNode.off(Node.EventType.TOUCH_END);
    buttonNode.off(Node.EventType.MOUSE_UP);
    if (onPress) {
      buttonNode.on(Node.EventType.TOUCH_END, onPress);
      buttonNode.on(Node.EventType.MOUSE_UP, onPress);
    }
  }

  private renderActionButtons(contentWidth: number, topY: number, buttons: EquipmentPanelButtonState[]): void {
    const actionButtons = buttons.length > 0
      ? buttons
      : [
          {
            name: "EquipmentPanelAction-empty",
            label: "当前没有可执行的装备操作",
            callback: null,
            tone: "default" as const
          }
        ];

    const buttonWidth = Math.floor((contentWidth - 6) / 2);
    const buttonHeight = 24;
    const gap = 6;
    const startY = topY - 10 - buttonHeight / 2;
    actionButtons.forEach((button, index) => {
      const row = Math.floor(index / 2);
      const column = index % 2;
      const centerX = column === 0 ? -buttonWidth / 2 - gap / 2 : buttonWidth / 2 + gap / 2;
      const centerY = startY - row * (buttonHeight + gap);
      const fill =
        button.tone === "equip"
          ? EQUIP_FILL
          : button.tone === "unequip"
            ? UNEQUIP_FILL
            : button.tone === "inspect"
              ? CARD_HIGHLIGHT_FILL
              : BUTTON_FILL;
      this.renderButton(
        button.name,
        centerX,
        centerY,
        buttonWidth,
        buttonHeight,
        button.label,
        {
          fill,
          stroke: new Color(230, 238, 246, 106)
        },
        button.callback
      );
    });

    for (const child of this.node.children) {
      if (
        (child.name.startsWith("EquipmentPanelAction-") || child.name.startsWith("EquipmentPanelInspect-")) &&
        !actionButtons.some((button) => button.name === child.name)
      ) {
        child.active = false;
      }
    }
  }

  private renderInventoryControlButtons(contentWidth: number, centerY: number): void {
    const buttonWidth = Math.floor((contentWidth - 18) / 4);
    const buttonHeight = 20;
    const gap = 6;
    const filterButtons: Array<{ name: string; label: string; filter: CocosEquipmentInventoryFilter }> = [
      { name: "EquipmentPanelFilter-all", label: "全部", filter: "all" },
      { name: "EquipmentPanelFilter-weapon", label: "武器", filter: "weapon" },
      { name: "EquipmentPanelFilter-armor", label: "护甲", filter: "armor" },
      { name: "EquipmentPanelFilter-accessory", label: "饰品", filter: "accessory" }
    ];
    filterButtons.forEach((button, index) => {
      this.renderButton(
        button.name,
        -contentWidth / 2 + buttonWidth / 2 + index * (buttonWidth + gap),
        centerY,
        buttonWidth,
        buttonHeight,
        button.label,
        {
          fill: this.inventoryFilter === button.filter ? CARD_HIGHLIGHT_FILL : BUTTON_FILL,
          stroke: new Color(230, 238, 246, 106)
        },
        () => this.setInventoryFilter(button.filter)
      );
    });

    const sortButtons: Array<{ name: string; label: string; sort: CocosEquipmentInventorySort }> = [
      { name: "EquipmentPanelSort-slot", label: "槽位", sort: "slot" },
      { name: "EquipmentPanelSort-rarity", label: "稀有", sort: "rarity" },
      { name: "EquipmentPanelSort-name", label: "名称", sort: "name" }
    ];
    sortButtons.forEach((button, index) => {
      this.renderButton(
        button.name,
        -contentWidth / 2 + buttonWidth / 2 + index * (buttonWidth + gap),
        centerY - 24,
        buttonWidth,
        buttonHeight,
        button.label,
        {
          fill: this.inventorySort === button.sort ? CARD_HIGHLIGHT_FILL : BUTTON_FILL,
          stroke: new Color(230, 238, 246, 106)
        },
        () => this.setInventorySort(button.sort)
      );
    });

    for (const child of this.node.children) {
      if (
        (child.name.startsWith("EquipmentPanelFilter-") || child.name.startsWith("EquipmentPanelSort-")) &&
        !filterButtons.some((button) => button.name === child.name) &&
        !sortButtons.some((button) => button.name === child.name)
      ) {
        child.active = false;
      }
    }
  }
}
