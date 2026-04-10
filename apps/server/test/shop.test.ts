import assert from "node:assert/strict";
import test from "node:test";
import { resolveShopProducts } from "../src/shop";

// resolveShopProducts — happy path using default config

test("resolveShopProducts returns an array of shop products from the default config", () => {
  const products = resolveShopProducts();
  assert.ok(Array.isArray(products));
  assert.ok(products.length > 0);
});

test("resolveShopProducts every product has a non-empty productId and name", () => {
  const products = resolveShopProducts();
  for (const product of products) {
    assert.ok(product.productId.length > 0, `productId should not be empty`);
    assert.ok(product.name.length > 0, `name for ${product.productId} should not be empty`);
  }
});

test("resolveShopProducts every product has a valid type", () => {
  const validTypes = new Set(["gem_pack", "equipment", "resource_bundle", "season_pass_premium", "cosmetic"]);
  const products = resolveShopProducts();
  for (const product of products) {
    assert.ok(validTypes.has(product.type), `product ${product.productId} has invalid type: ${product.type}`);
  }
});

test("resolveShopProducts every product price is a non-negative integer", () => {
  const products = resolveShopProducts();
  for (const product of products) {
    assert.ok(Number.isInteger(product.price), `price for ${product.productId} should be an integer`);
    assert.ok(product.price >= 0, `price for ${product.productId} should be non-negative`);
  }
});

test("resolveShopProducts every product has an enabled boolean field", () => {
  const products = resolveShopProducts();
  for (const product of products) {
    assert.equal(typeof product.enabled, "boolean");
  }
});

test("resolveShopProducts includes the resource-bundle-starter product", () => {
  const products = resolveShopProducts();
  const starter = products.find((p) => p.productId === "resource-bundle-starter");
  assert.ok(starter, "resource-bundle-starter should be present");
  assert.equal(starter?.type, "resource_bundle");
  assert.equal(starter?.price, 25);
  assert.equal(starter?.enabled, true);
});

test("resolveShopProducts resource-bundle-starter grant has expected resources", () => {
  const products = resolveShopProducts();
  const starter = products.find((p) => p.productId === "resource-bundle-starter");
  assert.ok(starter?.grant.resources, "grant.resources should be present");
  assert.equal(starter?.grant.resources?.gold, 250);
  assert.equal(starter?.grant.resources?.wood, 40);
  assert.equal(starter?.grant.resources?.ore, 20);
});

test("resolveShopProducts includes the gem-pack-scout product and is disabled", () => {
  const products = resolveShopProducts();
  const gemPack = products.find((p) => p.productId === "gem-pack-scout");
  assert.ok(gemPack, "gem-pack-scout should be present");
  assert.equal(gemPack?.type, "gem_pack");
  assert.equal(gemPack?.enabled, false);
  assert.ok((gemPack?.grant.gems ?? 0) > 0, "gem pack should have gems in grant");
});

test("resolveShopProducts gem-pack-scout has wechatPriceFen set", () => {
  const products = resolveShopProducts();
  const gemPack = products.find((p) => p.productId === "gem-pack-scout");
  assert.ok(gemPack?.wechatPriceFen != null, "gem-pack-scout should have wechatPriceFen");
  assert.equal(gemPack?.wechatPriceFen, 600);
});

test("resolveShopProducts includes the season-pass-premium product", () => {
  const products = resolveShopProducts();
  const pass = products.find((p) => p.productId === "season-pass-premium");
  assert.ok(pass, "season-pass-premium should be present");
  assert.equal(pass?.type, "season_pass_premium");
  assert.equal(pass?.grant.seasonPassPremium, true);
});

test("resolveShopProducts includes the equipment-sunforged-kit product", () => {
  const products = resolveShopProducts();
  const kit = products.find((p) => p.productId === "equipment-sunforged-kit");
  assert.ok(kit, "equipment-sunforged-kit should be present");
  assert.equal(kit?.type, "equipment");
  assert.ok(Array.isArray(kit?.grant.equipmentIds));
  assert.ok((kit?.grant.equipmentIds?.length ?? 0) > 0, "equipment grant must include equipmentIds");
});

// resolveShopProducts — with custom options

test("resolveShopProducts with empty options.products returns empty array", () => {
  const products = resolveShopProducts({ products: [] });
  assert.deepEqual(products, []);
});

test("resolveShopProducts with explicit null options.products falls back to default config", () => {
  const defaultProducts = resolveShopProducts();
  const products = resolveShopProducts({ products: undefined });
  assert.equal(products.length, defaultProducts.length);
});

test("resolveShopProducts with custom gem_pack product returns normalized product", () => {
  const products = resolveShopProducts({
    products: [
      {
        productId: "  test-gem-pack  ",
        name: "  Test Gem Pack  ",
        type: "gem_pack",
        price: 10,
        enabled: true,
        grant: { gems: 50 }
      }
    ]
  });
  assert.equal(products.length, 1);
  const product = products[0]!;
  assert.equal(product.productId, "test-gem-pack");
  assert.equal(product.name, "Test Gem Pack");
  assert.equal(product.type, "gem_pack");
  assert.equal(product.price, 10);
  assert.equal(product.enabled, true);
  assert.equal(product.grant.gems, 50);
});

test("resolveShopProducts with custom resource_bundle product returns normalized resources", () => {
  const products = resolveShopProducts({
    products: [
      {
        productId: "custom-bundle",
        name: "Custom Bundle",
        type: "resource_bundle",
        price: 0,
        enabled: true,
        grant: { resources: { gold: 100.9, wood: 50.1, ore: 25.7 } }
      }
    ]
  });
  const product = products[0]!;
  assert.equal(product.grant.resources?.gold, 100);
  assert.equal(product.grant.resources?.wood, 50);
  assert.equal(product.grant.resources?.ore, 25);
});

