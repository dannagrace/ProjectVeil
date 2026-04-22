import { expect, test, type APIRequestContext } from "@playwright/test";
import { SERVER_BASE_URL } from "./runtime-targets";

interface GuestLoginPayload {
  session?: {
    token?: string;
  };
}

interface GuildSummaryPayload {
  guildId?: string;
  name?: string;
  tag?: string;
  memberCount?: number;
  memberLimit?: number;
  availableSeats?: number;
  ownerPlayerId?: string;
  ownerDisplayName?: string;
}

interface GuildRosterMemberPayload {
  playerId?: string;
  displayName?: string;
  role?: string;
}

interface GuildRosterPayload {
  guildId?: string;
  memberCount?: number;
  memberLimit?: number;
  availableSeats?: number;
  members?: GuildRosterMemberPayload[];
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function createGuestSessionToken(
  request: APIRequestContext,
  playerId: string,
  displayName: string
): Promise<string> {
  const response = await request.post(`${SERVER_BASE_URL}/api/auth/guest-login`, {
    data: {
      playerId,
      displayName,
      privacyConsentAccepted: true
    }
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as GuestLoginPayload;
  expect(payload.session?.token).toBeTruthy();
  return payload.session?.token ?? "";
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`);
  expect(response.ok()).toBeTruthy();
});

test("guild lifecycle E2E covers create, join, leave, and roster detail views", async ({ request }) => {
  const founderToken = await createGuestSessionToken(request, `guild-founder-${Date.now()}`, "Guild Founder");
  const recruitToken = await createGuestSessionToken(request, `guild-recruit-${Date.now()}`, "Guild Recruit");

  let guildId = "";

  await test.step("api: founder creates a guild", async () => {
    const createResponse = await request.post(`${SERVER_BASE_URL}/api/guilds`, {
      headers: {
        ...buildAuthHeaders(founderToken),
        "Content-Type": "application/json"
      },
      data: {
        name: "Nightwatch",
        tag: "nite",
        description: "Frontier sentinels",
        memberLimit: 3
      }
    });
    expect(createResponse.status()).toBe(201);

    const createPayload = (await createResponse.json()) as {
      guild?: GuildSummaryPayload;
      roster?: GuildRosterPayload;
    };
    guildId = createPayload.guild?.guildId ?? "";
    expect(guildId).toMatch(/^guild-/);
    expect(createPayload.guild).toMatchObject({
      guildId,
      name: "Nightwatch",
      tag: "NITE",
      ownerDisplayName: "Guild Founder",
      memberCount: 1,
      memberLimit: 3,
      availableSeats: 2
    });
    expect(createPayload.roster).toMatchObject({
      guildId,
      memberCount: 1,
      memberLimit: 3,
      availableSeats: 2,
      members: [
        {
          displayName: "Guild Founder",
          role: "owner"
        }
      ]
    });
    expect(createPayload.roster?.members?.[0]?.playerId).toBeTruthy();
    expect(createPayload.guild?.ownerPlayerId).toBe(createPayload.roster?.members?.[0]?.playerId);
  });

  await test.step("api: a second player joins and the roster count increments", async () => {
    const joinResponse = await request.post(`${SERVER_BASE_URL}/api/guilds/${encodeURIComponent(guildId)}/join`, {
      headers: buildAuthHeaders(recruitToken)
    });
    expect(joinResponse.status()).toBe(200);

    const joinPayload = (await joinResponse.json()) as {
      guild?: GuildSummaryPayload;
      roster?: GuildRosterPayload;
    };
    expect(joinPayload.guild).toMatchObject({
      guildId,
      memberCount: 2,
      memberLimit: 3,
      availableSeats: 1
    });
    expect(joinPayload.roster).toMatchObject({
      guildId,
      memberCount: 2,
      memberLimit: 3,
      availableSeats: 1
    });
    expect(joinPayload.roster?.members?.map((member) => member.displayName)).toEqual(["Guild Founder", "Guild Recruit"]);
    expect(joinPayload.roster?.members?.map((member) => member.role)).toEqual(["owner", "member"]);
  });

  await test.step("api: guild detail and roster view reflect the joined member", async () => {
    const [detailResponse, rosterResponse] = await Promise.all([
      request.get(`${SERVER_BASE_URL}/api/guilds/${encodeURIComponent(guildId)}`),
      request.get(`${SERVER_BASE_URL}/api/guilds/${encodeURIComponent(guildId)}/roster`)
    ]);

    expect(detailResponse.status()).toBe(200);
    expect(rosterResponse.status()).toBe(200);

    const detailPayload = (await detailResponse.json()) as { guild?: GuildSummaryPayload };
    const rosterPayload = (await rosterResponse.json()) as { roster?: GuildRosterPayload };
    expect(detailPayload.guild).toMatchObject({
      guildId,
      name: "Nightwatch",
      tag: "NITE",
      ownerDisplayName: "Guild Founder",
      memberCount: 2,
      memberLimit: 3,
      availableSeats: 1
    });
    expect(rosterPayload.roster).toMatchObject({
      guildId,
      memberCount: 2,
      memberLimit: 3,
      availableSeats: 1
    });
    expect(rosterPayload.roster?.members?.map((member) => member.displayName)).toEqual(["Guild Founder", "Guild Recruit"]);
  });

  await test.step("api: a member leaves and is removed from subsequent roster views", async () => {
    const leaveResponse = await request.post(`${SERVER_BASE_URL}/api/guilds/${encodeURIComponent(guildId)}/leave`, {
      headers: buildAuthHeaders(recruitToken)
    });
    expect(leaveResponse.status()).toBe(200);

    const leavePayload = (await leaveResponse.json()) as {
      deleted?: boolean;
      guild?: GuildSummaryPayload;
      roster?: GuildRosterPayload;
    };
    expect(leavePayload.deleted).toBe(false);
    expect(leavePayload.guild).toMatchObject({
      guildId,
      memberCount: 1,
      memberLimit: 3,
      availableSeats: 2
    });
    expect(leavePayload.roster).toMatchObject({
      guildId,
      memberCount: 1,
      memberLimit: 3,
      availableSeats: 2
    });
    expect(leavePayload.roster?.members).toEqual([
      expect.objectContaining({
        displayName: "Guild Founder",
        role: "owner"
      })
    ]);

    const rosterAfterLeaveResponse = await request.get(`${SERVER_BASE_URL}/api/guilds/${encodeURIComponent(guildId)}/roster`);
    expect(rosterAfterLeaveResponse.status()).toBe(200);
    const rosterAfterLeavePayload = (await rosterAfterLeaveResponse.json()) as { roster?: GuildRosterPayload };
    expect(rosterAfterLeavePayload.roster?.members?.map((member) => member.displayName)).toEqual(["Guild Founder"]);
  });
});

test("guild lifecycle E2E rejects unauthenticated mutations with 401", async ({ request }) => {
  const founderToken = await createGuestSessionToken(request, `guild-auth-founder-${Date.now()}`, "Auth Founder");

  const createResponse = await request.post(`${SERVER_BASE_URL}/api/guilds`, {
    headers: {
      ...buildAuthHeaders(founderToken),
      "Content-Type": "application/json"
    },
    data: {
      name: "Guardians",
      tag: "grd"
    }
  });
  expect(createResponse.status()).toBe(201);

  const createPayload = (await createResponse.json()) as { guild?: GuildSummaryPayload };
  const guildId = createPayload.guild?.guildId ?? "";
  expect(guildId).toMatch(/^guild-/);

  const [unauthorizedCreate, unauthorizedJoin, unauthorizedLeave] = await Promise.all([
    request.post(`${SERVER_BASE_URL}/api/guilds`, {
      headers: {
        "Content-Type": "application/json"
      },
      data: {
        name: "Unauthorized",
        tag: "nope"
      }
    }),
    request.post(`${SERVER_BASE_URL}/api/guilds/${encodeURIComponent(guildId)}/join`),
    request.post(`${SERVER_BASE_URL}/api/guilds/${encodeURIComponent(guildId)}/leave`)
  ]);

  for (const response of [unauthorizedCreate, unauthorizedJoin, unauthorizedLeave]) {
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication required"
      }
    });
  }
});
