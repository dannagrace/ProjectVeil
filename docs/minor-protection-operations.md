# 未成年人保护运营与监护人说明

本文档描述 `#1305` 落地后的生产契约，覆盖账号年龄声明、房间准入拦截、运营查询面，以及当前仓库仍待补齐的能力。

## 当前生产行为

- 微信小游戏登录接口 `POST /api/auth/wechat-login` 支持客户端提交 `birthdate`，格式固定为 `YYYY-MM-DD`。
- 当仓库内没有微信实名能力时，服务端把该字段视为“用户自声明生日”，并据此推导 `ageVerified=true` 与 `isMinor=true|false`。
- 为降低敏感信息持久化范围，服务端当前只保存 `ageVerified` 与 `isMinor` 的归一化结果，不持久化原始 `birthdate`。
- 旧的 `isAdult` / `ageRange` 输入仍作为兼容兜底保留，但新的生产接入应优先传 `birthdate`。

## 服务端限制

- 时区固定读取 `VEIL_MINOR_PROTECTION_TIME_ZONE`，默认 `Asia/Shanghai`。
- 宵禁时段为 `22:00` 到次日 `08:00`，未成年人不能进房，也会在在线期间被定时器踢出。
- 每日累计时长上限为：
  - 工作日 `90` 分钟
  - 周末与 `VEIL_MINOR_PROTECTION_HOLIDAY_DATES` 命中的节假日 `180` 分钟
- 房间准入在 `connect/join` 前检查账号年龄状态与当前服务器时间，未成年人被拦截时返回结构化错误：
  - `reason=minor_restricted_hours`
  - `reason=minor_daily_limit_reached`
  - `minorProtection.nextAllowedAt`
  - `minorProtection.nextAllowedCountdownSeconds`

## 运营查询面

- 生产路由：`GET /api/admin/minor-protection`
- 兼容别名：`GET /api/admin/minor-protection/preview`
- 鉴权：请求头 `x-veil-admin-token: <VEIL_ADMIN_TOKEN>`
- 常用查询参数：
  - `playerId`: 必填
  - `at`: 可选，ISO-8601 时间，用于按历史/演练时间点评估
  - `dailyPlayMinutes`: 可选，覆盖当天累计分钟数做演练
- 响应会返回：
  - 当前是否命中宵禁 / 时长上限
  - 中国时区下的本地日期与时间
  - 当天剩余可玩分钟数
  - 下一次允许游戏的时间点与倒计时秒数

## 监护人/合规说明

- 当前仓库只实现“自声明生日 + 服务端限制”这一最小可上线链路，适合作为无微信实名 SDK 时的兜底。
- 若玩家自声明为未成年人，前端和运营文案应明确说明：
  - 宵禁时间为 `22:00-08:00`
  - 工作日每日最多 `1.5` 小时
  - 周末 / 法定节假日每日最多 `3` 小时
- 监护人同意、客服申诉、年龄更正等流程当前仍属于运营人工处理范围，建议保留人工审计记录并复核账号 `playerId`、设备、时间点与声明信息来源。

## 已知缺口与后续

- 未接入微信官方实名 / 防沉迷能力，无法证明自声明生日的真实性。
- 未实现存量账号强制补录年龄信息的迁移流程；当前限制仅在账号已有 `isMinor=true` 时生效。
- 未实现监护人同意凭证的持久化模型；若后续需要闭环，应新增专用 consent read-model，而不是复用 `privacyConsentAt`。
