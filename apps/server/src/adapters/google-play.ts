import { createHash, createSign, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { emitAnalyticsEvent } from "@server/domain/ops/analytics";
import { validateAuthSessionFromRequest } from "@server/domain/account/auth";
import { recordRuntimeErrorEvent } from "@server/domain/ops/observability";
import {
  CallbackDeadLetterQueue,
  normalizePaymentGrantRetryPolicy as normalizeSharedPaymentGrantRetryPolicy,
  refreshPaymentGrantObservability as refreshSharedPaymentGrantObservability
} from "@server/domain/payment/CallbackDeadLetterQueue";
import {
  OrderIdempotencyStore,
  isAcceptedPaymentOrderStatus as isSharedAcceptedPaymentOrderStatus,
  isFinalizedPaymentOrderStatus as isSharedFinalizedPaymentOrderStatus,
  isPaymentOpsStoreReady as isSharedPaymentOpsStoreReady,
  isPaymentStoreReady as isSharedPaymentStoreReady
} from "@server/domain/payment/OrderIdempotencyStore";
import { handlePaymentRefundNotification } from "@server/domain/payment/PaymentRefundNotifications";
import { PurchaseAuditLog } from "@server/domain/payment/PurchaseAuditLog";
import { type PaymentGateway, unsupportedPaymentGatewayOperation } from "@server/domain/payment/PaymentGateway";
import type { PaymentGatewayRegistration, PaymentNotificationHandler } from "@server/domain/payment/PaymentGatewayRegistry";
import type { PaymentOrderSnapshot, RoomSnapshotStore } from "@server/persistence";
import { resolveShopProducts, type RegisterShopRoutesOptions, type ShopProduct, type ShopProductGrant } from "@server/domain/economy/shop";

interface HttpApp {
  use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
  post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
}

export interface GooglePlayBillingRuntimeConfig {
  packageName: string;
  serviceAccountEmail: string;
  privateKey: string;
  oauthTokenUrl: string;
  androidPublisherApiUrl: string;
  rtdnSharedSecret?: string | null;
  rtdnAudience?: string | null;
  rtdnServiceAccountEmail?: string | null;
  rtdnTokenInfoUrl?: string;
}

export interface GoogleVerifiedProductPurchase {
  orderId: string;
  purchaseToken: string;
  productId: string;
  packageName: string;
  purchaseDate: string;
  environment: "Production" | "Test";
  acknowledgementState: 0 | 1;
  consumptionState: 0 | 1;
}

export interface GooglePlayBillingVerificationErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  statusCode: number;
  category: "invalid_request" | "verification" | "configuration" | "upstream";
}

export class GooglePlayBillingVerificationError extends Error {
  readonly retryable: boolean;
  readonly statusCode: number;
  readonly category: GooglePlayBillingVerificationErrorShape["category"];

  constructor(input: GooglePlayBillingVerificationErrorShape) {
    super(input.message);
    this.name = input.code;
    this.retryable = input.retryable;
    this.statusCode = input.statusCode;
    this.category = input.category;
  }

  toResponseBody() {
    return {
      error: {
        code: this.name,
        message: this.message,
        retryable: this.retryable,
        category: this.category
      }
    };
  }
}

export interface GooglePlayBillingVerificationAdapter {
  verifyProductPurchase(input: { packageName: string; productId: string; purchaseToken: string }): Promise<GoogleVerifiedProductPurchase>;
  acknowledgeProductPurchase(input: { packageName: string; productId: string; purchaseToken: string; developerPayload?: string }): Promise<void>;
  consumeProductPurchase(input: { packageName: string; productId: string; purchaseToken: string }): Promise<void>;
}

interface RegisterGooglePlayRoutesOptions extends RegisterShopRoutesOptions {
  adapter?: GooglePlayBillingVerificationAdapter;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  runtimeConfig?: GooglePlayBillingRuntimeConfig | null;
  notificationHandler?: (event: GooglePlayNotificationEvent) => GooglePlayNotificationHandlerResult | Promise<GooglePlayNotificationHandlerResult>;
}

interface GoogleAccessTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface GoogleProductPurchaseResponse {
  orderId?: string;
  purchaseTimeMillis?: string;
  purchaseState?: number;
  consumptionState?: number;
  acknowledgementState?: number;
  purchaseType?: number;
}

interface GooglePubSubPushEnvelope {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
    attributes?: Record<string, string> | null;
  } | null;
  subscription?: string;
}

interface GoogleSubscriptionNotificationPayload {
  version?: string;
  notificationType?: number;
  purchaseToken?: string;
  subscriptionId?: string;
}

interface GoogleOneTimeProductNotificationPayload {
  version?: string;
  notificationType?: number;
  purchaseToken?: string;
  sku?: string;
}

interface GoogleVoidedPurchaseNotificationPayload {
  purchaseToken?: string;
  orderId?: string;
  productType?: number;
  refundType?: number;
}

