# 2026-04-20 Map Art Upgrade Design

## Status

Proposed and approved for planning. Not yet in implementation.

## Objective

Upgrade the Cocos map presentation with a higher-fidelity pixel-art package that materially improves first-glance quality while preserving gameplay readability and existing asset integration points.

This pass is limited to map and scene-facing resources. It does not include unit portraits, HUD icons, or gameplay system changes.

## Chosen Direction

- Execution model: reinforced map-pack upgrade
- Style target: higher-fidelity pixel art
- Atmosphere: cold frontier
- Scope: full map package, executed in phases

## Problem Statement

The current Cocos map still reads as a mix of placeholder-era and early-production assets:

- terrain and fog do not establish a strong scene identity
- building and resource nodes are functionally readable, but visually thin
- many assets are already marked `production` in config, so the remaining gap is presentation quality rather than missing hooks

The next improvement should raise visual quality without widening into a rendering-system rewrite.

## Scope

### In Scope

- terrain tiles
- fog and hidden-state map presentation
- buildings used as interactable world landmarks
- map resource nodes
- additional asset variants where current loading slots can accept them without logic changes

### Out of Scope

- unit portraits, hero art, and unit sprites
- HUD, UI icons, buttons, and menus
- map logic, collision, pathfinding, interaction rules
- camera, zoom, layout, or rendering code changes unless required for a non-breaking hookup

## Target Assets

### Terrain

- `grass`
- `dirt`
- `sand`
- `water`
- `hidden`
- `fog`

### Buildings

- `recruitment_post`
- `attribute_shrine`
- `resource_mine`
- `watchtower`

### Resource Nodes

- `gold`
- `wood`
- `ore`

### Primary Asset Locations

- `apps/cocos-client/assets/resources/pixel/terrain`
- `apps/cocos-client/assets/resources/placeholder/fog`
- `apps/cocos-client/assets/resources/pixel/buildings`
- `apps/cocos-client/assets/resources/pixel/resources`

## Visual Direction

### Overall Mood

Cold frontier, not bright heroic fantasy. The map should feel like a harsh contested borderland:

- lower saturation
- cold gray-biased palette
- stronger material contrast
- rougher, more weathered surfaces
- clear light/dark layering

### Readability Principle

Readability takes priority over texture detail:

1. players must identify tile state quickly
2. interactable points must stay recognizable at the current default Cocos zoom
3. visual polish must not reduce functional-test clarity

## Asset Rules

### Terrain Rules

- `grass`: cold green, not vivid lawn green
- `dirt`: gray-brown with gravel, ruts, and compacted ground cues
- `sand`: cool soil-sand mix, avoiding warm golden desert tones
- `water`: deeper and colder with firmer edge definition

### Fog and Hidden Rules

- avoid flat black masking
- use layered darkening, subtle noise, and edge variation
- explored vs hidden must remain clearly distinguishable
- fog should imply suppression and uncertainty, not just absence of light

### Building Rules

- `recruitment_post`: frontier camp or outpost identity
- `attribute_shrine`: cold stone sacred site rather than bright fantasy monument
- `resource_mine`: frontline extraction point, more industrial and exposed
- `watchtower`: border stronghold presence, sharper silhouette

### Resource Rules

- `gold`, `wood`, and `ore` must each read as a distinct material
- resource nodes must remain identifiable at small on-map size
- avoid simple color swaps as the primary differentiator

## Technical Constraints

- preserve current asset names, directory structure, and config keys wherever possible
- prefer direct replacement over integration churn
- keep current texture size class unless a specific asset requires controlled expansion
- only add variants where the existing config and loaders can consume them without gameplay-code changes

## Delivery Plan

### Phase 1: Terrain and Fog

Replace and unify:

- terrain base tiles
- hidden-state presentation
- fog overlays and edge treatment

Goal: fix the overall scene mood first so the entire map reads as a coherent world.

### Phase 2: Buildings and Resources

Replace and unify:

- building landmark art
- resource node art
- variant coverage where useful and supported

Goal: improve recognition and visual hierarchy of interactable world points.

### Phase 3: Integration Validation

Validate against:

- `configs/assets.json`
- `packages/shared/src/assets-config.ts`
- actual Cocos load paths and runtime references

Goal: confirm that the upgraded assets remain slot-compatible and do not require avoidable logic changes.

### Phase 4: Cocos Functional Acceptance

Run manual Cocos checks through at least:

- new run
- world movement
- resource collection
- mine capture
- recruitment-post interaction
- fog-state transition checks

Goal: ensure visual improvements survive real gameplay usage.

## Acceptance Criteria

- the map reads as a coherent cold-frontier environment at default Cocos zoom
- terrain states remain easy to distinguish
- fog and hidden states remain easy to distinguish
- buildings and resource nodes are recognizable without hover
- functional readability is not reduced compared with the current baseline
- asset replacement does not require gameplay-system rewrites

## Risks

### Risk: Scope Drift into Rendering Changes

If the asset work starts requiring changes to map rendering, zoom rules, or tile-assembly logic, stop and re-evaluate before continuing. This effort is an art-pack upgrade, not a renderer rewrite.

### Risk: Style Mismatch with Existing Units and UI

The upgraded map may become more mature than the current unit and UI visuals. In that case, preserve map readability and self-consistency first, and defer full cross-surface style unification to a later pass.

### Risk: Variant Explosion

A reinforced map pack can expand quickly. Keep variants only where they produce visible quality gain without creating config churn.

## Implementation Notes

- favor regenerated bitmap assets over patching low-quality originals
- allow minimal hand cleanup only where generation leaves obvious artifacts
- do not perform blind bulk replacement; land the upgrade in phase order and validate after each phase

## Review Outcome

This spec reflects the agreed plan:

- maps and scene resources first
- higher-fidelity pixel art
- full-map scope
- cold-frontier visual direction
- reinforced map-pack delivery

Implementation should start only after this spec is reviewed and locked.
