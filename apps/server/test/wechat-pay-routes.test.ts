import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { issueAccountAuthSession } from "../src/auth";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import {
  encryptWechatCallbackResourceForTest,
  registerWechatPayRoutes,
  signWechatCallbackForTest,
  type WechatPayRuntimeConfig
} from "../src/wechat-pay";
import type { ShopProduct } from "../src/shop";

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
  private readonly postHandlers = new Map<string, (request: never, response: never) => void | Promise<void>>();

  use(handler: (request: never, response: never, next: () => void) => void): void {
    this.middlewares.push(handler);
  }

  post(path: string, handler: (request: never, response: never) => void | Promise<void>): void {
    this.postHandlers.set(path, handler);
  }

  async invoke(path: string, options: { body?: string; headers?: Record<string, string> } = {}) {
    const routeHandler = this.postHandlers.get(path);
    if (!routeHandler) {
      throw new Error(`No POST handler registered for ${path}`);
    }

    const request = Readable.from(options.body ? [Buffer.from(options.body, "utf8")] : []) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    request.method = "POST";
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
    status: "pending",
    amount: 600,
    gemAmount: 120,
    createdAt: order?.createdAt,
    updatedAt: order?.updatedAt
  });
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
  assert.equal(paidOrder?.status, "paid");
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

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 409);
  assert.equal(duplicatePayload.error.code, "payment_already_verified");
  assert.equal(account?.gems, 120);
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
  assert.equal(paidOrder?.status, "pending");
  assert.equal(receipt, null);
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
  const timestamp = "1712197200";
  const nonce = "signature-nonce-1";
  const signature = signWechatCallbackForTest(runtimeConfig.platformPrivateKey, timestamp, nonce, body);

  const sendCallback = async () =>
    app.invoke("/api/payments/wechat/callback", {
      headers: {
        "content-type": "application/json",
        "wechatpay-timestamp": timestamp,
        "wechatpay-nonce": nonce,
        "wechatpay-serial": runtimeConfig.platformCertificateSerial,
        "wechatpay-signature": signature
      },
      body
    });

  const firstResponse = await sendCallback();
  const secondResponse = await sendCallback();
  const account = await store.loadPlayerAccount("wechat-player");
  const paidOrder = await store.loadPaymentOrder(order.orderId);
  const receipt = await store.loadPaymentReceiptByOrderId(order.orderId);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(account?.gems, 120);
  assert.equal(paidOrder?.status, "paid");
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
  const timestamp = "1712197201";
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
  assert.equal(paidOrder?.status, "pending");
  assert.equal(receipt, null);
});

test("wechat pay callback rejects invalid signatures", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const runtimeConfig = createWechatPayConfig();
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig
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
