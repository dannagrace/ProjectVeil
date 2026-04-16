export interface ShopProductGrant {
  gems?: number;
  resources?: {
    gold?: number;
    wood?: number;
    ore?: number;
  };
  equipmentIds?: string[];
  cosmeticIds?: string[];
  seasonPassPremium?: boolean;
}

export type ShopProductType = "gem_pack" | "equipment" | "resource_bundle" | "season_pass_premium" | "cosmetic";

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
  featuredProductId: string | null;
  featuredTitle: string;
  featuredSummary: string;
  featuredFootnote: string;
  rows: ShopProductRowView[];
  emptyLabel: string | null;
}

export interface BuildCocosShopPanelInput {
  products: ShopProduct[];
  gemBalance: number;
  pendingProductId: string | null;
  ownedCosmeticIds?: string[];
  equippedCosmetics?: {
    heroSkinId?: string;
    unitRecolorId?: string;
    profileBorderId?: string;
    battleEmoteId?: string;
  };
  seasonPassPremiumOwned?: boolean;
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
  if ((product.grant.cosmeticIds?.length ?? 0) > 0) {
    return `外观 ${product.grant.cosmeticIds?.length ?? 0} 件`;
  }
  if (product.grant.seasonPassPremium === true) {
    return "高级通行证";
  }
  if (resources) {
    return resources;
  }
  return product.type === "equipment"
    ? "装备奖励"
    : product.type === "cosmetic"
      ? "外观奖励"
      : product.type === "season_pass_premium"
        ? "高级通行证"
        : "奖励待同步";
}

function resolveFeaturedProduct(input: BuildCocosShopPanelInput): ShopProduct | null {
  const products = input.products.filter((product) => product.enabled);
  const seasonPassProduct = products.find(
    (product) => product.type === "season_pass_premium" && input.seasonPassPremiumOwned !== true
  );
  if (seasonPassProduct) {
    return seasonPassProduct;
  }

  const ownedCosmeticIds = new Set((input.ownedCosmeticIds ?? []).map((entry) => entry.trim()).filter(Boolean));
  const equippedCosmeticIds = new Set(
    [
      input.equippedCosmetics?.heroSkinId,
      input.equippedCosmetics?.unitRecolorId,
      input.equippedCosmetics?.profileBorderId,
      input.equippedCosmetics?.battleEmoteId
    ]
      .map((entry) => entry?.trim())
      .filter((entry): entry is string => Boolean(entry))
  );
  const unequippedOwnedCosmetic = products.find((product) => {
    if (product.type !== "cosmetic") {
      return false;
    }
    const cosmeticId = product.grant.cosmeticIds?.[0]?.trim();
    return Boolean(cosmeticId && ownedCosmeticIds.has(cosmeticId) && !equippedCosmeticIds.has(cosmeticId));
  });
  if (unequippedOwnedCosmetic) {
    return unequippedOwnedCosmetic;
  }

  const wechatOffer = products.find((product) => Math.max(0, Math.floor(product.wechatPriceFen ?? 0)) > 0);
  if (wechatOffer) {
    return wechatOffer;
  }

  const gemAffordable = products.find((product) => Math.max(0, Math.floor(product.price ?? 0)) <= Math.max(0, Math.floor(input.gemBalance ?? 0)));
  return gemAffordable ?? products[0] ?? null;
}

function buildFeaturedCopy(product: ShopProduct | null, input: BuildCocosShopPanelInput): {
  productId: string | null;
  title: string;
  summary: string;
  footnote: string;
} {
  if (!product) {
    return {
      productId: null,
      title: "本期推荐",
      summary: "商店目录待同步",
      footnote: "当前没有可前置的推荐位。"
    };
  }

  const priceLabel = formatPriceLabel(product);
  if (product.type === "season_pass_premium") {
    return {
      productId: product.productId,
      title: `本期推荐 · ${product.name.trim() || "高级通行证"}`,
      summary: `${priceLabel} · 解锁高级奖励轨道与整季回流收益`,
      footnote: "如果这轮准备继续追活动和战令，这通常是最值得先看的长期投入。"
    };
  }

  if (product.type === "cosmetic") {
    const cosmeticId = product.grant.cosmeticIds?.[0]?.trim();
    const owned = cosmeticId ? (input.ownedCosmeticIds ?? []).includes(cosmeticId) : false;
    return {
      productId: product.productId,
      title: `外观推荐 · ${product.name.trim() || product.productId}`,
      summary: `${formatGrantLabel(product)} · ${priceLabel}`,
      footnote: owned ? "这件外观已经在仓库里，点一下就能立刻装备到当前账号前台。" : "如果这轮是回流开打，先换上可见外观会更容易把角色和成长记忆接起来。"
    };
  }

  return {
    productId: product.productId,
    title: `补给推荐 · ${product.name.trim() || product.productId}`,
    summary: `${formatGrantLabel(product)} · ${priceLabel}`,
    footnote:
      Math.max(0, Math.floor(product.wechatPriceFen ?? 0)) > 0
        ? "这是当前最直接的付费补给位，适合准备连续推进主线、地城或活动追逐时先补一档。"
        : "如果这轮准备继续推进几局，先把高价值补给拿下会让后面的主线和活动节奏更顺。"
  };
}

