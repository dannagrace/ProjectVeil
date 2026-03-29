# Cocos / WeChat RC Blocker Template

用于记录 release candidate 的未决风险。没有 blocker 也要保留一份，明确写 `none`，避免 reviewer 误以为记录缺失。

## Candidate

- Candidate: `rc-YYYY-MM-DD`
- Surface: `creator_preview | wechat_preview | wechat_upload_candidate`
- Commit: `<git-sha>`
- Owner: `<name>`
- Last updated: `<YYYY-MM-DD HH:mm TZ>`
- Release decision: `ship | hold | ship-with-followups`

## Blocker Rules

- `P0`: 不允许放行；必须修复或显式降级范围后重验
- `P1`: 可在受控范围内放行，但必须有 owner、时间窗口和回退方案
- `P2`: 不阻断 RC，但要保留后续收口动作

## Current Blockers

| ID | Severity | Area | Summary | Evidence | Owner | Exit Criteria | Next Update | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | n/a | n/a | No open blockers at handoff time. | `artifacts/release-evidence/<candidate>.<surface>.json` | `<name>` | n/a | n/a | closed |

若存在实际 blocker，把 `none` 行替换成真实记录，并保持每项都包含：

- `Evidence`: 直接指向 RC snapshot、smoke report、截图、日志或 artifact
- `Exit Criteria`: 明确到“什么条件满足后才能关闭”
- `Next Update`: 下次同步时间，避免 blocker 变成无人维护的注释
- `Status`: `open | mitigated | closed`

## Release Owner Notes

- 放行理由：
- 若带风险放行，限制范围：
- 回退动作：

