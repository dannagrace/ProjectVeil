# Cocos Release Evidence Template

本模板现在以 `npm run release:cocos-rc:bundle` 生成的 candidate-level evidence bundle 为主，内部会先自动执行 `npm run release:cocos:primary-journey-evidence`，再复用 `npm run release:cocos-rc:snapshot` 作为 machine-readable JSON。`release:cocos:primary-journey-evidence` 是 primary client main path 的 canonical RC evidence source；release gate review、PR artifact、和 candidate dossier 都应直接引用它生成的 candidate+revision JSON / Markdown，而不是再补 ad hoc 截图或另起格式。目标是把 Cocos 主客户端的 canonical `Lobby -> room -> world explore -> first battle -> settlement -> reconnect/session recovery` 证据，与微信小游戏 RC 的补充证据收口到同一份可归档、可校验、可对比的快照里，并自动补齐可直接附到 CI artifact / PR 评论的 Markdown 摘要、检查清单与 blocker 记录。

相关文档：

- 核心玩法发布就绪总清单：`docs/core-gameplay-release-readiness.md`
- Primary client delivery checklist：`docs/cocos-primary-client-delivery.md`
- 发布就绪自动化快照：`docs/release-readiness-snapshot.md`
- 统一断线恢复门禁：`docs/reconnect-smoke-gate.md`
- 微信小游戏构建 / 打包 / 验收：`docs/wechat-minigame-release.md`
- 样例快照：`docs/release-evidence/cocos-rc-snapshot.example.json`
- RC 检查清单模板：`docs/release-evidence/cocos-wechat-rc-checklist.template.md`
- RC blocker 模板：`docs/release-evidence/cocos-wechat-rc-blockers.template.md`

## RC Evidence Packet

每个 Cocos / WeChat release candidate 都固定产出同一组证据，并统一落在 `artifacts/release-readiness/`：

1. `artifacts/release-readiness/cocos-primary-journey-evidence-<candidate>-<short-sha>.json`
   - headless primary-client canonical journey 结构化结果，固定带每个 milestone 的 runtime diagnostics JSON，以及 stage pass/fail、timing、`failureSummary`、`checkpointLedger`
2. `artifacts/release-readiness/cocos-primary-journey-evidence-<candidate>-<short-sha>.md`
   - 同一 primary journey 的 reviewer 摘要，说明当前使用的是 headless runtime diagnostics fallback，并固定包含 `Checkpoint Ledger` / `Blocker Drill-Down`，可直接作为 release gate review 的 canonical main-path handoff
3. `artifacts/release-readiness/cocos-rc-evidence-bundle-<candidate>-<short-sha>.json`
   - candidate-scoped bundle manifest，适合挂 CI artifact 或 PR 机器人
4. `artifacts/release-readiness/cocos-rc-evidence-bundle-<candidate>-<short-sha>.md`
   - 同一 bundle 的人类可读摘要，直接列出主链路 pass/fail/pending 状态
5. `artifacts/release-readiness/cocos-rc-snapshot-<candidate>-<short-sha>.json`
   - `npm run release:cocos-rc:snapshot` 生成并回填的结构化 RC 证据
6. `artifacts/release-readiness/cocos-main-journey-replay-gate-<candidate>-<short-sha>.json`
   - candidate-scoped main-journey evidence gate，固定校验 primary journey evidence、RC snapshot、bundle manifest、checklist、blockers 是否仍绑定同一 revision，并把 presentation blockers 与 infrastructure failures 分开汇总
7. `artifacts/release-readiness/cocos-main-journey-replay-gate-<candidate>-<short-sha>.md`
   - 对应 gate 的 reviewer 摘要，默认包含 `Reviewer Workflow`，用于在 PR / release issue 中快速判定这份 packet 是否还能作为主客户端主链路证据
8. `artifacts/release-readiness/cocos-rc-checklist-<candidate>-<short-sha>.md`
   - 从模板复制并预填 candidate / revision 的人工检查清单
9. `artifacts/release-readiness/cocos-rc-blockers-<candidate>-<short-sha>.md`
   - 从模板复制并预填 candidate / revision 的 blocker 记录

其中 5 是权威 machine-readable RC 记录，1/2 则是自动化 primary journey 的原始证据面，6/7 是 candidate-scoped main-journey 守门摘要，3/4/8/9 是 reviewer / release owner 快速扫读和留档的补充视图。不要为同一个 RC 另外发明独立格式。

在 release review 中，先读 `cocos-main-journey-replay-gate-<candidate>-<short-sha>.md` 里的 `Infrastructure Failures` / `Evidence Drift` / `Presentation Blockers`，再按需要展开 primary journey Markdown 的 `Blocker Drill-Down` 与 `Checkpoint Ledger`。只有当 reviewer 需要跨 surface 或同 candidate 聚合视图时，才继续展开 RC bundle / snapshot / checklist / blockers。

## 标准流程

1. 先跑自动化基线，并保留自动化快照：

```bash
npm run release:readiness:snapshot -- \
  --manual-checks docs/release-readiness-manual-checks.example.json
```

如需把额外的 Phase 1 布局一并纳入候选包证据，先补跑对应内容包与持久化验证：

```bash
npm run validate:content-pack:all
npm run test:phase1-release-persistence:frontier
```

若 reviewer 关注石岗分叉或岭桥布局，则改为 `npm run test:phase1-release-persistence:stonewatch` 或 `npm run test:phase1-release-persistence:ridgeway`；这些产出的 JSON 都应与同一份 candidate evidence bundle 一起归档。

