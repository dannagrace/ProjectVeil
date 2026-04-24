import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { createDefaultPaymentGatewayRegistry } from "@server/domain/payment/DefaultPaymentGatewayRegistry";
import { handlePaymentRefundNotification } from "@server/domain/payment/PaymentRefundNotifications";
import { MemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";

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
    const routePath = new URL(path, "http://test.local").pathname;
    const routeHandler = this.postHandlers.get(routePath);
    if (!routeHandler) {
      throw new Error(`No POST handler registered for ${routePath}`);
    }

    const request = Readable.from(options.body ? [Buffer.from(options.body, "utf8")] : []) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    request.method = "POST";
    request.url = path;

    const response = new TestResponse();
    const handlers = [...this.middlewares, async (req: never, res: never) => routeHandler(req, res)];
    let index = 0;
    const next = (): void => {
      const handler = handlers[index];
      index += 1;
      if (handler) {
        void handler(request as never, response as never, next);
      }
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

function withGoogleRuntimeEnv<T>(callback: () => Promise<T>): Promise<T> {
  const keys = [
    "VEIL_GOOGLE_PLAY_PACKAGE_NAME",
    "VEIL_GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL",
    "VEIL_GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY",
    "VEIL_GOOGLE_PLAY_RTDN_SHARED_SECRET"
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  process.env.VEIL_GOOGLE_PLAY_PACKAGE_NAME = "com.projectveil.app";
  process.env.VEIL_GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL = "service-account@project-veil.test";
  process.env.VEIL_GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----";
  process.env.VEIL_GOOGLE_PLAY_RTDN_SHARED_SECRET = "veil-rtdn-secret";

  return callback().finally(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

function googleOrderIdForPurchaseToken(purchaseToken: string): string {
  return `google:${createHash("sha256").update(purchaseToken).digest("hex")}`;
}

test("default payment gateway registration claws back settled gems for Google voided purchase notifications", async () => {
  await withGoogleRuntimeEnv(async () => {
    const app = new TestApp();
    const store = new MemoryRoomSnapshotStore();
    const purchaseToken = "voided-google-purchase-token";
    const orderId = googleOrderIdForPurchaseToken(purchaseToken);

    await store.createPaymentOrder({
      orderId,
      playerId: "android-player",
      productId: "gem-pack-android",
      amount: 499,
      gemAmount: 60
    });
    await store.completePaymentOrder(orderId, {
      wechatOrderId: "google-transaction-hash",
      paidAt: "2026-04-23T08:00:00.000Z",
      verifiedAt: "2026-04-23T08:00:01.000Z",
      productName: "Android Gem Cache",
      grant: {
        gems: 60
      }
    });
    assert.equal((await store.loadPlayerAccount("android-player"))?.gems, 60);

    createDefaultPaymentGatewayRegistry().registerAll(app as never, store);

    const response = await app.invoke("/api/payments/google/rtdn?token=veil-rtdn-secret", {
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          messageId: "voided-purchase-message-1",
          data: Buffer.from(
            JSON.stringify({
              version: "1.0",
              packageName: "com.projectveil.app",
              eventTimeMillis: "1776931200000",
              voidedPurchaseNotification: {
                purchaseToken,
                orderId: "GPA.1234-5678-9012-34567",
                productType: 1,
                refundType: 1
              }
            }),
            "utf8"
          ).toString("base64")
        },
        subscription: "projects/project-veil/subscriptions/google-rtdn"
      })
    });

    assert.equal(response.statusCode, 200);
    assert.equal((response.json as { status?: string }).status, "processed");
    assert.equal((await store.loadPlayerAccount("android-player"))?.gems, 0);
    const refundedOrder = (await store.loadPaymentOrder(orderId)) as { refundedAt?: string; refundClawbackGems?: number };
    assert.equal(refundedOrder.refundClawbackGems, 60);
    assert.ok(refundedOrder.refundedAt);
  });
});

test("refund notification handler treats Apple revokes as idempotent gem clawbacks", async () => {
  const store = new MemoryRoomSnapshotStore();
  const orderId = "apple:1000001234500000";

  await store.createPaymentOrder({
    orderId,
    playerId: "ios-player",
    productId: "gem-pack-ios",
    amount: 499,
    gemAmount: 60
  });
  await store.completePaymentOrder(orderId, {
    wechatOrderId: "1000001234500000",
    paidAt: "2026-04-23T08:00:00.000Z",
    verifiedAt: "2026-04-23T08:00:01.000Z",
    productName: "iOS Gem Cache",
    grant: {
      gems: 60
    }
  });

  const firstResult = await handlePaymentRefundNotification(store, {
    channel: "apple",
    notificationType: "DID_REVOKE",
    orderId,
    eventId: "apple-revoke-1",
    eventTime: "2026-04-23T09:00:00.000Z",
    externalRefundId: "1000001234500000"
  });
  const duplicateResult = await handlePaymentRefundNotification(store, {
    channel: "apple",
    notificationType: "DID_REVOKE",
    orderId,
    eventId: "apple-revoke-1",
    eventTime: "2026-04-23T09:05:00.000Z",
    externalRefundId: "1000001234500000"
  });

  assert.equal(firstResult.status, "processed");
  assert.equal(duplicateResult.status, "duplicate");
  assert.equal((await store.loadPlayerAccount("ios-player"))?.gems, 0);
  const refundedOrder = (await store.loadPaymentOrder(orderId)) as { refundReason?: string; refundClawbackGems?: number };
  assert.equal(refundedOrder.refundReason, "apple:DID_REVOKE");
  assert.equal(refundedOrder.refundClawbackGems, 60);
});
