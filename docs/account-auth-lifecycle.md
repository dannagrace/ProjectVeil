# 账号鉴权、正式注册与密码找回

本文档描述当前仓库已经落地的正式账号能力，以及 `#124` 和 `#140` 已接上的正式注册 / 密码找回前后端闭环。游客升级、全新正式注册、密码找回与会话撤销之间的迁移契约，另见 `docs/account-migration-rules.md`。

## 当前已落地能力

- 游客登录：`POST /api/auth/guest-login`
- 微信小游戏登录：`POST /api/auth/wechat-login`（`/api/auth/wechat-mini-game-login` 仍保留别名）
- 微信小游戏年龄声明 / 未成年人保护：`POST /api/auth/wechat-login` 支持 `birthdate=YYYY-MM-DD` 自声明年龄校验；服务端会落库 `ageVerified/isMinor` 并在房间接入时执行未成年人限制
- 运营与监护人说明：`docs/minor-protection-operations.md`
- 游客档升级成口令账号：`POST /api/auth/account-bind`
- 口令账号登录：`POST /api/auth/account-login`
- 会话校验 / 刷新 / 退出：`GET /api/auth/session`、`POST /api/auth/refresh`、`POST /api/auth/logout`
- 正式账号设备会话列表 / 撤销：`GET /api/player-accounts/me/sessions`、`DELETE /api/player-accounts/me/sessions/:sessionId`
- 原生移动端推送令牌注册 / 注销：`PUT /api/players/me/push-token`、`DELETE /api/players/me/push-token`
- 已登录账号修改口令：`PUT /api/player-accounts/me`
- 迁移规则与边界场景说明：`docs/account-migration-rules.md`

当前账号模式仍沿用“先游客、再绑定”的模型：

1. 玩家可先以游客身份进入房间并形成 `player_accounts` 档案。
2. 需要长期登录时，再把当前游客档绑定到 `loginId + password`。
3. 后续账号登录会继续复用同一份英雄长期档、全局资源仓库和账号事件历史。

## `#1201` 当前切片进度

- [x] `POST /api/auth/account-login` 现在会按来源 IP 聚合短窗口内的跨账号口令失败；同一来源连续命中多个不同 `loginId` 失败后，会临时封禁该来源并返回 `429 credential_stuffing_blocked`。
- [x] `/api/runtime/auth-readiness` 与 `/api/runtime/metrics` 已补充撞库源封禁态势，便于 ops 区分“单账号锁定”与“同源多账号扫描”。
- [ ] 更外层的 DDoS 缓解仍属于 CDN / WAF / 基础设施侧工作，本次仓库切片未覆盖。
- [x] 未成年人保护已接入生产命名的运营查询面 `/api/admin/minor-protection`，并在服务端按中国时区执行 `22:00-08:00` 宵禁、工作日 `90` 分钟 / 周末与节假日 `180` 分钟的累计时长限制。
- [x] 当前仓库在缺少微信实名 SDK 脚手架时，采用 `birthdate=YYYY-MM-DD` 的自声明年龄校验作为生产兜底；服务端只持久化 `ageVerified/isMinor` 结果，不回存原始生日。
- [ ] 仍缺少对接微信实名能力后的更强校验链路，以及面向存量账号的强制补录 / 追认流程。

## 微信小游戏 code2session

- `POST /api/auth/wechat-login` 会用服务端环境变量 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 调用微信 `jscode2session`。
- 当同一个微信小游戏账号重复登录时，服务端会复用已经绑定过的 `playerId`，不会因为客户端再次提交不同的 `playerId` 而漂移。
- 若当前请求已经带有正式账号会话，服务端会把该微信身份绑定到现有账号；后续该微信登录会继续命中同一个账号档。
- 若当前请求带着游客会话，服务端会把游客进度原子迁移到微信账号档，并在响应里返回 `accountMigration.notice="您的游客进度将合并到新账号"` 供客户端展示。
- 当同一微信号已绑定且目标账号已有进度时，接口返回 `409 wechat_guest_upgrade_conflict`，要求客户端显式传 `migrationChoice=keep_registered|keep_guest` 再继续。
- 迁移完成后，旧游客档会记录 `guestMigratedToPlayerId`，旧游客 token 会返回 `401 session_revoked`，同一 `guest-*` ID 也不能再次通过 `POST /api/auth/guest-login` 复用。
- 服务端只消费微信返回的 `openid` / `unionid` 做绑定，不会把 `session_key` 写入客户端响应。
- mock code 仅保留给 `NODE_ENV=test` 的自动化测试；非测试环境即使显式配置 `VEIL_WECHAT_MINIGAME_LOGIN_MODE=mock` 也不会启用。

