import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  AccountTokenDeliveryConfigurationError,
  deliverAccountToken,
  readAccountRegistrationDeliveryMode,
  readPasswordRecoveryDeliveryMode
} from "../src/account-token-delivery";

async function startWebhookServer(): Promise<{
  close: () => Promise<void>;
  requests: Array<{ headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }>;
  url: string;
}> {
  const requests: Array<{ headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    requests.push({
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>
    });

    response.statusCode = 204;
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("webhook_server_address_unavailable");
  }

  return {
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    requests,
    url: `http://127.0.0.1:${address.port}/token-delivery`
  };
}

test("delivery mode readers default to dev-token and accept webhook or disabled", () => {
  assert.equal(readAccountRegistrationDeliveryMode({}), "dev-token");
  assert.equal(readAccountRegistrationDeliveryMode({ VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "webhook" }), "webhook");
  assert.equal(readAccountRegistrationDeliveryMode({ VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "disabled" }), "disabled");

  assert.equal(readPasswordRecoveryDeliveryMode({}), "dev-token");
  assert.equal(readPasswordRecoveryDeliveryMode({ VEIL_PASSWORD_RECOVERY_DELIVERY_MODE: "webhook" }), "webhook");
  assert.equal(readPasswordRecoveryDeliveryMode({ VEIL_PASSWORD_RECOVERY_DELIVERY_MODE: "disabled" }), "disabled");
});

test("dev-token delivery returns the token in-band", async () => {
  const result = await deliverAccountToken("dev-token", {
    kind: "account-registration",
    loginId: "dev-ranger",
    token: "dev-token-value",
    expiresAt: "2026-03-29T00:00:00.000Z",
    requestedDisplayName: "Dev Ranger"
  });

  assert.deepEqual(result, {
    deliveryMode: "dev-token",
    responseToken: "dev-token-value"
  });
});

test("webhook delivery posts the token payload without returning it in-band", async (t) => {
  const webhook = await startWebhookServer();

  t.after(async () => {
    await webhook.close().catch(() => undefined);
  });

  const result = await deliverAccountToken(
    "webhook",
    {
      kind: "password-recovery",
      loginId: "webhook-ranger",
      playerId: "player-123",
      token: "secret-token",
      expiresAt: "2026-03-29T00:00:00.000Z"
    },
    {
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL: webhook.url,
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN: "delivery-secret"
    }
  );

  assert.deepEqual(result, {
    deliveryMode: "webhook"
  });
  assert.equal(webhook.requests.length, 1);
  assert.equal(webhook.requests[0]?.headers.authorization, "Bearer delivery-secret");
  assert.deepEqual(webhook.requests[0]?.body, {
    event: "password-recovery",
    loginId: "webhook-ranger",
    playerId: "player-123",
    token: "secret-token",
    expiresAt: "2026-03-29T00:00:00.000Z"
  });
});

test("webhook delivery requires a configured URL", async () => {
  await assert.rejects(
    () =>
      deliverAccountToken(
        "webhook",
        {
          kind: "account-registration",
          loginId: "broken-ranger",
          token: "secret-token",
          expiresAt: "2026-03-29T00:00:00.000Z"
        },
        {}
      ),
    (error: unknown) => error instanceof AccountTokenDeliveryConfigurationError
  );
});
