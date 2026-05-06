import { expect, test, type APIRequestContext } from "@playwright/test";
import { SERVER_BASE_URL } from "./runtime-targets";
const ADMIN_TOKEN = process.env.VEIL_ADMIN_TOKEN ?? "dev-admin-token";
const SEED_MESSAGE_ID = "shop-purchase-e2e-seed";
const SEEDED_GEMS = 200;

interface GuestLoginPayload {
  session?: {
    token?: string;
    playerId?: string;
  };
}

interface PlayerProfilePayload {
  account?: {
    gems?: number;
    cosmeticInventory?: {
      ownedIds?: string[];
    };
  };
  session?: {
    token?: string;
  };
}

interface ShopProductPayload {
  productId: string;
  name: string;
  type?: string;
  price?: number;
  grant?: {
    cosmeticIds?: string[];
  };
}

interface ShopProductsPayload {
  items?: ShopProductPayload[];
}

interface MailboxClaimPayload {
  claimed?: boolean;
  message?: {
    claimedAt?: string;
  };
}

interface ShopPurchasePayload {
  purchaseId?: string;
  productId?: string;
  quantity?: number;
  totalPrice?: number;
  gemsBalance?: number;
  granted?: {
    cosmeticIds?: string[];
  };
}

interface EventLogPayload {
  items?: Array<{
    id?: string;
    description?: string;
  }>;
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function createGuestSession(
  request: APIRequestContext,
  playerId: string
): Promise<{ playerId: string; token: string }> {
  const response = await request.post(`${SERVER_BASE_URL}/api/auth/guest-login`, {
    data: {
      playerId,
      displayName: "Shop Purchase E2E",
      privacyConsentAccepted: true
    }
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as GuestLoginPayload;
  expect(payload.session?.token).toBeTruthy();
  expect(payload.session?.playerId).toBeTruthy();
  return {
    playerId: payload.session?.playerId ?? "",
    token: payload.session?.token ?? ""
  };
}

function refreshAuthToken(payload: { session?: { token?: string } }, currentToken: string): string {
  return payload.session?.token?.trim() || currentToken;
}

async function deliverMailboxSeed(request: APIRequestContext, playerId: string): Promise<void> {
  const response = await request.post(`${SERVER_BASE_URL}/api/admin/player-mailbox/deliver`, {
    headers: {
      "Content-Type": "application/json",
      "x-veil-admin-token": ADMIN_TOKEN
    },
    data: {
      playerIds: [playerId],
      message: {
        id: SEED_MESSAGE_ID,
        kind: "compensation",
        title: "商店测试补偿",
        body: "用于验证商店结算的测试宝石。",
        sentAt: "2026-04-10T00:00:00.000Z",
        expiresAt: "2099-04-12T00:00:00.000Z",
        grant: {
          gems: SEEDED_GEMS
        }
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

async function fetchProfile(request: APIRequestContext, authHeaders: Record<string, string>): Promise<PlayerProfilePayload> {
  const response = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
    headers: authHeaders
  });
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as PlayerProfilePayload;
  expect(payload.account).toBeTruthy();
  return payload;
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`, {
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    }
  });
  expect(response.ok()).toBeTruthy();
});

test("shop purchase E2E settles cosmetic ownership and account balance, then rejects an invalid SKU without mutating state", async ({
  request
}) => {
  const session = await createGuestSession(request, `shop-purchase-e2e-${Date.now()}`);
  const playerId = session.playerId;
  let token = session.token;
  const authHeaders = () => buildAuthHeaders(token);
  let seededGemBalance = 0;

  await test.step("api: seed the account with claimable mailbox gems for a real shop purchase", async () => {
    const profileBeforeSeed = await fetchProfile(request, authHeaders());
    token = refreshAuthToken(profileBeforeSeed, token);
    const gemsBeforeSeed = profileBeforeSeed.account?.gems ?? 0;

    await deliverMailboxSeed(request, playerId);

    const claimResponse = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/mailbox/${SEED_MESSAGE_ID}/claim`, {
      headers: authHeaders()
    });
    expect(claimResponse.status()).toBe(200);

    const claimPayload = (await claimResponse.json()) as MailboxClaimPayload;
    expect(claimPayload.claimed).toBe(true);
    expect(claimPayload.message?.claimedAt).toBeTruthy();

    const seededProfile = await fetchProfile(request, authHeaders());
    token = refreshAuthToken(seededProfile, token);
    seededGemBalance = gemsBeforeSeed + SEEDED_GEMS;
    expect(seededProfile.account?.gems).toBe(seededGemBalance);
  });

  let cosmeticProduct: ShopProductPayload | undefined;
  let cosmeticId = "";
  let purchaseId = "";

  await test.step("api: purchase a live cosmetic product and settle the cosmetic inventory plus gem balance", async () => {
    const catalogResponse = await request.get(`${SERVER_BASE_URL}/api/shop/products`);
    expect(catalogResponse.status()).toBe(200);

    const catalogPayload = (await catalogResponse.json()) as ShopProductsPayload;
    cosmeticProduct = catalogPayload.items?.find(
      (item) => item.type === "cosmetic" && (item.grant?.cosmeticIds?.length ?? 0) === 1 && (item.price ?? 0) < SEEDED_GEMS
    );
    expect(cosmeticProduct).toBeTruthy();
    cosmeticId = cosmeticProduct?.grant?.cosmeticIds?.[0] ?? "";
    expect(cosmeticId).toBeTruthy();

    const profileBeforePurchase = await fetchProfile(request, authHeaders());
    token = refreshAuthToken(profileBeforePurchase, token);
    expect(profileBeforePurchase.account?.cosmeticInventory?.ownedIds ?? []).not.toContain(cosmeticId);

    purchaseId = `shop-purchase-${playerId}`;
    const purchaseResponse = await request.post(`${SERVER_BASE_URL}/api/shop/purchase`, {
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json"
      },
      data: {
        productId: cosmeticProduct?.productId,
        quantity: 1,
        purchaseId
      }
    });
    expect(purchaseResponse.status()).toBe(200);

    const purchasePayload = (await purchaseResponse.json()) as ShopPurchasePayload;
    expect(purchasePayload.purchaseId).toBe(purchaseId);
    expect(purchasePayload.productId).toBe(cosmeticProduct?.productId);
    expect(purchasePayload.quantity).toBe(1);
    expect(purchasePayload.totalPrice).toBe(cosmeticProduct?.price);
    expect(purchasePayload.granted?.cosmeticIds).toEqual([cosmeticId]);
    expect(purchasePayload.gemsBalance).toBe(seededGemBalance - (cosmeticProduct?.price ?? 0));

    const profileAfterPurchase = await fetchProfile(request, authHeaders());
    token = refreshAuthToken(profileAfterPurchase, token);
    expect(profileAfterPurchase.account?.gems).toBe(seededGemBalance - (cosmeticProduct?.price ?? 0));
    expect(profileAfterPurchase.account?.cosmeticInventory?.ownedIds ?? []).toContain(cosmeticId);
    expect((profileAfterPurchase.account?.cosmeticInventory?.ownedIds ?? []).filter((ownedId) => ownedId === cosmeticId)).toHaveLength(1);

    const eventLogResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me/event-log?limit=20`, {
      headers: authHeaders()
    });
    expect(eventLogResponse.ok()).toBeTruthy();

    const eventLogPayload = (await eventLogResponse.json()) as EventLogPayload;
    expect(eventLogPayload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: expect.stringContaining(`Purchased ${cosmeticProduct?.name} x1`)
        })
      ])
    );
  });

  await test.step("api: invalid SKU requests are rejected and leave the settled account state untouched", async () => {
    const invalidPurchaseResponse = await request.post(`${SERVER_BASE_URL}/api/shop/purchase`, {
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json"
      },
      data: {
        productId: "cosmetic:does-not-exist",
        quantity: 1,
        purchaseId: `${purchaseId}-invalid`
      }
    });
    expect(invalidPurchaseResponse.status()).toBe(404);
    await expect(invalidPurchaseResponse.json()).resolves.toEqual({
      error: {
        code: "product_not_found",
        message: "Shop product not found: cosmetic:does-not-exist"
      }
    });

    const profileAfterInvalidPurchase = await fetchProfile(request, authHeaders());
    expect(profileAfterInvalidPurchase.account?.gems).toBe(seededGemBalance - (cosmeticProduct?.price ?? 0));
    expect(profileAfterInvalidPurchase.account?.cosmeticInventory?.ownedIds ?? []).toContain(cosmeticId);
    expect((profileAfterInvalidPurchase.account?.cosmeticInventory?.ownedIds ?? []).filter((ownedId) => ownedId === cosmeticId)).toHaveLength(1);
  });
});
