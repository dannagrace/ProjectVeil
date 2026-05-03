import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRuntimeSecrets,
  readRuntimeSecret,
  resetRuntimeSecretsForTest,
  setRuntimeSecretsForTest
} from "@server/infra/runtime-secrets";

test("readRuntimeSecret prefers the in-memory secret cache over env", () => {
  setRuntimeSecretsForTest({
    VEIL_AUTH_SECRET: "managed-auth-secret"
  });

  assert.equal(
    readRuntimeSecret("VEIL_AUTH_SECRET", {
      ...process.env,
      VEIL_AUTH_SECRET: "env-auth-secret"
    }),
    "managed-auth-secret"
  );

  resetRuntimeSecretsForTest();
});

test("loadRuntimeSecrets loads supported keys from AWS Secrets Manager payload", async () => {
  resetRuntimeSecretsForTest();

  await loadRuntimeSecrets(
    {
      ...process.env,
      VEIL_SECRET_PROVIDER: "aws-secrets-manager",
      VEIL_AWS_SECRETS_MANAGER_SECRET_ID: "projectveil/production/server",
      VEIL_AWS_SECRETS_MANAGER_REGION: "us-east-1",
      VEIL_MYSQL_HOST: "mysql",
      VEIL_MYSQL_USER: "project_veil",
      VEIL_WECHAT_MINIGAME_LOGIN_MODE: "production"
    },
    {
      createAwsSecretsManagerClient: () => ({
        async send() {
          return {
            SecretString: JSON.stringify({
              VEIL_AUTH_SECRET: "managed-auth-secret",
              ADMIN_SECRET: "managed-admin-secret",
              SUPPORT_MODERATOR_SECRET: "managed-moderator-secret",
              SUPPORT_SUPERVISOR_SECRET: "managed-supervisor-secret",
              VEIL_ADMIN_TOKEN: "managed-admin-token",
              VEIL_MYSQL_PASSWORD: "managed-mysql-password",
              WECHAT_APP_SECRET: "managed-wechat-secret",
              VEIL_WECHAT_GROUP_CHALLENGE_SECRET: "managed-group-secret"
            })
          };
        }
      })
    }
  );

  assert.equal(readRuntimeSecret("VEIL_AUTH_SECRET"), "managed-auth-secret");
  assert.equal(readRuntimeSecret("VEIL_MYSQL_PASSWORD"), "managed-mysql-password");
  assert.equal(readRuntimeSecret("WECHAT_APP_SECRET"), "managed-wechat-secret");

  resetRuntimeSecretsForTest();
});

test("loadRuntimeSecrets fails when the AWS secret bundle is missing required keys", async () => {
  resetRuntimeSecretsForTest();

  await assert.rejects(
    loadRuntimeSecrets(
      {
        ...process.env,
        VEIL_SECRET_PROVIDER: "aws-secrets-manager",
        VEIL_AWS_SECRETS_MANAGER_SECRET_ID: "projectveil/production/server",
        VEIL_AWS_SECRETS_MANAGER_REGION: "us-east-1"
      },
      {
        createAwsSecretsManagerClient: () => ({
          async send() {
            return {
              SecretString: JSON.stringify({
                VEIL_AUTH_SECRET: "managed-auth-secret"
              })
            };
          }
        })
      }
    ),
    /missing required keys/
  );

  resetRuntimeSecretsForTest();
});

test("loadRuntimeSecrets rejects production env startup when VEIL_AUTH_SECRET is missing", { concurrency: false }, async () => {
  resetRuntimeSecretsForTest();
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAuthSecret = process.env.VEIL_AUTH_SECRET;

  delete process.env.VEIL_AUTH_SECRET;
  process.env.NODE_ENV = "production";

  try {
    await assert.rejects(
      loadRuntimeSecrets({
        ...process.env,
        NODE_ENV: "production",
        VEIL_SECRET_PROVIDER: "env",
        VEIL_AUTH_SECRET: undefined
      }),
      /VEIL_AUTH_SECRET/
    );
  } finally {
    resetRuntimeSecretsForTest();
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAuthSecret === undefined) {
      delete process.env.VEIL_AUTH_SECRET;
    } else {
      process.env.VEIL_AUTH_SECRET = previousAuthSecret;
    }
  }
});

test("loadRuntimeSecrets rejects production env startup when VEIL_ADMIN_TOKEN is missing", { concurrency: false }, async () => {
  resetRuntimeSecretsForTest();

  await assert.rejects(
    loadRuntimeSecrets({
      ...process.env,
      NODE_ENV: "production",
      VEIL_SECRET_PROVIDER: "env",
      VEIL_AUTH_SECRET: "production-auth-secret",
      VEIL_ADMIN_TOKEN: undefined
    }),
    /VEIL_ADMIN_TOKEN/
  );

  resetRuntimeSecretsForTest();
});

test("loadRuntimeSecrets rejects development admin tokens in production", { concurrency: false }, async () => {
  resetRuntimeSecretsForTest();

  await assert.rejects(
    loadRuntimeSecrets({
      ...process.env,
      NODE_ENV: "production",
      VEIL_SECRET_PROVIDER: "env",
      VEIL_AUTH_SECRET: "production-auth-secret",
      VEIL_ADMIN_TOKEN: "dev-admin-token"
    }),
    /VEIL_ADMIN_TOKEN must be a non-development secret/
  );

  await assert.rejects(
    loadRuntimeSecrets({
      ...process.env,
      NODE_ENV: "production",
      VEIL_SECRET_PROVIDER: "env",
      VEIL_AUTH_SECRET: "production-auth-secret",
      VEIL_ADMIN_TOKEN: "veil-admin-2026"
    }),
    /VEIL_ADMIN_TOKEN must be a non-development secret/
  );

  resetRuntimeSecretsForTest();
});

test("loadRuntimeSecrets rejects production Redis URLs without credentials or REDIS_PASSWORD", { concurrency: false }, async () => {
  resetRuntimeSecretsForTest();

  await assert.rejects(
    loadRuntimeSecrets({
      ...process.env,
      NODE_ENV: "production",
      VEIL_SECRET_PROVIDER: "env",
      VEIL_AUTH_SECRET: "production-auth-secret",
      VEIL_ADMIN_TOKEN: "production-admin-token",
      REDIS_URL: "redis://project-veil-redis:6379/0",
      REDIS_PASSWORD: undefined
    }),
    /REDIS_PASSWORD/
  );

  await assert.doesNotReject(() =>
    loadRuntimeSecrets({
      ...process.env,
      NODE_ENV: "production",
      VEIL_SECRET_PROVIDER: "env",
      VEIL_AUTH_SECRET: "production-auth-secret",
      VEIL_ADMIN_TOKEN: "production-admin-token",
      REDIS_URL: "redis://project-veil-redis:6379/0",
      REDIS_PASSWORD: "production-redis-password"
    })
  );

  resetRuntimeSecretsForTest();
});
