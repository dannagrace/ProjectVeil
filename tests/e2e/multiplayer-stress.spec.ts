import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { decodePlayerWorldView } from "../../packages/shared/src/index";
import {
  buildRoomId,
  expectHeroMoveSpentForSession,
  followTilePathForSession,
  fullMoveTextPattern,
  openAuthenticatedMultiplayerRoomPair,
  openRoom,
  pressTile,
  reloadAndExpectAuthoritativeConvergence,
  withSmokeDiagnostics
} from "./smoke-helpers";
import { ADMIN_TOKEN, SERVER_BASE_URL, SERVER_WS_URL } from "./runtime-targets";

interface AutomationState {
  hero?: {
    id: string;
    x: number;
    y: number;
    move: {
      total: number;
      remaining: number;
    };
  } | null;
  ownHeroes?: Array<{
    id: string;
    playerId: string;
    position: {
      x: number;
      y: number;
    };
    move: {
      total: number;
      remaining: number;
    };
  }>;
}

interface RawSessionStateMessage {
  requestId: string;
  delivery: "reply" | "push";
  payload: {
    world: Parameters<typeof decodePlayerWorldView>[0];
    reason?: string;
    rejection?: {
      reason?: string;
    };
  };
}

interface RawSession {
  room: ColyseusRoom;
  statesByRequestId: Map<string, RawSessionStateMessage[]>;
  getLatestWorld(): ReturnType<typeof decodePlayerWorldView>;
  close(): Promise<void>;
}

interface ReachableTile {
  x: number;
  y: number;
}

async function resetStore(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`, {
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    }
  });
  expect(response.ok()).toBeTruthy();
}

async function readAutomationState(page: Page): Promise<AutomationState> {
  const text = await page.evaluate(() => window.render_game_to_text?.() ?? "{}");
  return JSON.parse(text) as AutomationState;
}

async function hoverTile(page: Page, x: number, y: number): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(({ x, y }) => {
        const tile = document.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`);
        if (!tile) {
          return false;
        }
        tile.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true, view: window }));
        return true;
      }, { x, y })
    )
    .toBe(true);
}

async function readReachableTiles(page: Page): Promise<ReachableTile[]> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(".tile.is-reachable"))
      .filter((tile) => !tile.classList.contains("is-hero") && !tile.classList.contains("fog-hidden"))
      .map((tile) => ({
        x: Number(tile.dataset.x ?? Number.NaN),
        y: Number(tile.dataset.y ?? Number.NaN)
      }))
      .filter((tile) => Number.isFinite(tile.x) && Number.isFinite(tile.y))
  );
}

async function selectSharedReachableTile(playerOnePage: Page, playerTwoPage: Page): Promise<ReachableTile> {
  const [playerOneTiles, playerTwoTiles] = await Promise.all([
    readReachableTiles(playerOnePage),
    readReachableTiles(playerTwoPage)
  ]);
  const playerTwoTileKeys = new Set(playerTwoTiles.map((tile) => `${tile.x},${tile.y}`));
  const sharedTiles = playerOneTiles.filter((tile) => playerTwoTileKeys.has(`${tile.x},${tile.y}`));

  sharedTiles.sort((left, right) => {
    const leftCenterDistance = Math.abs(left.x - 3) + Math.abs(left.y - 3);
    const rightCenterDistance = Math.abs(right.x - 3) + Math.abs(right.y - 3);
    if (leftCenterDistance !== rightCenterDistance) {
      return leftCenterDistance - rightCenterDistance;
    }
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    return left.x - right.x;
  });

  const target = sharedTiles[0];
  if (!target) {
    throw new Error("shared_reachable_tile_missing");
  }
  return target;
}

async function readMoveSpent(page: Page): Promise<number | null> {
  const move = (await readAutomationState(page)).hero?.move;
  return move ? move.total - move.remaining : null;
}

