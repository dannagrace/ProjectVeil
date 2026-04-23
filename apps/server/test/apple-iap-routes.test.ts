import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { issueAccountAuthSession } from "@server/domain/account/auth";
import {
  AppleIapVerificationError,
  createAppleStoreKitVerificationAdapter,
  registerApplePaymentRoutes,
  type AppleIapRuntimeConfig,
  type AppleVerifiedTransaction
} from "@server/adapters/apple-iap";
import { MemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import type { ShopProduct } from "@server/domain/economy/shop";

const TEST_PRODUCTS: Partial<ShopProduct>[] = [
  {
    productId: "gem-pack-ios",
    appleProductId: "com.projectveil.gems.ios",
    applePriceCents: 499,
    name: "iOS Gem Cache",
    type: "gem_pack",
    price: 5,
    enabled: true,
    grant: {
      gems: 60
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

  async invoke(path: string, options: { body?: string; headers?: Record<string, string>; method?: "POST" | "OPTIONS" } = {}) {
    const method = options.method ?? "POST";
    const routePath = new URL(path, "http://test.local").pathname;
    const routeHandler = this.postHandlers.get(routePath);
    if (!routeHandler) {
      throw new Error(`No ${method} handler registered for ${routePath}`);
    }

    const request = Readable.from(options.body ? [Buffer.from(options.body, "utf8")] : []) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
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

function issueSession() {
  return issueAccountAuthSession({
    playerId: "ios-player",
    displayName: "App Store Ranger",
    loginId: "ios-player",
    provider: "account-password"
  });
}

function createVerifiedTransaction(overrides: Partial<AppleVerifiedTransaction> = {}): AppleVerifiedTransaction {
  return {
    transactionId: "1000001234567890",
    productId: "com.projectveil.gems.ios",
    environment: "Production",
    bundleId: "com.projectveil.app",
    purchaseDate: "2026-04-13T01:17:00.000Z",
    ...overrides
  };
}

function createAppleRuntimeConfig(): AppleIapRuntimeConfig {
  const signingKeys = generateKeyPairSync("ec", {
    namedCurve: "prime256v1"
  });

  return {
    bundleId: "com.projectveil.app",
    issuerId: "11111111-2222-3333-4444-555555555555",
    keyId: "ABC123DEFG",
    privateKey: signingKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    productionApiUrl: "https://apple.example.test",
    sandboxApiUrl: "https://apple-sandbox.example.test"
  };
}

test("apple verify settles a StoreKit 2 transaction through the shared payment flow", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const session = issueSession();

  registerApplePaymentRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    adapter: {
      verifyTransaction: async () => createVerifiedTransaction()
    }
  });

  const response = await app.invoke("/api/payments/apple/verify", {
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      signedTransactionInfo: "client-jws"
    })
  });

  const payload = response.json as {
    orderId: string;
    status: string;
    credited: boolean;
    transactionId: string;
    environment: string;
    gemsBalance: number;
  };
  const order = await store.loadPaymentOrder(payload.orderId);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.orderId, "apple:1000001234567890");
  assert.equal(payload.status, "settled");
  assert.equal(payload.credited, true);
  assert.equal(payload.transactionId, "1000001234567890");
  assert.equal(payload.environment, "Production");
  assert.equal(payload.gemsBalance, 60);
  assert.equal(order?.status, "settled");
  assert.equal(order?.wechatOrderId, "1000001234567890");
});

test("apple verify rejects duplicate transaction ids through the shared idempotency guard", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const session = issueSession();

  registerApplePaymentRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    adapter: {
      verifyTransaction: async () => createVerifiedTransaction()
    }
  });

  const firstResponse = await app.invoke("/api/payments/apple/verify", {
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      signedTransactionInfo: "client-jws"
    })
  });
  const secondResponse = await app.invoke("/api/payments/apple/verify", {
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      signedTransactionInfo: "client-jws"
    })
  });

  const errorPayload = secondResponse.json as { error: { code: string; retryable: boolean } };
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 409);
  assert.equal(errorPayload.error.code, "payment_already_verified");
  assert.equal(errorPayload.error.retryable, false);
});

test("apple verify returns a permanent structured error when signature validation fails", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const session = issueSession();

  registerApplePaymentRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    adapter: {
      verifyTransaction: async () => {
        throw new AppleIapVerificationError({
          code: "apple_signature_invalid",
          message: "Apple transaction signature validation failed",
          retryable: false,
          statusCode: 400,
          category: "verification"
        });
      }
    }
  });

  const response = await app.invoke("/api/payments/apple/verify", {
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      signedTransactionInfo: "bad-client-jws"
    })
  });

  const payload = response.json as { error: { code: string; retryable: boolean; category: string } };
  assert.equal(response.statusCode, 400);
  assert.equal(payload.error.code, "apple_signature_invalid");
  assert.equal(payload.error.retryable, false);
  assert.equal(payload.error.category, "verification");
});

