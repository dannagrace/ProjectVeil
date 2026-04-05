import assert from "node:assert/strict";
import test from "node:test";
import {
  assignGuildMemberRole,
  createGuild,
  createGuildInvite,
  createGuildJoinRequest,
  createGuildRosterView,
  createGuildSummaryView,
  joinGuild,
  leaveGuild,
  normalizeGuildState,
  respondToGuildInvite,
  reviewGuildJoinRequest,
  type GuildState
} from "../src/index";

function createExistingGuild(overrides?: Partial<GuildState>): GuildState {
  return normalizeGuildState({
    id: "guild-nightwatch",
    name: "Nightwatch",
    tag: "NITE",
    description: "Frontier sentinels",
    memberLimit: 4,
    level: 3,
    xp: 2250,
    createdAt: "2026-04-01T10:00:00.000Z",
    updatedAt: "2026-04-01T10:00:00.000Z",
    members: [
      {
        playerId: "owner-1",
        displayName: "Owner",
        role: "owner",
        joinedAt: "2026-04-01T10:00:00.000Z"
      },
      {
        playerId: "officer-1",
        displayName: "Officer",
        role: "officer",
        joinedAt: "2026-04-01T10:05:00.000Z"
      },
      {
        playerId: "member-1",
        displayName: "Member",
        role: "member",
        joinedAt: "2026-04-01T10:10:00.000Z"
      }
    ],
    joinRequests: [],
    invites: [],
    ...overrides
  });
}

test("guild roster view exposes stable role metadata in rank order", () => {
  const roster = createGuildRosterView(
    createExistingGuild({
      members: [
        {
          playerId: "member-2",
          displayName: "Scout",
          role: "member",
          joinedAt: "2026-04-01T10:20:00.000Z"
        },
        {
          playerId: "owner-1",
          displayName: "Owner",
          role: "owner",
          joinedAt: "2026-04-01T10:00:00.000Z"
        },
        {
          playerId: "officer-1",
          displayName: "Officer",
          role: "officer",
          joinedAt: "2026-04-01T10:05:00.000Z"
        }
      ]
    })
  );

  assert.deepEqual(
    roster.members.map((member) => [member.playerId, member.role, member.roleLabel, member.rolePriority]),
    [
      ["owner-1", "owner", "Owner", 0],
      ["officer-1", "officer", "Officer", 1],
      ["member-2", "member", "Member", 2]
    ]
  );
  assert.equal(roster.availableSeats, 1);
});

test("guild creation returns a summary with the owner seeded into the roster", () => {
  const created = createGuild({
    ownerPlayerId: "founder-1",
    ownerDisplayName: "Founder",
    name: "Skyforge",
    tag: "SKY",
    description: "Open frontier builders",
    createdAt: "2026-04-02T06:00:00.000Z"
  });

  const summary = createGuildSummaryView(created.guild);
  assert.equal(summary.ownerPlayerId, "founder-1");
  assert.equal(summary.memberCount, 1);
  assert.equal(created.events[0]?.type, "guild.created");
});

test("guild join adds a direct member when capacity remains", () => {
  const joined = joinGuild(createExistingGuild(), {
    playerId: "member-2",
    displayName: "Scout",
    joinedAt: "2026-04-02T10:00:00.000Z"
  });

  assert.equal(joined.guild.members.find((member) => member.playerId === "member-2")?.role, "member");
  assert.equal(joined.events[0]?.type, "guild.member.joined");
});

test("owner leave transfers ownership and keeps the guild alive when members remain", () => {
  const result = leaveGuild(createExistingGuild(), {
    playerId: "owner-1",
    leftAt: "2026-04-02T11:00:00.000Z"
  });

  assert.equal(result.deleted, false);
  assert.equal(result.guild.members.some((member) => member.playerId === "owner-1"), false);
  assert.equal(result.guild.members.find((member) => member.playerId === "officer-1")?.role, "owner");
  assert.equal(result.events[0]?.type, "guild.member.owner_transferred");
  assert.equal(result.events[1]?.type, "guild.member.left");
});

test("last member leave disbands the guild", () => {
  const result = leaveGuild(
    createExistingGuild({
      members: [
        {
          playerId: "solo-1",
          displayName: "Solo",
          role: "owner",
          joinedAt: "2026-04-01T10:00:00.000Z"
        }
      ]
    }),
    {
      playerId: "solo-1",
      leftAt: "2026-04-02T12:00:00.000Z"
    }
  );

  assert.equal(result.deleted, true);
  assert.equal(result.guild.members.length, 0);
  assert.equal(result.events.at(-1)?.type, "guild.disbanded");
});

test("owner can promote a member to officer and emit a structured membership event", () => {
  const result = assignGuildMemberRole(createExistingGuild(), {
    actorPlayerId: "owner-1",
    targetPlayerId: "member-1",
    role: "officer",
    changedAt: "2026-04-02T09:00:00.000Z"
  });

  const promoted = result.guild.members.find((member) => member.playerId === "member-1");
  assert.equal(promoted?.role, "officer");
  assert.deepEqual(result.events[0], {
    type: "guild.member.role_changed",
    guildId: "guild-nightwatch",
    actorPlayerId: "owner-1",
    subjectPlayerId: "member-1",
    occurredAt: "2026-04-02T09:00:00.000Z",
    metadata: {
      previousRole: "member",
      nextRole: "officer"
    }
  });
});

