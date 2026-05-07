import { pathToFileURL } from "node:url";

import { createRoom, type AuthoritativeWorldRoom } from "@server/index";

type DemoLogger = (line: string) => void;

function printSection(title: string, lines: string[], log: DemoLogger): void {
  log(`\n=== ${title} ===`);
  for (const line of lines) {
    log(line);
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

const demoMovementPath = [
  { x: 3, y: 1 },
  { x: 5, y: 1 },
  { x: 5, y: 3 },
  { x: 5, y: 4 }
] as const;

export function runDemoFlow(log: DemoLogger = console.log): void {
  const room = createRoom("demo-room", 1001);
  printSection("Initial World", formatWorld(room), log);

  let moveResult: ReturnType<AuthoritativeWorldRoom["dispatch"]> | null = null;

  for (const destination of demoMovementPath) {
    moveResult = room.dispatch("player-1", {
      type: "hero.move",
      heroId: "hero-1",
      destination
    });

    printSection(
      `Move To (${destination.x},${destination.y})`,
      [
        `ok=${moveResult.ok}`,
        ...(moveResult.reason ? [`reason=${moveResult.reason}`] : []),
        `events=${JSON.stringify(moveResult.events ?? [])}`,
        `path=${JSON.stringify(moveResult.movementPlan?.path ?? [])}`,
        ...formatWorld(room)
      ],
      log
    );

    if (!moveResult.ok) {
      throw new Error(`Demo move failed at (${destination.x},${destination.y}): ${moveResult.reason ?? "unknown"}`);
    }
  }

  let battle = moveResult?.battle;
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
      ],
      log
    );

    if (!battleResult.ok) {
      throw new Error(`Demo battle failed: ${battleResult.reason ?? "unknown"}`);
    }

    battle = battleResult.battle;
    if (!battle) {
      printSection(
        "World After Battle",
        [
          `events=${JSON.stringify(battleResult.events ?? [])}`,
          ...formatWorld(room)
        ],
        log
      );
    }
  }
}

function isDirectRun(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  runDemoFlow();
}
