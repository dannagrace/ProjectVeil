import assert from "node:assert/strict";
import test from "node:test";

import { assertBaselineRuntimeHealthResponse, isBaselineRuntimeHealthResponse } from "../runtime-health-contract.mjs";

test("baseline runtime health accepts healthy 200 payloads", () => {
  assert.equal(
    isBaselineRuntimeHealthResponse(200, {
      status: "ok",
      runtime: {
        persistence: {
          status: "healthy",
          storage: "mysql"
        }
      }
    }),
    true
  );
});

test("baseline runtime health accepts degraded in-memory 503 payloads", () => {
  assert.equal(
    isBaselineRuntimeHealthResponse(503, {
      status: "warn",
      runtime: {
        persistence: {
          status: "degraded",
          storage: "memory",
          message: "In-memory room persistence active; room data will not survive process restarts."
        }
      }
    }),
    true
  );
});

test("baseline runtime health still rejects unrelated 503 payloads", () => {
  assert.throws(() =>
    assertBaselineRuntimeHealthResponse(503, {
      status: "warn",
      runtime: {
        persistence: {
          status: "degraded",
          storage: "mysql"
        }
      }
    })
  );
});
