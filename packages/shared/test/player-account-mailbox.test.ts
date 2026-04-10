import assert from "node:assert/strict";
import test from "node:test";

import {
  isPlayerMailboxMessageExpired,
  summarizePlayerMailbox,
  type PlayerMailboxMessage
} from "../src/index.ts";

const NOW = new Date("2026-04-10T12:00:00.000Z");
const PAST = "2026-01-01T00:00:00.000Z";
const FUTURE = "2099-12-31T23:59:59.000Z";

function makeMsg(overrides: Partial<PlayerMailboxMessage> = {}): PlayerMailboxMessage {
  return {
    id: "msg-1",
    kind: "system",
    title: "Test",
    body: "Body",
    sentAt: "2026-04-01T00:00:00.000Z",
    ...overrides
  };
}

// isPlayerMailboxMessageExpired

test("isPlayerMailboxMessageExpired: no expiresAt returns false", () => {
  assert.equal(isPlayerMailboxMessageExpired({ expiresAt: undefined }, NOW), false);
});

test("isPlayerMailboxMessageExpired: future expiresAt returns false", () => {
  assert.equal(isPlayerMailboxMessageExpired({ expiresAt: FUTURE }, NOW), false);
});

test("isPlayerMailboxMessageExpired: past expiresAt returns true", () => {
  assert.equal(isPlayerMailboxMessageExpired({ expiresAt: PAST }, NOW), true);
});

test("isPlayerMailboxMessageExpired: expiresAt exactly equals now returns true", () => {
  assert.equal(isPlayerMailboxMessageExpired({ expiresAt: NOW.toISOString() }, NOW), true);
});

test("isPlayerMailboxMessageExpired: invalid date string returns false", () => {
  assert.equal(isPlayerMailboxMessageExpired({ expiresAt: "not-a-date" }, NOW), false);
});

test("isPlayerMailboxMessageExpired: empty string expiresAt returns false", () => {
  assert.equal(isPlayerMailboxMessageExpired({ expiresAt: "" }, NOW), false);
});

// summarizePlayerMailbox

test("summarizePlayerMailbox: empty mailbox returns all zeros", () => {
  const summary = summarizePlayerMailbox([], NOW);
  assert.deepEqual(summary, {
    totalCount: 0,
    unreadCount: 0,
    claimableCount: 0,
    expiredCount: 0
  });
});

test("summarizePlayerMailbox: null mailbox returns all zeros", () => {
  const summary = summarizePlayerMailbox(null, NOW);
  assert.deepEqual(summary, {
    totalCount: 0,
    unreadCount: 0,
    claimableCount: 0,
    expiredCount: 0
  });
});

test("summarizePlayerMailbox: 1 unread message (no readAt, no claimedAt, no expiresAt, no grant)", () => {
  const summary = summarizePlayerMailbox([makeMsg()], NOW);
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.unreadCount, 1);
  assert.equal(summary.claimableCount, 0);
  assert.equal(summary.expiredCount, 0);
});

test("summarizePlayerMailbox: 1 read message (has readAt) gives unreadCount 0", () => {
  const summary = summarizePlayerMailbox([makeMsg({ readAt: "2026-04-05T00:00:00.000Z" })], NOW);
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.unreadCount, 0);
  assert.equal(summary.expiredCount, 0);
});

test("summarizePlayerMailbox: 1 claimed message gives unreadCount 0 and claimableCount 0", () => {
  const summary = summarizePlayerMailbox(
    [makeMsg({ claimedAt: "2026-04-05T00:00:00.000Z", grant: { gems: 100 } })],
    NOW
  );
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.unreadCount, 0);
  assert.equal(summary.claimableCount, 0);
});

test("summarizePlayerMailbox: 1 expired message increments expiredCount and not unreadCount", () => {
  const summary = summarizePlayerMailbox([makeMsg({ expiresAt: PAST })], NOW);
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.expiredCount, 1);
  assert.equal(summary.unreadCount, 0);
  assert.equal(summary.claimableCount, 0);
});

test("summarizePlayerMailbox: 1 message with grant, not claimed, not expired is claimable", () => {
  const summary = summarizePlayerMailbox([makeMsg({ grant: { gems: 50 } })], NOW);
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.claimableCount, 1);
  assert.equal(summary.expiredCount, 0);
});

test("summarizePlayerMailbox: 1 message with grant but claimed is not claimable", () => {
  const summary = summarizePlayerMailbox(
    [makeMsg({ grant: { gems: 50 }, claimedAt: "2026-04-05T00:00:00.000Z" })],
    NOW
  );
  assert.equal(summary.claimableCount, 0);
});

test("summarizePlayerMailbox: mixed mailbox with 2 unread + 1 expired + 1 claimable", () => {
  const messages = [
    makeMsg({ id: "msg-1" }),
    makeMsg({ id: "msg-2" }),
    makeMsg({ id: "msg-3", expiresAt: PAST }),
    makeMsg({ id: "msg-4", grant: { gems: 75 } })
  ];
  const summary = summarizePlayerMailbox(messages, NOW);
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.unreadCount, 3); // msg-1, msg-2, msg-4 (unread, not expired, no claimedAt)
  assert.equal(summary.claimableCount, 1); // msg-4 has grant
  assert.equal(summary.expiredCount, 1); // msg-3
});

test("summarizePlayerMailbox: all-expired mailbox → expiredCount equals totalCount, unread=0, claimable=0", () => {
  const messages = [
    makeMsg({ id: "msg-1", expiresAt: PAST }),
    makeMsg({ id: "msg-2", expiresAt: PAST, grant: { gems: 50 } }),
    makeMsg({ id: "msg-3", expiresAt: PAST })
  ];
  const summary = summarizePlayerMailbox(messages, NOW);
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.expiredCount, 3);
  assert.equal(summary.unreadCount, 0);
  assert.equal(summary.claimableCount, 0);
});

test("summarizePlayerMailbox: message without expiresAt never expires → counted as non-expired", () => {
  const messages = [makeMsg({ id: "msg-1" })]; // no expiresAt
  const summary = summarizePlayerMailbox(messages, NOW);
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.expiredCount, 0);
  assert.equal(summary.unreadCount, 1);
});
