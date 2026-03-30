# Cocos / WeChat RC Checklist Template

将本模板复制到当前 RC 的 `artifacts/release-evidence/` 或 PR 描述中回填。它不是 JSON 快照的替代品，而是帮助 reviewer 快速确认“这次 RC 是否已经把该补的证据补齐”。

## Candidate

- Candidate: `rc-YYYY-MM-DD`
- Surface: `creator_preview | wechat_preview | wechat_upload_candidate`
- Commit: `<git-sha>`
- Owner: `<name>`
- Date: `<YYYY-MM-DD>`
- Device / Client:
- Server / Environment:

## Linked Evidence

- [ ] Release readiness snapshot 已生成：
  `artifacts/release-readiness/<candidate>.json`
- [ ] Cocos RC snapshot 已生成并通过 `--check`：
  `artifacts/release-evidence/<candidate>.<surface>.json`
- [ ] 若为 WeChat RC，已附上 `codex.wechat.smoke-report.json`
- [ ] 若为上传候选包，已附上 `*.package.json` / `*.upload.json`

## Canonical Journey

- [ ] Lobby entry
  Evidence:
  Notes:
- [ ] Room join
  Evidence:
  Notes:
- [ ] Map explore
  Evidence:
  Notes:
- [ ] First battle
  Evidence:
  Notes:
- [ ] Reconnect / restore
  Evidence:
  Notes:
- [ ] Return to world
  Evidence:
  Notes:

## Required Evidence

- [ ] `roomId` 已记录，且截图/录屏中可见
  Value:
  Evidence:
- [ ] `reconnectPrompt` 已记录，且与 reconnect gate 口径一致
  Value:
  Evidence:
- [ ] `restoredState` 已记录，能证明恢复后未回档
  Value:
  Evidence:
- [ ] `firstBattleResult` 已记录，包含胜负与关键结算结果
  Value:
  Evidence:

## WeChat-Specific Checks

- [ ] 登录进入 Lobby 或游客降级结果已记录
- [ ] 进房成功并记录 `roomId`
- [ ] `reconnect-recovery` 已复用 `docs/reconnect-smoke-gate.md` 的 canonical scenario
- [ ] 分享回流已验证，或明确标记 `not_applicable`
- [ ] 关键资源加载无 404 / 白名单 / 缺图阻断
- [ ] 真机或准真机设备、客户端版本、执行时间已记录

## Release Decision

- Decision: `ship | hold | ship-with-followups`
- Summary:
- Remaining blockers doc:
- Follow-ups / owners:

