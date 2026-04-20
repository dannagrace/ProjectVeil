import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { issueAccountAuthSession } from "@server/domain/account/auth";
import { MemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "@server/domain/ops/observability";
import {
  encryptWechatCallbackResourceForTest,
  registerWechatPayRoutes,
  signWechatCallbackForTest,
  type WechatPayRuntimeConfig
} from "@server/adapters/wechat-pay";
import type { ShopProduct } from "@server/domain/economy/shop";

const TEST_PRODUCTS: Partial<ShopProduct>[] = [
  {
    productId: "gem-pack-premium",
    name: "Premium Gem Cache",
    type: "gem_pack",
    price: 0,
    wechatPriceFen: 600,
    enabled: false,
    grant: {
      gems: 120
    }
  }
];

const FAILING_GRANT_PRODUCTS: Partial<ShopProduct>[] = [
  {
    productId: "gem-pack-equipment-retry",
    name: "Equipment Retry Crate",
    type: "gem_pack",
    price: 0,
    wechatPriceFen: 600,
    enabled: false,
    grant: {
      gems: 120,
      equipmentIds: ["militia_pike"]
    }
  }
];

function buildFreshCallbackNow(): Date {
  return new Date("2024-04-04T02:22:00Z");
}

class TestResponse extends EventEmitter {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  body = "";

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  end(chunk?: string | Buffer): void {
    if (chunk != null) {
      this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    }
    this.emit("finish");
  }
}

class TestApp {
  private readonly middlewares: Array<(request: never, response: never, next: () => void) => void> = [];
  private readonly getHandlers = new Map<string, (request: never, response: never) => void | Promise<void>>();
  private readonly postHandlers = new Map<string, (request: never, response: never) => void | Promise<void>>();

  use(handler: (request: never, response: never, next: () => void) => void): void {
    this.middlewares.push(handler);
  }

  get(path: string, handler: (request: never, response: never) => void | Promise<void>): void {
    this.getHandlers.set(path, handler);
  }

  post(path: string, handler: (request: never, response: never) => void | Promise<void>): void {
    this.postHandlers.set(path, handler);
  }

  async invoke(
    path: string,
    options: { body?: string; headers?: Record<string, string>; method?: "GET" | "POST" } = {}
  ) {
    const method = options.method ?? "POST";
    const routePath = new URL(path, "http://test.local").pathname;
    const routeHandler = (method === "GET" ? this.getHandlers : this.postHandlers).get(routePath);
    if (!routeHandler) {
      throw new Error(`No ${method} handler registered for ${routePath}`);
    }

    const request = Readable.from(options.body ? [Buffer.from(options.body, "utf8")] : []) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    request.method = method;
    request.url = path;

    const response = new TestResponse();
    const handlers = [...this.middlewares, async (req: never, res: never) => routeHandler(req, res)];
    let index = 0;

    const next = (): void => {
      const handler = handlers[index];
      index += 1;
      if (!handler) {
        return;
      }
      void handler(request as never, response as never, next);
    };

    next();
    await EventEmitter.once(response, "finish");

    return {
      statusCode: response.statusCode,
      headers: response.headers,
      json: response.body ? (JSON.parse(response.body) as unknown) : null
    };
  }
}

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

function issueWechatSession() {
  return issueAccountAuthSession({
    playerId: "wechat-player",
    displayName: "暮潮守望",
    loginId: "wechat-player",
    provider: "wechat-mini-game"
  });
}

async function createVerifiedTestStore(): Promise<MemoryRoomSnapshotStore> {
  const store = new MemoryRoomSnapshotStore();
  await store.bindPlayerAccountWechatMiniGameIdentity("wechat-player", {
    openId: "wx-openid-player",
    displayName: "暮潮守望"
  });
  return store;
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
  return (async (_input, init) => {
    if (String(init?.method ?? "GET").toUpperCase() === "POST") {
      return new Response(JSON.stringify({ prepay_id: "wx-prepay-123" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    return new Response(
      JSON.stringify({
        appid: transaction.appid ?? "wx-test-app",
        mchid: transaction.mchid ?? "1900000109",
        out_trade_no: transaction.out_trade_no ?? "wechat-order-1",
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

test("wechat pay create route creates a pending order and returns JSAPI payment parameters", async () => {
  const app = new TestApp();
  const store = await createVerifiedTestStore();
  const runtimeConfig = createWechatPayConfig();

  let capturedBody = "";
  let capturedAuthorization = "";
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    fetchImpl: async (_input, init) => {
      capturedBody = String(init?.body ?? "");
      capturedAuthorization = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      return new Response(JSON.stringify({ prepay_id: "wx-prepay-123" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  });
  const session = issueWechatSession();

  const response = await app.invoke("/api/payments/wechat/create", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "gem-pack-premium"
    })
  });
  const payload = response.json as {
    orderId: string;
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: string;
    paySign: string;
  };
  const order = await store.loadPaymentOrder(payload.orderId);

  assert.equal(response.statusCode, 200);
  assert.ok(payload.orderId);
  assert.equal(payload.package, "prepay_id=wx-prepay-123");
  assert.equal(payload.signType, "RSA");
  assert.ok(payload.timeStamp);
  assert.ok(payload.nonceStr);
  assert.ok(payload.paySign);
  assert.match(capturedAuthorization, /^WECHATPAY2-SHA256-RSA2048 /);
  assert.deepEqual(JSON.parse(capturedBody), {
    appid: runtimeConfig.appId,
    mchid: runtimeConfig.merchantId,
    description: "Premium Gem Cache",
    out_trade_no: payload.orderId,
    notify_url: runtimeConfig.notifyUrl,
    amount: {
      total: 600,
      currency: "CNY"
    },
    payer: {
      openid: "wx-openid-player"
    }
  });
  assert.deepEqual(order, {
    orderId: payload.orderId,
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    status: "created",
    amount: 600,
    gemAmount: 120,
    grantAttemptCount: 0,
    createdAt: order?.createdAt,
    updatedAt: order?.updatedAt
  });
});

test("wechat pay create route rejects missing WeChat binding and malformed product requests", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const runtimeConfig = createWechatPayConfig();
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig
  });
  const session = issueWechatSession();

  const missingOpenId = await app.invoke("/api/payments/wechat/create", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "gem-pack-premium"
    })
  });
  const missingOpenIdPayload = missingOpenId.json as { error: { code: string } };
  assert.equal(missingOpenId.statusCode, 400);
  assert.equal(missingOpenIdPayload.error.code, "wechat_open_id_required");

  const invalidProduct = await app.invoke("/api/payments/wechat/create", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "missing-product"
    })
  });
  const invalidProductPayload = invalidProduct.json as { error: { message: string } };
  assert.equal(invalidProduct.statusCode, 400);
  assert.equal(invalidProductPayload.error.message, "product_not_found");

  const malformedJson = await app.invoke("/api/payments/wechat/create", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: "{"
  });
  assert.equal(malformedJson.statusCode, 400);
});

test("wechat pay create route surfaces missing configuration and upstream order creation failures", async () => {
  const session = issueWechatSession();

  const configMissingApp = new TestApp();
  const verifiedStore = await createVerifiedTestStore();
  registerWechatPayRoutes(configMissingApp as never, verifiedStore, {
    products: TEST_PRODUCTS,
    runtimeConfig: null
  });
  const missingConfig = await configMissingApp.invoke("/api/payments/wechat/create", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "gem-pack-premium"
    })
  });
  const missingConfigPayload = missingConfig.json as { error: { code: string } };
  assert.equal(missingConfig.statusCode, 503);
  assert.equal(missingConfigPayload.error.code, "wechat_pay_not_configured");

  const upstreamFailureApp = new TestApp();
  registerWechatPayRoutes(upstreamFailureApp as never, verifiedStore, {
    products: TEST_PRODUCTS,
    runtimeConfig: createWechatPayConfig(),
    fetchImpl: async () =>
      new Response("gateway exploded", {
        status: 502
      })
  });
  const upstreamFailure = await upstreamFailureApp.invoke("/api/payments/wechat/create", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "gem-pack-premium"
    })
  });
  const upstreamFailurePayload = upstreamFailure.json as { error: { code: string; message: string } };
  assert.equal(upstreamFailure.statusCode, 502);
  assert.equal(upstreamFailurePayload.error.code, "wechat_order_create_failed");
  assert.equal(upstreamFailurePayload.error.message, "gateway exploded");

  const invalidResponseApp = new TestApp();
  registerWechatPayRoutes(invalidResponseApp as never, verifiedStore, {
    products: TEST_PRODUCTS,
    runtimeConfig: createWechatPayConfig(),
    fetchImpl: async () =>
      new Response(JSON.stringify({ prepay_id: " " }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
  });
  const invalidResponse = await invalidResponseApp.invoke("/api/payments/wechat/create", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      productId: "gem-pack-premium"
    })
  });
  const invalidResponsePayload = invalidResponse.json as { error: { code: string } };
  assert.equal(invalidResponse.statusCode, 502);
  assert.equal(invalidResponsePayload.error.code, "wechat_order_create_invalid_response");
});

