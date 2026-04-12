import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const repoRoot = process.cwd();
const distDir = path.join(repoRoot, "dist");
const migrationsDir = path.join(repoRoot, "scripts", "migrations");

const packageJson = await import(path.join(repoRoot, "package.json"), {
  with: { type: "json" }
});

const externalPackages = [
  ...Object.keys(packageJson.default.dependencies ?? {}),
  ...Object.keys(packageJson.default.optionalDependencies ?? {})
];

const migrationEntries = (await readdir(migrationsDir))
  .filter((entry) => entry.endsWith(".ts"))
  .map((entry) => path.join(migrationsDir, entry));

await mkdir(distDir, { recursive: true });

await build({
  absWorkingDir: repoRoot,
  bundle: true,
  entryPoints: {
    "server/server": "apps/server/src/dev-server.ts",
    "scripts/migrate": "scripts/migrate.ts",
    "scripts/migrate-rollback": "scripts/migrate-rollback.ts"
  },
  external: externalPackages,
  format: "esm",
  logLevel: "info",
  outdir: distDir,
  outExtension: { ".js": ".mjs" },
  platform: "node",
  sourcemap: false,
  target: "node22",
  tsconfig: "tsconfig.base.json"
});

await build({
  absWorkingDir: repoRoot,
  bundle: true,
  entryPoints: migrationEntries,
  external: externalPackages,
  format: "esm",
  logLevel: "info",
  outbase: migrationsDir,
  outdir: path.join(distDir, "scripts", "migrations"),
  outExtension: { ".js": ".mjs" },
  platform: "node",
  sourcemap: false,
  target: "node22",
  tsconfig: "tsconfig.base.json"
});
