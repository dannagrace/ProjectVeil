import { Socket } from "node:net";
import { connect as connectTls, TLSSocket } from "node:tls";
import {
  recordAuthTokenDeliveryAttempt,
  recordAuthTokenDeliveryDeadLetter,
  recordAuthTokenDeliveryFailure,
  recordAuthTokenDeliveryRequest,
  recordAuthTokenDeliveryRetry,
  recordAuthTokenDeliverySuccess,
  setAuthTokenDeliveryDeadLetterCount,
  setAuthTokenDeliveryQueueCount
} from "./observability";

export type AccountTokenDeliveryKind = "account-registration" | "password-recovery";
export type AccountTokenDeliveryMode = "disabled" | "dev-token" | "smtp" | "webhook";
export type AccountTokenDeliveryStatus = "disabled" | "delivered" | "dev-token" | "retry_scheduled";
export type AccountTokenDeliveryFailureReason =
  | "misconfigured"
  | "network"
  | "smtp_4xx"
  | "smtp_5xx"
  | "smtp_protocol"
  | "timeout"
  | "webhook_4xx"
  | "webhook_429"
  | "webhook_5xx";

export interface AccountTokenDeliveryPayload {
  kind: AccountTokenDeliveryKind;
  loginId: string;
  token: string;
  expiresAt: string;
  requestedDisplayName?: string;
  playerId?: string;
}

interface BaseDeliveryConfig {
  kind: Extract<AccountTokenDeliveryMode, "smtp" | "webhook">;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

interface WebhookDeliveryConfig extends BaseDeliveryConfig {
  kind: "webhook";
  url: string;
  bearerToken?: string;
}

interface SmtpDeliveryConfig extends BaseDeliveryConfig {
  kind: "smtp";
  host: string;
  port: number;
  secure: boolean;
  ignoreTlsErrors: boolean;
  from: string;
  recipientDomain: string;
  ehloName: string;
  username?: string;
  password?: string;
}

type TransportDeliveryConfig = WebhookDeliveryConfig | SmtpDeliveryConfig;

interface QueuedDeliveryEntry {
  key: string;
  payload: AccountTokenDeliveryPayload;
  config: TransportDeliveryConfig;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lastError?: {
    message: string;
    failureReason: AccountTokenDeliveryFailureReason;
    statusCode?: number;
  };
}

export interface AccountTokenDeliveryResult {
  deliveryMode: AccountTokenDeliveryMode;
  deliveryStatus: AccountTokenDeliveryStatus;
  responseToken?: string;
  attemptCount?: number;
  maxAttempts?: number;
  nextAttemptAt?: string;
}

export class AccountTokenDeliveryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountTokenDeliveryConfigurationError";
  }
}

export class AccountTokenDeliveryError extends Error {
  readonly retryable: boolean;
  readonly failureReason: AccountTokenDeliveryFailureReason;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      failureReason: AccountTokenDeliveryFailureReason;
      statusCode?: number;
    }
  ) {
    super(message);
    this.name = "AccountTokenDeliveryError";
    this.retryable = options.retryable;
    this.failureReason = options.failureReason;
    if (options.statusCode != null) {
      this.statusCode = options.statusCode;
    }
  }
}

const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000;
const DEFAULT_DELIVERY_MAX_ATTEMPTS = 4;
const DEFAULT_DELIVERY_RETRY_BASE_DELAY_MS = 5_000;
const DEFAULT_DELIVERY_RETRY_MAX_DELAY_MS = 60_000;
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTPS_PORT = 465;

const queuedDeliveries = new Map<string, QueuedDeliveryEntry>();
const deadLetterDeliveries = new Map<string, QueuedDeliveryEntry>();
let queueTimer: NodeJS.Timeout | null = null;
let queueProcessing = false;

function parseEnvNumber(
  value: string | undefined,
  fallback: number,
  options: { minimum?: number; integer?: boolean } = {}
): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = options.integer ? Math.floor(parsed) : parsed;
  if (options.minimum != null && normalized < options.minimum) {
    return fallback;
  }

  return normalized;
}

function parseEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function readDeliveryMode(rawMode: string | undefined): AccountTokenDeliveryMode {
  const normalized = rawMode?.trim().toLowerCase();
  if (normalized === "disabled") {
    return "disabled";
  }
  if (normalized === "smtp") {
    return "smtp";
  }
  if (normalized === "webhook") {
    return "webhook";
  }
  return "dev-token";
}

function readSharedTransportConfig(env: NodeJS.ProcessEnv): Pick<
  BaseDeliveryConfig,
  "timeoutMs" | "maxAttempts" | "retryBaseDelayMs" | "retryMaxDelayMs"
> {
  return {
    timeoutMs: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_TIMEOUT_MS ?? env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_TIMEOUT_MS,
      DEFAULT_DELIVERY_TIMEOUT_MS,
      { minimum: 1, integer: true }
    ),
    maxAttempts: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_MAX_ATTEMPTS ?? env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_MAX_ATTEMPTS,
      DEFAULT_DELIVERY_MAX_ATTEMPTS,
      { minimum: 1, integer: true }
    ),
    retryBaseDelayMs: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_RETRY_BASE_DELAY_MS ?? env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_BASE_DELAY_MS,
      DEFAULT_DELIVERY_RETRY_BASE_DELAY_MS,
      { minimum: 1, integer: true }
    ),
    retryMaxDelayMs: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_RETRY_MAX_DELAY_MS ?? env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_MAX_DELAY_MS,
      DEFAULT_DELIVERY_RETRY_MAX_DELAY_MS,
      { minimum: 1, integer: true }
    )
  };
}

function readWebhookDeliveryConfig(env: NodeJS.ProcessEnv): WebhookDeliveryConfig {
  const url = env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL?.trim();
  if (!url) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL must be set when webhook delivery mode is enabled"
    );
  }

  return {
    kind: "webhook",
    url,
    ...(env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN?.trim()
      ? { bearerToken: env.VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN.trim() }
      : {}),
    ...readSharedTransportConfig(env)
  };
}

function readSmtpDeliveryConfig(env: NodeJS.ProcessEnv): SmtpDeliveryConfig {
  const host = env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_HOST?.trim();
  if (!host) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_SMTP_HOST must be set when smtp delivery mode is enabled"
    );
  }

  const from = env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_FROM?.trim();
  if (!from) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_SMTP_FROM must be set when smtp delivery mode is enabled"
    );
  }

  const recipientDomain = env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN?.trim();
  if (!recipientDomain) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN must be set when smtp delivery mode is enabled"
    );
  }

  const secure = parseEnvBoolean(env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_SECURE, false);
  const username = env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_USERNAME?.trim();
  const password = env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_PASSWORD?.trim();
  if ((username && !password) || (!username && password)) {
    throw new AccountTokenDeliveryConfigurationError(
      "VEIL_AUTH_TOKEN_DELIVERY_SMTP_USERNAME and VEIL_AUTH_TOKEN_DELIVERY_SMTP_PASSWORD must be provided together"
    );
  }

  return {
    kind: "smtp",
    host,
    port: parseEnvNumber(
      env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_PORT,
      secure ? DEFAULT_SMTPS_PORT : DEFAULT_SMTP_PORT,
      { minimum: 1, integer: true }
    ),
    secure,
    ignoreTlsErrors: parseEnvBoolean(env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_IGNORE_TLS_ERRORS, false),
    from,
    recipientDomain: recipientDomain.replace(/^@+/, ""),
    ehloName: env.VEIL_AUTH_TOKEN_DELIVERY_SMTP_EHLO_NAME?.trim() || "projectveil.local",
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...readSharedTransportConfig(env)
  };
}

function buildDeliveryKey(payload: Pick<AccountTokenDeliveryPayload, "kind" | "loginId">): string {
  return `${payload.kind}:${payload.loginId.trim().toLowerCase()}`;
}

function isExpired(expiresAt: string): boolean {
  const timestamp = new Date(expiresAt).getTime();
  return Number.isNaN(timestamp) || timestamp <= Date.now();
}

function toIsoTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function syncQueueTelemetry(): void {
  setAuthTokenDeliveryQueueCount(queuedDeliveries.size);
  setAuthTokenDeliveryDeadLetterCount(deadLetterDeliveries.size);
}

