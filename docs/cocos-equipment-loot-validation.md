# Cocos Equipment And Loot Validation

## Current Flow Audit

- Shared layer: `packages/shared/src/equipment.ts` owns the equipment catalog, slot validation, equip/unequip mutation, and derived bonus resolution.
- Shared layer: `packages/shared/src/map.ts` adds post-battle equipment drops through `hero.equipmentFound` and rotates equipped items back into hero inventory on `hero.equip` / `hero.unequip`.
- Server layer: `apps/server/src/colyseus-room.ts` and the existing room action pipeline already forward authoritative `world.action` requests and `session.state` snapshots without any Cocos-specific branching.
- Cocos session layer: `apps/cocos-client/assets/scripts/VeilCocosSession.ts` already sends `hero.equip` / `hero.unequip` requests and caches the returned `SessionUpdate`.
- Cocos prediction/HUD layer: `apps/cocos-client/assets/scripts/cocos-prediction.ts`, `apps/cocos-client/assets/scripts/cocos-hero-equipment.ts`, and `apps/cocos-client/assets/scripts/VeilHudPanel.ts` present hero loadout state, grouped inventory choices, recent loot, and visible stat changes inside the primary runtime.

## Implemented Slice For #1018

- Runtime entry points for this loop:
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`: opens/closes the gameplay equipment panel, routes equip/unequip actions, and feeds recent session loot plus account event log state into the panel.
  - `apps/cocos-client/assets/scripts/VeilEquipmentPanel.ts`: renders the bounded equipment bag surface, item inspection card, recent loot card, and equip/unequip controls.
  - `apps/cocos-client/assets/scripts/cocos-hero-equipment.ts`: adapts shared equipment contracts into grouped bag rows, inspectable item metadata, and readable stat/loot summaries for the Cocos runtime.
- HUD `装备配置` card now shows:
  - current slot occupancy for weapon / armor / accessory
  - per-slot rarity and bonus summary
  - equipment-derived stat gains aggregated from shared logic
  - carried inventory grouped by item type with rarity and bonus metadata
  - current backpack occupancy against the fixed 6-slot equipment inventory cap
  - a full-bag warning before the next equipment pickup would overflow
  - recent loot lines from the Cocos-visible account event log
- Primary client `装备背包` panel now provides a dedicated runtime surface for the same loop:
  - open it from the left HUD chrome without leaving the main scene
  - highlight the latest authoritative combat drop in a dedicated `战斗结算` loot spotlight card as soon as settlement lands
  - inspect one concrete equipped or backpack item at a time from a dedicated `物品详情` card
  - inspect equipped slots, grouped backpack contents, and recent loot in one place
  - filter the backpack by `全部 / 武器 / 护甲 / 饰品`
  - sort the backpack by `槽位 / 稀有度 / 名称`
  - execute equip / unequip actions from the panel and reuse the existing prediction plus authoritative reconciliation path
- Existing equip/unequip buttons remain the interaction surface and continue to drive prediction plus server reconciliation.
- The hero summary card now renders equipment-adjusted totals from shared progression math, so stat changes are visible during prediction and after reconciliation instead of only after a secondary refresh path.
- Recent loot rows now merge the latest authoritative session loot events with the persisted account event log, so battle drops and overflowed pickups stay visible immediately after combat even before account-history refresh finishes.
- Equipment loot now respects a fixed 6-slot backpack cap:
  - battle drops are only added when space remains
  - when full, the drop is surfaced as overflowed/not picked up instead of being silently appended
  - unequip is rejected while the backpack is full so equipped items are not pushed past capacity
- Remote gameplay refresh now stays on the injectable/root runtime loader and is skipped for local/manual sessions, so recent loot/event HUD data follows authoritative account updates without forcing unintended remote fetches.
- No unrelated gameplay systems were changed; this is a presentation-first slice on top of the existing authoritative flow.

## Local Verification

- Scripted smoke: `node --import tsx --test apps/cocos-client/test/cocos-primary-client-journey.test.ts`

1. Start the server with `npm run dev -- server`.
2. Open `apps/cocos-client` in Cocos Creator 3.8.x and preview a scene with `VeilRoot`.
3. Enter a room and move until you trigger at least one neutral battle.
4. Win a battle that grants equipment.
5. Click `装备背包` in the left HUD chrome and confirm the dedicated panel opens.
6. Confirm the panel `战斗结算` 卡片会高亮展示刚掉落的装备，并且 `最近战利品` / `背包清单` 同时包含该物品。
7. 切换 `全部 / 武器 / 护甲 / 饰品` 过滤按钮，并确认 `背包清单` 只显示对应分类。
8. 切换 `槽位 / 稀有度 / 名称` 排序按钮，并确认 `背包清单` 顺序立即变化。
9. Click a `查看 ...` button in the panel and confirm the `物品详情` card updates to show the selected item's rarity, source, stat bonuses, and description.
10. Fill the inventory to 6 items and trigger another equipment drop.
11. Confirm the panel, HUD, and event log clearly state the backpack was full and the overflowed drop was not picked up.
12. While the backpack is full, try to unequip an item and confirm the action is rejected with a full-inventory message.
13. Free one slot, then click an equip action button inside the `装备背包` panel.
14. Confirm the hero stat lines in the HUD update immediately after prediction/reconciliation.
15. Click the matching unequip action in the same panel and confirm the item returns to inventory and the stat gain line rolls back.

## Temporary Assumptions

- Loot history in the HUD is sourced from the existing account event log descriptions, so the loot rows currently display the authoritative log copy rather than a bespoke item card.
- Equipment interactions are only exposed when the hero is outside battle; in-battle equipment changes remain blocked by the current runtime rules.
