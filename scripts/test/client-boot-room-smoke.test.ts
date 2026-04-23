import assert from "node:assert/strict";
import test from "node:test";

import { resolveSmokeRuntimeTargets } from "../client-boot-room-smoke";

test("resolveSmokeRuntimeTargets honors explicit playwright runtime target env", () => {
  const targets = resolveSmokeRuntimeTargets({
    VEIL_PLAYWRIGHT_SERVER_ORIGIN: "http://127.0.0.1:2867",
    VEIL_PLAYWRIGHT_CLIENT_ORIGIN: "http://127.0.0.1:4473",
    VEIL_PLAYWRIGHT_SERVER_WS_URL: "ws://127.0.0.1:2867"
  });

  assert.deepEqual(targets, {
    serverUrl: "http://127.0.0.1:2867",
    clientUrl: "http://127.0.0.1:4473",
    serverWsUrl: "ws://127.0.0.1:2867"
  });
});

test("resolveSmokeRuntimeTargets falls back to localhost defaults", () => {
  const targets = resolveSmokeRuntimeTargets({});

  assert.deepEqual(targets, {
    serverUrl: "http://127.0.0.1:2567",
    clientUrl: "http://127.0.0.1:4173",
    serverWsUrl: "ws://127.0.0.1:2567"
  });
});
