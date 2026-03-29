# 微信小游戏构建校验与发布说明

## 自动化边界

- CI 入口：GitHub Actions `wechat-build-validation`
- 执行命令：`npm run check:wechat-build`
- 当前自动化会做三件事：
  - 校验 `apps/cocos-client/wechat-minigame.build.json` 生成出的模板产物是否已经提交且未漂移
  - 校验 `apps/cocos-client/build-templates/wechatgame/` 中必需文件是否齐全
  - 通过仓库内导出夹具校验注入配置、运行时 bootstrap 文件、主包 / 分包预算，以及运行时域名白名单缺口告警
- 当前自动化额外会校验一份确定性的发布元数据：`codex.wechat.release.json`
  - 清单内包含导出目录文件列表、字节数、SHA-256、主包 / 分包体积汇总，以及可选的源码 revision 标识
- 当前自动化可把已校验导出目录打成确定性的 `tar.gz` 发布包，并输出 sidecar 元数据 `codex.wechat.package.json`
  - sidecar 会记录归档文件名、SHA-256、字节数、导出目录来源，以及归档内文件清单摘要
- CI 会把上述归档与 sidecar 元数据作为 GitHub Actions artifact `wechat-release-<sha>` 上传，供提审前下载、留档与回滚追溯
- CI 额外会把刚上传的 artifact 再下载一次，并运行 `npm run verify:wechat-release` 做 artifact 级 smoke 验收
- GitHub Actions 现支持在 `workflow_dispatch` 时显式开启 `upload`，或推送 `wechat-release-<version>` tag 后自动执行 `miniprogram-ci` 上传
  - 上传前仍会保留 `verify:wechat-release` smoke 验收
  - 若仓库未配置微信上传 secret，上传 job 会在 summary 中记录 skipped，而不会让 workflow 失败
  - 上传成功后会生成额外 sidecar `*.upload.json`，记录版本号、commit、上传时间和微信回执摘要

## 本地执行

- 刷新模板：`npm run prepare:wechat-build`
- 生成发布元数据：`npm run prepare:wechat-release -- --output-dir <wechatgame-build-dir> --expect-exported-runtime [--source-revision <git-sha>]`
- 产出发布归档：`npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime [--source-revision <git-sha>]`
- 上传已打包产物：`npm run upload:wechat-release -- --artifacts-dir <release-artifacts-dir> --version <wechat-version> [--desc <upload-desc>]`
- 按 SHA 下载 CI artifact：`npm run download:wechat-release -- --sha <git-sha> [--output-dir artifacts/downloaded/wechat-release-<git-sha>]`
- 验收已下载 artifact：`npm run verify:wechat-release -- --artifacts-dir <downloaded-artifact-dir> [--expected-revision <git-sha>]`
- 生成 / 校验真机冒烟报告：`npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir> [--report <report-path>] [--check --expected-revision <git-sha>]`
- 统一断线恢复门禁：`docs/reconnect-smoke-gate.md`
- 统一 Cocos RC 证据快照：`npm run release:cocos-rc:snapshot`
- RC 检查清单模板：`docs/release-evidence/cocos-wechat-rc-checklist.template.md`
- RC blocker 模板：`docs/release-evidence/cocos-wechat-rc-blockers.template.md`
- 只做 CI 同款校验：`npm run check:wechat-build`
- 校验真实导出目录：`npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`

## 上传凭据

- GitHub Actions secrets：
  - `WECHAT_MINIPROGRAM_APPID`：目标小游戏 appid
  - `WECHAT_MINIPROGRAM_PRIVATE_KEY`：微信开放平台下载的 PEM 私钥原文
  - `WECHAT_MINIPROGRAM_PRIVATE_KEY_BASE64`：若不方便直接存多行 PEM，可改存 base64；与上项二选一
- 本地环境变量：
  - `WECHAT_MINIPROGRAM_APPID`
  - `WECHAT_MINIPROGRAM_PRIVATE_KEY` 或 `WECHAT_MINIPROGRAM_PRIVATE_KEY_BASE64`
  - 可选：`WECHAT_MINIPROGRAM_VERSION`、`WECHAT_MINIPROGRAM_DESC`、`WECHAT_MINIPROGRAM_ROBOT`
