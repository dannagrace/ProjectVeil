import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelCocosMatchmaking,
  enqueueCocosMatchmaking,
  readCocosMatchmakingStatus,
  startCocosMatchmakingStatusPolling,
  type CocosMatchmakingStatus
} from "../assets/scripts/cocos-matchmaking.ts";

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("readCocosMatchmakingStatus reads queue status with auth from storage", async () => {
  const requests: Array<{ url: string; auth: string | null }> = [];
  const storage = {
    getItem(): string {
      return JSON.stringify({
        playerId: "player-1",
        displayName: "One",
        authMode: "guest",
        token: "token-123",
        source: "remote"
      });
    }
  };

  const status = await readCocosMatchmakingStatus("ws://127.0.0.1:2567/ws", {
    storage,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        auth: new Headers(init?.headers).get("Authorization")
      });
      return okJson({
        status: "queued",
        position: 3,
        estimatedWaitSeconds: 18
      });
    }
  });

  assert.deepEqual(status, {
    status: "queued",
    position: 3,
    estimatedWaitSeconds: 18
  });
  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:2567/api/matchmaking/status",
      auth: "Bearer token-123"
    }
  ]);
});

test("enqueueCocosMatchmaking posts to the enqueue endpoint", async () => {
  const requests: Array<{ url: string; method: string; auth: string | null; contentType: string | null }> = [];

  const status = await enqueueCocosMatchmaking("http://127.0.0.1:2567", {
    authSession: {
      playerId: "player-1",
      displayName: "One",
      authMode: "guest",
      token: "token-abc",
      source: "remote"
    },
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        auth: new Headers(init?.headers).get("Authorization"),
        contentType: new Headers(init?.headers).get("Content-Type")
      });
      return okJson({
        status: "queued",
        position: 1,
        estimatedWaitSeconds: 12
      });
    }
  });

  assert.equal(status.status, "queued");
  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:2567/api/matchmaking/enqueue",
      method: "POST",
      auth: "Bearer token-abc",
      contentType: "application/json"
    }
  ]);
});

test("cancelCocosMatchmaking deletes the queue entry and normalizes the response", async () => {
  const requests: Array<{ url: string; method: string; auth: string | null }> = [];

  const result = await cancelCocosMatchmaking("http://127.0.0.1:2567", {
    authSession: {
      playerId: "player-1",
      displayName: "One",
      authMode: "guest",
      token: "token-cancel",
      source: "remote"
    },
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        auth: new Headers(init?.headers).get("Authorization")
      });
      return okJson({ status: "dequeued" });
    }
  });

  assert.equal(result, "dequeued");
  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:2567/api/matchmaking/cancel",
      method: "DELETE",
      auth: "Bearer token-cancel"
    }
  ]);
});

test("matchmaking requests expose server error codes in thrown errors", async () => {
  await assert.rejects(
    () =>
      readCocosMatchmakingStatus("http://127.0.0.1:2567", {
        fetchImpl: async () =>
          okJson(
            {
              error: {
                code: "token_expired"
              }
            },
            401
          )
      }),
    /cocos_request_failed:401:token_expired/
  );
});

test("startCocosMatchmakingStatusPolling stops scheduling after a matched response", async () => {
  const seen: CocosMatchmakingStatus[] = [];
  let fetchCount = 0;

  startCocosMatchmakingStatusPolling(
    "http://127.0.0.1:2567",
    (status) => {
      seen.push(status);
    },
    {
      pollIntervalMs: 250,
      fetchImpl: async () => {
        fetchCount += 1;
        return okJson({
          status: "matched",
          roomId: "pvp-match-1",
          playerIds: ["player-1", "player-2"],
          seedOverride: 1001
        });
      }
    }
  );

  await new Promise((resolve) => globalThis.setTimeout(resolve, 400));

  assert.equal(fetchCount, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.status, "matched");
});

test("startCocosMatchmakingStatusPolling can stop after an idle response when configured", async () => {
  const seen: CocosMatchmakingStatus[] = [];
  let fetchCount = 0;

  startCocosMatchmakingStatusPolling(
    "http://127.0.0.1:2567",
    (status) => {
      seen.push(status);
    },
    {
      stopOnIdle: true,
      pollIntervalMs: 250,
      fetchImpl: async () => {
        fetchCount += 1;
        return okJson({ status: "idle" });
      }
    }
  );

  await new Promise((resolve) => globalThis.setTimeout(resolve, 400));

  assert.equal(fetchCount, 1);
  assert.deepEqual(seen, [{ status: "idle" }]);
});

test("startCocosMatchmakingStatusPolling retries after transient errors until stopped", async () => {
  const seen: CocosMatchmakingStatus[] = [];
  let fetchCount = 0;

  const controller = startCocosMatchmakingStatusPolling(
    "http://127.0.0.1:2567",
    (status) => {
      seen.push(status);
    },
    {
      pollIntervalMs: 250,
      fetchImpl: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          throw new Error("network_down");
        }
        return okJson({
          status: "queued",
          position: 2,
          estimatedWaitSeconds: 9
        });
      }
    }
  );

  await new Promise((resolve) => globalThis.setTimeout(resolve, 320));
  controller.stop();
  await new Promise((resolve) => globalThis.setTimeout(resolve, 320));

  assert.equal(fetchCount, 2);
  assert.deepEqual(seen, [
    {
      status: "queued",
      position: 2,
      estimatedWaitSeconds: 9
    }
  ]);
});

test("startCocosMatchmakingStatusPolling stop cancels the next scheduled poll", async () => {
  let fetchCount = 0;

  const controller = startCocosMatchmakingStatusPolling(
    "http://127.0.0.1:2567",
    () => undefined,
    {
      pollIntervalMs: 250,
      fetchImpl: async () => {
        fetchCount += 1;
        return okJson({
          status: "queued",
          position: 1,
          estimatedWaitSeconds: 5
        });
      }
    }
  );

  await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  controller.stop();
  await new Promise((resolve) => globalThis.setTimeout(resolve, 350));

  assert.equal(fetchCount, 1);
});
