# Colyseus Reconnect Soak Gate

本说明固定 issue #288 引入的长时 reconnect soak 口径，避免每次临时换循环次数、房间数或成功信号。

它补的是 [`docs/reconnect-smoke-gate.md`](./reconnect-smoke-gate.md) 和 [`docs/multiplayer-loadtest-gate.md`](./multiplayer-loadtest-gate.md) 之间的空档：

- smoke 回答“单条 canonical reconnect 链路是否还通”
- loadtest 回答“多房间基础吞吐是否还在可接受区间”
- reconnect soak 回答“长时间断开/重连循环后，权威房间和玩家可见状态是否仍然收敛”

## Single Command

本地和 CI 都统一执行下面这一条：

```bash
npm run stress:rooms:reconnect-soak
```

默认参数：

- `48 rooms`
- `8 reconnect cycles` / room
- `12` 连接并发
- `12` 动作并发
- `150ms` 断开间隔
- artifact 输出到 `artifacts/release-readiness/colyseus-reconnect-soak-summary.json`

如果 CI 需要改 artifact 路径，可追加：

```bash
npm run stress:rooms:reconnect-soak -- --artifact-path=artifacts/release-readiness/ci-colyseus-reconnect-soak.json
```

## Required Invariants

每次 reconnect cycle 都必须同时满足：

- `room_snapshot_parity`：断线前后持久化房间快照一致
- `player_visible_world_parity`：玩家可见世界状态一致
- `player_visible_fog_state_parity`：fog/地图可见面一致
- `battle_state_parity`：若在战斗中，battle 状态不能漂移；若不在战斗中，不能误入战斗
- `reachable_tiles_parity`：断线前后的玩家可行动作面一致
- `world_progression_invariant`：day、英雄位置、剩余移动力、资源与可见格数不能回档或跳变

失败输出必须至少能直接定位：

- `roomId`
- `playerId`
- `cycle`
- `invariant`

## CI / Release Artifact

命令结束后会输出：

- 控制台摘要：房间数、reconnect 次数、world/battle cycle 数、invariant check 总数
- `STRESS_RESULT_JSON_*`：完整结果，便于排查
- `RECONNECT_SOAK_ARTIFACT_SUMMARY`：适合 CI 日志抓取的精简摘要
- `artifacts/release-readiness/colyseus-reconnect-soak-summary.json`：结构化 artifact

建议 CI 至少把该 JSON artifact 保留到构建产物中，供 release-readiness 记录引用。

## When This Must Pass

出现下面任一条件，发版或扩大 playtest 范围前必须重新执行，并且结果必须为 `passed`：

- `apps/server`、`packages/shared` 中任何影响房间状态、世界推进、战斗、reconnect、快照持久化的改动
- `apps/client` 或 `apps/cocos-client` 中任何影响 reconnect 恢复、房间进入或玩家可见状态解释的改动
- 调整 `stress:rooms` / `stress:rooms:reconnect-soak` 的默认参数、指标口径或 artifact 结构
- 准备从当前受控测试扩大到更多玩家、更多时段，或进入 release candidate / shipping 候选包

若此 soak 失败，不要把 `multiplayer smoke` 或基础 `stress:rooms` 的通过误判成“可发版”。