interface GoogleDeveloperNotificationPayload {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string | number;
  subscriptionNotification?: GoogleSubscriptionNotificationPayload | null;
  oneTimeProductNotification?: GoogleOneTimeProductNotificationPayload | null;
  voidedPurchaseNotification?: GoogleVoidedPurchaseNotificationPayload | null;
  testNotification?: Record<string, unknown> | null;
}

export interface GooglePlayNotificationEvent {
  eventId: string;
  kind: "subscription" | "one_time_product" | "voided_purchase" | "test";
  notificationType: string;
  eventTime: string;
  orderId?: string;
  purchaseTokenHash?: string;
  rawPayload: GoogleDeveloperNotificationPayload;
}

export interface GooglePlayNotificationHandlerResult {
  status?: "processed" | "ignored" | "duplicate";
}

const MAX_JSON_BODY_BYTES = 64 * 1024;
const GOOGLE_PLAY_ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const googlePurchaseAuditLog = new PurchaseAuditLog({
  surface: "google-play",
  paymentMethod: "google_play",
  defaultRoute: "/api/payments/google/verify",
  defaultTags: ["google-play"]
});

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

export function readGooglePlayBillingRuntimeConfig(env: NodeJS.ProcessEnv = process.env): GooglePlayBillingRuntimeConfig | null {
  const packageName = env.VEIL_GOOGLE_PLAY_PACKAGE_NAME?.trim();
  const serviceAccountEmail = env.VEIL_GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = readPemValue(env, "VEIL_GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY");

  if (!packageName || !serviceAccountEmail || !privateKey) {
    return null;
  }

  return {
    packageName,
    serviceAccountEmail,
    privateKey,
    oauthTokenUrl: env.VEIL_GOOGLE_PLAY_OAUTH_TOKEN_URL?.trim() || "https://oauth2.googleapis.com/token",
    androidPublisherApiUrl:
      env.VEIL_GOOGLE_PLAY_ANDROID_PUBLISHER_API_URL?.trim() || "https://androidpublisher.googleapis.com/androidpublisher/v3",
    rtdnSharedSecret: env.VEIL_GOOGLE_PLAY_RTDN_SHARED_SECRET?.trim() || null,
    rtdnAudience: env.VEIL_GOOGLE_PLAY_RTDN_AUDIENCE?.trim() || null,
    rtdnServiceAccountEmail: env.VEIL_GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL?.trim() || null,
    rtdnTokenInfoUrl: env.VEIL_GOOGLE_PLAY_RTDN_TOKEN_INFO_URL?.trim() || "https://oauth2.googleapis.com/tokeninfo"
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

function isPaymentStoreReady(store: RoomSnapshotStore | null) {
  return isSharedPaymentStoreReady(store);
}

function isPaymentOpsStoreReady(store: RoomSnapshotStore | null) {
  return isSharedPaymentOpsStoreReady(store);
}

function normalizePaymentGrantRetryPolicy(): { maxAttempts: number; baseDelayMs: number } {
  return normalizeSharedPaymentGrantRetryPolicy();
}

async function refreshPaymentGrantObservability(store: RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listPaymentOrders">>, now: Date) {
  return refreshSharedPaymentGrantObservability(store, now);
}

function normalizeGooglePaymentProduct(product: ShopProduct | undefined): ShopProduct & { grant: ShopProductGrant; googlePriceCents: number } {
  if (!product) {
    throw new GooglePlayBillingVerificationError({
      code: "google_product_not_found",
      message: "Verified Google Play purchase does not map to a configured shop product",
      retryable: false,
      statusCode: 400,
      category: "invalid_request"
    });
  }
  if (product.type !== "gem_pack" && product.type !== "season_pass_premium") {
    throw new GooglePlayBillingVerificationError({
      code: "google_product_unsupported",
      message: "Google Play Billing only supports gem packs and season pass premium products",
      retryable: false,
      statusCode: 400,
      category: "invalid_request"
    });
  }
  if ((product.grant.gems ?? 0) <= 0 && product.grant.seasonPassPremium !== true) {
    throw new GooglePlayBillingVerificationError({
      code: "google_product_grant_not_configured",
      message: "Google Play Billing product grant is not configured",
      retryable: false,
      statusCode: 500,
      category: "configuration"
    });
  }
  if (!product.googlePriceCents || product.googlePriceCents <= 0) {
    throw new GooglePlayBillingVerificationError({
      code: "google_product_price_not_configured",
      message: "Google Play Billing product price is not configured",
      retryable: false,
      statusCode: 500,
      category: "configuration"
    });
  }

  return product as ShopProduct & { grant: ShopProductGrant; googlePriceCents: number };
}

function findProductForGooglePurchase(products: ShopProduct[], googleProductId: string): ShopProduct | undefined {
  const normalizedGoogleProductId = googleProductId.trim();
  return products.find(
    (product) => product.productId === normalizedGoogleProductId || product.googleProductId === normalizedGoogleProductId
  );
}

function isFinalizedPaymentOrderStatus(status: PaymentOrderSnapshot["status"]): boolean {
  return isSharedFinalizedPaymentOrderStatus(status);
}

function isAcceptedPaymentOrderStatus(status: PaymentOrderSnapshot["status"]): boolean {
  return isSharedAcceptedPaymentOrderStatus(status);
}

function emitPurchaseCompletedEvent(input: {
  playerId: string;
  purchaseId: string;
  productId: string;
  paymentMethod: "google_play";
  quantity: number;
  totalPrice: number;
}): void {
  googlePurchaseAuditLog.emitCompleted(input);
}

function emitPurchaseFailedEvent(input: {
  playerId: string;
  purchaseId: string;
  productId: string;
  paymentMethod: "google_play";
  failureReason: string;
  orderStatus: PaymentOrderSnapshot["status"] | "failed";
}): void {
  googlePurchaseAuditLog.emitFailed(input);
}

function emitPaymentFraudSignal(
  playerId: string,
  signal: string,
  payload: {
    orderId: string;
    productId: string;
    [key: string]: unknown;
  }
): void {
  googlePurchaseAuditLog.emitFraudSignal({
    playerId,
    signal,
    orderId: payload.orderId,
    productId: payload.productId,
    details: payload
  });
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function createServiceAccountAssertion(config: GooglePlayBillingRuntimeConfig, now: Date): string {
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = {
    iss: config.serviceAccountEmail,
    scope: GOOGLE_PLAY_ANDROID_PUBLISHER_SCOPE,
    aud: config.oauthTokenUrl,
    iat: issuedAt,
    exp: issuedAt + 3600
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(config.privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function fetchGoogleAccessToken(input: {
  config: GooglePlayBillingRuntimeConfig;
  fetchImpl: typeof fetch;
  now: Date;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createServiceAccountAssertion(input.config, input.now)
  });
  const response = await input.fetchImpl(input.config.oauthTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  let payload: GoogleAccessTokenResponse | { error?: string; error_description?: string } | null = null;
  try {
    payload = (await response.json()) as GoogleAccessTokenResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new GooglePlayBillingVerificationError({
      code: "google_access_token_failed",
      message:
        payload && typeof payload === "object" && "error_description" in payload && typeof payload.error_description === "string"
          ? payload.error_description
          : `Google OAuth token exchange failed with status ${response.status}`,
      retryable: response.status >= 500 || response.status === 429,
      statusCode: response.status >= 500 ? 502 : 503,
      category: response.status >= 500 || response.status === 429 ? "upstream" : "configuration"
    });
  }

  const accessToken = payload && typeof payload === "object" && "access_token" in payload ? payload.access_token?.trim() : "";
  if (!accessToken) {
    throw new GooglePlayBillingVerificationError({
      code: "google_access_token_invalid",
      message: "Google OAuth token exchange did not return an access token",
      retryable: true,
      statusCode: 502,
      category: "upstream"
    });
  }

  return accessToken;
}

function normalizeGooglePurchaseTimestamp(value?: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new GooglePlayBillingVerificationError({
      code: "google_purchase_payload_invalid",
      message: "Google Play purchase payload is incomplete",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }

  return new Date(parsed).toISOString();
}

function normalizeGoogleProductPurchase(input: {
  payload: GoogleProductPurchaseResponse;
  packageName: string;
  productId: string;
  purchaseToken: string;
}): GoogleVerifiedProductPurchase {
  const orderId = input.payload.orderId?.trim();
  if (!orderId) {
    throw new GooglePlayBillingVerificationError({
      code: "google_purchase_payload_invalid",
      message: "Google Play purchase payload is incomplete",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }

  const purchaseState = Math.max(-1, Math.floor(input.payload.purchaseState ?? -1));
  if (purchaseState !== 0) {
    throw new GooglePlayBillingVerificationError({
      code: purchaseState === 2 ? "google_purchase_pending" : "google_purchase_not_purchased",
      message: purchaseState === 2 ? "Google Play purchase is still pending" : "Google Play purchase is not in a purchased state",
      retryable: purchaseState === 2,
      statusCode: 409,
      category: "verification"
    });
  }

  const acknowledgementState = input.payload.acknowledgementState === 1 ? 1 : 0;
  const consumptionState = input.payload.consumptionState === 1 ? 1 : 0;

  return {
    orderId,
    purchaseToken: input.purchaseToken,
    productId: input.productId,
    packageName: input.packageName,
    purchaseDate: normalizeGooglePurchaseTimestamp(input.payload.purchaseTimeMillis),
    environment: input.payload.purchaseType === 0 ? "Test" : "Production",
    acknowledgementState,
    consumptionState
  };
}

async function fetchGoogleProductPurchase(input: {
  config: GooglePlayBillingRuntimeConfig;
  fetchImpl: typeof fetch;
  now: Date;
  packageName: string;
  productId: string;
  purchaseToken: string;
}): Promise<GoogleVerifiedProductPurchase> {
  const accessToken = await fetchGoogleAccessToken({
    config: input.config,
    fetchImpl: input.fetchImpl,
    now: input.now
  });
  const requestUrl = `${input.config.androidPublisherApiUrl}/applications/${encodeURIComponent(input.packageName)}/purchases/products/${encodeURIComponent(input.productId)}/tokens/${encodeURIComponent(input.purchaseToken)}`;
  const response = await input.fetchImpl(requestUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });

  let payload: GoogleProductPurchaseResponse | { error?: { message?: string; status?: string } } | null = null;
  try {
    payload = (await response.json()) as GoogleProductPurchaseResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorMessage =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : `Google Play purchase lookup failed with status ${response.status}`;

    if (response.status === 400 || response.status === 404) {
      throw new GooglePlayBillingVerificationError({
        code: "google_signature_invalid",
        message: errorMessage,
        retryable: false,
        statusCode: 400,
        category: "verification"
      });
    }

    throw new GooglePlayBillingVerificationError({
      code: "google_verification_upstream_failed",
      message: errorMessage,
      retryable: response.status >= 500 || response.status === 429,
      statusCode: response.status >= 500 ? 502 : 503,
      category: response.status >= 500 || response.status === 429 ? "upstream" : "configuration"
    });
  }

  return normalizeGoogleProductPurchase({
    payload: (payload ?? {}) as GoogleProductPurchaseResponse,
    packageName: input.packageName,
    productId: input.productId,
    purchaseToken: input.purchaseToken
  });
}

async function postGooglePublisherMutation(input: {
  config: GooglePlayBillingRuntimeConfig;
  fetchImpl: typeof fetch;
  now: Date;
  packageName: string;
  productId: string;
  purchaseToken: string;
  action: "acknowledge" | "consume";
  body?: Record<string, unknown>;
}): Promise<void> {
  const accessToken = await fetchGoogleAccessToken({
    config: input.config,
    fetchImpl: input.fetchImpl,
    now: input.now
  });
  const requestUrl = `${input.config.androidPublisherApiUrl}/applications/${encodeURIComponent(input.packageName)}/purchases/products/${encodeURIComponent(input.productId)}/tokens/${encodeURIComponent(input.purchaseToken)}:${input.action}`;
  const response = await input.fetchImpl(requestUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input.body ?? {})
  });

  let payload: { error?: { message?: string } } | null = null;
  try {
    payload = (await response.json()) as { error?: { message?: string } };
  } catch {
    payload = null;
  }

  if (response.ok || response.status === 409) {
    return;
  }

  throw new GooglePlayBillingVerificationError({
    code: input.action === "acknowledge" ? "google_acknowledge_failed" : "google_consume_failed",
    message:
      payload?.error?.message?.trim() ||
      `Google Play ${input.action} request failed with status ${response.status}`,
    retryable: response.status >= 500 || response.status === 429,
    statusCode: response.status >= 500 ? 502 : 503,
    category: response.status >= 500 || response.status === 429 ? "upstream" : "configuration"
  });
}

export function createGooglePlayBillingVerificationAdapter(input: {
  config: GooglePlayBillingRuntimeConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): GooglePlayBillingVerificationAdapter {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());

  return {
    verifyProductPurchase: ({ packageName, productId, purchaseToken }) =>
      fetchGoogleProductPurchase({
        config: input.config,
        fetchImpl,
        now: now(),
        packageName,
        productId,
        purchaseToken
      }),
    acknowledgeProductPurchase: ({ packageName, productId, purchaseToken, developerPayload }) =>
      postGooglePublisherMutation({
        config: input.config,
        fetchImpl,
        now: now(),
        packageName,
        productId,
        purchaseToken,
        action: "acknowledge",
        ...(developerPayload ? { body: { developerPayload } } : {})
      }),
    consumeProductPurchase: ({ packageName, productId, purchaseToken }) =>
      postGooglePublisherMutation({
        config: input.config,
        fetchImpl,
        now: now(),
        packageName,
        productId,
        purchaseToken,
        action: "consume"
      })
  };
}

function hashPurchaseToken(purchaseToken: string): string {
  return createHash("sha256").update(purchaseToken).digest("hex");
}

function safeCompareSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseRequestSearchParams(request: IncomingMessage): URLSearchParams {
  return new URL(request.url ?? "/", "http://google-rtdn.local").searchParams;
}

function normalizeGoogleNotificationHandlerStatus(
  status: GooglePlayNotificationHandlerResult["status"]
): "processed" | "ignored" | "duplicate" {
  return status === "processed" || status === "duplicate" ? status : "ignored";
}

function normalizeGoogleNotificationTime(value: string | number | undefined): string {
  const timestamp =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  const parsedDate = new Date(timestamp);
  if (!Number.isFinite(parsedDate.getTime())) {
    throw new GooglePlayBillingVerificationError({
      code: "google_rtdn_payload_invalid",
      message: "Google RTDN payload is incomplete",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }
  return parsedDate.toISOString();
}

function mapGoogleSubscriptionNotificationType(notificationType: number): string {
  const mapped = {
    1: "SUBSCRIPTION_RECOVERED",
    2: "SUBSCRIPTION_RENEWED",
    3: "SUBSCRIPTION_CANCELED",
    4: "SUBSCRIPTION_PURCHASED",
    5: "SUBSCRIPTION_ON_HOLD",
    6: "SUBSCRIPTION_IN_GRACE_PERIOD",
    7: "SUBSCRIPTION_RESTARTED",
    8: "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
    9: "SUBSCRIPTION_DEFERRED",
    10: "SUBSCRIPTION_PAUSED",
    11: "SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED",
    12: "SUBSCRIPTION_REVOKED",
    13: "SUBSCRIPTION_EXPIRED",
    17: "SUBSCRIPTION_ITEMS_CHANGED",
    18: "SUBSCRIPTION_CANCELLATION_SCHEDULED",
    19: "SUBSCRIPTION_PRICE_CHANGE_UPDATED",
    20: "SUBSCRIPTION_PENDING_PURCHASE_CANCELED",
    22: "SUBSCRIPTION_PRICE_STEP_UP_CONSENT_UPDATED"
  }[Math.floor(notificationType)];
  if (!mapped) {
    throw new GooglePlayBillingVerificationError({
      code: "google_rtdn_notification_type_invalid",
      message: "Google RTDN notificationType is not supported",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }
  return mapped;
}

function mapGoogleOneTimeProductNotificationType(notificationType: number): string {
  const mapped = {
    1: "ONE_TIME_PRODUCT_PURCHASED",
    2: "ONE_TIME_PRODUCT_CANCELED"
  }[Math.floor(notificationType)];
  if (!mapped) {
    throw new GooglePlayBillingVerificationError({
      code: "google_rtdn_notification_type_invalid",
      message: "Google RTDN notificationType is not supported",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }
  return mapped;
}

async function validateGoogleRtdnAuth(input: {
  request: IncomingMessage;
  config: GooglePlayBillingRuntimeConfig;
  fetchImpl: typeof fetch;
  now: Date;
}): Promise<void> {
  const providedSecret =
    parseRequestSearchParams(input.request).get("token")?.trim() ||
    (typeof input.request.headers["x-veil-google-rtdn-secret"] === "string"
      ? input.request.headers["x-veil-google-rtdn-secret"].trim()
      : "");
  if (input.config.rtdnSharedSecret && providedSecret && safeCompareSecret(providedSecret, input.config.rtdnSharedSecret)) {
    return;
  }

  const authorizationHeader = input.request.headers.authorization?.trim() || "";
  const bearerToken = authorizationHeader.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length).trim() : "";
  if (!bearerToken || !input.config.rtdnAudience || !input.config.rtdnServiceAccountEmail) {
    throw new GooglePlayBillingVerificationError({
      code: "google_rtdn_unauthorized",
      message: "Google RTDN request is unauthorized",
      retryable: false,
      statusCode: 401,
      category: "verification"
    });
  }

  const tokenInfoUrl = `${input.config.rtdnTokenInfoUrl ?? "https://oauth2.googleapis.com/tokeninfo"}?id_token=${encodeURIComponent(bearerToken)}`;
  const response = await input.fetchImpl(tokenInfoUrl, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  let payload:
    | {
        aud?: string;
        email?: string;
        email_verified?: string | boolean;
        exp?: string | number;
        iss?: string;
      }
    | null = null;
  try {
    payload = (await response.json()) as {
      aud?: string;
      email?: string;
      email_verified?: string | boolean;
      exp?: string | number;
      iss?: string;
    };
  } catch {
    payload = null;
  }

  const exp = payload?.exp == null ? Number.NaN : Number(payload.exp);
  const emailVerified = payload?.email_verified === true || payload?.email_verified === "true";
  const issuer = payload?.iss?.trim() || "";
  if (
    !response.ok ||
    payload?.aud?.trim() !== input.config.rtdnAudience ||
    payload?.email?.trim() !== input.config.rtdnServiceAccountEmail ||
    !emailVerified ||
    (issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") ||
    !Number.isFinite(exp) ||
    exp * 1000 <= input.now.getTime()
  ) {
    throw new GooglePlayBillingVerificationError({
      code: "google_rtdn_unauthorized",
      message: "Google RTDN request is unauthorized",
      retryable: false,
      statusCode: 401,
      category: "verification"
    });
  }
}

function parseGooglePlayNotificationEvent(
  envelope: GooglePubSubPushEnvelope,
  config: GooglePlayBillingRuntimeConfig
): GooglePlayNotificationEvent {
  const messageId = envelope.message?.messageId?.trim() || "";
  const encodedData = envelope.message?.data?.trim() || "";
  if (!encodedData) {
    throw new GooglePlayBillingVerificationError({
      code: "google_rtdn_payload_invalid",
      message: "Google RTDN payload is incomplete",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }

  let payload: GoogleDeveloperNotificationPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8")) as GoogleDeveloperNotificationPayload;
  } catch {
    throw new GooglePlayBillingVerificationError({
      code: "google_rtdn_payload_invalid",
      message: "Google RTDN payload is incomplete",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }

  if (payload.packageName?.trim() !== config.packageName) {
    throw new GooglePlayBillingVerificationError({
      code: "google_package_name_mismatch",
      message: "Google RTDN packageName does not match this server",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }

  const eventTime = normalizeGoogleNotificationTime(payload.eventTimeMillis);
  if (payload.subscriptionNotification) {
    const purchaseToken = payload.subscriptionNotification.purchaseToken?.trim() || "";
    if (!purchaseToken) {
      throw new GooglePlayBillingVerificationError({
        code: "google_rtdn_payload_invalid",
        message: "Google RTDN payload is incomplete",
        retryable: false,
        statusCode: 400,
        category: "verification"
      });
    }
    const purchaseTokenHash = hashPurchaseToken(purchaseToken);
    return {
      eventId: messageId || `google-rtdn:${purchaseTokenHash}:${eventTime}`,
      kind: "subscription",
      notificationType: mapGoogleSubscriptionNotificationType(payload.subscriptionNotification.notificationType ?? -1),
      eventTime,
      orderId: `google:${purchaseTokenHash}`,
      purchaseTokenHash,
      rawPayload: payload
    };
  }
  if (payload.oneTimeProductNotification) {
    const purchaseToken = payload.oneTimeProductNotification.purchaseToken?.trim() || "";
    if (!purchaseToken) {
      throw new GooglePlayBillingVerificationError({
        code: "google_rtdn_payload_invalid",
        message: "Google RTDN payload is incomplete",
        retryable: false,
        statusCode: 400,
        category: "verification"
      });
    }
    const purchaseTokenHash = hashPurchaseToken(purchaseToken);
    return {
      eventId: messageId || `google-rtdn:${purchaseTokenHash}:${eventTime}`,
      kind: "one_time_product",
      notificationType: mapGoogleOneTimeProductNotificationType(payload.oneTimeProductNotification.notificationType ?? -1),
      eventTime,
      orderId: `google:${purchaseTokenHash}`,
      purchaseTokenHash,
      rawPayload: payload
    };
  }
  if (payload.voidedPurchaseNotification) {
    const purchaseToken = payload.voidedPurchaseNotification.purchaseToken?.trim() || "";
    const purchaseTokenHash = purchaseToken ? hashPurchaseToken(purchaseToken) : undefined;
    return {
      eventId: messageId || `google-rtdn:voided:${purchaseTokenHash ?? eventTime}`,
      kind: "voided_purchase",
      notificationType: "VOIDED_PURCHASE",
      eventTime,
      ...(purchaseTokenHash ? { orderId: `google:${purchaseTokenHash}`, purchaseTokenHash } : {}),
      rawPayload: payload
    };
  }
  if (payload.testNotification) {
    return {
      eventId: messageId || `google-rtdn:test:${eventTime}`,
      kind: "test",
      notificationType: "TEST_NOTIFICATION",
      eventTime,
      rawPayload: payload
    };
  }

  throw new GooglePlayBillingVerificationError({
    code: "google_rtdn_payload_invalid",
    message: "Google RTDN payload is incomplete",
    retryable: false,
    statusCode: 400,
    category: "verification"
  });
}

function recordGoogleNotificationAuditEvent(
  errorCode: string,
  message: string,
  details: Record<string, unknown> = {},
  severity: "warn" | "error" = "warn"
): void {
  try {
    recordRuntimeErrorEvent({
      id: randomUUID(),
      recordedAt: new Date().toISOString(),
      source: "server",
      surface: "google-play",
      candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
      featureArea: "payment",
      ownerArea: "commerce",
      severity,
      errorCode,
      message,
      tags: ["google-play", "payment-notification", errorCode],
      context: {
        roomId: null,
        playerId: null,
        requestId: null,
        route: "/api/payments/google/rtdn",
        action: null,
        statusCode: null,
        crash: false,
        detail: JSON.stringify(details)
      }
    });
  } catch {
    // Notification audit logging must never block payment callback handling.
  }
}

export function registerGooglePlayRoutes(
  app: HttpApp,
  store: RoomSnapshotStore | null,
  options: RegisterGooglePlayRoutesOptions = {}
): void {
  const products = resolveShopProducts(options);
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const runtimeConfig = options.runtimeConfig ?? readGooglePlayBillingRuntimeConfig();
  const notificationHandler = options.notificationHandler ?? null;
  const adapter =
    options.adapter ??
    (runtimeConfig
      ? createGooglePlayBillingVerificationAdapter({
          config: runtimeConfig,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          now
        })
      : null);

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

  const handleGoogleNotificationRequest = async (request: IncomingMessage, response: ServerResponse) => {
    if (!runtimeConfig) {
      sendJson(response, 503, {
        error: {
          code: "google_play_not_configured",
          message: "Google Play Billing runtime configuration is incomplete",
          retryable: false,
          category: "configuration"
        }
      });
      return;
    }
    if (
      !runtimeConfig.rtdnSharedSecret &&
      (!runtimeConfig.rtdnAudience || !runtimeConfig.rtdnServiceAccountEmail)
    ) {
      sendJson(response, 503, {
        error: {
          code: "google_rtdn_not_configured",
          message: "Google RTDN authentication is not configured",
          retryable: false,
          category: "configuration"
        }
      });
      return;
    }

    try {
      await validateGoogleRtdnAuth({
        request,
        config: runtimeConfig,
        fetchImpl,
        now: now()
      });
      const payload = parseGooglePlayNotificationEvent(
        (await readJsonBody(request)) as GooglePubSubPushEnvelope,
        runtimeConfig
      );
      const handlerResult = notificationHandler ? await notificationHandler(payload) : undefined;
      sendJson(response, 200, {
        acknowledged: true,
        status: normalizeGoogleNotificationHandlerStatus(handlerResult?.status),
        eventId: payload.eventId,
        notificationType: payload.notificationType,
        ...(payload.purchaseTokenHash ? { purchaseTokenHash: payload.purchaseTokenHash } : {})
      });
    } catch (error) {
      if (error instanceof GooglePlayBillingVerificationError) {
        if (error.statusCode >= 400 && error.statusCode < 500) {
          recordGoogleNotificationAuditEvent(error.name, error.message, {
            category: error.category
          });
        }
        sendJson(response, error.statusCode, error.toResponseBody());
        return;
      }

      recordGoogleNotificationAuditEvent(
        "google_rtdn_processing_failed",
        "Google RTDN processing failed",
        {
          reason: error instanceof Error ? error.message : String(error)
        },
        "error"
      );
      sendJson(response, 503, {
        error: {
          code: "google_rtdn_processing_failed",
          message: "Google RTDN processing failed",
          retryable: true,
          category: "upstream"
        }
      });
    }
  };

  app.post("/api/payments/google/rtdn", handleGoogleNotificationRequest);
  app.post("/api/payment/google/notification", handleGoogleNotificationRequest);

  app.post("/api/payments/google/verify", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }
    if (!runtimeConfig || !adapter) {
      sendJson(response, 503, {
        error: {
          code: "google_play_not_configured",
          message: "Google Play Billing runtime configuration is incomplete",
          retryable: false,
          category: "configuration"
        }
      });
      return;
    }
    if (!isPaymentStoreReady(store)) {
      sendJson(response, 503, {
        error: {
          code: "payment_persistence_unavailable",
          message: "Payment verification requires configured persistence storage",
          retryable: true,
          category: "configuration"
        }
      });
      return;
    }
    const paymentStore = new OrderIdempotencyStore(store);

    let orderId = "";
    let productId = "";
    let purchaseTokenHash = "";

    try {
      const body = (await readJsonBody(request)) as { productId?: string | null; purchaseToken?: string | null };
      const requestedProductId = body.productId?.trim();
      const purchaseToken = body.purchaseToken?.trim();
      if (!requestedProductId) {
        throw new GooglePlayBillingVerificationError({
          code: "google_product_id_required",
          message: "productId is required",
          retryable: false,
          statusCode: 400,
          category: "invalid_request"
        });
      }
      if (!purchaseToken) {
        throw new GooglePlayBillingVerificationError({
          code: "google_purchase_token_required",
          message: "purchaseToken is required",
          retryable: false,
          statusCode: 400,
          category: "invalid_request"
        });
      }

      purchaseTokenHash = hashPurchaseToken(purchaseToken);
      orderId = `google:${purchaseTokenHash}`;

      const product = normalizeGooglePaymentProduct(findProductForGooglePurchase(products, requestedProductId));
      productId = product.productId;
      const googleProductId = product.googleProductId ?? product.productId;

      let order = await paymentStore.loadOrder(orderId);
      if (order && order.playerId !== authSession.playerId) {
        emitPaymentFraudSignal(authSession.playerId, "purchase_token_claimed_by_another_player", {
          orderId,
          productId: product.productId,
          purchaseTokenHash
        });
        sendJson(response, 409, {
          error: {
            code: "payment_already_verified",
            message: "Payment order has already been verified",
            retryable: false,
            category: "verification"
          }
        });
        return;
      }

      if (!order) {
        try {
          order = await paymentStore.createOrder({
            orderId,
            playerId: authSession.playerId,
            productId: product.productId,
            amount: product.googlePriceCents,
            gemAmount: product.grant.gems ?? 0
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/duplicate/i.test(message)) {
            throw error;
          }
          order = await paymentStore.loadOrder(orderId);
        }
      }

      if (!order || order.playerId !== authSession.playerId) {
        throw new GooglePlayBillingVerificationError({
          code: "payment_order_not_found",
          message: "Payment order was not found",
          retryable: false,
          statusCode: 404,
          category: "verification"
        });
      }

      const existingReceipt = await paymentStore.loadReceiptByOrderId(order.orderId);
      if (isAcceptedPaymentOrderStatus(order.status) || existingReceipt) {
        emitPaymentFraudSignal(order.playerId, "duplicate_purchase_token", {
          orderId: order.orderId,
          productId: order.productId,
          purchaseTokenHash
        });
        sendJson(response, 409, {
          error: {
            code: "payment_already_verified",
            message: "Payment order has already been verified",
            retryable: false,
            category: "verification"
          }
        });
        return;
      }

      const verified = await adapter.verifyProductPurchase({
        packageName: runtimeConfig.packageName,
        productId: googleProductId,
        purchaseToken
      });
      if (verified.consumptionState === 1) {
        emitPaymentFraudSignal(order.playerId, "purchase_token_already_consumed", {
          orderId: order.orderId,
          productId: order.productId,
          purchaseTokenHash,
          googleOrderId: verified.orderId
        });
        sendJson(response, 409, {
          error: {
            code: "google_purchase_token_consumed",
            message: "Google Play purchase token has already been consumed",
            retryable: false,
            category: "verification"
          }
        });
        return;
      }

      if (verified.acknowledgementState === 0) {
        await adapter.acknowledgeProductPurchase({
          packageName: verified.packageName,
          productId: verified.productId,
          purchaseToken: verified.purchaseToken,
          developerPayload: authSession.playerId
        });
      }

      const settlement = await paymentStore.completeOrder(order.orderId, {
        wechatOrderId: purchaseTokenHash,
        paidAt: verified.purchaseDate,
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
          paymentMethod: "google_play",
          failureReason: settlement.order.lastGrantError ?? "grant_failed",
          orderStatus: settlement.order.status
        });
      }
      if (!settlement.credited && isFinalizedPaymentOrderStatus(settlement.order.status)) {
        sendJson(response, 409, {
          error: {
            code: "payment_already_verified",
            message: "Payment order has already been verified",
            retryable: false,
            category: "verification"
          }
        });
        return;
      }

      try {
        await adapter.consumeProductPurchase({
          packageName: verified.packageName,
          productId: verified.productId,
          purchaseToken: verified.purchaseToken
        });
      } catch (error) {
        if (error instanceof GooglePlayBillingVerificationError) {
          emitPaymentFraudSignal(order.playerId, "purchase_token_consume_failed", {
            orderId: order.orderId,
            productId: order.productId,
            purchaseTokenHash,
            reason: error.name
          });
        } else {
          emitPaymentFraudSignal(order.playerId, "purchase_token_consume_failed", {
            orderId: order.orderId,
            productId: order.productId,
            purchaseTokenHash,
            reason: error instanceof Error ? error.message : String(error)
          });
        }
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
          paymentMethod: "google_play",
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
          purchaseTokenHash,
          recentVerifiedCount
        });
      }

      sendJson(response, 200, {
        orderId: settlement.order.orderId,
        status: settlement.order.status,
        credited: settlement.credited,
        paidAt: settlement.order.paidAt,
        googleOrderId: verified.orderId,
        purchaseTokenHash,
        environment: verified.environment,
        ...(settlement.order.nextGrantRetryAt ? { nextGrantRetryAt: settlement.order.nextGrantRetryAt } : {}),
        ...(settlement.order.lastGrantError ? { lastGrantError: settlement.order.lastGrantError } : {}),
        gemsBalance: settlement.account.gems ?? 0,
        seasonPassPremium: settlement.account.seasonPassPremium === true
      });
    } catch (error) {
      if (error instanceof GooglePlayBillingVerificationError) {
        sendJson(response, error.statusCode, error.toResponseBody());
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 502, {
        error: {
          code: "google_play_verification_failed",
          message,
          retryable: true,
          category: "upstream"
        }
      });
    }
  });
}

const googlePlayPaymentGateway: PaymentGateway = {
  channel: "google",
  supportedOperations: ["verifyCallback", "grantRewards"],
  createOrder: (input) =>
    unsupportedPaymentGatewayOperation(
      "google",
      "createOrder",
      `Google Play orders are created client-side; server settlement begins at purchase token verification for ${input.productId}.`
    ),
  verifyCallback: () =>
    unsupportedPaymentGatewayOperation(
      "google",
      "verifyCallback",
      "Use the Google Play route adapter to verify authenticated RTDN callbacks and purchase tokens."
    ),
  grantRewards: () =>
    unsupportedPaymentGatewayOperation(
      "google",
      "grantRewards",
      "Use the Google Play route adapter to settle verified purchases against persistence."
    ),
  issueRefund: () =>
    unsupportedPaymentGatewayOperation("google", "issueRefund", "Google Play refunds are handled outside the current server runtime.")
};

const googlePlayPaymentNotificationHandler: PaymentNotificationHandler<GooglePlayNotificationEvent> = (store, event) =>
  handlePaymentRefundNotification(store, {
    channel: "google",
    notificationType: event.notificationType,
    ...(event.orderId ? { orderId: event.orderId } : {}),
    eventId: event.eventId,
    eventTime: event.eventTime,
    ...(event.rawPayload.voidedPurchaseNotification?.orderId
      ? { externalRefundId: event.rawPayload.voidedPurchaseNotification.orderId }
      : {})
  });

export const googlePlayPaymentGatewayRegistration: PaymentGatewayRegistration<GooglePlayNotificationEvent> = {
  gateway: googlePlayPaymentGateway,
  notificationHandler: googlePlayPaymentNotificationHandler,
  registerRoutes: (app, store) =>
    registerGooglePlayRoutes(app as HttpApp, store, {
      notificationHandler: (event) => googlePlayPaymentNotificationHandler(store, event)
    })
};
