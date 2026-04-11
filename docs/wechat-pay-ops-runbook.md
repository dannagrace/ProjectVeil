# WeChat Pay 退款 / 争议处理与防欺诈运营手册

适用范围：

- `apps/server/src/wechat-pay.ts` 提供的 WeChat Pay 下单、验单、回调链路
- `packages/shared/src/analytics-events.ts` 中的 `payment_fraud_signal`
- `docs/alerting-rules.yml` 中的 `VeilWechatPaymentFraudSignalsHigh` 告警

在以下情况打开本手册：

- 玩家反馈未到账、重复扣款、错商品到账
- WeChat Pay 退款或争议单需要运营审批
- `payment_fraud_signal` 被触发，或 Prometheus 告警命中支付风控信号
- 怀疑回调被重放、签名异常、订单号重复使用

## 值班与时限

| 事件类型 | 值班 owner | 首次响应目标 | 完成目标 |
| --- | --- | --- | --- |
| 玩家未到账 / 重复扣款 | commerce on-call | 15 分钟 | 4 小时内给出补偿或退款结论 |
| WeChat Pay 退款申请 | commerce approver + finance reviewer | 30 分钟 | 1 个工作日内完成审批与执行 |
| 争议 / 欺诈信号 / 回调重放怀疑 | commerce on-call + backend on-call | 15 分钟 | 2 小时内完成隔离、审计与升级 |

升级规则：

- 同一玩家 15 分钟内出现 2 次以上 `payment_fraud_signal`，直接升级到 backend on-call。
- 同一候选版本 15 分钟内出现 1 次以上 `VeilWechatPaymentFraudSignalsHigh`，暂停该版本继续放量或提审。
- 涉及重复扣款、批量未到账、或疑似恶意回调重放时，必须同时通知 finance reviewer。

## 退款与争议处理

审批矩阵：

| 场景 | 审批人 | 执行人 | 必备证据 |
| --- | --- | --- | --- |
| 未到账但微信侧已扣款 | commerce approver | commerce on-call | `payment_orders`、`payment_receipts`、玩家工单、补偿记录 |
| 重复扣款 | finance reviewer | commerce on-call | 同一 `playerId` / `productId` / 交易时间窗内的多笔订单与回调记录 |
| 商品错发 / 金额不符 | commerce approver + backend on-call | commerce on-call | 订单金额、商品配置、`payment_fraud_signal` 或验单错误记录 |
| 用户主动退款 / 第三方争议 | finance reviewer | commerce on-call | 工单、微信商户后台截图、内部审计日志 |

操作步骤：

1. 先在 `payment_orders` 和 `payment_receipts` 中按 `orderId`、`playerId`、`transactionId` 检索交易事实，不要仅凭工单文本做判断。
2. 再核对 `apps/server/src/wechat-pay.ts` 当前版本是否已把该订单标记为 `paid`，以及是否已经完成发货。
3. 若微信已扣款但游戏未到账，优先走补偿 SOP；只有补偿风险高、证据不一致或玩家明确要求原路退回时才发起退款。
4. 若确认重复扣款，先冻结该玩家的后续人工补单，再按 finance reviewer 审批结果执行退款。
5. 若为争议单，必须记录内部结论、审批人、执行人、执行时间、外部单号，并在 1 个工作日内回填工单。

## 未到账 / 重复扣款补偿 SOP

未到账：

1. 用 `/api/payments/wechat/verify` 或回调对应的 `out_trade_no` 查明是否已验单成功。
2. 如果微信订单成功、`payment_receipts` 缺失、且商品金额与 `openid` 一致，先由 backend on-call 确认是否可以安全重试补偿。
3. 重试成功后，在工单和审计日志中记录补偿方式、操作者、时间、关联 `orderId`。
4. 若 30 分钟内无法安全补偿，转为退款审批流。

重复扣款：

1. 检查同一玩家是否存在多个不同 `orderId` 指向相同支付动作，或同一 `orderId` 被重复回调。
2. 如果只是相同 `out_trade_no` 的重复通知，当前服务端会幂等返回成功，不做二次发货。
3. 如果是两笔真实成功交易且只应成交一次，按退款审批流处理，并把重复交易窗口内的所有 `transactionId` 记入审计日志。

