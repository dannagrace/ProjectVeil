# 账号鉴权、正式注册与密码找回

本文档描述当前仓库已经落地的正式账号能力，以及 `#124` 和 `#140` 已接上的正式注册 / 密码找回前后端闭环。游客升级、全新正式注册、密码找回与会话撤销之间的迁移契约，另见 `docs/account-migration-rules.md`。

## 当前已落地能力

- 游客登录：`POST /api/auth/guest-login`
- 游客档升级成口令账号：`POST /api/auth/account-bind`
- 口令账号登录：`POST /api/auth/account-login`
- 会话校验 / 刷新 / 退出：`GET /api/auth/session`、`POST /api/auth/refresh`、`POST /api/auth/logout`
- 正式账号设备会话列表 / 撤销：`GET /api/player-accounts/me/sessions`、`DELETE /api/player-accounts/me/sessions/:sessionId`
- 已登录账号修改口令：`PUT /api/player-accounts/me`
- 迁移规则与边界场景说明：`docs/account-migration-rules.md`

当前账号模式仍沿用“先游客、再绑定”的模型：

1. 玩家可先以游客身份进入房间并形成 `player_accounts` 档案。
2. 需要长期登录时，再把当前游客档绑定到 `loginId + password`。
3. 后续账号登录会继续复用同一份英雄长期档、全局资源仓库和账号事件历史。

## 设备会话管理

- 正式账号登录后，服务端会为每个刷新令牌族持久化一条设备会话记录，包含 `sessionId`、最近活跃时间、刷新令牌到期时间以及一个最小设备标签（当前取自请求 `User-Agent`）。
- `GET /api/player-accounts/me/sessions` 只返回当前账号仍然活跃的设备会话，并额外标记 `current=true` 的当前设备。
- `DELETE /api/player-accounts/me/sessions/:sessionId` 仅允许撤销“非当前设备”的会话；被撤销的设备会话会立刻从列表消失，且旧刷新令牌随后会返回 `401 session_revoked`。
- `POST /api/auth/logout` 与口令修改仍然属于“全量撤销”：会清空当前账号全部设备会话，并通过提升 `accountSessionVersion` 让旧访问令牌也一起失效。

## 正式注册闭环

### 1. 发起注册

接口：`POST /api/auth/account-registration/request`

请求体：

```json
{
  "loginId": "veil-ranger",
  "displayName": "暮潮守望"
}
```

行为：

- 为“全新正式账号”预留 `loginId`，不依赖先创建游客档。
- 校验 `loginId` 格式、口令账号占用情况，并按来源 IP 走现有滑动窗口限流。
- 当前默认投递模式为 `VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE=dev-token`，会直接在响应体里回传 `registrationToken` 供联调使用；若切到 `webhook` 或 `disabled`，响应仍返回 `202`，但不会向客户端泄漏令牌。
- 若同一个 `loginId` 仍有未过期的注册申请，服务端会复用现有令牌与到期时间，而不是生成新令牌，避免联调时旧令牌被静默顶掉。
- `webhook` 模式会把令牌投递到配置的后端通道；若同一申请被重复触发，服务端会重新投递同一枚未过期令牌，而不是生成新令牌。
- 若 `loginId` 已被绑定，接口返回 `409 login_id_taken`。
- 注册申请事件会在确认成功后补写入新账号的 `recentEventLog`，便于后续统一审计。

成功响应示例：

```json
{
  "status": "registration_requested",
  "expiresAt": "2026-03-28T12:34:56.000Z",
  "registrationToken": "dev-token-example"
}
```

### 2. 确认注册

接口：`POST /api/auth/account-registration/confirm`

请求体：

```json
{
  "loginId": "veil-ranger",
  "registrationToken": "dev-token-example",
  "password": "hunter2"
}
```

行为：

- 校验 `loginId`、注册令牌和新口令长度。
- 令牌错误或过期时返回 `401 invalid_registration_token`。
- 成功后会创建新的 `player_accounts` 正式档案、绑定口令凭据并立即签发首个账号会话。
- 服务端会向新账号 `recentEventLog` 追加两条 `category=account` 审计事件，分别记录“发起正式注册申请”和“完成正式账号注册”。

## 密码找回闭环

### 1. 发起找回

接口：`POST /api/auth/password-recovery/request`

请求体：

```json
{
  "loginId": "veil-ranger"
}
```

行为：

- 仅对已绑定口令账号生效；不存在的 `loginId` 仍返回 `202`，避免泄漏账号存在性。
- 服务端生成一次性短时效重置令牌，并按来源 IP 走现有滑动窗口限流。
- 当前默认投递模式为 `VEIL_PASSWORD_RECOVERY_DELIVERY_MODE=dev-token`，会直接在响应体里回传 `recoveryToken` 供联调使用；若切到 `webhook` 或 `disabled`，响应仍返回 `202`，但不会向客户端泄漏令牌。
- 若同一账号已有未过期的找回申请，服务端会复用现有令牌与到期时间，避免重复请求导致先前令牌失效或连续追加重复审计事件。
- `webhook` 模式会把令牌投递到配置的后端通道；若同一申请被重复触发，服务端会重新投递同一枚未过期令牌，而不是生成新令牌。
- 若后续切到 `disabled`，接口仍保留，但不会直接把令牌回传给客户端，也不会尝试外部投递。
- 成功发起时会向该账号的 `recentEventLog` 追加一条 `category=account` 的审计事件。

