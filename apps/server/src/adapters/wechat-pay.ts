import { createCipheriv, createDecipheriv, createSign, createVerify, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { emitAnalyticsEvent } from "@server/domain/ops/analytics";
import { validateAuthSessionFromRequest } from "@server/domain/account/auth";
import { recordPaymentGrantRetry } from "@server/domain/ops/observability";
import { timingSafeCompareAdminToken } from "@server/infra/admin-token";
import {
  CallbackDeadLetterQueue,
  buildPaymentGrantRuntimePayload as buildSharedPaymentGrantRuntimePayload,
  normalizePaymentGrantRetryPolicy as normalizeSharedPaymentGrantRetryPolicy,
  refreshPaymentGrantObservability as refreshSharedPaymentGrantObservability
} from "@server/domain/payment/CallbackDeadLetterQueue";
import {
  OrderIdempotencyStore,
  isAcceptedPaymentOrderStatus as isSharedAcceptedPaymentOrderStatus,
  isFinalizedPaymentOrderStatus as isSharedFinalizedPaymentOrderStatus,
  isPaymentRetryOpsStoreReady,
  isPaymentStoreReady as isSharedPaymentStoreReady
} from "@server/domain/payment/OrderIdempotencyStore";
import { handlePaymentRefundNotification } from "@server/domain/payment/PaymentRefundNotifications";
import { PurchaseAuditLog } from "@server/domain/payment/PurchaseAuditLog";
import {
  type PaymentGateway,
  unsupportedPaymentGatewayOperation
} from "@server/domain/payment/PaymentGateway";
import type { PaymentGatewayRegistration, PaymentNotificationHandler } from "@server/domain/payment/PaymentGatewayRegistry";
import type { PaymentOrderSnapshot, RoomSnapshotStore } from "@server/persistence";
import { appendAdminAuditLogIfAvailable } from "@server/domain/ops/admin-audit-log";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import { resolveShopProducts, type RegisterShopRoutesOptions, type ShopProduct, type ShopProductGrant } from "@server/domain/economy/shop";

interface HttpApp {
  use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
  get?: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
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
  transactionsOutTradeNoUrlTemplate: string;
}

interface RegisterWechatPayRoutesOptions extends RegisterShopRoutesOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  orderIdGenerator?: () => string;
  runtimeConfig?: WechatPayRuntimeConfig | null;
  notificationHandler?: (event: WechatPayNotificationEvent) => WechatPayNotificationHandlerResult | Promise<WechatPayNotificationHandlerResult>;
}

interface WechatPayTransactionsJsapiResponse {
  prepay_id?: string;
}

interface WechatPayTransactionQueryResponse {
  appid?: string;
  mchid?: string;
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  success_time?: string;
  amount?: {
    total?: number;
    payer_total?: number;
  } | null;
  payer?: {
    openid?: string;
  } | null;
}

