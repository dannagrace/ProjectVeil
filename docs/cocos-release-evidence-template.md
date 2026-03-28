# Cocos Release Evidence Template

本模板用于每次 `apps/cocos-client` release candidate 的统一验收留档。目标不是重复写发布说明，而是把每个必过门禁对应到一条可复用的“命令证据或人工证据”记录，避免不同候选包的证明口径漂移。

适用场景：

- Cocos Creator Web 预览候选包
- 微信小游戏导出、预览、提审候选包
- 任何需要证明 `Lobby -> 进房 -> 首场战斗 -> 重连恢复 -> 返回世界` 主链路可用的 release candidate

相关文档：

- 核心玩法发布就绪总清单：`docs/core-gameplay-release-readiness.md`
- 统一断线恢复门禁：`docs/reconnect-smoke-gate.md`
- 微信小游戏构建 / 打包 / 验收：`docs/wechat-minigame-release.md`
- Cocos 主客户端运行说明：`apps/cocos-client/README.md`

## 使用规则

1. 每个 release candidate 复制一份本模板，建议命名为 `docs/release-evidence/cocos-release-evidence-<yyyymmdd>-<candidate>.md`。
2. 所有门禁都必须填写 `Owner / Date / Status / Evidence`。
3. `Status` 只允许使用：`pass / partial / fail / n/a`。
4. 有自动化命令时，优先附命令、结果摘要和产物路径。
5. 自动化无法覆盖 Cocos 真机 / headed 场景时，必须补人工证据，不得只写“手工验证通过”。
6. 只要任一 `P0` 为 `fail`，该候选包不能视为发布就绪。

## Candidate Header

将以下头部复制到每次候选包记录中并回填：

```md
# Cocos Release Evidence - <candidate-name>

- Candidate: `<candidate-name>`
- Scope: `apps/cocos-client`
- Branch / Commit: `<branch>` / `<git-sha>`
- Build Surface: `Creator Web Preview | WeChat Preview | WeChat Upload Candidate | Other`
- Owner: `<name>`
- Date: `<YYYY-MM-DD>`
- Overall Status: `pass | partial | fail | n/a`
- Runtime / Env:
  - Server: `<local/staging URL>`
  - Cocos Creator: `<3.8.x version>` or `n/a`
  - WeChat DevTools / Device: `<version / device>` or `n/a`
- Notes: `<candidate summary / known risk / linked issue>`
```

## Evidence Attachment Rules

### Cocos Creator Preview Required

当 Web 自动化不能证明 Cocos 表现层时，至少附以下任意两类证据，且必须包含一条视觉证据：

- Cocos Creator 预览窗口截图或短录屏
- Console / HUD / Timeline 的关键文本截图，能看出房间号、玩家身份、战斗结果或恢复提示
- 预览使用的场景、Inspector 配置、`remoteUrl`、`roomId`、`playerId` 记录
- 若涉及音频、动画或 Tilemap，只写“观察正常”不够，需要补截图、录屏或 Creator 面板状态截图

建议在记录中直接写：

```md
- Evidence:
  - `Creator preview screenshot: <path-or-link>`
  - `Creator preview video: <path-or-link>`
  - `Scene: VeilRoot in <scene-name>`
  - `Runtime config: remoteUrl=<...> roomId=<...> playerId=<...>`
```

### WeChat Preview Required

当门禁必须在微信开发者工具、真机或准真机完成时，至少附以下证据：

- `codex.wechat.smoke-report.json` 路径
- 微信开发者工具预览截图、真机录屏或分享回流截图
- 开发者工具 `Console / Network / 安全域名` 相关告警截图或说明
- 使用的 artifact 目录、`sourceRevision`、`archiveSha256` 或上传回执 `*.upload.json`

建议顺序：

1. 先按 `docs/wechat-minigame-release.md` 跑 `verify`。
2. 再生成并回填 `codex.wechat.smoke-report.json`。
3. 最后把真机 / 准真机截图、录屏、分享回流结果附到对应 evidence 字段。

## Baseline Gate

这些命令不直接替代主链路证据，但每次候选包都应先记录：

| Gate | Priority | Command / Proof | Expected Result | Owner | Date | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shared / Server / Client baseline | P0 | `npm run typecheck:ci` | 全量 typecheck 通过 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<log path or CI URL>` | `<notes>` |
| Unit + contract baseline | P0 | `npm test` | shared/server/H5/Cocos 单测通过 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<log path or CI URL>` | `<notes>` |
| H5 smoke reference | P1 | `npm run test:e2e:smoke` | H5 lobby / battle / reconnect 基线通过 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<Playwright artifact>` | `只作为 Cocos 发布参考，不替代 Cocos 人工证据` |
| Multiplayer smoke reference | P1 | `npm run test:e2e:multiplayer:smoke` | 多人 / PvP / 结算恢复基线通过 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<Playwright artifact>` | `用于对照状态收敛与结算回写` |

## Required Release Gates

以下五项是每次 Cocos 候选包必须留存的最小证据。若同一条证据同时覆盖多项，可交叉引用，但每一行都必须单独填状态。

