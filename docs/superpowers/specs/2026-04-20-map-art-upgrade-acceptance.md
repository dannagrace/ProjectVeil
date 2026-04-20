# 2026-04-20 Map Art Upgrade Acceptance

## Scope Closed

This acceptance closes the map-art upgrade defined in:

- `docs/superpowers/specs/2026-04-20-map-art-upgrade-design.md`

Delivered scope:

- terrain tiles
- fog and hidden-state presentation
- building landmark art
- map resource-node art

Explicitly not changed:

- unit portraits and unit sprites
- HUD or button iconography
- map rules, collision, pathfinding, and gameplay logic

## Asset Surfaces Updated

### Terrain

- `apps/cocos-client/assets/resources/pixel/terrain/grass-tile.png`
- `apps/cocos-client/assets/resources/pixel/terrain/grass-tile-alt.png`
- `apps/cocos-client/assets/resources/pixel/terrain/dirt-tile.png`
- `apps/cocos-client/assets/resources/pixel/terrain/dirt-tile-alt.png`
- `apps/cocos-client/assets/resources/pixel/terrain/sand-tile.png`
- `apps/cocos-client/assets/resources/pixel/terrain/sand-tile-alt.png`
- `apps/cocos-client/assets/resources/pixel/terrain/water-tile.png`
- `apps/cocos-client/assets/resources/pixel/terrain/water-tile-alt.png`
- `apps/cocos-client/assets/resources/pixel/terrain/hidden-tile.png`
- `apps/cocos-client/assets/resources/pixel/terrain/hidden-tile-alt.png`
- `apps/cocos-client/assets/resources/pixel/terrain/hidden-tile-deep.png`
- `apps/cocos-client/assets/resources/pixel/terrain/fog-tile.png`

### Fog

- `apps/cocos-client/assets/resources/placeholder/fog/hidden-0.png` through `hidden-15.png`
- `apps/cocos-client/assets/resources/placeholder/fog/explored-0.png` through `explored-15.png`

### Buildings

- `apps/cocos-client/assets/resources/pixel/buildings/recruitment-post.png`
- `apps/cocos-client/assets/resources/pixel/buildings/attribute-shrine.png`
- `apps/cocos-client/assets/resources/pixel/buildings/resource-mine.png`
- `apps/cocos-client/assets/resources/pixel/buildings/forge-hall.png`

### Resources

- `apps/cocos-client/assets/resources/pixel/resources/gold-pile.png`
- `apps/cocos-client/assets/resources/pixel/resources/wood-stack.png`
- `apps/cocos-client/assets/resources/pixel/resources/ore-crate.png`

### Generator

- `scripts/art/generate_cocos_map_art_pack.py`

## Style Check

Target style:

- higher-fidelity pixel art
- cold frontier
- low-saturation terrain
- darker, layered fog
- rougher building and resource silhouettes

Result:

- terrain now reads as a coherent cold-gray borderland rather than mixed placeholder-era production art
- fog no longer reads as flat masking
- buildings have clearer frontier-outpost and cold-stone landmark identity
- resource nodes are separated by material rather than simple hue swaps

## Integration Check

The upgrade remained slot-compatible with:

- `configs/assets.json`
- `packages/shared/src/assets-config.ts`
- `apps/cocos-client/assets/scripts/cocos-pixel-sprite-manifest.ts`
- `apps/cocos-client/assets/scripts/cocos-map-visuals.ts`

No config-key rename and no gameplay-code rewrite were required.

## Verification Run

Passed:

- `npm run typecheck -- cocos`
- `node --import ./node_modules/tsx/dist/loader.mjs --test ./apps/cocos-client/test/cocos-map-visuals.test.ts ./apps/cocos-client/test/cocos-fog-overlay.test.ts ./apps/cocos-client/test/cocos-pixel-sprite-manifest.test.ts ./apps/cocos-client/test/cocos-pixel-sprites.test.ts ./apps/cocos-client/test/cocos-placeholder-sprites.test.ts ./apps/cocos-client/test/cocos-lobby-panel.test.ts ./apps/cocos-client/test/cocos-lobby-panel-model.test.ts ./apps/cocos-client/test/cocos-root-orchestration.test.ts ./apps/cocos-client/test/cocos-veil-root.test.ts ./apps/cocos-client/test/cocos-primary-client-journey.test.ts`
- `npm run smoke -- cocos:canonical-journey`

Gameplay-chain validation covered:

- new run
- world movement
- resource collection
- mine capture
- next-day progression
- recruitment-post interaction
- fog-state visibility transitions

## Preview Entry

A tracked preview page is available at:

- `docs/superpowers/specs/2026-04-20-map-art-upgrade-preview.html`

That page references the real assets in the repository, not external mockups.
