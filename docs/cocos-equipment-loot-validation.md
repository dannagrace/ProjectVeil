# Cocos Equipment And Loot Validation

## Current Flow Audit

- Shared layer: `packages/shared/src/equipment.ts` owns the equipment catalog, slot validation, equip/unequip mutation, and derived bonus resolution.
- Shared layer: `packages/shared/src/map.ts` adds post-battle equipment drops through `hero.equipmentFound` and rotates equipped items back into hero inventory on `hero.equip` / `hero.unequip`.
- Server layer: `apps/server/src/colyseus-room.ts` and the existing room action pipeline already forward authoritative `world.action` requests and `session.state` snapshots without any Cocos-specific branching.
- Cocos session layer: `apps/cocos-client/assets/scripts/VeilCocosSession.ts` already sends `hero.equip` / `hero.unequip` requests and caches the returned `SessionUpdate`.
- Cocos prediction/HUD layer: `apps/cocos-client/assets/scripts/cocos-prediction.ts`, `apps/cocos-client/assets/scripts/cocos-hero-equipment.ts`, and `apps/cocos-client/assets/scripts/VeilHudPanel.ts` present hero loadout state, grouped inventory choices, recent loot, and visible stat changes inside the primary runtime.

## Implemented Slice For #206

- HUD `装备配置` card now shows:
  - current slot occupancy for weapon / armor / accessory
  - per-slot rarity and bonus summary
  - equipment-derived stat gains aggregated from shared logic
  - carried inventory grouped by item type with rarity and bonus metadata
  - recent loot lines from the Cocos-visible account event log
- Existing equip/unequip buttons remain the interaction surface and continue to drive prediction plus server reconciliation.
- No unrelated gameplay systems were changed; this is a presentation-first slice on top of the existing authoritative flow.

## Local Verification

1. Start the server with `npm run dev:server`.
2. Open `apps/cocos-client` in Cocos Creator 3.8.x and preview a scene with `VeilRoot`.
3. Enter a room and move until you trigger at least one neutral battle.
4. Win a battle that grants equipment.
5. Confirm the HUD `装备配置` card shows a `战利品` section with the new drop.
6. Confirm the same card shows the item in the `背包` list with rarity and stat summary.
7. Click an equipment action button in the same card.
8. Confirm the hero stat lines in the HUD update immediately after prediction/reconciliation.
9. Click the matching unequip action and confirm the item returns to inventory and the stat gain line rolls back.

## Temporary Assumptions

- Loot history in the HUD is sourced from the existing account event log descriptions, so the loot rows currently display the authoritative log copy rather than a bespoke item card.
- Equipment interactions are only exposed when the hero is outside battle; in-battle equipment changes remain blocked by the current runtime rules.