2. 直接生成 candidate-level Cocos RC evidence bundle。该命令会自动先跑 primary journey evidence，再汇总成 RC snapshot：

```bash
npm run release:cocos-rc:bundle -- \
  --candidate rc-2026-03-29 \
  --build-surface creator_preview
```

3. 若目标面是微信小游戏，先完成 `verify` 与 `smoke`，再把 smoke 报告挂到同一份 bundle：

```bash
npm run release:cocos-rc:bundle -- \
  --candidate rc-2026-03-29 \
  --build-surface wechat_preview \
  --wechat-smoke-report artifacts/wechat-rc/codex.wechat.smoke-report.json \
  --release-readiness-snapshot artifacts/release-readiness/rc-2026-03-29.json
```

4. 回填 bundle 内的 snapshot 后执行校验：

```bash
npm run release:cocos-rc:snapshot -- \
  --output artifacts/release-readiness/cocos-rc-snapshot-rc-2026-03-29-<short-sha>.json \
  --check
```

5. 将 bundle 的 Markdown 摘要、checklist 与 blockers 文件附到 PR、release issue 或 CI artifact；它们已经由同一条命令生成，不需要额外复制模板。

## 快照结构

快照固定包含以下区块：

- `candidate`
  - 候选包名、分支、commit、构建面
- `execution`
  - 执行人、执行时间、最终状态、结论摘要
- `environment`
  - 服务端地址、Creator 版本、微信客户端/开发者工具版本、设备
- `linkedEvidence`
  - 自动化发布快照、微信 smoke 报告等外部证据引用
- `requiredEvidence`
  - 四个强制证据字段：`roomId`、`reconnectPrompt`、`restoredState`、`firstBattleResult`
- `journey`
  - 七个固定主链路节点：`lobby-entry`、`room-join`、`map-explore`、`first-battle`、`battle-settlement`、`reconnect-restore`、`return-to-world`
- `mappings`
  - Creator 预览观察项与 WeChat smoke 报告字段如何映射回同一份 RC 快照

## 必填与可选

必填字段：

- `execution.owner`
- `execution.executedAt`
- `execution.overallStatus`
- `execution.summary`
- `environment.server`
- `requiredEvidence.roomId`
- `requiredEvidence.reconnectPrompt`
- `requiredEvidence.restoredState`
- `requiredEvidence.firstBattleResult`
- 所有 `journey[*].status`
- 如存在 blocker，必须在配套 blocker 模板中写明 `severity`、`owner`、`next update`、`exit criteria`

可选补充：

- `environment.cocosCreatorVersion`
- `environment.wechatClient`
- `environment.device`
- `linkedEvidence.releaseReadinessSnapshot`
- `linkedEvidence.wechatSmokeReport`
- 任意截图、录屏、日志、artifact 路径

## 字段映射规则

同一份模板覆盖 Creator 预览与微信 RC，统一口径如下：

| 来源 | 回填位置 | 说明 |
| --- | --- | --- |
| `cocos-primary-journey-evidence` room join milestone | `requiredEvidence.roomId` | 自动回填权威 `roomId` |
| `cocos-primary-journey-evidence` reconnect milestone | `requiredEvidence.reconnectPrompt` | 自动回填 reconnect canonical prompt |
| `cocos-primary-journey-evidence` reconnect milestone | `requiredEvidence.restoredState` | 自动回填恢复后关键状态 |
| `cocos-primary-journey-evidence` settlement milestone | `requiredEvidence.firstBattleResult` | 自动回填首战胜负和关键结果 |
| `codex.wechat.smoke-report.json:cases[login-lobby]` | `journey[lobby-entry]` | 登录 / Lobby 结果直接复用 |
| `codex.wechat.smoke-report.json:cases[room-entry]` | `journey[room-join]` | 进房结果直接复用 |
| `codex.wechat.smoke-report.json:cases[reconnect-recovery]` | `journey[reconnect-restore]` + 三个恢复类证据字段 | 不能只写“恢复成功” |
| `codex.wechat.smoke-report.json:execution.summary` | `execution.summary` | 微信 RC 可复用 smoke 总结，但不会覆盖 primary journey 已记录的首战 / 恢复结构化证据 |

## 回填建议

Headless primary journey automation 默认补：

- 每个 milestone 一份 runtime diagnostics JSON
- 每个 stage 的 pass/fail、startedAt/completedAt、durationMs
- `roomId`、首战结算、恢复提示、恢复后状态四个结构化字段
- 一份可直接附到 PR / RC issue 的 Markdown 摘要

若 release owner 仍需 Creator 真机 / 预览截图，可把截图路径追加到同一份 bundle，而不是另起格式。

微信 RC 至少补：

- `codex.wechat.smoke-report.json`
- 真机或准真机截图 / 录屏
- 若有发布包，则附 artifact 目录或 `*.upload.json`
- 对应 RC checklist 中的设备、客户端版本、执行人和放行结论
- 对应 blocker 模板中的未关闭风险与是否允许带风险推进

## 样例

可直接复制并回填：

- JSON 样例：`docs/release-evidence/cocos-rc-snapshot.example.json`
- Markdown 检查清单：`docs/release-evidence/cocos-wechat-rc-checklist.template.md`
- Markdown blocker 模板：`docs/release-evidence/cocos-wechat-rc-blockers.template.md`
- 生成命令：

```bash
npm run release:cocos-rc:snapshot -- \
  --candidate rc-<date> \
  --build-surface creator_preview \
  --output artifacts/release-evidence/rc-<date>.json
```
