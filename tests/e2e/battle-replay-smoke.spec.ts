import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { attackOnce, buildRoomId, fullMoveTextPattern, openRoom, pressTile, withSmokeDiagnostics } from "./smoke-helpers";

const SERVER_BASE_URL = "http://127.0.0.1:2567";

interface StoredAuthSession {
  token?: string;
}

interface PlayerBattleReplaySummary {
  id: string;
  battleId: string;
  steps: unknown[];
}

interface BattleReplayPlaybackState {
  currentStepIndex: number;
  totalSteps: number;
}

function extractBattleId(roomId: string, detail: string): string {
  const match = detail.match(new RegExp(`遭遇会话：${roomId}/([^\\s]+)`));
  if (!match?.[1]) {
    throw new Error(`battle_id_not_found:${detail}`);
  }
  return match[1];
}

async function readAuthToken(page: Page): Promise<string> {
  let token: string | null = null;
  await expect
    .poll(
      async () => {
        token = await page.evaluate(() => {
          const raw = window.localStorage.getItem("project-veil:auth-session");
          if (!raw) {
            return null;
          }

          try {
            const session = JSON.parse(raw) as StoredAuthSession;
            return typeof session.token === "string" && session.token.trim().length > 0 ? session.token : null;
          } catch {
            return null;
          }
        });
        return token;
      },
      {
        message: "waiting for guest auth token",
        timeout: 10_000
      }
    )
    .not.toBeNull();

  return token as string;
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function getJson<T>(request: APIRequestContext, path: string, token: string): Promise<T> {
  const response = await request.get(`${SERVER_BASE_URL}${path}`, {
    headers: buildAuthHeaders(token)
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as T;
}

test("battle replay center smoke persists a resolved PvP battle and supports account playback", async ({
  browser,
  request
}, testInfo) => {
  const resetResponse = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`);
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

      await test.step("gameplay: resolve the PvP battle to completion", async () => {
        await pressTile(playerOnePage, 3, 4);
        await pressTile(playerTwoPage, 3, 4);

        await expect(playerOnePage.getByTestId("room-status-detail")).toContainText(`遭遇会话：${roomId}/battle-`);
        battleId = extractBattleId(roomId, await playerOnePage.getByTestId("room-status-detail").innerText());

        await attackOnce(playerTwoPage);
        await attackOnce(playerOnePage);
        await attackOnce(playerTwoPage);
        await attackOnce(playerOnePage);
        await attackOnce(playerTwoPage);

        await expect(playerOnePage.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
        await expect(playerTwoPage.getByTestId("battle-modal-title")).toHaveText("战斗失败");
      });

      await test.step("api: list, detail, and playback routes expose the saved replay", async () => {
        const token = await readAuthToken(playerOnePage);
        let replaySummary: PlayerBattleReplaySummary | null = null;

        await expect
          .poll(
            async () => {
              const payload = await getJson<{ items: PlayerBattleReplaySummary[] }>(
                request,
                "/api/player-accounts/me/battle-replays",
                token
              );
              replaySummary = payload.items.find((item) => item.battleId === battleId) ?? null;
              return replaySummary?.battleId ?? null;
            },
            {
              message: `waiting for replay summary ${battleId}`,
              timeout: 10_000
            }
          )
          .toBe(battleId);

        expect(replaySummary).not.toBeNull();

        const detailPayload = await getJson<{ replay: PlayerBattleReplaySummary }>(
          request,
          `/api/player-accounts/me/battle-replays/${encodeURIComponent(battleId)}`,
          token
        );
        expect(detailPayload.replay.battleId).toBe(battleId);
        expect(detailPayload.replay.steps.length).toBeGreaterThan(0);

        const playbackResponse = await request.post(
          `${SERVER_BASE_URL}/api/player-accounts/me/battle-replays/${encodeURIComponent(battleId)}/playback`,
          {
            headers: {
              ...buildAuthHeaders(token),
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