async function expectMoveSpentGreaterThan(page: Page, minimumSpent: number): Promise<void> {
  await expect.poll(async () => readMoveSpent(page)).toBeGreaterThan(minimumSpent);
}

async function connectRawSession(roomId: string, playerId: string): Promise<RawSession> {
  const client = new Client(SERVER_WS_URL);
  const room = await client.joinOrCreate("veil", {
    logicalRoomId: roomId,
    playerId,
    seed: 1001
  });
  const statesByRequestId = new Map<string, RawSessionStateMessage[]>();
  let latestState: RawSessionStateMessage | null = null;

  room.onMessage("session.state", (message: RawSessionStateMessage) => {
    latestState = message;
    const bucket = statesByRequestId.get(message.requestId) ?? [];
    bucket.push(message);
    statesByRequestId.set(message.requestId, bucket);
  });

  room.send("connect", {
    type: "connect",
    requestId: `connect-${playerId}`,
    roomId,
    playerId
  });

  await expect
    .poll(() => statesByRequestId.get(`connect-${playerId}`)?.length ?? 0, {
      message: `waiting for raw connect reply for ${playerId}`
    })
    .toBe(1);

  return {
    room,
    statesByRequestId,
    getLatestWorld() {
      if (!latestState) {
        throw new Error(`missing_latest_state:${playerId}`);
      }
      return decodePlayerWorldView(latestState.payload.world);
    },
    async close() {
      await room.leave();
    }
  };
}

test("duplicate action is idempotent", async ({ request }) => {
  await resetStore(request);
  const roomId = buildRoomId("e2e-multi-stress-dedup");
  const session = await connectRawSession(roomId, "player-1");

  try {
    const hero = session.getLatestWorld().ownHeroes[0];
    const requestId = "duplicate-move";
    const action = {
      type: "hero.move" as const,
      heroId: hero.id,
      destination: { x: 0, y: 1 }
    };

    session.room.send("world.action", {
      type: "world.action",
      requestId,
      action
    });
    session.room.send("world.action", {
      type: "world.action",
      requestId,
      action
    });

    await expect
      .poll(() => session.statesByRequestId.get(requestId)?.length ?? 0, {
        message: "waiting for duplicated move replies"
      })
      .toBe(2);

    const replies = session.statesByRequestId.get(requestId) ?? [];
    const worlds = replies.map((reply) => decodePlayerWorldView(reply.payload.world));

    expect(replies.map((reply) => reply.payload.reason)).toEqual([undefined, undefined]);
    expect(replies.map((reply) => reply.payload.rejection?.reason)).toEqual([undefined, undefined]);
    expect(worlds.map((world) => world.ownHeroes[0]?.position)).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 1 }
    ]);
    expect(worlds.map((world) => world.ownHeroes[0]?.move.remaining)).toEqual([5, 5]);
  } finally {
    await session.close();
  }
});

test("concurrent move to same tile resolves deterministically", async ({ browser, request }, testInfo) => {
  await resetStore(request);
  const roomId = buildRoomId("e2e-multi-stress-conflict");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage], async () => {
      await openAuthenticatedMultiplayerRoomPair(request, playerOnePage, playerTwoPage, roomId);
      await pressTile(playerOnePage, 3, 1);
      await expectHeroMoveSpentForSession(playerOnePage, 2);
      await followTilePathForSession(playerTwoPage, [
        { x: 6, y: 4, spent: 2 },
        { x: 6, y: 2, spent: 4 }
      ]);
      const target = await selectSharedReachableTile(playerOnePage, playerTwoPage);
      const playerOneSpentBefore = (await readMoveSpent(playerOnePage)) ?? 0;
      const playerTwoSpentBefore = (await readMoveSpent(playerTwoPage)) ?? 0;

      await Promise.all([pressTile(playerOnePage, target.x, target.y), pressTile(playerTwoPage, target.x, target.y)]);

      await expect(playerOnePage.getByTestId("battle-panel")).not.toContainText("No active battle", { timeout: 10_000 });
      await expect(playerTwoPage.getByTestId("battle-panel")).not.toContainText("No active battle", { timeout: 10_000 });

      await expect
        .poll(async () => (await readAutomationState(playerOnePage)).hero?.x ?? null, {
          message: "waiting for player one authoritative tile resolution"
        })
        .toBe(target.x);
      await expect.poll(async () => (await readAutomationState(playerOnePage)).hero?.y ?? null).toBe(target.y);
      await expect
        .poll(async () => {
          const hero = (await readAutomationState(playerTwoPage)).hero;
          return hero ? `${hero.x},${hero.y}` : null;
        })
        .not.toBe(`${target.x},${target.y}`);
      await expectMoveSpentGreaterThan(playerOnePage, playerOneSpentBefore);
      await expectMoveSpentGreaterThan(playerTwoPage, playerTwoSpentBefore);
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});

