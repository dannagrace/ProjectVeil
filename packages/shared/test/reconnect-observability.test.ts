import assert from "node:assert/strict";
import test from "node:test";
import { classifyReconnectFailure } from "../src/reconnect-observability.ts";

test("classifyReconnectFailure returns version_mismatch for rawReason version_mismatch", () => {
  assert.equal(classifyReconnectFailure({ rawReason: "version_mismatch" }), "version_mismatch");
});

test("classifyReconnectFailure returns version_mismatch for rawReason protocol mismatch", () => {
  assert.equal(classifyReconnectFailure({ rawReason: "protocol mismatch" }), "version_mismatch");
});

test("classifyReconnectFailure returns auth_invalid for rawCode 401", () => {
  assert.equal(classifyReconnectFailure({ rawCode: 401 }), "auth_invalid");
});

test("classifyReconnectFailure returns auth_invalid for rawCode 403", () => {
  assert.equal(classifyReconnectFailure({ rawCode: 403 }), "auth_invalid");
});

test("classifyReconnectFailure returns auth_invalid for rawReason unauthorized", () => {
  assert.equal(classifyReconnectFailure({ rawReason: "unauthorized" }), "auth_invalid");
});

test("classifyReconnectFailure returns auth_invalid for error with message invalid token", () => {
  assert.equal(classifyReconnectFailure({ error: new Error("invalid token") }), "auth_invalid");
});

test("classifyReconnectFailure returns reconnect_window_expired for rawReason reconnect window expired", () => {
  assert.equal(
    classifyReconnectFailure({ rawReason: "reconnect window expired" }),
    "reconnect_window_expired"
  );
});

test("classifyReconnectFailure returns timeout for rawReason connect_timeout", () => {
  assert.equal(classifyReconnectFailure({ rawReason: "connect_timeout" }), "timeout");
});

test("classifyReconnectFailure returns timeout for error with message timed out", () => {
  assert.equal(classifyReconnectFailure({ error: new Error("timed out") }), "timeout");
});

test("classifyReconnectFailure returns transport_lost for rawReason websocket disconnected", () => {
  assert.equal(classifyReconnectFailure({ rawReason: "websocket disconnected" }), "transport_lost");
});

test("classifyReconnectFailure returns transport_lost for rawReason network error", () => {
  assert.equal(classifyReconnectFailure({ rawReason: "network error" }), "transport_lost");
});

test("classifyReconnectFailure returns transport_lost for string error socket closed", () => {
  assert.equal(classifyReconnectFailure({ error: "socket closed" }), "transport_lost");
});

test("classifyReconnectFailure returns unknown for empty input", () => {
  assert.equal(classifyReconnectFailure({}), "unknown");
});

test("classifyReconnectFailure uses custom fallbackReason when no text matches", () => {
  assert.equal(
    classifyReconnectFailure({ fallbackReason: "timeout" }),
    "timeout"
  );
});

test("classifyReconnectFailure checks version_mismatch before auth_invalid when both keywords present", () => {
  // Text contains both "version_mismatch" and "unauthorized" — version_mismatch should win
  assert.equal(
    classifyReconnectFailure({ rawReason: "version_mismatch unauthorized" }),
    "version_mismatch"
  );
});
