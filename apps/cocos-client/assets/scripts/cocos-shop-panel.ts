export interface ShopProductGrant {
  gems?: number;
  resources?: {
    gold?: number;
    wood?: number;
    ore?: number;
  };
  equipmentIds?: string[];
}

export type ShopProductType = "gem_pack" | "equipment" | "resource_bundle";

export interface ShopProduct {
  productId: string;
  name: string;
  type: ShopProductType;
  price: number;
  wechatPriceFen?: number;
  enabled: boolean;
  grant: ShopProductGrant;
}

export interface ShopProductRowView {
  productId: string;
  name: string;
  grantLabel: string;
  priceLabel: string;
  affordabilityLabel: string;
  actionLabel: string;
  enabled: boolean;
  affordable: boolean;
  usesWechatPayment: boolean;
}

export interface CocosShopPanelView {
  gemBalanceLabel: string;
  rows: ShopProductRowView[];
  emptyLabel: string | null;
}

export interface BuildCocosShopPanelInput {
  products: ShopProduct[];
  gemBalance: number;
  pendingProductId: string | null;
}

function formatResourceGrant(resources?: ShopProductGrant["resources"]): string | null {
  if (!resources) {
    return null;
  }

  const parts = [
    (resources.gold ?? 0) > 0 ? `金币 +${Math.floor(resources.gold ?? 0)}` : null,
    (resources.wood ?? 0) > 0 ? `木材 +${Math.floor(resources.wood ?? 0)}` : null,
    (resources.ore ?? 0) > 0 ? `矿石 +${Math.floor(resources.ore ?? 0)}` : null
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : null;
}

function formatPriceLabel(product: ShopProduct): string {
  const gemPrice = Math.max(0, Math.floor(product.price ?? 0));
  const wechatPriceFen = Math.max(0, Math.floor(product.wechatPriceFen ?? 0));
  if (wechatPriceFen > 0 && gemPrice > 0) {
    return `微信 ¥${(wechatPriceFen / 100).toFixed(2)} / ${gemPrice} 宝石`;
  }
  if (wechatPriceFen > 0) {
    return `微信 ¥${(wechatPriceFen / 100).toFixed(2)}`;
  }
  return `${gemPrice} 宝石`;
}

function formatGrantLabel(product: ShopProduct): string {
  const resources = formatResourceGrant(product.grant.resources);
  if ((product.grant.gems ?? 0) > 0) {
    return `宝石 x${Math.floor(product.grant.gems ?? 0)}`;
  }
  if ((product.grant.equipmentIds?.length ?? 0) > 0) {
    return `装备 ${product.grant.equipmentIds?.length ?? 0} 件`;
  }
  if (resources) {
    return resources;
  }
  return product.type === "equipment" ? "装备奖励" : "奖励待同步";
}

export function buildCocosShopPanelView(input: BuildCocosShopPanelInput): CocosShopPanelView {
  const gemBalance = Math.max(0, Math.floor(input.gemBalance ?? 0));
  const rows = input.products.map<ShopProductRowView>((product) => {
    const usesWechatPayment = Math.max(0, Math.floor(product.wechatPriceFen ?? 0)) > 0;
    const affordable = usesWechatPayment ? true : gemBalance >= Math.max(0, Math.floor(product.price ?? 0));
    const pending = input.pendingProductId === product.productId;
    const enabled = product.enabled && !pending && (usesWechatPayment || affordable);

    return {
      productId: product.productId,
      name: product.name.trim() || product.productId,
      grantLabel: formatGrantLabel(product),
      priceLabel: formatPriceLabel(product),
      affordabilityLabel: pending
        ? "订单处理中..."
        : !product.enabled
          ? "暂未上架"
          : usesWechatPayment
            ? "需拉起微信支付"
            : affordable
              ? `可购买，余额 ${gemBalance - Math.max(0, Math.floor(product.price ?? 0))} 宝石`
              : `宝石不足，还差 ${Math.max(0, Math.floor(product.price ?? 0)) - gemBalance}`,
      actionLabel: pending ? "购买中..." : usesWechatPayment ? "微信购买" : "购买",
      enabled,
      affordable,
      usesWechatPayment
    };
  });

  return {
    gemBalanceLabel: `宝石 ${gemBalance}`,
    rows,
    emptyLabel: rows.length === 0 ? "当前没有可购买商品。" : null
  };
}