成功响应示例：

```json
{
  "status": "recovery_requested",
  "expiresAt": "2026-03-28T12:34:56.000Z",
  "recoveryToken": "dev-token-example"
}
```

### 2. 确认重置

接口：`POST /api/auth/password-recovery/confirm`

请求体：

```json
{
  "loginId": "veil-ranger",
  "recoveryToken": "dev-token-example",
  "newPassword": "hunter3"
}
```

行为：

- 校验 `loginId`、重置令牌和新口令长度。
- 令牌错误或过期时返回 `401 invalid_recovery_token`。
- 成功后会更新口令哈希、提升 `accountSessionVersion`、撤销旧刷新令牌族，并使旧访问令牌失效。
- 完成后同样会追加一条 `category=account` 的审计事件，便于通过 `/api/player-accounts/:playerId/event-log` 或 `/me/event-log` 查询。

## 运行时参数

- `VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE`
  - `dev-token`：默认值，直接在响应里返回开发态注册令牌
  - `webhook`：通过通用 webhook 投递注册令牌，响应不回传 `registrationToken`
  - `disabled`：不向客户端直出令牌，保留接口占位
- `VEIL_ACCOUNT_REGISTRATION_TTL_MINUTES`
  - 默认 `15`
- `VEIL_PASSWORD_RECOVERY_DELIVERY_MODE`
  - `dev-token`：默认值，直接在响应里返回开发态重置令牌
  - `webhook`：通过通用 webhook 投递重置令牌，响应不回传 `recoveryToken`
  - `disabled`：不向客户端直出令牌，保留接口占位
- `VEIL_PASSWORD_RECOVERY_TTL_MINUTES`
  - 默认 `15`
- `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL`
  - 当任一投递模式为 `webhook` 时必填；服务端会向该地址发送 `POST application/json`
- `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN`
  - 可选；若提供，服务端会附带 `Authorization: Bearer <token>`
- `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_TIMEOUT_MS`
  - 可选，默认 `10000`
- `VEIL_RATE_LIMIT_AUTH_WINDOW_MS`
  - 默认 `60000`
- `VEIL_RATE_LIMIT_AUTH_MAX`
  - 默认 `10`

## Webhook 投递契约与失败处理

- `webhook` 模式会向 `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL` 发送 JSON：
  - 注册：`{ "event": "account-registration", "loginId": "...", "token": "...", "expiresAt": "...", "requestedDisplayName": "..." }`
  - 找回：`{ "event": "password-recovery", "loginId": "...", "playerId": "...", "token": "...", "expiresAt": "..." }`
- 若 `webhook` 模式缺少 URL，`request` 接口会返回 `503 *_delivery_misconfigured`。
- 若 webhook 超时、网络失败或返回非 2xx，`request` 接口会返回 `502 *_delivery_failed`，并保留当前未过期令牌，方便修复通道后重试同一请求重新投递。
- `disabled` 适合作为生产环境的显式兜底占位；`dev-token` 适合作为本地联调回退模式。

## 本地联调建议

- 本地默认继续使用 `dev-token`，H5 / Cocos 现有调试入口可以直接拿响应里的 token 完成注册或找回确认。
- 若要联调真实投递链路，可把某一个流程切到 `webhook`，并将 URL 指向本地捕获器、邮件桥接器或反向代理入口。
- 若本地暂时没有外部通道，又不希望客户端看到 token，可以临时改成 `disabled`；接口仍会保留，但确认步骤需要从服务端日志、运维工具或外部投递链路获取令牌。

## 前端联调入口

- H5 Lobby
  - 大厅页现已新增“正式注册”和“密码找回”两张卡片，直接覆盖 `request / confirm` 四个接口。
  - `request` 成功后若当前是 `dev-token` 模式，页面会直接展示返回的 `registrationToken` / `recoveryToken` 与到期时间，方便本地联调。
  - 注册确认成功后会立即缓存服务端签发的正式账号会话并进入目标房间；密码找回确认成功后会自动用新口令补一次登录，再进入目标房间。
- Cocos Lobby
  - Lobby 面板现已新增“正式注册”和“密码找回”按钮，沿用现有 prompt 式输入链路完成最小闭环。
  - 开发态下同样会优先复用 `request` 响应里的 dev token 作为默认值，避免手工翻日志或重新拼请求。
  - 如果运行环境不支持 prompt，则仍建议临时改回 H5 调试壳完成这两条链路。

## 当前仍未覆盖的范围

当前仍未完成：

- 真实邮件 / 短信 / 验证码通道
- 更细的前端自动化回归，例如直接覆盖 Lobby DOM / Cocos 交互入口的端到端脚本
