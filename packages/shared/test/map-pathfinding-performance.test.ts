import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createInitialWorldState, findPath } from "../src/index.ts";

test("phase2 frontier expanded runtime config creates a 32x32 world", () => {
  const state = createInitialWorldState(1001, "perf-frontier-expanded[map:phase2_frontier_expanded]");

  assert.equal(state.meta.mapVariantId, "phase2_frontier_expanded");
  assert.equal(state.map.width, 32);
  assert.equal(state.map.height, 32);
  assert.deepEqual(state.heroes.map((hero) => hero.position), [
    { x: 2, y: 2 },
    { x: 29, y: 29 }
  ]);
});

test("A* pathfinding stays under 50ms per query on the 32x32 frontier-expanded map", () => {
  const state = createInitialWorldState(1001, "perf-frontier-expanded[map:phase2_frontier_expanded]");
  const destination = { x: 28, y: 28 };

  for (let warmup = 0; warmup < 5; warmup += 1) {
    const warmupPath = findPath(state, "hero-1", destination);
    assert.ok(warmupPath && warmupPath.length > 0);
  }

  const runs = 200;
  let totalMs = 0;
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now();
    const path = findPath(state, "hero-1", destination);
    totalMs += performance.now() - startedAt;
    assert.ok(path && path.length > 0);
  }

  const averageMs = totalMs / runs;
  assert.ok(
    averageMs < 50,
    `expected A* average query time under 50ms on the 32x32 frontier-expanded map, received ${averageMs.toFixed(2)}ms`
  );
});
