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
  - 当前只生成和校验元数据，不在 CI 中打包 zip 或上传微信后台

## 本地执行

- 刷新模板：`npm run prepare:wechat-build`
- 生成发布元数据：`npm run prepare:wechat-release -- --output-dir <wechatgame-build-dir> --expect-exported-runtime [--source-revision <git-sha>]`
- 只做 CI 同款校验：`npm run check:wechat-build`
- 校验真实导出目录：`npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`

## 发布步骤

1. 先更新 `apps/cocos-client/wechat-minigame.build.json` 中的 `appid`、远程资源地址、预算和域名清单。
2. 运行 `npm run prepare:wechat-build`，确认 `apps/cocos-client/build-templates/wechatgame/` 产物已更新。
3. 在 Cocos Creator 中执行 `wechatgame` 正式导出，并把模板目录内容合入导出目录。
4. 对真实导出目录执行 `npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`。
5. 运行 `npm run prepare:wechat-release -- --output-dir <wechatgame-build-dir> --expect-exported-runtime [--source-revision <git-sha>]`，生成 `codex.wechat.release.json` 供提审留档与后续比对。
6. 将远程资源上传到 CDN，在微信开发者工具中导入构建目录并完成人工 smoke check。

## Smoke Check

- 能正常启动到 Lobby / 首屏
- `wx` 登录链路或游客降级链路可用
- 与 `runtimeRemoteUrl` 对应的请求 / socket 域名无白名单报错
- 关键远程资源可加载，首轮进入房间或战斗不出现缺图 / 缺配置

## 回滚

- 构建模板或配置回滚：回退 `apps/cocos-client/wechat-minigame.build.json` 与 `apps/cocos-client/build-templates/wechatgame/`
- CI 导出夹具回滚：若只是校验夹具与脚本演进不一致，可同步回退 `apps/cocos-client/test/fixtures/wechatgame-export/`
- CDN 资源回滚：切回上一个静态资源目录版本
- 小游戏包回滚：在微信开发者工具 / 平台侧重新上传上一个已验证通过的构建目录

当前仓库未接入微信发布凭据，也不在 CI 中直连微信上传接口；正式提审和回滚发布仍保持人工执行。
