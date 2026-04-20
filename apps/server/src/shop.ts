import type { IncomingMessage, ServerResponse } from "node:http";
import shopConfigDocument from "../../../configs/shop-config.json";
import { getEquipmentDefinition, normalizeCosmeticInventory, resolveCosmeticCatalog, resolveWeeklyShopRotation } from "@veil/shared/economy";
import type { CosmeticId, EquippedCosmetics, ResourceLedger, ShopRotation } from "@veil/shared/models";
import { emitAnalyticsEvent } from "./analytics";
import { validateAuthSessionFromRequest } from "./auth";
import { equipOwnedCosmetic, type RoomSnapshotStore } from "./persistence";

export type ShopProductType = "gem_pack" | "equipment" | "resource_bundle" | "season_pass_premium" | "cosmetic";

export interface ShopProductGrant {
  gems?: number;
  resources?: Partial<ResourceLedger>;
  equipmentIds?: string[];
  cosmeticIds?: CosmeticId[];
  seasonPassPremium?: boolean;
}

export interface ShopProduct {
  productId: string;
  name: string;
  type: ShopProductType;
  price: number;
  wechatPriceFen?: number;
  appleProductId?: string;
  applePriceCents?: number;
  googleProductId?: string;
  googlePriceCents?: number;
  enabled: boolean;
  grant: ShopProductGrant;
}

interface ShopConfigDocument {
  products?: Partial<ShopProduct>[] | null;
  purchaseControls?: Partial<ShopPurchaseControlsConfigDocument> | null;
}

interface ShopProductsResponse {
  items: ShopProduct[];
  rotation: ShopRotation;
}

interface ShopPurchaseControlsConfigDocument {
  limitTimezone?: string | null;
  dailyGemSpendCap?: number | null;
  highValuePurchaseThreshold?: number | null;
  perItemDailyQuantityLimits?: Record<string, number | null> | null;
}

export interface ShopPurchaseControls {
  limitTimezone: string;
  dailyGemSpendCap: number;
  highValuePurchaseThreshold: number;
  perItemDailyQuantityLimits: Record<string, number>;
}

export interface RegisterShopRoutesOptions {
  products?: Partial<ShopProduct>[];
  purchaseControls?: Partial<ShopPurchaseControlsConfigDocument>;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "payload_too_large";
  }
}

class PurchaseLimitExceededError extends Error {
  constructor(
    readonly limitType: "daily_gem_spend_cap" | "daily_item_quantity_limit",
    readonly resetAt: string
  ) {
    super(`Purchase limit exceeded: ${limitType}`);
    this.name = "purchase_limit_exceeded";
  }
}

const MAX_JSON_BODY_BYTES = 32 * 1024;

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    request.resume();
    throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function toErrorPayload(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "error" : "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

function emitPurchaseFailedEvent(input: {
  playerId: string;
  purchaseId: string;
  productId: string;
  paymentMethod: "gems" | "wechat_pay";
  failureReason: string;
}): void {
  emitAnalyticsEvent("purchase_failed", {
    playerId: input.playerId,
    payload: {
      purchaseId: input.purchaseId,
      productId: input.productId,
      paymentMethod: input.paymentMethod,
      failureReason: input.failureReason,
      orderStatus: "failed"
    }
  });
}

function normalizePositiveInteger(value: number, field: string, allowZero = false): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || (!allowZero && normalized <= 0) || (allowZero && normalized < 0)) {
    throw new Error(`${field} must be a ${allowZero ? "non-negative" : "positive"} integer`);
  }

  return normalized;
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  return normalizePositiveInteger(value, field, true);
}

function normalizeResourceLedger(resources?: Partial<ResourceLedger> | null): ResourceLedger {
  return {
    gold: Math.max(0, Math.floor(resources?.gold ?? 0)),
    wood: Math.max(0, Math.floor(resources?.wood ?? 0)),
    ore: Math.max(0, Math.floor(resources?.ore ?? 0))
  };
}

