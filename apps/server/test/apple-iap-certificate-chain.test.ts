import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createPrivateKey, createSign, generateKeyPairSync, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  type AppleIapRuntimeConfig,
  AppleIapVerificationError,
  verifyAppleNotificationPayloadWithCertificateChain,
  verifySignedTransactionWithCertificateChain
} from "@server/adapters/apple-iap";

const execFileAsync = promisify(execFile);

function derToJoseEcdsaSignature(signature: Buffer, size: number): Buffer {
  const firstByte = signature[0];
  const secondByte = signature[1];
  if (signature.length < 8 || firstByte == null || secondByte == null || firstByte !== 0x30) {
    throw new Error("invalid_ecdsa_der_signature");
  }

  let offset = 2;
  if ((secondByte & 0x80) !== 0) {
    offset = 2 + (secondByte & 0x7f);
  }

  const integerMarker = signature[offset];
  const rLength = signature[offset + 1];
  if (integerMarker == null || rLength == null || integerMarker !== 0x02) {
    throw new Error("invalid_ecdsa_der_signature");
  }
  const r = signature.subarray(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  const secondIntegerMarker = signature[offset];
  const sLength = signature[offset + 1];
  if (secondIntegerMarker == null || sLength == null || secondIntegerMarker !== 0x02) {
    throw new Error("invalid_ecdsa_der_signature");
  }
  const s = signature.subarray(offset + 2, offset + 2 + sLength);

  const output = Buffer.alloc(size * 2);
  r.copy(output, size - Math.min(size, r.length), Math.max(0, r.length - size));
  s.copy(output, size * 2 - Math.min(size, s.length), Math.max(0, s.length - size));
  return output;
}

function createAppleRuntimeConfig(rootCertificates: string[]): AppleIapRuntimeConfig {
  const signingKeys = generateKeyPairSync("ec", {
    namedCurve: "prime256v1"
  });

  return {
    bundleId: "com.projectveil.app",
    issuerId: "11111111-2222-3333-4444-555555555555",
    keyId: "ABC123DEFG",
    privateKey: signingKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    productionApiUrl: "https://apple.example.test",
    sandboxApiUrl: "https://apple-sandbox.example.test",
    rootCertificates
  };
}

async function runOpenSsl(args: string[], cwd: string): Promise<void> {
  await execFileAsync("openssl", args, { cwd });
}

async function createTrustedCertificateChain(): Promise<{
  rootPem: string;
  leafPem: string;
  leafPrivateKeyPem: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-apple-cert-chain-"));
  await runOpenSsl(
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      "root-key.pem",
      "-out",
      "root-cert.pem",
      "-subj",
      "/CN=Trusted Apple Root Test",
      "-days",
      "3650"
    ],
    tempDir
  );
  await runOpenSsl(
    [
      "req",
      "-new",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      "leaf-key.pem",
      "-out",
      "leaf.csr",
      "-subj",
      "/CN=Apple StoreKit Signing Test"
    ],
    tempDir
  );
  await writeFile(
    join(tempDir, "leaf.ext"),
    ["basicConstraints=critical,CA:FALSE", "keyUsage=critical,digitalSignature"].join("\n"),
    "utf8"
  );
  await runOpenSsl(
    [
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      "root-cert.pem",
      "-CAkey",
      "root-key.pem",
      "-CAcreateserial",
      "-out",
      "leaf-cert.pem",
      "-days",
      "365",
      "-sha256",
      "-extfile",
      "leaf.ext"
    ],
    tempDir
  );

  const [rootPem, leafPem, leafPrivateKeyPem] = await Promise.all([
    readFile(join(tempDir, "root-cert.pem"), "utf8"),
    readFile(join(tempDir, "leaf-cert.pem"), "utf8"),
    readFile(join(tempDir, "leaf-key.pem"), "utf8")
  ]);

  return { rootPem, leafPem, leafPrivateKeyPem };
}

async function createSelfSignedAttackerCertificate(): Promise<{
  certificatePem: string;
  privateKeyPem: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-apple-self-signed-"));
  await runOpenSsl(
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      "attacker-key.pem",
      "-out",
      "attacker-cert.pem",
      "-subj",
      "/CN=Attacker Signing Cert",
      "-days",
      "365"
    ],
    tempDir
  );

  const [certificatePem, privateKeyPem] = await Promise.all([
    readFile(join(tempDir, "attacker-cert.pem"), "utf8"),
    readFile(join(tempDir, "attacker-key.pem"), "utf8")
  ]);

  return { certificatePem, privateKeyPem };
}