export function buildCocosShopPanelView(input: BuildCocosShopPanelInput): CocosShopPanelView {
  const gemBalance = Math.max(0, Math.floor(input.gemBalance ?? 0));
  const ownedCosmeticIds = new Set((input.ownedCosmeticIds ?? []).map((entry) => entry.trim()).filter(Boolean));
  const equippedCosmeticIds = new Set(
    [
      input.equippedCosmetics?.heroSkinId,
      input.equippedCosmetics?.unitRecolorId,
      input.equippedCosmetics?.profileBorderId,
      input.equippedCosmetics?.battleEmoteId
    ]
      .map((entry) => entry?.trim())
      .filter((entry): entry is string => Boolean(entry))
  );
  const rows = input.products.map<ShopProductRowView>((product) => {
    const usesWechatPayment = Math.max(0, Math.floor(product.wechatPriceFen ?? 0)) > 0;
    const affordable = usesWechatPayment ? true : gemBalance >= Math.max(0, Math.floor(product.price ?? 0));
    const pending = input.pendingProductId === product.productId;
    const cosmeticId = product.grant.cosmeticIds?.[0];
    const cosmeticOwned = cosmeticId ? ownedCosmeticIds.has(cosmeticId) : false;
    const cosmeticEquipped = cosmeticId ? equippedCosmeticIds.has(cosmeticId) : false;
    const seasonPassPremiumOwned = product.type === "season_pass_premium" && input.seasonPassPremiumOwned === true;
    const enabled =
      product.enabled &&
      !pending &&
      (product.type === "season_pass_premium"
        ? !seasonPassPremiumOwned && (usesWechatPayment || affordable)
        : product.type === "cosmetic"
        ? cosmeticEquipped
          ? false
          : cosmeticOwned || usesWechatPayment || affordable
        : usesWechatPayment || affordable);

    return {
      productId: product.productId,
      name: product.name.trim() || product.productId,
      grantLabel: formatGrantLabel(product),
      priceLabel: formatPriceLabel(product),
      affordabilityLabel: pending
        ? "订单处理中..."
        : !product.enabled
          ? "暂未上架"
          : seasonPassPremiumOwned
            ? "高级通行证已激活"
          : product.type === "cosmetic" && cosmeticEquipped
            ? "已装备"
            : product.type === "cosmetic" && cosmeticOwned
              ? "已拥有，可点击装备"
          : usesWechatPayment
            ? "需拉起微信支付"
            : affordable
              ? `可购买，余额 ${gemBalance - Math.max(0, Math.floor(product.price ?? 0))} 宝石`
              : `宝石不足，还差 ${Math.max(0, Math.floor(product.price ?? 0)) - gemBalance}`,
      actionLabel:
        pending
          ? "购买中..."
          : seasonPassPremiumOwned
            ? "已解锁"
            : product.type === "cosmetic" && cosmeticOwned
              ? "装备"
              : usesWechatPayment
                ? "微信购买"
                : "购买",
      enabled,
      affordable,
      usesWechatPayment
    };
  });
  const featured = buildFeaturedCopy(resolveFeaturedProduct(input), input);

  return {
    gemBalanceLabel: `宝石 ${gemBalance}`,
    featuredProductId: featured.productId,
    featuredTitle: featured.title,
    featuredSummary: featured.summary,
    featuredFootnote: featured.footnote,
    rows,
    emptyLabel: rows.length === 0 ? "当前没有可购买商品。" : null
  };
}