- 也可通过 CLI 传参覆盖：
  - `--appid <appid>`
  - `--private-key-path <pem-path>`
  - `--version <wechat-version>`
  - `--desc <upload-desc>`
  - `--robot <robot-id>`

## 发布步骤

1. 先更新 `apps/cocos-client/wechat-minigame.build.json` 中的 `appid`、远程资源地址、预算和域名清单。
2. 运行 `npm run prepare:wechat-build`，确认 `apps/cocos-client/build-templates/wechatgame/` 产物已更新。
3. 在 Cocos Creator 中执行 `wechatgame` 正式导出，并把模板目录内容合入导出目录。
4. 对真实导出目录执行 `npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`。
5. 运行 `npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime [--source-revision <git-sha>]`，生成包含 `codex.wechat.release.json` 的归档包与 sidecar 元数据。
6. 运行 `npm run verify:wechat-release -- --artifacts-dir <release-artifacts-dir> [--expected-revision <git-sha>]`，在上传前先做一次本地 artifact 级冒烟验收。
7. 运行 `npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir>` 生成 `codex.wechat.smoke-report.json` 模板，并在真机或准真机上逐项填写结果。
8. 完成真机 / 准真机冒烟后，执行 `npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir> --check [--expected-revision <git-sha>]`，确认登录、进房、重连、分享回流、关键资源加载都已有结果记录。
   - `reconnect-recovery` 必须复用 [`docs/reconnect-smoke-gate.md`](/home/gpt/project/ProjectVeil/.worktrees/issue-203/docs/reconnect-smoke-gate.md) 的 canonical scenario、最小成功信号和失败诊断口径。
9. 运行 `npm run release:cocos-rc:snapshot -- --candidate <candidate-name> --build-surface wechat_preview --wechat-smoke-report <release-artifacts-dir>/codex.wechat.smoke-report.json --output artifacts/release-evidence/<candidate-name>.wechat.json`，把微信 smoke 结果映射回统一的 Cocos RC 快照，并补齐首战 / 返回世界证据。
10. 复制 `docs/release-evidence/cocos-wechat-rc-checklist.template.md` 与 `docs/release-evidence/cocos-wechat-rc-blockers.template.md`，为当前 candidate 回填设备、结论和 blocker。
11. 运行 `npm run upload:wechat-release -- --artifacts-dir <release-artifacts-dir> --version <wechat-version> [--desc <upload-desc>]`，脚本会先复用 `verify:wechat-release` 验收，再调用 `miniprogram-ci` 上传，并在 artifact 目录旁写入 `*.upload.json` 回执。
12. 将远程资源上传到 CDN，并在微信后台 / 开发者工具中完成提审。

## 下载与验收

给定某次构建 SHA，可用以下方式标准化下载并验收对应发布包：

1. 下载 artifact：`npm run download:wechat-release -- --sha <git-sha>`
2. 复核 sidecar、release manifest 与 smoke 清单：`npm run verify:wechat-release -- --artifacts-dir artifacts/downloaded/wechat-release-<git-sha> --expected-revision <git-sha>`
3. 生成真机冒烟模板：`npm run smoke:wechat-release -- --artifacts-dir artifacts/downloaded/wechat-release-<git-sha>`
4. 完成真机 / 准真机检查后校验结果：`npm run smoke:wechat-release -- --artifacts-dir artifacts/downloaded/wechat-release-<git-sha> --check --expected-revision <git-sha>`
5. 如需直接提审上传，可执行 `npm run upload:wechat-release -- --artifacts-dir artifacts/downloaded/wechat-release-<git-sha> --version <wechat-version>`

`verify:wechat-release` 默认会完成以下检查：

- sidecar 中记录的归档文件名、字节数、SHA-256 是否与下载产物一致
- `codex.wechat.release.json` 是否存在，且 `sourceRevision` 与 sidecar / 目标 revision 一致
- `game.json`、`project.config.json`、`codex.wechat.build.json`、`README.codex.md`、`game.js`、`application.js`、`src/settings.json` 是否齐全
- release manifest 中记录的文件列表、字节数、SHA-256 是否与归档内真实内容一致
- `project.config.json` / `codex.wechat.build.json` 是否仍指向微信小游戏构建

## 提审前 Smoke Check

