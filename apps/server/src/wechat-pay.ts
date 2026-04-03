import { createCipheriv, createDecipheriv, createSign, createVerify, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { validateAuthSessionFromRequest } from "./auth";
import type { PaymentOrderSnapshot, RoomSnapshotStore } from "./persistence";
import { resolveShopProducts, type RegisterShopRoutesOptions, type ShopProduct } from "./shop";

interface HttpApp {
  use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
  post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
}

interface WechatPayRuntimeConfig {
  appId: string;
  merchantId: string;
  merchantCertificateSerial: string;
  merchantPrivateKey: string;
  platformCertificateSerial: string;
  platformPublicKey: string;
  apiV3Key: string;
  notifyUrl: string;
  transactionsJsapiUrl: string;
}

interface RegisterWechatPayRoutesOptions extends RegisterShopRoutesOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  orderIdGenerator?: () => string;
  runtimeConfig?: WechatPayRuntimeConfig | null;
}

interface WechatPayTransactionsJsapiResponse {
  prepay_id?: string;
}

interface WechatPayCallbackEnvelope {
  id?: string;
  event_type?: string;
  resource_type?: string;
  resource?: {
    algorithm?: string;
    ciphertext?: string;
    nonce?: string;
    associated_data?: string;
  } | null;
}

interface WechatPayCallbackTransaction {
  appid?: string;
  mchid?: string;
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  success_time?: string;
  amount?: {
    total?: number;
  } | null;
  payer?: {
    openid?: string;
  } | null;
}

const MAX_JSON_BODY_BYTES = 64 * 1024;
const SUCCESS_CALLBACK_BODY = { code: "SUCCESS", message: "success" };

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function normalizePemValue(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function readPemValue(env: NodeJS.ProcessEnv, key: string): string | null {
  const direct = env[key]?.trim();
  if (direct) {
    return normalizePemValue(direct);
  }

  const base64Value = env[`${key}_BASE64`]?.trim();
  if (!base64Value) {
    return null;
  }

  return normalizePemValue(Buffer.from(base64Value, "base64").toString("utf8"));
}

function readWechatPayRuntimeConfig(env: NodeJS.ProcessEnv = process.env): WechatPayRuntimeConfig | null {
  const appId = env.VEIL_WECHAT_PAY_APP_ID?.trim();
  const merchantId = env.VEIL_WECHAT_PAY_MERCHANT_ID?.trim();
  const merchantCertificateSerial = env.VEIL_WECHAT_PAY_CERT_SERIAL?.trim();
  const platformCertificateSerial = env.VEIL_WECHAT_PAY_PLATFORM_SERIAL?.trim();
  const apiV3Key = env.VEIL_WECHAT_PAY_API_V3_KEY?.trim();
  const notifyUrl = env.VEIL_WECHAT_PAY_NOTIFY_URL?.trim();
  const merchantPrivateKey = readPemValue(env, "VEIL_WECHAT_PAY_PRIVATE_KEY");
  const platformPublicKey = readPemValue(env, "VEIL_WECHAT_PAY_PLATFORM_PUBLIC_KEY");

  if (
    !appId ||
    !merchantId ||
    !merchantCertificateSerial ||
    !platformCertificateSerial ||
    !apiV3Key ||
    !notifyUrl ||
    !merchantPrivateKey ||
    !platformPublicKey
  ) {
    return null;
  }

  return {
    appId,
    merchantId,
    merchantCertificateSerial,
    merchantPrivateKey,
    platformCertificateSerial,
    platformPublicKey,
    apiV3Key,
    notifyUrl,
    transactionsJsapiUrl: env.VEIL_WECHAT_PAY_TRANSACTIONS_JSAPI_URL?.trim() || "https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi"
  };
}

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "payload_too_large";
  }
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
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

  return Buffer.concat(chunks);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const body = await readRawBody(request);
  return body.byteLength > 0 ? JSON.parse(body.toString("utf8")) : {};
}

