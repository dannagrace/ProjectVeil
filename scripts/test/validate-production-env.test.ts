import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvFile, PRODUCTION_ENV_VARS, validateProductionEnv } from "../validate-production-env.mjs";

test("validateProductionEnv passes when all required variables are present", () => {
  const envText = PRODUCTION_ENV_VARS.map((key) => `${key}=value`).join("\n");
  const result = validateProductionEnv(parseEnvFile(envText));

  assert.equal(result.expectedCount, 27);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.blank, []);
});

test("validateProductionEnv reports missing and blank values", () => {
  const envText = `${PRODUCTION_ENV_VARS[0]}=value\n${PRODUCTION_ENV_VARS[1]}=\n`;
  const result = validateProductionEnv(parseEnvFile(envText));

  assert.deepEqual(result.missing, PRODUCTION_ENV_VARS.slice(2));
  assert.deepEqual(result.blank, [PRODUCTION_ENV_VARS[1]]);
});
