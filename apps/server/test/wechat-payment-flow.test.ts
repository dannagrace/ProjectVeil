import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import type { AnalyticsEvent } from "../../../packages/shared/src/analytics-events";
import {
  flushAnalyticsEventsForTest,
  registerAnalyticsRoutes,
  resetAnalyticsRuntimeDependencies
} from "../src/analytics";
import { issueWechatMiniGameAuthSession, resetGuestAuthSessions } from "../src/auth";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { registerRuntimeObservabilityRoutes, resetRuntimeObservability } from "../src/observability";
import { registerPlayerAccountRoutes } from "../src/player-accounts";
import {
  encryptWechatCallbackResourceForTest,
  registerWechatPayRoutes,
  signWechatCallbackForTest,
  type WechatPayRuntimeConfig
} from "../src/adapters/wechat-pay";
import type { ShopProduct } from "../src/shop";

const TEST_PRODUCTS: Partial<ShopProduct>[] = [
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
];

function createWechatPayConfig(): WechatPayRuntimeConfig & { platformPrivateKey: string } {
  const merchantKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const platformKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });

  return {
    appId: "wx-test-app",
    merchantId: "1900000109",
    merchantCertificateSerial: "merchant-serial-001",
    merchantPrivateKey: merchantKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    platformCertificateSerial: "platform-serial-001",
    platformPublicKey: platformKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    platformPrivateKey: platformKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    apiV3Key: "0123456789abcdef0123456789abcdef",
    notifyUrl: "https://veil.example.test/api/payments/wechat/callback",
    transactionsJsapiUrl: "https://wechat.example.test/v3/pay/transactions/jsapi",
    transactionsOutTradeNoUrlTemplate: "https://wechat.example.test/v3/pay/transactions/out-trade-no/{out_trade_no}?mchid={mchid}"
  };
}

