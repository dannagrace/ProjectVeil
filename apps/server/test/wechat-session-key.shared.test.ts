import assert from "node:assert/strict";
import test from "node:test";
import { createWechatSessionKeyCache } from "@server/adapters/wechat-session-key";
import { resetRuntimeSecretsForTest, setRuntimeSecretsForTest } from "@server/infra/runtime-secrets";
import type { RedisClientLike } from "@server/infra/redis";

class MemoryWechatSessionRedis {
  readonly values = new Map<string, string>();
  private readonly expiresAtByKey = new Map<string, number>();

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.values.delete(key)) {
        deleted += 1;
      }
      this.expiresAtByKey.delete(key);
    }
    return deleted;
  }

  async get(key: string): Promise<string | null> {
    const expiresAt = this.expiresAtByKey.get(key);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.values.delete(key);
      this.expiresAtByKey.delete(key);
      return null;
    }
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, mode?: "EX" | "PX", duration?: number): Promise<"OK"> {
    this.values.set(key, value);
    if (mode === "EX" && duration !== undefined) {
      this.expiresAtByKey.set(key, Date.now() + duration * 1000);
    } else if (mode === "PX" && duration !== undefined) {
      this.expiresAtByKey.set(key, Date.now() + duration);
    }
    return "OK";
  }
}

test("redis-backed wechat session key cache shares entries across pod instances without plaintext storage", async (t) => {
  setRuntimeSecretsForTest({ VEIL_AUTH_SECRET: "wechat-session-key-cache-test-secret" });
  t.after(() => resetRuntimeSecretsForTest());

  const redis = new MemoryWechatSessionRedis();
  const redisClient = redis as unknown as RedisClientLike;
  const podA = createWechatSessionKeyCache({ redisClient });
  const podB = createWechatSessionKeyCache({ redisClient });

  await podA.cache("wechat-player", "pod-a-session-key", 60);

  const sharedSnapshot = await podB.get("wechat-player");
  assert.equal(sharedSnapshot?.playerId, "wechat-player");
  assert.equal(sharedSnapshot?.sessionKey, "pod-a-session-key");

  assert.equal(
    Array.from(redis.values.values()).some((value) => value.includes("pod-a-session-key")),
    false,
    "Redis value must not store the raw WeChat session key"
  );
});