test("wechat pay verify route grants a successful verified payment and stores the receipt", async () => {
  const app = new TestApp();
  const store = await createVerifiedTestStore();
  const runtimeConfig = createWechatPayConfig();
  const order = await store.createPaymentOrder({
    orderId: "wechat-order-1",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: buildFreshCallbackNow,
    fetchImpl: buildVerifyFetch({
      out_trade_no: order.orderId
    })
  });
  const session = issueWechatSession();

  const response = await app.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const account = await store.loadPlayerAccount("wechat-player");
  const paidOrder = await store.loadPaymentOrder(order.orderId);
  const receipt = await store.loadPaymentReceiptByOrderId(order.orderId);

  assert.equal(response.statusCode, 200);
  assert.equal(account?.gems, 120);
  assert.equal(paidOrder?.status, "settled");
  assert.equal(paidOrder?.wechatOrderId, "wechat-transaction-123");
  assert.equal(paidOrder?.paidAt, "2026-04-04T01:02:03.000Z");
  assert.equal(receipt?.transactionId, "wechat-transaction-123");
});

test("wechat pay verify route rejects failed verification without granting rewards", async () => {
  const app = new TestApp();
  const store = await createVerifiedTestStore();
  const runtimeConfig = createWechatPayConfig();
  const order = await store.createPaymentOrder({
    orderId: "wechat-order-1",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    fetchImpl: buildVerifyFetch({
      out_trade_no: order.orderId,
      trade_state: "USERPAYING"
    })
  });
  const session = issueWechatSession();

  const response = await app.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const payload = response.json as { error: { code: string } };
  const account = await store.loadPlayerAccount("wechat-player");

  assert.equal(response.statusCode, 409);
  assert.equal(payload.error.code, "wechat_payment_not_success");
  assert.equal(account?.gems ?? 0, 0);
});

test("wechat pay verify route rejects duplicate submissions with 409 and does not double-credit", async () => {
  resetRuntimeObservability();
  const app = new TestApp();
  const store = await createVerifiedTestStore();
  const runtimeConfig = createWechatPayConfig();
  const order = await store.createPaymentOrder({
    orderId: "wechat-order-1",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: buildFreshCallbackNow,
    fetchImpl: buildVerifyFetch({
      out_trade_no: order.orderId
    })
  });
  const session = issueWechatSession();

  const firstResponse = await app.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const secondResponse = await app.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const duplicatePayload = secondResponse.json as { error: { code: string } };
  const account = await store.loadPlayerAccount("wechat-player");
  const metrics = buildPrometheusMetricsDocument();

  assert.equal(firstResponse.statusCode, 200, JSON.stringify(firstResponse));
  assert.equal(secondResponse.statusCode, 409);
  assert.equal(duplicatePayload.error.code, "payment_already_verified");
  assert.equal(account?.gems, 120);
  assert.match(metrics, /veil_runtime_error_events_total\{error_code="payment_fraud_signal",feature_area="payment",owner_area="commerce",severity="warn"\} 1/);
});

test("wechat pay verify route rejects amount mismatches", async () => {
  const app = new TestApp();
  const store = await createVerifiedTestStore();
  const runtimeConfig = createWechatPayConfig();
  const order = await store.createPaymentOrder({
    orderId: "wechat-order-1",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    fetchImpl: buildVerifyFetch({
      out_trade_no: order.orderId,
      payer_total: 599
    })
  });
  const session = issueWechatSession();

  const response = await app.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const payload = response.json as { error: { code: string } };
  const account = await store.loadPlayerAccount("wechat-player");

  assert.equal(response.statusCode, 400);
  assert.equal(payload.error.code, "wechat_payment_amount_mismatch");
  assert.equal(account?.gems ?? 0, 0);
});

test("wechat pay verify route rejects payer openid mismatches without granting rewards", async () => {
  const app = new TestApp();
  const store = await createVerifiedTestStore();
  const runtimeConfig = createWechatPayConfig();
  const order = await store.createPaymentOrder({
    orderId: "wechat-order-1",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: buildFreshCallbackNow,
    fetchImpl: buildVerifyFetch({
      out_trade_no: order.orderId,
      openid: "wx-openid-other-player"
    })
  });
  const session = issueWechatSession();

  const response = await app.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const payload = response.json as { error: { code: string } };
  const account = await store.loadPlayerAccount("wechat-player");
  const paidOrder = await store.loadPaymentOrder(order.orderId);
  const receipt = await store.loadPaymentReceiptByOrderId(order.orderId);

  assert.equal(response.statusCode, 409);
  assert.equal(payload.error.code, "wechat_payment_openid_mismatch");
  assert.equal(account?.gems ?? 0, 0);
  assert.equal(paidOrder?.status, "created");
  assert.equal(receipt, null);
});

