import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDeterministicSeed,
  nextDeterministicRandom,
  createDeterministicRandomGenerator,
} from "../src/deterministic-rng.ts";

test("normalizeDeterministicSeed(42) returns 42", () => {
  assert.equal(normalizeDeterministicSeed(42), 42);
});

test("normalizeDeterministicSeed(3.9) floors to 3", () => {
  assert.equal(normalizeDeterministicSeed(3.9), 3);
});

test("normalizeDeterministicSeed(NaN) returns default fallback 1", () => {
  assert.equal(normalizeDeterministicSeed(NaN), 1);
});

test("normalizeDeterministicSeed(Infinity) returns default fallback 1", () => {
  assert.equal(normalizeDeterministicSeed(Infinity), 1);
});

test("normalizeDeterministicSeed(-5) returns a positive uint32", () => {
  const result = normalizeDeterministicSeed(-5);
  assert.ok(result >= 0, "result should be non-negative (uint32)");
  assert.ok(Number.isInteger(result), "result should be an integer");
});

test("nextDeterministicRandom with seed 1 returns nextSeed and value in [0,1)", () => {
  const step = nextDeterministicRandom(1);
  assert.ok(typeof step.nextSeed === "number", "nextSeed should be a number");
  assert.ok(typeof step.value === "number", "value should be a number");
  assert.ok(step.value >= 0, "value should be >= 0");
  assert.ok(step.value < 1, "value should be < 1");
});

test("nextDeterministicRandom is deterministic — same seed always produces same output", () => {
  const a = nextDeterministicRandom(42);
  const b = nextDeterministicRandom(42);
  assert.deepEqual(a, b);
});

test("nextDeterministicRandom value is >= 0 and < 1", () => {
  for (const seed of [0, 1, 100, 999999]) {
    const { value } = nextDeterministicRandom(seed);
    assert.ok(value >= 0, `value for seed ${seed} should be >= 0`);
    assert.ok(value < 1, `value for seed ${seed} should be < 1`);
  }
});

test("createDeterministicRandomGenerator(1) — calling twice gives different values", () => {
  const rng = createDeterministicRandomGenerator(1);
  const first = rng();
  const second = rng();
  assert.notEqual(first, second);
});

test("createDeterministicRandomGenerator(1) — two generators with same seed produce identical sequences", () => {
  const rng1 = createDeterministicRandomGenerator(1);
  const rng2 = createDeterministicRandomGenerator(1);
  for (let i = 0; i < 10; i++) {
    assert.equal(rng1(), rng2());
  }
});

test("all returned values from generator are in [0, 1)", () => {
  const rng = createDeterministicRandomGenerator(12345);
  for (let i = 0; i < 20; i++) {
    const val = rng();
    assert.ok(val >= 0, `value at step ${i} should be >= 0`);
    assert.ok(val < 1, `value at step ${i} should be < 1`);
  }
});
