import assert from "node:assert/strict";
import test from "node:test";
import { scanAccountsForDisplayNameViolations } from "../scan-player-display-names";
import type { PlayerAccountSnapshot } from "@server/persistence";
import { clearCachedDisplayNameRules } from "@server/domain/account/display-name-rules";

test("scanAccountsForDisplayNameViolations reports banned-word matches using runtime rules", () => {
  clearCachedDisplayNameRules();
  process.env.VEIL_DISPLAY_NAME_RULES_JSON = JSON.stringify({
    schemaVersion: 1,
    minLength: 2,
    maxLength: 24,
    reservedTerms: ["gm"],
    profanityTerms: ["veilbad"],
    reservedPatterns: ["^admin\\d*$"]
  });

  const findings = scanAccountsForDisplayNameViolations([
    {
      playerId: "player-ok",
      displayName: "Nightwatch",
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      recentEventLog: []
    },
    {
      playerId: "player-bad",
      displayName: "Veil Bad",
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      recentEventLog: []
    }
  ] as PlayerAccountSnapshot[]);

  assert.deepEqual(findings, [
    {
      playerId: "player-bad",
      displayName: "Veil Bad",
      reason: "profanity",
      matchedTerm: "veilbad"
    }
  ]);

  clearCachedDisplayNameRules();
  delete process.env.VEIL_DISPLAY_NAME_RULES_JSON;
});