test("wechat pay verify route validates order ownership, player bindings, and runtime config", async () => {
  const session = issueWechatSession();

  const missingConfigApp = new TestApp();
  const readyStore = await createVerifiedTestStore();
  registerWechatPayRoutes(missingConfigApp as never, readyStore, {
    products: TEST_PRODUCTS,
    runtimeConfig: null
  });
  const missingConfig = await missingConfigApp.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      orderId: "wechat-order-1"
    })
  });
  const missingConfigPayload = missingConfig.json as { error: { code: string } };
  assert.equal(missingConfig.statusCode, 503);
  assert.equal(missingConfigPayload.error.code, "wechat_pay_not_configured");

  const runtimeConfig = createWechatPayConfig();
  const invalidOrderApp = new TestApp();
  registerWechatPayRoutes(invalidOrderApp as never, readyStore, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    fetchImpl: buildVerifyFetch({})
  });
  const invalidOrder = await invalidOrderApp.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({})
  });
  const invalidOrderPayload = invalidOrder.json as { error: { code: string } };
  assert.equal(invalidOrder.statusCode, 400);
  assert.equal(invalidOrderPayload.error.code, "invalid_order_id");

  const notFound = await invalidOrderApp.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      orderId: "missing-order"
    })
  });
  const notFoundPayload = notFound.json as { error: { code: string } };
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFoundPayload.error.code, "payment_order_not_found");

  const noBindingApp = new TestApp();
  const noBindingStore = new MemoryRoomSnapshotStore();
  const order = await noBindingStore.createPaymentOrder({
    orderId: "wechat-order-no-openid",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  registerWechatPayRoutes(noBindingApp as never, noBindingStore, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    fetchImpl: buildVerifyFetch({
      out_trade_no: order.orderId
    })
  });
  const noBinding = await noBindingApp.invoke("/api/payments/wechat/verify", {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      orderId: order.orderId
    })
  });
  const noBindingPayload = noBinding.json as { error: { code: string } };
  assert.equal(noBinding.statusCode, 400);
  assert.equal(noBindingPayload.error.code, "wechat_open_id_required");
});

test("wechat pay callback verifies, credits once, and ignores duplicate notifications", async () => {
  const app = new TestApp();
  const store = await createVerifiedTestStore();
  const runtimeConfig = createWechatPayConfig();
  const order = await store.createPaymentOrder({
    orderId: "wechat-order-1",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: buildFreshCallbackNow,
    fetchImpl: buildVerifyFetch({
      out_trade_no: order.orderId
    })
  });

  const transaction = {
    appid: runtimeConfig.appId,
    mchid: runtimeConfig.merchantId,
    out_trade_no: order.orderId,
    transaction_id: "wechat-transaction-123",
    trade_state: "SUCCESS",
    success_time: "2026-04-04T01:02:03Z",
    amount: {
      total: 600
    },
    payer: {
      openid: "wx-openid-player"
    }
  };
  const resource = encryptWechatCallbackResourceForTest(
    runtimeConfig.apiV3Key,
    JSON.stringify(transaction),
    "callback-nonce1"
  );
  const body = JSON.stringify({
    id: "evt-1",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource
  });
  let callbackAttempt = 0;
  const sendCallback = async () => {
    const timestamp = String(Math.floor(buildFreshCallbackNow().getTime() / 1000) + callbackAttempt);
    const nonce = `signature-nonce-${callbackAttempt + 1}`;
    const signature = signWechatCallbackForTest(runtimeConfig.platformPrivateKey, timestamp, nonce, body);
    callbackAttempt += 1;

    return app.invoke("/api/payments/wechat/callback", {
      headers: {
        "content-type": "application/json",
        "wechatpay-timestamp": timestamp,
        "wechatpay-nonce": nonce,
        "wechatpay-serial": runtimeConfig.platformCertificateSerial,
        "wechatpay-signature": signature
      },
      body
    });
  };

  const firstResponse = await sendCallback();
  const secondResponse = await sendCallback();
  const account = await store.loadPlayerAccount("wechat-player");
  const paidOrder = await store.loadPaymentOrder(order.orderId);
  const receipt = await store.loadPaymentReceiptByOrderId(order.orderId);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(account?.gems, 120);
  assert.equal(paidOrder?.status, "settled");
  assert.equal(paidOrder?.wechatOrderId, "wechat-transaction-123");
  assert.equal(receipt?.transactionId, "wechat-transaction-123");
});

