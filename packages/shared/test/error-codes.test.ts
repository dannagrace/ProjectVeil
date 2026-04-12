import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_EVENT_CATALOG,
  STRUCTURED_ERROR_CODE_CATALOG,
  getStructuredErrorCodeDefinition
} from "../src/index";

test("structured error code catalog keeps the operational codes needed by monitoring and client analytics", () => {
  assert.deepEqual(
    Object.keys(STRUCTURED_ERROR_CODE_CATALOG).sort(),
    [
      "auth_invalid",
      "client_error_boundary_triggered",
      "config_hotload_failed",
      "persistence_save_failed",
      "session_disconnect",
      "uncaught_exception",
      "unhandled_rejection"
    ]
  );
  assert.equal(getStructuredErrorCodeDefinition("persistence_save_failed").ownerArea, "multiplayer");
  assert.equal(getStructuredErrorCodeDefinition("client_error_boundary_triggered").severity, "fatal");
});

test("client runtime error analytics schema stays aligned with the structured error contract", () => {
  assert.deepEqual(ANALYTICS_EVENT_CATALOG.client_runtime_error.samplePayload, {
    errorCode: "session_disconnect",
    severity: "error",
    stage: "connection",
    recoverable: true,
    message: "Reconnect failed while restoring the room snapshot."
  });
});