function computeRetryDelayMs(attemptCount: number, config: TransportDeliveryConfig): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * 2 ** exponent);
}

function clearQueueTimer(): void {
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
}

function scheduleQueuePump(): void {
  clearQueueTimer();
  if (queuedDeliveries.size === 0) {
    return;
  }

  const nextAttemptAt = Math.min(...Array.from(queuedDeliveries.values()).map((entry) => entry.nextAttemptAt));
  const delayMs = Math.max(0, nextAttemptAt - Date.now());
  queueTimer = setTimeout(() => {
    queueTimer = null;
    void processQueuedDeliveries();
  }, delayMs);
}

function markDeadLetter(entry: QueuedDeliveryEntry, error: AccountTokenDeliveryError, attemptNumber: number): void {
  queuedDeliveries.delete(entry.key);
  deadLetterDeliveries.set(entry.key, {
    ...entry,
    attemptCount: attemptNumber,
    lastError: {
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
    }
  });
  recordAuthTokenDeliveryDeadLetter();
  recordAuthTokenDeliveryAttempt({
    kind: entry.payload.kind,
    loginId: entry.payload.loginId,
    deliveryMode: entry.config.kind,
    status: "dead-lettered",
    attemptCount: attemptNumber,
    maxAttempts: entry.maxAttempts,
    retryable: error.retryable,
    message: error.message,
    failureReason: error.failureReason,
    ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
  });
  syncQueueTelemetry();
}

