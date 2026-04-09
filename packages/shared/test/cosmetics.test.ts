import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCosmeticInventory,
  normalizeEquippedCosmetics,
  normalizeCosmeticCatalogConfig,
  resolveCosmeticCatalog,
  resolveWeeklyShopRotation
} from "../src/cosmetics.ts";
import type { CosmeticCatalogConfig } from "../src/models.ts";

// ──────────────────────────────────────────────────────────
// normalizeCosmeticInventory
// ──────────────────────────────────────────────────────────

test("normalizeCosmeticInventory: null input returns empty ownedIds", () => {
  const result = normalizeCosmeticInventory(null);
  assert.deepEqual(result.ownedIds, []);
});

test("normalizeCosmeticInventory: undefined input returns empty ownedIds", () => {
  const result = normalizeCosmeticInventory(undefined);
  assert.deepEqual(result.ownedIds, []);
});

test("normalizeCosmeticInventory: empty ownedIds returns empty array", () => {
  assert.deepEqual(normalizeCosmeticInventory({ ownedIds: [] }).ownedIds, []);
});

test("normalizeCosmeticInventory: deduplicates repeated ids", () => {
  const result = normalizeCosmeticInventory({ ownedIds: ["skin-a", "skin-a", "skin-b"] });
  assert.deepEqual(result.ownedIds, ["skin-a", "skin-b"]);
});

test("normalizeCosmeticInventory: sorts ids lexicographically", () => {
  const result = normalizeCosmeticInventory({ ownedIds: ["zzz", "aaa", "mmm"] });
  assert.deepEqual(result.ownedIds, ["aaa", "mmm", "zzz"]);
});

test("normalizeCosmeticInventory: trims whitespace from ids", () => {
  const result = normalizeCosmeticInventory({ ownedIds: ["  skin-a  ", " skin-b"] });
  assert.deepEqual(result.ownedIds, ["skin-a", "skin-b"]);
});

test("normalizeCosmeticInventory: filters out empty-string ids after trim", () => {
  const result = normalizeCosmeticInventory({ ownedIds: ["skin-a", "   ", "skin-b"] });
  assert.deepEqual(result.ownedIds, ["skin-a", "skin-b"]);
});

// ──────────────────────────────────────────────────────────
// normalizeEquippedCosmetics
// ──────────────────────────────────────────────────────────

test("normalizeEquippedCosmetics: null input returns empty object", () => {
  assert.deepEqual(normalizeEquippedCosmetics(null), {});
});

test("normalizeEquippedCosmetics: undefined input returns empty object", () => {
  assert.deepEqual(normalizeEquippedCosmetics(undefined), {});
});

test("normalizeEquippedCosmetics: valid ids are preserved", () => {
  const result = normalizeEquippedCosmetics({
    heroSkinId: "skin-dragon",
    unitRecolorId: "recolor-blue",
    profileBorderId: "border-gold",
    battleEmoteId: "emote-laugh"
  });
  assert.equal(result.heroSkinId, "skin-dragon");
  assert.equal(result.unitRecolorId, "recolor-blue");
  assert.equal(result.profileBorderId, "border-gold");
  assert.equal(result.battleEmoteId, "emote-laugh");
});

test("normalizeEquippedCosmetics: blank heroSkinId is omitted", () => {
  const result = normalizeEquippedCosmetics({ heroSkinId: "   " });
  assert.ok(!("heroSkinId" in result), "blank heroSkinId should not appear in result");
});

test("normalizeEquippedCosmetics: ids are trimmed of surrounding whitespace", () => {
  const result = normalizeEquippedCosmetics({ heroSkinId: "  skin-x  " });
  assert.equal(result.heroSkinId, "skin-x");
});

test("normalizeEquippedCosmetics: partial input keeps only provided non-blank ids", () => {
  const result = normalizeEquippedCosmetics({ profileBorderId: "border-silver" });
  assert.equal(result.profileBorderId, "border-silver");
  assert.ok(!("heroSkinId" in result));
  assert.ok(!("unitRecolorId" in result));
  assert.ok(!("battleEmoteId" in result));
});

// ──────────────────────────────────────────────────────────
// normalizeCosmeticCatalogConfig
// ──────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<{
  id: string; name: string; category: string; rarity: string;
  description: string; price: number; unlockCondition: string; previewAsset: string;
}> = {}) {
  return {
    id: "cosmetic-test",
    name: "Test Skin",
    category: "hero_skin",
    rarity: "common",
    description: "A test cosmetic.",
    price: 100,
    unlockCondition: "shop",
    ...overrides
  };
}

test("normalizeCosmeticCatalogConfig: null input returns empty entries", () => {
  assert.deepEqual(normalizeCosmeticCatalogConfig(null).entries, []);
});

test("normalizeCosmeticCatalogConfig: valid entry passes through intact", () => {
  const config: CosmeticCatalogConfig = { entries: [makeEntry() as never] };
  const result = normalizeCosmeticCatalogConfig(config);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.id, "cosmetic-test");
  assert.equal(result.entries[0]?.category, "hero_skin");
  assert.equal(result.entries[0]?.rarity, "common");
  assert.equal(result.entries[0]?.price, 100);
});

test("normalizeCosmeticCatalogConfig: unknown category falls back to profile_border", () => {
  const config = { entries: [makeEntry({ category: "unknown_type" }) as never] };
  const result = normalizeCosmeticCatalogConfig(config);
  assert.equal(result.entries[0]?.category, "profile_border");
});

