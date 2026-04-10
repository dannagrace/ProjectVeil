import assert from "node:assert/strict";
import test from "node:test";
import { createTrackedMySqlPool } from "../src/mysql-pool";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "../src/observability";

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
  assert.match(metrics, /^veil_mysql_pool_connection_limit\{pool="room_snapshot"\} 7$/m);
  assert.match(metrics, /^veil_mysql_pool_queue_depth\{pool="room_snapshot"\} 0$/m);
  assert.match(metrics, /^veil_mysql_pool_connection_utilization_ratio\{pool="room_snapshot"\} 0\.0000$/m);
});
