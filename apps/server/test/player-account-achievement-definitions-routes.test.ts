import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { registerPlayerAccountRoutes } from "../src/player-accounts";
import type { AchievementDefinition } from "../../../packages/shared/src/index";

async function startAccountRouteServer(port: number): Promise<Server> {
  const transport = new WebSocketTransport();
  registerPlayerAccountRoutes(transport.getExpressApp() as never, null);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

test("player account achievement definitions route returns shared progression metadata", async (t) => {
  const port = 42190 + Math.floor(Math.random() * 1000);
  const server = await startAccountRouteServer(port);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/player-accounts/achievement-definitions`);
  const payload = (await response.json()) as { items: AchievementDefinition[] };

  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.items.map((definition) => definition.id),
    ["first_battle", "enemy_slayer", "skill_scholar", "world_explorer", "epic_collector"]
  );
  assert.deepEqual(payload.items[0], {
    id: "first_battle",
    metric: "battles_started",
    title: "初次交锋",
    description: "首次进入战斗。",
    target: 1
  });
});
