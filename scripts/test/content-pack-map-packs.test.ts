import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONTENT_PACK_MAP_PACK,
  EXTRA_CONTENT_PACK_MAP_PACKS,
  resolveContentPackMapPack,
  resolveExtraContentPackMapPack
} from "../content-pack-map-packs.ts";

// resolveContentPackMapPack

test("resolveContentPackMapPack returns DEFAULT_CONTENT_PACK_MAP_PACK for 'default'", () => {
  const result = resolveContentPackMapPack("default");
  assert.strictEqual(result, DEFAULT_CONTENT_PACK_MAP_PACK);
});

test("resolveContentPackMapPack returns DEFAULT_CONTENT_PACK_MAP_PACK for alias 'phase1'", () => {
  const result = resolveContentPackMapPack("phase1");
  assert.strictEqual(result, DEFAULT_CONTENT_PACK_MAP_PACK);
});

test("resolveContentPackMapPack trims and lowercases the input ('  DEFAULT  ')", () => {
  const result = resolveContentPackMapPack("  DEFAULT  ");
  assert.strictEqual(result, DEFAULT_CONTENT_PACK_MAP_PACK);
});

test("resolveContentPackMapPack returns frontier-basin definition by id", () => {
  const result = resolveContentPackMapPack("frontier-basin");
  const expected = EXTRA_CONTENT_PACK_MAP_PACKS.find((p) => p.id === "frontier-basin");
  assert.ok(expected, "frontier-basin should exist in EXTRA_CONTENT_PACK_MAP_PACKS");
  assert.strictEqual(result, expected);
});

test("resolveContentPackMapPack returns frontier-basin definition by alias 'frontier_basin'", () => {
  const result = resolveContentPackMapPack("frontier_basin");
  const expected = EXTRA_CONTENT_PACK_MAP_PACKS.find((p) => p.id === "frontier-basin");
  assert.ok(expected);
  assert.strictEqual(result, expected);
});

test("resolveContentPackMapPack returns stonewatch-fork by alias 'stonewatch'", () => {
  const result = resolveContentPackMapPack("stonewatch");
  const expected = EXTRA_CONTENT_PACK_MAP_PACKS.find((p) => p.id === "stonewatch-fork");
  assert.ok(expected);
  assert.strictEqual(result, expected);
});

test("resolveContentPackMapPack returns phase2 (contested-basin) by id 'phase2'", () => {
  const result = resolveContentPackMapPack("phase2");
  const expected = EXTRA_CONTENT_PACK_MAP_PACKS.find((p) => p.id === "phase2");
  assert.ok(expected);
  assert.strictEqual(result, expected);
});

test("resolveContentPackMapPack returns phase2 (contested-basin) by alias 'contested_basin'", () => {
  const result = resolveContentPackMapPack("contested_basin");
  const expected = EXTRA_CONTENT_PACK_MAP_PACKS.find((p) => p.id === "phase2");
  assert.ok(expected);
  assert.strictEqual(result, expected);
});

test("resolveContentPackMapPack returns verdant-vale pack by id 'phase2-verdant-vale'", () => {
  const result = resolveContentPackMapPack("phase2-verdant-vale");
  const expected = EXTRA_CONTENT_PACK_MAP_PACKS.find((p) => p.id === "phase2-verdant-vale");
  assert.ok(expected);
  assert.strictEqual(result, expected);
});

test("resolveContentPackMapPack returns verdant-vale pack by alias 'verdant_vale'", () => {
  const result = resolveContentPackMapPack("verdant_vale");
  const expected = EXTRA_CONTENT_PACK_MAP_PACKS.find((p) => p.id === "phase2-verdant-vale");
  assert.ok(expected);
  assert.strictEqual(result, expected);
});

test("resolveContentPackMapPack returns undefined for unknown id", () => {
  const result = resolveContentPackMapPack("unknown-map");
  assert.strictEqual(result, undefined);
});

// resolveExtraContentPackMapPack

test("resolveExtraContentPackMapPack returns undefined for 'default'", () => {
  const result = resolveExtraContentPackMapPack("default");
  assert.strictEqual(result, undefined);
});

test("resolveExtraContentPackMapPack returns undefined for default alias 'phase1'", () => {
  const result = resolveExtraContentPackMapPack("phase1");
  assert.strictEqual(result, undefined);
});

test("resolveExtraContentPackMapPack returns frontier-basin definition", () => {
  const result = resolveExtraContentPackMapPack("frontier-basin");
  const expected = EXTRA_CONTENT_PACK_MAP_PACKS.find((p) => p.id === "frontier-basin");
  assert.ok(expected);
  assert.strictEqual(result, expected);
});

test("resolveExtraContentPackMapPack returns undefined for unknown id", () => {
  const result = resolveExtraContentPackMapPack("unknown");
  assert.strictEqual(result, undefined);
});

test("resolved frontier-basin has correct worldFileName and phase", () => {
  const result = resolveContentPackMapPack("frontier-basin");
  assert.ok(result, "frontier-basin should resolve");
  assert.strictEqual(result.worldFileName, "phase1-world-frontier-basin.json");
  assert.strictEqual(result.phase, "phase1");
});
