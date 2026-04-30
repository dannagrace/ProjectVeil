import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../src/escape-html.ts";

test("escapeHtml encodes HTML-significant characters", () => {
  assert.equal(
    escapeHtml(`<&>"'/\`plain`),
    "&lt;&amp;&gt;&quot;&#39;&#47;&#96;plain"
  );
});

test("escapeHtml treats nullish values as an empty string", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});
