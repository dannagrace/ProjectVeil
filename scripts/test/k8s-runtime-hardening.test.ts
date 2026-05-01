import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(resolve(repoRoot, relativePath), "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dockerfileCopiesAdminHtmlPage(dockerfile: string, pagePath: string): boolean {
  const fileName = pagePath.split("/").at(-1);
  assert.ok(fileName, `Expected ${pagePath} to include a file name`);

  const escapedFileName = escapeRegExp(fileName);
  const explicitCopy = new RegExp(
    `^COPY\\s+--from=build\\s+/app/apps/client/${escapedFileName}\\s+(?:\\./apps/client/${escapedFileName}|\\./apps/client/)\\s*$`,
    "m"
  );
  const adminWildcardCopy = /^COPY\s+--from=build\s+\/app\/apps\/client\/admin\*\.html\s+\.\/apps\/client\/\s*$/m;

  return explicitCopy.test(dockerfile) || adminWildcardCopy.test(dockerfile);
}

function assertDeploymentHardening(manifest: string): void {
  assert.match(manifest, /terminationGracePeriodSeconds:\s*60/);
  assert.match(manifest, /runAsNonRoot:\s*true/);
  assert.match(manifest, /runAsUser:\s*10001/);
  assert.match(manifest, /fsGroup:\s*10001/);
  assert.match(manifest, /seccompProfile:\s*\n\s*type:\s*RuntimeDefault/);
  assert.match(manifest, /emptyDir:\s*\{\}/);
  assert.match(manifest, /mountPath:\s*\/tmp/);
  assert.match(manifest, /preStop:\s*\n\s*exec:\s*\n\s*command:\s*\["\/bin\/sh", "-c", "sleep 20"\]/);
  assert.match(manifest, /allowPrivilegeEscalation:\s*false/);
  assert.match(manifest, /readOnlyRootFilesystem:\s*true/);
  assert.match(manifest, /drop:\s*\["ALL"\]/);
}

function assertProbeAndResources(manifest: string): void {
  assert.match(manifest, /resources:\s*\n\s*requests:\s*\n\s*cpu:\s*500m\s*\n\s*memory:\s*512Mi/);
  assert.match(manifest, /limits:\s*\n\s*cpu:\s*"1"\s*\n\s*memory:\s*1Gi/);
  assert.match(manifest, /readinessProbe:\s*\n\s*httpGet:\s*\n\s*path:\s*\/api\/runtime\/readyz\s*\n\s*port:\s*http/);
  assert.match(manifest, /livenessProbe:\s*\n\s*httpGet:\s*\n\s*path:\s*\/api\/runtime\/livez\s*\n\s*port:\s*http/);
  assert.doesNotMatch(manifest, /path:\s*\/api\/runtime\/health/);
}

function assertRedisSecrets(manifest: string): void {
  assert.match(
    manifest,
    /-\s*name:\s*REDIS_URL\s*\n\s*valueFrom:\s*\n\s*secretKeyRef:\s*\n\s*name:\s*project-veil-server-secrets\s*\n\s*key:\s*REDIS_URL/
  );
  assert.match(
    manifest,
    /-\s*name:\s*REDIS_PASSWORD\s*\n\s*valueFrom:\s*\n\s*secretKeyRef:\s*\n\s*name:\s*project-veil-server-secrets\s*\n\s*key:\s*REDIS_PASSWORD/
  );
}

test("runtime Dockerfile runs as a non-root veil user", async () => {
  const dockerfile = await readRepoFile("Dockerfile.server");

  assert.match(dockerfile, /groupadd -r --gid 10001 veil/);
  assert.match(dockerfile, /useradd -r --uid 10001 --gid veil veil/);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends awscli/);
  assert.match(dockerfile, /ENV HOME=\/tmp/);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/runtime\/livez/);
  assert.doesNotMatch(dockerfile, /HEALTHCHECK[\s\S]*\/api\/runtime\/health/);
  assert.match(dockerfile, /USER 10001:10001/);
});

test("runtime Dockerfile packages all admin HTML pages", async () => {
  const dockerfile = await readRepoFile("Dockerfile.server");
  const adminHtmlPages = [
    "apps/client/admin.html",
    "apps/client/admin-calendar.html",
    "apps/client/admin-kill-switches.html",
    "apps/client/config-center.html"
  ];

  for (const pagePath of adminHtmlPages) {
    assert.ok(
      dockerfileCopiesAdminHtmlPage(dockerfile, pagePath),
      `Dockerfile.server must copy ${pagePath} into the runtime image`
    );
  }
});

test("deployments apply runtime hardening controls", async () => {
  const [primary, canary, stable] = await Promise.all([
    readRepoFile("k8s/deployment.yaml"),
    readRepoFile("k8s/canary/deployment-canary.yaml"),
    readRepoFile("k8s/canary/deployment-stable.yaml")
  ]);

  assertDeploymentHardening(primary);
  assertDeploymentHardening(canary);
  assertDeploymentHardening(stable);
  assertProbeAndResources(primary);
  assertProbeAndResources(canary);
  assertProbeAndResources(stable);
  assertRedisSecrets(primary);
  assertRedisSecrets(canary);
  assertRedisSecrets(stable);
});

