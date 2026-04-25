import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import test from "node:test";
import {
  AccountTokenDeliveryConfigurationError,
  configureAccountTokenDeliveryQueuePersistence,
  createRedisAccountTokenDeliveryQueuePersistence,
  deliverAccountToken,
  readAccountRegistrationDeliveryMode,
  readPasswordRecoveryDeliveryMode,
  resetAccountTokenDeliveryState
} from "@server/adapters/account-token-delivery";
import type { RedisClientLike } from "@server/infra/redis";

class MemoryRedisClient implements RedisClientLike {
  private readonly values = new Map<string, string>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly lists = new Map<string, string[]>();

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.values.delete(key)) {
        deleted += 1;
      }
      if (this.hashes.delete(key)) {
        deleted += 1;
      }
      if (this.lists.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async eval(_script: string, _numKeys: number, ...args: string[]): Promise<unknown> {
    const [key, expectedValue] = args;
    if (key && this.values.get(key) === expectedValue) {
      this.values.delete(key);
      return 1;
    }
    return 0;
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);
    if (!hash) {
      return 0;
    }
    let deleted = 0;
    for (const field of fields) {
      if (hash.delete(field)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map<string, string>();
      this.hashes.set(key, hash);
    }
    const isNew = !hash.has(field);
    hash.set(field, value);
    return isNew ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const value = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(value));
    return value;
  }

  async lindex(key: string, index: number): Promise<string | null> {
    return this.lists.get(key)?.[index] ?? null;
  }

  async linsert(key: string, direction: "BEFORE" | "AFTER", pivot: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    const index = list.indexOf(pivot);
    if (index < 0) {
      return -1;
    }
    list.splice(direction === "BEFORE" ? index : index + 1, 0, value);
    this.lists.set(key, list);
    return list.length;
  }

  async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    const normalizedStop = stop < 0 ? list.length + stop : stop;
    return list.slice(start, normalizedStop + 1);
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    let removed = 0;
    const next = list.filter((entry) => {
      if ((count === 0 || removed < count) && entry === value) {
        removed += 1;
        return false;
      }
      return true;
    });
    this.lists.set(key, next);
    return removed;
  }

  async quit(): Promise<unknown> {
    return undefined;
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.push(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async set(
    key: string,
    value: string,
    _mode?: "PX",
    _durationMs?: number,
    condition?: "NX"
  ): Promise<"OK" | null> {
    if (condition === "NX" && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return "OK";
  }
}

async function startWebhookServer(options: { statusCode?: number } = {}): Promise<{
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

    response.statusCode = options.statusCode ?? 204;
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

test("production delivery mode readers reject missing, unknown, and dev-token modes", () => {
  assert.throws(
    () =>
      readAccountRegistrationDeliveryMode({
        NODE_ENV: "production",
        VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: undefined
      }),
    AccountTokenDeliveryConfigurationError
  );
  assert.throws(
    () =>
      readAccountRegistrationDeliveryMode({
        NODE_ENV: "production",
        VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "dev-token"
      }),
    AccountTokenDeliveryConfigurationError
  );
  assert.throws(
    () =>
      readPasswordRecoveryDeliveryMode({
        NODE_ENV: "production",
        VEIL_PASSWORD_RECOVERY_DELIVERY_MODE: "not-a-real-mode"
      }),
    AccountTokenDeliveryConfigurationError
  );
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

test("production dev-token delivery is rejected before a token can be returned in-band", async () => {
  await assert.rejects(
    () =>
      deliverAccountToken(
        "dev-token",
        {
          kind: "password-recovery",
          loginId: "prod-ranger",
          playerId: "player-123",
          token: "prod-token-value",
          expiresAt: "2026-03-29T00:00:00.000Z"
        },
        {
          NODE_ENV: "production"
        }
      ),
    (error: unknown) => error instanceof AccountTokenDeliveryConfigurationError
  );
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

test("webhook retry queue restores queued token deliveries from Redis persistence across restarts", async (t) => {
  const redis = new MemoryRedisClient();
  const persistence = createRedisAccountTokenDeliveryQueuePersistence(redis, {
    namespace: `account-token-delivery:test:${Date.now()}`
  });
  const webhook = await startWebhookServer({ statusCode: 500 });
  const payload = {
    kind: "password-recovery" as const,
    loginId: "restart-ranger",
    playerId: "player-restore",
    token: "restore-token",
    expiresAt: "2099-03-29T00:00:00.000Z"
  };
  const env = {
    VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL: webhook.url,
    VEIL_AUTH_TOKEN_DELIVERY_MAX_ATTEMPTS: "3",
    VEIL_AUTH_TOKEN_DELIVERY_RETRY_BASE_DELAY_MS: "600000",
    VEIL_AUTH_TOKEN_DELIVERY_RETRY_MAX_DELAY_MS: "600000"
  };

  t.after(async () => {
    resetAccountTokenDeliveryState();
    await configureAccountTokenDeliveryQueuePersistence(null);
    await webhook.close().catch(() => undefined);
  });

  await configureAccountTokenDeliveryQueuePersistence(persistence);

  const initialResult = await deliverAccountToken("webhook", payload, env);
  assert.equal(initialResult.deliveryStatus, "retry_scheduled");
  assert.equal(initialResult.attemptCount, 1);
  assert.equal(webhook.requests.length, 1);

  resetAccountTokenDeliveryState();
  await configureAccountTokenDeliveryQueuePersistence(persistence);

  const restoredResult = await deliverAccountToken("webhook", payload, env);
  assert.equal(restoredResult.deliveryStatus, "retry_scheduled");
  assert.equal(restoredResult.attemptCount, 1);
  assert.equal(webhook.requests.length, 1);
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
