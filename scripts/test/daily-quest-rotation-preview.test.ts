import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateDailyQuestRotationPreviewArtifact,
  renderDailyQuestRotationPreviewMarkdown
} from "../daily-quest-rotation-preview.ts";
import { createDailyQuestRotationPreview } from "../../apps/server/src/domain/economy/daily-quest-rotations.ts";

test("daily quest rotation preview renders the active and next scheduled rotations", () => {
  const preview = createDailyQuestRotationPreview(
    new Date("2026-04-04T09:00:00.000Z"),
    {
      quest_system_enabled: true,
      pve_enabled: true
    }
  );
  const markdown = renderDailyQuestRotationPreviewMarkdown(preview);

  assert.match(markdown, /Spring Weekend Surge/);
  assert.match(markdown, /Spring Weekday Patrol/);
  assert.match(markdown, /starts 2026-04-06/);
});

test("daily quest rotation preview artifact writes markdown output", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-daily-quest-preview-"));
  const outputPath = path.join(workspace, "preview.md");

  generateDailyQuestRotationPreviewArtifact(
    new Date("2026-04-04T09:00:00.000Z"),
    outputPath,
    {
      quest_system_enabled: true
    }
  );

  const written = fs.readFileSync(outputPath, "utf8");
  assert.match(written, /Daily Quest Rotation Preview/);
  assert.match(written, /Spring Weekend Surge/);
});
