import { createRoom, type AuthoritativeWorldRoom } from "@server/index";

function printSection(title: string, lines: string[]): void {
  console.log(`\n=== ${title} ===`);
  for (const line of lines) {
    console.log(line);
  }
}

function formatWorld(room: AuthoritativeWorldRoom): string[] {
  const snapshot = room.getSnapshot("player-1");
  return [
    `Day ${snapshot.state.meta.day}`,
    `Hero @ (${snapshot.state.ownHeroes[0]?.position.x},${snapshot.state.ownHeroes[0]?.position.y})`,
    `Resources ${JSON.stringify(snapshot.state.resources)}`
  ];
}

const room = createRoom("demo-room", 1001);
printSection("Initial World", formatWorld(room));

const moveResult = room.dispatch("player-1", {
  type: "hero.move",
  heroId: "hero-1",
  destination: { x: 5, y: 4 }
});

printSection(
  "After Move",
  [
    `ok=${moveResult.ok}`,
    `events=${JSON.stringify(moveResult.events ?? [])}`,
    `path=${JSON.stringify(moveResult.movementPlan?.path ?? [])}`,
    ...formatWorld(room)
  ]
);

let battle = moveResult.battle;
while (battle) {
  const active = battle.activeUnitId;
  const activeUnit = active ? battle.units[active] : undefined;
  if (!active || !activeUnit) {
    break;
  }

  const target = Object.values(battle.units).find((unit) => unit.camp !== activeUnit.camp && unit.count > 0);
  if (!target) {
    break;
  }

  const battleResult = room.dispatchBattle("player-1", {
    type: "battle.attack",
    attackerId: active,
    defenderId: target.id
  });

  printSection(
    "Battle Tick",
    [
      `ok=${battleResult.ok}`,
      ...(battleResult.reason ? [`reason=${battleResult.reason}`] : []),
      ...(battleResult.battle?.log.slice(-2) ?? [])
    ]
  );

  battle = battleResult.battle;
  if (!battle) {
    printSection(
      "World After Battle",
      [
        `events=${JSON.stringify(battleResult.events ?? [])}`,
        ...formatWorld(room)
      ]
    );
  }
}
