# 微信小游戏适配脚手架

这个文档对应 issue #30 的一个收敛切片：先把“可提交、可校验、可继续扩展”的小游戏构建脚手架落到仓库里，而不是现在就宣称已经完成微信小游戏发布。

本轮只覆盖三件事：

1. 明确一份仓库内的小游戏构建/发布占位配置：`configs/wechat-mini-game-scaffold.json`
2. 用代码校验这份配置的关键约束：`npm run validate:wechat`
3. 把它和现有 Cocos 运行时/`wx.login()` mock 脚手架对齐，避免后续接入时重新讨论基础字段

## 当前脚手架包含什么

`configs/wechat-mini-game-scaffold.json` 当前锁住了这些基础字段：

- `platform`
  - 固定为 `wechat-game`
- `creatorVersion`
  - 当前 Cocos Creator 工程版本，便于后续导出小游戏工程时对齐
- `appId`
  - 当前先保留占位值 `wx-your-app-id`
- `envVersion`
  - 微信提审环境位：`develop / trial / release`
- `mainPackageBudgetMB`
  - 主包预算，当前明确要求 `< 4`
- `preloadBundles`
  - 计划保留在主包里的 bundle 名单
- `remoteBundles`
  - 计划切到远程/CDN 的 bundle 名单
- `assetCdnBaseUrl`
  - 远程资源 CDN 根地址，当前要求 `https://`
- `loginExchangePath`
  - 对接现有服务端小游戏登录交换脚手架，默认 `/api/auth/wechat-mini-game-login`
- `socketDomains`
  - 微信小游戏 `wss://` 安全域名白名单
- `requestDomains`
  - 微信小游戏 `https://` 请求/资源域名白名单

## 校验规则

`npm run validate:wechat` 会做以下检查：

- 主包预算必须小于 4MB
- 远程资源 CDN 必须是 HTTPS
- WebSocket 安全域名必须是 WSS origin
- 请求域名必须是 HTTPS origin
- `preloadBundles` 和 `remoteBundles` 不能重叠
- `loginExchangePath` 必须是绝对路径

另外会给出两个非阻断提醒：

- `appId` 仍是占位值
- `notes` 为空

这两个提醒不会让校验失败，目的是允许脚手架先合并，再在真实提审前补齐。

## 和现有代码的关系

仓库里已经有两层更早落地的基础：

- `apps/cocos-client/assets/scripts/cocos-runtime-platform.ts`
  - 识别 `wechat-game` 运行时，并读取 `wx.getLaunchOptionsSync().query`
- `apps/cocos-client/assets/scripts/cocos-login-provider.ts`
  - 暴露 `wechat-mini-game` 登录入口，并可对接 `wx.login()` 或 mock code
- `apps/server/src/auth.ts`
  - 暴露 `POST /api/auth/wechat-mini-game-login` 开发脚手架

这次新增的配置文件不是替代这些代码，而是把“小游戏构建和域名约束”单独沉淀成一份可审查、可验证的仓库基线。

## 本轮明确不做

以下内容仍然不在本次提交范围内：

- Cocos Creator 真正的微信小游戏导出工程
- 真实 `wx.login() -> code2Session -> openid/unionid` 生产链路
- OpenID 绑定现有账号体系
- 真机性能/内存优化
- 纹理压缩与资源分包的实际导出策略

所以这次 PR 应该被理解为 issue #30 的基础配置切片，而不是“小游戏适配完成”。
