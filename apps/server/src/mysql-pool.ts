import { createPool, type Pool, type PoolOptions } from "mysql2/promise";

export const DEFAULT_MYSQL_POOL_CONNECTION_LIMIT = 4;
export const DEFAULT_MYSQL_POOL_MAX_IDLE = 4;
export const DEFAULT_MYSQL_POOL_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_MYSQL_POOL_QUEUE_LIMIT = 0;
export const DEFAULT_MYSQL_POOL_WAIT_FOR_CONNECTIONS = true;

export interface MySqlPoolConfig {
  connectionLimit: number;
  maxIdle: number;
  idleTimeoutMs: number;
  queueLimit: number;
  waitForConnections: boolean;
}

export interface MySqlPoolConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  pool: MySqlPoolConfig;
}

interface TrackablePoolInternals {
  _allConnections?: unknown[];
  _freeConnections?: unknown[];
  _connectionQueue?: unknown[];
}

interface ObservablePoolState {
  activeConnections: number;
  queueDepth: number;
}

interface EventablePool {
  on(event: "acquire", listener: () => void): unknown;
  off(event: "enqueue", listener: () => void): unknown;
  on(event: "enqueue", listener: () => void): unknown;
  once(event: "enqueue", listener: () => void): unknown;
  on(event: "release", listener: () => void): unknown;
}

interface WrapableCorePool {
  getConnection(callback: (error: Error | null, connection: unknown) => void): void;
}

export interface MySqlPoolMetricsSnapshot {
  pool: string;
  connectionLimit: number;
  maxIdle: number;
  idleTimeoutMs: number;
  waitForConnections: boolean;
  queueLimit: number;
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  queueDepth: number;
  utilizationRatio: number;
}

const trackedPools = new Map<string, { pool: Pool; config: MySqlPoolConfig; state: ObservablePoolState }>();

function coerceLength(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value && typeof value === "object" && "length" in value && typeof value.length === "number") {
    return value.length;
  }
  return 0;
}

function getTrackedPoolInternals(pool: Pool): TrackablePoolInternals {
  const candidate = pool as unknown as { pool?: TrackablePoolInternals };
  return candidate.pool ?? {};
}

function attachPoolObservability(pool: Pool, state: ObservablePoolState): void {
  const observablePool = pool as unknown as EventablePool;
  observablePool.on("acquire", () => {
    state.activeConnections += 1;
  });
  observablePool.on("release", () => {
    state.activeConnections = Math.max(0, state.activeConnections - 1);
  });
  observablePool.on("enqueue", () => {
    state.queueDepth += 1;
  });

  const candidate = pool as unknown as { pool?: WrapableCorePool };
  const corePool = candidate.pool;
  if (!corePool) {
    return;
  }

  const originalGetConnection = corePool.getConnection.bind(corePool);
  corePool.getConnection = (callback) => {
    let requestWasQueued = false;
    const markQueued = () => {
      requestWasQueued = true;
    };
    observablePool.once("enqueue", markQueued);

    originalGetConnection((error, connection) => {
      observablePool.off("enqueue", markQueued);
      if (requestWasQueued) {
        state.queueDepth = Math.max(0, state.queueDepth - 1);
      }
      callback(error, connection);
    });
  };
}

export function createTrackedMySqlPool(
  label: string,
  config: MySqlPoolConnectionConfig,
  createPoolFn: (options: PoolOptions) => Pool = createPool
): Pool {
  const pool = createPoolFn(buildMySqlPoolOptions(config));
  const state: ObservablePoolState = {
    activeConnections: 0,
    queueDepth: 0
  };
  attachPoolObservability(pool, state);
  trackedPools.set(label, { pool, config: config.pool, state });

  const originalEnd = pool.end.bind(pool);
  (pool as { end: () => Promise<void> }).end = async () => {
    trackedPools.delete(label);
    await originalEnd();
  };

  return pool;
}

export function buildMySqlPoolOptions(config: MySqlPoolConnectionConfig): PoolOptions {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.pool.connectionLimit,
    maxIdle: config.pool.maxIdle,
    idleTimeout: config.pool.idleTimeoutMs,
    queueLimit: config.pool.queueLimit,
    waitForConnections: config.pool.waitForConnections,
    namedPlaceholders: true
  };
}

export function getMySqlPoolMetricsSnapshot(): MySqlPoolMetricsSnapshot[] {
  return Array.from(trackedPools.entries())
    .map(([label, entry]) => {
      const internals = getTrackedPoolInternals(entry.pool);
      const totalConnections = coerceLength(internals._allConnections);
      const idleConnections = coerceLength(internals._freeConnections);
      const activeConnections = entry.state.activeConnections;
      const queueDepth = entry.state.queueDepth;
      const utilizationRatio =
        entry.config.connectionLimit > 0 ? activeConnections / entry.config.connectionLimit : 0;

      return {
        pool: label,
        connectionLimit: entry.config.connectionLimit,
        maxIdle: entry.config.maxIdle,
        idleTimeoutMs: entry.config.idleTimeoutMs,
        waitForConnections: entry.config.waitForConnections,
        queueLimit: entry.config.queueLimit,
        totalConnections,
        activeConnections,
        idleConnections,
        queueDepth,
        utilizationRatio
      };
    })
    .sort((left, right) => left.pool.localeCompare(right.pool));
}

export function resetTrackedMySqlPools(): void {
  trackedPools.clear();
}
