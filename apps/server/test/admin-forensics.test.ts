import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import type { AdminAuditLogCreateInput } from "@server/persistence";
import { registerAdminForensicsMiddleware } from "@server/domain/ops/admin-forensics";

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

function createTestApp() {
  const middlewares: Middleware[] = [];
  return {
    app: {
      use(handler: Middleware) {
        middlewares.push(handler);
      }
    },
    async run(
      request: IncomingMessage,
      response: ServerResponse,
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    ) {
      let index = 0;
      const next = () => {
        const middleware = middlewares[index++];
        if (middleware) {
          middleware(request, response, next);
          return;
        }
        void handler(request, response);
      };
      next();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

function createRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
} = {}): IncomingMessage {
  return {
    method: options.method ?? "GET",
    url: options.url ?? "/api/admin/example",
    headers: options.headers ?? {},
    socket: { remoteAddress: "203.0.113.9" }
  } as IncomingMessage;
}

function createResponse(): ServerResponse & { body: string } {
  let body = "";
  return {
    statusCode: 200,
    setHeader() {
      return this;
    },
    end(chunk?: string | Buffer) {
      body = chunk === undefined ? "" : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      return this;
    },
    get body() {
      return body;
    }
  } as ServerResponse & { body: string };
}

function withAdminToken(t: import("node:test").TestContext, token = "admin-forensics-token"): string {
  const original = process.env.VEIL_ADMIN_TOKEN;
  process.env.VEIL_ADMIN_TOKEN = token;
  t.after(() => {
    if (original === undefined) {
      delete process.env.VEIL_ADMIN_TOKEN;
      return;
    }
    process.env.VEIL_ADMIN_TOKEN = original;
  });
  return token;
}

test("admin forensics records successful admin read access", async (t) => {
  const token = withAdminToken(t);
  const auditLogs: AdminAuditLogCreateInput[] = [];
  const { app, run } = createTestApp();
  registerAdminForensicsMiddleware(app, {
    async appendAdminAuditLog(input) {
      auditLogs.push(input);
      return { auditId: "audit-1", occurredAt: new Date().toISOString(), ...input };
    }
  });

  const response = createResponse();
  await run(
    createRequest({
      url: "/api/admin/payments/wechat/orders?limit=20&adminToken=redacted",
      headers: { "x-veil-admin-token": token, "x-forwarded-for": "198.51.100.10, 10.0.0.1" }
    }),
    response,
    (_request, res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    }
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0]?.action, "admin_read_access");
  assert.equal(auditLogs[0]?.actorRole, "admin");
  assert.equal(auditLogs[0]?.targetScope, "/api/admin/payments/wechat/orders");
  assert.match(auditLogs[0]?.metadataJson ?? "", /"queryKeys":\["adminToken","limit"\]/);
  assert.doesNotMatch(auditLogs[0]?.metadataJson ?? "", /redacted/);
});

test("admin forensics records rejected admin requests without storing raw credentials", async () => {
  const auditLogs: AdminAuditLogCreateInput[] = [];
  const { app, run } = createTestApp();
  registerAdminForensicsMiddleware(app, {
    async appendAdminAuditLog(input) {
      auditLogs.push(input);
      return { auditId: "audit-1", occurredAt: new Date().toISOString(), ...input };
    }
  });

  const response = createResponse();
  await run(
    createRequest({
      url: "/api/admin/audit-log",
      headers: { "x-veil-admin-token": "invalid-secret-value" }
    }),
    response,
    (_request, res) => {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "forbidden" }));
    }
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0]?.action, "admin_auth_failed");
  assert.equal(auditLogs[0]?.targetScope, "admin-auth");
  assert.match(auditLogs[0]?.metadataJson ?? "", /"prefix":"invali"/);
  assert.doesNotMatch(auditLogs[0]?.metadataJson ?? "", /invalid-secret-value/);
});
