import type { IncomingMessage, ServerResponse } from "node:http";
import shopConfigDocument from "../../../configs/shop-config.json";
import { getEquipmentDefinition, type ResourceLedger, type SeasonRewardConfig } from "../../../packages/shared/src/index";
import { validateAuthSessionFromRequest } from "./auth";
import type { RoomSnapshotStore } from "./persistence";
import { normalizeSeasonRewardConfig, type ResolvedSeasonRewardConfig } from "./season-rewards";

export type ShopProductType = "gem_pack" | "equipment" | "resource_bundle";

export interface ShopProductGrant {
  gems?: number;
  resources?: Partial<ResourceLedger>;
  equipmentIds?: string[];
}

export interface ShopProduct {
  productId: string;
  name: string;
  type: ShopProductType;
  price: number;
  wechatPriceFen?: number;
  enabled: boolean;
  grant: ShopProductGrant;
}

interface ShopConfigDocument {
  products?: Partial<ShopProduct>[] | null;
  seasonRewards?: Partial<SeasonRewardConfig> | null;
}

export interface RegisterShopRoutesOptions {
  products?: Partial<ShopProduct>[];
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

function normalizePositiveInteger(value: number, field: string, allowZero = false): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || (!allowZero && normalized <= 0) || (allowZero && normalized < 0)) {
    throw new Error(`${field} must be a ${allowZero ? "non-negative" : "positive"} integer`);
  }

  return normalized;
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

  return {
    ...(rawGrant?.gems != null ? { gems: normalizePositiveInteger(rawGrant.gems, "grant.gems", true) } : {}),
    ...(equipmentIds.length > 0 ? { equipmentIds } : {}),
    ...(rawGrant?.resources ? { resources: normalizeResourceLedger(rawGrant.resources) } : {})
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

    if (rawProduct.type !== "gem_pack" && rawProduct.type !== "equipment" && rawProduct.type !== "resource_bundle") {
      throw new Error(`shop product ${productId} type must be gem_pack, equipment, or resource_bundle`);
    }

    const grant = normalizeGrant(rawProduct.grant);
    const hasGrant =
      (grant.gems ?? 0) > 0 ||
      (grant.equipmentIds?.length ?? 0) > 0 ||
      ((grant.resources?.gold ?? 0) > 0 || (grant.resources?.wood ?? 0) > 0 || (grant.resources?.ore ?? 0) > 0);
    if (!hasGrant) {
      throw new Error(`shop product ${productId} grant must not be empty`);
    }

    if (rawProduct.type === "equipment" && (grant.equipmentIds?.length ?? 0) === 0) {
      throw new Error(`shop product ${productId} equipment grants must include equipmentIds`);
    }
    if (rawProduct.type === "resource_bundle" && !grant.resources) {
      throw new Error(`shop product ${productId} resource bundles must include resources`);
    }
    if (rawProduct.type === "gem_pack" && (grant.gems ?? 0) <= 0) {
      throw new Error(`shop product ${productId} gem packs must include gems`);
    }

    return {
      productId,
      name,
      type: rawProduct.type,
      price: normalizePositiveInteger(rawProduct.price ?? Number.NaN, `shop product ${productId} price`, true),
      ...(rawProduct.wechatPriceFen != null
        ? { wechatPriceFen: normalizePositiveInteger(rawProduct.wechatPriceFen, `shop product ${productId} wechatPriceFen`) }
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

export function resolveSeasonRewardsConfig(): ResolvedSeasonRewardConfig {
  return normalizeSeasonRewardConfig((shopConfigDocument as ShopConfigDocument).seasonRewards);
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

export function registerShopRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null,
  options: RegisterShopRoutesOptions = {}
): void {
  const products = resolveShopProducts(options);

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
    sendJson(response, 200, {
      items: products.filter((product) => product.enabled)
    });
  });

  app.post("/api/shop/purchase", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store?.purchaseShopProduct) {
      sendJson(response, 503, {
        error: {
          code: "shop_persistence_unavailable",
          message: "Shop purchases require configured room persistence storage"
        }
      });
      return;
    }

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

      const product = findProductById(products, productId);
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

      const result = await store.purchaseShopProduct(authSession.playerId, {
        purchaseId,
        productId: product.productId,
        productName: product.name,
        quantity,
        unitPrice: product.price,
        grant: product.grant
      });
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

      if (error instanceof Error && error.message === "insufficient gems") {
        sendJson(response, 409, {
          error: {
            code: "insufficient_gems",
            message: error.message
          }
        });
        return;
      }

      if (error instanceof Error && error.message === "equipment inventory full") {
        sendJson(response, 409, {
          error: {
            code: "equipment_inventory_full",
            message: error.message
          }
        });
        return;
      }

      if (error instanceof Error && error.message === "player hero archive not found") {
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

      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
