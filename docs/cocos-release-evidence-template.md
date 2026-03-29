# Cocos Release Evidence Template

本模板现在以 `npm run release:cocos-rc:snapshot` 生成的 machine-readable JSON 为主，Markdown 只保留使用说明、字段规则和样例路径。目标是把 Cocos Creator 预览与微信小游戏 RC 的证据收口到同一份可归档、可校验、可对比的快照里。

相关文档：

- 核心玩法发布就绪总清单：`docs/core-gameplay-release-readiness.md`
- 发布就绪自动化快照：`docs/release-readiness-snapshot.md`
- 统一断线恢复门禁：`docs/reconnect-smoke-gate.md`
- 微信小游戏构建 / 打包 / 验收：`docs/wechat-minigame-release.md`
- 样例快照：`docs/release-evidence/cocos-rc-snapshot.example.json`

## 标准流程

1. 先跑自动化基线，并保留自动化快照：

```bash
npm run release:readiness:snapshot -- \
  --manual-checks docs/release-readiness-manual-checks.example.json
```

2. 生成一份 Cocos RC 快照模板：

```bash
npm run release:cocos-rc:snapshot -- \
  --candidate rc-2026-03-29 \
  --build-surface creator_preview \
  --output artifacts/release-evidence/rc-2026-03-29.creator.json
```

3. 若目标面是微信小游戏，先完成 `verify` 与 `smoke`，再把 smoke 报告挂到同一份 RC 快照：

```bash
npm run release:cocos-rc:snapshot -- \
  --candidate rc-2026-03-29 \
  --build-surface wechat_preview \
  --wechat-smoke-report artifacts/wechat-rc/codex.wechat.smoke-report.json \
  --release-readiness-snapshot artifacts/release-readiness/rc-2026-03-29.json \
  --output artifacts/release-evidence/rc-2026-03-29.wechat.json
```

4. 回填后执行校验：

```bash
npm run release:cocos-rc:snapshot -- \
  --output artifacts/release-evidence/rc-2026-03-29.creator.json \
  --check
```

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
  - 六个固定主链路节点：`lobby-entry`、`room-join`、`map-explore`、`first-battle`、`reconnect-restore`、`return-to-world`
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
| Creator HUD / Session 文本 | `requiredEvidence.roomId` | 必须能看到权威 `roomId` |
| Creator 恢复提示 | `requiredEvidence.reconnectPrompt` | 必须复用 reconnect canonical scenario |
| Creator 恢复后 HUD / 世界态 | `requiredEvidence.restoredState` | 必须说明恢复后关键状态未回档 |
| Creator 首战结算面板 | `requiredEvidence.firstBattleResult` | 必须说明首战胜负和关键结果 |
| `codex.wechat.smoke-report.json:cases[login-lobby]` | `journey[lobby-entry]` | 登录 / Lobby 结果直接复用 |
| `codex.wechat.smoke-report.json:cases[room-entry]` | `journey[room-join]` | 进房结果直接复用 |
| `codex.wechat.smoke-report.json:cases[reconnect-recovery]` | `journey[reconnect-restore]` + 三个恢复类证据字段 | 不能只写“恢复成功” |
| `codex.wechat.smoke-report.json:execution.summary` | `execution.summary` | 微信 RC 可复用 smoke 总结，但仍需补齐首战与返回世界 |

## 回填建议

Creator 预览至少补：

- 1 张 Lobby 截图
- 1 张房间/HUD 截图，必须能看见 `roomId`
- 1 张首战结算截图或录屏片段
- 1 张恢复后截图，必须能看见恢复提示和关键状态

微信 RC 至少补：

- `codex.wechat.smoke-report.json`
- 真机或准真机截图 / 录屏
- 若有发布包，则附 artifact 目录或 `*.upload.json`

## 样例

可直接复制并回填：

- JSON 样例：`docs/release-evidence/cocos-rc-snapshot.example.json`
- 生成命令：

```bash
npm run release:cocos-rc:snapshot -- \
  --candidate rc-<date> \
  --build-surface creator_preview \
  --output artifacts/release-evidence/rc-<date>.json
```
