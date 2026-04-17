import assert from "node:assert/strict";
import test from "node:test";
import { closeRedisResource, readRedisUrl } from "../src/infra/redis";

// readRedisUrl

test("readRedisUrl returns the trimmed URL when REDIS_URL is set", () => {
  const result = readRedisUrl({ REDIS_URL: "redis://localhost:6379" });
  assert.equal(result, "redis://localhost:6379");
});

test("readRedisUrl trims leading and trailing whitespace from REDIS_URL", () => {
  const result = readRedisUrl({ REDIS_URL: "  redis://localhost:6379  " });
  assert.equal(result, "redis://localhost:6379");
});

test("readRedisUrl returns null when REDIS_URL is an empty string", () => {
  const result = readRedisUrl({ REDIS_URL: "" });
  assert.equal(result, null);
});

test("readRedisUrl returns null when REDIS_URL is whitespace only", () => {
  const result = readRedisUrl({ REDIS_URL: "   " });
  assert.equal(result, null);
});

test("readRedisUrl returns null when REDIS_URL is not present in env", () => {
  const result = readRedisUrl({});
  assert.equal(result, null);
});

// closeRedisResource

test("closeRedisResource resolves without error when passed null", async () => {
  await assert.doesNotReject(() => closeRedisResource(null));
});

test("closeRedisResource resolves without error when passed undefined", async () => {
  await assert.doesNotReject(() => closeRedisResource(undefined));
});

test("closeRedisResource calls shutdown() when available", async () => {
  let shutdownCalled = false;
  const resource = {
    shutdown: async () => {
      shutdownCalled = true;
    },
    quit: async () => {
      throw new Error("quit should not be called");
    },
    disconnect: () => {
      throw new Error("disconnect should not be called");
    }
  };

  await closeRedisResource(resource);
  assert.equal(shutdownCalled, true, "shutdown should have been called");
});

test("closeRedisResource calls quit() when shutdown is absent", async () => {
  let quitCalled = false;
  const resource = {
    quit: async () => {
      quitCalled = true;
    },
    disconnect: () => {
      throw new Error("disconnect should not be called");
    }
  };

  await closeRedisResource(resource);
  assert.equal(quitCalled, true, "quit should have been called");
});

test("closeRedisResource calls disconnect() when neither shutdown nor quit is present", async () => {
  let disconnectCalled = false;
  const resource = {
    disconnect: () => {
      disconnectCalled = true;
    }
  };

  await closeRedisResource(resource);
  assert.equal(disconnectCalled, true, "disconnect should have been called");
});
