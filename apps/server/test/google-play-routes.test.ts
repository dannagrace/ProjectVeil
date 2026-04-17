import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { issueAccountAuthSession } from "../src/auth";
import {
  createGooglePlayBillingVerificationAdapter,
  GooglePlayBillingVerificationError,
  registerGooglePlayRoutes,
  type GooglePlayBillingRuntimeConfig,
  type GoogleVerifiedProductPurchase
} from "../src/adapters/google-play";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import type { ShopProduct } from "../src/shop";

const TEST_PRODUCTS: Partial<ShopProduct>[] = [
  {
    productId: "gem-pack-android",
    googleProductId: "com.projectveil.gems.android",
    googlePriceCents: 499,
    name: "Android Gem Cache",
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
    playerId: "android-player",
    displayName: "Play Store Ranger",
    loginId: "android-player",
    provider: "account-password"
  });
}

function createVerifiedPurchase(overrides: Partial<GoogleVerifiedProductPurchase> = {}): GoogleVerifiedProductPurchase {
  return {
    orderId: "GPA.1234-5678-9012-34567",
    purchaseToken: "purchase-token-123",
    productId: "com.projectveil.gems.android",
    packageName: "com.projectveil.app",
    purchaseDate: "2026-04-13T01:17:00.000Z",
    environment: "Production",
    acknowledgementState: 0,
    consumptionState: 0,
    ...overrides
  };
}

function createGoogleRuntimeConfig(): GooglePlayBillingRuntimeConfig {
  const signingKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });

  return {
    packageName: "com.projectveil.app",
    serviceAccountEmail: "play-billing@project-veil.iam.gserviceaccount.com",
    privateKey: signingKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    oauthTokenUrl: "https://oauth.example.test/token",
    androidPublisherApiUrl: "https://androidpublisher.example.test/androidpublisher/v3"
  };
}

test("google verify settles a Play Billing purchase through the shared payment flow", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const session = issueSession();
  const runtimeConfig = createGoogleRuntimeConfig();

  let acknowledged = 0;
  let consumed = 0;
  registerGooglePlayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    adapter: {
      verifyProductPurchase: async () => createVerifiedPurchase(),
      acknowledgeProductPurchase: async () => {
        acknowledged += 1;
      },
      consumeProductPurchase: async () => {
        consumed += 1;
      }
    }
  });

  const response = await app.invoke("/api/payments/google/verify", {
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      productId: "gem-pack-android",
      purchaseToken: "purchase-token-123"
    })
  });

  const payload = response.json as {
    orderId: string;
    status: string;
    credited: boolean;
    googleOrderId: string;
    environment: string;
    gemsBalance: number;
  };
  const order = await store.loadPaymentOrder(payload.orderId);
  const receipt = await store.loadPaymentReceiptByOrderId(payload.orderId);

  assert.equal(response.statusCode, 200);
  assert.match(payload.orderId, /^google:[0-9a-f]{64}$/);
  assert.equal(payload.status, "settled");
  assert.equal(payload.credited, true);
  assert.equal(payload.googleOrderId, "GPA.1234-5678-9012-34567");
  assert.equal(payload.environment, "Production");
  assert.equal(payload.gemsBalance, 60);
  assert.equal(order?.status, "settled");
  assert.equal(receipt?.transactionId.length, 64);
  assert.equal(acknowledged, 1);
  assert.equal(consumed, 1);
});

test("google verify rejects already-consumed purchase tokens before fulfillment", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const session = issueSession();
  const runtimeConfig = createGoogleRuntimeConfig();

  registerGooglePlayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    adapter: {
      verifyProductPurchase: async () =>
        createVerifiedPurchase({
          acknowledgementState: 1,
          consumptionState: 1
        }),
      acknowledgeProductPurchase: async () => undefined,
      consumeProductPurchase: async () => undefined
    }
  });

  const response = await app.invoke("/api/payments/google/verify", {
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      productId: "gem-pack-android",
      purchaseToken: "purchase-token-123"
    })
  });

  const payload = response.json as { error: { code: string; retryable: boolean; category: string } };
  assert.equal(response.statusCode, 409);
  assert.equal(payload.error.code, "google_purchase_token_consumed");
  assert.equal(payload.error.retryable, false);
  assert.equal(payload.error.category, "verification");
  assert.equal(await store.listPaymentOrders?.({ limit: 10 }).then((orders) => orders[0]?.status), "created");
});