test("resolveShopProducts normalizes fractional price by flooring", () => {
  const products = resolveShopProducts({
    products: [
      {
        productId: "cheap-bundle",
        name: "Cheap Bundle",
        type: "resource_bundle",
        price: 9.9,
        enabled: true,
        grant: { resources: { gold: 10 } }
      }
    ]
  });
  assert.equal(products[0]!.price, 9);
});

test("resolveShopProducts enabled defaults to true when not specified", () => {
  const products = resolveShopProducts({
    products: [
      {
        productId: "no-enabled-flag",
        name: "No Enabled Flag",
        type: "resource_bundle",
        price: 5,
        grant: { resources: { gold: 10 } }
      }
    ]
  });
  assert.equal(products[0]!.enabled, true);
});

test("resolveShopProducts season_pass_premium product with seasonPassPremium true", () => {
  const products = resolveShopProducts({
    products: [
      {
        productId: "pass-premium",
        name: "Pass Premium",
        type: "season_pass_premium",
        price: 99,
        enabled: true,
        grant: { seasonPassPremium: true }
      }
    ]
  });
  assert.equal(products[0]!.grant.seasonPassPremium, true);
});

// resolveShopProducts — validation errors

test("resolveShopProducts throws if productId is missing", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            name: "Missing ID",
            type: "gem_pack",
            price: 10,
            grant: { gems: 5 }
          }
        ]
      }),
    /productId is required/
  );
});

test("resolveShopProducts throws if productId is whitespace-only", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "   ",
            name: "Whitespace ID",
            type: "gem_pack",
            price: 10,
            grant: { gems: 5 }
          }
        ]
      }),
    /productId is required/
  );
});

test("resolveShopProducts throws if name is missing", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "some-product",
            type: "gem_pack",
            price: 10,
            grant: { gems: 5 }
          }
        ]
      }),
    /name is required/
  );
});

test("resolveShopProducts throws if type is invalid", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "bad-type",
            name: "Bad Type",
            type: "invalid_type" as never,
            price: 10,
            grant: { gems: 5 }
          }
        ]
      }),
    /type must be/
  );
});

test("resolveShopProducts throws if gem_pack has no gems in grant (empty grant)", () => {
  // When gems is absent or zero the grant is considered empty, which is caught first
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "bad-gem-pack",
            name: "Bad Gem Pack",
            type: "gem_pack",
            price: 10,
            grant: {}
          }
        ]
      }),
    /grant must not be empty/
  );
});

test("resolveShopProducts throws if equipment product has no equipmentIds", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "bad-equipment",
            name: "Bad Equipment",
            type: "equipment",
            price: 10,
            grant: { gems: 5 }
          }
        ]
      }),
    /equipment grants must include equipmentIds/
  );
});

test("resolveShopProducts throws if cosmetic product has no cosmeticIds", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "bad-cosmetic",
            name: "Bad Cosmetic",
            type: "cosmetic",
            price: 10,
            grant: { gems: 5 }
          }
        ]
      }),
    /cosmetic grants must include cosmeticIds/
  );
});

test("resolveShopProducts throws if resource_bundle has no resources", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "bad-bundle",
            name: "Bad Bundle",
            type: "resource_bundle",
            price: 5,
            grant: { gems: 5 }
          }
        ]
      }),
    /resource bundles must include resources/
  );
});

test("resolveShopProducts throws if season_pass_premium grant does not set seasonPassPremium", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "bad-pass",
            name: "Bad Pass",
            type: "season_pass_premium",
            price: 10,
            grant: { gems: 5 }
          }
        ]
      }),
    /season pass premium grants must set seasonPassPremium/
  );
});

test("resolveShopProducts throws if grant references an unknown equipment id", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "unknown-equip",
            name: "Unknown Equip",
            type: "equipment",
            price: 10,
            grant: { equipmentIds: ["totally_nonexistent_item_xyz"] }
          }
        ]
      }),
    /unknown equipment/
  );
});

test("resolveShopProducts throws if grant references an unknown cosmetic id", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "unknown-cosmetic",
            name: "Unknown Cosmetic",
            type: "cosmetic",
            price: 10,
            grant: { cosmeticIds: ["cosmetic-does-not-exist-xyz" as never] }
          }
        ]
      }),
    /unknown cosmetic/
  );
});

test("resolveShopProducts throws if grant is entirely empty", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "empty-grant",
            name: "Empty Grant",
            type: "gem_pack",
            price: 10,
            grant: {}
          }
        ]
      }),
    /grant must not be empty/
  );
});

test("resolveShopProducts throws if price is NaN", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "nan-price",
            name: "NaN Price",
            type: "gem_pack",
            price: Number.NaN,
            grant: { gems: 5 }
          }
        ]
      }),
    /non-negative integer/
  );
});

test("resolveShopProducts throws if price is negative", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "neg-price",
            name: "Negative Price",
            type: "gem_pack",
            price: -1,
            grant: { gems: 5 }
          }
        ]
      }),
    /non-negative integer/
  );
});

test("resolveShopProducts throws if wechatPriceFen is zero", () => {
  assert.throws(
    () =>
      resolveShopProducts({
        products: [
          {
            productId: "zero-wechat",
            name: "Zero WeChat Price",
            type: "gem_pack",
            price: 5,
            wechatPriceFen: 0,
            grant: { gems: 5 }
          }
        ]
      }),
    /positive integer/
  );
});
