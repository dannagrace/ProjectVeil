# ProjectVeil Reconnect Smoke Gate

本说明定义 `ProjectVeil` 唯一的断线恢复冒烟门禁，避免 H5、Cocos、微信提审时分别使用不同口径。

适用面：

- 本地开发回归：H5 / Lobby 调试壳
- release candidate 验收：Cocos Creator 预览、微信开发者工具、真机 / 准真机

## Canonical Scenario

唯一基准场景固定为：

1. 进入同一个候选包对应的房间，确认 `roomId` 与 `playerId` 已显示。
2. 在世界态先做一个可见且可回读的状态变化：
   - 默认基线使用 `tests/e2e/reconnect-recovery.spec.ts` 的路径
   - 角色从初始位置移动两次
   - 领取一次木材资源
3. 在状态变化已经落地后，主动触发一次恢复动作：
   - 本地：刷新页面
   - RC：切后台再回前台、断网再恢复、刷新或重进前台容器，三选一即可
4. 等待恢复完成，确认客户端回到原房间，并继续显示断线前已经发生的状态变化。

这条门禁的目标不是证明“重新连上了 socket”而已，而是证明“重新连上后仍回到同一权威房间，且权威世界状态未丢”。

## Automation Reference

- 本地 canonical smoke：`npm run test:e2e:smoke -- reconnect-recovery`
- 覆盖用例：`tests/e2e/reconnect-recovery.spec.ts`
- 辅助多人 / 结算恢复参考：
  - `npm run test:e2e:multiplayer:smoke -- pvp-reconnect-recovery`
  - `npm run test:e2e:multiplayer:smoke -- pvp-postbattle-reconnect`

若当前命令包装不支持测试名过滤，直接运行完整命令：

- `npm run test:e2e:smoke`
- `npm run test:e2e:multiplayer:smoke`

## Smoke Hardening Notes

当前 Playwright 冒烟链路针对两类高频假失败做了固定收口：

- reload / 刷新前必须先确认 reconnect token 已经写入存储，再触发页面恢复；不要用裸 `page.reload()` 直接赌时序。
- 多人房间断言前必须先确认 `session-meta`、`diagnostic-connection-status`、`room-connection-summary` 都已经回到稳定的“已连接”态，再判断玩法同步或结算结果。
- 若 spec 失败，优先查看 Playwright 附件里的 client automation state、diagnostic snapshot text/json，以及 server diagnostic snapshot text，先区分是房间未启动、客户端未完成握手，还是玩法状态真实回归。

这三条的目标是把“基础设施 / 启动时序问题”和“玩法断言失败”拆开，减少 CI 因偶发 race condition 误报。

## Minimum Success Signals

### Local Run

本地 H5 冒烟至少要看到以下 4 个可观察信号，缺一不可：

1. `session-meta` 仍显示原 `roomId`。
2. `event-log` 出现“连接已恢复”。
3. 角色移动力没有重置，仍保留断线前的消耗结果。
   - 当前基线值：`Move 4/6`
4. 世界状态没有回档。
   - 当前基线值：`Wood 5`

### Release-Candidate Run

RC 手工验收至少要记录以下最小信号，口径与本地一致：

1. 重新进入的是原房间。
   - 证据应能看见 `roomId`
2. UI 明确出现“已恢复连接 / reconnect recovered / 对等提示”之一。
3. 断线前做出的那一步状态变化仍存在。
   - 例如移动力减少、木材数量变化、房间阶段、战斗结果摘要
4. 恢复后仍能继续后续操作，而不是停留在假活着的卡死态。
   - 例如还能继续移动、继续战斗、或明确显示已回到世界态

推荐 RC 记录方式：

- Creator / WeChat 预览截图 1 张：能看到 `roomId`
- 恢复提示截图 1 张
- 恢复后状态截图 1 张：能看到移动力 / 资源 / 房间阶段中的至少一个关键值

## Failure Diagnostics

### 没有恢复到原房间

- 先看 `roomId`、`playerId` 是否与恢复前一致。
- 检查本地存储中的 reconnect token 是否存在：
  - H5：`project-veil:reconnection:<roomId>:<playerId>`
  - Cocos：`project-veil:cocos:reconnection:<roomId>:<playerId>`
- 若 token 不存在，优先排查存储写入是否被清理、禁用或使用了错误的房间 / 玩家标识。

### 看不到“连接已恢复”或等效提示

- 检查客户端是否先进入过 `reconnecting`，再转为 `reconnected`。
- 检查是否直接落到了 `reconnect_failed`。
- 关注客户端运行时反馈与事件日志：
  - H5：`apps/client/src/main.ts`、`apps/client/src/room-feedback.ts`
  - Cocos：`apps/cocos-client/assets/scripts/VeilRoot.ts`
- 若服务端日志出现 `FAILED_TO_RECONNECT` 或重连窗口超时，优先排查 `apps/server/src/colyseus-room.ts` 中的重连窗口和房间生命周期。

### 回到了原房间，但状态回档

- 对照断线前后的移动力、资源值、房间阶段、战斗结算摘要。
- 若 `roomId` 一致但状态丢失，优先看是否恢复到了旧快照或未同步的本地视图。
- 排查：
  - `apps/server/test/colyseus-persistence-recovery.test.ts`
  - `apps/client/test/reconnection-storage.test.ts`
  - `apps/cocos-client/test/cocos-runtime-memory.test.ts`

### RC 只在微信预览或真机失败

- 附上 `codex.wechat.smoke-report.json` 中 `reconnect-recovery` case。
- 同时保留：
  - 开发者工具 `Console` 截图
  - `Network` / socket 失败截图
  - 域名白名单或弱网切换告警截图
  - 对应 artifact 的 `sourceRevision` 与 `archiveSha256`
- 若本地 H5 通过而微信失败，优先排查容器存储权限、切后台生命周期、弱网恢复和域名配置，而不是先怀疑 shared 规则。

## Release Gate Usage

- 本地基线：至少跑一次 `tests/e2e/reconnect-recovery.spec.ts`
- RC 门禁：必须按本说明记录最小成功信号
- 微信提审：`codex.wechat.smoke-report.json` 的 `reconnect-recovery` case 必须能映射到本说明的同一条场景和同一组成功信号

若该门禁失败，候选包不能标记为发布就绪。
