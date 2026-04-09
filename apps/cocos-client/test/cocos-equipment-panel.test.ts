import assert from "node:assert/strict";
import test from "node:test";
import { VeilEquipmentPanel } from "../assets/scripts/VeilEquipmentPanel.ts";
import { createLobbyPanelTestAccount } from "../assets/scripts/cocos-lobby-panel-model.ts";
import { createComponentHarness, findNode, pressNode, readCardLabel } from "./helpers/cocos-panel-harness.ts";
import { createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";

test("VeilEquipmentPanel renders loadout, inventory, and recent loot in a dedicated panel", () => {
  const { component, node } = createComponentHarness(VeilEquipmentPanel, {
    name: "EquipmentPanelRoot",
    width: 420,
    height: 520
  });
  const update = createSessionUpdate();
  const hero = update.world.ownHeroes[0]!;
  hero.name = "凯琳";
  hero.loadout.equipment.weaponId = "vanguard_blade";
  hero.loadout.inventory = ["militia_pike", "scout_compass"];

  component.render({
    hero,
    recentEventLog: [
      {
        ...createLobbyPanelTestAccount().recentEventLog[0]!,
        id: "loot-1",
        description: "凯琳 在战斗后获得了稀有装备 斥候罗盘。",
        worldEventType: "hero.equipmentFound",
        heroId: "hero-1"
      }
    ],
    recentSessionEvents: [
      {
        type: "hero.equipmentFound",
        heroId: "hero-1",
        equipmentName: "斥候罗盘",
        rarity: "common"
      }
    ]
  });

  assert.match(readCardLabel(node, "EquipmentPanelHeader"), /凯琳 的装备背包/);
  assert.match(readCardLabel(node, "EquipmentPanelLootSpotlight"), /战斗结算 获得新装备/);
  assert.match(readCardLabel(node, "EquipmentPanelLoadout"), /武器 先锋战刃/);
  assert.match(readCardLabel(node, "EquipmentPanelInventory"), /筛选 全部 · 排序 槽位/);
  assert.match(readCardLabel(node, "EquipmentPanelInventory"), /背包 2\/6 件/);
  assert.match(readCardLabel(node, "EquipmentPanelLoot"), /战利品 最近 2 条/);
});

test("VeilEquipmentPanel routes close and equip actions through rendered buttons", () => {
  const { component, node } = createComponentHarness(VeilEquipmentPanel, {
    name: "EquipmentPanelRoot",
    width: 420,
    height: 520
  });
  const update = createSessionUpdate();
  update.world.ownHeroes[0]!.loadout.inventory = ["militia_pike"];
  let closed = 0;
  let equipped: { slot: string; equipmentId: string } | null = null;

  component.configure({
    onClose: () => {
      closed += 1;
    },
    onEquipItem: (slot, equipmentId) => {
      equipped = { slot, equipmentId };
    }
  });
  component.render({
    hero: update.world.ownHeroes[0]!,
    recentEventLog: []
  });

  pressNode(findNode(node, "EquipmentPanelAction-weapon-militia_pike"));
  pressNode(findNode(node, "EquipmentPanelClose"));

  assert.deepEqual(equipped, {
    slot: "weapon",
    equipmentId: "militia_pike"
  });
  assert.equal(closed, 1);
});

test("VeilEquipmentPanel supports inspecting equipped and bag items in a dedicated detail card", () => {
  const { component, node } = createComponentHarness(VeilEquipmentPanel, {
    name: "EquipmentPanelRoot",
    width: 420,
    height: 520
  });
  const update = createSessionUpdate();
  const hero = update.world.ownHeroes[0]!;
  hero.loadout.equipment.weaponId = "vanguard_blade";
  hero.loadout.inventory = ["scout_compass", "scout_compass"];

  component.render({
    hero,
    recentEventLog: []
  });

  assert.match(readCardLabel(node, "EquipmentPanelInspect"), /武器 先锋战刃 · 稀有/);
  assert.match(readCardLabel(node, "EquipmentPanelInspect"), /来源 当前已穿戴/);
  assert.match(readCardLabel(node, "EquipmentPanelInspect"), /战斗影响/);

  pressNode(findNode(node, "EquipmentPanelInspect-inventory-accessory-scout_compass"));

  assert.match(readCardLabel(node, "EquipmentPanelInspect"), /饰品 斥候罗盘 · 普通/);
  assert.match(readCardLabel(node, "EquipmentPanelInspect"), /来源 背包中 2 件/);
  assert.match(readCardLabel(node, "EquipmentPanelInspect"), /扩大战术容错/);
  assert.match(readCardLabel(node, "EquipmentPanelInspect"), /说明 帮助英雄更快判断战场破绽/);
});

test("VeilEquipmentPanel lets the player filter and sort bag entries from the dedicated controls", () => {
  const { component, node } = createComponentHarness(VeilEquipmentPanel, {
    name: "EquipmentPanelRoot",
    width: 420,
    height: 520
  });
  const update = createSessionUpdate();
  const hero = update.world.ownHeroes[0]!;
  hero.loadout.inventory = ["militia_pike", "sun_medallion", "scout_compass", "tower_shield_mail"];

  component.render({
    hero,
    recentEventLog: []
  });

  pressNode(findNode(node, "EquipmentPanelFilter-accessory"));
  pressNode(findNode(node, "EquipmentPanelSort-rarity"));

  const inventoryLabel = readCardLabel(node, "EquipmentPanelInventory");
  assert.match(inventoryLabel, /筛选 饰品 · 排序 稀有度/);
  assert.match(inventoryLabel, /曜日勋章/);
  assert.doesNotMatch(inventoryLabel, /民兵长枪/);
});
