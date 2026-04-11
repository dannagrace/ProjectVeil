import assert from "node:assert/strict";
import test from "node:test";
import {
  compareClientVersions,
  DEFAULT_MIN_SUPPORTED_CLIENT_VERSION,
  isClientVersionSupported,
  parseClientVersion
} from "../src/client-version.ts";

test("parseClientVersion accepts major minor patch versions", () => {
  assert.deepEqual(parseClientVersion("1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3
  });
});

test("compareClientVersions orders semantic client versions", () => {
  assert.equal(compareClientVersions("1.2.3", "1.2.2"), 1);
  assert.equal(compareClientVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareClientVersions("1.2.3", "1.3.0"), -1);
});

test("isClientVersionSupported rejects missing or invalid versions once a minimum is configured", () => {
  assert.equal(isClientVersionSupported(undefined, DEFAULT_MIN_SUPPORTED_CLIENT_VERSION), true);
  assert.equal(isClientVersionSupported("bogus", DEFAULT_MIN_SUPPORTED_CLIENT_VERSION), true);
  assert.equal(isClientVersionSupported(undefined, "1.0.0"), false);
  assert.equal(isClientVersionSupported("bogus", "1.0.0"), false);
  assert.equal(isClientVersionSupported("0.9.9", "1.0.0"), false);
  assert.equal(isClientVersionSupported("1.0.0", "1.0.0"), true);
  assert.equal(isClientVersionSupported("1.0.1", "1.0.0"), true);
});
