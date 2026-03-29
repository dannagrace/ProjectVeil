# ProjectVeil Server Runtime Regression Baseline

这套基线用于快速发现服务端运行时明显退化，目标不是完整性能平台，而是把已经存在的 `stress:rooms` 指标固化成一套可重复对比的门禁。

当前基线配置在 [`configs/runtime-regression-baseline.json`](/home/gpt/project/ProjectVeil/.worktrees/issue-327-0330-0003/configs/runtime-regression-baseline.json)，比较工具在 [`scripts/compare-runtime-regression.ts`](/home/gpt/project/ProjectVeil/.worktrees/issue-327-0330-0003/scripts/compare-runtime-regression.ts)。

## Covered Metrics

- 房间规模与成功率：`rooms`、`successfulRooms`、`failedRooms`
- 吞吐与耗时：`actionsPerSecond`、`durationMs`
- 资源压力：`cpuCoreUtilizationPct`、`rssPeakMb`、`heapPeakMb`、`peakActiveHandles`
- 关键 runtime counters：
  - `runtimeHealthAfterConnect.activeRoomCount`
  - `runtimeHealthAfterConnect.connectionCount`
  - `runtimeHealthAfterScenario.worldActionsTotal`
  - `runtimeHealthAfterScenario.battleActionsTotal`
  - `runtimeHealthAfterScenario.connectMessagesTotal`
  - `runtimeHealthAfterScenario.actionMessagesTotal`

## Local Reproduction

1. 生成一次固定基线参数的运行时 artifact

```bash
npm run stress:rooms:baseline
```

默认会写出：

- `artifacts/release-readiness/stress-rooms-runtime-metrics.json`

2. 用基线配置比对本次运行结果

```bash
npm run perf:runtime:compare
```

默认会写出：

- `artifacts/release-readiness/runtime-regression-report.json`

同时会在控制台输出结构化结果摘要，并在有明确退化时返回非零退出码。

如果想比较别的 artifact：

```bash
node --import tsx ./scripts/compare-runtime-regression.ts \
  --baseline ./configs/runtime-regression-baseline.json \
  --artifact ./path/to/stress-rooms-runtime-metrics.json \
  --output ./artifacts/release-readiness/runtime-regression-report.json
```

## Updating The Baseline

只在下面场景更新基线：

- 服务端、房间生命周期或消息模型有意做了性能特征调整
- 固定压测命令本身发生了变化
- 已经在目标环境连续验证过“新结果稳定且合理”，旧阈值开始制造噪音

更新步骤：

1. 在目标环境重复执行至少一次 `npm run stress:rooms:baseline`，确认结果稳定。
2. 打开最新 artifact，核对各场景的 `actionsPerSecond`、`durationMs`、`rssPeakMb`、`heapPeakMb`、`peakActiveHandles` 和 runtime counters。
3. 仅修改 [`configs/runtime-regression-baseline.json`](/home/gpt/project/ProjectVeil/.worktrees/issue-327-0330-0003/configs/runtime-regression-baseline.json) 中对应阈值，不要把数字散落进脚本。
4. 重新执行 `npm run perf:runtime:compare`，确认同一份 artifact 在新基线下通过。
5. 在提交说明或 PR 描述中记录为什么需要抬高或收紧阈值，以及新 artifact 路径。

建议：

- 优先把阈值设成“能稳定抓住明显退化”的下限/上限，而不是贴着最近一次样本值。
- 如果只是偶发波动，不要直接刷新基线；先确认是否是环境噪音、并发参数变化或脚本回归。

## Failure Semantics

比较工具会把每个场景拆成独立 checks，并输出：

- `passed` / `failed` 总状态
- 每条失败 check 的 `id`
- 对应指标、阈值类型、实际值、来源路径、失败说明

任一 check 失败时，CLI 退出码为 `1`。
