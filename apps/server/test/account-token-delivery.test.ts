import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import test from "node:test";
import {
  AccountTokenDeliveryConfigurationError,
  deliverAccountToken,
  readAccountRegistrationDeliveryMode,
  readPasswordRecoveryDeliveryMode
} from "@server/adapters/account-token-delivery";

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

async function startSmtpServer(): Promise<{
  close: () => Promise<void>;
  port: number;
  sessions: Array<{
    commands: string[];
    messages: string[];
  }>;
}> {
  const sessions: Array<{
    commands: string[];
    messages: string[];
  }> = [];
  const server = createNetServer((socket) => {
    const session = {
      commands: [] as string[],
      messages: [] as string[]
    };
    sessions.push(session);

    let buffer = "";
    let readingData = false;
    let messageLines: string[] = [];

    socket.setEncoding("utf8");
    socket.write("220 smtp.projectveil.test ESMTP ready\r\n");
    socket.on("data", (chunk: string | Buffer) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

      while (true) {
        if (readingData) {
          const terminatorIndex = buffer.indexOf("\r\n.\r\n");
          if (terminatorIndex < 0) {
            break;
          }
          const message = buffer.slice(0, terminatorIndex);
          buffer = buffer.slice(terminatorIndex + 5);
          session.messages.push(message);
          readingData = false;
          messageLines = [];
          socket.write("250 message accepted\r\n");
          continue;
        }

        const lineBreakIndex = buffer.indexOf("\r\n");
        if (lineBreakIndex < 0) {
          break;
        }

        const line = buffer.slice(0, lineBreakIndex);
        buffer = buffer.slice(lineBreakIndex + 2);
        session.commands.push(line);

        if (/^EHLO\b/i.test(line)) {
          socket.write("250-smtp.projectveil.test\r\n250 AUTH PLAIN\r\n");
          continue;
        }
        if (/^AUTH PLAIN\b/i.test(line)) {
          socket.write("235 authenticated\r\n");
          continue;
        }
        if (/^MAIL FROM:/i.test(line)) {
          socket.write("250 sender ok\r\n");
          continue;
        }
        if (/^RCPT TO:/i.test(line)) {
          socket.write("250 recipient ok\r\n");
          continue;
        }
        if (/^DATA$/i.test(line)) {
          readingData = true;
          messageLines = [];
          socket.write("354 end with <CRLF>.<CRLF>\r\n");
          continue;
        }
        if (/^QUIT$/i.test(line)) {
          socket.write("221 bye\r\n");
          socket.end();
          continue;
        }

        socket.write("502 command not implemented\r\n");
      }
    });
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
    throw new Error("smtp_server_address_unavailable");
  }

  return {
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    port: address.port,
    sessions
  };
}

test("delivery mode readers default to dev-token and accept smtp webhook or disabled", () => {
  assert.equal(readAccountRegistrationDeliveryMode({}), "dev-token");
  assert.equal(readAccountRegistrationDeliveryMode({ VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "smtp" }), "smtp");
  assert.equal(readAccountRegistrationDeliveryMode({ VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "webhook" }), "webhook");
  assert.equal(readAccountRegistrationDeliveryMode({ VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "disabled" }), "disabled");

  assert.equal(readPasswordRecoveryDeliveryMode({}), "dev-token");
  assert.equal(readPasswordRecoveryDeliveryMode({ VEIL_PASSWORD_RECOVERY_DELIVERY_MODE: "smtp" }), "smtp");
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
    deliveryStatus: "dev-token",
    responseToken: "dev-token-value"
  });
});

test("smtp delivery sends the token to a real mail transport without returning it in-band", async (t) => {
  const smtp = await startSmtpServer();

  t.after(async () => {
    await smtp.close().catch(() => undefined);
  });

  const result = await deliverAccountToken(
    "smtp",
    {
      kind: "password-recovery",
      loginId: "smtp-ranger",
      playerId: "player-123",
      token: "secret-token",
      expiresAt: "2026-03-29T00:00:00.000Z"
    },
    {
      VEIL_AUTH_TOKEN_DELIVERY_SMTP_HOST: "127.0.0.1",
      VEIL_AUTH_TOKEN_DELIVERY_SMTP_PORT: String(smtp.port),
      VEIL_AUTH_TOKEN_DELIVERY_SMTP_FROM: "noreply@projectveil.test",
      VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN: "mail.projectveil.test"
    }
  );

  assert.deepEqual(result, {
    deliveryMode: "smtp",
    deliveryStatus: "delivered",
    attemptCount: 1,
    maxAttempts: 4
  });
  assert.equal(smtp.sessions.length, 1);
  assert.match(smtp.sessions[0]?.commands[1] ?? "", /^MAIL FROM:<noreply@projectveil\.test>$/);
  assert.match(smtp.sessions[0]?.commands[2] ?? "", /^RCPT TO:<smtp-ranger@mail\.projectveil\.test>$/);
  const message = smtp.sessions[0]?.messages[0] ?? "";
  assert.match(message, /^From: noreply@projectveil\.test/m);
  assert.match(message, /^To: smtp-ranger@mail\.projectveil\.test/m);
  assert.match(message, /^Subject: \[ProjectVeil\] Password recovery token for smtp-ranger$/m);
  assert.match(message, /Token: secret-token/);
  assert.match(message, /Player ID: player-123/);
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
    deliveryMode: "webhook",
    deliveryStatus: "delivered",
    attemptCount: 1,
    maxAttempts: 4
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

test("smtp delivery requires a configured host", async () => {
  await assert.rejects(
    () =>
      deliverAccountToken(
        "smtp",
        {
          kind: "account-registration",
          loginId: "broken-ranger",
          token: "secret-token",
          expiresAt: "2026-03-29T00:00:00.000Z"
        },
        {
          VEIL_AUTH_TOKEN_DELIVERY_SMTP_FROM: "noreply@projectveil.test",
          VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN: "mail.projectveil.test"
        }
      ),
    (error: unknown) => error instanceof AccountTokenDeliveryConfigurationError
  );
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
