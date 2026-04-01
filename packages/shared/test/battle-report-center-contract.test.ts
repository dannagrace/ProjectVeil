import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createBattleReportCenterFixture } from "./support/multiplayer-protocol-fixtures.ts";
import { assertContractSnapshot } from "./support/contract-snapshot.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

test("battle report center contract snapshot stays stable", () => {
  assertContractSnapshot(
    path.join(THIS_DIR, "fixtures", "contract-snapshots", "battle-report-center.json"),
    createBattleReportCenterFixture()
  );
});
