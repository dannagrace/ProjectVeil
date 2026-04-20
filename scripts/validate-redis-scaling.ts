import process from "node:process";
import {
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  createMatchmakingHeroSnapshot,
  type HeroState,
  type MatchmakingRequest
} from "../packages/shared/src/index";
import { RedisMatchmakingService } from "@server/domain/social/matchmaking";
import { readRedisUrl } from "@server/infra/redis";

function createHero(playerId: string): HeroState {
  return {
    id: `${playerId}-hero`,
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

function createRequest(playerId: string, enqueuedAt: string): MatchmakingRequest {
  return {
    playerId,
    heroSnapshot: createMatchmakingHeroSnapshot(createHero(playerId)),
    rating: 1000,
    enqueuedAt
  };
}

async function main(): Promise<void> {
  const redisUrl = readRedisUrl();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required. Example: REDIS_URL=redis://127.0.0.1:6379/0 npm run validate -- redis-scaling");
  }

  const keyPrefix = process.env.VEIL_REDIS_MATCHMAKING_PREFIX?.trim() || `veil:validate:${Date.now()}`;
  const nodeA = new RedisMatchmakingService({ redisUrl, keyPrefix });
  const nodeB = new RedisMatchmakingService({ redisUrl, keyPrefix });

  try {
    const queuedA = await nodeA.enqueue(createRequest("player-a", new Date().toISOString()));
    const queuedB = await nodeB.enqueue(createRequest("player-b", new Date(Date.now() + 1_000).toISOString()));
    const statusA = await nodeA.getStatus("player-a");
    const statusB = await nodeB.getStatus("player-b");

    if (queuedA.status !== "queued" || queuedA.position !== 1) {
      throw new Error(`Unexpected first enqueue result: ${JSON.stringify(queuedA)}`);
    }

    if (queuedB.status !== "queued" || queuedB.position < 2) {
      throw new Error(`Unexpected second enqueue result: ${JSON.stringify(queuedB)}`);
    }

    if (statusA.status !== "matched" || statusB.status !== "matched" || statusA.roomId !== statusB.roomId) {
      throw new Error(
        `Cross-node matchmaking failed. nodeA=${JSON.stringify(statusA)} nodeB=${JSON.stringify(statusB)}`
      );
    }

    console.log(JSON.stringify({ ok: true, keyPrefix, roomId: statusA.roomId, playerIds: statusA.playerIds }, null, 2));
  } finally {
    await Promise.all([nodeA.close(), nodeB.close()]);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