function normalizeGrant(rawGrant?: ShopProductGrant | null): ShopProductGrant {
  const equipmentIds = (rawGrant?.equipmentIds ?? []).map((equipmentId) => equipmentId?.trim()).filter(Boolean) as string[];
  for (const equipmentId of equipmentIds) {
    if (!getEquipmentDefinition(equipmentId)) {
      throw new Error(`shop product references unknown equipment: ${equipmentId}`);
    }
  }
  const cosmeticCatalogIds = new Set(resolveCosmeticCatalog().map((entry) => entry.id));
  const cosmeticIds = (rawGrant?.cosmeticIds ?? []).map((cosmeticId) => cosmeticId?.trim()).filter(Boolean) as string[];
  for (const cosmeticId of cosmeticIds) {
    if (!cosmeticCatalogIds.has(cosmeticId)) {
      throw new Error(`shop product references unknown cosmetic: ${cosmeticId}`);
    }
  }

  return {
    ...(rawGrant?.gems != null ? { gems: normalizePositiveInteger(rawGrant.gems, "grant.gems", true) } : {}),
    ...(equipmentIds.length > 0 ? { equipmentIds } : {}),
    ...(cosmeticIds.length > 0 ? { cosmeticIds } : {}),
    ...(rawGrant?.resources ? { resources: normalizeResourceLedger(rawGrant.resources) } : {}),
    ...(rawGrant?.seasonPassPremium === true ? { seasonPassPremium: true } : {})
  };
}

function normalizeTimeZone(value?: string | null): string {
  const normalized = value?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
  } catch {
    throw new Error(`shop purchase controls limitTimezone is invalid: ${normalized}`);
  }
  return normalized;
}

function normalizePerItemDailyQuantityLimits(value?: Record<string, number | null> | null): Record<string, number> {
  const entries = Object.entries(value ?? {}).flatMap(([productId, rawLimit]) => {
    const normalizedProductId = productId.trim();
    if (!normalizedProductId) {
      return [];
    }
    return [[normalizedProductId, normalizeNonNegativeInteger(rawLimit ?? Number.NaN, `daily quantity limit for ${normalizedProductId}`)] as const];
  });
  return Object.fromEntries(entries);
}

function normalizePurchaseControls(rawControls?: Partial<ShopPurchaseControlsConfigDocument> | null): ShopPurchaseControls {
  return {
    limitTimezone: normalizeTimeZone(rawControls?.limitTimezone),
    dailyGemSpendCap: normalizeNonNegativeInteger(rawControls?.dailyGemSpendCap ?? 0, "shop purchase controls dailyGemSpendCap"),
    highValuePurchaseThreshold: normalizeNonNegativeInteger(
      rawControls?.highValuePurchaseThreshold ?? 0,
      "shop purchase controls highValuePurchaseThreshold"
    ),
    perItemDailyQuantityLimits: normalizePerItemDailyQuantityLimits(rawControls?.perItemDailyQuantityLimits)
  };
}

