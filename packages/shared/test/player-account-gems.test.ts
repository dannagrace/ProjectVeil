import assert from "node:assert/strict";
import test from "node:test";

import { normalizePlayerAccountReadModel } from "../src/index.ts";

test("player account read model normalizes gems independently from the resource ledger", () => {
  const account = normalizePlayerAccountReadModel({
    playerId: "player-gems",
    gems: 12.9,
    globalResources: {
      gold: 4,
      wood: 2,
      ore: 1
    }
  });

  assert.equal(account.gems, 12);
  assert.deepEqual(account.globalResources, {
    gold: 4,
    wood: 2,
    ore: 1
  });
});

test("player account read model defaults gems to zero", () => {
  const account = normalizePlayerAccountReadModel({
    playerId: "player-empty"
  });

  assert.equal(account.gems, 0);
});