test("namespace and kustomizations include restricted pod security, PDB, and NetworkPolicy", async () => {
  const [namespaceYaml, rootKustomization, canaryKustomization] = await Promise.all([
    readRepoFile("k8s/namespace.yaml"),
    readRepoFile("k8s/kustomization.yaml"),
    readRepoFile("k8s/canary/kustomization.yaml")
  ]);

  assert.match(namespaceYaml, /pod-security\.kubernetes\.io\/enforce:\s*restricted/);
  assert.match(namespaceYaml, /pod-security\.kubernetes\.io\/audit:\s*restricted/);
  assert.match(rootKustomization, /- pdb\.yaml/);
  assert.match(rootKustomization, /- network-policy\.yaml/);
  assert.match(canaryKustomization, /- pdb\.yaml/);
  assert.match(canaryKustomization, /- network-policy\.yaml/);
});

test("network policy restricts ingress to ingress-nginx and narrows egress", async () => {
  const [rootPolicy, canaryPolicy] = await Promise.all([
    readRepoFile("k8s/network-policy.yaml"),
    readRepoFile("k8s/canary/network-policy.yaml")
  ]);

  for (const policy of [rootPolicy, canaryPolicy]) {
    assert.match(policy, /kind:\s*NetworkPolicy/);
    assert.match(policy, /kubernetes\.io\/metadata\.name:\s*ingress-nginx/);
    assert.match(policy, /port:\s*2567/);
    assert.match(policy, /kubernetes\.io\/metadata\.name:\s*kube-system/);
    assert.match(policy, /port:\s*6379/);
    assert.match(policy, /app\.kubernetes\.io\/name:\s*project-veil-redis/);
    assert.match(policy, /cidr:\s*10\.0\.0\.0\/16\s*\n\s*ports:\s*\n\s*-\s*protocol:\s*TCP\s*\n\s*port:\s*3306/);
    assert.match(policy, /port:\s*3306/);
    assert.doesNotMatch(policy, /cidr:\s*0\.0\.0\.0\/0\s*\n\s*ports:\s*\n\s*-\s*protocol:\s*TCP\s*\n\s*port:\s*3306/);
    assert.doesNotMatch(policy, /cidr:\s*0\.0\.0\.0\/0\s*\n\s*ports:\s*\n\s*-\s*protocol:\s*TCP\s*\n\s*port:\s*443/);
    assert.match(policy, /app\.kubernetes\.io\/name:\s*project-veil-egress-proxy/);
    assert.match(policy, /port:\s*443/);
    assert.match(policy, /port:\s*465/);
    assert.match(policy, /port:\s*587/);
  }
});

test("k8s configmap does not publish Redis credentials", async () => {
  const configmap = await readRepoFile("k8s/configmap.yaml");

  assert.doesNotMatch(configmap, /REDIS_URL/);
  assert.doesNotMatch(configmap, /REDIS_PASSWORD/);
});

test("ingresses inject baseline browser security response headers", async () => {
  const [primaryIngress, canaryIngress] = await Promise.all([
    readRepoFile("k8s/ingress.yaml"),
    readRepoFile("k8s/canary/ingress-canary.yaml")
  ]);

  for (const ingress of [primaryIngress, canaryIngress]) {
    assert.match(ingress, /nginx\.ingress\.kubernetes\.io\/configuration-snippet:\s*\|/);
    assert.match(ingress, /Strict-Transport-Security: max-age=31536000; includeSubDomains; preload/);
    assert.match(ingress, /Content-Security-Policy: default-src 'self'/);
    assert.match(ingress, /connect-src 'self' https:\/\/\*\.sentry\.io wss:\/\/game\.projectveil\.prod/);
    assert.match(ingress, /frame-ancestors 'none'/);
    assert.match(ingress, /X-Frame-Options: DENY/);
    assert.match(ingress, /X-Content-Type-Options: nosniff/);
    assert.match(ingress, /Referrer-Policy: strict-origin-when-cross-origin/);
    assert.match(ingress, /Permissions-Policy: camera=\(\), geolocation=\(\), microphone=\(\)/);
  }
});

test("production runbook and secrets inventory document compose MYSQL_ROOT_PASSWORD requirements", async () => {
  const [runbook, secretsInventory] = await Promise.all([
    readRepoFile("docs/ops/production-deploy-runbook.md"),
    readRepoFile("docs/ops/secrets-inventory.md")
  ]);

  assert.match(runbook, /MYSQL_ROOT_PASSWORD/);
  assert.match(runbook, /fails fast when that variable is missing/);
  assert.match(secretsInventory, /Compose-only local secret:/);
  assert.match(secretsInventory, /MYSQL_ROOT_PASSWORD/);
});
