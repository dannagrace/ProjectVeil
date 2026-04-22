import { expect, test, type APIRequestContext } from "@playwright/test";
import { SERVER_BASE_URL } from "./runtime-targets";
const ADMIN_TOKEN = process.env.VEIL_ADMIN_TOKEN ?? "dev-admin-token";
const SEED_MESSAGE_ID = "shop-purchase-e2e-seed";
const SEEDED_GEMS = 200;

interface GuestLoginPayload {
  session?: {
    token?: string;
  };
}

interface PlayerProfilePayload {
  account?: {
    gems?: number;
    cosmeticInventory?: {
      ownedIds?: string[];
    };
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

async function createGuestSessionToken(request: APIRequestContext, playerId: string): Promise<string> {
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
  return payload.session?.token ?? "";
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

async function fetchProfile(request: APIRequestContext, authHeaders: Record<string, string>): Promise<PlayerProfilePayload["account"]> {
  const response = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
    headers: authHeaders
  });
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as PlayerProfilePayload;
  expect(payload.account).toBeTruthy();
  return payload.account ?? {};
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`);
  expect(response.ok()).toBeTruthy();
});

test("shop purchase E2E settles cosmetic ownership and account balance, then rejects an invalid SKU without mutating state", async ({
  request
}) => {
  const playerId = `shop-purchase-e2e-${Date.now()}`;
  const token = await createGuestSessionToken(request, playerId);
  const authHeaders = buildAuthHeaders(token);

  await test.step("api: seed the account with claimable mailbox gems for a real shop purchase", async () => {
    await deliverMailboxSeed(request, playerId);

    const claimResponse = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/mailbox/${SEED_MESSAGE_ID}/claim`, {
      headers: authHeaders
    });
    expect(claimResponse.status()).toBe(200);

    const claimPayload = (await claimResponse.json()) as MailboxClaimPayload;
    expect(claimPayload.claimed).toBe(true);
    expect(claimPayload.message?.claimedAt).toBeTruthy();

    const seededProfile = await fetchProfile(request, authHeaders);
    expect(seededProfile?.gems).toBe(SEEDED_GEMS);
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

    const profileBeforePurchase = await fetchProfile(request, authHeaders);
    expect(profileBeforePurchase?.cosmeticInventory?.ownedIds ?? []).not.toContain(cosmeticId);

    purchaseId = `shop-purchase-${playerId}`;
    const purchaseResponse = await request.post(`${SERVER_BASE_URL}/api/shop/purchase`, {
      headers: {
        ...authHeaders,
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
    expect(purchasePayload.gemsBalance).toBe(SEEDED_GEMS - (cosmeticProduct?.price ?? 0));

    const profileAfterPurchase = await fetchProfile(request, authHeaders);
    expect(profileAfterPurchase?.gems).toBe(SEEDED_GEMS - (cosmeticProduct?.price ?? 0));
    expect(profileAfterPurchase?.cosmeticInventory?.ownedIds ?? []).toContain(cosmeticId);
    expect((profileAfterPurchase?.cosmeticInventory?.ownedIds ?? []).filter((ownedId) => ownedId === cosmeticId)).toHaveLength(1);

    const eventLogResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me/event-log?limit=20`, {
      headers: authHeaders
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
        ...authHeaders,
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

    const profileAfterInvalidPurchase = await fetchProfile(request, authHeaders);
    expect(profileAfterInvalidPurchase?.gems).toBe(SEEDED_GEMS - (cosmeticProduct?.price ?? 0));
    expect(profileAfterInvalidPurchase?.cosmeticInventory?.ownedIds ?? []).toContain(cosmeticId);
    expect((profileAfterInvalidPurchase?.cosmeticInventory?.ownedIds ?? []).filter((ownedId) => ownedId === cosmeticId)).toHaveLength(1);
  });
});