function createSignedTransactionJws(input: {
  certificateChain: string[];
  privateKeyPem: string;
  bundleId?: string;
}): string {
  const header = {
    alg: "ES256",
    x5c: input.certificateChain.map((certificatePem) => new X509Certificate(certificatePem).raw.toString("base64"))
  };
  const payload = {
    transactionId: "1000001234567890",
    productId: "com.projectveil.gems.ios",
    environment: "Production",
    bundleId: input.bundleId ?? "com.projectveil.app",
    purchaseDate: new Date().toISOString()
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signer = createSign("SHA256");
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const derSignature = signer.sign(createPrivateKey(input.privateKeyPem));
  const joseSignature = derToJoseEcdsaSignature(derSignature, 32).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${joseSignature}`;
}

function createSignedNotificationJws(input: {
  certificateChain: string[];
  privateKeyPem: string;
  bundleId?: string;
}): string {
  const signedTransactionInfo = createSignedTransactionJws({
    certificateChain: input.certificateChain,
    privateKeyPem: input.privateKeyPem,
    bundleId: input.bundleId
  });
  const header = {
    alg: "ES256",
    x5c: input.certificateChain.map((certificatePem) => new X509Certificate(certificatePem).raw.toString("base64"))
  };
  const payload = {
    notificationUUID: "apple-notification-1",
    notificationType: "REFUND",
    subtype: "VOLUNTARY",
    version: "2.0",
    signedDate: Date.now(),
    data: {
      bundleId: input.bundleId ?? "com.projectveil.app",
      signedTransactionInfo
    }
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signer = createSign("SHA256");
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const derSignature = signer.sign(createPrivateKey(input.privateKeyPem));
  const joseSignature = derToJoseEcdsaSignature(derSignature, 32).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${joseSignature}`;
}

test("verifySignedTransactionWithCertificateChain accepts a JWS signed by a trusted root chain", async () => {
  const trustedChain = await createTrustedCertificateChain();
  const runtimeConfig = createAppleRuntimeConfig([trustedChain.rootPem]);
  const signedTransactionInfo = createSignedTransactionJws({
    certificateChain: [trustedChain.leafPem, trustedChain.rootPem],
    privateKeyPem: trustedChain.leafPrivateKeyPem
  });

  const verified = verifySignedTransactionWithCertificateChain(signedTransactionInfo, runtimeConfig, new Date());
  assert.equal(verified.transactionId, "1000001234567890");
  assert.equal(verified.bundleId, "com.projectveil.app");
});

test("verifySignedTransactionWithCertificateChain rejects self-signed attacker certificates outside the trusted root set", async () => {
  const trustedChain = await createTrustedCertificateChain();
  const attackerChain = await createSelfSignedAttackerCertificate();
  const runtimeConfig = createAppleRuntimeConfig([trustedChain.rootPem]);
  const signedTransactionInfo = createSignedTransactionJws({
    certificateChain: [attackerChain.certificatePem],
    privateKeyPem: attackerChain.privateKeyPem
  });

  assert.throws(
    () => verifySignedTransactionWithCertificateChain(signedTransactionInfo, runtimeConfig, new Date()),
    (error: unknown) =>
      error instanceof AppleIapVerificationError &&
      error.name === "apple_certificate_chain_invalid" &&
      error.statusCode === 400
  );
});

test("verifyAppleNotificationPayloadWithCertificateChain accepts a trusted notification payload and decodes nested transactions", async () => {
  const trustedChain = await createTrustedCertificateChain();
  const runtimeConfig = createAppleRuntimeConfig([trustedChain.rootPem]);
  const signedPayload = createSignedNotificationJws({
    certificateChain: [trustedChain.leafPem, trustedChain.rootPem],
    privateKeyPem: trustedChain.leafPrivateKeyPem
  });

  const verified = verifyAppleNotificationPayloadWithCertificateChain(signedPayload, runtimeConfig, new Date());

  assert.equal(verified.notificationId, "apple-notification-1");
  assert.equal(verified.notificationType, "REFUND");
  assert.equal(verified.subtype, "VOLUNTARY");
  assert.equal(verified.transaction?.transactionId, "1000001234567890");
});
