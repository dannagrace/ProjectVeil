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
  - 当前仍不在 CI 中直连微信上传接口；提审上传继续人工执行

## 本地执行

- 刷新模板：`npm run prepare:wechat-build`
- 生成发布元数据：`npm run prepare:wechat-release -- --output-dir <wechatgame-build-dir> --expect-exported-runtime [--source-revision <git-sha>]`
- 产出发布归档：`npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime [--source-revision <git-sha>]`
- 按 SHA 下载 CI artifact：`npm run download:wechat-release -- --sha <git-sha> [--output-dir artifacts/downloaded/wechat-release-<git-sha>]`
- 验收已下载 artifact：`npm run verify:wechat-release -- --artifacts-dir <downloaded-artifact-dir> [--expected-revision <git-sha>]`
- 只做 CI 同款校验：`npm run check:wechat-build`
- 校验真实导出目录：`npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`

## 发布步骤

1. 先更新 `apps/cocos-client/wechat-minigame.build.json` 中的 `appid`、远程资源地址、预算和域名清单。
2. 运行 `npm run prepare:wechat-build`，确认 `apps/cocos-client/build-templates/wechatgame/` 产物已更新。
3. 在 Cocos Creator 中执行 `wechatgame` 正式导出，并把模板目录内容合入导出目录。
4. 对真实导出目录执行 `npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`。
5. 运行 `npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime [--source-revision <git-sha>]`，生成包含 `codex.wechat.release.json` 的归档包与 sidecar 元数据。
6. 运行 `npm run verify:wechat-release -- --artifacts-dir <release-artifacts-dir> [--expected-revision <git-sha>]`，在上传前先做一次本地 artifact 级冒烟验收。
7. 将远程资源上传到 CDN，在微信开发者工具中导入归档解压后的构建目录并完成人工 smoke check。

## 下载与验收

给定某次构建 SHA，可用以下方式标准化下载并验收对应发布包：

1. 下载 artifact：`npm run download:wechat-release -- --sha <git-sha>`
2. 复核 sidecar、release manifest 与 smoke 清单：`npm run verify:wechat-release -- --artifacts-dir artifacts/downloaded/wechat-release-<git-sha> --expected-revision <git-sha>`
3. 通过后再解压归档并导入微信开发者工具，执行人工提审前检查

`verify:wechat-release` 默认会完成以下检查：

- sidecar 中记录的归档文件名、字节数、SHA-256 是否与下载产物一致
- `codex.wechat.release.json` 是否存在，且 `sourceRevision` 与 sidecar / 目标 revision 一致
- `game.json`、`project.config.json`、`codex.wechat.build.json`、`README.codex.md`、`game.js`、`application.js`、`src/settings.json` 是否齐全
- release manifest 中记录的文件列表、字节数、SHA-256 是否与归档内真实内容一致
- `project.config.json` / `codex.wechat.build.json` 是否仍指向微信小游戏构建

## 提审前 Smoke Check

- artifact 验收脚本通过，无 sidecar / manifest / revision 漂移
- 能正常启动到 Lobby / 首屏
- `wx` 登录链路或游客降级链路可用
- 与 `runtimeRemoteUrl` 对应的请求 / socket 域名无白名单报错
- 关键远程资源可加载，首轮进入房间或战斗不出现缺图 / 缺配置

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

当前仓库未接入微信发布凭据，也不在 CI 中直连微信上传接口；正式提审和回滚发布仍保持人工执行。
