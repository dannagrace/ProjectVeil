# Cocos PvP Encounter Lifecycle

本说明定义 Cocos 主客户端在“敌方英雄接触 -> 进入对抗 -> 结算/恢复 -> 回写世界”这条权威链路上应渲染的最小状态与信号。`apps/client` 的 H5 回归壳应复用同一语义，作为自动化与多人验收的快反馈面。

## 权威状态机

| 服务端 / 权威状态 | 客户端渲染阶段 | 最小可见信号 | 备注 |
| --- | --- | --- | --- |
| 地图探索，目标格会撞上敌方英雄 | `待接敌` | 对手摘要、英雄/玩家身份、说明“接触后将进入 PVP” | 允许是 hover/preview 或选中态，不要求已经分配 battle session |
| 收到 `battle.started`，`encounterKind = hero` | `战斗中` | 遭遇来源、对手摘要、当前回合归属、遭遇会话 `<roomId>/<battleId>` | 这是“谁先手接敌”的权威来源，不要靠 debug log 猜 |
| 战斗中刷新普通快照 | `战斗中` | 当前行动方、我方席位、连接状态 | 不需要重复弹窗，但摘要不能丢 |
| 连接进入 `reconnecting` | `恢复中（等待权威同步）` | 明确提示“遭遇已中断/正在恢复”，并保留 battle session / 对手摘要 | 此时不要把本地预测当成最终胜负 |
| 连接进入 `reconnect_failed` 且开始缓存/快照回补 | `快照回补中` | 明确提示“遭遇恢复失败/已转入失败恢复”，说明当前展示可能来自缓存 | 要区分“仍在重连”与“已进入回补” |
| 收到权威 `battle.resolved`，我方获胜 | `已结算` | 胜利标题、结果摘要、房间已回到地图探索阶段、下一步仍可移动/继续推进 | 同时保留最近对手和遭遇会话 |
| 收到权威 `battle.resolved`，我方失败 | `已结算` | 失败标题、结果摘要、对手仍保留在地图上、下一步已无法继续移动或需等待 | 同时保留最近对手和遭遇会话 |
| 断线后恢复到已结算态 | `已结算` | 恢复状态、结算摘要、最近对手、战后房间态 | 用来证明“断线前后的权威结果一致” |

## 主客户端渲染约束

- 遭遇入口必须直接显示“谁先接触了谁”，不能只显示抽象的 `PVP` 标签。
- 对手摘要必须至少包含：对手英雄/玩家身份、房间态、遭遇会话、当前回合归属或“等待权威恢复”。
- 结算反馈必须能区分三种结果：胜利、失利、遭遇中断/恢复中。
- 进入失败恢复后，客户端要明确说明当前处于缓存/快照回补，而不是继续沿用正常结算文案。
- 战后回到地图后，最近对手/最近遭遇与 battle session 不能立刻消失，否则人工验收无法确认这场遭遇是谁。

## 自动化与人工验收

- Canonical multiplayer smoke：
  - `npm run test:e2e:multiplayer:smoke`
  - 当前默认覆盖多人同步基线与 `tests/e2e/pvp-hero-encounter.spec.ts`，用于快速确认“能进遭遇、能看懂对手与房间态、能读出结算结果”。
- Happy path：
  - `tests/e2e/pvp-hero-encounter.spec.ts`
  - 断言进入战斗时存在 `room-phase`、`encounter-source`、`opponent-summary`、`room-result-summary`
  - 断言结算后仍保留 `battle-settlement-*`、`room-next-action` 与最近对手 / 遭遇会话
- Lifecycle edge：
  - `npm run test:e2e:multiplayer -- pvp-reconnect-recovery`
  - `tests/e2e/pvp-reconnect-recovery.spec.ts`
  - 断言遭遇中断后仍保留对手摘要、遭遇会话、恢复提示，并在恢复后回到可继续操作的权威战斗态
- Post-settlement recovery：
  - `npm run test:e2e:multiplayer -- pvp-postbattle-reconnect`
  - `tests/e2e/pvp-postbattle-reconnect.spec.ts`
  - 断言结算弹窗、战后房间态、最近对手与遭遇会话在恢复后仍保持一致
- 文案 / 状态分支：
  - `apps/client/test/room-feedback.test.ts`
  - `apps/client/test/main-session-runtime.test.ts`

## 已知边界

- 本 slice 只收口已有双人遭遇 / 房间反馈链路，不扩展新的匹配系统、排位或复杂房间编排。
- `npm run test:e2e:multiplayer:smoke` 仍是 PR 级快反馈，不覆盖 reconnect / 结算恢复的所有分支；这些分支继续用 `npm run test:e2e:multiplayer` 下的对应 PvP spec 复核。
- H5 回归壳与 Cocos 主客户端应复用同一套“对手摘要 / 房间态 / 遭遇会话 / 结算结果”语义，但本地自动化当前仍以 H5 壳为最快反馈面。

## CI / 手工成功信号

- 进入 PvP 时能从 UI 直接确认发起方、对手方和 battle session。
- 重连期间与失败恢复期间的文案不同，且都明确提示“以权威状态为准”。
- 战后胜负与“房间是否已回到地图探索”可由 UI 直接读出，无需查看服务端日志。
- 恢复到已结算态后，最近对手与遭遇会话仍可见，便于截图、录屏和 smoke evidence 留档。
