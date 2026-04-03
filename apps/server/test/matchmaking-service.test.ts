import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  createMatchmakingHeroSnapshot,
  type HeroState,
  type MatchmakingRequest
} from "../../../packages/shared/src/index";
import { MatchmakingService } from "../src/matchmaking";

function createHero(playerId: string, heroId: string): HeroState {
  return {
    id: heroId,
    playerId,
    name: `Hero ${playerId}`,
    position: { x: 0, y: 0 },
    vision: 2,
    move: { total: 6, remaining: 6 },
    stats: {
      attack: 2,
      defense: 2,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    progression: createDefaultHeroProgression(),
    loadout: createDefaultHeroLoadout(),
    armyTemplateId: "hero_guard_basic",
    armyCount: 12,
    learnedSkills: []
  };
}

function createQueueRequest(playerId: string, enqueuedAt: string): MatchmakingRequest {
  return {
    playerId,
    heroSnapshot: createMatchmakingHeroSnapshot(createHero(playerId, `${playerId}-hero`)),
    rating: 1000,
    enqueuedAt
  };
}

function seedQueue(service: MatchmakingService, requests: MatchmakingRequest[]): void {
  const queue = Reflect.get(service as Record<string, unknown>, "queueByPlayerId") as Map<
    string,
    MatchmakingRequest
  >;
  const queueOrder = Reflect.get(service as Record<string, unknown>, "queueOrder") as string[];
  const queuePositionByPlayerId = Reflect.get(service as Record<string, unknown>, "queuePositionByPlayerId") as Map<
    string,
    number
  >;

  queue.clear();
  queueOrder.length = 0;
  queuePositionByPlayerId.clear();

  const sortedRequests = [...requests].sort(
    (left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.playerId.localeCompare(right.playerId)
  );
  for (const [index, request] of sortedRequests.entries()) {
    queue.set(request.playerId, request);
    queueOrder.push(request.playerId);
    queuePositionByPlayerId.set(request.playerId, index + 1);
  }
}

test("matchmaking service reports queued positions from maintained queue state", () => {
  const service = new MatchmakingService();

  seedQueue(service, [
    createQueueRequest("player-alpha", "2026-03-28T08:00:05.000Z"),
    createQueueRequest("player-beta", "2026-03-28T08:00:10.000Z"),
    createQueueRequest("player-earlier", "2026-03-28T08:00:01.000Z")
  ]);

  assert.deepEqual(service.getStatus("player-earlier"), {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
  assert.deepEqual(service.getStatus("player-alpha"), {
    status: "queued",
    position: 2,
    estimatedWaitSeconds: 15
  });
  assert.deepEqual(service.getStatus("player-beta"), {
    status: "queued",
    position: 3,
    estimatedWaitSeconds: 30
  });
});

test("matchmaking service updates maintained positions after dequeue and prune", () => {
  const service = new MatchmakingService();

  seedQueue(service, [
    createQueueRequest("player-alpha", "2026-03-28T08:00:05.000Z"),
    createQueueRequest("player-beta", "2026-03-28T08:00:10.000Z"),
    createQueueRequest("player-earlier", "2026-03-28T08:00:01.000Z")
  ]);

  assert.equal(service.dequeue("player-alpha"), true);
  assert.deepEqual(service.getStatus("player-earlier"), {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
  assert.deepEqual(service.getStatus("player-beta"), {
    status: "queued",
    position: 2,
    estimatedWaitSeconds: 15
  });

  const removed = service.pruneStaleEntries(5_000, new Date("2026-03-28T08:00:07.000Z"));
  assert.equal(removed, 1);
  assert.equal(service.getStatus("player-earlier").status, "idle");
  assert.deepEqual(service.getStatus("player-beta"), {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
});
