# 微信小游戏构建校验与发布说明

## 自动化边界

- CI 入口：GitHub Actions `wechat-build-validation`
- 执行命令：`npm run check:cocos-release-readiness`
- 当前自动化会做三件事：
  - 校验 `apps/cocos-client/wechat-minigame.build.json` 生成出的模板产物是否已经提交且未漂移
  - 校验 `apps/cocos-client/build-templates/wechatgame/` 中必需文件是否齐全
  - 通过仓库内导出夹具校验注入配置、运行时 bootstrap 文件、主包 / 分包预算，以及运行时域名白名单缺口告警
- 当前自动化额外会校验一份确定性的发布元数据：`codex.wechat.release.json`
  - 清单内包含导出目录文件列表、字节数、SHA-256、主包 / 分包体积汇总，以及可选的源码 revision 标识
- 当前自动化可把已校验导出目录打成确定性的 `tar.gz` 发布包，并输出 sidecar 元数据 `codex.wechat.package.json`
  - sidecar 会记录归档文件名、SHA-256、字节数、导出目录来源，以及归档内文件清单摘要
- 当前自动化还会运行 `npm run audit:cocos-primary-delivery`，把 primary client 的导出校验与 artifact 校验收口成一份简明 JSON / Markdown 摘要
- 当 PR 改动 `apps/cocos-client/**`、`scripts/cocos-*`、`scripts/*release*`、`docs/cocos-*` 或微信小游戏打包路径时，CI 会额外运行 `npm run test:cocos:primary-journey` 与 `npm run release:cocos:primary-diagnostics`
  - 结果会统一上传为 GitHub Actions artifact `cocos-release-packaging-evidence-<sha>`，其中固定包含 `SUMMARY.md`，并在成功时附带 primary delivery audit 与 primary-client diagnostics 的 JSON / Markdown 证据
  - 若任一证据缺失，`SUMMARY.md` 会明确指出缺失的是 delivery audit 还是 diagnostics artifact，并给出对应回归命令
- CI 会把上述归档与 sidecar 元数据作为 GitHub Actions artifact `wechat-release-<sha>` 上传，供提审前下载、留档与回滚追溯
- CI 额外会把刚上传的 artifact 再下载一次，并运行 `npm run verify:wechat-release` 做 artifact 级 smoke 验收
- GitHub Actions 现支持在 `workflow_dispatch` 时显式开启 `upload`，或推送 `wechat-release-<version>` tag 后自动执行 `miniprogram-ci` 上传
  - 上传前仍会保留 `verify:wechat-release` smoke 验收
  - 若仓库未配置微信上传 secret，上传 job 会在 summary 中记录 skipped，而不会让 workflow 失败
  - 上传成功后会生成额外 sidecar `*.upload.json`，记录版本号、commit、上传时间和微信回执摘要

## 本地执行

