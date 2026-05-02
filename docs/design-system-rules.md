# Project Veil Design-System Rules

`configs/project-veil-design-tokens.json` is the repo-level source of truth for Figma-to-code work. Figma payloads should be translated into this contract first, then mapped into the target runtime instead of pasting raw generated styles into H5 or Cocos files.

## Canonical Sources

- Tokens: `configs/project-veil-design-tokens.json`
- H5 gameplay shell: `apps/client/src/styles.css`
- H5 admin/config surfaces: `apps/client/src/config-center.css`
- Cocos primary runtime presentation: `configs/cocos-presentation.json` and `apps/cocos-client/assets/scripts/cocos-presentation-readiness.ts`

## Token Mapping

- Color roles map to CSS variables in H5 and to named presentation states in Cocos.
- Typography keeps HUD labels, panel titles, and body text separate; do not scale type by viewport width.
- Spacing and radius values are shared by intent. Cocos may round to whole-pixel node layout values when Creator requires it.
- `componentRoles.assetStageChip` is the shared vocabulary for placeholder/prototype/production asset status in H5 diagnostics, Cocos readiness, and release summaries.

## Figma-to-Code Checklist

- Capture design context: target surface, viewport, gameplay state, safe area, and candidate revision.
- Resolve token roles before implementation: color, type, spacing, radius, status tone, and asset stage.
- Map components to existing runtime surfaces: H5 lobby/HUD, admin/config panels, or Cocos Lobby/HUD/battle overlays.
- Keep visual assets as real bitmap or Cocos resources; do not replace inspectable game art with decorative gradients.
- Verify with screenshots or visual evidence: desktop/H5, mobile/H5 where relevant, Creator preview, and WeChat safe-area evidence for Cocos release work.
- Record intentional divergence in the PR or release evidence when a Figma value cannot map cleanly to Cocos Creator constraints.

## Exceptions

- Cocos animation, audio, and sprite delivery are governed by `configs/cocos-presentation.json`; design tokens only name status and layout roles.
- Admin/config-center pages may use denser spacing than gameplay HUDs, but they must still use the same color/status vocabulary.
- Temporary prototype assets must stay marked as `prototype` or `placeholder` until release evidence promotes them.