test("apple notifications verify signed payloads and surface duplicate-safe handler results", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const seenEvents: Array<{
    notificationId: string;
    notificationType: string;
    subtype?: string;
    orderId?: string;
    transactionId?: string;
  }> = [];

  registerApplePaymentRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    verifyNotificationPayload: async () => ({
      notificationId: "apple-notification-1",
      notificationType: "REFUND",
      subtype: "VOLUNTARY",
      signedDate: "2026-04-23T09:00:00.000Z",
      transaction: createVerifiedTransaction({
        originalTransactionId: "1000001234500000"
      }),
      rawPayload: {
        notificationUUID: "apple-notification-1",
        notificationType: "REFUND",
        subtype: "VOLUNTARY"
      }
    }),
    notificationHandler: async (event) => {
      seenEvents.push({
        notificationId: event.notificationId,
        notificationType: event.notificationType,
        subtype: event.subtype,
        orderId: event.orderId,
        transactionId: event.transaction?.transactionId
      });

      return {
        status: seenEvents.length === 1 ? "processed" : "duplicate"
      };
    }
  });

  const firstResponse = await app.invoke("/api/payments/apple/notifications", {
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      signedPayload: "apple-notification-jws"
    })
  });
  const secondResponse = await app.invoke("/api/payments/apple/notifications", {
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      signedPayload: "apple-notification-jws"
    })
  });

  const firstPayload = firstResponse.json as {
    acknowledged: boolean;
    status: string;
    notificationId: string;
    notificationType: string;
  };
  const secondPayload = secondResponse.json as {
    acknowledged: boolean;
    status: string;
    notificationId: string;
    notificationType: string;
  };

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  assert.deepEqual(seenEvents, [
    {
      notificationId: "apple-notification-1",
      notificationType: "REFUND",
      subtype: "VOLUNTARY",
      orderId: "apple:1000001234567890",
      transactionId: "1000001234567890"
    },
    {
      notificationId: "apple-notification-1",
      notificationType: "REFUND",
      subtype: "VOLUNTARY",
      orderId: "apple:1000001234567890",
      transactionId: "1000001234567890"
    }
  ]);
  assert.deepEqual(firstPayload, {
    acknowledged: true,
    status: "processed",
    notificationId: "apple-notification-1",
    notificationType: "REFUND"
  });
  assert.deepEqual(secondPayload, {
    acknowledged: true,
    status: "duplicate",
    notificationId: "apple-notification-1",
    notificationType: "REFUND"
  });
  assert.equal("signedPayload" in firstPayload, false);
});

test("apple notifications return structured verification errors for invalid signed payloads", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();

  registerApplePaymentRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    verifyNotificationPayload: async () => {
      throw new AppleIapVerificationError({
        code: "apple_notification_signature_invalid",
        message: "Apple notification signature validation failed",
        retryable: false,
        statusCode: 400,
        category: "verification"
      });
    }
  });

  const response = await app.invoke("/api/payments/apple/notifications", {
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      signedPayload: "bad-notification-jws"
    })
  });

  const payload = response.json as { error: { code: string; retryable: boolean; category: string } };
  assert.equal(response.statusCode, 400);
  assert.equal(payload.error.code, "apple_notification_signature_invalid");
  assert.equal(payload.error.retryable, false);
  assert.equal(payload.error.category, "verification");
});

test("apple adapter retries sandbox after a production transaction lookup miss", async () => {
  const runtimeConfig = createAppleRuntimeConfig();
  const seenUrls: string[] = [];
  const adapter = createAppleStoreKitVerificationAdapter({
    config: runtimeConfig,
    fetchImpl: (async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      seenUrls.push(url);
      if (url.startsWith(runtimeConfig.productionApiUrl)) {
        return new Response(
          JSON.stringify({
            errorCode: "4040010",
            errorMessage: "TransactionIdNotFound"
          }),
          {
            status: 404,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      return new Response(JSON.stringify({ signedTransactionInfo: "sandbox-jws" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }) as typeof fetch,
    verifySignedTransaction: (signedTransactionInfo, config) => {
      assert.equal(config.bundleId, "com.projectveil.app");
      if (signedTransactionInfo === "client-jws") {
        return createVerifiedTransaction({
          environment: "Production"
        });
      }
      if (signedTransactionInfo === "sandbox-jws") {
        return createVerifiedTransaction({
          environment: "Sandbox"
        });
      }
      throw new Error(`Unexpected token ${signedTransactionInfo}`);
    }
  });

  const verified = await adapter.verifyTransaction({
    signedTransactionInfo: "client-jws"
  });

  assert.equal(verified.environment, "Sandbox");
  assert.deepEqual(seenUrls, [
    "https://apple.example.test/inApps/v1/transactions/1000001234567890",
    "https://apple-sandbox.example.test/inApps/v1/transactions/1000001234567890"
  ]);
});
