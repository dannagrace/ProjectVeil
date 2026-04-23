import assert from "node:assert/strict";
import test from "node:test";

import { bindClientRuntimeErrorBoundary, reportClientRuntimeError } from "../src/runtime-error-reporting";

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("reportClientRuntimeError posts the expected payload and auth header", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  await reportClientRuntimeError({
    apiBaseUrl: "http://127.0.0.1:2567",
    authToken: "token-123",
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 202 });
    }) as typeof fetch,
    payload: {
      platform: "h5-shell",
      version: "test",
      errorMessage: "boom",
      context: {
        route: "http://127.0.0.1:4173/"
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://127.0.0.1:2567/api/errors");
  assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, "Bearer token-123");
  assert.equal((calls[0]?.init?.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    platform: "h5-shell",
    version: "test",
    errorMessage: "boom",
    context: {
      route: "http://127.0.0.1:4173/"
    }
  });
});

test("bindClientRuntimeErrorBoundary reports uncaught errors and rejections", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const payloads: Array<Record<string, unknown>> = [];
  const unbind = bindClientRuntimeErrorBoundary({
    apiBaseUrl: "http://127.0.0.1:2567",
    version: "test",
    eventTarget: {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      removeEventListener(type) {
        listeners.delete(type);
      }
    },
    fetchImpl: (async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch,
    readAuthToken: () => "session-token",
    readContext: () => ({
      roomId: "room-alpha",
      playerId: "player-alpha"
    })
  });

  assert.ok(unbind);
  listeners.get("error")?.({
    error: new Error("uncaught-boom")
  });
  listeners.get("unhandledrejection")?.({
    reason: "async-boom"
  });
  await flushMicrotasks();

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0]?.errorMessage, "uncaught-boom");
  assert.equal(payloads[1]?.errorMessage, "async-boom");
  assert.deepEqual(payloads[0]?.context, {
    roomId: "room-alpha",
    playerId: "player-alpha"
  });

  unbind?.();
  assert.equal(listeners.size, 0);
});

test("bindClientRuntimeErrorBoundary dedupes repeated runtime errors within the rolling window", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const payloads: Array<Record<string, unknown>> = [];
  const duplicateError = new Error("duplicate-boom");
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;

  try {
    const unbind = bindClientRuntimeErrorBoundary({
      apiBaseUrl: "http://127.0.0.1:2567",
      version: "test",
      eventTarget: {
        addEventListener(type, listener) {
          listeners.set(type, listener);
        },
        removeEventListener(type) {
          listeners.delete(type);
        }
      },
      fetchImpl: (async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      }) as typeof fetch,
      readAuthToken: () => "session-token",
      readContext: () => ({
        roomId: "room-alpha"
      })
    });

    for (let index = 0; index < 100; index += 1) {
      listeners.get("error")?.({
        error: duplicateError
      });
    }
    await flushMicrotasks();

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]?.errorMessage, "duplicate-boom");

    now += 61_000;
    listeners.get("error")?.({
      error: duplicateError
    });
    await flushMicrotasks();

    assert.equal(payloads.length, 2);
    unbind?.();
  } finally {
    Date.now = originalNow;
  }
});

test("bindClientRuntimeErrorBoundary throttles unique runtime errors to five reports per minute", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const payloads: Array<Record<string, unknown>> = [];
  const originalNow = Date.now;
  let now = 2_000;
  Date.now = () => now;

  try {
    const unbind = bindClientRuntimeErrorBoundary({
      apiBaseUrl: "http://127.0.0.1:2567",
      version: "test",
      eventTarget: {
        addEventListener(type, listener) {
          listeners.set(type, listener);
        },
        removeEventListener(type) {
          listeners.delete(type);
        }
      },
      fetchImpl: (async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      }) as typeof fetch,
      readAuthToken: () => "session-token",
      readContext: () => ({
        roomId: "room-alpha"
      })
    });

    for (let index = 0; index < 8; index += 1) {
      listeners.get("error")?.({
        error: new Error(`boom-${index}`)
      });
    }
    await flushMicrotasks();

    assert.equal(payloads.length, 5);

    now += 61_000;
    listeners.get("error")?.({
      error: new Error("boom-after-window")
    });
    await flushMicrotasks();

    assert.equal(payloads.length, 6);
    unbind?.();
  } finally {
    Date.now = originalNow;
  }
});

test("bindClientRuntimeErrorBoundary swallows handler failures before they can recurse", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const payloads: Array<Record<string, unknown>> = [];
  let recursiveDispatches = 0;
  const unbind = bindClientRuntimeErrorBoundary({
    apiBaseUrl: "http://127.0.0.1:2567",
    version: "test",
    eventTarget: {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      removeEventListener(type) {
        listeners.delete(type);
      }
    },
    fetchImpl: (async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch,
    readAuthToken: () => "session-token",
    readContext: () => {
      throw new Error("context-read-failed");
    }
  });

  const emit = (type: string, event: unknown): void => {
    const listener = listeners.get(type);
    if (!listener) {
      return;
    }
    try {
      listener(event);
    } catch (error) {
      recursiveDispatches += 1;
      if (recursiveDispatches < 5) {
        emit("error", { error });
      }
    }
  };

  emit("unhandledrejection", {
    reason: "async-boom"
  });
  await flushMicrotasks();

  assert.equal(recursiveDispatches, 0);
  assert.equal(payloads.length, 0);

  unbind?.();
});