test("normalizeCosmeticCatalogConfig: unknown rarity falls back to common", () => {
  const config = { entries: [makeEntry({ rarity: "mythical" }) as never] };
  const result = normalizeCosmeticCatalogConfig(config);
  assert.equal(result.entries[0]?.rarity, "common");
});

test("normalizeCosmeticCatalogConfig: negative price is clamped to 0", () => {
  const config = { entries: [makeEntry({ price: -50 }) as never] };
  const result = normalizeCosmeticCatalogConfig(config);
  assert.equal(result.entries[0]?.price, 0);
});

test("normalizeCosmeticCatalogConfig: missing id falls back to cosmetic-N index", () => {
  const config = { entries: [makeEntry({ id: "" }) as never] };
  const result = normalizeCosmeticCatalogConfig(config);
  assert.equal(result.entries[0]?.id, "cosmetic-1");
});

test("normalizeCosmeticCatalogConfig: missing description falls back to name + cosmetic suffix", () => {
  const config = { entries: [makeEntry({ description: "" }) as never] };
  const result = normalizeCosmeticCatalogConfig(config);
  assert.ok(result.entries[0]?.description.includes("cosmetic"), "description fallback should contain 'cosmetic'");
});

test("normalizeCosmeticCatalogConfig: previewAsset is omitted when blank", () => {
  const config = { entries: [makeEntry({ previewAsset: "   " }) as never] };
  const result = normalizeCosmeticCatalogConfig(config);
  assert.ok(!("previewAsset" in (result.entries[0] ?? {})), "blank previewAsset should not appear");
});

test("normalizeCosmeticCatalogConfig: previewAsset is preserved when non-blank", () => {
  const config = { entries: [makeEntry({ previewAsset: " skin-preview.png " }) as never] };
  const result = normalizeCosmeticCatalogConfig(config);
  assert.equal((result.entries[0] as { previewAsset?: string })?.previewAsset, "skin-preview.png");
});

// ──────────────────────────────────────────────────────────
// resolveCosmeticCatalog
// ──────────────────────────────────────────────────────────

test("resolveCosmeticCatalog: returns an array of cosmetic definitions", () => {
  const catalog = resolveCosmeticCatalog();
  assert.ok(Array.isArray(catalog));
});

test("resolveCosmeticCatalog: all entries have required fields", () => {
  const catalog = resolveCosmeticCatalog();
  for (const entry of catalog) {
    assert.ok(entry.id, `entry missing id`);
    assert.ok(entry.name, `${entry.id} missing name`);
    assert.ok(["hero_skin", "unit_recolor", "profile_border", "battle_emote"].includes(entry.category), `${entry.id} has invalid category`);
    assert.ok(["common", "rare", "epic", "legendary"].includes(entry.rarity), `${entry.id} has invalid rarity`);
    assert.ok(entry.price >= 0, `${entry.id} has negative price`);
  }
});

// ──────────────────────────────────────────────────────────
// resolveWeeklyShopRotation
// ──────────────────────────────────────────────────────────

test("resolveWeeklyShopRotation: returns seed, weekLabel, featuredSlots, discountSlots", () => {
  const rotation = resolveWeeklyShopRotation(new Date("2026-04-07"));
  assert.ok(typeof rotation.seed === "string" && rotation.seed.length > 0);
  assert.ok(typeof rotation.weekLabel === "string" && rotation.weekLabel.length > 0);
  assert.ok(Array.isArray(rotation.featuredSlots));
  assert.ok(Array.isArray(rotation.discountSlots));
});

test("resolveWeeklyShopRotation: same date produces same rotation (deterministic)", () => {
  const date = new Date("2026-04-07T00:00:00.000Z");
  const a = resolveWeeklyShopRotation(date);
  const b = resolveWeeklyShopRotation(date);
  assert.deepEqual(a, b);
});

test("resolveWeeklyShopRotation: different weeks produce different seeds", () => {
  const week1 = resolveWeeklyShopRotation(new Date("2026-04-07"));
  const week2 = resolveWeeklyShopRotation(new Date("2026-04-14"));
  assert.notEqual(week1.seed, week2.seed);
});

test("resolveWeeklyShopRotation: seed format includes ISO year and week number", () => {
  const rotation = resolveWeeklyShopRotation(new Date("2026-04-07"));
  assert.match(rotation.seed, /^\d{4}-W\d{2}$/);
});

test("resolveWeeklyShopRotation: weekLabel format matches seed format", () => {
  const rotation = resolveWeeklyShopRotation(new Date("2026-04-07"));
  assert.match(rotation.weekLabel, /^\d{4} W\d{2}$/);
});

test("resolveWeeklyShopRotation: featured slot cosmeticIds are distinct (no duplicates within rotation)", () => {
  const rotation = resolveWeeklyShopRotation(new Date("2026-04-07"));
  const ids = rotation.featuredSlots.map((s) => s.cosmeticId).filter(Boolean);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, "featured slot cosmeticIds should not repeat");
});

test("resolveWeeklyShopRotation: dates within same ISO week return same rotation", () => {
  // 2026-04-07 (Tuesday) and 2026-04-09 (Thursday) are in the same ISO week
  const tuesday = resolveWeeklyShopRotation(new Date("2026-04-07"));
  const thursday = resolveWeeklyShopRotation(new Date("2026-04-09"));
  assert.equal(tuesday.seed, thursday.seed);
  assert.deepEqual(tuesday.featuredSlots, thursday.featuredSlots);
});
