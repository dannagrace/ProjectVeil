import assert from "node:assert/strict";
import test from "node:test";

import { buildCompatibilityEntries, buildCompatibilityReport } from "../multiplayer-protocol-compatibility.ts";

test("buildCompatibilityEntries reports the checked-in multiplayer contract snapshots as compatible", () => {
  const entries = buildCompatibilityEntries();

  assert.deepEqual(
    entries.map((entry) => ({ id: entry.id, status: entry.status })),
    [
      { id: "session-state-payload", status: "compatible" },
      { id: "multiplayer-client-messages", status: "compatible" },
      { id: "multiplayer-server-messages", status: "compatible" }
    ]
  );
});

test("buildCompatibilityReport summarizes incompatible snapshot ids", () => {
  const report = buildCompatibilityReport(
    {
      commit: "abc123",
      shortCommit: "abc123",
      branch: "test-branch",
      dirty: false
    },
    [
      {
        id: "session-state-payload",
        label: "Session state",
        snapshotPath: "fixtures/session-state-payload.json",
        status: "compatible",
        summary: "matches"
      },
      {
        id: "multiplayer-server-messages",
        label: "Server messages",
        snapshotPath: "fixtures/multiplayer-server-messages.json",
        status: "incompatible",
        summary: "changed",
        diff: "line 12"
      }
    ]
  );

  assert.equal(report.summary.status, "incompatible");
  assert.equal(report.summary.snapshotCount, 2);
  assert.equal(report.summary.compatibleSnapshots, 1);
  assert.equal(report.summary.incompatibleSnapshots, 1);
  assert.deepEqual(report.summary.incompatibleSnapshotIds, ["multiplayer-server-messages"]);
});