function normalizeShopProducts(rawProducts?: Partial<ShopProduct>[] | null): ShopProduct[] {
  return (rawProducts ?? []).map((rawProduct, index) => {
    const productId = rawProduct.productId?.trim();
    if (!productId) {
      throw new Error(`shop product[${index}] productId is required`);
    }

    const name = rawProduct.name?.trim();
    if (!name) {
      throw new Error(`shop product ${productId} name is required`);
    }

    if (
      rawProduct.type !== "gem_pack" &&
      rawProduct.type !== "equipment" &&
      rawProduct.type !== "resource_bundle" &&
      rawProduct.type !== "season_pass_premium" &&
      rawProduct.type !== "cosmetic"
    ) {
      throw new Error(`shop product ${productId} type must be gem_pack, equipment, resource_bundle, season_pass_premium, or cosmetic`);
    }

    const grant = normalizeGrant(rawProduct.grant);
    const hasGrant =
      (grant.gems ?? 0) > 0 ||
      (grant.equipmentIds?.length ?? 0) > 0 ||
      (grant.cosmeticIds?.length ?? 0) > 0 ||
      ((grant.resources?.gold ?? 0) > 0 || (grant.resources?.wood ?? 0) > 0 || (grant.resources?.ore ?? 0) > 0) ||
      grant.seasonPassPremium === true;
    if (!hasGrant) {
      throw new Error(`shop product ${productId} grant must not be empty`);
    }

    if (rawProduct.type === "equipment" && (grant.equipmentIds?.length ?? 0) === 0) {
      throw new Error(`shop product ${productId} equipment grants must include equipmentIds`);
    }
    if (rawProduct.type === "cosmetic" && (grant.cosmeticIds?.length ?? 0) === 0) {
      throw new Error(`shop product ${productId} cosmetic grants must include cosmeticIds`);
    }
    if (rawProduct.type === "resource_bundle" && !grant.resources) {
      throw new Error(`shop product ${productId} resource bundles must include resources`);
    }
    if (rawProduct.type === "gem_pack" && (grant.gems ?? 0) <= 0) {
      throw new Error(`shop product ${productId} gem packs must include gems`);
    }
    if (rawProduct.type === "season_pass_premium" && grant.seasonPassPremium !== true) {
      throw new Error(`shop product ${productId} season pass premium grants must set seasonPassPremium`);
    }

    return {
      productId,
      name,
      type: rawProduct.type,
      price: normalizePositiveInteger(rawProduct.price ?? Number.NaN, `shop product ${productId} price`, true),
      ...(rawProduct.wechatPriceFen != null
        ? { wechatPriceFen: normalizePositiveInteger(rawProduct.wechatPriceFen, `shop product ${productId} wechatPriceFen`) }
        : {}),
      ...(rawProduct.appleProductId?.trim() ? { appleProductId: rawProduct.appleProductId.trim() } : {}),
      ...(rawProduct.applePriceCents != null
        ? { applePriceCents: normalizePositiveInteger(rawProduct.applePriceCents, `shop product ${productId} applePriceCents`) }
        : {}),
      ...(rawProduct.googleProductId?.trim() ? { googleProductId: rawProduct.googleProductId.trim() } : {}),
      ...(rawProduct.googlePriceCents != null
        ? { googlePriceCents: normalizePositiveInteger(rawProduct.googlePriceCents, `shop product ${productId} googlePriceCents`) }
        : {}),
      enabled: rawProduct.enabled !== false,
      grant
    };
  });
}

export function resolveShopProducts(options?: RegisterShopRoutesOptions): ShopProduct[] {
  const configuredProducts = options?.products ?? (shopConfigDocument as ShopConfigDocument).products;
  return normalizeShopProducts(configuredProducts);
}

export function resolveShopPurchaseControls(options?: RegisterShopRoutesOptions): ShopPurchaseControls {
  const configuredControls = options?.purchaseControls ?? (shopConfigDocument as ShopConfigDocument).purchaseControls;
  return normalizePurchaseControls(configuredControls);
}

function buildRotationProducts(rotation = resolveWeeklyShopRotation()): ShopProduct[] {
  const catalogById = new Map(resolveCosmeticCatalog().map((entry) => [entry.id, entry] as const));
  return [...rotation.featuredSlots, ...rotation.discountSlots].flatMap((slot) => {
    const cosmetic = slot.cosmeticId ? catalogById.get(slot.cosmeticId) : null;
    if (!cosmetic) {
      return [];
    }
    const discountMultiplier = Math.max(0, 100 - slot.discountPercent) / 100;
    return [
      {
        productId: `cosmetic:${cosmetic.id}`,
        name: `${cosmetic.name} · ${slot.label}`,
        type: "cosmetic" as const,
        price: Math.max(1, Math.floor(cosmetic.price * discountMultiplier)),
        enabled: true,
        grant: {
          cosmeticIds: [cosmetic.id]
        }
      }
    ];
  });
}

