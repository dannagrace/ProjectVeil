import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findPlaceholderMatches } from "../validate-k8s-configmap-placeholders.ts";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts", "validate-k8s-configmap-placeholders.ts");

function buildConfigMap(values: Record<string, string>): string {
  const entries = Object.entries(values)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join("\n");

  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: project-veil-server-config
data:
${entries}
`;
}

test("findPlaceholderMatches flags only the targeted placeholder patterns", () => {
  const matches = findPlaceholderMatches(
    buildConfigMap({
      SAFE_S3_ENDPOINT: "https://s3.example.com",
      SAFE_SENTRY_DSN: "https://public@o123456.ingest.sentry.io/42",
      SAFE_ANALYTICS_ENDPOINT: "https://analytics.projectveil.internal/ingest",
      BAD_ANALYTICS_ENDPOINT: "https://analytics.projectveil.example/ingest",
      BAD_SENTRY_DSN: "https://public@example.ingest.sentry.io/42",
      BAD_SECRET: "REPLACE_ME",
      BAD_NOTE: "TODO"
    })
  );

  assert.deepEqual(
    matches.map((match) => `${match.key}:${match.pattern}`),
    [
      "BAD_ANALYTICS_ENDPOINT:bare .example hostname",
      "BAD_SENTRY_DSN:placeholder Sentry ingest host",
      "BAD_SECRET:REPLACE_ME token",
      "BAD_NOTE:TODO token"
    ]
  );
});

test("validate:k8s-configmap CLI succeeds for production-shaped values", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-k8s-configmap-pass-"));
  const configPath = join(tempDir, "configmap.yaml");
  await writeFile(
    configPath,
    buildConfigMap({
      VEIL_BACKUP_S3_ENDPOINT: "https://s3.example.com",
      ANALYTICS_ENDPOINT: "https://analytics.projectveil.internal/ingest",
      SENTRY_DSN: "https://public@o123456.ingest.sentry.io/42"
    }),
    "utf8"
  );

  const { stdout } = await execFileAsync("node", ["--import", "tsx", scriptPath, "--config", configPath], {
    cwd: repoRoot
  });

  assert.match(stdout, /Kubernetes ConfigMap placeholder gate: PASS/);
});

test("validate:k8s-configmap CLI reports the offending keys", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-k8s-configmap-fail-"));
  const configPath = join(tempDir, "configmap.yaml");
  await writeFile(
    configPath,
    buildConfigMap({
      ANALYTICS_ENDPOINT: "https://analytics.projectveil.example/ingest",
      SENTRY_DSN: "https://public@example.ingest.sentry.io/42"
    }),
    "utf8"
  );

  await assert.rejects(
    execFileAsync("node", ["--import", "tsx", scriptPath, "--config", configPath], {
      cwd: repoRoot
    }),
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr ?? "", /ANALYTICS_ENDPOINT: matched bare \.example hostname/);
      assert.match(error.stderr ?? "", /SENTRY_DSN: matched placeholder Sentry ingest host/);
      return true;
    }
  );
});