test("wechat pay callback logs payer mismatches and does not grant rewards", async () => {
  const app = new TestApp();
  const store = await createVerifiedTestStore();
  const runtimeConfig = createWechatPayConfig();
  const order = await store.createPaymentOrder({
    orderId: "wechat-order-1",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: buildFreshCallbackNow,
    fetchImpl: buildVerifyFetch({
      out_trade_no: order.orderId,
      openid: "wx-openid-other-player"
    })
  });

  const transaction = {
    appid: runtimeConfig.appId,
    mchid: runtimeConfig.merchantId,
    out_trade_no: order.orderId,
    transaction_id: "wechat-transaction-123",
    trade_state: "SUCCESS",
    success_time: "2026-04-04T01:02:03Z",
    amount: {
      total: 600
    },
    payer: {
      openid: "wx-openid-other-player"
    }
  };
  const resource = encryptWechatCallbackResourceForTest(
    runtimeConfig.apiV3Key,
    JSON.stringify(transaction),
    "callback-nonce2"
  );
  const body = JSON.stringify({
    id: "evt-2",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource
  });
  const timestamp = String(Math.floor(buildFreshCallbackNow().getTime() / 1000));
  const nonce = "signature-nonce-2";
  const signature = signWechatCallbackForTest(runtimeConfig.platformPrivateKey, timestamp, nonce, body);

  const response = await app.invoke("/api/payments/wechat/callback", {
    headers: {
      "content-type": "application/json",
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": nonce,
      "wechatpay-serial": runtimeConfig.platformCertificateSerial,
      "wechatpay-signature": signature
    },
    body
  });
  const account = await store.loadPlayerAccount("wechat-player");
  const paidOrder = await store.loadPaymentOrder(order.orderId);
  const receipt = await store.loadPaymentReceiptByOrderId(order.orderId);

  assert.equal(response.statusCode, 200);
  assert.equal(account?.gems ?? 0, 0);
  assert.equal(paidOrder?.status, "created");
  assert.equal(receipt, null);
});

test("wechat pay callback rejects invalid signatures", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const runtimeConfig = createWechatPayConfig();
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: buildFreshCallbackNow
  });

  const response = await app.invoke("/api/payments/wechat/callback", {
    headers: {
      "content-type": "application/json",
      "wechatpay-timestamp": "1712197200",
      "wechatpay-nonce": "bad-signature-nonce",
      "wechatpay-serial": runtimeConfig.platformCertificateSerial,
      "wechatpay-signature": "invalid-signature"
    },
    body: JSON.stringify({
      id: "evt-invalid",
      event_type: "TRANSACTION.SUCCESS",
      resource_type: "encrypt-resource",
      resource: null
    })
  });
  const payload = response.json as { code: string; message: string };

  assert.equal(response.statusCode, 401);
  assert.equal(payload.code, "FAIL");
  assert.match(payload.message, /signature verification failed/);
});

test("wechat pay callback rejects timestamps outside the replay window", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const runtimeConfig = createWechatPayConfig();
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: () => new Date("2026-04-11T01:01:00Z")
  });

  const body = JSON.stringify({
    id: "evt-stale",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource: null
  });
  const staleTimestamp = String(Math.floor(new Date("2026-04-11T00:50:00Z").getTime() / 1000));
  const nonce = "stale-signature-nonce";
  const signature = signWechatCallbackForTest(runtimeConfig.platformPrivateKey, staleTimestamp, nonce, body);

  const response = await app.invoke("/api/payments/wechat/callback", {
    headers: {
      "content-type": "application/json",
      "wechatpay-timestamp": staleTimestamp,
      "wechatpay-nonce": nonce,
      "wechatpay-serial": runtimeConfig.platformCertificateSerial,
      "wechatpay-signature": signature
    },
    body
  });
  const payload = response.json as { code: string; message: string };

  assert.equal(response.statusCode, 401);
  assert.equal(payload.code, "FAIL");
  assert.match(payload.message, /replay window/);
});

test("wechat pay callback rejects unsupported trade states", async () => {
  const store = new MemoryRoomSnapshotStore();
  const runtimeConfig = createWechatPayConfig();
  const callbackApp = new TestApp();
  registerWechatPayRoutes(callbackApp as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: buildFreshCallbackNow,
    fetchImpl: buildVerifyFetch({})
  });

  const unsupportedTradeStateTransaction = {
    appid: runtimeConfig.appId,
    mchid: runtimeConfig.merchantId,
    out_trade_no: "wechat-order-unsupported",
    transaction_id: "wechat-transaction-unsupported",
    trade_state: "USERPAYING",
    amount: {
      total: 600
    },
    payer: {
      openid: "wx-openid-player"
    }
  };
  const unsupportedTradeStateResource = encryptWechatCallbackResourceForTest(
    runtimeConfig.apiV3Key,
    JSON.stringify(unsupportedTradeStateTransaction),
    "callback-nonce-unsupported"
  );
  const unsupportedTradeStateBody = JSON.stringify({
    id: "evt-unsupported",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource: unsupportedTradeStateResource
  });
  const unsupportedTradeStateTimestamp = "1712197202";
  const unsupportedTradeStateNonce = "signature-nonce-unsupported";
  const unsupportedTradeStateSignature = signWechatCallbackForTest(
    runtimeConfig.platformPrivateKey,
    unsupportedTradeStateTimestamp,
    unsupportedTradeStateNonce,
    unsupportedTradeStateBody
  );
  const unsupportedTradeState = await callbackApp.invoke("/api/payments/wechat/callback", {
    headers: {
      "content-type": "application/json",
      "wechatpay-timestamp": unsupportedTradeStateTimestamp,
      "wechatpay-nonce": unsupportedTradeStateNonce,
      "wechatpay-serial": runtimeConfig.platformCertificateSerial,
      "wechatpay-signature": unsupportedTradeStateSignature
    },
    body: unsupportedTradeStateBody
  });
  const unsupportedTradeStatePayload = unsupportedTradeState.json as { message: string };
  assert.equal(unsupportedTradeState.statusCode, 400);
  assert.equal(unsupportedTradeStatePayload.message, "unsupported trade state");
});

