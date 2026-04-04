import type {
  GuildInviteState,
  GuildInviteStatus,
  GuildJoinRequestState,
  GuildJoinRequestStatus,
  GuildMemberState,
  GuildRole,
  GuildState
} from "./models.ts";

export const DEFAULT_GUILD_MEMBER_LIMIT = 20;

const GUILD_ROLE_ORDER: Record<GuildRole, number> = {
  owner: 0,
  officer: 1,
  member: 2
};

const GUILD_ROLE_LABELS: Record<GuildRole, string> = {
  owner: "Owner",
  officer: "Officer",
  member: "Member"
};

export interface GuildRosterEntry {
  playerId: string;
  displayName: string;
  role: GuildRole;
  roleLabel: string;
  rolePriority: number;
  joinedAt: string;
  invitedByPlayerId?: string;
}

export interface GuildJoinRequestView {
  requestId: string;
  playerId: string;
  displayName: string;
  requestedAt: string;
  status: GuildJoinRequestStatus;
}

export interface GuildRosterView {
  guildId: string;
  name: string;
  tag: string;
  description?: string;
  level: number;
  xp: number;
  memberCount: number;
  memberLimit: number;
  availableSeats: number;
  members: GuildRosterEntry[];
  pendingJoinRequests: GuildJoinRequestView[];
}

export interface GuildMembershipEvent {
  type:
    | "guild.member.join_requested"
    | "guild.member.join_approved"
    | "guild.member.join_rejected"
    | "guild.member.invited"
    | "guild.member.invite_accepted"
    | "guild.member.invite_declined"
    | "guild.member.role_changed"
    | "guild.member.owner_transferred";
  guildId: string;
  actorPlayerId: string;
  subjectPlayerId: string;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface GuildMutationResult {
  guild: GuildState;
  events: GuildMembershipEvent[];
}

export interface GuildJoinRequestInput {
  playerId: string;
  displayName: string;
  requestId?: string;
  requestedAt?: string;
}

export interface GuildJoinReviewInput {
  actorPlayerId: string;
  requestId: string;
  approve: boolean;
  reviewedAt?: string;
  rejectionReason?: string;
}

export interface GuildInviteInput {
  actorPlayerId: string;
  playerId: string;
  inviteId?: string;
  createdAt?: string;
}

export interface GuildInviteResponseInput {
  playerId: string;
  inviteId: string;
  accept: boolean;
  respondedAt?: string;
}

export interface GuildRoleAssignmentInput {
  actorPlayerId: string;
  targetPlayerId: string;
  role: GuildRole;
  changedAt?: string;
}

function normalizeTimestamp(value?: string | null, fallback = new Date().toISOString()): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeDisplayName(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 40) : fallback;
}

function ensureGuildMemberLimit(value?: number | null): number {
  return Math.max(1, Math.floor(value ?? DEFAULT_GUILD_MEMBER_LIMIT));
}

function normalizeGuildMember(member: Partial<GuildMemberState>): GuildMemberState | null {
  const playerId = member.playerId?.trim();
  if (!playerId) {
    return null;
  }

  const role = member.role === "owner" || member.role === "officer" ? member.role : "member";
  const invitedByPlayerId = member.invitedByPlayerId?.trim();
  return {
    playerId,
    displayName: normalizeDisplayName(member.displayName, playerId),
    role,
    joinedAt: normalizeTimestamp(member.joinedAt),
    ...(invitedByPlayerId ? { invitedByPlayerId } : {})
  };
}