test("late-join is rejected with correct error code", async ({ browser, request }, testInfo) => {
  await resetStore(request);
  const roomId = buildRoomId("e2e-multi-stress-room-full");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerThreeContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();
  const playerThreePage = await playerThreeContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage, playerThreePage], async () => {
      await Promise.all([
        openRoom(playerOnePage, {
          roomId,
          playerId: "player-1",
          expectedMoveText: fullMoveTextPattern("player-1")
        }),
        openRoom(playerTwoPage, {
          roomId,
          playerId: "player-2",
          expectedMoveText: fullMoveTextPattern("player-2")
        })
      ]);

      await playerThreePage.goto(`/?roomId=${encodeURIComponent(roomId)}&playerId=player-3`, {
        waitUntil: "domcontentloaded"
      });

      await expect(playerThreePage.getByTestId("room-connection-summary")).toContainText("恢复失败", {
        timeout: 10_000
      });
      await expect(playerThreePage.getByTestId("event-log")).toContainText("room_full", {
        timeout: 10_000
      });
      await expect
        .poll(async () => (await readAutomationState(playerThreePage)).ownHeroes?.length ?? 0, {
          message: "waiting for rejected late join to remain hero-less"
        })
        .toBe(0);
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
    await playerThreeContext.close();
  }
});

test("client resync after server rollback produces consistent state", async ({ browser, request }, testInfo) => {
  await resetStore(request);
  const roomId = buildRoomId("e2e-multi-stress-resync");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage], async () => {
      const { playerOne, playerTwo } = await openAuthenticatedMultiplayerRoomPair(
        request,
        playerOnePage,
        playerTwoPage,
        roomId
      );

      await followTilePathForSession(playerTwoPage, [
        { x: 6, y: 4, spent: 2 },
        { x: 6, y: 2, spent: 4 },
        { x: 5, y: 1, spent: 6 }
      ]);

      await pressTile(playerOnePage, 3, 1);
      await expectHeroMoveSpentForSession(playerOnePage, 2);
      await pressTile(playerOnePage, 3, 1);

      await expect(playerTwoPage.getByTestId("event-log")).toContainText("收到房间同步推送", { timeout: 10_000 });
      await hoverTile(playerTwoPage, 3, 1);
      await expect(playerTwoPage.locator(".object-card-copy")).toContainText(`当前归属 ${playerOne.playerId}`);

      await reloadAndExpectAuthoritativeConvergence(playerTwoPage, {
        roomId,
        playerId: playerTwo.playerId
      });

      await hoverTile(playerTwoPage, 3, 1);
      await expect(playerTwoPage.locator(".object-card-copy")).toContainText(`当前归属 ${playerOne.playerId}`);
      await expectHeroMoveSpentForSession(playerTwoPage, 6);
      await expect(playerTwoPage.getByTestId("room-next-action")).not.toContainText("等待权威");

      await hoverTile(playerOnePage, 3, 1);
      await expect(playerOnePage.locator(".object-card-copy")).toContainText(`当前归属 ${playerOne.playerId}`);
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
