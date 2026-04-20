import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Pool } from "mysql2/promise";
import { createTrackedMySqlPool } from "@server/infra/mysql-pool";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "@server/domain/ops/observability";

test("prometheus metrics expose mysql pool pressure gauges when mysql pools are configured", async (t) => {
  resetRuntimeObservability();
  const pool = createTrackedMySqlPool("room_snapshot", {
    host: "127.0.0.1",
    port: 3306,
    user: "veil",
    password: "veil",
    database: "project_veil",
    pool: {
      connectionLimit: 7,
      maxIdle: 3,
      idleTimeoutMs: 15_000,
      queueLimit: 12,
      waitForConnections: true
    }
  });

  t.after(async () => {
    await pool.end();
    resetRuntimeObservability();
  });

  const metrics = buildPrometheusMetricsDocument();
  assert.match(metrics, /^veil_db_pool_active_connections\{pool="room_snapshot"\} 0$/m);
  assert.match(metrics, /^veil_db_pool_queue_depth\{pool="room_snapshot"\} 0$/m);
  assert.match(metrics, /^veil_mysql_pool_connection_limit\{pool="room_snapshot"\} 7$/m);
  assert.match(metrics, /^veil_mysql_pool_queue_depth\{pool="room_snapshot"\} 0$/m);
  assert.match(metrics, /^veil_mysql_pool_connection_utilization_ratio\{pool="room_snapshot"\} 0\.0000$/m);
});

test("prometheus db pool gauges track active and queued requests from pool callbacks", async (t) => {
  resetRuntimeObservability();

  const queuedCallbacks: Array<(error: Error | null, connection: unknown) => void> = [];

  class FakePool extends EventEmitter {
    pool = {
      getConnection: (callback: (error: Error | null, connection: unknown) => void) => {
        this.emit("enqueue");
        queuedCallbacks.push(callback);
      }
    };

    async end(): Promise<void> {}
  }

  const fakePool = new FakePool();
  const pool = createTrackedMySqlPool(
    "config_center",
    {
      host: "127.0.0.1",
      port: 3306,
      user: "veil",
      password: "veil",
      database: "project_veil",
      pool: {
        connectionLimit: 4,
        maxIdle: 4,
        idleTimeoutMs: 60_000,
        queueLimit: 0,
        waitForConnections: true
      }
    },
    () => fakePool as unknown as Pool
  );

  t.after(async () => {
    await pool.end();
    resetRuntimeObservability();
  });

  fakePool.emit("acquire");
  fakePool.emit("acquire");
  fakePool.emit("release");
  fakePool.pool.getConnection(() => {});

  let metrics = buildPrometheusMetricsDocument();
  assert.match(metrics, /^veil_db_pool_active_connections\{pool="config_center"\} 1$/m);
  assert.match(metrics, /^veil_db_pool_queue_depth\{pool="config_center"\} 1$/m);
  assert.match(metrics, /^veil_mysql_pool_connections_active\{pool="config_center"\} 1$/m);
  assert.match(metrics, /^veil_mysql_pool_queue_depth\{pool="config_center"\} 1$/m);
  assert.match(metrics, /^veil_mysql_pool_connection_utilization_ratio\{pool="config_center"\} 0\.2500$/m);

  queuedCallbacks.shift()?.(null, {});
  metrics = buildPrometheusMetricsDocument();
  assert.match(metrics, /^veil_db_pool_queue_depth\{pool="config_center"\} 0$/m);
  assert.match(metrics, /^veil_mysql_pool_queue_depth\{pool="config_center"\} 0$/m);
});
