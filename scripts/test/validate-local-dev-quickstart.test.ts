import assert from "node:assert/strict";
import test from "node:test";

import {
  QUICKSTART_SERVER_URL,
  resolveQuickstartRuntimeTargets
} from "../validate-local-dev-quickstart.mjs";

test("resolveQuickstartRuntimeTargets honors explicit runtime target env", () => {
  const targets = resolveQuickstartRuntimeTargets({
    VEIL_PLAYWRIGHT_SERVER_ORIGIN: "http://127.0.0.1:2867"
  });

  assert.deepEqual(targets, {
    serverUrl: "http://127.0.0.1:2867"
  });
});

test("resolveQuickstartRuntimeTargets keeps the documented default when reuse is requested", () => {
  const targets = resolveQuickstartRuntimeTargets({
    VEIL_PLAYWRIGHT_REUSE_SERVER: "1"
  });

  assert.deepEqual(targets, {
    serverUrl: QUICKSTART_SERVER_URL
  });
});

test("resolveQuickstartRuntimeTargets derives a workspace-specific server port by default", () => {
  const targets = resolveQuickstartRuntimeTargets({
    VEIL_PLAYWRIGHT_WORKSPACE_SEED: "quickstart-test"
  });

  assert.deepEqual(targets, {
    serverUrl: "http://127.0.0.1:2749"
  });
});
