import assert from "node:assert/strict";
import test from "node:test";

import { runDemoFlow } from "../demo.ts";

test("demo flow follows the current map rules through neutral battle resolution", () => {
  const lines: string[] = [];

  runDemoFlow((line) => lines.push(line));

  const output = lines.join("\n");
  assert.doesNotMatch(output, /ok=false/);
  assert.match(output, /=== Move To \(5,4\) ===/);
  assert.match(output, /"type":"battle\.started"/);
  assert.match(output, /=== World After Battle ===/);
  assert.match(output, /"type":"battle\.resolved"/);
  assert.match(output, /"type":"hero\.progressed"/);
  assert.match(output, /"type":"hero\.collected"/);
  assert.match(output, /Resources \{"gold":300,"wood":0,"ore":0\}/);
});