function sendUnauthorized(
  response: ServerResponse,
  errorCode: "unauthorized" | "token_expired" | "token_kind_invalid" | "session_revoked" = "unauthorized"
): void {
  sendJson(response, 401, {
    error: {
      code: errorCode,
      message:
        errorCode === "token_expired"
          ? "Auth token has expired"
          : errorCode === "session_revoked"
            ? "Auth session has been revoked"
            : "Guest auth session is missing or invalid"
    }
  });
}

function sendAccountBanned(response: ServerResponse, ban?: { banReason?: string; banExpiry?: string } | null): void {
  sendJson(response, 403, {
    error: {
      code: "account_banned",
      message: "Account is banned",
      reason: ban?.banReason ?? "No reason provided",
      ...(ban?.banExpiry ? { expiry: ban.banExpiry } : {})
    }
  });
}

async function requireAuthSession(request: IncomingMessage, response: ServerResponse, store: RoomSnapshotStore | null) {
  const result = await validateAuthSessionFromRequest(request, store);
  if (!result.session) {
    if (result.errorCode === "account_banned") {
      sendAccountBanned(response, result.ban);
      return null;
    }
    sendUnauthorized(response, result.errorCode ?? "unauthorized");
    return null;
  }

  return result.session;
}

function findProductById(products: ShopProduct[], productId: string): ShopProduct | null {
  const normalizedProductId = productId.trim();
  return products.find((product) => product.productId === normalizedProductId) ?? null;
}

function hasPurchaseHistoryStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "purchaseShopProduct" | "listPlayerPurchaseHistory">> {
  return Boolean(store?.purchaseShopProduct && store.listPlayerPurchaseHistory);
}

function parseGmtOffsetMinutes(value: string): number {
  if (value === "GMT") {
    return 0;
  }
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(value);
  if (!match) {
    throw new Error(`Unsupported GMT offset format: ${value}`);
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function getTimeZoneOffsetMinutes(at: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit"
  });
  const offsetPart = formatter.formatToParts(at).find((part) => part.type === "timeZoneName")?.value;
  if (!offsetPart) {
    throw new Error(`Unable to resolve timezone offset for ${timeZone}`);
  }
  return parseGmtOffsetMinutes(offsetPart);
}

function getDatePartsInTimeZone(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(at);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return { year, month, day };
}

function getUtcInstantForTimeZoneMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}

function getCurrentPurchaseLimitWindow(referenceAt: Date, timeZone: string): { from: string; resetAt: string } {
  const { year, month, day } = getDatePartsInTimeZone(referenceAt, timeZone);
  const start = getUtcInstantForTimeZoneMidnight(year, month, day, timeZone);
  const reset = getUtcInstantForTimeZoneMidnight(year, month, day + 1, timeZone);
  return {
    from: start.toISOString(),
    resetAt: reset.toISOString()
  };
}

async function enforcePurchaseLimits(input: {
  store: RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listPlayerPurchaseHistory">>;
  playerId: string;
  productId: string;
  quantity: number;
  totalPrice: number;
  controls: ShopPurchaseControls;
}): Promise<void> {
  const itemLimit = input.controls.perItemDailyQuantityLimits[input.productId] ?? 0;
  if (input.controls.dailyGemSpendCap <= 0 && itemLimit <= 0) {
    return;
  }

  const window = getCurrentPurchaseLimitWindow(new Date(), input.controls.limitTimezone);
  const history = await input.store.listPlayerPurchaseHistory(input.playerId, {
    from: window.from,
    limit: 10_000,
    offset: 0
  });

  if (input.controls.dailyGemSpendCap > 0) {
    const currentSpend = history.items.reduce((sum, item) => sum + item.amount, 0);
    if (currentSpend + input.totalPrice > input.controls.dailyGemSpendCap) {
      throw new PurchaseLimitExceededError("daily_gem_spend_cap", window.resetAt);
    }
  }

  if (itemLimit > 0) {
    const currentQuantity = history.items
      .filter((item) => item.itemId === input.productId)
      .reduce((sum, item) => sum + item.quantity, 0);
    if (currentQuantity + input.quantity > itemLimit) {
      throw new PurchaseLimitExceededError("daily_item_quantity_limit", window.resetAt);
    }
  }
}

