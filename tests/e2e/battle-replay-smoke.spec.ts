import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  buildRoomId,
  followTilePath,
  fullMoveTextPattern,
  openRoom,
  pressTile,
  resolveBattleToSettlement,
  withSmokeDiagnostics
} from "./smoke-helpers";
import { ADMIN_TOKEN, SERVER_BASE_URL } from "./runtime-targets";

interface PlayerBattleReplaySummary {
  id: string;
  battleId: string;
  steps: unknown[];
}

interface BattleReplayPlaybackState {
  currentStepIndex: number;
  totalSteps: number;
}

interface GuestLoginPayload {
  session?: {
    token?: string;
  };
}

function extractBattleId(roomId: string, detail: string): string {
  const match = detail.match(new RegExp(`遭遇会话：${roomId}/([^\\s。]+)`));
  if (!match?.[1]) {
    throw new Error(`battle_id_not_found:${detail}`);
  }
  return match[1];
}

async function getJson<T>(
  request: APIRequestContext,
  path: string,
  headers?: Record<string, string>
): Promise<T> {
  const response = await request.get(`${SERVER_BASE_URL}${path}`, headers ? { headers } : undefined);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as T;
}

async function createGuestSessionToken(request: APIRequestContext, playerId: string): Promise<string> {
  const response = await request.post(`${SERVER_BASE_URL}/api/auth/guest-login`, {
    data: {
      playerId,
      displayName: playerId,
      privacyConsentAccepted: true
    }
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as GuestLoginPayload;
  const token = payload.session?.token?.trim();
  expect(token).toBeTruthy();
  return token ?? "";
}

test("battle replay center smoke persists a resolved PvP battle and supports account playback", async ({
  browser,
  request
}, testInfo) => {
  const resetResponse = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`, {
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    }
  });
  expect(resetResponse.ok()).toBeTruthy();

  const roomId = buildRoomId("e2e-battle-replay");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage], async () => {
      await test.step("setup: both players enter the same room", async () => {
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
      });

      let battleId = "";
      const replayPlayerId = "player-1";

      await test.step("gameplay: resolve the PvP battle to completion", async () => {
        await pressTile(playerOnePage, 3, 1);
        await followTilePath(
          playerTwoPage,
          [
            { x: 6, y: 4, spent: 2 },
            { x: 6, y: 2, spent: 4 },
            { x: 5, y: 1, spent: 6 }
          ],
          "player-2"
        );
        await pressTile(playerOnePage, 5, 1);

        await expect(playerOnePage.getByTestId("room-status-detail")).toContainText(`遭遇会话：${roomId}/battle-`);
        battleId = extractBattleId(roomId, await playerOnePage.getByTestId("room-status-detail").innerText());

        await resolveBattleToSettlement(playerOnePage, playerTwoPage);

        await expect(playerOnePage.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
        await expect(playerTwoPage.getByTestId("battle-modal-title")).toHaveText("战斗失败");
      });

      await test.step("api: list, detail, and playback routes expose the saved replay", async () => {
        let replaySummary: PlayerBattleReplaySummary | null = null;
        let replayId: string | null = null;
        const token = await createGuestSessionToken(request, replayPlayerId);
        const authHeaders = {
          Authorization: `Bearer ${token}`
        };

        await expect
          .poll(
            async () => {
              const payload = await getJson<{ items: PlayerBattleReplaySummary[] }>(
                request,
                `/api/player-accounts/${encodeURIComponent(replayPlayerId)}/battle-replays`,
                authHeaders
              );
              replaySummary = payload.items.find((item) => item.battleId === battleId) ?? null;
              replayId = replaySummary?.id ?? null;
              return replaySummary?.battleId ?? null;
            },
            {
              message: `waiting for replay summary ${battleId}`,
              timeout: 10_000
            }
          )
          .toBe(battleId);

        expect(replaySummary).not.toBeNull();
        expect(replayId).not.toBeNull();

        const detailPayload = await getJson<{ replay: PlayerBattleReplaySummary }>(
          request,
          `/api/player-accounts/${encodeURIComponent(replayPlayerId)}/battle-replays/${encodeURIComponent(replayId!)}`,
          authHeaders
        );
        expect(detailPayload.replay.battleId).toBe(battleId);
        expect(detailPayload.replay.steps.length).toBeGreaterThan(0);

        const playbackResponse = await request.post(
          `${SERVER_BASE_URL}/api/player-accounts/${encodeURIComponent(replayPlayerId)}/battle-replays/${encodeURIComponent(replayId!)}/playback`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            data: {
              command: "step-forward"
            }
          }
        );
        expect(playbackResponse.ok()).toBeTruthy();
        const playbackPayload = (await playbackResponse.json()) as { playback: BattleReplayPlaybackState };
        expect(playbackPayload.playback.currentStepIndex).toBeGreaterThan(0);
        expect(playbackPayload.playback.totalSteps).toBeGreaterThan(0);
      });
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
