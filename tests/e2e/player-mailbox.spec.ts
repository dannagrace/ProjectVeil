import { expect, test, type APIRequestContext } from "@playwright/test";
import { SERVER_BASE_URL } from "./runtime-targets";
const ADMIN_TOKEN = process.env.VEIL_ADMIN_TOKEN ?? "dev-admin-token";
const ACTIVE_MESSAGE_ID = "mailbox-e2e-active";
const EXPIRED_MESSAGE_ID = "mailbox-e2e-expired";
const ACTIVE_REWARD = {
  gems: 25,
  resources: {
    gold: 140
  }
};

interface GuestLoginPayload {
  session?: {
    token?: string;
  };
}

interface PlayerProfilePayload {
  account?: {
    gems?: number;
    globalResources?: {
      gold?: number;
    };
  };
}

interface MailboxMessagePayload {
  id: string;
  title?: string;
  claimedAt?: string;
  expiresAt?: string;
}

interface MailboxSummaryPayload {
  totalCount?: number;
  unreadCount?: number;
  claimableCount?: number;
  expiredCount?: number;
}

interface MailboxListPayload {
  items?: MailboxMessagePayload[];
  summary?: MailboxSummaryPayload;
}

interface MailboxClaimPayload extends MailboxListPayload {
  claimed?: boolean;
  reason?: string;
  message?: MailboxMessagePayload;
}