- 刷新模板：`npm run prepare:wechat-build`
- 生成发布元数据：`npm run prepare:wechat-release -- --output-dir <wechatgame-build-dir> --expect-exported-runtime [--source-revision <git-sha>]`
- 产出发布归档：`npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime [--source-revision <git-sha>]`
- 聚合校验 RC artifact：`npm run validate:wechat-rc -- --artifacts-dir <release-artifacts-dir> [--expected-revision <git-sha>] [--version <wechat-version>] [--require-smoke-report] [--manual-checks docs/release-evidence/wechat-release-manual-review.example.json]`
- 发布彩排与汇总：`npm run release:wechat:rehearsal -- --build-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> [--summary <json>] [--markdown <md>]`（顺序执行 prepare / package / verify / validate，并输出结构化 + Markdown 摘要）
- 上传已打包产物：`npm run upload:wechat-release -- --artifacts-dir <release-artifacts-dir> --version <wechat-version> [--desc <upload-desc>]`
- 按 SHA 下载 CI artifact：`npm run download:wechat-release -- --sha <git-sha> [--output-dir artifacts/downloaded/wechat-release-<git-sha>]`
- 验收已下载 artifact：`npm run verify:wechat-release -- --artifacts-dir <downloaded-artifact-dir> [--expected-revision <git-sha>]`
- 生成 / 校验真机冒烟报告：`npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir> [--report <report-path>] [--runtime-evidence <runtime-evidence.json>] [--check --expected-revision <git-sha>]`
- 导入自动化设备/runtime 证据：`npm run ingest:wechat-smoke-evidence -- --metadata <release-sidecar.package.json> --report <release-artifacts-dir>/codex.wechat.smoke-report.json --runtime-evidence <runtime-evidence.json>`
- 统一断线恢复门禁：`docs/reconnect-smoke-gate.md`
- 统一 Cocos RC candidate bundle：`npm run release:cocos-rc:bundle`（会自动先跑 `npm run release:cocos:primary-journey-evidence`）
- Primary client delivery checklist：`docs/cocos-primary-client-delivery.md`
- Cocos Phase 1 占位 / fallback 表现签核：`docs/cocos-phase1-presentation-signoff.md`
- WeChat runtime observability 签核：`docs/wechat-runtime-observability-signoff.md`
- WeChat runtime observability 签核模板：`docs/release-evidence/wechat-runtime-observability-signoff.template.md`
- Primary client delivery audit：`npm run audit:cocos-primary-delivery -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime [--expected-revision <git-sha>]`
- PR 包装改动门禁：匹配上述路径时，查看 CI artifact `cocos-release-packaging-evidence-<git-sha>`
- RC 检查清单模板：`docs/release-evidence/cocos-wechat-rc-checklist.template.md`
- RC blocker 模板：`docs/release-evidence/cocos-wechat-rc-blockers.template.md`
- WeChat 手工复核 contract 示例：`docs/release-evidence/wechat-release-manual-review.example.json`
- 只做 CI 同款校验：`npm run check:cocos-release-readiness`
- 校验真实导出目录：`npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`

## 上传凭据

- GitHub Actions secrets：
  - `WECHAT_MINIPROGRAM_APPID`：目标小游戏 appid
  - `WECHAT_MINIPROGRAM_PRIVATE_KEY`：微信开放平台下载的 PEM 私钥原文
  - `WECHAT_MINIPROGRAM_PRIVATE_KEY_BASE64`：若不方便直接存多行 PEM，可改存 base64；与上项二选一
- 本地环境变量：
  - `WECHAT_MINIPROGRAM_APPID`
  - `WECHAT_MINIPROGRAM_PRIVATE_KEY` 或 `WECHAT_MINIPROGRAM_PRIVATE_KEY_BASE64`
  - 可选：`WECHAT_MINIPROGRAM_VERSION`、`WECHAT_MINIPROGRAM_DESC`、`WECHAT_MINIPROGRAM_ROBOT`
- 也可通过 CLI 传参覆盖：
  - `--appid <appid>`
  - `--private-key-path <pem-path>`
  - `--version <wechat-version>`
  - `--desc <upload-desc>`
  - `--robot <robot-id>`

## 发布步骤

1. 先更新 `apps/cocos-client/wechat-minigame.build.json` 中的 `appid`、远程资源地址、预算和域名清单。
2. 运行 `npm run prepare:wechat-build`，确认 `apps/cocos-client/build-templates/wechatgame/` 产物已更新。
3. 在 Cocos Creator 中执行 `wechatgame` 正式导出，并把模板目录内容合入导出目录。
4. 对真实导出目录执行 `npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`。
5. 运行 `npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime [--source-revision <git-sha>]`，生成包含 `codex.wechat.release.json` 的归档包与 sidecar 元数据。
6. 运行 `npm run verify:wechat-release -- --artifacts-dir <release-artifacts-dir> [--expected-revision <git-sha>]`，在上传前先做一次本地 artifact 级冒烟验收。
7. 如需把 sidecar、归档、smoke、manual review 与可选 upload receipt 收口成同一条 candidate-level 证据，运行 `npm run validate:wechat-rc -- --artifacts-dir <release-artifacts-dir> [--expected-revision <git-sha>] [--version <wechat-version>] [--require-smoke-report] [--manual-checks docs/release-evidence/wechat-release-manual-review.example.json]`。
   - 该命令会稳定输出 `codex.wechat.rc-validation-report.json`
   - 同目录还会输出 `codex.wechat.release-candidate-summary.json` 与 `.md`，把 package、validation、smoke、upload、manual review 汇总到同一个 revision
   - summary 中缺失 smoke 证据或待完成 manual review 会直接列为 `blockers`，而不是分散在多个文件里
   - JSON 至少包含 `version`、`commit`、artifact 路径、逐项检查结果和 `failureSummary`
   - `--version` 会要求并校验 `*.upload.json`；`--require-smoke-report` 会把 `codex.wechat.smoke-report.json` 设为必需门禁
  - 若未显式传 `--manual-checks`，脚本仍会内置四条必需 manual review：微信开发者工具真实导出复核、真机 runtime 复核、runtime observability sign-off，以及 RC checklist/blocker review
   - required manual review 现在必须带 `owner`、`recordedAt`、`revision`；当 review 时间超过 24h、revision 不匹配或元数据缺失时，candidate summary 会继续保持 `blocked`
