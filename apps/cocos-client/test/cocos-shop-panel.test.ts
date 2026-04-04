import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosShopPanelView } from "../assets/scripts/cocos-shop-panel";

test("buildCocosShopPanelView formats gem purchases, WeChat purchases, and pending state", () => {
  const view = buildCocosShopPanelView({
    gemBalance: 30,
    pendingProductId: "equipment-sunforged-kit",
    products: [
      {
        productId: "resource-bundle-starter",
        name: "Starter Supply Cache",
        type: "resource_bundle",
        price: 25,
        enabled: true,
        grant: {
          resources: {
            gold: 250,
            wood: 40,
            ore: 20
          }
        }
      },
      {
        productId: "equipment-sunforged-kit",
        name: "Sunforged Kit",
        type: "equipment",
        price: 40,
        enabled: true,
        grant: {
          equipmentIds: ["sunforged_spear"]
        }
      },
      {
        productId: "gem-pack-premium",
        name: "Premium Gem Cache",
        type: "gem_pack",
        price: 0,
        wechatPriceFen: 600,
        enabled: true,
        grant: {
          gems: 120
        }
      }
    ]
  });

  assert.equal(view.gemBalanceLabel, "宝石 30");
  assert.equal(view.emptyLabel, null);
  assert.deepEqual(view.rows, [
    {
      productId: "resource-bundle-starter",
      name: "Starter Supply Cache",
      grantLabel: "金币 +250 / 木材 +40 / 矿石 +20",
      priceLabel: "25 宝石",
      affordabilityLabel: "可购买，余额 5 宝石",
      actionLabel: "购买",
      enabled: true,
      affordable: true,
      usesWechatPayment: false
    },
    {
      productId: "equipment-sunforged-kit",
      name: "Sunforged Kit",
      grantLabel: "装备 1 件",
      priceLabel: "40 宝石",
      affordabilityLabel: "订单处理中...",
      actionLabel: "购买中...",
      enabled: false,
      affordable: false,
      usesWechatPayment: false
    },
    {
      productId: "gem-pack-premium",
      name: "Premium Gem Cache",
      grantLabel: "宝石 x120",
      priceLabel: "微信 ¥6.00",
      affordabilityLabel: "需拉起微信支付",
      actionLabel: "微信购买",
      enabled: true,
      affordable: true,
      usesWechatPayment: true
    }
  ]);
});

test("buildCocosShopPanelView reports insufficient gems and empty states", () => {
  const insufficient = buildCocosShopPanelView({
    gemBalance: 3,
    pendingProductId: null,
    products: [
      {
        productId: "resource-bundle-starter",
        name: "Starter Supply Cache",
        type: "resource_bundle",
        price: 25,
        enabled: true,
        grant: {
          resources: {
            gold: 250
          }
        }
      }
    ]
  });

  assert.equal(insufficient.rows[0]?.affordabilityLabel, "宝石不足，还差 22");
  assert.equal(insufficient.rows[0]?.enabled, false);

  const empty = buildCocosShopPanelView({
    gemBalance: 8,
    pendingProductId: null,
    products: []
  });

  assert.equal(empty.emptyLabel, "当前没有可购买商品。");
  assert.deepEqual(empty.rows, []);
});
