# WeChat Mini Game Build Checklist

- Build target: `wechatgame`
- Project name: `Project Veil`
- Build output dir: `build/wechatgame`
- Runtime remote URL: `http://127.0.0.1:2567`
- Main package budget: 4 MB
- Total subpackage budget: 30 MB
- Device orientation: `portrait`
- Remote asset root: 尚未配置

## Expected Subpackages
- 当前未在仓库配置显式分包计划；请在 Cocos Creator 中把目标 Asset Bundle 标为 Mini Game Subpackage。

## Domain Checklist
- request 合法域名: http://127.0.0.1:2567
- socket 合法域名: ws://127.0.0.1:2567
- uploadFile 合法域名: 尚未配置
- downloadFile 合法域名: 尚未配置

## Required Domain Origins
- request 运行时域名: http://127.0.0.1:2567
- socket 运行时域名: ws://127.0.0.1:2567
- uploadFile 运行时域名: 尚未配置
- downloadFile 运行时域名: 尚未配置

## Missing Domain Coverage
- 当前配置已覆盖已知 request/socket/downloadFile 域名。

## Follow-up
- 在 Cocos Creator 的微信小游戏构建目标中执行正式导出。
- 若资源需要分包，请把对应 Asset Bundle 的 Compression Type 设为 Mini Game Subpackage。
- 导出后运行 `npm run validate -- wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime` 校验注入配置与 4MB / 30MB 预算。
- 把远程资源目录上传到 CDN 后，再在微信开发者工具中补齐域名白名单。
- 如果需要增量资源发布，运行 `npm run release -- wechat:assets-hotfix -- --build-dir <wechatgame-build-dir>` 生成 hotfix manifest 并上传变更资源。