8. 若已有设备农场、真机调试或准真机脚本产出的结构化 runtime 证据，执行 `npm run ingest:wechat-smoke-evidence -- --metadata <release-sidecar.package.json> --report <release-artifacts-dir>/codex.wechat.smoke-report.json --runtime-evidence <runtime-evidence.json>`，把证据直接写入既有 `codex.wechat.smoke-report.json` schema。
9. 若本次 RC 没有自动化 runtime 证据，再运行 `npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir>` 生成模板，并在真机或准真机上逐项补录结果。
10. 完成自动导入或人工补录后，执行 `npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir> --check [--expected-revision <git-sha>]`，确认登录、进房、重连、分享回流、关键资源加载都已有结果记录。
   - `reconnect-recovery` 必须复用 [`docs/reconnect-smoke-gate.md`](./reconnect-smoke-gate.md) 的 canonical scenario、最小成功信号和失败诊断口径。
11. 按 [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md) 与 [`docs/release-evidence/wechat-runtime-observability-signoff.template.md`](./release-evidence/wechat-runtime-observability-signoff.template.md) 为同一 candidate revision 回填 runtime observability sign-off，确认 release 环境的 `/api/runtime/health`、`/api/runtime/diagnostic-snapshot`、`/api/runtime/metrics` 都已有可追溯证据，并记录 reviewer 与 `recordedAt`。
12. 运行 `npm run release:cocos-rc:bundle -- --candidate <candidate-name> --build-surface wechat_preview --wechat-smoke-report <release-artifacts-dir>/codex.wechat.smoke-report.json [--release-readiness-snapshot artifacts/release-readiness/<candidate>.json]`，脚本会先自动生成 candidate+revision 命名的 `cocos-primary-journey-evidence` JSON / Markdown 与 milestone diagnostics，再一次性输出 bundle manifest、Markdown 摘要、RC snapshot、checklist 与 blockers，并把微信 smoke 的 Lobby / 进房 / 重连证据并入统一的 Cocos RC 快照；若设备 evidence 缺失，会在快照和摘要里显式标成 `partial` 或 `blocked`，而不是默认为通过。
13. 直接回填同一 bundle 里的 checklist / blockers 文件，仅补充自动化未覆盖的设备、observability 结论和 blocker；不要再额外复制模板或在 PR 里发明另一套字段。
14. 运行 `npm run upload:wechat-release -- --artifacts-dir <release-artifacts-dir> --version <wechat-version> [--desc <upload-desc>]`，脚本会先复用 `verify:wechat-release` 验收，再调用 `miniprogram-ci` 上传，并在 artifact 目录旁写入 `*.upload.json` 回执。
15. 将远程资源上传到 CDN，并在微信后台 / 开发者工具中完成提审。

## 发布彩排摘要

`npm run release:wechat:rehearsal` 用于把准备 / 打包 / 验证 / RC 聚合这四个阶段一次跑完，并把结果写成稳定的 CI 证据：

- 默认读取 `apps/cocos-client/wechat-minigame.build.json`，也可用 `--build-dir` / `--artifacts-dir` 覆盖输入输出。
- 顺序执行 `prepare:wechat-release`、`package:wechat-release`、`verify:wechat-release`、`validate:wechat-rc`，任一阶段失败后续阶段会被标记为 `skipped`。
- 结构化摘要默认写到 `artifacts/wechat-release/wechat-release-rehearsal-<short-sha>.json`，Markdown 摘要写到同名 `.md`；可通过 `--summary` / `--markdown` 改写路径。
- JSON 摘要包含阶段命令、耗时、stdout / stderr tail 以及首个失败阶段的诊断，Markdown 版本可直接贴到 CI Summary 或 PR。
- `--source-revision`、`--expected-revision`、`--package-name`、`--version`、`--require-smoke-report` 会透传给对应脚本，方便对齐真实提审参数。
- 适合在本地 release rehearsal、或在 CI 下载模板导出夹具时，一次性确认整个链路仍能跑通。


