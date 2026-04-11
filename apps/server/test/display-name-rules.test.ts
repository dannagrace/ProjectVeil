import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  assertDisplayNameAvailableOrThrow,
  clearCachedDisplayNameRules,
  configureDisplayNameRuleRuntimeDependencies,
  getDisplayNameRuleRuntimeSnapshot,
  loadDisplayNameValidationRules,
  resetDisplayNameRuleRuntimeDependencies
} from "../src/display-name-rules";

function withCleanState(t: TestContext): void {
  clearCachedDisplayNameRules();
  resetDisplayNameRuleRuntimeDependencies();
  const originalEnv: Record<string, string | undefined> = {
    VEIL_DISPLAY_NAME_RULES_JSON: process.env.VEIL_DISPLAY_NAME_RULES_JSON,
    VEIL_DISPLAY_NAME_RULES_PATH: process.env.VEIL_DISPLAY_NAME_RULES_PATH,
    VEIL_DISPLAY_NAME_RULES_RELOAD_INTERVAL_MS: process.env.VEIL_DISPLAY_NAME_RULES_RELOAD_INTERVAL_MS
  };
  t.after(() => {
    clearCachedDisplayNameRules();
    resetDisplayNameRuleRuntimeDependencies();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("loadDisplayNameValidationRules falls back to defaults when file is missing", (t) => {
  withCleanState(t);
  configureDisplayNameRuleRuntimeDependencies({
    readFileSync: () => {
      throw new Error("ENOENT");
    }
  });

  const rules = loadDisplayNameValidationRules({});
  assert.equal(rules.schemaVersion, 1);
  assert.ok(rules.reservedTerms.length > 0);
});

test("loadDisplayNameValidationRules hot reloads after the configured interval", (t) => {
  withCleanState(t);
  let nowMs = Date.parse("2026-04-11T00:00:00.000Z");
  let mtimeMs = Date.parse("2026-04-11T00:00:00.000Z");
  let rawConfig = JSON.stringify({
    schemaVersion: 1,
    minLength: 2,
    maxLength: 24,
    reservedTerms: ["gm"],
    profanityTerms: ["bad"],
    reservedPatterns: []
  });

  configureDisplayNameRuleRuntimeDependencies({
    now: () => nowMs,
    statSync: () => ({ mtimeMs } as never),
    readFileSync: () => rawConfig
  });

  const first = loadDisplayNameValidationRules({ VEIL_DISPLAY_NAME_RULES_RELOAD_INTERVAL_MS: "1000" });
  assert.deepEqual(first.profanityTerms, ["bad"]);

  rawConfig = JSON.stringify({
    schemaVersion: 1,
    minLength: 2,
    maxLength: 24,
    reservedTerms: ["gm"],
    profanityTerms: ["worse"],
    reservedPatterns: []
  });
  nowMs += 500;
  const cached = loadDisplayNameValidationRules({ VEIL_DISPLAY_NAME_RULES_RELOAD_INTERVAL_MS: "1000" });
  assert.deepEqual(cached.profanityTerms, ["bad"]);

  nowMs += 1500;
  mtimeMs += 2000;
  const reloaded = loadDisplayNameValidationRules({ VEIL_DISPLAY_NAME_RULES_RELOAD_INTERVAL_MS: "1000" });
  assert.deepEqual(reloaded.profanityTerms, ["worse"]);
});

test("assertDisplayNameAvailableOrThrow rejects active banned-account reservations for other players", async (t) => {
  withCleanState(t);

  await assert.rejects(
    () =>
      assertDisplayNameAvailableOrThrow(
        {
          async findActivePlayerNameReservation(displayName: string) {
            return {
              playerId: "banned-player",
              displayName,
              reservedUntil: "2026-04-18T00:00:00.000Z",
              reason: "banned_account"
            };
          }
        },
        "Ghost Ranger",
        "different-player"
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "display_name_reserved" &&
      error.message.includes("temporarily reserved")
  );
});

test("getDisplayNameRuleRuntimeSnapshot exposes file metadata", (t) => {
  withCleanState(t);
  const nowMs = Date.parse("2026-04-11T02:00:00.000Z");
  const mtimeMs = Date.parse("2026-04-11T01:59:00.000Z");

  configureDisplayNameRuleRuntimeDependencies({
    now: () => nowMs,
    statSync: () => ({ mtimeMs } as never),
    readFileSync: () =>
      JSON.stringify({
        schemaVersion: 1,
        minLength: 2,
        maxLength: 24,
        reservedTerms: ["gm"],
        profanityTerms: ["bad"],
        reservedPatterns: []
      })
  });

  const snapshot = getDisplayNameRuleRuntimeSnapshot({});
  assert.equal(snapshot.metadata.source, "file");
  assert.equal(snapshot.metadata.sourceUpdatedAt, "2026-04-11T01:59:00.000Z");
  assert.ok(snapshot.metadata.checksum.length > 10);
});
