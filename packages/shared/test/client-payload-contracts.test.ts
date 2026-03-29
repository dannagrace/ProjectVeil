import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createClientMessageFixtures,
  createPlayerProgressionSnapshotFixture,
  createRuntimeDiagnosticsSnapshotFixture,
  createServerMessageFixtures,
  createSessionStatePayloadFixture
} from "./support/multiplayer-protocol-fixtures.ts";
import { assertContractSnapshot } from "./support/contract-snapshot.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_SNAPSHOT_DIR = path.join(THIS_DIR, "fixtures", "contract-snapshots");

test("shared contract snapshots stay stable for high-value client-facing payloads", async (t) => {
  const fixtures = [
    {
      name: "session-state-payload",
      value: createSessionStatePayloadFixture()
    },
    {
      name: "player-progression-snapshot",
      value: createPlayerProgressionSnapshotFixture()
    },
    {
      name: "runtime-diagnostics-snapshot",
      value: createRuntimeDiagnosticsSnapshotFixture()
    },
    {
      name: "multiplayer-client-messages",
      value: createClientMessageFixtures()
    },
    {
      name: "multiplayer-server-messages",
      value: createServerMessageFixtures()
    }
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      assertContractSnapshot(path.join(CONTRACT_SNAPSHOT_DIR, `${fixture.name}.json`), fixture.value);
    });
  }
});
