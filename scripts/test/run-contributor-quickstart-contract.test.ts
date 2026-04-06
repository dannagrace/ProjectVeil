import assert from "node:assert/strict";
import test from "node:test";

import { runContributorQuickstartContractCli } from "../run-contributor-quickstart-contract.mjs";

test("contract wrapper fails before invoking tsx when runtime preflight fails", () => {
  let spawnCalled = false;

  assert.throws(
    () =>
      runContributorQuickstartContractCli(["--skip-runtime"], {
        assertSupportedRuntimeImpl: () => {
          throw new Error("unsupported runtime");
        },
        spawnSyncImpl: () => {
          spawnCalled = true;
          return { status: 0 };
        }
      }),
    /unsupported runtime/
  );

  assert.equal(spawnCalled, false);
});

test("contract wrapper forwards args into the tsx entrypoint after preflight passes", () => {
  let receivedArgs: string[] | null = null;

  runContributorQuickstartContractCli(["--skip-runtime", "--output", "artifact.json"], {
    assertSupportedRuntimeImpl: () => undefined,
    spawnSyncImpl: (_command, args) => {
      receivedArgs = args;
      return { status: 0 };
    }
  });

  assert.deepEqual(receivedArgs, [
    "--import",
    "tsx",
    "./scripts/contributor-quickstart-contract.ts",
    "--skip-runtime",
    "--output",
    "artifact.json"
  ]);
});