## 回调重放攻击检测与防御

当前代码面的最低防线：

- 平台证书序列号必须匹配 `VEIL_WECHAT_PAY_PLATFORM_SERIAL`
- 回调签名必须通过 `wechatpay-signature` 校验
- 回调时间戳必须落在 5 分钟 replay window 内
- `out_trade_no` 已支付或已有 receipt 时，只做幂等处理并上报 `duplicate_out_trade_no`
- 回调到账后仍会再次向微信查询订单状态，校验 `appid`、`mchid`、金额、`openid`

运营检查项：

1. 如果发现回调时间戳超窗、序列号不匹配或签名异常，立即视为潜在重放/伪造流量。
2. 保留原始请求头里的 `wechatpay-timestamp`、`wechatpay-nonce`、`wechatpay-serial`，不要只截图响应结果。
3. 同一 `orderId` 在短时间内重复出现时，结合 `payment_fraud_signal` 和 `payment_receipts` 判断是正常重试还是恶意重放。
4. 如怀疑平台证书泄露或配置漂移，立即轮换 `VEIL_WECHAT_PAY_PLATFORM_PUBLIC_KEY` / `VEIL_WECHAT_PAY_PLATFORM_SERIAL` 并冻结继续放量。

## Payment Fraud Signal Alert

`docs/alerting-rules.yml` 已将 `payment_fraud_signal` 接到 `VeilWechatPaymentFraudSignalsHigh`。

收到告警后执行：

1. 抓取 `/metrics`，确认 `veil_runtime_error_events_total{feature_area="payment",error_code="payment_fraud_signal"}` 的增长窗口和数量。
2. 打开 `/api/runtime/diagnostic-snapshot`，检查最近的 payment runtime error 与相关 `playerId`。
3. 在 analytics 或日志侧按 `signal` 聚合，优先识别 `duplicate_out_trade_no`、`openid_mismatch`、`amount_mismatch`、`high_velocity_purchases`。
4. 若是单个玩家异常，先冻结该玩家的人工补偿和高风险道具发放。
5. 若是候选版本级异常，暂停该 candidate 的继续提审 / 放量，并要求 backend on-call 审核最近支付变更。

## 支付流水审计日志格式

每次退款、争议、补偿、风控升级都必须至少记录以下字段：

| 字段 | 说明 |
| --- | --- |
| `recordedAt` | 处理时间，ISO-8601 |
| `operator` | 操作人 |
| `reviewer` | 审批人；无审批则写 `n/a` |
| `playerId` | 玩家 ID |
| `orderId` | 内部 `out_trade_no` |
| `transactionId` | 微信交易单号；未知时写 `pending` |
| `productId` | 商品 ID |
| `amountFen` | 金额，分 |
| `reason` | 退款、补偿、争议、风控升级原因 |
| `action` | `refund_requested` / `refund_completed` / `compensation_granted` / `dispute_opened` / `fraud_escalated` |
| `evidence` | 工单、截图、SQL 查询、artifact 路径 |

## 保留策略

- `payment_orders` 与 `payment_receipts` 不应接入 snapshot TTL 清理。
- 带支付环境的备份保留必须至少覆盖 3 年；最小要求是把 `VEIL_BACKUP_KEEP_WEEKLY_DAYS` 提升到 `1095` 或使用等效的冷归档策略。
- 审计日志、退款审批记录、争议证据与补偿记录必须与支付流水一起保留至少 3 年。
- 不允许只保留截图。最终留存必须能回溯到 `orderId`、`transactionId` 和审批结论。

## Release Checklist 挂钩

进入 WeChat release candidate / shipping candidate 前，额外确认：

- `docs/core-gameplay-release-readiness.md` 中的支付运维检查项已回填
- `docs/release-evidence/wechat-commercial-verification.example.json` 对应的 payment check 已附上本手册要求的证据
- `payment_fraud_signal` 告警路由和值班 owner 已确认
- 本次候选版本涉及支付改动时，至少演练一次“未到账补偿”或“重复回调幂等”路径
