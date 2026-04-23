import assert from "node:assert/strict";
import test from "node:test";

import { resolveTrustedRequestIp } from "@server/infra/request-ip";

test("resolveTrustedRequestIp ignores forwarded headers from untrusted sockets", () => {
  assert.equal(
    resolveTrustedRequestIp(
      {
        headers: {
          "x-forwarded-for": "198.51.100.20",
          "x-real-ip": "198.51.100.21"
        },
        socket: {
          remoteAddress: "127.0.0.1"
        }
      },
      {}
    ),
    "127.0.0.1"
  );
});

test("resolveTrustedRequestIp honors x-real-ip when the socket is a trusted proxy", () => {
  assert.equal(
    resolveTrustedRequestIp(
      {
        headers: {
          "x-forwarded-for": "198.51.100.20",
          "x-real-ip": "198.51.100.21"
        },
        socket: {
          remoteAddress: "10.0.0.9"
        }
      },
      {
        VEIL_TRUSTED_PROXIES: "10.0.0.0/8"
      }
    ),
    "198.51.100.21"
  );
});
