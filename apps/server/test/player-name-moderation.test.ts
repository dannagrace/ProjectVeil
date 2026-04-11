import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { registerAuthRoutes, issueGuestAuthSession, resetGuestAuthSessions } from "../src/auth";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { registerPlayerAccountRoutes } from "../src/player-accounts";

async function startServer(port: number, store: MemoryRoomSnapshotStore): Promise<Server> {
  const transport = new WebSocketTransport();
  const app = transport.getExpressApp() as never;
  registerAuthRoutes(app, store);
  registerPlayerAccountRoutes(app, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

test("guest login returns 400 for moderated display names", async (t) => {
  const port = 45220 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  const server = await startServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "moderation-guest",
      displayName: "G.M!",
      privacyConsentAccepted: true
    })
  });
  const payload = (await response.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "invalid_display_name");
});

test("renames reject names reserved from banned accounts", async (t) => {
  const port = 45240 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.ensurePlayerAccount({
    playerId: "banned-player",
    displayName: "影裔巡林"
  });
  await store.savePlayerBan?.("banned-player", {
    banStatus: "permanent",
    banReason: "impersonation"
  });
  await store.ensurePlayerAccount({
    playerId: "rename-player",
    displayName: "新旅人"
  });
  const server = await startServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "rename-player",
    displayName: "新旅人"
  });

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/player-accounts/rename-player`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      displayName: "影裔巡林"
    })
  });
  const payload = (await response.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "display_name_reserved");
});

test("admin name-history lookups expose rename history and active reservations", async (t) => {
  process.env.VEIL_ADMIN_TOKEN = "test-admin-token";
  const port = 45260 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  await store.ensurePlayerAccount({
    playerId: "ops-player",
    displayName: "旧雾旅人"
  });
  await store.savePlayerAccountProfile("ops-player", {
    displayName: "新雾旅人"
  });
  await store.savePlayerBan?.("ops-player", {
    banStatus: "permanent",
    banReason: "impersonation"
  });
  const server = await startServer(port, store);

  t.after(async () => {
    delete process.env.VEIL_ADMIN_TOKEN;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const byPlayerResponse = await fetch(`http://127.0.0.1:${port}/api/admin/player-accounts/ops-player/name-history`, {
    headers: {
      "x-veil-admin-token": "test-admin-token"
    }
  });
  const byPlayerPayload = (await byPlayerResponse.json()) as {
    items: Array<{ displayName: string }>;
  };

  assert.equal(byPlayerResponse.status, 200);
  assert.deepEqual(byPlayerPayload.items.map((entry) => entry.displayName), ["新雾旅人", "旧雾旅人"]);

  const byNameResponse = await fetch(
    `http://127.0.0.1:${port}/api/admin/player-accounts/name-history?displayName=${encodeURIComponent("旧雾旅人")}`,
    {
      headers: {
        "x-veil-admin-token": "test-admin-token"
      }
    }
  );
  const byNamePayload = (await byNameResponse.json()) as {
    items: Array<{ playerId: string }>;
    reservation?: { playerId: string; reason: string };
  };

  assert.equal(byNameResponse.status, 200);
  assert.equal(byNamePayload.items[0]?.playerId, "ops-player");
  assert.equal(byNamePayload.reservation?.playerId, "ops-player");
  assert.equal(byNamePayload.reservation?.reason, "banned_account");
});