## 下载与验收

给定某次构建 SHA，可用以下方式标准化下载并验收对应发布包：

1. 下载 artifact：`npm run download:wechat-release -- --sha <git-sha>`
2. 复核 sidecar、release manifest 与 smoke 清单：`npm run verify:wechat-release -- --artifacts-dir artifacts/downloaded/wechat-release-<git-sha> --expected-revision <git-sha>`
3. 生成真机冒烟模板：`npm run smoke:wechat-release -- --artifacts-dir artifacts/downloaded/wechat-release-<git-sha>`
4. 完成真机 / 准真机检查后校验结果：`npm run smoke:wechat-release -- --artifacts-dir artifacts/downloaded/wechat-release-<git-sha> --check --expected-revision <git-sha>`
5. 如需直接提审上传，可执行 `npm run upload:wechat-release -- --artifacts-dir artifacts/downloaded/wechat-release-<git-sha> --version <wechat-version>`

`verify:wechat-release` 默认会完成以下检查：

- sidecar 中记录的归档文件名、字节数、SHA-256 是否与下载产物一致
- `codex.wechat.release.json` 是否存在，且 `sourceRevision` 与 sidecar / 目标 revision 一致
- `game.json`、`project.config.json`、`codex.wechat.build.json`、`README.codex.md`、`game.js`、`application.js`、`src/settings.json` 是否齐全
- release manifest 中记录的文件列表、字节数、SHA-256 是否与归档内真实内容一致
- `project.config.json` / `codex.wechat.build.json` 是否仍指向微信小游戏构建

`validate:wechat-rc` 会在 `verify:wechat-release` 之上额外统一输出一份稳定 JSON 报告，并收口以下门禁：

- release sidecar 基本字段是否完整，SHA / 字节数 / fileCount 是否具备有效形状
- artifact 归档与 sidecar 是否仍能通过 `verify:wechat-release`
- 若存在 `codex.wechat.smoke-report.json`，则复用 `smoke:wechat-release --check` 校验其结果；传 `--require-smoke-report` 时缺失也会直接失败
- 若存在 `*.upload.json`，则校验其与 sidecar 的 archive / SHA / commit 一致；传 `--version <wechat-version>` 时会把 upload receipt 设为必需并校验版本号

同时 `validate:wechat-rc` 现在会为 reviewer 生成一份 candidate summary：

- `codex.wechat.release-candidate-summary.json`：candidate-level contract，固定引用同一 revision 的 package、validation、smoke、upload、manual review 状态
- `codex.wechat.release-candidate-summary.md`：可直接贴进 PR、CI summary 或提审记录的精简摘要；会额外展开 WeChat 设备/runtime 执行人、设备、执行时间、五个 smoke case 状态，以及 reconnect/share 的结构化字段
- `blockers`：显式列出缺失 smoke report、失败校验、待完成 manual review，以及对应 artifact / next command；若 smoke report 的 `execution.executedAt` 缺失、非法或早于 summary 生成时间 24h，也会直接阻塞 candidate
- `--manual-checks <json>`：读取显式 manual review 状态；推荐直接从 `docs/release-evidence/wechat-release-manual-review.example.json` 复制当次 candidate 文件
- `--manual-check <id>:<title>`：临时追加一条 pending manual review
- `npm run release:wechat:rehearsal` 的 `## Artifacts` 区块会自动列出 `codex.wechat.release-candidate-summary.json` / `.md`，方便 reviewer 或 PR 作者直接复制 `.md` 文件内容到评论区，并将 `.json` 作为结构化证据随 artifact 一起上传

推荐的 manual review JSON 现在至少包含：

- `owner`
- `recordedAt`
- `revision`
- `artifactPath`
- 对 checklist/blocker review 可额外补 `blockerIds`
- 若为带条件放行，可补 `waiver.approvedBy` / `waiver.approvedAt` / `waiver.reason`

默认 required checks 分别对应三类 release evidence：

