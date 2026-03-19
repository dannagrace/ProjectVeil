import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname),
  server: {
    host: "0.0.0.0",
    port: 4173
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true
  }
});
