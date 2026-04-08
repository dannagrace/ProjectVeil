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
      description: "Frontier sentinels",
      memberLimit: 3
    })
  });
  const createdPayload = (await created.json()) as {
    guild: { guildId: string; tag: string; ownerPlayerId?: string; memberLimit: number; availableSeats: number };
    roster: { memberCount: number; memberLimit: number; availableSeats: number; members: Array<{ playerId: string }> };
  };

  assert.equal(created.status, 201);
  assert.equal(createdPayload.guild.tag, "NITE");
  assert.equal(createdPayload.guild.ownerPlayerId, "founder-1");
  assert.equal(createdPayload.guild.memberLimit, 3);
  assert.equal(createdPayload.guild.availableSeats, 2);
  assert.equal(createdPayload.roster.memberCount, 1);
  assert.equal(createdPayload.roster.memberLimit, 3);
  assert.equal(createdPayload.roster.availableSeats, 2);

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

test("guild routes keep the guild alive and surface owner transfer events when the owner leaves", async (t) => {
  resetGuestAuthSessions();
  const store = createMemoryRoomSnapshotStore();
  const port = 44900 + Math.floor(Math.random() * 1000);
  const server = await startGuildRouteServer(store, port);
  const founderSession = issueGuestAuthSession({ playerId: "owner-leave-a", displayName: "Owner Leave A" });
  const successorSession = issueGuestAuthSession({ playerId: "owner-leave-b", displayName: "Owner Leave B" });

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
      name: "Succession",
      tag: "KING"
    })
  });
  const createdPayload = (await created.json()) as { guild: { guildId: string } };
  assert.equal(created.status, 201);

  const joined = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/join`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${successorSession.token}`
    }
  });
  assert.equal(joined.status, 200);

  const leftOwner = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/leave`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${founderSession.token}`
    }
  });
  const leftOwnerPayload = (await leftOwner.json()) as {
    deleted: boolean;
    guild: { guildId: string; ownerPlayerId?: string };
    roster: { members: Array<{ playerId: string; role: string }> };
    events: Array<{ type: string; subjectPlayerId: string; metadata?: Record<string, string> }>;
  };
  assert.equal(leftOwner.status, 200);
  assert.equal(leftOwnerPayload.deleted, false);
  assert.equal(leftOwnerPayload.guild.guildId, createdPayload.guild.guildId);
  assert.equal(leftOwnerPayload.guild.ownerPlayerId, "owner-leave-b");
  assert.deepEqual(
    leftOwnerPayload.roster.members.map((member) => ({ playerId: member.playerId, role: member.role })),
    [{ playerId: "owner-leave-b", role: "owner" }]
  );
  assert.deepEqual(
    leftOwnerPayload.events
      .filter((event) => event.type === "guild.member.owner_transferred")
      .map((event) => ({
        type: event.type,
        subjectPlayerId: event.subjectPlayerId,
        metadata: event.metadata
      })),
    [
      {
        type: "guild.member.owner_transferred",
        subjectPlayerId: "owner-leave-b",
        metadata: {
          previousOwnerPlayerId: "owner-leave-a",
          newOwnerPlayerId: "owner-leave-b"
        }
      }
    ]
  );

  const detail = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}`);
  const detailPayload = (await detail.json()) as {
    guild: { guildId: string; ownerPlayerId?: string };
  };
  assert.equal(detail.status, 200);
  assert.equal(detailPayload.guild.guildId, createdPayload.guild.guildId);
  assert.equal(detailPayload.guild.ownerPlayerId, "owner-leave-b");
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
    events: Array<{ type: string }>;
  };
  assert.equal(leftFounder.status, 200);
  assert.equal(leftFounderPayload.deleted, true);
  assert.equal(leftFounderPayload.guildId, createdPayload.guild.guildId);
  assert.ok(leftFounderPayload.events.some((event) => event.type === "guild.disbanded"));

  const notFound = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}`);
  assert.equal(notFound.status, 404);
});

