import { createPrivateKey, createSign, createVerify, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { emitAnalyticsEvent } from "@server/domain/ops/analytics";
import { validateAuthSessionFromRequest } from "@server/domain/account/auth";
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
import { PurchaseAuditLog } from "@server/domain/payment/PurchaseAuditLog";
import { type PaymentGateway, unsupportedPaymentGatewayOperation } from "@server/domain/payment/PaymentGateway";
import type { PaymentGatewayRegistration } from "@server/domain/payment/PaymentGatewayRegistry";
import type { PaymentOrderSnapshot, RoomSnapshotStore } from "@server/persistence";
import { resolveShopProducts, type RegisterShopRoutesOptions, type ShopProduct, type ShopProductGrant } from "@server/domain/economy/shop";

interface HttpApp {
  use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
  post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
}

export interface AppleIapRuntimeConfig {
  bundleId: string;
  issuerId: string;
  keyId: string;
  privateKey: string;
  productionApiUrl: string;
  sandboxApiUrl: string;
  rootCertificates: string[];
}

export interface AppleVerifiedTransaction {
  transactionId: string;
  originalTransactionId?: string;
  productId: string;
  environment: "Production" | "Sandbox";
  bundleId: string;
  purchaseDate: string;
  appAccountToken?: string;
}

export interface AppleIapVerificationErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  statusCode: number;
  category: "invalid_request" | "verification" | "configuration" | "upstream";
}

export class AppleIapVerificationError extends Error {
  readonly retryable: boolean;
  readonly statusCode: number;
  readonly category: AppleIapVerificationErrorShape["category"];

