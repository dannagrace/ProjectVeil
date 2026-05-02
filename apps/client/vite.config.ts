import { resolve } from "node:path";
import { defineConfig } from "vite";

function readPort(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const clientPort = readPort("VEIL_PLAYWRIGHT_CLIENT_PORT", 4173);
const serverHttpUrl = process.env.VEIL_DEV_SERVER_HTTP_URL?.trim() || "http://127.0.0.1:2567";

function normalizeModuleId(id: string): string {
  return id.replace(/\\/g, "/");
}

function manualChunks(id: string): string | undefined {
  const normalized = normalizeModuleId(id);
  if (normalized.includes("/packages/shared/")) {
    return "shared";
  }
  if (normalized.endsWith("/apps/client/src/account-history.ts")) {
    return "client-account-history";
  }
  if (normalized.endsWith("/apps/cocos-client/assets/scripts/cocos-share-card.ts")) {
    return "cocos-share-card";
  }
  return undefined;
}

export default defineConfig({
  root: resolve(__dirname),
  resolve: {
    alias: {
      "@server": resolve(__dirname, "../server/src")
    }
  },
  preview: {
    host: "127.0.0.1",
    port: clientPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: serverHttpUrl,
        changeOrigin: true
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: clientPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: serverHttpUrl,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        configCenter: resolve(__dirname, "config-center.html")
      },
      output: {
        manualChunks
      }
    }
  }
});
