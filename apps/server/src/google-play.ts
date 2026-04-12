import { createHash, createSign, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { emitAnalyticsEvent } from "./analytics";
import { validateAuthSessionFromRequest } from "./auth";
import {
  recordPaymentDeadLetter,
  recordRuntimeErrorEvent,
  setPaymentGrantDeadLetterCount,
  setPaymentGrantQueueCount,
  setPaymentGrantQueueLatency
} from "./observability";
import type { PaymentOrderSnapshot, RoomSnapshotStore } from "./persistence";
import { resolveShopProducts, type RegisterShopRoutesOptions, type ShopProduct, type ShopProductGrant } from "./shop";

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

const MAX_JSON_BODY_BYTES = 64 * 1024;
const DEFAULT_PAYMENT_GRANT_MAX_ATTEMPTS = 5;
const DEFAULT_PAYMENT_GRANT_BASE_DELAY_MS = 60_000;
const GOOGLE_PLAY_ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

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
      env.VEIL_GOOGLE_PLAY_ANDROID_PUBLISHER_API_URL?.trim() || "https://androidpublisher.googleapis.com/androidpublisher/v3"
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

function isPaymentStoreReady(store: RoomSnapshotStore | null): store is RoomSnapshotStore &
  Required<
    Pick<
      RoomSnapshotStore,
      "createPaymentOrder" | "completePaymentOrder" | "loadPaymentOrder" | "loadPaymentReceiptByOrderId" | "countVerifiedPaymentReceiptsSince"
    >
  > {
  return Boolean(
    store?.createPaymentOrder &&
      store.completePaymentOrder &&
      store.loadPaymentOrder &&
      store.loadPaymentReceiptByOrderId &&
      store.countVerifiedPaymentReceiptsSince
  );
}

function isPaymentOpsStoreReady(store: RoomSnapshotStore | null): store is RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "listPaymentOrders">> {
  return Boolean(store?.listPaymentOrders);
}

function normalizePaymentGrantRetryPolicy(): { maxAttempts: number; baseDelayMs: number } {
  return {
    maxAttempts: DEFAULT_PAYMENT_GRANT_MAX_ATTEMPTS,
    baseDelayMs: DEFAULT_PAYMENT_GRANT_BASE_DELAY_MS
  };
}

async function refreshPaymentGrantObservability(store: RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listPaymentOrders">>, now: Date) {
  const [pendingOrders, deadLetterOrders] = await Promise.all([
    store.listPaymentOrders({ statuses: ["grant_pending"], limit: 200 }),
    store.listPaymentOrders({ statuses: ["dead_letter"], limit: 200 })
  ]);

  setPaymentGrantQueueCount(pendingOrders.length);
  setPaymentGrantDeadLetterCount(deadLetterOrders.length);

  const pendingRetryTimes = pendingOrders
    .map((order) => (order.nextGrantRetryAt ? new Date(order.nextGrantRetryAt).getTime() : null))
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((left, right) => left - right);

  const oldestQueuedLatencyMs =
    pendingOrders.length === 0
      ? null
      : pendingOrders
          .map((order) => (order.lastGrantAttemptAt ? Math.max(0, now.getTime() - new Date(order.lastGrantAttemptAt).getTime()) : 0))
          .reduce((max, value) => Math.max(max, value), 0);
  const nextPendingRetryTime = pendingRetryTimes[0];
  const nextAttemptDelayMs = nextPendingRetryTime != null ? Math.max(0, nextPendingRetryTime - now.getTime()) : null;

  setPaymentGrantQueueLatency({
    oldestQueuedLatencyMs,
    nextAttemptDelayMs
  });
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
  return status === "settled" || status === "dead_letter";
}

function isAcceptedPaymentOrderStatus(status: PaymentOrderSnapshot["status"]): boolean {
  return status !== "created";
}

function emitPurchaseCompletedEvent(input: {
  playerId: string;
  purchaseId: string;
  productId: string;
  paymentMethod: "google_play";
  quantity: number;
  totalPrice: number;
}): void {
  emitAnalyticsEvent("purchase_completed", {
    playerId: input.playerId,
    payload: {
      purchaseId: input.purchaseId,
      productId: input.productId,
      paymentMethod: input.paymentMethod,
      quantity: input.quantity,
      totalPrice: input.totalPrice
    }
  });
}

function emitPurchaseFailedEvent(input: {
  playerId: string;
  purchaseId: string;
  productId: string;
  paymentMethod: "google_play";
  failureReason: string;
  orderStatus: PaymentOrderSnapshot["status"] | "failed";
}): void {
  emitAnalyticsEvent("purchase_failed", {
    playerId: input.playerId,
    payload: {
      purchaseId: input.purchaseId,
      productId: input.productId,
      paymentMethod: input.paymentMethod,
      failureReason: input.failureReason,
      orderStatus: input.orderStatus
    }
  });
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
  try {
    emitAnalyticsEvent("payment_fraud_signal", {
      playerId,
      payload: {
        signal,
        ...payload
      }
    });
  } catch {
    // Fraud logging must not break payment handling.
  }

  recordRuntimeErrorEvent({
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
    source: "server",
    surface: "google-play",
    candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    featureArea: "payment",
    ownerArea: "commerce",
    severity: "warn",
    errorCode: "payment_fraud_signal",
    message: `Google Play Billing fraud signal triggered: ${signal}`,
    tags: ["google-play", signal],
    context: {
      roomId: null,
      playerId,
      requestId: null,
      route: "/api/payments/google/verify",
      action: null,
      statusCode: null,
      crash: false,
      detail: JSON.stringify({
        orderId: payload.orderId,
        productId: payload.productId,
        signal
      })
    }
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

export function registerGooglePlayRoutes(
  app: HttpApp,
  store: RoomSnapshotStore | null,
  options: RegisterGooglePlayRoutesOptions = {}
): void {
  const products = resolveShopProducts(options);
  const now = options.now ?? (() => new Date());
  const runtimeConfig = options.runtimeConfig ?? readGooglePlayBillingRuntimeConfig();
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

      let order = await store.loadPaymentOrder(orderId);
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
          order = await store.createPaymentOrder({
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
          order = await store.loadPaymentOrder(orderId);
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

      const existingReceipt = await store.loadPaymentReceiptByOrderId(order.orderId);
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

      const settlement = await store.completePaymentOrder(order.orderId, {
        wechatOrderId: purchaseTokenHash,
        paidAt: verified.purchaseDate,
        verifiedAt: now().toISOString(),
        productName: product.name,
        grant: product.grant,
        retryPolicy: normalizePaymentGrantRetryPolicy()
      });

      if (settlement.order.status === "dead_letter") {
        recordPaymentDeadLetter();
      }
      if (isPaymentOpsStoreReady(store)) {
        await refreshPaymentGrantObservability(store, now());
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

      const recentVerifiedCount = await store.countVerifiedPaymentReceiptsSince(
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
