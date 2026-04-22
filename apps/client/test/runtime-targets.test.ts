import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeServerHttpUrl, resolveRuntimeServerWsUrl } from "../src/runtime-targets";

test("runtime target helpers fall back to localhost defaults when import.meta.env is unavailable", () => {
  assert.equal(resolveRuntimeServerHttpUrl(), "http://127.0.0.1:2567");
  assert.equal(resolveRuntimeServerWsUrl(), "ws://127.0.0.1:2567");
});
