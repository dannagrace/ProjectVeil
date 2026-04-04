import { validateAnalyticsEventCatalog } from "../packages/shared/src/index.ts";

const result = validateAnalyticsEventCatalog();

if (!result.valid) {
  for (const error of result.errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log("Analytics schema catalog is valid.");
}
