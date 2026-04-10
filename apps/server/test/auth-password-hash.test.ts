import assert from "node:assert/strict";
import test from "node:test";
import { hashAccountPassword, verifyAccountPassword } from "../src/auth";

// hashAccountPassword tests

test("hashAccountPassword returns a string with 3 parts split by '$'", () => {
  const hash = hashAccountPassword("password123");
  const parts = hash.split("$");
  assert.equal(parts.length, 3);
});

test("hashAccountPassword first part is 'scrypt'", () => {
  const hash = hashAccountPassword("password123");
  const [algorithm] = hash.split("$");
  assert.equal(algorithm, "scrypt");
});

test("hashAccountPassword salt part is a 32-char hex string", () => {
  const hash = hashAccountPassword("password123");
  const [, salt] = hash.split("$");
  assert.equal(salt.length, 32);
  assert.match(salt, /^[0-9a-f]+$/);
});

test("hashAccountPassword hash part is a 128-char hex string", () => {
  const hash = hashAccountPassword("password123");
  const [, , derivedKey] = hash.split("$");
  assert.equal(derivedKey.length, 128);
  assert.match(derivedKey, /^[0-9a-f]+$/);
});

test("hashAccountPassword produces different output on two calls with the same password (random salt)", () => {
  const hash1 = hashAccountPassword("samepassword");
  const hash2 = hashAccountPassword("samepassword");
  assert.notEqual(hash1, hash2);
});

test("hashAccountPassword returns a non-empty string", () => {
  const hash = hashAccountPassword("anypassword");
  assert.ok(hash.length > 0);
});

// verifyAccountPassword tests

test("verifyAccountPassword returns true for correct password", () => {
  const hash = hashAccountPassword("secret");
  assert.equal(verifyAccountPassword("secret", hash), true);
});

test("verifyAccountPassword returns false for wrong password", () => {
  const hash = hashAccountPassword("secret");
  assert.equal(verifyAccountPassword("wrong", hash), false);
});

test("verifyAccountPassword returns false for wrong algorithm", () => {
  assert.equal(verifyAccountPassword("pass", "bcrypt$salt$hash"), false);
});

test("verifyAccountPassword returns false when salt is missing", () => {
  assert.equal(verifyAccountPassword("pass", "scrypt$$hash"), false);
});

test("verifyAccountPassword returns false when hash is missing", () => {
  assert.equal(verifyAccountPassword("pass", "scrypt$salt$"), false);
});

test("verifyAccountPassword returns false for totally invalid string", () => {
  assert.equal(verifyAccountPassword("pass", "not-a-hash"), false);
});

test("verifyAccountPassword handles empty string password correctly", () => {
  const hash = hashAccountPassword("");
  assert.equal(verifyAccountPassword("", hash), true);
  assert.equal(verifyAccountPassword("notempty", hash), false);
});