function normalizeGuildJoinRequest(request: Partial<GuildJoinRequestState>): GuildJoinRequestState | null {
  const requestId = request.requestId?.trim();
  const playerId = request.playerId?.trim();
  if (!requestId || !playerId) {
    return null;
  }

  const status: GuildJoinRequestStatus =
    request.status === "approved" || request.status === "rejected" || request.status === "cancelled"
      ? request.status
      : "pending";
  const reviewedByPlayerId = request.reviewedByPlayerId?.trim();
  const rejectionReason = request.rejectionReason?.trim();
  return {
    requestId,
    playerId,
    displayName: normalizeDisplayName(request.displayName, playerId),
    requestedAt: normalizeTimestamp(request.requestedAt),
    status,
    ...(request.reviewedAt ? { reviewedAt: normalizeTimestamp(request.reviewedAt) } : {}),
    ...(reviewedByPlayerId ? { reviewedByPlayerId } : {}),
    ...(rejectionReason ? { rejectionReason } : {})
  };
}

function normalizeGuildInvite(invite: Partial<GuildInviteState>): GuildInviteState | null {
  const inviteId = invite.inviteId?.trim();
  const playerId = invite.playerId?.trim();
  const invitedByPlayerId = invite.invitedByPlayerId?.trim();
  if (!inviteId || !playerId || !invitedByPlayerId) {
    return null;
  }

  const status: GuildInviteStatus =
    invite.status === "accepted" || invite.status === "declined" || invite.status === "revoked" ? invite.status : "pending";
  return {
    inviteId,
    playerId,
    invitedByPlayerId,
    createdAt: normalizeTimestamp(invite.createdAt),
    status,
    ...(invite.respondedAt ? { respondedAt: normalizeTimestamp(invite.respondedAt) } : {})
  };
}

export function normalizeGuildState(input?: Partial<GuildState> | null): GuildState {
  const id = input?.id?.trim() ?? "";
  const name = input?.name?.trim() ?? id;
  const tag = input?.tag?.trim().toUpperCase() ?? "";
  const description = input?.description?.trim();
  const members = Array.from(
    new Map(
      (input?.members ?? [])
        .map((member) => normalizeGuildMember(member))
        .filter((member): member is GuildMemberState => Boolean(member))
        .map((member) => [member.playerId, member] as const)
    ).values()
  ).sort((left, right) => {
    const roleOrder = GUILD_ROLE_ORDER[left.role] - GUILD_ROLE_ORDER[right.role];
    return roleOrder || left.joinedAt.localeCompare(right.joinedAt) || left.playerId.localeCompare(right.playerId);
  });
  const joinRequests = Array.from(
    new Map(
      (input?.joinRequests ?? [])
        .map((request) => normalizeGuildJoinRequest(request))
        .filter((request): request is GuildJoinRequestState => Boolean(request))
        .map((request) => [request.requestId, request] as const)
    ).values()
  ).sort((left, right) => left.requestedAt.localeCompare(right.requestedAt) || left.requestId.localeCompare(right.requestId));
  const invites = Array.from(
    new Map(
      (input?.invites ?? [])
        .map((invite) => normalizeGuildInvite(invite))
        .filter((invite): invite is GuildInviteState => Boolean(invite))
        .map((invite) => [invite.inviteId, invite] as const)
    ).values()
  ).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.inviteId.localeCompare(right.inviteId));

  return {
    id,
    name: name || "Guild",
    tag: tag.slice(0, 4),
    ...(description ? { description } : {}),
    memberLimit: ensureGuildMemberLimit(input?.memberLimit),
    level: Math.max(1, Math.floor(input?.level ?? 1)),
    xp: Math.max(0, Math.floor(input?.xp ?? 0)),
    createdAt: normalizeTimestamp(input?.createdAt),
    updatedAt: normalizeTimestamp(input?.updatedAt),
    members,
    joinRequests,
    invites
  };
}

function cloneGuild(guild: GuildState): GuildState {
  return normalizeGuildState(structuredClone(guild));
}

function getGuildMember(guild: GuildState, playerId: string): GuildMemberState | undefined {
  return guild.members.find((member) => member.playerId === playerId);
}

function hasPendingJoinRequestForPlayer(guild: GuildState, playerId: string): boolean {
  return guild.joinRequests.some((request) => request.playerId === playerId && request.status === "pending");
}

