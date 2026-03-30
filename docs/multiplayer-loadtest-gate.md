# ProjectVeil Multiplayer / Load-Test Gate

本说明把 wider playtest 前必须复用的多人同步 / 多房间基线固定下来，避免每次临时换参数、换阈值、换回退口径。

它是 [`docs/core-gameplay-release-readiness.md`](/home/gpt/project/ProjectVeil/.worktrees/issue-214/docs/core-gameplay-release-readiness.md) 中“权威玩法与多人同步”门禁的唯一放量基线。

如果需要把一次 `stress:rooms` 执行结果和固定 runtime regression baseline 做自动对比，参见 [`docs/runtime-regression-baseline.md`](/home/gpt/project/ProjectVeil/.worktrees/issue-327-0330-0003/docs/runtime-regression-baseline.md)。

如果目标是 release candidate / shipping 候选包，或本次改动涉及 reconnect 生命周期、房间快照恢复、战斗恢复，不要只跑本说明；还必须额外通过 [`docs/reconnect-soak-gate.md`](./reconnect-soak-gate.md)。

## Standard Command Set

扩大测试范围前，至少按下面顺序执行一次：

1. 多人同步冒烟

```bash
npm run test:e2e:multiplayer:smoke
```

2. 多房间基线压测

```bash
npm run stress:rooms:baseline
```

等价展开命令：

```bash
npm run stress:rooms -- \
  --rooms=48 \
  --connect-concurrency=12 \
  --action-concurrency=12 \
  --sample-interval-ms=100 \
  --reconnect-pause-ms=150 \
  --artifact-path=artifacts/release-readiness/stress-rooms-runtime-metrics.json
```

3. 基线回归对比

```bash
npm run perf:runtime:compare
```

说明：

- `48 rooms` 是当前 wider playtest 前的固定基线，不在本门禁里临时上调。
- 默认场景固定为 `world_progression,battle_settlement,reconnect`，不要删场景只跑其中一段。
- `test:e2e:multiplayer:smoke` 负责回答“多人主链路还通不通”，`stress:rooms` 负责回答“同一套候选包在多房间下是否还在可接受性能区间内”。
- `perf:runtime:compare` 负责回答“这次运行是否已经明显偏离固定 runtime baseline”。

若环境无法跑 Playwright，但 `stress:rooms` 能跑，请把 Playwright 阻塞原因和缺失依赖写进本次记录，不能直接把 smoke 视为通过。

## Required Thresholds

`npm run stress:rooms` 的控制台摘要和 `STRESS_RESULT_JSON_*` 输出中，至少要满足下面阈值：

| 指标 | 阈值 | 说明 |
| --- | --- | --- |
| `successfulRooms` | 每个场景都必须等于 `48` | 任何房间失败都算 gate fail |
| `failedRooms` | 每个场景都必须等于 `0` | 不接受部分成功 |
| `runtimeHealthAfterConnect.activeRoomCount` | `48` | 确认房间数确实拉满 |
| `runtimeHealthAfterConnect.connectionCount` | `48` | 当前基线是每房 1 连接 |
| `runtimeHealthAfterScenario.worldActionsTotal` | `world_progression >= 96` | 固定命令下应完成 48 次移动 + 48 次结束回合 |
| `runtimeHealthAfterScenario.worldActionsTotal` | `battle_settlement >= 144` | battle 场景结束后累计 world action 总数下限 |
| `runtimeHealthAfterScenario.battleActionsTotal` | `battle_settlement >= 144` | battle 结算必须实际消耗战斗动作 |
| `runtimeHealthAfterScenario.connectMessagesTotal` | `reconnect >= 192` | reconnect 场景结束后累计连接消息下限 |
| `runtimeHealthAfterScenario.actionMessagesTotal` | `reconnect >= 336` | 固定三场景顺序下的累计动作总数下限 |
| `actionsPerSecond` | `world_progression >= 150` | 当前基线下的最低可接受吞吐 |
| `actionsPerSecond` | `battle_settlement >= 250` | 战斗结算压测最低吞吐 |
| `actionsPerSecond` | `reconnect >= 100` | reconnect 恢复场景最低吞吐 |
| `durationMs` | `world_progression <= 1200` | 单场景耗时上限 |
| `durationMs` | `battle_settlement <= 1200` | 单场景耗时上限 |
| `durationMs` | `reconnect <= 1500` | reconnect 允许更高耗时 |
| `cpuCoreUtilizationPct` | `world_progression <= 80` | 超过说明 CPU 已接近无缓冲区 |
| `cpuCoreUtilizationPct` | `battle_settlement <= 75` | 战斗场景更容易暴露 CPU 压力 |
| `cpuCoreUtilizationPct` | `reconnect <= 50` | reconnect 不应靠高 CPU 扛过去 |
| `rssPeakMb` | 每个场景都必须 `<= 320` | 粗粒度内存上限 |
| `heapPeakMb` | 每个场景都必须 `<= 110` | JS 堆上限 |
| `peakActiveHandles` | 每个场景都必须 `<= 120` | 防止句柄泄漏式放量 |
| reconnect 恢复成功率 | `100%` | 以 `reconnect` 场景 `successfulRooms / rooms` 计算 |

