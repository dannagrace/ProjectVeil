# Issue #33 资产集成约定

Issue [#33](https://github.com/dannagrace/ProjectVeil/issues/33) 的完整交付依赖正式像素资源、Spine 动画和音频素材。本仓库当前先把“如何合法、安全、可验证地接入这些资源”固定下来，避免未来引入免费或商业美术包时再次修改代码结构。

## 当前状态

- `configs/assets.json` 已作为运行时 manifest，继续承载 H5 / Cocos 共用的稳定资源 key。
- 仓库内现有 `/assets/pixel/**` 仍是由 Cocos 占位资源同步出的预演素材，不应误标为正式量产资产。
- Cocos 侧动画适配层 `VeilUnitAnimator` 已支持 `sp.Skeleton` 和时间轴动画，但还没有对应的正式 skeleton 数据落库。
- 音频目前仍是运行时 fallback，没有正式 BGM / SFX 资产包与映射清单。

## 本次约定

本地接入开源资源时，统一把未提交到仓库的素材放进：

`external-assets/issue-33-open-source`

该目录会被 `.gitignore` 忽略，用于放置下载后的免费像素包、许可证文本和人工整理后的二次导出结果。仓库通过 `npm run check:issue33-assets -- --require-pack` 校验它是否满足 issue #33 的最小落库合同。

## 目录合同

以下路径是校验脚本要求的最小交付面：

```text
external-assets/issue-33-open-source/
  manifest.json
  LICENSE.txt
  heroes/
    hero-01.png
    hero-02.png
    hero-03.png
    hero-04.png
  units/
    unit-01.png
    unit-02.png
    unit-03.png
    unit-04.png
    unit-05.png
    unit-06.png
    unit-07.png
    unit-08.png
  terrain/
    grass.png
    mountain.png
    water.png
    desert.png
    snow.png
  buildings/
    recruitment-post.png
    attribute-shrine.png
    resource-mine.png
    forge.png
  spine/
    idle/
    attack/
    hit/
    death/
  audio/
    bgm-explore.ogg
    bgm-battle.ogg
    sfx-attack.ogg
    sfx-skill.ogg
    sfx-hit.ogg
    sfx-levelup.ogg
```

## manifest.json 建议字段

建议至少记录：

- `packName`
- `sourceUrl`
- `license`
- `author`
- `exportedBy`
- `exportedAt`
- `notes`
- `mappings`

`mappings` 用于写明外部资源文件和 Project Veil 稳定槽位之间的关系，例如 `terrain.grass.default`、`unit.hero_guard_basic.idle`、`audio.bgm.explore`。

## 与运行时 key 的关系

- 当前运行时实际只存在 2 个单位模板和 3 个建筑种类，因此 issue 里要求的“4 英雄 / 8 单位 / 4 建筑”还不能全部映射进 `configs/assets.json`。
- 本文档先把素材落库合同固定住；后续新增 gameplay key 时，再把对应资源提升到 `configs/assets.json` 的正式映射。
- 现有 `/assets/pixel/**` 条目在 manifest 中标记为 `prototype`，表示它们已经是像素资源接入链路的一部分，但仍不是最终验收素材。

## 推荐流程

1. 下载并审查可商用或兼容项目分发方式的免费像素包。
2. 把原始包和许可证放进 `external-assets/issue-33-open-source`。
3. 按上面的目录合同整理导出图集、音频和 Spine 数据。
4. 运行 `npm run check:issue33-assets -- --require-pack`。
5. 完成筛选后，再按 gameplay key 和客户端实际使用路径逐步更新 `configs/assets.json`、Cocos 资源目录和加载逻辑。

## 未完成项

以下内容仍然依赖外部正式素材，因此本次 PR 不伪造完成：

- issue 中要求的 16x16 英雄头像、32x32 单位精灵、64x64 地形、256x256 建筑正式资源替换
- Spine skeleton / atlas / json 实际接入
- BGM / SFX 正式播放配置
- Cocos 端压缩参数与真实加载时长压测