## 设备会话管理

- 正式账号登录后，服务端会为每个刷新令牌族持久化一条设备会话记录，包含 `sessionId`、最近活跃时间、刷新令牌到期时间以及一个最小设备标签（当前取自请求 `User-Agent`）。
- `GET /api/player-accounts/me/sessions` 只返回当前账号仍然活跃的设备会话，并额外标记 `current=true` 的当前设备。
- `DELETE /api/player-accounts/me/sessions/:sessionId` 仅允许撤销“非当前设备”的会话；被撤销的设备会话会立刻从列表消失，且旧刷新令牌随后会返回 `401 session_revoked`。
- `POST /api/auth/logout` 与口令修改仍然属于“全量撤销”：会清空当前账号全部设备会话，并通过提升 `accountSessionVersion` 让旧访问令牌也一起失效。

## 移动推送令牌

- `PUT /api/players/me/push-token` 接收 `{ "platform": "ios" | "android", "token": "..." }`，按平台为当前玩家保存一个原生推送 token。
- `DELETE /api/players/me/push-token` 接收 `{ "platform"?: "...", "token"?: "..." }`，按平台或 token 删除已登记的原生推送 token。
- 当前服务端会把原生推送接到既有的 `match_found` 与 `turn_reminder` 事件链路；推送失败只记日志，不阻塞匹配或回合推进。
- APNs 依赖 `VEIL_APNS_KEY_ID`、`VEIL_APNS_TEAM_ID`、`VEIL_APNS_PRIVATE_KEY`、`VEIL_APNS_TOPIC`，默认在非生产环境走 sandbox，可用 `VEIL_APNS_USE_SANDBOX=false` 或 `VEIL_APNS_HOST` 覆盖。
- FCM 依赖 `VEIL_FCM_SERVER_KEY`，发送地址默认 `https://fcm.googleapis.com/fcm/send`，可用 `VEIL_FCM_SEND_URL` 覆盖到测试项目或代理。

## 鉴权观测面

- `GET /api/runtime/health` 现已附带 `runtime.auth`，用于和现有运行时健康面一起查看鉴权态势。
- `GET /api/runtime/auth-readiness` 提供更紧凑的鉴权摘要，适合直接接现有 dashboard / alerting tooling。
- `GET /api/runtime/account-token-delivery` 提供账号令牌投递专用视图，包含当前重试队列、dead-letter 数、失败原因计数与最近投递尝试明细，便于运维直接排查 webhook / SMTP 通道状态。
- `GET /api/runtime/metrics` 现已补充以下 Prometheus 指标：
  - 当前进程内活跃游客会话：`veil_auth_guest_sessions`
  - 当前进程内活跃正式账号设备会话：`veil_auth_account_sessions`
  - 当前登录锁定数：`veil_auth_account_locks`
  - 当前处于撞库源封禁中的来源数：`veil_auth_credential_stuffing_sources`
  - 待确认注册 / 找回令牌：`veil_auth_pending_registrations`、`veil_auth_pending_recoveries`
  - 会话校验、游客登录、账号登录、绑定、注册确认、刷新、退出、限流、撞库源封禁、口令错误等累计计数：`veil_auth_*_total`
  - 账号令牌投递队列 / dead-letter gauge：`veil_auth_token_delivery_queue_count`、`veil_auth_token_delivery_dead_letter_count`
  - 账号令牌投递请求量、成功、失败、重试、耗尽累计计数：`veil_auth_token_delivery_requests_total`、`veil_auth_token_delivery_successes_total`、`veil_auth_token_delivery_failures_total`、`veil_auth_token_delivery_retries_total`、`veil_auth_token_delivery_dead_letters_total`
  - 账号令牌投递失败原因累计计数：`veil_auth_token_delivery_failures_timeout_total`、`veil_auth_token_delivery_failures_network_total`、`veil_auth_token_delivery_failures_smtp_4xx_total`、`veil_auth_token_delivery_failures_smtp_5xx_total`、`veil_auth_token_delivery_failures_smtp_protocol_total`、`veil_auth_token_delivery_failures_webhook_4xx_total`、`veil_auth_token_delivery_failures_webhook_429_total`、`veil_auth_token_delivery_failures_webhook_5xx_total`