test("wechat pay callback rejects merchant mismatches", async () => {
  const store = new MemoryRoomSnapshotStore();
  const runtimeConfig = createWechatPayConfig();
  const callbackApp = new TestApp();
  registerWechatPayRoutes(callbackApp as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: buildFreshCallbackNow,
    fetchImpl: buildVerifyFetch({})
  });

  const merchantMismatchTransaction = {
    appid: "wrong-app",
    mchid: runtimeConfig.merchantId,
    out_trade_no: "wechat-order-mismatch",
    transaction_id: "wechat-transaction-mismatch",
    trade_state: "SUCCESS",
    amount: {
      total: 600
    },
    payer: {
      openid: "wx-openid-player"
    }
  };
  const merchantMismatchResource = encryptWechatCallbackResourceForTest(
    runtimeConfig.apiV3Key,
    JSON.stringify(merchantMismatchTransaction),
    "callback-nonce-merchant"
  );
  const merchantMismatchBody = JSON.stringify({
    id: "evt-merchant",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource: merchantMismatchResource
  });
  const merchantMismatchTimestamp = "1712197203";
  const merchantMismatchNonce = "signature-nonce-merchant";
  const merchantMismatchSignature = signWechatCallbackForTest(
    runtimeConfig.platformPrivateKey,
    merchantMismatchTimestamp,
    merchantMismatchNonce,
    merchantMismatchBody
  );
  const merchantMismatch = await callbackApp.invoke("/api/payments/wechat/callback", {
    headers: {
      "content-type": "application/json",
      "wechatpay-timestamp": merchantMismatchTimestamp,
      "wechatpay-nonce": merchantMismatchNonce,
      "wechatpay-serial": runtimeConfig.platformCertificateSerial,
      "wechatpay-signature": merchantMismatchSignature
    },
    body: merchantMismatchBody
  });
  const merchantMismatchPayload = merchantMismatch.json as { message: string };
  assert.equal(merchantMismatch.statusCode, 400);
  assert.equal(merchantMismatchPayload.message, "merchant validation failed");
});