test("guild routes transfer ownership when the owner leaves a guild with remaining members", async (t) => {
  resetGuestAuthSessions();
  const store = createMemoryRoomSnapshotStore();
  const port = 45100 + Math.floor(Math.random() * 1000);
  const server = await startGuildRouteServer(store, port);
  const founderSession = issueGuestAuthSession({ playerId: "founder-transfer", displayName: "Founder Transfer" });
  const recruitOneSession = issueGuestAuthSession({ playerId: "recruit-transfer-1", displayName: "Recruit One" });
  const recruitTwoSession = issueGuestAuthSession({ playerId: "recruit-transfer-2", displayName: "Recruit Two" });

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
      name: "Torchbearers",
      tag: "TORC"
    })
  });
  const createdPayload = (await created.json()) as { guild: { guildId: string } };
  assert.equal(created.status, 201);

  for (const session of [recruitOneSession, recruitTwoSession]) {
    const joined = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    });
    assert.equal(joined.status, 200);
  }

  const ownerLeave = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/leave`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${founderSession.token}`
    }
  });
  const ownerLeavePayload = (await ownerLeave.json()) as {
    deleted: boolean;
    guild: { ownerPlayerId?: string };
    roster: { memberCount: number; members: Array<{ playerId: string; role: string }> };
    events: Array<{ type: string }>;
  };

  assert.equal(ownerLeave.status, 200);
  assert.equal(ownerLeavePayload.deleted, false);
  assert.equal(ownerLeavePayload.guild.ownerPlayerId, "recruit-transfer-1");
  assert.equal(ownerLeavePayload.roster.memberCount, 2);
  assert.deepEqual(
    ownerLeavePayload.roster.members.map((member) => ({ playerId: member.playerId, role: member.role })),
    [
      { playerId: "recruit-transfer-1", role: "owner" },
      { playerId: "recruit-transfer-2", role: "member" }
    ]
  );
  assert.equal(Array.isArray(ownerLeavePayload.events), true);
  assert.ok(ownerLeavePayload.events.some((event) => event.type === "guild.member.owner_transferred"));

  const detail = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}`);
  const detailPayload = (await detail.json()) as {
    guild: { ownerPlayerId?: string; memberCount: number };
  };
  assert.equal(detail.status, 200);
  assert.equal(detailPayload.guild.ownerPlayerId, "recruit-transfer-1");
  assert.equal(detailPayload.guild.memberCount, 2);
});

test("guild routes reject joins when the guild is at its member limit", async (t) => {
  resetGuestAuthSessions();
  const store = createMemoryRoomSnapshotStore();
  const port = 45100 + Math.floor(Math.random() * 1000);
  const server = await startGuildRouteServer(store, port);
  const founderSession = issueGuestAuthSession({ playerId: "limit-founder", displayName: "Limit Founder" });
  const recruitOneSession = issueGuestAuthSession({ playerId: "limit-recruit-1", displayName: "Limit Recruit One" });
  const recruitTwoSession = issueGuestAuthSession({ playerId: "limit-recruit-2", displayName: "Limit Recruit Two" });

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
      name: "Capstone",
      tag: "CAP",
      memberLimit: 2
    })
  });
  const createdPayload = (await created.json()) as {
    guild: { guildId: string; memberLimit: number; availableSeats: number };
    roster: { memberLimit: number; availableSeats: number };
  };
  assert.equal(created.status, 201);
  assert.equal(createdPayload.guild.memberLimit, 2);
  assert.equal(createdPayload.guild.availableSeats, 1);
  assert.equal(createdPayload.roster.memberLimit, 2);
  assert.equal(createdPayload.roster.availableSeats, 1);

  const joined = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/join`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recruitOneSession.token}`
    }
  });
  assert.equal(joined.status, 200);

  const detail = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}`);
  const detailPayload = (await detail.json()) as {
    guild: { memberLimit: number; availableSeats: number };
  };
  assert.equal(detail.status, 200);
  assert.equal(detailPayload.guild.memberLimit, 2);
  assert.equal(detailPayload.guild.availableSeats, 0);

  const roster = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/roster`);
  const rosterPayload = (await roster.json()) as {
    roster: { memberCount: number; memberLimit: number; availableSeats: number };
  };
  assert.equal(roster.status, 200);
  assert.equal(rosterPayload.roster.memberCount, 2);
  assert.equal(rosterPayload.roster.memberLimit, 2);
  assert.equal(rosterPayload.roster.availableSeats, 0);

  const fullJoin = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdPayload.guild.guildId}/join`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recruitTwoSession.token}`
    }
  });
  const fullJoinPayload = (await fullJoin.json()) as { error: { code: string; message: string } };
  assert.equal(fullJoin.status, 409);
  assert.equal(fullJoinPayload.error.code, "guild_conflict");
  assert.match(fullJoinPayload.error.message, /guild_member_limit_reached/);
});

test("guild routes reject unauthorized and banned create requests", async (t) => {
  resetGuestAuthSessions();
  const store = createMemoryRoomSnapshotStore();
  await store.ensurePlayerAccount({ playerId: "banned-founder", displayName: "Banned Founder" });
  await store.savePlayerBan("banned-founder", {
    banStatus: "temporary",
    banReason: "Chargeback abuse",
    banExpiry: "2026-05-05T00:00:00.000Z"
  });
  const port = 44100 + Math.floor(Math.random() * 1000);
  const server = await startGuildRouteServer(store, port);
  const bannedSession = issueGuestAuthSession({ playerId: "banned-founder", displayName: "Banned Founder" });

  t.after(async () => {
    resetGuestAuthSessions();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const unauthorized = await fetch(`http://127.0.0.1:${port}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: "Nightwatch",
      tag: "NITE"
    })
  });
  const unauthorizedPayload = (await unauthorized.json()) as { error: { code: string } };
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorizedPayload.error.code, "unauthorized");

  const banned = await fetch(`http://127.0.0.1:${port}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bannedSession.token}`
    },
    body: JSON.stringify({
      name: "Nightwatch",
      tag: "NITE"
    })
  });
  const bannedPayload = (await banned.json()) as { error: { code: string; reason: string; expiry?: string } };
  assert.equal(banned.status, 403);
  assert.equal(bannedPayload.error.code, "account_banned");
  assert.equal(bannedPayload.error.reason, "Chargeback abuse");
  assert.equal(bannedPayload.error.expiry, "2026-05-05T00:00:00.000Z");
});