- 以上“活跃会话”指标是当前服务进程内的运行时视角，适合做本机 readiness / traffic 观测；若部署多实例，应按实例维度抓取再在监控端汇总。

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
- 当前默认投递模式为 `VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE=dev-token`，会直接在响应体里回传 `registrationToken` 供联调使用；若切到 `smtp`、`webhook` 或 `disabled`，响应仍返回 `202`，但不会向客户端泄漏令牌。
- `request` 响应会额外返回 `deliveryStatus`；外部通道首次投递成功时是 `delivered`，若首次命中可重试故障则会返回 `retry_scheduled` 并附带 `deliveryAttemptCount / deliveryMaxAttempts / deliveryNextAttemptAt`，方便客户端把它识别为“临时投递异常但服务端仍会继续送达”。
- 若同一个 `loginId` 仍有未过期的注册申请，服务端会复用现有令牌与到期时间，而不是生成新令牌，避免联调时旧令牌被静默顶掉。
- `smtp` / `webhook` 模式都会把令牌投递到配置的后端通道；若同一申请被重复触发，服务端会复用同一枚未过期令牌，并在已有重试排队时直接返回当前排队状态，而不是重复生成新任务。
- 若 `loginId` 已被绑定，接口返回 `409 login_id_taken`。
- 注册申请事件会在确认成功后补写入新账号的 `recentEventLog`，便于后续统一审计。

成功响应示例：

