# 账号鉴权、正式注册与密码找回

本文档描述当前仓库已经落地的正式账号能力，以及 `#124` 当前已接上的正式注册 / 密码找回后端闭环。

## 当前已落地能力

- 游客登录：`POST /api/auth/guest-login`
- 游客档升级成口令账号：`POST /api/auth/account-bind`
- 口令账号登录：`POST /api/auth/account-login`
- 会话校验 / 刷新 / 退出：`GET /api/auth/session`、`POST /api/auth/refresh`、`POST /api/auth/logout`
- 已登录账号修改口令：`PUT /api/player-accounts/me`

当前账号模式仍沿用“先游客、再绑定”的模型：

1. 玩家可先以游客身份进入房间并形成 `player_accounts` 档案。
2. 需要长期登录时，再把当前游客档绑定到 `loginId + password`。
3. 后续账号登录会继续复用同一份英雄长期档、全局资源仓库和账号事件历史。

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
- 当前默认开发态投递模式为 `VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE=dev-token`，会直接在响应体里回传 `registrationToken` 供联调使用。
- 若同一个 `loginId` 仍有未过期的注册申请，服务端会复用现有令牌与到期时间，而不是生成新令牌，避免联调时旧令牌被静默顶掉。
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
- 当前默认开发态投递模式为 `VEIL_PASSWORD_RECOVERY_DELIVERY_MODE=dev-token`，会直接在响应体里回传 `recoveryToken` 供联调使用。
- 若同一账号已有未过期的找回申请，服务端会复用现有令牌与到期时间，避免重复请求导致先前令牌失效或连续追加重复审计事件。
- 若后续切到 `disabled`，接口仍保留，但不会直接把令牌回传给客户端。
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
  - `disabled`：不向客户端直出令牌，保留接口占位
- `VEIL_ACCOUNT_REGISTRATION_TTL_MINUTES`
  - 默认 `15`
- `VEIL_PASSWORD_RECOVERY_DELIVERY_MODE`
  - `dev-token`：默认值，直接在响应里返回开发态重置令牌
  - `disabled`：不向客户端直出令牌，保留接口占位
- `VEIL_PASSWORD_RECOVERY_TTL_MINUTES`
  - 默认 `15`
- `VEIL_RATE_LIMIT_AUTH_WINDOW_MS`
  - 默认 `60000`
- `VEIL_RATE_LIMIT_AUTH_MAX`
  - 默认 `10`

## 本轮未覆盖的 #124 范围

本次只落了后端正式注册 + 密码找回 vertical slice，仍未完成：

- H5 Lobby / Cocos Lobby 的注册或找回 UI 入口
- 游客绑定账号与“全新正式注册账号”之间的迁移规则文档
- 真实邮件 / 短信 / 验证码通道