function hasPendingInviteForPlayer(guild: GuildState, playerId: string): boolean {
  return guild.invites.some((invite) => invite.playerId === playerId && invite.status === "pending");
}

function assertCanReviewJoinRequests(guild: GuildState, actorPlayerId: string): GuildMemberState {
  const actor = getGuildMember(guild, actorPlayerId);
  if (!actor || (actor.role !== "owner" && actor.role !== "officer")) {
    throw new Error("guild_join_review_forbidden");
  }
  return actor;
}

function assertCanManageInvites(guild: GuildState, actorPlayerId: string): GuildMemberState {
  const actor = getGuildMember(guild, actorPlayerId);
  if (!actor || (actor.role !== "owner" && actor.role !== "officer")) {
    throw new Error("guild_invite_forbidden");
  }
  return actor;
}

function assertCanManageRoles(guild: GuildState, actorPlayerId: string): GuildMemberState {
  const actor = getGuildMember(guild, actorPlayerId);
  if (!actor || actor.role !== "owner") {
    throw new Error("guild_role_assignment_forbidden");
  }
  return actor;
}

function assertGuildHasCapacity(guild: GuildState): void {
  if (guild.members.length >= guild.memberLimit) {
    throw new Error("guild_member_limit_reached");
  }
}

function appendEvent(
  events: GuildMembershipEvent[],
  event: Omit<GuildMembershipEvent, "guildId" | "occurredAt">,
  guildId: string,
  occurredAt: string
): void {
  events.push({
    guildId,
    occurredAt,
    ...event
  });
}

function settleMatchingPendingInvite(guild: GuildState, playerId: string, status: Exclude<GuildInviteStatus, "pending">, respondedAt: string): void {
  const pendingInvite = guild.invites.find((invite) => invite.playerId === playerId && invite.status === "pending");
  if (!pendingInvite) {
    return;
  }

  pendingInvite.status = status;
  pendingInvite.respondedAt = respondedAt;
}

function addMember(guild: GuildState, member: GuildMemberState): void {
  guild.members = guild.members
    .filter((existing) => existing.playerId !== member.playerId)
    .concat(member)
    .sort((left, right) => {
      const roleOrder = GUILD_ROLE_ORDER[left.role] - GUILD_ROLE_ORDER[right.role];
      return roleOrder || left.joinedAt.localeCompare(right.joinedAt) || left.playerId.localeCompare(right.playerId);
    });
}

export function createGuildRosterView(guildInput: GuildState): GuildRosterView {
  const guild = normalizeGuildState(guildInput);
  return {
    guildId: guild.id,
    name: guild.name,
    tag: guild.tag,
    ...(guild.description ? { description: guild.description } : {}),
    level: guild.level,
    xp: guild.xp,
    memberCount: guild.members.length,
    memberLimit: guild.memberLimit,
    availableSeats: Math.max(0, guild.memberLimit - guild.members.length),
    members: guild.members.map((member) => ({
      playerId: member.playerId,
      displayName: member.displayName,
      role: member.role,
      roleLabel: GUILD_ROLE_LABELS[member.role],
      rolePriority: GUILD_ROLE_ORDER[member.role],
      joinedAt: member.joinedAt,
      ...(member.invitedByPlayerId ? { invitedByPlayerId: member.invitedByPlayerId } : {})
    })),
    pendingJoinRequests: guild.joinRequests
      .filter((request) => request.status === "pending")
      .map((request) => ({
        requestId: request.requestId,
        playerId: request.playerId,
        displayName: request.displayName,
        requestedAt: request.requestedAt,
        status: request.status
      }))
  };
}

