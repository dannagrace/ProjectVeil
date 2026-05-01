import assert from "node:assert/strict";
import test from "node:test";

import {
  renderBattleLogLines,
  renderBattleModalBody,
  renderBattleModalTitle,
  renderEventLogLines,
  renderTimelineCopy
} from "../src/main/html-safe-render";

test("H5 text sinks render server-provided HTML-like strings as text", () => {
  const payload = `<img src=x onerror="alert(1)">`;

  const rendered = [
    renderEventLogLines([`Found equipment: ${payload}`]),
    renderBattleLogLines([`Wolf used ${payload}`]),
    renderTimelineCopy(`战利品：${payload}`),
    renderBattleModalTitle(`Victory ${payload}`),
    renderBattleModalBody(`Aftermath ${payload}`)
  ].join("\n");

  assert.equal(rendered.includes("<img"), false);
  assert.equal(rendered.includes("onerror=\"alert(1)\""), false);
  assert.match(rendered, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});
