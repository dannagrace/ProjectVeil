import { test as base } from "@playwright/test";

const SERVER_BASE_URL = "http://127.0.0.1:2567";
const RESET_ENDPOINT = `${SERVER_BASE_URL}/api/test/reset-store`;

/**
 * Custom test fixture that automatically resets the server's in-memory store
 * before each test, ensuring test isolation and preventing resource accumulation
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    // Reset the server's in-memory store before each test by making a direct HTTP call
    // This happens before any test navigation to ensure clean state
    try {
      const response = await page.context().request.post(RESET_ENDPOINT);
      if (!response.ok()) {
        console.warn(`Store reset failed: ${response.status()}`);
      }
    } catch (error) {
      console.warn("Failed to reset store:", error);
      // Continue anyway - the endpoint might not be available in all environments
    }

    // Use the page for the test
    await use(page);
  }
});

// Re-export other common test utilities
export { expect } from "@playwright/test";