async function deliverViaWebhook(payload: AccountTokenDeliveryPayload, config: WebhookDeliveryConfig): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {})
      },
      body: JSON.stringify({
        event: payload.kind,
        loginId: payload.loginId,
        token: payload.token,
        expiresAt: payload.expiresAt,
        ...(payload.requestedDisplayName ? { requestedDisplayName: payload.requestedDisplayName } : {}),
        ...(payload.playerId ? { playerId: payload.playerId } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const failureReason: AccountTokenDeliveryFailureReason =
        response.status === 429
          ? "webhook_429"
          : response.status >= 500
            ? "webhook_5xx"
            : "webhook_4xx";
      throw new AccountTokenDeliveryError(
        `Token delivery webhook returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`.trim(),
        {
          retryable: response.status === 429 || response.status >= 500,
          failureReason,
          statusCode: response.status
        }
      );
    }
  } catch (error) {
    if (error instanceof AccountTokenDeliveryError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new AccountTokenDeliveryError(`Token delivery webhook timed out after ${config.timeoutMs}ms`, {
        retryable: true,
        failureReason: "timeout"
      });
    }
    throw new AccountTokenDeliveryError(
      `Token delivery webhook request failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        retryable: true,
        failureReason: "network"
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function createSmtpFailure(code: number, message: string): AccountTokenDeliveryError {
  return new AccountTokenDeliveryError(message, {
    retryable: code >= 400 && code < 500,
    failureReason: code >= 400 && code < 500 ? "smtp_4xx" : "smtp_5xx",
    statusCode: code
  });
}

function createSmtpRecipientAddress(loginId: string, recipientDomain: string): string {
  return `${loginId.trim().toLowerCase()}@${recipientDomain}`;
}

function renderSmtpSubject(payload: AccountTokenDeliveryPayload): string {
  return payload.kind === "account-registration"
    ? `[ProjectVeil] Registration token for ${payload.loginId}`
    : `[ProjectVeil] Password recovery token for ${payload.loginId}`;
}

function renderSmtpTextBody(payload: AccountTokenDeliveryPayload, recipient: string): string {
  const intro =
    payload.kind === "account-registration"
      ? "Use the registration token below to finish creating your ProjectVeil account."
      : "Use the password recovery token below to reset your ProjectVeil password.";
  return [
    intro,
    "",
    `Login ID: ${payload.loginId}`,
    `Delivery recipient: ${recipient}`,
    `Token: ${payload.token}`,
    `Expires at: ${payload.expiresAt}`,
    ...(payload.requestedDisplayName ? [`Display name: ${payload.requestedDisplayName}`] : []),
    ...(payload.playerId ? [`Player ID: ${payload.playerId}`] : []),
    "",
    "If you did not request this token, you can ignore this email."
  ].join("\r\n");
}

function createSmtpMessage(payload: AccountTokenDeliveryPayload, config: SmtpDeliveryConfig): { recipient: string; data: string } {
  const recipient = createSmtpRecipientAddress(payload.loginId, config.recipientDomain);
  const body = renderSmtpTextBody(payload, recipient);
  const lines = [
    `From: ${config.from}`,
    `To: ${recipient}`,
    `Subject: ${renderSmtpSubject(payload)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body
  ];

  const normalizedLines = lines
    .join("\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line));
  return {
    recipient,
    data: `${normalizedLines.join("\r\n")}\r\n`
  };
}

class SmtpClient {
  private readonly socket: Socket | TLSSocket;
  private buffer = "";
  private readonly responseQueue: string[] = [];
  private readonly responseWaiters: Array<(response: string) => void> = [];
  private readonly errorWaiters: Array<(error: Error) => void> = [];
  private closed = false;

  constructor(socket: Socket | TLSSocket, private readonly timeoutMs: number) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk: string | Buffer) => {
      this.onData(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    socket.on("timeout", () => {
      this.fail(new Error(`SMTP connection timed out after ${timeoutMs}ms`));
      socket.destroy();
    });
    socket.on("error", (error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    socket.on("close", () => {
      this.closed = true;
      this.fail(new Error("SMTP connection closed before the delivery completed"));
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const lineBreakIndex = this.buffer.indexOf("\r\n");
      if (lineBreakIndex < 0) {
        return;
      }
      const line = this.buffer.slice(0, lineBreakIndex);
      this.buffer = this.buffer.slice(lineBreakIndex + 2);
      if (!/^\d{3}[\s-]/.test(line)) {
        continue;
      }
      if (line[3] === "-") {
        continue;
      }
      this.pushResponse(line);
    }
  }

  private pushResponse(response: string): void {
    const waiter = this.responseWaiters.shift();
    if (waiter) {
      waiter(response);
      return;
    }
    this.responseQueue.push(response);
  }

  private fail(error: Error): void {
    while (this.errorWaiters.length > 0) {
      const reject = this.errorWaiters.shift();
      reject?.(error);
    }
  }

  async readResponse(): Promise<{ code: number; message: string }> {
    if (this.responseQueue.length > 0) {
      const response = this.responseQueue.shift()!;
      return this.parseResponse(response);
    }

    const response = await new Promise<string>((resolve, reject) => {
      this.responseWaiters.push(resolve);
      this.errorWaiters.push(reject);
    });
    return this.parseResponse(response);
  }

  private parseResponse(line: string): { code: number; message: string } {
    const match = /^(\d{3})\s?(.*)$/.exec(line);
    if (!match) {
      throw new AccountTokenDeliveryError(`SMTP server returned an invalid response: ${line}`, {
        retryable: false,
        failureReason: "smtp_protocol"
      });
    }
    return {
      code: Number(match[1]),
      message: match[2] || line
    };
  }

  async sendLine(line: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${line}\r\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async sendData(data: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${data}\r\n.\r\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await new Promise<void>((resolve) => {
      this.socket.end(() => resolve());
    });
  }
}

async function expectSmtpResponse(
  client: SmtpClient,
  allowedCodes: number[],
  context: string
): Promise<{ code: number; message: string }> {
  const response = await client.readResponse();
  if (allowedCodes.includes(response.code)) {
    return response;
  }
  if (response.code >= 400 && response.code < 600) {
    throw createSmtpFailure(response.code, `SMTP ${context} failed with ${response.code} ${response.message}`.trim());
  }
  throw new AccountTokenDeliveryError(`SMTP ${context} returned unexpected status ${response.code} ${response.message}`.trim(), {
    retryable: false,
    failureReason: "smtp_protocol",
    statusCode: response.code
  });
}

async function sendSmtpCommand(
  client: SmtpClient,
  command: string,
  allowedCodes: number[],
  context: string
): Promise<{ code: number; message: string }> {
  await client.sendLine(command);
  return expectSmtpResponse(client, allowedCodes, context);
}

async function connectSmtp(config: SmtpDeliveryConfig): Promise<SmtpClient> {
  const socket = config.secure
    ? connectTls({
        host: config.host,
        port: config.port,
        rejectUnauthorized: !config.ignoreTlsErrors
      })
    : new Socket();

  const connectedSocket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    socket.once("error", onError);
    if (config.secure) {
      (socket as TLSSocket).once("secureConnect", () => {
        socket.off("error", onError);
        resolve(socket);
      });
    } else {
      socket.connect(config.port, config.host, () => {
        socket.off("error", onError);
        resolve(socket);
      });
    }
  });

  return new SmtpClient(connectedSocket, config.timeoutMs);
}

async function deliverViaSmtp(payload: AccountTokenDeliveryPayload, config: SmtpDeliveryConfig): Promise<void> {
  const client = await connectSmtp(config).catch((error: unknown) => {
    if (error instanceof AccountTokenDeliveryError) {
      throw error;
    }
    throw new AccountTokenDeliveryError(`Token delivery SMTP connection failed: ${error instanceof Error ? error.message : String(error)}`, {
      retryable: true,
      failureReason: "network"
    });
  });

  try {
    await expectSmtpResponse(client, [220], "greeting");
    await sendSmtpCommand(client, `EHLO ${config.ehloName}`, [250], "EHLO");

    if (config.username && config.password) {
      const credentials = Buffer.from(`\u0000${config.username}\u0000${config.password}`, "utf8").toString("base64");
      const authResponse = await sendSmtpCommand(client, `AUTH PLAIN ${credentials}`, [235, 334], "AUTH");
      if (authResponse.code === 334) {
        await client.sendLine(credentials);
        await expectSmtpResponse(client, [235], "AUTH challenge");
      }
    }

    const message = createSmtpMessage(payload, config);
    await sendSmtpCommand(client, `MAIL FROM:<${config.from}>`, [250], "MAIL FROM");
    await sendSmtpCommand(client, `RCPT TO:<${message.recipient}>`, [250, 251], "RCPT TO");
    await sendSmtpCommand(client, "DATA", [354], "DATA");
    await client.sendData(message.data);
    await expectSmtpResponse(client, [250], "message body");
    await client.sendLine("QUIT");
  } catch (error) {
    if (error instanceof AccountTokenDeliveryError) {
      throw error;
    }
    if (error instanceof Error && /timed out/i.test(error.message)) {
      throw new AccountTokenDeliveryError(error.message, {
        retryable: true,
        failureReason: "timeout"
      });
    }
    throw new AccountTokenDeliveryError(`Token delivery SMTP request failed: ${error instanceof Error ? error.message : String(error)}`, {
      retryable: true,
      failureReason: "network"
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function deliverViaTransport(payload: AccountTokenDeliveryPayload, config: TransportDeliveryConfig): Promise<void> {
  if (config.kind === "smtp") {
    await deliverViaSmtp(payload, config);
    return;
  }
  await deliverViaWebhook(payload, config);
}

function successMessageForDeliveryMode(mode: Extract<AccountTokenDeliveryMode, "smtp" | "webhook">): string {
  return mode === "smtp" ? "Token delivery SMTP transport accepted the message" : "Token delivery webhook accepted the payload";
}

async function processQueuedDelivery(entry: QueuedDeliveryEntry): Promise<void> {
  if (isExpired(entry.payload.expiresAt)) {
    markDeadLetter(
      entry,
      new AccountTokenDeliveryError("Token delivery retry exhausted because the token expired before delivery succeeded", {
        retryable: false,
        failureReason: "timeout"
      }),
      entry.attemptCount
    );
    return;
  }

  const attemptNumber = entry.attemptCount + 1;
  try {
    await deliverViaTransport(entry.payload, entry.config);
    queuedDeliveries.delete(entry.key);
    deadLetterDeliveries.delete(entry.key);
    recordAuthTokenDeliverySuccess();
    recordAuthTokenDeliveryAttempt({
      kind: entry.payload.kind,
      loginId: entry.payload.loginId,
      deliveryMode: entry.config.kind,
      status: "delivered",
      attemptCount: attemptNumber,
      maxAttempts: entry.maxAttempts,
      retryable: false,
      message: successMessageForDeliveryMode(entry.config.kind)
    });
    syncQueueTelemetry();
  } catch (error) {
    if (!(error instanceof AccountTokenDeliveryError)) {
      throw error;
    }

    recordAuthTokenDeliveryFailure(error.failureReason);

    if (!error.retryable || attemptNumber >= entry.maxAttempts) {
      markDeadLetter(entry, error, attemptNumber);
      return;
    }

    const nextAttemptAt = Date.now() + computeRetryDelayMs(attemptNumber, entry.config);
    queuedDeliveries.set(entry.key, {
      ...entry,
      attemptCount: attemptNumber,
      nextAttemptAt,
      lastError: {
        message: error.message,
        failureReason: error.failureReason,
        ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
      }
    });
    recordAuthTokenDeliveryRetry();
    recordAuthTokenDeliveryAttempt({
      kind: entry.payload.kind,
      loginId: entry.payload.loginId,
      deliveryMode: entry.config.kind,
      status: "retry_scheduled",
      attemptCount: attemptNumber,
      maxAttempts: entry.maxAttempts,
      retryable: true,
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {}),
      nextAttemptAt: toIsoTimestamp(nextAttemptAt)
    });
    syncQueueTelemetry();
  }
}

async function processQueuedDeliveries(): Promise<void> {
  if (queueProcessing) {
    scheduleQueuePump();
    return;
  }

  queueProcessing = true;
  try {
    while (true) {
      const dueEntry = Array.from(queuedDeliveries.values())
        .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt)[0];
      if (!dueEntry || dueEntry.nextAttemptAt > Date.now()) {
        break;
      }

      await processQueuedDelivery(dueEntry);
    }
  } finally {
    queueProcessing = false;
    scheduleQueuePump();
  }
}

function queueRetry(
  payload: AccountTokenDeliveryPayload,
  config: TransportDeliveryConfig,
  error: AccountTokenDeliveryError
): AccountTokenDeliveryResult {
  const key = buildDeliveryKey(payload);
  const existing = queuedDeliveries.get(key);
  if (existing && existing.payload.token === payload.token) {
    return {
      deliveryMode: config.kind,
      deliveryStatus: "retry_scheduled",
      attemptCount: existing.attemptCount,
      maxAttempts: existing.maxAttempts,
      nextAttemptAt: toIsoTimestamp(existing.nextAttemptAt)
    };
  }

  const nextAttemptAt = Date.now() + computeRetryDelayMs(1, config);
  queuedDeliveries.set(key, {
    key,
    payload,
    config,
    attemptCount: 1,
    maxAttempts: config.maxAttempts,
    nextAttemptAt,
    lastError: {
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
    }
  });
  deadLetterDeliveries.delete(key);
  recordAuthTokenDeliveryRetry();
  recordAuthTokenDeliveryAttempt({
    kind: payload.kind,
    loginId: payload.loginId,
    deliveryMode: config.kind,
    status: "retry_scheduled",
    attemptCount: 1,
    maxAttempts: config.maxAttempts,
    retryable: true,
    message: error.message,
    failureReason: error.failureReason,
    ...(error.statusCode != null ? { statusCode: error.statusCode } : {}),
    nextAttemptAt: toIsoTimestamp(nextAttemptAt)
  });
  syncQueueTelemetry();
  scheduleQueuePump();

  return {
    deliveryMode: config.kind,
    deliveryStatus: "retry_scheduled",
    attemptCount: 1,
    maxAttempts: config.maxAttempts,
    nextAttemptAt: toIsoTimestamp(nextAttemptAt)
  };
}

function readTransportDeliveryConfig(mode: Extract<AccountTokenDeliveryMode, "smtp" | "webhook">, env: NodeJS.ProcessEnv): TransportDeliveryConfig {
  return mode === "smtp" ? readSmtpDeliveryConfig(env) : readWebhookDeliveryConfig(env);
}

export function readAccountRegistrationDeliveryMode(env: NodeJS.ProcessEnv = process.env): AccountTokenDeliveryMode {
  return readDeliveryMode(env.VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE);
}

export function readPasswordRecoveryDeliveryMode(env: NodeJS.ProcessEnv = process.env): AccountTokenDeliveryMode {
  return readDeliveryMode(env.VEIL_PASSWORD_RECOVERY_DELIVERY_MODE);
}

export function clearAccountTokenDeliveryState(kind: AccountTokenDeliveryKind, loginId: string): void {
  const key = buildDeliveryKey({ kind, loginId });
  queuedDeliveries.delete(key);
  deadLetterDeliveries.delete(key);
  syncQueueTelemetry();
  scheduleQueuePump();
}

export function resetAccountTokenDeliveryState(): void {
  clearQueueTimer();
  queuedDeliveries.clear();
  deadLetterDeliveries.clear();
  queueProcessing = false;
  syncQueueTelemetry();
}

export async function deliverAccountToken(
  mode: AccountTokenDeliveryMode,
  payload: AccountTokenDeliveryPayload,
  env: NodeJS.ProcessEnv = process.env
): Promise<AccountTokenDeliveryResult> {
  recordAuthTokenDeliveryRequest();

  if (mode === "disabled") {
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: mode,
      status: "disabled",
      attemptCount: 0,
      maxAttempts: 0,
      retryable: false,
      message: "Account token delivery is disabled"
    });
    return { deliveryMode: mode, deliveryStatus: "disabled" };
  }

  if (mode === "dev-token") {
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: mode,
      status: "dev-token",
      attemptCount: 0,
      maxAttempts: 0,
      retryable: false,
      message: "Account token returned in-band for development"
    });
    return {
      deliveryMode: mode,
      deliveryStatus: "dev-token",
      responseToken: payload.token
    };
  }

  const config = readTransportDeliveryConfig(mode, env);
  const key = buildDeliveryKey(payload);
  const existing = queuedDeliveries.get(key);
  if (existing && existing.payload.token === payload.token && !isExpired(existing.payload.expiresAt)) {
    return {
      deliveryMode: config.kind,
      deliveryStatus: "retry_scheduled",
      attemptCount: existing.attemptCount,
      maxAttempts: existing.maxAttempts,
      nextAttemptAt: toIsoTimestamp(existing.nextAttemptAt)
    };
  }

  try {
    await deliverViaTransport(payload, config);
    queuedDeliveries.delete(key);
    deadLetterDeliveries.delete(key);
    recordAuthTokenDeliverySuccess();
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: config.kind,
      status: "delivered",
      attemptCount: 1,
      maxAttempts: config.maxAttempts,
      retryable: false,
      message: successMessageForDeliveryMode(config.kind)
    });
    syncQueueTelemetry();
    return {
      deliveryMode: config.kind,
      deliveryStatus: "delivered",
      attemptCount: 1,
      maxAttempts: config.maxAttempts
    };
  } catch (error) {
    if (!(error instanceof AccountTokenDeliveryError)) {
      throw error;
    }

    recordAuthTokenDeliveryFailure(error.failureReason);

    if (error.retryable && config.maxAttempts > 1 && !isExpired(payload.expiresAt)) {
      return queueRetry(payload, config, error);
    }

    deadLetterDeliveries.set(key, {
      key,
      payload,
      config,
      attemptCount: 1,
      maxAttempts: config.maxAttempts,
      nextAttemptAt: Date.now(),
      lastError: {
        message: error.message,
        failureReason: error.failureReason,
        ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
      }
    });
    recordAuthTokenDeliveryDeadLetter();
    recordAuthTokenDeliveryAttempt({
      kind: payload.kind,
      loginId: payload.loginId,
      deliveryMode: config.kind,
      status: "dead-lettered",
      attemptCount: 1,
      maxAttempts: config.maxAttempts,
      retryable: error.retryable,
      message: error.message,
      failureReason: error.failureReason,
      ...(error.statusCode != null ? { statusCode: error.statusCode } : {})
    });
    syncQueueTelemetry();
    throw error;
  }
}
