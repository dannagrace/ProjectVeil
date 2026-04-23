import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRedisClient } from "@server/infra/redis";

class FakeRedisClient extends EventEmitter {
  static instances: FakeRedisClient[] = [];

  readonly url: string;
  readonly options: {
    maxRetriesPerRequest: number;
    enableReadyCheck: boolean;
    connectTimeout: number;
    commandTimeout: number;
    retryStrategy: (attempt: number) => number;
  };

  constructor(
    url: string,
    options: {
      maxRetriesPerRequest: number;
      enableReadyCheck: boolean;
      connectTimeout: number;
      commandTimeout: number;
      retryStrategy: (attempt: number) => number;
    }
  ) {
    super();
    this.url = url;
    this.options = options;
    FakeRedisClient.instances.push(this);
  }
}

test("createRedisClient configures bounded retry and timeout options", () => {
  FakeRedisClient.instances.length = 0;

  createRedisClient("redis://project-veil-redis:6379/0", {
    RedisCtor: FakeRedisClient as never,
    recordRuntimeErrorEvent: () => {},
    logger: { warn() {} }
  });

  const client = FakeRedisClient.instances[0];
  assert.ok(client);
  assert.equal(client.url, "redis://project-veil-redis:6379/0");
  assert.equal(client.options.maxRetriesPerRequest, 3);
  assert.equal(client.options.enableReadyCheck, true);
  assert.equal(client.options.connectTimeout, 5_000);
  assert.equal(client.options.commandTimeout, 3_000);
  assert.equal(client.options.retryStrategy(1), 200);
  assert.equal(client.options.retryStrategy(30), 2_000);
});

test("createRedisClient captures error events in runtime observability and logs reconnects", () => {
  FakeRedisClient.instances.length = 0;
  const runtimeEvents: Array<{ errorCode: string; message: string; surface: string }> = [];
  const warnings: string[] = [];

  createRedisClient("redis://project-veil-redis:6379/0", {
    RedisCtor: FakeRedisClient as never,
    recordRuntimeErrorEvent: (event) => {
      runtimeEvents.push({
        errorCode: event.errorCode,
        message: event.message,
        surface: event.surface
      });
    },
    logger: {
      warn(message) {
        warnings.push(message);
      }
    }
  });

  const client = FakeRedisClient.instances[0];
  client.emit("error", new Error("redis auth failed"));
  client.emit("reconnecting", 600);

  assert.deepEqual(runtimeEvents, [
    {
      errorCode: "redis_client_error",
      message: "redis auth failed",
      surface: "redis-client"
    }
  ]);
  assert.deepEqual(warnings, ["Redis client reconnect scheduled in 600ms."]);
});