test("wechat pay callback rejects missing order ids, missing orders, and missing payer bindings", async () => {
  const runtimeConfig = createWechatPayConfig();
  const callbackApp = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  registerWechatPayRoutes(callbackApp as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    now: buildFreshCallbackNow,
    fetchImpl: buildVerifyFetch({})
  });

  const missingOrderIdTransaction = {
    appid: runtimeConfig.appId,
    mchid: runtimeConfig.merchantId,
    out_trade_no: " ",
    transaction_id: "wechat-transaction-no-order",
    trade_state: "SUCCESS",
    amount: {
      total: 600
    },
    payer: {
      openid: "wx-openid-player"
    }
  };
  const missingOrderIdResource = encryptWechatCallbackResourceForTest(
    runtimeConfig.apiV3Key,
    JSON.stringify(missingOrderIdTransaction),
    "callback-nonce-order-id"
  );
  const missingOrderIdBody = JSON.stringify({
    id: "evt-missing-order-id",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource: missingOrderIdResource
  });
  const missingOrderIdTimestamp = "1712197204";
  const missingOrderIdNonce = "signature-nonce-order-id";
  const missingOrderIdSignature = signWechatCallbackForTest(
    runtimeConfig.platformPrivateKey,
    missingOrderIdTimestamp,
    missingOrderIdNonce,
    missingOrderIdBody
  );
  const missingOrderId = await callbackApp.invoke("/api/payments/wechat/callback", {
    headers: {
      "content-type": "application/json",
      "wechatpay-timestamp": missingOrderIdTimestamp,
      "wechatpay-nonce": missingOrderIdNonce,
      "wechatpay-serial": runtimeConfig.platformCertificateSerial,
      "wechatpay-signature": missingOrderIdSignature
    },
    body: missingOrderIdBody
  });
  const missingOrderIdPayload = missingOrderId.json as { message: string };
  assert.equal(missingOrderId.statusCode, 400);
  assert.equal(missingOrderIdPayload.message, "order identifiers are missing");

  const missingOrderTransaction = {
    appid: runtimeConfig.appId,
    mchid: runtimeConfig.merchantId,
    out_trade_no: "wechat-order-missing",
    transaction_id: "wechat-transaction-missing",
    trade_state: "SUCCESS",
    amount: {
      total: 600
    },
    payer: {
      openid: "wx-openid-player"
    }
  };
  const missingOrderResource = encryptWechatCallbackResourceForTest(
    runtimeConfig.apiV3Key,
    JSON.stringify(missingOrderTransaction),
    "callback-nonce-missing-order"
  );
  const missingOrderBody = JSON.stringify({
    id: "evt-missing-order",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource: missingOrderResource
  });
  const missingOrderTimestamp = "1712197205";
  const missingOrderNonce = "signature-nonce-missing-order";
  const missingOrderSignature = signWechatCallbackForTest(
    runtimeConfig.platformPrivateKey,
    missingOrderTimestamp,
    missingOrderNonce,
    missingOrderBody
  );
  const missingOrder = await callbackApp.invoke("/api/payments/wechat/callback", {
    headers: {
      "content-type": "application/json",
      "wechatpay-timestamp": missingOrderTimestamp,
      "wechatpay-nonce": missingOrderNonce,
      "wechatpay-serial": runtimeConfig.platformCertificateSerial,
      "wechatpay-signature": missingOrderSignature
    },
    body: missingOrderBody
  });
  const missingOrderPayload = missingOrder.json as { message: string };
  assert.equal(missingOrder.statusCode, 404);
  assert.equal(missingOrderPayload.message, "payment order not found");

  const orderWithoutBinding = await store.createPaymentOrder({
    orderId: "wechat-order-no-binding",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  const missingBindingTransaction = {
    appid: runtimeConfig.appId,
    mchid: runtimeConfig.merchantId,
    out_trade_no: orderWithoutBinding.orderId,
    transaction_id: "wechat-transaction-no-binding",
    trade_state: "SUCCESS",
    amount: {
      total: 600
    },
    payer: {
      openid: "wx-openid-player"
    }
  };
  const missingBindingResource = encryptWechatCallbackResourceForTest(
    runtimeConfig.apiV3Key,
    JSON.stringify(missingBindingTransaction),
    "callback-nonce-no-binding"
  );
  const missingBindingBody = JSON.stringify({
    id: "evt-no-binding",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource: missingBindingResource
  });
  const missingBindingTimestamp = "1712197206";
  const missingBindingNonce = "signature-nonce-no-binding";
  const missingBindingSignature = signWechatCallbackForTest(
    runtimeConfig.platformPrivateKey,
    missingBindingTimestamp,
    missingBindingNonce,
    missingBindingBody
  );
  const missingBinding = await callbackApp.invoke("/api/payments/wechat/callback", {
    headers: {
      "content-type": "application/json",
      "wechatpay-timestamp": missingBindingTimestamp,
      "wechatpay-nonce": missingBindingNonce,
      "wechatpay-serial": runtimeConfig.platformCertificateSerial,
      "wechatpay-signature": missingBindingSignature
    },
    body: missingBindingBody
  });
  const missingBindingPayload = missingBinding.json as { message: string };
  assert.equal(missingBinding.statusCode, 400);
  assert.equal(missingBindingPayload.message, "payer validation failed");
});

test("wechat pay verify persists grant_pending failures and admin retry can settle the order", async () => {
  const previousAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = "wechat-admin-token";
  try {
    resetRuntimeObservability();
    const app = new TestApp();
    const store = await createVerifiedTestStore();
    const runtimeConfig = createWechatPayConfig();
    const order = await store.createPaymentOrder({
      orderId: "wechat-order-retry",
      playerId: "wechat-player",
      productId: "gem-pack-equipment-retry",
      amount: 600,
      gemAmount: 120
    });
    registerWechatPayRoutes(app as never, store, {
      products: FAILING_GRANT_PRODUCTS,
      runtimeConfig,
      now: buildFreshCallbackNow,
      fetchImpl: buildVerifyFetch({
        out_trade_no: order.orderId
      })
    });
    const session = issueWechatSession();

    const verifyResponse = await app.invoke("/api/payments/wechat/verify", {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({
        orderId: order.orderId
      })
    });
    const verifyPayload = verifyResponse.json as { status: string; credited: boolean; nextGrantRetryAt?: string; lastGrantError?: string };
    const queuedOrder = await store.loadPaymentOrder(order.orderId);
    const receipt = await store.loadPaymentReceiptByOrderId(order.orderId);
    const accountBeforeRetry = await store.loadPlayerAccount("wechat-player");

    assert.equal(verifyResponse.statusCode, 200);
    assert.equal(verifyPayload.status, "grant_pending");
    assert.equal(verifyPayload.credited, false);
    assert.ok(verifyPayload.nextGrantRetryAt);
    assert.match(String(verifyPayload.lastGrantError), /player hero archive not found/);
    assert.equal(queuedOrder?.status, "grant_pending");
    assert.equal(queuedOrder?.grantAttemptCount, 1);
    assert.equal(receipt?.transactionId, "wechat-transaction-123");
    assert.equal(accountBeforeRetry?.gems ?? 0, 0);

    const runtimeBeforeRetry = await app.invoke("/api/runtime/wechat-payment-grants", { method: "GET" });
    const runtimeBeforeRetryPayload = runtimeBeforeRetry.json as { queueCount: number; deadLetterCount: number; pendingOrders: Array<{ orderId: string }> };
    assert.equal(runtimeBeforeRetry.statusCode, 200);
    assert.equal(runtimeBeforeRetryPayload.queueCount, 1);
    assert.equal(runtimeBeforeRetryPayload.deadLetterCount, 0);
    assert.equal(runtimeBeforeRetryPayload.pendingOrders[0]?.orderId, order.orderId);

    (
      store as unknown as {
        heroArchives: Map<string, { playerId: string; heroId: string; hero: { loadout: { inventory: unknown[] } } }>;
      }
    ).heroArchives.set("wechat-player:hero-1", {
      playerId: "wechat-player",
      heroId: "hero-1",
      hero: {
        loadout: {
          inventory: []
        }
      }
    });

    const retryResponse = await app.invoke("/api/admin/payments/wechat/retry", {
      headers: {
        "content-type": "application/json",
        "x-veil-admin-token": "wechat-admin-token"
      },
      body: JSON.stringify({
        orderId: order.orderId
      })
    });
    const retryPayload = retryResponse.json as { credited: boolean; order: { status: string; grantAttemptCount: number } };
    const settledOrder = await store.loadPaymentOrder(order.orderId);
    const accountAfterRetry = await store.loadPlayerAccount("wechat-player");

    assert.equal(retryResponse.statusCode, 200);
    assert.equal(retryPayload.credited, true);
    assert.equal(retryPayload.order.status, "settled");
    assert.equal(retryPayload.order.grantAttemptCount, 2);
    assert.equal(settledOrder?.status, "settled");
    assert.equal(accountAfterRetry?.gems, 120);

    const runtimeAfterRetry = await app.invoke("/api/runtime/wechat-payment-grants", { method: "GET" });
    const runtimeAfterRetryPayload = runtimeAfterRetry.json as { queueCount: number; deadLetterCount: number };
    assert.equal(runtimeAfterRetryPayload.queueCount, 0);
    assert.equal(runtimeAfterRetryPayload.deadLetterCount, 0);
  } finally {
    if (previousAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
    } else {
      process.env.VEIL_ADMIN_TOKEN = previousAdminToken;
    }
  }
});

test("wechat pay admin retry exhausts grant failures into dead_letter and exposes metrics", async () => {
  const previousAdminToken = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = "wechat-admin-token";
  try {
    resetRuntimeObservability();
    const app = new TestApp();
    const store = await createVerifiedTestStore();
    const runtimeConfig = createWechatPayConfig();
    const order = await store.createPaymentOrder({
      orderId: "wechat-order-dead-letter",
      playerId: "wechat-player",
      productId: "gem-pack-equipment-retry",
      amount: 600,
      gemAmount: 120
    });
    registerWechatPayRoutes(app as never, store, {
      products: FAILING_GRANT_PRODUCTS,
      runtimeConfig,
      now: buildFreshCallbackNow,
      fetchImpl: buildVerifyFetch({
        out_trade_no: order.orderId
      })
    });
    const session = issueWechatSession();

    await app.invoke("/api/payments/wechat/verify", {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({
        orderId: order.orderId
      })
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const retryResponse = await app.invoke("/api/admin/payments/wechat/retry", {
        headers: {
          "content-type": "application/json",
          "x-veil-admin-token": "wechat-admin-token"
        },
        body: JSON.stringify({
          orderId: order.orderId,
          includeDeadLetter: true
        })
      });
      assert.equal(retryResponse.statusCode, 200);
    }

    const deadLetterOrder = await store.loadPaymentOrder(order.orderId);
    const runtimePayload = (
      await app.invoke("/api/runtime/wechat-payment-grants", {
        method: "GET"
      })
    ).json as { queueCount: number; deadLetterCount: number; deadLetterOrders: Array<{ orderId: string }> };
    const metrics = buildPrometheusMetricsDocument();

    assert.equal(deadLetterOrder?.status, "dead_letter");
    assert.equal(deadLetterOrder?.grantAttemptCount, 5);
    assert.equal(runtimePayload.queueCount, 0);
    assert.equal(runtimePayload.deadLetterCount, 1);
    assert.equal(runtimePayload.deadLetterOrders[0]?.orderId, order.orderId);
    assert.match(metrics, /veil_payment_dead_letter_total 1/);
  } finally {
    if (previousAdminToken === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
    } else {
      process.env.VEIL_ADMIN_TOKEN = previousAdminToken;
    }
  }
});