export function registerShopRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null,
  options: RegisterShopRoutesOptions = {}
): void {
  const baseProducts = resolveShopProducts(options);
  const purchaseControls = resolveShopPurchaseControls(options);

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/shop/products", async (_request, response) => {
    const rotation = resolveWeeklyShopRotation();
    const items = [...baseProducts.filter((product) => product.enabled), ...buildRotationProducts(rotation)];
    sendJson(response, 200, {
      items,
      rotation
    } satisfies ShopProductsResponse);
  });

  app.post("/api/shop/purchase", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!hasPurchaseHistoryStore(store)) {
      sendJson(response, 503, {
        error: {
          code: "shop_persistence_unavailable",
          message: "Shop purchases require configured room persistence storage"
        }
      });
      return;
    }

    let analyticsPurchaseContext:
      | {
          playerId: string;
          purchaseId: string;
          productId: string;
        }
      | undefined;

    try {
      const body = (await readJsonBody(request)) as {
        productId?: string | null;
        quantity?: number | null;
        purchaseId?: string | null;
      };
      const productId = body.productId?.trim();
      const purchaseId = body.purchaseId?.trim();
      const quantity = normalizePositiveInteger(body.quantity ?? Number.NaN, "quantity");

      if (!productId) {
        sendJson(response, 400, {
          error: {
            code: "invalid_product_id",
            message: "productId is required"
          }
        });
        return;
      }

      if (!purchaseId) {
        sendJson(response, 400, {
          error: {
            code: "invalid_purchase_id",
            message: "purchaseId is required"
          }
        });
        return;
      }

      const rotation = resolveWeeklyShopRotation();
      const product = findProductById([...baseProducts, ...buildRotationProducts(rotation)], productId);
      if (!product) {
        sendJson(response, 404, {
          error: {
            code: "product_not_found",
            message: `Shop product not found: ${productId}`
          }
        });
        return;
      }
      if (!product.enabled) {
        sendJson(response, 409, {
          error: {
            code: "product_not_available",
            message: `Shop product is not currently on sale: ${productId}`
          }
        });
        return;
      }

      analyticsPurchaseContext = {
        playerId: authSession.playerId,
        purchaseId,
        productId: product.productId
      };

      await enforcePurchaseLimits({
        store,
        playerId: authSession.playerId,
        productId: product.productId,
        quantity,
        totalPrice: product.price * quantity,
        controls: purchaseControls
      });

      const result = await store.purchaseShopProduct(authSession.playerId, {
        purchaseId,
        productId: product.productId,
        productName: product.name,
        quantity,
        unitPrice: product.price,
        grant: product.grant
      });
      emitAnalyticsEvent("purchase", {
        playerId: authSession.playerId,
        payload: {
          purchaseId: result.purchaseId,
          productId: result.productId,
          quantity: result.quantity,
          totalPrice: result.totalPrice
        }
      });
      emitAnalyticsEvent("purchase_completed", {
        playerId: authSession.playerId,
        payload: {
          purchaseId: result.purchaseId,
          productId: result.productId,
          paymentMethod: "gems",
          quantity: result.quantity,
          totalPrice: result.totalPrice
        }
      });
      if (
        purchaseControls.highValuePurchaseThreshold > 0 &&
        result.totalPrice >= purchaseControls.highValuePurchaseThreshold
      ) {
        emitAnalyticsEvent("purchase_high_value_alert", {
          playerId: authSession.playerId,
          payload: {
            purchaseId: result.purchaseId,
            productId: result.productId,
            quantity: result.quantity,
            totalPrice: result.totalPrice,
            threshold: purchaseControls.highValuePurchaseThreshold,
            paymentMethod: "gems",
            status: "completed"
          }
        });
      }
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }

      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          error: {
            code: "invalid_json",
            message: "Request body must be valid JSON"
          }
        });
        return;
      }

      if (error instanceof PurchaseLimitExceededError) {
        sendJson(response, 429, {
          error: {
            code: error.name,
            message: error.message,
            limitType: error.limitType,
            resetAt: error.resetAt
          }
        });
        return;
      }

      if (error instanceof Error && error.message === "insufficient gems") {
        if (analyticsPurchaseContext) {
          emitPurchaseFailedEvent({
            ...analyticsPurchaseContext,
            paymentMethod: "gems",
            failureReason: "insufficient_gems"
          });
        }
        sendJson(response, 409, {
          error: {
            code: "insufficient_gems",
            message: error.message
          }
        });
        return;
      }

      if (error instanceof Error && error.message === "equipment inventory full") {
        if (analyticsPurchaseContext) {
          emitPurchaseFailedEvent({
            ...analyticsPurchaseContext,
            paymentMethod: "gems",
            failureReason: "equipment_inventory_full"
          });
        }
        sendJson(response, 409, {
          error: {
            code: "equipment_inventory_full",
            message: error.message
          }
        });
        return;
      }

      if (error instanceof Error && error.message === "player hero archive not found") {
        if (analyticsPurchaseContext) {
          emitPurchaseFailedEvent({
            ...analyticsPurchaseContext,
            paymentMethod: "gems",
            failureReason: "player_hero_archive_not_found"
          });
        }
        sendJson(response, 409, {
          error: {
            code: "player_hero_archive_not_found",
            message: error.message
          }
        });
        return;
      }

      if (error instanceof Error && /must be/.test(error.message)) {
        sendJson(response, 400, { error: toErrorPayload(error) });
        return;
      }

      if (analyticsPurchaseContext) {
        emitPurchaseFailedEvent({
          ...analyticsPurchaseContext,
          paymentMethod: "gems",
          failureReason: error instanceof Error ? error.message : "internal_error"
        });
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/shop/equip", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }
    if (!store?.loadPlayerAccount || !store.savePlayerAccountProgress) {
      sendJson(response, 503, {
        error: {
          code: "shop_persistence_unavailable",
          message: "Cosmetic equips require configured persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        cosmeticId?: CosmeticId | null;
      };
      const cosmeticId = body.cosmeticId?.trim();
      if (!cosmeticId) {
        sendJson(response, 400, {
          error: {
            code: "invalid_cosmetic_id",
            message: "cosmeticId is required"
          }
        });
        return;
      }

      const account = await store.loadPlayerAccount(authSession.playerId);
      if (!account) {
        sendJson(response, 404, {
          error: {
            code: "player_account_not_found",
            message: `Player account not found: ${authSession.playerId}`
          }
        });
        return;
      }

      const nextEquipped = equipOwnedCosmetic(account, cosmeticId);
      const nextAccount = await store.savePlayerAccountProgress(authSession.playerId, {
        cosmeticInventory: normalizeCosmeticInventory(account.cosmeticInventory),
        equippedCosmetics: nextEquipped
      });

      emitAnalyticsEvent("purchase", {
        playerId: authSession.playerId,
        payload: {
          purchaseId: `equip:${cosmeticId}`,
          productId: `equip:${cosmeticId}`,
          quantity: 1,
          totalPrice: 0
        }
      });
      sendJson(response, 200, {
        cosmeticId,
        equippedCosmetics: (nextAccount.equippedCosmetics ?? {}) as EquippedCosmetics
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: toErrorPayload(error) });
        return;
      }

      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          error: {
            code: "invalid_json",
            message: "Request body must be valid JSON"
          }
        });
        return;
      }

      if (error instanceof Error && (error.message === "cosmetic_not_found" || error.message === "cosmetic_not_owned")) {
        sendJson(response, 409, {
          error: {
            code: error.message,
            message: error.message
          }
        });
        return;
      }

      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
