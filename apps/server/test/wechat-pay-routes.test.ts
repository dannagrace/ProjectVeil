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
    transactionsJsapiUrl: "https://wechat.example.test/v3/pay/transactions/jsapi"
  };
}

test("wechat pay create route creates a pending order and returns JSAPI payment parameters", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const runtimeConfig = createWechatPayConfig();
  await store.bindPlayerAccountWechatMiniGameIdentity("wechat-player", {
    openId: "wx-openid-player",
    displayName: "暮潮守望"
  });

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
  const session = issueAccountAuthSession({
    playerId: "wechat-player",
    displayName: "暮潮守望",
    loginId: "wechat-player",
    provider: "wechat-mini-game"
  });

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

test("wechat pay callback verifies, decrypts, and credits gems only once for duplicate notifications", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const runtimeConfig = createWechatPayConfig();
  await store.bindPlayerAccountWechatMiniGameIdentity("wechat-player", {
    openId: "wx-openid-player",
    displayName: "暮潮守望"
  });
  const order = await store.createPaymentOrder({
    orderId: "wechat-order-1",
    playerId: "wechat-player",
    productId: "gem-pack-premium",
    amount: 600,
    gemAmount: 120
  });
  registerWechatPayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig
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

  const sendCallback = async (wechatpaySignature: string) =>
    app.invoke("/api/payments/wechat/callback", {
      headers: {
        "content-type": "application/json",
        "wechatpay-timestamp": timestamp,
        "wechatpay-nonce": nonce,
        "wechatpay-serial": runtimeConfig.platformCertificateSerial,
        "wechatpay-signature": wechatpaySignature
      },
      body
    });

  const firstResponse = await sendCallback(signature);
  const secondResponse = await sendCallback(signature);
  const account = await store.loadPlayerAccount("wechat-player");
  const paidOrder = await store.loadPaymentOrder(order.orderId);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(account?.gems, 120);
  assert.equal(paidOrder?.status, "paid");
  assert.equal(paidOrder?.wechatOrderId, "wechat-transaction-123");
  assert.equal(paidOrder?.paidAt, "2026-04-04T01:02:03.000Z");
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