export function createGuildJoinRequest(guildInput: GuildState, input: GuildJoinRequestInput): GuildMutationResult {
  const guild = cloneGuild(guildInput);
  const playerId = input.playerId.trim();
  if (!playerId) {
    throw new Error("guild_join_request_player_required");
  }
  if (getGuildMember(guild, playerId)) {
    throw new Error("guild_join_request_already_member");
  }
  if (hasPendingJoinRequestForPlayer(guild, playerId)) {
    throw new Error("guild_join_request_pending");
  }

  const occurredAt = normalizeTimestamp(input.requestedAt);
  const requestId = input.requestId?.trim() || `join-${playerId}-${occurredAt}`;
  guild.joinRequests = guild.joinRequests.concat({
    requestId,
    playerId,
    displayName: normalizeDisplayName(input.displayName, playerId),
    requestedAt: occurredAt,
    status: "pending"
  });
  guild.updatedAt = occurredAt;

  const events: GuildMembershipEvent[] = [];
  appendEvent(
    events,
    {
      type: "guild.member.join_requested",
      actorPlayerId: playerId,
      subjectPlayerId: playerId,
      metadata: { requestId }
    },
    guild.id,
    occurredAt
  );

  return { guild: normalizeGuildState(guild), events };
}

export function reviewGuildJoinRequest(guildInput: GuildState, input: GuildJoinReviewInput): GuildMutationResult {
  const guild = cloneGuild(guildInput);
  const actor = assertCanReviewJoinRequests(guild, input.actorPlayerId.trim());
  const request = guild.joinRequests.find((entry) => entry.requestId === input.requestId.trim());
  if (!request || request.status !== "pending") {
    throw new Error("guild_join_request_not_found");
  }

  const occurredAt = normalizeTimestamp(input.reviewedAt);
  request.reviewedAt = occurredAt;
  request.reviewedByPlayerId = actor.playerId;
  const events: GuildMembershipEvent[] = [];

  if (input.approve) {
    assertGuildHasCapacity(guild);
    request.status = "approved";
    addMember(guild, {
      playerId: request.playerId,
      displayName: request.displayName,
      role: "member",
      joinedAt: occurredAt
    });
    settleMatchingPendingInvite(guild, request.playerId, "accepted", occurredAt);
    appendEvent(
      events,
      {
        type: "guild.member.join_approved",
        actorPlayerId: actor.playerId,
        subjectPlayerId: request.playerId,
        metadata: { requestId: request.requestId }
      },
      guild.id,
      occurredAt
    );
  } else {
    request.status = "rejected";
    if (input.rejectionReason?.trim()) {
      request.rejectionReason = input.rejectionReason.trim();
    }
    appendEvent(
      events,
      {
        type: "guild.member.join_rejected",
        actorPlayerId: actor.playerId,
        subjectPlayerId: request.playerId,
        metadata: {
          requestId: request.requestId,
          hasReason: Boolean(request.rejectionReason)
        }
      },
      guild.id,
      occurredAt
    );
  }

  guild.updatedAt = occurredAt;
  return { guild: normalizeGuildState(guild), events };
}

export function createGuildInvite(guildInput: GuildState, input: GuildInviteInput): GuildMutationResult {
  const guild = cloneGuild(guildInput);
  const actor = assertCanManageInvites(guild, input.actorPlayerId.trim());
  const playerId = input.playerId.trim();
  if (!playerId) {
    throw new Error("guild_invite_player_required");
  }
  if (getGuildMember(guild, playerId)) {
    throw new Error("guild_invite_already_member");
  }
  if (hasPendingInviteForPlayer(guild, playerId)) {
    throw new Error("guild_invite_pending");
  }

  const occurredAt = normalizeTimestamp(input.createdAt);
  const inviteId = input.inviteId?.trim() || `invite-${playerId}-${occurredAt}`;
  guild.invites = guild.invites.concat({
    inviteId,
    playerId,
    invitedByPlayerId: actor.playerId,
    createdAt: occurredAt,
    status: "pending"
  });
  guild.updatedAt = occurredAt;

  const events: GuildMembershipEvent[] = [];
  appendEvent(
    events,
    {
      type: "guild.member.invited",
      actorPlayerId: actor.playerId,
      subjectPlayerId: playerId,
      metadata: { inviteId }
    },
    guild.id,
    occurredAt
  );

  return { guild: normalizeGuildState(guild), events };
}