test("officer cannot change guild roles", () => {
  assert.throws(
    () =>
      assignGuildMemberRole(createExistingGuild(), {
        actorPlayerId: "officer-1",
        targetPlayerId: "member-1",
        role: "officer"
      }),
    /guild_role_assignment_forbidden/
  );
});

test("owner transfer promotes the new owner and demotes the previous owner to officer", () => {
  const result = assignGuildMemberRole(createExistingGuild(), {
    actorPlayerId: "owner-1",
    targetPlayerId: "officer-1",
    role: "owner",
    changedAt: "2026-04-02T09:30:00.000Z"
  });

  assert.equal(result.guild.members.find((member) => member.playerId === "officer-1")?.role, "owner");
  assert.equal(result.guild.members.find((member) => member.playerId === "owner-1")?.role, "officer");
  assert.equal(result.events[0]?.type, "guild.member.owner_transferred");
});

test("officer can approve a pending join request and add the player to the roster", () => {
  const requested = createGuildJoinRequest(createExistingGuild(), {
    playerId: "applicant-1",
    displayName: "Applicant",
    requestId: "join-1",
    requestedAt: "2026-04-02T08:00:00.000Z"
  });

  const approved = reviewGuildJoinRequest(requested.guild, {
    actorPlayerId: "officer-1",
    requestId: "join-1",
    approve: true,
    reviewedAt: "2026-04-02T08:15:00.000Z"
  });

  assert.equal(approved.guild.joinRequests[0]?.status, "approved");
  assert.equal(approved.guild.members.find((member) => member.playerId === "applicant-1")?.role, "member");
  assert.deepEqual(approved.events[0], {
    type: "guild.member.join_approved",
    guildId: "guild-nightwatch",
    actorPlayerId: "officer-1",
    subjectPlayerId: "applicant-1",
    occurredAt: "2026-04-02T08:15:00.000Z",
    metadata: {
      requestId: "join-1"
    }
  });
});

test("members cannot approve join requests", () => {
  const requested = createGuildJoinRequest(createExistingGuild(), {
    playerId: "applicant-1",
    displayName: "Applicant",
    requestId: "join-1",
    requestedAt: "2026-04-02T08:00:00.000Z"
  });

  assert.throws(
    () =>
      reviewGuildJoinRequest(requested.guild, {
        actorPlayerId: "member-1",
        requestId: "join-1",
        approve: true
      }),
    /guild_join_review_forbidden/
  );
});

test("join rejection preserves the applicant outside the roster and records the rejection", () => {
  const requested = createGuildJoinRequest(createExistingGuild(), {
    playerId: "applicant-2",
    displayName: "Applicant",
    requestId: "join-2",
    requestedAt: "2026-04-02T08:00:00.000Z"
  });

  const rejected = reviewGuildJoinRequest(requested.guild, {
    actorPlayerId: "owner-1",
    requestId: "join-2",
    approve: false,
    reviewedAt: "2026-04-02T08:20:00.000Z",
    rejectionReason: "guild_full"
  });

  assert.equal(rejected.guild.members.some((member) => member.playerId === "applicant-2"), false);
  assert.equal(rejected.guild.joinRequests[0]?.status, "rejected");
  assert.equal(rejected.guild.joinRequests[0]?.rejectionReason, "guild_full");
  assert.equal(rejected.events[0]?.type, "guild.member.join_rejected");
});

test("invited players can accept or decline their invite, while others cannot respond for them", () => {
  const invited = createGuildInvite(createExistingGuild(), {
    actorPlayerId: "officer-1",
    playerId: "friend-1",
    inviteId: "invite-1",
    createdAt: "2026-04-02T07:00:00.000Z"
  });

  assert.throws(
    () =>
      respondToGuildInvite(invited.guild, {
        playerId: "intruder-1",
        inviteId: "invite-1",
        accept: true
      }),
    /guild_invite_response_forbidden/
  );

  const accepted = respondToGuildInvite(invited.guild, {
    playerId: "friend-1",
    inviteId: "invite-1",
    accept: true,
    respondedAt: "2026-04-02T07:30:00.000Z"
  });
  assert.equal(accepted.guild.members.find((member) => member.playerId === "friend-1")?.invitedByPlayerId, "officer-1");
  assert.equal(accepted.events[0]?.type, "guild.member.invite_accepted");

  const declined = respondToGuildInvite(invited.guild, {
    playerId: "friend-1",
    inviteId: "invite-1",
    accept: false,
    respondedAt: "2026-04-02T07:45:00.000Z"
  });
  assert.equal(declined.guild.invites[0]?.status, "declined");
  assert.equal(declined.events[0]?.type, "guild.member.invite_declined");
});
