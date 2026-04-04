import assert from "node:assert/strict";
import test from "node:test";
import {
  applySeasonalEventProgress,
  buildEventLeaderboard,
  claimSeasonalEventReward,
  getActiveSeasonalEvents,
  resolveSeasonalEvents
} from "../src/event-engine";
import type { PlayerAccountSnapshot } from "../src/persistence";

test("seasonal events resolve the active defend-the-bridge window", () => {
  const events = resolveSeasonalEvents();
  const activeEvents = getActiveSeasonalEvents(events, new Date("2026-04-04T12:00:00.000Z"));

  assert.equal(events.length, 1);
  assert.equal(activeEvents.length, 1);
  assert.equal(activeEvents[0]?.id, "defend-the-bridge");
  assert.equal(activeEvents[0]?.leaderboard.size, 100);
});

test("seasonal event progress accumulates once per claimed dungeon run", () => {
  const [event] = getActiveSeasonalEvents(resolveSeasonalEvents(), new Date("2026-04-04T12:00:00.000Z"));
  assert.ok(event);

  const first = applySeasonalEventProgress(
    event,
    undefined,
    {
      actionId: "run-1",
      actionType: "daily_dungeon_reward_claimed",
      dungeonId: "shadow-archives",
      occurredAt: "2026-04-04T12:05:00.000Z"
    },
    new Date("2026-04-04T12:05:00.000Z")
  );
  const duplicate = applySeasonalEventProgress(
    event,
    first?.state,
    {
      actionId: "run-1",
      actionType: "daily_dungeon_reward_claimed",
      dungeonId: "shadow-archives",
      occurredAt: "2026-04-04T12:06:00.000Z"
    },
    new Date("2026-04-04T12:06:00.000Z")
  );
  const second = applySeasonalEventProgress(
    event,
    first?.state,
    {
      actionId: "run-2",
      actionType: "daily_dungeon_reward_claimed",
      dungeonId: "shadow-archives",
      occurredAt: "2026-04-04T13:00:00.000Z"
    },
    new Date("2026-04-04T13:00:00.000Z")
  );

  assert.equal(first?.delta, 40);
  assert.equal(first?.state.points, 40);
  assert.equal(duplicate, null);
  assert.equal(second?.state.points, 80);
});

test("seasonal event reward claims validate thresholds and idempotency", () => {
  const [event] = getActiveSeasonalEvents(resolveSeasonalEvents(), new Date("2026-04-04T12:00:00.000Z"));
  assert.ok(event);

  assert.throws(() => claimSeasonalEventReward(event, undefined, "bridge-ration-cache"), /seasonal_event_reward_locked/);

  const initialState = {
    eventId: event.id,
    points: 120,
    claimedRewardIds: [],
    appliedActionIds: ["run-1", "run-2", "run-3"],
    lastUpdatedAt: "2026-04-04T12:10:00.000Z"
  };
  const claim = claimSeasonalEventReward(event, initialState, "bridge-ration-cache", new Date("2026-04-04T12:11:00.000Z"));

  assert.equal(claim.reward.kind, "resources");
  assert.equal(claim.state.claimedRewardIds[0], "bridge-ration-cache");
  assert.throws(
    () => claimSeasonalEventReward(event, claim.state, "bridge-ration-cache", new Date("2026-04-04T12:12:00.000Z")),
    /seasonal_event_reward_already_claimed/
  );
});

test("event leaderboard sorts players by points then oldest update time", () => {
  const [event] = getActiveSeasonalEvents(resolveSeasonalEvents(), new Date("2026-04-04T12:00:00.000Z"));
  assert.ok(event);

  const account = (playerId: string, displayName: string, points: number, lastUpdatedAt: string): PlayerAccountSnapshot => ({
    playerId,
    displayName,
    globalResources: { gold: 0, wood: 0, ore: 0 },
    achievements: [],
    recentEventLog: [],
    seasonalEventStates: [
      {
        eventId: event.id,
        points,
        claimedRewardIds: [],
        appliedActionIds: [],
        lastUpdatedAt
      }
    ],
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: lastUpdatedAt
  });

  const leaderboard = buildEventLeaderboard(event, [
    account("player-1", "Lyra", 120, "2026-04-04T09:00:00.000Z"),
    account("player-2", "Serin", 160, "2026-04-04T09:10:00.000Z"),
    account("player-3", "Hale", 120, "2026-04-04T08:55:00.000Z")
  ]);

  assert.equal(leaderboard[0]?.playerId, "player-2");
  assert.equal(leaderboard[1]?.playerId, "player-3");
  assert.equal(leaderboard[2]?.playerId, "player-1");
  assert.equal(leaderboard[0]?.rewardPreview, "Bridge Champion");
});
