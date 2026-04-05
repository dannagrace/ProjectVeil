import fs from "node:fs";
import path from "node:path";
import { createDailyQuestRotationPreview } from "../apps/server/src/daily-quest-rotations.ts";
import type { FeatureFlags } from "../packages/shared/src/index.ts";

interface Args {
  at?: string;
  outputPath: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    outputPath: path.resolve(process.cwd(), "output/daily-quest-rotation-preview.md")
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--at") {
      args.at = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--output") {
      const output = argv[index + 1];
      if (output) {
        args.outputPath = path.resolve(process.cwd(), output);
      }
      index += 1;
    }
  }

  return args;
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolvePreviewFlags(env: NodeJS.ProcessEnv = process.env): Partial<FeatureFlags> {
  return {
    quest_system_enabled: isTruthyEnv(env.VEIL_DAILY_QUESTS_ENABLED),
    battle_pass_enabled: isTruthyEnv(env.VEIL_BATTLE_PASS_ENABLED),
    pve_enabled: isTruthyEnv(env.VEIL_PVE_ENABLED),
    tutorial_enabled: !["0", "false", "no", "off"].includes(env.VEIL_TUTORIAL_ENABLED?.trim().toLowerCase() ?? "")
  };
}

export function renderDailyQuestRotationPreviewMarkdown(
  preview: ReturnType<typeof createDailyQuestRotationPreview>
): string {
  const lines = [
    "# Daily Quest Rotation Preview",
    "",
    `Generated at: ${preview.generatedAt}`,
    `Active date: ${preview.activeDate}`,
    `Enabled flags: ${preview.enabledFlags.length ? preview.enabledFlags.join(", ") : "none"}`,
    "",
    "## Active Rotation",
    preview.activeRotation ? `- ${preview.activeRotation.label} [${preview.activeRotation.id}]` : "- none",
    ...(preview.activeRotation ? ["", "```text", preview.activeRotation.summary, "```"] : []),
    "",
    "## Next Rotation",
    preview.nextRotation
      ? `- ${preview.nextRotation.label} [${preview.nextRotation.id}] starts ${preview.nextRotation.startsOn}`
      : "- none",
    ...(preview.nextRotation ? ["", "```text", preview.nextRotation.summary, "```"] : []),
    ""
  ];

  return lines.join("\n");
}

export function generateDailyQuestRotationPreviewArtifact(
  now = new Date(),
  outputPath = path.resolve(process.cwd(), "output/daily-quest-rotation-preview.md"),
  flags = resolvePreviewFlags()
): string {
  const preview = createDailyQuestRotationPreview(now, flags);
  const markdown = renderDailyQuestRotationPreviewMarkdown(preview);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown, "utf8");
  return markdown;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const now = args.at ? new Date(args.at) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`invalid --at value: ${args.at}`);
  }

  process.stdout.write(generateDailyQuestRotationPreviewArtifact(now, args.outputPath));
}
