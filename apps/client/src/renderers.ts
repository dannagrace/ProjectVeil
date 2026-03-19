import type { BattleState, HeroState, PlayerTileView, PlayerWorldView } from "../../../packages/shared/src/index";

function terrainSymbol(tile: PlayerTileView): string {
  if (tile.fog === "hidden") {
    return "?";
  }

  return tile.terrain.slice(0, 1).toUpperCase() || ".";
}

function renderTile(tile: PlayerTileView): string {
  const resource = tile.resource ? `(${tile.resource.kind}:${tile.resource.amount})` : "";
  const occupant = tile.occupant?.kind === "neutral" ? "[M]" : tile.occupant?.kind === "hero" ? "[H]" : "";
  return `${terrainSymbol(tile)}${resource}${occupant}`;
}

function renderHero(hero: HeroState): string {
  return `${hero.name} HP:${hero.stats.hp}/${hero.stats.maxHp} MOV:${hero.move.remaining}/${hero.move.total}`;
}

export function renderWorldState(state: PlayerWorldView): string {
  const rows = state.map.tiles
    .reduce<string[]>((result, tile, index) => {
      const row = Math.floor(index / state.map.width);
      result[row] = `${result[row] ?? ""}${renderTile(tile).padEnd(9, " ")}`;
      return result;
    }, [])
    .join("\n");

  return [
    `Room: ${state.meta.roomId}`,
    `Day: ${state.meta.day}`,
    `Own Heroes:`,
    ...state.ownHeroes.map(renderHero),
    `Visible Enemies:`,
    ...(state.visibleHeroes.length > 0
      ? state.visibleHeroes.map((hero) => `${hero.name} @ (${hero.position.x},${hero.position.y})`)
      : ["None"]),
    "",
    rows
  ].join("\n");
}

export function renderBattleState(state: BattleState): string {
  if (state.turnOrder.length === 0) {
    return "Battle idle";
  }

  return [
    `Battle: ${state.id}`,
    `Round: ${state.round}`,
    `Active: ${state.activeUnitId}`,
    ...state.turnOrder.flatMap((unitId) => {
      const unit = state.units[unitId];
      if (!unit) {
        return [];
      }
      return `${unitId} ${unit.stackName} x${unit.count} HP:${unit.currentHp}${unit.defending ? " DEF" : ""}`;
    }),
    `RNG Cursor: ${state.rng.cursor}`
  ].join("\n");
}
