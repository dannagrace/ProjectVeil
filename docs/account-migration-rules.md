# 游客与正式账号迁移规则

本文档补充 `docs/account-auth-lifecycle.md`，专门定义游客账号、游客绑定后的正式账号，以及“全新正式注册账号”之间的迁移契约。重点回答三类问题：

- 哪些路径会复用同一份 `player_accounts` / 英雄长期档 / 全局资源。
- 哪些路径会创建全新身份，不做自动合并。
- 会话、审计事件，以及失败场景该如何表现。

## 术语

- 游客账号：通过 `POST /api/auth/guest-login` 进入，已有 `playerId` 与 `player_accounts` 档案，但还没有 `loginId / passwordHash`。
- 绑定正式账号：在已登录游客会话上调用 `POST /api/auth/account-bind` 后形成的口令账号。它和绑定前是同一个 `playerId`。
- 全新正式账号：通过 `POST /api/auth/account-registration/request` + `confirm` 新创建的口令账号。它会生成新的 `playerId`，不依赖现有游客档。

## 迁移矩阵

| 场景 | 身份结果 | `playerId` | 英雄长期档 / 全局资源 | 会话结果 | 审计事件 |
| --- | --- | --- | --- | --- | --- |
| 游客 -> 绑定正式账号 | 复用当前账号并补齐口令凭据 | 保持不变 | 全量保留，继续沿用当前游客档 | 当前游客会话立即升级为正式账号会话 | 继续沿用原账号事件历史；后续账号操作继续写入同一账号 |
| 全新正式注册 -> 首次登录 | 创建全新正式账号 | 新生成 `account-*` 风格 `playerId` | 从空白正式档开始，不合并任何现有游客档 | 确认注册成功后立即签发首个正式账号会话 | 新账号写入“发起正式注册申请 / 完成正式账号注册” |
| 正式账号密码找回 | 不更换身份，只更新口令 | 保持不变 | 全量保留，不影响英雄档、资源和历史 | 旧访问令牌与刷新令牌全部失效，需用新口令重新登录 | 写入“发起密码找回申请 / 重置口令” |
| 正式账号退出登录 | 不更换身份 | 保持不变 | 全量保留 | 当前实现属于全量撤销：该账号全部设备会话失效 | 不额外迁移数据；会话撤销结果可通过会话接口观察 |

## 支持的迁移路径

### 1. 游客升级为已绑定正式账号

适用接口：`POST /api/auth/account-bind`

规则：

- 这是唯一会把“已有游客进度”升级成口令账号的路径。
- 绑定前后的核心身份是同一个 `playerId`，因此 `player_accounts`、`player_hero_archives`、全局资源仓库、`recentEventLog`、历史战报等都继续挂在原账号上。
- 成功后服务端不会要求玩家先退出再登录，而是直接返回新的 `authMode=account` 会话；前端应以这份新会话覆盖旧游客会话。
- 绑定后再次通过 `POST /api/auth/account-login` 登录时，进入的仍是同一份长期档。

不支持的事情：

- 不支持把两个已有账号合并。
- 不支持把一个游客档绑定到已经被其他账号占用的 `loginId`。
- 不支持“半绑定”状态。`account-bind` 失败时，原游客档和游客会话保持原样。

### 2. 全新正式注册

适用接口：

- `POST /api/auth/account-registration/request`
- `POST /api/auth/account-registration/confirm`

规则：

- 这条链路用于“从零创建一个正式账号”，不是游客升级。
- `confirm` 成功后会新建一份 `player_accounts` 正式档案，并生成新的 `playerId`；不会接管或覆盖当前浏览器里可能存在的游客档。
- 因为是新身份，所以默认没有既有英雄长期档、全局资源或房间进度，后续进度从新账号开始累计。
- 注册确认成功后会立即签发首个正式账号会话，不需要额外再调一次 `account-login`。

实现边界：

- 当前仓库没有“把旧游客档迁入新注册正式账号”的自动合并逻辑。如果玩家希望保留已有游客进度，必须走 `account-bind`，而不是全新注册。
- 同一个 `loginId` 在未消费的有效申请存在时会复用同一个 `registrationToken` 和 `expiresAt`，避免重复申请把旧令牌静默顶掉。

### 3. 密码找回与口令重置

适用接口：