| Gate | Priority | Automated Command Reference | Manual Proof Steps | Required Evidence | Owner | Date | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lobby entry | P0 | `npm run test:e2e:smoke`（覆盖 `tests/e2e/lobby-smoke.spec.ts`）；`npm test`（覆盖 `apps/cocos-client/test/cocos-lobby.test.ts`） | 在 Cocos Creator 预览或微信预览中冷启动；确认先进入 Lobby；记录大厅标题、玩家身份态、活跃房间列表或错误提示；若使用账号态，记录登录 ID / 游客降级情况 | 至少 1 张 Lobby 截图；若需 Creator/WeChat 预览，再补预览窗口或真机录屏 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<paths/links>` | `<notes>` |
| Room join | P0 | `npm run test:e2e:smoke`（`tests/e2e/lobby-smoke.spec.ts`）；`npm test`（`apps/server/test/lobby-routes.test.ts`、`apps/cocos-client/test/cocos-session-launch.test.ts`） | 从 Lobby 创建或加入房间；确认房间号、玩家 ID、HUD 基础状态、地图已加载；如依赖 staging 服务，写明 `remoteUrl` 与房间号 | 房间内 HUD / session 信息截图，能看见 `roomId` 和玩家身份 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<paths/links>` | `<notes>` |
| First battle | P0 | `npm run test:e2e:smoke`（`tests/e2e/battle-flow.spec.ts`）；`npm test`（`apps/cocos-client/test/cocos-battle-feedback.test.ts`、`apps/cocos-client/test/cocos-battle-panel-model.test.ts`、`apps/cocos-client/test/cocos-battle-report.test.ts`） | 从房间进入首场遭遇战；至少执行一场完整结算；记录进入战斗、攻击/等待/防御反馈、胜败弹窗、奖励或伤害结果 | 战斗中截图 + 结算截图；若自动化不足，补 Creator/WeChat 录屏证明输入到结算完整闭环 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<paths/links>` | `<notes>` |
| Reconnect / session restore | P0 | `npm run test:e2e:smoke`（`tests/e2e/reconnect-recovery.spec.ts`）；`npm run test:e2e:multiplayer:smoke`（`tests/e2e/pvp-reconnect-recovery.spec.ts`、`tests/e2e/pvp-postbattle-reconnect.spec.ts`）；`npm test`（`apps/client/test/reconnection-storage.test.ts`、`apps/server/test/colyseus-persistence-recovery.test.ts`、`apps/cocos-client/test/cocos-runtime-memory.test.ts`） | 按 [`docs/reconnect-smoke-gate.md`](/home/gpt/project/ProjectVeil/.worktrees/issue-203/docs/reconnect-smoke-gate.md) 的 canonical scenario 执行一次恢复；在房间或战斗后主动刷新、切后台、断网或切换网络；确认恢复到原房间并显示可接受的恢复提示；记录是否丢失房间上下文、战斗状态或奖励结果 | 恢复后截图，必须能看见恢复提示、原房间号和关键状态未丢失；微信预览时附 `codex.wechat.smoke-report.json` 对应 case | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<paths/links>` | `失败时按 reconnect gate 文档附诊断项，不要只写“恢复失败”` |
| Return to world | P0 | `npm run test:e2e:multiplayer:smoke`（`tests/e2e/pvp-postbattle-reconnect.spec.ts`、`tests/e2e/pvp-postbattle-continue.spec.ts`）；`npm test`（`apps/cocos-client/test/cocos-map-visuals.test.ts`、`apps/cocos-client/test/cocos-battle-transition-copy.test.ts`） | 首场战斗结算后确认房间已回到世界探索态；`No active battle`、地图/HUD 可继续交互，且结算已回写；若胜者仍可行动或败者移动归零，也一并记录 | 战后返回地图截图，需能看见世界 HUD、结算摘要或 `No active battle`；如需 headed 证明，补录屏展示“战斗结束 -> 回到世界”全过程 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<paths/links>` | `<notes>` |

## WeChat-Specific Gate

若候选包目标面是微信小游戏，以下三项必须附加记录：

| Gate | Priority | Command / Proof | Expected Result | Owner | Date | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WeChat build validation | P0 | `npm run check:wechat-build` | 模板、导出夹具、release metadata 校验通过 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<log path or CI URL>` | `<notes>` |
| Exported runtime validation | P0 | `npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime` | 真实导出目录通过 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<log path>` | `<notes>` |
| Artifact verify + smoke report | P0 | `npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime --source-revision <git-sha>`；`npm run verify:wechat-release -- --artifacts-dir <release-artifacts-dir> --expected-revision <git-sha>`；`npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir>`；回填后执行 `npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir> --check --expected-revision <git-sha>` | 归档、sidecar、release manifest、真机 smoke 报告全部可追溯 | `<owner>` | `<date>` | `pass/partial/fail/n/a` | `<artifact dir / smoke-report / screenshots / upload receipt>` | `若用开发者工具预览或真机，需补截图或录屏，不可只留 JSON` |

## Manual Proof Checklist

以下清单可直接贴到候选包文档末尾，补齐人工观察项：

```md
## Manual Proof Notes

- Candidate: `<candidate-name>`
- Owner: `<name>`
- Date: `<YYYY-MM-DD>`
- Runtime: `Creator Preview | WeChat DevTools | WeChat Device`

- [ ] Lobby entry
  - 观察结果：`<text>`
  - 证据：`<path-or-link>`
- [ ] Room join
  - 观察结果：`<text>`
  - 证据：`<path-or-link>`
- [ ] First battle
  - 观察结果：`<text>`
  - 证据：`<path-or-link>`
- [ ] Reconnect / session restore
  - 观察结果：`<text>`
  - 证据：`<path-or-link>`
- [ ] Return to world
  - 观察结果：`<text>`
  - 证据：`<path-or-link>`
```

## Release Decision

最终结论建议固定写成以下格式：

```md
## Release Decision

- Owner: `<name>`
- Date: `<YYYY-MM-DD>`
- Final Status: `pass | partial | fail`
- Blocking Issues:
  - `<issue-or-none>`
- Follow-ups:
  - `<issue-or-none>`
- Evidence Index:
  - `<artifact / screenshot bundle / smoke report / PR / CI run>`
```