export function respondToGuildInvite(guildInput: GuildState, input: GuildInviteResponseInput): GuildMutationResult {
  const guild = cloneGuild(guildInput);
  const playerId = input.playerId.trim();
  const invite = guild.invites.find((entry) => entry.inviteId === input.inviteId.trim());
  if (!invite || invite.status !== "pending") {
    throw new Error("guild_invite_not_found");
  }
  if (invite.playerId !== playerId) {
    throw new Error("guild_invite_response_forbidden");
  }
  if (getGuildMember(guild, playerId)) {
    throw new Error("guild_invite_already_member");
  }

  const occurredAt = normalizeTimestamp(input.respondedAt);
  invite.respondedAt = occurredAt;
  const events: GuildMembershipEvent[] = [];

  if (input.accept) {
    assertGuildHasCapacity(guild);
    invite.status = "accepted";
    addMember(guild, {
      playerId,
      displayName: playerId,
      role: "member",
      joinedAt: occurredAt,
      invitedByPlayerId: invite.invitedByPlayerId
    });
    appendEvent(
      events,
      {
        type: "guild.member.invite_accepted",
        actorPlayerId: playerId,
        subjectPlayerId: playerId,
        metadata: { inviteId: invite.inviteId, invitedByPlayerId: invite.invitedByPlayerId }
      },
      guild.id,
      occurredAt
    );
  } else {
    invite.status = "declined";
    appendEvent(
      events,
      {
        type: "guild.member.invite_declined",
        actorPlayerId: playerId,
        subjectPlayerId: playerId,
        metadata: { inviteId: invite.inviteId, invitedByPlayerId: invite.invitedByPlayerId }
      },
      guild.id,
      occurredAt
    );
  }

  guild.updatedAt = occurredAt;
  return { guild: normalizeGuildState(guild), events };
}

export function assignGuildMemberRole(guildInput: GuildState, input: GuildRoleAssignmentInput): GuildMutationResult {
  const guild = cloneGuild(guildInput);
  const actor = assertCanManageRoles(guild, input.actorPlayerId.trim());
  const target = getGuildMember(guild, input.targetPlayerId.trim());
  if (!target) {
    throw new Error("guild_role_assignment_target_not_found");
  }
  if (target.playerId === actor.playerId && input.role !== "owner") {
    throw new Error("guild_role_assignment_self_forbidden");
  }
  if (target.role === input.role) {
    throw new Error("guild_role_assignment_noop");
  }

  const occurredAt = normalizeTimestamp(input.changedAt);
  const events: GuildMembershipEvent[] = [];

  if (input.role === "owner") {
    target.role = "owner";
    actor.role = "officer";
    appendEvent(
      events,
      {
        type: "guild.member.owner_transferred",
        actorPlayerId: actor.playerId,
        subjectPlayerId: target.playerId,
        metadata: {
          previousOwnerPlayerId: actor.playerId,
          newOwnerPlayerId: target.playerId
        }
      },
      guild.id,
      occurredAt
    );
  } else {
    const previousRole = target.role;
    target.role = input.role;
    appendEvent(
      events,
      {
        type: "guild.member.role_changed",
        actorPlayerId: actor.playerId,
        subjectPlayerId: target.playerId,
        metadata: {
          previousRole,
          nextRole: input.role
        }
      },
      guild.id,
      occurredAt
    );
  }

  guild.updatedAt = occurredAt;
  guild.members.sort((left, right) => {
    const roleOrder = GUILD_ROLE_ORDER[left.role] - GUILD_ROLE_ORDER[right.role];
    return roleOrder || left.joinedAt.localeCompare(right.joinedAt) || left.playerId.localeCompare(right.playerId);
  });
  return { guild: normalizeGuildState(guild), events };
}
