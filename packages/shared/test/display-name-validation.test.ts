import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DISPLAY_NAME_VALIDATION_RULES,
  findDisplayNameModerationViolation,
  isDisplayNameAllowed,
  normalizeDisplayNameValidationRules,
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

test("display-name moderation enforces configurable game rules", () => {
  const rules = normalizeDisplayNameValidationRules({
    minLength: 3,
    maxLength: 10,
    profanityTerms: ["veilbad"]
  });

  assert.deepEqual(findDisplayNameModerationViolation("xy", rules), {
    term: "min_length",
    reason: "game_rule"
  });
  assert.deepEqual(findDisplayNameModerationViolation("toolongname!", rules), {
    term: "max_length",
    reason: "game_rule"
  });
  assert.deepEqual(findDisplayNameModerationViolation("Veil Bad", rules), {
    term: "veilbad",
    reason: "profanity"
  });
});

test("display-name moderation uses reserved regex rules after NFKC normalization", () => {
  assert.deepEqual(findDisplayNameModerationViolation("ＧＭ007", DEFAULT_DISPLAY_NAME_VALIDATION_RULES), {
    term: "gm",
    reason: "reserved"
  });
});