test("guild routes map malformed payloads and store outages to actionable errors", async (t) => {
  resetGuestAuthSessions();
  const store = createMemoryRoomSnapshotStore();
  const port = 44200 + Math.floor(Math.random() * 1000);
  const server = await startGuildRouteServer(store, port);
  const founderSession = issueGuestAuthSession({ playerId: "founder-invalid", displayName: "Founder Invalid" });

  const unavailablePort = 44300 + Math.floor(Math.random() * 1000);
  const unavailableServer = await startGuildRouteServer(null, unavailablePort);

  t.after(async () => {
    resetGuestAuthSessions();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
    await unavailableServer.gracefullyShutdown(false).catch(() => undefined);
  });

  const malformed = await fetch(`http://127.0.0.1:${port}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${founderSession.token}`
    },
    body: "{"
  });
  const malformedPayload = (await malformed.json()) as { error: { code: string; message: string } };
  assert.equal(malformed.status, 400);
  assert.equal(malformedPayload.error.code, "invalid_request");
  assert.equal(typeof malformedPayload.error.message, "string");
  assert.ok(malformedPayload.error.message.length > 0);

  const invalidName = await fetch(`http://127.0.0.1:${port}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${founderSession.token}`
    },
    body: JSON.stringify({
      name: " ",
      tag: "INVALID"
    })
  });
  const invalidNamePayload = (await invalidName.json()) as { error: { code: string; message: string } };
  assert.equal(invalidName.status, 400);
  assert.equal(invalidNamePayload.error.code, "invalid_request");
  assert.equal(invalidNamePayload.error.message, "guild_create_name_required");

  const unavailable = await fetch(`http://127.0.0.1:${unavailablePort}/api/guilds`);
  const unavailablePayload = (await unavailable.json()) as { error: { code: string } };
  assert.equal(unavailable.status, 503);
  assert.equal(unavailablePayload.error.code, "guild_store_unavailable");
});

test("guild routes reject duplicate tags, invalid joins, and invalid leaves", async (t) => {
  resetGuestAuthSessions();
  const store = createMemoryRoomSnapshotStore();
  const port = 44400 + Math.floor(Math.random() * 1000);
  const server = await startGuildRouteServer(store, port);
  const founderSession = issueGuestAuthSession({ playerId: "founder-dup", displayName: "Founder Dup" });
  const secondFounderSession = issueGuestAuthSession({ playerId: "founder-other", displayName: "Founder Other" });
  const recruitSession = issueGuestAuthSession({ playerId: "recruit-dup", displayName: "Recruit Dup" });
  const outsiderSession = issueGuestAuthSession({ playerId: "outsider-dup", displayName: "Outsider Dup" });

  t.after(async () => {
    resetGuestAuthSessions();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const createdOne = await fetch(`http://127.0.0.1:${port}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${founderSession.token}`
    },
    body: JSON.stringify({
      name: "Nightwatch",
      tag: "nite"
    })
  });
  const createdOnePayload = (await createdOne.json()) as { guild: { guildId: string } };
  assert.equal(createdOne.status, 201);

  const duplicateTag = await fetch(`http://127.0.0.1:${port}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secondFounderSession.token}`
    },
    body: JSON.stringify({
      name: "Nightwatch Again",
      tag: "NITE"
    })
  });
  const duplicateTagPayload = (await duplicateTag.json()) as { error: { code: string } };
  assert.equal(duplicateTag.status, 409);
  assert.equal(duplicateTagPayload.error.code, "guild_conflict");

  const joinMissingGuild = await fetch(`http://127.0.0.1:${port}/api/guilds/missing-guild/join`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recruitSession.token}`
    }
  });
  const joinMissingGuildPayload = (await joinMissingGuild.json()) as { error: { code: string } };
  assert.equal(joinMissingGuild.status, 404);
  assert.equal(joinMissingGuildPayload.error.code, "guild_not_found");

  const joined = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdOnePayload.guild.guildId}/join`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recruitSession.token}`
    }
  });
  assert.equal(joined.status, 200);

  const joinAgain = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdOnePayload.guild.guildId}/join`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recruitSession.token}`
    }
  });
  const joinAgainPayload = (await joinAgain.json()) as { error: { code: string } };
  assert.equal(joinAgain.status, 409);
  assert.equal(joinAgainPayload.error.code, "guild_conflict");

  const outsiderLeave = await fetch(`http://127.0.0.1:${port}/api/guilds/${createdOnePayload.guild.guildId}/leave`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${outsiderSession.token}`
    }
  });
  const outsiderLeavePayload = (await outsiderLeave.json()) as { error: { code: string } };
  assert.equal(outsiderLeave.status, 409);
  assert.equal(outsiderLeavePayload.error.code, "guild_membership_invalid");
});