function normalizeProductId(productId?: string | null): string {
  const normalized = productId?.trim();
  if (!normalized) {
    throw new Error("productId is required");
  }

  return normalized;
}

function normalizeWechatPayProduct(product: ShopProduct | undefined): ShopProduct & { wechatPriceFen: number; grant: { gems: number } } {
  if (!product) {
    throw new Error("product_not_found");
  }
  if (product.type !== "gem_pack") {
    throw new Error("wechat_pay_requires_gem_pack");
  }
  if (!product.wechatPriceFen || product.wechatPriceFen <= 0) {
    throw new Error("wechat_pay_price_not_configured");
  }
  if (!product.grant.gems || product.grant.gems <= 0) {
    throw new Error("wechat_pay_gem_grant_not_configured");
  }

  return product as ShopProduct & { wechatPriceFen: number; grant: { gems: number } };
}

function randomNonce(): string {
  return randomBytes(16).toString("hex");
}

function signWithMerchantKey(config: WechatPayRuntimeConfig, message: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  signer.end();
  return signer.sign(config.merchantPrivateKey, "base64");
}

function buildWechatAuthorization(
  config: WechatPayRuntimeConfig,
  method: string,
  requestUrl: URL,
  body: string,
  timestamp: string,
  nonce: string
): string {
  const message = `${method}\n${requestUrl.pathname}${requestUrl.search}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = signWithMerchantKey(config, message);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${config.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.merchantCertificateSerial}",signature="${signature}"`;
}

function buildClientPaySign(config: WechatPayRuntimeConfig, timeStamp: string, nonceStr: string, packageValue: string): string {
  return signWithMerchantKey(config, `${config.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`);
}

