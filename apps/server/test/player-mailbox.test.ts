import assert from "node:assert/strict";
import test from "node:test";
import {
  claimAllPlayerMailboxMessages,
  claimPlayerMailboxMessage,
  deliverPlayerMailboxMessage,
  normalizePlayerMailboxMessage,
  pruneExpiredPlayerMailboxMessages
} from "@server/domain/account/player-mailbox";

test("mailbox delivery is idempotent per player message id and single-claim is idempotent", () => {
  const message = normalizePlayerMailboxMessage({
    id: "comp-2026-04-05-restart",
    kind: "compensation",
    title: "停机补偿",
    body: "由于早间维护延长，补发资源。",
    sentAt: "2026-04-05T00:00:00.000Z",
    expiresAt: "2026-04-12T00:00:00.000Z",
    grant: {
      gems: 50,
      resources: {
        gold: 200
      }
    }
  });

  const firstDelivery = deliverPlayerMailboxMessage([], message);
  const secondDelivery = deliverPlayerMailboxMessage(firstDelivery.mailbox, message);
  assert.equal(firstDelivery.delivered, true);
  assert.equal(secondDelivery.delivered, false);

  const firstClaim = claimPlayerMailboxMessage(firstDelivery.mailbox, message.id, new Date("2026-04-05T01:00:00.000Z"));
  assert.equal(firstClaim.claimed, true);
  assert.equal(firstClaim.granted?.gems, 50);
  assert.equal(firstClaim.granted?.resources.gold, 200);

  const secondClaim = claimPlayerMailboxMessage(firstClaim.mailbox, message.id, new Date("2026-04-05T01:01:00.000Z"));
  assert.equal(secondClaim.claimed, false);
  assert.equal(secondClaim.reason, "already_claimed");
});

test("mailbox claim-all skips expired messages and prune removes them", () => {
  const activeMessage = normalizePlayerMailboxMessage({
    id: "comp-active",
    title: "活跃补偿",
    body: "仍可领取。",
    sentAt: "2026-04-05T00:00:00.000Z",
    expiresAt: "2026-04-10T00:00:00.000Z",
    grant: {
      resources: {
        gold: 100
      }
    }
  });
  const expiredMessage = normalizePlayerMailboxMessage({
    id: "comp-expired",
    title: "已过期补偿",
    body: "不应再次发放。",
    sentAt: "2026-04-01T00:00:00.000Z",
    expiresAt: "2026-04-02T00:00:00.000Z",
    grant: {
      gems: 25
    }
  });

  const result = claimAllPlayerMailboxMessages([activeMessage, expiredMessage], new Date("2026-04-05T02:00:00.000Z"));
  assert.equal(result.claimed, true);
  assert.deepEqual(result.claimedMessageIds, ["comp-active"]);
  assert.equal(result.summary.expiredCount, 1);

  const pruned = pruneExpiredPlayerMailboxMessages(result.mailbox, new Date("2026-04-05T02:00:00.000Z"));
  assert.equal(pruned.removedCount, 1);
  assert.deepEqual(
    pruned.mailbox.map((entry) => entry.id),
    ["comp-active"]
  );
});
