import assert from "node:assert/strict";
import test from "node:test";
import {
  findDisplayNameModerationViolation,
  isDisplayNameAllowed,
  normalizeTextForModeration
} from "../src/display-name-validation.ts";

test("display-name moderation normalizes punctuation and spacing before matching blocked terms", () => {
  assert.equal(normalizeTextForModeration(" G.M! "), "gm");
  assert.deepEqual(findDisplayNameModerationViolation("G.M!"), {
    term: "gm",
    reason: "reserved"
  });
});

test("display-name moderation allows ordinary names", () => {
  assert.equal(isDisplayNameAllowed("Nightwatch"), true);
  assert.equal(findDisplayNameModerationViolation("Nightwatch"), null);
});