function verifyWechatCallbackSignature(
  config: WechatPayRuntimeConfig,
  headers: IncomingMessage["headers"],
  body: string
): boolean {
  const signature = headers["wechatpay-signature"];
  const nonce = headers["wechatpay-nonce"];
  const timestamp = headers["wechatpay-timestamp"];
  const serial = headers["wechatpay-serial"];
  if (
    typeof signature !== "string" ||
    typeof nonce !== "string" ||
    typeof timestamp !== "string" ||
    typeof serial !== "string" ||
    serial.trim() !== config.platformCertificateSerial
  ) {
    return false;
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${timestamp}\n${nonce}\n${body}\n`);
  verifier.end();
  return verifier.verify(config.platformPublicKey, signature, "base64");
}

function decryptWechatCallbackResource(config: WechatPayRuntimeConfig, envelope: WechatPayCallbackEnvelope): WechatPayCallbackTransaction {
  const resource = envelope.resource;
  if (
    !resource ||
    resource.algorithm !== "AEAD_AES_256_GCM" ||
    typeof resource.ciphertext !== "string" ||
    typeof resource.nonce !== "string"
  ) {
    throw new Error("invalid_wechat_callback_resource");
  }

  const apiV3Key = Buffer.from(config.apiV3Key, "utf8");
  if (apiV3Key.byteLength !== 32) {
    throw new Error("invalid_wechat_pay_api_v3_key");
  }

  const ciphertext = Buffer.from(resource.ciphertext, "base64");
  const authTag = ciphertext.subarray(ciphertext.byteLength - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.byteLength - 16);
  const decipher = createDecipheriv("aes-256-gcm", apiV3Key, Buffer.from(resource.nonce, "utf8"));
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, "utf8"));
  }
  decipher.setAuthTag(authTag);

  const plainText = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  return JSON.parse(plainText) as WechatPayCallbackTransaction;
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

function sendCallbackResponse(response: ServerResponse, statusCode: number, payload = SUCCESS_CALLBACK_BODY): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function isPaymentStoreReady(store: RoomSnapshotStore | null): store is RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "createPaymentOrder" | "completePaymentOrder" | "loadPaymentOrder">> {
  return Boolean(store?.createPaymentOrder && store.completePaymentOrder && store.loadPaymentOrder);
}

function findProduct(products: ShopProduct[], productId: string): ShopProduct | undefined {
  return products.find((product) => product.productId === productId);
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

function normalizeSuccessTimestamp(value?: string): string {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("invalid_wechat_payment_success_time");
  }
  return parsed.toISOString();
}

export function registerWechatPayRoutes(
  app: HttpApp,
  store: RoomSnapshotStore | null,
  options: RegisterWechatPayRoutesOptions = {}
): void {
  const products = resolveShopProducts(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const orderIdGenerator = options.orderIdGenerator ?? randomUUID;
  const runtimeConfig = options.runtimeConfig ?? readWechatPayRuntimeConfig();

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.post("/api/payments/wechat/create", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }
    if (!runtimeConfig) {
      sendJson(response, 503, {
        error: {
          code: "wechat_pay_not_configured",
          message: "WeChat Pay runtime configuration is incomplete"
        }
      });
      return;
    }
    if (!isPaymentStoreReady(store)) {
      sendJson(response, 503, {
        error: {
          code: "payment_persistence_unavailable",
          message: "Payment orders require configured persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { productId?: string | null };
      const productId = normalizeProductId(body.productId);
      const product = normalizeWechatPayProduct(findProduct(products, productId));
      const account = await store.loadPlayerAccount(authSession.playerId);
      const openId = account?.wechatMiniGameOpenId?.trim();
      if (!openId) {
        sendJson(response, 400, {
          error: {
            code: "wechat_open_id_required",
            message: "Player must bind a WeChat mini-game identity before creating a payment order"
          }
        });
        return;
      }

      const order = await store.createPaymentOrder({
        orderId: orderIdGenerator(),
        playerId: authSession.playerId,
        productId: product.productId,
        amount: product.wechatPriceFen,
        gemAmount: product.grant.gems
      });

      const createdAt = now();
      const payload = {
        appid: runtimeConfig.appId,
        mchid: runtimeConfig.merchantId,
        description: product.name,
        out_trade_no: order.orderId,
        notify_url: runtimeConfig.notifyUrl,
        amount: {
          total: order.amount,
          currency: "CNY"
        },
        payer: {
          openid: openId
        }
      };
      const requestUrl = new URL(runtimeConfig.transactionsJsapiUrl);
      const bodyText = JSON.stringify(payload);
      const timestamp = String(Math.floor(createdAt.getTime() / 1000));
      const nonce = randomNonce();
      const wechatResponse = await fetchImpl(requestUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: buildWechatAuthorization(runtimeConfig, "POST", requestUrl, bodyText, timestamp, nonce)
        },
        body: bodyText
      });
      if (!wechatResponse.ok) {
        const errorText = await wechatResponse.text();
        sendJson(response, 502, {
          error: {
            code: "wechat_order_create_failed",
            message: errorText || "WeChat Pay order creation failed"
          }
        });
        return;
      }

      const wechatPayload = (await wechatResponse.json()) as WechatPayTransactionsJsapiResponse;
      const prepayId = wechatPayload.prepay_id?.trim();
      if (!prepayId) {
        sendJson(response, 502, {
          error: {
            code: "wechat_order_create_invalid_response",
            message: "WeChat Pay response did not include prepay_id"
          }
        });
        return;
      }

      const timeStamp = timestamp;
      const nonceStr = randomNonce();
      const packageValue = `prepay_id=${prepayId}`;
      sendJson(response, 200, {
        orderId: order.orderId,
        timeStamp,
        nonceStr,
        package: packageValue,
        signType: "RSA",
        paySign: buildClientPaySign(runtimeConfig, timeStamp, nonceStr, packageValue)
      });
    } catch (error) {
      sendJson(response, 400, {
        error: {
          code: error instanceof Error ? error.name || "bad_request" : "bad_request",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  });

  app.post("/api/payments/wechat/callback", async (request, response) => {
    if (!runtimeConfig) {
      sendCallbackResponse(response, 503, {
        code: "FAIL",
        message: "WeChat Pay runtime configuration is incomplete"
      });
      return;
    }
    if (!isPaymentStoreReady(store)) {
      sendCallbackResponse(response, 503, {
        code: "FAIL",
        message: "Payment persistence is unavailable"
      });
      return;
    }

    try {
      const rawBody = await readRawBody(request);
      const bodyText = rawBody.toString("utf8");
      if (!verifyWechatCallbackSignature(runtimeConfig, request.headers, bodyText)) {
        sendCallbackResponse(response, 401, {
          code: "FAIL",
          message: "signature verification failed"
        });
        return;
      }

      const envelope = JSON.parse(bodyText) as WechatPayCallbackEnvelope;
      const transaction = decryptWechatCallbackResource(runtimeConfig, envelope);
      if (transaction.trade_state !== "SUCCESS") {
        sendCallbackResponse(response, 400, {
          code: "FAIL",
          message: "unsupported trade state"
        });
        return;
      }

      if (transaction.appid?.trim() !== runtimeConfig.appId || transaction.mchid?.trim() !== runtimeConfig.merchantId) {
        sendCallbackResponse(response, 400, {
          code: "FAIL",
          message: "merchant validation failed"
        });
        return;
      }

      const orderId = transaction.out_trade_no?.trim();
      const wechatOrderId = transaction.transaction_id?.trim();
      if (!orderId || !wechatOrderId) {
        sendCallbackResponse(response, 400, {
          code: "FAIL",
          message: "order identifiers are missing"
        });
        return;
      }

      const order = await store.loadPaymentOrder(orderId);
      if (!order) {
        sendCallbackResponse(response, 404, {
          code: "FAIL",
          message: "payment order not found"
        });
        return;
      }

      if ((transaction.amount?.total ?? 0) !== order.amount) {
        sendCallbackResponse(response, 400, {
          code: "FAIL",
          message: "payment amount mismatch"
        });
        return;
      }

      const account = await store.loadPlayerAccount(order.playerId);
      if (!account?.wechatMiniGameOpenId || transaction.payer?.openid?.trim() !== account.wechatMiniGameOpenId) {
        sendCallbackResponse(response, 400, {
          code: "FAIL",
          message: "payer validation failed"
        });
        return;
      }

      await store.completePaymentOrder(order.orderId, {
        wechatOrderId,
        paidAt: normalizeSuccessTimestamp(transaction.success_time)
      });
      sendCallbackResponse(response, 200);
    } catch (error) {
      sendCallbackResponse(response, 400, {
        code: "FAIL",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

export function encryptWechatCallbackResourceForTest(
  apiV3Key: string,
  plaintext: string,
  nonce: string,
  associatedData = "transaction"
): { ciphertext: string; nonce: string; associated_data: string; algorithm: "AEAD_AES_256_GCM" } {
  const keyBuffer = Buffer.from(apiV3Key, "utf8");
  const encryptedCipher = createCipheriv("aes-256-gcm", keyBuffer, Buffer.from(nonce, "utf8"));
  encryptedCipher.setAAD(Buffer.from(associatedData, "utf8"));
  const encrypted = Buffer.concat([encryptedCipher.update(plaintext, "utf8"), encryptedCipher.final()]);
  const authTag = encryptedCipher.getAuthTag();

  return {
    algorithm: "AEAD_AES_256_GCM",
    nonce,
    associated_data: associatedData,
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64")
  };
}

export function signWechatCallbackForTest(privateKey: string, timestamp: string, nonce: string, body: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(`${timestamp}\n${nonce}\n${body}\n`);
  signer.end();
  return signer.sign(privateKey, "base64");
}

export type { RegisterWechatPayRoutesOptions, WechatPayRuntimeConfig, PaymentOrderSnapshot };
