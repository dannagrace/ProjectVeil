# Colyseus Reconnect Soak Gate

本说明固定 issue #288 引入的长时 reconnect soak 口径，避免每次临时换循环次数、房间数或成功信号。

它补的是 [`docs/reconnect-smoke-gate.md`](./reconnect-smoke-gate.md) 和 [`docs/multiplayer-loadtest-gate.md`](./multiplayer-loadtest-gate.md) 之间的空档：

- smoke 回答“单条 canonical reconnect 链路是否还通”
- loadtest 回答“多房间基础吞吐是否还在可接受区间”
- reconnect soak 回答“长时间断开/重连循环后，权威房间和玩家可见状态是否仍然收敛”

## Single Command

release candidate、shipping 候选包、或需要给 reviewer 固定 revision-scoped 证据时，统一执行下面这一条：

```bash
npm run release -- reconnect-soak -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha>
```

这个命令会固定调用底层的 `npm run stress:rooms:reconnect-soak`，但把结果提升成 candidate-level artifact：

- `artifacts/release-readiness/colyseus-reconnect-soak-summary-<candidate>-<short-sha>.json`
- `artifacts/release-readiness/colyseus-reconnect-soak-summary-<candidate>-<short-sha>.md`

默认 soak profile（也是 candidate gate 的最小 profile）：

- `48 rooms`
- `8 reconnect cycles` / room
- `12` 连接并发
- `12` 动作并发
- `150ms` 断开间隔
- Markdown / JSON 都会记录实际持续时间；任何低于这套 canonical profile 的短跑都不应当作为 candidate gate 证据

如果需要覆盖输出路径，可追加：

```bash
npm run release -- reconnect-soak -- \
  --candidate phase1-wechat-rc \
  --candidate-revision abc1234 \
  --output artifacts/release-readiness/phase1-reconnect-soak.json \
  --markdown-output artifacts/release-readiness/phase1-reconnect-soak.md
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
- candidate-scoped JSON：duration、scenario matrix、failures、final verdict、cleanup 状态、rerun triggers
- candidate-scoped Markdown：给 release reviewer / PR / CI artifact 直接挂载的人类可读摘要

建议 CI 至少把该 JSON artifact 保留到构建产物中，供 release-readiness 记录引用。

`npm run release -- gate:summary` 和 `npm run release -- phase1:candidate-dossier` 会把这份 artifact 作为正式 candidate gate 输入之一，并显式标记 reconnect soak evidence 是：

- `present`：artifact 对齐当前 candidate revision，soak 通过且 cleanup 归零
- `stale`：artifact 时间戳过旧，或 revision 不再对齐当前 candidate
- `failing`：任一 invariant、cleanup、计数器、或 candidate verdict 失败

PR / 日常多人回归先看 `npm test -- e2e:multiplayer:smoke`；release candidate、shipping 候选包、或 reconnect / 房间恢复语义改动，再额外要求 reconnect soak gate 通过。

## When This Must Pass

出现下面任一条件，发版或扩大 playtest 范围前必须重新执行，并且结果必须为 `passed`：

- `apps/server`、`packages/shared` 中任何影响房间状态、世界推进、战斗、reconnect、快照持久化的改动
- `apps/client` 或 `apps/cocos-client` 中任何影响 reconnect 恢复、房间进入或玩家可见状态解释的改动
- 调整 `stress:rooms` / `stress:rooms:reconnect-soak` 的默认参数、指标口径或 artifact 结构
- 准备从当前受控测试扩大到更多玩家、更多时段，或进入 release candidate / shipping 候选包

若此 soak 失败，不要把 `multiplayer smoke` 或基础 `stress:rooms` 的通过误判成“可发版”。

## Interpreting Flakes Vs Blockers

- 可视为“需要重跑”的前提：端口占用、临时环境抖动、或 runner 启动类噪音导致命令未完成，但 reconnect invariant 本身没有失败证据，cleanup 也没有泄漏
- 必须视为 blocker：任一 invariant 漂移、`failedRooms > 0`、cleanup 计数未回零、artifact revision 不匹配当前 candidate、或 artifact 没记录 reconnect attempts / invariant checks
- 若第一次结果无法明确归类，保留失败 artifact，重新在同一 candidate revision 上再跑一次；不要覆盖成“最后一次看起来通过”而丢失第一次证据
