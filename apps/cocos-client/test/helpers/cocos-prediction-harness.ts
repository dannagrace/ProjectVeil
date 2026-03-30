import type { HeroView, OccupantState, PlayerTileView, PlayerWorldView, Vec2 } from "../../assets/scripts/VeilCocosSession.ts";
import { createSessionUpdate } from "./cocos-session-fixtures.ts";

export function createPredictionWorld(options?: {
  width?: number;
  height?: number;
  heroPosition?: Vec2;
  moveRemaining?: number;
  visibleHeroes?: PlayerWorldView["visibleHeroes"];
}) : PlayerWorldView {
  const baseWorld = createSessionUpdate().world;
  const width = options?.width ?? 4;
  const height = options?.height ?? 3;
  const heroPosition = options?.heroPosition ?? { x: 0, y: 0 };
  const moveRemaining = options?.moveRemaining ?? 6;

  const tiles: PlayerTileView[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles.push({
        position: { x, y },
        fog: "visible",
        terrain: "grass",
        walkable: true,
        resource: undefined,
        occupant: undefined,
        building: undefined
      });
    }
  }

  const hero: HeroView = {
    ...baseWorld.ownHeroes[0]!,
    position: { ...heroPosition },
    move: {
      ...baseWorld.ownHeroes[0]!.move,
      remaining: moveRemaining
    }
  };

  setTileOccupant(tiles, width, heroPosition, {
    kind: "hero",
    refId: hero.id
  });

  return {
    ...baseWorld,
    map: {
      width,
      height,
      tiles
    },
    ownHeroes: [hero],
    visibleHeroes: options?.visibleHeroes?.map((item) => ({
      ...item,
      position: { ...item.position }
    })) ?? []
  };
}

export function updateTile(
  world: PlayerWorldView,
  position: Vec2,
  update: Partial<PlayerTileView>
): PlayerWorldView {
  return {
    ...world,
    map: {
      ...world.map,
      tiles: world.map.tiles.map((tile) =>
        samePosition(tile.position, position)
          ? {
              ...tile,
              ...update
            }
          : tile
      )
    }
  };
}

export function placeOwnHero(world: PlayerWorldView, hero: Pick<HeroView, "id" | "playerId" | "name" | "position">): PlayerWorldView {
  const template = world.ownHeroes[0]!;
  return {
    ...world,
    ownHeroes: [
      ...world.ownHeroes,
      {
        ...template,
        id: hero.id,
        playerId: hero.playerId,
        name: hero.name,
        position: { ...hero.position }
      }
    ],
    map: {
      ...world.map,
      tiles: setTileOccupant(world.map.tiles, world.map.width, hero.position, {
        kind: "hero",
        refId: hero.id
      })
    }
  };
}

export function withOccupant(world: PlayerWorldView, position: Vec2, occupant: OccupantState | undefined): PlayerWorldView {
  return updateTile(world, position, { occupant });
}

function setTileOccupant(
  tiles: PlayerTileView[],
  width: number,
  position: Vec2,
  occupant: OccupantState
): PlayerTileView[] {
  const index = position.y * width + position.x;
  tiles[index] = {
    ...tiles[index]!,
    occupant
  };
  return tiles;
}

function samePosition(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