  constructor(input: AppleIapVerificationErrorShape) {
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

export interface AppleStoreKitVerificationAdapter {
  verifyTransaction(input: { signedTransactionInfo: string }): Promise<AppleVerifiedTransaction>;
}

interface RegisterApplePaymentRoutesOptions extends RegisterShopRoutesOptions {
  adapter?: AppleStoreKitVerificationAdapter;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  runtimeConfig?: AppleIapRuntimeConfig | null;
}

interface AppleTransactionPayload {
  transactionId?: string | number;
  originalTransactionId?: string | number;
  productId?: string;
  bundleId?: string;
  environment?: string;
  purchaseDate?: string | number;
  appAccountToken?: string;
}

interface AppleTransactionLookupResponse {
  signedTransactionInfo?: string;
}

const MAX_JSON_BODY_BYTES = 64 * 1024;
const applePurchaseAuditLog = new PurchaseAuditLog({
  surface: "apple-iap",
  paymentMethod: "apple_iap",
  defaultRoute: "/api/payments/apple/verify",
  defaultTags: ["apple-iap"]
});

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function normalizePemValue(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function splitPemCertificates(value: string): string[] {
  return (
    value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)?.map((certificate) => certificate.trim()) ??
    []
  );
}

function readBundledAppleRootCertificates(): string[] {
  const bundledPath = resolve(process.cwd(), "configs", "apple", "AppleRootCA-G3.pem");
  try {
    const contents = readFileSync(bundledPath, "utf8");
    return splitPemCertificates(contents);
  } catch {
    return [];
  }
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

export function readAppleIapRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AppleIapRuntimeConfig | null {
  const bundleId = env.VEIL_APPLE_IAP_BUNDLE_ID?.trim();
  const issuerId = env.VEIL_APPLE_IAP_ISSUER_ID?.trim();
  const keyId = env.VEIL_APPLE_IAP_KEY_ID?.trim();
  const privateKey = readPemValue(env, "VEIL_APPLE_IAP_PRIVATE_KEY");
  const inlineRootCertificates = readPemValue(env, "VEIL_APPLE_IAP_ROOT_CERTIFICATES");
  const rootCertificates = inlineRootCertificates
    ? splitPemCertificates(inlineRootCertificates)
    : readBundledAppleRootCertificates();

  if (!bundleId || !issuerId || !keyId || !privateKey || rootCertificates.length === 0) {
    return null;
  }

  return {
    bundleId,
    issuerId,
    keyId,
    privateKey,
    productionApiUrl: env.VEIL_APPLE_IAP_PRODUCTION_API_URL?.trim() || "https://api.storekit.itunes.apple.com",
    sandboxApiUrl: env.VEIL_APPLE_IAP_SANDBOX_API_URL?.trim() || "https://api.storekit-sandbox.itunes.apple.com",
    rootCertificates
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

function normalizeApplePaymentProduct(product: ShopProduct | undefined): ShopProduct & { grant: ShopProductGrant } {
  if (!product) {
    throw new AppleIapVerificationError({
      code: "apple_product_not_found",
      message: "Verified Apple transaction does not map to a configured shop product",
      retryable: false,
      statusCode: 400,
      category: "invalid_request"
    });
  }
  if (product.type !== "gem_pack" && product.type !== "season_pass_premium") {
    throw new AppleIapVerificationError({
      code: "apple_product_unsupported",
      message: "Apple IAP only supports gem packs and season pass premium products",
      retryable: false,
      statusCode: 400,
      category: "invalid_request"
    });
  }
  if ((product.grant.gems ?? 0) <= 0 && product.grant.seasonPassPremium !== true) {
    throw new AppleIapVerificationError({
      code: "apple_product_grant_not_configured",
      message: "Apple IAP product grant is not configured",
      retryable: false,
      statusCode: 500,
      category: "configuration"
    });
  }

  return product as ShopProduct & { grant: ShopProductGrant };
}

function findProductForAppleTransaction(products: ShopProduct[], appleProductId: string): ShopProduct | undefined {
  const normalizedAppleProductId = appleProductId.trim();
  return products.find(
    (product) => product.productId === normalizedAppleProductId || product.appleProductId === normalizedAppleProductId
  );
}

function resolveAppleOrderAmount(product: ShopProduct): number {
  const amount = Math.max(0, Math.floor(product.applePriceCents ?? product.price ?? 0));
  if (amount <= 0) {
    throw new AppleIapVerificationError({
      code: "apple_product_price_not_configured",
      message: "Apple IAP product price is not configured",
      retryable: false,
      statusCode: 500,
      category: "configuration"
    });
  }
  return amount;
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
  paymentMethod: "apple_iap";
  quantity: number;
  totalPrice: number;
}): void {
  applePurchaseAuditLog.emitCompleted(input);
}

function emitPurchaseFailedEvent(input: {
  playerId: string;
  purchaseId: string;
  productId: string;
  paymentMethod: "apple_iap";
  failureReason: string;
  orderStatus: PaymentOrderSnapshot["status"] | "failed";
}): void {
  applePurchaseAuditLog.emitFailed(input);
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
  applePurchaseAuditLog.emitFraudSignal({
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

function derToJoseEcdsaSignature(signature: Buffer, size: number): Buffer {
  const firstByte = signature[0];
  const secondByte = signature[1];
  if (signature.length < 8 || firstByte == null || secondByte == null || firstByte !== 0x30) {
    throw new Error("invalid_ecdsa_der_signature");
  }

  let offset = 2;
  if ((secondByte & 0x80) !== 0) {
    offset = 2 + (secondByte & 0x7f);
  }

  const integerMarker = signature[offset];
  const rLength = signature[offset + 1];
  if (integerMarker == null || rLength == null || integerMarker !== 0x02) {
    throw new Error("invalid_ecdsa_der_signature");
  }
  const r = signature.subarray(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  const secondIntegerMarker = signature[offset];
  const sLength = signature[offset + 1];
  if (secondIntegerMarker == null || sLength == null || secondIntegerMarker !== 0x02) {
    throw new Error("invalid_ecdsa_der_signature");
  }
  const s = signature.subarray(offset + 2, offset + 2 + sLength);

  const output = Buffer.alloc(size * 2);
  r.copy(output, size - Math.min(size, r.length), Math.max(0, r.length - size));
  s.copy(output, size * 2 - Math.min(size, s.length), Math.max(0, s.length - size));
  return output;
}

function joseToDerEcdsaSignature(signature: Buffer): Buffer {
  const size = signature.length / 2;
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("invalid_ecdsa_jose_signature");
  }

  const trimInteger = (value: Buffer) => {
    let trimmed = value;
    while (trimmed.length > 1 && trimmed[0] != null && trimmed[1] != null && trimmed[0] === 0x00 && (trimmed[1] & 0x80) === 0) {
      trimmed = trimmed.subarray(1);
    }
    if (trimmed[0] != null && (trimmed[0] & 0x80) !== 0) {
      trimmed = Buffer.concat([Buffer.from([0x00]), trimmed]);
    }
    return trimmed;
  };

  const r = trimInteger(signature.subarray(0, size));
  const s = trimInteger(signature.subarray(size));
  const totalLength = 2 + r.length + 2 + s.length;

  return Buffer.concat([Buffer.from([0x30, totalLength, 0x02, r.length]), r, Buffer.from([0x02, s.length]), s]);
}

function createJwtToken(config: AppleIapRuntimeConfig, now: Date): string {
  const header = {
    alg: "ES256",
    kid: config.keyId,
    typ: "JWT"
  };
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = {
    iss: config.issuerId,
    iat: issuedAt,
    exp: issuedAt + 300,
    aud: "appstoreconnect-v1",
    bid: config.bundleId
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const derSignature = signer.sign(createPrivateKey(config.privateKey));
  const joseSignature = derToJoseEcdsaSignature(derSignature, 32);

  return `${signingInput}.${base64UrlEncode(joseSignature)}`;
}

function decodeCompactJwsPart(value: string): string {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new AppleIapVerificationError({
      code: "apple_jws_malformed",
      message: "signedTransactionInfo is not a valid JWS",
      retryable: false,
      statusCode: 400,
      category: "invalid_request"
    });
  }
}

function normalizeAppleEnvironment(value?: string): "Production" | "Sandbox" {
  if (value === "Production" || value === "Sandbox") {
    return value;
  }
  throw new AppleIapVerificationError({
    code: "apple_environment_invalid",
    message: "Apple transaction environment is invalid or missing",
    retryable: false,
    statusCode: 400,
    category: "verification"
  });
}

function normalizeAppleTransactionPayload(payload: AppleTransactionPayload, expectedBundleId: string): AppleVerifiedTransaction {
  const transactionId = String(payload.transactionId ?? "").trim();
  const productId = payload.productId?.trim() || "";
  const bundleId = payload.bundleId?.trim() || "";
  const purchaseDateValue = payload.purchaseDate;
  const purchaseDate =
    typeof purchaseDateValue === "number"
      ? new Date(purchaseDateValue).toISOString()
      : typeof purchaseDateValue === "string" && purchaseDateValue.trim()
        ? new Date(purchaseDateValue).toISOString()
        : "";

  if (!transactionId || !productId || !bundleId || !purchaseDate || Number.isNaN(new Date(purchaseDate).getTime())) {
    throw new AppleIapVerificationError({
      code: "apple_transaction_payload_invalid",
      message: "Apple transaction payload is incomplete",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }
  if (bundleId !== expectedBundleId) {
    throw new AppleIapVerificationError({
      code: "apple_bundle_id_mismatch",
      message: "Apple transaction bundleId does not match this server",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }

  return {
    transactionId,
    ...(payload.originalTransactionId != null ? { originalTransactionId: String(payload.originalTransactionId).trim() } : {}),
    productId,
    environment: normalizeAppleEnvironment(payload.environment),
    bundleId,
    purchaseDate,
    ...(payload.appAccountToken?.trim() ? { appAccountToken: payload.appAccountToken.trim() } : {})
  };
}

function buildCertificatePemFromDer(certificateDer: string): string {
  return `-----BEGIN CERTIFICATE-----\n${certificateDer.match(/.{1,64}/g)?.join("\n") ?? certificateDer}\n-----END CERTIFICATE-----`;
}

function assertCertificateIsCurrentlyValid(certificate: X509Certificate, now: Date): void {
  const validFrom = new Date(certificate.validFrom);
  const validTo = new Date(certificate.validTo);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime()) || now < validFrom || now > validTo) {
    throw new AppleIapVerificationError({
      code: "apple_certificate_invalid",
      message: "Apple transaction signing certificate is not currently valid",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }
}

function isCertificateIssuedBy(child: X509Certificate, parent: X509Certificate): boolean {
  if (!child.checkIssued(parent)) {
    return false;
  }
  try {
    return child.verify(parent.publicKey);
  } catch {
    return false;
  }
}

function assertTrustedCertificateChain(
  chain: X509Certificate[],
  trustedRoots: X509Certificate[],
  now: Date
): void {
  for (const certificate of chain) {
    assertCertificateIsCurrentlyValid(certificate, now);
  }
  for (const trustedRoot of trustedRoots) {
    assertCertificateIsCurrentlyValid(trustedRoot, now);
  }

  for (let index = 0; index < chain.length - 1; index += 1) {
    if (!isCertificateIssuedBy(chain[index]!, chain[index + 1]!)) {
      throw new AppleIapVerificationError({
        code: "apple_certificate_chain_invalid",
        message: "Apple transaction certificate chain is not trusted",
        retryable: false,
        statusCode: 400,
        category: "verification"
      });
    }
  }

  const chainRoot = chain.at(-1);
  if (!chainRoot) {
    throw new AppleIapVerificationError({
      code: "apple_certificate_chain_invalid",
      message: "Apple transaction certificate chain is not trusted",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }

  const trustedRoot = trustedRoots.find(
    (root) => root.fingerprint256 === chainRoot.fingerprint256 || isCertificateIssuedBy(chainRoot, root)
  );
  if (!trustedRoot) {
    throw new AppleIapVerificationError({
      code: "apple_certificate_chain_invalid",
      message: "Apple transaction certificate chain is not trusted",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }
}

export function verifySignedTransactionWithCertificateChain(
  signedTransactionInfo: string,
  config: AppleIapRuntimeConfig,
  now: Date
): AppleVerifiedTransaction {
  const [encodedHeader, encodedPayload, encodedSignature] = signedTransactionInfo.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new AppleIapVerificationError({
      code: "apple_jws_malformed",
      message: "signedTransactionInfo is not a valid compact JWS",
      retryable: false,
      statusCode: 400,
      category: "invalid_request"
    });
  }

  const header = JSON.parse(decodeCompactJwsPart(encodedHeader)) as { alg?: string; x5c?: string[] };
  if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length === 0) {
    throw new AppleIapVerificationError({
      code: "apple_signature_header_invalid",
      message: "Apple transaction JWS header is invalid",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }

  const certificateDerChain = header.x5c.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  const leafCertificateDer = certificateDerChain[0];
  if (!leafCertificateDer) {
    throw new AppleIapVerificationError({
      code: "apple_signature_header_invalid",
      message: "Apple transaction JWS header is invalid",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }
  const certificateChain = certificateDerChain.map((certificateDer) => new X509Certificate(buildCertificatePemFromDer(certificateDer)));
  const trustedRoots = config.rootCertificates.map((certificatePem) => new X509Certificate(certificatePem));
  if (trustedRoots.length === 0) {
    throw new AppleIapVerificationError({
      code: "apple_root_certificates_missing",
      message: "Apple IAP root certificates are not configured",
      retryable: false,
      statusCode: 500,
      category: "configuration"
    });
  }

  const leafCertificate = certificateChain[0]!;
  assertTrustedCertificateChain(certificateChain, trustedRoots, now);

  const verifier = createVerify("SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const signature = joseToDerEcdsaSignature(Buffer.from(encodedSignature, "base64url"));
  if (!verifier.verify(leafCertificate.publicKey, signature)) {
    throw new AppleIapVerificationError({
      code: "apple_signature_invalid",
      message: "Apple transaction signature validation failed",
      retryable: false,
      statusCode: 400,
      category: "verification"
    });
  }

  const payload = JSON.parse(decodeCompactJwsPart(encodedPayload)) as AppleTransactionPayload;
  return normalizeAppleTransactionPayload(payload, config.bundleId);
}

function isAppleTransactionNotFound(statusCode: number, payload: unknown): boolean {
  if (statusCode !== 404) {
    return false;
  }
  if (!payload || typeof payload !== "object") {
    return true;
  }
  const errorCode = "errorCode" in payload ? String((payload as { errorCode?: unknown }).errorCode ?? "") : "";
  return errorCode === "" || errorCode === "4040010";
}

async function fetchAppleTransactionFromEnvironment(input: {
  config: AppleIapRuntimeConfig;
  fetchImpl: typeof fetch;
  now: Date;
  transactionId: string;
  environment: "Production" | "Sandbox";
}): Promise<{ environment: "Production" | "Sandbox"; signedTransactionInfo: string }> {
  const baseUrl = input.environment === "Sandbox" ? input.config.sandboxApiUrl : input.config.productionApiUrl;
  const response = await input.fetchImpl(`${baseUrl}/inApps/v1/transactions/${encodeURIComponent(input.transactionId)}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${createJwtToken(input.config, input.now)}`
    }
  });

  let payload: AppleTransactionLookupResponse | { errorCode?: string | number; errorMessage?: string } | null = null;
  try {
    payload = (await response.json()) as AppleTransactionLookupResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (isAppleTransactionNotFound(response.status, payload)) {
      throw new AppleIapVerificationError({
        code: "apple_transaction_not_found",
        message: "Apple transaction is not available yet",
        retryable: true,
        statusCode: 502,
        category: "upstream"
      });
    }
    throw new AppleIapVerificationError({
      code: "apple_verification_upstream_failed",
      message:
        payload && typeof payload === "object" && "errorMessage" in payload && typeof payload.errorMessage === "string"
          ? payload.errorMessage
          : `Apple verification request failed with status ${response.status}`,
      retryable: response.status >= 500 || response.status === 429,
      statusCode: response.status >= 500 ? 502 : 400,
      category: response.status >= 500 || response.status === 429 ? "upstream" : "verification"
    });
  }

  const signedTransactionInfo = payload && typeof payload === "object" && "signedTransactionInfo" in payload ? payload.signedTransactionInfo : "";
  if (!signedTransactionInfo || typeof signedTransactionInfo !== "string") {
    throw new AppleIapVerificationError({
      code: "apple_verification_response_invalid",
      message: "Apple verification response did not include signedTransactionInfo",
      retryable: true,
      statusCode: 502,
      category: "upstream"
    });
  }

  return {
    environment: input.environment,
    signedTransactionInfo
  };
}

export function createAppleStoreKitVerificationAdapter(input: {
  config: AppleIapRuntimeConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  verifySignedTransaction?: (signedTransactionInfo: string, config: AppleIapRuntimeConfig, now: Date) => AppleVerifiedTransaction;
}): AppleStoreKitVerificationAdapter {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const verifySignedTransaction = input.verifySignedTransaction ?? verifySignedTransactionWithCertificateChain;

  return {
    async verifyTransaction({ signedTransactionInfo }) {
      const verifiedClientTransaction = verifySignedTransaction(signedTransactionInfo, input.config, now());
      const preferredEnvironment = verifiedClientTransaction.environment;

      try {
        const upstream = await fetchAppleTransactionFromEnvironment({
          config: input.config,
          fetchImpl,
          now: now(),
          transactionId: verifiedClientTransaction.transactionId,
          environment: preferredEnvironment
        });
        const verifiedServerTransaction = verifySignedTransaction(upstream.signedTransactionInfo, input.config, now());
        if (verifiedServerTransaction.transactionId !== verifiedClientTransaction.transactionId) {
          throw new AppleIapVerificationError({
            code: "apple_transaction_mismatch",
            message: "Apple verification response returned a different transactionId",
            retryable: false,
            statusCode: 400,
            category: "verification"
          });
        }
        if (verifiedServerTransaction.productId !== verifiedClientTransaction.productId) {
          throw new AppleIapVerificationError({
            code: "apple_product_mismatch",
            message: "Apple verification response returned a different productId",
            retryable: false,
            statusCode: 400,
            category: "verification"
          });
        }
        return verifiedServerTransaction;
      } catch (error) {
        if (
          error instanceof AppleIapVerificationError &&
          error.name === "apple_transaction_not_found" &&
          preferredEnvironment === "Production"
        ) {
          const upstream = await fetchAppleTransactionFromEnvironment({
            config: input.config,
            fetchImpl,
            now: now(),
            transactionId: verifiedClientTransaction.transactionId,
            environment: "Sandbox"
          });
          const verifiedServerTransaction = verifySignedTransaction(upstream.signedTransactionInfo, input.config, now());
          if (verifiedServerTransaction.transactionId !== verifiedClientTransaction.transactionId) {
            throw new AppleIapVerificationError({
              code: "apple_transaction_mismatch",
              message: "Apple verification response returned a different transactionId",
              retryable: false,
              statusCode: 400,
              category: "verification"
            });
          }
          return verifiedServerTransaction;
        }

        throw error;
      }
    }
  };
}

export function registerApplePaymentRoutes(
  app: HttpApp,
  store: RoomSnapshotStore | null,
  options: RegisterApplePaymentRoutesOptions = {}
): void {
  const products = resolveShopProducts(options);
  const now = options.now ?? (() => new Date());
  const runtimeConfig = options.runtimeConfig ?? readAppleIapRuntimeConfig();
  const adapter =
    options.adapter ??
    (runtimeConfig
      ? createAppleStoreKitVerificationAdapter({
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

  app.post("/api/payments/apple/verify", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }
    if (!adapter) {
      sendJson(response, 503, {
        error: {
          code: "apple_iap_not_configured",
          message: "Apple IAP runtime configuration is incomplete",
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

    try {
      const body = (await readJsonBody(request)) as { signedTransactionInfo?: string | null };
      const signedTransactionInfo = body.signedTransactionInfo?.trim();
      if (!signedTransactionInfo) {
        throw new AppleIapVerificationError({
          code: "apple_signed_transaction_required",
          message: "signedTransactionInfo is required",
          retryable: false,
          statusCode: 400,
          category: "invalid_request"
        });
      }

      const verified = await adapter.verifyTransaction({ signedTransactionInfo });
      const product = normalizeApplePaymentProduct(findProductForAppleTransaction(products, verified.productId));
      const amount = resolveAppleOrderAmount(product);
      orderId = `apple:${verified.transactionId}`;
      productId = product.productId;

      let order = await paymentStore.loadOrder(orderId);
      if (order && order.playerId !== authSession.playerId) {
        emitPaymentFraudSignal(authSession.playerId, "transaction_claimed_by_another_player", {
          orderId,
          productId: product.productId,
          transactionId: verified.transactionId
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
            amount,
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
        throw new AppleIapVerificationError({
          code: "payment_order_not_found",
          message: "Payment order was not found",
          retryable: false,
          statusCode: 404,
          category: "verification"
        });
      }

      const existingReceipt = await paymentStore.loadReceiptByOrderId(order.orderId);
      if (isAcceptedPaymentOrderStatus(order.status) || existingReceipt) {
        emitPaymentFraudSignal(order.playerId, "duplicate_transaction_id", {
          orderId: order.orderId,
          productId: order.productId,
          transactionId: verified.transactionId
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

      const settlement = await paymentStore.completeOrder(order.orderId, {
        wechatOrderId: verified.transactionId,
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
          paymentMethod: "apple_iap",
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
          paymentMethod: "apple_iap",
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
          transactionId: verified.transactionId,
          recentVerifiedCount
        });
      }

      sendJson(response, 200, {
        orderId: settlement.order.orderId,
        status: settlement.order.status,
        credited: settlement.credited,
        paidAt: settlement.order.paidAt,
        transactionId: verified.transactionId,
        environment: verified.environment,
        ...(verified.originalTransactionId ? { originalTransactionId: verified.originalTransactionId } : {}),
        ...(settlement.order.nextGrantRetryAt ? { nextGrantRetryAt: settlement.order.nextGrantRetryAt } : {}),
        ...(settlement.order.lastGrantError ? { lastGrantError: settlement.order.lastGrantError } : {}),
        gemsBalance: settlement.account.gems ?? 0,
        seasonPassPremium: settlement.account.seasonPassPremium === true
      });
    } catch (error) {
      if (error instanceof AppleIapVerificationError) {
        sendJson(response, error.statusCode, error.toResponseBody());
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 502, {
        error: {
          code: "apple_iap_verification_failed",
          message,
          retryable: true,
          category: "upstream"
        }
      });
    }
  });
}

const applePaymentGateway: PaymentGateway = {
  channel: "apple",
  supportedOperations: ["grantRewards"],
  createOrder: (input) =>
    unsupportedPaymentGatewayOperation(
      "apple",
      "createOrder",
      `Apple IAP orders are created client-side; server settlement begins at receipt verification for ${input.productId}.`
    ),
  verifyCallback: () =>
    unsupportedPaymentGatewayOperation(
      "apple",
      "verifyCallback",
      "Apple IAP uses signed transaction verification instead of a server callback contract."
    ),
  grantRewards: () =>
    unsupportedPaymentGatewayOperation(
      "apple",
      "grantRewards",
      "Use the Apple payment route adapter to settle verified StoreKit transactions against persistence."
    ),
  issueRefund: () =>
    unsupportedPaymentGatewayOperation("apple", "issueRefund", "Apple refunds are handled outside the current server runtime.")
};

export const applePaymentGatewayRegistration: PaymentGatewayRegistration = {
  gateway: applePaymentGateway,
  registerRoutes: (app, store) => registerApplePaymentRoutes(app as HttpApp, store)
};