export interface WechatPayCallbackEnvelope {
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

export interface WechatPayRefundCallback {
  mchid?: string;
  transaction_id?: string;
  out_trade_no?: string;
  refund_id?: string;
  out_refund_no?: string;
  refund_status?: string;
  success_time?: string;
}

export interface WechatPayNotificationEvent {
  eventId: string;
  notificationType: string;
  eventTime: string;
  orderId?: string;
  externalRefundId?: string;
  rawPayload: WechatPayCallbackEnvelope;
  resource: WechatPayRefundCallback;
}

export interface WechatPayNotificationHandlerResult {
  status?: "processed" | "ignored" | "duplicate";
}

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_CALLBACK_TIMESTAMP_SKEW_SECONDS = 5 * 60;
const SUCCESS_CALLBACK_BODY = { code: "SUCCESS", message: "success" };
const wechatPurchaseAuditLog = new PurchaseAuditLog({
  surface: "wechat-pay",
  paymentMethod: "wechat_pay",
  defaultRoute: "/api/payments/wechat/verify",
  defaultTags: ["wechat-pay"]
});

function emitPurchaseCompletedEvent(input: {
  playerId: string;
  purchaseId: string;
  productId: string;
  paymentMethod: "gems" | "wechat_pay";
  quantity: number;
  totalPrice: number;
}): void {
  wechatPurchaseAuditLog.emitCompleted(input);
}

function emitPurchaseFailedEvent(input: {
  playerId: string;
  purchaseId: string;
  productId: string;
  paymentMethod: "gems" | "wechat_pay";
  failureReason: string;
  orderStatus: PaymentOrderSnapshot["status"] | "failed";
}): void {
  wechatPurchaseAuditLog.emitFailed(input);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function normalizePemValue(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function readPemValue(env: NodeJS.ProcessEnv, key: string): string | null {
  const direct =
    key === "VEIL_WECHAT_PAY_PRIVATE_KEY" ? readRuntimeSecret("VEIL_WECHAT_PAY_PRIVATE_KEY", env) : env[key]?.trim();
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
  const apiV3Key = readRuntimeSecret("VEIL_WECHAT_PAY_API_V3_KEY", env);
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
    transactionsJsapiUrl: env.VEIL_WECHAT_PAY_TRANSACTIONS_JSAPI_URL?.trim() || "https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi",
    transactionsOutTradeNoUrlTemplate:
      env.VEIL_WECHAT_PAY_TRANSACTIONS_OUT_TRADE_NO_URL_TEMPLATE?.trim() ||
      "https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/{out_trade_no}?mchid={mchid}"
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

function normalizeWechatPayProduct(
  product: ShopProduct | undefined
): ShopProduct & { wechatPriceFen: number; grant: ShopProductGrant } {
  if (!product) {
    throw new Error("product_not_found");
  }
  if (product.type !== "gem_pack" && product.type !== "season_pass_premium") {
    throw new Error("wechat_pay_requires_supported_product");
  }
  if (!product.wechatPriceFen || product.wechatPriceFen <= 0) {
    throw new Error("wechat_pay_price_not_configured");
  }
  if ((product.grant.gems ?? 0) <= 0 && product.grant.seasonPassPremium !== true) {
    throw new Error("wechat_pay_grant_not_configured");
  }

  return product as ShopProduct & { wechatPriceFen: number; grant: ShopProductGrant };
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

function buildWechatTransactionQueryUrl(config: WechatPayRuntimeConfig, orderId: string): URL {
  const template = config.transactionsOutTradeNoUrlTemplate
    .replace("{out_trade_no}", encodeURIComponent(orderId))
    .replace("{mchid}", encodeURIComponent(config.merchantId));
  return new URL(template);
}

function resolveVerifiedPaidAmount(
  amount: WechatPayCallbackTransaction["amount"] | WechatPayTransactionQueryResponse["amount"]
): number {
  const payerTotal = amount && "payer_total" in amount ? amount.payer_total : undefined;
  return Math.max(0, Math.floor(payerTotal ?? amount?.total ?? 0));
}

function normalizeWechatEventType(eventType?: string): string {
  return eventType?.trim().toUpperCase() ?? "";
}

function isWechatRefundEventType(eventType?: string): boolean {
  const normalized = normalizeWechatEventType(eventType);
  return normalized === "REFUND" || normalized === "REFUND.SUCCESS";
}

function emitPaymentFraudSignal(
  playerId: string,
  signal: string,
  payload: {
    orderId: string;
    productId: string;
    [key: string]: unknown;
  },
  route: "/api/payments/wechat/verify" | "/api/payments/wechat/callback"
): void {
  wechatPurchaseAuditLog.emitFraudSignal({
    playerId,
    signal,
    orderId: payload.orderId,
    productId: payload.productId,
    route,
    details: payload
  });
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

function isWechatCallbackTimestampFresh(headers: IncomingMessage["headers"], now: Date): boolean {
  const timestamp = headers["wechatpay-timestamp"];
  if (typeof timestamp !== "string") {
    return false;
  }

  const parsedSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedSeconds)) {
    return false;
  }

  return Math.abs(Math.floor(now.getTime() / 1000) - parsedSeconds) <= MAX_CALLBACK_TIMESTAMP_SKEW_SECONDS;
}

function decryptWechatCallbackResource(config: WechatPayRuntimeConfig, envelope: WechatPayCallbackEnvelope): unknown {
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
  return JSON.parse(plainText) as unknown;
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

function isPaymentStoreReady(store: RoomSnapshotStore | null) {
  return isSharedPaymentStoreReady(store);
}

function isPaymentOpsStoreReady(store: RoomSnapshotStore | null) {
  return isPaymentRetryOpsStoreReady(store);
}

function readRequestIp(request: IncomingMessage): string | undefined {
  const forwardedFor = request.headers["x-forwarded-for"];
  const candidate = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return candidate?.split(",")[0]?.trim() || request.socket?.remoteAddress || undefined;
}

function readAdminToken(): string | null {
  const token = readRuntimeSecret("VEIL_ADMIN_TOKEN");
  return token ? token : null;
}

function isAdminRequest(request: IncomingMessage): boolean {
  const adminToken = readAdminToken();
  return timingSafeCompareAdminToken(request.headers["x-veil-admin-token"], adminToken);
}

function normalizePaymentGrantRetryPolicy(): { maxAttempts: number; baseDelayMs: number } {
  return normalizeSharedPaymentGrantRetryPolicy();
}

function isFinalizedPaymentOrderStatus(status: PaymentOrderSnapshot["status"]): boolean {
  return isSharedFinalizedPaymentOrderStatus(status);
}

function isAcceptedPaymentOrderStatus(status: PaymentOrderSnapshot["status"]): boolean {
  return isSharedAcceptedPaymentOrderStatus(status);
}

async function refreshPaymentGrantObservability(store: RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listPaymentOrders">>, now: Date) {
  return refreshSharedPaymentGrantObservability(store, now);
}

async function buildPaymentGrantRuntimePayload(
  store: RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listPaymentOrders">>,
  now: Date
) {
  return buildSharedPaymentGrantRuntimePayload(store, now);
}

function findProduct(products: ShopProduct[], productId: string): ShopProduct | undefined {
  return products.find((product) => product.productId === productId);
}

function resolvePaymentGrantRetryPayload(
  products: ShopProduct[],
  order: Pick<PaymentOrderSnapshot, "productId" | "gemAmount">
): { productName: string; grant: ShopProductGrant } {
  const product = findProduct(products, order.productId);
  if (product) {
    const normalizedProduct = normalizeWechatPayProduct(product);
    return {
      productName: normalizedProduct.name,
      grant: normalizedProduct.grant
    };
  }

  return {
    productName: order.productId,
    grant: {
      gems: order.gemAmount
    }
  };
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

async function queryWechatPaymentByOutTradeNo(
  config: WechatPayRuntimeConfig,
  fetchImpl: typeof fetch,
  now: () => Date,
  orderId: string
): Promise<WechatPayTransactionQueryResponse> {
  const requestUrl = buildWechatTransactionQueryUrl(config, orderId);
  const timestamp = String(Math.floor(now().getTime() / 1000));
  const nonce = randomNonce();
  const response = await fetchImpl(requestUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: buildWechatAuthorization(config, "GET", requestUrl, "", timestamp, nonce)
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "wechat_order_query_failed");
  }

  return (await response.json()) as WechatPayTransactionQueryResponse;
}

async function verifyPaymentReceipt(input: {
  config: WechatPayRuntimeConfig;
  fetchImpl: typeof fetch;
  now: () => Date;
  order: PaymentOrderSnapshot;
}): Promise<Required<Pick<WechatPayTransactionQueryResponse, "transaction_id" | "success_time">> &
  WechatPayTransactionQueryResponse & { paidAmount: number; payerOpenId: string }> {
  const transaction = await queryWechatPaymentByOutTradeNo(input.config, input.fetchImpl, input.now, input.order.orderId);
  if (transaction.trade_state !== "SUCCESS") {
    throw new Error("wechat_payment_not_success");
  }
  if (
    transaction.appid?.trim() !== input.config.appId ||
    transaction.mchid?.trim() !== input.config.merchantId ||
    transaction.out_trade_no?.trim() !== input.order.orderId
  ) {
    throw new Error("wechat_payment_identity_mismatch");
  }

  const transactionId = transaction.transaction_id?.trim();
  if (!transactionId) {
    throw new Error("wechat_payment_transaction_id_missing");
  }

  const payerOpenId = transaction.payer?.openid?.trim() || "";
  const paidAmount = resolveVerifiedPaidAmount(transaction.amount);
  if (paidAmount !== input.order.amount) {
    throw new Error("wechat_payment_amount_mismatch");
  }
  if (!payerOpenId) {
    throw new Error("wechat_payment_openid_missing");
  }

  return {
    ...transaction,
    transaction_id: transactionId,
    success_time: normalizeSuccessTimestamp(transaction.success_time),
    paidAmount,
    payerOpenId
  };
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
  const notificationHandler = options.notificationHandler ?? null;

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
    const paymentStore = new OrderIdempotencyStore(store);

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

      const order = await paymentStore.createOrder({
        orderId: orderIdGenerator(),
        playerId: authSession.playerId,
        productId: product.productId,
        amount: product.wechatPriceFen,
        gemAmount: product.grant.gems ?? 0
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

  app.post("/api/payments/wechat/verify", async (request, response) => {
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
          message: "Payment verification requires configured persistence storage"
        }
      });
      return;
    }
    const paymentStore = new OrderIdempotencyStore(store);

    let order: PaymentOrderSnapshot | null = null;
    try {
      const body = (await readJsonBody(request)) as { orderId?: string | null };
      const orderId = body.orderId?.trim();
      if (!orderId) {
        sendJson(response, 400, {
          error: {
            code: "invalid_order_id",
            message: "orderId is required"
          }
        });
        return;
      }

      order = await paymentStore.loadOrder(orderId);
      if (!order || order.playerId !== authSession.playerId) {
        sendJson(response, 404, {
          error: {
            code: "payment_order_not_found",
            message: "Payment order was not found"
          }
        });
        return;
      }

      const existingReceipt = await paymentStore.loadReceiptByOrderId(order.orderId);
      if (isAcceptedPaymentOrderStatus(order.status) || existingReceipt) {
        emitPaymentFraudSignal(order.playerId, "duplicate_out_trade_no", {
          orderId: order.orderId,
          productId: order.productId
        }, "/api/payments/wechat/verify");
        sendJson(response, 409, {
          error: {
            code: "payment_already_verified",
            message: "Payment order has already been verified"
          }
        });
        return;
      }

      const product = normalizeWechatPayProduct(findProduct(products, order.productId));
      const account = await store.loadPlayerAccount(order.playerId);
      const expectedOpenId = account?.wechatMiniGameOpenId?.trim();
      if (!expectedOpenId) {
        sendJson(response, 400, {
          error: {
            code: "wechat_open_id_required",
            message: "Player must bind a WeChat mini-game identity before verifying a payment order"
          }
        });
        return;
      }

      const verified = await verifyPaymentReceipt({
        config: runtimeConfig,
        fetchImpl,
        now,
        order
      });
      if (verified.payerOpenId !== expectedOpenId) {
        emitPaymentFraudSignal(order.playerId, "openid_mismatch", {
          orderId: order.orderId,
          productId: order.productId,
          expectedOpenId,
          receivedOpenId: verified.payerOpenId,
          transactionId: verified.transaction_id
        }, "/api/payments/wechat/verify");
        sendJson(response, 409, {
          error: {
            code: "wechat_payment_openid_mismatch",
            message: "wechat_payment_openid_mismatch"
          }
        });
        return;
      }

      const settlement = await paymentStore.completeOrder(order.orderId, {
        wechatOrderId: verified.transaction_id,
        paidAt: verified.success_time,
        verifiedAt: now().toISOString(),
        productName: product.name,
        grant: product.grant,
        retryPolicy: normalizePaymentGrantRetryPolicy()
      });
      const deadLetterQueue = new CallbackDeadLetterQueue(isPaymentOpsStoreReady(store) ? store : null, now);
      deadLetterQueue.recordSettlement(settlement.order);
      if (isPaymentOpsStoreReady(store)) {
        await deadLetterQueue.refresh();
      }
      if (!settlement.credited) {
        emitPurchaseFailedEvent({
          playerId: order.playerId,
          purchaseId: order.orderId,
          productId: order.productId,
          paymentMethod: "wechat_pay",
          failureReason: settlement.order.lastGrantError ?? "grant_failed",
          orderStatus: settlement.order.status
        });
      }
      if (!settlement.credited && isFinalizedPaymentOrderStatus(settlement.order.status)) {
        emitPaymentFraudSignal(order.playerId, "duplicate_out_trade_no", {
          orderId: order.orderId,
          productId: order.productId,
          transactionId: verified.transaction_id
        }, "/api/payments/wechat/verify");
        sendJson(response, 409, {
          error: {
            code: "payment_already_verified",
            message: "Payment order has already been verified"
          }
        });
        return;
      }

      emitAnalyticsEvent("purchase", {
        playerId: order.playerId,
        payload: {
          purchaseId: order.orderId,
          productId: order.productId,
          quantity: 1,
          totalPrice: order.amount
        }
      });
      if (settlement.credited) {
        emitPurchaseCompletedEvent({
          playerId: order.playerId,
          purchaseId: order.orderId,
          productId: order.productId,
          paymentMethod: "wechat_pay",
          quantity: 1,
          totalPrice: order.amount
        });
      }

      const recentVerifiedCount = await paymentStore.countVerifiedReceiptsSince(
        order.playerId,
        new Date(now().getTime() - 60_000).toISOString()
      );
      if (recentVerifiedCount > 3) {
        emitPaymentFraudSignal(order.playerId, "high_velocity_purchases", {
          orderId: order.orderId,
          productId: order.productId,
          recentVerifiedCount
        }, "/api/payments/wechat/verify");
      }

      sendJson(response, 200, {
        orderId: settlement.order.orderId,
        status: settlement.order.status,
        credited: settlement.credited,
        paidAt: settlement.order.paidAt,
        ...(settlement.order.nextGrantRetryAt ? { nextGrantRetryAt: settlement.order.nextGrantRetryAt } : {}),
        ...(settlement.order.lastGrantError ? { lastGrantError: settlement.order.lastGrantError } : {}),
        gemsBalance: settlement.account.gems ?? 0,
        seasonPassPremium: settlement.account.seasonPassPremium === true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        message === "wechat_payment_not_success"
          ? 409
          : message === "wechat_payment_amount_mismatch"
            ? 400
            : message === "wechat_payment_identity_mismatch" ||
                message === "wechat_payment_openid_missing" ||
                message === "wechat_payment_openid_mismatch"
              ? 400
              : 502;
      if (message === "wechat_payment_amount_mismatch" && order) {
        emitPaymentFraudSignal(order.playerId, "amount_mismatch", {
          orderId: order.orderId,
          productId: order.productId,
          expectedAmount: order.amount
        }, "/api/payments/wechat/verify");
      }
      sendJson(response, statusCode, {
        error: {
          code: message,
          message
        }
      });
    }
  });

  const handleWechatCallbackRequest = async (request: IncomingMessage, response: ServerResponse) => {
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
    const paymentStore = new OrderIdempotencyStore(store);

    try {
      const rawBody = await readRawBody(request);
      const bodyText = rawBody.toString("utf8");
      if (!isWechatCallbackTimestampFresh(request.headers, now())) {
        sendCallbackResponse(response, 401, {
          code: "FAIL",
          message: "callback timestamp is outside the allowed replay window"
        });
        return;
      }
      if (!verifyWechatCallbackSignature(runtimeConfig, request.headers, bodyText)) {
        sendCallbackResponse(response, 401, {
          code: "FAIL",
          message: "signature verification failed"
        });
        return;
      }

      const envelope = JSON.parse(bodyText) as WechatPayCallbackEnvelope;
      const callbackResource = decryptWechatCallbackResource(runtimeConfig, envelope);
      const callbackEventType = normalizeWechatEventType(envelope.event_type);
      if (isWechatRefundEventType(callbackEventType)) {
        const refund = callbackResource as WechatPayRefundCallback;
        if (refund.mchid?.trim() !== runtimeConfig.merchantId) {
          sendCallbackResponse(response, 400, {
            code: "FAIL",
            message: "merchant validation failed"
          });
          return;
        }
        if (refund.refund_status && refund.refund_status.trim().toUpperCase() !== "SUCCESS") {
          sendCallbackResponse(response, 200);
          return;
        }
        const orderId = refund.out_trade_no?.trim();
        if (!orderId) {
          sendCallbackResponse(response, 400, {
            code: "FAIL",
            message: "order identifiers are missing"
          });
          return;
        }
        const eventTime =
          refund.success_time && !Number.isNaN(new Date(refund.success_time).getTime())
            ? new Date(refund.success_time).toISOString()
            : now().toISOString();
        if (notificationHandler) {
          const externalRefundId = refund.refund_id?.trim() || refund.out_refund_no?.trim();
          await notificationHandler({
            eventId: envelope.id?.trim() || `wechat-refund:${orderId}:${refund.refund_id ?? refund.out_refund_no ?? eventTime}`,
            notificationType: callbackEventType,
            eventTime,
            orderId,
            ...(externalRefundId ? { externalRefundId } : {}),
            rawPayload: envelope,
            resource: refund
          });
        }
        sendCallbackResponse(response, 200);
        return;
      }

      const transaction = callbackResource as WechatPayCallbackTransaction;
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
      if (!orderId) {
        sendCallbackResponse(response, 400, {
          code: "FAIL",
          message: "order identifiers are missing"
        });
        return;
      }

      const order = await paymentStore.loadOrder(orderId);
      if (!order) {
        sendCallbackResponse(response, 404, {
          code: "FAIL",
          message: "payment order not found"
        });
        return;
      }

      const account = await store.loadPlayerAccount(order.playerId);
      const expectedOpenId = account?.wechatMiniGameOpenId?.trim();
      if (!expectedOpenId) {
        sendCallbackResponse(response, 400, {
          code: "FAIL",
          message: "payer validation failed"
        });
        return;
      }

      const existingReceipt = await paymentStore.loadReceiptByOrderId(order.orderId);
      if (isAcceptedPaymentOrderStatus(order.status) || existingReceipt) {
        emitPaymentFraudSignal(order.playerId, "duplicate_out_trade_no", {
          orderId: order.orderId,
          productId: order.productId
        }, "/api/payments/wechat/callback");
        sendCallbackResponse(response, 200);
        return;
      }

      const product = normalizeWechatPayProduct(findProduct(products, order.productId));
      const verified = await verifyPaymentReceipt({
        config: runtimeConfig,
        fetchImpl,
        now,
        order
      });
      if (verified.payerOpenId !== expectedOpenId || transaction.payer?.openid?.trim() !== expectedOpenId) {
        emitPaymentFraudSignal(order.playerId, "openid_mismatch", {
          orderId: order.orderId,
          productId: order.productId,
          expectedOpenId,
          callbackOpenId: transaction.payer?.openid?.trim() || "",
          verifiedOpenId: verified.payerOpenId
        }, "/api/payments/wechat/callback");
        sendCallbackResponse(response, 200);
        return;
      }

      if (resolveVerifiedPaidAmount(transaction.amount) !== order.amount) {
        emitPaymentFraudSignal(order.playerId, "amount_mismatch", {
          orderId: order.orderId,
          productId: order.productId,
          expectedAmount: order.amount,
          receivedAmount: resolveVerifiedPaidAmount(transaction.amount)
        }, "/api/payments/wechat/callback");
      }

      const settlement = await paymentStore.completeOrder(order.orderId, {
        wechatOrderId: verified.transaction_id,
        paidAt: verified.success_time,
        verifiedAt: now().toISOString(),
        productName: product.name,
        grant: product.grant,
        retryPolicy: normalizePaymentGrantRetryPolicy()
      });
      const deadLetterQueue = new CallbackDeadLetterQueue(isPaymentOpsStoreReady(store) ? store : null, now);
      deadLetterQueue.recordSettlement(settlement.order);
      if (isPaymentOpsStoreReady(store)) {
        await deadLetterQueue.refresh();
      }
      if (settlement.credited) {
        emitAnalyticsEvent("purchase", {
          playerId: order.playerId,
          payload: {
            purchaseId: order.orderId,
            productId: order.productId,
            quantity: 1,
            totalPrice: order.amount
          }
        });
        emitPurchaseCompletedEvent({
          playerId: order.playerId,
          purchaseId: order.orderId,
          productId: order.productId,
          paymentMethod: "wechat_pay",
          quantity: 1,
          totalPrice: order.amount
        });
      } else {
        emitPurchaseFailedEvent({
          playerId: order.playerId,
          purchaseId: order.orderId,
          productId: order.productId,
          paymentMethod: "wechat_pay",
          failureReason: settlement.order.lastGrantError ?? "grant_failed",
          orderStatus: settlement.order.status
        });
      }
      sendCallbackResponse(response, 200);
    } catch (error) {
      sendCallbackResponse(response, 400, {
        code: "FAIL",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  app.post("/api/payments/wechat/callback", handleWechatCallbackRequest);
  app.post("/api/payment/wechat/notification", handleWechatCallbackRequest);

  if (app.get) {
    app.get("/api/runtime/wechat-payment-grants", async (request, response) => {
      const adminToken = readAdminToken();
      if (!adminToken) {
        sendJson(response, 503, { error: { code: "admin_token_not_configured", message: "VEIL_ADMIN_TOKEN is not configured" } });
        return;
      }
      if (!isAdminRequest(request)) {
        sendJson(response, 403, { error: { code: "forbidden", message: "Invalid admin token" } });
        return;
      }
      if (!isPaymentOpsStoreReady(store)) {
        sendJson(response, 503, {
          error: {
            code: "payment_persistence_unavailable",
            message: "Payment grant queue visibility requires configured persistence storage"
          }
        });
        return;
      }

      try {
        sendJson(response, 200, await buildPaymentGrantRuntimePayload(store, now()));
      } catch (error) {
        sendJson(response, 500, {
          error: {
            code: "wechat_payment_grant_runtime_unavailable",
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }
    });

    app.get("/api/admin/payments/wechat/orders", async (request, response) => {
      const adminToken = readAdminToken();
      if (!adminToken) {
        sendJson(response, 503, { error: { code: "admin_token_not_configured", message: "VEIL_ADMIN_TOKEN is not configured" } });
        return;
      }
      if (!isAdminRequest(request)) {
        sendJson(response, 403, { error: { code: "forbidden", message: "Invalid admin token" } });
        return;
      }
      if (!isPaymentOpsStoreReady(store)) {
        sendJson(response, 503, {
          error: {
            code: "payment_persistence_unavailable",
            message: "Payment grant queue inspection requires configured persistence storage"
          }
        });
        return;
      }

      try {
        const url = new URL(request.url ?? "/api/admin/payments/wechat/orders", "http://runtime.local");
        const rawStatuses = url.searchParams
          .get("status")
          ?.split(",")
          .map((value) => value.trim())
          .filter((value): value is PaymentOrderSnapshot["status"] =>
            value === "created" || value === "paid" || value === "grant_pending" || value === "settled" || value === "dead_letter"
          );
        const limit = Math.max(1, Math.min(200, Math.floor(Number(url.searchParams.get("limit") ?? "50"))));
        const orders = await store.listPaymentOrders({
          ...(rawStatuses && rawStatuses.length > 0 ? { statuses: rawStatuses } : {}),
          limit
        });
        await refreshPaymentGrantObservability(store, now());
        sendJson(response, 200, {
          checkedAt: now().toISOString(),
          count: orders.length,
          items: orders
        });
      } catch (error) {
        sendJson(response, 500, {
          error: {
            code: "wechat_payment_order_list_failed",
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }
    });
  }

  app.post("/api/admin/payments/wechat/retry", async (request, response) => {
    const adminToken = readAdminToken();
    if (!adminToken) {
      sendJson(response, 503, { error: { code: "admin_token_not_configured", message: "VEIL_ADMIN_TOKEN is not configured" } });
      return;
    }
    if (!isAdminRequest(request)) {
      sendJson(response, 403, { error: { code: "forbidden", message: "Invalid admin token" } });
      return;
    }
    if (!isPaymentStoreReady(store) || !isPaymentOpsStoreReady(store)) {
      sendJson(response, 503, {
        error: {
          code: "payment_persistence_unavailable",
          message: "Payment grant retries require configured persistence storage"
        }
      });
      return;
    }

    try {
      const body = (await readJsonBody(request)) as {
        orderId?: string | null;
        limit?: number;
        includeDeadLetter?: boolean;
      };
      const processedAt = now();
      const retryPolicy = normalizePaymentGrantRetryPolicy();

      if (body.orderId?.trim()) {
        const currentOrder = await store.loadPaymentOrder(body.orderId);
        if (!currentOrder) {
          sendJson(response, 404, {
            error: {
              code: "payment_order_not_found",
              message: "Payment order was not found"
            }
          });
          return;
        }

        const retryPayload = resolvePaymentGrantRetryPayload(products, currentOrder);
        recordPaymentGrantRetry();
        const settlement = await store.retryPaymentOrderGrant(currentOrder.orderId, {
          ...retryPayload,
          retriedAt: processedAt.toISOString(),
          retryPolicy,
          allowDeadLetter: body.includeDeadLetter === true
        });
        new CallbackDeadLetterQueue(isPaymentOpsStoreReady(store) ? store : null, () => processedAt).recordDeadLetterTransition(
          currentOrder.status,
          settlement.order.status
        );
        if (settlement.credited) {
          emitAnalyticsEvent("purchase", {
            playerId: settlement.order.playerId,
            payload: {
              purchaseId: settlement.order.orderId,
              productId: settlement.order.productId,
              quantity: 1,
              totalPrice: settlement.order.amount
            }
          });
          emitPurchaseCompletedEvent({
            playerId: settlement.order.playerId,
            purchaseId: settlement.order.orderId,
            productId: settlement.order.productId,
            paymentMethod: "wechat_pay",
            quantity: 1,
            totalPrice: settlement.order.amount
          });
        } else {
          emitPurchaseFailedEvent({
            playerId: settlement.order.playerId,
            purchaseId: settlement.order.orderId,
            productId: settlement.order.productId,
            paymentMethod: "wechat_pay",
            failureReason: settlement.order.lastGrantError ?? "grant_failed",
            orderStatus: settlement.order.status
          });
        }
        await appendAdminAuditLogIfAvailable(store, {
          actorPlayerId: "admin:wechat-pay",
          actorRole: "admin",
          action: "wechat_payment_retry",
          targetPlayerId: settlement.order.playerId,
          targetScope: "payment-order",
          summary: `Manually retried wechat payment ${settlement.order.orderId}`,
          beforeJson: JSON.stringify(currentOrder),
          afterJson: JSON.stringify(settlement.order),
          metadataJson: JSON.stringify({
            orderId: settlement.order.orderId,
            productId: settlement.order.productId,
            amount: settlement.order.amount,
            previousStatus: currentOrder.status,
            nextStatus: settlement.order.status,
            credited: settlement.credited,
            includeDeadLetter: body.includeDeadLetter === true,
            requestIp: readRequestIp(request)
          }),
          occurredAt: processedAt.toISOString()
        });
        await refreshPaymentGrantObservability(store, processedAt);
        sendJson(response, 200, {
          processedAt: processedAt.toISOString(),
          retried: 1,
          order: settlement.order,
          credited: settlement.credited
        });
        return;
      }

      const limit = Math.max(1, Math.min(100, Math.floor(body.limit ?? 20)));
      const dueOrders = await store.listPaymentOrders({
        statuses: ["grant_pending"],
        dueBefore: processedAt.toISOString(),
        limit
      });
      const results: Array<{
        orderId: string;
        status: PaymentOrderSnapshot["status"];
        credited: boolean;
        error?: string;
      }> = [];

      for (const pendingOrder of dueOrders) {
        try {
          const retryPayload = resolvePaymentGrantRetryPayload(products, pendingOrder);
          recordPaymentGrantRetry();
          const settlement = await store.retryPaymentOrderGrant(pendingOrder.orderId, {
            ...retryPayload,
            retriedAt: processedAt.toISOString(),
            retryPolicy
          });
          new CallbackDeadLetterQueue(isPaymentOpsStoreReady(store) ? store : null, () => processedAt).recordDeadLetterTransition(
            pendingOrder.status,
            settlement.order.status
          );
          if (settlement.credited) {
            emitAnalyticsEvent("purchase", {
              playerId: settlement.order.playerId,
              payload: {
                purchaseId: settlement.order.orderId,
                productId: settlement.order.productId,
                quantity: 1,
                totalPrice: settlement.order.amount
              }
            });
            emitPurchaseCompletedEvent({
              playerId: settlement.order.playerId,
              purchaseId: settlement.order.orderId,
              productId: settlement.order.productId,
              paymentMethod: "wechat_pay",
              quantity: 1,
              totalPrice: settlement.order.amount
            });
          } else {
            emitPurchaseFailedEvent({
              playerId: settlement.order.playerId,
              purchaseId: settlement.order.orderId,
              productId: settlement.order.productId,
              paymentMethod: "wechat_pay",
              failureReason: settlement.order.lastGrantError ?? "grant_failed",
              orderStatus: settlement.order.status
            });
          }
          results.push({
            orderId: settlement.order.orderId,
            status: settlement.order.status,
            credited: settlement.credited
          });
        } catch (error) {
          results.push({
            orderId: pendingOrder.orderId,
            status: pendingOrder.status,
            credited: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: "admin:wechat-pay",
        actorRole: "admin",
        action: "wechat_payment_retry_batch",
        targetScope: "payment-order",
        summary: `Manually retried ${results.length} queued wechat payment grant(s)`,
        metadataJson: JSON.stringify({
          limit,
          includeDeadLetter: body.includeDeadLetter === true,
          requestIp: readRequestIp(request),
          results
        }),
        occurredAt: processedAt.toISOString()
      });
      await refreshPaymentGrantObservability(store, processedAt);
      sendJson(response, 200, {
        processedAt: processedAt.toISOString(),
        retried: results.length,
        items: results
      });
    } catch (error) {
      sendJson(response, 400, {
        error: {
          code: "wechat_payment_retry_failed",
          message: error instanceof Error ? error.message : String(error)
        }
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

const wechatPaymentGateway: PaymentGateway = {
  channel: "wechat",
  supportedOperations: ["createOrder", "verifyCallback", "grantRewards"],
  createOrder: (input) =>
    unsupportedPaymentGatewayOperation(
      "wechat",
      "createOrder",
      `Use the WeChat route adapter to create runtime-bound JSAPI orders for ${input.productId}.`
    ),
  verifyCallback: () =>
    unsupportedPaymentGatewayOperation(
      "wechat",
      "verifyCallback",
      "Use the WeChat route adapter to verify callback envelopes with request headers and runtime keys."
    ),
  grantRewards: () =>
    unsupportedPaymentGatewayOperation(
      "wechat",
      "grantRewards",
      "Use the WeChat route adapter to settle verified orders against persistence and grant queues."
    ),
  issueRefund: () =>
    unsupportedPaymentGatewayOperation("wechat", "issueRefund", "WeChat refunds are not implemented in the current server runtime.")
};

const wechatPaymentNotificationHandler: PaymentNotificationHandler<WechatPayNotificationEvent> = (store, event) =>
  handlePaymentRefundNotification(store, {
    channel: "wechat",
    notificationType: event.notificationType,
    ...(event.orderId ? { orderId: event.orderId } : {}),
    eventId: event.eventId,
    eventTime: event.eventTime,
    ...(event.externalRefundId ? { externalRefundId: event.externalRefundId } : {})
  });

export const wechatPaymentGatewayRegistration: PaymentGatewayRegistration<WechatPayNotificationEvent> = {
  gateway: wechatPaymentGateway,
  notificationHandler: wechatPaymentNotificationHandler,
  registerRoutes: (app, store) =>
    registerWechatPayRoutes(app as HttpApp, store, {
      notificationHandler: (event) => wechatPaymentNotificationHandler(store, event)
    })
};

export type { RegisterWechatPayRoutesOptions, WechatPayRuntimeConfig, PaymentOrderSnapshot };
