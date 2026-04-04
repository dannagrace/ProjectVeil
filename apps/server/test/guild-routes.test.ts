import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { issueGuestAuthSession, resetGuestAuthSessions } from "../src/auth";
import { registerGuildRoutes } from "../src/guilds";
import { createMemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import type { RoomSnapshotStore } from "../src/persistence";

async function startGuildRouteServer(store: RoomSnapshotStore, port: number): Promise<Server> {
  const transport = new WebSocketTransport();
  registerGuildRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

test("guild routes create, list, fetch, and expose rosters", async (t) => {
  resetGuestAuthSessions();
  const store = createMemoryRoomSnapshotStore();
  const port = 44000 + Math.floor(Math.random() * 1000);
  const server = await startGuildRouteServer(store, port);
  const session = issueGuestAuthSession({ playerId: "founder-1", displayName: "Founder" });

  t.after(async () => {
    resetGuestAuthSessions();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const created = await fetch(`http://127.0.0.1:${port}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      name: "Nightwatch",
      tag: "nite",
      description: "Frontier sentinels"
    })
  });
  const createdPayload = (await created.json()) as {
    guild: { guildId: string; tag: string; ownerPlayerId?: string };
    roster: { memberCount: number; members: Array<{ playerId: string }> };
  };

  assert.equal(created.status, 201);
  assert.equal(createdPayload.guild.tag, "NITE");
  assert.equal(createdPayload.guild.ownerPlayerId, "founder-1");
  assert.equal(createdPayload.roster.memberCount, 1);

  const listed = await fetch(`http://127.0.0.1:${port}/api/guilds`);
  const listedPayload = (await listed.json()) as {
    items: Array<{ guildId: string; memberCount: number }>;
  };
  assert.equal(listed.status, 200);
  assert.equal(listedPayload.items[0]?.guildId, createdPayload.guild.guildId);
  assert.equal(listedPayload.items[0]?.memberCount, 1);

  const detail = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}`);
  const detailPayload = (await detail.json()) as {
    guild: { guildId: string; ownerPlayerId?: string };
  };
  assert.equal(detail.status, 200);
  assert.equal(detailPayload.guild.ownerPlayerId, "founder-1");

  const roster = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/roster`);
  const rosterPayload = (await roster.json()) as {
    roster: { members: Array<{ playerId: string }> };
  };
  assert.equal(roster.status, 200);
  assert.deepEqual(rosterPayload.roster.members.map((member) => member.playerId), ["founder-1"]);
});

test("guild routes support join and leave, including disband on last member leave", async (t) => {
  resetGuestAuthSessions();
  const store = createMemoryRoomSnapshotStore();
  const port = 45000 + Math.floor(Math.random() * 1000);
  const server = await startGuildRouteServer(store, port);
  const founderSession = issueGuestAuthSession({ playerId: "founder-2", displayName: "Founder Two" });
  const recruitSession = issueGuestAuthSession({ playerId: "recruit-1", displayName: "Recruit" });

  t.after(async () => {
    resetGuestAuthSessions();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const created = await fetch(`http://127.0.0.1:${port}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${founderSession.token}`
    },
    body: JSON.stringify({
      name: "Skyforge",
      tag: "SKY"
    })
  });
  const createdPayload = (await created.json()) as { guild: { guildId: string } };
  assert.equal(created.status, 201);

  const joined = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/join`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recruitSession.token}`
    }
  });
  const joinedPayload = (await joined.json()) as {
    roster: { memberCount: number; members: Array<{ playerId: string }> };
  };
  assert.equal(joined.status, 200);
  assert.equal(joinedPayload.roster.memberCount, 2);
  assert.deepEqual(joinedPayload.roster.members.map((member) => member.playerId), ["founder-2", "recruit-1"]);

  const leftRecruit = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/leave`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recruitSession.token}`
    }
  });
  const leftRecruitPayload = (await leftRecruit.json()) as {
    deleted: boolean;
    roster: { memberCount: number };
  };
  assert.equal(leftRecruit.status, 200);
  assert.equal(leftRecruitPayload.deleted, false);
  assert.equal(leftRecruitPayload.roster.memberCount, 1);

  const leftFounder = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/leave`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${founderSession.token}`
    }
  });
  const leftFounderPayload = (await leftFounder.json()) as {
    deleted: boolean;
    guildId: string;
  };
  assert.equal(leftFounder.status, 200);
  assert.equal(leftFounderPayload.deleted, true);
  assert.equal(leftFounderPayload.guildId, createdPayload.guild.guildId);

  const notFound = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}`);
  assert.equal(notFound.status, 404);
});
