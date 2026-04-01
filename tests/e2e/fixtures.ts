import { test as base } from "@playwright/test";

const SERVER_BASE_URL = "http://127.0.0.1:2567";
const RESET_ENDPOINT = `${SERVER_BASE_URL}/api/test/reset-store`;

/**
 * Custom test fixture that automatically resets the server's in-memory store
 * before each test, ensuring test isolation and preventing resource accumulation
 *
 * Server-side reset handles:
 * - In-memory room snapshots
 * - Player accounts  
 * - Auth session data (via resetGuestAuthSessions)
 * - All other in-memory state
 *
 * The client-side reset happens when the fixture clears browser storage before
 * any test navigation, ensuring stale tokens aren't reused.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    // Reset the server's in-memory store before each test
    try {
      const response = await page.context().request.post(RESET_ENDPOINT);
      if (!response.ok()) {
        console.warn(`Store reset failed: ${response.status()}`);
      }
    } catch (error) {
      console.warn("Failed to reset store:", error);
    }

    // Clear browser storage to prevent auth token reuse
    // We must do this AFTER server reset but BEFORE test navigates
    // Navigate to any URL first to establish context, then clear storage
    try {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    } catch {
      // Ignore storage clearing errors if page hasn't loaded yet
    }

    // Use the page for the test
    await use(page);
  }
});

// Re-export other common test utilities
export { expect } from "@playwright/test";
