# 客户端 / 服务端兼容矩阵

## 目的

当服务端协议发生不兼容变更时，服务端需要拒绝过旧客户端，避免旧包继续进入房间循环后触发不可恢复的运行时错误。

## 当前约定

| 项目 | 说明 |
| --- | --- |
| 握手字段 | `connect` 握手会携带 `clientVersion` |
| 当前客户端默认版本 | `1.0.3` |
| 服务端最小支持版本 | `MIN_SUPPORTED_CLIENT_VERSION` |
| 服务端拒绝码 | `upgrade_required` |
| 客户端 UX | 收到 `upgrade_required` 后停留在大厅，并提示必须升级 |

## 兼容矩阵

| 客户端版本 | `MIN_SUPPORTED_CLIENT_VERSION=0.0.0` | `MIN_SUPPORTED_CLIENT_VERSION=1.0.3` |
| --- | --- | --- |
| 未携带 / 非法版本 | 允许接入，兼容旧环境 | 拒绝，返回 `upgrade_required` |
| `1.0.2` | 允许接入 | 拒绝，返回 `upgrade_required` |
| `1.0.3` | 允许接入 | 允许接入 |
| `1.0.4+` | 允许接入 | 允许接入 |

## 发布操作

1. 先发新版客户端，确认渠道包可用。
2. 再把服务端 `MIN_SUPPORTED_CLIENT_VERSION` 提升到目标版本。
3. 观察 `upgrade_required` 命中量，确认旧包流量已经被拦截。
4. 若需要灰度，先在预发布或单独环境提高该配置，再推广到正式环境。

## 回退原则

- 如果新版客户端出现阻塞性问题，可以先把 `MIN_SUPPORTED_CLIENT_VERSION` 下调，临时恢复旧版接入。
- 下调后仍要尽快修复新版包，避免长期维持多协议并存。
