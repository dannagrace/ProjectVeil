import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from "cc";
import type { EventLogEntry } from "./project-shared/index.ts";
import type { HeroView } from "./VeilCocosSession.ts";
import {
  buildHeroEquipmentActionRows,
  formatEquipmentOverviewLines,
  formatEquipmentStatSummary,
  formatInventorySummaryLines,
  formatRecentLootLines,
  type CocosEquipmentActionRow
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
  tone: "default" | "equip" | "unequip";
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

function buildActionButtons(
  rows: CocosEquipmentActionRow[],
  onEquipItem: VeilEquipmentPanelOptions["onEquipItem"],
  onUnequipItem: VeilEquipmentPanelOptions["onUnequipItem"]
): EquipmentPanelButtonState[] {
  const buttons: EquipmentPanelButtonState[] = [];

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

  configure(options: VeilEquipmentPanelOptions): void {
    this.onClose = options.onClose;
    this.onEquipItem = options.onEquipItem;
    this.onUnequipItem = options.onUnequipItem;
  }

  render(state: VeilEquipmentPanelRenderState): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const width = transform.width || 420;
    const height = transform.height || 520;
    const contentWidth = width - 30;
    const hero = state.hero;
    const rows = buildHeroEquipmentActionRows(hero);
    const buttons = buildActionButtons(rows, this.onEquipItem, this.onUnequipItem);
    const bonusSummary = formatEquipmentStatSummary(hero);
    const loadoutLines = formatEquipmentOverviewLines(hero);
    const inventoryLines = formatInventorySummaryLines(hero);
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
      Math.max(110, 34 + inventoryLines.length * 16),
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
        button.tone === "equip" ? EQUIP_FILL : button.tone === "unequip" ? UNEQUIP_FILL : BUTTON_FILL;
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
      if (child.name.startsWith("EquipmentPanelAction-") && !actionButtons.some((button) => button.name === child.name)) {
        child.active = false;
      }
    }
  }
}
