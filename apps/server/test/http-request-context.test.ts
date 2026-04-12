import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import {
  getRequestCorrelationId,
  installHttpRequestObservability,
  REQUEST_CORRELATION_ID_HEADER
} from "../src/http-request-context";
import { registerRuntimeObservabilityRoutes, resetRuntimeObservability } from "../src/observability";

interface TestLoggerEntry {
  message: string;
  error: unknown;
}

interface TestLogger {
  errors: TestLoggerEntry[];
  error(message: string, error: unknown): void;
}

function createLogger(): TestLogger {
  return {
    errors: [],
    error(message, error) {
      this.errors.push({ message, error });
    }
  };
}

function sendJson(response: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function startRequestObservabilityServer(port: number) {
  resetRuntimeObservability();
  const logger = createLogger();
  const transport = new WebSocketTransport();
  const app = transport.getExpressApp() as {
    use(handler: (request: never, response: never, next: () => void) => void): void;
    get(path: string, handler: (request: never, response: never) => void | Promise<void>): void;
  };

  installHttpRequestObservability(app, logger);
  app.get("/api/test/correlation", (request, response) => {
    sendJson(response, 200, {
      correlationId: getRequestCorrelationId(request)
    });
  });
  app.get("/api/test/failure", async () => {
    throw new Error("intentional route failure");
  });
  registerRuntimeObservabilityRoutes(app);

  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");

  return { logger, server };
}

test("http request observability attaches generated and caller-supplied correlation ids", async (t) => {
  const port = 45100 + Math.floor(Math.random() * 1000);
  const { server } = await startRequestObservabilityServer(port);

  t.after(async () => {
    resetRuntimeObservability();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const generatedResponse = await fetch(`http://127.0.0.1:${port}/api/test/correlation`);
  const generatedPayload = (await generatedResponse.json()) as { correlationId: string };
  const generatedHeader = generatedResponse.headers.get(REQUEST_CORRELATION_ID_HEADER);
  assert.ok(generatedHeader);
  assert.match(generatedHeader, /^req-[0-9a-f-]+$/);
  assert.equal(generatedPayload.correlationId, generatedHeader);

  const callerCorrelationId = "client-supplied-123";
  const forwardedResponse = await fetch(`http://127.0.0.1:${port}/api/test/correlation`, {
    headers: {
      [REQUEST_CORRELATION_ID_HEADER]: callerCorrelationId
    }
  });
  const forwardedPayload = (await forwardedResponse.json()) as { correlationId: string };
  assert.equal(forwardedResponse.headers.get(REQUEST_CORRELATION_ID_HEADER), callerCorrelationId);
  assert.equal(forwardedPayload.correlationId, callerCorrelationId);
});

test("http request observability logs structured route failures and records them in diagnostics", async (t) => {
  const port = 46100 + Math.floor(Math.random() * 1000);
  const { logger, server } = await startRequestObservabilityServer(port);

  t.after(async () => {
    resetRuntimeObservability();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const failedResponse = await fetch(`http://127.0.0.1:${port}/api/test/failure`);
  const failedPayload = (await failedResponse.json()) as { error: string; correlationId: string };
  assert.equal(failedResponse.status, 500);
  assert.equal(failedPayload.error, "internal_server_error");
  assert.equal(failedResponse.headers.get(REQUEST_CORRELATION_ID_HEADER), failedPayload.correlationId);

  assert.equal(logger.errors.length, 1);
  assert.match(logger.errors[0]?.message ?? "", /HTTP route handler failed/);
  const loggedError = logger.errors[0]?.error as {
    method: string;
    path: string;
    routePattern: string;
    correlationId: string;
    errorName: string;
    errorMessage: string;
    stack: string | null;
  };
  assert.equal(loggedError.method, "GET");
  assert.equal(loggedError.path, "/api/test/failure");
  assert.equal(loggedError.routePattern, "/api/test/failure");
  assert.equal(loggedError.correlationId, failedPayload.correlationId);
  assert.equal(loggedError.errorName, "Error");
  assert.equal(loggedError.errorMessage, "intentional route failure");
  assert.match(loggedError.stack ?? "", /intentional route failure/);

  const diagnosticsResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/diagnostic-snapshot`);
  const diagnosticsPayload = (await diagnosticsResponse.json()) as {
    diagnostics: {
      errorEvents: Array<{
        errorCode: string;
        context: {
          requestId: string | null;
          route: string | null;
          action: string | null;
          statusCode: number | null;
        };
      }>;
    };
  };
  const routeFailureEvent = diagnosticsPayload.diagnostics.errorEvents.find(
    (event) => event.errorCode === "http_route_failed"
  );

  assert.ok(routeFailureEvent);
  assert.equal(routeFailureEvent?.context.requestId, failedPayload.correlationId);
  assert.equal(routeFailureEvent?.context.route, "/api/test/failure");
  assert.equal(routeFailureEvent?.context.action, "GET");
  assert.equal(routeFailureEvent?.context.statusCode, 500);
});