interface EventLogPayload {
  items?: Array<{
    id?: string;
    description?: string;
    rewards?: Array<{
      label?: string;
      amount?: number;
    }>;
  }>;
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function createGuestSessionToken(request: APIRequestContext, playerId: string): Promise<string> {
  const response = await request.post(`${SERVER_BASE_URL}/api/auth/guest-login`, {
    data: {
      playerId,
      displayName: "Mailbox E2E",
      privacyConsentAccepted: true
    }
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as GuestLoginPayload;
  expect(payload.session?.token).toBeTruthy();
  return payload.session?.token ?? "";
}

async function deliverMailboxMessage(
  request: APIRequestContext,
  playerId: string,
  message: {
    id: string;
    title: string;
    body: string;
    expiresAt: string;
    grant?: {
      gems?: number;
      resources?: {
        gold?: number;
      };
    };
  }
): Promise<void> {
  const response = await request.post(`${SERVER_BASE_URL}/api/admin/player-mailbox/deliver`, {
    headers: {
      "Content-Type": "application/json",
      "x-veil-admin-token": ADMIN_TOKEN
    },
    data: {
      playerIds: [playerId],
      message: {
        id: message.id,
        kind: "compensation",
        title: message.title,
        body: message.body,
        sentAt: "2026-04-05T00:00:00.000Z",
        expiresAt: message.expiresAt,
        ...(message.grant ? { grant: message.grant } : {})
      }
    }
  });

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({
      delivered: 1,
      skipped: 0,
      deliveredPlayerIds: [playerId],
      skippedPlayerIds: []
    })
  );
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`, {
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    }
  });
  expect(response.ok()).toBeTruthy();
});

test("player mailbox E2E covers admin delivery, list/readback, claim settlement, and expired claim rejection", async ({ request }) => {
  const playerId = `mailbox-e2e-${Date.now()}`;
  const token = await createGuestSessionToken(request, playerId);
  const authHeaders = buildAuthHeaders(token);

  await test.step("api: admin delivers one claimable message and one expired message", async () => {
    await deliverMailboxMessage(request, playerId, {
      id: ACTIVE_MESSAGE_ID,
      title: "停机补偿",
      body: "补发宝石和金币。",
      expiresAt: "2099-04-12T00:00:00.000Z",
      grant: ACTIVE_REWARD
    });
    await deliverMailboxMessage(request, playerId, {
      id: EXPIRED_MESSAGE_ID,
      title: "过期补偿",
      body: "这封邮件应当被视为过期。",
      expiresAt: "2020-04-12T00:00:00.000Z",
      grant: {
        gems: 10,
        resources: {
          gold: 50
        }
      }
    });
  });

  let gemsBeforeClaim = 0;
  let goldBeforeClaim = 0;

  await test.step("api: mailbox list exposes delivered items and flags the expired entry in summary", async () => {
    const profileResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
      headers: authHeaders
    });
    expect(profileResponse.ok()).toBeTruthy();

    const profilePayload = (await profileResponse.json()) as PlayerProfilePayload;
    gemsBeforeClaim = profilePayload.account?.gems ?? 0;
    goldBeforeClaim = profilePayload.account?.globalResources?.gold ?? 0;

    const listResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me/mailbox`, {
      headers: authHeaders
    });
    expect(listResponse.status()).toBe(200);

    const listPayload = (await listResponse.json()) as MailboxListPayload;
    expect(listPayload.items?.map((entry) => entry.id)).toEqual(expect.arrayContaining([ACTIVE_MESSAGE_ID, EXPIRED_MESSAGE_ID]));
    expect(listPayload.summary).toEqual({
      totalCount: 2,
      unreadCount: 1,
      claimableCount: 1,
      expiredCount: 1
    });
    expect(listPayload.items?.find((entry) => entry.id === ACTIVE_MESSAGE_ID)?.claimedAt).toBeFalsy();
    expect(listPayload.items?.find((entry) => entry.id === EXPIRED_MESSAGE_ID)?.expiresAt).toBe("2020-04-12T00:00:00.000Z");
  });

  await test.step("api: claiming the active mailbox reward credits the account and records the claim", async () => {
    const claimResponse = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/mailbox/${ACTIVE_MESSAGE_ID}/claim`, {
      headers: authHeaders
    });
    expect(claimResponse.status()).toBe(200);

    const claimPayload = (await claimResponse.json()) as MailboxClaimPayload;
    expect(claimPayload.claimed).toBe(true);
    expect(claimPayload.reason).toBeUndefined();
    expect(claimPayload.message?.id).toBe(ACTIVE_MESSAGE_ID);
    expect(claimPayload.message?.claimedAt).toBeTruthy();
    expect(claimPayload.summary).toEqual({
      totalCount: 2,
      unreadCount: 0,
      claimableCount: 0,
      expiredCount: 1
    });

    const profileAfterClaimResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
      headers: authHeaders
    });
    expect(profileAfterClaimResponse.ok()).toBeTruthy();

    const profileAfterClaim = (await profileAfterClaimResponse.json()) as PlayerProfilePayload;
    expect(profileAfterClaim.account?.gems).toBe(gemsBeforeClaim + ACTIVE_REWARD.gems);
    expect(profileAfterClaim.account?.globalResources?.gold).toBe(goldBeforeClaim + ACTIVE_REWARD.resources.gold);

    const eventLogResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me/event-log?limit=20`, {
      headers: authHeaders
    });
    expect(eventLogResponse.ok()).toBeTruthy();

    const eventLogPayload = (await eventLogResponse.json()) as EventLogPayload;
    const claimEntry = eventLogPayload.items?.find((entry) => entry.id?.includes(`mailbox:${ACTIVE_MESSAGE_ID}`));
    expect(claimEntry?.description).toBe("Claimed mailbox reward: 停机补偿.");
    expect(claimEntry?.rewards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "gems", amount: ACTIVE_REWARD.gems }),
        expect.objectContaining({ label: "gold", amount: ACTIVE_REWARD.resources.gold })
      ])
    );
  });

  await test.step("api: claiming an expired mailbox reward is rejected without settling it", async () => {
    const expiredClaimResponse = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/mailbox/${EXPIRED_MESSAGE_ID}/claim`, {
      headers: authHeaders
    });
    expect(expiredClaimResponse.status()).toBe(200);

    const expiredClaimPayload = (await expiredClaimResponse.json()) as MailboxClaimPayload;
    expect(expiredClaimPayload.claimed).toBe(false);
    expect(expiredClaimPayload.reason).toBe("expired");
    expect(expiredClaimPayload.message?.id).toBe(EXPIRED_MESSAGE_ID);
    expect(expiredClaimPayload.message?.claimedAt).toBeFalsy();
    expect(expiredClaimPayload.summary).toEqual({
      totalCount: 2,
      unreadCount: 0,
      claimableCount: 0,
      expiredCount: 1
    });

    const profileAfterExpiredClaimResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
      headers: authHeaders
    });
    expect(profileAfterExpiredClaimResponse.ok()).toBeTruthy();

    const profileAfterExpiredClaim = (await profileAfterExpiredClaimResponse.json()) as PlayerProfilePayload;
    expect(profileAfterExpiredClaim.account?.gems).toBe(gemsBeforeClaim + ACTIVE_REWARD.gems);
    expect(profileAfterExpiredClaim.account?.globalResources?.gold).toBe(goldBeforeClaim + ACTIVE_REWARD.resources.gold);
  });
});