判定规则：

- 任一阈值失败，本次候选包不能进入 wider playtest。
- 若 smoke 失败但压测通过，仍按 gate fail 处理，因为这通常说明主链路逻辑或测试环境有回归。
- 若 smoke 因环境依赖缺失无法执行，允许把结果记为 `blocked`，但不能标记为 `passed`。

## Rollback Guidance

只要触发下列任一情况，优先回退到“上一次通过本基线的候选包 / 配置”，而不是带着异常继续放量：

- `failedRooms > 0`
- reconnect 恢复成功率不是 `100%`
- `rssPeakMb`、`heapPeakMb` 或 `peakActiveHandles` 超阈值
- `actionsPerSecond` 明显跌破阈值，且伴随 `durationMs` 上升
- smoke 出现多人状态分叉、错误房间恢复、结算后回档

建议回退动作：

1. 停止扩大测试名单，维持当前已知稳定的 playtest 范围。
2. 回退最近引入的多人协议、房间生命周期、持久化、reconnect、战斗结算相关变更。
3. 在回退候选包上重新执行本门禁，确认指标恢复到阈值内。
4. 仅在新的修复候选包再次通过 smoke + stress 后，才重新放量。

## When To Rerun

出现下面任一条件，必须重跑本门禁，不能复用旧记录：

- `apps/server`、`packages/shared` 中任何影响房间状态、战斗、同步、reconnect、持久化的改动
- `apps/client` 或 `apps/cocos-client` 中任何影响多人房间进入、状态恢复、事件驱动的改动
- 进入 release candidate / shipping 候选包，尤其是 reconnect / 快照恢复相关候选包
- 调整 `stress:rooms` 参数、默认场景、阈值，或 observability 指标口径
- 准备把 playtest 范围扩大到更多玩家、更多时段，或从 H5 过渡到 Cocos 主客户端验证
- 距离上一次基线记录已超过 14 天
- 上一次记录结果为 `partial`、`blocked` 或 `fail`

## Result Record Template

最小记录至少包含以下字段，建议直接保存一份 JSON 到 `docs/release-evidence/`：

```json
{
  "schemaVersion": 1,
  "gate": "multiplayer-loadtest-baseline",
  "executedAt": "2026-03-29T08:12:22+08:00",
  "revision": {
    "branch": "<branch>",
    "commit": "<commit>",
    "shortCommit": "<short>"
  },
  "commands": [
    "npm run test:e2e:multiplayer:smoke",
    "npm run stress:rooms -- --rooms=48 --connect-concurrency=12 --action-concurrency=12 --sample-interval-ms=100 --reconnect-pause-ms=150"
  ],
  "status": "passed | blocked | failed",
  "thresholds": {
    "rooms": 48,
    "reconnectSuccessRate": "100%",
    "rssPeakMbMax": 320,
    "heapPeakMbMax": 110,
    "peakActiveHandlesMax": 120
  },
  "results": [],
  "validation": {
    "multiplayerSmoke": {
      "status": "passed | blocked | failed",
      "notes": ""
    },
    "stressRooms": {
      "status": "passed | failed",
      "notes": ""
    }
  },
  "rollbackDecision": {
    "required": false,
    "notes": ""
  }
}
```

## Real Sample Record

本仓库当前基线样例见：

- [`docs/release-evidence/multiplayer-loadtest-baseline-2026-03-29.json`](/home/gpt/project/ProjectVeil/.worktrees/issue-214/docs/release-evidence/multiplayer-loadtest-baseline-2026-03-29.json)

这份样例来自真实执行：

- `npm run stress:rooms -- --rooms=48 --connect-concurrency=12 --action-concurrency=12 --sample-interval-ms=100 --reconnect-pause-ms=150`
- `npm run test:e2e:multiplayer:smoke`

其中：

- `stress:rooms` 通过，3 个场景均达到 `48/48` 成功房间，reconnect 恢复成功率 `100%`。
- `test:e2e:multiplayer:smoke` 在当前容器中被环境依赖阻塞，Chromium 启动失败并缺少 `libatk-bridge-2.0.so.0`，因此样例记录为 `blocked`，没有把 smoke 误记成 `passed`。