- `POST /api/auth/password-recovery/request`
- `POST /api/auth/password-recovery/confirm`

规则：

- 密码找回只改变口令凭据，不改变 `playerId`，也不会迁移或重建账号数据。
- 成功确认后，正式账号的英雄长期档、全局资源、事件历史、战报等全部保留。
- 重置完成后服务端会提升 `accountSessionVersion` 并撤销旧刷新令牌族，因此找回前签发的访问令牌和刷新令牌都会随后返回 `401 session_revoked`。
- 玩家需要使用新口令重新登录；旧口令不会继续有效。

### 4. 退出登录、会话撤销与设备会话

适用接口：

- `POST /api/auth/logout`
- `GET /api/player-accounts/me/sessions`
- `DELETE /api/player-accounts/me/sessions/:sessionId`
- `POST /api/auth/refresh`

规则：

- `POST /api/auth/logout` 当前是“全量撤销”语义，不只是退出当前设备。调用后该账号全部设备会话都会失效。
- `DELETE /api/player-accounts/me/sessions/:sessionId` 才是定向撤销其他设备；当前设备不能通过这个接口删除，只能走 `logout`。
- 被定向撤销的设备会话会从会话列表消失，并在继续刷新时返回 `401 session_revoked`。
- 刷新令牌轮换后，旧刷新令牌立即作废；重复使用旧刷新令牌同样返回 `401 session_revoked`。

## 数据保留与不保留规则

### 会保留的数据

- 游客 -> 绑定正式账号：保留当前游客账号下的全部长期数据，因为本质上仍是同一个 `playerId`。
- 密码找回、重新登录、设备会话刷新/撤销：都只影响认证材料和在线态，不影响账号下的长期数据。

### 不会自动迁移的数据

- 全新正式注册不会继承已有游客档的资源、英雄或事件历史。
- 当前实现没有“两个正式账号合并”或“游客档手动并入新注册正式账号”的后端契约。
- 如果玩家在注册页重新创建了一个全新正式账号，那只是新增了一个身份，不会替换旧游客档。

## 失败与边界场景

### `loginId` 冲突

- `account-bind` 或 `account-registration/request|confirm` 若目标 `loginId` 已被其他正式账号占用，应失败并返回 `409 login_id_taken`。
- 失败不会迁移任何数据，也不会修改原账号的 `playerId`、资源或英雄档。

### 注册令牌无效或过期

- `account-registration/confirm` 在令牌错误、过期或已被消费后返回 `401 invalid_registration_token`。
- 已创建的注册申请不会凭空生成新账号；客户端应重新发起 `request` 获取新的有效令牌。

### 找回令牌无效或过期

- `password-recovery/confirm` 在令牌错误、过期或账号状态不匹配时返回 `401 invalid_recovery_token`。
- 失败不会改变现有口令，也不会撤销当前仍有效的正式账号会话。

### 已登录游客在注册途中放弃

- 若用户先拿到 `registrationToken` 但没有完成 `confirm`，已有游客账号不受影响。
- 重新请求同一个 `loginId` 时，只要旧申请仍有效，就复用原令牌和到期时间。
- 令牌过期后再继续，需要重新走一遍 `request`。

### 会话被撤销后的客户端表现

- 访问令牌过期时返回 `401 token_expired`，客户端应尝试用刷新令牌换新会话。
- 若返回 `401 session_revoked`，说明整个会话家族已经失效，客户端应清掉本地缓存并要求重新登录或重新走游客登录。
- 游客绑定成功后，客户端应立即保存返回的正式账号会话，避免继续拿旧游客 token 调用后续接口。

### 频率限制与安全闸门

- `guest-login`、`account-bind`、`account-login`、注册、密码找回都受来源 IP 滑动窗口限流保护；超限返回 `429 rate_limited`。
- `account-login` 还受连续失败锁定控制；锁定期间即使口令正确也不会继续签发新会话。

## 前后端协作建议

- “保留游客进度并升级为正式账号”时，只能调用 `account-bind`。
- “创建一个全新正式身份”时，才调用正式注册 `request/confirm`。
- 前端展示帮助文案时，应明确告知：全新注册不会继承当前游客进度；想保留进度请绑定当前账号。
- 只要客户端收到新的正式账号会话，就应覆盖本地旧会话缓存，不要并存保存游客 token 与正式账号 token。
