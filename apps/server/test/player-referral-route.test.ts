import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { issueGuestAuthSession } from "@server/domain/account/auth";
import { registerPlayerAccountRoutes } from "@server/domain/account/player-accounts";
import type { PlayerAccountSnapshot, PlayerReferralClaimResult, RoomSnapshotStore } from "@server/persistence";

class ReferralRouteTestStore {
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly referrals = new Set<string>();

  seedAccount(playerId: string, input: Partial<PlayerAccountSnapshot> = {}): void {
    this.accounts.set(playerId, {
      playerId,
      displayName: input.displayName ?? playerId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      lastSeenAt: input.lastSeenAt ?? new Date().toISOString(),
      gems: input.gems ?? 0,
      globalResources: input.globalResources ?? {
        gold: 0,
        wood: 0,
        ore: 0
      },
      achievements: input.achievements ?? [],
      recentEventLog: input.recentEventLog ?? [],
      recentBattleReplays: input.recentBattleReplays ?? [],
      tutorialStep: input.tutorialStep ?? 0,
      ...input
    });
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    return this.accounts.get(playerId) ?? null;
  }

  async loadPlayerBan(_playerId: string): Promise<null> {
    return null;
  }

  async claimPlayerReferral(referrerId: string, newPlayerId: string, rewardGems: number): Promise<PlayerReferralClaimResult> {
    const normalizedReferrerId = referrerId.trim();
    const normalizedNewPlayerId = newPlayerId.trim();
    const normalizedRewardGems = Math.floor(rewardGems);

    if (normalizedReferrerId === normalizedNewPlayerId) {
      throw new Error("self_referral_forbidden");
    }

    const referralKey = `${normalizedReferrerId}:${normalizedNewPlayerId}`;
    if (this.referrals.has(referralKey)) {
      throw new Error("duplicate_referral");
    }

    const referrer = this.accounts.get(normalizedReferrerId);
    const newPlayer = this.accounts.get(normalizedNewPlayerId);
    if (!referrer || !newPlayer) {
      throw new Error("player_not_found");
    }

    this.referrals.add(referralKey);
    this.accounts.set(normalizedReferrerId, {
      ...referrer,
      gems: (referrer.gems ?? 0) + normalizedRewardGems,
      updatedAt: new Date().toISOString()
    });
    this.accounts.set(normalizedNewPlayerId, {
      ...newPlayer,
      gems: (newPlayer.gems ?? 0) + normalizedRewardGems,
      updatedAt: new Date().toISOString()
    });

    return {
      claimed: true,
      rewardGems: normalizedRewardGems,
      referrerId: normalizedReferrerId,
      newPlayerId: normalizedNewPlayerId
    };
  }
}

type RouteHandler = (request: MockRequest, response: MockResponse) => Promise<void> | void;

class MockApp {
  private readonly routes = new Map<string, RouteHandler>();

  use(): void {}

  get(path: string, handler: RouteHandler): void {
    this.routes.set(`GET ${path}`, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.routes.set(`POST ${path}`, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.routes.set(`PUT ${path}`, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.routes.set(`DELETE ${path}`, handler);
  }

  route(method: string, path: string): RouteHandler {
    const handler = this.routes.get(`${method} ${path}`);
    if (!handler) {
      throw new Error(`route not registered: ${method} ${path}`);
    }
    return handler;
  }
}

class MockRequest extends Readable {
  readonly headers: Record<string, string>;
  readonly method: string;
  readonly url: string;
  private sent = false;

  constructor(input: { method: string; url: string; headers?: Record<string, string>; body?: string }) {
    super();
    this.method = input.method;
    this.url = input.url;
    this.headers = input.headers ?? {};
    this.body = input.body ?? "";
  }

  private readonly body: string;

  _read(): void {
    if (this.sent) {
      this.push(null);
      return;
    }
    this.sent = true;
    this.push(this.body);
    this.push(null);
  }
}

class MockResponse extends Writable {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  body = "";

  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  _write(
    chunk: string | Buffer | Uint8Array,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : Buffer.from(chunk).toString("utf8");
    callback();
  }

  override end(chunk?: string | Buffer | Uint8Array): this {
    if (chunk) {
      this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : Buffer.from(chunk).toString("utf8");
    }
    super.end();
    return this;
  }
}

function buildReferralRouteHandler(store: ReferralRouteTestStore): RouteHandler {
  const app = new MockApp();
  registerPlayerAccountRoutes(app as never, store as RoomSnapshotStore);
  return app.route("POST", "/api/player/referral");
}

async function claimReferral(input: { handler: RouteHandler; token: string; referrerId: string }) {
  const body = JSON.stringify({
    referrerId: input.referrerId
  });
  const request = new MockRequest({
    method: "POST",
    url: "/api/player/referral",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body))
    },
    body
  });
  const response = new MockResponse();
  await input.handler(request, response);
  return {
    status: response.statusCode,
    json: JSON.parse(response.body)
  };
}

test("referral route rejects self-referrals", async () => {
  const store = new ReferralRouteTestStore();
  store.seedAccount("self-player", { displayName: "雾中旅者" });
  const handler = buildReferralRouteHandler(store);
  const session = issueGuestAuthSession({
    playerId: "self-player",
    displayName: "雾中旅者"
  });

  const response = await claimReferral({
    handler,
    token: session.token,
    referrerId: "self-player"
  });
  const payload = response.json as {
    error: { code: string };
  };

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "self_referral_forbidden");
});

test("referral route rejects duplicate claims for the same referrer and player", async () => {
  const store = new ReferralRouteTestStore();
  store.seedAccount("referrer-1", { displayName: "先驱旅者" });
  store.seedAccount("new-player-1", { displayName: "新雾行者" });
  const handler = buildReferralRouteHandler(store);
  const session = issueGuestAuthSession({
    playerId: "new-player-1",
    displayName: "新雾行者"
  });

  const firstResponse = await claimReferral({
    handler,
    token: session.token,
    referrerId: "referrer-1"
  });
  assert.equal(firstResponse.status, 200);

  const secondResponse = await claimReferral({
    handler,
    token: session.token,
    referrerId: "referrer-1"
  });
  const secondPayload = secondResponse.json as {
    error: { code: string };
  };

  assert.equal(secondResponse.status, 409);
  assert.equal(secondPayload.error.code, "referral_already_claimed");
});

test("referral route grants the reward to both accounts on success", async () => {
  const store = new ReferralRouteTestStore();
  store.seedAccount("referrer-2", {
    displayName: "先驱旅者",
    gems: 11
  });
  store.seedAccount("new-player-2", {
    displayName: "新雾行者",
    gems: 3
  });
  const handler = buildReferralRouteHandler(store);
  const session = issueGuestAuthSession({
    playerId: "new-player-2",
    displayName: "新雾行者"
  });

  const response = await claimReferral({
    handler,
    token: session.token,
    referrerId: "referrer-2"
  });
  const payload = response.json as PlayerReferralClaimResult;

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    claimed: true,
    rewardGems: 20,
    referrerId: "referrer-2",
    newPlayerId: "new-player-2"
  });

  const referrer = await store.loadPlayerAccount("referrer-2");
  const newPlayer = await store.loadPlayerAccount("new-player-2");
  assert.equal(referrer?.gems, 31);
  assert.equal(newPlayer?.gems, 23);
});