```json
{
  "status": "registration_requested",
  "expiresAt": "2026-03-28T12:34:56.000Z",
  "deliveryStatus": "dev-token",
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
- 当前默认投递模式为 `VEIL_PASSWORD_RECOVERY_DELIVERY_MODE=dev-token`，会直接在响应体里回传 `recoveryToken` 供联调使用；若切到 `smtp`、`webhook` 或 `disabled`，响应仍返回 `202`，但不会向客户端泄漏令牌。
- `request` 响应同样会附带 `deliveryStatus`；若外部通道首次投递命中可重试异常，接口仍返回 `202 recovery_requested`，但 `deliveryStatus=retry_scheduled`，并给出下一次后台重试时间。
- 若同一账号已有未过期的找回申请，服务端会复用现有令牌与到期时间，避免重复请求导致先前令牌失效或连续追加重复审计事件。
- `smtp` / `webhook` 模式都会把令牌投递到配置的后端通道；若同一申请被重复触发，服务端会复用同一枚未过期令牌，并优先复用已有的排队重试状态。
- 若后续切到 `disabled`，接口仍保留，但不会直接把令牌回传给客户端，也不会尝试外部投递。
- 成功发起时会向该账号的 `recentEventLog` 追加一条 `category=account` 的审计事件。

成功响应示例：

```json
{
  "status": "recovery_requested",
  "expiresAt": "2026-03-28T12:34:56.000Z",
  "deliveryStatus": "dev-token",
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
  - `smtp`：通过 SMTP 邮件投递注册令牌，响应不回传 `registrationToken`
  - `webhook`：通过通用 webhook 投递注册令牌，响应不回传 `registrationToken`
  - `disabled`：不向客户端直出令牌，保留接口占位
- `VEIL_ACCOUNT_REGISTRATION_TTL_MINUTES`
  - 默认 `15`
- `VEIL_PASSWORD_RECOVERY_DELIVERY_MODE`
  - `dev-token`：默认值，直接在响应里返回开发态重置令牌
  - `smtp`：通过 SMTP 邮件投递重置令牌，响应不回传 `recoveryToken`
  - `webhook`：通过通用 webhook 投递重置令牌，响应不回传 `recoveryToken`
  - `disabled`：不向客户端直出令牌，保留接口占位
- `VEIL_PASSWORD_RECOVERY_TTL_MINUTES`
  - 默认 `15`
- `VEIL_AUTH_TOKEN_DELIVERY_TIMEOUT_MS`
  - 可选，默认 `10000`；供 SMTP / webhook 共用，旧的 `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_TIMEOUT_MS` 仍可作为兼容别名
- `VEIL_AUTH_TOKEN_DELIVERY_MAX_ATTEMPTS`
  - 可选，默认 `4`，包含首次同步投递在内；旧的 `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_MAX_ATTEMPTS` 仍可作为兼容别名
- `VEIL_AUTH_TOKEN_DELIVERY_RETRY_BASE_DELAY_MS`
  - 可选，默认 `5000`；旧的 `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_BASE_DELAY_MS` 仍可作为兼容别名
- `VEIL_AUTH_TOKEN_DELIVERY_RETRY_MAX_DELAY_MS`
  - 可选，默认 `60000`；旧的 `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_MAX_DELAY_MS` 仍可作为兼容别名
- `VEIL_AUTH_TOKEN_DELIVERY_SMTP_HOST`
  - 当任一投递模式为 `smtp` 时必填
- `VEIL_AUTH_TOKEN_DELIVERY_SMTP_PORT`
  - 可选；默认 `587`，若 `VEIL_AUTH_TOKEN_DELIVERY_SMTP_SECURE=true` 则默认 `465`
- `VEIL_AUTH_TOKEN_DELIVERY_SMTP_SECURE`
  - 可选；默认 `false`，为 `true` 时走 SMTPS
- `VEIL_AUTH_TOKEN_DELIVERY_SMTP_IGNORE_TLS_ERRORS`
  - 可选；默认 `false`，仅建议本地 / CI 对接自签证书测试盒时使用
- `VEIL_AUTH_TOKEN_DELIVERY_SMTP_FROM`
  - 当任一投递模式为 `smtp` 时必填；作为发件人地址
- `VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN`
  - 当任一投递模式为 `smtp` 时必填；服务端会把 `loginId` 映射成 `<loginId>@<domain>`，适合 staging catch-all 邮箱或 Mailpit/MailHog 域名
- `VEIL_AUTH_TOKEN_DELIVERY_SMTP_EHLO_NAME`
  - 可选；默认 `projectveil.local`
- `VEIL_AUTH_TOKEN_DELIVERY_SMTP_USERNAME`
  - 可选；若提供则必须同时提供 `VEIL_AUTH_TOKEN_DELIVERY_SMTP_PASSWORD`
- `VEIL_AUTH_TOKEN_DELIVERY_SMTP_PASSWORD`
  - 可选；若提供则必须同时提供 `VEIL_AUTH_TOKEN_DELIVERY_SMTP_USERNAME`
- `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL`
  - 当任一投递模式为 `webhook` 时必填；服务端会向该地址发送 `POST application/json`
- `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN`
  - 可选；若提供，服务端会附带 `Authorization: Bearer <token>`
- `VEIL_RATE_LIMIT_AUTH_WINDOW_MS`
  - 默认 `60000`
- `VEIL_RATE_LIMIT_AUTH_MAX`
  - 默认 `10`
- `VEIL_AUTH_CREDENTIAL_STUFFING_WINDOW_MS`
  - 默认 `300000`；按来源 IP 聚合 `account-login` 失败的观测窗口
- `VEIL_AUTH_CREDENTIAL_STUFFING_DISTINCT_LOGIN_IDS`
  - 默认 `5`；同一来源在窗口内命中多少个不同 `loginId` 失败后，触发临时撞库源封禁
- `VEIL_AUTH_CREDENTIAL_STUFFING_BLOCK_DURATION_MINUTES`
  - 默认 `15`；撞库源封禁持续时间，期间 `account-login` 会直接返回 `429 credential_stuffing_blocked`

## SMTP / Webhook 投递契约与失败处理

### SMTP

- `smtp` 模式会把 `loginId` 映射成 `<loginId>@VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN`，然后通过 SMTP 发送纯文本邮件：
  - 注册主题：`[ProjectVeil] Registration token for <loginId>`
  - 找回主题：`[ProjectVeil] Password recovery token for <loginId>`
  - 正文固定包含 `loginId`、`token`、`expiresAt`，注册邮件还会带 `requestedDisplayName`，找回邮件会带 `playerId`
- 若 `smtp` 模式缺少 host / from / recipient domain 等关键配置，`request` 接口会返回 `503 *_delivery_misconfigured`。
- SMTP `4xx`、超时与网络失败会被视为可重试故障：`request` 接口仍返回 `202 *_requested`，但 `deliveryStatus=retry_scheduled`，服务端会按共享重试参数继续投递。
- SMTP `5xx` 或协议错误会被视为非可重试故障：`request` 接口返回 `502 *_delivery_failed`，并把当前令牌投递任务记入 dead-letter。

### Webhook

- `webhook` 模式会向 `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL` 发送 JSON：
  - 注册：`{ "event": "account-registration", "loginId": "...", "token": "...", "expiresAt": "...", "requestedDisplayName": "..." }`
  - 找回：`{ "event": "password-recovery", "loginId": "...", "playerId": "...", "token": "...", "expiresAt": "..." }`
- 若 `webhook` 模式缺少 URL，`request` 接口会返回 `503 *_delivery_misconfigured`。
- webhook 超时、网络失败、`429` 或 `5xx` 会被视为可重试故障：`request` 接口仍返回 `202 *_requested`，但 `deliveryStatus=retry_scheduled`，服务端会按共享重试参数继续投递，直到成功或耗尽。
- webhook 其他 `4xx` 会被视为非可重试故障：`request` 接口返回 `502 *_delivery_failed`，并把当前令牌投递任务记入 dead-letter，等待运维修复配置或通道契约。
- 若后台重试最终耗尽，令牌会进入 dead-letter；客户端拿到的仍是原先的 `202 *_requested`，但运维可通过 `GET /api/runtime/account-token-delivery` 或 Prometheus 指标看到 `deadLetterCount` / `veil_auth_token_delivery_dead_letters_total` 变化。
- 因此客户端可据此区分三类结果：`401/409` 等业务态错误代表账号 / 令牌本身无效；`503 *_delivery_misconfigured` 代表服务端投递配置缺失；`202 ... deliveryStatus=retry_scheduled` 代表临时通道异常且服务端已接管后续重试。
- `disabled` 适合作为生产环境的显式兜底占位；`dev-token` 适合作为本地联调回退模式。

## 本地联调建议

- 本地默认继续使用 `dev-token`，H5 / Cocos 现有调试入口可以直接拿响应里的 token 完成注册或找回确认。
- 若要联调真实投递链路，可把某一个流程切到 `smtp` 或 `webhook`：
  - `smtp`：建议本地启动 Mailpit / MailHog，然后配置 `VEIL_AUTH_TOKEN_DELIVERY_SMTP_HOST=127.0.0.1`、`VEIL_AUTH_TOKEN_DELIVERY_SMTP_PORT=<smtp-port>`、`VEIL_AUTH_TOKEN_DELIVERY_SMTP_FROM=noreply@example.test`、`VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN=mail.example.test`。这样 `loginId=veil-ranger` 会投递到 `veil-ranger@mail.example.test`，可直接在本地收件箱查看 token。
  - `webhook`：把 URL 指向本地捕获器、邮件桥接器或反向代理入口。
- 若本地暂时没有外部通道，又不希望客户端看到 token，可以临时改成 `disabled`；接口仍会保留，但确认步骤需要从服务端日志、运维工具或外部投递链路获取令牌。
- CI / staging 建议优先使用 `smtp` + catch-all 域名：所有测试账号都能按 `loginId@domain` 收件，既不需要把令牌回传给客户端，也不需要为每个测试账号手工配置单独地址。

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

- 短信 / 独立验证码供应商通道
- 更完整的前端自动化回归矩阵；当前已补上 `npm run smoke -- cocos:canonical-journey` 这条 primary Cocos client 的账号会话 -> Lobby -> 首次进房自动化切片，但更广的交互矩阵仍待继续扩充