- `wechat-devtools-export-review`：真实导出目录已在微信开发者工具中导入并成功启动
- `wechat-device-runtime-review`：同一 revision 已完成真机或微信开发者工具真机调试 runtime smoke，并附上 `codex.wechat.smoke-report.json`、`login-lobby`、`room-entry`、`reconnect-recovery`、`share-roundtrip`、`key-assets` 对应 capture
- `wechat-runtime-observability-signoff`：同一 candidate revision 的 release 环境已复核 `/api/runtime/health`、`/api/runtime/diagnostic-snapshot`、`/api/runtime/metrics`，并记录 reviewer、`recordedAt`、任何告警或接受风险
- `wechat-release-checklist`：RC checklist / blocker register 已对齐同一 candidate

## 提审前 Smoke Check

`npm run smoke:wechat-release` 会生成 `codex.wechat.smoke-report.json`，也可以通过 `--runtime-evidence <runtime-evidence.json>` 直接把自动化设备/runtime 结果导入同一 schema。该文件是提审前必须保留的最小验收记录，建议直接随 artifact 归档保存。

最小必填项如下：

- `login-lobby`：验证微信小游戏登录或游客降级后能进入 Lobby，并记录首屏异常
- `room-entry`：验证从 Lobby 创建 / 加入房间成功
- `reconnect-recovery`：验证断网、切后台或网络切换后的自动重连 / 恢复
- `share-roundtrip`：验证分享链路与回流后房间号 / 邀请参数恢复
- `key-assets`：验证首屏、Lobby、房间或首场战斗关键资源加载无白名单 / 缺图 / 404

其中两条 case 额外带有强制结构化证据字段，`--check` 时会直接校验：

- `reconnect-recovery.requiredEvidence.roomId`：恢复后确认仍在原权威房间
- `reconnect-recovery.requiredEvidence.reconnectPrompt`：记录“连接已恢复”或等效恢复提示
- `reconnect-recovery.requiredEvidence.restoredState`：记录恢复后未回档的关键状态
- `share-roundtrip.requiredEvidence.shareScene`：记录从 Lobby / 世界 / 战斗中的哪个入口触发分享
- `share-roundtrip.requiredEvidence.shareQuery`：记录分享 query 或等效 payload 摘要，至少覆盖 `roomId` / `inviterId` 等关键参数
- `share-roundtrip.requiredEvidence.roundtripState`：记录回流后识别到的房间号、邀请参数或恢复到的界面状态

推荐执行方式：

1. 先跑 `npm run verify:wechat-release -- --artifacts-dir <release-artifacts-dir> [--expected-revision <git-sha>]`
2. 若已有自动化设备/runtime 证据，执行 `npm run ingest:wechat-smoke-evidence -- --metadata <release-sidecar.package.json> --report <release-artifacts-dir>/codex.wechat.smoke-report.json --runtime-evidence <runtime-evidence.json>`
3. 若没有自动化证据，再跑 `npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir>` 生成模板
4. 先在微信开发者工具中导入同一 revision 的真实 `wechatgame` 导出目录并记录启动结果，再在真机或微信开发者工具真机调试模式中逐项填写 `tester`、`device`、`executedAt`、`summary` 以及每个 case 的 `status` / `notes` / `evidence`
   - `reconnect-recovery.requiredEvidence` 下的 `roomId`、`reconnectPrompt`、`restoredState` 都必须填非空字符串；细则见 [`docs/reconnect-smoke-gate.md`](./reconnect-smoke-gate.md)
   - `share-roundtrip.requiredEvidence` 下的 `shareScene`、`shareQuery`、`roundtripState` 也都必须填非空字符串，用来说明分享入口、参数和回流结果
5. 回填完成后执行 `npm run smoke:wechat-release -- --artifacts-dir <release-artifacts-dir> --check [--expected-revision <git-sha>]`
6. 再执行 `npm run release:cocos-rc:bundle -- --candidate <candidate-name> --build-surface wechat_preview --wechat-smoke-report <release-artifacts-dir>/codex.wechat.smoke-report.json`，把 `login-lobby`、`room-entry`、`reconnect-recovery` 自动映射到统一 RC 快照，同时保留同一 revision 的 primary-client canonical journey evidence，并在 `artifacts/release-readiness/` 生成可直接附到 CI artifact / PR 评论的 bundle 摘要；若设备 evidence 缺失，快照会标成 `blocked`，避免在 RC 汇总里被误判为通过。
7. 回填同一 bundle 里的 checklist / blockers 文件，并同步附上 [`docs/cocos-phase1-presentation-signoff.md`](./cocos-phase1-presentation-signoff.md) 与 [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md) 的当前结论，确保 reviewer 能直接看到当前 RC 的设备、observability 结论与未关闭风险。