test("google verify returns a permanent structured error when verification fails", async () => {
  const app = new TestApp();
  const store = new MemoryRoomSnapshotStore();
  const session = issueSession();
  const runtimeConfig = createGoogleRuntimeConfig();

  registerGooglePlayRoutes(app as never, store, {
    products: TEST_PRODUCTS,
    runtimeConfig,
    adapter: {
      verifyProductPurchase: async () => {
        throw new GooglePlayBillingVerificationError({
          code: "google_signature_invalid",
          message: "Google Play purchase token is invalid",
          retryable: false,
          statusCode: 400,
          category: "verification"
        });
      },
      acknowledgeProductPurchase: async () => undefined,
      consumeProductPurchase: async () => undefined
    }
  });

  const response = await app.invoke("/api/payments/google/verify", {
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      productId: "gem-pack-android",
      purchaseToken: "bad-purchase-token"
    })
  });

  const payload = response.json as { error: { code: string; retryable: boolean; category: string } };
  assert.equal(response.statusCode, 400);
  assert.equal(payload.error.code, "google_signature_invalid");
  assert.equal(payload.error.retryable, false);
  assert.equal(payload.error.category, "verification");
});

test("google adapter validates purchases through purchases.products.get and recognizes test purchases", async () => {
  const runtimeConfig = createGoogleRuntimeConfig();
  const seenRequests: Array<{ url: string; method: string; body: string }> = [];
  const adapter = createGooglePlayBillingVerificationAdapter({
    config: runtimeConfig,
    fetchImpl: (async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof URLSearchParams
            ? init.body.toString()
            : "";
      seenRequests.push({ url, method, body });

      if (url === runtimeConfig.oauthTokenUrl) {
        return new Response(
          JSON.stringify({
            access_token: "google-access-token"
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      if (url.includes(":acknowledge") || url.includes(":consume")) {
        return new Response("{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }

      return new Response(
        JSON.stringify({
          orderId: "GPA.1111-2222-3333-44444",
          purchaseTimeMillis: String(Date.parse("2026-04-13T01:17:00.000Z")),
          purchaseState: 0,
          consumptionState: 0,
          acknowledgementState: 0,
          purchaseType: 0
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch
  });

  const verified = await adapter.verifyProductPurchase({
    packageName: runtimeConfig.packageName,
    productId: "com.projectveil.gems.android",
    purchaseToken: "purchase-token-123"
  });
  await adapter.acknowledgeProductPurchase({
    packageName: runtimeConfig.packageName,
    productId: "com.projectveil.gems.android",
    purchaseToken: "purchase-token-123",
    developerPayload: "android-player"
  });
  await adapter.consumeProductPurchase({
    packageName: runtimeConfig.packageName,
    productId: "com.projectveil.gems.android",
    purchaseToken: "purchase-token-123"
  });

  assert.equal(verified.orderId, "GPA.1111-2222-3333-44444");
  assert.equal(verified.environment, "Test");
  assert.equal(verified.acknowledgementState, 0);
  assert.equal(verified.consumptionState, 0);
  assert.equal(seenRequests.filter((entry) => entry.method === "GET").length, 1);
  assert.equal(seenRequests.filter((entry) => entry.url.includes(":acknowledge")).length, 1);
  assert.equal(seenRequests.filter((entry) => entry.url.includes(":consume")).length, 1);
  assert.ok(
    seenRequests.some(
      (entry) =>
        entry.url.includes("/applications/com.projectveil.app/purchases/products/com.projectveil.gems.android/tokens/purchase-token-123")
    )
  );
});