function buildVerifyFetch(
  transaction: Partial<{
    appid: string;
    mchid: string;
    out_trade_no: string;
    transaction_id: string;
    trade_state: string;
    success_time: string;
    payer_total: number;
    openid: string;
  }>
): typeof fetch {
  return (async (input, init) => {
    if (String(init?.method ?? "GET").toUpperCase() === "POST") {
      return new Response(JSON.stringify({ prepay_id: "wx-prepay-123" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const outTradeNoMatch = requestUrl.pathname.match(/\/out-trade-no\/([^/]+)$/);
    const outTradeNo = outTradeNoMatch ? decodeURIComponent(outTradeNoMatch[1]) : "wechat-order-1";

    return new Response(
      JSON.stringify({
        appid: transaction.appid ?? "wx-test-app",
        mchid: transaction.mchid ?? "1900000109",
        out_trade_no: transaction.out_trade_no ?? outTradeNo,
        transaction_id: transaction.transaction_id ?? "wechat-transaction-123",
        trade_state: transaction.trade_state ?? "SUCCESS",
        success_time: transaction.success_time ?? "2026-04-04T01:02:03Z",
        amount: {
          payer_total: transaction.payer_total ?? 600
        },
        payer: {
          openid: transaction.openid ?? "wx-openid-player"
        }
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }) as typeof fetch;
}

async function createVerifiedTestStore(): Promise<MemoryRoomSnapshotStore> {
  const store = new MemoryRoomSnapshotStore();
  await store.bindPlayerAccountWechatMiniGameIdentity("wechat-player", {
    openId: "wx-openid-player",
    displayName: "暮潮守望"
  });
  return store;
}

function issueWechatSession() {
  return issueWechatMiniGameAuthSession({
    playerId: "wechat-player",
    displayName: "暮潮守望",
    loginId: "wechat-player"
  });
}

function withEnvOverrides(overrides: Record<string, string | undefined>): () => void {
  const previousValues = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]])
  ) as Record<string, string | undefined>;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of Object.entries(previousValues)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function startWechatPaymentServer(input: {
  port: number;
  store: MemoryRoomSnapshotStore;
  runtimeConfig: WechatPayRuntimeConfig;
  fetchImpl: typeof fetch;
  products?: Partial<ShopProduct>[];
}): Promise<Server> {
  resetGuestAuthSessions();
  resetAnalyticsRuntimeDependencies();
  resetRuntimeObservability();

  const transport = new WebSocketTransport();
  const app = transport.getExpressApp() as never;
  registerAnalyticsRoutes(app);
  registerPlayerAccountRoutes(app, input.store);
  registerRuntimeObservabilityRoutes(app, { store: input.store });
  registerWechatPayRoutes(app, input.store, {
    products: input.products ?? TEST_PRODUCTS,
    runtimeConfig: input.runtimeConfig,
    fetchImpl: input.fetchImpl
  });

  const server = new Server({ transport });
  await server.listen(input.port, "127.0.0.1");
  return server;
}

async function createOrder(baseUrl: string, token: string): Promise<{ orderId: string; package: string }> {
  const response = await fetch(`${baseUrl}/api/payments/wechat/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      productId: "gem-pack-premium"
    })
  });
  const payload = (await response.json()) as { orderId: string; package: string };
  assert.equal(response.status, 200);
  assert.equal(payload.package, "prepay_id=wx-prepay-123");
  assert.ok(payload.orderId);
  return payload;
}

function createSignedCallbackRequest(
  runtimeConfig: WechatPayRuntimeConfig & { platformPrivateKey: string },
  transaction: {
    out_trade_no: string;
    transaction_id: string;
    amount: { total: number };
    payer: { openid: string };
  }
): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify({
    id: "evt-wechat-payment-success",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource: encryptWechatCallbackResourceForTest(
      runtimeConfig.apiV3Key,
      JSON.stringify({
        appid: runtimeConfig.appId,
        mchid: runtimeConfig.merchantId,
        trade_state: "SUCCESS",
        success_time: "2026-04-04T01:02:03Z",
        ...transaction
      }),
      "callback-nonce-01"
    )
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "signature-nonce-1";
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "Wechatpay-Timestamp": timestamp,
      "Wechatpay-Nonce": nonce,
      "Wechatpay-Serial": runtimeConfig.platformCertificateSerial,
      "Wechatpay-Signature": signWechatCallbackForTest(runtimeConfig.platformPrivateKey, timestamp, nonce, body)
    }
  };
}

async function fetchCapturedAnalytics(baseUrl: string): Promise<AnalyticsEvent[]> {
  const response = await fetch(`${baseUrl}/api/test/analytics/events`);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { events?: AnalyticsEvent[] };
  return payload.events ?? [];
}

test("wechat payment callback settles the order, emits purchase analytics, and duplicate verify is rejected", async (t) => {
  const port = 42750 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const runtimeConfig = createWechatPayConfig();
  const store = await createVerifiedTestStore();
  const restoreEnv = withEnvOverrides({
    ANALYTICS_ENDPOINT: `${baseUrl}/api/analytics/events`
  });
  const server = await startWechatPaymentServer({
    port,
    store,
    runtimeConfig,
    fetchImpl: buildVerifyFetch({})
  });
  const session = issueWechatSession();

  t.after(async () => {
    restoreEnv();
    resetAnalyticsRuntimeDependencies();
    resetGuestAuthSessions();
    resetRuntimeObservability();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const order = await createOrder(baseUrl, session.token);
  const callbackRequest = createSignedCallbackRequest(runtimeConfig, {
    out_trade_no: order.orderId,
    transaction_id: "wechat-transaction-123",
    amount: {
      total: 600
    },
    payer: {
      openid: "wx-openid-player"
    }
  });
  const callbackResponse = await fetch(`${baseUrl}/api/payments/wechat/callback`, {
    method: "POST",
    headers: callbackRequest.headers,
    body: callbackRequest.body
  });
  await flushAnalyticsEventsForTest();

  const duplicateVerifyResponse = await fetch(`${baseUrl}/api/payments/wechat/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const duplicateVerifyPayload = (await duplicateVerifyResponse.json()) as { error: { code: string } };
  const accountResponse = await fetch(`${baseUrl}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const accountPayload = (await accountResponse.json()) as { account: { gems: number } };
  const eventLogResponse = await fetch(`${baseUrl}/api/player-accounts/me/event-log`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const eventLogPayload = (await eventLogResponse.json()) as { items: Array<{ description: string }> };
  const analyticsEvents = await fetchCapturedAnalytics(baseUrl);
  const purchaseEvent = analyticsEvents.find(
    (event) => event.name === "purchase" && event.payload.purchaseId === order.orderId
  );
  const purchaseCompletedEvent = analyticsEvents.find(
    (event) => event.name === "purchase_completed" && event.payload.purchaseId === order.orderId
  );
  const storedOrder = await store.loadPaymentOrder(order.orderId);
  const receipt = await store.loadPaymentReceiptByOrderId(order.orderId);

  assert.equal(callbackResponse.status, 200);
  assert.equal(duplicateVerifyResponse.status, 409);
  assert.equal(duplicateVerifyPayload.error.code, "payment_already_verified");
  assert.equal(accountResponse.status, 200);
  assert.equal(accountPayload.account.gems, 120);
  assert.ok(eventLogPayload.items.some((entry) => entry.description.includes("Premium Gem Cache")));
  assert.ok(purchaseEvent);
  assert.equal(purchaseEvent?.payload.productId, "gem-pack-premium");
  assert.equal(purchaseEvent?.payload.totalPrice, 600);
  assert.equal(purchaseCompletedEvent?.payload.paymentMethod, "wechat_pay");
  assert.equal(purchaseCompletedEvent?.payload.totalPrice, 600);
  assert.equal(storedOrder?.status, "settled");
  assert.equal(storedOrder?.wechatOrderId, "wechat-transaction-123");
  assert.equal(receipt?.transactionId, "wechat-transaction-123");
});

test("wechat payment verify settles a created order and emits purchase analytics over the HTTP integration flow", async (t) => {
  const port = 42880 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const runtimeConfig = createWechatPayConfig();
  const store = await createVerifiedTestStore();
  const restoreEnv = withEnvOverrides({
    ANALYTICS_ENDPOINT: `${baseUrl}/api/analytics/events`
  });
  const server = await startWechatPaymentServer({
    port,
    store,
    runtimeConfig,
    fetchImpl: buildVerifyFetch({})
  });
  const session = issueWechatSession();

  t.after(async () => {
    restoreEnv();
    resetAnalyticsRuntimeDependencies();
    resetGuestAuthSessions();
    resetRuntimeObservability();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const order = await createOrder(baseUrl, session.token);
  const verifyResponse = await fetch(`${baseUrl}/api/payments/wechat/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const verifyPayload = (await verifyResponse.json()) as { status: string; gemsBalance: number };
  await flushAnalyticsEventsForTest();

  const accountResponse = await fetch(`${baseUrl}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const accountPayload = (await accountResponse.json()) as { account: { gems: number } };
  const analyticsEvents = await fetchCapturedAnalytics(baseUrl);
  const purchaseEvent = analyticsEvents.find(
    (event) => event.name === "purchase" && event.payload.purchaseId === order.orderId
  );
  const purchaseCompletedEvent = analyticsEvents.find(
    (event) => event.name === "purchase_completed" && event.payload.purchaseId === order.orderId
  );

  assert.equal(verifyResponse.status, 200);
  assert.equal(verifyPayload.status, "settled");
  assert.equal(verifyPayload.gemsBalance, 120);
  assert.equal(accountResponse.status, 200);
  assert.equal(accountPayload.account.gems, 120);
  assert.ok(purchaseEvent);
  assert.equal(purchaseEvent?.payload.productId, "gem-pack-premium");
  assert.equal(purchaseCompletedEvent?.payload.paymentMethod, "wechat_pay");
});

test("wechat payment verify returns amount mismatch without granting rewards and records the fraud signal", async (t) => {
  const port = 43010 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const runtimeConfig = createWechatPayConfig();
  const store = await createVerifiedTestStore();
  const restoreEnv = withEnvOverrides({
    ANALYTICS_ENDPOINT: `${baseUrl}/api/analytics/events`
  });
  const server = await startWechatPaymentServer({
    port,
    store,
    runtimeConfig,
    fetchImpl: buildVerifyFetch({
      payer_total: 599
    })
  });
  const session = issueWechatSession();

  t.after(async () => {
    restoreEnv();
    resetAnalyticsRuntimeDependencies();
    resetGuestAuthSessions();
    resetRuntimeObservability();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const order = await createOrder(baseUrl, session.token);
  const verifyResponse = await fetch(`${baseUrl}/api/payments/wechat/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const verifyPayload = (await verifyResponse.json()) as { error: { code: string } };
  await flushAnalyticsEventsForTest();

  const accountResponse = await fetch(`${baseUrl}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const accountPayload = (await accountResponse.json()) as { account: { gems: number } };
  const analyticsEvents = await fetchCapturedAnalytics(baseUrl);
  const fraudEvent = analyticsEvents.find(
    (event) =>
      event.name === "payment_fraud_signal" &&
      event.payload.orderId === order.orderId &&
      event.payload.signal === "amount_mismatch"
  );
  const purchaseEvent = analyticsEvents.find(
    (event) => event.name === "purchase" && event.payload.purchaseId === order.orderId
  );
  const storedOrder = await store.loadPaymentOrder(order.orderId);
  const receipt = await store.loadPaymentReceiptByOrderId(order.orderId);

  assert.equal(verifyResponse.status, 400);
  assert.equal(verifyPayload.error.code, "wechat_payment_amount_mismatch");
  assert.equal(accountResponse.status, 200);
  assert.equal(accountPayload.account.gems, 0);
  assert.ok(fraudEvent);
  assert.equal(purchaseEvent, undefined);
  assert.equal(storedOrder?.status, "created");
  assert.equal(receipt, null);
});

test("wechat payment verify emits purchase_failed when settlement cannot grant rewards", async (t) => {
  const port = 43080 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const runtimeConfig = createWechatPayConfig();
  const store = await createVerifiedTestStore();
  const restoreEnv = withEnvOverrides({
    ANALYTICS_ENDPOINT: `${baseUrl}/api/analytics/events`
  });
  const originalCompletePaymentOrder = store.completePaymentOrder.bind(store);
  store.completePaymentOrder = async (orderId, input) => {
    const settlement = await originalCompletePaymentOrder(orderId, input);
    return {
      ...settlement,
      credited: false,
      order: {
        ...settlement.order,
        status: "dead_letter",
        lastGrantError: "grant_failed_for_test",
        deadLetteredAt: settlement.order.paidAt ?? settlement.order.updatedAt
      }
    };
  };
  const server = await startWechatPaymentServer({
    port,
    store,
    runtimeConfig,
    fetchImpl: buildVerifyFetch({})
  });
  const session = issueWechatSession();

  t.after(async () => {
    restoreEnv();
    resetAnalyticsRuntimeDependencies();
    resetGuestAuthSessions();
    resetRuntimeObservability();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const order = await createOrder(baseUrl, session.token);
  const verifyResponse = await fetch(`${baseUrl}/api/payments/wechat/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const verifyPayload = (await verifyResponse.json()) as { error: { code: string } };
  await flushAnalyticsEventsForTest();

  const analyticsEvents = await fetchCapturedAnalytics(baseUrl);
  const purchaseFailedEvent = analyticsEvents.find(
    (event) => event.name === "purchase_failed" && event.payload.purchaseId === order.orderId
  );

  assert.equal(verifyResponse.status, 409);
  assert.equal(verifyPayload.error.code, "payment_already_verified");
  assert.equal(purchaseFailedEvent?.payload.paymentMethod, "wechat_pay");
  assert.equal(purchaseFailedEvent?.payload.failureReason, "grant_failed_for_test");
  assert.equal(purchaseFailedEvent?.payload.orderStatus, "dead_letter");
});