`npm run smoke:wechat-release` 会生成 `codex.wechat.smoke-report.json`，默认与 release artifact 放在同一目录。该文件是提审前必须保留的最小验收记录，建议直接随 artifact 归档保存。

最小必填项如下：

- `login-lobby`：验证微信小游戏登录或游客降级后能进入 Lobby，并记录首屏异常
- `room-entry`：验证从 Lobby 创建 / 加入房间成功
- `reconnect-recovery`：验证断网、切后台或网络切换后的自动重连 / 恢复
- `share-roundtrip`：验证分享链路与回流后房间号 / 邀请参数恢复
- `key-assets`：验证首屏、Lobby、房间或首场战斗关键资源加载无白名单 / 缺图 / 404

推荐执行方式：

1. 先跑 `npm run verify:wechat-release -- --artifacts-dir <release-artifacts-dir> [--expected-revision <git-sha>]`
2. 再跑 `npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir>` 生成模板
3. 在真机或微信开发者工具真机调试模式中逐项填写 `tester`、`device`、`executedAt`、`summary` 以及每个 case 的 `status` / `notes` / `evidence`
   - `reconnect-recovery` 至少要记录原 `roomId`、恢复提示、恢复后未回档状态三项证据；细则见 [`docs/reconnect-smoke-gate.md`](/home/gpt/project/ProjectVeil/.worktrees/issue-203/docs/reconnect-smoke-gate.md)
4. 回填完成后执行 `npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir> --check [--expected-revision <git-sha>]`
5. 再执行 `npm run release:cocos-rc:snapshot -- --candidate <candidate-name> --build-surface wechat_preview --wechat-smoke-report <release-artifacts-dir>/codex.wechat.smoke-report.json --output artifacts/release-evidence/<candidate-name>.wechat.json`，把 `login-lobby`、`room-entry`、`reconnect-recovery` 映射到统一 RC 快照，并补齐 `firstBattleResult` 与 `return-to-world` 证据。
6. 复制并回填 `docs/release-evidence/cocos-wechat-rc-checklist.template.md` 与 `docs/release-evidence/cocos-wechat-rc-blockers.template.md`，确保 reviewer 能直接看到当前 RC 的设备、结论与未关闭风险。

若某项因当前包能力受限无法完整验证，可把 case 标记为 `not_applicable`，并在 `notes` 中写明原因与替代观察证据；其余必填项不得保留 `pending`。若因此形成风险，必须同步写入 blocker 模板，而不是只留在 smoke report 备注里。

## 回滚演练

以下步骤用于演练如何恢复到某个历史 revision，对应 issue #141 的“可下载、可回退、可追溯”目标：

1. 选择目标 revision：确认要恢复的 Git SHA，例如 `<rollback-sha>`。
2. 下载历史包：`npm run download:wechat-release -- --sha <rollback-sha> --output-dir artifacts/rollback/<rollback-sha>`
3. 验证历史包：`npm run verify:wechat-release -- --artifacts-dir artifacts/rollback/<rollback-sha> --expected-revision <rollback-sha>`
4. 解压并恢复构建目录：`tar -xzf artifacts/rollback/<rollback-sha>/*.tar.gz -C artifacts/rollback/<rollback-sha>/extracted`
5. 切换远程资源：把 CDN 指向该历史包对应的资源版本，或同步恢复其资源目录快照。
6. 在微信开发者工具中导入 `artifacts/rollback/<rollback-sha>/extracted/<package-name>/wechatgame`，确认能启动并完成最小 smoke check。
7. 记录演练结果：保存使用的 SHA、artifact 名称、验收结果和恢复时间，确保后续回滚步骤不依赖人工记忆。

- 构建模板或配置回滚：回退 `apps/cocos-client/wechat-minigame.build.json` 与 `apps/cocos-client/build-templates/wechatgame/`
- CI 导出夹具回滚：若只是校验夹具与脚本演进不一致，可同步回退 `apps/cocos-client/test/fixtures/wechatgame-export/`
- CDN 资源回滚：切回上一个静态资源目录版本
- 小游戏包回滚：在微信开发者工具 / 平台侧重新上传上一个已验证通过的构建目录

当前仓库默认仍不会在 `main` 分支 push 上自动上传；只有手动 `workflow_dispatch` 显式开启 `upload`，或推送 `wechat-release-<version>` tag 时，才会尝试调用微信上传接口。
