import assert from "node:assert/strict";
import { test } from "@playwright/test";
import { createDefaultPaymentGatewayRegistry } from "../../apps/server/src/domain/payment/DefaultPaymentGatewayRegistry.ts";
import { PaymentGatewayOperationUnsupportedError } from "../../apps/server/src/domain/payment/PaymentGateway.ts";

class ContractTestApp {
  readonly middlewares: Array<unknown> = [];
  readonly gets: string[] = [];
  readonly posts: string[] = [];

  use(handler: unknown): void {
    this.middlewares.push(handler);
  }

  get(path: string, _handler?: unknown): void {
    this.gets.push(path);
  }

  post(path: string, _handler?: unknown): void {
    this.posts.push(path);
  }
}

test("payment gateway registry exposes the three launch payment channels", async () => {
  const registry = createDefaultPaymentGatewayRegistry();
  const registrations = registry.list();

  assert.deepEqual(
    registrations.map((registration) => registration.gateway.channel),
    ["apple", "google", "wechat"]
  );

  assert.deepEqual(registry.get("apple").gateway.supportedOperations, ["grantRewards"]);
  assert.deepEqual(registry.get("google").gateway.supportedOperations, ["grantRewards"]);
  assert.deepEqual(registry.get("wechat").gateway.supportedOperations, ["createOrder", "verifyCallback", "grantRewards"]);
});

test("payment gateway registry wires route adapters for each channel", async () => {
  const registry = createDefaultPaymentGatewayRegistry();
  const app = new ContractTestApp();

  registry.registerAll(app, null);

  assert.ok(app.middlewares.length >= 3);
  assert.deepEqual(
    app.posts.sort(),
    [
      "/api/payments/apple/verify",
      "/api/payments/google/verify",
      "/api/admin/payments/wechat/retry",
      "/api/payments/wechat/callback",
      "/api/payments/wechat/create",
      "/api/payments/wechat/verify"
    ].sort()
  );
  assert.deepEqual(app.gets.sort(), ["/api/admin/payments/wechat/orders", "/api/runtime/wechat-payment-grants"].sort());
});

test("payment gateways reject unsupported unbound operations with explicit errors", async () => {
  const registry = createDefaultPaymentGatewayRegistry();

  await assert.rejects(
    registry.get("apple").gateway.createOrder({
      playerId: "player-1",
      productId: "gem-pack-ios",
      amount: 499
    }),
    (error) =>
      error instanceof PaymentGatewayOperationUnsupportedError &&
      error.channel === "apple" &&
      error.operation === "createOrder"
  );

  await assert.rejects(
    registry.get("google").gateway.verifyCallback({
      body: { purchaseToken: "token-1" }
    }),
    (error) =>
      error instanceof PaymentGatewayOperationUnsupportedError &&
      error.channel === "google" &&
      error.operation === "verifyCallback"
  );

  await assert.rejects(
    registry.get("wechat").gateway.issueRefund(
      {
        channel: "wechat",
        orderId: "wechat-order-1",
        playerId: "player-1",
        productId: "gem-pack-premium",
        amount: 600
      },
      {
        code: "manual_review",
        message: "Manual refund review is required"
      }
    ),
    (error) =>
      error instanceof PaymentGatewayOperationUnsupportedError &&
      error.channel === "wechat" &&
      error.operation === "issueRefund"
  );
});