### 自动化 Runtime Evidence Schema

`--runtime-evidence` 读取的是一个轻量 JSON，目标不是定义新 gate，而是把现有设备/runtime 观测写回 `codex.wechat.smoke-report.json`：

```json
{
  "schemaVersion": 1,
  "buildTemplatePlatform": "wechatgame",
  "artifact": {
    "archiveFileName": "veil-wechat-rc.tar.gz",
    "archiveSha256": "<sha256>",
    "sourceRevision": "<git-sha>"
  },
  "execution": {
    "tester": "device-farm",
    "device": "iPhone 15 Pro / WeChat 8.0.50",
    "clientVersion": "8.0.50",
    "executedAt": "2026-03-31T10:00:00+08:00",
    "result": "passed",
    "summary": "Automated device smoke evidence imported."
  },
  "cases": [
    { "id": "startup", "status": "passed", "notes": "cold start ok", "evidence": ["startup.mp4"] },
    { "id": "lobby-entry", "status": "passed", "notes": "lobby ok", "evidence": ["lobby.png"] },
    { "id": "room-entry", "status": "passed", "notes": "room ok", "evidence": ["room.png"] },
    {
      "id": "reconnect-recovery",
      "status": "passed",
      "requiredEvidence": {
        "roomId": "room-alpha",
        "reconnectPrompt": "连接已恢复",
        "restoredState": "Returned to the same room and HUD state."
      }
    },
    { "id": "share-roundtrip", "status": "not_applicable" },
    { "id": "key-assets", "status": "passed", "notes": "no 404 or whitelist error" }
  ]
}
```

- `startup` 与 `lobby-entry` 会合并写回现有 `login-lobby` case。
- `blocked` 明确表示“设备/runtime 证据未完成”，RC summary 会把它和真正的 `failed` 区分开。
- `reconnect-recovery.requiredEvidence` 仍是必填结构化字段，用来保证恢复路径不再只存在于人工备注中。

若某项因当前包能力受限无法完整验证，可把 case 标记为 `not_applicable`，并在 `notes` 中写明原因与替代观察证据；其余必填项不得保留 `pending`。若因此形成风险，必须同步写入 blocker 模板，而不是只留在 smoke report 备注里。

## 回滚演练

以下步骤用于演练如何恢复到某个历史 revision，对应 issue #141 的“可下载、可回退、可追溯”目标：

1. 选择目标 revision：确认要恢复的 Git SHA，例如 `<rollback-sha>`。
2. 下载历史包：`npm run download:wechat-release -- --sha <rollback-sha> --output-dir artifacts/rollback/<rollback-sha>`
3. 验证历史包：`npm run verify:wechat-release -- --artifacts-dir artifacts/rollback/<rollback-sha> --expected-revision <rollback-sha>`
4. 解压并恢复构建目录：`tar -xzf artifacts/rollback/<rollback-sha>/*.tar.gz -C artifacts/rollback/<rollback-sha>/extracted`
5. 切换远程资源：把 CDN 指向该历史包对应的资源版本，或同步恢复其资源目录快照。
6. 在微信开发者工具中导入 `artifacts/rollback/<rollback-sha>/extracted/<package-name>/wechatgame`，确认能启动并完成最小 smoke check。
7. 记录演练结果：保存使用的 SHA、artifact 名称、验收结果和恢复时间，确保后续回滚步骤不依赖人工记忆。

- 构建模板或配置回滚：回退 `apps/cocos-client/wechat-minigame.build.json` 与 `apps/cocos-client/build-templates/wechatgame/`
- CI 导出夹具回滚：若只是校验夹具与脚本演进不一致，可同步回退 `apps/cocos-client/test/fixtures/wechatgame-export/`
- CDN 资源回滚：切回上一个静态资源目录版本
- 小游戏包回滚：在微信开发者工具 / 平台侧重新上传上一个已验证通过的构建目录

当前仓库默认仍不会在 `main` 分支 push 上自动上传；只有手动 `workflow_dispatch` 显式开启 `upload`，或推送 `wechat-release-<version>` tag 时，才会尝试调用微信上传接口。
