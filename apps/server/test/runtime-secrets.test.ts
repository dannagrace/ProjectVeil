import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRuntimeSecrets,
  readRuntimeSecret,
  resetRuntimeSecretsForTest,
  setRuntimeSecretsForTest
} from "../src/runtime-secrets";

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
