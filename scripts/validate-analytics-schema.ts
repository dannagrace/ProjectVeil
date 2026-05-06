import { validateAnalyticsEventCatalog } from "../packages/shared/src/index.ts";

const [unknownArg] = process.argv.slice(2);
if (unknownArg) {
  console.error(`Analytics schema validation failed: Unknown argument: ${unknownArg}`);
  process.exitCode = 1;
} else {
  const result = validateAnalyticsEventCatalog();

  if (!result.valid) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
  } else {
    console.log("Analytics schema catalog is valid.");
  }
}
