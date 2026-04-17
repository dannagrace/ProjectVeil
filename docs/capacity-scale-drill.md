# Capacity Scale Drill

`LAUNCH-P3 #1556` 把 HPA 演练从“只有理论容量规划”推进成了可重复执行的 drill。

## What We Added

- `npm run ops:hpa-scale-drill`
- `infra/grafana/dashboards/cost-overview.json`
- `docs/alerting-rules.yml` 里的 `VeilDailyInfrastructureCostHigh`
- `infra/alertmanager.yml` 里的 cost alert 路由

## Input Format

脚本消费一份按时间排序的 checkpoint JSON：

```json
{
  "checkpoints": [
    {
      "at": "2026-04-17T09:00:00.000Z",
      "replicas": 2,
      "activeRooms": 10,
      "connectedPlayers": 20,
      "cpuUtilizationPct": 51
    },
    {
      "at": "2026-04-17T09:00:20.000Z",
      "replicas": 2,
      "activeRooms": 16,
      "connectedPlayers": 32,
      "cpuUtilizationPct": 78
    },
    {
      "at": "2026-04-17T09:01:05.000Z",
      "replicas": 4,
      "activeRooms": 24,
      "connectedPlayers": 48,
      "cpuUtilizationPct": 63
    }
  ]
}
```

## Run

```bash
npm run ops:hpa-scale-drill -- \
  --input ./artifacts/ops/hpa-checkpoints.json \
  --output-dir ./artifacts/ops \
  --threshold-active-rooms 16 \
  --target-replicas 4
```

产物：

- `hpa-scale-drill.json`
- `hpa-scale-drill.md`

## Expected Review Questions

每次 drill 至少回答这 3 个问题：

1. HPA 是否在阈值触发后按预期从 `N` 扩到 `2N`
2. scale-out latency 是否还在当前可接受窗口内
3. cost overview 面板是否能解释这次扩容带来的日成本变化

## Alert: VeilDailyInfrastructureCostHigh

触发条件：

- `sum(veil_infra_estimated_daily_cost_usd) > 180`
- 持续 `30m`

处理顺序：

1. 先看 `dashboards/cost-overview.json` 里的 namespace / deployment 成本分布
2. 对照 HPA drill 报告，看是否是 `project-veil-server` 扩容导致
3. 如果是活动流量抬升，再对照 live-ops calendar 和 kill-switch 状态
4. 如果是异常放大，再考虑先降灰度或触发限流/回滚
