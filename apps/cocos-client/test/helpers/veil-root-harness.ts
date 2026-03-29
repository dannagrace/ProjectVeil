import { VeilRoot } from "../../assets/scripts/VeilRoot.ts";
import type { SessionUpdate } from "../../assets/scripts/VeilCocosSession.ts";

export function createVeilRootHarness(): VeilRoot & Record<string, unknown> {
  const root = new VeilRoot() as VeilRoot & Record<string, unknown>;
  root.renderView = () => undefined;
  root.syncBrowserRoomQuery = () => undefined;
  root.syncWechatShareBridge = () => ({
    available: false,
    menuEnabled: false,
    handlerRegistered: false,
    canShareDirectly: false,
    immediateShared: false,
    payload: null,
    message: "disabled"
  });
  root.applySessionUpdate = async (update: SessionUpdate) => {
    root.lastUpdate = update;
  };
  root.applyReplayedSessionUpdate = (update: SessionUpdate) => {
    root.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
  };
  root.refreshLobbyRoomList = async () => undefined;
  root.refreshLobbyAccountProfile = async () => undefined;
  return root;
}
