import assert from "node:assert/strict";
import test from "node:test";

import type { RoomSnapshotStore } from "@server/persistence";
import { registerRetentionSummaryRoute } from "@server/domain/ops/retention-summary";

test("retention summary route returns cohort metrics from account timestamps", async () => {
  const routes = new Map<string, (request: unknown, response: FakeResponse) => void | Promise<void>>();
  const app = {
    get(path: string, handler: (request: unknown, response: FakeResponse) => void | Promise<void>) {
      routes.set(path, handler);
    }
  };
  const store = {
    async listPlayerAccounts() {
      return [
        {
          playerId: "player-1",
          displayName: "player-1",
          globalResources: { gold: 0, wood: 0, ore: 0 },
          achievements: [],
          recentEventLog: [],
          createdAt: "2026-03-01T09:00:00.000Z",
          lastSeenAt: "2026-03-10T09:00:00.000Z"
        },
        {
          playerId: "player-2",
          displayName: "player-2",
          globalResources: { gold: 0, wood: 0, ore: 0 },
          achievements: [],
          recentEventLog: [],
          createdAt: "2026-03-01T12:00:00.000Z",
          lastSeenAt: "2026-03-01T12:00:00.000Z"
        }
      ];
    }
  } as Pick<RoomSnapshotStore, "listPlayerAccounts"> as RoomSnapshotStore;

  registerRetentionSummaryRoute(app as never, store);
  const response = new FakeResponse();
  await routes.get("/ops/retention-summary")?.({} as never, response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.cohorts[0].cohortDate, "2026-03-01");
  assert.equal(payload.cohorts[0].newPlayers, 2);
  assert.equal(payload.cohorts[0].retainedD1, 1);
  assert.equal(payload.cohorts[0].retainedD7, 1);
});

class FakeResponse {
  statusCode = 0;
  body = "";

  setHeader(): void {}

  end(body: string): void {
    this.body = body;
  }
}
