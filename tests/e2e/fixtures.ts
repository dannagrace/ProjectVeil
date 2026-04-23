import { test as base } from "@playwright/test";
import { ADMIN_TOKEN, CLIENT_BASE_URL, RESET_ENDPOINT } from "./runtime-targets";

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
      let response = await page.context().request.post(RESET_ENDPOINT, {
        headers: {
          "x-veil-admin-token": ADMIN_TOKEN
        }
      });
      for (let attempt = 0; attempt < 4 && response.status() === 429; attempt += 1) {
        const retryAfterSeconds = Math.max(1, Number(response.headers()["retry-after"] ?? "1"));
        await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
        response = await page.context().request.post(RESET_ENDPOINT, {
          headers: {
            "x-veil-admin-token": ADMIN_TOKEN
          }
        });
      }
      if (!response.ok()) {
        console.warn(`Store reset failed: ${response.status()}`);
      }
    } catch (error) {
      console.warn("Failed to reset store:", error);
    }

    // Clear browser storage to prevent auth token reuse.
    // We must establish the H5 origin first, otherwise localStorage/sessionStorage
    // access will throw before the first navigation and stale reconnect tokens leak
    // into the next test.
    try {
      await page.goto(CLIENT_BASE_URL, { waitUntil: "domcontentloaded" });
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
