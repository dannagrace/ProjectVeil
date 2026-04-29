import assert from "node:assert/strict";
import test from "node:test";

function installFakeBrowser(search: string): { app: { innerHTML: string } } {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };
  const app = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const fakeElement = () => ({
    style: {},
    append: () => undefined,
    click: () => undefined,
    remove: () => undefined,
    setAttribute: () => undefined,
    addEventListener: () => undefined,
    querySelectorAll: () => [],
    querySelector: () => null,
    innerHTML: "",
    textContent: "",
    id: ""
  });

  Object.assign(globalThis, {
    window: {
      location: {
        search,
        protocol: "http:",
        hostname: "127.0.0.1",
        href: `http://127.0.0.1:4173/${search}`
      },
      localStorage: storage,
      setTimeout,
      clearTimeout
    },
    document: {
      createElement: fakeElement,
      body: {
        appendChild: () => undefined
      },
      querySelector: (selector: string) => (selector === "#app" ? app : null),
      addEventListener: () => undefined
    }
  });

  return { app };
}

test("H5 session metadata escapes query-derived room and player identifiers", async () => {
  globalThis.__PROJECT_VEIL_MAIN_SKIP_AUTO_BOOT__ = true;
  const { app } = installFakeBrowser(
    "?roomId=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&playerId=%3Csvg%20onload%3Dalert(2)%3E"
  );
  const { startMainH5Boot } = await import("../src/main");

  startMainH5Boot({
    launchMainH5AppImpl: (({ render }) => {
      render();
    }) as never
  });

  assert.match(
    app.innerHTML,
    /Room: &lt;img src=x onerror=alert\(1\)&gt; · Player: &lt;svg onload=alert\(2\)&gt;/
  );
  assert.doesNotMatch(app.innerHTML, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(app.innerHTML, /<svg onload=alert\(2\)>/);
});
